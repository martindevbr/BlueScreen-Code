//! Servidores de linguagem (LSP) e depuradores (DAP), como os do IntelliJ e do VS Code: o BlueScreen não reimplementa
//! a análise de cada linguagem, ele conversa com as ferramentas oficiais de cada uma (rust-analyzer, gopls, pyright,
//! clangd, jdtls, debugpy, Delve, lldb-dap...). Os dois protocolos usam a mesma moldura (cabeçalho Content-Length +
//! JSON), então uma ponte só liga o processo à página por WebSocket: cada mensagem vira um quadro de texto.
//! Ferramentas a mais ou com outro caminho: ~/.bluescreen/tools.json, lista de { id, kind, name, langs, command, args }.
use crate::build::detect::which;
use crate::util::{read_json, user_dir};
use axum::body::Body;
use axum::extract::FromRequest;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

#[derive(Serialize, Clone, Debug)]
pub struct Tool {
    pub id: String,
    /// "lsp" ou "dap"
    pub kind: &'static str,
    pub name: String,
    /// linguagens do editor (ids do Monaco) que a ferramenta atende
    pub langs: Vec<String>,
    /// caminho encontrado (vazio = não instalada)
    pub command: String,
    pub args: Vec<String>,
    /// como instalar, para mostrar na interface
    pub install: String,
    /// DAP por TCP: o processo abre {port} e a ponte conecta nele
    pub tcp: bool,
    pub installed: bool,
    /// como a IDE instala sozinha (sem console), se der neste PC
    #[serde(skip_serializing_if = "Option::is_none")] pub auto: Option<String>,
    /// o que falta para a IDE conseguir instalar (ex.: "precisa de Node.js (npm) instalado")
    #[serde(skip_serializing_if = "Option::is_none")] pub needs: Option<String>,
}

struct Def { id: &'static str, kind: &'static str, name: &'static str, langs: &'static [&'static str], progs: &'static [&'static str], args: &'static [&'static str], install: &'static str, tcp: bool }
const fn lsp(id: &'static str, name: &'static str, langs: &'static [&'static str], progs: &'static [&'static str], args: &'static [&'static str], install: &'static str) -> Def {
    Def { id, kind: "lsp", name, langs, progs, args, install, tcp: false }
}
const fn dap(id: &'static str, name: &'static str, langs: &'static [&'static str], progs: &'static [&'static str], args: &'static [&'static str], install: &'static str, tcp: bool) -> Def {
    Def { id, kind: "dap", name, langs, progs, args, install, tcp }
}

