//! Mapeamento de cada gramática para conceitos comuns (função, if, laço, catch, salto, atribuição...).
//! As regras são escritas uma vez sobre os conceitos; cada linguagem só diz quais tipos de nó são o quê.
//! Na carga, os nomes viram uma tabela indexada pelo id do tipo de nó: o despacho no percurso é O(1).
use crate::lang::{ALL, Lang};
use std::sync::OnceLock;

pub mod k {
    pub const FUNC: u32 = 1 << 0;
    pub const IF: u32 = 1 << 1;
    pub const ELIF: u32 = 1 << 2;
    pub const ELSE: u32 = 1 << 3;
    pub const LOOP: u32 = 1 << 4;
    pub const CATCH: u32 = 1 << 5;
    pub const JUMP: u32 = 1 << 6;
    pub const WRAP: u32 = 1 << 7;
    pub const BLOCK: u32 = 1 << 8;
    pub const EXEMPT: u32 = 1 << 9;
    pub const ASSIGN: u32 = 1 << 10;
    pub const BINARY: u32 = 1 << 11;
    pub const MAP: u32 = 1 << 12;
    pub const COMMENT: u32 = 1 << 13;
    pub const CALL: u32 = 1 << 14;
    pub const DEBUG: u32 = 1 << 15;
    pub const TERNARY: u32 = 1 << 16;
    pub const CASE: u32 = 1 << 17;
    pub const VARDECL: u32 = 1 << 18;
    pub const IMPORT: u32 = 1 << 19;
    pub const ATTR: u32 = 1 << 20;
    pub const PRAGMA: u32 = 1 << 21;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Imports { None, Python, Js, Java, Kotlin }

pub struct Spec {
    /// funções, métodos e lambdas (escopo de variáveis, métricas)
    pub functions: &'static [&'static str],
    /// nós com os campos condition / consequence / alternative
    pub ifs: &'static [&'static str],
    /// elif / else if que são nós próprios (com condition)
    pub elifs: &'static [&'static str],
    /// else que embrulha o bloco ou o próximo if
    pub elses: &'static [&'static str],
    pub loops: &'static [&'static str],
    pub catches: &'static [&'static str],
    /// return / throw / break / continue / goto
    pub jumps: &'static [&'static str],
    /// comando que embrulha uma expressão (expression_statement com return dentro, no Rust e no PHP)
    pub wrappers: &'static [&'static str],
    /// listas de comandos (onde vale "código depois de return")
    pub blocks: &'static [&'static str],
    /// pode vir depois de um return sem ser inalcançável (declarações içadas, rótulos)
    pub exempt: &'static [&'static str],
    pub assigns: &'static [&'static str],
    pub binaries: &'static [&'static str],
    /// literais de mapa (objeto JS, dict Python, hash Ruby); os pares têm o campo key
    pub maps: &'static [&'static str],
    pub comments: &'static [&'static str],
    /// chamadas (campo function, ou macro no Rust)
    pub calls: &'static [&'static str],
    /// comandos de depuração esquecidos (debugger do JS)
    pub debug_kinds: &'static [&'static str],
    /// nomes de chamadas de depuração (breakpoint, dbg!, var_dump)
    pub debug_calls: &'static [&'static str],
    pub ternaries: &'static [&'static str],
    pub cases: &'static [&'static str],
    /// declarações de variável local: (tipo do nó, campo do nome ou "" para o primeiro filho, tipo exigido do pai ou "")
    pub vardecls: &'static [(&'static str, &'static str, &'static str)],
    pub imports: Imports,
    pub import_kinds: &'static [&'static str],
    /// texto que torna o uso de variáveis imprevisível (eval, locals()): desliga "variável não usada" na função
    pub dynamic: &'static [&'static str],
    /// atributos/anotações que podem silenciar regras (`#[allow]`, `@SuppressWarnings`, `[SuppressMessage]`)
    pub attrs: &'static [&'static str],
    /// diretivas de pré-processador que silenciam regras (`#pragma warning disable` do C#)
    pub pragmas: &'static [&'static str],
}

const NONE: &[&str] = &[];
const EMPTY: Spec = Spec {
    functions: NONE, ifs: NONE, elifs: NONE, elses: NONE, loops: NONE, catches: NONE, jumps: NONE, wrappers: NONE, blocks: NONE,
    exempt: NONE, assigns: NONE, binaries: NONE, maps: NONE, comments: NONE, calls: NONE, debug_kinds: NONE, debug_calls: NONE,
    ternaries: NONE, cases: NONE, vardecls: &[], imports: Imports::None, import_kinds: NONE, dynamic: NONE, attrs: NONE, pragmas: NONE,
};

