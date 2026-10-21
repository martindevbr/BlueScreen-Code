//! Rotas, servidor de plugin e cliente do núcleo.
//!
//! Plugins com parte de servidor são programas à parte (um `server.exe` na pasta do plugin). O BlueScreen inicia o
//! programa quando o plugin está ligado, passando por variável de ambiente o endereço do núcleo e um token:
//!   BLUESCREEN_URL, BLUESCREEN_TOKEN, BLUESCREEN_PLUGIN (id), BLUESCREEN_PLUGIN_DIR
//! O plugin abre uma porta local qualquer e avisa numa linha da saída padrão:
//!   BLUESCREEN-READY {"port":1234,"routes":["cx/project", ...]}
//! A partir daí o núcleo encaminha /api/<rota> para o plugin. Para falar com o núcleo ou com outro plugin,
//! o plugin chama o núcleo com o token (`core()`).
use crate::util::*;
use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header};
use axum::response::Response;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

pub const H_TOKEN: &str = "x-bluescreen-token";
pub const H_REMOTE: &str = "x-bluescreen-remote";
pub const H_INTERNAL: &str = "x-bluescreen-internal";
/// token próprio de cada processo de plugin (BLUESCREEN_PLUGIN_TOKEN): identifica quem chama
pub const H_PLUGIN_TOKEN: &str = "x-bluescreen-plugin-token";

// ---------- requisição e resposta das rotas ----------
pub struct Req {
    pub query: HashMap<String, String>,
    pub method: Method,
    pub headers: HeaderMap,
    pub body: Bytes,
    /// acesso pela rede local (celular, outro PC)
    pub remote: bool,
    /// chamada de outro plugin ou do próprio núcleo (com o token): pode usar rotas internas
    pub internal: bool,
}
impl Req {
    /// Parâmetro da query (vazio conta como ausente, como no JS).
    pub fn q(&self, k: &str) -> Option<&str> { self.query.get(k).map(String::as_str).filter(|s| !s.is_empty()) }
    pub fn q_or<'a>(&'a self, k: &str, d: &'a str) -> &'a str { self.q(k).unwrap_or(d) }
    pub fn flag(&self, k: &str) -> bool { self.q(k) == Some("1") }
    pub fn require(&self, k: &str) -> ApiResult<&str> { self.q(k).ok_or_else(|| fail(format!("{k} obrigatório"), 400)) }
    pub fn body_text(&self) -> String { String::from_utf8_lossy(&self.body).into_owned() }
    /// Corpo JSON; corpo vazio vira `{}`.
    pub fn body_json<T: serde::de::DeserializeOwned>(&self) -> ApiResult<T> {
        let s = self.body_text();
        serde_json::from_str(if s.trim().is_empty() { "{}" } else { &s }).map_err(|e| fail(format!("JSON inválido: {e}"), 400))
    }
    pub fn is_post(&self) -> bool { self.method == Method::POST }
    /// Rotas que rodam processos ou mexem no PC só respondem pelo PC local.
    pub fn local_only(&self) -> ApiResult<()> { if self.remote { Err(fail("só pelo PC local", 403)) } else { Ok(()) } }
    /// Rotas que só outros plugins podem chamar.
    pub fn internal_only(&self) -> ApiResult<()> { if self.internal { Ok(()) } else { Err(fail("rota interna", 403)) } }
}
pub enum Reply {
    Json(Value),
    /// Resposta pronta (HTML, PDF, stream...).
    Raw(Response),
}
impl From<Value> for Reply { fn from(v: Value) -> Self { Reply::Json(v) } }
/// Serializa qualquer resposta para a rota.
pub fn ok<T: Serialize>(v: T) -> ApiResult<Reply> { Ok(Reply::Json(serde_json::to_value(v)?)) }

pub type RouteFn = Arc<dyn Fn(Arc<Req>) -> BoxFuture<'static, ApiResult<Reply>> + Send + Sync>;
pub fn route_fn<F, Fut>(f: F) -> RouteFn
where F: Fn(Arc<Req>) -> Fut + Send + Sync + 'static, Fut: Future<Output = ApiResult<Reply>> + Send + 'static {
    Arc::new(move |r| Box::pin(f(r)))
}
/// Caminho do projeto vindo da query.
pub fn project_of(r: &Req) -> ApiResult<PathBuf> { Ok(PathBuf::from(r.require("project")?)) }
pub fn path_str(p: &Path) -> String { p.to_string_lossy().into_owned() }

