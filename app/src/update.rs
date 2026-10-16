//! Atualização pelo repositório (git) de onde este BlueScreen foi compilado.
//! O repositório é achado pelo `source.txt` que o instalador grava ao lado do exe ou subindo as pastas do exe
//! (app\dist\BlueScreen, app\target\release e app\ ficam dentro dele). Ao abrir a IDE, a página pergunta
//! (update/check): git fetch e os commits que chegaram. O que mudou decide o tamanho da atualização:
//! - só interface (app/wwwroot, ui.js/style.css de plugins, docs): git pull e copiar os arquivos; a página recarrega;
//! - núcleo (Rust, Cargo, build.ps1, ícone): git pull, build.ps1 numa pasta temporária, troca dos arquivos e reinício.
//! Exe e DLL em uso não podem ser sobrescritos no Windows, mas podem ser renomeados: viram *.old-<n>.exe e somem no
//! próximo início (cleanup). O reinício abre o exe novo com BLUESCREEN_REPLACE, que encerra esta instância.
use crate::build::detect::which;
use crate::plugins::{RouteFn, ok, route_fn};
use crate::util::*;
use parking_lot::Mutex;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Default)]
struct Job {
    running: bool,
    step: usize,
    steps: Vec<&'static str>,
    progress: f64,
    line: String,
    lines: Vec<String>,
    error: Option<String>,
    done: bool,
    restart: bool,
    started: Option<Instant>,
    /// exe a abrir no reinício (o caminho de antes da troca)
    exe: Option<PathBuf>,
    /// versão publicada (GitHub Releases): baixa o pacote pronto em vez de compilar
    release: bool,
}
static JOB: LazyLock<Mutex<Job>> = LazyLock::new(Default::default);
static LAST: LazyLock<Mutex<Option<(Instant, Value)>>> = LazyLock::new(Default::default);

fn is_repo(d: &Path) -> bool { d.join(".git").exists() && d.join("app").join("build.ps1").is_file() }
pub fn repo() -> Option<PathBuf> {
    let dir = app_dir();
    if let Ok(s) = std::fs::read_to_string(dir.join("source.txt")) { let p = PathBuf::from(s.trim()); if is_repo(&p) { return Some(p); } }
    dir.ancestors().find(|d| is_repo(d)).map(Path::to_path_buf)
}
async fn git(repo: &Path, args: &[&str], ms: u64) -> ProcResult { run("git", args, repo, ms).await }

/// o arquivo mudado exige compilar o núcleo?
fn native(f: &str) -> bool {
    if !f.starts_with("app/") || f.ends_with(".md") || f.starts_with("app/wwwroot/") { return false; }
    if f.starts_with("app/plugins/") { return f.contains("/src/") || f.ends_with("Cargo.toml"); }
    true
}

/// Pacotes do cargo que os arquivos mudados afetam (o resto não recompila). None = todos: mudou o SDK, que
/// núcleo e plugins usam, ou o Cargo.toml/Cargo.lock do workspace (versões das dependências).
fn packages(files: &[String]) -> Option<Vec<String>> {
    let mut out: Vec<String> = vec![];
    let mut add = |p: String| if !out.contains(&p) { out.push(p) };
    for f in files.iter().filter(|f| native(f)) {
        if f.starts_with("app/sdk/") || f == "app/Cargo.toml" || f == "app/Cargo.lock" { return None; }
        match f.strip_prefix("app/plugins/").and_then(|r| r.split('/').next()) {
            Some(id) => add(format!("bluescreen-{id}")),
            None => add("bluescreen".into()),
        }
    }
    Some(out)
}

