# QAutils

O kit do QA no BlueScreen: cenários em Gherkin (Cucumber), ferramentas do dia a dia, checklists e teste exploratório. É um plugin nativo e só tem interface: usa o índice e a busca do núcleo, a pasta de dados do plugin e o console de Build. Não sobe nenhum servidor.

O painel **QAutils** (`Alt+9`, se nenhum outro plugin usar a tecla) tem quatro abas: **Cenários**, **Kit**, **Checklists** e **Sessão**. Toda ferramenta do kit também está no **Buscar em tudo** (`QA: Dados de teste`, `QA: JSON`…).

## Kit

Botões rápidos no topo: um clique gera e copia CPF, CNPJ, nome, e-mail, celular ou UUID. Cada ferramenta abre numa janela larga; clicar num valor copia.

| Ferramenta | O que faz |
|---|---|
| **Dados de teste** | nome, e-mail (`@example.com`), CPF, CNPJ, RG (SP), PIS/PASEP, CNH, título de eleitor, Renavam, placa Mercosul, celular com DDD real, nascimento (com a idade), CEP de capital (com logradouro), cartão **de teste** (Visa, Mastercard, Elo, Amex, Hipercard: passa no Luhn, com validade e CVV), UUID e senha forte. Com ou sem máscara. Todos os documentos têm dígito verificador válido e são gerados: não são de ninguém |
| **Massa de dados** | N linhas (até 5000) com os campos escolhidos, em CSV (`;`, abre como planilha) ou JSON; copia ou salva em `qa/massas/` |
| **Validar** | cole CPFs, CNPJs, cartões, e-mails ou CEPs (um por linha): diz o que é e se é válido |
| **Valores limite** | texto (tamanho), número ou data: vazio, mín−1, mín, mín+1, máx−1, máx, máx+1 e os casos clássicos (29/02, dia 31, mês 13, negativo, letras…) |
| **Entradas especiais** | espaços, acentos, apóstrofo, emoji, caracteres invisíveis, texto da direita para a esquerda, 255/256/1000 caracteres, números estranhos, e-mails inválidos e entradas de injeção (HTML, XSS, SQL, template, caminho) para testar o seu sistema |
| **JSON** | formatar, validar (com linha e coluna do erro), minificar, ordenar chaves, virar/tirar de string e comparar |
| **Base64 · URL · JWT** | codifica e decodifica Base64, URL e HTML; lê um JWT (header, payload, emitido, validade e se já expirou) |
| **Data e hora** | epoch (s/ms) ↔ data, ISO, dia da semana; somar dias (corridos ou úteis); dias corridos, úteis e horas entre duas datas |
| **Texto** | gera texto com **exatamente N caracteres** (para testar limite de campo), conta caracteres, bytes, palavras e linhas; maiúsculas, minúsculas, título, sem acentos, espaços extras, linhas únicas, ordenar, slug |
| **Hash e UUID** | SHA-1, SHA-256, SHA-512 e Base64 do texto; UUIDs |
| **Regex** | testa uma expressão com vários valores de uma vez |
| **Comparar** | esperado × obtido lado a lado (texto, JSON, XML, SQL, HTML), com as diferenças marcadas |
| **Relatório de bug** | título, severidade, prioridade, ambiente, navegador, chamado, cenário, pré-condição, passos (numerados sozinhos), esperado, obtido e evidências; copia como texto (para o chamado) ou Markdown (Jira, Azure, GitHub) ou salva em `qa/bugs/` |
| **Ambientes** | os ambientes das configurações (PRD, HML, DSV…), a um clique |

**Bug a partir de um cenário:** no status de um cenário (acima dele, no editor) há **Abrir relatório de bug deste cenário…**, com a pré-condição, os passos, o esperado, o chamado e as evidências já preenchidos.

## Checklists

Modelos prontos (**Smoke test**, **Formulário**, **Login e sessão**, **Regressão**, **Acessibilidade básica**, **Responsividade**, **API**) ou em branco. Marque os itens, acrescente outros (Enter), anote observações por item e copie ou salve em Markdown (`qa/checklists/`). Ficam guardadas por projeto, na pasta de dados do plugin.

## Sessão (teste exploratório)

