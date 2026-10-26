//! Git e SVN: projetos, resumo, alterações, histórico, diff e o código que a cópia local representa.
use crate::util::*;
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

#[derive(Serialize, Clone, Debug)]
pub struct Commit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub hash: String,
    pub author: String,
    pub when: String,
    pub subject: String,
    /// data do commit (segundos unix): o Histórico agrupa por dia
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts: Option<i64>,
    /// histórico de um arquivo: o caminho dele naquele commit (muda quando o arquivo foi renomeado)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
#[derive(Serialize)]
pub struct ProjectInfo { pub name: String, pub path: String, pub vcs: Option<&'static str>, pub mtime: f64 }
#[derive(Serialize)]
pub struct Summary { pub vcs: Option<&'static str>, pub dirty: usize, pub branch: String, pub last: Option<Commit> }
#[derive(Serialize, Clone)]
pub struct ChangedFile {
    pub path: String,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub add: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub del: Option<i64>,
}
#[derive(Serialize, Clone)]
pub struct Changes {
    pub vcs: Option<&'static str>,
    pub files: Vec<ChangedFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rev: Option<String>,
}
#[derive(Serialize, Clone)]
pub struct DiffPair { pub original: String, pub modified: String }

pub async fn git(cwd: &Path, a: &[&str]) -> ProcResult {
    let mut v = vec!["-c", "core.quotepath=off"];
    v.extend_from_slice(a);
    run("git", &v, cwd, 20000).await
}
pub async fn git_t(cwd: &Path, a: &[&str], timeout_ms: u64) -> ProcResult {
    let mut v = vec!["-c", "core.quotepath=off"];
    v.extend_from_slice(a);
    run("git", &v, cwd, timeout_ms).await
}
pub async fn svn(cwd: &Path, a: &[&str]) -> ProcResult { svn_t(cwd, a, 20000).await }
pub async fn svn_t(cwd: &Path, a: &[&str], timeout_ms: u64) -> ProcResult {
    let mut v = vec!["--non-interactive"];
    v.extend_from_slice(a);
    run("svn", &v, cwd, timeout_ms).await
}

pub fn here(dir: &Path) -> Option<&'static str> {
    if dir.join(".git").exists() { return Some("git"); }
    if dir.join(".svn").is_dir() { return Some("svn"); }
    None
}
static DETECT: LazyLock<TtlCache<PathBuf, Option<&'static str>>> = LazyLock::new(|| TtlCache::new(Duration::from_secs(10)));
/// Sobe até a raiz do checkout: uma subpasta de um working copy também é um projeto versionado.
pub fn detect(dir: &Path) -> Option<&'static str> {
    let start = absolute(dir);
    if let Some(v) = DETECT.get(&start) { return v; }
    let mut cur = Some(start.as_path());
    let mut found = None;
    for _ in 0..40 {
        let Some(c) = cur else { break };
        found = here(c);
        if found.is_some() { break; }
        cur = c.parent();
    }
    DETECT.set(start, found);
    found
}

static PREFIX: LazyLock<TtlCache<PathBuf, String>> = LazyLock::new(|| TtlCache::new(Duration::from_secs(30)));
/// Prefixo da pasta dentro do repositório git ("" na raiz, "sub/dir/" numa subpasta).
pub async fn git_prefix(dir: &Path) -> String {
    if let Some(p) = PREFIX.get(&dir.to_path_buf()) { return p; }
    let r = git(dir, &["rev-parse", "--show-prefix"]).await;
    let p = if r.ok { r.out.trim().trim_start_matches('/').to_string() } else { String::new() };
    PREFIX.set(dir.to_path_buf(), p.clone());
    p
}
fn strip_prefix(p: &str, pre: &str) -> Option<String> {
    if pre.is_empty() { Some(p.to_string()) } else { p.strip_prefix(pre).map(str::to_string) }
}
fn unquote(p: &str) -> &str { if p.len() > 1 && p.starts_with('"') && p.ends_with('"') { &p[1..p.len() - 1] } else { p } }

