# Escrevendo um plugin

Um plugin acrescenta coisas ao BlueScreen sem mexer no núcleo: painéis, atalhos, ações do Buscar em tudo, itens da status bar, cards do resumo do projeto, tarefas de build. Se precisar de lógica fora da página (falar com uma API, ler arquivos grandes, rodar ferramentas), ele traz um servidor próprio, que é um programa à parte em qualquer linguagem.

Plugins ligam e desligam na aba **Plugins** (`Alt+7`), sem recompilar o BlueScreen. Desligado, um plugin some por inteiro: painel, atalhos, status bar, card, marcas na árvore, ações, contribuições ao build, rotas da API e o processo do servidor. A escolha fica em `~/.bluescreen/plugins.json`.

## Onde ficam

- `app/plugins/<id>/`: os que vêm com o BlueScreen.
- `~/.bluescreen/plugins/<id>/`: os seus. Com o mesmo id, o seu ganha.

Cada pasta tem:

| Arquivo | |
|---|---|
| `plugin.json` | `{ "id", "name", "description", "version", "order", "icon": "icon.svg", "requires": ["outro-plugin"], "hooks": { "build.info": "meu/build-info" } }` |
| `icon.svg` ou `icon.png` (opcional) | o ícone na aba Plugins e no servidor de plugins: SVG, PNG, JPG ou WebP, até 64 KB, de preferência quadrado. Sem o campo `icon`, vale o `icon.svg`/`icon.png` da pasta; sem nenhum, a IDE desenha um com as iniciais do nome |
| `ui.js` (opcional) | roda na página dentro de `function (bs, plugin) { ... }` e enxerga tudo do núcleo (`S`, `api`, `$`, `esc`, `toast`, `store`, `I`, `TI`, `monaco`, `editor`, `openFile`, `openTool`...) |
| `style.css` (opcional) | injetado junto com o `ui.js` |
| `server.exe` (opcional) | o servidor do plugin, iniciado quando o plugin liga e encerrado quando desliga ou quando o BlueScreen fecha |
| `README.md` | o que o plugin faz e como configurar |

## Interface (`ui.js`)

O objeto `bs` (também em `window.BS`):

| | |
|---|---|
| `bs.tools.register({ id, title, icon, key: 'Alt+5', order, render() })` | painel na barra da esquerda, com atalho e badge `#badge-<id>`. Com `bottom: true` e `toggle(on)`, vira um painel embaixo do editor, como o Terminal |
| `bs.keys.add('Ctrl+F9', fn)` | tecla; devolver `false` deixa a tecla seguir |
| `bs.actions.add([{ label, k, run, icon }])` | ações do Buscar em tudo (`Shift` `Shift`) |
| `bs.status.add({ id, title, onclick })` | item na status bar (devolve o `<span>`) |
| `bs.dashboard.card({ id, order, wide, html(), bind(el) })` / `bs.dashboard.action({ label, icon, go })` | card e botão no resumo do projeto |
| `bs.ui.panel(html)` | painel na área do editor, abaixo do código |
| `bs.build.info()` / `selected()` / `run(task, cmd)` / `showLog(log)` / `current()` / `render()` | janela Build: estrutura, escolhas (Maven, JDK, repositório), rodar tarefa, mostrar um log de fora no console |
| `bs.terminal.open(pasta, shell)` / `run(comando, pasta)` / `shells()` | terminal |
| `bs.lsp.tools()` / `clientFor(aba)` / `restart(ferramenta, raiz)` | servidores de linguagem: lista, cliente da aba (para pedidos LSP próprios) e reinício |
| `bs.debug.start(aba)` / `stop()` / `session()` | depurador |
| `bs.hooks.on(evento, fn)` | `project:select`, `project:refresh`, `tab:open`, `tab:activate`, `tab:close`, `tab:save`, `editor:ready(editor, diffEditor)`, `dashboard:render(el)`, `build:render(body, info)`, `codefont(tamanho)`, `refresh`, `escape` |
| `bs.hooks.filter(nome, fn)` | `tree:marks`, `menu:file`, `menu:tab`, `menu:project`, `menu:commit`, `build:path(rel, caminho)` |

Funções do núcleo declaradas com `function` também podem ser trocadas: `window.renderTree = function () { ... }`.

Exemplo, um item de menu na árvore:

```js
bs.hooks.filter('menu:file', (items, ctx) => [...items, '-', {
  label: 'Contar linhas', icon: bs.I.lint,
  action: async () => { const f = await bs.api('file', { project: bs.S.project.path, file: ctx.rel }); bs.toast(f.content.split('\n').length + ' linhas'); },
}]);
```

## Servidor do plugin

O BlueScreen passa ao programa, por variável de ambiente, `BLUESCREEN_URL`, `BLUESCREEN_TOKEN`, `BLUESCREEN_PLUGIN` e `BLUESCREEN_PLUGIN_DIR`. O programa abre uma porta local e avisa numa linha da saída padrão:

