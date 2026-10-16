//! Dependências não instaladas: acha os manifestos do projeto (raiz e até 2 níveis abaixo) e confere se o que eles
//! pedem já está baixado. A página mostra um aviso com o comando que resolve (npm install, uv sync, dotnet restore...).
//! Erros como "Cannot find module" ou "Type annotations can only be used in TypeScript files" quase sempre vêm daqui.
//! - Node: cada pacote de dependencies/devDependencies precisa de node_modules/<nome>/package.json nesta pasta ou
//!   numa acima, até a raiz do projeto (workspaces instalam na raiz);
//! - Python: precisa de um ambiente virtual (.venv, venv, env) com pyvenv.cfg;
//! - PHP: vendor/autoload.php; .NET: obj/project.assets.json; Dart/Flutter: .dart_tool/package_config.json;
//!   Ruby: Gemfile.lock; Go: go.sum quando o go.mod tem require.
use crate::build::detect::which;
use crate::plugins::{RouteFn, ok, project_of, route_fn};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct Item {
    /// pasta relativa à raiz do projeto ("" = raiz), com "/"
    dir: String,
    kind: &'static str,
    label: String,
    reason: String,
    missing: usize,
    total: usize,
    sample: Vec<String>,
    /// linhas para rodar no terminal, na pasta `dir`, uma depois da outra
    commands: Vec<String>,
    tool: String,
    tool_ok: bool,
}

const SKIP: &[&str] = &["node_modules", "target", "dist", "build", "out", "vendor", "venv", "env", "bin", "obj", "__pycache__", "coverage"];

pub fn routes() -> Vec<(&'static str, RouteFn)> {
    vec![("deps/check", route_fn(|r| async move {
        let root = project_of(&r)?;
        let items = tokio::task::spawn_blocking(move || check(&root)).await.unwrap_or_default();
        ok(items)
    }))]
}

pub fn check(root: &Path) -> Vec<Item> {
    let mut dirs = vec![root.to_path_buf()];
    let mut level = vec![root.to_path_buf()];
    for _ in 0..2 {
        let mut next = vec![];
        for d in &level {
            let Ok(rd) = fs::read_dir(d) else { continue };
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.starts_with('.') || SKIP.contains(&n.as_str()) || !e.file_type().is_ok_and(|t| t.is_dir()) { continue; }
                next.push(e.path());
            }
        }
        dirs.extend(next.iter().cloned());
        level = next;
        if dirs.len() > 400 { break; }
    }
    let mut out = vec![];
    let mut root_node_missing = false;
    for d in &dirs {
        let rel = d.strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        // workspaces: com a raiz sem instalar, um "npm install" na raiz resolve as subpastas também
        if let Some(it) = node(root, d, &rel) { if rel.is_empty() { root_node_missing = true; out.push(it); } else if !root_node_missing { out.push(it); } }
        out.extend([python(d, &rel), php(d, &rel), dotnet(d, &rel), dart(d, &rel), ruby(d, &rel), go(d, &rel)].into_iter().flatten());
    }
    out
}

fn item(kind: &'static str, label: &str, rel: &str, reason: String, tool: &str, commands: Vec<String>) -> Item {
    Item { dir: rel.into(), kind, label: label.into(), reason, missing: 0, total: 0, sample: vec![], commands, tool: tool.into(), tool_ok: which(tool).is_some() }
}

fn node(root: &Path, d: &Path, rel: &str) -> Option<Item> {
    let pj: Value = serde_json::from_str(&fs::read_to_string(d.join("package.json")).ok()?).ok()?;
    let mut deps: BTreeMap<String, ()> = BTreeMap::new();
    for k in ["dependencies", "devDependencies"] {
        if let Some(o) = pj[k].as_object() { for n in o.keys() { deps.insert(n.clone(), ()); } }
    }
    if deps.is_empty() { return None; }
    let installed = |name: &str| {
        let mut cur = Some(d);
        while let Some(c) = cur {
            if c.join("node_modules").join(name).join("package.json").is_file() { return true; }
            if c == root { break; }
            cur = c.parent();
        }
        false
    };
    let missing: Vec<String> = deps.keys().filter(|n| !installed(n)).cloned().collect();
    if missing.is_empty() { return None; }
    let declared = pj["packageManager"].as_str().unwrap_or("").split('@').next().unwrap_or("").to_string();
    let has = |f: &str| d.join(f).is_file() || root.join(f).is_file();
    let pm = if !declared.is_empty() { declared } else if has("pnpm-lock.yaml") { "pnpm".into() } else if has("yarn.lock") { "yarn".into() } else if has("bun.lockb") || has("bun.lock") { "bun".into() } else { "npm".into() };
    let none = !d.join("node_modules").is_dir() && !root.join("node_modules").is_dir();
    let reason = if none { format!("node_modules não existe: {} pacotes do package.json não foram baixados", deps.len()) }
                 else { format!("{} de {} pacotes do package.json não estão em node_modules", missing.len(), deps.len()) };
    let mut it = item("node", &format!("Node · {pm}"), rel, reason, &pm, vec![format!("{pm} install")]);
    it.total = deps.len(); it.missing = missing.len(); it.sample = missing.into_iter().take(6).collect();
    Some(it)
}

