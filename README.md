<p align="center"><img src="assets/bluescreen.png" width="104" alt=""></p>

<h1 align="center">BlueScreen</h1>

<p align="center">
Uma IDE leve para Windows, com a cara e os atalhos do IntelliJ.<br>
Abre em menos de meio segundo, ocupa 25 MB e conversa com as ferramentas oficiais de cada linguagem.
</p>

<p align="center"><img src="docs/img/preview-markdown.png" alt="BlueScreen com um README aberto e a visualização ao lado" width="900"></p>

## O que é

O BlueScreen nasceu para **ler, revisar, ajustar, rodar e depurar código** sem esperar uma IDE pesada abrir. O núcleo é em Rust e a janela é nativa (WebView2); o editor é o Monaco, o mesmo do VS Code.

Ele não reimplementa cada linguagem. Para análise, refatoração e depuração, usa as ferramentas oficiais que você já instala no PC (rust-analyzer, gopls, pyright, clangd, jdtls, debugpy, Delve...), pelos mesmos protocolos do VS Code (LSP e DAP). Assim, cada linguagem fica tão boa quanto a ferramenta dela.

O nome vem da tela azul do Windows. No ícone, em vez do `:(` do erro, ela pisca de volta: `;)`.

## Destaques

- **Projetos Git e SVN** com alterações, diff lado a lado, histórico e marcas na margem do editor.
- **Análise e refatoração** de qualquer linguagem com servidor LSP: renomear em todos os arquivos, ir para a definição, usos, ações rápidas, erros enquanto digita.
- **Depurador** com breakpoints (inclusive com condição), passo a passo, pilha, variáveis e console.
- **Terminal** com PowerShell, cmd, Git Bash, WSL, prompts do Visual Studio e perfis do Windows Terminal.
- **Visualização ao vivo** de Markdown e HTML ao lado do código.
- **Build reconhecido sozinho** para Maven, Gradle, npm, Cargo, .NET, CMake e mais de 60 ferramentas.
- **Buscar em tudo** com `Shift` duas vezes, como no IntelliJ.
- **Abrir pelo celular** ou outro PC da rede local, com PIN.
- **Plugins** em JavaScript (interface) e, se precisar, um servidor próprio em qualquer linguagem.

<table>
<tr>
<td width="50%"><img src="docs/img/boas-vindas.png" alt="Tela de boas-vindas"><br><sub>Sem projeto aberto, a tela de boas-vindas leva de volta ao último projeto, com o que ficou pendente.</sub></td>
<td width="50%"><img src="docs/img/depurador.png" alt="Depurador pausado num breakpoint"><br><sub>Depurador pausado: linha atual, frames da pilha e variáveis.</sub></td>
</tr>
<tr>
<td><img src="docs/img/analise.png" alt="Documentação da função vinda do servidor de linguagem"><br><sub>Tipos e documentação vindos do servidor da linguagem (aqui, o Pyright).</sub></td>
<td><img src="docs/img/terminal.png" alt="Terminal integrado"><br><sub>Terminal na pasta do projeto, com abas e o shell que você escolher.</sub></td>
</tr>
</table>

## Instalar

Precisa de Windows 10 ou 11, 64 bits, com o [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/), que já vem no Windows 11.

Baixe a última versão na página de releases do repositório, extraia e rode `BlueScreen.exe`. Não há instalador nem configuração: a pasta de projetos padrão é a pasta acima do programa, e dá para trocar na tela de boas-vindas.

```
BlueScreen.exe C:\meus\projetos    # outra pasta de projetos
BlueScreen.exe --lan               # já liga o acesso pela rede local
BlueScreen.exe --web               # abre no navegador em vez da janela
```

## Primeiros passos

| | |
|---|---|
| `Shift` `Shift` | buscar classes, arquivos, texto e ações |
| `Ctrl+B` / `Ctrl`+clique | ir para a definição |
| `Shift+F6` | renomear em todos os arquivos |
| `Alt+Enter` | ações rápidas e refatorações |
| `Alt+F7` | encontrar usos |
| `Shift+F9` | depurar o arquivo aberto (`F8` passa, `F7` entra, `F9` continua) |
| `Ctrl+F8` | marcar breakpoint (ou clique na margem) |
| `Alt+F12` | terminal |
| `Ctrl+Shift+V` | visualização de Markdown e HTML ao lado |
| `Alt+2` | alterações locais |
| `F1` | todos os atalhos |

