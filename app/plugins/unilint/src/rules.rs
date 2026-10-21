//! Catálogo das regras universais. `equivalents` são os nomes da mesma ideia em outros linters: valem nos
//! comentários de supressão (`# noqa: F841`, `// eslint-disable-line no-unused-vars`) e na deduplicação.
use crate::diag::{Rule, Severity::*};

pub static SYNTAX: Rule = Rule { id: "syntax", severity: Error, summary: "Erro de sintaxe", equivalents: &["E999", "syntax-error", "parse-error", "SC1000", "CS1002", "CS1513"] };
pub static UNREACHABLE: Rule = Rule { id: "unreachable", severity: Warning, summary: "Código depois de return/throw/break/continue nunca roda", equivalents: &["no-unreachable", "W0101", "unreachable_code", "unreachable-code", "UNREACHABLE_CODE", "UnreachableCode", "CS0162", "deadCode.unreachable", "Lint/UnreachableCode", "W511", "unreachable-code-loop", "S1763"] };
pub static SELF_ASSIGN: Rule = Rule { id: "self-assign", severity: Warning, summary: "Atribuição de uma variável a ela mesma", equivalents: &["no-self-assign", "W0127", "PLW0127", "self-assigning-variable", "self_assignment", "SA4018", "Lint/SelfAssignment", "SelfAssignment", "CS1717"] };
pub static SELF_COMPARE: Rule = Rule { id: "self-compare", severity: Warning, summary: "Comparação ou operação lógica com os dois lados iguais", equivalents: &["no-self-compare", "R0124", "PLR0124", "comparison-with-itself", "eq_op", "SA4000", "misc-redundant-expression", "Lint/BinaryOperatorWithIdenticalOperands", "BinaryOperatorWithIdenticalOperands", "CS1718"] };
pub static DUP_CONDITION: Rule = Rule { id: "duplicate-condition", severity: Warning, summary: "Condição repetida na mesma cadeia de if / else if", equivalents: &["no-dupe-else-if", "ifs_same_cond", "S1862", "dupCond", "Lint/DuplicateElsifCondition", "DuplicateElsifCondition"] };
pub static IDENTICAL_BRANCHES: Rule = Rule { id: "identical-branches", severity: Warning, summary: "if e else (ou ? :) fazem exatamente a mesma coisa", equivalents: &["if_same_then_else", "S3923", "S1871", "no-all-duplicated-branches", "no-duplicated-branches", "bugprone-branch-clone", "dupBranchBody", "Lint/DuplicateBranch", "DuplicateBranch"] };
pub static CONSTANT_CONDITION: Rule = Rule { id: "constant-condition", severity: Warning, summary: "Condição do if é sempre verdadeira ou sempre falsa", equivalents: &["no-constant-condition", "W0125", "PLW0125", "using-constant-test", "Lint/LiteralAsCondition", "LiteralAsCondition", "ConstantConditionIf"] };
pub static EMPTY_BLOCK: Rule = Rule { id: "empty-block", severity: Warning, summary: "Bloco do if vazio", equivalents: &["no-empty", "S108", "EmptyIfBlock", "EmptyBlock", "Lint/EmptyConditionalBody", "EmptyControlStatement"] };
pub static EMPTY_CATCH: Rule = Rule { id: "empty-catch", severity: Warning, summary: "catch/except vazio engole o erro", equivalents: &["no-empty", "S110", "BLE001", "W0718", "broad-exception-caught", "EmptyCatchBlock", "empty-catch", "bugprone-empty-catch", "Lint/SuppressedException", "SuppressedException", "SwallowedException", "PSAvoidUsingEmptyCatchBlock", "CA1031", "RCS1075"] };
pub static BARE_EXCEPT: Rule = Rule { id: "bare-except", severity: Warning, summary: "except sem tipo captura até KeyboardInterrupt e SystemExit", equivalents: &["E722", "W0702", "bare-except", "PLW0702"] };
pub static DUP_KEY: Rule = Rule { id: "duplicate-key", severity: Warning, summary: "Chave repetida no mesmo literal de objeto/dicionário", equivalents: &["no-dupe-keys", "F601", "W0109", "duplicate-key", "Lint/DuplicateHashKey", "DuplicateHashKey", "W314"] };
pub static DEBUGGER: Rule = Rule { id: "debugger", severity: Warning, summary: "Comando de depuração esquecido no código", equivalents: &["no-debugger", "T100", "dbg_macro", "forgotten-debug-statement", "W1515", "Lint/Debugger"] };
pub static FOCUSED_TEST: Rule = Rule { id: "focused-test", severity: Warning, summary: "Teste focado (.only, fit, fdescribe): a suíte roda só ele e pula os outros", equivalents: &["no-focused-tests", "no-focused-test", "no-exclusive-tests", "no-only-tests", "RSpec/Focus", "Focus"] };
pub static UNUSED_VAR: Rule = Rule { id: "unused-variable", severity: Warning, summary: "Variável local declarada e nunca usada", equivalents: &["no-unused-vars", "F841", "W0612", "unused-variable", "unused_variables", "UNUSED_VARIABLE", "UnusedPrivateProperty", "UselessAssignment", "Lint/UselessAssignment", "CS0168", "CS0219", "IDE0059", "IDE0051", "UnusedLocalVariable", "unused-local", "W211", "PSUseDeclaredVarsMoreThanAssignments", "clang-diagnostic-unused-variable", "ineffassign", "unusedvariable"] };
pub static UNUSED_IMPORT: Rule = Rule { id: "unused-import", severity: Warning, summary: "Import que o arquivo não usa", equivalents: &["no-unused-vars", "F401", "W0611", "unused-import", "unused_imports", "UnusedImports", "UnusedImport", "UNUSED_IMPORT", "IDE0005", "CS8019", "UnnecessaryImport"] };
pub static LONG_FUNCTION: Rule = Rule { id: "long-function", severity: Info, summary: "Função com mais de 200 linhas", equivalents: &["max-lines-per-function", "too_many_lines", "R0915", "too-many-statements", "PLR0915", "LongMethod", "Metrics/MethodLength", "MethodLength", "funlen", "readability-function-size", "ExcessiveMethodLength", "NcssCount"] };
pub static TOO_MANY_PARAMS: Rule = Rule { id: "too-many-params", severity: Info, summary: "Função com mais de 7 parâmetros", equivalents: &["max-params", "R0913", "PLR0913", "too-many-arguments", "too_many_arguments", "LongParameterList", "Metrics/ParameterLists", "ParameterLists", "ExcessiveParameterList", "ParameterNumber"] };
pub static COMPLEXITY: Rule = Rule { id: "complexity", severity: Info, summary: "Complexidade ciclomática acima de 25", equivalents: &["complexity", "C901", "R0912", "too-many-branches", "PLR0912", "cognitive_complexity", "CyclomaticComplexMethod", "ComplexMethod", "Metrics/CyclomaticComplexity", "CyclomaticComplexity", "gocyclo", "cyclop", "gocognit", "readability-function-cognitive-complexity", "CognitiveComplexity", "NPathComplexity"] };
pub static DEEP_NESTING: Rule = Rule { id: "deep-nesting", severity: Info, summary: "Mais de 5 níveis de if/laço/try aninhados", equivalents: &["max-depth", "R1702", "too-many-nested-blocks", "PLR1702", "NestedBlockDepth", "nestif", "Metrics/BlockNesting", "BlockNesting", "AvoidDeeplyNestedIfStmts"] };

pub static ALL: &[&Rule] = &[
    &SYNTAX, &UNREACHABLE, &SELF_ASSIGN, &SELF_COMPARE, &DUP_CONDITION, &IDENTICAL_BRANCHES, &CONSTANT_CONDITION, &EMPTY_BLOCK,
    &EMPTY_CATCH, &BARE_EXCEPT, &DUP_KEY, &DEBUGGER, &FOCUSED_TEST, &UNUSED_VAR, &UNUSED_IMPORT, &LONG_FUNCTION, &TOO_MANY_PARAMS, &COMPLEXITY, &DEEP_NESTING,
];

pub fn by_id(id: &str) -> Option<&'static Rule> { ALL.iter().copied().find(|r| r.id == id) }

pub const MAX_LINES: usize = 200;
pub const MAX_PARAMS: usize = 7;
pub const MAX_COMPLEXITY: u32 = 25;
pub const MAX_DEPTH: u32 = 5;
