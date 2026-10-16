//! O motor: um parse, uma passada pela árvore (cursor, sem recursão), despacho por tabela de conceitos.
//! Cada nó custa uma consulta num vetor; só os nós de um conceito conhecido chegam às regras.
use crate::diag::{Diagnostic, Edit, Fix, Rule};
use crate::lang::Lang;
use crate::rules::*;
use crate::spec::{Imports, Profile, k, profile};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use tree_sitter::{Node, Parser, Point, Tree};

thread_local! {
    // um parser por linguagem e por thread: criar um Parser custa mais que o parse de um arquivo pequeno
    static PARSERS: RefCell<Vec<Option<Parser>>> = RefCell::new((0..crate::lang::ALL.len()).map(|_| None).collect());
}

pub fn parse(lang: Lang, src: &str) -> Option<Tree> {
    PARSERS.with(|ps| {
        let mut ps = ps.borrow_mut();
        let slot = &mut ps[lang.index()];
        if slot.is_none() {
            let mut p = Parser::new();
            p.set_language(&profile(lang).language).ok()?;
            *slot = Some(p);
        }
        slot.as_mut()?.parse(src, None)
    })
}

struct Frame<'t> { node: Node<'t>, depth: u32, max_depth: u32, complexity: u32, vars: Vec<Node<'t>> }

pub(crate) struct Cx<'a, 't> {
    src: &'a str,
    p: &'static Profile,
    file_name: &'a str,
    pub out: Vec<Diagnostic>,
    frames: Vec<Frame<'t>>,
    /// intervalos (bytes) dos comentários, em ordem: o que está neles não conta como uso de nome
    comments: Vec<(usize, usize)>,
    /// comentários que são documentação ou anotação de tipo (`/** {@link X} */`, `# type: X`): contam para imports
    doc_comments: Vec<(usize, usize)>,
    /// comentários e pragmas com cara de diretiva de supressão
    raws: Vec<crate::suppress::Raw<'a>>,
    /// supressões vindas de atributos/anotações (`#[allow]`, `@SuppressWarnings`...), já com o trecho do item
    attr_supps: Vec<crate::suppress::Supp>,
    last_line: u32,
    imports: Vec<Node<'t>>,
    /// ifs que já foram vistos como parte de uma cadeia else-if (não começam outra)
    chained: HashSet<usize>,
    /// ancestrais do nó atual. Node::parent() do Tree-sitter desce da raiz a cada chamada (O(profundidade)):
    /// a pilha do próprio percurso dá o pai em O(1)
    anc: Vec<Node<'t>>,
    /// imports dentro de try (Python): checagem de dependência opcional
    guarded_imports: HashSet<usize>,
}

/// letra de identificador; `$` só conta onde faz parte do nome (JS/TS/PHP). No Kotlin, Bash, Rust ("{x$}") e
/// PowerShell ele vem antes ou depois do nome e precisa separar a palavra.
#[inline]
fn is_ident(b: u8, dollar: bool) -> bool { b.is_ascii_alphanumeric() || b == b'_' || (dollar && b == b'$') || b >= 0x80 }

/// texto sem espaços em branco fora de strings e sem parênteses externos (para comparar condições e operandos)
fn norm(s: &str) -> String {
    let mut t = String::with_capacity(s.len());
    let mut quote: Option<char> = None;
    let mut esc = false;
    for c in s.chars() {
        match quote {
            Some(q) => { t.push(c); if esc { esc = false; } else if c == '\\' { esc = true; } else if c == q { quote = None; } }
            None => { if c == '"' || c == '\'' || c == '`' { quote = Some(c); t.push(c); } else if !c.is_whitespace() { t.push(c); } }
        }
    }
    while t.len() >= 2 && t.starts_with('(') && t.ends_with(')') && balanced(&t[1..t.len() - 1]) { t = t[1..t.len() - 1].to_string(); }
    t
}
fn balanced(s: &str) -> bool {
    let mut d = 0i32;
    for c in s.bytes() { match c { b'(' => d += 1, b')' => { d -= 1; if d < 0 { return false; } } _ => {} } }
    d == 0
}
/// chamada, incremento, await...: duas ocorrências do mesmo texto podem dar valores diferentes
fn impure(s: &str) -> bool { s.contains('(') || s.contains("++") || s.contains("--") || s.contains("await") || s.contains("yield") || s.contains('$') && s.contains('{') }

