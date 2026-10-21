//! Cofre: tokens da IDE (GitHub, OpenAI, Jira...) que você guarda uma vez e libera para os plugins que quiser.
//! Fica em ~/.bluescreen/vault.json, com cada valor cifrado pelo DPAPI do Windows.
//!
//! Todo ui.js roda na mesma página, então um plugin pode se passar por outro numa chamada à API e ler o que se digita
//! num campo da página. Por isso o cofre não confia na página:
//!   - o valor entra pela área de transferência, lida aqui no núcleo: nunca passa por um campo da página;
//!   - tudo o que amplia o acesso (gravar um valor, liberar um plugin, acrescentar sites ou programas) só vale depois
//!     do "Sim" numa caixa de diálogo nativa do Windows, que o JavaScript da página não clica;
//!   - o plugin usa o segredo sem vê-lo: `{{vault:nome}}` no `plugin/fetch` (só para os sites liberados, em HTTPS)
//!     ou nas variáveis de ambiente do `plugin/exec`/`plugin/proc` (só para os programas liberados); o valor é
//!     tirado das respostas e da saída antes de voltar para a página;
//!   - ler o valor cru (`vault/reveal`) só para um servidor de plugin, identificado pelo token que ele recebeu ao ser
//!     iniciado (BLUESCREEN_PLUGIN_TOKEN), e só se você marcou "pode ver o valor" para ele;
//!   - cada uso (e cada recusa) entra no registro do cofre.
//! Plugins com servidor nativo rodam como o seu usuário do Windows: o cofre limita o que eles recebem pela API, mas
//! não é uma sandbox.
use super::{RouteFn, ok, route_fn};
use crate::server::host;
use crate::util::*;
use bluescreen_sdk::plugin::Req;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, VecDeque};
use std::sync::LazyLock;

use bluescreen_sdk::plugin::H_PLUGIN_TOKEN;
const ENTROPY: &[u8] = b"bluescreen-vault";

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Grant {
    /// usar sem ver ({{vault:nome}} no fetch e nas variáveis de ambiente)
    #[serde(rename = "use")]
    pub allow: bool,
    /// ler o valor (só servidores de plugin)
    pub reveal: bool,
}
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
struct Entry {
    /// cifrado (DPAPI, base64); nunca sai daqui
    #[serde(skip_serializing_if = "String::is_empty")]
    value: String,
    label: String,
    note: String,
    /// sites para onde o segredo pode ir: "api.github.com", "*.atlassian.net"
    hosts: Vec<String>,
    /// programas que podem recebê-lo numa variável de ambiente: "gh", "git"
    programs: Vec<String>,
    grants: BTreeMap<String, Grant>,
    /// começo do valor ("ghp_"), para você reconhecer qual token é; só em valores longos
    hint: String,
    length: usize,
    created: i64,
    updated: i64,
    last_used: Option<i64>,
    last_by: Option<String>,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Store { entries: BTreeMap<String, Entry> }

static LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static AUDIT: LazyLock<Mutex<VecDeque<Value>>> = LazyLock::new(|| Mutex::new(VecDeque::new()));
/// uma caixa de confirmação por vez (um plugin não empilha dezenas de pedidos)
static ASKING: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

fn file() -> std::path::PathBuf { user_dir().join("vault.json") }
fn load() -> Store { serde_json::from_value(read_json(&file())).unwrap_or_default() }
fn save(s: &Store) -> ApiResult<()> { Ok(write_atomic(&file(), &serde_json::to_string_pretty(s).unwrap_or_default())?) }
fn edit<T>(f: impl FnOnce(&mut Store) -> ApiResult<T>) -> ApiResult<T> {
    let _g = LOCK.lock();
    let mut s = load();
    let out = f(&mut s)?;
    save(&s)?;
    Ok(out)
}
fn now() -> i64 { chrono::Utc::now().timestamp_millis() }
fn valid_name(n: &str) -> bool { !n.is_empty() && n.len() <= 64 && n.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c)) }
fn need_name(n: &str) -> ApiResult<String> {
    if valid_name(n) { Ok(n.to_string()) } else { Err(fail("nome inválido: use letras, números, _ . - (até 64)", 400)) }
}