// ---------- projetos ----------
pub fn list_projects(root: &Path) -> std::io::Result<Vec<ProjectInfo>> {
    let dirs: Vec<_> = std::fs::read_dir(root)?.flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| { let n = e.file_name().to_string_lossy().to_string(); !n.starts_with('.') && !IGNORED_DIRS.contains(n.as_str()) })
        .collect();
    let mut out: Vec<ProjectInfo> = dirs.par_iter().map(|e| {
        let p = e.path();
        let mtime = e.metadata().and_then(|m| m.modified()).map(mtime_ms).unwrap_or(0.0);
        ProjectInfo { name: e.file_name().to_string_lossy().into(), path: p.to_string_lossy().into(), vcs: detect(&p), mtime }
    }).collect();
    out.sort_by(|a, b| b.mtime.total_cmp(&a.mtime));
    Ok(out)
}

pub async fn summary(dir: &Path) -> Summary {
    match detect(dir) {
        Some("git") => {
            let (st, lg, br) = tokio::join!(
                git(dir, &["status", "--porcelain", "--", "."]),
                git(dir, &["log", "-1", "--format=%h%x1f%an%x1f%ct%x1f%s", "--", "."]),
                git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]),
            );
            let dirty = st.out.lines().filter(|l| !l.is_empty()).count();
            let f: Vec<&str> = lg.out.trim().split('\x1f').collect();
            let last = (lg.ok && f.len() >= 4 && !f[0].is_empty()).then(|| Commit { id: None, hash: f[0].into(), author: f[1].into(), when: rel_time_unix(f[2]), subject: f[3].into(), ts: f[2].trim().parse().ok(), path: None });
            Summary { vcs: Some("git"), dirty, branch: br.out.trim().into(), last }
        }
        Some("svn") => {
            let (st, info) = tokio::join!(svn(dir, &["status", "-q"]), svn(dir, &["info", "--show-item", "last-changed-revision"]));
            let dirty = st.out.lines().filter(|l| !l.trim().is_empty()).count();
            let rev = info.out.trim().to_string();
            let mut last = None;
            if !rev.is_empty() {
                let lg = svn(dir, &["log", "-r", &rev, "--xml"]).await;
                last = parse_svn_log(&lg.out).into_iter().next().map(|mut c| { c.hash = format!("r{}", c.hash); c });
            }
            Summary { vcs: Some("svn"), dirty, branch: String::new(), last }
        }
        _ => Summary { vcs: None, dirty: 0, branch: String::new(), last: None },
    }
}

static LOG_ENTRY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<logentry\s+revision="(\d+)">([\s\S]*?)</logentry>"#).unwrap());
static LOG_AUTHOR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<author>([\s\S]*?)</author>").unwrap());
static LOG_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<date>([\s\S]*?)</date>").unwrap());
static LOG_MSG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<msg>([\s\S]*?)</msg>").unwrap());
pub fn parse_svn_log(xml: &str) -> Vec<Commit> {
    let tag = |re: &Regex, body: &str| re.captures(body).map(|c| html_unescape(&c[1])).unwrap_or_default();
    LOG_ENTRY.captures_iter(xml).map(|m| {
        let body = &m[2];
        let date = tag(&LOG_DATE, body);
        Commit { id: None, hash: m[1].into(), author: tag(&LOG_AUTHOR, body), when: if date.is_empty() { String::new() } else { rel_time_iso(&date) }, subject: tag(&LOG_MSG, body).lines().next().unwrap_or("").into(), ts: iso_ms(&date).map(|ms| (ms / 1000.0) as i64), path: None }
    }).collect()
}

// ---------- alterações / log / diff ----------
// arquivo novo (não versionado) dentro de saída de build (target/, node_modules/...): não conta como alteração
fn is_build_output(f: &ChangedFile) -> bool { (f.code == "?" || f.code == "I") && f.path.split('/').any(|s| IGNORED_DIRS.contains(s)) }
fn apply_numstat(files: &mut [ChangedFile], out: &str, pre: &str) {
    let mut stat = std::collections::HashMap::new();
    for l in out.lines() {
        let parts: Vec<&str> = l.split('\t').collect();
        if parts.len() < 3 || parts[2].is_empty() { continue; }
        if let Some(q) = strip_prefix(unquote(parts[2]), pre) { stat.insert(q, (parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(0))); }
    }
    for f in files.iter_mut() { if let Some(&(a, d)) = stat.get(&f.path) { f.add = Some(a); f.del = Some(d); } }
}

