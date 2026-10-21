//! Catálogo: o que cada linguagem precisa instalado para compilar e executar, e como conseguir.
//! - `Tool`: um runtime ou compilador (JDK, Node.js, Python, gcc...). `progs` são os programas que provam que ele está
//!   no PC (basta um). `sdk` é o tipo que o núcleo baixa sozinho (janela SDKs); `winget`/`scoop` são o comando que
//!   instala pelo gerenciador do Windows; `url` é a página oficial.
//! - `Lang`: extensões e requisitos. Cada requisito é uma lista de alternativas (TypeScript roda com Node, Deno ou Bun).
use std::path::Path;

pub struct Tool {
    pub id: &'static str,
    pub name: &'static str,
    pub progs: &'static [&'static str],
    /// argumentos que imprimem a versão (vazio: não pergunta; JVM lenta, por exemplo)
    pub version_args: &'static [&'static str],
    pub sdk: Option<&'static str>,
    pub winget: Option<&'static str>,
    pub scoop: Option<&'static str>,
    pub url: &'static str,
    /// dica mostrada junto (o que vem no pacote, cuidado no Windows)
    pub note: &'static str,
}

const fn t(id: &'static str, name: &'static str, progs: &'static [&'static str], version_args: &'static [&'static str], sdk: Option<&'static str>, winget: Option<&'static str>, scoop: Option<&'static str>, url: &'static str, note: &'static str) -> Tool {
    Tool { id, name, progs, version_args, sdk, winget, scoop, url, note }
}

