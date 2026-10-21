//! Como executar um ponto de entrada, como o "Run" do IntelliJ: escolhe o caminho pelo projeto em volta do arquivo.
//! - Java/Kotlin/Scala num projeto Maven: `exec:java` com a classe (compila antes; classes de teste com o escopo test);
//!   num projeto Gradle: uma tarefa `bsRun` (JavaExec) acrescentada por um init script, sem mexer no build.gradle;
//!   arquivo solto: `javac` com o -sourcepath da raiz dos pacotes (acha as outras classes do projeto) e `java -cp`.
//!   O JDK é o que atende à versão que o projeto pede (o escolhido como padrão primeiro).
//! - Python: o .venv do projeto (uv/Poetry quando é o caso), como módulo (`-m pacote.mod`) dentro de pacotes.
//! - Rust: `cargo run` com --bin/--example certo; Go: `go run .` no pacote; C#/F#/VB: `dotnet run --project`;
//!   C/C++: compila o arquivo e os vizinhos sem main (gcc, clang ou zig cc); e o equivalente nas outras linguagens.
//! Devolve os passos no formato das tarefas do núcleo (TaskStep), que o console de Build roda.
use crate::entries::{self, Entry};
use crate::require::{need, up_to};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Jdk { pub home: String, pub major: u32, pub name: String }

#[derive(Serialize, Clone, Debug, Default)]
pub struct Step {
    pub kind: String,
    pub label: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")] pub env: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub java: bool,
}
#[derive(Serialize, Clone, Debug)]
pub struct Plan {
    pub title: String,
    /// por onde vai rodar ("Maven (exec:java)", "javac + java 21", "cargo run")
    pub how: String,
    pub steps: Vec<Step>,
    /// JDK (home) para os passos Java
    #[serde(skip_serializing_if = "Option::is_none")] pub jdk: Option<String>,
}

/// o que o planejador precisa saber do PC
pub struct Env<'a> {
    /// o programa existe (pela busca da IDE: PATH, SDKs, PATH do registro)
    pub has: &'a dyn Fn(&str) -> bool,
    /// JDKs achados (o escolhido primeiro)
    pub jdks: &'a [Jdk],
    /// pasta para classes compiladas, executáveis e o init script do Gradle
    pub work: PathBuf,
}

const WIN: bool = cfg!(windows);
fn s(p: &Path) -> String { p.to_string_lossy().into_owned() }
fn exe(name: &str) -> String { if WIN { format!("{name}.exe") } else { name.into() } }
fn hash(s: &str) -> String { let mut h: u64 = 0xcbf29ce484222325; for b in s.to_lowercase().bytes() { h ^= b as u64; h = h.wrapping_mul(0x100000001b3); } format!("{:08x}", h as u32) }

fn step(program: impl Into<String>, args: Vec<String>, cwd: &Path) -> Step {
    let program = program.into();
    let shown = Path::new(&program).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| program.clone());
    Step { kind: "cmd".into(), label: format!("{shown} {}", args.join(" ")).trim().to_string(), program, args, cwd: s(cwd), ..Default::default() }
}
fn v(a: &[&str]) -> Vec<String> { a.iter().map(|x| x.to_string()).collect() }

/// divide os argumentos do programa como um shell simples ("a b" fica junto)
pub fn split_args(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut q, mut any) = (vec![], String::new(), None::<char>, false);
    for c in s.chars() {
        match (q, c) {
            (Some(x), c) if c == x => q = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => { q = Some(c); any = true; }
            (None, c) if c.is_whitespace() => { if any || !cur.is_empty() { out.push(std::mem::take(&mut cur)); any = false; } }
            (None, c) => cur.push(c),
        }
    }
    if any || !cur.is_empty() { out.push(cur); }
    out
}

// ---------- projeto em volta do arquivo ----------
#[derive(Debug, PartialEq)]
pub enum Build { Maven { pom: PathBuf, test: bool }, Gradle { root: PathBuf, module: PathBuf, set: String }, Sbt { root: PathBuf }, None }

