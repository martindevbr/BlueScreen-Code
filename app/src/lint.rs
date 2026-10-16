//! Linters embutidos (sem dependências) + integração com ferramentas externas quando existem.
use crate::util::*;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

#[derive(Serialize, Clone)]
pub struct Problem {
    pub line: usize, pub col: usize, pub sev: &'static str, pub msg: String, pub rule: String,
    /// fim do trecho (0 = só a posição inicial); os linters embutidos não informam, o Linter Universal sim
    #[serde(skip_serializing_if = "is_zero")] pub end_line: usize,
    #[serde(skip_serializing_if = "is_zero")] pub end_col: usize,
}
fn is_zero(n: &usize) -> bool { *n == 0 }
#[derive(Serialize, Default)]
pub struct LintResult {
    pub tool: Option<String>,
    pub problems: Vec<Problem>,
    #[serde(skip_serializing_if = "Option::is_none")] pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub client: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")] pub live: Option<bool>,
}

fn p(line: usize, col: usize, sev: &'static str, msg: impl Into<String>, rule: &str) -> Problem {
    Problem { line: line.max(1), col: col.max(1), sev, msg: msg.into(), rule: rule.into(), end_line: 0, end_col: 0 }
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

#[path = "lint_formats.rs"] mod formats;

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
/// tags do HTML cujo fechamento é opcional pela especificação (<li>a<li>b, <p>texto, <td>...)
const OPTIONAL_END: &[&str] = &["p", "li", "td", "th", "tr", "dd", "dt", "option", "optgroup", "thead", "tbody", "tfoot", "colgroup", "rp", "rt", "rb", "rtc", "html", "head", "body"];
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
        // o "=" dentro de um valor entre aspas (Condition="'$(A)'=='1'") não conta
        if !html && !closing && re!(r#"\s[\w:.-]+=[^"'\s]"#).is_match(&re!(r#""[^"]*"|'[^']*'"#).replace_all(&txt[i + m[0].len()..k], "\"\"")) { o.push(pl(line_col(txt, i), "error", format!("Atributo sem aspas em <{name}>"), "xml")); }
        let (line, col) = line_col(txt, lt);
        if closing {
            match stack.iter().rposition(|s| s.0 == name) {
                None => o.push(p(line, col, soft, format!("</{name}> sem abertura"), rule)),
                Some(idx) => {
                    for s in stack[idx + 1..].iter().rev().filter(|s| !(html && OPTIONAL_END.contains(&s.0.as_str()))) { o.push(p(s.1, s.2, soft, format!("<{}> não fechada (fechou </{name}> antes)", s.0), rule)); }
                    stack.truncate(idx);
                }
            }
        } else if !self_close && !(html && VOID.contains(&name.as_str())) { stack.push((name.clone(), line, col)); }
        i = k + 1;
        // conteúdo de <script>/<style> é texto: pula até o fechamento (só na abertura; busca ASCII sem mudar o tamanho em bytes)
        if html && !closing && (name == "script" || name == "style") && !self_close {
            let close = format!("</{name}");
            match txt.as_bytes()[i..].windows(close.len()).position(|w| w.eq_ignore_ascii_case(close.as_bytes())) { Some(e) => i += e, None => { o.push(p(line, col, "error", format!("<{name}> não fechada"), "html")); break; } }
        }
    }
    for s in stack.iter().filter(|s| !(html && OPTIONAL_END.contains(&s.0.as_str()))) { o.push(p(s.1, s.2, soft, format!("<{}> não fechada", s.0), rule)); }
    if !html && !txt.trim().is_empty() && !re!(r"^\s*(<\?xml[^>]*\?>)?\s*(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>)?\s*<").is_match(txt) {
        o.push(p(1, 1, "error", "Conteúdo antes do elemento raiz", "xml"));
    }
    if !html {
        // '&' solto não vale em comentários, CDATA nem instruções <? ?>: vira espaço com o mesmo tamanho em bytes
        let masked = re!(r"(?s)<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>").replace_all(txt, |m: &regex::Captures| m[0].chars().map(|c| if c == '\n' { "\n".into() } else { " ".repeat(c.len_utf8()) }).collect::<String>());
        for m in fre!(r"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+|[A-Za-z][\w.-]*);)").find_iter(masked.as_ref()).flatten() {
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
    if ext == "css" { for m in re!(r":[^;{}]*[^;\s{}]\s*\n\s*\}").find_iter(txt) { o.push(pl(line_col(txt, m.start()), "info", "Sem ';' na última declaração (válido, mas fácil de esquecer ao acrescentar outra)", "css")); } }
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
    let mut block: Option<usize> = None; // dentro de um bloco | ou >: indentação da linha que o abriu
    for (i, raw) in txt.split('\n').enumerate() {
        let l = raw.strip_suffix('\r').unwrap_or(raw);
        let t = l.trim(); let ind = l.len() - l.trim_start().len();
        if let Some(b) = block { if t.is_empty() || ind > b { continue; } block = None; }
        if re!(r"^\s*\t").is_match(l) { o.push(p(i + 1, 1, "error", "Tab na indentação (YAML exige espaços)", "yaml")); }
        if t.is_empty() || t.starts_with('#') || t == "---" || t == "..." { continue; }
        if let Some(km) = re!(r"^([\w.\-/$]+)\s*:(\s|$)").captures(t) {
            while keys.last().is_some_and(|k| k.1 >= ind) { keys.pop(); }
            let parent = keys.iter().find(|k| k.1 < ind).map(|k| k.2);
            if keys.iter().any(|k| k.1 == ind && k.0 == km[1] && k.3 == parent) { o.push(p(i + 1, 1, "warning", format!("Chave duplicada \"{}\"", &km[1]), "yaml")); }
            keys.push((km[1].to_string(), ind, i + 1, parent));
        } else if ind == 0 && re!(r#"^[^\s\-'"\[{>|!&*%@`]"#).is_match(t) && !re!(r"^\S.*:(\s|$)").is_match(t) {
            o.push(p(i + 1, 1, "warning", "Linha solta sem \"chave:\" nem \"-\"", "yaml"));
        }
        // aspas: uma aspa só abre string no começo de um valor (depois de espaço, ':', '-', '[', '{' ou ','); "don't" não abre
        let (mut sq, mut dq, mut prev, mut esc) = (false, false, ' ', false);
        for ch in t.chars() {
            if dq { if esc { esc = false; } else if ch == '\\' { esc = true; } else if ch == '"' { dq = false; } }
            else if sq { if ch == '\'' { sq = false; } }
            else if ch == '#' && (prev == ' ' || prev == '\t') { break; }
            else if matches!(prev, ' ' | '\t' | ':' | '-' | '[' | '{' | ',') { if ch == '"' { dq = true; } else if ch == '\'' { sq = true; } }
            prev = ch;
        }
        if dq && !t.ends_with('\\') { o.push(p(i + 1, 1, "error", "Aspas duplas não fechadas", "yaml")); }
        if re!(r"(^|:|-)\s*[|>][-+0-9]*\s*(#.*)?$").is_match(t) { block = Some(ind); }
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
    // cerca de código: ``` ou ~~~ (3 ou mais); fecha com o mesmo caractere e pelo menos o mesmo tamanho
    let mut open: Option<(char, usize, usize)> = None;
    for (i, raw) in txt.split('\n').enumerate() {
        let l = raw.strip_suffix('\r').unwrap_or(raw);
        let t = l.trim_start();
        if l.len() - t.len() > 3 && open.is_none() { continue; }
        let Some(c) = t.chars().next().filter(|c| *c == '`' || *c == '~') else { continue };
        let n = t.chars().take_while(|x| *x == c).count(); if n < 3 { continue; }
        match open {
            None => { if !(c == '`' && t[n..].contains('`')) { open = Some((c, n, i + 1)); } }
            Some((oc, on, _)) => { if oc == c && n >= on && t[n..].trim().is_empty() { open = None; } }
        }
    }
    match open { Some((c, n, ln)) => vec![p(ln, 1, "warning", format!("Bloco de código {} não fechado", c.to_string().repeat(n)), "markdown")], None => vec![] }
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

// ---------- plugins (gancho "lint") ----------
/// Plugin inscrito no gancho `lint` (o Linter Universal) responde primeiro. Se ele recusar (`handled: false`,
/// linguagem que ele não conhece), falhar ou estiver desligado, o lint segue o caminho de sempre.
async fn plugin_lint(project: &Path, rel: &str) -> Option<LintResult> {
    for (id, route) in crate::server::host().hooks("lint") {
        let body = serde_json::json!({ "project": project.to_string_lossy(), "file": rel });
        match bluescreen_sdk::plugin::core().post(&route, &[], &body).await {
            Ok(v) if v["handled"] == true => {
                let n = |x: &serde_json::Value, k: &str| x[k].as_u64().unwrap_or(0) as usize;
                let problems = v["problems"].as_array().map(|a| a.iter().map(|x| Problem {
                    line: n(x, "line").max(1), col: n(x, "col").max(1), end_line: n(x, "end_line"), end_col: n(x, "end_col"),
                    sev: match x["sev"].as_str() { Some("error") => "error", Some("info") => "info", _ => "warning" },
                    msg: x["msg"].as_str().unwrap_or("").into(), rule: x["rule"].as_str().unwrap_or(&id).into(),
                }).collect()).unwrap_or_default();
                return Some(LintResult { tool: v["tool"].as_str().map(String::from).or(Some(id)), problems, note: None, client: (v["client"] == "ts").then_some("ts"), live: None });
            }
            Ok(_) => {}
            Err(e) => log(format!("plugin {id}: lint falhou, usando o lint de sempre ({})", e.msg)),
        }
    }
    None
}

// ---------- entrada ----------
/// extensão e nome do arquivo em minúsculas; sem extensão, o shebang (#!/usr/bin/env python3) decide
fn names(rel_file: &str, txt: Option<&str>) -> (String, String) {
    let path = Path::new(rel_file);
    let mut ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let base = path.file_name().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ext.is_empty() { if let Some(e) = txt.and_then(formats::shebang) { ext = e.into(); } }
    (ext, base)
}
pub async fn lint(project: &Path, rel_file: &str) -> LintResult {
    let abs = project.join(rel_file);
    let (ext, _) = names(rel_file, None);
    if formats::BINARY.contains(&ext.as_str()) { return LintResult { note: Some("Binário, sem lint".into()), ..Default::default() }; }
    let bytes = match tokio::fs::read(&abs).await { Ok(b) => b, Err(e) => return LintResult { note: Some(e.to_string()), ..Default::default() } };
    let Some(txt) = formats::decode(&bytes) else { return LintResult { note: Some("Binário, sem lint".into()), ..Default::default() } };
    let (ext, base) = names(rel_file, Some(&txt));
    if let Some(mut out) = plugin_lint(project, rel_file).await {
        let mut all = generic(&txt);
        all.append(&mut out.problems);
        out.problems = all;
        return out;
    }
    let mut out = match text_rules(&ext, &base, &txt) { Some(r) => r, None => match ext.as_str() {
        "java" => java(project, &abs).await,
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" | "vue" => js(project, &abs, &ext).await,
        "sass" => wrap("sass", vec![]),
        "py" | "pyw" => py(&abs, project).await,
        "ps1" | "psm1" | "psd1" => ps1(&abs).await,
        "sh" | "bash" | "ksh" => sh(&abs).await,
        "zsh" => external(&abs, "zsh", &["-n"], "zsh -n").await,
        "fish" => external(&abs, "fish", &["--no-execute"], "fish --no-execute").await,
        "pl" | "pm" | "cgi" | "psgi" => external(&abs, "perl", &["-c"], "perl -c").await,
        "bat" | "cmd" | "btm" => wrap("bat", txt.split('\n').enumerate().filter(|(_, l)| l.matches('"').count() % 2 == 1).map(|(i, _)| p(i + 1, 1, "warning", "Aspas não fechadas", "bat")).collect()),
        "" => wrap("texto", vec![]),
        e => LintResult { tool: Some("texto".into()), note: Some(format!("Sem regras específicas para .{e}; só checagens genéricas")), ..Default::default() },
    } };
    let mut all = generic(&txt);
    all.append(&mut out.problems);
    out.problems = all;
    out
}
/// checagem de sintaxe pelo próprio interpretador (zsh -n, perl -c...), quando ele está instalado
async fn external(file: &Path, prog: &str, args: &[&str], tool: &str) -> LintResult {
    let mut a: Vec<String> = args.iter().map(|s| s.to_string()).collect(); a.push(file.to_string_lossy().into_owned());
    let a: Vec<&str> = a.iter().map(String::as_str).collect();
    let r = run(prog, &a, file.parent().unwrap_or(file), 30000).await;
    if r.not_found { return LintResult { note: Some(format!("{prog} não encontrado: sem checagem de sintaxe")), ..Default::default() }; }
    let problems = if r.ok { vec![] } else {
        // tira o caminho do arquivo da mensagem: "x.pl line 3" / "x.zsh:3:" viram só o texto do erro
        let fname = file.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        let msg = format!("{}\n{}", r.err, r.out).replace(&*file.to_string_lossy(), &fname);
        re!(r"(?m)^(.*?)(?:line |:)(\d+)[:,.]?\s*(.*)$").captures_iter(&msg).filter(|m| !m[0].contains("syntax OK")).take(20)
            .map(|m| p(m[2].parse().unwrap_or(1), 1, "error", format!("{} {}", m[1].replace(&fname, "").trim_end_matches([' ', ':', ',']), m[3].trim()).replace(" at  ", " ").trim().to_string(), prog)).collect()
    };
    LintResult { tool: Some(tool.into()), problems, ..Default::default() }
}
fn head(txt: &str) -> &str { let mut n = txt.len().min(4000); while !txt.is_char_boundary(n) { n -= 1; } &txt[..n] }
/// regras que só olham o texto (sem ferramenta externa nem o arquivo em disco): o catálogo de lint_formats.rs
fn text_rules(ext: &str, base: &str, txt: &str) -> Option<LintResult> {
    use formats::Kind::*;
    let txt = txt.strip_prefix('\u{feff}').unwrap_or(txt); // BOM do UTF-8
    let k = formats::classify(base, ext, head(txt))?;
    let problems = match &k {
        Html(t) => { let mut v = html_lint(txt, ext); if *t == "template" { v.extend(formats::template_blocks(txt)); } v }
        Xml => if ext == "dtd" { vec![] } else { xml(txt, false) },
        Json => json_lint(txt), Jsonc => formats::jsonc(txt), Jsonl => formats::jsonl(txt),
        Yaml => yaml(txt), Toml => formats::toml(txt), Ini(d) => formats::ini(txt, *d), Env => formats::dotenv(txt),
        Properties => properties(txt), Csv(d) => formats::csv(txt, *d), Css(e) => css(txt, e),
        Sql => sql(txt), Markdown => markdown(txt), Docker => formats::dockerfile(txt), Make => formats::makefile(txt),
        Latex => formats::latex(txt), Vb => formats::vb(txt), Manifest => formats::manifest(txt), Po => formats::po(txt),
        Diff => formats::diff(txt), Subs(v) => formats::subtitles(txt, *v),
        GoTpl => { let mut v = formats::go_template(txt); if txt.contains("</") { v.extend(html_lint(txt, ext)); } v }
        Code(s) => formats::code(txt, s), Plain => vec![],
    };
    Some(wrap(formats::tool(&k), problems))
}
/// lint ao vivo do editor: o texto ainda não salvo, só com as regras de texto (o resto espera o salvar).
/// live: false avisa a página que este tipo não tem lint ao vivo (ela para de mandar o texto)
pub fn lint_text(rel_file: &str, txt: &str) -> LintResult {
    let (ext, base) = names(rel_file, Some(txt));
    let Some(mut out) = text_rules(&ext, &base, txt) else { return LintResult { note: Some("Sem lint ao vivo para este tipo".into()), live: Some(false), ..Default::default() } };
    let mut all = generic(txt);
    all.append(&mut out.problems);
    out.problems = all;
    out
}
fn wrap(tool: &str, problems: Vec<Problem>) -> LintResult { LintResult { tool: Some(tool.into()), problems, ..Default::default() } }
