//! unilint: linter universal.
//!
//! Camadas (do estudo de ESLint, Ruff, Biome, Oxc, Semgrep, CodeQL, Roslyn, PMD, ShellCheck...):
//! - gramáticas Tree-sitter embutidas: nada para baixar, sintaxe completa e arquivo quebrado ainda gera árvore;
//! - `spec`: cada linguagem só diz quais tipos de nó são função, if, laço, catch, salto, atribuição...;
//! - `engine`: um parse e uma passada por arquivo, despacho por tabela; regras escritas uma vez sobre os conceitos;
//! - `suppress`: supressão central que entende os comentários do unilint e dos linters comuns;
//! - `lint_files`: arquivos em paralelo (rayon), um parser reaproveitado por thread.
pub mod diag;
mod engine;
pub mod jsp;
pub mod lang;
pub mod rules;
mod spec;
mod suppress;

pub use diag::{Diagnostic, Edit, Fix, Rule, Severity};
pub use lang::Lang;
use rayon::prelude::*;
use std::path::{Path, PathBuf};

/// mimalloc também para o Tree-sitter (o malloc do Windows é o gargalo com várias threads fazendo parse).
/// Chamar no começo do main, antes de qualquer parse; os executáveis também usam o mimalloc como alocador global.
pub fn use_fast_allocator() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        use libmimalloc_sys::{mi_calloc, mi_free, mi_malloc, mi_realloc};
        tree_sitter::set_allocator(Some(tree_sitter::Allocator { malloc: mi_malloc, calloc: mi_calloc, realloc: mi_realloc, free: mi_free }));
    });
}

/// Lint de um texto já em memória.
pub fn lint_source(lang: Lang, src: &str, file_name: &str) -> Vec<Diagnostic> { engine::run(lang, src, file_name) }

pub struct FileReport { pub path: PathBuf, pub lang: Lang, pub bytes: usize, pub lines: usize, pub diagnostics: Vec<Diagnostic> }

/// Lint de um arquivo do disco; None quando a linguagem não é suportada.
pub fn lint_path(path: &Path) -> std::io::Result<Option<FileReport>> {
    let Some(lang) = Lang::from_path(path) else { return Ok(None) };
    let bytes = std::fs::read(path)?;
    let src = String::from_utf8_lossy(&bytes);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let diagnostics = lint_source(lang, &src, &name);
    Ok(Some(FileReport { path: path.to_path_buf(), lang, bytes: bytes.len(), lines: memchr::memchr_iter(b'\n', &bytes).count() + 1, diagnostics }))
}

/// Vários arquivos em paralelo (a ordem da saída é a da entrada).
pub fn lint_files(paths: &[PathBuf]) -> Vec<FileReport> {
    // maiores primeiro: um arquivo enorme no fim da fila deixaria as outras threads paradas esperando por ele
    let mut order: Vec<(u64, usize)> = paths.par_iter().enumerate().map(|(i, p)| (std::fs::metadata(p).map(|m| m.len()).unwrap_or(0), i)).collect();
    order.sort_unstable_by_key(|x| std::cmp::Reverse(x.0));
    let mut out: Vec<(usize, FileReport)> = order.par_iter().with_max_len(1).filter_map(|&(_, i)| Some((i, lint_path(&paths[i]).ok().flatten()?))).collect();
    out.sort_unstable_by_key(|x| x.0);
    out.into_iter().map(|x| x.1).collect()
}

pub fn supports(path: &Path) -> bool { Lang::from_path(path).is_some() }

/// Só o parse (para medir quanto do tempo é do Tree-sitter e quanto é das regras).
#[doc(hidden)]
pub fn parse_files(paths: &[PathBuf]) -> usize {
    paths.par_iter().filter_map(|p| { let l = Lang::from_path(p)?; let s = std::fs::read_to_string(p).ok()?; engine::parse(l, &s).map(|t| t.root_node().child_count() as usize) }).sum()
}

#[cfg(test)]
mod tests;
