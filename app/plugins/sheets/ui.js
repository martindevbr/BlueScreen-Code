// Planilhas: .csv/.tsv e .xlsx abrem numa tabela (aba do visualizador de arquivos), sem bibliotecas.
// CSV: lido aqui (aspas, quebra de linha dentro de campo, separador detectado, UTF-8 ou Windows-1252).
// XLSX: é um zip de XMLs; o índice do zip é lido aqui, o WebView2 descompacta (DecompressionStream) e lê os XMLs
// (DOMParser). Valores, fórmulas, datas e formatos de número comuns do Excel; uma aba embaixo para cada planilha.
// A tabela é virtual (só as linhas visíveis existem na página), então um CSV de centenas de milhares de linhas abre.
const FV = bs.fileViewer; if (!FV) return;
const { esc, toast, store } = bs;
const EXT = { csv: 'csv', tsv: 'csv', tab: 'csv', xlsx: 'xlsx', xlsm: 'xlsx' };
const MAX = 200 * 1048576; // acima disso, a tabela não abre (o texto continua no leitor de arquivos grandes)
const RH = 24;             // altura da linha (px), fixa: é o que permite desenhar só as linhas visíveis
const extOf = (p) => (p.split('/').pop().split('.').pop() || '').toLowerCase();

// os tipos entram no visualizador; xlsx sai do hexadecimal (com o plugin desligado, volta para lá)
FV.kinds.hex = FV.kinds.hex.filter(e => !EXT[e]);
FV.kinds.sheet = Object.keys(EXT);
FV.labels.sheet = 'planilha';