pub fn routes() -> Vec<(&'static str, RouteFn)> {
    vec![
        ("update/check", route_fn(|r| async move {
            r.local_only()?;
            if !r.flag("fresh") { if let Some((t, v)) = LAST.lock().clone() { if t.elapsed() < Duration::from_secs(600) { return ok(v); } } }
            let v = check().await;
            *LAST.lock() = Some((Instant::now(), v.clone()));
            ok(v)
        })),
        ("update/apply", route_fn(|r| async move {
            r.local_only()?;
            if !r.is_post() { return Err(fail("use POST", 405)); }
            let info = check().await;
            if info["behind"].as_u64().unwrap_or(0) == 0 { return Err(fail("Nada para atualizar.", 409)); }
            let release = info["mode"] == "release";
            {
                let mut j = JOB.lock();
                if j.running { return Err(fail("A atualização já está rodando.", 409)); }
                if release {
                    *j = Job { running: true, started: Some(Instant::now()), restart: true, release: true,
                        steps: vec!["Baixar a versão nova", "Conferir e extrair", "Instalar a versão nova", "Reiniciar"], ..Default::default() };
                }
            }
            if release {
                tokio::spawn(async move { if let Err(e) = apply_release(info).await { let mut j = JOB.lock(); j.error = Some(e); j.running = false; } });
                return ok(json!({ "started": true }));
            }
            {
                let mut j = JOB.lock();
                let build = info["needsBuild"].as_bool() == Some(true);
                *j = Job { running: true, started: Some(Instant::now()), restart: build,
                    steps: if build { vec!["Baixar as alterações (git pull)", "Compilar o BlueScreen", "Instalar a versão nova", "Reiniciar"] } else { vec!["Baixar as alterações (git pull)", "Atualizar a interface"] },
                    ..Default::default() };
            }
            tokio::spawn(async move { if let Err(e) = apply(info).await { let mut j = JOB.lock(); j.error = Some(e); j.running = false; } });
            ok(json!({ "started": true }))
        })),
        ("update/status", route_fn(|_r| async move {
            let j = JOB.lock();
            ok(json!({ "running": j.running, "step": j.step, "steps": j.steps, "progress": j.progress, "line": j.line, "error": j.error, "done": j.done,
                "restart": j.restart, "release": j.release, "elapsed": j.started.map(|t| t.elapsed().as_secs()).unwrap_or(0), "tail": j.lines.iter().rev().take(80).rev().collect::<Vec<_>>() }))
        })),
        ("update/restart", route_fn(|r| async move {
            r.local_only()?;
            if !r.is_post() { return Err(fail("use POST", 405)); }
            let exe = JOB.lock().exe.clone().or_else(|| std::env::current_exe().ok()).ok_or_else(|| fail("exe não encontrado", 500))?;
            let args: Vec<String> = std::env::args().skip(1).collect();
            let mut c = std::process::Command::new(&exe);
            c.args(&args).env("BLUESCREEN_REPLACE", "1").current_dir(exe.parent().unwrap_or(Path::new(".")));
            c.spawn().map_err(|e| fail(format!("não abriu {}: {e}", exe.display()), 500))?;
            log("Reiniciando na versão nova.");
            ok(json!({ "ok": true }))
        })),
    ]
}

