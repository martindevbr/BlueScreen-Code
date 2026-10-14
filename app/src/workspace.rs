//! Árvore no estilo Project View do IntelliJ, índice de arquivos/classes e busca de texto.
//! Modelo do projeto: módulos (pom.xml, .project, build.gradle, package.json) e source roots (pom/.classpath/convenção
//! Maven). Dentro de src/test, pasta vira pacote e pacotes intermediários vazios são compactados.
//! Tudo o que varre disco roda em paralelo (rayon) e usa os dados da própria enumeração do diretório.
use crate::util::*;
use parking_lot::Mutex;
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub struct ProjectModel {
    pub roots: BTreeMap<String, &'static str>,
    pub modules: HashMap<String, &'static str>,
}

#[derive(Serialize)]
pub struct TreeItem {
    pub name: String,
    pub dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub vcs: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")] pub kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")] pub module: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")] pub sub: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub java: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")] pub test: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct IndexEntry {
    pub p: String,
    pub size: u64,
    pub mtime: f64,
    #[serde(skip_serializing_if = "Option::is_none")] pub cls: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pkg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub java: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")] pub test: Option<bool>,
}

#[derive(Serialize)]
pub struct SearchHit { pub p: String, pub line: usize, pub col: usize, pub len: usize, pub text: String, pub off: usize, pub cut: bool }
#[derive(Serialize)]
pub struct SearchResult { pub hits: Vec<SearchHit>, pub files: usize, pub truncated: bool }

struct Ent { name: String, path: PathBuf, is_dir: bool, size: u64, mtime: f64, reparse: bool }
fn entries(dir: &Path) -> Vec<Ent> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten().map(|e| {
        // no Windows, metadata() de DirEntry vem da própria enumeração (sem abrir o arquivo)
        let md = e.metadata().ok();
        let ft = e.file_type().ok();
        Ent {
            name: e.file_name().to_string_lossy().into_owned(),
            path: e.path(),
            is_dir: ft.map(|t| t.is_dir()).unwrap_or(false),
            reparse: ft.map(|t| t.is_symlink()).unwrap_or(false),
            size: md.as_ref().map(|m| m.len()).unwrap_or(0),
            mtime: md.and_then(|m| m.modified().ok()).map(mtime_ms).unwrap_or(0.0),
        }
    }).collect()
}

static JAVA_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z_$][\w$]*$").unwrap());
static JVM_SRC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(java|kt|groovy|scala)$").unwrap());
static XML_COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<!--[\s\S]*?-->").unwrap());
static TEST_RES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<testResources>([\s\S]*?)</testResources>").unwrap());
static RES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<resources>([\s\S]*?)</resources>").unwrap());
static DIRECTORY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<directory>([^<]+)</directory>").unwrap());
static CP_SRC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<classpathentry\b[^>]*\bkind="src"[^>]*>"#).unwrap());
static CP_PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\bpath="([^"]+)""#).unwrap());

fn has_java(abs: &Path, depth: u32) -> bool {
    if depth > 8 { return false; }
    let ents = entries(abs);
    if ents.iter().any(|e| !e.is_dir && JVM_SRC.is_match(&e.name)) { return true; }
    ents.iter().any(|e| e.is_dir && !IGNORED_DIRS.contains(e.name.as_str()) && has_java(&e.path, depth + 1))
}
fn tags(x: &str, t: &str) -> Vec<String> {
    Regex::new(&format!("<{t}>([^<]+)</{t}>")).unwrap().captures_iter(x).map(|c| c[1].to_string()).collect()
}