/// sistema de build que compila este arquivo (o arquivo tem de estar em src/<conjunto>/ do módulo)
pub fn build_of(root: &Path, file: &Path) -> Build {
    let dir = file.parent().unwrap_or(root);
    let chain = up_to(root, dir);
    let set_of = |module: &Path| -> Option<String> {
        let rel = file.strip_prefix(module).ok()?;
        let mut it = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
        (it.next()? == "src").then(|| it.next()).flatten()
    };
    for d in &chain {
        if d.join("build.gradle").is_file() || d.join("build.gradle.kts").is_file() {
            let Some(set) = set_of(d) else { continue };
            // raiz do Gradle: a pasta mais de cima com settings.gradle (ou o próprio módulo)
            let groot = chain.iter().rev().find(|x| x.join("settings.gradle").is_file() || x.join("settings.gradle.kts").is_file()).filter(|x| d.starts_with(x)).cloned().unwrap_or_else(|| d.clone());
            return Build::Gradle { root: groot, module: d.clone(), set };
        }
        if d.join("pom.xml").is_file() {
            let Some(set) = set_of(d) else { continue };
            return Build::Maven { pom: d.join("pom.xml"), test: set == "test" };
        }
        if d.join("build.sbt").is_file() { return Build::Sbt { root: d.clone() }; }
    }
    Build::None
}

/// projeto com Gradle, Maven ou sbt em volta (o compilador de Kotlin/Scala/Groovy vem pelo build)
pub fn is_built(root: &Path, file: &Path) -> bool { build_of(root, file) != Build::None }

/// Init script do Gradle com a tarefa bsRun (JavaExec) em todo projeto com sourceSets: roda -Dbs.main com o classpath
/// do conjunto -Dbs.set (main, test...), com a entrada do console e os argumentos de -Dbs.args.
pub const GRADLE_INIT: &str = r#"// BlueScreen (plugin runtimes): tarefa bsRun para executar um main sem mexer no build do projeto
allprojects {
    afterEvaluate { p ->
        def sets = p.extensions.findByName('sourceSets')
        if (sets == null || p.tasks.findByName('bsRun') != null) return
        p.tasks.register('bsRun', JavaExec) { t ->
            t.group = 'bluescreen'
            t.description = 'Executa a classe -Dbs.main (BlueScreen)'
            def set = sets.findByName(System.getProperty('bs.set', 'main')) ?: sets.getByName('main')
            t.classpath = set.runtimeClasspath
            if (t.hasProperty('mainClass')) { t.mainClass.set(System.getProperty('bs.main')) } else { t.main = System.getProperty('bs.main') }
            t.standardInput = System.in
            t.workingDir = p.projectDir
            def a = System.getProperty('bs.args', '')
            if (a) { t.args((a =~ /"([^"]*)"|(\S+)/).collect { it[1] != null ? it[1] : it[2] }) }
            def j = System.getProperty('bs.jvm', '')
            if (j) { t.jvmArgs(j.split(' ').findAll { it }) }
        }
    }
}
"#;
pub fn gradle_init(work: &Path) -> PathBuf { work.join("bs-run.gradle") }

/// JDK que atende ao mínimo (o escolhido primeiro, como a lista vem)
pub fn pick_jdk<'a>(jdks: &'a [Jdk], min: u32) -> Option<&'a Jdk> { jdks.iter().find(|j| j.major == 0 || j.major >= min).or(if min == 0 { jdks.first() } else { None }) }

fn java_min(root: &Path, dir: &Path) -> u32 { need("jdk", root, dir).and_then(|n| n.version.parse().ok()).unwrap_or(0) }