Escreva a missão (o que explorar e com qual objetivo), a área, o tempo planejado e o ambiente, e comece. O cronômetro aparece no painel e na barra de status. Anote o que encontrar como **🐞 Bug**, **❓ Dúvida**, **💡 Ideia** ou **📝 Nota** (Ctrl+Enter anota como nota): cada anotação leva o horário. Uma anotação de bug abre o relatório de bug já preenchido. Dá para pausar. Ao encerrar, o relatório (resumo, anotações por tipo e linha do tempo) é salvo em `qa/sessoes/`.

---

# Cenários (Gherkin / Cucumber)

## Painel (aba Cenários)

- **Features:** as features por pasta (equipe, mês), com o **chamado** do nome do arquivo em destaque (`INC1753202`, `PRB0068833`, `SDIGBSID00-2429`), o número de cenários e uma barra com o andamento da execução. "Recentes" ordena pelo que foi mexido por último. A seta abre os cenários de cada feature.
- **Busca:** texto (nome do arquivo, da funcionalidade, dos cenários e dos passos), `@tag` ou o número do chamado.
- **Passos:** cada passo diferente do projeto e quantas vezes é usado. Os mais usados são os "padrões" que o autocompletar sugere. Clique para ver onde cada um aparece.
- **Tags:** as tags com contagem. Clique para filtrar. Em projeto automatizado, ▶ roda a tag.
- **Execução:** o percentual executado, ✓ passou, ✗ falhou, ⊘ bloqueado e ○ não executado, com as features com falha primeiro. Daqui saem o relatório de evidências e o CSV do que a busca encontrou.
- Botão **+**: nova feature. Clique no chamado: abre o link (veja as configurações) ou copia o número.

## Nova feature de chamado

No **+** do painel, no botão direito numa pasta (**Nova feature aqui…**) ou no Buscar em tudo (**QA: Nova feature**):

- **Nome do arquivo:** `CHAMADO - Título.feature`.
- **Pasta do mês:** se a pasta escolhida já tem subpastas por mês (`OUTUBRO`, `OUTUBRO-2026`, `outubro_2026`), a feature vai para a do mês atual, no mesmo estilo.
- **Conteúdo:**
  - `# language: pt` (ou o idioma do projeto);
  - a tag do chamado (`@INC1753202`);
  - a história de usuário (Como / Eu quero / Para que);
  - os cenários já numerados (`CT001`, `CT002`…).

## No editor (`.feature`)

- **Acima de cada cenário:** o status (**○ Não executado → ✓ Passou / ✗ Falhou / ⊘ Bloqueado**, com anotação), as **📷 Evidências** e **Copiar**, que copia o cenário em texto pronto para colar no chamado, com o resultado.
- **Acima da funcionalidade:** o resumo da execução, o **Relatório de evidências** e o **Exportar CSV**.
- **Autocompletar:**
  - palavras-chave no idioma do arquivo; num arquivo novo, no idioma da configuração ou das features do projeto (sem features: **português**);
  - em português: `Funcionalidade`, `Contexto`, `Cenário`, `Esquema do Cenário`, `Exemplos`, `Regra`, `Dado`/`Dada`/`Dados`/`Dadas`, `Quando`, `Então`, `E`, `Mas`. Dá para digitar sem acento (`cenario`, `entao`) ou o termo em inglês (`feat`, `scen`, `then`): a sugestão já vem em português;
  - a primeira palavra-chave em português põe o `# language: pt` na primeira linha (sem ele o Cucumber lê o arquivo como inglês). Arquivo sem esse cabeçalho ganha um aviso, e **Alt+Enter** o adiciona;
  - cenário novo já com o próximo número (`CT006`);
  - os passos já escritos no projeto (os mais usados e os do mesmo tipo Dado/Quando/Então primeiro);
  - as step definitions, com os parâmetros para preencher;
  - `@tags` (inclusive a do chamado do arquivo);
  - as `<colunas>` dos Exemplos.
