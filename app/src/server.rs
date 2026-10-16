//! Servidor HTTP (axum/tokio): rotas do núcleo, despacho para plugins, arquivos da interface e rede local com PIN.
use crate::plugins::{Host, Reply, Req, RouteFn, ok, route_fn};
use crate::util::*;
use crate::{lint, vcs, workspace};
use axum::body::Body;
use axum::http::{HeaderValue, Method, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use parking_lot::Mutex;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Avisos do servidor para a janela do aplicativo.
pub enum UiEvent { Activate }
pub static UI: OnceLock<Box<dyn Fn(UiEvent) + Send + Sync>> = OnceLock::new();

pub struct Lan { pub pin: Option<String>, pub port: u16, stop: Option<tokio::sync::oneshot::Sender<()>> }
#[allow(dead_code)]
pub struct App {
    pub root: PathBuf,
    pub port: u16,
    pub lan: Mutex<Lan>,
    pub sessions: Mutex<HashSet<String>>,
    pub host: OnceLock<Host>,
}
pub type Shared = Arc<App>;
static APP: OnceLock<Shared> = OnceLock::new();
pub fn app() -> &'static Shared { APP.get().expect("app") }

pub fn create(root: PathBuf, port: u16, lan_port: u16) -> Shared {
    let a = Arc::new(App { root, port, lan: Mutex::new(Lan { pin: None, port: lan_port, stop: None }), sessions: Mutex::new(HashSet::new()), host: OnceLock::new() });
    let _ = APP.set(a.clone());
    // token dos plugins: quem chama o núcleo com ele é um plugin ou o próprio núcleo (pode usar rotas internas)
    let token: String = (0..40).map(|_| format!("{:x}", rand::random_range(0..16u8))).collect();
    bluescreen_sdk::plugin::set_core(&format!("http://127.0.0.1:{port}"), &token);
    let _ = a.host.set(Host::new(core_routes()));
    a
}
pub fn host() -> &'static Host { app().host.get().expect("host") }

// ---------- rede local (acesso via LAN com PIN) ----------
fn lan_addresses(port: u16) -> Vec<Value> {
    // IPs da máquina: abre um socket UDP "conectado" para descobrir o endereço de saída, e lista os do hostname
    let mut ips: Vec<String> = vec![];
    if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") { if s.connect("8.8.8.8:80").is_ok() { if let Ok(a) = s.local_addr() { ips.push(a.ip().to_string()); } } }
    if let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&(gethostname(), 0)) {
        for a in addrs { if let std::net::IpAddr::V4(v4) = a.ip() { if !v4.is_loopback() && !v4.is_link_local() { let s = v4.to_string(); if !ips.contains(&s) { ips.push(s); } } } }
    }
    ips.into_iter().map(|ip| json!({ "iface": "rede", "url": format!("http://{ip}:{port}") })).collect()
}
pub fn gethostname() -> String { std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "localhost".into()) }
pub fn lan_status() -> Value {
    let l = app().lan.lock();
    let on = l.stop.is_some();
    json!({ "enabled": on, "pin": l.pin, "port": l.port, "urls": if on { lan_addresses(l.port) } else { vec![] } })
}
pub fn lan_enabled() -> bool { app().lan.lock().stop.is_some() }
pub async fn lan_enable() -> ApiResult<Value> {
    if lan_enabled() { return Ok(lan_status()); }
    let port = app().lan.lock().port;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| fail(format!("Não deu para abrir a porta {port}: {e}"), 500))?;
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut l = app().lan.lock();
        l.pin = Some(std::env::var("BLUESCREEN_PIN").unwrap_or_else(|_| format!("{:06}", rand::random_range(100000..1000000u32))));
        l.stop = Some(tx);
    }
    let router = router(true);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = rx.await; }).await;
    });
    Ok(lan_status())
}
pub async fn lan_disable() -> Value {
    { let mut l = app().lan.lock(); if let Some(tx) = l.stop.take() { let _ = tx.send(()); } l.pin = None; }
    app().sessions.lock().clear();
    lan_status()
}