/// Como executar `entry` do arquivo. Ok(None): o plugin não tem um jeito melhor (o núcleo executa o arquivo pela extensão).
pub fn plan(env: &Env, root: &Path, file: &Path, lang: &str, entry: &Entry, args: &str) -> Result<Option<Plan>, String> {
    let dir = file.parent().unwrap_or(root).to_path_buf();
    let fname = file.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let f = s(file);
    let argv = split_args(args);
    let has = env.has;
    let title = format!("Executar {}", entry.label);
    let plan = |how: &str, steps: Vec<Step>, jdk: Option<String>| Ok(Some(Plan { title: title.clone(), how: how.into(), steps, jdk }));
    let with_args = |mut a: Vec<String>| { a.extend(argv.iter().cloned()); a };
    match lang {
        "java" | "kotlin" | "scala" | "groovy" | "clojure" => jvm(env, root, file, &dir, lang, entry, &argv, args, &title),
        "python" => {
            let mut py: Option<(String, Vec<String>)> = None;
            'venv: for d in up_to(root, &dir) {
                for v in [".venv", "venv", "env", ".env"] {
                    let p = if WIN { d.join(v).join("Scripts").join("python.exe") } else { d.join(v).join("bin").join("python") };
                    if p.is_file() { py = Some((s(&p), vec![])); break 'venv; }
                }
            }
            let mut how = "Python".to_string();
            if py.is_none() {
                let lock = |n: &str| up_to(root, &dir).iter().any(|d| d.join(n).is_file());
                py = if lock("uv.lock") && has("uv") { how = "uv run".into(); Some(("uv".into(), v(&["run", "python"]))) }
                     else if lock("poetry.lock") && has("poetry") { how = "poetry run".into(); Some(("poetry".into(), v(&["run", "python"]))) }
                     else if has("py") { Some(("py".into(), vec![])) }
                     else if has("python") { Some(("python".into(), vec![])) }
                     else if has("python3") { Some(("python3".into(), vec![])) } else { None };
            } else { how = "Python (.venv)".into(); }
            let Some((prog, mut a)) = py else { return Err("Python não encontrado".into()) };
            a.push("-u".into());
            // dentro de pacotes (pastas com __init__.py): roda como módulo, a partir da pasta acima do pacote de cima
            let mut base = dir.clone();
            if dir.join("__init__.py").is_file() {
                while base.parent().is_some_and(|p| p.join("__init__.py").is_file() && p.starts_with(root)) { base = base.parent().unwrap().to_path_buf(); }
                base = base.parent().unwrap_or(root).to_path_buf();
            }
            let cwd = if base != dir {
                let module = file.with_extension("").strip_prefix(&base).map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join(".")).unwrap_or_default();
                a.extend(["-m".into(), module]);
                base.clone()
            } else { a.push(f.clone()); dir.clone() };
            let mut st = step(prog, with_args(a), &cwd);
            let mut pp = vec![s(root)];
            if root.join("src").is_dir() { pp.push(s(&root.join("src"))); }
            st.env.insert("PYTHONPATH".into(), pp.join(if WIN { ";" } else { ":" }));
            st.env.insert("PYTHONIOENCODING".into(), "utf-8".into());
            st.env.insert("PYTHONUNBUFFERED".into(), "1".into());
            plan(&how, vec![st], None)
        }
        "javascript" | "typescript" => {
            let ts = lang == "typescript";
            let local_tsx = up_to(root, &dir).into_iter().map(|d| d.join("node_modules").join(".bin").join(if WIN { "tsx.cmd" } else { "tsx" })).find(|p| p.is_file());
            let (prog, a, how) = if !ts && has("node") { ("node".to_string(), vec![f.clone()], "Node.js") }
                else if let Some(t) = local_tsx.filter(|_| ts) { (s(&t), vec![f.clone()], "tsx do projeto") }
                else if has("deno") { ("deno".into(), vec!["run".into(), "-A".into(), f.clone()], "Deno") }
                else if has("bun") { ("bun".into(), vec!["run".into(), f.clone()], "Bun") }
                else if ts && has("npx") { ("npx".into(), vec!["-y".into(), "tsx".into(), f.clone()], "npx tsx") }
                else { return Err("Node.js não encontrado".into()) };
            plan(how, vec![step(prog, with_args(a), root)], None)
        }
        "go" => {
            let src = std::fs::read_to_string(file).unwrap_or_default();
            let solo = src.lines().take(20).any(|l| l.starts_with("//go:build ignore") || l.starts_with("// +build ignore"));
            let a = if solo { vec!["run".into(), f.clone()] } else { v(&["run", "."]) };
            plan(if solo { "go run (arquivo)" } else { "go run (pacote)" }, vec![step("go", with_args(a), &dir)], None)
        }
        "rust" => rust(root, file, &dir, &argv, &title, &env.work),
        "csharp" | "fsharp" | "vb" => {
            if fname.ends_with(".fsx") { return plan("dotnet fsi", vec![step("dotnet", with_args(vec!["fsi".into(), f.clone()]), &dir)], None); }
            let ext = match lang { "csharp" => "csproj", "fsharp" => "fsproj", _ => "vbproj" };
            let proj = up_to(root, &dir).into_iter().find_map(|d| {
                let mut v: Vec<PathBuf> = std::fs::read_dir(&d).ok()?.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == ext)).collect();
                v.sort();
                v.into_iter().next()
            });
            match proj {
                Some(p) => {
                    let mut a = vec!["run".into(), "--project".into(), s(&p)];
                    if !entry.target.is_empty() && lang != "fsharp" { a.push(format!("-p:StartupObject={}", entry.target)); }
                    if !argv.is_empty() { a.push("--".into()); }
                    plan("dotnet run", vec![step("dotnet", with_args(a), p.parent().unwrap_or(&dir))], None)
                }
                // .NET 10: dotnet run arquivo.cs
                None if lang == "csharp" => plan("dotnet run (arquivo)", vec![step("dotnet", with_args(vec!["run".into(), f.clone()]), &dir)], None),
                None => Err(format!("nenhum .{ext} acima de {fname}")),
            }
        }
        "c" | "cpp" => {
            let cpp = lang == "cpp";
            let (cc, pre): (&str, Vec<String>) = if cpp {
                if has("g++") { ("g++", vec![]) } else if has("clang++") { ("clang++", vec![]) } else if has("zig") { ("zig", v(&["c++"])) } else { return Err("compilador C++ não encontrado".into()) }
            } else if has("gcc") { ("gcc", vec![]) } else if has("clang") { ("clang", vec![]) } else if has("zig") { ("zig", v(&["cc"])) } else { return Err("compilador C não encontrado".into()) };
            let exts: &[&str] = if cpp { &["cpp", "cc", "cxx", "c++"] } else { &["c"] };
            // os .c/.cpp da mesma pasta que não têm main entram junto (programa em vários arquivos)
            let mut srcs = vec![f.clone()];
            if let Ok(rd) = std::fs::read_dir(&dir) {
                let mut sib: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p != file && p.extension().is_some_and(|x| exts.contains(&x.to_string_lossy().to_lowercase().as_str()))).collect();
                sib.sort();
                for p in sib.into_iter().take(60) {
                    let t = std::fs::read_to_string(&p).unwrap_or_default();
                    if entries::find(lang, &s(&p), &t).is_empty() { srcs.push(s(&p)); }
                }
            }
            let out = env.work.join(exe(&format!("{}-{}", file.file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default(), hash(&f))));
            let mut a = pre;
            a.extend(srcs);
            a.extend(["-g".into(), "-I".into(), s(&dir)]);
            if cpp { a.push("-std=c++20".into()); }
            a.extend(["-o".into(), s(&out)]);
            plan(&format!("{cc} + executar"), vec![step(cc, a, &dir), step(s(&out), argv.clone(), &dir)], None)
        }
        "zig" => {
            if let Some(b) = up_to(root, &dir).into_iter().find(|d| d.join("build.zig").is_file()) {
                let mut a = v(&["build", "run"]);
                if !argv.is_empty() { a.push("--".into()); }
                return plan("zig build run", vec![step("zig", with_args(a), &b)], None);
            }
            let mut a = vec!["run".into(), f.clone()];
            if !argv.is_empty() { a.push("--".into()); }
            plan("zig run", vec![step("zig", with_args(a), &dir)], None)
        }
        "dart" => plan("dart run", vec![step("dart", with_args(vec!["run".into(), f.clone()]), &dir)], None),
        "swift" => plan("swift", vec![step("swift", with_args(vec![f.clone()]), &dir)], None),
        "ruby" => {
            let gem = up_to(root, &dir).into_iter().find(|d| d.join("Gemfile").is_file());
            match gem.filter(|_| has("bundle")) {
                Some(g) => plan("bundle exec ruby", vec![step("bundle", with_args(vec!["exec".into(), "ruby".into(), f.clone()]), &g)], None),
                None => plan("ruby", vec![step("ruby", with_args(vec![f.clone()]), &dir)], None),
            }
        }
        "nim" => plan("nim r", vec![step("nim", with_args(vec!["r".into(), "--hints:off".into(), f.clone()]), &dir)], None),
        "julia" => plan("julia", vec![step("julia", with_args(vec![f.clone()]), &dir)], None),
        "haskell" => {
            let stack = up_to(root, &dir).into_iter().find(|d| d.join("stack.yaml").is_file());
            match stack.filter(|_| has("stack")) {
                Some(d) => plan("stack runghc", vec![step("stack", with_args(vec!["runghc".into(), f.clone()]), &d)], None),
                None => plan("runghc", vec![step("runghc", with_args(vec![f.clone()]), &dir)], None),
            }
        }
        "elixir" => plan("elixir", vec![step("elixir", with_args(vec![f.clone()]), &dir)], None),
        "d" => if has("rdmd") { plan("rdmd", vec![step("rdmd", with_args(vec![f.clone()]), &dir)], None) } else { plan("dmd -run", vec![step("dmd", with_args(vec!["-run".into(), f.clone()]), &dir)], None) },
        _ => Ok(None),
    }
}

