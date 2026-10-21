//! Servidor de plugins do BlueScreen: hospeda plugins com versões para as IDEs instalarem e atualizarem.
//!
//! Uso: bluescreen-plugin-server [--port 4900] [--dir ./plugin-store] [--name "Plugins da equipe"]
//!      (ou PLUGIN_SERVER_PORT, PLUGIN_SERVER_DIR, PLUGIN_SERVER_NAME)
//!
//! Só de leitura: pela rede, as IDEs listam e baixam; nada é enviado nem apagado por ela.
//! Pasta de dados: <dir>/<id>/<versão>/ com os arquivos do plugin (plugin.json, ui.js, style.css, server.exe...).
//! Versão nova: quem administra a máquina solta a pasta do plugin (a que tem o plugin.json) direto em <dir>/;
//! o servidor lê o id e a versão do plugin.json e arquiva em <dir>/<id>/<versão>/ sozinho.
//! As IDEs que apontam para este servidor sempre recebem a maior versão e avisam que há atualização.
//!
//! Rotas: GET /api/index, GET /api/plugins/{id}[?version=], GET / (página com a lista).
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use bluescreen_sdk::store::{bundle_hash, read_files, valid_id, valid_version, version_cmp};
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
        // pasta com o mesmo nome do id (o caso comum: "sheets/"): não dá para movê-la para dentro dela mesma, então
        // ela passa antes por um nome temporário (com ".", que a listagem ignora)
        let mut from = e.path();
        if name == id {
            let tmp = st.dir.join(format!(".{id}-{}", random_hex().get(..8).unwrap_or("x")));
            if let Err(er) = std::fs::rename(&from, &tmp) { log(format!("não deu para arquivar {name}: {er} (tento de novo em instantes)")); continue; }
            from = tmp;
        }
        let _ = std::fs::create_dir_all(st.dir.join(&id));
        match std::fs::rename(&from, &dest) {
            Ok(()) => log(format!("publicado {id} {ver} (pasta solta em {})", st.dir.display())),
            Err(er) => {
                if from != e.path() { let _ = std::fs::rename(&from, e.path()); } // volta ao nome solto para tentar de novo
                log(format!("não deu para arquivar {name}: {er} (tento de novo em instantes)"));
            }
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
        "icon": bluescreen_sdk::store::icon_uri(&dir, &m),
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
struct VerQ { version: Option<String> }

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
        table = if rows.is_empty() { "<div class=empty>Nenhum plugin publicado ainda. Para publicar, solte a pasta do plugin (a que tem o plugin.json) na pasta de dados do servidor.</div>".to_string() }
                else { format!("<table><tr><th>Plugin</th><th>id</th><th>Versão</th><th>Todas as versões</th></tr>{rows}</table>") }))
}

fn arg(args: &[String], name: &str, env: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned()).or_else(|| std::env::var(env).ok()).filter(|s| !s.trim().is_empty())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        println!("bluescreen-plugin-server [--port 4900] [--dir ./plugin-store] [--name \"Plugins da equipe\"]");
        return;
    }
    let port: u16 = arg(&args, "--port", "PLUGIN_SERVER_PORT").and_then(|p| p.parse().ok()).unwrap_or(4900);
    let dir = PathBuf::from(arg(&args, "--dir", "PLUGIN_SERVER_DIR").unwrap_or_else(|| "plugin-store".into()));
    if let Err(e) = std::fs::create_dir_all(&dir) { eprintln!("não deu para criar {}: {e}", dir.display()); std::process::exit(1); }
    let dir = if dir.is_absolute() { dir } else { std::env::current_dir().map(|c| c.join(&dir)).unwrap_or(dir) };
    let name = arg(&args, "--name", "PLUGIN_SERVER_NAME").unwrap_or_else(|| "Servidor de plugins BlueScreen".into());
    let st: St = Arc::new(Store { dir: dir.clone(), name, hashes: Mutex::new(HashMap::new()) });

    // pastas soltas na raiz são arquivadas mesmo sem ninguém pedir o índice
    tokio::spawn({ let st = st.clone(); async move { loop { let s = st.clone(); let _ = tokio::task::spawn_blocking(move || file_drops(&s)).await; tokio::time::sleep(Duration::from_secs(5)).await; } } });

    let app = Router::new()
        .route("/", get(page))
        .route("/api/index", get(api_index))
        .route("/api/plugins/{id}", get(api_bundle))
        .with_state(st);
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(l) => l,
        Err(e) => { eprintln!("não deu para abrir a porta {port}: {e}"); std::process::exit(1); }
    };
    println!("Servidor de plugins BlueScreen v{}", env!("CARGO_PKG_VERSION"));
    println!("  endereço:  http://localhost:{port}  (e o IP desta máquina na rede)");
    println!("  dados:     {}", dir.display());
    println!("  publicar:  solte a pasta do plugin (com o plugin.json) em {}", dir.display());
    println!("  na IDE: aba Plugins (Alt+7) > Servidores > adicionar o endereço");
    if let Err(e) = axum::serve(listener, app).await { eprintln!("{e}"); }
}