// ---------- rotas do núcleo ----------
fn project(r: &Req) -> ApiResult<PathBuf> { Ok(PathBuf::from(r.require("project")?)) }
fn in_project(r: &Req, key: &str) -> ApiResult<(PathBuf, PathBuf, String)> {
    let p = project(r)?;
    let rel = r.q_or(key, "").to_string();
    let abs = absolute(&p.join(&rel));
    if !within(&p, &abs) { return Err(fail("fora do projeto", 400)); }
    Ok((p, abs, rel))
}
fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> impl std::future::Future<Output = ApiResult<T>> {
    async move { tokio::task::spawn_blocking(f).await.map_err(|e| fail(e.to_string(), 500)) }
}

fn core_routes() -> HashMap<String, RouteFn> {
    let mut m: HashMap<String, RouteFn> = HashMap::new();
    let mut add = |name: &str, f: RouteFn| { m.insert(name.into(), f); };
    add("session", route_fn(|r| async move { ok(json!({ "remote": r.remote, "authed": true })) }));
    add("config", route_fn(|_| async move {
        let a = app();
        ok(json!({ "app": "bluescreen", "engine": "rust", "version": VERSION, "pid": std::process::id(), "root": a.root, "host": gethostname(), "network": lan_status(), "plugins": host().get().list, "desktop": UI.get().is_some() }))
    }));
    add("reveal", route_fn(|r| async move {
        r.local_only()?;
        let target = absolute(Path::new(r.q_or("path", "")));
        if !target.exists() { return Err(fail("não existe", 400)); }
        let t = target.to_string_lossy().to_string();
        if target.is_dir() { fire("explorer.exe", &[&t]); } else { fire("explorer.exe", &[&format!("/select,{t}")]); }
        ok(json!({ "ok": true }))
    }));
    add("activate", route_fn(|r| async move {
        // outra instância foi aberta: traz esta janela para a frente
        if r.remote || !r.is_post() || r.headers.get("x-bluescreen").and_then(|v| v.to_str().ok()) != Some("takeover") { return Err(fail("só pelo PC local", 403)); }
        match UI.get() { Some(f) => { f(UiEvent::Activate); ok(json!({ "ok": true })) } None => Err(fail("sem janela", 409)) }
    }));
    add("shutdown", route_fn(|r| async move {
        if r.remote || !r.is_post() || r.headers.get("x-bluescreen").and_then(|v| v.to_str().ok()) != Some("takeover") { return Err(fail("só pelo PC local", 403)); }
        log("Outra instância do BlueScreen assumiu. Encerrando.");
        tokio::spawn(async { tokio::time::sleep(std::time::Duration::from_millis(150)).await; std::process::exit(0); });
        ok(json!({ "ok": true }))
    }));
    add("network", route_fn(|r| async move {
        r.local_only()?;
        if r.is_post() {
            let b: Value = r.body_json()?;
            return ok(if b["enable"].as_bool().unwrap_or(false) { lan_enable().await? } else { lan_disable().await });
        }
        ok(lan_status())
    }));
    add("projects", route_fn(|r| async move {
        let root = absolute(&r.q("root").map(PathBuf::from).unwrap_or_else(|| app().root.clone()));
        if !root.is_dir() { return Err(fail(format!("Pasta não existe: {}", root.display()), 400)); }
        let rr = root.clone();
        let projects = blocking(move || vcs::list_projects(&rr)).await??;
        ok(json!({ "root": root, "projects": projects }))
    }));
    // ---------- abrir e criar projetos em qualquer pasta (como o Open / New Project do IntelliJ) ----------
    add("project/info", route_fn(|r| async move {
        let dir = absolute(Path::new(r.require("path")?));
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir.to_string_lossy().into_owned());
        ok(json!({ "path": dir, "name": name, "exists": dir.is_dir(), "vcs": if dir.is_dir() { vcs::detect(&dir) } else { None } }))
    }));
    // seletor de pasta nativo do Windows; devolve { path: null } quando o usuário cancela
    add("project/pick", route_fn(|r| async move {
        r.local_only()?;
        let start = r.q("start").map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(|| app().root.clone());
        let title = r.q_or("title", "Abrir projeto").to_string();
        let picked = blocking(move || rfd::FileDialog::new().set_title(&title).set_directory(&start).pick_folder()).await?;
        ok(json!({ "path": picked.map(|p| absolute(&p)) }))
    }));
    // POST { parent, name, git, readme }: cria a pasta do projeto (e, se pedido, o repositório Git e o README.md)
    add("project/new", route_fn(|r| async move {
        r.local_only()?;
        if !r.is_post() { return Err(fail("POST", 405)); }
        let b: Value = r.body_json()?;
        let parent = absolute(Path::new(b["parent"].as_str().unwrap_or("").trim()));
        let name = b["name"].as_str().unwrap_or("").trim().to_string();
        let bad = name.is_empty() || name == "." || name == ".." || name.ends_with('.') || name.chars().any(|c| "\\/:*?\"<>|".contains(c) || c.is_control());
        if bad { return Err(fail("Nome de projeto inválido (não use \\ / : * ? \" < > |)", 400)); }
        if !parent.is_dir() { return Err(fail(format!("A pasta {} não existe", parent.display()), 400)); }
        let dir = parent.join(&name);
        if dir.exists() { return Err(fail(format!("Já existe {}", dir.display()), 400)); }
        tokio::fs::create_dir(&dir).await.map_err(|e| fail(format!("Não deu para criar {}: {e}", dir.display()), 500))?;
        let mut warn = None;
        if b["readme"].as_bool().unwrap_or(false) { tokio::fs::write(dir.join("README.md"), format!("# {name}\n")).await?; }
        if b["git"].as_bool().unwrap_or(false) {
            let g = run("git", &["init"], &dir, 30000).await;
            if !g.ok { warn = Some("Projeto criado, mas o git init falhou (o Git está instalado?)".to_string()); }
        }
        ok(json!({ "path": dir, "warning": warn }))
    }));
    add("summary", route_fn(|r| async move { ok(vcs::summary(&project(&r)?).await) }));
    add("changes", route_fn(|r| async move { ok(vcs::changes(&project(&r)?, r.q_or("mode", "working"), r.q("rev")).await) }));
    add("log", route_fn(|r| async move { ok(vcs::history_n(&project(&r)?, r.q_or("n", "30").parse().unwrap_or(30)).await) }));
    add("diff", route_fn(|r| async move { ok(vcs::diff(&project(&r)?, r.q_or("file", ""), r.q_or("mode", "working"), r.q("rev")).await) }));
    add("tree", route_fn(|r| async move {
        let (p, abs, _) = in_project(&r, "dir")?;
        let p = absolute(&p);
        let rel = rel(&p, &abs);
        let rel = if rel == "." { String::new() } else { rel };
        let (compact, fresh) = (r.q("compact") != Some("0"), r.flag("fresh"));
        ok(blocking(move || workspace::tree(&p, &rel, compact, fresh)).await??)
    }));
    add("file", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        if r.method == Method::PUT {
            tokio::fs::write(&abs, &r.body).await?;
            let md = tokio::fs::metadata(&abs).await.ok();
            return ok(json!({ "saved": true, "mtime": md.as_ref().and_then(|m| m.modified().ok()).map(mtime_ms), "size": md.map(|m| m.len()) }));
        }
        let md = tokio::fs::metadata(&abs).await.map_err(|e| fail(e.to_string(), 404))?;
        let mtime = md.modified().map(mtime_ms).unwrap_or(0.0);
        if md.len() > MAX_FILE { return ok(json!({ "content": "", "tooBig": true, "size": md.len(), "mtime": mtime })); }
        let buf = tokio::fs::read(&abs).await?;
        let binary = looks_binary(&buf);
        ok(json!({ "content": if binary { String::new() } else { String::from_utf8_lossy(&buf).into_owned() }, "binary": binary, "size": md.len(), "mtime": mtime }))
    }));
    // POST { files: [rel...] }: data e tamanho de cada arquivo (null = não existe mais), para conferir as abas abertas
    add("file/stat", route_fn(|r| async move {
        let p = absolute(&project(&r)?);
        let b: Value = r.body_json()?;
        let mut out = serde_json::Map::new();
        for f in b["files"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).take(500) {
            let abs = absolute(&p.join(f));
            if !within(&p, &abs) { continue; }
            let st = tokio::fs::metadata(&abs).await.ok().filter(|m| m.is_file()).map(|m| json!({ "mtime": m.modified().map(mtime_ms).unwrap_or(0.0), "size": m.len() }));
            out.insert(f.to_string(), st.unwrap_or(Value::Null));
        }
        ok(json!({ "files": out }))
    }));
    // arquivos grandes, lidos em janelas de linhas (ver bigfile.rs)
    add("big/info", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        ok(blocking(move || crate::bigfile::info(&abs)).await?.map_err(|e| fail(e, 404))?)
    }));
    add("big/lines", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        let (from, count) = (r.q("from").and_then(|v| v.parse().ok()).unwrap_or(0), r.q("count").and_then(|v| v.parse().ok()).unwrap_or(500));
        let full = r.flag("full");
        ok(blocking(move || crate::bigfile::lines(&abs, from, count, full)).await?.map_err(|e| fail(e, 400))?)
    }));
    add("big/search", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        let (q, case, re) = (r.q_or("q", "").to_string(), r.flag("case"), r.flag("regex"));
        ok(blocking(move || crate::bigfile::search(&abs, &q, case, re)).await?.map_err(|e| fail(e, 400))?)
    }));
    // edição: POST com o texto novo das linhas [from, to) no corpo; fica em memória até salvar
    add("big/edit", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        let (from, to) = (r.q("from").and_then(|v| v.parse().ok()).unwrap_or(0), r.q("to").and_then(|v| v.parse().ok()).unwrap_or(0));
        // del: apaga as linhas (corpo vazio seria "uma linha vazia")
        let text = if r.flag("del") { None } else { Some(String::from_utf8_lossy(&r.body).into_owned()) };
        ok(blocking(move || crate::bigfile::edit(&abs, from, to, text.as_deref())).await?.map_err(|e| fail(e, 409))?)
    }));
    // a = undo | redo | discard
    add("big/history", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        let dir = match r.q_or("a", "") { "undo" => -1, "redo" => 1, "discard" => 0, _ => return Err(fail("a: undo, redo ou discard", 400)) };
        ok(blocking(move || crate::bigfile::history(&abs, dir)).await?.map_err(|e| fail(e, 400))?)
    }));
    add("big/save", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        ok(blocking(move || crate::bigfile::save(&abs)).await?.map_err(|e| fail(e, 409))?)
    }));
    // alterações feitas fora da IDE (long-poll; ver watch.rs)
    add("watch", route_fn(|r| async move {
        let p = absolute(&project(&r)?);
        if !p.is_dir() { return Err(fail("pasta não existe", 404)); }
        ok(crate::watch::poll(p, r.q("since").and_then(|s| s.parse().ok())).await)
    }));
    add("index", route_fn(|r| async move { ok(&*workspace::file_index(&absolute(&project(&r)?), r.flag("fresh")).await) }));
    add("search", route_fn(|r| async move { ok(workspace::search_text(&absolute(&project(&r)?), r.q_or("q", ""), r.flag("case"), r.flag("regex")).await?) }));
    add("lint", route_fn(|r| async move { let (p, _, rel) = in_project(&r, "file")?; ok(lint::lint(&p, &rel).await) }));
    // lista de plugins; POST { id, enabled } liga/desliga (persistido em ~/.bluescreen/plugins.json) e POST { reload: true } relê a pasta
    add("plugins", route_fn(|r| async move {
        if r.is_post() {
            r.local_only()?;
            let b: Value = r.body_json()?;
            if let Some(id) = b["id"].as_str() {
                if !host().get().list.iter().any(|p| p.id == id) { return Err(fail(format!("plugin desconhecido: {id}"), 404)); }
                host().set_enabled(id, b["enabled"].as_bool().unwrap_or(false));
            } else { host().load(); }
            host().print();
        }
        ok(json!({ "plugins": host().get().list, "dirs": crate::plugins::dirs(), "config": crate::plugins::config_file() }))
    }));
    // visão geral do projeto (tela sem abas): README, linguagens e sistemas de build
    add("overview", route_fn(|r| async move { ok(workspace::overview(&absolute(&project(&r)?)).await) }));
    // arquivo do projeto como veio (imagens do README, visualizador de imagens, PDF, áudio, vídeo e fontes).
    // Lê só um trecho quando pedido: cabeçalho Range (áudio e vídeo pulam para o meio sem ler o arquivo todo)
    // ou ?offset=&len= (visualizador hexadecimal). O tamanho total vai em x-file-size.
    add("raw", route_fn(|r| async move {
        let (_, abs, _) = in_project(&r, "file")?;
        let size = tokio::fs::metadata(&abs).await.map_err(|e| fail(e.to_string(), 404))?.len();
        let range = r.headers.get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| parse_range(v, size));
        let chunk = r.q("len").map(|l| {
            let off = r.q("offset").and_then(|o| o.parse::<u64>().ok()).unwrap_or(0).min(size);
            (off, (off + l.parse::<u64>().unwrap_or(65536).min(MAX_CHUNK)).min(size))
        });
        let (start, end, partial) = match (range, chunk) { (Some((a, b)), _) => (a, b, true), (None, Some((a, b))) => (a, b, false), _ => (0, size, false) };
        let bytes = read_slice(&abs, start, end).await.map_err(|e| fail(e.to_string(), 500))?;
        let mut resp = ([(header::CONTENT_TYPE, mime(&abs)), (header::CACHE_CONTROL, "no-cache")], bytes).into_response();
        let h = resp.headers_mut();
        h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        h.insert("x-file-size", HeaderValue::from(size));
        if partial {
            h.insert(header::CONTENT_RANGE, HeaderValue::from_str(&format!("bytes {start}-{}/{size}", end.saturating_sub(1))).unwrap());
            *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
        }
        Ok(Reply::Raw(resp))
    }));
    // chave do preview de HTML do editor: /api/preview/<chave>/<arquivo> serve os arquivos do projeto com caminhos
    // relativos (css, imagens, scripts). A chave substitui o cookie, que não vai junto de um iframe isolado (sandbox).
    add("preview", route_fn(|r| async move {
        let p = absolute(&project(&r)?);
        let mut m = previews().lock();
        let key = match m.iter().find(|(_, v)| **v == p) {
            Some((k, _)) => k.clone(),
            None => { let k: String = (0..32).map(|_| format!("{:x}", rand::random_range(0..16u8))).collect(); m.insert(k.clone(), p); k }
        };
        ok(json!({ "key": key }))
    }));
    // terminal embutido: shells instalados (o shell em si abre por WebSocket em /api/terminal/ws)
    add("terminal/shells", route_fn(|r| async move {
        r.local_only()?;
        let fresh = r.q_or("fresh", "") == "1";
        ok(json!({ "shells": blocking(move || crate::terminal::shells(fresh)).await?.as_ref() }))
    }));
    // servidores de linguagem e depuradores encontrados (cada um abre por WebSocket em /api/rpc/ws)
    add("rpc/tools", route_fn(|r| async move {
        r.local_only()?;
        let fresh = r.q_or("fresh", "") == "1";
        ok(json!({ "tools": blocking(move || crate::rpc::tools(fresh)).await?.as_ref() }))
    }));
    // instalar um servidor de linguagem pela IDE: POST começa, GET devolve o andamento (ver install.rs)
    add("rpc/install", route_fn(|r| async move {
        r.local_only()?;
        let id = r.q_or("tool", "").to_string();
        if r.is_post() { return ok(crate::install::start(&id).map_err(|e| fail(e, 400))?); }
        ok(crate::install::status(&id))
    }));
    // SDKs e runtimes baixados pela IDE (JDK, Node.js, Python, Go, .NET...; ver sdk.rs)
    add("sdk/list", route_fn(|r| async move {
        r.local_only()?;
        ok(blocking(crate::sdk::list).await?)
    }));
    add("sdk/versions", route_fn(|r| async move {
        r.local_only()?;
        let kind = r.q_or("kind", "").to_string();
        let v = crate::sdk::versions(&kind, r.q_or("fresh", "") == "1").await.map_err(|e| fail(e, 502))?;
        ok(json!({ "pkgs": v }))
    }));
    // POST começa a baixar; GET devolve o andamento (o mesmo formato das instalações de servidores de linguagem)
    add("sdk/install", route_fn(|r| async move {
        r.local_only()?;
        if r.is_post() { return ok(crate::sdk::install(r.q_or("kind", ""), r.q_or("id", "")).map_err(|e| fail(e, 400))?); }
        ok(crate::install::status(r.q_or("job", "")))
    }));
    add("sdk/remove", route_fn(|r| async move {
        r.local_only()?;
        crate::sdk::remove(r.q_or("kind", ""), r.q_or("path", "")).await.map_err(|e| fail(e, 400))?;
        ok(json!({ "ok": true }))
    }));
    add("sdk/default", route_fn(|r| async move {
        r.local_only()?;
        crate::sdk::set_default(r.q_or("kind", ""), r.q_or("path", "")).map_err(|e| fail(e, 400))?;
        ok(json!({ "ok": true }))
    }));
    // preferências da interface (aparência, predefinições) em ~/.bluescreen/settings.json
    add("settings", route_fn(|r| async move {
        let file = user_dir().join("settings.json");
        if r.is_post() {
            r.local_only()?;
            let v: Value = r.body_json()?;
            write_atomic(&file, &serde_json::to_string_pretty(&v).unwrap_or_default())?;
            return ok(json!({ "saved": true }));
        }
        let v = read_json(&file);
        ok(if v.is_null() { json!({}) } else { v })
    }));
    // build nativo da IDE
    for (name, f) in crate::build::routes() { add(name, f); }
    m
}

