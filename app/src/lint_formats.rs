//! Lint dos formatos "do resto do mundo": o catálogo de extensões (e nomes de arquivo) e linters de texto leves.
//! - catálogo: cada extensão aponta para uma família; as ambíguas (.m, .v, .cls, .cl, .frm, .pl, .conf, .config...)
//!   decidem pelo começo do conteúdo;
//! - linters próprios: TOML, INI, .env, CSV/TSV, JSON com comentários e JSON Lines, Dockerfile, Makefile, LaTeX,
//!   VB/VBA, MANIFEST.MF, gettext (.po), diff/patch, legendas (SRT/VTT) e blocos de templates (Twig, Jinja,
//!   Liquid, Handlebars, Go) e Gherkin (.feature do Cucumber, Behave, SpecFlow);
//! - `Code`: verificador de pares ()[]{} com strings e comentários de cada linguagem, para centenas de linguagens
//!   sem linter embutido (shaders, Lisp, Haskell, Fortran, Pascal, Erlang, HCL, GraphQL, protobuf...).
//! Tudo só olha o texto: serve ao lint ao salvar e ao lint ao vivo do editor.
use super::{Problem, line_col, p, pl};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use regex::Regex;

macro_rules! re { ($s:expr) => {{ static R: LazyLock<Regex> = LazyLock::new(|| Regex::new($s).unwrap()); &*R }}; }

// ---------- texto: binário, UTF-16 ----------
/// bytes do arquivo -> texto; None = binário. UTF-16 com BOM (comum em .reg, .ps1 e .bat do Windows) é lido direito.
pub fn decode(b: &[u8]) -> Option<String> {
    let u16s = |le: bool| -> String {
        let v: Vec<u16> = b[2..].chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        String::from_utf16_lossy(&v)
    };
    if b.starts_with(&[0xFF, 0xFE]) { return Some(u16s(true)); }
    if b.starts_with(&[0xFE, 0xFF]) { return Some(u16s(false)); }
    if b[..b.len().min(8000)].contains(&0) { return None; }
    Some(String::from_utf8_lossy(b).into_owned())
}

// ---------- verificador de pares ----------
pub struct Spec {
    pub name: &'static str,
    line: &'static [&'static str],
    block: &'static [(&'static str, &'static str)],
    nest: bool,
    quotes: &'static [u8],
    /// \ escapa dentro da string (senão: aspa dobrada, como em SQL, Pascal e VB)
    bs: bool,
    /// strings podem atravessar linhas
    multi: bool,
    /// três aspas abrem e fecham strings longas
    triple: bool,
    /// \ fora de string escapa o próximo caractere (Lisp \(, LaTeX \{, RTF \})
    esc_out: bool,
    /// ' depois de nome, ) ] } ou ' é transposta, não string (MATLAB, Julia)
    prime: bool,
    /// caractere na coluna 1 que faz da linha um comentário (Fortran de formato fixo: C, c, *)
    col1: &'static [u8],
    pairs: &'static str,
}
const BASE: Spec = Spec { name: "código", line: &[], block: &[], nest: false, quotes: b"\"", bs: true, multi: false, triple: false, esc_out: false, prime: false, col1: &[], pairs: "()[]{}" };
const C_BLOCK: &[(&str, &str)] = &[("/*", "*/")];
pub static C_LIKE: Spec = Spec { name: "c-like", line: &["//"], block: C_BLOCK, quotes: b"\"'", ..BASE };
pub static C_NEST: Spec = Spec { name: "c-like", line: &["//"], block: C_BLOCK, nest: true, quotes: b"\"'", multi: true, triple: true, ..BASE };
pub static C_DQ: Spec = Spec { name: "c-like", line: &["//"], block: C_BLOCK, nest: true, multi: true, triple: true, ..BASE };
pub static SHADER: Spec = Spec { name: "shader", line: &["//"], block: C_BLOCK, ..BASE };
pub static HASH: Spec = Spec { line: &["#"], quotes: b"\"'", multi: true, triple: true, ..BASE };
pub static HASH_DQ: Spec = Spec { line: &["#"], multi: true, triple: true, ..BASE };
pub static HCL: Spec = Spec { name: "hcl", line: &["#", "//"], block: C_BLOCK, ..BASE };
pub static CONF: Spec = Spec { name: "conf", line: &["#"], pairs: "{}", ..BASE };
pub static CMAKE: Spec = Spec { name: "cmake", line: &["#"], block: &[("#[[", "]]")], multi: true, pairs: "()", ..BASE };
pub static NIX: Spec = Spec { name: "nix", line: &["#"], block: C_BLOCK, multi: true, ..BASE };
pub static JSONNET: Spec = Spec { name: "jsonnet", line: &["//", "#"], block: C_BLOCK, quotes: b"\"'", ..BASE };
pub static JSON5: Spec = Spec { name: "json5", line: &["//"], block: C_BLOCK, quotes: b"\"'", ..BASE };
pub static LISP: Spec = Spec { name: "lisp", line: &[";"], block: &[("#|", "|#")], nest: true, multi: true, esc_out: true, ..BASE };
pub static HASKELL: Spec = Spec { name: "haskell", line: &["--"], block: &[("{-", "-}")], nest: true, ..BASE };
pub static ML: Spec = Spec { name: "ml", block: &[("(*", "*)")], nest: true, multi: true, ..BASE };
pub static FSHARP: Spec = Spec { name: "f#", line: &["//"], block: &[("(*", "*)")], nest: true, multi: true, triple: true, ..BASE };
pub static ERLANG: Spec = Spec { name: "erlang", line: &["%"], multi: true, ..BASE };
pub static PROLOG: Spec = Spec { name: "prolog", line: &["%"], block: C_BLOCK, quotes: b"\"'", ..BASE };
pub static MATLAB: Spec = Spec { name: "matlab", line: &["%"], block: &[("%{", "%}")], quotes: b"\"'", bs: false, prime: true, ..BASE };
pub static JULIA: Spec = Spec { name: "julia", line: &["#"], block: &[("#=", "=#")], nest: true, quotes: b"\"'", multi: true, triple: true, prime: true, ..BASE };
pub static DASHDASH: Spec = Spec { line: &["--"], bs: false, pairs: "()[]", ..BASE };
pub static FORTRAN: Spec = Spec { name: "fortran", line: &["!"], quotes: b"\"'", bs: false, pairs: "()[]", ..BASE };
pub static FORTRAN_FIXED: Spec = Spec { name: "fortran", line: &["!"], quotes: b"\"'", bs: false, col1: b"cC*dD!", pairs: "()", ..BASE };
pub static PASCAL: Spec = Spec { name: "pascal", line: &["//"], block: &[("{", "}"), ("(*", "*)")], quotes: b"'", bs: false, pairs: "()[]", ..BASE };
pub static NIM: Spec = Spec { name: "nim", line: &["#"], block: &[("#[", "]#")], nest: true, multi: true, triple: true, ..BASE };
pub static COFFEE: Spec = Spec { name: "coffeescript", line: &["#"], block: &[("###", "###")], quotes: b"\"'", multi: true, triple: true, ..BASE };
pub static BRACES: Spec = Spec { name: "rtf", quotes: b"", bs: false, esc_out: true, pairs: "{}", ..BASE };
pub static BIB: Spec = Spec { name: "bibtex", line: &["%"], quotes: b"", bs: false, esc_out: true, pairs: "{}()", ..BASE };