fn seal(plain: &str) -> ApiResult<String> {
    use base64::Engine;
    let c = super::data::dpapi::protect(plain.as_bytes(), ENTROPY, true).ok_or_else(|| fail("não deu para cifrar", 500))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(c))
}
fn unseal(sealed: &str) -> Option<String> {
    use base64::Engine;
    let c = base64::engine::general_purpose::STANDARD.decode(sealed).ok()?;
    String::from_utf8(super::data::dpapi::protect(&c, ENTROPY, false)?).ok()
}

fn audit(plugin: &str, name: &str, target: &str, allowed: bool, why: &str) {
    let mut a = AUDIT.lock();
    a.push_front(json!({ "at": now(), "plugin": plugin, "name": name, "target": target, "ok": allowed, "why": why }));
    a.truncate(200);
    if !allowed { log(format!("cofre: {plugin} -> {name} ({target}) recusado: {why}")); }
}

// ---------- quem chama ----------
pub struct Caller {
    pub plugin: String,
    /// identificado pelo token do processo (servidor de plugin); falso = a página, que só declara o id
    pub verified: bool,
}
/// Quem está chamando: o servidor de plugin dono do token do cabeçalho ou, sem ele, o plugin que a página declara.
pub fn caller(r: &Req) -> ApiResult<Caller> {
    let claimed = r.q("plugin");
    if let Some(tok) = r.headers.get(H_PLUGIN_TOKEN).and_then(|v| v.to_str().ok()).filter(|t| !t.is_empty()) {
        if r.remote { return Err(fail("só pelo PC local", 403)); }
        let id = super::external::token_owner(tok).ok_or_else(|| fail("token de plugin desconhecido", 403))?;
        if claimed.is_some_and(|c| c != id) { return Err(fail("o token é de outro plugin", 403)); }
        return Ok(Caller { plugin: id, verified: true });
    }
    Ok(Caller { plugin: super::data::plugin_of(r)?, verified: false })
}