const DEFS: &[Def] = &[
    // ----- análise e refatoração (LSP) -----
    lsp("jdtls", "Eclipse JDT LS (Java)", &["java"], &["jdtls"], &["-data", "{data}"], "scoop install jdtls  (ou baixe em download.eclipse.org/jdtls e ponha o bin no PATH)"),
    lsp("tsserver", "TypeScript Language Server", &["typescript", "javascript"], &["typescript-language-server"], &["--stdio"], "npm i -g typescript typescript-language-server"),
    lsp("basedpyright", "basedpyright (Python)", &["python"], &["basedpyright-langserver"], &["--stdio"], "pip install basedpyright"),
    lsp("pyright", "Pyright (Python)", &["python"], &["pyright-langserver"], &["--stdio"], "npm i -g pyright"),
    lsp("pylsp", "Python LSP Server", &["python"], &["pylsp"], &[], "pip install python-lsp-server"),
    lsp("rust-analyzer", "rust-analyzer", &["rust"], &["rust-analyzer"], &[], "rustup component add rust-analyzer"),
    lsp("gopls", "gopls (Go)", &["go"], &["gopls"], &[], "go install golang.org/x/tools/gopls@latest"),
    lsp("clangd", "clangd (C/C++)", &["c", "cpp"], &["clangd"], &[], "winget install LLVM.LLVM"),
    lsp("csharp-ls", "csharp-ls (C#)", &["csharp"], &["csharp-ls"], &[], "dotnet tool install -g csharp-ls"),
    lsp("kotlin", "Kotlin Language Server", &["kotlin"], &["kotlin-language-server"], &[], "scoop install kotlin-language-server"),
    lsp("intelephense", "Intelephense (PHP)", &["php"], &["intelephense"], &["--stdio"], "npm i -g intelephense"),
    lsp("ruby-lsp", "Ruby LSP", &["ruby"], &["ruby-lsp"], &[], "gem install ruby-lsp"),
    lsp("solargraph", "Solargraph (Ruby)", &["ruby"], &["solargraph"], &["stdio"], "gem install solargraph"),
    lsp("lua", "Lua Language Server", &["lua"], &["lua-language-server"], &[], "winget install LuaLS.lua-language-server"),
    lsp("html", "HTML (VS Code)", &["html"], &["vscode-html-language-server"], &["--stdio"], "npm i -g vscode-langservers-extracted"),
    lsp("css", "CSS, SCSS e Less (VS Code)", &["css", "scss", "less"], &["vscode-css-language-server"], &["--stdio"], "npm i -g vscode-langservers-extracted"),
    lsp("json", "JSON (VS Code)", &["json"], &["vscode-json-language-server"], &["--stdio"], "npm i -g vscode-langservers-extracted"),
    lsp("yaml", "YAML Language Server", &["yaml"], &["yaml-language-server"], &["--stdio"], "npm i -g yaml-language-server"),
    lsp("bash", "Bash Language Server", &["shell"], &["bash-language-server"], &["start"], "npm i -g bash-language-server"),
    lsp("lemminx", "LemMinX (XML)", &["xml"], &["lemminx"], &[], "scoop install lemminx"),
    lsp("dart", "Dart Analysis Server", &["dart"], &["dart"], &["language-server", "--protocol=lsp"], "instale o Dart SDK ou o Flutter"),
    lsp("zls", "ZLS (Zig)", &["zig"], &["zls"], &[], "winget install zigtools.zls"),
    // ----- depuração (DAP) -----
    dap("debugpy", "debugpy (Python)", &["python"], &["python", "py"], &["-m", "debugpy.adapter"], "pip install debugpy", false),
    dap("delve", "Delve (Go)", &["go"], &["dlv"], &["dap", "--listen=127.0.0.1:{port}"], "go install github.com/go-delve/delve/cmd/dlv@latest", true),
    dap("lldb-dap", "LLDB (C, C++ e Rust)", &["c", "cpp", "rust"], &["lldb-dap", "lldb-vscode"], &[], "winget install LLVM.LLVM", false),
    dap("codelldb", "CodeLLDB (C, C++ e Rust)", &["c", "cpp", "rust"], &["codelldb"], &["--port", "{port}"], "baixe o CodeLLDB (github.com/vadimcn/codelldb) e ponha adapter/ no PATH", true),
    dap("netcoredbg", "netcoredbg (.NET)", &["csharp"], &["netcoredbg"], &["--interpreter=vscode"], "scoop install netcoredbg", false),
];

fn tools_dir() -> PathBuf { crate::install::tools_dir() }

/// debugpy não é um programa: o que precisa existir é o módulo no Python encontrado
fn extra_check(id: &str, prog: &Path) -> bool {
    match id {
        "debugpy" => {
            let mut c = std::process::Command::new(prog);
            c.args(["-c", "import debugpy"]).stdout(Stdio::null()).stderr(Stdio::null());
            #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
            c.status().map(|s| s.success()).unwrap_or(false)
        }
        // atalhos do rustup em ~/.cargo/bin (rust-analyzer...) existem mesmo sem o componente instalado; aí saem na
        // hora com "Unknown binary": só conta como instalado se responder ao --version
        _ if prog.parent().is_some_and(|d| d.ends_with(".cargo/bin") || d.ends_with(".cargo\\bin")) => {
            let mut c = std::process::Command::new(prog);
            c.arg("--version").stdout(Stdio::null()).stderr(Stdio::null());
            #[cfg(windows)] { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
            c.status().map(|s| s.success()).unwrap_or(false)
        }
        _ => true,
    }
}

