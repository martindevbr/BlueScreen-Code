//! Pontos de entrada de um arquivo, como o ▶ que o IntelliJ mostra na margem: `public static void main` (e o
//! `void main()` do Java 25), `fun main`, `object X extends App`, `static void Main`, `func main`, `fn main`,
//! `int main`, `if __name__ == "__main__":`, `require.main === module`...
//! Nas linguagens com chaves, comentários e textos são apagados antes (o `main` dentro de um comentário não conta) e a
//! profundidade das chaves diz em que classe o main está (classe aninhada vira Externa$Interna, como na JVM).
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Entry {
    /// linha (1 = primeira)
    pub line: usize,
    /// o que aparece no menu: "Main.main()", "app.py"
    pub label: String,
    /// nome para executar: classe da JVM (pacote.Classe$Interna), classe do .NET, módulo do Clojure; vazio = o arquivo
    #[serde(skip_serializing_if = "String::is_empty")]
    pub target: String,
    /// Java: main de instância (Java 21+ com preview, padrão no 25)
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub instance: bool,
}

macro_rules! re { ($s:expr) => {{ static R: LazyLock<Regex> = LazyLock::new(|| Regex::new($s).unwrap()); &*R }}; }

/// Apaga comentários e conteúdo de textos (troca por espaços, mantém as quebras de linha) nas linguagens com chaves.
/// Caractere entre aspas simples só conta com um caractere ou um escape ('a', '{', '\n'); no Rust, `'a` é tempo de vida.
pub fn clean(src: &str, lang: &str) -> String {
    let b: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let triple = matches!(lang, "java" | "kotlin" | "scala" | "groovy" | "dart" | "swift");
    let backtick = matches!(lang, "javascript" | "typescript" | "go");
    let blank = |c: char, out: &mut String| out.push(if c == '\n' { '\n' } else { ' ' });
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        let next = b.get(i + 1).copied().unwrap_or('\0');
        if c == '/' && next == '/' {
            while i < b.len() && b[i] != '\n' { out.push(' '); i += 1; }
            continue;
        }
        if c == '/' && next == '*' {
            out.push_str("  ");
            i += 2;
            while i < b.len() && !(b[i] == '*' && b.get(i + 1) == Some(&'/')) { blank(b[i], &mut out); i += 1; }
            if i < b.len() { out.push_str("  "); i += 2; }
            continue;
        }
        if triple && c == '"' && next == '"' && b.get(i + 2) == Some(&'"') {
            out.push_str("\"\"\"");
            i += 3;
            while i < b.len() && !(b[i] == '"' && b.get(i + 1) == Some(&'"') && b.get(i + 2) == Some(&'"')) { blank(b[i], &mut out); i += 1; }
            if i < b.len() { out.push_str("\"\"\""); i += 3; }
            continue;
        }
        if c == '"' || (backtick && c == '`') {
            let q = c;
            // no Go, `...` é texto cru (sem escape); só o ` atravessa linhas
            let raw = q == '`' && lang == "go";
            out.push(q);
            i += 1;
            while i < b.len() && b[i] != q && (q == '`' || b[i] != '\n') {
                if b[i] == '\\' && !raw {
                    out.push(' ');
                    i += 1;
                    if i < b.len() { blank(b[i], &mut out); i += 1; }
                    continue;
                }
                blank(b[i], &mut out);
                i += 1;
            }
            if i < b.len() && b[i] == q { out.push(q); i += 1; }
            continue;
        }
        if c == '\'' {
            let end = if next == '\\' { (i + 3..b.len().min(i + 12)).find(|&j| b[j] == '\'') }
                      else if next != '\n' && next != '\0' && b.get(i + 2) == Some(&'\'') { Some(i + 2) } else { None };
            if let Some(e) = end.filter(|&e| !b[i + 1..e].contains(&'\n')) {
                out.push('\'');
                for _ in i + 1..e { out.push(' '); }
                out.push('\'');
                i = e + 1;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// nome do arquivo sem extensão
fn stem(name: &str) -> &str { let n = name.rsplit(['/', '\\']).next().unwrap_or(name); n.split('.').next().unwrap_or(n) }
fn join(pkg: &str, name: &str) -> String { if pkg.is_empty() { name.to_string() } else { format!("{pkg}.{name}") } }

/// Tipo aberto: nome, profundidade do corpo e se é o companion object do Kotlin (que não tem nome próprio na JVM)
struct Scope { name: String, depth: i32, companion: bool }

/// Varre o texto limpo; onde `main` casa, chama `f(linha, texto da linha, pilha de tipos, profundidade)` com a pilha
/// daquele ponto da linha (`class A { static void main() {} }` numa linha só também vale). `same_line`: a declaração
/// sem `{` na mesma linha não tem corpo (Kotlin: `data class P(val x: Int)`); no Java e no C# a chave pode vir embaixo.
fn walk_types(clean: &str, decl: &Regex, main: &Regex, same_line: bool, mut f: impl FnMut(usize, &str, &[Scope], i32)) {
    let mut depth = 0i32;
    let mut stack: Vec<Scope> = vec![];
    let mut pending: Option<(String, bool)> = None;
    for (n, line) in clean.lines().enumerate() {
        // declarações da linha, pela posição onde terminam
        let decls: Vec<(usize, String, bool)> = decl.captures_iter(line).map(|c| {
            let end = c.get(0).map(|m| m.end()).unwrap_or(0);
            let name = c.name("name").or_else(|| c.name("cname")).map(|m| m.as_str().to_string()).unwrap_or_default();
            (end, name, c.name("comp").is_some())
        }).collect();
        let at = main.find(line).map(|m| m.start());
        for (idx, ch) in line.char_indices() {
            if at == Some(idx) { f(n + 1, line, &stack, depth); }
            if let Some((_, name, comp)) = decls.iter().find(|d| d.0 == idx) { pending = Some((name.clone(), *comp)); }
            match ch {
                '{' => { depth += 1; if let Some((name, companion)) = pending.take() { stack.push(Scope { name, depth, companion }); } }
                '}' => { depth -= 1; while stack.last().is_some_and(|s| s.depth > depth) { stack.pop(); } }
                // declaração sem corpo (record de uma linha, typealias): não abre escopo
                ';' => pending = None,
                _ => {}
            }
        }
        // a declaração termina no fim da linha (a chave vem embaixo)
        if let Some((_, name, comp)) = decls.last().filter(|d| d.0 >= line.len()) { pending = Some((name.clone(), *comp)); }
        if same_line { pending = None; }
    }
}
fn jvm_name(stack: &[Scope]) -> (String, String) {
    // binário (Externa$Interna) e legível (Externa.Interna)
    let names: Vec<&str> = stack.iter().filter(|s| !s.companion).map(|s| s.name.as_str()).collect();
    (names.join("$"), names.join("."))
}

/// Pontos de entrada do texto de um arquivo (`file` dá o nome da classe implícita do Java e do FileKt do Kotlin).
pub fn find(lang: &str, file: &str, src: &str) -> Vec<Entry> {
    let mut out = vec![];
    let name = file.rsplit(['/', '\\']).next().unwrap_or(file).to_string();
    let entry = |line: usize, label: String, target: String| Entry { line, label, target, instance: false };
    match lang {
        "java" | "groovy" => {
            let cl = clean(src, lang);
            let pkg = re!(r"(?m)^\s*package\s+([\w.]+)").captures(&cl).map(|c| c[1].to_string()).unwrap_or_default();
            let decl = re!(r"\b(?:class|interface|enum|record)\s+(?P<name>[A-Za-z_$][\w$]*)");
            let main = re!(r"(?P<mods>(?:\b(?:public|protected|private|static|final|synchronized|strictfp)\s+)*)\bvoid\s+main\s*\(\s*(?:(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)\s*\w+|(?:final\s+)?String\s+\w+\s*\[\s*\])?\s*\)");
            walk_types(&cl, decl, main, false, |n, line, stack, _| {
                let Some(c) = main.captures(line) else { return };
                let mods = c.name("mods").map(|m| m.as_str()).unwrap_or("");
                let is_static = mods.contains("static");
                // main de instância (Java 25 / JEP 512): sem static, mas não privado
                if !is_static && (mods.contains("private") || lang == "groovy") { return; }
                let (bin, shown) = jvm_name(stack);
                let (bin, shown) = if bin.is_empty() { (stem(&name).to_string(), stem(&name).to_string()) } else { (bin, shown) };
                out.push(Entry { line: n, label: format!("{shown}.main()"), target: join(&pkg, &bin), instance: !is_static });
            });
            if lang == "groovy" && out.is_empty() && !re!(r"(?m)^\s*(?:abstract\s+|final\s+|public\s+)*(?:class|interface|trait|enum)\b").is_match(&cl) {
                // script Groovy: roda o arquivo inteiro, a partir da primeira linha de código
                if let Some(n) = cl.lines().position(|l| { let t = l.trim_start(); !t.is_empty() && !t.starts_with("import") && !t.starts_with("package") }) {
                    out.push(entry(n + 1, name.clone(), String::new()));
                }
            }
        }
        "kotlin" => {
            if name.ends_with(".kts") { return out; }
            let cl = clean(src, lang);
            let pkg = re!(r"(?m)^\s*package\s+([\w.]+)").captures(&cl).map(|c| c[1].to_string()).unwrap_or_default();
            let facade = re!(r#"@file\s*:\s*JvmName\s*\(\s*"(\w+)"\s*\)"#).captures(src).map(|c| c[1].to_string())
                .unwrap_or_else(|| { let s = stem(&name); let mut ch = s.chars(); ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default() + "Kt" });
            let decl = re!(r"\b(?:(?P<comp>companion)\s+object(?:\s+(?P<cname>\w+))?|(?:class|interface|object)\s+(?P<name>\w+))");
            let main = re!(r"\bfun\s+main\s*\(");
            let lines: Vec<&str> = cl.lines().collect();
            walk_types(&cl, decl, main, true, |n, line, stack, depth| {
                if depth == 0 && stack.is_empty() {
                    out.push(entry(n, format!("{}.main()", stem(&name)), join(&pkg, &facade)));
                    return;
                }
                // dentro de object/companion: só roda pela JVM com @JvmStatic
                let annotated = line.contains("@JvmStatic") || (n >= 2 && lines.get(n - 2).is_some_and(|p| p.contains("@JvmStatic")));
                if !annotated { return; }
                let (bin, shown) = jvm_name(stack);
                if !bin.is_empty() { out.push(entry(n, format!("{shown}.main()"), join(&pkg, &bin))); }
            });
        }
        "scala" => {
            let cl = clean(src, lang);
            let pkg = re!(r"(?m)^\s*package\s+([\w.]+)\s*$").captures(&cl).map(|c| c[1].to_string()).unwrap_or_default();
            let mut last_object = String::new();
            for (i, line) in cl.lines().enumerate() {
                if let Some(c) = re!(r"\bobject\s+(\w+)").captures(line) { last_object = c[1].to_string(); }
                if let Some(c) = re!(r"@main\s+def\s+(\w+)").captures(line) {
                    out.push(entry(i + 1, format!("{}()", &c[1]), join(&pkg, &c[1])));
                } else if re!(r"\bobject\s+\w+\s+extends\s+App\b").is_match(line) {
                    out.push(entry(i + 1, last_object.clone(), join(&pkg, &last_object)));
                } else if re!(r"\bdef\s+main\s*\(\s*\w+\s*:\s*Array\s*\[\s*String\s*\]\s*\)").is_match(line) && !last_object.is_empty() {
                    out.push(entry(i + 1, format!("{last_object}.main()"), join(&pkg, &last_object)));
                }
            }
        }
        "csharp" => {
            let cl = clean(src, lang);
            let ns = re!(r"(?m)^\s*namespace\s+([\w.]+)").captures(&cl).map(|c| c[1].to_string()).unwrap_or_default();
            let decl = re!(r"\b(?:class|struct|record)\s+(?P<name>\w+)");
            let main = re!(r"\bstatic\s+(?:async\s+)?(?:void|int|Task|Task\s*<\s*int\s*>)\s+Main\s*\(");
            walk_types(&cl, decl, main, false, |n, _line, stack, _| {
                let names: Vec<&str> = stack.iter().map(|s| s.name.as_str()).collect();
                if names.is_empty() { return; }
                out.push(entry(n, format!("{}.Main()", names.join(".")), join(&ns, &names.join("+"))));
            });
        }
        "vb" => {
            let ns = re!(r"(?mi)^\s*namespace\s+([\w.]+)").captures(src).map(|c| c[1].to_string()).unwrap_or_default();
            let mut last = String::new();
            for (i, line) in src.lines().enumerate() {
                if let Some(c) = re!(r"(?i)^\s*(?:public\s+|friend\s+)?(?:module|class)\s+(\w+)").captures(line) { last = c[1].to_string(); }
                if re!(r"(?i)^\s*(?:(?:public|shared)\s+)*(?:sub|function)\s+main\s*\(").is_match(line) {
                    out.push(entry(i + 1, format!("{last}.Main()"), join(&ns, &last)));
                }
            }
        }
        "fsharp" => {
            if name.ends_with(".fsx") { out.push(entry(1, name.clone(), String::new())); return out; }
            for (i, line) in src.lines().enumerate() {
                if line.contains("[<EntryPoint>]") { out.push(entry(i + 1, "main".into(), String::new())); }
            }
        }
        "go" => {
            let cl = clean(src, lang);
            if !re!(r"(?m)^\s*package\s+main\b").is_match(&cl) { return out; }
            for (i, line) in cl.lines().enumerate() { if re!(r"^func\s+main\s*\(\s*\)").is_match(line) { out.push(entry(i + 1, "main()".into(), String::new())); } }
        }
        "rust" | "zig" | "c" | "cpp" | "d" | "dart" | "swift" => {
            let cl = clean(src, lang);
            let main = match lang {
                "rust" => re!(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+main\s*\("),
                "zig" => re!(r"^\s*pub\s+fn\s+main\s*\("),
                "c" | "cpp" => re!(r"^\s*(?:(?:static|extern)\s+)?(?:int|void|auto|INT|signed\s+int)\s+(?:__cdecl\s+|WINAPI\s+|APIENTRY\s+)?(?:w?main|_tmain|w?WinMain)\s*\("),
                "d" => re!(r"^\s*(?:int|void)\s+main\s*\("),
                "dart" => re!(r"^\s*(?:(?:Future\s*<\s*void\s*>|void|Future)\s+)?main\s*\("),
                _ => re!(r"^\s*@main\b"),
            };
            let mut depth = 0i32;
            for (i, line) in cl.lines().enumerate() {
                if depth == 0 && main.is_match(line) { out.push(entry(i + 1, if lang == "swift" { name.clone() } else { "main()".into() }, String::new())); }
                for ch in line.chars() { match ch { '{' => depth += 1, '}' => depth -= 1, _ => {} } }
                depth = depth.max(0);
            }
        }
        "python" => {
            for (i, line) in src.lines().enumerate() {
                if re!(r#"^if\s+(?:__name__\s*==\s*['"]__main__['"]|['"]__main__['"]\s*==\s*__name__)\s*:"#).is_match(line) { out.push(entry(i + 1, name.clone(), String::new())); }
            }
        }
        "ruby" => {
            for (i, line) in src.lines().enumerate() {
                if re!(r"^\s*(?:if|unless)\s+(?:__FILE__\s*==\s*\$(?:0|PROGRAM_NAME)|\$(?:0|PROGRAM_NAME)\s*==\s*__FILE__)").is_match(line) { out.push(entry(i + 1, name.clone(), String::new())); }
            }
        }
        "javascript" | "typescript" => {
            let cl = clean(src, lang);
            for (i, line) in cl.lines().enumerate() {
                if re!(r"\brequire\.main\s*===?\s*module\b|\bmodule\s*===?\s*require\.main\b|\bimport\.meta\.main\b").is_match(line) { out.push(entry(i + 1, name.clone(), String::new())); }
            }
        }
        "nim" => for (i, line) in src.lines().enumerate() { if re!(r"^when\s+isMainModule\b").is_match(line) { out.push(entry(i + 1, name.clone(), String::new())); } },
        "julia" => for (i, line) in src.lines().enumerate() { if re!(r"abspath\(PROGRAM_FILE\)\s*==\s*@__FILE__").is_match(line) { out.push(entry(i + 1, name.clone(), String::new())); } },
        "haskell" => if let Some(i) = src.lines().position(|l| re!(r"^main\s*(?:::|=)").is_match(l)) { out.push(entry(i + 1, "main".into(), String::new())); },
        "clojure" => {
            let ns = re!(r"\(ns\s+([\w.\-*+!?]+)").captures(src).map(|c| c[1].to_string()).unwrap_or_default();
            for (i, line) in src.lines().enumerate() { if re!(r"\(defn-?\s+-main\b").is_match(line) { out.push(entry(i + 1, format!("{ns}/-main"), ns.clone())); } }
        }
        "elixir" => if name.ends_with(".exs") && !src.trim().is_empty() { out.push(entry(1, name.clone(), String::new())); },
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn java_mains() {
        let src = "package com.acme.app;\n\n/** public static void main(String[] a) no comentário */\npublic class Main {\n  static String s = \"void main(String[] x)\";\n  public static void main(String[] args) {\n    System.out.println(\"{\");\n    char c = '{';\n  }\n  static class Inner {\n    public static void main(String... args) {}\n  }\n}\nclass Other { static public void main(final String args[]) {} }\n";
        let e = find("java", "src/com/acme/app/Main.java", src);
        assert_eq!(e.iter().map(|x| (x.line, x.target.as_str())).collect::<Vec<_>>(), vec![(6, "com.acme.app.Main"), (11, "com.acme.app.Main$Inner"), (14, "com.acme.app.Other")]);
        assert_eq!(e[1].label, "Main.Inner.main()");
        // chave na linha de baixo
        let e = find("java", "B.java", "public class B\n{\n    public static void main(String[] args)\n    {\n    }\n}\n");
        assert_eq!(e[0].target, "B");
        // Java 25: classe implícita e main de instância
        let e = find("java", "Hello.java", "void main() {\n  IO.println(\"oi\");\n}\n");
        assert_eq!(e, vec![Entry { line: 1, label: "Hello.main()".into(), target: "Hello".into(), instance: true }]);
        // método main que não é ponto de entrada
        assert!(find("java", "A.java", "class A { private void main() {} int main(int x) { return x; } }").is_empty());
    }
    #[test]
    fn kotlin_mains() {
        let e = find("kotlin", "src/main/kotlin/app/server.kt", "package app\n\ndata class P(val x: Int)\nfun main(args: Array<String>) {\n}\n");
        assert_eq!(e[0].target, "app.ServerKt");
        let e = find("kotlin", "Tool.kt", "@file:JvmName(\"Cli\")\nfun main() {}\n");
        assert_eq!(e[0].target, "Cli");
        let src = "package p\nclass App {\n  companion object {\n    @JvmStatic\n    fun main(args: Array<String>) {}\n  }\n}\nobject Runner {\n  @JvmStatic fun main(args: Array<String>) {}\n}\nobject NoStatic {\n  fun main(args: Array<String>) {}\n}\n";
        let e = find("kotlin", "App.kt", src);
        assert_eq!(e.iter().map(|x| x.target.as_str()).collect::<Vec<_>>(), vec!["p.App", "p.Runner"]);
    }
    #[test]
    fn other_langs() {
        assert_eq!(find("python", "a.py", "def f():\n    pass\n\nif __name__ == '__main__':\n    f()\n")[0].line, 4);
        assert_eq!(find("go", "m.go", "package main\n\nfunc main() {\n}\n")[0].line, 3);
        assert!(find("go", "m.go", "package util\n\nfunc main() {}\n").is_empty());
        assert_eq!(find("rust", "m.rs", "// fn main() {}\nfn helper() { fn main() {} }\n#[tokio::main]\nasync fn main() {}\n")[0].line, 4);
        assert_eq!(find("rust", "lt.rs", "fn f<'a>(x: &'a str) -> &'a str { x }\nfn main() {}\n")[0].line, 2);
        assert_eq!(find("c", "a.c", "#include <stdio.h>\nint main(void) {\n  return 0;\n}\n")[0].line, 2);
        let cs = find("csharp", "P.cs", "namespace Demo.App;\npublic class Program\n{\n    public static async Task<int> Main(string[] args) { return 0; }\n}\n");
        assert_eq!(cs[0].target, "Demo.App.Program");
        assert_eq!(find("scala", "M.scala", "package x\nobject Main extends App {\n}\n")[0].target, "x.Main");
        assert_eq!(find("scala", "M.scala", "@main def hello(): Unit = ()\n")[0].target, "hello");
        assert_eq!(find("ruby", "a.rb", "if __FILE__ == $0\n  run\nend\n")[0].line, 1);
        assert_eq!(find("javascript", "a.js", "if (require.main === module) main();\n")[0].line, 1);
        assert_eq!(find("clojure", "core.clj", "(ns my.app.core)\n(defn -main [& args] (println 1))\n")[0].target, "my.app.core");
        assert_eq!(find("dart", "a.dart", "Future<void> main() async {\n}\n")[0].line, 1);
        assert_eq!(find("vb", "M.vb", "Module Program\n    Sub Main(args As String())\n    End Sub\nEnd Module\n")[0].target, "Program");
    }
}