// ---------- uso pelos plugins ----------
/// Valor do segredo para um plugin liberado (a política de destino é conferida depois, em `check`).
pub fn resolve(c: &Caller, name: &str) -> ApiResult<String> {
    let s = { let _g = LOCK.lock(); load() };
    let Some(e) = s.entries.get(name) else {
        audit(&c.plugin, name, "", false, "não existe no cofre");
        return Err(fail(format!("\"{name}\" não está no cofre. Crie em Plugins › Cofre."), 404));
    };
    if !e.grants.get(&c.plugin).is_some_and(|g| g.allow) {
        audit(&c.plugin, name, "", false, "plugin sem permissão");
        return Err(fail(format!("o plugin {} não tem permissão para usar \"{name}\" (Plugins › Cofre)", c.plugin), 403));
    }
    unseal(&e.value).ok_or_else(|| fail(format!("não deu para decifrar \"{name}\" (o cofre foi copiado de outro usuário ou PC?)"), 500))
}
pub enum Target<'a> { Http(&'a reqwest::Url), Program(&'a str) }
fn host_ok(pattern: &str, host: &str) -> bool {
    let (p, h) = (pattern.trim().to_ascii_lowercase(), host.to_ascii_lowercase());
    match p.strip_prefix("*.") { Some(base) => h == base || h.ends_with(&format!(".{base}")), None => p == h }
}
fn local_host(h: &str) -> bool { matches!(h, "localhost" | "127.0.0.1" | "[::1]" | "::1") }
/// Confere se os segredos usados podem ir para esse destino; registra o uso (ou a recusa).
pub fn check(c: &Caller, names: &[String], target: Target) -> ApiResult<()> {
    if names.is_empty() { return Ok(()); }
    let s = { let _g = LOCK.lock(); load() };
    for name in names {
        let Some(e) = s.entries.get(name) else { continue };
        let (desc, res): (String, Result<(), String>) = match &target {
            Target::Http(u) => {
                let h = u.host_str().unwrap_or("");
                let desc = h.to_string();
                let res = if u.scheme() != "https" && !local_host(h) { Err(format!("\"{name}\" só vai por HTTPS")) }
                    else if e.hosts.is_empty() && !c.verified { Err(format!("\"{name}\" não tem sites liberados: defina para onde ele pode ir em Plugins › Cofre")) }
                    else if !e.hosts.is_empty() && !e.hosts.iter().any(|p| host_ok(p, h)) { Err(format!("\"{name}\" não pode ir para {h} (liberados: {})", e.hosts.join(", "))) }
                    else { Ok(()) };
                (desc, res)
            }
            Target::Program(p) => {
                let base = std::path::Path::new(p).file_stem().and_then(|s| s.to_str()).unwrap_or(p).to_ascii_lowercase();
                let res = if e.programs.iter().any(|x| x.trim().eq_ignore_ascii_case(&base)) { Ok(()) }
                    else { Err(format!("\"{name}\" não está liberado para o programa {base} (Plugins › Cofre)")) };
                (format!("programa {base}"), res)
            }
        };
        match res {
            Ok(()) => audit(&c.plugin, name, &desc, true, ""),
            Err(m) => { audit(&c.plugin, name, &desc, false, &m); return Err(fail(m, 403)); }
        }
    }
    // último uso (sem travar a resposta numa escrita de disco por pedido)
    let (names, who) = (names.to_vec(), c.plugin.clone());
    std::thread::spawn(move || { let _ = edit(|s| { for n in &names { if let Some(e) = s.entries.get_mut(n) { e.last_used = Some(now()); e.last_by = Some(who.clone()); } } Ok(()) }); });
    Ok(())
}
/// Tira os valores dos segredos de um texto que volta para a página (resposta HTTP, saída de programa).
pub fn scrub(text: &str, values: &[String]) -> String {
    let mut out = text.to_string();
    for v in values.iter().filter(|v| v.len() >= 4) { if out.contains(v.as_str()) { out = out.replace(v.as_str(), "••••••"); } }
    out
}

// ---------- confirmação nativa e área de transferência ----------
#[cfg(windows)]
fn native_confirm(title: &str, text: &str) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (t, m) = (w(title), w(text));
    // SAFETY: textos terminados em zero, vivos durante a chamada; sem janela dona (fica por cima de tudo)
    let r = unsafe { MessageBoxW(std::ptr::null_mut(), m.as_ptr(), t.as_ptr(), MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_TOPMOST | MB_SETFOREGROUND) };
    r == IDYES
}
#[cfg(not(windows))]
fn native_confirm(_: &str, _: &str) -> bool { false }
/// Pergunta numa caixa nativa (o JavaScript da página não clica nela). Uma por vez.
async fn confirm(text: String) -> ApiResult<()> {
    let _g = ASKING.try_lock().map_err(|_| fail("já há uma confirmação do cofre aberta", 409))?;
    let yes = tokio::task::spawn_blocking(move || native_confirm("BlueScreen · Cofre", &text)).await.unwrap_or(false);
    if yes { Ok(()) } else { Err(fail("cancelado", 409)) }
}
#[cfg(windows)]
fn clipboard_text(clear: bool) -> Option<String> {
    use windows_sys::Win32::System::DataExchange::*;
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    const CF_UNICODETEXT: u32 = 13;
    // SAFETY: a área de transferência fica aberta só aqui dentro; o texto é copiado antes de soltar o bloqueio
    unsafe {
        let mut opened = false;
        for _ in 0..10 { if OpenClipboard(std::ptr::null_mut()) != 0 { opened = true; break; } std::thread::sleep(std::time::Duration::from_millis(30)); }
        if !opened { return None; }
        let h = GetClipboardData(CF_UNICODETEXT);
        let mut out = None;
        if !h.is_null() {
            let p = GlobalLock(h as _) as *const u16;
            if !p.is_null() {
                let mut n = 0; while *p.add(n) != 0 && n < 1 << 20 { n += 1; }
                out = Some(String::from_utf16_lossy(std::slice::from_raw_parts(p, n)));
                GlobalUnlock(h as _);
            }
        }
        if clear && out.is_some() { EmptyClipboard(); }
        CloseClipboard();
        out
    }
}
#[cfg(not(windows))]
fn clipboard_text(_: bool) -> Option<String> { None }