## Linguagens

O BlueScreen procura as ferramentas no `PATH` ao abrir o primeiro arquivo de cada linguagem. O item da status bar mostra qual está em uso; sem nenhuma, ele oferece instalar pelo terminal.

| Linguagem | Análise e refatoração | Depuração |
|---|---|---|
| Python | `npm i -g pyright` ou `pip install basedpyright` | `pip install debugpy` |
| Rust | `rustup component add rust-analyzer` | `winget install LLVM.LLVM` (lldb-dap) |
| Go | `go install golang.org/x/tools/gopls@latest` | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| C e C++ | `winget install LLVM.LLVM` (clangd) | lldb-dap ou CodeLLDB |
| C# | `dotnet tool install -g csharp-ls` | `scoop install netcoredbg` |
| Java | Eclipse JDT LS (`jdtls`) | ainda não |
| JavaScript e TypeScript | `npm i -g typescript typescript-language-server` | ainda não |
| PHP, Ruby, Lua, Kotlin, Dart, Zig | Intelephense, Ruby LSP, LuaLS, Kotlin LS, Dart, ZLS | ainda não |
| HTML, CSS, JSON, YAML, XML, Bash | `vscode-langservers-extracted`, `yaml-language-server`, LemMinX, `bash-language-server` | não se aplica |

Sem servidor instalado, o editor continua com cores, completar por palavras, lint embutido e, para JavaScript e TypeScript, a análise do próprio Monaco. Para usar outra ferramenta ou outro caminho, liste em `~/.bluescreen/tools.json`:

```json
[{ "id": "meu-ls", "kind": "lsp", "name": "Meu servidor", "langs": ["python"], "command": "C:\\ferramentas\\meu-ls.exe", "args": ["--stdio"] }]
```

## Comparativo

Medido numa máquina com Ryzen 5 5600GT, 32 GB e Windows 11, em outubro de 2026. Cada IDE foi aberta na tela inicial e medida depois de 15 a 30 s parada, somando todos os processos dela.

| | BlueScreen 2.0 | WebStorm 2026.1.3 | Visual Studio Community 2026 |
|---|---|---|---|
| Instalação em disco | **25 MB** | 2,9 GB | 4,2 GB (só a pasta de instalação) |
| Memória privada, ociosa | **238 MB** | 744 a 763 MB | 498 a 512 MB |
| Primeira janela, a frio | **0,4 s** | 5,6 s (splash) | 0,8 s (splash) |

