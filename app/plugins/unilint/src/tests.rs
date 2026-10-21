use crate::lang::{ALL, Lang};
use crate::{lint_source, spec};

fn rules(lang: Lang, src: &str) -> Vec<String> {
    lint_source(lang, src, "t").into_iter().map(|d| format!("{}@{}", d.rule, d.line)).collect()
}
fn has(lang: Lang, src: &str, want: &[&str]) {
    let got = rules(lang, src);
    for w in want { assert!(got.iter().any(|g| g == w), "{lang:?}: esperava {w}, veio {got:?}\n{src}"); }
}
fn clean(lang: Lang, src: &str) {
    let got = lint_source(lang, src, "t");
    assert!(got.is_empty(), "{lang:?}: esperava nada, veio {:?}\n{src}", got.iter().map(|d| format!("{}@{}: {}", d.rule, d.line, d.message)).collect::<Vec<_>>());
}

#[test]
fn every_mapped_kind_exists_in_its_grammar() {
    let mut bad = vec![];
    for l in ALL { let u = spec::unknown_kinds(*l); if !u.is_empty() { bad.push(format!("{l:?}: {u:?}")); } }
    assert!(bad.is_empty(), "tipos de nó inexistentes:\n{}", bad.join("\n"));
}

#[test]
fn syntax_errors() {
    has(Lang::Python, "def f(:\n    pass\n", &["syntax@1"]);
    has(Lang::JavaScript, "function f( {\n", &["syntax@1"]);
    has(Lang::Java, "class A { void f() { int x = ; } }", &["syntax@1"]);
    has(Lang::Rust, "fn main() { let x = ; }", &["syntax@1"]);
    has(Lang::Go, "package main\nfunc main() {\n  x := \n}\n", &["syntax@3"]);
    has(Lang::Bash, "if [ x ]; then\n echo\n", &["syntax@3"]);
}

#[test]
fn python() {
    has(Lang::Python, "import os\nimport sys as s\nfrom a import b, c\nprint(c)\n", &["unused-import@1", "unused-import@2", "unused-import@3"]);
    has(Lang::Python, "def f():\n    x = 1\n    return 2\n    y = 3\n", &["unused-variable@2", "unreachable@4"]);
    has(Lang::Python, "try:\n    f()\nexcept:\n    pass\n", &["bare-except@3", "empty-catch@3"]);
    has(Lang::Python, "d = {'a': 1, \"a\": 2}\nif x == x:\n    pass\n", &["duplicate-key@1", "self-compare@2"]);
    has(Lang::Python, "if a:\n    f()\nelif b:\n    g()\nelif a:\n    h()\n", &["duplicate-condition@5"]);
    has(Lang::Python, "def f():\n    breakpoint()\n", &["debugger@2"]);
    clean(Lang::Python, "import os\nfrom typing import List\n\ndef f(a: List[int]) -> str:\n    x = os.getcwd()\n    try:\n        return x\n    except ValueError:\n        raise\n");
    clean(Lang::Python, "def f():\n    v = 1\n    return f'{v}'\n");
}

#[test]
fn javascript_typescript() {
    let js = "import fs from 'fs';\nimport { a, b as c } from 'x';\nfunction f(){ const y = 1; return a; debugger; }\n";
    has(Lang::JavaScript, js, &["unused-import@1", "unused-import@2", "unused-variable@3", "unreachable@3"]);
    has(Lang::JavaScript, "const o = { a: 1, 'a': 2 };\nx = x;\ntry { f() } catch (e) {}\n", &["duplicate-key@1", "self-assign@2", "empty-catch@3"]);
    has(Lang::JavaScript, "if (a) { f() } else if (b) { g() } else if (a) { h() }\nif (true) {}\n", &["duplicate-condition@1", "constant-condition@2", "empty-block@2"]);
    has(Lang::JavaScript, "debugger;\n", &["debugger@1"]);
    has(Lang::TypeScript, "function f(a: number): number { return a; const z = 2; }\n", &["unreachable@1"]);
    has(Lang::Tsx, "import { X } from 'y';\nexport const C = () => <div/>;\n", &["unused-import@1"]);
    clean(Lang::JavaScript, "import React from 'react';\nimport { a } from 'x';\nexport function f(n) { const t = `${n}`; try { return a(t); } catch (e) { /* ignorado */ } }\n");
    clean(Lang::TypeScript, "function f(): number { return 1; function g() {} }\ninterface I { a: number }\n");
}