pub async fn changes(dir: &Path, mode: &str, rev: Option<&str>, base: Option<&str>) -> Changes {
    let vcs = detect(dir);
    match vcs {
        None => Changes { vcs, files: vec![], rev: None },
        Some("git") => {
            let pre = git_prefix(dir).await;
            if mode == "working" {
                let (st, ns) = tokio::join!(git(dir, &["status", "--porcelain", "-uall", "--", "."]), git(dir, &["diff", "--numstat", "HEAD", "--", "."]));
                let mut files = Vec::new();
                for l in st.out.lines() {
                    if l.len() < 4 { continue; }
                    let b = l.as_bytes(); let (x, y) = (b[0] as char, b[1] as char);
                    let mut p = &l[3..];
                    if let Some(i) = p.find(" -> ") { p = &p[i + 4..]; }
                    let Some(q) = strip_prefix(unquote(p), &pre) else { continue };
                    let code = if x == '?' { "?".to_string() } else if y != ' ' { y.to_string() } else { x.to_string() };
                    let f = ChangedFile { path: q, code, staged: Some(x != ' ' && x != '?'), add: None, del: None };
                    if !is_build_output(&f) { files.push(f); }
                }
                apply_numstat(&mut files, &ns.out, &pre);
                return Changes { vcs, files, rev: None };
            }
            if mode == "range" { return compare(dir, base.unwrap_or("HEAD"), rev).await; }
            let target = rev.filter(|r| !r.is_empty()).unwrap_or("HEAD").to_string();
            let key = format!("{}|{target}", dir.display());
            if fixed(&target) && let Some(c) = CHANGES.lock().get(&key) { return c; }
            // um processo só: o hash (%H), a lista com o tipo da mudança (--raw) e as linhas (--numstat)
            let r = git(dir, &["show", "--format=%H", "--raw", "--numstat", "-m", "--first-parent", &target, "--", "."]).await;
            let hash = r.out.lines().next().map(str::trim).filter(|h| fixed(h)).map(str::to_string);
            let c = Changes { vcs, files: parse_raw_numstat(&r.out, &pre), rev: Some(hash.clone().unwrap_or(target)) };
            // guardado pelo hash: o "último commit" (HEAD) de agora também serve quando ele for aberto pelo hash
            if r.ok && let Some(h) = hash { let cost = c.files.iter().map(|f| f.path.len() + 40).sum(); CHANGES.lock().put(format!("{}|{h}", dir.display()), c.clone(), cost); }
            c
        }
        Some(_) => {
            if mode == "working" {
                let st = svn(dir, &["status"]).await;
                let files = st.out.lines().filter(|l| !l.trim().is_empty() && !l.starts_with("Status against") && l.len() > 8)
                    .map(|l| ChangedFile { path: norm(l.get(8..).unwrap_or("").trim()), code: l[..1].to_string(), staged: None, add: None, del: None })
                    .filter(|f| !is_build_output(f)).collect();
                return Changes { vcs, files, rev: None };
            }
            if mode == "range" { return compare(dir, base.unwrap_or("BASE"), rev).await; }
            let t = match rev.filter(|r| !r.is_empty()) {
                Some(r) => r.to_string(),
                None => svn(dir, &["info", "--show-item", "last-changed-revision"]).await.out.trim().to_string(),
            };
            let key = format!("{}|{t}", dir.display());
            if fixed(&t) && let Some(c) = CHANGES.lock().get(&key) { return c; }
            let r = svn(dir, &["diff", "--summarize", "-c", &t]).await;
            let c = Changes { vcs, files: parse_svn_summarize(dir, &r.out), rev: Some(t.clone()) };
            if r.ok && fixed(&t) { let cost = c.files.iter().map(|f| f.path.len() + 40).sum(); CHANGES.lock().put(key, c.clone(), cost); }
            c
        }
    }
}