A memória do BlueScreen inclui o WebView2 e os servidores de dois plugins. O runtime do WebView2 já vem com o Windows 11 e não entra na conta da instalação. Requisitos oficiais de outras: IntelliJ IDEA pede 8 GB de RAM e 10 GB de disco ([guia](https://www.jetbrains.com/help/idea/installation-guide.html)); VS Code pede 1 GB de RAM e menos de 500 MB de disco ([requisitos](https://code.visualstudio.com/docs/supporting/requirements)).

| Pronto para usar, sem extensões | BlueScreen | IntelliJ / WebStorm | VS Code | Visual Studio |
|---|---|---|---|---|
| Visualização de Markdown lado a lado | ✅ | ✅ | ✅ | ✅ |
| Visualização de HTML ao vivo | ✅ | ✅ | extensão | abre no navegador |
| Terminal com vários shells | ✅ | ✅ | ✅ | ✅ |
| Git / SVN | ✅ / ✅ | ✅ / plugin | ✅ / extensão | ✅ / extensão |
| Build reconhecido sozinho | ✅ (60+ ferramentas) | Maven, Gradle, npm e outros | tarefas ou extensões | MSBuild, CMake |
| Refatoração e análise semântica | ✅ pelo servidor da linguagem | ✅ próprio | por extensão | ✅ próprio |
| Depurador | ✅ pelo depurador da linguagem | ✅ | por extensão | ✅ |
| Abrir pelo celular, com PIN | ✅ | Code With Me (conta) | Remote Tunnels (conta) | não |

A análise própria do IntelliJ e do Visual Studio ainda vai mais fundo em Java e .NET (inspeções, refatorações estruturais). O BlueScreen fica com o que o servidor oficial de cada linguagem oferece.

## Recursos em detalhe

<details>
<summary><b>Projetos, árvore e alterações</b></summary>

- A pasta de projetos lista cada subpasta, com Git ou SVN, branch, alterações locais e idade do último commit. Projetos de fora entram pelos recentes.
- A árvore segue o Project View do IntelliJ: módulos (`pom.xml`, `build.gradle`, `.project`) em negrito, source roots coloridos, pacotes Java compactados (`br.com.empresa.app`), classes com ícone de tipo (classe, interface, enum, anotação, abstrata).
- Nomes coloridos pelas alterações, contador por pasta e bolinha de "não salvo" na aba, na árvore e na status bar.
- **Alterações** (`Alt+2`): o que não foi commitado, ou os arquivos de qualquer commit do Histórico. Diff lado a lado ou em linha, editável, com navegação entre trechos (`Alt+↓` / `Alt+↑`).
- Sem abas abertas, o editor mostra o README do projeto renderizado, ou uma visão geral com linguagens e sistemas de build.
</details>

<details>
<summary><b>Análise, refatoração e depuração</b></summary>

- Cada servidor de linguagem sobe no primeiro arquivo da linguagem, um por projeto, e fecha junto com o BlueScreen.
- Renomear altera os arquivos abertos no editor (que ficam por salvar) e salva os outros direto no disco.
- `Alt+Enter` traz as correções e refatorações do servidor (extrair, organizar imports, implementar métodos...).
- O depurador lembra os breakpoints por projeto, acompanha as linhas quando o código muda e aceita condição (botão direito na margem).
- Pausado, passar o mouse sobre uma variável mostra o valor; o console avalia expressões no frame escolhido.
- Para C, C++, Rust e .NET, o BlueScreen pergunta qual executável depurar e lembra a resposta.
</details>

<details>
<summary><b>Buscar em tudo</b></summary>

`Shift` duas vezes, até com o foco no editor. Abas Tudo, Classes, Arquivos, Texto e Ações. Aceita CamelHumps (`PaCo` acha `ParcelasController`), `pacote.Classe`, `pasta/arquivo` e `Nome:linha`. A busca de texto percorre o projeto em paralelo, com opção de maiúsculas e regex. Atalhos diretos: `Ctrl+N` classes, `Ctrl+Shift+N` arquivos, `Ctrl+Shift+F` texto, `Ctrl+Shift+A` ações.
</details>

<details>
<summary><b>Build e executar arquivo</b></summary>

O painel Build (`Alt+6`) reconhece os arquivos de build da pasta e das subpastas e agrupa as tarefas por sistema, usando o wrapper do projeto quando existe.

- **JVM:** Maven (pom agregador, escolha de Maven, JDK e repositório), Gradle, Ant, sbt, Mill, Leiningen.
- **JavaScript:** npm, Yarn, pnpm, Bun, Deno, Nx, Turbo.
- **Outras:** Cargo, Go, .NET, Python (uv, Poetry, PDM, Hatch, Pipenv, Conda, pip, tox), Swift, Elixir, Erlang, Haskell, OCaml, Zig, Crystal, Julia, R, Elm, PHP.
- **C/C++ e geradores:** CMake (com presets), Meson, Ninja, Make, xmake, SCons, Premake, vcpkg, Conan, Bazel, Buck2, Pants.
- **Tarefas e infraestrutura:** just, Taskfile, Rake, Docker, Docker Compose, Terraform, Helm, MkDocs, Hugo, LaTeX.

`Ctrl+Shift+F10` executa o arquivo aberto pela linguagem dele. O console mostra a saída ao vivo, com erros clicáveis e um resumo do que falhou.
</details>

<details>
<summary><b>Lint embutido</b></summary>

`Ctrl+Alt+L` ou ao salvar, sem instalar nada: Java (`javac` com o classpath do projeto), JS/TS (ESLint quando configurado), HTML/JSP, XML e derivados, CSS/SCSS/Less, JSON, properties, YAML, SQL, Markdown, PowerShell, Bash e Python. Em qualquer arquivo de texto: bytes nulos, fins de linha misturados e marcadores de conflito. O ícone ✓ do painel Alterações roda o lint em todos os arquivos modificados.
</details>

<details>
<summary><b>Terminal</b></summary>

Cada aba é um shell de verdade num pseudoconsole do Windows (ConPTY), com cores e programas de tela cheia. Encontra sozinho PowerShell 7, Windows PowerShell, cmd, Git Bash, WSL, MSYS2, Cygwin, Nushell, os prompts de desenvolvedor do Visual Studio e os perfis do Windows Terminal. `caminho:linha` na saída vira link para o arquivo. Os atalhos da IDE não roubam as teclas do shell.
</details>

<details>
<summary><b>Visualização de Markdown e HTML</b></summary>

Três modos no canto do editor, lembrados por tipo de arquivo: só editor, editor e visualização, só visualização. O Markdown é refeito só no bloco editado e rola junto com o código. O HTML roda isolado, com o texto ainda não salvo, e carrega CSS, imagens e scripts relativos do projeto.
</details>

<details>
<summary><b>Rede local e aparência</b></summary>

- O ícone de wifi liga um segundo endereço (`http://<ip-do-pc>:4748`) protegido por PIN, para abrir no celular ou em outro PC. Build, terminal, depurador e plugins só respondem no próprio PC.
- `Ctrl+Alt+S` abre a Aparência: dez temas prontos e tudo editável ao vivo (cores da interface e do código, fontes, tamanhos, cantos). Temas exportam e importam em JSON.
</details>

## Compilar

Precisa do Rust (toolchain stable MSVC) e do Visual Studio Build Tools com C++. Na pasta `app`:

```
cargo build --workspace; cargo run -- C:\meus\projetos   # desenvolvimento
powershell -File build.ps1                               # versão final em app\dist\BlueScreen
powershell -File build.ps1 -Plugin <id>                  # só um plugin
```

## Arquitetura

```
BlueScreen.exe  (Rust: axum + tokio)
 ├─ janela nativa (tao + wry/WebView2) ── interface em app/wwwroot (Monaco, xterm.js)
 ├─ API local /api/*: projetos, árvore, Git/SVN, busca, lint, build
 ├─ WebSocket: terminal (ConPTY), servidores de linguagem (LSP) e depuradores (DAP)
 └─ plugins: ui.js na página + server.exe opcional, cada um seu processo
```

| Pasta | O que tem |
|---|---|
| `app/src` | o núcleo: `server.rs` (rotas), `workspace.rs` (árvore e busca), `terminal.rs`, `rpc.rs` (LSP e DAP), `lint.rs`, `desktop.rs` (janela), `build/`, `plugins/` |
| `app/sdk` | base comum do núcleo e dos plugins: processos, Git/SVN, servidor de plugin |
| `app/wwwroot` | a interface: `app.js`, `lsp.js`, `debug.js`, `terminal.js`, `preview.js`, `build.js`, `theme.js` |
| `app/plugins` | plugins que vêm junto, cada um com o próprio README |
| `assets` | o ícone (SVG, PNG e ICO) |

## Plugins

Plugins acrescentam painéis, atalhos, ações, cards e tarefas de build, e podem ter um servidor próprio em qualquer linguagem. Ligam e desligam na aba Plugins (`Alt+7`), sem recompilar nada. Como escrever um: [docs/PLUGINS.md](docs/PLUGINS.md).

## Contribuir

Correções, ideias e plugins são bem-vindos. Veja [CONTRIBUTING.md](CONTRIBUTING.md) para rodar em modo de desenvolvimento e o que conferir antes de abrir um pull request.

## Créditos

O BlueScreen usa [Monaco Editor](https://github.com/microsoft/monaco-editor) e [xterm.js](https://github.com/xtermjs/xterm.js) (MIT), [marked](https://github.com/markedjs/marked) (MIT), [DOMPurify](https://github.com/cure53/DOMPurify) (Apache 2.0 / MPL 2.0), as fontes [IBM Plex Sans](https://github.com/IBM/plex) e [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (OFL), e no núcleo [axum](https://github.com/tokio-rs/axum), [tokio](https://tokio.rs), [wry e tao](https://github.com/tauri-apps) e [portable-pty](https://github.com/wezterm/wezterm). As licenças de cada um ficam junto dos arquivos em `app/wwwroot/vendor`.

## Licença

A definir.
