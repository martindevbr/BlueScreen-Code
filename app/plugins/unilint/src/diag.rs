//! Modelo comum de diagnóstico: o que LSP, SARIF e rdjson entendem (posições 1-based, coluna em caracteres).
use serde::Serialize;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Severity { Error, Warning, Info }
impl Severity {
    pub fn as_str(self) -> &'static str { match self { Severity::Error => "error", Severity::Warning => "warning", Severity::Info => "info" } }
}

/// Troca de texto em bytes do arquivo original.
#[derive(Serialize, Clone, Debug)]
pub struct Edit { pub start: usize, pub end: usize, pub text: String }

#[derive(Serialize, Clone, Debug)]
pub struct Fix {
    pub title: String,
    pub edits: Vec<Edit>,
    /// pode ser aplicada sem revisão (como o Applicability::MachineApplicable do rustc / Safe do Ruff)
    pub safe: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Diagnostic {
    pub rule: &'static str,
    pub severity: Severity,
    pub message: String,
    pub line: u32,
    pub col: u32,
    pub end_line: u32,
    pub end_col: u32,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fixes: Vec<Fix>,
}

/// Metadados de uma regra. `equivalents` liga a regra às de outros linters (para supressão e deduplicação).
#[derive(Serialize, Debug)]
pub struct Rule {
    pub id: &'static str,
    pub severity: Severity,
    pub summary: &'static str,
    pub equivalents: &'static [&'static str],
}