// ===== CSV =====
function decode(buf) {
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'UTF-8' }; }
  catch { return { text: new TextDecoder('windows-1252').decode(buf), enc: 'Windows-1252' }; }
}
// separador: o que aparece o mesmo número de vezes (e mais vezes) nas primeiras linhas, fora de aspas
function sniff(text) {
  const lines = [], cands = [',', ';', '\t', '|'];
  let cur = '', q = false;
  for (let i = 0; i < text.length && lines.length < 30 && i < 200000; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    if (!q && (c === '\n' || c === '\r')) { if (cur) lines.push(cur); cur = ''; continue; }
    if (!q) cur += c;
  }
  if (cur) lines.push(cur);
  let best = ',', score = -1;
  for (const d of cands) {
    const n = lines.map(l => l.split(d).length - 1);
    if (!n.length || !n[0]) continue;
    const same = n.filter(x => x === n[0]).length / n.length;
    const s = same * 1000 + n[0];
    if (s > score) { score = s; best = d; }
  }
  return best;
}
function parseCSV(text, d) {
  const rows = []; let row = [], f = '', i = 0, q = false; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      // trecho sem aspas de uma vez (bem mais rápido que caractere a caractere)
      const j = text.indexOf('"', i); const end = j < 0 ? n : j; f += text.slice(i, end); i = end; continue;
    }
    if (c === '"' && f === '') { q = true; i++; continue; }
    if (c === d) { row.push(f); f = ''; i++; continue; }
    if (c === '\n' || c === '\r') { row.push(f); rows.push(row); row = []; f = ''; i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// ===== XLSX =====
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function zipIndex(b) {
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('não é um arquivo .xlsx (zip) válido');
  const count = u16(b, e + 10), off = u32(b, e + 16);
  if (off === 0xFFFFFFFF || count === 0xFFFF) throw new Error('planilha grande demais (zip64), ainda não suportada');
  const dec = new TextDecoder(), files = new Map();
  for (let i = 0, p = off; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('índice do zip corrompido');
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), lho = u32(b, p + 42);
    files.set(dec.decode(b.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/'), { method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  return files;
}
async function zipRead(b, files, name) {
  const f = files.get(name) || files.get(name.replace(/^\//, ''));
  if (!f) return null;
  const at = f.lho + 30 + u16(b, f.lho + 26) + u16(b, f.lho + 28);
  const data = b.subarray(at, at + f.csize);
  let out = data;
  if (f.method === 8) out = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  else if (f.method !== 0) throw new Error('compressão do zip não suportada (' + f.method + ')');
  return new TextDecoder().decode(out);
}
const xml = (s) => { const d = new DOMParser().parseFromString(s, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('XML inválido dentro do .xlsx'); return d; };
const tags = (n, name) => n.getElementsByTagNameNS('*', name);
const kid = (n, name) => { for (const c of n.children) if (c.localName === name) return c; return null; };
// texto de um <si>/<is>: todos os <t>, menos os da pronúncia (<rPh>)
const richText = (n) => [...tags(n, 't')].filter(t => !t.closest('rPh')).map(t => t.textContent).join('');
const relId = (n) => { for (const a of n.attributes) if (a.localName === 'id' && a.prefix) return a.value; return n.getAttribute('r:id'); };
const colNum = (ref) => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n - 1; };
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };

const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00', 49: '@' };
// formato sem o que está entre aspas e colchetes: o que sobra diz se é data, porcentagem, casas decimais...
const bare = (code) => code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '');
const isDateFmt = (id, code) => DATE_IDS.has(id) || (!!code && /[dmyhs]/i.test(bare(code)) && !/^general$/i.test(code));
const p2 = (n) => String(n).padStart(2, '0');
function fmtDate(v, code, d1904) {
  const ms = Math.round(((d1904 ? v + 1462 : v) - 25569) * 86400000);
  const d = new Date(ms); if (isNaN(d)) return String(v);
  const b = bare(code || '').toLowerCase();
  const hasTime = /h|s/.test(b) || (v % 1 !== 0 && !b);
  const hasDate = v >= 1 || /d|y/.test(b);
  const date = `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${/s/.test(b) ? ':' + p2(d.getUTCSeconds()) : ''}`;
  return [hasDate ? date : '', hasTime ? time : ''].filter(Boolean).join(' ');
}
function fmtNum(v, code) {
  const c = bare(code || '');
  if (!c || /^general$/i.test(code) || c === '@') return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(12))).replace('.', ',');
  if (/E\+/i.test(c)) return v.toExponential(((c.match(/\.(0+)/) || ['', ''])[1]).length).replace('.', ',');
  const pct = c.includes('%');
  const dec = ((c.split(';')[0].match(/\.(0+)/) || ['', ''])[1]).length;
  const sym = ((code.match(/\[\$([^-\]]+)/) || [])[1] || (code.match(/"(R\$|\$|€|US\$)\s*"/) || [])[1] || '').trim();
  const s = (pct ? v * 100 : v).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: /#,#|0,0/.test(c) });
  return (sym ? sym + ' ' : '') + s + (pct ? '%' : '');
}

async function readXlsx(buf) {
  const b = new Uint8Array(buf), files = zipIndex(b);
  const wbText = await zipRead(b, files, 'xl/workbook.xml');
  if (!wbText) throw new Error('não achei xl/workbook.xml: não parece um .xlsx do Excel');
  const wb = xml(wbText);
  const pr = tags(wb, 'workbookPr')[0]; const d1904 = !!pr && /^(1|true)$/.test(pr.getAttribute('date1904') || '');
  const rels = {};
  const relText = await zipRead(b, files, 'xl/_rels/workbook.xml.rels');
  if (relText) for (const r of tags(xml(relText), 'Relationship')) {
    const t = r.getAttribute('Target') || '';
    rels[r.getAttribute('Id')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
  }
  const ssText = await zipRead(b, files, 'xl/sharedStrings.xml');
  const shared = ssText ? [...tags(xml(ssText), 'si')].map(richText) : [];
  // estilos: índice do estilo da célula -> código do formato de número
  const fmts = [];
  const stText = await zipRead(b, files, 'xl/styles.xml');
  if (stText) {
    const st = xml(stText), codes = { ...BUILTIN };
    for (const nf of tags(st, 'numFmt')) codes[+nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
    const xfs = tags(st, 'cellXfs')[0];
    if (xfs) for (const xf of xfs.children) { const id = +(xf.getAttribute('numFmtId') || 0); fmts.push({ id, code: codes[id] || '', date: isDateFmt(id, codes[id]) }); }
  }
  const sheets = [...tags(wb, 'sheet')].map(s => ({ name: s.getAttribute('name') || 'Planilha', hidden: (s.getAttribute('state') || 'visible') !== 'visible', path: rels[relId(s)] }));
  // cada planilha é lida quando a aba dela é aberta
  for (const s of sheets) s.load = async () => {
    const text = s.path && await zipRead(b, files, s.path);
    if (!text) return { rows: [], formulas: new Map() };
    return parseSheet(xml(text), shared, fmts, d1904);
  };
  return sheets;
}
function parseSheet(doc, shared, fmts, d1904) {
  const rows = [], formulas = new Map();
  let rn = 0;
  for (const row of tags(doc, 'row')) {
    rn = row.hasAttribute('r') ? +row.getAttribute('r') - 1 : rn;
    const out = []; let cn = 0;
    for (const c of row.children) {
      if (c.localName !== 'c') continue;
      const ref = c.getAttribute('r'); if (ref) cn = colNum(ref);
      const t = c.getAttribute('t') || 'n', v = kid(c, 'v'), f = kid(c, 'f');
      const raw = v ? v.textContent : '';
      let val = '';
      if (t === 's') val = shared[+raw] ?? '';
      else if (t === 'inlineStr') { const is = kid(c, 'is'); val = is ? richText(is) : ''; }
      else if (t === 'b') val = raw === '1' ? 'VERDADEIRO' : raw === '0' ? 'FALSO' : raw;
      else if (t === 'str' || t === 'e') val = raw;
      else if (t === 'd') val = raw.replace(/^(\d{4})-(\d\d)-(\d\d)T?/, '$3/$2/$1 ').trim();
      else if (raw !== '') {
        const num = +raw, st = fmts[+(c.getAttribute('s') || 0)];
        val = isNaN(num) ? raw : st && st.date ? fmtDate(num, st.code, d1904) : fmtNum(num, st && st.code);
      }
      if (f && f.textContent) formulas.set(rn + ',' + cn, '=' + f.textContent);
      if (val !== '') { while (out.length < cn) out.push(''); out[cn] = val; }
      cn++;
    }
    if (out.length) { while (rows.length < rn) rows.push([]); rows[rn] = out; }
    rn++;
  }
  return { rows, formulas };
}

// ===== tabela =====
const NUM_RE = /^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?%?$|^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?%?$/;
// número, com ou sem símbolo de moeda na frente ("R$ 1.234,50")
const CUR = /^(R\$|US\$|\$|€)\s*/;
const NUM = { test: (s) => NUM_RE.test(s.replace(CUR, '')) };
const coll = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const numKey = (s) => { const t = s.replace(CUR, '').replace(/%$/, ''); return /,/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t) ? +t.replace(/\./g, '').replace(',', '.') : +t; };

function widths(rows, ncol, start) {
  const w = new Array(ncol).fill(0);
  for (let r = start; r < Math.min(rows.length, start + 400); r++) { const row = rows[r]; if (row) for (let c = 0; c < ncol; c++) { const s = row[c]; if (s && s.length > w[c]) w[c] = s.length; } }
  return w.map(n => Math.max(56, Math.min(380, 24 + n * 7.6)));
}
// planilha atual da aba: { rows, formulas, ncol, head, view (índices visíveis), sort }
function prepare(t, data) {
  const rows = data.rows; let ncol = 0;
  for (const r of rows) if (r && r.length > ncol) ncol = r.length;
  while (rows.length && !(rows[rows.length - 1] || []).some(x => x !== '')) rows.pop();
  // primeira linha como cabeçalho: lembrada por arquivo; sem escolha, quando ela só tem texto e a segunda tem número
  const saved = (store.get('sheetHead', {}) || {})[t.path];
  const r0 = rows[0] || [], r1 = rows[1] || [];
  const guess = r0.length > 0 && r0.every(x => x !== '' && !NUM.test(x)) && (r1.some(x => NUM.test(x)) || rows.length > 1);
  const sh = { rows, formulas: data.formulas || new Map(), ncol, head: saved ?? guess, sort: null, filter: '', sel: null };
  sh.w = widths(rows, ncol, 0);
  apply(sh);
  return sh;
}
function apply(sh) {
  const start = sh.head ? 1 : 0;
  let v = []; for (let i = start; i < sh.rows.length; i++) v.push(i);
  const q = sh.filter.trim().toLowerCase();
  if (q) v = v.filter(i => (sh.rows[i] || []).some(x => x && x.toLowerCase().includes(q)));
  if (sh.sort) {
    const { c, dir } = sh.sort, cell = (i) => (sh.rows[i] || [])[c] || '';
    const allNum = v.every(i => { const s = cell(i); return !s || NUM.test(s); });
    v.sort((a, b) => {
      const x = cell(a), y = cell(b);
      if (!x !== !y) return x ? -1 : 1; // vazios sempre no fim
      return dir * (allNum ? numKey(x) - numKey(y) : coll.compare(x, y));
    });
  }
  sh.view = v;
}

const ICON = {
  filter: '<svg class="i" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
};
function build(t, el) {
  t.sh = { cur: 0, sheets: null };
  const csv = EXT[extOf(t.path)] === 'csv';
  el.innerHTML = FV.bar(t, `${csv ? `<select class="sh-delim" data-delim title="Separador das colunas"><option value="">separador: automático</option><option value=",">vírgula ( , )</option><option value=";">ponto e vírgula ( ; )</option><option value="&#9;">tabulação</option><option value="|">barra ( | )</option></select>` : ''}
      <label class="sh-chk" title="Usar a primeira linha como nome das colunas"><input type="checkbox" data-head> cabeçalho</label>
      <span class="sh-find">${ICON.filter}<input data-q placeholder="Filtrar linhas" spellcheck="false"></span>
      ${csv ? '<button class="chip" data-a="text" title="Abrir o arquivo no editor de texto">Editar como texto</button>' : ''}`)
    + `<div class="sh-fx"><span class="sh-ref" data-ref></span><span class="sh-val" data-val></span></div>
       <div class="sh-grid" data-grid tabindex="0"><div class="sh-head" data-headrow></div><div class="sh-body" data-body><div class="sh-space" data-space></div><div class="sh-rows" data-rows></div></div></div>
       <div class="sh-tabs" data-tabs hidden></div>`;
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => FV.act(t, b.dataset.a));
  const body = $('[data-body]');
  body.addEventListener('scroll', () => { $('[data-headrow]').style.transform = `translateX(${-body.scrollLeft}px)`; draw(t); }, { passive: true });
  t.sh.ro = new ResizeObserver(() => draw(t)); t.sh.ro.observe(body);
  let qt; $('[data-q]').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { const s = cur(t); if (!s) return; s.filter = e.target.value; apply(s); body.scrollTop = 0; render(t); }, 160); };
  $('[data-head]').onchange = (e) => {
    const s = cur(t); if (!s) return; s.head = e.target.checked;
    const m = store.get('sheetHead', {}) || {}; m[t.path] = s.head; store.set('sheetHead', m);
    apply(s); render(t);
  };
  const dl = $('[data-delim]'); if (dl) dl.onchange = () => { t.sh.delim = dl.value; load(t); };
  // clique numa célula: seleciona; no cabeçalho: ordena (crescente, decrescente, sem ordem)
  $('[data-rows]').addEventListener('mousedown', (e) => { const c = e.target.closest('[data-c]'); if (!c) return; select(t, +c.parentNode.dataset.r, +c.dataset.c); });
  $('[data-headrow]').addEventListener('click', (e) => {
    const h = e.target.closest('[data-c]'); if (!h) return; const s = cur(t), c = +h.dataset.c;
    s.sort = !s.sort || s.sort.c !== c ? { c, dir: 1 } : s.sort.dir === 1 ? { c, dir: -1 } : null;
    apply(s); render(t);
  });
  $('[data-grid]').addEventListener('keydown', (e) => key(t, e));
  load(t);
}
const cur = (t) => t.sh && t.sh.sheets && t.sh.sheets[t.sh.cur] && t.sh.sheets[t.sh.cur].data;

