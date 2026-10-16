//! JSP: o Java dos scriptlets passa pelo mesmo lint do Java. O arquivo vira dois fontes Java virtuais com as mesmas
//! linhas e colunas do original (tudo que não é Java vira espaço, as quebras de linha ficam):
//! - corpo: `<% ... %>` e `<%= ... %>` dentro de um método (scriptlets de um `if` aberto num e fechado noutro se juntam);
//! - declarações: `<%! ... %>` dentro da classe (campos e métodos).
//! A primeira linha de cada fonte é a casca (classe e método); os avisos voltam uma linha para cima.
use crate::diag::Diagnostic;
use crate::lang::Lang;

const CLASS: &str = "class _Jsp {\n";
const METHOD: &str = "class _Jsp { void _jspService() throws Exception {\n";
/// medidas que só fazem sentido para um método de verdade, não para a página inteira
const PAGE_METRICS: &[&str] = &["long-function", "complexity", "deep-nesting", "too-many-params", "unused-import"];

#[derive(Clone, Copy, PartialEq)]
enum Part { Body, Decl }

/// (corpo, declarações, tem algum Java)
fn split(src: &str) -> (String, String, bool) {
    let blank = |s: &str, out: &mut String| for c in s.chars() { out.push(if c == '\n' || c == '\r' { c } else { ' ' }); };
    let (mut body, mut decl) = (String::with_capacity(src.len()), String::with_capacity(src.len()));
    let mut any = false;
    let mut rest = src;
    while let Some(i) = rest.find("<%") {
        blank(&rest[..i], &mut body); blank(&rest[..i], &mut decl);
        let tag = &rest[i..];
        // comentário JSP: some inteiro
        if tag.starts_with("<%--") {
            let end = tag.find("--%>").map(|e| e + 4).unwrap_or(tag.len());
            blank(&tag[..end], &mut body); blank(&tag[..end], &mut decl);
            rest = &tag[end..]; continue;
        }
        let (open, part, expr) = match tag.as_bytes().get(2) {
            Some(b'@') => { // diretiva: não é Java
                let end = tag.find("%>").map(|e| e + 2).unwrap_or(tag.len());
                blank(&tag[..end], &mut body); blank(&tag[..end], &mut decl);
                rest = &tag[end..]; continue;
            }
            Some(b'!') => (3, Part::Decl, false),
            Some(b'=') => (3, Part::Body, true),
            _ => (2, Part::Body, false),
        };
        any = true;
        let close = tag[open..].find("%>").map(|e| e + open);
        let code = &tag[open..close.unwrap_or(tag.len())];
        let (into, other) = if part == Part::Body { (&mut body, &mut decl) } else { (&mut decl, &mut body) };
        // <%= x %> vira _o(x); com o mesmo tamanho: "<%=" -> "_o(" e "%>" -> ");"
        into.push_str(if expr { "_o(" } else if open == 3 { "   " } else { "  " });
        into.push_str(code);
        blank(&tag[..open], other); blank(code, other);
        match close {
            Some(c) => { into.push_str(if expr { ");" } else { "  " }); other.push_str("  "); rest = &tag[c + 2..]; }
            None => { rest = ""; }
        }
    }
    blank(rest, &mut body); blank(rest, &mut decl);
    (body, decl, any)
}

fn run(head: &str, src: &str, file_name: &str, skip: &[&str]) -> Vec<Diagnostic> {
    let text = format!("{head}{src}\n}}{}", if head == METHOD { "}" } else { "" });
    let mut out: Vec<Diagnostic> = crate::lint_source(Lang::Java, &text, file_name).into_iter()
        .filter(|d| d.line > 1 && !skip.contains(&d.rule))
        .collect();
    let last = src.split('\n').count() as u32;
    for d in out.iter_mut() {
        d.line -= 1; d.end_line = d.end_line.saturating_sub(1).max(d.line);
        // erro "no fim do arquivo" (casca fechando): aponta a última linha do original
        if d.line > last { d.line = last; d.col = 1; d.end_line = last; d.end_col = 1; }
        d.fixes.clear(); // as correções são em bytes do fonte virtual
    }
    out
}

/// Lint do Java de uma página JSP (.jsp, .jspf, .tag). Sem scriptlets, nada.
pub fn lint(src: &str, file_name: &str) -> Vec<Diagnostic> {
    let (body, decl, any) = split(src);
    if !any { return vec![]; }
    // fragmentos (.jspf, .tag) podem abrir um bloco que outro arquivo fecha: chaves desbalanceadas de propósito
    let balanced = |s: &str| s.matches('{').count() == s.matches('}').count();
    let fragment = !file_name.to_ascii_lowercase().ends_with(".jsp");
    let mut skip: Vec<&str> = PAGE_METRICS.to_vec();
    if fragment && !balanced(&body) { skip.push("syntax"); }
    let mut out = run(METHOD, &body, file_name, &skip);
    if decl.trim().len() > 0 { out.extend(run(CLASS, &decl, file_name, &["unused-import"])); }
    out.sort_by(|a, b| (a.line, a.col).cmp(&(b.line, b.col)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_positions() {
        let src = "<%@ page import=\"x\" %>\n<p>ola</p>\n<%\n  int a = 1;\n  if (a > 0) {\n%>\n<b>${a}</b>\n<% } %>\n<%= a %>\n<%! private int n; %>";
        let (body, decl, any) = split(src);
        assert!(any);
        assert_eq!(body.chars().count(), src.chars().count());
        assert_eq!(decl.chars().count(), src.chars().count());
        assert!(body.contains("int a = 1;") && body.contains("_o( a );") && !body.contains("private"));
        assert!(decl.contains("private int n;") && !decl.contains("int a"));
        assert!(lint(src, "a.jsp").iter().all(|d| d.rule != "syntax"));
    }
    #[test]
    fn finds_java_errors() {
        // falta o ; da linha 3
        let src = "<p>x</p>\n<%\n  String s = \"a\"\n  out.print(s);\n%>";
        let d = lint(src, "a.jsp");
        assert!(d.iter().any(|d| d.rule == "syntax" && d.line == 3), "{d:?}");
        // falta a } do if
        let src = "<%\n if (true) {\n  out.print(1);\n%>\n<p/>";
        assert!(lint(src, "b.jsp").iter().any(|d| d.rule == "syntax"));
        // no fragmento, bloco aberto aqui e fechado em outro arquivo é normal
        assert!(lint(src, "b.jspf").iter().all(|d| d.rule != "syntax"));
    }
}