pub fn json_resp(code: u16, body: &Value) -> Response {
    let mut r = Response::new(Body::from(serde_json::to_vec(body).unwrap_or_default()));
    *r.status_mut() = StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}
pub fn reply_to_response(res: ApiResult<Reply>) -> Response {
    match res {
        Ok(Reply::Raw(r)) => r,
        Ok(Reply::Json(v)) => json_resp(200, &v),
        Err(e) => json_resp(e.status, &json!({ "error": e.msg })),
    }
}
/// "?a=1&b=2" (vazio sem parâmetros)
pub fn query_string<'a>(q: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    let s: Vec<String> = q.into_iter().map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v))).collect();
    if s.is_empty() { String::new() } else { format!("?{}", s.join("&")) }
}
pub fn parse_query(q: Option<&str>) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for pair in q.unwrap_or("").split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let d = |s: &str| urlencoding::decode(&s.replace('+', " ")).map(|x| x.into_owned()).unwrap_or_default();
        m.insert(d(k), d(v));
    }
    m
}

// ---------- servidor de plugin (programa à parte) ----------
pub struct PluginServer { pub id: String, routes: HashMap<String, RouteFn> }
impl PluginServer {
    pub fn new(id: &str) -> Self { PluginServer { id: id.into(), routes: HashMap::new() } }
    pub fn route<F, Fut>(&mut self, name: &str, f: F) -> &mut Self
    where F: Fn(Arc<Req>) -> Fut + Send + Sync + 'static, Fut: Future<Output = ApiResult<Reply>> + Send + 'static {
        self.routes.insert(name.trim_start_matches('/').trim_start_matches("api/").to_string(), route_fn(f));
        self
    }
    /// Abre a porta, avisa o núcleo e atende até o núcleo encerrar o processo.
    pub async fn run(self) -> anyhow::Result<()> {
        let token = std::env::var("BLUESCREEN_TOKEN").unwrap_or_default();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        let mut names: Vec<String> = self.routes.keys().cloned().collect();
        names.sort();
        let routes = Arc::new(self.routes);
        let app = axum::Router::new().fallback(move |req: Request<Body>| {
            let (routes, token) = (routes.clone(), token.clone());
            async move {
                // só o núcleo (com o token) fala com o plugin
                if !token.is_empty() && req.headers().get(H_TOKEN).and_then(|v| v.to_str().ok()) != Some(token.as_str()) {
                    return json_resp(403, &json!({ "error": "acesso negado" }));
                }
                let path = req.uri().path().trim_start_matches("/api/").to_string();
                let Some(h) = routes.get(&path).cloned() else { return json_resp(404, &json!({ "error": "rota desconhecida" })) };
                let (parts, body) = req.into_parts();
                let body = axum::body::to_bytes(body, 256 * 1024 * 1024).await.unwrap_or_default();
                let flag = |k: &str| parts.headers.get(k).and_then(|v| v.to_str().ok()) == Some("1");
                let r = Arc::new(Req { query: parse_query(parts.uri.query()), remote: flag(H_REMOTE), internal: flag(H_INTERNAL), method: parts.method, headers: parts.headers, body });
                reply_to_response(h(r).await)
            }
        });
        println!("BLUESCREEN-READY {}", json!({ "port": port, "routes": names }));
        use std::io::Write;
        let _ = std::io::stdout().flush();
        axum::serve(listener, app).await?;
        Ok(())
    }
}