// ---------- versões publicadas (GitHub Releases, .github/workflows/release.yml) ----------
/// pacote de cada versão: BlueScreen-X.Y.Z-windows-x64.zip (+ .sha256)
const ASSET: &str = "-windows-x64.zip";
/// registro dos instaladores: AppId do app/installer/BlueScreen.iss (+ "_is1" do Inno Setup) e o do Instalar BlueScreen.cmd
const UNINSTALL_KEYS: &[&str] = &["{6B3F2D1A-9C4E-4E8B-A7D2-B1E5C0F3A9D4}_is1", "BlueScreen"];
fn releases_api() -> Option<String> {
    let slug = env!("CARGO_PKG_REPOSITORY").trim_end_matches('/').strip_prefix("https://github.com/")?.to_string();
    Some(format!("https://api.github.com/repos/{slug}/releases/latest"))
}
fn semver(v: &str) -> (u64, u64, u64) {
    let mut p = v.trim().trim_start_matches('v').split(['.', '-', '+']).map(|x| x.parse().unwrap_or(0));
    (p.next().unwrap_or(0), p.next().unwrap_or(0), p.next().unwrap_or(0))
}
/// rodando do código-fonte (app\, app\target\..., app\dist\...): quem programa atualiza pelo git e compila
fn from_source() -> bool {
    let d = absolute(&app_dir());
    repo().is_some_and(|r| { let app = absolute(&r.join("app")); d == app || within(&app.join("target"), &d) || within(&app.join("dist"), &d) })
}
fn http(timeout: Option<u64>) -> Result<reqwest::Client, String> {
    let b = reqwest::Client::builder().user_agent(concat!("BlueScreen-IDE/", env!("CARGO_PKG_VERSION"))).connect_timeout(Duration::from_secs(15));
    let b = match timeout { Some(s) => b.timeout(Duration::from_secs(s)), None => b };
    b.build().map_err(|e| e.to_string())
}
/// último Release: { mode: "release", behind: 1 se é mais novo que esta versão, commits (das notas), url do zip... }
async fn check_release() -> Result<Value, String> {
    let api = releases_api().ok_or("o Cargo.toml não aponta um repositório do GitHub")?;
    let v: Value = http(Some(15))?.get(&api).header("Accept", "application/vnd.github+json").send().await.and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let tag = v["tag_name"].as_str().ok_or("Release sem tag")?.to_string();
    let assets = v["assets"].as_array().cloned().unwrap_or_default();
    let zip = assets.iter().find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(ASSET))).ok_or_else(|| format!("{tag} não tem o pacote para Windows"))?;
    let name = zip["name"].as_str().unwrap_or_default();
    let sha = assets.iter().find(|a| a["name"].as_str() == Some(&format!("{name}.sha256"))).and_then(|a| a["browser_download_url"].as_str());
    let remote = tag.trim_start_matches('v').to_string();
    let newer = semver(&remote) > semver(crate::server::VERSION);
    // notas geradas pelo workflow: "- assunto (hash)"
    let body = v["body"].as_str().unwrap_or_default();
    let commits: Vec<Value> = body.lines().filter_map(|l| l.trim().strip_prefix("- ")).map(|l| {
        let (subject, hash) = match l.rsplit_once(" (") { Some((s, h)) if h.ends_with(')') => (s, h.trim_end_matches(')')), _ => (l, "") };
        json!({ "subject": subject, "hash": hash, "author": "", "when": "" })
    }).collect();
    Ok(json!({ "available": true, "mode": "release", "behind": if newer { 1 } else { 0 }, "ahead": 0, "commits": commits, "files": 0,
        "needsBuild": true, "dirty": false, "version": crate::server::VERSION, "remoteVersion": remote, "remoteHead": tag,
        "upstream": format!("GitHub · {tag}"), "size": zip["size"], "url": zip["browser_download_url"], "digest": zip["digest"], "sha256Url": sha,
        "published": v["published_at"], "appDir": app_dir() }))
}