static MODEL: LazyLock<TtlCache<PathBuf, Arc<ProjectModel>>> = LazyLock::new(|| TtlCache::new(Duration::from_secs(60)));
pub fn model(dir: &Path, fresh: bool) -> Arc<ProjectModel> {
    if !fresh { if let Some(m) = MODEL.get(&dir.to_path_buf()) { return m; } }
    let mut m = ProjectModel::default();
    scan(dir, &mut m, "", 0);
    let m = Arc::new(m);
    MODEL.set(dir.to_path_buf(), m.clone());
    m
}
fn j(a: &str, b: &str) -> String { if a.is_empty() { b.to_string() } else { format!("{a}/{b}") } }
fn inside_root(m: &ProjectModel, r: &str) -> bool { m.roots.keys().any(|x| r.starts_with(&format!("{x}/"))) }
fn add_root(dir: &Path, m: &mut ProjectModel, base: &str, p: &str, kind: &'static str) {
    let mut p = p.trim().replace('\\', "/");
    if let Some(s) = p.strip_prefix("./") { p = s.to_string(); }
    let p = p.trim_end_matches('/');
    let b = p.as_bytes();
    if p.is_empty() || p.contains("${") || p.starts_with('/') || p.starts_with('.') || (b.len() > 1 && b[1] == b':' && b[0].is_ascii_alphabetic()) { return; }
    let r = j(base, p);
    if m.roots.contains_key(&r) || inside_root(m, &r) || !dir.join(&r).is_dir() { return; }
    m.roots.insert(r, kind);
}
fn module_roots(dir: &Path, m: &mut ProjectModel, rel: &str, names: &HashSet<String>) {
    if names.contains("pom.xml") {
        let x = XML_COMMENT.replace_all(&read_text(&dir.join(rel).join("pom.xml"), 256 * 1024), "").into_owned();
        for p in tags(&x, "sourceDirectory") { add_root(dir, m, rel, &p, "src"); }
        for p in tags(&x, "testSourceDirectory") { add_root(dir, m, rel, &p, "test"); }
        for p in tags(&x, "warSourceDirectory") { add_root(dir, m, rel, &p, "web"); }
        if let Some(tr) = TEST_RES.captures(&x) { for c in DIRECTORY.captures_iter(&tr[1]) { add_root(dir, m, rel, &c[1], "testres"); } }
        let without = TEST_RES.replace_all(&x, "");
        if let Some(rs) = RES.captures(&without) { for c in DIRECTORY.captures_iter(&rs[1]) { add_root(dir, m, rel, &c[1], "res"); } }
    }
    if names.contains(".classpath") {
        let x = read_text(&dir.join(rel).join(".classpath"), 256 * 1024);
        for e in CP_SRC.find_iter(&x) {
            if let Some(p) = CP_PATH.captures(e.as_str()) { let k = if p[1].to_lowercase().contains("test") { "test" } else { "src" }; add_root(dir, m, rel, &p[1], k); }
        }
    }
    for (p, k) in [("src/main/java", "src"), ("src/main/kotlin", "src"), ("src/test/java", "test"), ("src/test/kotlin", "test"), ("src/main/resources", "res"), ("src/test/resources", "testres"), ("src/main/webapp", "web"), ("WebContent", "web")] {
        add_root(dir, m, rel, p, k);
    }
    // projeto Java sem pom/.classpath: "src" e "test" com código Java viram source roots
    if !m.roots.keys().any(|r| rel.is_empty() || r.starts_with(&format!("{rel}/"))) {
        for (p, k) in [("src", "src"), ("JavaSource", "src"), ("source", "src"), ("test", "test")] {
            if has_java(&dir.join(rel).join(p), 0) { add_root(dir, m, rel, p, k); }
        }
    }
}
fn scan(dir: &Path, m: &mut ProjectModel, rel: &str, depth: u32) {
    let ents = entries(&if rel.is_empty() { dir.to_path_buf() } else { dir.join(rel) });
    let names: HashSet<String> = ents.iter().map(|e| e.name.clone()).collect();
    let kind = if names.contains("pom.xml") { Some("maven") }
        else if names.contains("build.gradle") || names.contains("build.gradle.kts") { Some("gradle") }
        else if names.contains(".project") || names.contains(".classpath") { Some("eclipse") }
        else if names.contains("package.json") { Some("node") } else { None };
    if let (Some(k), false) = (kind, rel.is_empty()) { m.modules.insert(rel.to_string(), k); }
    if matches!(kind, Some(k) if k != "node") || rel.is_empty() { module_roots(dir, m, rel, &names); }
    if depth >= 3 { return; }
    for e in &ents {
        let r = j(rel, &e.name);
        if e.is_dir && !IGNORED_DIRS.contains(e.name.as_str()) && !e.name.starts_with('.') && !m.roots.contains_key(&r) && !inside_root(m, &r) { scan(dir, m, &r, depth + 1); }
    }
}
pub fn root_of<'a>(m: &'a ProjectModel, rel: &str) -> Option<(&'a str, &'static str)> {
    let mut best: Option<(&str, &'static str)> = None;
    for (r, k) in &m.roots {
        if (rel == r || rel.starts_with(&format!("{r}/"))) && best.is_none_or(|b| r.len() > b.0.len()) { best = Some((r.as_str(), *k)); }
    }
    best
}

// ---------- tipo da classe Java pelo cabeçalho (ícone C, I, E, @, R ou abstrata) ----------
static KIND_CACHE: LazyLock<Mutex<HashMap<(PathBuf, u64), &'static str>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static STRIP_JAVA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"/\*[\s\S]*?\*/|//[^\n]*|"(?:[^"\\\n]|\\.)*""#).unwrap());
static ABSTRACT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\babstract\b").unwrap());
pub fn java_kind(abs: &Path, name: &str, mtime: f64) -> &'static str {
    let key = (abs.to_path_buf(), mtime as u64);
    if mtime > 0.0 { if let Some(k) = KIND_CACHE.lock().get(&key) { return k; } }
    let mut buf = vec![0u8; 12000];
    let n = match std::fs::File::open(abs) { Ok(mut f) => { use std::io::Read; let mut n = 0; while n < buf.len() { match f.read(&mut buf[n..]) { Ok(0) | Err(_) => break, Ok(k) => n += k } } n } Err(_) => return "class" };
    let t = String::from_utf8_lossy(&buf[..n]);
    let t = STRIP_JAVA.replace_all(&t, |c: &regex::Captures| if c[0].starts_with('"') { "\"\"" } else { " " });
    let re = Regex::new(&format!(r"([^;{{}}]*?)\b(@interface|interface|enum|record|class)\s+{}\b", regex::escape(name))).unwrap();
    let res = match re.captures(&t) {
        None => "class",
        Some(c) => match &c[2] {
            "@interface" => "annotation",
            "interface" => "interface",
            "enum" => "enum",
            "record" => "record",
            _ if ABSTRACT.is_match(&c[1]) => "abstract",
            _ if name.ends_with("Exception") || name.ends_with("Error") => "exception",
            _ => "class",
        },
    };
    if mtime > 0.0 { KIND_CACHE.lock().insert(key, res); }
    res
}