impl<'a, 't> Cx<'a, 't> {
    #[inline]
    fn text(&self, n: Node) -> &'a str { self.src.get(n.byte_range()).unwrap_or("") }
    #[inline]
    fn is(&self, n: Node, f: u32) -> bool { self.p.flags(n.kind_id()) & f != 0 }
    fn dollar(&self) -> bool { matches!(self.p.lang, Lang::JavaScript | Lang::TypeScript | Lang::Tsx | Lang::Php) }
    fn pos(&self, byte: usize, pt: Point) -> (u32, u32) {
        let ls = byte.saturating_sub(pt.column);
        let col = self.src.get(ls..byte).map(|s| s.chars().count()).unwrap_or(pt.column);
        (pt.row as u32 + 1, col as u32 + 1)
    }
    fn push(&mut self, rule: &'static Rule, start: (usize, Point), end: (usize, Point), message: String, fixes: Vec<Fix>) {
        let (line, col) = self.pos(start.0, start.1);
        let (end_line, end_col) = self.pos(end.0, end.1);
        self.out.push(Diagnostic { rule: rule.id, severity: rule.severity, message, line, col, end_line, end_col, fixes });
    }
    fn report(&mut self, rule: &'static Rule, n: Node, message: String) {
        self.push(rule, (n.start_byte(), n.start_position()), (n.end_byte(), n.end_position()), message, vec![]);
    }
    /// só a primeira linha do nó (para funções e blocos grandes)
    fn report_head(&mut self, rule: &'static Rule, n: Node, message: String) {
        let t = self.text(n);
        let len = t.find('\n').unwrap_or(t.len()).min(120);
        let end = Point { row: n.start_position().row, column: n.start_position().column + len };
        self.push(rule, (n.start_byte(), n.start_position()), (n.start_byte() + len, end), message, vec![]);
    }