// ---------- HTTP ----------
fn json_resp(code: u16, body: &Value) -> Response {
    let mut r = Response::new(Body::from(serde_json::to_vec(body).unwrap_or_default()));
    *r.status_mut() = StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}
fn previews() -> &'static Mutex<HashMap<String, PathBuf>> { static P: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new(); P.get_or_init(Default::default) }
async fn serve_preview(rest: &str) -> Response {
    let (key, rel) = rest.split_once('/').unwrap_or((rest, ""));
    let Some(root) = previews().lock().get(key).cloned() else { return bad("preview expirado", 404) };
    let rel = urlencoding::decode(rel).map(|s| s.into_owned()).unwrap_or_default();
    let file = absolute(&root.join(rel.trim_start_matches('/')));
    if !within(&root, &file) { return bad("fora do projeto", 400); }
    match tokio::fs::read(&file).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, mime(&file)), (header::CACHE_CONTROL, "no-cache")], bytes).into_response(),
        Err(_) => bad("not found", 404),
    }
}
/// maior trecho lido de uma vez (Range de vídeo, visualizador hexadecimal)
const MAX_CHUNK: u64 = 4 << 20;
/// "bytes=a-b", "bytes=a-" ou "bytes=-n" -> [início, fim) dentro do arquivo, no máximo MAX_CHUNK
fn parse_range(v: &str, size: u64) -> Option<(u64, u64)> {
    let spec = v.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => { let n: u64 = n.parse().ok()?; (size.saturating_sub(n), size) }
        (a, "") => (a.parse().ok()?, size),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.saturating_add(1).min(size)),
    };
    (start < end).then(|| (start, end.min(start + MAX_CHUNK)))
}
async fn read_slice(p: &Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let mut f = tokio::fs::File::open(p).await?;
    if start > 0 { f.seek(std::io::SeekFrom::Start(start)).await?; }
    let mut buf = Vec::with_capacity((end - start) as usize);
    f.take(end - start).read_to_end(&mut buf).await?;
    Ok(buf)
}
fn bad(msg: &str, code: u16) -> Response { json_resp(code, &json!({ "error": msg })) }
fn mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8", "mjs" => "text/javascript; charset=utf-8", "txt" | "md" => "text/plain; charset=utf-8", "xml" => "application/xml",
        "mp4" | "m4v" => "video/mp4", "webm" => "video/webm", "ogv" => "video/ogg", "mov" => "video/quicktime", "mp3" => "audio/mpeg", "wav" => "audio/wav", "ogg" | "opus" | "oga" => "audio/ogg", "flac" => "audio/flac", "m4a" => "audio/mp4", "aac" => "audio/aac", "bmp" => "image/bmp", "pdf" => "application/pdf", "avif" => "image/avif", "otf" => "font/otf", "js" => "text/javascript; charset=utf-8", "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "ico" => "image/x-icon", "json" => "application/json",
        "woff2" => "font/woff2", "woff" => "font/woff", "ttf" => "font/ttf", "map" => "application/json", _ => "application/octet-stream",
    }
}
fn cookie(req: &Request<Body>, name: &str) -> Option<String> {
    req.headers().get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';'))
        .filter_map(|c| c.split_once('=')).find(|(k, _)| k.trim() == name).map(|(_, v)| urlencoding::decode(v.trim()).map(|s| s.into_owned()).unwrap_or_default())
}
fn parse_query(q: Option<&str>) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for pair in q.unwrap_or("").split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let d = |s: &str| urlencoding::decode(&s.replace('+', " ")).map(|x| x.into_owned()).unwrap_or_default();
        m.insert(d(k), d(v));
    }
    m
}

