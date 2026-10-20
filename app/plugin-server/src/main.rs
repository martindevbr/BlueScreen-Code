//! Servidor de plugins do BlueScreen: hospeda plugins com versões para as IDEs instalarem e atualizarem.
//!
//! Uso: bluescreen-plugin-server [--port 4900] [--dir ./plugin-store] [--token SEGREDO] [--name "Plugins da equipe"]
//!      (ou PLUGIN_SERVER_PORT, PLUGIN_SERVER_DIR, PLUGIN_SERVER_TOKEN, PLUGIN_SERVER_NAME)
//!
//! Pasta de dados: <dir>/<id>/<versão>/ com os arquivos do plugin (plugin.json, ui.js, style.css, server.exe...).
//! Publicar uma versão nova:
//!   - pela IDE: botão direito no plugin (aba Plugins) > "Publicar no servidor", com o token de publicação;
//!   - pela API: POST /api/publish com o pacote e o cabeçalho `Authorization: Bearer <token>`;
//!   - à mão: soltar a pasta do plugin (a que tem o plugin.json) direto em <dir>/. O servidor lê o id e a versão
//!     do plugin.json e arquiva em <dir>/<id>/<versão>/ sozinho.
//! As IDEs que apontam para este servidor sempre recebem a maior versão e avisam que há atualização.
//!
//! Rotas: GET /api/index, GET /api/plugins/{id}[?version=], POST /api/publish[?force=1],
//!        DELETE /api/plugins/{id}/{version}, GET / (página com a lista).
use axum::extract::{DefaultBodyLimit, Path as UrlPath, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use bluescreen_sdk::store::{bundle_hash, read_files, safe_rel, valid_id, valid_version, version_cmp};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

struct Store {
    dir: PathBuf,
    token: String,
    name: String,
    /// versões publicadas não mudam: o hash de cada pasta é calculado uma vez
    hashes: Mutex<HashMap<PathBuf, (String, u64)>>,
}
type St = Arc<Store>;

fn log(msg: impl AsRef<str>) {
    let s = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) % 86400;
    println!("[{:02}:{:02}:{:02} UTC] {}", s / 3600, s / 60 % 60, s % 60, msg.as_ref());
}
fn random_hex() -> String {
    (0..2).map(|_| format!("{:016x}", std::collections::hash_map::RandomState::new().build_hasher().finish())).collect()
}
fn err(code: StatusCode, msg: impl Into<String>) -> Response { (code, Json(json!({ "error": msg.into() }))).into_response() }

/// pastas que o servidor nunca trata como plugin: as de trabalho (.tmp-*) e as de arquivos recusados (_recusados)
fn internal(name: &str) -> bool { name.starts_with('.') || name.starts_with('_') }
/// arquivos que não viajam no pacote
fn skip(rel: &str, _dir: bool) -> bool { rel.split('/').any(|c| c.starts_with('.')) }

fn manifest(dir: &Path) -> Option<Value> {
    std::fs::read_to_string(dir.join("plugin.json")).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
}
/// versões de um plugin, da maior para a menor
fn versions(st: &Store, id: &str) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(st.dir.join(id)).into_iter().flatten().flatten()
        .filter(|e| e.path().join("plugin.json").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| valid_version(n)).collect();
    v.sort_by(|a, b| version_cmp(b, a));
    v
}
fn hash_of(st: &Store, dir: &Path) -> std::io::Result<(String, u64)> {
    if let Some(h) = st.hashes.lock().unwrap().get(dir) { return Ok(h.clone()); }
    let files = read_files(dir, &skip)?;
    let h = (bundle_hash(&files), files.iter().map(|f| f.1.len() as u64).sum());
    st.hashes.lock().unwrap().insert(dir.to_path_buf(), h.clone());
    Ok(h)
}

