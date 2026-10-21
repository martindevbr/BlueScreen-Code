<p align="center"><img src="assets/bluescreen.png" width="96" alt=""></p>

<h1 align="center">BlueScreen</h1>

<p align="center">IDE leve para Windows: núcleo em Rust, editor Monaco, 25 MB instalada, abre em 0,4 s.</p>

<p align="center"><img src="docs/img/preview-markdown.png" alt="BlueScreen com um README aberto e a visualização ao lado" width="860"></p>

A análise e a depuração de cada linguagem vêm das ferramentas oficiais que você instala (rust-analyzer, pyright, gopls, clangd, debugpy...), pelos mesmos protocolos do VS Code (LSP e DAP).

## Instalar

Windows 10 ou 11, 64 bits, com o [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (já vem no Windows 11).

- **Setup:** baixe o `BlueScreen-Setup-X.Y.Z.exe` em [Releases](https://github.com/martindevbr/BlueScreen-IDE/releases/latest). Instala só para o seu usuário, sem administrador.
- **Zip:** baixe o `BlueScreen-X.Y.Z-windows-x64.zip`, extraia e rode `BlueScreen.exe`.
- **Do repositório:** dois cliques em `Instalar BlueScreen.cmd`. Ele baixa a última versão e confere o SHA-256; marque **Compilar a partir deste código** para instalar o que está na pasta.

A IDE instalada se atualiza sozinha ao abrir.

```
BlueScreen.exe C:\meus\projetos    # outra pasta de projetos
BlueScreen.exe --lan               # liga o acesso pela rede local (com PIN)
BlueScreen.exe --web               # abre no navegador em vez da janela
BlueScreen.exe --doc dados.xlsx    # só o documento, numa janela leve (.csv, .tsv, .xlsx)
```

## Atalhos

| Atalho | O que faz |
|---|---|
| `Shift` `Shift` | buscar classes, arquivos, texto e ações |
| `Ctrl+B` / `Ctrl`+clique | ir para a definição |
| `Alt+F7` | encontrar usos |
| `Shift+F6` | renomear em todos os arquivos |
| `Alt+Enter` | ações rápidas e refatorações |
| `Ctrl+Shift+F10` | executar o main mais perto do cursor (ou o arquivo aberto) |
| `Shift+F9` | depurar (`F8` passa, `F7` entra, `F9` continua) |
| `Ctrl+F8` | breakpoint (botão direito na margem: com condição) |
| `Ctrl+Alt+L` | lint do arquivo |
| `Alt+F12` | terminal |
| `Ctrl+Shift+V` | visualização de Markdown e HTML ao lado |
| `Alt+2` | alterações locais (diff, lint dos modificados) |
| `Alt+6` / `Alt+7` | Build / Plugins |
| `Ctrl+Alt+S` | aparência e temas |
| `F1` | todos os atalhos |

## Linguagens

Na primeira vez que você abre um arquivo de uma linguagem, a IDE procura o servidor dela no `PATH`. Se não achar, a status bar oferece instalar. Enquanto isso, o editor tem cores, completar por palavras e o lint embutido.

| Linguagem | Análise e refatoração | Depuração |
|---|---|---|
| Python | `npm i -g pyright` ou `pip install basedpyright` | `pip install debugpy` |
| Rust | `rustup component add rust-analyzer` | `winget install LLVM.LLVM` (lldb-dap) |
| Go | `go install golang.org/x/tools/gopls@latest` | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| C e C++ | `winget install LLVM.LLVM` (clangd) | lldb-dap ou CodeLLDB |
| C# | `dotnet tool install -g csharp-ls` | `scoop install netcoredbg` |
| Java | Eclipse JDT LS (`jdtls`) | — |
| JavaScript e TypeScript | `npm i -g typescript typescript-language-server` | — |
| HTML, CSS, JSON, YAML, XML, Bash | `vscode-langservers-extracted`, `yaml-language-server`, LemMinX, `bash-language-server` | — |

Também funcionam com os servidores de PHP, Ruby, Lua, Kotlin, Dart e Zig (Intelephense, Ruby LSP, LuaLS, Kotlin LS, Dart, ZLS).

Outra ferramenta ou outro caminho: liste em `~/.bluescreen/tools.json`.

```json
[{ "id": "meu-ls", "kind": "lsp", "name": "Meu servidor", "langs": ["python"], "command": "C:\\ferramentas\\meu-ls.exe", "args": ["--stdio"] }]
```

## O que vem pronto

- **Git e SVN:** alterações, diff lado a lado editável, histórico, marcas na margem.
- **Build:** o painel `Alt+6` reconhece Maven, Gradle, npm/Yarn/pnpm, Cargo, .NET, CMake, Go, Python (uv, Poetry...) e mais de 60 ferramentas, usando o wrapper do projeto (`mvnw`, `gradlew`).
- **Runtimes e executar o main:** ao abrir um arquivo, a IDE confere se o runtime da linguagem está instalado (JDK, Node.js, Python, Go, .NET, Rust, compilador C/C++, Ruby, PHP e mais 20) e se atende à versão que o projeto pede (`pom.xml`, `build.gradle`, `.nvmrc`, `go.mod`, `global.json`...). Se faltar, oferece baixar pela IDE, escolher outra versão, apontar uma pasta já instalada ou instalar com winget. Cada `main` (`public static void main`, `fun main`, `if __name__ == "__main__"`, `func main`, `fn main`, `static void Main`...) ganha um ▶ na margem, como no IntelliJ. Ele executa pelo Maven, Gradle, Cargo, dotnet ou direto, com entrada para o programa no console (plugin [`runtimes`](app/plugins/runtimes/README.md)).
- **Dependências:** se o `package.json`, o `requirements.txt`, o `.csproj` ou outro manifesto ainda não foi instalado, um aviso oferece o comando certo.
- **Lint sem instalar nada:** 16 linguagens por árvore sintática (plugin [`unilint`](app/plugins/unilint/README.md)) e linters de formato (JSON, YAML, XML, CSS, SQL, Dockerfile...).
- **BDD e testes automatizados:** `.feature` do Cucumber, Behave e SpecFlow com cores e lint ao vivo (estrutura que o parser do Cucumber cobra, tabelas, docstrings, tags, colunas dos Exemplos, cenários repetidos ou vazios; palavras-chave em inglês, português e espanhol pelo `# language:`). Nos testes, teste focado esquecido (`it.only`, `fit`, `fdescribe`, RSpec `fit`) vira aviso com correção.
- **Terminal:** PowerShell, cmd, Git Bash, WSL e os prompts do Visual Studio; `arquivo:linha` na saída abre o arquivo.
- **Arquivos gigantes:** logs e CSVs de vários GB abrem na hora, com busca no arquivo inteiro.
- **Planilhas:** `.csv` e `.xlsx` abrem numa tabela editável, com fórmulas e formatação (plugin [`sheets`](app/plugins/sheets/README.md)). No Windows, o BlueScreen aparece no **Abrir com** desses arquivos e abre só o documento, numa janela leve, sem mexer na IDE aberta (`BlueScreen.exe --doc arquivo.xlsx`). Para ser o programa padrão, marque "Sempre usar este aplicativo".
- **Mudanças feitas fora da IDE** (git pull, formatador, outro editor) entram na aba aberta; se você também mexeu, é feito merge de três vias.
- **Rede local:** o ícone de wifi abre `http://<ip-do-pc>:4748` com PIN, para usar pelo celular. Build, terminal, depurador e plugins só funcionam no próprio PC.

## Compilar

Rust stable (MSVC) e Visual Studio Build Tools com C++. Na pasta `app`:

```
cargo run -- C:\meus\projetos                      # desenvolvimento
powershell -File build.ps1                         # versão final em app\dist\BlueScreen
powershell -File build.ps1 -Plugin <id>            # só um plugin
powershell -File build.ps1 -Packages bluescreen    # só o núcleo
powershell -File build.ps1 -PluginServer           # só o servidor de plugins, em app\dist\PluginServer
```

A interface (`app/wwwroot`) não tem build: edite o `.js` ou `.css` e recarregue a página. Mudanças em `app/src` pedem `cargo build`.

| Pasta | Conteúdo |
|---|---|
| `app/src` | núcleo (rotas, árvore, busca, terminal, LSP/DAP, lint, build, plugins) |
| `app/sdk` | base comum do núcleo e dos plugins |
| `app/wwwroot` | interface |
| `app/plugins` | plugins que vêm junto |
| `app/plugin-server` | servidor de plugins para equipes |

Cada push na `main` que mexe no app gera um Release `vX.Y.Z`. `X.Y` vem do `app/Cargo.toml`. Para um push não gerar versão, ponha `[skip release]` na mensagem do commit.

## Plugins

Um plugin é uma pasta em `app/plugins/<id>` ou `~/.bluescreen/plugins/<id>` com `plugin.json`, `ui.js` e, se precisar, um servidor próprio em qualquer linguagem. Liga e desliga em `Alt+7`. Guia: [docs/PLUGINS.md](docs/PLUGINS.md).

Para distribuir plugins numa equipe, rode o [servidor de plugins](app/plugin-server/README.md) e adicione o endereço em **Plugins › Servidores de plugins**.

## Configurações

Em `~/.bluescreen/`: `tools.json` (ferramentas próprias), `plugins.json` (plugins ligados e servidores), `plugins/` (seus plugins) e `bluescreen.log`.

## Licença

Copyright (c) 2025-2026 Martin Hartfelder. Código aberto para leitura, uso e contribuições, mas **não é software livre**: copiar, redistribuir ou usar comercialmente exige autorização por escrito. Plugins próprios podem usar a licença que o autor quiser. Termos em [LICENSE](LICENSE); componentes de terceiros em [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Para contribuir, veja [CONTRIBUTING.md](CONTRIBUTING.md).