```
BLUESCREEN-READY {"port":51234,"routes":["meu/ola","meu/build-info"]}
```

A partir daí, `/api/meu/ola` chega ao plugin com o cabeçalho `x-bluescreen-token`, e com `x-bluescreen-remote: 1` quando vem da rede local. O resto da saída vai para `~/.bluescreen/bluescreen.log`.

Em Rust, o crate `app/sdk` (`bluescreen-sdk`) faz tudo isso:

```rust
let mut p = bluescreen_sdk::plugin::PluginServer::new("meu");
p.route("meu/ola", |r| async move { ok(json!({ "projeto": r.q("project") })) });
p.run().await
```

Toda pasta em `app/plugins/` com `Cargo.toml` entra sozinha no workspace; `build.ps1 -Plugin <id>` monta só aquele plugin.

Para falar com o núcleo ou com outro plugin, chame o BlueScreen com o token (`bluescreen_sdk::plugin::core().get("outro/rota", ...)`). Um plugin pode publicar uma lib com o cliente das suas rotas para os outros usarem (como `bluescreen-ic`). Rotas internas (`r.internal_only()`) só respondem a chamadas com o token, nunca ao navegador nem à rede local.

## Ganchos do núcleo (`hooks` no `plugin.json`)

O núcleo chama a rota indicada (POST, como chamada interna) e usa a resposta. Gancho que aponta para uma rota que o plugin não anuncia é ignorado e vai para o log.

| Gancho | Recebe | Devolve (tudo opcional) |
|---|---|---|
| `build.info` | `{ project, root, rel, vcs, aggregator, poms, mavens, jdks }` | `{ tasks, aggregator, maven, systemNames, repos, data }`: tarefas extras (`main` destaca, `detail` lista os passos), pom agregador, versão de Maven preferida, nome dos grupos de tarefas, repositórios Maven (`{ id, label, default }`) e dados livres que o `ui.js` lê em `bs.build.info().plugins[id]` |
| `build.run` | `{ project, root, repo }` quando o usuário escolheu um repositório do plugin | `{ settings, env, note }`: settings.xml do Maven, variáveis de ambiente do build e o aviso no console |
| `lint` | `{ project, file }` (caminho relativo ao projeto) | `{ handled, tool, problems: [{ line, col, end_line, end_col, sev, msg, rule }], client }`. Com `handled: false` (ou erro), o núcleo segue o lint de sempre. `sev` é `error`, `warning` ou `info`; `client: "ts"` mantém o verificador TypeScript do editor |

## Servidor de plugins

`app/plugin-server` é um programa à parte que hospeda plugins com versões. A IDE aponta para ele na aba **Plugins** › **Servidores de plugins** (só o endereço). O servidor é só de leitura: a IDE lista, instala e atualiza, mas não envia nada para ele. A lista fica em `~/.bluescreen/plugins.json` (`servers`).

**Na IDE:**
- **Instalar.** Os plugins do servidor aparecem em **Disponíveis nos servidores**, com o botão **Instalar**.
- **Aviso de atualização.**
  - A IDE consulta os servidores alguns segundos depois de abrir, de meia em meia hora e quando você volta para a janela.
  - Havendo versão maior de um plugin instalado, aparecem o selo no topo e o número na aba Plugins.
  - O botão **Atualizar para vX** fica na linha do plugin.
  - O aviso some quando você atualiza.
- **Onde instala.** O plugin vai para `~/.bluescreen/plugins/<id>`, que vale mais que o do app.
  - O pacote é conferido pelo sha256 antes.
  - Um plugin com `server.exe` é encerrado e trocado sem fechar a IDE.
  - A pasta ganha um `.origin.json` com o servidor e a versão.
- **Desinstalar.** Botão direito no plugin › **Desinstalar**. Só vale para plugins da pasta do usuário. Se o app tiver o mesmo plugin, a versão do app volta a valer.

**No servidor:**

```
app\build.ps1 -PluginServer
dist\PluginServer\bluescreen-plugin-server.exe --port 4900 --dir D:\plugins --name "Plugins da equipe"
```

- **Pasta de dados:** `<dir>/<id>/<versão>/`. As IDEs sempre recebem a maior versão; as antigas ficam guardadas.
- **Publicar:** na máquina do servidor, solte a pasta do plugin, a que tem o `plugin.json`, direto em `<dir>/`. O servidor lê o id e a versão e arquiva sozinho. Para as IDEs receberem o aviso, aumente o `version` do `plugin.json`; uma versão que já está lá vai para `<dir>/_recusados/`.
- **Tirar uma versão:** apague `<dir>/<id>/<versão>/`.
- **Rotas:**
  - `GET /api/index`
  - `GET /api/plugins/<id>[?version=]`, que devolve o pacote `{ id, version, sha256, files: [{ path, data (base64) }] }`
  - `GET /`, uma página com a lista
- **Só leitura:** não há rota para enviar nem apagar plugins pela rede.