const PYTHON: Spec = Spec {
    functions: &["function_definition", "lambda"],
    ifs: &["if_statement"], elifs: &["elif_clause"], elses: &["else_clause"],
    loops: &["for_statement", "while_statement"],
    catches: &["except_clause"],
    jumps: &["return_statement", "raise_statement", "break_statement", "continue_statement"],
    blocks: &["block", "module"],
    exempt: &["function_definition", "class_definition", "decorated_definition"],
    assigns: &["assignment"],
    binaries: &["comparison_operator", "boolean_operator"],
    maps: &["dictionary"],
    comments: &["comment"],
    calls: &["call"],
    debug_calls: &["breakpoint", "pdb.set_trace", "ipdb.set_trace"],
    ternaries: &["conditional_expression"],
    cases: &["case_clause"],
    vardecls: &[("assignment", "left", "")],
    imports: Imports::Python, import_kinds: &["import_statement", "import_from_statement"],
    dynamic: &["locals()", "vars()", "eval(", "exec("],
    ..EMPTY
};

const JS_FUNCS: &[&str] = &["function_declaration", "function_expression", "arrow_function", "method_definition", "generator_function", "generator_function_declaration"];
const JS_JUMPS: &[&str] = &["return_statement", "throw_statement", "break_statement", "continue_statement"];
const JAVASCRIPT: Spec = Spec {
    functions: JS_FUNCS,
    ifs: &["if_statement"], elses: &["else_clause"],
    loops: &["for_statement", "for_in_statement", "while_statement", "do_statement"],
    catches: &["catch_clause"],
    jumps: JS_JUMPS,
    blocks: &["statement_block", "program", "switch_case", "switch_default"],
    exempt: &["function_declaration", "generator_function_declaration", "empty_statement"],
    assigns: &["assignment_expression"],
    binaries: &["binary_expression"],
    maps: &["object"],
    comments: &["comment", "html_comment"],
    calls: &["call_expression"],
    debug_kinds: &["debugger_statement"],
    ternaries: &["ternary_expression"],
    cases: &["switch_case"],
    vardecls: &[("variable_declarator", "name", "")],
    imports: Imports::Js, import_kinds: &["import_statement"],
    dynamic: &["eval("],
    ..EMPTY
};
const TYPESCRIPT: Spec = Spec {
    exempt: &["function_declaration", "generator_function_declaration", "empty_statement", "interface_declaration", "type_alias_declaration", "function_signature"],
    ..JAVASCRIPT
};

const JAVA: Spec = Spec {
    functions: &["method_declaration", "constructor_declaration", "lambda_expression"],
    ifs: &["if_statement"],
    loops: &["for_statement", "enhanced_for_statement", "while_statement", "do_statement"],
    catches: &["catch_clause"],
    jumps: &["return_statement", "throw_statement", "break_statement", "continue_statement", "yield_statement"],
    blocks: &["block", "constructor_body", "switch_block_statement_group"],
    exempt: &["class_declaration", "record_declaration", "interface_declaration", "enum_declaration"],
    assigns: &["assignment_expression"],
    binaries: &["binary_expression"],
    comments: &["line_comment", "block_comment"],
    ternaries: &["ternary_expression"],
    cases: &["switch_label"],
    vardecls: &[("variable_declarator", "name", "local_variable_declaration")],
    imports: Imports::Java, import_kinds: &["import_declaration"],
    attrs: &["annotation"],
    ..EMPTY
};

const RUST: Spec = Spec {
    functions: &["function_item", "closure_expression"],
    ifs: &["if_expression"], elses: &["else_clause"],
    loops: &["for_expression", "while_expression", "loop_expression"],
    jumps: &["return_expression", "break_expression", "continue_expression"],
    wrappers: &["expression_statement"],
    blocks: &["block"],
    exempt: &["function_item", "struct_item", "enum_item", "impl_item", "use_declaration", "const_item", "static_item",
        "macro_definition", "mod_item", "trait_item", "type_item", "attribute_item", "empty_statement"],
    assigns: &["assignment_expression"],
    binaries: &["binary_expression"],
    comments: &["line_comment", "block_comment"],
    calls: &["macro_invocation"],
    debug_calls: &["dbg"],
    cases: &["match_arm"],
    vardecls: &[("let_declaration", "pattern", "")],
    attrs: &["attribute_item", "inner_attribute_item"],
    ..EMPTY
};

const GO: Spec = Spec {
    functions: &["function_declaration", "method_declaration", "func_literal"],
    ifs: &["if_statement"],
    loops: &["for_statement"],
    jumps: &["return_statement", "break_statement", "continue_statement", "goto_statement"],
    blocks: &["block", "statement_list", "expression_case", "default_case", "type_case", "communication_case"],
    exempt: &["labeled_statement", "empty_statement"],
    assigns: &["assignment_statement"],
    binaries: &["binary_expression"],
    comments: &["comment"],
    cases: &["expression_case", "type_case", "communication_case"],
    vardecls: &[("short_var_declaration", "left", ""), ("var_spec", "name", "")],
    ..EMPTY
};

