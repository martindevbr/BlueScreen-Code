//! Sistema de plugins.
//! Um plugin é uma pasta em plugins/ (do app) ou em ~/.bluescreen/plugins/ (do usuário) com:
//!   plugin.json  manifesto: { id, name, description, version, order, requires, hooks }
//!                `hooks` liga pontos de extensão do núcleo a rotas do plugin, ex.: { "build.info": "meu/build-info" }.
//!                O núcleo chama a rota (POST, como chamada interna) e usa o que ela devolver; ele não conhece o plugin.
//!   ui.js        opcional: roda na página, dentro de function (bs, plugin) { ... }; enxerga tudo do núcleo (S, api, $, esc...)
//!   style.css    opcional: injetado na página junto com o ui.js
//!   server.exe   opcional: servidor do plugin, um programa à parte (veja `external` e o SDK). O BlueScreen o inicia
//!                quando o plugin está ligado e encaminha as rotas dele; desligar o plugin encerra o processo.
//! Nenhum plugin é compilado no núcleo: trocar ou remover um plugin nunca exige recompilar o BlueScreen.
//! A pasta do usuário ganha da pasta do app.
use crate::util::*;
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

mod external;
pub mod remote;
pub use bluescreen_sdk::plugin::{Reply, Req, RouteFn, ok, path_str, project_of, route_fn};

#[derive(Serialize, Clone, Default)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub order: f64,
    pub requires: Vec<String>,
    pub author: String,
    /// ponto de extensão do núcleo -> rota do plugin
    pub hooks: BTreeMap<String, String>,
}
#[derive(Serialize, Clone)]
pub struct PluginStatus {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    /// "process" (tem server.exe) ou "ui" (só interface)
    pub kind: &'static str,
    pub path: String,
    pub enabled: bool,
    pub error: Option<String>,
    pub ui: bool,
    pub server: bool,
    pub order: f64,
    pub requires: Vec<String>,
    pub routes: Vec<String>,
    pub hooks: BTreeMap<String, String>,
    /// instalado de um servidor de plugins: { server, version, sha256, installed } (.origin.json na pasta)
    pub origin: Value,
    /// está na pasta do usuário (~/.bluescreen/plugins), que é onde os servidores de plugins instalam
    pub user: bool,
}

#[derive(Default)]
pub struct Registry {
    pub routes: HashMap<String, RouteFn>,
    pub ui: HashMap<String, (String, String)>,
    pub list: Vec<PluginStatus>,
    /// ganchos dos plugins ativos, na ordem dos plugins: (ponto de extensão, id do plugin, rota)
    pub hooks: Vec<(String, String, String)>,
    /// processos dos plugins com servidor próprio; saem quando o registro é trocado (recarregar/desligar)
    _procs: Vec<external::Running>,
}

pub fn dirs() -> Vec<PathBuf> { vec![app_dir().join("plugins"), user_dir().join("plugins")] }
pub fn config_file() -> PathBuf { user_dir().join("plugins.json") }
/// ~/.bluescreen/plugins.json: { disabled: [ids], servers: [{ url }] }
pub fn config() -> Value { match read_json(&config_file()) { v @ Value::Object(_) => v, _ => json!({}) } }
pub fn save_config(f: impl FnOnce(&mut serde_json::Map<String, Value>)) {
    let mut v = config();
    if let Some(o) = v.as_object_mut() { f(o); }
    let _ = write_atomic(&config_file(), &serde_json::to_string_pretty(&v).unwrap_or_default());
}
fn disabled() -> HashSet<String> {
    config()["disabled"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

struct Entry { manifest: Manifest, path: PathBuf, rank: usize, broken: Option<String> }
fn norm_manifest(m: &Value, fallback: &str) -> anyhow::Result<Manifest> {
    let id = m["id"].as_str().unwrap_or(fallback).trim().to_string();
    let ok = !id.is_empty() && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok { anyhow::bail!("id de plugin inválido: \"{id}\""); }
    Ok(Manifest {
        name: m["name"].as_str().unwrap_or(&id).into(),
        description: m["description"].as_str().unwrap_or("").into(),
        version: m["version"].as_str().unwrap_or("0.0.0").into(),
        order: m["order"].as_f64().unwrap_or(100.0),
        requires: m["requires"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
        author: m["author"].as_str().unwrap_or("").into(),
        hooks: m["hooks"].as_object().map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|r| (k.clone(), r.trim_start_matches('/').trim_start_matches("api/").to_string()))).collect()).unwrap_or_default(),
        id,
    })
}
fn discover() -> Vec<Entry> {
    let mut found: HashMap<String, Entry> = HashMap::new();
    // a pasta do usuário nasce vazia: sem ela, "Abrir a pasta dos seus plugins" não tem o que abrir
    let _ = std::fs::create_dir_all(user_dir().join("plugins"));
    for (rank, dir) in dirs().iter().enumerate() {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        for e in rd.flatten() {
            if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let mf = e.path().join("plugin.json");
            if !mf.exists() { continue; }
            let name = e.file_name().to_string_lossy().to_string();
            let entry = match std::fs::read_to_string(&mf).map_err(anyhow::Error::from)
                .and_then(|s| serde_json::from_str::<Value>(&s).map_err(|er| anyhow::anyhow!("plugin.json inválido: {er}")))
                .and_then(|v| norm_manifest(&v, &name)) {
                Ok(m) => Entry { manifest: m, path: e.path(), rank, broken: None },
                // manifesto quebrado: aparece na lista com erro, para o usuário ver
                Err(er) => Entry { manifest: Manifest { id: name.clone(), name: name.clone(), order: 999.0, ..Default::default() }, path: e.path(), rank, broken: Some(er.to_string()) },
            };
            let id = entry.manifest.id.clone();
            if found.get(&id).is_none_or(|c| entry.rank >= c.rank) { found.insert(id, entry); }
        }
    }
    let mut v: Vec<Entry> = found.into_values().collect();
    v.sort_by(|a, b| a.manifest.order.total_cmp(&b.manifest.order).then(a.manifest.id.cmp(&b.manifest.id)));
    v
}