/// Pastas de plugin soltas na raiz (com plugin.json direto nelas) vão para <id>/<versão>.
fn file_drops(st: &Store) {
    let Ok(rd) = std::fs::read_dir(&st.dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if internal(&name) || !e.path().join("plugin.json").is_file() { continue; }
        let m = manifest(&e.path()).unwrap_or(Value::Null);
        let (id, ver) = (m["id"].as_str().unwrap_or(&name).trim().to_string(), m["version"].as_str().unwrap_or("").trim().to_string());
        let reject = |why: String| {
            let to = st.dir.join("_recusados").join(format!("{name}-{}", random_hex().get(..8).unwrap_or("x")));
            let _ = std::fs::create_dir_all(st.dir.join("_recusados"));
            let _ = std::fs::rename(e.path(), &to);
            log(format!("pasta {name} recusada: {why} (movida para {})", to.display()));
        };
        if !valid_id(&id) { reject(format!("id inválido \"{id}\"")); continue; }
        if !valid_version(&ver) { reject(format!("versão inválida \"{ver}\" no plugin.json")); continue; }
        let dest = st.dir.join(&id).join(&ver);
        if dest.exists() { reject(format!("{id} {ver} já está publicado (aumente o version do plugin.json)")); continue; }
        let _ = std::fs::create_dir_all(st.dir.join(&id));
        match std::fs::rename(e.path(), &dest) {
            Ok(()) => log(format!("publicado {id} {ver} (pasta solta em {})", st.dir.display())),
            Err(er) => log(format!("não deu para arquivar {name}: {er} (tento de novo em instantes)")),
        }
    }
}

fn entry(st: &Store, id: &str) -> Option<Value> {
    let vs = versions(st, id);
    let last = vs.first()?;
    let dir = st.dir.join(id).join(last);
    let m = manifest(&dir).unwrap_or(Value::Null);
    let (sha, size) = hash_of(st, &dir).ok()?;
    let updated = dir.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    Some(json!({
        "id": id, "version": last, "versions": vs, "sha256": sha, "size": size, "updated": updated,
        "name": m["name"].as_str().unwrap_or(id), "description": m["description"].as_str().unwrap_or(""),
        "author": m["author"].as_str().unwrap_or(""), "requires": m["requires"].clone(),
    }))
}
fn index(st: &Store) -> Value {
    file_drops(st);
    let mut ids: Vec<String> = std::fs::read_dir(&st.dir).into_iter().flatten().flatten()
        .filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !internal(n) && valid_id(n)).collect();
    ids.sort();
    json!({ "server": "bluescreen-plugin-server", "version": env!("CARGO_PKG_VERSION"), "name": st.name, "plugins": ids.iter().filter_map(|id| entry(st, id)).collect::<Vec<_>>() })
}