#[test]
fn java_kotlin_csharp() {
    has(Lang::Java, "import java.util.List;\nimport java.util.Map;\nclass A { int f(Map m) { int z = 1; try { g(); } catch (Exception e) {} return 1; } }\n", &["unused-import@1", "unused-variable@3", "empty-catch@3"]);
    has(Lang::Java, "class A { void f() { if (x == x) {} return; } }", &["self-compare@1"]);
    has(Lang::Java, "class A { int f() { return 1; g(); } }", &["unreachable@1"]);
    has(Lang::Kotlin, "import a.b.C\nimport a.b.D\nfun f(d: D) {}\n", &["unused-import@1"]);
    has(Lang::CSharp, "class A { void F() { try { G(); } catch (System.Exception) { } int v = 1; return; G(); } }", &["empty-catch@1", "unused-variable@1", "unreachable@1"]);
    clean(Lang::Java, "import java.util.*;\nclass A { private int field = 1; int f() { int x = 2; return x + field; } }\n");
}

#[test]
fn rust_go_c() {
    has(Lang::Rust, "fn f() -> i32 { let x = 1; dbg!(2); return 3; let y = 4; }\n", &["unused-variable@1", "debugger@1", "unreachable@1"]);
    has(Lang::Rust, "fn f(a: i32) -> bool { if a > 1 { true } else if a > 1 { false } else { a == a } }\n", &["duplicate-condition@1", "self-compare@1"]);
    clean(Lang::Rust, "fn f() -> String { let name = 1; format!(\"{name}\") }\nfn g() { let _unused = 1; }\n");
    has(Lang::Go, "package main\nfunc f() int {\n  return 1\n  g()\n}\n", &["unreachable@4"]);
    has(Lang::C, "int f(int a) { int unused = 1; a = a; return a; a++; }\n", &["unused-variable@1", "self-assign@1", "unreachable@1"]);
    has(Lang::Cpp, "int f() { try { g(); } catch (...) {} return 0; }\n", &["empty-catch@1"]);
    clean(Lang::C, "int g(void);\nint f(int a) {\n  int r = g();\n  switch (a) { case 1: return r; case 2: break; default: return 0; }\n  return r;\n}\n");
}

#[test]
fn ruby_php_lua_bash_ps() {
    has(Lang::Ruby, "h = { a: 1, a: 2 }\ndef f\n  x = 1\n  return 2\nend\n", &["duplicate-key@1", "unused-variable@3"]);
    has(Lang::Php, "<?php\nfunction f() { var_dump(1); return 1; echo 2; }\n", &["debugger@2", "unreachable@2"]);
    has(Lang::Php, "<?php\ntry { f(); } catch (Exception $e) {}\n", &["empty-catch@2"]);
    has(Lang::Lua, "if a then f() elseif a then g() end\n", &["duplicate-condition@1"]);
    has(Lang::PowerShell, "try { f } catch { }\n", &["empty-catch@1"]);
    clean(Lang::Bash, "#!/bin/bash\nfor f in *.txt; do\n  echo \"$f\"\ndone\n");
}