pub fn code(txt: &str, s: &Spec) -> Vec<Problem> {
    let b = txt.as_bytes(); let n = b.len(); let mut i = 0;
    let mut o = vec![]; let mut stack: Vec<(u8, usize)> = vec![];
    let opens = s.pairs.as_bytes().iter().step_by(2).copied().collect::<Vec<_>>();
    let closes = s.pairs.as_bytes().iter().skip(1).step_by(2).copied().collect::<Vec<_>>();
    let rule = s.name;
    'scan: while i < n {
        for (a, z) in s.block {
            if b[i..].starts_with(a.as_bytes()) {
                let start = i; let mut depth = 1; i += a.len();
                while i < n {
                    if b[i..].starts_with(z.as_bytes()) { depth -= 1; i += z.len(); if depth == 0 || !s.nest { continue 'scan; } }
                    else if s.nest && b[i..].starts_with(a.as_bytes()) { depth += 1; i += a.len(); }
                    else { i += 1; }
                }
                o.push(pl(line_col(txt, start), "error", format!("Comentário {a} não fechado"), rule));
                break 'scan;
            }
        }
        for l in s.line {
            if b[i..].starts_with(l.as_bytes()) { while i < n && b[i] != b'\n' { i += 1; } continue 'scan; }
        }
        let c = b[i];
        if !s.col1.is_empty() && (i == 0 || b[i - 1] == b'\n') && s.col1.contains(&c) { while i < n && b[i] != b'\n' { i += 1; } continue; }
        if s.esc_out && c == b'\\' { i += 2; continue; }
        if s.prime && c == b'\'' && i > 0 && (b[i - 1].is_ascii_alphanumeric() || matches!(b[i - 1], b'_' | b')' | b']' | b'}' | b'.' | b'\'')) { i += 1; continue; }
        if s.quotes.contains(&c) {
            let start = i;
            if s.triple && b[i..].starts_with(&[c, c, c]) {
                match find(&b[i + 3..], &[c, c, c]) { Some(e) => { i += 3 + e + 3; continue; } None => { o.push(pl(line_col(txt, start), "error", "String de três aspas não fechada", rule)); break 'scan; } }
            }
            i += 1;
            loop {
                if i >= n { o.push(pl(line_col(txt, start), "error", "String não fechada", rule)); break 'scan; }
                let d = b[i];
                if s.bs && d == b'\\' { i += 2; continue; }
                if d == c { if !s.bs && b.get(i + 1) == Some(&c) { i += 2; continue; } i += 1; break; }
                if d == b'\n' && !s.multi { o.push(pl(line_col(txt, start), "error", "String não fechada nesta linha", rule)); i += 1; break; }
                i += 1;
            }
            continue;
        }
        if opens.contains(&c) { stack.push((c, i)); }
        else if let Some(k) = closes.iter().position(|&x| x == c) {
            let want = opens[k];
            match stack.iter().rposition(|s| s.0 == want) {
                None => o.push(pl(line_col(txt, i), "error", format!("'{}' sem '{}' correspondente", c as char, want as char), rule)),
                Some(at) => {
                    for (oc, oi) in stack[at + 1..].iter().rev() { o.push(pl(line_col(txt, *oi), "error", format!("'{}' não fechado (fechou '{}' antes)", *oc as char, c as char), rule)); }
                    stack.truncate(at);
                }
            }
            if o.len() > 50 { break; }
        }
        i += 1;
    }
    for (oc, oi) in stack.iter().take(20) { o.push(pl(line_col(txt, *oi), "error", format!("'{}' não fechado", *oc as char), rule)); }
    o
}
fn find(h: &[u8], n: &[u8]) -> Option<usize> { h.windows(n.len()).position(|w| w == n) }
fn lines(txt: &str) -> impl Iterator<Item = (usize, &str)> { txt.split('\n').enumerate().map(|(i, l)| (i + 1, l.strip_suffix('\r').unwrap_or(l))) }

// ---------- JSON com comentários / JSON Lines ----------
/// tira comentários e vírgulas finais trocando por espaços (as posições dos erros continuam certas)
pub fn jsonc(txt: &str) -> Vec<Problem> {
    let mut b = txt.trim_start_matches('\u{feff}').as_bytes().to_vec(); let n = b.len();
    // 1ª passada: comentários; 2ª: vírgula antes de } ou ] (já sem os comentários no meio)
    for pass in 0..2 {
        let mut i = 0;
        while i < n {
            match b[i] {
                b'"' => { i += 1; while i < n && b[i] != b'"' { if b[i] == b'\\' { i += 1; } i += 1; } }
                b'/' if pass == 0 && b.get(i + 1) == Some(&b'/') => { while i < n && b[i] != b'\n' { b[i] = b' '; i += 1; } continue; }
                b'/' if pass == 0 && b.get(i + 1) == Some(&b'*') => { while i < n && !(b[i] == b'*' && b.get(i + 1) == Some(&b'/')) { if b[i] != b'\n' { b[i] = b' '; } i += 1; } if i + 1 < n { b[i] = b' '; b[i + 1] = b' '; i += 1; } }
                b',' if pass == 1 => { let mut j = i + 1; while j < n && b[j].is_ascii_whitespace() { j += 1; } if j < n && (b[j] == b'}' || b[j] == b']') { b[i] = b' '; } }
                _ => {}
            }
            i += 1;
        }
    }
    super::json_lint(&String::from_utf8_lossy(&b))
}
pub fn jsonl(txt: &str) -> Vec<Problem> {
    let mut o = vec![];
    for (ln, l) in lines(txt) {
        if l.trim().is_empty() { continue; }
        if let Err(e) = serde_json::from_str::<serde_json::Value>(l) { o.push(p(ln, e.column(), "error", re!(r" at line \d+ column \d+$").replace(&e.to_string(), "").into_owned(), "jsonl")); if o.len() > 100 { break; } }
    }
    o
}

// ---------- TOML ----------
pub fn toml(txt: &str) -> Vec<Problem> {
    static HDR: LazyLock<Regex> = LazyLock::new(|| { let k = r#"(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')"#; Regex::new(&format!(r"^\[(\[)?\s*({k}(?:\s*\.\s*{k})*)\s*\](\])?\s*(#.*)?$")).unwrap() });
    static KV: LazyLock<Regex> = LazyLock::new(|| { let k = r#"(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')"#; Regex::new(&format!(r"^({k}(?:\s*\.\s*{k})*)\s*=\s*(.*)$")).unwrap() });
    let mut o = vec![]; let mut tables: HashSet<String> = HashSet::new(); let mut keys: HashSet<String> = HashSet::new();
    let mut depth = 0i32; let mut ml: Option<&str> = None; let mut cur = String::new();
    for (ln, l) in lines(txt) {
        // dentro de string de várias linhas ou de array/tabela que atravessa linhas
        let mut rest = l;
        // """ fecha e até duas aspas a mais ainda são conteúdo (""""" = fim com duas aspas no texto)
        if let Some(q) = ml { match rest.find(q) { Some(e) => { rest = &rest[e + 3..]; for _ in 0..2 { if let Some(x) = rest.strip_prefix(&q[..1]) { rest = x; } } ml = None; } None => continue } }
        let t = rest.trim();
        if depth == 0 && rest.len() == l.len() {
            if t.is_empty() || t.starts_with('#') { continue; }
            if t.starts_with('[') {
                match HDR.captures(t) {
                    Some(m) if m.get(1).is_some() == m.get(3).is_some() => {
                        let name = re!(r"\s*\.\s*").replace_all(&m[2], ".").into_owned();
                        // [[x]] começa um elemento novo: as tabelas [x.y] dele são outras
                        if m.get(1).is_some() { let pre = format!("{name}."); tables.retain(|t| !t.starts_with(&pre)); }
                        if m.get(1).is_none() && !tables.insert(name.clone()) { o.push(p(ln, 1, "error", format!("Tabela [{name}] definida duas vezes"), "toml")); }
                        cur = name; keys.clear();
                    }
                    _ => o.push(p(ln, 1, "error", "Cabeçalho de tabela inválido", "toml")),
                }
                continue;
            }
            let Some(m) = KV.captures(t) else { o.push(p(ln, 1, "error", "Linha inválida: esperava chave = valor ou [tabela]", "toml")); continue };
            let k = format!("{cur}.{}", re!(r"\s*\.\s*").replace_all(&m[1], "."));
            if !keys.insert(k.clone()) { o.push(p(ln, 1, "error", format!("Chave \"{}\" repetida na mesma tabela", &m[1]), "toml")); }
            let v = t[m.get(2).unwrap().start()..].trim();
            if v.is_empty() || v.starts_with('#') { o.push(p(ln, 1, "error", "Valor ausente depois de '='", "toml")); continue; }
            if !re!(r#"^(["'\[{]|true\b|false\b|[+-]?(inf|nan)\b|[+-]?[0-9]|0x|0o|0b)"#).is_match(v) {
                o.push(p(ln, l.find(v).unwrap_or(0) + 1, "error", "Valor inválido (texto precisa de aspas)", "toml"));
                continue;
            }
            rest = v;
        }
        // varre o valor: strings, comentários e profundidade de [ ] { }
        let b = rest.as_bytes(); let mut i = 0;
        while i < b.len() {
            let c = b[i];
            if b[i..].starts_with(b"\"\"\"") || b[i..].starts_with(b"'''") {
                let q = if c == b'"' { "\"\"\"" } else { "'''" };
                match rest[i + 3..].find(q) { Some(e) => { i += 3 + e + 3; for _ in 0..2 { if b.get(i) == Some(&c) { i += 1; } } continue; } None => { ml = Some(q); break; } }
            }
            if c == b'"' || c == b'\'' {
                let s = i; i += 1;
                while i < b.len() && b[i] != c { if c == b'"' && b[i] == b'\\' { i += 1; } i += 1; }
                if i >= b.len() { o.push(p(ln, s + 1, "error", "String não fechada", "toml")); }
                i += 1; continue;
            }
            if c == b'#' { break; }
            if c == b'[' || c == b'{' { depth += 1; } else if c == b']' || c == b'}' { depth -= 1; }
            i += 1;
        }
        if depth < 0 { o.push(p(ln, 1, "error", "']' ou '}' sem abertura", "toml")); depth = 0; }
    }
    if ml.is_some() { o.push(p(1, 1, "error", "String de várias linhas não fechada", "toml")); }
    if depth > 0 { o.push(p(1, 1, "error", "Array ou tabela inline não fechada", "toml")); }
    o
}

// ---------- INI / .env ----------
pub fn ini(txt: &str, dup_keys: bool) -> Vec<Problem> {
    let mut o = vec![]; let mut sections: HashMap<String, usize> = HashMap::new(); let mut keys: HashMap<String, usize> = HashMap::new();
    for (ln, l) in lines(txt) {
        let t = l.trim();
        if t.is_empty() || t.starts_with(';') || t.starts_with('#') { continue; }
        if t.starts_with('[') {
            let Some(end) = t.find(']') else { o.push(p(ln, 1, "error", "Seção sem ']'", "ini")); continue };
            let after = t[end + 1..].trim();
            if !after.is_empty() && !after.starts_with(';') && !after.starts_with('#') { o.push(p(ln, end + 2, "warning", "Texto depois de ']'", "ini")); }
            let name = t[1..end].trim().to_string();
            if let Some(at) = sections.get(&name.to_lowercase()) { if dup_keys { o.push(p(ln, 1, "warning", format!("Seção [{name}] repetida (também na linha {at})"), "ini")); } }
            else { sections.insert(name.to_lowercase(), ln); }
            keys.clear(); continue;
        }
        if !dup_keys || l.starts_with([' ', '\t']) { continue; } // linha recuada: continuação do valor anterior
        if let Some(k) = t.split(['=', ':']).next().map(|k| k.trim().to_lowercase()).filter(|k| !k.is_empty() && t.contains(['=', ':']) && !k.starts_with(['+', '-', '.', '!', '%'])) {
            if let Some(at) = keys.get(&k) { o.push(p(ln, 1, "warning", format!("Chave \"{k}\" repetida na seção (também na linha {at})"), "ini")); } else { keys.insert(k, ln); }
        }
    }
    o
}
pub fn dotenv(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut seen: HashMap<String, usize> = HashMap::new(); let all: Vec<(usize, &str)> = lines(txt).collect();
    let mut skip_to = 0;
    for &(ln, l) in &all {
        if ln <= skip_to { continue; }
        let t = l.trim(); if t.is_empty() || t.starts_with('#') { continue; }
        let Some(m) = re!(r"^(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)(\s*)=(\s*)(.*)$").captures(t) else { o.push(p(ln, 1, "error", "Linha inválida: esperava NOME=valor", "env")); continue };
        let name = m[2].to_string();
        if !m[3].is_empty() || !m[4].is_empty() { o.push(p(ln, 1, "warning", "Espaço em volta do '=' (o shell e vários carregadores de .env não aceitam)", "env")); }
        if let Some(at) = seen.get(&name) { o.push(p(ln, 1, "warning", format!("{name} definido de novo (também na linha {at})"), "env")); } else { seen.insert(name, ln); }
        let v = &m[5];
        if let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'' || *c == '`') {
            if v.len() > 1 && v[1..].contains(q) { continue; }
            // aspas abertas: o valor pode seguir nas próximas linhas
            match all.iter().find(|(k, x)| *k > ln && x.contains(q)) { Some((k, _)) => skip_to = *k, None => o.push(p(ln, 1, "error", "Aspas não fechadas no valor", "env")) }
        }
    }
    o
}

// ---------- CSV / TSV ----------
pub fn csv(txt: &str, delim: Option<u8>) -> Vec<Problem> {
    let mut t = txt.trim_start_matches('\u{feff}'); let mut line0 = 1;
    // "sep=;" na 1ª linha (Excel) escolhe o separador
    let mut delim = delim;
    if let Some(rest) = t.strip_prefix("sep=") { delim = rest.bytes().next().or(delim); t = rest.split_once('\n').map(|x| x.1).unwrap_or(""); line0 = 2; }
    let b = t.as_bytes();
    let first = t.lines().next().unwrap_or("");
    let d = delim.unwrap_or_else(|| [b',', b';', b'\t', b'|'].into_iter().max_by_key(|c| first.bytes().filter(|x| x == c).count()).unwrap_or(b','));
    let mut o = vec![]; let (mut i, mut line, mut fields, mut row_line) = (0, line0, 1usize, line0); let mut expect: Option<usize> = None; let mut bad = 0;
    let mut at_start = true; let mut empty_row = true;
    let mut end_row = |fields: usize, row_line: usize, empty: bool, o: &mut Vec<Problem>| {
        if empty { return; }
        match expect { None => expect = Some(fields), Some(e) if e != fields => { bad += 1; if bad <= 30 { o.push(p(row_line, 1, "warning", format!("{fields} colunas (o cabeçalho tem {e})"), "csv")); } } _ => {} }
    };
    while i < b.len() {
        let c = b[i];
        if empty_row && c == b'#' { while i < b.len() && b[i] != b'\n' { i += 1; } continue; } // linha de comentário
        if at_start && c == b'"' {
            let s = i; i += 1;
            loop {
                if i >= b.len() { o.push(p(line, 1, "error", "Aspas não fechadas (o resto do arquivo virou um campo)", "csv")); let _ = s; return o; }
                if b[i] == b'"' { if b.get(i + 1) == Some(&b'"') { i += 2; continue; } i += 1; break; }
                if b[i] == b'\n' { line += 1; }
                i += 1;
            }
            at_start = false; empty_row = false; continue;
        }
        if c == d { fields += 1; at_start = true; empty_row = false; }
        else if c == b'\n' { end_row(fields, row_line, empty_row, &mut o); line += 1; row_line = line; fields = 1; at_start = true; empty_row = true; }
        else if c != b'\r' { at_start = false; empty_row = false; }
        i += 1;
    }
    end_row(fields, row_line, empty_row, &mut o);
    if bad > 30 { o.push(p(1, 1, "warning", format!("{bad} linhas com número de colunas diferente do cabeçalho"), "csv")); }
    o
}

// ---------- Dockerfile ----------
pub fn dockerfile(txt: &str) -> Vec<Problem> {
    const INS: &[&str] = &["FROM", "RUN", "CMD", "LABEL", "MAINTAINER", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT", "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL"];
    let mut o = vec![]; let mut cont = false; let mut heredoc: Option<String> = None; let mut seen_from = false;
    let esc = if re!(r"(?im)^#\s*escape\s*=\s*`").is_match(txt) { '`' } else { '\\' };
    for (ln, l) in lines(txt) {
        if let Some(h) = &heredoc { if l.trim() == h { heredoc = None; } continue; }
        let t = l.trim();
        if t.is_empty() || t.starts_with('#') { continue; }
        if !cont {
            let word = t.split_whitespace().next().unwrap_or("");
            let up = word.to_uppercase();
            if !INS.contains(&up.as_str()) { o.push(p(ln, 1, "error", format!("Instrução desconhecida: {word}"), "dockerfile")); }
            else {
                if up == "MAINTAINER" { o.push(p(ln, 1, "warning", "MAINTAINER está obsoleto: use LABEL maintainer=\"...\"", "dockerfile")); }
                if up == "FROM" { seen_from = true; } else if up != "ARG" && !seen_from { o.push(p(ln, 1, "error", format!("{up} antes do primeiro FROM"), "dockerfile")); seen_from = true; }
                if t.split_whitespace().nth(1).is_none() { o.push(p(ln, 1, "error", format!("{up} sem argumentos"), "dockerfile")); }
            }
        }
        if let Some(m) = re!(r#"<<-?["']?([A-Za-z_]\w*)["']?"#).captures(t) { heredoc = Some(m[1].to_string()); }
        cont = t.ends_with(esc);
    }
    if !seen_from && !txt.trim().is_empty() { o.push(p(1, 1, "error", "Nenhum FROM no arquivo", "dockerfile")); }
    o
}

// ---------- Makefile ----------
pub fn makefile(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut cond: Vec<usize> = vec![]; let mut define: Option<usize> = None;
    let mut in_rule = false; let mut cont = false;
    for (ln, l) in lines(txt) {
        let was_cont = cont; cont = l.ends_with('\\');
        if was_cont { continue; }
        let t = l.trim();
        if let Some(_) = define { if re!(r"^endef\b").is_match(t) { define = None; } continue; }
        if t.is_empty() { continue; }
        if l.starts_with('\t') { continue; }
        if t.starts_with('#') { continue; }
        let word = t.split_whitespace().next().unwrap_or("");
        match word.trim_start_matches('-') {
            "ifeq" | "ifneq" | "ifdef" | "ifndef" | "if" => { cond.push(ln); continue; } // "if COND" é do automake
            "else" => { if cond.is_empty() { o.push(p(ln, 1, "error", "else sem if", "make")); } continue; }
            "endif" => { if cond.pop().is_none() { o.push(p(ln, 1, "error", "endif sem if", "make")); } continue; }
            "define" => { define = Some(ln); continue; }
            "endef" => { o.push(p(ln, 1, "error", "endef sem define", "make")); continue; }
            _ => {}
        }
        if l.starts_with(' ') && in_rule && !re!(r"^\s*[\w.$(){}-]+\s*(\?|\+|:{1,3}|!)?=").is_match(l) {
            o.push(p(ln, 1, "error", "Receita recuada com espaços: o make exige TAB (\"missing separator\")", "make"));
            continue;
        }
        if l.starts_with(' ') { continue; }
        in_rule = re!(r"^[^=#]*[^:=]:([^=]|$)").is_match(t) && !re!(r"^[\w.$(){}-]+\s*(\?|\+|:{1,3}|!)?=").is_match(t);
    }
    if let Some(at) = define { o.push(p(at, 1, "error", "define sem endef", "make")); }
    for at in cond { o.push(p(at, 1, "error", "if sem endif", "make")); }
    o
}

// ---------- LaTeX ----------
pub fn latex(txt: &str) -> Vec<Problem> {
    const VERB: &[&str] = &["verbatim", "verbatim*", "lstlisting", "minted", "comment", "Verbatim", "alltt", "filecontents", "filecontents*"];
    let b = txt.as_bytes(); let n = b.len(); let mut i = 0; let mut o = vec![];
    let mut braces: Vec<usize> = vec![]; let mut envs: Vec<(String, usize)> = vec![];
    while i < n {
        match b[i] {
            b'%' => { while i < n && b[i] != b'\n' { i += 1; } continue; }
            b'{' => braces.push(i),
            b'}' => { if braces.pop().is_none() { o.push(pl(line_col(txt, i), "error", "'}' sem '{'", "latex")); } }
            b'\\' => {
                let rest = &txt[i..];
                if let Some(m) = re!(r"^\\(begin|end)\s*\{([^}]*)\}").captures(rest) {
                    let name = m[2].to_string(); let len = m[0].len();
                    if &m[1] == "begin" {
                        if VERB.contains(&name.as_str()) {
                            match txt[i + len..].find(&format!("\\end{{{name}}}")) { Some(e) => { i += len + e + name.len() + 6; continue; } None => { o.push(pl(line_col(txt, i), "error", format!("\\begin{{{name}}} sem \\end"), "latex")); break; } }
                        }
                        envs.push((name, i));
                    } else {
                        match envs.iter().rposition(|e| e.0 == name) {
                            None => o.push(pl(line_col(txt, i), "error", format!("\\end{{{name}}} sem \\begin"), "latex")),
                            Some(at) => { for e in envs[at + 1..].iter().rev() { o.push(pl(line_col(txt, e.1), "error", format!("\\begin{{{}}} não fechado (fechou {name} antes)", e.0), "latex")); } envs.truncate(at); }
                        }
                    }
                    i += len; continue;
                }
                if let Some(m) = re!(r"^\\verb\*?(.)").captures(rest) {
                    let d = &m[1]; let s = i + m[0].len();
                    match txt[s..].find(d) { Some(e) => { i = s + e + d.len(); continue; } None => { i = s; continue; } }
                }
                i += 2; continue;
            }
            _ => {}
        }
        i += 1;
    }
    for at in braces.iter().take(20) { o.push(pl(line_col(txt, *at), "error", "'{' não fechado", "latex")); }
    for e in envs { o.push(pl(line_col(txt, e.1), "error", format!("\\begin{{{}}} sem \\end", e.0), "latex")); }
    o
}

// ---------- VB / VBA / VBScript ----------
pub fn vb(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut stack: Vec<(&'static str, usize)> = vec![]; let mut joined = String::new(); let mut start = 0;
    let close = |o: &mut Vec<Problem>, stack: &mut Vec<(&'static str, usize)>, want: &'static str, ln: usize, word: &str| {
        match stack.iter().rposition(|s| s.0 == want) {
            None => o.push(p(ln, 1, "error", format!("{word} sem {want} correspondente"), "vb")),
            Some(at) => { for s in stack[at + 1..].iter().rev() { o.push(p(s.1, 1, "error", format!("{} não fechado (veio {word} antes)", s.0), "vb")); } stack.truncate(at); }
        }
    };
    for (ln, l) in lines(txt) {
        if joined.is_empty() { start = ln; }
        // tira o comentário (' fora de string) e confere as aspas da linha
        let mut code = String::new(); let mut q = false;
        for ch in l.chars() { if ch == '"' { q = !q; } if ch == '\'' && !q { break; } code.push(ch); }
        if q { o.push(p(ln, 1, "error", "String não fechada nesta linha", "vb")); }
        let c = code.trim_end();
        if let Some(x) = c.strip_suffix(" _") { joined.push_str(x); joined.push(' '); continue; }
        joined.push_str(c);
        let t = re!(r#""[^"]*""#).replace_all(joined.trim(), "\"\"").into_owned(); joined.clear();
        let ln = start;
        if t.is_empty() || t.starts_with('#') || re!(r"(?i)^rem\b").is_match(&t) { continue; }
        // vários comandos na linha (a : b) contam separados, menos rótulos
        for st in t.split(':').map(str::trim) {
            let s = re!(r"(?i)^((public|private|friend|protected|static|shared|overrides|overridable|overloads|shadows|notinheritable|mustinherit|partial|default|readonly|writeonly|async|iterator)\s+)*").replace(st, "").into_owned();
            let low = s.to_lowercase();
            let w: Vec<&str> = low.split_whitespace().collect();
            let (a, b2) = (w.first().copied().unwrap_or(""), w.get(1).copied().unwrap_or(""));
            // dentro de Interface os Sub/Function são só assinaturas (VB.NET)
            let iface = stack.iter().any(|s| s.0 == "Interface");
            match (a, b2) {
                ("declare" | "mustoverride" | "delegate" | "exit" | "event", _) => {}
                ("interface", _) => stack.push(("Interface", ln)),
                ("end", "interface") => close(&mut o, &mut stack, "Interface", ln, "End Interface"),
                ("sub" | "function", _) if !iface => stack.push((if a == "sub" { "Sub" } else { "Function" }, ln)),
                // só a Property do VBA (Get/Let/Set); a do VB.NET pode ser automática, sem End Property
                ("property", "get" | "let" | "set") if !iface => stack.push(("Property", ln)),
                ("if", _) | ("else", "if") if re!(r"(?i)\bthen$").is_match(&s) => stack.push(("If", ln)),
                ("end", "property") if !stack.iter().any(|s| s.0 == "Property") => {}
                ("for", _) => stack.push(("For", ln)),
                ("do", _) => stack.push(("Do", ln)),
                ("while", _) => stack.push(("While", ln)),
                ("with", _) => stack.push(("With", ln)),
                ("select", "case") => stack.push(("Select", ln)),
                ("next", _) => close(&mut o, &mut stack, "For", ln, "Next"),
                ("loop", _) => close(&mut o, &mut stack, "Do", ln, "Loop"),
                ("wend", _) => close(&mut o, &mut stack, "While", ln, "Wend"),
                ("end", x) => {
                    let (want, word) = match x { "sub" => ("Sub", "End Sub"), "function" => ("Function", "End Function"), "property" => ("Property", "End Property"), "if" => ("If", "End If"), "with" => ("With", "End With"), "select" => ("Select", "End Select"), "while" => ("While", "End While"), _ => continue };
                    close(&mut o, &mut stack, want, ln, word);
                }
                _ => {}
            }
        }
    }
    for s in stack.iter().take(20) { o.push(p(s.1, 1, "error", format!("{} sem fechamento", s.0), "vb")); }
    o
}

// ---------- MANIFEST.MF, gettext, diff, legendas ----------
pub fn manifest(txt: &str) -> Vec<Problem> {
    let mut o = vec![];
    for (ln, l) in lines(txt) {
        if l.len() > 72 { o.push(p(ln, 73, "error", format!("Linha com {} bytes: o MANIFEST.MF aceita no máximo 72 (continue na linha seguinte começando com um espaço)", l.len()), "manifest")); }
        if l.is_empty() || l.starts_with(' ') { continue; }
        if !re!(r"^[A-Za-z0-9][A-Za-z0-9_-]*: ").is_match(l) && !re!(r"^[A-Za-z0-9][A-Za-z0-9_-]*:$").is_match(l) { o.push(p(ln, 1, "error", "Esperava \"Nome: valor\"", "manifest")); }
    }
    if !txt.is_empty() && !txt.ends_with('\n') { o.push(p(txt.lines().count(), 1, "warning", "Última linha sem quebra: o Java ignora o último atributo", "manifest")); }
    o
}
pub fn po(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut ids: HashMap<String, usize> = HashMap::new();
    let mut cur: Option<(usize, String, String, bool)> = None; // (linha, msgctxt, msgid, tem msgstr)
    let mut last = "";
    let mut flush = |cur: &mut Option<(usize, String, String, bool)>, o: &mut Vec<Problem>| {
        if let Some((ln, ctx, id, has)) = cur.take() {
            if !has { o.push(p(ln, 1, "error", "msgid sem msgstr", "po")); }
            let k = format!("{ctx}\u{4}{id}");
            if !(id.is_empty() && ctx.is_empty()) { if let Some(at) = ids.get(&k) { o.push(p(ln, 1, "error", format!("msgid repetido (também na linha {at})"), "po")); } else { ids.insert(k, ln); } }
        }
    };
    let mut ctx = String::new();
    for (ln, l) in lines(txt) {
        let t = l.trim();
        if t.is_empty() || t.starts_with('#') { continue; }
        let (kw, val) = match t.find(' ') { Some(s) if !t.starts_with('"') => (&t[..s], t[s..].trim()), _ => ("", t) };
        if !val.starts_with('"') || !re!(r#"^"(?:[^"\\]|\\.)*"$"#).is_match(val) { o.push(p(ln, 1, "error", "String mal formada (aspas ou escape)", "po")); continue; }
        let s = &val[1..val.len() - 1];
        match kw {
            "msgctxt" => { flush(&mut cur, &mut o); ctx = s.into(); last = "msgctxt"; }
            "msgid" => { if last != "msgctxt" { flush(&mut cur, &mut o); ctx.clear(); } cur = Some((ln, std::mem::take(&mut ctx), s.into(), false)); last = "msgid"; }
            "msgid_plural" => { last = "msgid_plural"; }
            k if k == "msgstr" || k.starts_with("msgstr[") => { match cur.as_mut() { Some(c) => c.3 = true, None => o.push(p(ln, 1, "error", "msgstr sem msgid", "po")) } last = "msgstr"; }
            "" => { if last == "msgid" { if let Some(c) = cur.as_mut() { c.2.push_str(s); } } }
            k => o.push(p(ln, 1, "error", format!("Palavra-chave desconhecida: {k}"), "po")),
        }
    }
    flush(&mut cur, &mut o);
    o
}
pub fn diff(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut hunk: Option<(usize, usize, usize, usize, usize)> = None; // (linha, esperado -, esperado +, visto -, visto +)
    let check = |h: Option<(usize, usize, usize, usize, usize)>, o: &mut Vec<Problem>| {
        if let Some((ln, a, b, x, y)) = h { if a != x || b != y { o.push(p(ln, 1, "error", format!("Hunk anuncia -{a} +{b} linhas mas tem -{x} +{y}"), "diff")); } }
    };
    for (ln, l) in lines(txt) {
        if let Some(m) = re!(r"^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@").captures(l) {
            check(hunk.take(), &mut o);
            let n = |g: Option<regex::Match>| g.map(|x| x.as_str().parse().unwrap_or(0)).unwrap_or(1);
            hunk = Some((ln, n(m.get(1)), n(m.get(2)), 0, 0)); continue;
        }
        let Some(h) = hunk.as_mut() else { continue };
        if h.3 >= h.1 && h.4 >= h.2 { check(hunk.take(), &mut o); continue; }
        match l.as_bytes().first() {
            Some(b' ') => { h.3 += 1; h.4 += 1; }
            Some(b'-') => h.3 += 1,
            Some(b'+') => h.4 += 1,
            Some(b'\\') => {}
            None => { h.3 += 1; h.4 += 1; } // linha de contexto vazia que perdeu o espaço
            _ => { check(hunk.take(), &mut o); }
        }
    }
    check(hunk, &mut o);
    o
}
pub fn subtitles(txt: &str, vtt: bool) -> Vec<Problem> {
    let mut o = vec![];
    let t = txt.trim_start_matches('\u{feff}');
    if vtt && !t.starts_with("WEBVTT") { o.push(p(1, 1, "error", "Arquivo WebVTT precisa começar com WEBVTT", "vtt")); }
    let ms = |s: &str| -> Option<u64> {
        let m = re!(r"^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$").captures(s)?;
        Some(((m.get(1).map(|x| x.as_str().parse::<u64>().unwrap_or(0)).unwrap_or(0) * 60 + m[2].parse::<u64>().ok()?) * 60 + m[3].parse::<u64>().ok()?) * 1000 + m[4].parse::<u64>().ok()?)
    };
    let mut prev_idx: Option<u64> = None;
    for (ln, l) in lines(t) {
        if let Some((a, b)) = l.split_once("-->") {
            let a = a.trim(); let b = b.trim().split_whitespace().next().unwrap_or("");
            let sep_ok = if vtt { !a.contains(',') && !b.contains(',') } else { a.contains(',') && b.contains(',') };
            match (ms(a), ms(b)) {
                (Some(x), Some(y)) if sep_ok => { if y <= x { o.push(p(ln, 1, "error", "Tempo final antes do inicial", if vtt { "vtt" } else { "srt" })); } }
                _ => o.push(p(ln, 1, "error", if vtt { "Tempo inválido (use 00:00:01.000 --> 00:00:02.000)" } else { "Tempo inválido (use 00:00:01,000 --> 00:00:02,000)" }, if vtt { "vtt" } else { "srt" })),
            }
        } else if !vtt && re!(r"^\d+$").is_match(l.trim()) {
            let n: u64 = l.trim().parse().unwrap_or(0);
            if let Some(pv) = prev_idx { if n != pv + 1 && n > pv { o.push(p(ln, 1, "warning", format!("Numeração pulou de {pv} para {n}"), "srt")); } }
            prev_idx = Some(n);
        }
    }
    o
}

// ---------- blocos de templates ----------
/// {% if %}...{% endif %} (Twig, Jinja, Django, Nunjucks, Liquid), {{#if}}...{{/if}} (Handlebars, Mustache) e
/// {{if}}...{{end}} (templates do Go)
pub fn template_blocks(txt: &str) -> Vec<Problem> {
    let mut o = vec![];
    // o que não é lógica vira espaço (as posições continuam certas): {# #}, {% raw/comment/verbatim %}...{% end... %}
    let mut clean = txt.to_string();
    for r in [re!(r"(?s)\{#.*?#\}"), re!(r"(?s)\{%-?\s*raw\s*-?%\}.*?\{%-?\s*endraw\s*-?%\}"), re!(r"(?s)\{%-?\s*comment\s*-?%\}.*?\{%-?\s*endcomment\s*-?%\}"), re!(r"(?s)\{%-?\s*verbatim\s*-?%\}.*?\{%-?\s*endverbatim\s*-?%\}"), re!(r"(?s)\{\{!--.*?--\}\}|\{\{![^}]*\}\}")] {
        clean = r.replace_all(&clean, |m: &regex::Captures| m[0].chars().map(|c| if c == '\n' { "\n".to_string() } else { " ".repeat(c.len_utf8()) }).collect::<String>()).into_owned();
    }
    let txt = clean.as_str();
    // Jinja / Twig / Liquid: um nome é bloco se o arquivo tem o "endNOME"
    let tags: Vec<(usize, String, String)> = re!(r"(?s)\{%-?\s*(\w+)(.*?)-?%\}").captures_iter(txt).map(|m| (m.get(0).unwrap().start(), m[1].to_string(), m[2].to_string())).collect();
    if !tags.is_empty() {
        let ends: HashSet<String> = tags.iter().filter_map(|t| t.1.strip_prefix("end").map(String::from)).collect();
        let mut st: Vec<(String, usize)> = vec![];
        for (at, name, args) in &tags {
            if let Some(base) = name.strip_prefix("end") {
                if !base.is_empty() && ends.contains(base) {
                    match st.iter().rposition(|s| s.0 == base) {
                        None => o.push(pl(line_col(txt, *at), "error", format!("{{% {name} %}} sem {{% {base} %}}"), "template")),
                        Some(k) => { for s in st[k + 1..].iter().rev() { o.push(pl(line_col(txt, s.1), "error", format!("{{% {} %}} não fechado (veio {name} antes)", s.0), "template")); } st.truncate(k); }
                    }
                    continue;
                }
            }
            if ends.contains(name.as_str()) && !(name == "set" && args.contains('=')) { st.push((name.clone(), *at)); }
        }
        for s in st { o.push(pl(line_col(txt, s.1), "error", format!("{{% {} %}} sem {{% end{} %}}", s.0, s.0), "template")); }
    }
    // Handlebars / Mustache
    let mut st: Vec<(String, usize)> = vec![];
    for m in re!(r"\{\{~?\s*([#^/])\s*[>*]?\s*([\w./-]+)").captures_iter(txt) {
        let at = m.get(0).unwrap().start(); let name = m[2].to_string();
        if &m[1] != "/" { st.push((name, at)); continue; }
        match st.iter().rposition(|s| s.0 == name) {
            None => o.push(pl(line_col(txt, at), "error", format!("{{{{/{name}}}}} sem abertura"), "template")),
            Some(k) => { for s in st[k + 1..].iter().rev() { o.push(pl(line_col(txt, s.1), "error", format!("{{{{#{}}}}} não fechado", s.0), "template")); } st.truncate(k); }
        }
    }
    for s in st { o.push(pl(line_col(txt, s.1), "error", format!("{{{{#{}}}}} sem {{{{/{}}}}}", s.0, s.0), "template")); }
    o
}
pub fn go_template(txt: &str) -> Vec<Problem> {
    let mut o = vec![]; let mut st: Vec<(String, usize)> = vec![];
    for m in re!(r"\{\{-?\s*(if|range|with|define|block|end)\b").captures_iter(txt) {
        let at = m.get(0).unwrap().start();
        if &m[1] == "end" { if st.pop().is_none() { o.push(pl(line_col(txt, at), "error", "{{end}} sem abertura", "gotemplate")); } }
        else { st.push((m[1].to_string(), at)); }
    }
    for s in st { o.push(pl(line_col(txt, s.1), "error", format!("{{{{{}}}}} sem {{{{end}}}}", s.0), "gotemplate")); }
    o
}

// ---------- Gherkin (.feature: Cucumber, Behave, SpecFlow/Reqnroll, pytest-bdd, Karate) ----------
/// palavras-chave de um idioma (as do gherkin-languages.json do Cucumber); as dos passos sem o espaço do fim
struct Dialect {
    feature: &'static [&'static str], rule: &'static [&'static str], background: &'static [&'static str], scenario: &'static [&'static str],
    outline: &'static [&'static str], examples: &'static [&'static str],
    given: &'static [&'static str], when: &'static [&'static str], then: &'static [&'static str], and: &'static [&'static str], but: &'static [&'static str],
}
const GH_EN: Dialect = Dialect {
    feature: &["Feature", "Business Need", "Ability"], rule: &["Rule"], background: &["Background"], scenario: &["Example", "Scenario"],
    outline: &["Scenario Outline", "Scenario Template"], examples: &["Examples", "Scenarios"],
    given: &["Given"], when: &["When"], then: &["Then"], and: &["And"], but: &["But"],
};
const GH_PT: Dialect = Dialect {
    feature: &["Funcionalidade", "Característica", "Caracteristica"], rule: &["Regra"], background: &["Contexto", "Cenário de Fundo", "Cenario de Fundo", "Fundo"],
    scenario: &["Exemplo", "Cenário", "Cenario"], outline: &["Esquema do Cenário", "Esquema do Cenario", "Delineação do Cenário", "Delineacao do Cenario"],
    examples: &["Exemplos", "Cenários", "Cenarios"],
    given: &["Dado", "Dada", "Dados", "Dadas"], when: &["Quando"], then: &["Então", "Entao"], and: &["E"], but: &["Mas"],
};
const GH_ES: Dialect = Dialect {
    feature: &["Característica", "Necesidad del negocio", "Requisito"], rule: &["Regla", "Regla de negocio"], background: &["Antecedentes"],
    scenario: &["Ejemplo", "Escenario"], outline: &["Esquema del escenario"], examples: &["Ejemplos"],
    given: &["Dado", "Dada", "Dados", "Dadas"], when: &["Cuando"], then: &["Entonces"], and: &["Y", "E"], but: &["Pero"],
};
#[derive(Clone, Copy, PartialEq)]
enum GhHead { Feature, Rule, Background, Scenario, Outline, Examples }
/// E / Mas / * continuam o tipo do passo anterior
#[derive(Clone, Copy, PartialEq)]
enum GhStep { Given, When, Then, Cont }
fn gh_head<'t>(d: &Dialect, t: &'t str) -> Option<(GhHead, &'t str)> {
    use GhHead::*;
    for (list, h) in [(d.feature, Feature), (d.rule, Rule), (d.background, Background), (d.outline, Outline), (d.scenario, Scenario), (d.examples, Examples)] {
        for kw in list { if let Some(name) = t.strip_prefix(kw).and_then(|r| r.strip_prefix(':')) { return Some((h, name.trim())); } }
    }
    None
}
fn gh_step(d: &Dialect, t: &str) -> Option<(GhStep, &'static str)> {
    use GhStep::*;
    if t.starts_with("* ") { return Some((Cont, "*")); }
    for (list, s) in [(d.given, Given), (d.when, When), (d.then, Then), (d.and, Cont), (d.but, Cont)] {
        for kw in list { if t.strip_prefix(kw).is_some_and(|r| r.starts_with(' ')) { return Some((s, kw)); } }
    }
    None
}
/// células de uma linha de tabela (`| a | b \| c |`) e o que sobra depois do último '|'
fn gh_cells(t: &str) -> (Vec<String>, String) {
    let (mut cells, mut cur, mut esc) = (vec![], String::new(), false);
    for ch in t.chars().skip(1) {
        if esc { if ch != '|' && ch != '\\' { cur.push('\\'); } cur.push(ch); esc = false; }
        else if ch == '\\' { esc = true; }
        else if ch == '|' { cells.push(cur.trim().to_string()); cur.clear(); }
        else { cur.push(ch); }
    }
    (cells, cur)
}
/// `<coluna>` usadas na linha (passo, título, tabela ou docstring de um Esquema do Cenário)
fn gh_uses(l: &str, ln: usize, out: &mut Vec<(String, usize, usize)>) {
    for m in re!(r"<([^<>\s][^<>]*)>").captures_iter(l) { out.push((m[1].to_string(), ln, l[..m.get(0).unwrap().start()].chars().count() + 1)); }
}
struct GhExamples { line: usize, col: usize, header: Option<Vec<String>>, rows: usize }
struct GhScenario { line: usize, col: usize, bg: bool, outline: bool, steps: usize, uses: Vec<(String, usize, usize)>, examples: Vec<GhExamples> }
fn gh_close(sc: Option<GhScenario>, o: &mut Vec<Problem>) {
    let Some(sc) = sc else { return };
    if sc.bg { if sc.steps == 0 { o.push(p(sc.line, sc.col, "warning", "Contexto (Background) sem passos", "no-empty-background")); } return; }
    if sc.steps == 0 { o.push(p(sc.line, sc.col, "warning", "Cenário sem passos", "no-empty-scenario")); }
    if sc.examples.is_empty() {
        if sc.outline { o.push(p(sc.line, sc.col, "warning", "Esquema do Cenário sem Exemplos (Examples): não roda nenhuma vez", "gherkin")); }
        else if let Some((n, l, c)) = sc.uses.first() { o.push(p(*l, *c, "info", format!("<{n}> só é trocado por valor num cenário com Exemplos (Examples)"), "gherkin")); }
        return;
    }
    let mut cols: HashSet<&str> = HashSet::new();
    for ex in &sc.examples {
        match &ex.header {
            None => o.push(p(ex.line, ex.col, "warning", "Exemplos (Examples) sem tabela", "gherkin")),
            Some(h) => { if ex.rows == 0 { o.push(p(ex.line, ex.col, "warning", "Exemplos só com o cabeçalho: nenhuma linha para rodar", "gherkin")); } cols.extend(h.iter().map(String::as_str)); }
        }
    }
    if cols.is_empty() { return; }
    for (n, l, c) in &sc.uses { if !cols.contains(n.as_str()) { o.push(p(*l, *c, "warning", format!("<{n}> não é coluna dos Exemplos: fica no texto sem trocar"), "no-undefined-variables")); } }
    let used: HashSet<&str> = sc.uses.iter().map(|u| u.0.as_str()).collect();
    for ex in &sc.examples {
        for c in ex.header.iter().flatten().filter(|c| !c.is_empty() && !used.contains(c.as_str())) {
            o.push(p(ex.line, ex.col, "warning", format!("Coluna \"{c}\" dos Exemplos não é usada em nenhum passo"), "no-unused-variables"));
        }
    }
}
/// estrutura do Gherkin como o parser oficial do Cucumber cobra (uma Funcionalidade, Contexto antes dos Cenários,
/// passos só dentro de Cenário/Contexto, tabelas com o mesmo número de células, docstrings fechadas, tags com @)
/// e as regras mais usadas do gherkin-lint (cenários sem nome, repetidos, vazios, colunas dos Exemplos sem uso).
/// Idiomas: en (padrão), pt e es pelo `# language:`; nos outros, só tabelas, docstrings e tags.
pub fn gherkin(txt: &str) -> Vec<Problem> {
    use GhHead::*;
    let mut o = vec![];
    let lang = lines(txt).take_while(|(_, l)| { let t = l.trim(); t.is_empty() || t.starts_with('#') })
        .find_map(|(ln, l)| re!(r"^\s*#\s*language\s*:\s*([\w-]+)").captures(l).map(|m| (ln, m[1].to_lowercase())));
    let d: Option<&Dialect> = match lang.as_ref().map(|x| x.1.as_str()) {
        None | Some("en") => Some(&GH_EN),
        Some("pt" | "pt-br" | "pt_br" | "pt-pt") => Some(&GH_PT),
        Some("es") => Some(&GH_ES),
        Some(x) => { o.push(p(lang.as_ref().map_or(1, |l| l.0), 1, "info", format!("Idioma \"{x}\" sem dicionário no lint embutido: só tabelas, docstrings e tags são conferidas"), "gherkin")); None }
    };
    let mut feature: Option<usize> = None;
    let (mut scenarios, mut content, mut early) = (0usize, false, false);
    let (mut bg_seen, mut sc_seen) = (false, false); // no escopo atual (Funcionalidade ou Regra)
    let mut names: HashMap<String, usize> = HashMap::new();
    let mut cur: Option<GhScenario> = None; // Cenário ou Contexto aberto
    let mut in_examples = false;
    let mut desc_ok = false; // texto livre (descrição) só logo depois de um cabeçalho
    let mut arg = 0u8; // o que uma tabela pode ser aqui: 0 nada, 1 argumento do passo, 2 tabela dos Exemplos
    let mut width: Option<(usize, usize)> = None; // tabela atual: (células, linha da primeira)
    let mut doc: Option<(&str, usize, usize)> = None; // docstring aberta: (delimitador, linha, coluna)
    let mut tags: Option<usize> = None; // linha das tags que esperam um cabeçalho
    let mut last: Option<GhStep> = None;
    for (ln, l) in lines(txt) {
        if o.len() > 200 { break; }
        let t = l.trim(); let col = l.chars().take_while(|c| c.is_whitespace()).count() + 1;
        if let Some((delim, ..)) = doc {
            if t == delim { doc = None; arg = 0; } else if let Some(sc) = cur.as_mut().filter(|s| !s.bg) { gh_uses(l, ln, &mut sc.uses); }
            continue;
        }
        if t.is_empty() || t.starts_with('#') { continue; }
        content = true;
        if !t.starts_with('|') { width = None; }
        if t.starts_with('@') {
            let mut seen = HashSet::new();
            for tok in t.split_whitespace() {
                if tok.starts_with('#') { break; }
                if !tok.starts_with('@') || tok.len() == 1 { o.push(p(ln, col, "error", format!("Tag inválida \"{tok}\": toda tag começa com @ e não tem espaço"), "gherkin")); break; }
                if !seen.insert(tok) { o.push(p(ln, col, "warning", format!("Tag {tok} repetida"), "no-duplicate-tags")); }
            }
            tags.get_or_insert(ln); desc_ok = false; arg = 0;
            continue;
        }
        let head = d.and_then(|d| gh_head(d, t));
        if let Some(tl) = tags.take().filter(|_| d.is_some()) {
            match head {
                Some((Background, _)) => o.push(p(tl, 1, "error", "Contexto (Background) não aceita tags", "gherkin")),
                Some(_) => {}
                None => o.push(p(tl, 1, "error", "Tags sem Funcionalidade, Regra, Cenário ou Exemplos logo depois", "gherkin")),
            }
        }
        if t.starts_with('|') {
            desc_ok = false;
            let (cells, rest) = gh_cells(t);
            if !rest.trim().is_empty() { o.push(p(ln, col, "warning", "Texto depois do último '|' da tabela é ignorado", "gherkin")); }
            if d.is_some() && arg == 0 { o.push(p(ln, col, "error", "Tabela fora de um passo ou de Exemplos (Examples)", "gherkin")); continue; }
            match width {
                None => width = Some((cells.len(), ln)),
                Some((w, first)) if w != cells.len() => o.push(p(ln, col, "error", format!("Linha da tabela com {} células; a primeira (linha {first}) tem {w}", cells.len()), "gherkin")),
                _ => {}
            }
            if arg == 2 { if let Some(ex) = cur.as_mut().and_then(|s| s.examples.last_mut()) { if ex.header.is_none() { ex.header = Some(cells); } else { ex.rows += 1; } } }
            else if let Some(sc) = cur.as_mut().filter(|s| !s.bg) { gh_uses(l, ln, &mut sc.uses); }
            continue;
        }
        if t.starts_with("\"\"\"") || t.starts_with("```") {
            if d.is_some() && arg != 1 { o.push(p(ln, col, "error", "Docstring fora de um passo", "gherkin")); }
            doc = Some((if t.starts_with("```") { "```" } else { "\"\"\"" }, ln, col)); desc_ok = false;
            continue;
        }
        let Some(d) = d else { continue };
        if let Some((h, name)) = head {
            desc_ok = true; arg = 0; last = None; in_examples = false;
            let kw = &t[..t.find(':').unwrap_or(0)];
            if h == Feature {
                match feature {
                    Some(f) => o.push(p(ln, col, "error", format!("Só uma Funcionalidade (Feature) por arquivo: a primeira está na linha {f}"), "gherkin")),
                    None => { feature = Some(ln); if name.is_empty() { o.push(p(ln, col, "warning", "Funcionalidade sem nome", "no-unnamed-features")); } }
                }
                gh_close(cur.take(), &mut o); bg_seen = false; sc_seen = false;
                continue;
            }
            if feature.is_none() && !early { o.push(p(ln, col, "error", format!("\"{kw}\" antes da Funcionalidade (Feature)"), "gherkin")); early = true; }
            match h {
                Rule => { gh_close(cur.take(), &mut o); bg_seen = false; sc_seen = false; }
                Background => {
                    if sc_seen { o.push(p(ln, col, "error", "Contexto (Background) depois de um Cenário: ele vem antes de todos", "gherkin")); }
                    else if bg_seen { o.push(p(ln, col, "error", "Mais de um Contexto (Background) na mesma Funcionalidade ou Regra", "gherkin")); }
                    gh_close(cur.take(), &mut o); bg_seen = true;
                    cur = Some(GhScenario { line: ln, col, bg: true, outline: false, steps: 0, uses: vec![], examples: vec![] });
                }
                Scenario | Outline => {
                    gh_close(cur.take(), &mut o); sc_seen = true; scenarios += 1;
                    if name.is_empty() { o.push(p(ln, col, "warning", "Cenário sem nome", "no-unnamed-scenarios")); }
                    else if let Some(prev) = names.get(name) { o.push(p(ln, col, "warning", format!("Cenário \"{name}\" repetido (também na linha {prev})"), "no-dupe-scenario-names")); }
                    else { names.insert(name.to_string(), ln); }
                    let mut sc = GhScenario { line: ln, col, bg: false, outline: h == Outline, steps: 0, uses: vec![], examples: vec![] };
                    gh_uses(l, ln, &mut sc.uses);
                    cur = Some(sc);
                }
                Examples => match cur.as_mut().filter(|s| !s.bg) {
                    Some(sc) => { sc.examples.push(GhExamples { line: ln, col, header: None, rows: 0 }); in_examples = true; arg = 2; }
                    None => o.push(p(ln, col, "error", "Exemplos (Examples) fora de um Cenário", "gherkin")),
                },
                Feature => {}
            }
            continue;
        }
        if let Some((kind, kw)) = gh_step(d, t) {
            desc_ok = false; arg = 1;
            match cur.as_mut() {
                None => o.push(p(ln, col, "error", "Passo fora de um Cenário ou Contexto (Scenario/Background)", "gherkin")),
                Some(_) if in_examples => o.push(p(ln, col, "error", "Passo depois dos Exemplos: os passos vêm antes de Examples", "gherkin")),
                Some(sc) => {
                    sc.steps += 1;
                    if !sc.bg { gh_uses(l, ln, &mut sc.uses); }
                    if kind != GhStep::Cont && last == Some(kind) { o.push(p(ln, col, "info", format!("\"{kw}\" repetido: continue o passo anterior com \"{}\"", d.and[0]), "use-and")); }
                    if kind != GhStep::Cont { last = Some(kind); }
                }
            }
            continue;
        }
        if desc_ok { continue; }
        if feature.is_none() { if !early { o.push(p(ln, col, "error", "Texto antes da Funcionalidade (Feature)", "gherkin")); early = true; } continue; }
        o.push(p(ln, col, "error", format!("Linha não reconhecida: passo sem palavra-chave ({}/{}/{}/{}/{}) ou texto fora da descrição", d.given[0], d.when[0], d.then[0], d.and[0], d.but[0]), "gherkin"));
    }
    if let Some((_, l, c)) = doc { o.push(p(l, c, "error", "Docstring não fechada", "gherkin")); }
    if let Some(tl) = tags.filter(|_| d.is_some()) { o.push(p(tl, 1, "error", "Tags sem nada depois", "gherkin")); }
    gh_close(cur, &mut o);
    if d.is_some() {
        match feature {
            None if content => { o.retain(|x| x.msg != "Texto antes da Funcionalidade (Feature)"); o.push(p(1, 1, "error", "Nenhuma Funcionalidade (Feature) no arquivo", "gherkin")); }
            Some(f) if scenarios == 0 => o.push(p(f, 1, "warning", "Funcionalidade sem cenários", "no-files-without-scenarios")),
            _ => {}
        }
    }
    o.sort_by_key(|x| (x.line, x.col));
    o
}

// ---------- catálogo ----------
pub enum Kind {
    Html(&'static str), Xml, Json, Jsonc, Jsonl, Yaml, Toml, Ini(bool), Env, Properties, Csv(Option<u8>), Css(&'static str),
    Sql, Markdown, Docker, Make, Latex, Vb, Manifest, Po, Diff, Subs(bool), GoTpl, Gherkin, Code(&'static Spec), Plain,
}
/// família do arquivo pelo nome (minúsculo), extensão e começo do conteúdo; None = não é formato de texto daqui
pub fn classify(base: &str, ext: &str, head: &str) -> Option<Kind> {
    use Kind::*;
    let h = head.trim_start_matches('\u{feff}').trim_start();
    // por nome
    match base {
        "dockerfile" | "containerfile" => return Some(Docker),
        "makefile" | "gnumakefile" | "bsdmakefile" => return Some(Make),
        "cmakelists.txt" => return Some(Code(&CMAKE)),
        "manifest.mf" => return Some(Manifest),
        ".env" | ".envrc" | ".flaskenv" => return Some(Env),
        "jenkinsfile" => return Some(Code(&C_NEST)),
        "build" | "build.bazel" | "workspace" | "workspace.bazel" | "module.bazel" | "tiltfile" => return Some(Code(&HASH)),
        "vagrantfile" | "caddyfile" | "nginx.conf" => return Some(Code(&CONF)),
        "pipfile" | "cargo.lock" | "poetry.lock" | "uv.lock" | "pdm.lock" => return Some(Toml),
        ".gitconfig" | ".gitmodules" | ".editorconfig" | ".npmrc" | ".yarnrc" | ".pypirc" | ".pylintrc" | ".flake8" | ".coveragerc" | ".hgrc" | "setup.cfg" | "tox.ini" | "pytest.ini" | "mypy.ini" | ".wgetrc" => return Some(Ini(false)),
        ".babelrc" | ".swcrc" | ".jshintrc" | ".jscsrc" | ".luaurc" | "tsconfig.json" | "jsconfig.json" | "devcontainer.json" | ".devcontainer.json" | "settings.json" | "launch.json" | "tasks.json" | "extensions.json" | "keybindings.json" | "tslint.json" | "deno.json" | "biome.json" | "turbo.json" => return Some(Jsonc),
        ".prettierrc" | ".eslintrc" | ".stylelintrc" | ".markdownlintrc" | ".htmlhintrc" | ".lintstagedrc" => return Some(if h.starts_with('{') { Jsonc } else { Yaml }),
        ".clang-format" | ".clang-tidy" | ".yamllint" | ".gemrc" | "pubspec.lock" => return Some(Yaml),
        ".gitignore" | ".dockerignore" | ".npmignore" | ".eslintignore" | ".prettierignore" | ".hgignore" | ".gitattributes" | ".gcloudignore" | ".vscodeignore" | "codeowners" | "license" | "licence" | "copying" | "readme" | "authors" | "contributors" | "changelog" | "notice" | "todo" | "go.sum" | "yarn.lock" | "procfile" | ".htaccess" | ".nvmrc" | ".node-version" | ".python-version" | ".ruby-version" | ".tool-versions" | "requirements.txt" => return Some(Plain),
        _ => {}
    }
    if base.starts_with(".env.") || base.ends_with(".env") { return Some(Env); }
    // dockerfile.vim e makefile.el são de outra coisa (sintaxe do vim, modo do emacs)
    const OTHER: &[&str] = &["vim", "el", "py", "rb", "js", "ts", "md", "txt", "json", "yml", "yaml", "xml", "html", "sh", "ps1", "go", "rs", "java", "lua", "snippets", "sublime-syntax", "tmlanguage", "nanorc", "lang", "kak", "toml", "j2", "jinja", "tpl", "erb"];
    if (base.starts_with("dockerfile.") && !OTHER.contains(&ext)) || base.ends_with(".dockerfile") { return Some(Docker); }
    if base.starts_with("makefile.") && !OTHER.contains(&ext) { return Some(Make); }
    if (base.starts_with("tsconfig") || base.starts_with("jsconfig")) && ext == "json" { return Some(Jsonc); }
    // README.cmake, LICENSE.vim, CHANGES.el...: texto, seja qual for a extensão
    if re!(r"^(readme|licen[sc]e|copying|changelog|changes|authors|news|install|todo|thanks|credits)\b").is_match(base) && !matches!(ext, "md" | "markdown" | "html" | "htm" | "rst" | "adoc" | "txt" | "json" | "xml" | "yml" | "yaml") { return Some(Plain); }
    if base.starts_with("requirements") && ext == "txt" { return Some(Plain); }
    Some(match ext {
        // HTML e templates (marcação com lógica embutida)
        "html" | "htm" | "xhtml" | "xht" | "shtml" | "shtm" | "stm" | "jsp" | "jspf" | "tag" | "vm" | "ftl" | "ftlh" | "ftlx" => Html("html"),
        "twig" | "jinja" | "jinja2" | "j2" | "njk" | "nunjucks" | "liquid" | "djhtml" | "jinja-html" | "html.j2" | "volt" | "peb" | "pebble" | "jet" => Html("template"),
        "hbs" | "handlebars" | "mustache" | "mst" | "hjs" | "stache" => Html("template"),
        "erb" | "rhtml" | "ejs" | "eta" | "ect" | "gsp" | "asp" | "aspx" | "ascx" | "ashx" | "asmx" | "master" | "kit" | "svelte" | "riot" | "tpl.html" => Html("html"),
        "gohtml" | "gotmpl" | "gotxt" | "tmpl" => GoTpl,
        // XML e dialetos
        "xml" | "xsd" | "wsdl" | "xsl" | "xslt" | "tld" | "jrxml" | "xmi" | "pom" | "svg" | "project" | "classpath" | "launch" | "component" | "factorypath" | "jsdtscope" | "container" | "plist" | "iml" | "ipr" | "iws"
        | "csproj" | "vbproj" | "fsproj" | "vcxproj" | "vcproj" | "sqlproj" | "wixproj" | "proj" | "props" | "targets" | "nuspec" | "resx" | "xaml" | "axaml" | "ruleset" | "runsettings" | "testsettings" | "vsixmanifest" | "vsct" | "filters" | "pubxml" | "settings" | "edmx" | "dbml" | "xoml" | "appxmanifest" | "manifest"
        | "storyboard" | "xib" | "entitlements" | "xcscheme" | "xcworkspacedata" | "xcsettings" | "kml" | "gpx" | "rss" | "atom" | "opml" | "fxml" | "jnlp" | "xul" | "wxs" | "wxi" | "wxl" | "xliff" | "xlf" | "tmx" | "ttml" | "dfxp" | "dae" | "mxml" | "musicxml" | "mxl.xml" | "sld" | "fo" | "xsl-fo" | "rdf" | "owl" | "jspx" | "tagx" | "xspf" | "svgz.xml" | "nzb" | "graphml" | "gexf" | "x3d" | "xmp" | "xfdf" | "xhb" | "glade" | "ui.xml" | "qrc" | "ts.xml" | "tmlanguage" | "tmtheme" | "tmsnippet" | "tmpreferences" | "sublime-snippet" | "vcxitems" | "wpr" | "mpp.xml" | "bpmn" | "dmn" | "cmmn" | "drawio" | "uxf" | "ditamap" | "dita" | "docbook" | "dbk" | "xpl" | "xproc" | "sch" | "rng" | "xjb" | "wadl" | "xbrl" | "xhtm" | "gradle.xml" | "ant" | "nant" | "build.xml" | "pubspec.xml" | "mod.xml" | "cbproj" | "dproj" | "groupproj" | "lpi" | "lps" | "lpk" | "cbp" | "workspace.xml" | "fla.xml" | "csdef" | "cscfg" | "vstemplate" | "addin" | "natvis" | "tlog.xml" | "xrml" | "mathml" | "mml" => Xml,
        "dtd" | "ent" | "mod" if h.starts_with('<') => Xml,
        "config" | "conf" | "cfg" | "ui" | "ts" | "gml" | "inc" | "res" | "def" | "pkg" | "stx" | "tmpl.xml" | "data" if h.starts_with("<?xml") || (h.starts_with('<') && !h.starts_with("<%") && !h.starts_with("<?php")) => Xml,
        // JSON
        "json" | "map" | "webmanifest" | "geojson" | "topojson" | "har" | "ipynb" | "gltf" | "avsc" | "jsonld" | "arb" | "mcmeta" | "sarif" | "babylon" | "jsonschema" | "schema.json" | "lottie" | "tfstate" | "watchmanconfig" | "flowconfig.json" | "importmap" | "4dform" | "4dproject" | "har.json" | "vl.json" | "vg.json" | "postman_collection" | "postman_environment" | "chartjs" | "ndjson.json" | "jsonp.json" | "sublime-settings" | "sublime-project" | "sublime-workspace" | "sublime-keymap" | "sublime-commands" | "sublime-menu" | "sublime-build" | "sublime-theme" | "sublime-color-scheme" | "code-snippets" | "code-workspace" | "jsonc" | "json-tmlanguage" => if matches!(ext, "jsonc" | "code-workspace" | "code-snippets" | "sublime-settings" | "sublime-project" | "sublime-keymap" | "sublime-commands" | "sublime-menu" | "sublime-build" | "sublime-theme" | "sublime-color-scheme" | "sublime-workspace") { Jsonc } else { Json },
        "json5" | "hjson" => Code(&JSON5),
        "jsonl" | "ndjson" | "ldjson" | "jsonlines" | "geojsonl" | "jsonseq" => Jsonl,
        // configuração
        "yml" | "yaml" | "cff" | "sublime-syntax" | "mir" | "reek" | "rviz" | "syntax" | "yaml-tmlanguage" | "eyaml" | "gemrc" | "clang-format" | "clang-tidy" | "kubeconfig" | "lock.yml" => Yaml,
        "toml" | "tml" => Toml,
        "ini" | "cfg" | "desktop" | "directory" | "theme" | "inf" | "reg" | "url" | "service" | "socket" | "timer" | "mount" | "automount" | "swap" | "target" | "path" | "slice" | "scope" | "network" | "netdev" | "link" | "nmconnection" | "lnk.ini" | "properties.ini" | "ass" | "ssa" | "wpj" | "dof" | "dsk" | "rdp" | "ica" | "vbp" | "vbw" | "mak.ini" | "editorconfig" | "gitconfig" | "npmrc" | "pylintrc" | "flake8" | "coveragerc" | "pypirc" | "hgrc" | "buckconfig" | "lektorproject" | "prefs.ini" | "sln.ini" | "frm.ini" | "cnf" | "ovpn.ini" | "wrangler.ini" => Ini(matches!(ext, "cfg" | "desktop" | "directory" | "url" | "rdp" | "editorconfig" | "pylintrc" | "flake8" | "coveragerc")),
        "env" | "dotenv" => Env,
        "mk" | "mak" | "make" | "mke" => Make,
        "properties" | "prefs" | "props.ini" | "lang" => Properties,
        "csv" => Csv(None), "tsv" => Csv(Some(b'\t')), "psv" => Csv(Some(b'|')), "ssv" => Csv(Some(b';')),
        // estilos
        "css" | "wxss" | "acss" | "qss" | "pcss" | "postcss" | "sss" | "tss" | "uss" | "gss" => Css("css"),
        "scss" => Css("scss"), "less" => Css("less"),
        "styl" | "stylus" => Code(&C_LIKE),
        // SQL e dialetos
        "sql" | "ddl" | "dml" | "pks" | "pkb" | "pls" | "plsql" | "pck" | "prc" | "fnc" | "trg" | "vw" | "tab.sql" | "psql" | "pgsql" | "mysql" | "tsql" | "spsql" | "hql" | "cql" | "q" | "bql" | "prql.sql" | "snowsql" | "db2" | "sqlite.sql" | "dbt.sql" | "sqlx" | "udf" | "sp" | "viw" | "mssql" | "ora" | "pkh" | "spec" | "body" if matches!(ext, "sql" | "ddl" | "dml" | "psql" | "pgsql" | "mysql" | "plsql" | "tsql" | "mssql") || re!(r"(?i)\b(select|create|insert|update|delete|begin|package|procedure|function|table)\b").is_match(head) => Sql,
        // documentos
        "md" | "markdown" | "mdown" | "mkd" | "mkdn" | "mdwn" | "mdx" | "rmd" | "qmd" | "ronn" | "scd" | "workbook" | "livemd" | "mdc" => Markdown,
        "tex" | "ltx" | "sty" | "dtx" | "ins" | "latex" | "bbx" | "cbx" | "lbx" | "def.tex" | "rnw" | "tikz" | "pgf" | "ctx" | "mkiv" | "mkii" | "mkxl" => Latex,
        "cls" => if re!(r"(?i)VERSION 1\.0 CLASS|Attribute VB_").is_match(head) { Vb } else if head.contains('\\') && re!(r"\\(ProvidesClass|NeedsTeXFormat|LoadClass|def|newcommand|RequirePackage)").is_match(head) { Latex } else { Code(&C_LIKE) },
        "bib" | "bibtex" | "biblatex" => Code(&BIB),
        "rtf" => Code(&BRACES),
        "po" | "pot" => Po,
        "diff" | "patch" | "rej" | "debdiff" => Diff,
        "srt" => Subs(false), "vtt" | "webvtt" => Subs(true),
        "mf" => Manifest,
        "feature" | "gherkin" => Gherkin,
        // VB
        "vb" | "vbs" | "vba" | "bas" | "vbscript" | "wsf.vbs" | "dsr" | "ctl" | "pag" | "dob" | "vbe.txt" => Vb,
        "frm" if re!(r"(?i)^(VERSION|Begin VB|Attribute VB_)").is_match(h) => Vb,
        // código: verificador de pares por família
        "proto" | "thrift" | "fbs" | "avdl" | "idl" | "odl" | "webidl" | "smithy" | "wit" | "sol" | "move" | "cairo" | "cue" | "pkl" | "prisma" | "bicep" | "qml" | "qbs" | "mq4" | "mq5" | "mqh" | "pde" | "aidl" | "apex" | "trigger" | "hx" | "hxsl" | "as" | "jsfl" | "d" | "di" | "zig" | "zon" | "odin" | "jai" | "c3" | "v.vlang" | "vala" | "vapi" | "gs" | "gml" | "lsl" | "sqf" | "pwn" | "nut" | "wren" | "chpl" | "ceylon" | "agda.c" | "ballerina" | "bal" | "carbon" | "mojo.c" | "verse" | "uc" | "uci" | "unrealscript" | "ahkl" | "mel" | "nss" | "nwscript" | "gdshaderinc" | "dm" | "pike" | "pmod" | "nqp" | "yar" | "yara" | "kusto" | "kql" | "csl" | "jsx.c" | "ets" | "arkts" | "cj" | "mvel" | "drl" | "dart.c" | "re" | "rei" | "res" | "resi" | "gleam" | "roc" | "grace" | "io" | "x10" | "fan" | "fwt" | "fantom" | "ooc" | "e" | "eclass" | "ebuild.c" => if matches!(ext, "re" | "rei" | "res" | "resi") { Code(&C_DQ) } else { Code(&C_LIKE) },
        "groovy" | "gvy" | "gy" | "gsh" | "gradle" | "nf" | "scala" | "sc" | "sbt" | "mill" | "dart" | "swift" | "kts.c" => if matches!(ext, "scala" | "sc" | "sbt" | "mill" | "swift") { Code(&C_DQ) } else { Code(&C_NEST) },
        "glsl" | "vert" | "frag" | "geom" | "tesc" | "tese" | "comp" | "vs" | "fs" | "gs.glsl" | "vsh" | "fsh" | "gsh.glsl" | "shader" | "cginc" | "compute" | "hlsl" | "hlsli" | "fx" | "fxh" | "fxc" | "usf" | "ush" | "wgsl" | "metal" | "cu" | "cuh" | "cl.c" | "ispc" | "rgen" | "rmiss" | "rchit" | "rahit" | "rint" | "rcall" | "mesh" | "task" | "msl" | "gdshader" | "tscn.shader" | "effect" | "slang" | "psh" | "frag.glsl" | "spvasm.c" | "osl" | "rsh" => if ext == "fs" && !re!(r"(?m)^\s*(#version|uniform|varying|in |out |precision|void main)").is_match(head) { Code(&FSHARP) } else { Code(&SHADER) },
        "hcl" | "tf" | "tfvars" | "nomad" | "pkr.hcl" | "sentinel" | "workflow" | "hcl2" => Code(&HCL),
        "nix" => Code(&NIX),
        "jsonnet" | "libsonnet" => Code(&JSONNET),
        "graphql" | "gql" | "graphqls" | "capnp" | "rego" | "gd" | "bzl" | "star" | "sky" | "bazel" | "bazelrc.star" | "cr" | "r" | "rd" | "ex" | "exs" | "eex.ex" | "pyx" | "pxd" | "pxi" | "sage" | "mojo" | "🔥" | "pony" | "rb.hash" | "ws" | "nu" | "elv" | "rpy" | "gn" | "gni" | "meson" | "wscript" | "kv" | "vcl" | "tla" | "pp" | "epp" | "sls" | "ron" => if matches!(ext, "graphql" | "gql" | "graphqls" | "cr" | "ex" | "exs" | "pp" | "ron") { Code(&HASH_DQ) } else { Code(&HASH) },
        "cmake" | "cmake.in" => Code(&CMAKE),
        "jl" => Code(&JULIA),
        "nim" | "nims" | "nimble" => Code(&NIM),
        "coffee" | "cson" | "iced" | "litcoffee" | "cjsx" => Code(&COFFEE),
        "el" if !(h.starts_with(';') || h.starts_with('(')) => return None,
        "lisp" | "lsp" | "l" | "el" | "elc.txt" | "scm" | "ss" | "sls.scm" | "sld.scm" | "rkt" | "rktl" | "rktd" | "clj" | "cljs" | "cljc" | "cljd" | "edn" | "bb" | "fnl" | "hy" | "lfe" | "janet" | "jank" | "kl" | "shen" | "lsps" | "asd" | "ros" | "sexp" | "wast" | "wat" | "dune" | "opam.sexp" | "kicad_pcb" | "kicad_sch" | "kicad_mod" | "kicad_sym" | "kicad_pro.sexp" | "yuck" | "ny" | "sch.scm" | "stk" | "sps" | "sld.lisp" => Code(&LISP),
        "cl" => if h.starts_with('(') || h.starts_with(';') { Code(&LISP) } else { Code(&SHADER) },
        "hs" | "lhs" | "hsc" | "hs-boot" | "elm" | "purs" | "agda" | "idr" | "lidr" | "dhall" | "curry" => Code(&HASKELL),
        "ml" | "mli" | "mll" | "mly" | "eliom" | "sml" | "fun" | "cm" | "mlb" | "thy" | "v.coq" | "atd" => Code(&ML),
        "fsx" | "fsi" | "fsscript" => Code(&FSHARP),
        "erl" | "hrl" | "xrl" | "yrl" | "escript" | "app.src" => Code(&ERLANG),
        "pro" | "prolog" | "plg" | "lgt" | "ecl" | "P" => Code(&PROLOG),
        "pl" | "pm" if re!(r"(?m)^\s*:-|^\w+\([^)]*\)\s*:-").is_match(head) => Code(&PROLOG),
        "m" if !re!(r"(?m)^\s*(#import|#include|@interface|@implementation|@protocol|@end)").is_match(head) => Code(&MATLAB),
        "m" | "mm" | "h.objc" => Code(&C_LIKE),
        "sv" if !re!(r"(?m)^\s*(module|package|interface|class|program|`include|`timescale|`define|import)\b").is_match(head) => return None,
        "v" | "sv" | "svh" | "vh" | "vlog" | "veo" => if ext == "v" && !re!(r"(?m)^\s*(module|`timescale|`include|`define)\b").is_match(head) { Code(&C_DQ) } else { Code(&SHADER) },
        "vhd" | "vhdl" | "vho" | "vht" | "adb" | "ads" | "ada" | "gpr" | "lua.dd" | "e.vhd" => Code(&DASHDASH),
        "f" | "for" | "f77" | "ftn" | "fpp" => Code(&FORTRAN_FIXED),
        "f90" | "f95" | "f03" | "f08" | "f18" | "pf" | "fi" => Code(&FORTRAN),
        "pas" | "dpr" | "lpr" | "dpk" | "dfm" | "lfm" | "fmx" => Code(&PASCAL),
        "conf" | "nginx" | "nginxconf" | "vhost" | "hocon" | "caddy" | "pf.conf" | "haproxy" | "squid" | "zone.conf" => Code(&CONF),
        "txt" | "text" | "log" | "out.txt" | "me" | "1st" | "nfo" | "diz" | "rst" | "rest" | "adoc" | "asciidoc" | "asc" | "org" | "textile" | "wiki" | "mediawiki" | "creole" | "pod" | "rdoc" | "man" | "roff" | "nroff" | "groff" | "ms" | "mom" | "texi" | "texinfo" | "lst" | "list" | "sub" | "lrc" | "sbv" | "gitignore" | "gitattributes" | "dockerignore" | "npmignore" | "lock" | "sum" | "mod.go" | "work" | "pem" | "crt" | "cer" | "csr" | "key" | "pub" | "asc.txt" | "sig.txt" | "gpg.txt" | "plantuml" | "puml" | "mmd" | "mermaid" | "dot" | "gv" | "http" | "rest.http" | "story" | "tu" | "ti" | "prd" | "hml" | "dnx" | "srt.txt" | "cue.txt" | "m3u" | "m3u8" | "pls" | "xspf.txt" | "tle" | "nmea" | "gcode" | "nc" | "ngc" | "tap" | "obj" | "mtl" | "ply" | "stl" | "off" | "x3d.txt" | "pgm" | "ppm" | "pbm" | "xpm" | "xbm" | "pcd" | "las.txt" | "fasta" | "fa" | "fastq" | "fq" | "gff" | "gtf" | "vcf" | "bed" | "sam" | "pdb" | "mol" | "sdf" | "xyz" | "cif" | "ics" | "ical" | "vcard" | "vcs" | "eml" | "mbox" | "msg.txt" | "url.txt" | "webloc.txt" | "desktop.txt" | "spec.txt" | "changes" | "news" | "authors" | "todo" | "install" | "copying" | "license" | "readme" | "ascii" | "ans" | "utf8" => Plain,
        _ => return None,
    })
}
/// nome curto da família para a barra de status
pub fn tool(k: &Kind) -> &'static str {
    match k {
        Kind::Html(t) => if *t == "template" { "html/template" } else { "html/jsp" }, Kind::Xml => "xml", Kind::Json => "json", Kind::Jsonc => "json (com comentários)", Kind::Jsonl => "json lines",
        Kind::Yaml => "yaml", Kind::Toml => "toml", Kind::Ini(_) => "ini", Kind::Env => ".env", Kind::Properties => "properties", Kind::Csv(_) => "csv",
        Kind::Css(_) => "css", Kind::Sql => "sql", Kind::Markdown => "markdown", Kind::Docker => "dockerfile", Kind::Make => "makefile", Kind::Latex => "latex",
        Kind::Vb => "vb", Kind::Manifest => "manifest", Kind::Po => "gettext", Kind::Diff => "diff", Kind::Subs(v) => if *v { "webvtt" } else { "srt" },
        Kind::GoTpl => "go template", Kind::Gherkin => "gherkin", Kind::Code(s) => s.name, Kind::Plain => "texto",
    }
}
/// intérprete do shebang (#!/usr/bin/env python3 -> "py"), para arquivos sem extensão
pub fn shebang(head: &str) -> Option<&'static str> {
    let first = head.lines().next()?.strip_prefix("#!")?;
    let mut w = first.split_whitespace();
    let mut prog = w.next()?.rsplit('/').next()?;
    if prog == "env" { prog = w.find(|x| !x.starts_with('-'))?; }
    let prog = prog.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.');
    Some(match prog {
        "sh" | "bash" | "dash" | "ash" | "ksh" | "mksh" => "sh", "zsh" => "zsh", "fish" => "fish",
        "python" | "pypy" => "py", "node" | "nodejs" | "deno" | "bun" => "js", "perl" => "pl", "ruby" => "rb", "php" => "php",
        "pwsh" | "powershell" => "ps1", "lua" | "luajit" => "lua", "make" => "mk", "awk" | "gawk" => "awk", "tclsh" | "wish" => "tcl", "Rscript" => "r", "julia" => "jl", "elixir" => "exs", "escript" => "escript", "groovy" => "groovy", "scala" => "scala", "kotlin" => "kts",
        _ => return None,
    })
}
/// extensões binárias conhecidas (o resto é decidido pelo conteúdo)
pub const BINARY: &[&str] = &[
    "gif", "png", "jpg", "jpeg", "jpe", "jfif", "pjpeg", "webp", "avif", "heic", "heif", "jxl", "jp2", "j2k", "bmp", "dib", "ico", "icns", "cur", "ani", "tif", "tiff", "psd", "psb", "xcf", "kra", "ora", "clip", "sai", "raw", "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "srw", "pef", "exr", "hdr", "dds", "ktx", "ktx2", "tga", "pcx", "wbmp", "svgz", "emf", "wmf", "ai", "eps", "indd", "sketch", "fig", "xd", "afdesign", "afphoto",
    "mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "aac", "wma", "aiff", "aif", "ape", "alac", "mid", "midi", "amr", "au", "caf", "mka", "dsf", "wv", "mod.bin", "xm", "it", "s3m", "spc",
    "mp4", "m4v", "mkv", "webm", "avi", "mov", "qt", "wmv", "flv", "f4v", "mpg", "mpeg", "m2ts", "mts", "vob", "3gp", "3g2", "ogv", "rm", "rmvb", "asf", "divx", "mxf", "braw", "r3d",
    "zip", "jar", "war", "ear", "aar", "apk", "aab", "xapk", "ipa", "7z", "rar", "gz", "tgz", "bz2", "tbz2", "xz", "txz", "zst", "lz", "lz4", "lzma", "lzh", "lha", "cab", "arj", "z", "tar", "iso", "img", "dmg", "vhd.bin", "vhdx", "vmdk", "qcow2", "vdi", "ova", "wim", "esd", "msi", "msix", "msixbundle", "appx", "appxbundle", "msp", "msu", "deb", "rpm", "pkg.tar.zst", "snap", "flatpak", "appimage", "nupkg", "snupkg", "vsix", "crx", "xpi", "whl", "egg", "gem", "unitypackage", "pak", "upk", "vpk", "bsa", "ba2", "rpa", "asar", "sfx",
    "exe", "dll", "sys", "drv", "ocx", "cpl", "scr", "com", "so", "dylib", "o", "obj.bin", "a", "lib", "ilk", "exp.bin", "idb", "pch", "gch", "ipch", "bin", "elf", "out.bin", "wasm", "class", "dex", "odex", "vdex", "oat", "pyc", "pyo", "pyd", "beam", "rlib", "rmeta", "luac", "nro", "nso", "xex", "xbe", "efi", "ko", "mui", "winmd", "node",
    "pdf", "doc", "docx", "docm", "dotx", "dotm", "xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "xltm", "ppt", "pptx", "pptm", "pps", "ppsx", "pot.bin", "potx", "odt", "ods", "odp", "odg", "odf", "ott", "pages", "numbers", "key.bin", "vsd", "vsdx", "mpp", "one", "onepkg", "xps", "oxps", "epub", "mobi", "azw", "azw3", "kfx", "fb2.zip", "djvu", "cbz", "cbr", "chm", "hlp",
    "ttf", "otf", "woff", "woff2", "eot", "ttc", "fon", "fnt", "pfb", "pfm", "afm.bin",
    "db", "sqlite", "sqlite3", "db3", "mdb", "accdb", "dbf", "myd", "myi", "ibd", "ldf", "mdf", "ndf", "bak", "fdb", "gdb", "nsf", "pst", "ost", "edb", "realm", "kdbx", "kdb", "keychain", "jks", "keystore", "p12", "pfx", "der", "gpg", "pgp", "p7b", "p7s", "p7m",
    "parquet", "avro", "orc", "feather", "arrow", "npy", "npz", "pkl", "pickle", "joblib", "h5", "hdf5", "he5", "nc4", "mat", "sav", "dta", "sas7bdat", "xpt", "rds", "rdata", "rda", "onnx", "pt", "pth", "ckpt", "safetensors", "tflite", "pb", "mlmodel", "gguf", "ggml", "bin.model", "weights", "caffemodel", "msgpack", "bson", "cbor", "protobin", "flatbuffer", "tfrecord", "lmdb", "leveldb", "ldb", "sst", "rdb", "aof.bin",
    "fbx", "blend", "blend1", "max", "3ds", "c4d", "ma.bin", "mb", "lwo", "lws", "glb", "usdz", "usdc", "abc", "skp", "dwg", "dxf.bin", "step.bin", "stp.bin", "igs.bin", "sldprt", "sldasm", "slddrw", "ipt", "iam", "catpart", "f3d", "3mf", "vox", "uasset", "umap", "ubulk", "uexp", "utoc", "ucas", "assets", "resource", "ress", "bundle", "unity3d", "prefab.bin", "anim.bin", "nif", "dds.bin", "vtf", "vmt.bin", "mdl", "bsp", "wad", "esp", "esm", "esl",
    "swf", "fla", "xap", "dcr", "nds", "gba", "gb", "gbc", "nes", "sfc", "smc", "n64", "z64", "v64", "gcm", "wbfs", "xci", "nsp", "cia", "3ds.rom", "rom", "sav.bin", "srm", "state",
    "lnk", "ds_store", "swp", "swo", "thumbs", "dat.bin", "mo", "gmo", "ser", "class.bin", "jmod", "jimage", "icc", "icm", "torrent", "pcap", "pcapng", "etl", "evtx", "dmp", "mdmp", "hprof", "core", "trace", "nettrace", "diagsession", "vsp", "suo", "vsidx", "cache", "tlog", "lastbuildstate", "res.bin", "aps", "ncb", "sdf.bin", "opendb", "VC.db", "ipdb", "iobj",
];

#[cfg(test)]
mod tests {
    use super::*;
    fn errs(v: Vec<Problem>) -> usize { v.len() }
    #[test]
    fn code_pairs() {
        assert_eq!(errs(code("void f() { int a[3] = {1,2,3}; /* ) */ char c = '}'; s = \"(\"; }", &C_LIKE)), 0);
        assert_eq!(errs(code("void f() { if (x) { }", &C_LIKE)), 1);
        assert_eq!(errs(code("f(a]", &C_LIKE)), 2); // ']' sem '[' e '(' não fechado
        assert_eq!(errs(code("(defun f (x) \"a ) b\" ; )\n #| ( |# \\( (+ x 1))", &LISP)), 0);
        assert_eq!(errs(code("(defun f (x)", &LISP)), 1);
        assert_eq!(errs(code("f x' = {- { -} [x']", &HASKELL)), 0);
        assert_eq!(errs(code("s = \"\"\"a ( b\"\"\"\nf(1)", &C_NEST)), 0);
        assert_eq!(errs(code("x = \"abc\ny = 1", &SHADER)), 1);
    }
    #[test]
    fn formats() {
        assert_eq!(errs(toml("[a]\nx = 1\ny = \"s\" # c\nz = [1,\n 2]\n[b.c]\nk = { a = 1 }\ns = '''\nmulti\n'''\n[[arr]]\n[[arr]]\n")), 0);
        assert_eq!(errs(toml("[a]\nx = 1\nx = 2\n[a]\ny = texto\nlixo\n")), 4);
        assert_eq!(errs(ini("[s]\na=1\nb = 2\n  continua\n; c\n", true)), 0);
        assert_eq!(errs(ini("[s]\na=1\na=2\n[s\n", true)), 2);
        assert_eq!(errs(dotenv("A=1\nexport B=\"x y\"\n# c\nC='multi\nline'\n")), 0);
        assert_eq!(errs(dotenv("A = 1\n1X=2\nA=3\nD=\"aberto\n")), 4);
        assert_eq!(errs(csv("a,b,c\n1,\"x,\ny\",3\n4,5,6\n", None)), 0);
        assert_eq!(errs(csv("a;b;c\n1;2\n", None)), 1);
        assert_eq!(errs(jsonc("{\n // c\n \"a\": [1,2,], /* x */ \"b\": 2,\n}")), 0);
        assert_eq!(errs(jsonl("{\"a\":1}\n\n{\"b\":\n")), 1);
        assert_eq!(errs(dockerfile("# syntax=docker/dockerfile:1\nARG V=1\nFROM alpine:$V\nRUN apk add \\\n    curl\nRUN <<EOF\necho oi\nEOF\nCMD [\"sh\"]\n")), 0);
        assert_eq!(errs(dockerfile("RUN x\nFROM a\nCOPYY a b\nMAINTAINER eu\n")), 3);
        assert_eq!(errs(makefile("CC := gcc\nall: a b\n\t$(CC) -o x\n\n\techo ok\nifeq ($(A),1)\nX = 1\nelse\nX = 2\nendif\ndefine T\n  qualquer\nendef\n")), 0);
        assert_eq!(errs(makefile("all:\n    echo espaços\nifdef X\n")), 2);
        assert_eq!(errs(latex("\\begin{document}\n% { \n\\verb|{| \\{ \\begin{verbatim}\n\\end{itemize} {\n\\end{verbatim}\n\\end{document}\n")), 0);
        assert_eq!(errs(latex("\\begin{a}\\begin{b}\\end{a} {")), 2);
        assert_eq!(errs(vb("Sub A()\n  If x Then y = 1\n  If x Then\n    For i = 1 To 2: Next\n  End If ' comentário \"\n  s = \"a \"\"b\"\"\"\nEnd Sub\nFunction F() _\n  As Long\nEnd Function\n")), 0);
        assert_eq!(errs(vb("Sub A()\n  If x Then\nEnd Sub\n")), 1);
        assert_eq!(errs(manifest("Manifest-Version: 1.0\nMain-Class: a.B\n")), 0);
        assert_eq!(errs(manifest("Manifest-Version 1.0\n")), 1);
        assert_eq!(errs(po("msgid \"\"\nmsgstr \"\"\n\"Content-Type: text/plain\\n\"\n\nmsgid \"a\"\nmsgstr \"b\"\n\nmsgctxt \"m\"\nmsgid \"a\"\nmsgstr \"c\"\n")), 0);
        assert_eq!(errs(po("msgid \"a\"\nmsgstr \"b\"\nmsgid \"a\"\nmsgstr \"c\"\nmsgid \"x\"\n")), 2);
        assert_eq!(errs(diff("--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n")), 0);
        assert_eq!(errs(diff("@@ -1,3 +1,2 @@\n a\n-b\n+c\n")), 1);
        assert_eq!(errs(subtitles("1\n00:00:01,000 --> 00:00:02,000\noi\n\n2\n00:00:03,000 --> 00:00:04,500\ntchau\n", false)), 0);
        assert_eq!(errs(subtitles("WEBVTT\n\n00:01.000 --> 00:00.500\nx\n", true)), 1);
        assert_eq!(errs(template_blocks("{% if a %}{% for x in y %}{{ x }}{% endfor %}{% else %}{% endif %}{% set z = 1 %}{{#each l}}{{/each}}")), 0);
        assert_eq!(errs(template_blocks("{% if a %}{% for x in y %}{% endif %}{% endfor %}")), 2);
        assert_eq!(errs(go_template("{{define \"x\"}}{{if .A}}{{range .B}}{{end}}{{end}}{{end}}")), 0);
    }
    #[test]
    fn gherkin_lint() {
        let rules = |t: &str| gherkin(t).into_iter().map(|x| format!("{}@{}", x.rule, x.line)).collect::<Vec<_>>();
        let en = "@smoke @login\nFeature: Login\n  As a user\n  I want to log in\n\n  Background:\n    Given the app is open\n\n  Rule: valid users\n\n  Scenario: ok\n    Given a user \"ana\"\n      | name | role  |\n      | ana  | admin |\n    When she logs in\n    And waits\n    Then she sees the home\n    But no errors\n\n  @wip\n  Scenario Outline: many <who>\n    Given a user <who> with:\n      \"\"\"json\n      {\"pass\": \"<pass>\"}\n      \"\"\"\n    * she logs in\n    Then the result is <result>\n\n    Examples: valid\n      | who | pass | result |\n      | ana | 1\\|2 | ok     |\n    @bad\n    Examples:\n      | who | pass | result |\n      | bob | x    | fail   |\n";
        assert_eq!(rules(en), Vec::<String>::new());
        let pt = "# language: pt\n# encoding: utf-8\nFuncionalidade: Saque\n  Contexto:\n    Dado que tenho R$ 100\n\n  Cenário: saque simples\n    Quando saco R$ 20\n    Então tenho R$ 80\n    E recebo o recibo\n\n  Esquema do Cenário: saque de <valor>\n    Quando saco <valor>\n    Então o saldo é <saldo>\n    Exemplos:\n      | valor | saldo |\n      | 10    | 90    |\n";
        assert_eq!(rules(pt), Vec::<String>::new());
        // erros do parser oficial
        assert_eq!(rules("Given x\nFeature: a\n  Scenario: b\n    Given c\n"), ["gherkin@1"]);
        assert_eq!(rules("Feature: a\n  Given solto\n  Scenario: b\n    Given c\n"), ["gherkin@2"]);
        assert_eq!(rules("Feature: a\n  Scenario: b\n    Given c\n    texto sem palavra-chave\n"), ["gherkin@4"]);
        assert_eq!(rules("Feature: a\n  Scenario: b\n    Given c\n  Background:\n    Given d\n"), ["gherkin@4"]);
        assert_eq!(rules("Feature: a\n  Scenario: b\n    Given c\n      | x | y |\n      | 1 |\n"), ["gherkin@5"]);
        assert_eq!(rules("Feature: a\n  Scenario: b\n    Given c\n      \"\"\"\n      aberto\n"), ["gherkin@4"]);
        assert_eq!(rules("Feature: a\n  @tag errada\n  Scenario: b\n    Given c\n"), ["gherkin@2"]);
        assert_eq!(rules("Feature: a\n  @t\n  Background:\n    Given x\n  Scenario: b\n    Given c\n"), ["gherkin@2"]);
        assert_eq!(rules("Feature: a\n  Scenario: b\n    Given c\nFeature: d\n"), ["gherkin@4"]);
        assert_eq!(rules("Feature: a\n  Scenario Outline: b\n    Given <x>\n    Examples:\n      | x |\n      | 1 |\n    Given depois\n"), ["gherkin@7"]);
        assert_eq!(rules("só texto\n"), ["gherkin@1"]);
        // regras do gherkin-lint
        assert_eq!(rules("Feature: a\n  Scenario: b\n    Given c\n  Scenario: b\n    Given d\n"), ["no-dupe-scenario-names@4"]);
        assert_eq!(rules("Feature:\n  Scenario:\n    Given c\n  Scenario: vazio\n"), ["no-unnamed-features@1", "no-unnamed-scenarios@2", "no-empty-scenario@4"]);
        assert_eq!(rules("Feature: a\n  Scenario Outline: b\n    Given <x> and <y>\n    Examples:\n      | x | z |\n      | 1 | 2 |\n"), ["no-undefined-variables@3", "no-unused-variables@4"]);
        assert_eq!(rules("Feature: a\n  Scenario Outline: b\n    Given <x>\n"), ["gherkin@2"]);
        assert_eq!(rules("Feature: a\n  Scenario: b\n    Given c\n    Given d\n"), ["use-and@4"]);
        assert_eq!(rules("Feature: a\n  Background:\n  Scenario: b\n    Given c\n"), ["no-empty-background@2"]);
        assert_eq!(rules("Feature: a\n"), ["no-files-without-scenarios@1"]);
        assert_eq!(rules("# só comentário\n"), Vec::<String>::new());
        // idioma sem dicionário: só tabelas, docstrings e tags
        assert_eq!(rules("# language: fr\nFonctionnalité: a\n  Scénario: b\n    Soit c\n      | x | y |\n      | 1 |\n"), ["gherkin@1", "gherkin@6"]);
        assert!(matches!(classify("login.feature", "feature", ""), Some(Kind::Gherkin)));
    }
    /// varre arquivos reais (LINT_SCAN=pasta1;pasta2) e mostra, por família, os arquivos que acusaram algo: arquivos
    /// válidos de verdade não deveriam acusar nada. cargo test --release --bin bluescreen scan_real -- --ignored --nocapture
    #[test]
    #[ignore]
    fn scan_real_files() {
        let mut stats: std::collections::BTreeMap<String, (usize, usize, Vec<String>)> = Default::default();
        let mut per_ext: HashMap<String, usize> = HashMap::new();
        fn walk(d: &std::path::Path, out: &mut Vec<std::path::PathBuf>, depth: u32) {
            if depth > 14 || out.len() > 400_000 { return; }
            let Ok(rd) = std::fs::read_dir(d) else { return };
            for e in rd.flatten() {
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_symlink() { continue; }
                if ft.is_dir() { if e.file_name() != ".git" { walk(&e.path(), out, depth + 1); } } else { out.push(e.path()); }
            }
        }
        let mut files = vec![];
        for r in std::env::var("LINT_SCAN").unwrap_or_default().split(';').filter(|s| !s.is_empty()) { walk(std::path::Path::new(r), &mut files, 0); }
        for f in files {
            let name = f.file_name().unwrap().to_string_lossy().to_lowercase();
            let ext = f.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if BINARY.contains(&ext.as_str()) { continue; }
            let n = per_ext.entry(ext.clone()).or_default(); if *n >= 2000 { continue; } *n += 1;
            let Ok(md) = f.metadata() else { continue }; if md.len() > 2_000_000 { continue; }
            let Ok(b) = std::fs::read(&f) else { continue }; let Some(txt) = decode(&b) else { continue };
            let Some(r) = crate::lint::text_rules(&ext, &name, &txt) else { continue };
            let key = format!("{} (.{})", r.tool.unwrap_or_default(), if ext.is_empty() { name.clone() } else { ext });
            let s = stats.entry(key).or_default(); s.0 += 1;
            if !r.problems.is_empty() {
                s.1 += 1;
                if s.2.len() < 4 { s.2.push(format!("{}\n        {}", f.display(), r.problems.iter().take(3).map(|x| format!("{}:{} {}", x.line, x.col, x.msg)).collect::<Vec<_>>().join("\n        "))); }
            }
        }
        let (mut tf, mut tb) = (0, 0);
        for (k, (n, bad, ex)) in &stats {
            tf += n; tb += bad;
            if *bad > 0 { println!("{k}: {bad}/{n} com problemas"); for e in ex { println!("    {e}"); } }
        }
        println!("\nTOTAL: {tf} arquivos em {} tipos, {tb} com problemas", stats.len());
        let clean: Vec<String> = stats.iter().filter(|x| x.1.1 == 0).map(|x| format!("{} {}", x.0, x.1.0)).collect();
        println!("sem nenhum problema: {}", clean.join(", "));
    }
    #[test]
    fn catalog() {
        assert!(matches!(classify("dockerfile", "", ""), Some(Kind::Docker)));
        assert!(matches!(classify("a.m", "m", "function y = f(x)\n% c"), Some(Kind::Code(s)) if s.name == "matlab"));
        assert!(matches!(classify("a.m", "m", "#import <Foundation/Foundation.h>"), Some(Kind::Code(s)) if s.name == "c-like"));
        assert!(matches!(classify("web.config", "config", "<?xml version=\"1.0\"?><configuration/>"), Some(Kind::Xml)));
        assert!(matches!(classify("a.cls", "cls", "VERSION 1.0 CLASS\nBEGIN"), Some(Kind::Vb)));
        assert!(classify("a.java", "java", "").is_none());
        assert_eq!(shebang("#!/usr/bin/env python3\nprint(1)"), Some("py"));
        assert_eq!(shebang("#!/bin/bash -e"), Some("sh"));
        assert!(decode(&[0xFF, 0xFE, b'a', 0, b'b', 0]).as_deref() == Some("ab"));
        assert!(decode(b"ab\0c").is_none());
    }
}