/// Registro vivo: trocado inteiro quando os plugins são recarregados (ligar/desligar).
pub struct Host {
    current: RwLock<Arc<Registry>>,
    core: Arc<HashMap<String, RouteFn>>,
}
impl Host {
    pub fn new(core: HashMap<String, RouteFn>) -> Self {
        let h = Host { current: RwLock::new(Arc::new(Registry::default())), core: Arc::new(core) };
        h.load();
        h
    }
    pub fn get(&self) -> Arc<Registry> { self.current.read().clone() }
    pub fn core(&self) -> &HashMap<String, RouteFn> { &self.core }
    pub fn load(&self) { self.load_skip(None) }
    /// Recarrega sem um plugin: o processo dele sai e a pasta fica livre (para instalar uma versão nova por cima).
    pub fn unload(&self, id: &str) { self.load_skip(Some(id)) }
    fn load_skip(&self, skip: Option<&str>) {
        let mut reg = Registry::default();
        let off = disabled();
        let entries = discover();
        let ids: HashSet<String> = entries.iter().map(|e| e.manifest.id.clone()).collect();
        let mut active: HashSet<String> = HashSet::new();
        for e in entries {
            let m = e.manifest.clone();
            if skip == Some(m.id.as_str()) { continue; }
            let exe = external::server_exe(&e.path, &m.id);
            let mut st = PluginStatus {
                id: m.id.clone(), name: m.name.clone(), version: m.version.clone(), description: m.description.clone(), author: m.author.clone(),
                kind: if exe.is_some() { "process" } else { "ui" }, path: e.path.to_string_lossy().into(), enabled: !off.contains(&m.id),
                error: None, ui: false, server: exe.is_some(), order: m.order, requires: m.requires.clone(), routes: vec![], hooks: m.hooks.clone(),
                origin: read_json(&e.path.join(".origin.json")), user: e.rank == 1,
            };
            if !st.enabled { reg.list.push(st); continue; }
            if let Some(b) = &e.broken { st.error = Some(b.clone()); reg.list.push(st); continue; }
            let missing: Vec<&String> = m.requires.iter().filter(|r| !active.contains(*r)).collect();
            if !missing.is_empty() {
                let first = missing[0].clone();
                st.error = Some(format!("precisa do plugin {}{}", missing.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "), if ids.contains(&first) { " (desligado ou com erro)" } else { " (não instalado)" }));
                reg.list.push(st); continue;
            }
            // servidor próprio: inicia o programa e encaminha as rotas que ele anunciar
            if let Some(exe) = &exe {
                match external::start(&m.id, &e.path, exe) {
                    Ok(run) => {
                        for r in &run.routes { reg.routes.insert(r.clone(), external::proxy(m.id.clone(), run.port, r.clone())); }
                        st.routes = run.routes.clone();
                        reg._procs.push(run);
                    }
                    Err(er) => { log(format!("plugin {} falhou: {er}", m.id)); st.error = Some(er.to_string()); reg.list.push(st); continue; }
                }
            }
            let ui = std::fs::read_to_string(e.path.join("ui.js")).unwrap_or_default();
            let css = std::fs::read_to_string(e.path.join("style.css")).unwrap_or_default();
            st.ui = !ui.is_empty() || !css.is_empty();
            if st.ui { reg.ui.insert(m.id.clone(), (ui, css)); }
            // só vale gancho que aponta para uma rota que o plugin realmente atende
            for (hook, route) in &m.hooks {
                if reg.routes.contains_key(route) { reg.hooks.push((hook.clone(), m.id.clone(), route.clone())); }
                else { log(format!("plugin {}: gancho {hook} aponta para a rota {route}, que o plugin não atende", m.id)); }
            }
            active.insert(m.id.clone());
            reg.list.push(st);
        }
        *self.current.write() = Arc::new(reg);
    }
    /// Plugins ativos inscritos num ponto de extensão: (id do plugin, rota).
    pub fn hooks(&self, name: &str) -> Vec<(String, String)> {
        self.get().hooks.iter().filter(|(h, _, _)| h == name).map(|(_, id, r)| (id.clone(), r.clone())).collect()
    }
    pub fn set_enabled(&self, id: &str, on: bool) {
        let mut set = disabled();
        if on { set.remove(id); } else { set.insert(id.to_string()); }
        let mut v: Vec<String> = set.into_iter().collect(); v.sort();
        save_config(|c| { c.insert("disabled".into(), json!(v)); });
        self.load();
    }
    /// ui.js + style.css de um plugin, servidos como um único script.
    pub fn bundle(&self, id: &str) -> Option<String> {
        let reg = self.get();
        let (ui, css) = reg.ui.get(id)?;
        let js = |s: &str| serde_json::to_string(s).unwrap_or_default();
        Some(format!("/* BlueScreen: plugin {id} */\n(function(){{\n'use strict';\nvar css={};\nif(css){{var s=document.createElement('style');s.dataset.plugin={};s.textContent=css;document.head.appendChild(s);}}\nBS.define({}, function(bs, plugin){{\n{ui}\n}});\n}})();\n", js(css), js(id), js(id)))
    }
    pub fn print(&self) {
        for p in &self.get().list {
            log(format!("plugin {} v{}: {}", p.id, p.version, match (&p.error, p.enabled) { (Some(e), _) => format!("ERRO: {e}"), (None, true) => "ligado".into(), _ => "desligado".into() }));
        }
    }
}
