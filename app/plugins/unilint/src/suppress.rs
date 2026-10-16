//! Supressão central (fora das regras, como o pipeline do golangci-lint), com o modelo de cada linguagem:
//! - comentários de linha, de próxima linha, de intervalo (disable ... enable), de arquivo e de escopo;
//! - atributos e anotações nativos (`#[allow(...)]`, `@SuppressWarnings`, `@Suppress`, `[SuppressMessage]`),
//!   que valem para o item anotado inteiro;
//! - `#pragma warning disable/restore` do C#.
//!
//! Os nomes de regra podem ser os do unilint ou os de qualquer linter equivalente (`F401`, `no-unused-vars`,
//! `clippy::eq_op`, `UNUSED_VARIABLE`, `Lint/UselessAssignment`, `IDE0059`...), e os grupos (`unused`, `all`, `warnings`).
use crate::diag::Diagnostic;
use crate::rules;

/// Trecho silenciado: linhas [from, to] (1-based, inclusivo); `rules` vazio = todas as regras.
#[derive(Debug, Clone)]
pub struct Supp { pub from: u32, pub to: u32, pub rules: Vec<String> }

/// Comentário (ou pragma) com cara de diretiva, já com o contexto que o motor sabe dar.
pub struct Raw<'a> {
    pub text: &'a str,
    pub line: u32,
    pub end_line: u32,
    /// sozinho na linha (sem código antes)
    pub own_line: bool,
    /// linhas do próximo comando/declaração depois do comentário (quando está sozinho na linha)
    pub next: Option<(u32, u32)>,
    /// fim do escopo onde o comentário está (função), ou a última linha do arquivo
    pub scope_end: u32,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Line,
    Next,
    /// sozinho na linha: a próxima linha; no fim de uma linha de código: aquela linha
    NextOrLine,
    /// sozinho na linha: o próximo item inteiro (função, comando); no fim da linha: aquela linha
    NextItem,
    File,
    Start(&'static str),
    End(&'static str),
    /// sozinho na linha: até o enable da mesma família ou o fim do escopo; no fim da linha: aquela linha
    Scope(&'static str),
    /// shellcheck: antes do primeiro comando vale para o script todo; depois, para o próximo comando
    ShellCheck,
}
use Kind::*;

/// palavras que um comentário precisa ter para valer a pena analisar (o motor filtra com isso)
pub const HINTS: &[&str] = &["disable", "noqa", "NOLINT", "nolint", "ignore", "suppress", "Suppress", "ReSharper", "pragma", "@diagnostic", "rubocop:", "phpcs:", "enable", "restore", "luacheck"];

// os mais longos antes dos que são prefixo deles
const MARKERS: &[(&str, Kind)] = &[
    ("unilint-disable-next-line", Next), ("unilint-disable-line", Line), ("unilint-disable-file", File), ("unilint-enable", End("unilint")), ("unilint-disable", Start("unilint")),
    ("eslint-disable-next-line", Next), ("eslint-disable-line", Line), ("eslint-enable", End("eslint")), ("eslint-disable", Start("eslint")),
    ("oxlint-disable-next-line", Next), ("oxlint-disable-line", Line), ("oxlint-enable", End("oxlint")), ("oxlint-disable", Start("oxlint")),
    ("biome-ignore-all", File), ("biome-ignore-start", Start("biome")), ("biome-ignore-end", End("biome")), ("biome-ignore", Next),
    ("NOLINTNEXTLINE", Next), ("NOLINTBEGIN", Start("nolint")), ("NOLINTEND", End("nolint")), ("NOLINT", Line),
    ("nolint", NextItem),
    ("ruff: noqa", File), ("flake8: noqa", File), ("noqa", Line),
    ("pylint: disable-next=", Next), ("pylint: disable=", Scope("pylint")), ("pylint: enable=", End("pylint")),
    ("rubocop:disable", Scope("rubocop")), ("rubocop:todo", Scope("rubocop")), ("rubocop:enable", End("rubocop")),
    ("shellcheck disable=", ShellCheck),
    ("phpcs:ignoreFile", File), ("phpcs:ignore", NextOrLine), ("phpcs:disable", Start("phpcs")), ("phpcs:enable", End("phpcs")),
    ("@phpstan-ignore-next-line", Next), ("@phpstan-ignore-line", Line), ("@phpstan-ignore", NextOrLine), ("@psalm-suppress", NextItem),
    ("@diagnostic disable-next-line", Next), ("@diagnostic disable-line", Line), ("@diagnostic disable", Start("luals")), ("@diagnostic enable", End("luals")),
    ("luacheck: ignore", NextOrLine),
    ("ReSharper disable once", Next), ("ReSharper disable", Start("resharper")), ("ReSharper restore", End("resharper")),
    ("pragma warning disable", Start("pragma")), ("pragma warning restore", End("pragma")),
    ("cppcheck-suppress", NextOrLine),
];

/// nomes de regra depois do marcador, até o fim da diretiva (`-- motivo`, `// motivo`, `*/`)
fn rule_list(rest: &str) -> Vec<String> {
    let rest = rest.trim_start_matches([':', '=', ' ', '\t', '(']);
    let end = ["\n", "*/", "-->", " -- ", " // ", "//", ")", "#>", "]]"].iter().filter_map(|m| rest.find(m)).min().unwrap_or(rest.len());
    rest[..end].split([',', ' ', '\t']).map(|s| s.trim().trim_matches(['"', '\'', '`'])).filter(|s| !s.is_empty() && *s != "-" && *s != "--").map(String::from).collect()
}

/// Monta os trechos silenciados a partir dos comentários e dos atributos já resolvidos pelo motor.
pub fn build(raws: &[Raw], mut attrs: Vec<Supp>, last_line: u32, first_code_line: u32) -> Vec<Supp> {
    let mut out = std::mem::take(&mut attrs);
    // intervalos abertos: (família, linha de início, regras)
    let mut open: Vec<(&'static str, u32, Vec<String>, u32)> = vec![];
    for r in raws {
        let Some((kind, rest)) = MARKERS.iter().find_map(|(m, k)| r.text.find(m).map(|i| (*k, &r.text[i + m.len()..]))) else { continue };
        let rules = rule_list(rest);
        let next_line = r.end_line + 1;
        let item = r.next.unwrap_or((next_line, next_line));
        match kind {
            Line => out.push(Supp { from: r.line, to: r.end_line, rules }),
            Next => out.push(Supp { from: next_line, to: next_line, rules }),
            NextOrLine => out.push(if r.own_line { Supp { from: next_line, to: next_line, rules } } else { Supp { from: r.line, to: r.end_line, rules } }),
            NextItem => out.push(if r.own_line { Supp { from: item.0, to: item.1, rules } } else { Supp { from: r.line, to: r.end_line, rules } }),
            File => out.push(Supp { from: 1, to: last_line, rules }),
            ShellCheck => out.push(if r.own_line && r.line < first_code_line { Supp { from: 1, to: last_line, rules } } else if r.own_line { Supp { from: item.0, to: item.1, rules } } else { Supp { from: r.line, to: r.end_line, rules } }),
            Start(fam) => open.push((fam, r.line, rules, last_line)),
            Scope(fam) => if r.own_line { open.push((fam, r.line, rules, r.scope_end)) } else { out.push(Supp { from: r.line, to: r.end_line, rules }) },
            End(fam) => {
                // fecha os abertos da família (todos, ou só os que citam alguma das regras)
                let mut i = 0;
                while i < open.len() {
                    let o = &open[i];
                    if o.0 == fam && (rules.is_empty() || o.2.is_empty() || o.2.iter().any(|x| rules.contains(x))) {
                        let o = open.remove(i);
                        out.push(Supp { from: o.1, to: r.line.min(o.3), rules: o.2 });
                    } else { i += 1; }
                }
            }
        }
    }
    for o in open { out.push(Supp { from: o.1, to: o.3, rules: o.2 }); }
    out
}

/// nome de regra comparável: sem prefixo de ferramenta/departamento, minúsculo, só letras e números
fn norm(t: &str) -> String {
    let mut t = t.trim();
    if let Some(i) = t.rfind("::") { t = &t[i + 2..]; }
    else if let Some(x) = t.strip_prefix("checkstyle:") { t = x; }
    else if let Some(i) = t.find(':') { t = &t[..i]; } // "IDE0059:Remover atribuição"
    if let Some(i) = t.rfind('/') { t = &t[i + 1..]; }
    let lower = t.to_ascii_lowercase();
    let t = lower.strip_prefix("pmd.").unwrap_or(&lower);
    t.chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}
const CLIPPY_GROUPS: &[&str] = &["all", "pedantic", "nursery", "style", "complexity", "correctness", "suspicious", "perf", "restriction", "cargo"];

fn matches(rules_in: &[String], diag: &Diagnostic) -> bool {
    if rules_in.is_empty() { return true; }
    let eq = rules::by_id(diag.rule).map(|r| r.equivalents).unwrap_or(&[]);
    let mine = norm(diag.rule);
    rules_in.iter().any(|t| {
        if t.starts_with("clippy::") && CLIPPY_GROUPS.contains(&&t[8..]) { return true; }
        let n = norm(t);
        if matches!(n.as_str(), "all" | "warnings" | "") { return true; }
        // grupo `unused` (rustc, @SuppressWarnings do Java, Kotlin): variável, import e código morto
        if n == "unused" { return matches!(diag.rule, "unused-variable" | "unused-import" | "unreachable"); }
        n == mine || eq.iter().any(|e| norm(e) == n)
    })
}

pub fn apply(supps: &[Supp], diags: &mut Vec<Diagnostic>) {
    if supps.is_empty() { return; }
    diags.retain(|g| !supps.iter().any(|s| g.line >= s.from && g.line <= s.to && matches(&s.rules, g)));
}

/// Regras citadas num atributo/anotação de supressão, ou None se não é de supressão.
/// `#[allow(a, clippy::b)]`, `#[expect(...)]`, `@SuppressWarnings({"unused", "x"})`, `@Suppress("A")`,
/// `[SuppressMessage("Categoria", "IDE0059:...")]`, `@file:Suppress(...)`.
pub fn attr_rules(text: &str) -> Option<Vec<String>> {
    for key in ["allow(", "expect("] {
        if let Some(i) = text.find(key) {
            let rest = &text[i + key.len()..];
            let body = &rest[..rest.find(')').unwrap_or(rest.len())];
            return Some(body.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect());
        }
    }
    if ["SuppressWarnings", "Suppress(", "SuppressMessage", "SuppressLint", "suppress("].iter().any(|k| text.contains(k)) {
        // os textos entre aspas são os nomes (no SuppressMessage, o primeiro é a categoria: não atrapalha)
        let parts: Vec<String> = text.split('"').skip(1).step_by(2).map(String::from).collect();
        return Some(if parts.is_empty() { vec!["all".into()] } else { parts });
    }
    None
}
