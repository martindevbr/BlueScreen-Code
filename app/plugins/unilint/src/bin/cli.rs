//! unilint na linha de comando.
//!   unilint [--json] [--stats] [--quiet] [--rules] <arquivos ou pastas>...
//! Saída padrão: `caminho:linha:coluna: severidade [regra] mensagem` (o formato que errorformat/IDEs entendem).
//! Respeita .gitignore e pula pastas ocultas, node_modules, target etc. Código de saída 1 quando há erro.
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() {
    unilint::use_fast_allocator();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |f: &str| args.iter().any(|a| a == f);
    if flag("--rules") {
        for r in unilint::rules::ALL { println!("{:<20} {:<8} {}  [{}]", r.id, r.severity.as_str(), r.summary, r.equivalents.join(", ")); }
        return;
    }
    let (json, stats, quiet) = (flag("--json"), flag("--stats"), flag("--quiet"));
    let roots: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let t0 = Instant::now();
    let mut files: Vec<PathBuf> = vec![];
    for r in if roots.is_empty() { vec![&".".to_string()].into_iter().cloned().collect::<Vec<_>>() } else { roots.into_iter().cloned().collect() } {
        let p = PathBuf::from(&r);
        if p.is_file() { files.push(p); continue; }
        let walk = ignore::WalkBuilder::new(&p).filter_entry(|e| !matches!(e.file_name().to_str(), Some("node_modules" | "target" | "dist" | "build" | "vendor" | "__pycache__"))).build();
        for e in walk.flatten() {
            if e.file_type().is_some_and(|t| t.is_file()) && unilint::supports(e.path()) && e.metadata().is_ok_and(|m| m.len() < 4 * 1024 * 1024) { files.push(e.into_path()); }
        }
    }
    let t_walk = t0.elapsed();
    if flag("--parse-only") {
        let t = Instant::now(); unilint::parse_files(&files);
        println!("{} arquivos: parse {:.0} ms", files.len(), t.elapsed().as_secs_f64() * 1000.0);
        return;
    }
    let reports = unilint::lint_files(&files);
    let t_lint = t0.elapsed() - t_walk;

    let out = std::io::stdout();
    let mut out = std::io::BufWriter::new(out.lock());
    let (mut errors, mut warnings, mut infos, mut bytes, mut lines) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let mut per_rule: std::collections::BTreeMap<&str, usize> = Default::default();
    let mut all = vec![];
    for r in &reports {
        bytes += r.bytes; lines += r.lines;
        for d in &r.diagnostics {
            match d.severity { unilint::Severity::Error => errors += 1, unilint::Severity::Warning => warnings += 1, unilint::Severity::Info => infos += 1 }
            *per_rule.entry(d.rule).or_default() += 1;
            if json { all.push(serde_json::json!({ "path": r.path.to_string_lossy(), "lang": r.lang.name(), "diagnostic": d })); }
            else if !quiet { let _ = writeln!(out, "{}:{}:{}: {} [{}] {}", r.path.display(), d.line, d.col, d.severity.as_str(), d.rule, d.message); }
        }
    }
    if json { let _ = writeln!(out, "{}", serde_json::to_string(&all).unwrap_or_default()); }
    if stats || quiet {
        let secs = t_lint.as_secs_f64().max(1e-9);
        let _ = writeln!(out, "\n{} arquivos, {} linhas, {:.1} MB  |  {} erros, {} avisos, {} infos", reports.len(), lines, bytes as f64 / 1e6, errors, warnings, infos);
        let _ = writeln!(out, "busca de arquivos {:.0} ms, lint {:.0} ms  |  {:.0} arquivos/s, {:.0} mil linhas/s, {:.1} MB/s ({} threads)",
            t_walk.as_secs_f64() * 1000.0, secs * 1000.0, reports.len() as f64 / secs, lines as f64 / secs / 1000.0, bytes as f64 / 1e6 / secs, rayon::current_num_threads());
        for (r, n) in per_rule { let _ = writeln!(out, "  {r:<20} {n}"); }
    }
    let _ = out.flush();
    if errors > 0 { std::process::exit(1); }
}