/// Baixa o zip do Release, confere o SHA-256, extrai e troca os arquivos da pasta do programa. Sem compilar.
async fn apply_release(info: Value) -> Result<(), String> {
    use futures_util::StreamExt;
    use sha2::Digest;
    use tokio::io::AsyncWriteExt;
    let url = info["url"].as_str().ok_or("Release sem endereço do pacote")?.to_string();
    let dir = app_dir();
    let stage = std::env::temp_dir().join("bluescreen-release");
    let _ = tokio::fs::remove_dir_all(&stage).await;
    tokio::fs::create_dir_all(&stage).await.map_err(|e| e.to_string())?;
    let zip = stage.join("pacote.zip");

    // 1. baixar (a soma é calculada enquanto chega)
    set(|j| { j.step = 0; j.progress = 0.02; });
    push(&format!("$ baixar {url}"));
    let client = http(None)?;
    let resp = client.get(&url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("download: {e}"))?;
    let total = resp.content_length().or(info["size"].as_u64()).unwrap_or(0).max(1);
    let mut f = tokio::fs::File::create(&zip).await.map_err(|e| e.to_string())?;
    let mut h = sha2::Sha256::new();
    let (mut got, mut stream) = (0u64, resp.bytes_stream());
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download: {e}"))?;
        f.write_all(&chunk).await.map_err(|e| e.to_string())?;
        h.update(&chunk);
        got += chunk.len() as u64;
        let p = (got as f64 / total as f64).min(1.0);
        set(|j| { j.progress = 0.02 + 0.68 * p; j.line = format!("{:.1} de {:.1} MB", got as f64 / 1048576.0, total as f64 / 1048576.0); });
    }
    f.flush().await.map_err(|e| e.to_string())?;
    drop(f);
    push(&format!("baixado: {:.1} MB", got as f64 / 1048576.0));

    // 2. conferir a soma publicada e extrair
    set(|j| { j.step = 1; j.progress = 0.72; });
    let have = format!("{:x}", h.finalize());
    let want = match info["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")) {
        Some(d) => d.to_string(),
        None => match info["sha256Url"].as_str() {
            Some(u) => client.get(u).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("soma: {e}"))?.text().await.map_err(|e| e.to_string())?
                .split_whitespace().next().unwrap_or_default().to_string(),
            None => return Err("O Release não publica a soma SHA-256 do pacote; por segurança, nada foi instalado.".into()),
        },
    };
    if !want.eq_ignore_ascii_case(&have) { return Err(format!("O pacote baixado não confere com a soma publicada (esperado {want}, veio {have}). Nada foi instalado.")); }
    push(&format!("sha256 conferido: {have}"));
    let out = stage.join("BlueScreen");
    tokio::fs::create_dir_all(&out).await.map_err(|e| e.to_string())?;
    let x = run("tar", &["-xf", &zip.to_string_lossy(), "-C", &out.to_string_lossy()], &stage, 120_000).await;
    if !x.ok { return Err(format!("não deu para extrair o pacote: {}", x.err.trim())); }
    if !out.join("BlueScreen.exe").is_file() { return Err("o pacote não tem o BlueScreen.exe".into()); }
    set(|j| j.progress = 0.85);

    // 3. instalar: troca os arquivos (exe e dll em uso são renomeados, ver unlock)
    set(|j| j.step = 2);
    let d2 = dir.clone();
    tokio::task::spawn_blocking(move || copy_tree(&out, &d2)).await.map_err(|e| e.to_string())?.map_err(|e| format!("instalação em {}: {e}", dir.display()))?;
    push(&format!("instalado em {}", dir.display()));
    let _ = tokio::fs::remove_dir_all(&stage).await;
    // Configurações > Apps mostra a versão nova (instalado pelo BlueScreen-Setup.exe ou pelo Instalar BlueScreen.cmd)
    if let Some(v) = info["remoteVersion"].as_str() {
        for key in UNINSTALL_KEYS {
            let k = format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{key}");
            if run("reg", &["query", &k, "/v", "DisplayVersion"], &dir, 5_000).await.ok {
                let _ = run("reg", &["add", &k, "/v", "DisplayVersion", "/d", v, "/f"], &dir, 5_000).await;
            }
        }
    }
    set(|j| { j.exe = Some(dir.join("BlueScreen.exe")); j.step = 3; j.progress = 1.0; j.done = true; j.running = false; });
    *LAST.lock() = None;
    Ok(())
}