async function load(t) {
  const el = t.el, msg = (m) => { el.querySelector('[data-rows]').innerHTML = `<div class="vw-msg">${m}</div>`; el.querySelector('[data-space]').style.height = '0'; };
  msg('Lendo a planilha…');
  try {
    const head = await fetch(FV.url(t, '&offset=0&len=0'));
    t.size = +head.headers.get('x-file-size');
    if (t.size > MAX) return msg(`Planilha grande demais para a tabela (${FV.size(t.size)}).`);
    const r = await fetch(FV.url(t));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const buf = await r.arrayBuffer();
    const keep = t.sh.sheets ? t.sh.sheets[t.sh.cur] && t.sh.sheets[t.sh.cur].name : null;
    if (EXT[extOf(t.path)] === 'csv') {
      const { text, enc } = decode(buf);
      const d = t.sh.delim || (extOf(t.path) === 'csv' ? sniff(text) : '\t');
      t.sh.sheets = [{ name: 'CSV', data: prepare(t, { rows: parseCSV(text, d) }) }];
      t.sh.info = `${enc} · separador ${({ ',': 'vírgula', ';': 'ponto e vírgula', '\t': 'tabulação', '|': 'barra' })[d] || JSON.stringify(d)}`;
    } else {
      t.sh.sheets = (await readXlsx(buf)).map(s => ({ ...s, data: null }));
      t.sh.info = '';
      if (!t.sh.sheets.length) return msg('A pasta de trabalho não tem planilhas.');
    }
    const i = keep ? t.sh.sheets.findIndex(s => s.name === keep) : -1;
    await pick(t, i >= 0 ? i : Math.max(0, t.sh.sheets.findIndex(s => !s.hidden)));
  } catch (e) { msg(`Não deu para ler a planilha: ${esc(e.message)}`); }
}
async function pick(t, i) {
  const s = t.sh.sheets[i]; t.sh.cur = i;
  if (!s.data) {
    t.el.querySelector('[data-rows]').innerHTML = '<div class="vw-msg">Lendo a planilha…</div>';
    try { s.data = prepare(t, await s.load()); } catch (e) { t.el.querySelector('[data-rows]').innerHTML = `<div class="vw-msg">Não deu para ler "${esc(s.name)}": ${esc(e.message)}</div>`; return; }
  }
  const tabs = t.el.querySelector('[data-tabs]');
  tabs.hidden = t.sh.sheets.length < 2 && EXT[extOf(t.path)] === 'csv';
  tabs.innerHTML = t.sh.sheets.map((x, k) => `<button class="sh-tab ${k === i ? 'on' : ''} ${x.hidden ? 'hid' : ''}" data-k="${k}" title="${x.hidden ? 'Planilha oculta' : ''}">${esc(x.name)}</button>`).join('');
  tabs.querySelectorAll('[data-k]').forEach(b => b.onclick = () => pick(t, +b.dataset.k));
  const sh = s.data;
  t.el.querySelector('[data-head]').checked = sh.head;
  t.el.querySelector('[data-q]').value = sh.filter;
  t.el.querySelector('[data-body]').scrollTop = 0;
  render(t);
  if (t.goLine) { const n = t.goLine; t.goLine = 0; FV.custom.sheet.goto(t, n); }
}
// cabeçalho, altura total e as linhas visíveis
function render(t) {
  const sh = cur(t); if (!sh) return;
  const el = t.el, digits = String(sh.rows.length).length;
  sh.rnw = Math.max(40, 16 + digits * 8);
  sh.total = sh.rnw + sh.w.reduce((a, b) => a + b, 0);
  const hr = sh.head ? sh.rows[0] || [] : [];
  const arrow = (c) => sh.sort && sh.sort.c === c ? (sh.sort.dir === 1 ? ' ▲' : ' ▼') : '';
  el.querySelector('[data-headrow]').style.width = sh.total + 'px';
  el.querySelector('[data-headrow]').innerHTML = `<div class="sh-rn" style="width:${sh.rnw}px"></div>`
    + sh.w.map((w, c) => `<div class="sh-h" data-c="${c}" style="width:${w}px" title="Coluna ${colName(c)}${hr[c] ? ': ' + esc(hr[c]) : ''} · clique para ordenar"><span>${esc(sh.head && hr[c] ? hr[c] : colName(c))}</span>${arrow(c)}</div>`).join('');
  el.querySelector('[data-space]').style.cssText = `height:${sh.view.length * RH}px;width:${sh.total}px`;
  t.sh.drawn = null; draw(t);
  t.dims = `${sh.view.length.toLocaleString('pt-BR')}${sh.filter ? ' de ' + (sh.rows.length - (sh.head ? 1 : 0)).toLocaleString('pt-BR') : ''} linhas × ${sh.ncol} colunas${t.sh.info ? ' · ' + t.sh.info : ''}`;
  const m = el.querySelector('[data-meta]'); if (m) m.textContent = [t.dims, FV.size(t.size)].filter(Boolean).join(' · ');
  fx(t);
}
function draw(t) {
  const sh = cur(t); if (!sh || !t.el) return;
  const body = t.el.querySelector('[data-body]');
  const first = Math.max(0, Math.floor(body.scrollTop / RH) - 10), last = Math.min(sh.view.length, Math.ceil((body.scrollTop + body.clientHeight) / RH) + 10);
  const key = first + ':' + last + ':' + (sh.sel ? sh.sel.r + ',' + sh.sel.c : '');
  if (t.sh.drawn === key) return; t.sh.drawn = key;
  let html = '';
  for (let k = first; k < last; k++) {
    const r = sh.view[k], row = sh.rows[r] || [];
    html += `<div class="sh-r" data-r="${r}" style="top:${k * RH}px;width:${sh.total}px"><div class="sh-rn" style="width:${sh.rnw}px">${r + 1}</div>`;
    for (let c = 0; c < sh.ncol; c++) {
      const v = row[c] || '', on = sh.sel && sh.sel.r === r && sh.sel.c === c;
      html += `<div class="sh-c${NUM.test(v) ? ' n' : ''}${on ? ' on' : ''}${sh.formulas.has(r + ',' + c) ? ' f' : ''}" data-c="${c}" style="width:${sh.w[c]}px">${esc(v)}</div>`;
    }
    html += '</div>';
  }
  if (!sh.view.length) html = `<div class="vw-msg">${sh.filter ? 'Nenhuma linha com esse texto.' : 'Planilha vazia.'}</div>`;
  t.el.querySelector('[data-rows]').innerHTML = html;
}
function fx(t) {
  const sh = cur(t), ref = t.el.querySelector('[data-ref]'), val = t.el.querySelector('[data-val]');
  if (!sh || !sh.sel) { ref.textContent = ''; val.textContent = ''; return; }
  const { r, c } = sh.sel;
  ref.textContent = colName(c) + (r + 1);
  const f = sh.formulas.get(r + ',' + c), v = (sh.rows[r] || [])[c] || '';
  val.textContent = f ? `${f}   →   ${v}` : v;
}
function select(t, r, c) {
  const sh = cur(t); if (!sh) return;
  sh.sel = { r, c }; t.sh.drawn = null; draw(t); fx(t);
}
// setas andam pela tabela (na ordem visível); Ctrl+C copia a célula; Ctrl+F vai para o filtro
function key(t, e) {
  const sh = cur(t); if (!sh) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); t.el.querySelector('[data-q]').focus(); return; }
  if (!sh.sel) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); navigator.clipboard.writeText((sh.rows[sh.sel.r] || [])[sh.sel.c] || '').then(() => toast('Copiado')).catch(() => {}); return; }
  const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-20, 0], PageDown: [20, 0] };
  const m = moves[e.key]; if (!m) return; e.preventDefault();
  const k = Math.max(0, Math.min(sh.view.length - 1, sh.view.indexOf(sh.sel.r) + m[0])), c = Math.max(0, Math.min(sh.ncol - 1, sh.sel.c + m[1]));
  select(t, sh.view[k], c);
  // mantém a célula à vista
  const body = t.el.querySelector('[data-body]'), top = k * RH, left = sh.rnw + sh.w.slice(0, c).reduce((a, b) => a + b, 0);
  if (top < body.scrollTop) body.scrollTop = top; else if (top + RH > body.scrollTop + body.clientHeight - RH) body.scrollTop = top + 2 * RH - body.clientHeight;
  if (left < body.scrollLeft + sh.rnw) body.scrollLeft = left - sh.rnw; else if (left + sh.w[c] > body.scrollLeft + body.clientWidth) body.scrollLeft = left + sh.w[c] - body.clientWidth;
}

