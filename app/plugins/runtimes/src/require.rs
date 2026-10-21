//! A versão que o projeto pede de cada runtime, lida dos arquivos que as próprias ferramentas usam:
//! - Java: pom.xml (maven.compiler.release/source, java.version, <release>), build.gradle(.kts) (toolchain,
//!   jvmToolchain, sourceCompatibility), .java-version, .sdkmanrc, .tool-versions
//! - Node.js: .nvmrc, .node-version, engines.node do package.json · Python: .python-version, requires-python do
//!   pyproject.toml, runtime.txt, Pipfile · Go: go.mod (go / toolchain) · Rust: rust-toolchain(.toml), rust-version
//! - .NET: global.json, <TargetFramework> do .csproj · Ruby: .ruby-version, Gemfile · PHP: require.php do composer.json
//! - Dart: environment.sdk do pubspec.yaml
//!
//! Procura da pasta do arquivo até a raiz do projeto (o mais perto vale). A versão é o mínimo: "21" aceita 21, 23 e 25.
use regex::Regex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

macro_rules! re { ($s:expr) => {{ static R: LazyLock<Regex> = LazyLock::new(|| Regex::new($s).unwrap()); &*R }}; }

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Need {
    /// versão mínima ("21", "3.11", "1.22")
    pub version: String,
    /// de onde veio (caminho relativo ao projeto)
    pub source: String,
}

/// pastas do arquivo até a raiz do projeto (a do arquivo primeiro)
pub fn up_to(root: &Path, start: &Path) -> Vec<PathBuf> {
    let mut v = vec![];
    let mut cur = Some(start);
    while let Some(d) = cur {
        v.push(d.to_path_buf());
        if d == root || !d.starts_with(root) { break; }
        cur = d.parent();
    }
    if v.last().is_some_and(|d| d != root) && start.starts_with(root) { v.push(root.to_path_buf()); }
    v
}