// ---------- árvore ----------
fn sort_key(s: &str) -> String {
    // ordem do pt-BR sem diferenciar maiúsculas nem acentos (á ~ a), como o localeCompare do navegador
    s.to_lowercase().chars().map(|c| match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a', 'é' | 'è' | 'ê' | 'ë' => 'e', 'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o', 'ú' | 'ù' | 'û' | 'ü' => 'u', 'ç' => 'c', c => c,
    }).collect()
}
pub fn tree(project: &Path, rel: &str, compact: bool, fresh: bool) -> ApiResult<Vec<TreeItem>> {
    let m = model(project, fresh);
    let dir = if rel.is_empty() { project.to_path_buf() } else { project.join(rel) };
    if !dir.is_dir() { return Err(fail(format!("Pasta não existe: {rel}"), 404)); }
    let here = root_of(&m, rel).map(|(r, k)| (r.to_string(), k));
    let in_code = matches!(here, Some((_, "src" | "test")));
    let ents: Vec<Ent> = entries(&dir).into_iter().filter(|e| !IGNORED_DIRS.contains(e.name.as_str())).collect();
    let mut items: Vec<TreeItem> = ents.par_iter().map(|e| {
        let r = j(rel, &e.name);
        let mut it = TreeItem { name: e.name.clone(), dir: e.is_dir, vcs: None, kind: None, module: None, sub: None, label: None, java: None, test: None };
        if e.is_dir {
            it.vcs = crate::vcs::here(&e.path);
            it.kind = Some(if let Some(k) = m.roots.get(&r) { *k } else if m.modules.contains_key(&r) { "module" } else if in_code && JAVA_ID.is_match(&e.name) { "package" } else { "dir" });
            it.module = m.modules.get(&r).copied();
            if it.kind == Some("package") && compact {
                // pacotes intermediários vazios: br > com > empresa vira "br.com.empresa"
                let mut chain = vec![e.name.clone()]; let mut cur = e.path.clone(); let mut cr = r.clone();
                for _ in 0..20 {
                    let vis: Vec<Ent> = entries(&cur).into_iter().filter(|x| !IGNORED_DIRS.contains(x.name.as_str())).collect();
                    if vis.len() != 1 || !vis[0].is_dir || !JAVA_ID.is_match(&vis[0].name) { break; }
                    let nr = format!("{cr}/{}", vis[0].name);
                    if m.roots.contains_key(&nr) || m.modules.contains_key(&nr) { break; }
                    chain.push(vis[0].name.clone()); cur = vis[0].path.clone(); cr = nr;
                }
                if chain.len() > 1 { it.sub = Some(chain.join("/")); it.label = Some(chain.join(".")); }
            }
        } else if in_code && e.name.ends_with(".java") && e.name.len() > 5 {
            let cls = &e.name[..e.name.len() - 5];
            it.label = Some(cls.to_string());
            it.java = Some(java_kind(&e.path, cls, e.mtime));
            if matches!(here, Some((_, "test"))) { it.test = Some(true); }
        }
        it
    }).collect();
    items.sort_by_cached_key(|x| (!x.dir, sort_key(x.label.as_deref().unwrap_or(&x.name))));
    Ok(items)
}

