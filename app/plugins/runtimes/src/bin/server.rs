//! Servidor do plugin Runtimes e execução. Pergunta ao núcleo onde estão os programas (sdk/which, a mesma busca da IDE:
//! PATH, SDKs baixados, PATH do registro) e quais JDKs existem (sdk/jdks); o resto é da biblioteca `runtimes`.
//!
//! Rotas:
//!   runtimes/check    ?project=&file=          -> { lang, name, needs: [estado de cada requisito] }
//!   runtimes/project  ?project=                -> { langs: [{ lang, name, files, needs }] }  (linguagens do projeto)
//!   runtimes/entries  POST { file, text }      -> { lang, entries: [{ line, label, target }] }  (o ▶ da margem)
//!   runtimes/plan     POST { project, file, line, args } -> { plan } | { missing: [...] } | { fallback: true }
//!   runtimes/select   POST { tool, path }      -> aponta uma instalação que já existe (vira o padrão da IDE)
//!   runtimes/forget                            -> esquece o que já foi procurado (depois de instalar por fora)
use bluescreen_sdk::plugin::{PluginServer, Req, core, ok};
use bluescreen_sdk::util::{ApiResult, absolute, fail};
use runtimes::{entries, langs, plan, require};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};

const WIN: bool = cfg!(windows);

/// parâmetro do corpo JSON ou da query
fn arg(r: &Req, body: &Value, k: &str) -> Option<String> {
    body[k].as_str().map(String::from).or_else(|| r.q(k).map(String::from)).filter(|s| !s.is_empty())
}
fn blocking_err(e: tokio::task::JoinError) -> bluescreen_sdk::util::ApiError { fail(e.to_string(), 500) }

// ---------- o que há no PC (pelo núcleo) ----------
struct Pc { which: HashMap<String, Option<String>>, jdks: Vec<plan::Jdk>, mavens: usize }
impl Pc {
    fn find(&self, prog: &str) -> Option<&str> { self.which.get(prog).and_then(|p| p.as_deref()) }
    fn has(&self, prog: &str) -> bool { self.find(prog).is_some() }
}
static PC: LazyLock<Mutex<Option<(Instant, Arc<Pc>)>>> = LazyLock::new(|| Mutex::new(None));
/// consulta o núcleo (guardado por 20 s: abrir abas seguidas não repete a busca)
async fn pc() -> ApiResult<Arc<Pc>> {
    if let Some((t, p)) = PC.lock().unwrap().clone() && t.elapsed() < Duration::from_secs(20) { return Ok(p); }
    let progs = langs::all_progs();
    let w = core().post("sdk/which", &[], &json!({ "progs": progs })).await?;
    let mut which: HashMap<String, Option<String>> = progs.iter().map(|p| (p.to_string(), w[*p].as_str().map(String::from))).collect();
    // o python.exe "da loja" (atalho em WindowsApps sem Python instalado) não é Python
    let stubs: Vec<String> = which.iter().filter(|(k, v)| k.starts_with("python") && v.as_deref().is_some_and(in_windows_apps)).map(|(k, _)| k.clone()).collect();
    for k in stubs {
        let p = which[&k].clone().unwrap_or_default();
        let real = tokio::task::spawn_blocking(move || version_of(&p, &["--version"]).is_some()).await.unwrap_or(false);
        if !real { which.insert(k, None); }
    }
    let jdks: Vec<plan::Jdk> = serde_json::from_value(core().get("sdk/jdks", &[]).await?).unwrap_or_default();
    // Mavens que o núcleo acha (~/Tools, C:\, MAVEN_HOME, SDKs, PATH): o build roda por eles
    let mavens = core().get("sdk/mavens", &[]).await.ok().and_then(|v| v.as_array().map(Vec::len)).unwrap_or(0);
    let p = Arc::new(Pc { which, jdks, mavens });
    *PC.lock().unwrap() = Some((Instant::now(), p.clone()));
    Ok(p)
}
fn in_windows_apps(p: &str) -> bool { p.to_lowercase().contains("\\windowsapps\\") }
fn forget() { *PC.lock().unwrap() = None; VERSIONS.lock().unwrap().clear(); }