// ---------- o que não muda fica guardado: um commit do Git (hash) ou uma revisão do SVN é imutável ----------
// Navegar commit a commit e voltar não chama o Git/SVN de novo (no SVN, cada chamada vai ao servidor).
struct Lru<V> { map: HashMap<String, (V, usize)>, order: VecDeque<String>, bytes: usize, max: usize }
impl<V: Clone> Lru<V> {
    fn new(max: usize) -> Self { Self { map: HashMap::new(), order: VecDeque::new(), bytes: 0, max } }
    fn get(&self, k: &str) -> Option<V> { self.map.get(k).map(|(v, _)| v.clone()) }
    fn put(&mut self, k: String, v: V, cost: usize) {
        if cost > self.max / 4 { return; }
        if let Some((_, c)) = self.map.insert(k.clone(), (v, cost)) { self.bytes -= c; self.order.retain(|x| x != &k); }
        self.order.push_back(k);
        self.bytes += cost;
        while self.bytes > self.max {
            let Some(o) = self.order.pop_front() else { break };
            if let Some((_, c)) = self.map.remove(&o) { self.bytes -= c; }
        }
    }
}
static CHANGES: LazyLock<Mutex<Lru<Changes>>> = LazyLock::new(|| Mutex::new(Lru::new(8 << 20)));
static DIFFS: LazyLock<Mutex<Lru<DiffPair>>> = LazyLock::new(|| Mutex::new(Lru::new(96 << 20)));
/// hash completo do Git (SHA-1 ou SHA-256) ou número de revisão do SVN: aponta sempre para o mesmo conteúdo
fn fixed(rev: &str) -> bool {
    ((rev.len() == 40 || rev.len() == 64) && rev.bytes().all(|b| b.is_ascii_hexdigit())) || (!rev.is_empty() && rev.len() < 12 && rev.bytes().all(|b| b.is_ascii_digit()))
}

/// saída de "git show/diff --raw --numstat": ":100644 100644 a b M\tcaminho" e depois "adições\tremoções\tcaminho"
fn parse_raw_numstat(out: &str, pre: &str) -> Vec<ChangedFile> {
    let mut files: Vec<ChangedFile> = out.lines().filter(|l| l.starts_with(':')).filter_map(|l| {
        let parts: Vec<&str> = l.split('\t').collect();
        let code = parts[0].split(' ').next_back().and_then(|c| c.get(..1)).unwrap_or("M").to_string();
        strip_prefix(unquote(parts[parts.len() - 1]), pre).map(|q| ChangedFile { path: q, code, staged: None, add: None, del: None })
    }).collect();
    let ns = out.lines().filter(|l| !l.starts_with(':') && l.contains('\t')).collect::<Vec<_>>().join("\n");
    apply_numstat(&mut files, &ns, pre);
    files
}
fn parse_svn_summarize(dir: &Path, out: &str) -> Vec<ChangedFile> {
    let nd = norm(&dir.to_string_lossy()).to_lowercase();
    out.lines().filter(|l| !l.trim().is_empty() && l.len() > 8).map(|l| {
        let p = norm(l.get(8..).unwrap_or("").trim());
        let path = if p.to_lowercase().starts_with(&nd) { p[nd.len()..].trim_start_matches('/').to_string() } else { p };
        ChangedFile { path, code: l[..1].to_string(), staged: None, add: None, del: None }
    }).collect()
}

/// Comparar duas versões quaisquer: base (commit, branch, tag, revisão) contra target (outra versão ou, sem target,
/// a cópia local como está no disco).
pub async fn compare(dir: &Path, base: &str, target: Option<&str>) -> Changes {
    let target = target.filter(|t| !t.is_empty());
    let vcs = detect(dir);
    let key = format!("{}|{base}..{}", dir.display(), target.unwrap_or(""));
    let cache = fixed(base) && target.is_some_and(fixed);
    if cache && let Some(c) = CHANGES.lock().get(&key) { return c; }
    let c = match vcs {
        Some("git") => {
            let pre = git_prefix(dir).await;
            let mut a = vec!["diff", "--raw", "--numstat", base];
            if let Some(t) = target { a.push(t); }
            a.extend(["--", "."]);
            let r = git(dir, &a).await;
            Changes { vcs, files: parse_raw_numstat(&r.out, &pre), rev: target.map(str::to_string) }
        }
        Some(_) => {
            let range = match target { Some(t) => format!("{base}:{t}"), None => base.to_string() };
            let r = svn(dir, &["diff", "--summarize", "-r", &range]).await;
            Changes { vcs, files: parse_svn_summarize(dir, &r.out), rev: target.map(str::to_string) }
        }
        None => Changes { vcs, files: vec![], rev: None },
    };
    if cache { let cost = c.files.iter().map(|f| f.path.len() + 40).sum(); CHANGES.lock().put(key, c.clone(), cost); }
    c
}