// ---------- o que a página e os plugins veem (nunca o valor) ----------
fn public(name: &str, e: &Entry) -> Value {
    let mut v = serde_json::to_value(e).unwrap_or_default();
    if let Some(o) = v.as_object_mut() { o.remove("value"); o.insert("name".into(), json!(name)); }
    v
}
/// pedidos dos plugins (`vault` no plugin.json): [{ key, label, why, hosts, programs, reveal }]
fn requests(s: &Store) -> Vec<Value> {
    let mut out = vec![];
    for p in host().get().list.iter() {
        for d in p.vault.as_array().into_iter().flatten() {
            let Some(key) = d["key"].as_str().filter(|k| valid_name(k)) else { continue };
            let g = s.entries.get(key).and_then(|e| e.grants.get(&p.id)).cloned().unwrap_or_default();
            out.push(json!({
                "plugin": p.id, "pluginName": p.name, "enabled": p.enabled, "key": key, "label": d["label"], "why": d["why"],
                "hosts": d["hosts"], "programs": d["programs"], "reveal": d["reveal"].as_bool().unwrap_or(false),
                "exists": s.entries.contains_key(key), "granted": g.allow, "revealGranted": g.reveal,
            }));
        }
    }
    out
}
fn plugin_name(id: &str) -> String { host().get().list.iter().find(|p| p.id == id).map(|p| p.name.clone()).unwrap_or_else(|| id.to_string()) }
fn list_of(v: &Value) -> Vec<String> {
    let raw: Vec<String> = match v { Value::String(s) => s.split([',', ' ', '\n', ';']).map(String::from).collect(), _ => v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default() };
    let mut out: Vec<String> = raw.into_iter().map(|s| s.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/').to_ascii_lowercase()).filter(|s| !s.is_empty()).collect();
    out.sort(); out.dedup(); out
}

pub fn routes() -> Vec<(&'static str, RouteFn)> {
    vec![
        // a tela do cofre: GET -> { entries, requests, audit }; POST { action, ... } (veja abaixo). Só pelo PC local.
        ("vault", route_fn(|r| async move {
            r.local_only()?;
            // servidores de plugin não administram o cofre: só a tela da IDE (com a confirmação nativa)
            if r.headers.contains_key(H_PLUGIN_TOKEN) { return Err(fail("plugins não administram o cofre", 403)); }
            if r.is_post() { manage(&r).await?; }
            let s = { let _g = LOCK.lock(); load() };
            ok(json!({
                "entries": s.entries.iter().map(|(k, e)| public(k, e)).collect::<Vec<_>>(),
                "requests": requests(&s),
                "audit": AUDIT.lock().iter().take(100).cloned().collect::<Vec<_>>(),
                "file": file(),
            }))
        })),
        // para os plugins: GET ?plugin= -> { items: [{ key, exists, granted, reveal, hosts, programs }] } (sem valores)
        ("vault/status", route_fn(|r| async move {
            let c = caller(&r)?;
            let s = { let _g = LOCK.lock(); load() };
            let mut keys: Vec<String> = host().get().list.iter().filter(|p| p.id == c.plugin).flat_map(|p| p.vault.as_array().cloned().unwrap_or_default())
                .filter_map(|d| d["key"].as_str().map(String::from)).collect();
            keys.extend(s.entries.iter().filter(|(_, e)| e.grants.get(&c.plugin).is_some_and(|g| g.allow || g.reveal)).map(|(k, _)| k.clone()));
            keys.sort(); keys.dedup();
            let items: Vec<Value> = keys.iter().map(|k| {
                let e = s.entries.get(k);
                let g = e.and_then(|e| e.grants.get(&c.plugin)).cloned().unwrap_or_default();
                json!({ "key": k, "exists": e.is_some(), "granted": g.allow, "reveal": g.reveal, "hosts": e.map(|e| e.hosts.clone()), "programs": e.map(|e| e.programs.clone()) })
            }).collect();
            ok(json!({ "items": items }))
        })),
        // valor cru: só um servidor de plugin (token do processo) com "pode ver o valor"
        ("vault/reveal", route_fn(|r| async move {
            r.local_only()?;
            let c = caller(&r)?;
            let name = need_name(r.require("key")?)?;
            if !c.verified {
                audit(&c.plugin, &name, "valor", false, "pedido da página");
                return Err(fail("o valor do cofre só sai para servidores de plugin; na página, use {{vault:nome}} no fetch", 403));
            }
            let s = { let _g = LOCK.lock(); load() };
            let e = s.entries.get(&name).ok_or_else(|| fail(format!("\"{name}\" não está no cofre"), 404))?;
            if !e.grants.get(&c.plugin).is_some_and(|g| g.reveal) {
                audit(&c.plugin, &name, "valor", false, "sem permissão para ver o valor");
                return Err(fail(format!("o plugin {} não pode ver o valor de \"{name}\"", c.plugin), 403));
            }
            let v = unseal(&e.value).ok_or_else(|| fail("não deu para decifrar", 500))?;
            audit(&c.plugin, &name, "valor", true, "");
            ok(json!({ "value": v }))
        })),
    ]
}

/// Ações da tela do cofre. As que ampliam acesso passam pela confirmação nativa; restringir ou apagar, não.
///   paste   { name, label, note, hosts, programs, clear }   grava o texto da área de transferência
///   edit    { name, label, note, hosts, programs }          muda os dados (sites/programas novos pedem confirmação)
///   grant   { name, plugin, use, reveal }                    libera ou tira um plugin
///   delete  { name }
async fn manage(r: &Req) -> ApiResult<()> {
    let b: Value = r.body_json()?;
    let name = need_name(b["name"].as_str().unwrap_or("").trim())?;
    let cur = { let _g = LOCK.lock(); load() }.entries.get(&name).cloned();
    match b["action"].as_str().unwrap_or("") {
        "paste" => {
            let clear = b["clear"].as_bool().unwrap_or(true);
            let text = tokio::task::spawn_blocking(move || clipboard_text(false)).await.ok().flatten().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
                .ok_or_else(|| fail("a área de transferência está vazia (copie o token antes)", 400))?;
            if text.chars().count() > 16_384 { return Err(fail("texto grande demais para um segredo", 400)); }
            let hint: String = if text.chars().count() >= 16 { text.chars().take(4).collect() } else { String::new() };
            let (hosts, programs) = (list_of(&b["hosts"]), list_of(&b["programs"]));
            let dest = if hosts.is_empty() { "nenhum site ainda".to_string() } else { hosts.join(", ") };
            let shown = if hint.is_empty() { format!("{} caracteres", text.chars().count()) } else { format!("{} caracteres, começa com \"{hint}\"", text.chars().count()) };
            confirm(format!("{} \"{name}\" no cofre com o texto da área de transferência ({shown})?\n\nPode ir para: {}\nProgramas: {}{}",
                if cur.is_some() { "Trocar o valor de" } else { "Guardar" },
                dest,
                if programs.is_empty() { "nenhum".to_string() } else { programs.join(", ") },
                if clear { "\n\nA área de transferência será limpa." } else { "" })).await?;
            let sealed = seal(&text)?;
            let len = text.chars().count();
            drop(text);
            edit(|s| {
                let e = s.entries.entry(name.clone()).or_insert_with(|| Entry { created: now(), ..Default::default() });
                e.value = sealed; e.hint = hint; e.length = len; e.updated = now();
                if let Some(l) = b["label"].as_str() { e.label = l.trim().into(); }
                if let Some(n) = b["note"].as_str() { e.note = n.trim().into(); }
                if !b["hosts"].is_null() { e.hosts = hosts; }
                if !b["programs"].is_null() { e.programs = programs; }
                Ok(())
            })?;
            if clear { let _ = tokio::task::spawn_blocking(|| clipboard_text(true)).await; }
            log(format!("cofre: \"{name}\" gravado"));
        }
        "edit" => {
            let cur = cur.ok_or_else(|| fail(format!("\"{name}\" não está no cofre"), 404))?;
            let hosts = if b["hosts"].is_null() { cur.hosts.clone() } else { list_of(&b["hosts"]) };
            let programs = if b["programs"].is_null() { cur.programs.clone() } else { list_of(&b["programs"]) };
            let new_hosts: Vec<&String> = hosts.iter().filter(|h| !cur.hosts.contains(h)).collect();
            let new_progs: Vec<&String> = programs.iter().filter(|p| !cur.programs.contains(p)).collect();
            if !new_hosts.is_empty() || !new_progs.is_empty() {
                let mut t = format!("Liberar \"{name}\" para mais destinos?\n");
                if !new_hosts.is_empty() { t += &format!("\nSites novos: {}", new_hosts.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")); }
                if !new_progs.is_empty() { t += &format!("\nProgramas novos: {}", new_progs.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")); }
                let users: Vec<String> = cur.grants.iter().filter(|(_, g)| g.allow).map(|(p, _)| plugin_name(p)).collect();
                if !users.is_empty() { t += &format!("\n\nPlugins que usam este segredo: {}", users.join(", ")); }
                confirm(t).await?;
            }
            edit(|s| {
                let e = s.entries.get_mut(&name).ok_or_else(|| fail("sumiu", 404))?;
                e.hosts = hosts; e.programs = programs; e.updated = now();
                if let Some(l) = b["label"].as_str() { e.label = l.trim().into(); }
                if let Some(n) = b["note"].as_str() { e.note = n.trim().into(); }
                Ok(())
            })?;
        }
        "grant" => {
            let cur = cur.ok_or_else(|| fail(format!("\"{name}\" não está no cofre"), 404))?;
            let plugin = b["plugin"].as_str().filter(|p| bluescreen_sdk::store::valid_id(p)).ok_or_else(|| fail("plugin obrigatório", 400))?.to_string();
            let old = cur.grants.get(&plugin).cloned().unwrap_or_default();
            let allow = b["use"].as_bool().unwrap_or(old.allow);
            let reveal = b["reveal"].as_bool().unwrap_or(old.reveal);
            if (allow && !old.allow) || (reveal && !old.reveal) {
                let pname = plugin_name(&plugin);
                let dest = if cur.hosts.is_empty() { "nenhum site liberado ainda".to_string() } else { cur.hosts.join(", ") };
                let t = if reveal && !old.reveal {
                    format!("Deixar o plugin \"{pname}\" VER o valor de \"{name}\"?\n\nCom isso o plugin pode copiar o token e mandá-lo para qualquer lugar. Só permita para plugins em que você confia.")
                } else {
                    format!("Permitir que o plugin \"{pname}\" use \"{name}\"?\n\nO plugin não vê o valor: o BlueScreen o coloca nos pedidos.\nPode ir para: {dest}\nProgramas: {}", if cur.programs.is_empty() { "nenhum".into() } else { cur.programs.join(", ") })
                };
                confirm(t).await?;
            }
            edit(|s| {
                let e = s.entries.get_mut(&name).ok_or_else(|| fail("sumiu", 404))?;
                if !allow && !reveal { e.grants.remove(&plugin); } else { e.grants.insert(plugin.clone(), Grant { allow, reveal }); }
                Ok(())
            })?;
            log(format!("cofre: \"{name}\" para {plugin}: usar={allow} ver={reveal}"));
        }
        "delete" => { edit(|s| { s.entries.remove(&name); Ok(()) })?; log(format!("cofre: \"{name}\" apagado")); }
        a => return Err(fail(format!("ação desconhecida: {a}"), 400)),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hosts() {
        assert!(host_ok("api.github.com", "API.github.com"));
        assert!(host_ok("*.atlassian.net", "acme.atlassian.net") && host_ok("*.atlassian.net", "atlassian.net"));
        assert!(!host_ok("*.atlassian.net", "atlassian.net.evil.com") && !host_ok("github.com", "api.github.com"));
        assert_eq!(list_of(&json!("https://api.github.com/, *.x.com;gh")), vec!["*.x.com", "api.github.com", "gh"]);
        assert_eq!(scrub("token=abcd1234 ok", &["abcd1234".into()]), "token=•••••• ok");
    }
}
