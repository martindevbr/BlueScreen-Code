//! Servidor do plugin Linter Universal. O núcleo chama `unilint/lint` pelo gancho `lint` do plugin.json:
//! com o plugin ligado, o lint das linguagens embutidas não roda nenhum programa externo nem pede download.
//!
//! Rotas:
//!   unilint/lint     { project, file }  -> { handled, tool, problems }   (handled=false: o núcleo segue o caminho de sempre)
//!   unilint/project  ?project=          -> { files, lines, ms, problems: [{ file, ... }] }  (o projeto inteiro, em paralelo)
//!   unilint/rules                       -> catálogo das regras e linguagens
use bluescreen_sdk::plugin::{PluginServer, Req, ok};
use bluescreen_sdk::util::{ApiResult, absolute, fail, within};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

const ESLINT_CFG: &[&str] = &["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"];
/// arquivos maiores que isso ficam com o lint de sempre (minificados, gerados)
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// parâmetro do corpo JSON (chamada do núcleo) ou da query (chamada da página)
fn arg(r: &Req, body: &Value, k: &str) -> Option<String> {
    body[k].as_str().map(String::from).or_else(|| r.q(k).map(String::from)).filter(|s| !s.is_empty())
}
fn problem(d: &unilint::Diagnostic) -> Value {
    json!({ "line": d.line, "col": d.col, "end_line": d.end_line, "end_col": d.end_col, "sev": d.severity.as_str(), "msg": d.message, "rule": d.rule, "fixes": d.fixes })
}

/// JSP: o Java dos scriptlets (unilint::jsp). `text`: o texto do editor (lint ao vivo); sem ele, o do disco.
fn lint_jsp(abs: &Path, text: Option<String>) -> ApiResult<Value> {
    let src = match text { Some(t) => t, None => String::from_utf8_lossy(&std::fs::read(abs)?).into_owned() };
    let t = Instant::now();
    let name = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let d = unilint::jsp::lint(&src, &name);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    Ok(json!({ "handled": true, "tool": format!("Linter Universal (java em jsp, {ms:.1} ms)"), "problems": d.iter().map(problem).collect::<Vec<_>>() }))
}
const JSP: &[&str] = &["jsp", "jspf", "tag"];

fn lint_one(project: &Path, rel: &str, text: Option<String>) -> ApiResult<Value> {
    let abs = absolute(&project.join(rel));
    if !within(project, &abs) { return Err(fail("fora do projeto", 400)); }
    if abs.extension().is_some_and(|e| JSP.contains(&e.to_string_lossy().to_lowercase().as_str())) { return lint_jsp(&abs, text); }
    let Some(lang) = unilint::Lang::from_path(&abs) else { return Ok(json!({ "handled": false })) };
    // projeto com ESLint configurado: as regras do time valem mais que as nossas
    if matches!(lang, unilint::Lang::JavaScript | unilint::Lang::TypeScript | unilint::Lang::Tsx) && ESLINT_CFG.iter().any(|c| project.join(c).exists()) {
        return Ok(json!({ "handled": false, "note": "projeto com ESLint configurado" }));
    }
    if std::fs::metadata(&abs).map(|m| m.len() > MAX_BYTES).unwrap_or(true) { return Ok(json!({ "handled": false })); }
    let t = Instant::now();
    let Some(rep) = unilint::lint_path(&abs)? else { return Ok(json!({ "handled": false })) };
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    let mut out = json!({ "handled": true, "tool": format!("Linter Universal ({}, {ms:.1} ms)", rep.lang.name()), "problems": rep.diagnostics.iter().map(problem).collect::<Vec<_>>() });
    // JS/TS: os tipos continuam com o verificador TypeScript do editor (já vem no navegador, nada a baixar)
    if matches!(lang, unilint::Lang::JavaScript | unilint::Lang::TypeScript | unilint::Lang::Tsx) { out["client"] = json!("ts"); }
    Ok(out)
}

fn lint_project(project: &Path) -> Value {
    let t = Instant::now();
    let mut files: Vec<PathBuf> = vec![];
    let walk = ignore::WalkBuilder::new(project).filter_entry(|e| !matches!(e.file_name().to_str(), Some("node_modules" | "target" | "dist" | "build" | "vendor" | "__pycache__" | ".svn"))).build();
    for e in walk.flatten() {
        if e.file_type().is_some_and(|t| t.is_file()) && unilint::supports(e.path()) && e.metadata().is_ok_and(|m| m.len() <= MAX_BYTES) { files.push(e.into_path()); }
    }
    let reports = unilint::lint_files(&files);
    let mut problems = vec![];
    let mut lines = 0;
    for r in &reports {
        lines += r.lines;
        let rel = r.path.strip_prefix(project).unwrap_or(&r.path).to_string_lossy().replace('\\', "/");
        for d in &r.diagnostics { let mut p = problem(d); p["file"] = json!(rel); problems.push(p); }
    }
    json!({ "files": reports.len(), "lines": lines, "ms": (t.elapsed().as_secs_f64() * 1000.0).round(), "problems": problems })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    unilint::use_fast_allocator();
    let mut p = PluginServer::new("unilint");
    p.route("unilint/lint", |r: Arc<Req>| async move {
        let body: Value = r.body_json().unwrap_or_default();
        let project = PathBuf::from(arg(&r, &body, "project").ok_or_else(|| fail("project obrigatório", 400))?);
        let file = arg(&r, &body, "file").ok_or_else(|| fail("file obrigatório", 400))?;
        let text = body["text"].as_str().map(String::from);
        let v = tokio::task::spawn_blocking(move || lint_one(&project, &file, text)).await.map_err(|e| fail(e.to_string(), 500))??;
        ok(v)
    });
    p.route("unilint/project", |r: Arc<Req>| async move {
        let project = PathBuf::from(r.require("project")?);
        if !project.is_dir() { return Err(fail("projeto não encontrado", 404)); }
        ok(tokio::task::spawn_blocking(move || lint_project(&project)).await.map_err(|e| fail(e.to_string(), 500))?)
    });
    p.route("unilint/rules", |_r: Arc<Req>| async move {
        ok(json!({ "rules": unilint::rules::ALL, "langs": unilint::lang::ALL.iter().map(|l| l.name()).collect::<Vec<_>>() }))
    });
    // carrega as tabelas das gramáticas antes da primeira chamada (a primeira resposta não paga a inicialização)
    std::thread::spawn(|| { for l in unilint::lang::ALL { unilint::lint_source(*l, "", ""); } });
    p.run().await?;
    Ok(())
}