pub async fn history(dir: &Path) -> Vec<Commit> { history_n(dir, 30).await }

/// os `n` commits mais recentes (a aba Alterações pede mais conforme se navega para trás)
pub async fn history_n(dir: &Path, n: usize) -> Vec<Commit> { history_of(dir, n, None).await }

/// histórico do projeto ou, com `file`, só dos commits que mexeram nesse arquivo (seguindo renomeações no Git)
pub async fn history_of(dir: &Path, n: usize, file: Option<&str>) -> Vec<Commit> {
    let n = n.clamp(1, 5000).to_string();
    let file = file.filter(|f| !f.is_empty());
    match detect(dir) {
        Some("git") => {
            let mut a = vec!["log", "-n", &n, "--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s"];
            match file { Some(f) => a.extend(["--follow", "--name-only", "--", f]), None => a.extend(["--", "."]) }
            let (r, pre) = tokio::join!(git(dir, &a), git_prefix(dir));
            let mut out: Vec<Commit> = Vec::new();
            for l in r.out.lines() {
                let f: Vec<&str> = l.split('').collect();
                if f.len() >= 5 { out.push(Commit { id: Some(f[0].into()), hash: f[1].into(), author: f[2].into(), when: rel_time_unix(f[3]), subject: f[4].into(), ts: f[3].trim().parse().ok(), path: None }); }
                // --name-only: o caminho (a partir da raiz do repositório) vem nas linhas depois do commit
                else if !l.trim().is_empty() && let Some(c) = out.last_mut() { c.path = strip_prefix(unquote(l.trim()), &pre); }
            }
            out
        }
        Some("svn") => {
            let mut a = vec!["log", "-l", &n, "--xml"];
            if let Some(f) = file { a.push(f); }
            let r = svn(dir, &a).await;
            parse_svn_log(&r.out).into_iter().map(|mut c| { c.id = Some(c.hash.clone()); c.hash = format!("r{}", c.hash); c }).collect()
        }
        _ => vec![],
    }
}

