//! "Abrir com" do Windows: o BlueScreen aparece na lista de programas para .csv, .tsv, .xlsx e .xlsm.
//! Fica tudo em HKCU\Software\Classes (só para o usuário, sem administrador) e não troca o programa padrão: o
//! Windows não deixa um programa se pôr como padrão sozinho, e quem escolhe é o usuário ("Sempre usar este app").
//! O comando é `BlueScreen.exe --doc "<arquivo>"`, que abre a janela leve do documento (main.rs, desktop.rs).
//! A IDE instalada registra ao abrir (rápido: só grava se mudou); `--unregister` apaga, e os desinstaladores o chamam.

pub const EXTS: &[&str] = &[".csv", ".tsv", ".xlsx", ".xlsm"];
const PROGID: &str = "BlueScreen.Planilha";

#[cfg(windows)]
mod reg {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::*;
    fn w(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }
    pub fn get(key: &str, name: &str) -> Option<String> {
        let (k, n) = (w(key), w(name));
        let mut buf = vec![0u16; 1024];
        let mut len = (buf.len() * 2) as u32;
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), if name.is_empty() { std::ptr::null() } else { n.as_ptr() }, RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr() as _, &mut len) };
        if r != ERROR_SUCCESS { return None; }
        let n = (len as usize / 2).saturating_sub(1);
        Some(String::from_utf16_lossy(&buf[..n]))
    }
    pub fn set(key: &str, name: &str, val: &str) -> bool {
        let (k, n, v) = (w(key), w(name), w(val));
        unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), if name.is_empty() { std::ptr::null() } else { n.as_ptr() }, REG_SZ, v.as_ptr() as _, (v.len() * 2) as u32) == ERROR_SUCCESS }
    }
    pub fn del_tree(key: &str) { let k = w(key); unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, k.as_ptr()); RegDeleteKeyW(HKEY_CURRENT_USER, k.as_ptr()); } }
    pub fn del_value(key: &str, name: &str) { let (k, n) = (w(key), w(name)); unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr()); } }
    pub fn changed() { unsafe { windows_sys::Win32::UI::Shell::SHChangeNotify(0x0800_0000 /* SHCNE_ASSOCCHANGED */, 0, std::ptr::null(), std::ptr::null()); } }
}

/// Registra (ou corrige, se o exe mudou de pasta). Não faz nada fora de uma instalação: o exe de desenvolvimento
/// (target\debug, target\release) não deve virar o "Abrir com" de ninguém.
#[cfg(windows)]
pub fn register() {
    let Ok(exe) = std::env::current_exe() else { return };
    let exe_s = exe.to_string_lossy().into_owned();
    if cfg!(debug_assertions) || exe_s.to_ascii_lowercase().contains("\\target\\") { return; }
    let cmd = format!("\"{exe_s}\" --doc \"%1\"");
    let c = "Software\\Classes";
    if reg::get(&format!("{c}\\{PROGID}\\shell\\open\\command"), "").as_deref() == Some(cmd.as_str())
        && EXTS.iter().all(|e| reg::get(&format!("{c}\\{e}\\OpenWithProgids"), PROGID).is_some()) { return; }
    let icon = format!("\"{exe_s}\",0");
    let mut ok = true;
    for (k, n, v) in [
        (format!("{c}\\{PROGID}"), "", "Planilha (BlueScreen)"),
        (format!("{c}\\{PROGID}"), "FriendlyTypeName", "Planilha"),
        (format!("{c}\\{PROGID}\\DefaultIcon"), "", icon.as_str()),
        (format!("{c}\\{PROGID}\\shell\\open"), "FriendlyAppName", "BlueScreen"),
        (format!("{c}\\{PROGID}\\shell\\open\\command"), "", cmd.as_str()),
        (format!("{c}\\Applications\\BlueScreen.exe"), "FriendlyAppName", "BlueScreen"),
        (format!("{c}\\Applications\\BlueScreen.exe\\DefaultIcon"), "", icon.as_str()),
        (format!("{c}\\Applications\\BlueScreen.exe\\shell\\open\\command"), "", cmd.as_str()),
    ] { ok &= reg::set(&k, n, v); }
    for e in EXTS {
        ok &= reg::set(&format!("{c}\\{e}\\OpenWithProgids"), PROGID, "");
        ok &= reg::set(&format!("{c}\\Applications\\BlueScreen.exe\\SupportedTypes"), e, "");
    }
    reg::changed();
    crate::util::log(if ok { "Abrir com: BlueScreen registrado para .csv, .tsv e .xlsx." } else { "Abrir com: não deu para registrar tudo no Windows." });
}
#[cfg(windows)]
pub fn unregister() {
    let c = "Software\\Classes";
    reg::del_tree(&format!("{c}\\{PROGID}"));
    reg::del_tree(&format!("{c}\\Applications\\BlueScreen.exe"));
    for e in EXTS { reg::del_value(&format!("{c}\\{e}\\OpenWithProgids"), PROGID); }
    reg::changed();
}
#[cfg(not(windows))]
pub fn register() {}
#[cfg(not(windows))]
pub fn unregister() {}
