//! Linguagens embutidas (gramáticas Tree-sitter compiladas no binário: nada para baixar).
use std::path::Path;
use tree_sitter::Language;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum Lang { Python, JavaScript, TypeScript, Tsx, Java, Rust, Go, C, Cpp, CSharp, Bash, Ruby, Php, Kotlin, PowerShell, Lua }

pub const ALL: &[Lang] = &[
    Lang::Python, Lang::JavaScript, Lang::TypeScript, Lang::Tsx, Lang::Java, Lang::Rust, Lang::Go, Lang::C, Lang::Cpp,
    Lang::CSharp, Lang::Bash, Lang::Ruby, Lang::Php, Lang::Kotlin, Lang::PowerShell, Lang::Lua,
];

impl Lang {
    pub fn name(self) -> &'static str {
        match self {
            Lang::Python => "python", Lang::JavaScript => "javascript", Lang::TypeScript => "typescript", Lang::Tsx => "tsx",
            Lang::Java => "java", Lang::Rust => "rust", Lang::Go => "go", Lang::C => "c", Lang::Cpp => "cpp", Lang::CSharp => "csharp",
            Lang::Bash => "bash", Lang::Ruby => "ruby", Lang::Php => "php", Lang::Kotlin => "kotlin", Lang::PowerShell => "powershell", Lang::Lua => "lua",
        }
    }
    /// extensão em minúsculas, sem o ponto
    pub fn from_extension(ext: &str) -> Option<Lang> {
        Some(match ext {
            "py" | "pyw" | "pyi" => Lang::Python,
            "js" | "mjs" | "cjs" | "jsx" => Lang::JavaScript,
            "ts" | "mts" | "cts" => Lang::TypeScript,
            "tsx" => Lang::Tsx,
            "java" => Lang::Java,
            "rs" => Lang::Rust,
            "go" => Lang::Go,
            "c" | "h" => Lang::C,
            "cpp" | "cc" | "cxx" | "c++" | "hpp" | "hh" | "hxx" | "ino" => Lang::Cpp,
            "cs" => Lang::CSharp,
            "sh" | "bash" | "ksh" => Lang::Bash,
            "rb" | "rake" | "gemspec" => Lang::Ruby,
            "php" | "phtml" => Lang::Php,
            "kt" | "kts" => Lang::Kotlin,
            "ps1" | "psm1" | "psd1" => Lang::PowerShell,
            "lua" => Lang::Lua,
            _ => return None,
        })
    }
    pub fn from_path(p: &Path) -> Option<Lang> {
        let name = p.file_name()?.to_string_lossy().to_lowercase();
        match name.as_str() { "rakefile" | "gemfile" => return Some(Lang::Ruby), _ => {} }
        Lang::from_extension(&p.extension()?.to_string_lossy().to_lowercase())
    }
    pub fn language(self) -> Language {
        match self {
            Lang::Python => tree_sitter_python::LANGUAGE.into(),
            Lang::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Lang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::Java => tree_sitter_java::LANGUAGE.into(),
            Lang::Rust => tree_sitter_rust::LANGUAGE.into(),
            Lang::Go => tree_sitter_go::LANGUAGE.into(),
            Lang::C => tree_sitter_c::LANGUAGE.into(),
            Lang::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Lang::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            Lang::Bash => tree_sitter_bash::LANGUAGE.into(),
            Lang::Ruby => tree_sitter_ruby::LANGUAGE.into(),
            Lang::Php => tree_sitter_php::LANGUAGE_PHP.into(),
            Lang::Kotlin => tree_sitter_kotlin_ng::LANGUAGE.into(),
            Lang::PowerShell => tree_sitter_powershell::LANGUAGE.into(),
            Lang::Lua => tree_sitter_lua::LANGUAGE.into(),
        }
    }
    pub(crate) fn index(self) -> usize { ALL.iter().position(|l| *l == self).unwrap_or(0) }
}