#[allow(clippy::too_many_arguments)]
fn jvm(env: &Env, root: &Path, file: &Path, dir: &Path, lang: &str, entry: &Entry, argv: &[String], args: &str, title: &str) -> Result<Option<Plan>, String> {
    let f = s(file);
    let has = env.has;
    let mut min = java_min(root, dir);
    // main de instância: Java 21+ (preview até o 24, padrão no 25)
    if entry.instance { min = min.max(21); }
    let jdk = pick_jdk(env.jdks, min).cloned();
    let jdk_home = jdk.as_ref().map(|j| j.home.clone());
    let java_bin = |p: &str| -> String { jdk.as_ref().map(|j| s(&Path::new(&j.home).join("bin").join(exe(p)))).unwrap_or_else(|| p.to_string()) };
    let need_jdk = || -> Result<(), String> {
        if jdk.is_none() { Err(if min > 0 { format!("nenhum JDK {min} ou mais novo encontrado") } else { "nenhum JDK encontrado".into() }) } else { Ok(()) }
    };
    let plan = |how: String, steps: Vec<Step>| Ok(Some(Plan { title: title.to_string(), how, steps, jdk: jdk_home.clone() }));
    let target = entry.target.clone();
    need_jdk()?;
    match build_of(root, file) {
        Build::Maven { pom, test } if lang != "clojure" && !target.is_empty() => {
            let mut a = v(&["-q", "-f"]);
            a.push(s(&pom));
            a.push(if test { "test-compile" } else { "compile" }.into());
            a.push("org.codehaus.mojo:exec-maven-plugin:3.5.0:java".into());
            a.push(format!("-Dexec.mainClass={target}"));
            a.push(format!("-Dexec.classpathScope={}", if test { "test" } else { "runtime" }));
            a.push("-Dexec.cleanupDaemonThreads=false".into());
            if !args.trim().is_empty() { a.push(format!("-Dexec.args={}", args.trim())); }
            let st = Step { kind: "maven".into(), label: format!("mvn {}", a.join(" ")), args: a, java: true, ..Default::default() };
            return plan("Maven (exec:java)".into(), vec![st]);
        }
        Build::Gradle { root: groot, module, set } if lang != "clojure" && !target.is_empty() => {
            let build = std::fs::read_to_string(module.join("build.gradle")).or_else(|_| std::fs::read_to_string(module.join("build.gradle.kts"))).unwrap_or_default();
            if build.contains("com.android") { return Err("projeto Android: execute pelo Gradle (installDebug) ou pelo Android Studio".into()); }
            let wrapper = groot.join(if WIN { "gradlew.bat" } else { "gradlew" });
            let prog = if wrapper.is_file() { s(&wrapper) } else if has("gradle") { "gradle".into() } else { return Err("Gradle não encontrado (o projeto não tem gradlew)".into()) };
            let path = module.strip_prefix(&groot).map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join(":")).unwrap_or_default();
            let task = if path.is_empty() { ":bsRun".to_string() } else { format!(":{path}:bsRun") };
            let mut a = vec!["--init-script".into(), s(&gradle_init(&env.work)), "-q".into(), "--console=plain".into(), task, format!("-Dbs.main={target}"), format!("-Dbs.set={set}")];
            if !args.trim().is_empty() { a.push(format!("-Dbs.args={}", args.trim())); }
            let mut st = step(prog, a, &groot);
            st.java = true;
            return plan("Gradle (bsRun)".into(), vec![st]);
        }
        Build::Sbt { root: sroot } if lang == "scala" && has("sbt") => {
            let cmd = if target.is_empty() { "run".to_string() } else { format!("runMain {target}{}{}", if argv.is_empty() { "" } else { " " }, args.trim()) };
            let mut st = step("sbt", vec![cmd], &sroot);
            st.java = true;
            return plan("sbt".into(), vec![st]);
        }
        _ => {}
    }
    let with_args = |mut a: Vec<String>| { a.extend(argv.iter().cloned()); a };
    match lang {
        "java" => {
            let major = jdk.as_ref().map(|j| j.major).unwrap_or(0);
            // raiz dos pacotes: a pasta do arquivo sem as pastas do "package a.b;"
            let src = std::fs::read_to_string(file).unwrap_or_default();
            let pkg = regex::Regex::new(r"(?m)^\s*package\s+([\w.]+)\s*;").unwrap().captures(&entries::clean(&src, "java")).map(|c| c[1].to_string()).unwrap_or_default();
            let mut srcroot = dir.to_path_buf();
            let parts: Vec<&str> = if pkg.is_empty() { vec![] } else { pkg.split('.').collect() };
            if parts.iter().rev().zip(dir.components().rev()).all(|(p, c)| c.as_os_str().to_string_lossy() == *p) && parts.len() <= dir.components().count() {
                for _ in &parts { srcroot = srcroot.parent().unwrap_or(&srcroot).to_path_buf(); }
            }
            // bibliotecas soltas: lib/, libs/ e target/dependency
            let mut libs: Vec<String> = vec![];
            for d in [root.join("lib"), root.join("libs"), root.join("target").join("dependency"), srcroot.parent().map(|p| p.join("lib")).unwrap_or_default()] {
                if let Ok(rd) = std::fs::read_dir(&d) { let mut v: Vec<String> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "jar")).map(|p| s(&p)).collect(); v.sort(); for j in v { if !libs.contains(&j) { libs.push(j); } } }
            }
            let sep = if WIN { ";" } else { ":" };
            let out = env.work.join(format!("java-{}", hash(&s(&srcroot)))).join("classes");
            // o javac do JDK 8 não cria a pasta do -d ("directory not found")
            let _ = std::fs::create_dir_all(&out);
            let mut jc = v(&["-encoding", "UTF-8", "-g", "-d"]);
            jc.push(s(&out));
            jc.extend(["-sourcepath".into(), s(&srcroot)]);
            if !libs.is_empty() { jc.extend(["-cp".into(), libs.join(sep)]); }
            let preview = entry.instance && (21..25).contains(&major);
            if preview { jc.extend(["--enable-preview".into(), "--release".into(), major.to_string()]); }
            jc.push(f.clone());
            let mut cp = vec![s(&out)];
            cp.extend(libs);
            let mut ja = v(&["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dsun.stdout.encoding=UTF-8", "-Dsun.stderr.encoding=UTF-8"]);
            if preview { ja.push("--enable-preview".into()); }
            ja.extend(["-cp".into(), cp.join(sep), target.clone()]);
            let mut s1 = step(java_bin("javac"), jc, root);
            let mut s2 = step(java_bin("java"), with_args(ja), root);
            s1.java = true;
            s2.java = true;
            plan(format!("javac + java {}", jdk.as_ref().map(|j| if j.major > 0 { j.major.to_string() } else { j.name.clone() }).unwrap_or_default()), vec![s1, s2])
        }
        "kotlin" => {
            if !has("kotlinc") { return Err("compilador Kotlin (kotlinc) não encontrado".into()); }
            let jar = env.work.join(format!("kt-{}.jar", hash(&f)));
            let mut s1 = step("kotlinc", vec![f.clone(), "-include-runtime".into(), "-d".into(), s(&jar)], dir);
            let mut s2 = step(java_bin("java"), with_args(vec!["-Dfile.encoding=UTF-8".into(), "-Dstdout.encoding=UTF-8".into(), "-cp".into(), s(&jar), target.clone()]), dir);
            s1.java = true;
            s2.java = true;
            plan("kotlinc + java".into(), vec![s1, s2])
        }
        "scala" => {
            let prog = if has("scala-cli") { "scala-cli" } else if has("scala") { "scala" } else { return Err("Scala (scala-cli) não encontrado".into()) };
            let mut a = vec!["run".into(), f.clone()];
            if !target.is_empty() { a.extend(["--main-class".into(), target.clone()]); }
            if !argv.is_empty() { a.push("--".into()); }
            let mut st = step(prog, with_args(a), dir);
            st.java = true;
            plan(format!("{prog} run"), vec![st])
        }
        "groovy" => { let mut st = step("groovy", with_args(vec![f.clone()]), dir); st.java = true; plan("groovy".into(), vec![st]) }
        "clojure" => {
            let chain = up_to(root, dir);
            let (prog, a, cwd) = if let Some(d) = chain.iter().find(|d| d.join("deps.edn").is_file()).filter(|_| has("clojure")) { ("clojure", vec!["-M".into(), "-m".into(), target.clone()], d.clone()) }
                else if let Some(d) = chain.iter().find(|d| d.join("project.clj").is_file()).filter(|_| has("lein")) { ("lein", vec!["run".into(), "-m".into(), target.clone()], d.clone()) }
                else if has("clojure") { ("clojure", vec!["-M".into(), f.clone()], dir.to_path_buf()) } else { return Err("Clojure não encontrado".into()) };
            let mut st = step(prog, with_args(a), &cwd);
            st.java = true;
            plan(prog.to_string(), vec![st])
        }
        _ => Ok(None),
    }
}