    fn named_children(&self, n: Node<'t>) -> Vec<Node<'t>> {
        let mut c = n.walk();
        n.named_children(&mut c).filter(|x| !self.is(*x, k::COMMENT)).collect()
    }

    // ---------- percurso ----------
    fn walk(&mut self, root: Node<'t>) {
        let mut cur = root.walk();
        loop {
            let node = cur.node();
            let f = self.p.flags(node.kind_id());
            if f != 0 { self.enter(node, f); }
            if cur.goto_first_child() { self.anc.push(node); continue; }
            loop {
                let n = cur.node();
                let f = self.p.flags(n.kind_id());
                if f != 0 { self.leave(n, f); }
                if cur.goto_next_sibling() { break; }
                if !cur.goto_parent() { return; }
                self.anc.pop();
            }
        }
    }

    fn counts_depth(&self, n: Node, f: u32) -> bool { f & (k::IF | k::LOOP | k::CATCH) != 0 && !(f & k::IF != 0 && self.is_chain_if(n)) }
    /// pai do nó atual do percurso
    #[inline]
    fn parent(&self) -> Option<Node<'t>> { self.anc.last().copied() }
    #[inline]
    fn grandparent(&self) -> Option<Node<'t>> { self.anc.len().checked_sub(2).map(|i| self.anc[i]) }
    fn is_chain_if(&self, n: Node) -> bool {
        let Some(par) = self.parent() else { return false };
        if self.is(par, k::ELSE) { return true; }
        if self.is(par, k::IF | k::ELIF) { let mut c = par.walk(); return par.children_by_field_name("alternative", &mut c).any(|x| x.id() == n.id()); }
        false
    }

    fn enter(&mut self, n: Node<'t>, f: u32) {
        if f & k::COMMENT != 0 { self.comment(n); return; }
        if f & k::PRAGMA != 0 { self.directive(n); return; }
        if f & k::ATTR != 0 { self.attribute(n); }
        if f & k::FUNC != 0 { self.frames.push(Frame { node: n, depth: 0, max_depth: 0, complexity: 1, vars: vec![] }); }
        let depth = self.counts_depth(n, f);
        if let Some(fr) = self.frames.last_mut() {
            if depth { fr.depth += 1; fr.max_depth = fr.max_depth.max(fr.depth); }
            if f & (k::IF | k::ELIF | k::LOOP | k::CATCH | k::TERNARY | k::CASE) != 0 { fr.complexity += 1; }
        }
        if f & k::IF != 0 && !self.chained.contains(&n.id()) { self.if_chain(n); }
        if f & k::CATCH != 0 { self.catch(n); }
        if f & (k::JUMP | k::WRAP) != 0 { self.unreachable(n, f); }
        if f & k::ASSIGN != 0 { self.self_assign(n); }
        if f & k::BINARY != 0 { self.binary(n); }
        if f & k::MAP != 0 { self.map(n); }
        if f & k::TERNARY != 0 { self.ternary(n); }
        if f & k::DEBUG != 0 {
            let fix = Fix { title: "Remover".into(), edits: vec![Edit { start: n.start_byte(), end: n.end_byte(), text: String::new() }], safe: true };
            self.push(&DEBUGGER, (n.start_byte(), n.start_position()), (n.end_byte(), n.end_position()), format!("`{}` esquecido no código", self.text(n).trim_end_matches(';')), vec![fix]);
        }
        if f & k::CALL != 0 && !self.p.spec.debug_calls.is_empty() { self.debug_call(n); }
        if f & k::VARDECL != 0 && !self.frames.is_empty() { self.vardecl(n); }
        if f & k::IMPORT != 0 {
            if self.p.spec.imports == Imports::Python && self.anc.iter().any(|a| a.kind() == "try_statement") { self.guarded_imports.insert(n.id()); }
            self.imports.push(n);
        }
    }

    // ---------- comentários e supressões ----------
    fn comment(&mut self, n: Node<'t>) {
        let (s, e) = (n.start_byte(), n.end_byte());
        self.comments.push((s, e));
        let t = self.text(n);
        let doc = t.starts_with("/**") || t.starts_with("///") || t.starts_with("//!") || t.trim_start_matches('#').trim_start().starts_with("type:");
        if doc { self.doc_comments.push((s, e)); }
        self.directive(n);
    }
    fn directive(&mut self, n: Node<'t>) {
        let text = self.text(n);
        if !crate::suppress::HINTS.iter().any(|h| text.contains(h)) { return; }
        let line_start = self.src[..n.start_byte()].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let own_line = self.src[line_start..n.start_byte()].trim().is_empty();
        let next = if own_line { self.next_item(n) } else { None };
        let scope_end = self.frames.last().map(|f| f.node.end_position().row as u32 + 1).unwrap_or(self.last_line);
        self.raws.push(crate::suppress::Raw { text, line: n.start_position().row as u32 + 1, end_line: n.end_position().row as u32 + 1, own_line, next, scope_end });
    }
    /// linhas do próximo irmão que não é comentário nem atributo (o item que a diretiva/atributo anota)
    fn next_item(&self, n: Node<'t>) -> Option<(u32, u32)> {
        let par = self.parent()?;
        let mut c = par.walk();
        let x = par.named_children(&mut c).skip_while(|x| x.id() != n.id()).skip(1).find(|x| !self.is(*x, k::COMMENT | k::ATTR))?;
        Some((x.start_position().row as u32 + 1, x.end_position().row as u32 + 1))
    }
    fn attribute(&mut self, n: Node<'t>) {
        let Some(rules) = crate::suppress::attr_rules(self.text(n)) else { return };
        let line = n.start_position().row as u32 + 1;
        let whole = (1, self.last_line);
        let target = match n.kind() {
            "file_annotation" => Some(whole),
            // #![allow] vale para o item onde está (o arquivo, se estiver no topo)
            "inner_attribute_item" => self.parent().map(|p| if self.anc.len() <= 1 { whole } else { (p.start_position().row as u32 + 1, p.end_position().row as u32 + 1) }),
            // #[allow] vale para o próximo item
            "attribute_item" => self.next_item(n),
            // anotação: sobe por modifiers/attribute_list até a declaração
            _ => self.anc.iter().rev().find(|a| { let k = a.kind(); !k.contains("modifier") && !k.contains("annotation") && !k.contains("attribute") })
                .map(|a| (a.start_position().row as u32 + 1, a.end_position().row as u32 + 1)),
        };
        if let Some((from, to)) = target { self.attr_supps.push(crate::suppress::Supp { from: from.min(line), to, rules }); }
    }
    fn in_comment(&self, pos: usize) -> bool {
        let i = self.comments.partition_point(|c| c.0 <= pos);
        i > 0 && pos < self.comments[i - 1].1
    }

    fn leave(&mut self, n: Node<'t>, f: u32) {
        if f & (k::COMMENT | k::PRAGMA) != 0 { return; }
        if self.counts_depth(n, f) { if let Some(fr) = self.frames.last_mut() { fr.depth = fr.depth.saturating_sub(1); } }
        if f & k::FUNC != 0 {
            if let Some(fr) = self.frames.pop() { self.function_done(fr); }
        }
    }

    // ---------- if / else if ----------
    fn if_chain(&mut self, top: Node<'t>) {
        let mut conds: Vec<Node<'t>> = vec![];
        let mut else_body: Option<Node<'t>> = None;
        self.collect_chain(top, &mut conds, &mut else_body, 0);
        // condições repetidas e constantes
        let mut seen: Vec<(String, u32)> = vec![];
        for c in &conds {
            let t = norm(self.text(*c));
            if t.is_empty() { continue; }
            let toggles = matches!(self.p.lang, Lang::Go | Lang::C | Lang::Cpp | Lang::Rust);
            if !toggles && matches!(t.as_str(), "true" | "false" | "True" | "False" | "$true" | "$false") {
                self.report(&CONSTANT_CONDITION, *c, format!("Condição sempre {}", if t.to_lowercase().ends_with("true") { "verdadeira" } else { "falsa" }));
            }
            let line = c.start_position().row as u32 + 1;
            if let Some((_, l)) = seen.iter().find(|(s, _)| *s == t) {
                if !impure(&t) { self.report(&DUP_CONDITION, *c, format!("Condição repetida: já foi testada na linha {l}, este ramo nunca roda")); }
            } else { seen.push((t, line)); }
        }
        let cons = top.child_by_field_name("consequence").or_else(|| top.child_by_field_name("body")).or_else(|| self.positional(top).0);
        if let Some(b) = cons {
            if else_body.is_none() && conds.len() == 1 && self.is(b, k::BLOCK) && b.named_child_count() == 0 && self.text(b).starts_with('{') { self.report_head(&EMPTY_BLOCK, b, "Bloco do if vazio".into()); }
        }
        // if/else com os dois lados iguais (só cadeia de um if, para não acusar else-if parecidos)
        // condição que cria variável (`if let`, `:=`, `is T x`): o mesmo nome nos dois ramos pode ser outra variável
        let binds = conds.first().is_some_and(|c| { let t = self.text(*c); t.trim_start().starts_with("let ") || t.contains(":=") || t.contains(" is ") || c.kind().contains("let") });
        if conds.len() == 1 && !binds {
            if let (Some(a), Some(b)) = (cons, else_body) {
                let (ta, tb) = (norm(self.text(a)), norm(self.text(b)));
                if !ta.is_empty() && ta == tb { self.report_head(&IDENTICAL_BRANCHES, top, "if e else fazem exatamente a mesma coisa".into()); }
            }
        }
    }
    /// if sem campos de ramo (Kotlin): os filhos depois da condição são (então, senão)
    fn positional(&self, n: Node<'t>) -> (Option<Node<'t>>, Option<Node<'t>>) {
        if n.child_by_field_name("consequence").is_some() || n.child_by_field_name("alternative").is_some() || n.child_by_field_name("body").is_some() { return (None, None); }
        let cond = n.child_by_field_name("condition").map(|c| c.id());
        let rest: Vec<Node<'t>> = self.named_children(n).into_iter().filter(|x| Some(x.id()) != cond && !self.is(*x, k::ELIF | k::ELSE)).collect();
        (rest.first().copied(), rest.get(1).copied())
    }
    fn collect_chain(&mut self, n: Node<'t>, conds: &mut Vec<Node<'t>>, else_body: &mut Option<Node<'t>>, depth: u32) {
        if depth > 300 { return; }
        if let Some(c) = n.child_by_field_name("condition") { conds.push(c); }
        if let (_, Some(alt)) = self.positional(n) {
            if self.is(alt, k::IF) { self.chained.insert(alt.id()); self.collect_chain(alt, conds, else_body, depth + 1); } else { *else_body = Some(alt); }
        }
        let mut cur = n.walk();
        if !cur.goto_first_child() { return; }
        loop {
            let ch = cur.node();
            let field = cur.field_name();
            if ch.is_named() && !matches!(field, Some("consequence" | "condition" | "body")) {
                let f = self.p.flags(ch.kind_id());
                if f & k::ELIF != 0 || (f & k::IF != 0 && field == Some("alternative")) { self.chained.insert(ch.id()); self.collect_chain(ch, conds, else_body, depth + 1); }
                else if f & k::ELSE != 0 {
                    let inner = ch.child_by_field_name("body").or_else(|| { let v = self.named_children(ch); if v.len() == 1 { Some(v[0]) } else { None } });
                    match inner {
                        Some(i) if self.is(i, k::IF) => { self.chained.insert(i.id()); self.collect_chain(i, conds, else_body, depth + 1); }
                        Some(i) => *else_body = Some(i),
                        None => {}
                    }
                } else if field == Some("alternative") && f & k::BLOCK != 0 { *else_body = Some(ch); }
                else if f == 0 {
                    // contêiner de elifs (elseif_clauses do PowerShell)
                    let mut c2 = ch.walk();
                    let elifs: Vec<Node<'t>> = ch.named_children(&mut c2).filter(|x| self.is(*x, k::ELIF)).collect();
                    for e in elifs { self.chained.insert(e.id()); self.collect_chain(e, conds, else_body, depth + 1); }
                }
            }
            if !cur.goto_next_sibling() { break; }
        }
    }

    fn ternary(&mut self, n: Node<'t>) {
        let (Some(a), Some(b)) = (n.child_by_field_name("consequence"), n.child_by_field_name("alternative")) else { return };
        let ta = norm(self.text(a));
        if !ta.is_empty() && ta == norm(self.text(b)) { self.report(&IDENTICAL_BRANCHES, n, format!("Os dois lados do operador ternário são `{}`", self.text(a))); }
    }

    // ---------- catch ----------
    fn catch(&mut self, n: Node<'t>) {
        let kids = self.named_children(n);
        let body = n.child_by_field_name("body").or_else(|| kids.iter().rev().find(|x| self.is(**x, k::BLOCK) || x.kind().contains("block")).copied());
        let Some(body) = body else { return };
        if self.p.lang == Lang::Python {
            let head = self.text(n).trim_start_matches("except").trim_start();
            // um comentário no except explica por que ele está vazio
            let mut c = n.walk();
            if n.named_children(&mut c).any(|x| self.is(x, k::COMMENT)) || body.named_child_count() > self.named_children(body).len() { return; }
            if head.starts_with(':') { self.report_head(&BARE_EXCEPT, n, "`except:` sem tipo captura tudo, até KeyboardInterrupt e SystemExit; use `except Exception:`".into()); }
            let stmts = self.named_children(body);
            let broad = head.starts_with(':') || ["Exception", "BaseException"].iter().any(|b| head.starts_with(b) && head[b.len()..].trim_start().starts_with([':', ' ']));
            if broad && !stmts.is_empty() && body.named_child_count() == stmts.len() && stmts.iter().all(|s| s.kind() == "pass_statement") {
                self.report_head(&EMPTY_CATCH, n, "except amplo com só `pass` engole qualquer erro sem deixar rastro".into());
            }
            return;
        }
        // `catch (Exception ignored) {}`: o nome da variável já diz que é de propósito (convenção do IntelliJ)
        let ignored = kids.iter().any(|x| { let t = self.text(*x); ["ignored", "ignore", "expected", "_"].iter().any(|w| t == *w || t.ends_with(&format!(" {w}"))) });
        if ignored { return; }
        let mut c = body.walk();
        let inner = body.named_children(&mut c).filter(|x| !x.kind().ends_with("statement_list") || x.named_child_count() > 0).count();
        if inner == 0 { self.report_head(&EMPTY_CATCH, n, "catch vazio engole o erro sem deixar rastro (trate, registre ou comente o motivo)".into()); }
    }

    // ---------- inalcançável ----------
    fn unreachable(&mut self, n: Node<'t>, f: u32) {
        let jump = if f & k::JUMP != 0 { n } else {
            match n.named_child(0) { Some(j) if self.is(j, k::JUMP) => j, _ => return }
        };
        let Some(par) = self.parent() else { return };
        if !self.is(par, k::BLOCK) { return; }
        // próximo comando (next_named_sibling também sobe pela raiz): anda nos filhos do pai a partir deste
        let mut c = par.walk();
        let next = par.named_children(&mut c).skip_while(|x| x.id() != n.id()).skip(1)
            .find(|x| !self.is(*x, k::COMMENT) && x.kind() != "empty_statement");
        let Some(x) = next else { return };
        if self.is(x, k::EXEMPT) || x.is_extra() || x.kind() == "ERROR" { return; }
        // na mesma linha, sem ';' entre os dois: é a gramática separando `return expr` (Kotlin), não código morto
        let between = self.src.get(n.end_byte()..x.start_byte()).unwrap_or("");
        if !between.contains(['\n', ';']) && !self.text(n).ends_with(';') { return; }
        // `return` seguido de `yield`: o jeito de escrever um gerador vazio no Python
        if self.p.lang == Lang::Python && self.text(x).starts_with("yield") { return; }
        let word: String = self.text(jump).chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        self.report_head(&UNREACHABLE, x, format!("Código inalcançável: vem depois de `{word}`"));
    }

    // ---------- expressões ----------
    /// (esquerda, operador, direita): campos left/right, ou os dois únicos filhos nomeados
    fn split(&self, n: Node<'t>) -> Option<(Node<'t>, Cow<'a, str>, Node<'t>)> {
        let (l, r) = match (n.child_by_field_name("left"), n.child_by_field_name("right")) {
            (Some(l), Some(r)) => (l, r),
            _ => {
                let v = self.named_children(n);
                match v.len() { 2 => (v[0], v[1]), 3 if v[1].kind().ends_with("operator") => (v[0], v[2]), _ => return None }
            }
        };
        let mut c = n.walk();
        let mut op: Option<Cow<'a, str>> = None;
        for ch in n.children(&mut c) {
            if ch.start_byte() < l.end_byte() || ch.end_byte() > r.start_byte() { continue; }
            if ch.is_named() && ch.kind() != "comparison_operator" && !ch.kind().ends_with("operator") { continue; }
            let t = self.text(ch);
            op = Some(match op { None => Cow::Borrowed(t), Some(o) => Cow::Owned(format!("{o} {t}")) });
        }
        Some((l, op?, r))
    }

    fn self_assign(&mut self, n: Node<'t>) {
        let Some((l, op, r)) = self.split(n) else { return };
        if op != "=" { return; }
        // `local x = x` do Lua é o jeito de trazer um global para o escopo local
        if self.parent().is_some_and(|p| p.kind() == "variable_declaration") { return; }
        let lt = self.text(l);
        if impure(lt) || norm(lt).is_empty() || norm(lt) != norm(self.text(r)) { return; }
        self.report(&SELF_ASSIGN, n, format!("`{lt}` recebe ele mesmo: a atribuição não faz nada"));
    }

    fn binary(&mut self, n: Node<'t>) {
        let Some((l, op, r)) = self.split(n) else { return };
        let logic = matches!(op.as_ref(), "&&" | "||" | "and" | "or" | "-and" | "-or");
        let cmp = matches!(op.as_ref(), "==" | "===" | "!=" | "!==" | "<" | ">" | "<=" | ">=" | "is" | "is not" | "-eq" | "-ne");
        if logic { if let Some(fr) = self.frames.last_mut() { fr.complexity += 1; } }
        if !logic && !cmp { return; }
        let lt = self.text(l);
        if impure(lt) || norm(lt).is_empty() || norm(lt) != norm(self.text(r)) { return; }
        let msg = if cmp { format!("`{lt}` comparado com ele mesmo: o resultado é sempre o mesmo (para NaN use isNaN / math.isnan)") }
                  else { format!("Os dois lados de `{op}` são `{lt}`") };
        self.report(&SELF_COMPARE, n, msg);
    }

    fn map(&mut self, n: Node<'t>) {
        let mut seen: HashMap<String, u32> = HashMap::new();
        for pair in self.named_children(n) {
            let Some(key) = pair.child_by_field_name("key").or_else(|| if self.p.lang == Lang::Lua { pair.child_by_field_name("name") } else { None }) else { continue };
            let Some(norm_key) = self.key_of(key) else { continue };
            let line = key.start_position().row as u32 + 1;
            if let Some(prev) = seen.get(&norm_key) {
                self.report(&DUP_KEY, key, format!("Chave `{}` repetida: o valor da linha {prev} é sobrescrito", self.text(key)));
            } else { seen.insert(norm_key, line); }
        }
    }
    /// chave normalizada; None quando é calculada (não dá para saber em tempo de análise)
    fn key_of(&self, key: Node) -> Option<String> {
        let t = self.text(key);
        let kind = key.kind();
        if key.named_child_count() > 0 && kind.contains("string") {
            // string com interpolação (f-string, template) é calculada
            let mut c = key.walk();
            if key.named_children(&mut c).any(|x| x.kind().contains("interpolation") || x.kind().contains("substitution")) { return None; }
        }
        if t.starts_with(['"', '\'']) { return Some(format!("s:{}", t.trim_matches(['"', '\'']))); }
        Some(match kind {
            "property_identifier" => format!("s:{t}"),
            "hash_key_symbol" => format!("y:{t}"),
            "simple_symbol" => format!("y:{}", t.trim_start_matches(':')),
            "number" | "integer" | "float" => format!("n:{t}"),
            "true" | "false" | "none" | "nil" | "null" => format!("k:{t}"),
            "identifier" if self.p.lang == Lang::Python => format!("i:{t}"),
            "identifier" if self.p.lang == Lang::Lua => format!("s:{t}"),
            _ if kind.contains("string") && !t.chars().next().is_some_and(|c| c.is_ascii_alphabetic() && "fF".contains(c)) => format!("s:{t}"),
            _ => return None,
        })
    }

    fn debug_call(&mut self, n: Node<'t>) {
        let Some(callee) = n.child_by_field_name("function").or_else(|| n.child_by_field_name("macro")) else { return };
        let t = self.text(callee);
        if self.p.spec.debug_calls.contains(&t) {
            let shown = if n.kind() == "macro_invocation" { format!("{t}!") } else { format!("{t}()") };
            self.report(&DEBUGGER, n, format!("Chamada de depuração `{shown}` esquecida no código"));
        }
    }

    // ---------- escopo: variáveis e imports ----------
    fn vardecl(&mut self, n: Node<'t>) {
        // campos de classe não são variáveis locais
        if self.anc.iter().rev().take(3).any(|x| x.kind().contains("field_declaration")) { return; }
        if n.has_error() { return; }
        // C/C++: [[maybe_unused]] e __attribute__((unused)) dizem que é de propósito
        let t = self.text(n);
        if t.contains("maybe_unused") || t.contains("unused))") { return; }
        let Some(&(_, field, parent)) = self.p.spec.vardecls.iter().find(|d| d.0 == n.kind()) else { return };
        if !parent.is_empty() {
            let (want_p, want_g) = parent.split_once('>').unwrap_or((parent, ""));
            let Some(p) = self.parent() else { return };
            if p.kind() != want_p { return; }
            if !want_g.is_empty() && self.grandparent().is_none_or(|g| g.kind() != want_g) { return; }
        }
        let mut c = n.walk();
        let targets: Vec<Node<'t>> = if field.is_empty() { n.named_child(0).into_iter().collect() } else { n.children_by_field_name(field, &mut c).collect() };
        let mut names = vec![];
        for t in targets { decl_names(t, &mut names, 0); }
        if let Some(fr) = self.frames.last_mut() { fr.vars.extend(names); }
    }

    fn function_done(&mut self, fr: Frame<'t>) {
        let n = fr.node;
        let name = n.child_by_field_name("name").or_else(|| declarator_name(n));
        let label = name.map(|x| format!("`{}`", self.text(x))).unwrap_or_else(|| "anônima".into());
        let head = name.unwrap_or(n);
        let lines = n.end_position().row - n.start_position().row + 1;
        if lines > MAX_LINES { self.report_head(&LONG_FUNCTION, head, format!("Função {label} tem {lines} linhas (limite {MAX_LINES})")); }
        if let Some(params) = params_of(n) {
            let count = self.named_children(params).len();
            if count > MAX_PARAMS { self.report_head(&TOO_MANY_PARAMS, head, format!("Função {label} tem {count} parâmetros (limite {MAX_PARAMS})")); }
        }
        if fr.complexity > MAX_COMPLEXITY { self.report_head(&COMPLEXITY, head, format!("Função {label} tem complexidade ciclomática {} (limite {MAX_COMPLEXITY})", fr.complexity)); }
        if fr.max_depth > MAX_DEPTH { self.report_head(&DEEP_NESTING, head, format!("Função {label} tem {} níveis de aninhamento (limite {MAX_DEPTH})", fr.max_depth)); }

        if fr.vars.is_empty() { return; }
        let body = self.text(n);
        if self.p.spec.dynamic.iter().any(|d| body.contains(d)) { return; }
        let mut done: HashSet<&str> = HashSet::new();
        for v in fr.vars {
            let name = self.text(v);
            if name.is_empty() || name.starts_with('_') || !done.insert(name) { continue; }
            let base = n.start_byte();
            let uses = memchr::memmem::find_iter(body.as_bytes(), name.as_bytes())
                .filter(|&i| is_word_at(body.as_bytes(), i, name.len(), self.dollar()) && !self.in_comment(base + i)).take(2).count();
            if uses < 2 {
                self.report(&UNUSED_VAR, v, format!("Variável `{name}` recebe valor e nunca é usada"));
            }
        }
    }

    fn unused_imports(&mut self) {
        if self.imports.is_empty() { return; }
        let lang = self.p.spec.imports;
        if lang == Imports::Python && (self.file_name.ends_with("__init__.py") || self.src.contains("__all__")) { return; }
        let mut bound: Vec<(Node<'t>, &'a str)> = vec![];
        for imp in self.imports.clone() {
            // import dentro de try (checagem de dependência opcional) existe para testar se o módulo carrega
            if self.guarded_imports.contains(&imp.id()) { continue; }
            self.import_names(imp, lang, &mut bound);
        }
        if bound.is_empty() { return; }
        let mut ranges: Vec<(usize, usize)> = self.imports.iter().map(|n| (n.start_byte(), n.end_byte())).collect();
        // comentário comum não é uso; documentação (javadoc {@link X}, KDoc [X], `# type: X`) é
        ranges.extend(self.comments.iter().filter(|c| self.doc_comments.binary_search(c).is_err()).copied());
        ranges.sort_unstable();
        let used = words_outside(self.src.as_bytes(), &ranges, self.dollar());
        for (node, name) in bound {
            if name.is_empty() || name == "*" || used.contains(name) { continue; }
            self.report(&UNUSED_IMPORT, node, format!("`{name}` é importado e não é usado"));
        }
    }
    fn import_names(&self, imp: Node<'t>, lang: Imports, out: &mut Vec<(Node<'t>, &'a str)>) {
        match lang {
            Imports::Python => {
                let mut c = imp.walk();
                let items: Vec<Node<'t>> = if imp.kind() == "import_from_statement" { imp.children_by_field_name("name", &mut c).collect() } else { imp.named_children(&mut c).collect() };
                for it in items {
                    match it.kind() {
                        "aliased_import" => if let Some(a) = it.child_by_field_name("alias") { out.push((a, self.text(a))) },
                        "dotted_name" => { let t = self.text(it); out.push((it, t.split('.').next().unwrap_or(t).trim())); }
                        _ => {}
                    }
                }
            }
            Imports::Js => {
                let mut stack = vec![imp];
                while let Some(x) = stack.pop() {
                    let mut c = x.walk();
                    for ch in x.named_children(&mut c) {
                        match ch.kind() {
                            "import_clause" | "named_imports" => stack.push(ch),
                            "identifier" if x.kind() == "import_clause" => out.push((ch, self.text(ch))),
                            "namespace_import" => if let Some(id) = ch.named_child(0) { out.push((id, self.text(id))) },
                            "import_specifier" => if let Some(id) = ch.child_by_field_name("alias").or_else(|| ch.child_by_field_name("name")) { out.push((id, self.text(id))) },
                            _ => {}
                        }
                    }
                }
                // pragmas de JSX: usados pelo compilador, não pelo texto
                out.retain(|(_, n)| !matches!(*n, "React" | "h" | "Fragment" | "jsx"));
            }
            Imports::Java | Imports::Kotlin => {
                let t = self.text(imp).trim().trim_start_matches("import").trim().trim_start_matches("static ").trim().trim_end_matches(';').trim();
                if t.ends_with('*') { return; }
                let name = match t.split_once(" as ") { Some((_, a)) => a.trim(), None => t.rsplit('.').next().unwrap_or(t) };
                // operadores do Kotlin (delegação `by`, desestruturação) são usados sem aparecer pelo nome
                if lang == Imports::Kotlin && (KOTLIN_IMPLICIT.contains(&name) || name.starts_with("component")) { return; }
                out.push((imp, name));
            }
            Imports::None => {}
        }
    }
}

const KOTLIN_IMPLICIT: &[&str] = &["getValue", "setValue", "provideDelegate", "invoke", "get", "set", "contains", "iterator", "compareTo", "plus", "minus", "times", "div", "rem", "unaryMinus", "not", "inc", "dec", "rangeTo", "plusAssign", "minusAssign"];

/// nomes declarados num alvo de declaração (identifier, lista do Go, declarador do C)
fn decl_names<'t>(n: Node<'t>, out: &mut Vec<Node<'t>>, depth: u32) {
    if depth > 4 { return; }
    match n.kind() {
        "identifier" => out.push(n),
        "expression_list" => { let mut c = n.walk(); for x in n.named_children(&mut c) { if x.kind() == "identifier" { out.push(x); } } }
        "init_declarator" | "pointer_declarator" => if let Some(d) = n.child_by_field_name("declarator") { decl_names(d, out, depth + 1) },
        _ => {}
    }
}
/// nome de função do C/C++ (fica dentro do declarador)
fn declarator_name(n: Node) -> Option<Node> {
    let mut d = n.child_by_field_name("declarator")?;
    for _ in 0..6 {
        match d.child_by_field_name("declarator") { Some(x) => d = x, None => break }
    }
    matches!(d.kind(), "identifier" | "field_identifier" | "qualified_identifier" | "destructor_name" | "operator_name").then_some(d)
}
fn params_of(n: Node) -> Option<Node> {
    if let Some(p) = n.child_by_field_name("parameters") { return Some(p); }
    let mut d = n.child_by_field_name("declarator")?;
    for _ in 0..6 {
        if let Some(p) = d.child_by_field_name("parameters") { return Some(p); }
        d = d.child_by_field_name("declarator")?;
    }
    None
}

