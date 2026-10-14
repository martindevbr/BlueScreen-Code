//! BlueScreen: IDE leve para mostrar código e alterações (Git/SVN), estilo IntelliJ, com plugins.
//!   bluescreen [pasta] [--lan] [--web] [--no-open] [--devtools]
//! O núcleo (servidor, Git/SVN, árvore, busca, lint, rede local) é Rust; a interface é a página em wwwroot/,
//! mostrada numa janela nativa com WebView2 (ou no navegador com --web).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod build;
mod desktop;
mod lint;
mod plugins;
mod rpc;
mod server;
mod terminal;
mod workspace;
pub(crate) use bluescreen_sdk::{util, vcs};

use std::path::PathBuf;
use std::time::Duration;
use util::log;

fn fatal(msg: &str) -> ! {
    log(msg);
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MessageBoxW};
        let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        MessageBoxW(std::ptr::null_mut(), w(msg).as_ptr(), w("BlueScreen").as_ptr(), MB_ICONERROR);
    }
    std::process::exit(1)
}

/// Porta ocupada por outro BlueScreen: se ele tem janela, só traz para a frente; senão pede para encerrar
/// (versões antigas, em Node, não têm /api/activate) e, se não sair, finaliza o processo pelo PID.
async fn take_over(port: u16, want_window: bool) -> Result<bool, String> {
    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().map_err(|e| e.to_string())?;
    let cfg: serde_json::Value = match http.get(format!("{base}/api/config")).send().await { Ok(r) => r.json().await.unwrap_or_default(), Err(_) => Default::default() };
    if cfg.get("root").is_none() || cfg.get("network").is_none() { return Err(format!("A porta {port} está em uso por outro programa. Use BLUESCREEN_PORT para escolher outra.")); }
    if want_window && cfg["desktop"].as_bool() == Some(true) {
        // quem o usuário acabou de abrir pode passar o direito de ir para a frente à instância que já está aberta
        #[cfg(windows)]
        if let Some(pid) = cfg["pid"].as_u64() { unsafe { windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(pid as u32); } }
        if let Ok(r) = http.post(format!("{base}/api/activate")).header("X-BlueScreen", "takeover").send().await {
            if r.status().is_success() { return Ok(false); }
        }
    }
    let _ = http.post(format!("{base}/api/shutdown")).header("X-BlueScreen", "takeover").send().await;
    let free = || std::net::TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(200)).is_err();
    for _ in 0..10 { tokio::time::sleep(Duration::from_millis(200)).await; if free() { return Ok(true); } }
    if let Some(pid) = cfg["pid"].as_u64().filter(|&p| p as u32 != std::process::id()) {
        log(format!("Encerrando o BlueScreen antigo (PID {pid}) que ocupava a porta {port}."));
        let _ = util::run("taskkill", &["/PID", &pid.to_string(), "/T", "/F"], &std::env::temp_dir(), 5000).await;
        for _ in 0..15 { tokio::time::sleep(Duration::from_millis(200)).await; if free() { return Ok(true); } }
    }
    Err(format!("Não foi possível liberar a porta {port}. Feche a outra instância ou use BLUESCREEN_PORT."))
}

fn main() {
    #[cfg(windows)]
    unsafe { windows_sys::Win32::System::Console::AttachConsole(windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS); }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has = |f: &str| args.iter().any(|a| a == f);
    let env_port = |k: &str, d: u16| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
    let port = env_port("BLUESCREEN_PORT", 4747);
    let lan_port = env_port("BLUESCREEN_LAN_PORT", 4748);
    let headless = has("--no-open") || std::env::var("BLUESCREEN_NO_OPEN").is_ok_and(|v| !v.is_empty());
    let web = has("--web");
    let root = args.iter().find(|a| !a.starts_with("--")).map(|a| util::absolute(&PathBuf::from(a)))
        .unwrap_or_else(|| util::app_dir().parent().map(PathBuf::from).unwrap_or_else(|| std::env::current_dir().unwrap_or_default()));

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().thread_name("bluescreen").build().expect("tokio");
    let listener = rt.block_on(async {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => l,
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                log(format!("Porta {port} ocupada. Verificando se é outro BlueScreen…"));
                match take_over(port, !headless && !web).await {
                    Ok(false) => { log("O BlueScreen já está aberto: trouxe a janela para a frente."); std::process::exit(0) }
                    Ok(true) => tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap_or_else(|e| fatal(&format!("Porta {port}: {e}"))),
                    Err(m) => fatal(&m),
                }
            }
            Err(e) => fatal(&format!("Não foi possível iniciar o BlueScreen na porta {port}: {e}")),
        }
    });
    let _ = server::create(root.clone(), port, lan_port);
    let addr = format!("http://127.0.0.1:{port}");
    println!();
    log(format!("BlueScreen {} (Rust)  ▸  {addr}", server::VERSION));
    log(format!("pasta: {}", root.display()));
    server::host().print();
    rt.spawn(async move { let _ = axum::serve(listener, server::router(false)).await; });
    if has("--lan") {
        match rt.block_on(server::lan_enable()) {
            Ok(s) => log(format!("rede: PIN {}  {}", s["pin"].as_str().unwrap_or(""), s["urls"].as_array().map(|u| u.iter().filter_map(|x| x["url"].as_str()).collect::<Vec<_>>().join("  ")).unwrap_or_default())),
            Err(e) => log(format!("rede: falhou: {e}")),
        }
    }
    println!();
    if headless { rt.block_on(std::future::pending::<()>()); }
    if web { util::open_url(&addr); rt.block_on(std::future::pending::<()>()); }
    // a janela precisa da thread principal; o servidor segue nas threads do tokio
    let _rt = Box::leak(Box::new(rt));
    desktop::run(addr + "/", has("--devtools"))
}