const C: Spec = Spec {
    functions: &["function_definition"],
    ifs: &["if_statement"], elses: &["else_clause"],
    loops: &["for_statement", "while_statement", "do_statement"],
    jumps: &["return_statement", "break_statement", "continue_statement", "goto_statement"],
    blocks: &["compound_statement", "case_statement"],
    exempt: &["labeled_statement", "case_statement"],
    assigns: &["assignment_expression"],
    binaries: &["binary_expression"],
    comments: &["comment"],
    ternaries: &["conditional_expression"],
    cases: &["case_statement"],
    vardecls: &[("declaration", "declarator", "")],
    ..EMPTY
};
// C++: sem "variável não usada" (guardas RAII como lock_guard existem só pelo construtor/destrutor)
const CPP: Spec = Spec {
    functions: &["function_definition", "lambda_expression"],
    loops: &["for_statement", "for_range_loop", "while_statement", "do_statement"],
    catches: &["catch_clause"],
    jumps: &["return_statement", "break_statement", "continue_statement", "goto_statement", "throw_statement", "co_return_statement"],
    exempt: &["labeled_statement", "case_statement"],
    vardecls: &[],
    ..C
};

const CSHARP: Spec = Spec {
    functions: &["method_declaration", "constructor_declaration", "local_function_statement", "lambda_expression", "anonymous_method_expression"],
    ifs: &["if_statement"],
    loops: &["for_statement", "foreach_statement", "while_statement", "do_statement"],
    catches: &["catch_clause"],
    jumps: &["return_statement", "throw_statement", "break_statement", "continue_statement", "goto_statement", "yield_statement"],
    blocks: &["block", "switch_section"],
    exempt: &["local_function_statement", "labeled_statement", "empty_statement"],
    assigns: &["assignment_expression"],
    binaries: &["binary_expression"],
    comments: &["comment"],
    ternaries: &["conditional_expression"],
    cases: &["switch_section"],
    vardecls: &[("variable_declarator", "name", "")],
    attrs: &["attribute"],
    pragmas: &["preproc_pragma"],
    ..EMPTY
};

const BASH: Spec = Spec {
    functions: &["function_definition"],
    loops: &["for_statement", "c_style_for_statement", "while_statement"],
    comments: &["comment"],
    cases: &["case_item"],
    ..EMPTY
};

const RUBY: Spec = Spec {
    functions: &["method", "singleton_method", "lambda"],
    ifs: &["if", "unless"], elifs: &["elsif"],
    loops: &["while", "until", "for"],
    jumps: &["return", "break", "next"],
    blocks: &["body_statement", "then"],
    exempt: &["method", "singleton_method", "class", "module", "rescue", "ensure", "else"],
    assigns: &["assignment"],
    binaries: &["binary"],
    maps: &["hash"],
    comments: &["comment"],
    ternaries: &["conditional"],
    cases: &["when"],
    vardecls: &[("assignment", "left", "")],
    dynamic: &["binding", "eval", "local_variable_get"],
    ..EMPTY
};

const PHP: Spec = Spec {
    functions: &["function_definition", "method_declaration", "anonymous_function", "arrow_function"],
    ifs: &["if_statement"], elifs: &["else_if_clause"], elses: &["else_clause"],
    loops: &["for_statement", "foreach_statement", "while_statement", "do_statement"],
    catches: &["catch_clause"],
    jumps: &["return_statement", "break_statement", "continue_statement", "goto_statement", "throw_expression"],
    wrappers: &["expression_statement"],
    blocks: &["compound_statement", "case_statement", "default_statement", "program"],
    exempt: &["function_definition", "class_declaration", "named_label_statement", "empty_statement"],
    assigns: &["assignment_expression"],
    binaries: &["binary_expression"],
    comments: &["comment"],
    calls: &["function_call_expression"],
    debug_calls: &["var_dump", "dd", "dump"],
    ternaries: &["conditional_expression"],
    cases: &["case_statement"],
    ..EMPTY
};

const KOTLIN: Spec = Spec {
    functions: &["function_declaration", "lambda_literal", "anonymous_function"],
    ifs: &["if_expression"],
    loops: &["for_statement", "while_statement", "do_while_statement"],
    catches: &["catch_block"],
    jumps: &["return_expression", "throw_expression"],
    blocks: &["block"],
    assigns: &["assignment"],
    binaries: &["binary_expression"],
    vardecls: &[("variable_declaration", "", "property_declaration>block")],
    comments: &["line_comment", "block_comment"],
    imports: Imports::Kotlin, import_kinds: &["import"],
    attrs: &["annotation", "file_annotation"],
    ..EMPTY
};