/// mode: "working" (último commit x disco), "last" (commit `rev` x o anterior a ele) ou "range" (`base` x `rev`;
/// sem `rev`, o disco)
pub async fn diff(dir: &Path, file: &str, mode: &str, rev: Option<&str>, base: Option<&str>) -> DiffPair {
    let rev = rev.filter(|r| !r.is_empty());
    let base = base.filter(|b| !b.is_empty());
    // as duas versões são imutáveis: guarda (o mesmo diff aberto de novo, ou pré-carregado pela interface)
    let key = match (mode, rev, base) {
        ("last", Some(r), _) if fixed(r) => Some(format!("{}|{r}|{file}", dir.display())),
        ("range", Some(r), Some(b)) if fixed(r) && fixed(b) => Some(format!("{}|{b}..{r}|{file}", dir.display())),
        _ => None,
    };
    if let Some(k) = &key && let Some(d) = DIFFS.lock().get(k) { return d; }
    let d = diff_uncached(dir, file, mode, rev, base).await;
    if let Some(k) = key { let cost = d.original.len() + d.modified.len() + 64; DIFFS.lock().put(k, d.clone(), cost); }
    d
}
async fn diff_uncached(dir: &Path, file: &str, mode: &str, rev: Option<&str>, base: Option<&str>) -> DiffPair {
    let abs = dir.join(file);
    let disk = || async { tokio::fs::read(&abs).await.map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default() };
    match detect(dir) {
        Some("git") => {
            let pre = git_prefix(dir).await;
            let nf = norm(file);
            let show = |spec: String| { let pre = pre.clone(); let nf = nf.clone(); async move {
                let r = git(dir, &["show", &format!("{spec}:{pre}{nf}")]).await;
                if r.ok { r.out } else { String::new() }
            } };
            if mode == "working" { let (a, b) = tokio::join!(show("HEAD".into()), disk()); return DiffPair { original: a, modified: b }; }
            if mode == "range" {
                let b = base.unwrap_or("HEAD").to_string();
                let (a, m) = match rev { Some(t) => tokio::join!(show(b), show(t.to_string())), None => { let (a, m) = tokio::join!(show(b), disk()); (a, m) } };
                return DiffPair { original: a, modified: m };
            }
            let t = rev.unwrap_or("HEAD").to_string();
            let (a, b) = tokio::join!(show(format!("{t}~1")), show(t.clone()));
            DiffPair { original: a, modified: b }
        }
        Some("svn") => {
            let cat = |r: String| async move { let x = svn(dir, &["cat", "-r", &r, file]).await; if x.ok { x.out } else { String::new() } };
            if mode == "working" { let (a, b) = tokio::join!(cat("BASE".into()), disk()); return DiffPair { original: a, modified: b }; }
            if mode == "range" {
                let b = base.unwrap_or("BASE").to_string();
                let (a, m) = match rev { Some(t) => tokio::join!(cat(b), cat(t.to_string())), None => { let (a, m) = tokio::join!(cat(b), disk()); (a, m) } };
                return DiffPair { original: a, modified: m };
            }
            let t = match rev {
                Some(r) => r.to_string(),
                None => svn(dir, &["info", "--show-item", "last-changed-revision"]).await.out.trim().to_string(),
            };
            let n: i64 = t.parse().unwrap_or(0);
            let (a, b) = tokio::join!(cat((n - 1).to_string()), cat(t.clone()));
            DiffPair { original: a, modified: b }
        }
        _ => DiffPair { original: String::new(), modified: disk().await },
    }
}

// ---------- quem mudou esta linha ----------
#[derive(Serialize)]
pub struct Blame {
    /// o commit que deixou a linha como está (None: ainda não commitada)
    pub commit: Option<Commit>,
    /// número da linha naquele commit (para abrir o diff dele no lugar certo)
    pub line: usize,
}
static SVN_BLAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<entry\s+line-number="(\d+)">\s*(?:<commit\s+revision="(\d+)">)?"#).unwrap());
/// `contents`: o texto do editor (com edições ainda não salvas), para a linha bater com a que você está vendo
pub async fn blame(dir: &Path, file: &str, line: usize, contents: Option<&str>) -> Blame {
    let line = line.max(1);
    match detect(dir) {
        Some("git") => {
            let tmp = contents.and_then(|c| {
                let p = std::env::temp_dir().join(format!("bs-blame-{}-{}", std::process::id(), now_ms() as u64));
                std::fs::write(&p, c).is_ok().then_some(p)
            });
            let tp = tmp.as_ref().map(|p| p.to_string_lossy().to_string());
            let l = format!("{line},{line}");
            let mut a = vec!["blame", "--porcelain", "-L", &l];
            if let Some(t) = &tp { a.extend(["--contents", t.as_str()]); }
            a.extend(["--", file]);
            let r = git(dir, &a).await;
            if let Some(p) = tmp { let _ = std::fs::remove_file(p); }
            let mut it = r.out.lines();
            let Some(first) = it.next() else { return Blame { commit: None, line } };
            let mut f = first.split(' ');
            let id = f.next().unwrap_or("").to_string();
            let orig: usize = f.next().and_then(|x| x.parse().ok()).unwrap_or(line);
            if id.is_empty() || id.bytes().all(|b| b == b'0') { return Blame { commit: None, line }; }
            let (mut author, mut ts, mut subject) = (String::new(), String::new(), String::new());
            for l in it {
                if let Some(v) = l.strip_prefix("author ") { author = v.into(); }
                else if let Some(v) = l.strip_prefix("author-time ") { ts = v.into(); }
                else if let Some(v) = l.strip_prefix("summary ") { subject = v.into(); }
                else if l.starts_with('\t') { break; }
            }
            let c = Commit { hash: id[..id.len().min(7)].into(), id: Some(id), author, when: rel_time_unix(&ts), subject, ts: ts.trim().parse().ok(), path: None };
            Blame { commit: Some(c), line: orig }
        }
        Some("svn") => {
            let r = svn(dir, &["blame", "--xml", file]).await;
            let rev = SVN_BLAME.captures_iter(&r.out).find(|c| c[1].parse::<usize>().ok() == Some(line)).and_then(|c| c.get(2).map(|m| m.as_str().to_string()));
            let Some(rev) = rev else { return Blame { commit: None, line } };
            let lg = svn(dir, &["log", "-r", &rev, "--xml"]).await;
            let c = parse_svn_log(&lg.out).into_iter().next().map(|mut c| { c.id = Some(c.hash.clone()); c.hash = format!("r{}", c.hash); c });
            Blame { commit: c, line }
        }
        _ => Blame { commit: None, line },
    }
}