// ---------- índice de arquivos e classes (Buscar em tudo) ----------
type Index = Arc<Vec<IndexEntry>>;
static INDEX: LazyLock<Mutex<HashMap<PathBuf, (Instant, Index)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static INDEX_BUILD: LazyLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::OnceCell<Index>>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
pub async fn file_index(project: &Path, fresh: bool) -> Index {
    let key = project.to_path_buf();
    if !fresh {
        if let Some((at, ix)) = INDEX.lock().get(&key) { if at.elapsed() < Duration::from_secs(60) { return ix.clone(); } }
    }
    // pedidos simultâneos do mesmo projeto esperam a mesma varredura
    let cell = INDEX_BUILD.lock().entry(key.clone()).or_insert_with(|| Arc::new(tokio::sync::OnceCell::new())).clone();
    let ix = cell.get_or_init(|| { let k = key.clone(); async move {
        tokio::task::spawn_blocking(move || Arc::new(build_index(&k, fresh))).await.unwrap_or_default()
    } }).await.clone();
    INDEX_BUILD.lock().remove(&key);
    INDEX.lock().insert(key, (Instant::now(), ix.clone()));
    ix
}
fn build_index(project: &Path, fresh: bool) -> Vec<IndexEntry> {
    let m = model(project, fresh);
    // varredura paralela por subpasta; a ordem final é a mesma de uma busca em profundidade
    fn walk(m: &ProjectModel, rel: &str, abs: &Path, depth: u32) -> Vec<IndexEntry> {
        if depth > 25 { return vec![]; }
        let ents = entries(abs);
        let parts: Vec<Vec<IndexEntry>> = ents.par_iter().filter(|e| !IGNORED_DIRS.contains(e.name.as_str())).map(|e| {
            let r = j(rel, &e.name);
            if e.is_dir { return if e.reparse { vec![] } else { walk(m, &r, &e.path, depth + 1) }; }
            let mut f = IndexEntry { p: r, size: e.size, mtime: e.mtime, cls: None, pkg: None, java: None, test: None };
            if e.name.ends_with(".java") && e.name.len() > 5 {
                if let Some((root, k @ ("src" | "test"))) = root_of(m, rel) {
                    let cls = e.name[..e.name.len() - 5].to_string();
                    f.pkg = Some(if rel == root { String::new() } else { rel[root.len() + 1..].replace('/', ".") });
                    if k == "test" { f.test = Some(true); }
                    f.java = Some(java_kind(&e.path, &cls, e.mtime));
                    f.cls = Some(cls);
                }
            }
            vec![f]
        }).collect();
        parts.into_iter().flatten().collect()
    }
    let mut v = walk(&m, "", project, 0);
    v.truncate(30000);
    v
}