pub const TOOLS: &[Tool] = &[
    t("jdk", "Java (JDK)", &["javac"], &[], Some("jdk"), Some("EclipseAdoptium.Temurin.21.JDK"), None, "https://adoptium.net/", "Só o JRE não compila: precisa do JDK (tem o javac)."),
    t("node", "Node.js", &["node"], &["--version"], Some("node"), Some("OpenJS.NodeJS.LTS"), Some("nodejs-lts"), "https://nodejs.org/", ""),
    t("deno", "Deno", &["deno"], &["--version"], None, Some("DenoLand.Deno"), Some("deno"), "https://deno.com/", ""),
    t("bun", "Bun", &["bun"], &["--version"], None, Some("Oven-sh.Bun"), Some("bun"), "https://bun.sh/", ""),
    t("python", "Python", &["python", "py", "python3"], &["--version"], Some("python"), Some("Python.Python.3.13"), Some("python"), "https://www.python.org/downloads/", "O python.exe da Microsoft Store (atalho em WindowsApps) não conta: ele só abre a loja."),
    t("go", "Go", &["go"], &["version"], Some("go"), Some("GoLang.Go"), Some("go"), "https://go.dev/dl/", ""),
    t("rust", "Rust", &["cargo", "rustc"], &["--version"], Some("rust"), Some("Rustlang.Rustup"), Some("rustup"), "https://rustup.rs/", "No Windows o Rust (MSVC) também precisa do Visual Studio Build Tools com C++ para o link."),
    t("dotnet", ".NET SDK", &["dotnet"], &["--version"], Some("dotnet"), Some("Microsoft.DotNet.SDK.9"), Some("dotnet-sdk"), "https://dotnet.microsoft.com/download", ""),
    t("kotlin", "Kotlin", &["kotlinc"], &[], Some("kotlin"), None, Some("kotlin"), "https://kotlinlang.org/docs/command-line.html", "Em projetos Gradle ou Maven o compilador vem pelo build; aqui é só para arquivos soltos."),
    t("maven", "Maven", &["mvn"], &[], Some("maven"), None, Some("maven"), "https://maven.apache.org/download.cgi", ""),
    t("gradle", "Gradle", &["gradle"], &[], Some("gradle"), None, Some("gradle"), "https://gradle.org/install/", "Projetos com gradlew não precisam: o wrapper baixa o Gradle certo."),
    t("cc", "Compilador C", &["gcc", "clang"], &["--version"], Some("zig"), Some("BrechtSanders.WinLibs.POSIX.UCRT"), Some("gcc"), "https://winlibs.com/", "A IDE baixa o Zig, que compila C e C++ sozinho (zig cc), sem Visual Studio."),
    t("cxx", "Compilador C++", &["g++", "clang++"], &["--version"], Some("zig"), Some("BrechtSanders.WinLibs.POSIX.UCRT"), Some("gcc"), "https://winlibs.com/", "A IDE baixa o Zig, que compila C e C++ sozinho (zig c++), sem Visual Studio."),
    t("zig", "Zig", &["zig"], &["version"], Some("zig"), Some("zig.zig"), Some("zig"), "https://ziglang.org/download/", ""),
    t("ruby", "Ruby", &["ruby"], &["--version"], None, Some("RubyInstallerTeam.RubyWithDevKit.3.3"), Some("ruby"), "https://rubyinstaller.org/", ""),
    t("php", "PHP", &["php"], &["--version"], None, None, Some("php"), "https://windows.php.net/download/", ""),
    t("perl", "Perl", &["perl"], &["-e", "print $^V"], None, Some("StrawberryPerl.StrawberryPerl"), Some("perl"), "https://strawberryperl.com/", ""),
    t("lua", "Lua", &["lua", "luajit", "lua54"], &["-v"], None, None, Some("lua"), "https://luabinaries.sourceforge.net/", ""),
    t("r", "R", &["Rscript"], &["--version"], None, Some("RProject.R"), Some("r"), "https://cran.r-project.org/bin/windows/base/", ""),
    t("julia", "Julia", &["julia"], &["--version"], None, Some("Julialang.Julia"), Some("julia"), "https://julialang.org/downloads/", ""),
    t("dart", "Dart", &["dart"], &["--version"], None, None, Some("dart"), "https://dart.dev/get-dart", "O Flutter já traz o Dart."),
    t("swift", "Swift", &["swift"], &["--version"], None, Some("Swift.Toolchain"), None, "https://www.swift.org/install/windows/", ""),
    t("scala", "Scala", &["scala-cli", "scala", "sbt"], &[], None, None, Some("scala-cli"), "https://scala-cli.virtuslab.org/install", ""),
    t("groovy", "Groovy", &["groovy"], &[], None, None, Some("groovy"), "https://groovy.apache.org/download.html", ""),
    t("clojure", "Clojure", &["clojure", "clj", "lein"], &[], None, None, Some("leiningen"), "https://clojure.org/guides/install_clojure", ""),
    t("elixir", "Elixir", &["elixir"], &["--version"], None, None, Some("elixir"), "https://elixir-lang.org/install.html", "O Elixir roda sobre o Erlang/OTP: instale os dois."),
    t("erlang", "Erlang/OTP", &["erl", "escript"], &[], None, Some("Erlang.ErlangOTP"), Some("erlang"), "https://www.erlang.org/downloads", ""),
    t("haskell", "Haskell (GHC)", &["runghc", "ghc", "stack"], &["--version"], None, None, Some("ghc"), "https://www.haskell.org/ghcup/", ""),
    t("nim", "Nim", &["nim"], &["--version"], None, None, Some("nim"), "https://nim-lang.org/install_windows.html", ""),
    t("ocaml", "OCaml", &["ocaml"], &["-version"], None, None, None, "https://ocaml.org/install", ""),
    t("dlang", "D", &["rdmd", "dmd", "ldc2"], &["--version"], None, None, Some("dmd"), "https://dlang.org/download.html", ""),
    t("bash", "Bash", &["bash"], &["--version"], None, Some("Git.Git"), Some("git"), "https://git-scm.com/download/win", "O Git para Windows traz o Bash (Git Bash)."),
    t("tex", "LaTeX (latexmk)", &["latexmk"], &["--version"], None, Some("MiKTeX.MiKTeX"), None, "https://miktex.org/download", ""),
];

pub fn tool(id: &str) -> Option<&'static Tool> { TOOLS.iter().find(|t| t.id == id) }