pub fn detect() -> Vec<Tool> {
    let mut out: Vec<Tool> = DEFS.iter().map(|d| {
        // baixada pela IDE (~/.bluescreen/tools/<id>) primeiro, depois o PATH
        let found = d.progs.iter().find_map(|p| crate::install::local(d.id, p).or_else(|| which(p).filter(|w| extra_check(d.id, w))));
        let (auto, needs) = if found.is_some() { (None, None) } else { crate::install::describe(d.id) };
        Tool {
            id: d.id.into(), kind: d.kind, name: d.name.into(), langs: d.langs.iter().map(|s| s.to_string()).collect(),
            command: found.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
            args: d.args.iter().map(|s| s.to_string()).collect(), install: d.install.into(), tcp: d.tcp, installed: found.is_some(), auto, needs,
        }
    }).collect();
    // ~/.bluescreen/tools.json: ferramentas do usuário (mesmo id troca a de fábrica)
    if let Some(list) = read_json(&user_dir().join("tools.json")).as_array() {
        for v in list {
            let (Some(id), Some(cmd)) = (v["id"].as_str(), v["command"].as_str()) else { continue };
            let kind = if v["kind"].as_str() == Some("dap") { "dap" } else { "lsp" };
            let prog = if Path::new(cmd).is_absolute() { Some(PathBuf::from(cmd)).filter(|p| p.is_file()) } else { which(cmd) };
            let t = Tool {
                id: id.into(), kind, name: v["name"].as_str().unwrap_or(id).into(),
                langs: v["langs"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
                command: prog.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
                args: v["args"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
                install: v["install"].as_str().unwrap_or("").into(), tcp: v["tcp"].as_bool().unwrap_or(false), installed: prog.is_some(), auto: None, needs: None,
            };
            out.retain(|x| x.id != t.id); out.insert(0, t);
        }
    }
    out
}

static TOOLS: parking_lot::Mutex<Option<std::sync::Arc<Vec<Tool>>>> = parking_lot::const_mutex(None);
pub fn tools(fresh: bool) -> std::sync::Arc<Vec<Tool>> {
    if !fresh { if let Some(t) = TOOLS.lock().clone() { return t; } }
    let t = std::sync::Arc::new(detect()); *TOOLS.lock() = Some(t.clone()); t
}

fn deny(code: StatusCode, msg: &str) -> Response { (code, msg.to_string()).into_response() }

/// GET /api/rpc/ws?tool=<id>&root=<pasta> — inicia a ferramenta e liga ao WebSocket (só PC local, só a própria página).
pub async fn ws(req: Request<Body>, remote: bool, q: HashMap<String, String>) -> Response {
    if remote { return deny(StatusCode::FORBIDDEN, "só pelo PC local"); }
    let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    let origin = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()).unwrap_or("");
    if host.is_empty() || origin != format!("http://{host}") { return deny(StatusCode::FORBIDDEN, "origem não permitida"); }
    let list = tools(false);
    let Some(tool) = q.get("tool").and_then(|id| list.iter().find(|t| &t.id == id)).cloned() else { return deny(StatusCode::NOT_FOUND, "ferramenta desconhecida") };
    if !tool.installed { return deny(StatusCode::NOT_FOUND, "ferramenta não instalada"); }
    let root = q.get("root").map(PathBuf::from).filter(|p| p.is_dir()).or_else(dirs::home_dir).unwrap_or_else(|| PathBuf::from("C:\\"));
    match WebSocketUpgrade::from_request(req, &()).await {
        Ok(up) => up.on_upgrade(move |socket| session(socket, tool, root)),
        Err(e) => e.into_response(),
    }
}

fn free_port() -> u16 { std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(0) }

async fn session(mut ws: WebSocket, tool: Tool, root: PathBuf) {
    let text = |v: Value| Message::Text(v.to_string().into());
    let port = if tool.tcp { free_port() } else { 0 };
    // pasta de trabalho do jdtls por projeto (ele guarda o índice lá)
    let data = user_dir().join("lsp-data").join(format!("{}-{:x}", tool.id, root.to_string_lossy().bytes().fold(0u64, |h, b| h.wrapping_mul(31).wrapping_add(b as u64))));
    let args: Vec<String> = tool.args.iter().map(|a| a.replace("{port}", &port.to_string()).replace("{data}", &data.to_string_lossy()).replace("{tools}", &tools_dir().to_string_lossy()).replace("{root}", &root.to_string_lossy())).collect();
    let mut cmd = tokio::process::Command::new(&tool.command);
    cmd.args(&args).current_dir(&root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)] cmd.creation_flags(0x0800_0000);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => { let _ = ws.send(text(json!({ "bs": "error", "message": format!("não deu para iniciar {}: {e}", tool.name) }))).await; return; }
    };
    // o que a ferramenta escreve no stderr vai para a página como log (aparece no console do BlueScreen)
    if let Some(err) = child.stderr.take() {
        let name = tool.id.clone();
        tokio::spawn(async move { let mut l = BufReader::new(err).lines(); while let Ok(Some(s)) = l.next_line().await { crate::util::log(&format!("[{name}] {s}")); } });
    }
    let (reader, writer): (Box<dyn AsyncRead + Unpin + Send>, Box<dyn AsyncWrite + Unpin + Send>) = if tool.tcp {
        // DAP por TCP: espera o adaptador abrir a porta
        let mut conn = None;
        for _ in 0..100 { if let Ok(s) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await { conn = Some(s); break; } tokio::time::sleep(Duration::from_millis(100)).await; }
        let Some(s) = conn else { let _ = ws.send(text(json!({ "bs": "error", "message": format!("{} não abriu a porta {port}", tool.name) }))).await; let _ = child.kill().await; return; };
        let (r, w) = s.into_split(); (Box::new(r), Box::new(w))
    } else {
        (Box::new(child.stdout.take().expect("stdout")), Box::new(child.stdin.take().expect("stdin")))
    };
    let _ = ws.send(text(json!({ "bs": "ready", "pid": child.id(), "name": tool.name, "port": port }))).await;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
    let rtask = tokio::spawn(async move {
        let mut r = BufReader::new(reader);
        loop {
            // cabeçalhos até a linha vazia; só o Content-Length importa
            let mut len: Option<usize> = None;
            loop {
                let mut line = String::new();
                match r.read_line(&mut line).await { Ok(0) | Err(_) => return, Ok(_) => {} }
                let l = line.trim_end();
                if l.is_empty() { if len.is_some() { break; } continue; }
                if let Some(v) = l.strip_prefix("Content-Length:").or_else(|| l.strip_prefix("content-length:")) { len = v.trim().parse().ok(); }
            }
            let mut buf = vec![0u8; len.unwrap_or(0)];
            if r.read_exact(&mut buf).await.is_err() { return; }
            if tx.send(String::from_utf8_lossy(&buf).into_owned()).await.is_err() { return; }
        }
    });
    let mut writer = writer;
    loop {
        tokio::select! {
            m = rx.recv() => match m {
                Some(s) => { if ws.send(Message::Text(s.into())).await.is_err() { break; } }
                None => { let code = child.wait().await.ok().and_then(|s| s.code()); let _ = ws.send(text(json!({ "bs": "exit", "code": code }))).await; break; }
            },
            m = ws.recv() => match m {
                Some(Ok(Message::Text(t))) => {
                    let body = t.as_str().as_bytes();
                    let frame = [format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes(), body].concat();
                    if writer.write_all(&frame).await.is_err() || writer.flush().await.is_err() { break; }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            }
        }
    }
    rtask.abort();
    drop(writer);
    // dá um instante para sair sozinha (depois do shutdown/disconnect da página); senão encerra
    if tokio::time::timeout(Duration::from_millis(1500), child.wait()).await.is_err() { kill_tree(&mut child).await; }
}

/// shims do npm (.cmd) rodam o node como neto: encerrar só o filho deixaria o servidor vivo
async fn kill_tree(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let mut c = tokio::process::Command::new("taskkill");
        c.args(["/T", "/F", "/PID", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x0800_0000);
        let _ = c.status().await;
    }
    let _ = child.kill().await;
}