async fn check() -> Value {
    // instalado (fora do código-fonte): a versão pronta publicada pelo GitHub Actions; sem internet ou sem Release, o git
    if !from_source() {
        match check_release().await {
            Ok(v) => return v,
            Err(e) => { log(format!("atualização: Releases indisponíveis ({e}); tentando pelo git")); if repo().is_none() { return json!({ "available": false, "reason": format!("Não deu para consultar as versões publicadas: {e}") }); } }
        }
    }
    let Some(repo) = repo() else { return json!({ "available": false, "reason": "Este BlueScreen não foi compilado de um repositório git (sem pasta de origem)." }) };
    if which("git").is_none() { return json!({ "available": false, "reason": "git não está no PATH." }); }
    let fetch = git(&repo, &["fetch", "--quiet", "--no-tags"], 45_000).await;
    let up = git(&repo, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 10_000).await;
    if !up.ok { return json!({ "available": false, "repo": repo, "reason": "O branch atual não segue nenhum branch remoto." }); }
    let upstream = up.out.trim().to_string();
    // o resto não depende um do outro: em paralelo (cada git no Windows custa um processo novo)
    let (behind, ahead, log_out, diff, status, cargo_toml, head) = tokio::join!(
        git(&repo, &["rev-list", "--count", "HEAD..@{u}"], 10_000),
        git(&repo, &["rev-list", "--count", "@{u}..HEAD"], 10_000),
        git(&repo, &["log", "--no-merges", "-n", "60", "--format=%h%x1f%an%x1f%at%x1f%s", "HEAD..@{u}"], 10_000),
        git(&repo, &["diff", "--name-only", "HEAD...@{u}"], 10_000),
        git(&repo, &["status", "--porcelain", "--untracked-files=no"], 10_000),
        git(&repo, &["show", "@{u}:app/Cargo.toml"], 10_000),
        git(&repo, &["rev-parse", "--short", "@{u}"], 10_000),
    );
    let behind: u64 = behind.out.trim().parse().unwrap_or(0);
    let ahead: u64 = ahead.out.trim().parse().unwrap_or(0);
    let log_out = log_out.out;
    let commits: Vec<Value> = log_out.lines().filter_map(|l| {
        let p: Vec<&str> = l.split('\x1f').collect();
        (p.len() == 4).then(|| json!({ "hash": p[0], "author": p[1], "when": rel_time_unix(p[2]), "subject": p[3] }))
    }).collect();
    let files: Vec<String> = diff.out.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let needs_build = files.iter().any(|f| native(f));
    let packages = packages(&files);
    let dirty = !status.out.trim().is_empty();
    let remote_version = cargo_toml.out.lines()
        .find_map(|l| l.trim().strip_prefix("version").and_then(|v| v.split('"').nth(1)).map(String::from)).unwrap_or_default();
    let head = head.out.trim().to_string();
    json!({ "available": true, "repo": repo, "upstream": upstream, "behind": behind, "ahead": ahead, "commits": commits, "files": files.len(),
        "needsBuild": needs_build, "packages": packages, "dirty": dirty, "version": crate::server::VERSION, "remoteVersion": remote_version, "remoteHead": head,
        "offline": !fetch.ok, "appDir": app_dir() })
}

fn set(f: impl FnOnce(&mut Job)) { f(&mut JOB.lock()); }
fn push(line: &str) {
    let mut j = JOB.lock();
    let l = line.trim_end().to_string();
    if !l.trim().is_empty() { j.line = l.trim().chars().take(200).collect(); }
    j.lines.push(l); if j.lines.len() > 4000 { j.lines.drain(..1000); }
}

