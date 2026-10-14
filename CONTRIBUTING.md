# Contribuindo com o BlueScreen

Obrigado pelo interesse. Correções, melhorias de usabilidade, suporte a mais linguagens e plugins são bem-vindos.

## Rodando em modo de desenvolvimento

Precisa do Rust (`rustup`, toolchain stable MSVC) e do Visual Studio Build Tools com C++.

```
cd app
cargo build --workspace
cargo run -- C:\uma\pasta\de\projetos --web     # abre no navegador, bom para usar o DevTools
cargo run -- C:\uma\pasta\de\projetos           # na janela; --devtools libera o Inspecionar
```

A interface (`app/wwwroot`) não passa por build: edite o `.js` ou o `.css` e recarregue a página (`F5` recarrega o projeto; `Ctrl+R` no navegador recarrega a página). Só mudanças em `app/src` pedem `cargo build`.

Use outra porta para não brigar com um BlueScreen aberto: `BLUESCREEN_PORT=4790`.

## Onde mexer

| Quero mudar... | Arquivo |
|---|---|
| rotas, rede local, preview de HTML | `app/src/server.rs` |
| árvore, índice e busca | `app/src/workspace.rs` |
| terminal (ConPTY) | `app/src/terminal.rs` e `app/wwwroot/terminal.js` |
| servidores de linguagem e depuradores conhecidos | `app/src/rpc.rs` (lista `DEFS`) |
| análise e refatoração no editor | `app/wwwroot/lsp.js` |
| depurador | `app/wwwroot/debug.js` |
| janela, tela de boas-vindas | `app/src/desktop.rs` e `app/wwwroot/app.js` |
| build | `app/src/build/` e `app/wwwroot/build.js` |

Para suportar uma linguagem nova, quase sempre basta acrescentar o servidor (ou o depurador) em `DEFS` no `rpc.rs`, com o comando, os argumentos e como instalar. Depuradores precisam também da configuração de "depurar este arquivo" em `launchArgs` no `debug.js`.

## Antes de abrir um pull request

- `cargo build --workspace` sem erros nem avisos novos.
- `node --check` nos `.js` que você mudou.
- Teste o que mudou no aplicativo de verdade, no tema escuro e no claro.
- Siga o estilo do código ao redor: comentários curtos em português explicando o porquê, nomes no mesmo padrão.
- Textos da interface em português, diretos, dizendo o que acontece ("Abrir com terminal", não "Prosseguir").
- Nada de dependências baixadas de CDN: o BlueScreen roda offline. Bibliotecas novas vão para `app/wwwroot/vendor` com a licença junto.

## Relatando um problema

Diga o que fez, o que esperava e o que aconteceu, com a versão do Windows e do BlueScreen. O log fica em `~/.bluescreen/bluescreen.log`.