/// a ocorrência em `i` é a palavra inteira (não pedaço de outro identificador)
fn is_word_at(hay: &[u8], i: usize, len: usize, dollar: bool) -> bool {
    let before = i.checked_sub(1).map(|j| hay[j]);
    let after = hay.get(i + len).copied();
    !before.is_some_and(|b| is_ident(b, dollar)) && !after.is_some_and(|b| is_ident(b, dollar))
}
/// todas as palavras (identificadores) do arquivo fora dos intervalos dados, numa passada só
fn words_outside<'s>(src: &'s [u8], ranges: &[(usize, usize)], dollar: bool) -> HashSet<&'s str> {
    let mut set = HashSet::new();
    let mut i = 0;
    let mut r = 0;
    while i < src.len() {
        while r < ranges.len() && ranges[r].1 <= i { r += 1; }
        if r < ranges.len() && ranges[r].0 <= i { i = ranges[r].1; continue; }
        if is_ident(src[i], dollar) {
            let s = i;
            while i < src.len() && is_ident(src[i], dollar) { i += 1; }
            if let Ok(w) = std::str::from_utf8(&src[s..i]) { set.insert(w); }
        } else { i += 1; }
    }
    set
}

const MAX_SYNTAX: usize = 30;
fn syntax(cx: &mut Cx, root: Node) {
    let mut stack = vec![root];
    let mut found = 0;
    if root.is_error() { stack.clear(); stack.push(root); }
    while let Some(n) = stack.pop() {
        if found >= MAX_SYNTAX { break; }
        if n.is_error() || n.is_missing() {
            found += 1;
            if n.is_missing() {
                let kind = n.kind();
                let what = if n.is_named() { kind.replace('_', " ") } else { format!("`{kind}`") };
                cx.report_head(&SYNTAX, n, format!("Falta {what}"));
            } else {
                let t = cx.text(n).trim();
                let snip: String = t.lines().next().unwrap_or("").chars().take(40).collect();
                cx.report_head(&SYNTAX, n, if snip.is_empty() { "Sintaxe inválida".into() } else { format!("Sintaxe inválida perto de `{snip}`") });
            }
            if n.id() != root.id() { continue; }
        }
        let mut c = n.walk();
        let kids: Vec<Node> = n.children(&mut c).filter(|x| x.has_error() || x.is_missing()).collect();
        stack.extend(kids.into_iter().rev());
    }
}