const POWERSHELL: Spec = Spec {
    functions: &["function_statement"],
    ifs: &["if_statement"], elifs: &["elseif_clause"], elses: &["else_clause"],
    loops: &["for_statement", "foreach_statement", "while_statement", "do_statement"],
    catches: &["catch_clause"],
    jumps: &["flow_control_statement"],
    blocks: &["statement_list"],
    binaries: &["comparison_expression", "logical_expression"],
    comments: &["comment"],
    ..EMPTY
};

const LUA: Spec = Spec {
    functions: &["function_declaration", "function_definition"],
    ifs: &["if_statement"], elifs: &["elseif_statement"], elses: &["else_statement"],
    loops: &["for_statement", "while_statement", "repeat_statement"],
    jumps: &["break_statement", "goto_statement"],
    blocks: &["block", "chunk"],
    exempt: &["label_statement", "empty_statement"],
    assigns: &["assignment_statement"],
    binaries: &["binary_expression"],
    maps: &["table_constructor"],
    comments: &["comment"],
    ..EMPTY
};

pub fn spec(lang: Lang) -> &'static Spec {
    match lang {
        Lang::Python => &PYTHON, Lang::JavaScript => &JAVASCRIPT, Lang::TypeScript | Lang::Tsx => &TYPESCRIPT, Lang::Java => &JAVA,
        Lang::Rust => &RUST, Lang::Go => &GO, Lang::C => &C, Lang::Cpp => &CPP, Lang::CSharp => &CSHARP, Lang::Bash => &BASH,
        Lang::Ruby => &RUBY, Lang::Php => &PHP, Lang::Kotlin => &KOTLIN, Lang::PowerShell => &POWERSHELL, Lang::Lua => &LUA,
    }
}

impl Spec {
    fn lists(&self) -> Vec<(&'static [&'static str], u32)> {
        vec![
            (self.functions, k::FUNC), (self.ifs, k::IF), (self.elifs, k::ELIF), (self.elses, k::ELSE), (self.loops, k::LOOP),
            (self.catches, k::CATCH), (self.jumps, k::JUMP), (self.wrappers, k::WRAP), (self.blocks, k::BLOCK), (self.exempt, k::EXEMPT),
            (self.assigns, k::ASSIGN), (self.binaries, k::BINARY), (self.maps, k::MAP), (self.comments, k::COMMENT), (self.calls, k::CALL),
            (self.debug_kinds, k::DEBUG), (self.ternaries, k::TERNARY), (self.cases, k::CASE), (self.import_kinds, k::IMPORT),
            (self.attrs, k::ATTR), (self.pragmas, k::PRAGMA),
        ]
    }
}

pub struct Profile {
    pub lang: Lang,
    pub spec: &'static Spec,
    pub language: tree_sitter::Language,
    flags: Vec<u32>,
}
impl Profile {
    #[inline]
    pub fn flags(&self, id: u16) -> u32 { self.flags.get(id as usize).copied().unwrap_or(0) }
}

fn build(lang: Lang) -> Profile {
    let language = lang.language();
    let spec = spec(lang);
    let lists = spec.lists();
    let decls: Vec<&str> = spec.vardecls.iter().map(|d| d.0).collect();
    let n = language.node_kind_count();
    let mut flags = vec![0u32; n];
    // vários ids podem ter o mesmo nome (aliases da gramática): todos recebem os mesmos conceitos
    for id in 0..n as u16 {
        if !language.node_kind_is_named(id) { continue; }
        let Some(name) = language.node_kind_for_id(id) else { continue };
        for (list, f) in &lists { if list.contains(&name) { flags[id as usize] |= f; } }
        if decls.contains(&name) { flags[id as usize] |= k::VARDECL; }
    }
    Profile { lang, spec, language, flags }
}

static PROFILES: [OnceLock<Profile>; 16] = [const { OnceLock::new() }; 16];
pub fn profile(lang: Lang) -> &'static Profile { PROFILES[lang.index()].get_or_init(|| build(lang)) }

/// Nomes do mapeamento que não existem na gramática (erro de digitação ou gramática mudou). Usado nos testes.
#[cfg(test)]
pub fn unknown_kinds(lang: Lang) -> Vec<&'static str> {
    let language = lang.language();
    let spec = spec(lang);
    let exists = |name: &str| (0..language.node_kind_count() as u16).any(|id| language.node_kind_is_named(id) && language.node_kind_for_id(id) == Some(name));
    let mut out = vec![];
    for (list, _) in spec.lists() { for n in list { if !exists(n) && !out.contains(n) { out.push(*n); } } }
    for (n, _, _) in spec.vardecls { if !exists(n) && !out.contains(n) { out.push(*n); } }
    out
}

#[allow(dead_code)]
pub fn all_profiles() -> impl Iterator<Item = &'static Profile> { ALL.iter().map(|l| profile(*l)) }
