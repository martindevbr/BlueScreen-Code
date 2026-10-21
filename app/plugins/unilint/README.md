# Linter Universal (`unilint`)

Lint embutido para 16 linguagens, sem baixar nenhum linter: as gramáticas Tree-sitter vêm compiladas no `server.exe`.

Ligado, o plugin atende o gancho `lint` do núcleo. Desligado (aba **Plugins**, `Alt+7`), o BlueScreen volta ao lint de sempre: javac, pyflakes, node --check, eslint e os servidores de linguagem que ele oferece para instalar.

| | |
|---|---|
| Linguagens | Python, JavaScript, TypeScript, TSX, Java, Rust, Go, C, C++, C#, Kotlin, PHP, Ruby, Lua, Bash, PowerShell |
| Recusa (o núcleo segue o lint de sempre) | outras extensões; arquivos acima de 4 MB; JS/TS em projeto com ESLint configurado (as regras do time valem mais) |
| Página | ação **Linter Universal: analisar o projeto inteiro** (`Shift` `Shift`) e item no menu do projeto; o aviso "Análise de código não instalada" não insiste nas linguagens acima |

## Regras

`unilint --rules` lista todas. Cada regra é escrita uma vez sobre conceitos (função, if, laço, catch, salto, atribuição) e vale para todas as linguagens mapeadas.

| Regra | | Equivalente em |
|---|---|---|
| `syntax` | erro de sintaxe (no Kotlin, aviso: a gramática anda atrás da linguagem) | E999 |
| `unreachable` | código depois de return / throw / break / continue | no-unreachable, W0101 |
| `unused-import` | import não usado (Python, JS/TS, Java, Kotlin) | F401, no-unused-vars |
| `unused-variable` | variável local que recebe valor e nunca é usada | F841, no-unused-vars, unused_variables |
| `self-assign` / `self-compare` | `x = x`, `x == x`, `a && a` | no-self-assign, no-self-compare, eq_op |
| `duplicate-condition` | condição repetida na cadeia if / else if | no-dupe-else-if, ifs_same_cond |
| `identical-branches` | if e else (ou `? :`) iguais | if_same_then_else |
| `constant-condition` | `if (true)` (não no Go/C/C++/Rust, onde `if false` é o interruptor de depuração) | no-constant-condition |
| `empty-catch` / `bare-except` | catch vazio, `except:` sem tipo, `except Exception: pass` | no-empty, E722, S110 |
| `empty-block` | if vazio sem else | no-empty |
| `duplicate-key` | chave repetida em objeto JS, dict Python, hash Ruby, tabela Lua | no-dupe-keys, F601 |
| `debugger` | `debugger`, `breakpoint()`, `dbg!`, `var_dump` | no-debugger, T100, dbg_macro |
| `focused-test` | teste focado esquecido: `it.only`, `test.only`, `describe.only`, `fit`, `fdescribe` (Jest, Mocha, Vitest, Cypress, Playwright) e `fit`, `fcontext` (RSpec); a correção tira o foco | jest/no-focused-tests, mocha/no-exclusive-tests, RSpec/Focus |
| `long-function`, `too-many-params`, `complexity`, `deep-nesting` | métricas (info): 200 linhas, 7 parâmetros, complexidade 25, 5 níveis | max-lines-per-function, max-params, C901, max-depth |

### Supressão

Funciona como em cada linter original, com os nomes de regra do unilint ou de qualquer ferramenta equivalente (coluna acima; também `F401`, `UNUSED_VARIABLE`, `Lint/UselessAssignment`, `IDE0059`, `clippy::eq_op`, `PMD.EmptyCatchBlock`) e os grupos `all`, `warnings`, `unused` e `clippy::<grupo>`:

| | |
|---|---|
| Linha / próxima linha | `unilint-disable-line`, `unilint-disable-next-line`, `# noqa: F401`, `// eslint-disable-line`, `eslint-disable-next-line`, `NOLINT`, `NOLINTNEXTLINE`, `biome-ignore`, `@phpstan-ignore-next-line`, `phpcs:ignore`, `---@diagnostic disable-next-line`, `ReSharper disable once`, `cppcheck-suppress`, `pylint: disable-next=` |
| Intervalo | `unilint-disable` … `unilint-enable`, `/* eslint-disable */` … `/* eslint-enable */`, `NOLINTBEGIN` … `NOLINTEND`, `rubocop:disable` … `rubocop:enable`, `phpcs:disable` … `enable`, `biome-ignore-start` … `end`, `#pragma warning disable` … `restore` (C#) |
| Escopo | `# pylint: disable=` sozinho na linha vale até o fim da função; `//nolint` sozinho na linha vale para a declaração seguinte inteira (golangci); `# shellcheck disable=` antes do primeiro comando vale para o script |
| Arquivo | `unilint-disable-file`, `# ruff: noqa`, `# flake8: noqa`, `biome-ignore-all`, `phpcs:ignoreFile`, `@file:Suppress(...)` (Kotlin), `#![allow(...)]` no topo (Rust) |
| Atributos e anotações | `#[allow(...)]` / `#[expect(...)]` (Rust), `@SuppressWarnings` (Java), `@Suppress` (Kotlin), `[SuppressMessage]` (C#): valem para o item anotado inteiro; `[[maybe_unused]]` e `__attribute__((unused))` (C/C++) |

Comentário não conta como uso de nome (`let x = 1; // x` continua sendo variável não usada, como no rustc e no pyflakes); documentação conta para imports (`{@link X}` no javadoc, `# type: X` no Python), e strings contam (`format!("{x}")`).

## Desempenho

Um parse e uma passada por arquivo: a tabela de conceitos é indexada pelo id do tipo de nó (despacho O(1)), os ancestrais vêm da pilha do próprio percurso (o `Node::parent()` do Tree-sitter desce da raiz) e os arquivos rodam em paralelo, os maiores primeiro. O mimalloc atende o Rust e o Tree-sitter.

Na IDE, o lint de um arquivo leva ~2 ms de ponta a ponta (antes: ~600 ms com py_compile, ~650 ms com javac, ~80 ms com node --check).

Linha de comando, mesma máquina (12 threads), melhor de 5, contando o início do processo (~50 ms no Windows):

| Código | unilint | original |
|---|---|---|
| Python, pylint + astroid (68 mil linhas) | **111 ms** | ruff 115 ms · pyflakes 1305 ms · flake8 1546 ms · pylint 19172 ms |
| JavaScript, eslint/lib (92 mil linhas) | **95 ms** | eslint 1885 ms |

## Código

| | |
|---|---|
| `src/spec.rs` | mapeamento de cada gramática para os conceitos; uma linguagem nova é uma `Spec` + a gramática em `lang.rs` |
| `src/engine.rs` | percurso, regras e escopo |
| `src/suppress.rs` | supressão central |
| `src/rules.rs` | catálogo e limites das métricas |
| `src/bin/server.rs` | servidor do plugin (`unilint/lint`, `unilint/project`, `unilint/rules`) |
| `src/bin/cli.rs` | `cargo run -p bluescreen-unilint --release --bin unilint -- <pastas> [--stats] [--json] [--rules]` |

`cargo test -p bluescreen-unilint --lib` confere que todo tipo de nó mapeado existe na gramática e cobre as regras em todas as linguagens, incluindo os falsos positivos achados rodando em código real (eslint, oxc, pylint, astroid, pmd, detekt, gotools).
