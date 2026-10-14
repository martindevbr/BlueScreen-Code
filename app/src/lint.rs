//! Linters embutidos (sem dependências) + integração com ferramentas externas quando existem.
use crate::util::*;
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

#[derive(Serialize, Clone)]
pub struct Problem { pub line: usize, pub col: usize, pub sev: &'static str, pub msg: String, pub rule: String }
#[derive(Serialize, Default)]
pub struct LintResult {
    pub tool: Option<String>,
    pub problems: Vec<Problem>,
    #[serde(skip_serializing_if = "Option::is_none")] pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub client: Option<&'static str>,
}

fn p(line: usize, col: usize, sev: &'static str, msg: impl Into<String>, rule: &str) -> Problem {
    Problem { line: line.max(1), col: col.max(1), sev, msg: msg.into(), rule: rule.into() }
}
fn pl(lc: (usize, usize), sev: &'static str, msg: impl Into<String>, rule: &str) -> Problem { p(lc.0, lc.1, sev, msg, rule) }
/// linha e coluna (contadas em caracteres) do índice em bytes
fn line_col(txt: &str, idx: usize) -> (usize, usize) {
    let before = &txt[..idx.min(txt.len())];
    let line = before.bytes().filter(|&b| b == b'\n').count() + 1;
    let last = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    (line, before[last..].chars().count() + 1)
}
macro_rules! re { ($s:expr) => {{ static R: LazyLock<Regex> = LazyLock::new(|| Regex::new($s).unwrap()); &*R }}; }
macro_rules! fre { ($s:expr) => {{ static R: LazyLock<fancy_regex::Regex> = LazyLock::new(|| fancy_regex::Regex::new($s).unwrap()); &*R }}; }

const BINARY: &[&str] = &["gif", "png", "jpg", "jpeg", "ico", "ttf", "woff", "woff2", "eot", "otf", "zip", "jar", "war", "ear", "class", "pdf", "doc", "docx", "xls", "xlsx", "swf", "db", "wbmp", "exe", "dll", "bmp"];

// ---------- genérico (todo arquivo de texto) ----------
fn generic(txt: &str) -> Vec<Problem> {
    let mut o = vec![];
    if txt.contains('\0') { o.push(p(1, 1, "error", "Arquivo contém bytes nulos (binário?)", "texto")); }
    let b = txt.as_bytes(); let (mut crlf, mut lf) = (0, 0);
    for i in 0..b.len() { if b[i] == b'\n' { if i > 0 && b[i - 1] == b'\r' { crlf += 1 } else { lf += 1 } } }
    if crlf > 0 && lf > 0 { o.push(p(1, 1, "warning", format!("Quebras de linha misturadas ({crlf} CRLF e {lf} LF)"), "eol")); }
    if let Some(m) = re!(r"(?m)<{7} |^={7}$|^>{7} ").find(txt) { o.push(pl(line_col(txt, m.start()), "error", "Marcador de conflito de merge", "merge")); }
    o
}

// ---------- XML (bem-formado) / HTML ----------
const VOID: &[&str] = &["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "basefont", "frame", "isindex", "keygen"];
fn xml(txt: &str, html: bool) -> Vec<Problem> {
    let mut o = vec![]; let mut stack: Vec<(String, usize, usize)> = vec![];
    let b = txt.as_bytes(); let n = b.len(); let mut i = 0;
    let rule = if html { "html" } else { "xml" }; let soft = if html { "warning" } else { "error" };
    let skip_to = |i: &mut usize, s: &str| -> bool { match txt[*i..].find(s) { Some(j) => { *i += j + s.len(); true } None => false } };
    while i < n {
        let Some(off) = txt[i..].find('<') else { break }; let lt = i + off; i = lt;
        let rest = &txt[i..];
        if rest.starts_with("<!--") { if !skip_to(&mut i, "-->") { o.push(pl(line_col(txt, lt), "error", "Comentário não fechado", "xml")); break; } continue; }
        if rest.starts_with("<![CDATA[") { if !skip_to(&mut i, "]]>") { o.push(pl(line_col(txt, lt), "error", "CDATA não fechado", "xml")); break; } continue; }
        if rest.starts_with("<?") { if !skip_to(&mut i, "?>") { o.push(pl(line_col(txt, lt), "error", "Instrução <? não fechada", "xml")); break; } continue; }
        if rest.starts_with("<!") {
            let mut depth = 0i32; let mut j = i;
            while j < n { match b[j] { b'[' => depth += 1, b']' => depth -= 1, b'>' if depth <= 0 => break, _ => {} } j += 1; }
            i = j + 1; continue;
        }
        if html && rest.starts_with("<%") { if !skip_to(&mut i, "%>") { o.push(pl(line_col(txt, lt), "error", "Scriptlet <% não fechado", "jsp")); break; } continue; }
        let Some(m) = re!(r"^<(/?)([A-Za-z_][\w:.-]*)").captures(rest) else {
            if !html { o.push(pl(line_col(txt, lt), "error", "'<' sem nome de tag (use &lt;)", "xml")); }
            i += 1; continue;
        };
        let closing = &m[1] == "/"; let name = if html { m[2].to_lowercase() } else { m[2].to_string() };
        let mut k = i + m[0].len(); let mut q = 0u8; let mut self_close = false;
        while k < n {
            let c = b[k];
            if q != 0 { if c == q { q = 0; } k += 1; continue; }
            if c == b'"' || c == b'\'' { q = c; }
            else if c == b'>' { self_close = b[k - 1] == b'/'; break; }
            else if c == b'<' && !html { o.push(pl(line_col(txt, k), "error", format!("'<' dentro da tag <{name}>"), "xml")); break; }
            k += 1;
        }
        if k >= n { o.push(pl(line_col(txt, lt), "error", format!("Tag <{name}> não fechada com '>'"), "xml")); break; }
        if q != 0 { o.push(pl(line_col(txt, lt), "error", format!("Aspas não fechadas na tag <{name}>"), "xml")); }
        if !html && !closing && re!(r#"\s[\w:.-]+=[^"'\s]"#).is_match(&txt[i + m[0].len()..k]) { o.push(pl(line_col(txt, i), "error", format!("Atributo sem aspas em <{name}>"), "xml")); }
        let (line, col) = line_col(txt, lt);
        if closing {
            match stack.iter().rposition(|s| s.0 == name) {
                None => o.push(p(line, col, soft, format!("</{name}> sem abertura"), rule)),
                Some(idx) => {
                    for s in stack[idx + 1..].iter().rev() { o.push(p(s.1, s.2, soft, format!("<{}> não fechada (fechou </{name}> antes)", s.0), rule)); }
                    stack.truncate(idx);
                }
            }
        } else if !self_close && !(html && VOID.contains(&name.as_str())) { stack.push((name.clone(), line, col)); }
        i = k + 1;
        if html && (name == "script" || name == "style") && !self_close {
            match txt[i..].to_lowercase().find(&format!("</{name}")) { Some(e) => i += e, None => { o.push(p(line, col, "error", format!("<{name}> não fechada"), "html")); break; } }
        }
    }
    for s in &stack { o.push(p(s.1, s.2, soft, format!("<{}> não fechada", s.0), rule)); }
    if !html && !txt.trim().is_empty() && !re!(r"^\s*(<\?xml[^>]*\?>)?\s*(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>)?\s*<").is_match(txt) {
        o.push(p(1, 1, "error", "Conteúdo antes do elemento raiz", "xml"));
    }
    if !html {
        for m in fre!(r"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+|[A-Za-z][\w.-]*);)").find_iter(txt).flatten() {
            o.push(pl(line_col(txt, m.start()), "error", "'&' sem entidade (use &amp;)", "xml"));
            if o.len() > 200 { break; }
        }
    }
    o
}
fn html_lint(txt: &str, ext: &str) -> Vec<Problem> {
    let mut o = xml(txt, true);
    if ext == "jsp" || ext == "jspf" {
        let b = txt.as_bytes(); let mut depth = 0;
        for k in 0..b.len() { if b[k] == b'$' && b.get(k + 1) == Some(&b'{') { depth += 1 } else if b[k] == b'}' && depth > 0 { depth -= 1 } }
        if depth > 0 { o.push(p(1, 1, "warning", "${ } de EL possivelmente não fechado", "jsp")); }
        for m in fre!(r"<%(?!--|@|=)([\s\S]*?)%>").captures_iter(txt).flatten() {
            let body = &m[1];
            if body.matches('{').count() != body.matches('}').count() {
                o.push(pl(line_col(txt, m.get(0).unwrap().start()), "warning", "Scriptlet com chaves desbalanceadas (abre/fecha em scriptlets diferentes?)", "jsp"));
            }
        }
    }
    o
}

// ---------- CSS / SCSS / LESS ----------
fn css(txt: &str, ext: &str) -> Vec<Problem> {
    let mut o = vec![]; let (mut depth, mut line, mut col) = (0usize, 1usize, 0usize);
    let mut q: Option<char> = None; let mut comment = false; let mut pos: Vec<(usize, usize)> = vec![];
    let c: Vec<char> = txt.chars().collect(); let mut i = 0;
    while i < c.len() {
        let ch = c[i]; col += 1; let nx = c.get(i + 1).copied().unwrap_or('\0');
        if ch == '\n' { line += 1; col = 0; if q.is_some() { o.push(p(line - 1, 1, "error", "String não fechada", "css")); q = None; } i += 1; continue; }
        if comment { if ch == '*' && nx == '/' { comment = false; i += 1; col += 1; } i += 1; continue; }
        if let Some(qc) = q { if ch == '\\' { i += 2; col += 1; continue; } if ch == qc { q = None; } i += 1; continue; }
        if ch == '/' && nx == '*' { comment = true; pos.push((line, col)); i += 2; continue; }
        if (ext == "scss" || ext == "less") && ch == '/' && nx == '/' { while i < c.len() && c[i] != '\n' { i += 1; } continue; }
        if ch == '"' || ch == '\'' { q = Some(ch); i += 1; continue; }
        if ch == '{' { depth += 1; pos.push((line, col)); }
        else if ch == '}' { if depth == 0 { o.push(p(line, col, "error", "'}' sem '{' correspondente", "css")); } else { depth -= 1; pos.pop(); } }
        i += 1;
    }
    if comment { let (l, cc) = pos.pop().unwrap_or((1, 1)); o.push(p(l, cc, "error", "Comentário /* não fechado", "css")); }
    if depth > 0 { let (l, cc) = pos.last().copied().unwrap_or((1, 1)); o.push(p(l, cc, "error", format!("'{{' não fechado ({depth})"), "css")); }
    if ext == "css" { for m in re!(r":[^;{}]*[^;\s{}]\s*\n\s*\}").find_iter(txt) { o.push(pl(line_col(txt, m.start()), "warning", "Falta ';' no fim da declaração", "css")); } }
    o
}

fn json_lint(txt: &str) -> Vec<Problem> {
    match serde_json::from_str::<serde_json::Value>(txt.trim_start_matches('\u{feff}')) {
        Ok(_) => vec![],
        Err(e) => vec![p(e.line(), e.column(), "error", re!(r" at line \d+ column \d+$").replace(&e.to_string(), "").into_owned(), "json")],
    }
}

fn properties(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut seen: HashMap<String, usize> = HashMap::new(); let mut cont = false;
    for (i, raw) in txt.split('\n').enumerate() {
        let l = raw.strip_suffix('\r').unwrap_or(raw);
        if cont { cont = l.ends_with('\\'); continue; }
        let t = l.trim(); if t.is_empty() || t.starts_with('#') || t.starts_with('!') { continue; }
        cont = l.ends_with('\\');
        let Some(m) = re!(r"^((?:\\.|[^=:\s])+)\s*[=:]?\s*(.*)$").captures(t) else { o.push(p(i + 1, 1, "error", "Linha inválida", "properties")); continue };
        let key = m[1].to_string();
        if let Some(at) = seen.get(&key) { o.push(p(i + 1, 1, "warning", format!("Chave duplicada \"{key}\" (também na linha {at})"), "properties")); } else { seen.insert(key, i + 1); }
        if re!(r"[^\\]\s+$").is_match(l) && !m[2].is_empty() { o.push(p(i + 1, l.chars().count(), "warning", "Espaço em branco no fim do valor", "properties")); }
        if !t.is_ascii() { o.push(p(i + 1, 1, "warning", "Caractere não-ASCII (use \\uXXXX em .properties ISO-8859-1)", "properties")); }
    }
    o
}

fn yaml(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut keys: Vec<(String, usize, usize, Option<usize>)> = vec![];
    for (i, raw) in txt.split('\n').enumerate() {
        let l = raw.strip_suffix('\r').unwrap_or(raw);
        if re!(r"^\s*\t").is_match(l) { o.push(p(i + 1, 1, "error", "Tab na indentação (YAML exige espaços)", "yaml")); }
        let t = l.trim(); if t.is_empty() || t.starts_with('#') || t == "---" || t == "..." { continue; }
        let ind = l.len() - l.trim_start().len();
        if let Some(km) = re!(r"^([\w.\-/$]+)\s*:(\s|$)").captures(t) {
            while keys.last().is_some_and(|k| k.1 >= ind) { keys.pop(); }
            let parent = keys.iter().find(|k| k.1 < ind).map(|k| k.2);
            if keys.iter().any(|k| k.1 == ind && k.0 == km[1] && k.3 == parent) { o.push(p(i + 1, 1, "warning", format!("Chave duplicada \"{}\"", &km[1]), "yaml")); }
            keys.push((km[1].to_string(), ind, i + 1, parent));
        } else if re!(r#"^[^\s\-'"\[{>|!&*%@`]"#).is_match(t) && !re!(r"^\S.*:\s").is_match(t) && ind == 0 && !re!(r"^[\w.\-/$]+\s*:").is_match(t) {
            o.push(p(i + 1, 1, "warning", "Linha solta sem \"chave:\" nem \"-\"", "yaml"));
        }
        if re!(r#"(^|[^\\])""#).find_iter(t).count() % 2 == 1 { o.push(p(i + 1, 1, "error", "Aspas duplas não fechadas", "yaml")); }
    }
    o
}

fn sql(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let b = txt.as_bytes(); let (mut depth, mut q, mut i) = (0usize, 0u8, 0usize);
    while i < b.len() {
        let c = b[i]; let nx = b.get(i + 1).copied().unwrap_or(0);
        if q != 0 { if c == q { if nx == q { i += 1 } else { q = 0 } } i += 1; continue; }
        if c == b'-' && nx == b'-' { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if c == b'/' && nx == b'*' { match txt[i..].find("*/") { Some(e) => { i += e + 2; continue; } None => { o.push(pl(line_col(txt, i), "error", "Comentário /* não fechado", "sql")); break; } } }
        if c == b'\'' || c == b'"' { q = c; i += 1; continue; }
        if c == b'(' { depth += 1 } else if c == b')' { if depth == 0 { o.push(pl(line_col(txt, i), "error", "')' sem '('", "sql")) } else { depth -= 1 } }
        i += 1;
    }
    if q != 0 { o.push(p(1, 1, "error", "String não fechada", "sql")); }
    if depth > 0 { o.push(p(1, 1, "error", format!("'(' não fechado ({depth})"), "sql")); }
    o
}

fn markdown(txt: &str) -> Vec<Problem> {
    if re!(r"(?m)^\s*```").find_iter(txt).count() % 2 == 1 { vec![p(1, 1, "warning", "Bloco de código ``` não fechado", "markdown")] } else { vec![] }
}

// ---------- Java (javac com classpath do projeto) ----------
fn java_classpath(project: &Path, file: &Path) -> (String, String, usize) {
    let mut jars = vec![]; let mut src: Vec<std::path::PathBuf> = vec![];
    fn walk(d: &Path, depth: u32, jars: &mut Vec<std::path::PathBuf>, src: &mut Vec<std::path::PathBuf>) {
        if depth > 6 || jars.len() > 400 { return; }
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if matches!(name.as_str(), ".svn" | ".git" | "node_modules" | "target" | "build") { continue; }
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if matches!(name.as_str(), "src" | "java" | "classes") && !src.contains(&e.path()) { src.push(e.path()); }
                walk(&e.path(), depth + 1, jars, src);
            } else if name.to_lowercase().ends_with(".jar") { jars.push(e.path()); }
            if jars.len() > 400 { return; }
        }
    }
    walk(project, 0, &mut jars, &mut src);
    if let Ok(t) = std::fs::read_to_string(file) {
        if let Some(pk) = re!(r"(?m)^\s*package\s+([\w.]+)\s*;").captures(&t) {
            let mut r = file.parent().unwrap_or(project).to_path_buf();
            for _ in pk[1].split('.') { r = r.parent().unwrap_or(&r).to_path_buf(); }
            if !src.contains(&r) { src.push(r); }
        }
    }
    let sep = if cfg!(windows) { ";" } else { ":" };
    let classes: Vec<String> = src.iter().filter(|s| s.ends_with("classes")).map(|s| s.to_string_lossy().into()).collect();
    let n = classes.len() + jars.len();
    let cp = classes.into_iter().chain(jars.iter().map(|j| j.to_string_lossy().into())).collect::<Vec<String>>().join(sep);
    let sp = src.iter().filter(|s| !s.ends_with("classes")).map(|s| s.to_string_lossy().into()).collect::<Vec<String>>().join(sep);
    (cp, sp, n)
}
async fn java(project: &Path, file: &Path) -> LintResult {
    let (cp, sp, n) = { let (p, f) = (project.to_path_buf(), file.to_path_buf()); tokio::task::spawn_blocking(move || java_classpath(&p, &f)).await.unwrap_or_default() };
    let tmp = std::env::temp_dir().join("bluescreen-javac"); let _ = std::fs::create_dir_all(&tmp);
    let tmp_s = tmp.to_string_lossy().to_string(); let file_s = file.to_string_lossy().to_string();
    let mut args = vec!["-proc:none", "-implicit:none", "-Xlint:all", "-Xmaxerrs", "200", "-encoding", "UTF-8", "-d", &tmp_s];
    if !cp.is_empty() { args.push("-cp"); args.push(&cp); }
    if !sp.is_empty() { args.push("-sourcepath"); args.push(&sp); }
    args.push(&file_s);
    let r = run("javac", &args, project, 90000).await;
    if r.not_found { return LintResult { note: Some("javac não encontrado".into()), ..Default::default() }; }
    let me = absolute(file).to_string_lossy().to_lowercase();
    let mut problems = vec![];
    for m in re!(r"(?m)^(.+?\.java):(\d+): (error|warning): (.*)$").captures_iter(&r.err) {
        if absolute(&project.join(&m[1])).to_string_lossy().to_lowercase() != me { continue; }
        let (mut sev, mut msg, mut rule) = (if &m[3] == "error" { "error" } else { "warning" }, m[4].trim_end().to_string(), "javac");
        if re!(r"cannot find symbol|package .* does not exist|cannot access").is_match(&msg) { sev = "warning"; rule = "classpath"; msg.push_str(" (dependência fora do classpath?)"); }
        problems.push(p(m[2].parse().unwrap_or(1), 1, sev, msg, rule));
    }
    if problems.is_empty() && !r.ok && !r.err.trim().is_empty() { problems.push(p(1, 1, "warning", r.err.trim().lines().next().unwrap_or(""), "javac")); }
    LintResult { tool: Some(format!("javac ({n} jars)")), problems, ..Default::default() }
}

// ---------- PowerShell / shell / Python ----------
async fn ps1(file: &Path) -> LintResult {
    let f = file.to_string_lossy().replace('\'', "''");
    let script = format!("$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('{f}',[ref]$t,[ref]$e);$e|%{{ '{{0}}|{{1}}|{{2}}' -f $_.Extent.StartLineNumber,$_.Extent.StartColumnNumber,$_.Message }}");
    let r = run("powershell", &["-NoProfile", "-NonInteractive", "-Command", &script], file.parent().unwrap_or(file), 30000).await;
    let problems = r.out.lines().map(str::trim).filter(|l| !l.is_empty()).map(|l| {
        let parts: Vec<&str> = l.split('|').collect();
        p(parts[0].parse().unwrap_or(1), parts.get(1).and_then(|c| c.parse().ok()).unwrap_or(1), "error", parts.get(2..).map(|x| x.join("|")).unwrap_or_default(), "powershell")
    }).collect();
    LintResult { tool: Some("powershell parser".into()), problems, ..Default::default() }
}
async fn sh(file: &Path) -> LintResult {
    let r = run("bash", &["-n", &file.to_string_lossy()], file.parent().unwrap_or(file), 30000).await;
    if r.not_found { return LintResult { note: Some("bash não encontrado".into()), ..Default::default() }; }
    let problems = re!(r"line (\d+): (.*)").captures_iter(&r.err).map(|m| p(m[1].parse().unwrap_or(1), 1, "error", m[2].trim_end(), "bash")).collect();
    LintResult { tool: Some("bash -n".into()), problems, ..Default::default() }
}
static PYTHON: tokio::sync::OnceCell<Option<&'static str>> = tokio::sync::OnceCell::const_new();
async fn py(file: &Path, dir: &Path) -> LintResult {
    let py = *PYTHON.get_or_init(|| async {
        for c in ["py", "python3", "python"] { let r = run(c, &["-c", "print(1)"], dir, 8000).await; if r.ok && r.out.trim() == "1" { return Some(c); } }
        None
    }).await;
    let Some(py) = py else { return LintResult { note: Some("Python não encontrado (instale ou adicione ao PATH)".into()), ..Default::default() } };
    let fs = file.to_string_lossy();
    let r = run(py, &["-m", "pyflakes", &fs], dir, 30000).await;
    if !r.err.contains("No module named") && !r.not_found {
        let problems = r.out.lines().filter_map(|l| re!(r":(\d+):(\d+):?\s*(.*)").captures(l)).map(|m| p(m[1].parse().unwrap_or(1), m[2].parse().unwrap_or(1), "warning", m[3].trim_end(), "pyflakes")).collect();
        return LintResult { tool: Some("pyflakes".into()), problems, ..Default::default() };
    }
    let r = run(py, &["-m", "py_compile", &fs], dir, 30000).await;
    let mut problems = vec![];
    if !r.ok {
        let m = re!(r"line (\d+)[\s\S]*?(\w+Error: .*)").captures(&r.err);
        problems.push(match m { Some(m) => p(m[1].parse().unwrap_or(1), 1, "error", m[2].trim_end(), "syntax"), None => p(1, 1, "error", r.err.trim(), "syntax") });
    }
    LintResult { tool: Some("py_compile".into()), problems, ..Default::default() }
}

// ---------- JS / TS ----------
const ESLINT_CFG: &[&str] = &["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"];
async fn js(dir: &Path, file: &Path, ext: &str) -> LintResult {
    let fs = file.to_string_lossy().to_string();
    if ESLINT_CFG.iter().any(|c| dir.join(c).exists()) {
        let r = run("cmd.exe", &["/d", "/s", "/c", "npx", "--no-install", "eslint", "--format", "json", &fs], dir, 60000).await;
        if let Ok(serde_json::Value::Array(files)) = serde_json::from_str::<serde_json::Value>(if r.out.trim().is_empty() { "[]" } else { &r.out }) {
            let mut problems = vec![];
            for f in files { for m in f["messages"].as_array().cloned().unwrap_or_default() {
                problems.push(p(m["line"].as_u64().unwrap_or(1) as usize, m["column"].as_u64().unwrap_or(1) as usize, if m["severity"] == 2 { "error" } else { "warning" }, m["message"].as_str().unwrap_or(""), m["ruleId"].as_str().unwrap_or("eslint")));
            } }
            return LintResult { tool: Some("eslint".into()), problems, ..Default::default() };
        }
    }
    if matches!(ext, "js" | "mjs" | "cjs") {
        let r = run("node", &["--check", &fs], dir, 30000).await;
        if !r.not_found {
            let mut problems = vec![];
            if !r.ok {
                let m = re!(r":(\d+)\r?\n[\s\S]*?\^+\r?\n\r?\n(\w+Error: .*)").captures(&r.err).or_else(|| re!(r":(\d+)[\s\S]*?(SyntaxError: .*)").captures(&r.err));
                problems.push(match m { Some(m) => p(m[1].parse().unwrap_or(1), 1, "error", m[2].trim_end(), "syntax"), None => p(1, 1, "error", r.err.trim().lines().last().unwrap_or(""), "syntax") });
            }
            return LintResult { tool: Some("node --check".into()), problems, client: Some("ts"), ..Default::default() };
        }
    }
    // sem Node, ou ts/tsx/jsx: o verificador TypeScript do editor cuida (client)
    LintResult { tool: Some("typescript (editor)".into()), client: Some("ts"), ..Default::default() }
}

// ---------- entrada ----------
static XML_EXT: LazyLock<HashSet<&str>> = LazyLock::new(|| ["xml", "xsd", "wsdl", "xsl", "xslt", "tld", "jrxml", "xmi", "pom", "svg", "project", "classpath", "launch", "component", "factorypath", "jsdtscope", "container", "name", "plist", "dtd"].into_iter().collect());
const PLAIN_EXT: &[&str] = &["txt", "mf", "gitignore", "editorconfig", "iml", "log", "csv", "tu", "ti", "prd", "hml", "dnx"];
pub async fn lint(project: &Path, rel_file: &str) -> LintResult {
    let abs = project.join(rel_file);
    let ext = Path::new(rel_file).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let base = Path::new(rel_file).file_name().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if BINARY.contains(&ext.as_str()) { return LintResult { note: Some("Binário, sem lint".into()), ..Default::default() }; }
    let txt = match tokio::fs::read(&abs).await { Ok(b) => String::from_utf8_lossy(&b).into_owned(), Err(e) => return LintResult { note: Some(e.to_string()), ..Default::default() } };
    let mut out = match ext.as_str() {
        "java" => java(project, &abs).await,
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" | "vue" => js(project, &abs, &ext).await,
        "html" | "htm" | "xhtml" | "jsp" | "jspf" | "tag" | "vm" | "ftl" => wrap("html/jsp", html_lint(&txt, &ext)),
        e if XML_EXT.contains(e) || base.ends_with(".xml") => wrap("xml", if e == "dtd" { vec![] } else { xml(&txt, false) }),
        "css" | "scss" | "less" => wrap(&ext, css(&txt, &ext)),
        "sass" => wrap("sass", vec![]),
        "json" | "map" | "webmanifest" => wrap("json", json_lint(&txt)),
        "properties" | "prefs" => wrap("properties", properties(&txt)),
        "yml" | "yaml" => wrap("yaml", yaml(&txt)),
        "sql" | "ddl" | "pks" | "pkb" => wrap("sql", sql(&txt)),
        "md" | "markdown" => wrap("markdown", markdown(&txt)),
        "py" => py(&abs, project).await,
        "ps1" | "psm1" => ps1(&abs).await,
        "sh" | "bash" => sh(&abs).await,
        "bat" | "cmd" => wrap("bat", txt.split('\n').enumerate().filter(|(_, l)| l.matches('"').count() % 2 == 1).map(|(i, _)| p(i + 1, 1, "warning", "Aspas não fechadas", "bat")).collect()),
        e if PLAIN_EXT.contains(&e) || e.is_empty() => wrap("texto", vec![]),
        e => LintResult { tool: Some("texto".into()), note: Some(format!("Sem regras específicas para .{e}; só checagens genéricas")), ..Default::default() },
    };
    let mut all = generic(&txt);
    all.append(&mut out.problems);
    out.problems = all;
    out
}
fn wrap(tool: &str, problems: Vec<Problem>) -> LintResult { LintResult { tool: Some(tool.into()), problems, ..Default::default() } }
