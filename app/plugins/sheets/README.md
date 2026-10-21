# Planilhas (`sheets`)

`.csv`, `.tsv` e `.xlsx` abrem numa tabela editável, no lugar do texto ou do hexadecimal. O plugin roda só na página (`ui.js`), sem bibliotecas nem servidor.

| | |
|---|---|
| Editar | digite por cima da célula, ou `F2` / dois cliques para editar o que já tem; `Enter` e `Tab` confirmam e andam, `Esc` cancela; barra de fórmulas em cima |
| Selecionar | arrastar, `Shift`+clique, `Shift`+setas, `Ctrl`+setas (borda dos dados), clique no número da linha ou na letra da coluna, `Ctrl+A`; embaixo à direita, soma, média e contagem da seleção |
| Fórmulas | começam com `=`; aceitam o jeito do arquivo (`=SUM(A1:A3,2)`) e o brasileiro (`=SOMA(A1:A3;2,5)`); ~60 funções (SOMA, MÉDIA, SE, SEERRO, PROCV, ÍNDICE, CORRESP, SOMASE, CONT.SE, SOMASES, DATA, HOJE, texto...); `Σ` faz a AutoSoma |
| Formatar | negrito, itálico, sublinhado, tachado, cor do texto, preenchimento, alinhamento, bordas, formatos (número, moeda, porcentagem, data, hora, científico, texto) e casas decimais |
| Copiar e colar | `Ctrl+C` / `Ctrl+X` / `Ctrl+V`, com o Excel também; aqui dentro vão junto fórmulas (ajustadas) e formatação; `Ctrl+D` / `Ctrl+R` preenchem para baixo / à direita |
| Linhas e colunas | botão direito: inserir e excluir (as fórmulas se ajustam), ordenar (só a vista ou a planilha), largura automática; arraste a borda da coluna para mudar a largura |
| Desfazer | `Ctrl+Z` / `Ctrl+Y`, até 200 passos |
| Abas (xlsx) | uma por planilha; `+` cria uma nova, dois cliques renomeiam (as fórmulas que citam o nome acompanham) |
| Salvar | `Ctrl+S` (e o salvamento automático da IDE). O `.xlsx` regrava só as planilhas alteradas, os estilos e o workbook: gráficos, imagens e o resto voltam como estavam. O CSV mantém separador, codificação, BOM e fim de linha |
| CSV | grava só valores: com formatação, o salvar pergunta se grava só os valores ou uma cópia **.xlsx** (também na barra: **Salvar como .xlsx**) |
| Texto | **Editar como texto** na barra (CSV), e no menu do arquivo **Abrir como texto** / **Abrir como planilha** |
| Arquivos grandes | leitura em pedaços, com o progresso na tela e sem travar a IDE: o CSV separa as linhas sem aspas de forma nativa; o `.xlsx` é descompactado e lido aos poucos, direto do texto do XML. A busca guarda o texto de cada linha (a primeira monta o índice, as seguintes são imediatas). Editar recalcula só as fórmulas que dependem da célula alterada (grafo de dependências), não a pasta inteira. Uma planilha de 200 mil linhas abre em ~1 s, e editar uma célula leva ~20 ms |

Limites: `.xls` (formato binário antigo) e `.xlsx` acima de 4 GB (zip64) não abrem na tabela; arquivos acima de 200 MB também não. Células mescladas, formatação condicional e gráficos são preservados ao salvar, mas não aparecem na tabela. Funções que o motor não conhece mantêm o valor que o arquivo trouxe (o Excel recalcula ao abrir).