#[test]
fn focused_tests() {
    has(Lang::JavaScript, "describe('a', () => {
  it.only('b', () => {});
  fit('c', () => {});
});
", &["focused-test@2", "focused-test@3"]);
    has(Lang::TypeScript, "test.describe.only('a', () => {});
it.only.each([1, 2])('n %d', (n: number) => {});
fdescribe('x', () => {});
", &["focused-test@1", "focused-test@2", "focused-test@3"]);
    has(Lang::Ruby, "RSpec.describe A do
  fit 'b' do
  end
  fcontext 'c' do
  end
end
", &["focused-test@2", "focused-test@4"]);
    // o que só parece: método `only` de outro objeto, `fit` como variável, testes normais
    clean(Lang::JavaScript, "describe('a', () => { it('b', () => {}); test.skip('c', () => {}); });
const r = query.only(1);
const fit = 2; g(fit);
");
    clean(Lang::Ruby, "describe A do
  it 'b' do
  end
end
x.fit(1)
");
    clean(Lang::JavaScript, "it.only('b', () => {}); // eslint-disable-line jest/no-focused-tests
");
    // a correção tira só o foco
    let fix = |lang, src: &str| { let d = crate::lint_source(lang, src, "t"); let e = &d[0].fixes[0].edits[0]; format!("{}{}{}", &src[..e.start], e.text, &src[e.end..]) };
    assert_eq!(fix(Lang::JavaScript, "it.only('b', f);"), "it('b', f);");
    assert_eq!(fix(Lang::JavaScript, "fdescribe('b', f);"), "describe('b', f);");
}

#[test]
fn suppressions() {
    clean(Lang::Python, "import os  # noqa\n");
    clean(Lang::Python, "import os  # noqa: F401\n");
    has(Lang::Python, "import os  # noqa: E501\n", &["unused-import@1"]);
    clean(Lang::JavaScript, "// eslint-disable-next-line no-debugger\ndebugger;\n");
    clean(Lang::JavaScript, "debugger; // unilint-disable-line debugger\n");
    clean(Lang::Rust, "// unilint-disable\nfn f() { dbg!(1); }\n");
}

#[test]
fn metrics() {
    let body: String = (0..210).map(|i| format!("  x{i} = {i}\n")).collect();
    has(Lang::Python, &format!("def big():\n{body}  return 1\n"), &["long-function@1"]);
    has(Lang::JavaScript, "function f(a,b,c,d,e,f,g,h) { return a+b+c+d+e+f+g+h; }\n", &["too-many-params@1"]);
    has(Lang::JavaScript, "function f(){ if(a){ if(b){ if(c){ if(d){ if(e){ if(g){ x(); } } } } } } }\n", &["deep-nesting@1"]);
    clean(Lang::JavaScript, "function f(){ if(a){ x(); } else if(b){ y(); } else if(c){ z(); } else if(d){ w(); } else if(e){ v(); } else if(g){ u(); } }\n");
}

#[test]
fn false_positives_found_in_real_code() {
    // strings diferentes só no espaço (eslint)
    clean(Lang::JavaScript, "const s = a ? \" \" : \"\";
");
    // {x$} do format! usa a variável (oxc)
    clean(Lang::Rust, "fn f(n: f64) -> String { let w = 3; format!(\"{n:.w$}\") }
");
    // template $x do Kotlin (detekt)
    clean(Lang::Kotlin, "fun f(a: Boolean): String { val s = if (a) 1 else 2
 return \"$s\" }
");
    // interruptor de depuração do Go (gotools)
    clean(Lang::Go, "package p
func f() {
	if false {
		println()
	}
}
");
    // varargs de método abstrato não é variável local (pmd)
    clean(Lang::Java, "interface R { void warn(String m, Object... args); }
");
    // except de exceção específica com pass é escolha consciente (pylint, astroid)
    clean(Lang::Python, "try:
    import x
except ImportError:
    pass
");
    has(Lang::Python, "try:
    f()
except Exception:
    pass
", &["empty-catch@3"]);
    // if vazio com else é intencional (oxc)
    clean(Lang::Rust, "fn f(a: bool) { if a {} else { g(); } }
");
    // `if let` cria outra variável com o mesmo nome (biome)
    clean(Lang::Rust, "fn f(e: Option<i32>, d: i32) -> i32 { if let Some(d) = e { d } else { d } }
");
    // gerador vazio (astroid) e catch com variável `ignored` (pmd)
    clean(Lang::Python, "def f():
    return
    yield
");
    clean(Lang::Java, "class A { void f() { try { g(); } catch (IllegalArgumentException ignored) {} } }
");
    // Kotlin com recurso novo: só aviso
    assert!(lint_source(Lang::Kotlin, "context(_: KaSession)
fun f() {}
", "t").iter().all(|d| d.severity != crate::Severity::Error));
}

#[test]
fn kotlin_powershell_lua_extra() {
    has(Lang::Kotlin, "fun f(a: Int) { val unused = 1; if (a == a) {} else if (a > 1) {} else if (a == a) {}; return; g() }
", &["unused-variable@1", "self-compare@1", "unreachable@1"]);
    has(Lang::PowerShell, "if ($a -eq $a) { f } elseif ($b) { g } elseif ($b) { h }
function F { return 1; g }
", &["self-compare@1", "duplicate-condition@1", "unreachable@2"]);
    has(Lang::Lua, "local t = { a = 1, a = 2 }
local x = x
", &["duplicate-key@1"]);
    clean(Lang::Lua, "local print = print
");
}

#[test]
#[ignore]
fn dump() {
    let lang = match std::env::var("L").as_deref() { Ok("ts") => Lang::TypeScript, Ok("cpp") => Lang::Cpp, Ok("bash") => Lang::Bash, Ok("kotlin") => Lang::Kotlin, Ok("js") => Lang::JavaScript, Ok("ps") => Lang::PowerShell, Ok("lua") => Lang::Lua, Ok("ruby") => Lang::Ruby, Ok("php") => Lang::Php, Ok("cs") => Lang::CSharp, Ok("go") => Lang::Go, Ok("c") => Lang::C, Ok("rust") => Lang::Rust, Ok("py") => Lang::Python, _ => Lang::Java };
    let src = std::env::var("S").unwrap();
    let t = crate::engine::parse(lang, &src).unwrap();
    println!("{}", t.root_node().to_sexp());
}

#[test]
fn comments_are_not_usage() {
    // o nome citado só no comentário não conta como uso (era o caso do Rust no editor)
    has(Lang::Rust, "fn f() {\n    let x = 1; // x é citado aqui\n    let z = 3; /* z */\n}\n", &["unused-variable@2", "unused-variable@3"]);
    has(Lang::Python, "import os  # os\n\ndef f():\n    y = 1  # y\n", &["unused-import@1", "unused-variable@4"]);
    has(Lang::JavaScript, "import a from 'a'; // a\nfunction f(){ const b = 1; /* b */ }\n", &["unused-import@1", "unused-variable@2"]);
    has(Lang::Go, "package p\nfunc f() {\n\tv := 1 // v\n}\n", &["unused-variable@3"]);
    has(Lang::Kotlin, "fun f() {\n    val w = 1 // w\n}\n", &["unused-variable@2"]);
    has(Lang::Ruby, "def f\n  q = 1 # q\nend\n", &["unused-variable@2"]);
    // documentação conta para import: javadoc {@link X}, `# type: X`
    clean(Lang::Java, "import java.util.List;\n/** Veja {@link List}. */\nclass A {}\n");
    clean(Lang::Python, "from typing import List\nx = []  # type: List[int]\n");
    // string conta (format! do Rust, f-string, template)
    clean(Lang::Rust, "fn f() -> String { let n = 1; format!(\"{n}\") }\n");
}

#[test]
fn native_suppressions() {
    // Rust: atributos valem para o item anotado
    clean(Lang::Rust, "fn f() {\n    #[allow(unused_variables)]\n    let y = 2;\n}\n");
    clean(Lang::Rust, "#[allow(unused)]\nfn f() {\n    let y = 2;\n}\n");
    clean(Lang::Rust, "#![allow(clippy::all)]\nfn f() { dbg!(1); }\n");
    clean(Lang::Rust, "#[expect(clippy::dbg_macro)]\nfn f() { dbg!(1); }\n");
    has(Lang::Rust, "#[allow(unused_variables)]\nfn f() { let a = 1; }\nfn g() { let b = 2; }\n", &["unused-variable@3"]);
    // Java/Kotlin/C#: anotações e atributos
    clean(Lang::Java, "class A {\n  @SuppressWarnings(\"unused\")\n  void f() { int x = 1; }\n}\n");
    clean(Lang::Java, "class A { void f() { try { g(); } catch (Exception e) {} } @SuppressWarnings(\"PMD.EmptyCatchBlock\") void g() { try { g(); } catch (Exception e) {} } }\n".replace("void f() { try { g(); } catch (Exception e) {} } ", "").as_str());
    clean(Lang::Kotlin, "@file:Suppress(\"UNUSED_VARIABLE\")\npackage a\nfun f() { val x = 1 }\n");
    clean(Lang::Kotlin, "fun f() {\n    @Suppress(\"UNUSED_VARIABLE\") val x = 1\n}\n");
    clean(Lang::CSharp, "class A {\n  [System.Diagnostics.CodeAnalysis.SuppressMessage(\"Style\", \"IDE0059:x\")]\n  void F() { int v = 1; }\n}\n");
    clean(Lang::CSharp, "class A {\n#pragma warning disable CS0168\n  void F() { int v = 1; }\n#pragma warning restore CS0168\n}\n");
    has(Lang::CSharp, "class A {\n#pragma warning disable CS0168\n  void F() { int v = 1; }\n#pragma warning restore CS0168\n  void G() { int w = 1; }\n}\n", &["unused-variable@5"]);
    // C/C++
    clean(Lang::C, "int f(void) { [[maybe_unused]] int a = 1; return 0; }\n");
    clean(Lang::Cpp, "int f() {\n  // NOLINTBEGIN\n  try { g(); } catch (...) {}\n  // NOLINTEND\n  return 0;\n}\n");
    // intervalos disable ... enable
    has(Lang::JavaScript, "/* eslint-disable no-debugger */\ndebugger;\n/* eslint-enable no-debugger */\ndebugger;\n", &["debugger@4"]);
    has(Lang::Ruby, "# rubocop:disable Lint/UselessAssignment\ndef f\n  a = 1\nend\n# rubocop:enable Lint/UselessAssignment\ndef g\n  b = 1\nend\n", &["unused-variable@7"]);
    // pylint sozinho na linha vale até o fim do escopo
    has(Lang::Python, "def f():\n    # pylint: disable=unused-variable\n    a = 1\n    b = 2\n\ndef g():\n    c = 3\n", &["unused-variable@7"]);
    // golangci: //nolint sozinho na linha vale para a declaração seguinte inteira
    clean(Lang::Go, "package p\n//nolint:ineffassign\nfunc f() {\n\tv := 1\n}\n");
    // ruff / flake8 no arquivo todo; noqa com código do pylint/ruff
    clean(Lang::Python, "# ruff: noqa: F401\nimport os\nimport sys\n");
    clean(Lang::Python, "import os  # noqa: W0611\n");
    // shellcheck antes do primeiro comando vale para o script todo
    clean(Lang::Bash, "#!/bin/bash\n# shellcheck disable=SC1000\nif [ x ]; then\n echo\n");
    // Lua (lua-language-server)
    clean(Lang::Lua, "---@diagnostic disable-next-line: duplicate-key\nlocal t = { a = 1, a = 2 }\n");
    // PHP (phpstan / phpcs)
    clean(Lang::Php, "<?php\nfunction f() { return 1; /** @phpstan-ignore-next-line */\n echo 2; }\n");
    // grupo `all` e nome com prefixo de ferramenta
    clean(Lang::JavaScript, "debugger; // eslint-disable-line @typescript-eslint/no-debugger\n");
}

#[test]
fn every_comment_syntax_is_recognized() {
    let cases: &[(Lang, &str, &[&str])] = &[
        (Lang::Rust, "//! m\n/// d\n// l\n/* b */\n/** bd */\nfn f() {}\n", &["//! m", "/// d", "// l", "/* b */", "/** bd */"]),
        (Lang::Python, "# c\nx = 1  # t\n", &["# c", "# t"]),
        (Lang::JavaScript, "// l\n/* b */\n/** d */\nconst x = <a>{/* j */}</a>;\n", &["// l", "/* b */", "/** d */", "/* j */"]),
        (Lang::TypeScript, "// l\n/* b */\nlet x: number = 1;\n", &["// l", "/* b */"]),
        (Lang::Java, "// l\n/* b */\n/** d */\nclass A {}\n", &["// l", "/* b */", "/** d */"]),
        (Lang::Kotlin, "// l\n/* b */\n/** d */\nfun f() {}\n", &["// l", "/* b */", "/** d */"]),
        (Lang::Go, "package p\n// l\n/* b */\n", &["// l", "/* b */"]),
        (Lang::C, "// l\n/* b */\nint x;\n", &["// l", "/* b */"]),
        (Lang::Cpp, "// l\n/* b */\nint x;\n", &["// l", "/* b */"]),
        (Lang::CSharp, "// l\n/* b */\n/// d\nclass A {}\n", &["// l", "/* b */", "/// d"]),
        (Lang::Php, "<?php\n// l\n# h\n/* b */\n/** d */\n$a = 1;\n", &["// l", "# h", "/* b */", "/** d */"]),
        (Lang::Ruby, "# c\n=begin\nbloco\n=end\nx = 1\n", &["# c", "=begin\nbloco\n=end"]),
        (Lang::Lua, "-- l\n--[[ b ]]\n---@type number\nlocal x = 1\n", &["-- l", "--[[ b ]]", "---@type number"]),
        (Lang::Bash, "#!/bin/bash\n# c\necho 1 # t\n", &["#!/bin/bash", "# c", "# t"]),
        (Lang::PowerShell, "# l\n<# b #>\n$a = 1\n", &["# l", "<# b #>"]),
    ];
    for (lang, src, want) in cases {
        let tree = crate::engine::parse(*lang, src).unwrap();
        let p = spec::profile(*lang);
        let mut found = vec![];
        let mut stack = vec![tree.root_node()];
        while let Some(n) = stack.pop() {
            if p.flags(n.kind_id()) & spec::k::COMMENT != 0 { found.push(src[n.byte_range()].trim_end().to_string()); continue; }
            let mut c = n.walk();
            stack.extend(n.children(&mut c));
        }
        for w in *want { assert!(found.iter().any(|f| f == w), "{lang:?}: comentário {w:?} não reconhecido; achados {found:?}"); }
    }
}
