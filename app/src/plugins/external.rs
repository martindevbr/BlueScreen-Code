//! Plugins com servidor próprio: um programa (`server.exe`) na pasta do plugin.
//! O núcleo inicia o programa, espera o aviso `BLUESCREEN-READY {"port":..,"routes":[..]}` na saída padrão e
//! encaminha cada /api/<rota> do plugin para ele. Desligar o plugin (ou recarregar) encerra o processo.
use super::{Reply, RouteFn, route_fn};
use crate::util::*;
use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::Response;
use bluescreen_sdk::plugin::{H_INTERNAL, H_REMOTE, H_TOKEN};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

pub struct Running { pub child: Child, pub port: u16, pub routes: Vec<String> }
impl Drop for Running {
    fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
}

/// Executável do plugin: `server.exe` na pasta; em desenvolvimento, o binário `bluescreen-<id>` do cargo.
pub fn server_exe(dir: &Path, id: &str) -> Option<PathBuf> {
    let name = if cfg!(windows) { "server.exe" } else { "server" };
    let p = dir.join(name);
    if p.is_file() { return Some(p); }
    let bin = format!("bluescreen-{id}{}", if cfg!(windows) { ".exe" } else { "" });
    ["release", "debug"].iter().map(|prof| app_dir().join("target").join(prof).join(&bin)).filter(|p| p.is_file())
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
}

/// Inicia o programa do plugin e espera ele avisar a porta (até 15 s).
pub fn start(id: &str, dir: &Path, exe: &Path) -> anyhow::Result<Running> {
    let (url, token) = (bluescreen_sdk::plugin::core().url.clone(), bluescreen_sdk::plugin::core().token().to_string());
    let mut cmd = Command::new(exe);
    cmd.current_dir(dir).env("BLUESCREEN_URL", url).env("BLUESCREEN_TOKEN", token).env("BLUESCREEN_PLUGIN", id).env("BLUESCREEN_PLUGIN_DIR", dir)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // sem janela de console
    }
    let mut child = cmd.spawn().map_err(|e| anyhow::anyhow!("não foi possível iniciar {}: {e}", exe.display()))?;
    job::assign(&child);
    let (tx, rx) = mpsc::channel::<Value>();
    let out = child.stdout.take().expect("stdout");
    let err = child.stderr.take().expect("stderr");
    let tag = id.to_string();
    std::thread::spawn(move || {
        // primeira linha útil: o aviso de pronto; o resto vai para o log do BlueScreen
        let mut sent = false;
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if !sent { if let Some(j) = line.strip_prefix("BLUESCREEN-READY ") { let _ = tx.send(serde_json::from_str(j).unwrap_or_default()); sent = true; continue; } }
            log(format!("[{tag}] {line}"));
        }
    });
    let tag = id.to_string();
    std::thread::spawn(move || { for line in BufReader::new(err).lines().map_while(Result::ok) { log(format!("[{tag}] {line}")); } });
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(v) => {
            let port = v["port"].as_u64().unwrap_or(0) as u16;
            if port == 0 { let _ = child.kill(); anyhow::bail!("o servidor do plugin não informou a porta"); }
            let routes = v["routes"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            Ok(Running { child, port, routes })
        }
        Err(_) => {
            let code = child.try_wait().ok().flatten().map(|s| format!(" (saiu com código {})", s.code().unwrap_or(-1))).unwrap_or_default();
            let _ = child.kill();
            anyhow::bail!("o servidor do plugin não respondeu{code}")
        }
    }
}

static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| reqwest::Client::builder().no_proxy().build().expect("http"));

/// Rota que repassa a requisição ao processo do plugin e devolve a resposta como veio.
pub fn proxy(id: String, port: u16, route: String) -> RouteFn {
    let id = Arc::new(id);
    route_fn(move |r| {
        let (id, route) = (id.clone(), route.clone());
        async move {
            let token = bluescreen_sdk::plugin::core().token().to_string();
            let mut rb = HTTP.request(r.method.clone(), format!("http://127.0.0.1:{port}/api/{route}{}", bluescreen_sdk::plugin::query_string(r.query.iter().map(|(k, v)| (k.as_str(), v.as_str())))))
                .header(H_TOKEN, token).header(H_REMOTE, if r.remote { "1" } else { "0" }).header(H_INTERNAL, if r.internal { "1" } else { "0" })
                .body(r.body.clone());
            if let Some(ct) = r.headers.get(header::CONTENT_TYPE) { rb = rb.header(header::CONTENT_TYPE, ct.clone()); }
            let resp = rb.send().await.map_err(|e| fail(format!("O plugin {id} não respondeu ({e}). Recarregue os plugins na aba Plugins."), 502))?;
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let headers = resp.headers().clone();
            let mut out = Response::new(Body::from_stream(resp.bytes_stream()));
            *out.status_mut() = status;
            copy_headers(&headers, &mut out);
            Ok(Reply::Raw(out))
        }
    })
}

/// Repassa o tipo do conteúdo e o nome do arquivo do plugin para o navegador.
pub fn copy_headers(from: &reqwest::header::HeaderMap, to: &mut Response) {
    for k in [header::CONTENT_TYPE, header::CONTENT_DISPOSITION, header::CACHE_CONTROL] {
        if let Some(v) = from.get(k.as_str()).and_then(|v| HeaderValue::from_bytes(v.as_bytes()).ok()) { to.headers_mut().insert(k, v); }
    }
}

/// Windows: os processos dos plugins ficam num Job Object que morre junto com o BlueScreen (mesmo se ele travar).
#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::sync::LazyLock;
    use windows_sys::Win32::System::JobObjects::*;
    struct Job(isize);
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}
    static JOB: LazyLock<Job> = LazyLock::new(|| unsafe {
        let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as _, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
        Job(h as isize)
    });
    pub fn assign(child: &std::process::Child) { unsafe { AssignProcessToJobObject(JOB.0 as _, child.as_raw_handle() as _); } }
}
#[cfg(not(windows))]
mod job { pub fn assign(_: &std::process::Child) {} }