async fn apply(info: Value) -> Result<(), String> {
    let repo = PathBuf::from(info["repo"].as_str().unwrap_or_default());
    let build = info["needsBuild"].as_bool() == Some(true);
    let dir = app_dir();
    let in_repo_app = absolute(&dir) == absolute(&repo.join("app")); // rodando do código-fonte (wwwroot do próprio repo)

    // 1. git pull (guarda e reaplica mudanças locais)
    set(|j| { j.step = 0; j.progress = 0.03; });
    push(&format!("$ git pull --ff-only --autostash  ({})", repo.display()));
    let r = run_env("git", &["pull", "--ff-only", "--autostash"], &repo, 180_000, &[("GIT_TERMINAL_PROMPT", "0")]).await;
    for l in r.out.lines().chain(r.err.lines()) { push(l); }
    if !r.ok { return Err("O git pull não conseguiu avançar (talvez o branch local tenha commits que não estão no remoto). Resolva no repositório e tente de novo.".into()); }
    set(|j| j.progress = if build { 0.08 } else { 0.5 });

    if !build {
        // 2. só interface: copia wwwroot e a interface dos plugins para a pasta do programa
        set(|j| j.step = 1);
        if !in_repo_app {
            mirror(&repo.join("app").join("wwwroot"), &dir.join("wwwroot")).map_err(|e| format!("cópia da interface: {e}"))?;
            plugin_ui(&repo.join("app").join("plugins"), &dir.join("plugins"));
            push(&format!("interface copiada para {}", dir.display()));
        } else { push("rodando do código-fonte: a interface já é a do repositório"); }
        set(|j| { j.progress = 1.0; j.done = true; j.running = false; j.step = 2; });
        *LAST.lock() = None;
        return Ok(());
    }

    // 2. compilar numa pasta temporária (a pasta em uso fica intacta até a troca)
    set(|j| j.step = 1);
    let app = repo.join("app");
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    // rodando de app\target\release: o cargo precisa sobrescrever o exe em uso
    if within(&app.join("target"), &me) { unlock(&me)?; }
    let stage = std::env::temp_dir().join("bluescreen-update");
    let _ = std::fs::remove_dir_all(&stage);
    let total = std::fs::read_to_string(app.join("Cargo.lock")).map(|t| t.matches("[[package]]").count()).unwrap_or(400).max(150) as f64 * 0.8;
    let ps1 = app.join("build.ps1");
    // só o que mudou: os pacotes que ficam de fora vêm do target\release da compilação anterior
    let only: Vec<String> = info["packages"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let total = if only.is_empty() { total } else { only.len() as f64 * 3.0 };
    let mut c = tokio::process::Command::new("powershell");
    c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(&ps1).arg("-Out").arg(&stage).current_dir(&app)
        .env("CARGO_TERM_COLOR", "never").stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    if let Some(home) = dirs::home_dir() { let path = std::env::var("PATH").unwrap_or_default(); c.env("PATH", format!("{};{path}", home.join(".cargo").join("bin").display())); }
    if !only.is_empty() { c.arg("-Packages").arg(only.join(",")); }
    crate::install::hidden(&mut c);
    push(&format!("$ build.ps1{}", if only.is_empty() { String::new() } else { format!(" -Packages {}", only.join(",")) }));
    let mut child = c.spawn().map_err(|e| format!("não abriu o powershell: {e}"))?;
    let (out, err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let compiled = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let reader = |s: Box<dyn tokio::io::AsyncRead + Unpin + Send>, n: std::sync::Arc<std::sync::atomic::AtomicUsize>| tokio::spawn(async move {
        let mut lines = BufReader::new(s).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            if l.trim_start().starts_with("Compiling ") {
                let k = n.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                set(|j| j.progress = j.progress.max(0.08 + 0.72 * (k as f64 / total).min(1.0)));
            } else if l.trim_start().starts_with("Finished") { set(|j| j.progress = j.progress.max(0.82)); }
            push(&l);
        }
    });
    let (a, b) = (reader(Box::new(out), compiled.clone()), reader(Box::new(err), compiled.clone()));
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = tokio::join!(a, b);
    if !status.success() { return Err("A compilação falhou. As últimas linhas do cargo estão abaixo.".into()); }

    // 3. instalar: troca os arquivos da pasta do programa pelos novos
    set(|j| { j.step = 2; j.progress = 0.86; });
    let new = stage.join("BlueScreen");
    let exe = if in_repo_app {
        push("rodando do código-fonte: o exe novo fica em app\\target\\release");
        app.join("target").join("release").join("bluescreen.exe")
    } else {
        copy_tree(&new, &dir).map_err(|e| format!("instalação em {}: {e}", dir.display()))?;
        push(&format!("instalado em {}", dir.display()));
        dir.join("BlueScreen.exe")
    };
    let _ = std::fs::remove_dir_all(&stage);
    set(|j| { j.exe = Some(exe); j.step = 3; j.progress = 1.0; j.done = true; j.running = false; });
    *LAST.lock() = None;
    Ok(())
}

/// arquivo em uso (exe/dll rodando): renomeia para *.old-<n> para liberar o nome
fn unlock(p: &Path) -> Result<(), String> {
    if !p.exists() || std::fs::OpenOptions::new().write(true).open(p).is_ok() { return Ok(()); }
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let old = p.with_file_name(format!("{stem}.old-{}.{ext}", now_ms() as u64));
    std::fs::rename(p, &old).map_err(|e| format!("{} está em uso e não pôde ser trocado: {e}", p.display()))?;
    push(&format!("{} em uso: renomeado para {}", p.display(), old.file_name().unwrap_or_default().to_string_lossy()));
    Ok(())
}
fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for e in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let (from, to) = (e.path(), dst.join(e.file_name()));
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            if e.file_name() == "wwwroot" { mirror(&from, &to)?; } else { copy_tree(&from, &to)?; }
        } else {
            unlock(&to)?;
            std::fs::copy(&from, &to).map_err(|er| format!("{}: {er}", to.display()))?;
        }
    }
    Ok(())
}
/// deixa `dst` igual a `src` (remove o que saiu da versão nova)
fn mirror(src: &Path, dst: &Path) -> Result<(), String> {
    copy_tree_plain(src, dst)?;
    fn prune(src: &Path, dst: &Path) {
        let Ok(rd) = std::fs::read_dir(dst) else { return };
        for e in rd.flatten() {
            let s = src.join(e.file_name());
            if !s.exists() { let _ = if e.path().is_dir() { std::fs::remove_dir_all(e.path()) } else { std::fs::remove_file(e.path()) }; }
            else if e.path().is_dir() { prune(&s, &e.path()); }
        }
    }
    prune(src, dst);
    Ok(())
}
fn copy_tree_plain(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for e in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let to = dst.join(e.file_name());
        if e.file_type().is_ok_and(|t| t.is_dir()) { copy_tree_plain(&e.path(), &to)?; }
        else { std::fs::copy(e.path(), &to).map_err(|er| format!("{}: {er}", to.display()))?; }
    }
    Ok(())
}
fn plugin_ui(src: &Path, dst: &Path) {
    let Ok(rd) = std::fs::read_dir(src) else { return };
    for e in rd.flatten() {
        let to = dst.join(e.file_name());
        if !to.is_dir() { continue; }
        for f in ["plugin.json", "ui.js", "style.css"] { if e.path().join(f).is_file() { let _ = std::fs::copy(e.path().join(f), to.join(f)); } }
    }
}