FV.custom.sheet = {
  build,
  show(t) { t.sh && (t.sh.drawn = null); requestAnimationFrame(() => draw(t)); },
  reload(t) { if (t.el) load(t); },
  close(t) { if (t.sh && t.sh.ro) t.sh.ro.disconnect(); t.sh = null; },
  // abrir em uma linha (busca, Problemas): vai até ela e seleciona a primeira célula
  goto(t, line) {
    const sh = cur(t); if (!sh) { t.goLine = line; return; }
    const k = sh.view.indexOf(line - 1); if (k < 0) return;
    t.el.querySelector('[data-body]').scrollTop = Math.max(0, k * RH - 60); select(t, line - 1, 0);
  },
};

// CSV aberto como texto: o menu do arquivo oferece voltar para a tabela (e o inverso)
bs.hooks.filter('menu:file', (items, ctx) => {
  if (ctx.isDir || !EXT[extOf(ctx.rel)]) return items;
  const asText = FV.forceText.has(ctx.rel);
  return [...items, '-', asText
    ? { label: 'Abrir como planilha', action: () => { FV.forceText.delete(ctx.rel); bs.S.tabs.filter(x => x.path === ctx.rel && x.mode === 'editor').forEach(x => closeTab(x)); bs.openFile(ctx.rel, 'editor'); } }
    : { label: 'Abrir como texto', action: () => { FV.forceText.add(ctx.rel); bs.S.tabs.filter(x => x.path === ctx.rel && x.mode === 'view').forEach(x => closeTab(x)); bs.openFile(ctx.rel, 'editor'); } }];
});