static SVN_BRANCH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/(trunk|branches/[^/]+|tags/[^/]+)(/|$)").unwrap());
/// Qual código a cópia local representa (trunk, branch, revisão).
pub async fn local_ref(dir: &Path, vcs: Option<&str>) -> serde_json::Value {
    match vcs {
        Some("git") => { let r = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]).await; serde_json::json!({ "branch": r.out.trim() }) }
        Some("svn") => {
            let (u, rv) = tokio::join!(svn(dir, &["info", "--show-item", "url"]), svn(dir, &["info", "--show-item", "revision"]));
            let url = u.out.trim();
            let branch = SVN_BRANCH.captures(url).map(|c| c[1].trim_start_matches("branches/").trim_start_matches("tags/").to_string()).unwrap_or_default();
            let rev = rv.out.trim();
            serde_json::json!({ "branch": branch, "rev": if rev.is_empty() { String::new() } else { format!("r{rev}") }, "url": url })
        }
        _ => serde_json::json!({}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_e_numstat_de_um_processo_so() {
        let out = "a7a487c74e44859aa703ac41f9724ed195abecd0\n\n:100644 100644 1111111 2222222 M\tsub/a.rs\n:000000 100644 0000000 3333333 A\tsub/novo.txt\n:100644 100644 4444444 5555555 R087\tsub/velho.js\tsub/renomeado.js\n:100644 000000 6666666 0000000 D\tfora.md\n3\t1\tsub/a.rs\n10\t0\tsub/novo.txt\n-\t-\tsub/img.png\n";
        let f = parse_raw_numstat(out, "sub/");
        let got: Vec<(&str, &str, Option<i64>)> = f.iter().map(|x| (x.path.as_str(), x.code.as_str(), x.add)).collect();
        assert_eq!(got, vec![("a.rs", "M", Some(3)), ("novo.txt", "A", Some(10)), ("renomeado.js", "R", None)]);
        assert_eq!(f[0].del, Some(1));
    }

    #[test]
    fn so_versoes_fixas_vao_para_o_cache() {
        assert!(fixed("a7a487c74e44859aa703ac41f9724ed195abecd0"));
        assert!(fixed("1234"));
        assert!(!fixed("HEAD"));
        assert!(!fixed("main"));
        assert!(!fixed("a7a487c"));
        assert!(!fixed(""));
    }

    #[test]
    fn lru_respeita_o_limite() {
        let mut l: Lru<String> = Lru::new(100);
        l.put("a".into(), "1".into(), 20);
        l.put("b".into(), "2".into(), 20);
        for k in ["c", "d", "e"] { l.put(k.into(), "3".into(), 25); }
        assert!(l.get("a").is_none()); // 115 > 100: sai o mais antigo
        assert_eq!(l.get("b").as_deref(), Some("2"));
        assert_eq!(l.get("e").as_deref(), Some("3"));
        l.put("grande".into(), "x".into(), 26); // mais de 1/4 do limite: não guarda
        assert!(l.get("grande").is_none());
    }
}