pub fn router(remote: bool) -> axum::Router {
    axum::Router::new().fallback(move |req: Request<Body>| handle(req, remote))
}

async fn handle(req: Request<Body>, remote: bool) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    // arquivos do preview de HTML: liberados pela chave (vale para a rede local também)
    if let Some(rest) = path.strip_prefix("/api/preview/") { return serve_preview(rest).await; }
    // --- autenticação só para acessos pela rede ---
    if remote {
        if path == "/api/login" && method == Method::POST {
            let body = axum::body::to_bytes(req.into_body(), 64 * 1024).await.unwrap_or_default();
            let pin = serde_json::from_slice::<Value>(&body).ok().and_then(|v| v["pin"].as_str().map(String::from)).unwrap_or_default();
            if Some(pin) != app().lan.lock().pin { return bad("PIN incorreto", 401); }
            let sid: String = (0..48).map(|_| format!("{:x}", rand::random_range(0..16u8))).collect();
            app().sessions.lock().insert(sid.clone());
            let mut r = json_resp(200, &json!({ "ok": true }));
            r.headers_mut().insert(header::SET_COOKIE, HeaderValue::from_str(&format!("bs_sid={sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400")).unwrap());
            return r;
        }
        let authed = cookie(&req, "bs_sid").is_some_and(|s| app().sessions.lock().contains(&s));
        if path.starts_with("/api/") {
            if path == "/api/session" { return json_resp(200, &json!({ "remote": true, "authed": authed })); }
            if !authed { return bad("login necessário", 401); }
        }
    }
    // script de um plugin (ui.js + style.css num arquivo só)
    if let Some(id) = path.strip_prefix("/plugins/").and_then(|p| p.strip_suffix(".js")) {
        return match host().bundle(id) {
            Some(b) => ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], b).into_response(),
            None => bad("plugin sem interface ou desligado", 404),
        };
    }
    if !path.starts_with("/api/") { return serve_static(&path).await; }
    if path == "/api/rpc/ws" { let q = parse_query(req.uri().query()); return crate::rpc::ws(req, remote, q).await; }
    if path == "/api/terminal/ws" { let q = parse_query(req.uri().query()); return crate::terminal::ws(req, remote, q).await; }
    let name = path[5..].to_string();
    let reg = host().get();
    let Some(handler) = reg.routes.get(&name).cloned().or_else(|| host().core().get(&name).cloned()) else { return bad("rota desconhecida", 404) };
    let (parts, body) = req.into_parts();
    let body = match axum::body::to_bytes(body, 256 * 1024 * 1024).await { Ok(b) => b, Err(e) => return bad(&e.to_string(), 413) };
    let internal = !remote && parts.headers.get(bluescreen_sdk::plugin::H_TOKEN).and_then(|v| v.to_str().ok()) == Some(bluescreen_sdk::plugin::core().token());
    let r = Arc::new(Req { query: parse_query(parts.uri.query()), method: parts.method, headers: parts.headers, body, remote, internal });
    match handler(r.clone()).await {
        Ok(Reply::Raw(resp)) => resp,
        Ok(Reply::Json(v)) => json_resp(200, &v),
        Err(e) => bad(&e.msg, e.status),
    }
}

async fn serve_static(path: &str) -> Response {
    let base = app_dir().join("wwwroot");
    let rel = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    let rel = urlencoding::decode(rel).map(|s| s.into_owned()).unwrap_or_default();
    let file = absolute(&base.join(&rel));
    if !within(&base, &file) { return bad("not found", 404); }
    match tokio::fs::read(&file).await {
        Ok(bytes) => {
            // bibliotecas (Monaco, fontes) não mudam: cache longo; o resto sempre revalida
            let cache = if rel.starts_with("vendor/") { "public, max-age=31536000, immutable" } else { "no-cache" };
            ([(header::CONTENT_TYPE, mime(&file)), (header::CACHE_CONTROL, cache)], bytes).into_response()
        }
        Err(_) => bad("not found", 404),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_range;
    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 100)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 1000)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 1000)));
        assert_eq!(parse_range("bytes=0-5000", 1000), Some((0, 1000)));
        assert_eq!(parse_range("bytes=0-", 0), None);
        assert_eq!(parse_range("bytes=0-", 100 << 20), Some((0, 4 << 20)));
    }
}