// ---------- cliente do núcleo (para falar com o BlueScreen e com outros plugins) ----------
#[derive(Clone)]
pub struct Core { pub url: String, token: String, http: reqwest::Client }
static CORE: OnceLock<Core> = OnceLock::new();
/// O núcleo chama isso ao iniciar; nos plugins o endereço vem do ambiente.
pub fn set_core(url: &str, token: &str) { let _ = CORE.set(Core::new(url, token)); }
pub fn core() -> &'static Core {
    CORE.get_or_init(|| Core::new(&std::env::var("BLUESCREEN_URL").unwrap_or_else(|_| "http://127.0.0.1:4747".into()), &std::env::var("BLUESCREEN_TOKEN").unwrap_or_default()))
}
impl Core {
    fn new(url: &str, token: &str) -> Self {
        Core { url: url.trim_end_matches('/').into(), token: token.into(), http: reqwest::Client::builder().no_proxy().build().expect("http") }
    }
    pub fn token(&self) -> &str { &self.token }
    fn req(&self, method: reqwest::Method, route: &str, query: &[(&str, &str)]) -> reqwest::RequestBuilder {
        let rb = self.http.request(method, format!("{}/api/{}{}", self.url, route, query_string(query.iter().copied()))).header(H_TOKEN, &self.token);
        // o token próprio do processo identifica o plugin (o cofre só entrega valores assim)
        match std::env::var("BLUESCREEN_PLUGIN_TOKEN") { Ok(t) if !t.is_empty() => rb.header(H_PLUGIN_TOKEN, t), _ => rb }
    }
    async fn send(rb: reqwest::RequestBuilder) -> ApiResult<reqwest::Response> {
        let r = rb.send().await.map_err(|e| fail(format!("BlueScreen não respondeu: {e}"), 502))?;
        if r.status().is_success() { return Ok(r); }
        let st = r.status().as_u16();
        let v: Value = r.json().await.unwrap_or_default();
        Err(fail(v["error"].as_str().unwrap_or("falha").to_string(), st))
    }
    /// GET numa rota do núcleo ou de outro plugin. Rota inexistente (plugin desligado) dá 404.
    pub async fn get(&self, route: &str, query: &[(&str, &str)]) -> ApiResult<Value> {
        Ok(Self::send(self.req(reqwest::Method::GET, route, query)).await?.json().await.map_err(|e| fail(e.to_string(), 502))?)
    }
    pub async fn get_bytes(&self, route: &str, query: &[(&str, &str)]) -> ApiResult<Bytes> {
        Self::send(self.req(reqwest::Method::GET, route, query)).await?.bytes().await.map_err(|e| fail(e.to_string(), 502))
    }
    pub async fn post(&self, route: &str, query: &[(&str, &str)], body: &Value) -> ApiResult<Value> {
        Ok(Self::send(self.req(reqwest::Method::POST, route, query).json(body)).await?.json().await.map_err(|e| fail(e.to_string(), 502))?)
    }
}

// ---------- pasta de dados do plugin (~/.bluescreen/plugin-data/<id>) ----------
/// Pasta de dados deste plugin (BLUESCREEN_PLUGIN_DATA): o programa pode gravar o que quiser nela.
pub fn data_dir() -> Option<PathBuf> { std::env::var_os("BLUESCREEN_PLUGIN_DATA").map(PathBuf::from) }
fn self_id() -> String { std::env::var("BLUESCREEN_PLUGIN").unwrap_or_default() }
impl Core {
    /// Atributo guardado pelo plugin (store.json); `Null` quando não existe.
    pub async fn data_get(&self, key: &str) -> ApiResult<Value> { Ok(self.get("plugin/data", &[("plugin", &self_id()), ("key", key)]).await?["value"].take()) }
    /// Grava um atributo; `Value::Null` apaga.
    pub async fn data_set(&self, key: &str, value: Value) -> ApiResult<()> { self.post("plugin/data", &[("plugin", &self_id())], &json!({ "key": key, "value": value })).await.map(|_| ()) }
    /// Segredo do plugin, decifrado (token, senha); `None` quando não foi configurado.
    pub async fn secret(&self, key: &str) -> ApiResult<Option<String>> {
        Ok(self.get("plugin/secrets", &[("plugin", &self_id()), ("key", key)]).await?["value"].as_str().map(String::from))
    }
    /// Valores das configurações declaradas no plugin.json (`settings`), com os padrões; os segredos ficam em `secret`.
    pub async fn settings(&self) -> ApiResult<Value> { Ok(self.get("plugin/settings", &[("plugin", &self_id())]).await?["values"].take()) }
    /// Valor de um segredo do cofre da IDE: só se o usuário deixou este plugin ver o valor (Plugins › Cofre). Para só
    /// usar, prefira `{{vault:nome}}` no `plugin/fetch`, que não entrega o valor ao plugin.
    pub async fn vault_reveal(&self, key: &str) -> ApiResult<String> {
        self.get("vault/reveal", &[("plugin", &self_id()), ("key", key)]).await?["value"].as_str().map(String::from).ok_or_else(|| fail("sem valor", 404))
    }
}