fn has_venv(d: &Path) -> bool { [".venv", "venv", "env", ".env"].iter().any(|v| d.join(v).join("pyvenv.cfg").is_file()) }
fn python(d: &Path, rel: &str) -> Option<Item> {
    let f = |n: &str| d.join(n).is_file();
    if !(f("requirements.txt") || f("pyproject.toml") || f("Pipfile")) || has_venv(d) { return None; }
    // um ambiente na pasta de cima (monorepo) também serve
    if d.parent().is_some_and(has_venv) { return None; }
    let py = if which("py").is_some() { "py" } else { "python" };
    let reason = "nenhum ambiente virtual (.venv) com as dependências foi encontrado".to_string();
    Some(if f("uv.lock") || (f("pyproject.toml") && fs::read_to_string(d.join("pyproject.toml")).is_ok_and(|t| t.contains("[tool.uv]"))) {
        item("python", "Python · uv", rel, reason, "uv", vec!["uv sync".into()])
    } else if f("poetry.lock") {
        item("python", "Python · Poetry", rel, reason, "poetry", vec!["poetry install".into()])
    } else if f("Pipfile") {
        item("python", "Python · Pipenv", rel, reason, "pipenv", vec!["pipenv install --dev".into()])
    } else if f("requirements.txt") {
        item("python", "Python · pip", rel, reason, py, vec![format!("{py} -m venv .venv"), r".venv\Scripts\python -m pip install -r requirements.txt".into()])
    } else {
        item("python", "Python · pip", rel, reason, py, vec![format!("{py} -m venv .venv"), r".venv\Scripts\python -m pip install -e .".into()])
    })
}
fn php(d: &Path, rel: &str) -> Option<Item> {
    (d.join("composer.json").is_file() && !d.join("vendor").join("autoload.php").is_file())
        .then(|| item("php", "PHP · Composer", rel, "vendor/ não existe: as dependências do composer.json não foram baixadas".into(), "composer", vec!["composer install".into()]))
}
fn dotnet(d: &Path, rel: &str) -> Option<Item> {
    let projs: Vec<_> = fs::read_dir(d).ok()?.flatten().map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "csproj" || x == "fsproj" || x == "vbproj")).collect();
    if projs.is_empty() || d.join("obj").join("project.assets.json").is_file() { return None; }
    Some(item("dotnet", ".NET · NuGet", rel, "os pacotes NuGet não foram restaurados (falta obj/project.assets.json)".into(), "dotnet", vec!["dotnet restore".into()]))
}
fn dart(d: &Path, rel: &str) -> Option<Item> {
    let spec = fs::read_to_string(d.join("pubspec.yaml")).ok()?;
    if d.join(".dart_tool").join("package_config.json").is_file() { return None; }
    let flutter = spec.contains("sdk: flutter");
    let tool = if flutter { "flutter" } else { "dart" };
    Some(item("dart", if flutter { "Flutter · pub" } else { "Dart · pub" }, rel, "os pacotes do pubspec.yaml não foram baixados".into(), tool, vec![format!("{tool} pub get")]))
}
fn ruby(d: &Path, rel: &str) -> Option<Item> {
    (d.join("Gemfile").is_file() && !d.join("Gemfile.lock").is_file())
        .then(|| item("ruby", "Ruby · Bundler", rel, "as gems do Gemfile ainda não foram instaladas (sem Gemfile.lock)".into(), "bundle", vec!["bundle install".into()]))
}
fn go(d: &Path, rel: &str) -> Option<Item> {
    let m = fs::read_to_string(d.join("go.mod")).ok()?;
    (m.contains("require") && !d.join("go.sum").is_file())
        .then(|| item("go", "Go · módulos", rel, "go.sum não existe: os módulos do go.mod não foram baixados".into(), "go", vec!["go mod download".into()]))
}

#[cfg(test)]
mod tests {
    use super::check;
    use std::fs;
    #[test]
    fn node_missing_and_installed() {
        let d = std::env::temp_dir().join(format!("bs-deps-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("node_modules/left-pad")).unwrap();
        fs::write(d.join("package.json"), r#"{"dependencies":{"left-pad":"1","typescript":"5"}}"#).unwrap();
        fs::write(d.join("node_modules/left-pad/package.json"), "{}").unwrap();
        let v = check(&d);
        assert_eq!(v.len(), 1);
        assert_eq!((v[0].missing, v[0].total), (1, 2));
        assert_eq!(v[0].sample, vec!["typescript".to_string()]);
        fs::create_dir_all(d.join("node_modules/typescript")).unwrap();
        fs::write(d.join("node_modules/typescript/package.json"), "{}").unwrap();
        assert!(check(&d).is_empty());
        let _ = fs::remove_dir_all(&d);
    }
}