pub struct Lang {
    pub id: &'static str,
    pub name: &'static str,
    pub exts: &'static [&'static str],
    /// requisitos: cada um é uma lista de alternativas (basta uma); a primeira é a sugerida
    pub needs: &'static [&'static [&'static str]],
}
const fn l(id: &'static str, name: &'static str, exts: &'static [&'static str], needs: &'static [&'static [&'static str]]) -> Lang { Lang { id, name, exts, needs } }

pub const LANGS: &[Lang] = &[
    l("java", "Java", &["java"], &[&["jdk"]]),
    l("kotlin", "Kotlin", &["kt", "kts"], &[&["jdk"], &["kotlin"]]),
    l("scala", "Scala", &["scala", "sc"], &[&["jdk"], &["scala"]]),
    l("groovy", "Groovy", &["groovy", "gvy"], &[&["jdk"], &["groovy"]]),
    l("clojure", "Clojure", &["clj", "cljc"], &[&["jdk"], &["clojure"]]),
    l("python", "Python", &["py", "pyw"], &[&["python"]]),
    l("javascript", "JavaScript", &["js", "mjs", "cjs", "jsx"], &[&["node", "deno", "bun"]]),
    l("typescript", "TypeScript", &["ts", "mts", "cts", "tsx"], &[&["node", "deno", "bun"]]),
    l("go", "Go", &["go"], &[&["go"]]),
    l("rust", "Rust", &["rs"], &[&["rust"]]),
    l("csharp", "C#", &["cs", "csx"], &[&["dotnet"]]),
    l("fsharp", "F#", &["fs", "fsx"], &[&["dotnet"]]),
    l("vb", "Visual Basic", &["vb"], &[&["dotnet"]]),
    l("c", "C", &["c"], &[&["cc", "zig"]]),
    l("cpp", "C++", &["cpp", "cc", "cxx", "c++"], &[&["cxx", "zig"]]),
    l("zig", "Zig", &["zig"], &[&["zig"]]),
    l("ruby", "Ruby", &["rb"], &[&["ruby"]]),
    l("php", "PHP", &["php"], &[&["php"]]),
    l("perl", "Perl", &["pl", "pm"], &[&["perl"]]),
    l("lua", "Lua", &["lua"], &[&["lua"]]),
    l("r", "R", &["r"], &[&["r"]]),
    l("julia", "Julia", &["jl"], &[&["julia"]]),
    l("dart", "Dart", &["dart"], &[&["dart"]]),
    l("swift", "Swift", &["swift"], &[&["swift"]]),
    l("elixir", "Elixir", &["ex", "exs"], &[&["elixir"], &["erlang"]]),
    l("erlang", "Erlang", &["erl"], &[&["erlang"]]),
    l("haskell", "Haskell", &["hs"], &[&["haskell"]]),
    l("nim", "Nim", &["nim"], &[&["nim"]]),
    l("ocaml", "OCaml", &["ml"], &[&["ocaml"]]),
    l("d", "D", &["d"], &[&["dlang"]]),
    l("shell", "Shell", &["sh", "bash"], &[&["bash"]]),
    l("latex", "LaTeX", &["tex"], &[&["tex"]]),
];

pub fn lang(id: &str) -> Option<&'static Lang> { LANGS.iter().find(|l| l.id == id) }
pub fn lang_of(path: &Path) -> Option<&'static Lang> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    LANGS.iter().find(|l| l.exts.contains(&ext.as_str()))
}

/// todos os programas que o catálogo procura (uma consulta só ao núcleo)
pub fn all_progs() -> Vec<&'static str> {
    let mut v: Vec<&str> = TOOLS.iter().flat_map(|t| t.progs.iter().copied()).collect();
    v.extend(["mvn", "gradle", "java", "npx", "tsx", "sbt", "lein", "stack", "bundle", "scoop", "winget", "kotlin", "flutter"]);
    v.sort_unstable();
    v.dedup();
    v
}

/// Requisitos da linguagem neste arquivo. Kotlin, Scala e Groovy dentro de um projeto Gradle/Maven/sbt não precisam do
/// compilador solto: o build baixa o dele.
pub fn needs_for(lang: &Lang, built: bool) -> Vec<&'static [&'static str]> {
    lang.needs.iter().copied().filter(|alts| !(built && matches!(alts.first(), Some(&"kotlin" | &"scala" | &"groovy")))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_need_is_a_tool() {
        for l in LANGS { for alts in l.needs { for a in *alts { assert!(tool(a).is_some(), "{} pede {a}", l.id); } } }
        assert_eq!(lang_of(Path::new("a/B.java")).unwrap().id, "java");
        assert_eq!(lang_of(Path::new("x.TSX")).unwrap().id, "typescript");
        assert!(needs_for(lang("kotlin").unwrap(), true).len() == 1);
    }
}
