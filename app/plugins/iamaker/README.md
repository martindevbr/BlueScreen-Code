# IAMaker

Cria e altera plugins do BlueScreen conversando com uma IA de linha de comando, sem compilar nem recarregar nada. Fica numa janela do balão flutuante (**Alt+0**), que você pode mover, redimensionar, minimizar no balão ou encaixar numa região da tela (arraste o topo da janela até um dos alvos).

## Como usar

1. Abra o IAMaker: **Alt+0**, o balão no canto da tela, ou "IAMaker" no Buscar em tudo.
2. Escolha a IA no topo: **Claude Code**, **Gemini CLI** ou **Codex CLI**.
3. Em **Novo plugin…**, descreva o que você quer. O nome é opcional: em branco, a IA escolhe um nome curto e o IAMaker renomeia a pasta para combinar. Para mudar um plugin que já existe, escolha ele na lista ou clique no ✦ (**Editar com o IAMaker**) no cartão dele, na aba Plugins.
4. A IA avisa onde o componente vai aparecer: balão flutuante, barra de status, barra da esquerda, painel de baixo, resumo do projeto... Esse lugar mostra um carregamento enquanto ela trabalha.
5. Quando ela termina, o IAMaker confere o plugin e carrega ele na IDE aberta, **sem recarregar a página**: o que você tinha aberto continua como estava. O componente aparece no lugar com um contorno de destaque rápido, e uma janela nova no balão já abre.

Peça mudanças na mesma conversa ("deixe o texto verde", "acrescente um atalho"). Cada plugin tem a sua conversa, guardada na pasta de dados do IAMaker. O ＋ no topo começa uma conversa nova e o plugin continua como está.

## O que precisa estar instalado

O programa da IA, no PATH e com o login feito uma vez no terminal:

| IA | Instalar | Login |
|---|---|---|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude` |
| Gemini CLI | `npm install -g @google/gemini-cli` | `gemini` |
| Codex CLI | `npm install -g @openai/codex` | `codex login` |

Sem o programa, o painel mostra o comando e um botão que roda a instalação no terminal da IDE.

## Onde ficam os plugins

- **Novos:** em `~/.bluescreen/plugins/<id>`. São plugins comuns (`plugin.json` + `ui.js` + `style.css`), que você pode abrir, copiar e distribuir pelo servidor de plugins.
- **Os que vêm com o BlueScreen:** nunca são alterados nem sobrepostos. Na primeira mudança, o IAMaker cria uma **versão sua**: um plugin à parte, com id próprio (`<id>-meu`, "Nome (minha versão)"), em `~/.bluescreen/plugins/<id>-meu`. Ela é uma cópia do original, com as configurações e os dados dele, e o `plugin.json` guarda de onde veio (`"basedOn": { "id", "version" }`). A IA só mexe nessa versão.
  - O original continua instalado, sem mudança nenhuma, e fica desligado enquanto a sua versão existir, para os dois não registrarem os mesmos painéis e atalhos. Se outro plugin ligado depende do original, o IAMaker avisa.
  - Pedir outra mudança no original (pela lista ou pelo ✦ no cartão dele) continua na sua versão, com a mesma conversa.
  - Para voltar ao original, remova a sua versão na aba Plugins (ela vai para a Lixeira): na próxima vez que o IAMaker abrir, ele liga o original de novo.
  - Plugins copiados por versões antigas do IAMaker, com o mesmo id do original, continuam como estão e são editados direto, como os seus.
- **Com servidor compilado** (`server.exe`): a IA só mexe na interface (`ui.js`, `style.css`, `plugin.json`), nunca na parte compilada.

## Segurança

- A IA roda com o diretório de trabalho na pasta do plugin.
  - **Claude Code:** só pode ler, procurar e editar arquivos (`--allowedTools Read,Write,Edit,Glob,Grep`), sem rodar comandos.
  - **Codex CLI:** roda com `--full-auto`, numa sandbox que só grava na pasta.
  - **Gemini CLI:** roda com `--approval-mode auto_edit`. Os comandos que pedem aprovação são recusados, porque não há ninguém para aprovar.
- Antes de carregar o plugin, o IAMaker confere se o `plugin.json` é válido e se o `id` é o nome da pasta, e procura erros de sintaxe no `ui.js` sem rodar o código. Com erro, ele não carrega: pede a correção para a IA, até 2 vezes seguidas.
- Erro que o plugin lança logo depois de carregar (num `setTimeout`, num evento) também conta, nos primeiros 3 segundos.

## Configurações

Na engrenagem do painel, ou na do cartão na aba Plugins:

| | |
|---|---|
| IA | a escolhida no painel |
| Modelo | opcional, por IA (`--model` / `-m`) |
| Argumentos | um por linha, por IA. O pedido vai sempre pela entrada padrão. Se a sua versão do Gemini CLI não aceitar `--output-format stream-json` ou `--approval-mode`, troque aqui |
| Carregar o plugin sozinho | ligado por padrão; desligado, aparece o botão **Aplicar** |
| Pedir a correção sozinho | ligado por padrão |

## Como funciona

- As instruções que a IA recebe estão em [`GUIA.md`](GUIA.md): regras, a API `bs`/`plugin`, modelos de painel e a linha `IAMAKER-LUGAR`.
- O Claude Code continua a mesma sessão entre os pedidos (`--resume`). Para o Gemini e o Codex, o IAMaker manda as instruções e o resumo da conversa a cada pedido.
- A saída de cada IA (JSON por linha) vira a conversa na tela: respostas, arquivos lidos e escritos, erros.
- O núcleo não aceita `{{secret:..}}` nem `{{vault:..}}` na entrada de um processo. Por isso, no texto enviado à IA, esses marcadores aparecem como `⟪secret:..⟫`, e o guia explica como escrevê-los.
- Se você recarregar a página com a IA rodando, o IAMaker volta a acompanhar o mesmo processo.
- Cada mudança carrega o plugin de novo com `BS.plugins.reload`, que desfaz o que a versão anterior registrou (veja [PLUGINS.md](../../../docs/PLUGINS.md#recarregar-sem-recarregar-a-página)). Por isso o guia pede à IA que registre tudo no topo do `ui.js` e use `plugin.onUnload` para `setInterval` e afins.