pub fn run(lang: Lang, src: &str, file_name: &str) -> Vec<Diagnostic> {
    let Some(tree) = parse(lang, src) else { return vec![] };
    let root = tree.root_node();
    let mut cx = Cx { src, p: profile(lang), file_name, out: vec![], frames: vec![], comments: vec![], imports: vec![], chained: HashSet::new(), anc: Vec::with_capacity(64), guarded_imports: HashSet::new(),
        doc_comments: vec![], raws: vec![], attr_supps: vec![], last_line: root.end_position().row as u32 + 1 };
    if root.has_error() {
        syntax(&mut cx, root);
        // a gramática do Kotlin anda atrás da linguagem (context parameters do 2.2...): erro vira aviso
        if lang == Lang::Kotlin {
            for d in cx.out.iter_mut() { d.severity = crate::diag::Severity::Warning; d.message.push_str(" (a gramática Kotlin embutida pode não conhecer recursos muito novos)"); }
        }
    }
    cx.walk(root);
    cx.unused_imports();
    let first_code = { let mut c = root.walk(); root.named_children(&mut c).find(|x| !cx.is(*x, k::COMMENT)).map(|x| x.start_position().row as u32 + 1).unwrap_or(u32::MAX) };
    let supps = crate::suppress::build(&cx.raws, std::mem::take(&mut cx.attr_supps), cx.last_line, first_code);
    let mut out = std::mem::take(&mut cx.out);
    crate::suppress::apply(&supps, &mut out);
    out.sort_by(|a, b| (a.line, a.col, a.rule).cmp(&(b.line, b.col, b.rule)));
    out.dedup_by(|a, b| a.line == b.line && a.col == b.col && a.rule == b.rule);
    out
}