// ---------- versão de um programa (guardada pela data do arquivo) ----------
static VERSIONS: LazyLock<Mutex<HashMap<String, (Option<SystemTime>, Option<String>)>>> = LazyLock::new(Default::default);
fn run_out(prog: &str, args: &[&str]) -> Option<String> {
    let mut c = std::process::Command::new(prog);
    c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    let mut child = c.spawn().ok()?;
    let t = Instant::now();
    // não trava a página por um programa que não responde
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if t.elapsed() < Duration::from_secs(6) => std::thread::sleep(Duration::from_millis(30)),
            _ => { let _ = child.kill(); return None; }
        }
    }
    let o = child.wait_with_output().ok()?;
    Some(format!("{}\n{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
}
fn version_of(path: &str, args: &[&str]) -> Option<String> {
    if args.is_empty() { return None; }
    let key = format!("{path}|{}", args.join(" "));
    let mt = std::fs::metadata(path).and_then(|m| m.modified()).ok();
    if let Some((m, v)) = VERSIONS.lock().unwrap().get(&key) && *m == mt { return v.clone(); }
    let v = run_out(path, args).and_then(|o| require::parse_version(&o));
    VERSIONS.lock().unwrap().insert(key, (mt, v.clone()));
    v
}

// ---------- estado de cada requisito ----------
#[derive(Serialize, Clone)]
struct Status {
    id: &'static str,
    name: &'static str,
    /// ok | missing | old (versão mais velha que a pedida)
    status: &'static str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")] path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] need: Option<require::Need>,
    sdk: Option<&'static str>,
    winget: Option<&'static str>,
    scoop: Option<&'static str>,
    url: &'static str,
    note: &'static str,
    /// outras opções que também resolvem (TypeScript: Deno, Bun)
    alts: Vec<&'static str>,
    /// Java: os JDKs achados, para escolher
    #[serde(skip_serializing_if = "Vec::is_empty")] jdks: Vec<plan::Jdk>,
}

fn tool_status(t: &'static langs::Tool, pc: &Pc, root: &Path, dir: &Path) -> Status {
    let need = require::need(t.id, root, dir);
    let mut st = Status { id: t.id, name: t.name, status: "missing", ok: false, path: None, version: None, need: need.clone(), sdk: t.sdk, winget: t.winget, scoop: t.scoop, url: t.url, note: t.note, alts: vec![], jdks: vec![] };
    if t.id == "jdk" {
        st.jdks = pc.jdks.clone();
        let min: u32 = need.as_ref().and_then(|n| n.version.parse().ok()).unwrap_or(0);
        if let Some(j) = plan::pick_jdk(&pc.jdks, min) {
            st.status = "ok";
            st.path = Some(j.home.clone());
            st.version = Some(if j.major > 0 { j.major.to_string() } else { j.name.clone() });
        } else if let Some(j) = pc.jdks.first() {
            st.status = "old";
            st.path = Some(j.home.clone());
            st.version = Some(j.major.to_string());
        }
        st.ok = st.status == "ok";
        return st;
    }
    let Some((prog, path)) = t.progs.iter().find_map(|p| pc.find(p).map(|x| (*p, x.to_string()))) else { return st };
    st.path = Some(path.clone());
    st.status = "ok";
    if t.id == "dotnet" {
        // vários SDKs lado a lado: basta um que atenda
        let sdks: Vec<String> = run_out(&path, &["--list-sdks"]).unwrap_or_default().lines().filter_map(|l| l.split_whitespace().next().map(String::from)).filter(|v| v.chars().next().is_some_and(|c| c.is_ascii_digit())).collect();
        st.version = sdks.last().cloned();
        if sdks.is_empty() { st.status = "missing"; st.note = "Só o runtime do .NET está instalado: falta o SDK (dotnet build/run)."; }
        else if let Some(n) = &need && !sdks.iter().any(|v| require::satisfies(v, &n.version)) { st.status = "old"; }
    } else {
        let args: &[&str] = if prog == "py" { &["--version"] } else { t.version_args };
        st.version = version_of(&path, args);
        if let (Some(v), Some(n)) = (&st.version, &need) && !require::satisfies(v, &n.version) { st.status = "old"; }
    }
    st.ok = st.status == "ok";
    st
}
/// um requisito (lista de alternativas): a primeira que está ok; senão a sugerida, com as outras como opção
fn requirement(alts: &[&str], pc: &Pc, root: &Path, dir: &Path) -> Status {
    let all: Vec<Status> = alts.iter().filter_map(|a| langs::tool(a)).map(|t| tool_status(t, pc, root, dir)).collect();
    if let Some(s) = all.iter().find(|s| s.ok) { return s.clone(); }
    // alguma instalada mas velha conta mais que nenhuma
    let mut s = all.iter().find(|s| s.status == "old").or(all.first()).cloned().expect("requisito sem ferramenta");
    s.alts = all.iter().filter(|x| x.id != s.id).map(|x| x.name).collect();
    s
}
fn needs_of(lang: &langs::Lang, pc: &Pc, root: &Path, file: Option<&Path>) -> Vec<Status> {
    let dir = file.and_then(Path::parent).unwrap_or(root);
    let build = file.map(|f| plan::build_of(root, f)).unwrap_or(plan::Build::None);
    let mut v: Vec<Status> = langs::needs_for(lang, build != plan::Build::None).into_iter().map(|alts| requirement(alts, pc, root, dir)).collect();
    // o arquivo é compilado pelo Maven ou pelo Gradle: precisa deles (o wrapper do projeto basta)
    let chain = require::up_to(root, dir);
    let wrapper = |n: &str| chain.iter().any(|d| d.join(n).is_file());
    let tool = match &build {
        plan::Build::Maven { .. } if !(wrapper("mvnw.cmd") || wrapper("mvnw") || pc.has("mvn") || pc.mavens > 0) => langs::tool("maven"),
        plan::Build::Gradle { .. } if !(wrapper("gradlew.bat") || wrapper("gradlew") || pc.has("gradle")) => langs::tool("gradle"),
        _ => None,
    };
    if let Some(t) = tool { v.push(tool_status(t, pc, root, dir)); }
    v
}

/// gerenciadores de pacotes do Windows que existem (para oferecer winget/scoop)
fn managers(pc: &Pc) -> Value { json!({ "winget": pc.has("winget"), "scoop": pc.has("scoop") }) }
fn project_path(r: &Req, body: &Value) -> ApiResult<PathBuf> { Ok(absolute(Path::new(&arg(r, body, "project").ok_or_else(|| fail("project obrigatório", 400))?))) }
fn file_path(root: &Path, rel: &str) -> PathBuf { let p = Path::new(rel); absolute(&if p.is_absolute() { p.to_path_buf() } else { root.join(p) }) }

// ---------- linguagens do projeto ----------
const SKIP: &[&str] = &["node_modules", "target", "build", "dist", "out", "bin", "obj", "vendor", "venv", ".venv", "env", "__pycache__", ".git", ".svn", ".idea", ".gradle", ".vs", "coverage", "packages", ".dart_tool", "zig-cache", ".zig-cache"];
fn scan(root: &Path) -> Vec<(&'static langs::Lang, usize)> {
    let mut count: HashMap<&'static str, usize> = HashMap::new();
    let mut seen = 0usize;
    let mut stack = vec![(root.to_path_buf(), 0u32)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > 40000 { break; }
            let n = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() { if depth < 8 && !n.starts_with('.') && !SKIP.contains(&n.as_str()) { stack.push((e.path(), depth + 1)); } }
            else if let Some(l) = langs::lang_of(Path::new(&n)) { *count.entry(l.id).or_default() += 1; }
        }
    }
    let mut v: Vec<(&'static langs::Lang, usize)> = count.into_iter().filter_map(|(id, n)| langs::lang(id).map(|l| (l, n))).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.name.cmp(b.0.name)));
    v.truncate(14);
    v
}

// ---------- apontar uma instalação ----------
/// pasta de programas dentro do que o usuário escolheu (a própria, bin, Scripts ou uma subpasta)
fn find_bin(path: &Path, progs: &[&str]) -> Option<PathBuf> {
    let has = |d: &Path| progs.iter().any(|p| ["exe", "cmd", "bat"].iter().any(|x| d.join(format!("{p}.{x}")).is_file()) || (!WIN && d.join(p).is_file()));
    let mut cands = vec![path.to_path_buf(), path.join("bin"), path.join("Scripts")];
    if let Ok(rd) = std::fs::read_dir(path) {
        let mut subs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        subs.sort();
        subs.reverse(); // a versão mais nova primeiro (jdk-21 antes de jdk-17)
        for s in subs.into_iter().take(40) { cands.push(s.join("bin")); cands.push(s); }
    }
    cands.into_iter().find(|d| has(d))
}

async fn select(tool: &str, path: &str) -> ApiResult<Value> {
    let t = langs::tool(tool).ok_or_else(|| fail("ferramenta desconhecida", 400))?;
    let p = PathBuf::from(path);
    if !p.is_dir() { return Err(fail(format!("A pasta {path} não existe"), 400)); }
    let progs: &[&str] = if t.id == "jdk" { &["javac"] } else { t.progs };
    let bin = { let p = p.clone(); tokio::task::spawn_blocking(move || find_bin(&p, progs)).await.map_err(blocking_err)? }
        .ok_or_else(|| fail(format!("Não achei {} em {path} (nem em bin/ ou nas subpastas). Escolha a pasta onde {} foi instalado.", progs.join(" ou "), t.name), 400))?;
    // SDKs que o núcleo conhece: viram o padrão do tipo (JAVA_HOME, PATH, JDK do build); o resto entra no PATH
    let home_kinds = ["jdk", "node", "python", "go", "dotnet", "zig", "kotlin", "maven", "gradle"];
    let (route, q_name, q_path) = if t.sdk == Some(t.id) && home_kinds.contains(&t.id) {
        // a pasta do SDK: a de cima do bin (JDK, Go, Kotlin, Maven, Gradle), a de cima do Scripts (Python) ou a própria
        // (Node, .NET, Zig e Python têm o programa na raiz)
        let up = |name: &str| bin.file_name().is_some_and(|n| n.eq_ignore_ascii_case(name));
        let home = if (up("bin") && ["jdk", "go", "kotlin", "maven", "gradle"].contains(&t.id)) || (up("Scripts") && t.id == "python") { bin.parent().unwrap_or(&bin).to_path_buf() } else { bin.clone() };
        ("sdk/default", "kind", home.to_string_lossy().into_owned())
    } else {
        ("sdk/path", "name", bin.to_string_lossy().into_owned())
    };
    let name = if route == "sdk/path" { format!("runtimes-{}", t.id) } else { t.id.to_string() };
    core().get(route, &[(q_name, &name), ("path", &q_path)]).await?;
    forget();
    let pc = pc().await?;
    let st = tool_status(t, &pc, &PathBuf::from(&q_path), &PathBuf::from(&q_path));
    Ok(json!({ "ok": true, "path": q_path, "version": st.version, "status": st }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let work = std::env::temp_dir().join("bluescreen-run");
    let mut p = PluginServer::new("runtimes");

    p.route("runtimes/check", |r: Arc<Req>| async move {
        let body: Value = r.body_json().unwrap_or_default();
        let root = project_path(&r, &body)?;
        let Some(rel) = arg(&r, &body, "file") else { return ok(json!({ "lang": null })) };
        let file = file_path(&root, &rel);
        let Some(lang) = langs::lang_of(&file) else { return ok(json!({ "lang": null })) };
        let pc = pc().await?;
        let pm = managers(&pc);
        let needs = tokio::task::spawn_blocking(move || needs_of(lang, &pc, &root, Some(&file))).await.map_err(blocking_err)?;
        ok(json!({ "lang": lang.id, "name": lang.name, "needs": needs, "pm": pm }))
    });

    p.route("runtimes/project", |r: Arc<Req>| async move {
        let root = project_path(&r, &Value::Null)?;
        let pc = pc().await?;
        let pm = managers(&pc);
        let langs = tokio::task::spawn_blocking(move || scan(&root).into_iter().map(|(l, n)| json!({ "lang": l.id, "name": l.name, "files": n, "needs": needs_of(l, &pc, &root, None) })).collect::<Vec<_>>())
            .await.map_err(blocking_err)?;
        ok(json!({ "langs": langs, "pm": pm }))
    });

    p.route("runtimes/entries", |r: Arc<Req>| async move {
        let body: Value = r.body_json()?;
        let file = arg(&r, &body, "file").unwrap_or_default();
        let Some(lang) = langs::lang_of(Path::new(&file)) else { return ok(json!({ "lang": null, "entries": [] })) };
        let text = body["text"].as_str().unwrap_or("");
        if text.len() > 4 * 1024 * 1024 { return ok(json!({ "lang": lang.id, "entries": [] })); }
        ok(json!({ "lang": lang.id, "entries": entries::find(lang.id, &file, text) }))
    });

    let w = work.clone();
    p.route("runtimes/plan", move |r: Arc<Req>| { let work = w.clone(); async move {
        r.local_only()?;
        let body: Value = r.body_json()?;
        let root = project_path(&r, &body)?;
        let file = file_path(&root, &arg(&r, &body, "file").ok_or_else(|| fail("file obrigatório", 400))?);
        let line = body["line"].as_u64().unwrap_or(0) as usize;
        let args = body["args"].as_str().unwrap_or("").to_string();
        let Some(lang) = langs::lang_of(&file) else { return ok(json!({ "fallback": true })) };
        let pc = pc().await?;
        tokio::task::spawn_blocking(move || -> ApiResult<Value> {
            let missing: Vec<Status> = needs_of(lang, &pc, &root, Some(&file)).into_iter().filter(|s| !s.ok).collect();
            if !missing.is_empty() { return Ok(json!({ "missing": missing, "lang": lang.id, "name": lang.name, "pm": managers(&pc) })); }
            let text = std::fs::read_to_string(&file).map_err(|e| fail(format!("não deu para ler {}: {e}", file.display()), 400))?;
            let list = entries::find(lang.id, &file.to_string_lossy(), &text);
            // o main da linha pedida; senão o último acima dela; senão o primeiro
            let Some(entry) = list.iter().find(|e| e.line == line).or_else(|| list.iter().rev().find(|e| e.line <= line)).or(list.first()).cloned() else { return Ok(json!({ "fallback": true })) };
            let _ = std::fs::create_dir_all(&work);
            let init = plan::gradle_init(&work);
            if std::fs::read_to_string(&init).ok().as_deref() != Some(plan::GRADLE_INIT) { let _ = std::fs::write(&init, plan::GRADLE_INIT); }
            let has = |p: &str| pc.has(p);
            let env = plan::Env { has: &has, jdks: &pc.jdks, work: work.clone() };
            match plan::plan(&env, &root, &file, lang.id, &entry, &args) {
                Ok(Some(p)) => Ok(json!({ "plan": p, "entry": entry })),
                Ok(None) => Ok(json!({ "fallback": true })),
                Err(e) => Err(fail(e, 400)),
            }
        }).await.map_err(blocking_err)?.map(bluescreen_sdk::plugin::Reply::Json)
    } });

    p.route("runtimes/select", |r: Arc<Req>| async move {
        r.local_only()?;
        let body: Value = r.body_json().unwrap_or_default();
        let tool = arg(&r, &body, "tool").ok_or_else(|| fail("tool obrigatório", 400))?;
        let path = arg(&r, &body, "path").ok_or_else(|| fail("path obrigatório", 400))?;
        ok(select(&tool, &path).await?)
    });

    p.route("runtimes/forget", |r: Arc<Req>| async move {
        r.local_only()?;
        let _ = core().get("sdk/forget", &[]).await;
        forget();
        ok(json!({ "ok": true }))
    });

    p.run().await?;
    Ok(())
}
