//! Git e SVN: projetos, resumo, alterações, histórico, diff e o código que a cópia local representa.
use crate::util::*;
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;
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
#[derive(Serialize)]
pub struct Changes {
    pub vcs: Option<&'static str>,
    pub files: Vec<ChangedFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rev: Option<String>,
}
#[derive(Serialize)]
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
            let last = (lg.ok && f.len() >= 4 && !f[0].is_empty()).then(|| Commit { id: None, hash: f[0].into(), author: f[1].into(), when: rel_time_unix(f[2]), subject: f[3].into() });
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
        Commit { id: None, hash: m[1].into(), author: tag(&LOG_AUTHOR, body), when: if date.is_empty() { String::new() } else { rel_time_iso(&date) }, subject: tag(&LOG_MSG, body).lines().next().unwrap_or("").into() }
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

pub async fn changes(dir: &Path, mode: &str, rev: Option<&str>) -> Changes {
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
            let target = rev.filter(|r| !r.is_empty()).unwrap_or("HEAD").to_string();
            let a1 = ["show", "--name-status", "--format=", "-m", "--first-parent", &target, "--", "."];
            let a2 = ["show", "--numstat", "--format=", "-m", "--first-parent", &target, "--", "."];
            let (r, ns) = tokio::join!(git(dir, &a1), git(dir, &a2));
            let mut files: Vec<ChangedFile> = r.out.lines().filter(|l| !l.is_empty()).filter_map(|l| {
                let parts: Vec<&str> = l.split('\t').collect();
                strip_prefix(parts[parts.len() - 1], &pre).map(|q| ChangedFile { path: q, code: parts[0][..1].to_string(), staged: None, add: None, del: None })
            }).collect();
            apply_numstat(&mut files, &ns.out, &pre);
            Changes { vcs, files, rev: Some(target) }
        }
        Some(_) => {
            if mode == "working" {
                let st = svn(dir, &["status"]).await;
                let files = st.out.lines().filter(|l| !l.trim().is_empty() && !l.starts_with("Status against") && l.len() > 8)
                    .map(|l| ChangedFile { path: norm(l.get(8..).unwrap_or("").trim()), code: l[..1].to_string(), staged: None, add: None, del: None })
                    .filter(|f| !is_build_output(f)).collect();
                return Changes { vcs, files, rev: None };
            }
            let t = match rev.filter(|r| !r.is_empty()) {
                Some(r) => r.to_string(),
                None => svn(dir, &["info", "--show-item", "last-changed-revision"]).await.out.trim().to_string(),
            };
            let r = svn(dir, &["diff", "--summarize", "-c", &t]).await;
            let nd = norm(&dir.to_string_lossy()).to_lowercase();
            let files = r.out.lines().filter(|l| !l.trim().is_empty() && l.len() > 8).map(|l| {
                let p = norm(l.get(8..).unwrap_or("").trim());
                let path = if p.to_lowercase().starts_with(&nd) { p[nd.len()..].trim_start_matches('/').to_string() } else { p };
                ChangedFile { path, code: l[..1].to_string(), staged: None, add: None, del: None }
            }).collect();
            Changes { vcs, files, rev: Some(t) }
        }
    }
}

pub async fn history(dir: &Path) -> Vec<Commit> { history_n(dir, 30).await }

/// os `n` commits mais recentes (a aba Alterações pede mais conforme se navega para trás)
pub async fn history_n(dir: &Path, n: usize) -> Vec<Commit> {
    let n = n.clamp(1, 2000).to_string();
    match detect(dir) {
        Some("git") => {
            let r = git(dir, &["log", "-n", &n, "--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s", "--", "."]).await;
            r.out.lines().filter_map(|l| {
                let f: Vec<&str> = l.split('\x1f').collect();
                (f.len() >= 5).then(|| Commit { id: Some(f[0].into()), hash: f[1].into(), author: f[2].into(), when: rel_time_unix(f[3]), subject: f[4].into() })
            }).collect()
        }
        Some("svn") => {
            let r = svn(dir, &["log", "-l", &n, "--xml"]).await;
            parse_svn_log(&r.out).into_iter().map(|mut c| { c.id = Some(c.hash.clone()); c.hash = format!("r{}", c.hash); c }).collect()
        }
        _ => vec![],
    }
}

pub async fn diff(dir: &Path, file: &str, mode: &str, rev: Option<&str>) -> DiffPair {
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
            let t = rev.filter(|r| !r.is_empty()).unwrap_or("HEAD").to_string();
            let (a, b) = tokio::join!(show(format!("{t}~1")), show(t.clone()));
            DiffPair { original: a, modified: b }
        }
        Some("svn") => {
            let cat = |r: String| async move { let x = svn(dir, &["cat", "-r", &r, file]).await; if x.ok { x.out } else { String::new() } };
            if mode == "working" { let (a, b) = tokio::join!(cat("BASE".into()), disk()); return DiffPair { original: a, modified: b }; }
            let t = match rev.filter(|r| !r.is_empty()) {
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