// ---------- busca de texto (funciona igual para Git, SVN e pasta solta) ----------
pub static BIN_EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(png|jpe?g|gif|ico|webp|bmp|pdf|jar|war|ear|zip|gz|7z|rar|tar|class|exe|dll|so|woff2?|ttf|eot|otf|mp[34]|avi|mov|xlsx?|docx?|pptx?|dnx)$").unwrap());
const MAX_HITS: usize = 300;
enum Matcher { Fast(regex::bytes::Regex), Fancy(fancy_regex::Regex) }
impl Matcher {
    /// primeira ocorrência na linha: (início, fim) em bytes
    fn find(&self, line: &str) -> Option<(usize, usize)> {
        match self {
            Matcher::Fast(r) => r.find(line.as_bytes()).map(|m| (m.start(), m.end())),
            Matcher::Fancy(r) => r.find(line).ok().flatten().map(|m| (m.start(), m.end())),
        }
    }
    fn any(&self, bytes: &[u8]) -> bool {
        match self {
            Matcher::Fast(r) => r.is_match(bytes),
            Matcher::Fancy(r) => std::str::from_utf8(bytes).ok().map(|s| r.is_match(s).unwrap_or(false)).unwrap_or(false),
        }
    }
}
pub async fn search_text(project: &Path, q: &str, case: bool, is_regex: bool) -> ApiResult<SearchResult> {
    if q.is_empty() { return Ok(SearchResult { hits: vec![], files: 0, truncated: false }); }
    let pat = if is_regex { q.to_string() } else { regex::escape(q) };
    // regex::bytes é o caminho rápido (SIMD, tempo linear); lookaround/backreference caem no fancy-regex
    let matcher = match regex::bytes::RegexBuilder::new(&pat).case_insensitive(!case).multi_line(true).build() {
        Ok(r) => Matcher::Fast(r),
        Err(e) => match fancy_regex::RegexBuilder::new(&format!("{}{}", if case { "" } else { "(?i)" }, pat)).build() {
            Ok(r) => Matcher::Fancy(r),
            Err(_) => return Err(fail(format!("Regex inválida: {e}"), 400)),
        },
    };
    let idx = file_index(project, false).await;
    let project = project.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let files: Vec<&IndexEntry> = idx.iter().filter(|f| (f.size as f64) <= 1.5 * 1024.0 * 1024.0 && !BIN_EXT.is_match(&f.p)).collect();
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut hits = Vec::new(); let mut nfiles = 0; let mut truncated = false;
        // lotes em paralelo, juntados na ordem do índice: o resultado é o mesmo de uma busca sequencial
        for chunk in files.chunks(512) {
            if hits.len() >= MAX_HITS || Instant::now() > deadline { truncated = true; break; }
            let parts: Vec<Option<Vec<SearchHit>>> = chunk.par_iter().map(|f| {
                if Instant::now() > deadline { return None; }
                search_file(&project.join(&f.p), &f.p, &matcher)
            }).collect();
            for p in parts.into_iter().flatten() {
                if p.is_empty() { continue; }
                nfiles += 1;
                for h in p { if hits.len() >= MAX_HITS { truncated = true; break; } hits.push(h); }
            }
        }
        Ok(SearchResult { hits, files: nfiles, truncated })
    }).await.map_err(|e| fail(e.to_string(), 500))?
}
fn utf16_len(s: &str) -> usize { s.chars().map(char::len_utf16).sum() }
fn search_file(abs: &Path, rel: &str, m: &Matcher) -> Option<Vec<SearchHit>> {
    let buf = std::fs::read(abs).ok()?;
    if looks_binary(&buf) || !m.any(&buf) { return None; }
    let text = String::from_utf8_lossy(&buf);
    let mut out = Vec::new();
    for (i, line) in text.split('\n').enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let Some((s, e)) = m.find(line) else { continue };
        // colunas em UTF-16, como o editor (Monaco) conta
        let pre: Vec<char> = line[..s].chars().collect();
        let start = pre.len().saturating_sub(60);
        let piece: String = line.chars().skip(start).take(220).collect();
        let off = utf16_len(&pre[start..].iter().collect::<String>());
        out.push(SearchHit { p: rel.to_string(), line: i + 1, col: utf16_len(&line[..s]) + 1, len: utf16_len(&line[s..e]).max(1), text: piece, off, cut: start > 0 });
        if out.len() >= MAX_HITS { break; }
    }
    Some(out)
}