/// apaga os *.old-<n>.exe/.dll deixados por uma atualização (já não estão em uso)
pub fn cleanup() {
    fn walk(d: &Path, depth: u32) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if e.file_type().is_ok_and(|t| t.is_dir()) { if depth > 0 && n != "wwwroot" && n != "node_modules" && n != "deps" && n != "build" { walk(&e.path(), depth - 1); } }
            else if n.contains(".old-") && (n.ends_with(".exe") || n.ends_with(".dll")) { let _ = std::fs::remove_file(e.path()); }
        }
    }
    let dir = app_dir();
    walk(&dir, 2);
    walk(&dir.join("target").join("release"), 0);
}

#[cfg(test)]
mod tests {
    use super::{native, packages, semver};
    #[test]
    fn versions() {
        assert!(semver("v2.1.10") > semver("2.1.9"));
        assert!(semver("2.1.0") > semver("2.0.37"));
        assert_eq!(semver("v3.0.1"), (3, 0, 1));
    }
    #[test]
    fn classify() {
        assert!(native("app/src/main.rs"));
        assert!(native("app/Cargo.toml"));
        assert!(native("app/plugins/unilint/src/engine.rs"));
        assert!(!native("app/wwwroot/app.js"));
        assert!(!native("app/plugins/unilint/ui.js"));
        assert!(!native("README.md"));
        assert!(!native("Instalar BlueScreen.cmd"));
    }
    #[test]
    fn only_what_changed() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(packages(&v(&["app/src/main.rs", "app/wwwroot/app.js"])), Some(v(&["bluescreen"])));
        assert_eq!(packages(&v(&["app/plugins/unilint/src/jsp.rs"])), Some(v(&["bluescreen-unilint"])));
        assert_eq!(packages(&v(&["app/src/lint.rs", "app/plugins/unilint/src/a.rs", "app/src/x.rs"])), Some(v(&["bluescreen", "bluescreen-unilint"])));
        assert_eq!(packages(&v(&["app/sdk/src/lib.rs"])), None);
        assert_eq!(packages(&v(&["app/Cargo.lock"])), None);
    }
}
