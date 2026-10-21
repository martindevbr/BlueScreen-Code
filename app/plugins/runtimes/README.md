# Runtimes e execução

Plugin oficial do BlueScreen. Faz duas coisas.

## O que cada linguagem precisa instalado

Ao abrir um arquivo, o plugin confere se o runtime ou o compilador da linguagem está no PC e se atende à versão que o projeto pede. Se faltar, aparece um aviso no canto do editor com estas opções:

- **Baixar** pela própria IDE, na versão pedida: JDK, Node.js, Python, Go, .NET, Rust, Kotlin, Maven, Gradle e Zig. O Zig também compila C e C++. Não precisa de instalador nem de administrador.
- **Outras versões…**: abre a janela SDKs (fornecedor e versão).
- **Já tenho instalado…**: você aponta a pasta de uma instalação. Para JDK, Node, Python, Go, .NET, Kotlin, Maven e Gradle, ela vira o padrão da IDE (o JDK vira o `JAVA_HOME` e o JDK do build). Os outros runtimes entram no PATH do terminal, do build e dos servidores de linguagem.
- **winget** / **scoop**: o comando de instalação roda no terminal da IDE. Depois, clique em **Verificar de novo**.
- **Página oficial**.

A versão pedida vem dos arquivos que as próprias ferramentas usam. O arquivo mais perto do arquivo aberto vale.

| Runtime | Onde lê |
|---|---|
| Java | `pom.xml` (`maven.compiler.release`/`source`, `java.version`, `<release>`), `build.gradle(.kts)` (toolchain, `jvmToolchain`, `sourceCompatibility`), `.java-version`, `.sdkmanrc`, `.tool-versions` |
| Node.js | `.nvmrc`, `.node-version`, `engines.node` do `package.json` |
| Python | `.python-version`, `requires-python` do `pyproject.toml`, `runtime.txt`, `Pipfile` |
| Go | `go.mod` (`go`, `toolchain`) |
| Rust | `rust-toolchain(.toml)`, `rust-version` do `Cargo.toml` |
| .NET | `global.json`, `<TargetFramework>` do `.csproj` |
| Ruby, PHP, Dart | `.ruby-version`/`Gemfile`, `require.php` do `composer.json`, `environment.sdk` do `pubspec.yaml` |

Linguagens cobertas: Java, Kotlin, Scala, Groovy, Clojure, Python, JavaScript, TypeScript, Go, Rust, C#, F#, VB, C, C++, Zig, Ruby, PHP, Perl, Lua, R, Julia, Dart, Swift, Elixir, Erlang, Haskell, Nim, OCaml, D, Shell e LaTeX. Arquivo de projeto Maven ou Gradle também pede o Maven ou o Gradle; o `mvnw` ou o `gradlew` do projeto já resolve.

O python.exe da Microsoft Store (o atalho em `WindowsApps` que só abre a loja) não conta como Python.

A janela **Runtimes do projeto** (clique na status bar, `Shift` `Shift` › "Runtimes do projeto…" ou o resumo do projeto) mostra cada linguagem do projeto, o que ela precisa e onde está. Nela também se troca o JDK padrão.

## Executar os mains, como no IntelliJ

Um ▶ verde aparece na margem de cada ponto de entrada. Clique nele para executar, executar com argumentos (ficam guardados), depurar (Python, Go, Rust, C, C++ e C#) ou copiar o comando. `Ctrl+Shift+F10` executa o main mais perto do cursor.

| Linguagem | Ponto de entrada | Como roda |
|---|---|---|
| Java | `public static void main`, classe aninhada (`Externa$Interna`), `void main()` do Java 21+/25 | projeto Maven: `exec:java` (teste com o escopo test); Gradle: tarefa `bsRun` por um init script, sem mexer no build; solto: `javac -sourcepath` na raiz dos pacotes + `java -cp`, com os jars de `lib/`/`libs/` |
| Kotlin | `fun main` (`ArquivoKt`, `@file:JvmName`), `@JvmStatic` em `object`/`companion` | Maven/Gradle como no Java; solto: `kotlinc` + `java` |
| Scala, Groovy, Clojure | `@main`, `object X extends App`, `def main`; `static void main`/script; `-main` | `sbt runMain`, `scala-cli`; `groovy`; `clojure -M -m` / `lein run -m` |
| Python | `if __name__ == "__main__":` | o `.venv` do projeto (ou `uv run`/`poetry run`); dentro de pacotes, `python -m pacote.modulo` |
| C#, F#, VB | `static void/int/Task Main`, `[<EntryPoint>]`, `Sub Main` | `dotnet run --project` (com `StartupObject` quando há vários mains); `.cs` solto: `dotnet run arquivo.cs` |
| Go | `func main` em `package main` | `go run .` no pacote (`//go:build ignore`: só o arquivo) |
| Rust | `fn main` | `cargo run` com `--bin`/`--example` certos; fora de um crate, `rustc` |
| C, C++ | `int main` | gcc, clang ou `zig cc`, com os `.c`/`.cpp` vizinhos que não têm main |
| JS, TS, Ruby, Dart, Zig, Nim, Julia, Haskell, Swift, Elixir, D | `require.main === module`, `import.meta.main`, `if __FILE__ == $0`, `main()`... | `node`, tsx/deno/bun, `bundle exec ruby`, `dart run`, `zig build run`/`zig run`... |

A saída vai para o console do Build: erros clicáveis, parar, repetir (`Ctrl+F9`) e uma linha para digitar a entrada do programa (`Scanner`, `input()`). Antes de executar, o plugin confere os requisitos; se faltar algo, a janela de instalação abre e depois executa.

## Rotas

| Rota | |
|---|---|
| `runtimes/check?project=&file=` | requisitos da linguagem do arquivo e o estado de cada um |
| `runtimes/project?project=` | linguagens do projeto (contadas pelos arquivos) e os requisitos |
| `runtimes/entries` POST `{ file, text }` | pontos de entrada do texto |
| `runtimes/plan` POST `{ project, file, line, args }` | `{ plan: { title, how, steps, jdk } }`, `{ missing }` ou `{ fallback }` |
| `runtimes/select` POST `{ tool, path }` | aponta uma instalação existente |
| `runtimes/forget` | esquece o que já foi procurado (depois de instalar por fora) |

Testes: `cargo test -p bluescreen-runtimes`.