async fn api_index(State(st): State<St>) -> Response {
    tokio::task::spawn_blocking(move || Json(index(&st)).into_response()).await.unwrap_or_else(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
struct VerQ { version: Option<String>, force: Option<String> }

async fn api_bundle(State(st): State<St>, UrlPath(id): UrlPath<String>, Query(q): Query<VerQ>) -> Response {
    tokio::task::spawn_blocking(move || {
        if !valid_id(&id) { return err(StatusCode::BAD_REQUEST, "id inválido"); }
        let vs = versions(&st, &id);
        let Some(ver) = (match q.version.as_deref().filter(|v| !v.is_empty()) { Some(v) => vs.iter().find(|x| *x == v), None => vs.first() }) else {
            return err(StatusCode::NOT_FOUND, format!("plugin {id} não está neste servidor"));
        };
        let dir = st.dir.join(&id).join(ver);
        let files = match read_files(&dir, &skip) { Ok(f) => f, Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()) };
        let sha = bundle_hash(&files);
        let size: u64 = files.iter().map(|f| f.1.len() as u64).sum();
        Json(json!({
            "id": id, "version": ver, "sha256": sha, "size": size, "manifest": manifest(&dir),
            "files": files.iter().map(|(p, d)| json!({ "path": p, "data": B64.encode(d) })).collect::<Vec<_>>(),
        })).into_response()
    }).await.unwrap_or_else(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn authorized(st: &Store, h: &HeaderMap) -> bool {
    let given = h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|s| s.strip_prefix("Bearer ")).map(str::trim)
        .or_else(|| h.get("x-plugin-token").and_then(|v| v.to_str().ok()));
    // comparação em tempo constante: o token não vaza pela demora da resposta
    given.is_some_and(|g| g.len() == st.token.len() && g.bytes().zip(st.token.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0)
}

async fn api_publish(State(st): State<St>, Query(q): Query<VerQ>, h: HeaderMap, Json(b): Json<Value>) -> Response {
    if !authorized(&st, &h) { return err(StatusCode::UNAUTHORIZED, "token de publicação inválido"); }
    tokio::task::spawn_blocking(move || {
        let mut files: Vec<(String, Vec<u8>)> = vec![];
        for f in b["files"].as_array().into_iter().flatten() {
            let p = f["path"].as_str().unwrap_or("");
            if !safe_rel(p) || skip(p, false) { return err(StatusCode::BAD_REQUEST, format!("caminho inválido no pacote: {p}")); }
            match B64.decode(f["data"].as_str().unwrap_or("")) { Ok(d) => files.push((p.to_string(), d)), Err(e) => return err(StatusCode::BAD_REQUEST, format!("{p}: base64 inválido ({e})")) }
        }
        if let Some(sha) = b["sha256"].as_str() { if sha != bundle_hash(&files) { return err(StatusCode::BAD_REQUEST, "o sha256 do pacote não confere (envio corrompido)"); } }
        let Some(m) = files.iter().find(|f| f.0 == "plugin.json").and_then(|f| serde_json::from_slice::<Value>(f.1.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&f.1)).ok()) else {
            return err(StatusCode::BAD_REQUEST, "o pacote precisa de um plugin.json válido");
        };
        let (id, ver) = (m["id"].as_str().unwrap_or("").trim().to_string(), m["version"].as_str().unwrap_or("").trim().to_string());
        if !valid_id(&id) { return err(StatusCode::BAD_REQUEST, format!("id inválido no plugin.json: \"{id}\"")); }
        if !valid_version(&ver) { return err(StatusCode::BAD_REQUEST, format!("versão inválida no plugin.json: \"{ver}\"")); }
        let dest = st.dir.join(&id).join(&ver);
        let force = q.force.as_deref() == Some("1");
        if dest.exists() && !force { return err(StatusCode::CONFLICT, format!("{id} {ver} já está publicado: aumente o \"version\" do plugin.json")); }
        let tmp = st.dir.join(format!(".tmp-{}", random_hex()));
        let write = || -> std::io::Result<()> {
            for (p, d) in &files { let to = tmp.join(p); if let Some(par) = to.parent() { std::fs::create_dir_all(par)?; } std::fs::write(to, d)?; }
            std::fs::create_dir_all(st.dir.join(&id))?;
            if dest.exists() { std::fs::remove_dir_all(&dest)?; }
            std::fs::rename(&tmp, &dest)
        };
        if let Err(e) = write() { let _ = std::fs::remove_dir_all(&tmp); return err(StatusCode::INTERNAL_SERVER_ERROR, format!("não deu para gravar: {e}")); }
        st.hashes.lock().unwrap().remove(&dest);
        let latest = versions(&st, &id).first().cloned().unwrap_or_default();
        log(format!("publicado {id} {ver}{} ({} arquivos)", if force { " (substituído)" } else { "" }, files.len()));
        Json(json!({ "id": id, "version": ver, "latest": latest, "files": files.len() })).into_response()
    }).await.unwrap_or_else(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn api_delete(State(st): State<St>, UrlPath((id, ver)): UrlPath<(String, String)>, h: HeaderMap) -> Response {
    if !authorized(&st, &h) { return err(StatusCode::UNAUTHORIZED, "token de publicação inválido"); }
    if !valid_id(&id) || !valid_version(&ver) { return err(StatusCode::BAD_REQUEST, "id ou versão inválidos"); }
    let dir = st.dir.join(&id).join(&ver);
    if !dir.is_dir() { return err(StatusCode::NOT_FOUND, format!("{id} {ver} não existe")); }
    if let Err(e) = std::fs::remove_dir_all(&dir) { return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()); }
    st.hashes.lock().unwrap().remove(&dir);
    let _ = std::fs::remove_dir(st.dir.join(&id)); // só sai se ficou vazia
    log(format!("removido {id} {ver}"));
    Json(json!({ "removed": true })).into_response()
}

fn esc(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }
async fn page(State(st): State<St>, h: HeaderMap) -> Html<String> {
    let idx = tokio::task::spawn_blocking({ let st = st.clone(); move || index(&st) }).await.unwrap_or(Value::Null);
    let host = h.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("localhost");
    let rows: String = idx["plugins"].as_array().into_iter().flatten().map(|p| format!(
        "<tr><td><b>{}</b><div class=d>{}</div></td><td><code>{}</code></td><td>{}</td><td class=v>{}</td></tr>",
        esc(p["name"].as_str().unwrap_or("")), esc(p["description"].as_str().unwrap_or("")), esc(p["id"].as_str().unwrap_or("")),
        esc(p["version"].as_str().unwrap_or("")),
        p["versions"].as_array().map(|v| v.iter().filter_map(|x| x.as_str()).map(esc).collect::<Vec<_>>().join(", ")).unwrap_or_default(),
    )).collect();
    Html(format!(r#"<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name}</title><style>
:root{{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--mut:#656d76;--line:#d0d7de;--acc:#0969da}}
@media (prefers-color-scheme:dark){{:root{{--bg:#1e1f22;--fg:#dfe1e5;--mut:#8c8f94;--line:#393b40;--acc:#548af7}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,"Segoe UI",sans-serif}}
main{{max-width:900px;margin:0 auto;padding:32px 16px}}h1{{font-size:22px;margin:0 0 4px}}p{{color:var(--mut);margin:0 0 20px}}
code{{background:color-mix(in srgb,var(--fg) 8%,transparent);padding:1px 6px;border-radius:4px}}
table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{font-size:12px;color:var(--mut);font-weight:600}}.d{{color:var(--mut);font-size:12.5px}}.v{{color:var(--mut);font-size:12.5px}}
.empty{{color:var(--mut);padding:24px 0}}</style>
<main><h1>{name}</h1><p>Na IDE: aba <b>Plugins</b> (Alt+7) &rsaquo; <b>Servidores</b> &rsaquo; adicione <code>http://{host}</code>. As IDEs avisam quando sai versão nova.</p>
{table}</main></html>"#,
        name = esc(&st.name), host = esc(host),
        table = if rows.is_empty() { "<div class=empty>Nenhum plugin publicado ainda. Publique pela IDE (botão direito no plugin &rsaquo; Publicar no servidor) ou solte a pasta do plugin na pasta de dados do servidor.</div>".to_string() }
                else { format!("<table><tr><th>Plugin</th><th>id</th><th>Versão</th><th>Todas as versões</th></tr>{rows}</table>") }))
}

fn arg(args: &[String], name: &str, env: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned()).or_else(|| std::env::var(env).ok()).filter(|s| !s.trim().is_empty())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("bluescreen-plugin-server [--port 4900] [--dir ./plugin-store] [--token SEGREDO] [--name \"Plugins da equipe\"]");
        return;
    }
    let port: u16 = arg(&args, "--port", "PLUGIN_SERVER_PORT").and_then(|p| p.parse().ok()).unwrap_or(4900);
    let dir = PathBuf::from(arg(&args, "--dir", "PLUGIN_SERVER_DIR").unwrap_or_else(|| "plugin-store".into()));
    if let Err(e) = std::fs::create_dir_all(&dir) { eprintln!("não deu para criar {}: {e}", dir.display()); std::process::exit(1); }
    let dir = if dir.is_absolute() { dir } else { std::env::current_dir().map(|c| c.join(&dir)).unwrap_or(dir) };
    // token de publicação: o da linha de comando/ambiente ou um gerado na primeira vez e guardado na pasta de dados
    let token = arg(&args, "--token", "PLUGIN_SERVER_TOKEN").unwrap_or_else(|| {
        let f = dir.join(".token");
        std::fs::read_to_string(&f).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| { let t = random_hex(); let _ = std::fs::write(&f, &t); t })
    });
    let name = arg(&args, "--name", "PLUGIN_SERVER_NAME").unwrap_or_else(|| "Servidor de plugins BlueScreen".into());
    let st: St = Arc::new(Store { dir: dir.clone(), token: token.clone(), name, hashes: Mutex::new(HashMap::new()) });

    // pastas soltas na raiz são arquivadas mesmo sem ninguém pedir o índice
    tokio::spawn({ let st = st.clone(); async move { loop { let s = st.clone(); let _ = tokio::task::spawn_blocking(move || file_drops(&s)).await; tokio::time::sleep(Duration::from_secs(5)).await; } } });

    let app = Router::new()
        .route("/", get(page))
        .route("/api/index", get(api_index))
        .route("/api/plugins/{id}", get(api_bundle))
        .route("/api/plugins/{id}/{version}", delete(api_delete))
        .route("/api/publish", post(api_publish))
        .layer(DefaultBodyLimit::max(512 << 20))
        .with_state(st);
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(l) => l,
        Err(e) => { eprintln!("não deu para abrir a porta {port}: {e}"); std::process::exit(1); }
    };
    println!("Servidor de plugins BlueScreen v{}", env!("CARGO_PKG_VERSION"));
    println!("  endereço:  http://localhost:{port}  (e o IP desta máquina na rede)");
    println!("  dados:     {}", dir.display());
    println!("  token de publicação: {token}");
    println!("  na IDE: aba Plugins (Alt+7) > Servidores > adicionar o endereço");
    if let Err(e) = axum::serve(listener, app).await { eprintln!("{e}"); }
}