- **Passo parecido:** quando um passo é quase igual a um padrão do projeto (outra grafia, um acento, uma palavra trocada), o editor avisa e **Alt+Enter** troca pelo padrão.
- **Alt+Enter no cabeçalho da funcionalidade ou de um cenário:**
  - **mover os passos repetidos para o `Contexto`:** os que abrem todos os cenários do mesmo jeito; o primeiro passo que sobra vira "Quando/Então" se começava com "E";
  - **converter as palavras-chave** para português ou inglês (Feature ↔ Funcionalidade, Given ↔ Dado...), sem mexer na descrição, nas tabelas nem nas docstrings (só no cabeçalho da funcionalidade);
  - **renumerar os cenários** (`CT001`, `CT002`… mantendo o prefixo e a largura);
  - **formatar e alinhar as tabelas**.
- **Shift+Alt+F:** formata (recuo padrão, tabelas alinhadas, docstrings preservadas).
- **Estrutura:** **Ctrl+F12** e a trilha mostram a funcionalidade e os cenários.
- **Navegação:** **Shift+F12** mostra onde mais o passo é usado. Passar o mouse mostra quantas vezes ele aparece.
- **Comentário que parece tag** (`#Sistema_E2E_...`): **Alt+Enter** transforma em `@tag` acima da funcionalidade.

## Evidências e relatórios

- **Evidências:** tire o print (**Win+Shift+S**), clique em **📷 Evidência** acima do cenário e cole com **Ctrl+V**, ou arraste imagens. Elas ficam ao lado da feature: `<pasta>/evidencias/<nome da feature>/CT001_1.png`. Vão para o repositório junto da feature, se você quiser.
- **Relatório de evidências (HTML):** funcionalidade, cenários, passos, Exemplos, status, data, QA, observações e as imagens. Abre no navegador, onde dá para imprimir em PDF. O de uma feature fica na pasta das evidências dela; o de uma pasta, em `relatorio-evidencias.html`.
- **CSV:** casos de teste para Excel, Xray, Zephyr ou Azure Test Plans, com as colunas Chamado, Arquivo, Funcionalidade, ID, Cenário, Tags, Pré-condições (Contexto + Dado), Passos (Quando), Resultado esperado (Então), Exemplos, Status, Executado em, QA e Observação. Separado por `;`, abre direto no Excel em português, e o BlueScreen o abre como planilha.

O status de execução é seu (fica na pasta de dados do plugin, em `~/.bluescreen/plugin-data/qautils`). O relatório e o CSV levam o status para quem precisar.

## Automação

Quando o projeto tem step definitions (Java, Kotlin, JS/TS, Ruby, Python/behave ou C#/SpecFlow), o modo automação liga sozinho:

- **Steps:** os sem definição e os ambíguos ficam marcados. **Alt+Enter** gera a definição no idioma da feature (`@Dado`, `@Quando`, `@Entao` com o import de `io.cucumber.java.pt`, ou `Given`/`When`/`Then`) e insere no arquivo de steps que você escolher.
- **F12 / Ctrl+clique** num passo vai para a step definition.
- **▶ Executar** a feature, o cenário ou uma tag:
  - **Maven:** `mvn test -Dcucumber.features=arquivo:linha`, só com a classe do Cucumber;
  - **Gradle:** `cleanTest test`, com `CUCUMBER_FEATURES`;
  - **npm:** `npx cucumber-js`;
  - **Ruby:** `bundle exec cucumber`;
  - **behave**.

  A saída vai para o console de Build.

## Configurações (engrenagem na aba Plugins)

| | |
|---|---|
| Seu nome | vai nos relatórios, nos bugs e nas sessões |
| Ambientes | um por linha, `NOME=endereço`: o Kit abre com um clique e o relatório de bug oferece a lista |
| Pasta dos relatórios de bug e das sessões | `qa` (bugs, sessões, massas e checklists salvos ficam em `qa/…`) |
| Modo | automático (documentação sem step definitions), documentação ou automação |
| Idioma das features novas | o mesmo do projeto, português ou inglês |
| Prefixo dos cenários | `CT` (CT001, CT002…) |
| Pasta das evidências | `evidencias` |
| Links dos chamados | um por linha, `PREFIXO=endereço com {id}`, ex.: `INC=https://empresa.service-now.com/nav_to.do?uri=incident.do?sysparm_query=number={id}` |
| Passo parecido | liga/desliga o aviso |
