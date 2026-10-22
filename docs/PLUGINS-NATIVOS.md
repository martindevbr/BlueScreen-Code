# Plugins nativos (`server.exe`)

Um plugin nativo tem o servidor compilado (em Rust, pelo `bluescreen-sdk`) e entregue como `server.exe`. No BlueScreen ele é a **exceção**: o padrão é `ui.js`, com `server.js` / `server.py` quando precisar, porque assim o plugin muda sem compilar (veja [MIGRACAO-PLUGINS.md](MIGRACAO-PLUGINS.md)).

Este guia vale para os casos em que o nativo faz diferença de verdade e merece ser explorado até o fim. A API do servidor em Rust está em [PLUGINS.md › Em Rust](PLUGINS.md#em-rust).

## Quando um plugin novo pode nascer nativo

Só com um dos motivos **N1 a N7** de [MIGRACAO-PLUGINS.md › Critérios](MIGRACAO-PLUGINS.md#21-motivos-para-manter-o-serverexe) confirmado. Para os de desempenho (N1, N2, N5), confirmado com medição: escreva primeiro o trecho quente em JavaScript, meça com os limites da etapa 3 e só parta para Rust se ele não couber.

"Rust é mais rápido" sozinho não é motivo. O que conta é o usuário sentir a diferença.

## Regras

### 1. O nativo faz só o que precisa ser nativo

A interface fica sempre no `ui.js`: painéis, menus, atalhos, diálogos, textos. O `server.exe` faz o trabalho pesado e devolve JSON. Assim, mexer na tela não exige compilar.

Quando só um trecho justifica o nativo, use o **híbrido**: a lógica fica em `ui.js` / `server.js`, e um executável pequeno faz só aquele trecho, chamado por `plugin.exec` (entrada em `stdin` ou argumentos, saída em JSON no `stdout`). Ele nem precisa ser o servidor do plugin.

### 2. O contrato é documentado e estável

No `README.md` do plugin, liste cada rota com o que recebe e o que devolve. Esse contrato é o que permite, um dia, trocar o motor por `server.js` sem mexer em quem chama (etapa 4.1 da migração). Mudanças no formato aumentam a versão do plugin.

### 3. A decisão fica escrita, com números

O `README.md` tem a seção **Arquitetura** do modelo da migração, com a decisão **manter nativo**, as medições e o campo **Reavaliar quando**. Sem números, a próxima pessoa (ou IA) não sabe se o nativo ainda se justifica.

### 4. Tem como medir sem a IDE

Deixe um binário de linha de comando que roda o trecho quente fora da IDE, para benchmark e testes, como o `unilint`:

```
cargo run -p bluescreen-unilint --release --bin unilint -- <pastas>
```

### 5. Não trava, não abre janela, sai junto

- Trabalho pesado vai em `tokio::task::spawn_blocking` (ou `rayon`), nunca direto na rota assíncrona.
- Todo processo filho no Windows sai com `creation_flags(0x0800_0000)` (sem janela de console), como em `runtimes`.
- O servidor não guarda estado que se perca mal se ele for encerrado: o BlueScreen o encerra ao desligar o plugin, ao fechar a IDE e ao atualizar o plugin pelo servidor de plugins.

### 6. Usa o núcleo em vez de refazer

Procurar programas (`sdk/which`), JDKs (`sdk/jdks`), Mavens (`sdk/mavens`), dados (`core().data_get/data_set`), configurações, segredos e cofre vêm do núcleo pelo `bluescreen-sdk`. Isso mantém o plugin igual ao resto da IDE e facilita uma migração futura.

### 7. Segurança

Um `server.exe` roda como o usuário do Windows, sem a proteção que a página tem. Ele pode fazer qualquer coisa que o usuário faz. Por isso:

- Peça ao cofre só o que usa, e `"reveal": true` só se precisar mesmo do valor cru.
- Não grave tokens em log nem em `plugin-data` sem cifrar (use `core().secret`).
- Rotas que não devem responder à rede local usam `r.internal_only()`.

## Montar e distribuir

```
powershell -File build.ps1 -Plugin <id>   # monta só este plugin e copia server.exe para a pasta dele
powershell -File build.ps1                # tudo
```

Uma pasta em `app/plugins/<id>/` com `Cargo.toml` entra sozinha no workspace durante o build, e o binário `bluescreen-<id>` vira `server.exe`. Em desenvolvimento, sem `server.exe` na pasta, o núcleo usa o binário mais novo de `target/release` ou `target/debug`.

Pelo [servidor de plugins](PLUGINS.md#servidor-de-plugins), o `server.exe` vai junto com a pasta: publique a pasta já montada, com o `version` aumentado. A IDE encerra o servidor antigo e troca o arquivo sem fechar.

## Reavaliar

Um plugin nativo volta à análise de [MIGRACAO-PLUGINS.md](MIGRACAO-PLUGINS.md) quando:

- acontece o que estava em **Reavaliar quando** no README;
- a parte nativa encolheu, e o trabalho pesado passou para um programa externo ou para o núcleo;
- surgiu uma biblioteca madura em JavaScript ou Python para o que só existia em C/Rust (N3);
- o plugin parou de receber mudanças por ninguém conseguir compilar.

## Plugins nativos hoje

| Plugin | Por que é nativo |
|---|---|
| `unilint` | gancho `lint` a cada salvamento (N1), 15 gramáticas Tree-sitter compiladas (N3), lint de pastas em paralelo com `rayon` (N2) |
| `runtimes` | ainda sem análise: é candidato à migração (veja a tabela no fim de [MIGRACAO-PLUGINS.md](MIGRACAO-PLUGINS.md#situação-dos-plugins-do-repositório)) |