fn read(p: &Path) -> String {
    match std::fs::metadata(p) { Ok(m) if m.is_file() && m.len() < 2 * 1024 * 1024 => std::fs::read_to_string(p).unwrap_or_default(), _ => String::new() }
}
/// "1.8" -> "8" (Java antigo); tira o "v" e espaços
fn norm_java(v: &str) -> String { let v = v.trim().trim_start_matches('v'); v.strip_prefix("1.").filter(|r| !r.is_empty()).unwrap_or(v).split(['.', '-', '_', '+']).next().unwrap_or("").to_string() }
/// primeira versão numérica de uma faixa: ">=18.0.0" -> "18.0.0", "^3.10" -> "3.10", "~> 3.2" -> "3.2"
fn first_version(s: &str) -> Option<String> { re!(r"(\d+(?:\.\d+){0,2})").captures(s).map(|c| c[1].to_string()) }
fn rel(root: &Path, p: &Path) -> String { p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/") }

/// versão pedida para uma ferramenta do catálogo (jdk, node, python, go, rust, dotnet, ruby, php, dart)
pub fn need(tool: &str, root: &Path, file_dir: &Path) -> Option<Need> {
    for d in up_to(root, file_dir) {
        if let Some((v, f)) = need_in(tool, &d).filter(|(v, _)| !v.is_empty()) { return Some(Need { version: v, source: rel(root, &d.join(f)) }); }
    }
    None
}

fn tool_versions(d: &Path, names: &[&str]) -> Option<String> {
    read(&d.join(".tool-versions")).lines().find_map(|l| {
        let mut it = l.split_whitespace();
        let k = it.next()?;
        names.contains(&k).then(|| it.next().map(String::from)).flatten()
    })
}

fn need_in(tool: &str, d: &Path) -> Option<(String, &'static str)> {
    match tool {
        "jdk" => {
            let pom = read(&d.join("pom.xml"));
            if !pom.is_empty() {
                for r in [re!(r"<maven\.compiler\.release>\s*([\d.]+)\s*<"), re!(r"<release>\s*([\d.]+)\s*</release>"), re!(r"<java\.version>\s*([\d.]+)\s*<"), re!(r"<maven\.compiler\.source>\s*([\d.]+)\s*<"), re!(r"<maven\.compiler\.target>\s*([\d.]+)\s*<"), re!(r"<source>\s*([\d.]+)\s*</source>")] {
                    if let Some(c) = r.captures(&pom) { return Some((norm_java(&c[1]), "pom.xml")); }
                }
            }
            for f in ["build.gradle.kts", "build.gradle"] {
                let g = read(&d.join(f));
                if g.is_empty() { continue; }
                for r in [re!(r"JavaLanguageVersion\.of\(\s*(\d+)\s*\)"), re!(r"jvmToolchain\(\s*(\d+)\s*\)"), re!(r#"(?:sourceCompatibility|targetCompatibility)\s*=\s*(?:JavaVersion\.VERSION_(\d+(?:_\d+)?)|['"]?([\d.]+)['"]?)"#), re!(r"jvmTarget\.set\(\s*JvmTarget\.JVM_(\d+)")] {
                    if let Some(c) = r.captures(&g) {
                        let v = c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().replace('_', ".")).unwrap_or_default();
                        return Some((norm_java(&v), if f.ends_with("kts") { "build.gradle.kts" } else { "build.gradle" }));
                    }
                }
            }
            let jv = read(&d.join(".java-version"));
            if !jv.trim().is_empty() { return Some((norm_java(jv.trim().rsplit('-').next().unwrap_or("")), ".java-version")); }
            if let Some(c) = re!(r"(?m)^\s*java\s*=\s*([\d.]+)").captures(&read(&d.join(".sdkmanrc"))) { return Some((norm_java(&c[1]), ".sdkmanrc")); }
            tool_versions(d, &["java"]).and_then(|v| first_version(&v)).map(|v| (norm_java(&v), ".tool-versions"))
        }
        "node" => {
            for f in [".nvmrc", ".node-version"] {
                let t = read(&d.join(f));
                let t = t.trim();
                if !t.is_empty() && !t.starts_with("lts") && !t.starts_with("node") { return first_version(t).map(|v| (v, if f == ".nvmrc" { ".nvmrc" } else { ".node-version" })); }
            }
            let pj = read(&d.join("package.json"));
            if !pj.is_empty() && let Ok(v) = serde_json::from_str::<serde_json::Value>(&pj) && let Some(e) = v["engines"]["node"].as_str() {
                return first_version(e).map(|v| (v, "package.json"));
            }
            tool_versions(d, &["nodejs", "node"]).and_then(|v| first_version(&v)).map(|v| (v, ".tool-versions"))
        }
        "python" => {
            let pv = read(&d.join(".python-version"));
            if let Some(v) = pv.lines().next().and_then(first_version) { return Some((v, ".python-version")); }
            if let Some(c) = re!(r#"(?m)^\s*requires-python\s*=\s*["']([^"']+)["']"#).captures(&read(&d.join("pyproject.toml"))) {
                // ">=3.10,<4": o mínimo
                let spec = c[1].split(',').find(|p| p.contains(">=") || p.contains("~=") || p.contains("==") || p.trim().starts_with('^')).unwrap_or(&c[1]).to_string();
                return first_version(&spec).map(|v| (v, "pyproject.toml"));
            }
            if let Some(c) = re!(r"python-(\d+\.\d+)").captures(&read(&d.join("runtime.txt"))) { return Some((c[1].to_string(), "runtime.txt")); }
            if let Some(c) = re!(r#"python_version\s*=\s*["'](\d+\.\d+)"#).captures(&read(&d.join("Pipfile"))) { return Some((c[1].to_string(), "Pipfile")); }
            tool_versions(d, &["python"]).and_then(|v| first_version(&v)).map(|v| (v, ".tool-versions"))
        }
        "go" => {
            let m = read(&d.join("go.mod"));
            if let Some(c) = re!(r"(?m)^toolchain\s+go(\d+\.\d+(?:\.\d+)?)").captures(&m) { return Some((c[1].to_string(), "go.mod")); }
            re!(r"(?m)^go\s+(\d+\.\d+(?:\.\d+)?)").captures(&m).map(|c| (c[1].to_string(), "go.mod"))
        }
        "rust" => {
            let t = read(&d.join("rust-toolchain.toml"));
            if let Some(c) = re!(r#"channel\s*=\s*"(\d+\.\d+(?:\.\d+)?)""#).captures(&t) { return Some((c[1].to_string(), "rust-toolchain.toml")); }
            let t = read(&d.join("rust-toolchain"));
            if let Some(v) = t.lines().next().map(str::trim).filter(|l| l.chars().next().is_some_and(|c| c.is_ascii_digit())) { return Some((v.to_string(), "rust-toolchain")); }
            re!(r#"(?m)^\s*rust-version\s*=\s*"(\d+\.\d+(?:\.\d+)?)""#).captures(&read(&d.join("Cargo.toml"))).map(|c| (c[1].to_string(), "Cargo.toml"))
        }
        "dotnet" => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&read(&d.join("global.json"))) && let Some(s) = v["sdk"]["version"].as_str() {
                return first_version(s).map(|x| (x, "global.json"));
            }
            // <TargetFramework>net8.0</TargetFramework> (ou net8.0-windows): precisa do SDK 8 ou mais novo
            let projs: Vec<PathBuf> = std::fs::read_dir(d).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "csproj" || x == "fsproj" || x == "vbproj")).collect()).unwrap_or_default();
            let mut best: Option<u32> = None;
            for p in &projs {
                for c in re!(r"<TargetFrameworks?>([^<]+)<").captures_iter(&read(p)) {
                    for tfm in c[1].split(';') {
                        if let Some(m) = re!(r"^net(\d+)\.\d").captures(tfm.trim()) { let n: u32 = m[1].parse().unwrap_or(0); if n >= 5 { best = Some(best.map_or(n, |b| b.max(n))); } }
                    }
                }
            }
            best.map(|n| (n.to_string(), "csproj"))
        }
        "ruby" => {
            let rv = read(&d.join(".ruby-version"));
            if let Some(v) = rv.lines().next().and_then(first_version) { return Some((v, ".ruby-version")); }
            if let Some(c) = re!(r#"(?m)^\s*ruby\s+['"]([^'"]+)['"]"#).captures(&read(&d.join("Gemfile"))) { return first_version(&c[1]).map(|v| (v, "Gemfile")); }
            tool_versions(d, &["ruby"]).and_then(|v| first_version(&v)).map(|v| (v, ".tool-versions"))
        }
        "php" => {
            let cj = read(&d.join("composer.json"));
            let v: serde_json::Value = serde_json::from_str(&cj).ok()?;
            v["require"]["php"].as_str().and_then(first_version).map(|x| (x, "composer.json"))
        }
        "dart" => re!(r#"(?m)^\s*sdk\s*:\s*['"]?[>=^~ ]*(\d+\.\d+(?:\.\d+)?)"#).captures(&read(&d.join("pubspec.yaml"))).map(|c| (c[1].to_string(), "pubspec.yaml")),
        _ => None,
    }
}

/// "21.0.2" atende "21"? "3.12.1" atende "3.11"? Compara só as partes pedidas (a versão pedida é o mínimo).
pub fn satisfies(found: &str, need: &str) -> bool {
    let nums = |s: &str| -> Vec<u64> { re!(r"\d+").find_iter(s).filter_map(|m| m.as_str().parse().ok()).collect() };
    let (f, n) = (nums(found), nums(need));
    if n.is_empty() || f.is_empty() { return true; }
    let f: Vec<u64> = (0..n.len()).map(|i| f.get(i).copied().unwrap_or(0)).collect();
    f >= n
}

/// versão de um texto de saída ("javac 21.0.2", "Python 3.12.1", "go version go1.22.1 windows/amd64", "v20.11.0")
pub fn parse_version(out: &str) -> Option<String> {
    re!(r"(?:go|v|version\s|\s|^)(\d+\.\d+(?:\.\d+)?(?:[-+._][0-9A-Za-z.]+)?)").captures(out).map(|c| c[1].trim_end_matches(['.', ',']).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions() {
        assert!(satisfies("21.0.2", "21"));
        assert!(satisfies("23", "21"));
        assert!(!satisfies("17.0.9", "21"));
        assert!(satisfies("3.12.1", "3.11"));
        assert!(!satisfies("3.9.6", "3.10"));
        assert!(satisfies("1.22.1", "1.22"));
        assert_eq!(norm_java("1.8"), "8");
        assert_eq!(norm_java("17"), "17");
        assert_eq!(parse_version("go version go1.22.1 windows/amd64").as_deref(), Some("1.22.1"));
        assert_eq!(parse_version("Python 3.12.1").as_deref(), Some("3.12.1"));
        assert_eq!(parse_version("v20.11.0").as_deref(), Some("20.11.0"));
        assert_eq!(parse_version("ruby 3.3.0 (2023-12-25 revision 5124f9ac75) [x64-mingw-ucrt]").as_deref(), Some("3.3.0"));
        assert_eq!(parse_version("cargo 1.79.0 (ffa9cf99a 2024-06-03)").as_deref(), Some("1.79.0"));
    }
    #[test]
    fn project_files() {
        let d = std::env::temp_dir().join(format!("bs-rt-req-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("mod/src")).unwrap();
        std::fs::write(d.join("pom.xml"), "<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>").unwrap();
        std::fs::write(d.join("mod/build.gradle.kts"), "java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }").unwrap();
        std::fs::write(d.join(".nvmrc"), "v20.11.0\n").unwrap();
        std::fs::write(d.join("pyproject.toml"), "[project]\nrequires-python = \">=3.10,<4\"\n").unwrap();
        std::fs::write(d.join("go.mod"), "module x\n\ngo 1.22\n").unwrap();
        std::fs::write(d.join("App.csproj"), "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>").unwrap();
        assert_eq!(need("jdk", &d, &d.join("mod/src")), Some(Need { version: "17".into(), source: "mod/build.gradle.kts".into() }));
        assert_eq!(need("jdk", &d, &d).unwrap().version, "21");
        assert_eq!(need("node", &d, &d.join("mod")).unwrap().version, "20.11.0");
        assert_eq!(need("python", &d, &d).unwrap().version, "3.10");
        assert_eq!(need("go", &d, &d).unwrap().version, "1.22");
        assert_eq!(need("dotnet", &d, &d).unwrap().version, "8");
        let _ = std::fs::remove_dir_all(&d);
    }
}