// ---------- visão geral do projeto (tela sem abas abertas) ----------
fn language_of(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_lowercase();
    Some(match ext.as_str() {
        "java" => "Java", "kt" | "kts" => "Kotlin", "scala" | "sc" => "Scala", "groovy" | "gradle" => "Groovy", "clj" | "cljs" | "edn" => "Clojure",
        "js" | "mjs" | "cjs" | "jsx" => "JavaScript", "ts" | "tsx" | "mts" | "cts" => "TypeScript", "vue" => "Vue", "svelte" => "Svelte",
        "html" | "htm" | "xhtml" => "HTML", "jsp" | "jspf" | "tag" => "JSP", "css" => "CSS", "scss" | "sass" => "Sass", "less" => "Less",
        "py" | "pyw" => "Python", "rb" => "Ruby", "php" => "PHP", "pl" | "pm" => "Perl", "lua" => "Lua", "r" => "R", "jl" => "Julia",
        "go" => "Go", "rs" => "Rust", "c" | "h" => "C", "cpp" | "cc" | "cxx" | "hpp" | "hh" => "C++", "cs" => "C#", "fs" | "fsx" => "F#", "vb" => "Visual Basic",
        "swift" => "Swift", "m" | "mm" => "Objective-C", "dart" => "Dart", "zig" => "Zig", "nim" => "Nim", "cr" => "Crystal", "d" => "D",
        "ex" | "exs" => "Elixir", "erl" | "hrl" => "Erlang", "hs" => "Haskell", "ml" | "mli" => "OCaml", "elm" => "Elm",
        "sql" | "pks" | "pkb" | "ddl" => "SQL", "sh" | "bash" => "Shell", "ps1" | "psm1" => "PowerShell", "bat" | "cmd" => "Batch",
        "xml" | "xsd" | "wsdl" | "xsl" | "xslt" => "XML", "json" => "JSON", "yml" | "yaml" => "YAML", "toml" => "TOML", "properties" => "Properties",
        "md" | "markdown" | "adoc" | "rst" => "Docs", "tf" => "Terraform", "proto" => "Protobuf", "graphql" | "gql" => "GraphQL",
        _ => return None,
    })
}
/// README (se houver), linguagens por tamanho, total de arquivos e os sistemas de build achados.
pub async fn overview(project: &Path) -> serde_json::Value {
    let idx = file_index(project, false).await;
    let mut langs: HashMap<&'static str, (u64, usize)> = HashMap::new();
    // bibliotecas copiadas (vendor, minificados) não contam: distorcem a linguagem do projeto
    let third = Regex::new(r"(?i)(^|/)(vendor|vendors|third[-_]?party|bower_components|lib/(jquery|bootstrap))/|\.min\.(js|css)$|\.bundle\.js$").unwrap();
    for f in idx.iter().filter(|f| !third.is_match(&f.p)) { if let Some(l) = language_of(&f.p) { let e = langs.entry(l).or_default(); e.0 += f.size; e.1 += 1; } }
    let mut langs: Vec<_> = langs.into_iter().collect();
    langs.sort_by(|a, b| b.1.0.cmp(&a.1.0));
    // README: na raiz primeiro; README.md ganha dos outros formatos
    let pick = ["README.md", "readme.md", "Readme.md", "README.markdown", "README.MD", "README.txt", "README.rst", "README", "readme.txt"].iter()
        .map(|n| project.join(n)).find(|p| p.is_file());
    let readme = pick.map(|p| serde_json::json!({ "file": p.file_name().map(|f| f.to_string_lossy().to_string()), "text": read_text(&p, 1024 * 1024) }));
    let p = project.to_path_buf();
    let systems = tokio::task::spawn_blocking(move || crate::build::detect::detect(&p, None).0).await.unwrap_or_default();
    serde_json::json!({
        "readme": readme,
        "files": idx.len(),
        "bytes": idx.iter().map(|f| f.size).sum::<u64>(),
        "languages": langs.iter().take(8).map(|(l, (b, n))| serde_json::json!({ "name": l, "bytes": b, "files": n })).collect::<Vec<_>>(),
        "systems": systems,
    })
}