fn rust(root: &Path, file: &Path, dir: &Path, argv: &[String], title: &str, work: &Path) -> Result<Option<Plan>, String> {
    let crate_dir = up_to(root, dir).into_iter().find(|d| d.join("Cargo.toml").is_file());
    let plan = |how: &str, steps: Vec<Step>| Ok(Some(Plan { title: title.to_string(), how: how.into(), steps, jdk: None }));
    if let Some(cd) = crate_dir {
        let toml = std::fs::read_to_string(cd.join("Cargo.toml")).unwrap_or_default();
        let rel: Vec<String> = file.strip_prefix(&cd).map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect()).unwrap_or_default();
        let r: Vec<&str> = rel.iter().map(String::as_str).collect();
        let stem = |s: &str| s.trim_end_matches(".rs").to_string();
        // [[bin]] com path apontando para o arquivo
        let bin_by_path = regex::Regex::new(r#"(?s)\[\[bin\]\][^\[]*?name\s*=\s*"([^"]+)"[^\[]*?path\s*=\s*"([^"]+)""#).unwrap().captures_iter(&toml)
            .find(|c| cd.join(&c[2]) == file || c[2].replace('\\', "/") == rel.join("/")).map(|c| c[1].to_string());
        let pkg = regex::Regex::new(r#"(?s)\[package\][^\[]*?name\s*=\s*"([^"]+)""#).unwrap().captures(&toml).map(|c| c[1].to_string());
        let sel: Option<Vec<String>> = if let Some(b) = bin_by_path { Some(vec!["--bin".into(), b]) } else {
            match r.as_slice() {
                ["src", "main.rs"] => Some(if toml.contains("[[bin]]") || cd.join("src").join("bin").is_dir() { pkg.map(|p| vec!["--bin".into(), p]).unwrap_or_default() } else { vec![] }),
                ["src", "bin", f] => Some(vec!["--bin".into(), stem(f)]),
                ["src", "bin", d, "main.rs"] => Some(vec!["--bin".into(), d.to_string()]),
                ["examples", f] => Some(vec!["--example".into(), stem(f)]),
                ["examples", d, "main.rs"] => Some(vec!["--example".into(), d.to_string()]),
                _ => None,
            }
        };
        if let Some(sel) = sel {
            let mut a = vec!["run".to_string()];
            a.extend(sel);
            if !argv.is_empty() { a.push("--".into()); a.extend(argv.iter().cloned()); }
            return plan("cargo run", vec![step("cargo", a, &cd)]);
        }
    }
    // arquivo solto (fora de um crate, ou que não é alvo dele): rustc e executa
    let out = work.join(exe(&format!("{}-{}", file.file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default(), hash(&s(file)))));
    plan("rustc + executar", vec![step("rustc", vec![s(file), "--edition".into(), "2021".into(), "-o".into(), s(&out)], dir), step(s(&out), argv.to_vec(), dir)])
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(n: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("bs-rt-plan-{n}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d }
    fn jdk(major: u32) -> Jdk { Jdk { home: format!("C:/jdk-{major}"), major, name: format!("jdk-{major}") } }
    fn e(target: &str) -> Entry { Entry { line: 1, label: "Main.main()".into(), target: target.into(), instance: false } }

    #[test]
    fn args() { assert_eq!(split_args(r#"a "b c" 'd e' f"#), vec!["a", "b c", "d e", "f"]); assert_eq!(split_args("  "), Vec::<String>::new()); }

    #[test]
    fn java_plain_maven_gradle() {
        let d = tmp("java");
        let jdks = [jdk(17), jdk(21)];
        let env = Env { has: &|_| true, jdks: &jdks, work: d.join("work") };
        // solto, com pacote: -sourcepath na raiz dos pacotes
        std::fs::create_dir_all(d.join("app/com/x")).unwrap();
        let f = d.join("app/com/x/Main.java");
        std::fs::write(&f, "package com.x;\npublic class Main { public static void main(String[] a) {} }\n").unwrap();
        let p = plan(&env, &d, &f, "java", &e("com.x.Main"), "um \"dois três\"").unwrap().unwrap();
        assert_eq!(p.steps.len(), 2);
        let sp = p.steps[0].args.iter().position(|a| a == "-sourcepath").unwrap();
        assert_eq!(PathBuf::from(&p.steps[0].args[sp + 1]), d.join("app"));
        assert!(p.steps[1].args.ends_with(&["com.x.Main".to_string(), "um".into(), "dois três".into()]));
        assert_eq!(p.jdk.as_deref(), Some("C:/jdk-17"));
        // pom.xml pede 21: escolhe o JDK 21; arquivo em src/test vira escopo test
        std::fs::create_dir_all(d.join("svc/src/test/java/a")).unwrap();
        std::fs::write(d.join("svc/pom.xml"), "<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>").unwrap();
        let t = d.join("svc/src/test/java/a/T.java");
        std::fs::write(&t, "package a; class T { public static void main(String[] a) {} }").unwrap();
        let p = plan(&env, &d, &t, "java", &e("a.T"), "").unwrap().unwrap();
        assert_eq!(p.steps[0].kind, "maven");
        assert!(p.steps[0].args.contains(&"-Dexec.classpathScope=test".to_string()) && p.steps[0].args.contains(&"test-compile".to_string()));
        assert_eq!(p.jdk.as_deref(), Some("C:/jdk-21"));
        // Gradle multi-projeto: tarefa :lib:bsRun na raiz, com o wrapper
        std::fs::create_dir_all(d.join("g/lib/src/main/kotlin/k")).unwrap();
        std::fs::write(d.join("g/settings.gradle.kts"), "include(\"lib\")").unwrap();
        std::fs::write(d.join("g/gradlew.bat"), "").unwrap();
        std::fs::write(d.join("g/lib/build.gradle.kts"), "plugins { kotlin(\"jvm\") }").unwrap();
        let k = d.join("g/lib/src/main/kotlin/k/App.kt");
        std::fs::write(&k, "package k\nfun main() {}\n").unwrap();
        let p = plan(&env, &d, &k, "kotlin", &e("k.AppKt"), "").unwrap().unwrap();
        assert!(p.steps[0].program.ends_with("gradlew.bat"));
        assert!(p.steps[0].args.contains(&":lib:bsRun".to_string()) && p.steps[0].args.contains(&"-Dbs.main=k.AppKt".to_string()));
        assert_eq!(PathBuf::from(&p.steps[0].cwd), d.join("g"));
        // sem JDK que atenda
        let old = [jdk(11)];
        let env2 = Env { has: &|_| true, jdks: &old, work: d.join("work") };
        assert!(plan(&env2, &d, &t, "java", &e("a.T"), "").unwrap_err().contains("21"));
        assert!(plan(&env2, &d, &f, "java", &Entry { instance: true, ..e("Main") }, "").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn python_rust_c() {
        let d = tmp("misc");
        let env = Env { has: &|p| p == "python" || p == "gcc", jdks: &[], work: d.join("work") };
        std::fs::create_dir_all(d.join("pkg/sub")).unwrap();
        for f in ["pkg/__init__.py", "pkg/sub/__init__.py"] { std::fs::write(d.join(f), "").unwrap(); }
        let f = d.join("pkg/sub/tool.py");
        std::fs::write(&f, "if __name__ == '__main__':\n    pass\n").unwrap();
        let p = plan(&env, &d, &f, "python", &Entry { line: 1, label: "tool.py".into(), target: String::new(), instance: false }, "").unwrap().unwrap();
        assert!(p.steps[0].args.ends_with(&["-m".to_string(), "pkg.sub.tool".into()]));
        assert_eq!(PathBuf::from(&p.steps[0].cwd), d);
        // cargo: src/bin/x.rs
        std::fs::create_dir_all(d.join("cr/src/bin")).unwrap();
        std::fs::write(d.join("cr/Cargo.toml"), "[package]\nname = \"cr\"\n").unwrap();
        let r = d.join("cr/src/bin/cli.rs");
        std::fs::write(&r, "fn main() {}").unwrap();
        let p = plan(&env, &d, &r, "rust", &e(""), "-v").unwrap().unwrap();
        assert_eq!(p.steps[0].args, vec!["run", "--bin", "cli", "--", "-v"]);
        // C: vizinhos sem main entram junto
        std::fs::create_dir_all(d.join("c")).unwrap();
        std::fs::write(d.join("c/main.c"), "int main(void) { return f(); }").unwrap();
        std::fs::write(d.join("c/util.c"), "int f(void) { return 0; }").unwrap();
        std::fs::write(d.join("c/other.c"), "int main() { return 1; }").unwrap();
        let p = plan(&env, &d, &d.join("c/main.c"), "c", &e(""), "").unwrap().unwrap();
        assert_eq!(p.steps[0].program, "gcc");
        assert!(p.steps[0].args.iter().any(|a| a.ends_with("util.c")) && !p.steps[0].args.iter().any(|a| a.ends_with("other.c")));
        let _ = std::fs::remove_dir_all(&d);
    }
}
