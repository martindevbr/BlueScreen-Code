# Planilhas (`sheets`)

`.csv`, `.tsv` e `.xlsx` abrem numa tabela, no lugar do texto ou do hexadecimal. O plugin roda só na página (`ui.js`), sem bibliotecas nem servidor.

| | |
|---|---|
| CSV / TSV | aspas e quebras de linha dentro de campo; separador detectado (`,` `;` tab `|`) ou escolhido; UTF-8 ou Windows-1252 |
| XLSX | todas as planilhas, em abas embaixo; valores, fórmulas (na barra de cima), datas, moeda, porcentagem e texto formatado |
| Tabela | só as linhas visíveis existem na página, então 200 mil linhas abrem na hora; primeira linha como cabeçalho (lembrada por arquivo) |
| Filtro e ordem | filtro por texto (`Ctrl+F`); clique no cabeçalho ordena: crescente, decrescente e volta à ordem original |
| Teclado | setas e PageUp/PageDown andam pelas células; `Ctrl+C` copia a célula |
| Texto | **Editar como texto** na barra (CSV), e no menu do arquivo **Abrir como texto** / **Abrir como planilha** |

Limites: `.xls` (formato binário antigo) e `.xlsx` acima de 4 GB (zip64) não abrem na tabela; arquivos acima de 200 MB também não.
