// Planilhas: .csv/.tsv e .xlsx abrem numa tabela editável (aba do visualizador de arquivos), sem bibliotecas.
// CSV: lido aqui (aspas, quebra de linha dentro de campo, separador detectado, UTF-8 ou Windows-1252) e gravado do
// mesmo jeito (separador, codificação, BOM e fim de linha do arquivo). CSV não guarda formatação: ao salvar com
// formatação, a aba oferece salvar como .xlsx.
// XLSX: é um zip de XMLs. O índice do zip é lido aqui, o WebView2 descompacta e compacta (DecompressionStream e
// CompressionStream) e lê os XMLs (DOMParser). Ao salvar, só as planilhas alteradas, os estilos e o workbook são
// reescritos; o resto do pacote (gráficos, imagens, tabelas...) volta para o zip byte a byte.
// Edição: células, fórmulas (motor próprio, ~60 funções), seleção de intervalos, copiar/colar (inclusive com o
// Excel), desfazer, formatação (negrito, itálico, sublinhado, tachado, cores, alinhamento, bordas, formatos de
// número), inserir/excluir linhas e colunas, largura das colunas, ordenação e abas novas.
// A tabela é virtual (só as linhas e colunas visíveis existem na página), então um CSV de centenas de milhares de
// linhas abre.
const FV = bs.fileViewer; if (!FV) return;
const { esc, toast, store } = bs;
const EXT = { csv: 'csv', tsv: 'csv', tab: 'csv', xlsx: 'xlsx', xlsm: 'xlsx' };
const MAX = 200 * 1048576; // acima disso, a tabela não abre (o texto continua no leitor de arquivos grandes)
const RH = 24;             // altura da linha (px), fixa: é o que permite desenhar só as linhas visíveis
const XR = 60, XC = 8;     // linhas e colunas vazias depois dos dados, para digitar além do fim
const DEF_W = 88;
const extOf = (p) => (p.split('/').pop().split('.').pop() || '').toLowerCase();

// os tipos entram no visualizador; xlsx sai do hexadecimal (com o plugin desligado, volta para lá)
FV.kinds.hex = FV.kinds.hex.filter(e => !EXT[e]);
FV.kinds.sheet = Object.keys(EXT);
FV.labels.sheet = 'planilha';

// ===== CSV =====
function decode(buf) {
  const u = new Uint8Array(buf), bom = u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF;
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'UTF-8', bom }; }
  catch { return { text: new TextDecoder('windows-1252').decode(buf), enc: 'Windows-1252', bom: false }; }
}
let W1252 = null;
function encode(text, enc, bom) {
  if (enc !== 'Windows-1252') {
    const b = new TextEncoder().encode(text); if (!bom) return b;
    const o = new Uint8Array(b.length + 3); o.set([0xEF, 0xBB, 0xBF]); o.set(b, 3); return o;
  }
  if (!W1252) { W1252 = new Map(); const s = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i)); for (let i = 0; i < 256; i++) W1252.set(s.charCodeAt(i), i); }
  const o = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) { const b = W1252.get(text.charCodeAt(i)); o[i] = b === undefined ? 63 : b; } // fora do Windows-1252: "?"
  return o;
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
const csvField = (s, d) => s.includes('"') || s.includes(d) || s.includes('\n') || s.includes('\r') ? '"' + s.replace(/"/g, '""') + '"' : s;
// texto de uma célula no CSV: o valor como foi digitado; fórmula volta com o "=" (o Excel calcula ao abrir)
const csvText = (x) => x == null ? '' : typeof x === 'string' ? x : x.f != null ? '=' + x.f : x.v == null ? '' : typeof x.v === 'string' ? x.v : show(null, { v: x.v });
function toCsv(sh, o) {
  let last = sh.rows.length - 1;
  while (last >= 0 && !(sh.rows[last] || []).some(x => csvText(x) !== '')) last--;
  const lines = [];
  for (let r = 0; r <= last; r++) { const row = sh.rows[r] || []; let s = ''; for (let c = 0; c < row.length; c++) s += (c ? o.d : '') + csvField(csvText(row[c]), o.d); lines.push(s); }
  return lines.join(o.eol) + (o.trail && lines.length ? o.eol : '');
}

// ===== ZIP =====
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
    const nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32);
    files.set(dec.decode(b.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/'), {
      flags: u16(b, p + 8), method: u16(b, p + 10), time: u16(b, p + 12), date: u16(b, p + 14), crc: u32(b, p + 16),
      csize: u32(b, p + 20), usize: u32(b, p + 24), lho: u32(b, p + 42),
    });
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const zipRaw = (b, f) => { const at = f.lho + 30 + u16(b, f.lho + 26) + u16(b, f.lho + 28); return b.subarray(at, at + f.csize); };
const stream = async (data, s) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(s)).arrayBuffer());
async function zipText(b, files, name) {
  const f = files.get(name) || files.get(name.replace(/^\//, ''));
  if (!f) return null;
  let out = zipRaw(b, f);
  if (f.method === 8) out = await stream(out, new DecompressionStream('deflate-raw'));
  else if (f.method !== 0) throw new Error('compressão do zip não suportada (' + f.method + ')');
  return new TextDecoder().decode(out);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// list: [{ name, bytes }] (compacta agora) ou [{ name, raw }] (entrada do zip original, copiada como está)
async function zipBuild(list) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  const now = new Date(), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const e of list) {
    let m = e.raw;
    if (!m) { const data = await stream(e.bytes, new CompressionStream('deflate-raw')); m = { method: 8, crc: crc32(e.bytes), csize: data.length, usize: e.bytes.length, data, time, date, flags: 0 }; }
    const name = enc.encode(e.name), flags = (m.flags & ~0x0008) | 0x0800; // tamanhos no cabeçalho (sem descritor); nome em UTF-8
    const h = new Uint8Array(30 + name.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, flags, true); v.setUint16(8, m.method, true);
    v.setUint16(10, m.time, true); v.setUint16(12, m.date, true); v.setUint32(14, m.crc, true); v.setUint32(18, m.csize, true);
    v.setUint32(22, m.usize, true); v.setUint16(26, name.length, true); h.set(name, 30);
    const c = new Uint8Array(46 + name.length), w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, flags, true); w.setUint16(10, m.method, true);
    w.setUint16(12, m.time, true); w.setUint16(14, m.date, true); w.setUint32(16, m.crc, true); w.setUint32(20, m.csize, true);
    w.setUint32(24, m.usize, true); w.setUint16(28, name.length, true); w.setUint32(42, off, true); c.set(name, 46);
    parts.push(h, m.data); cen.push(c); off += h.length + m.data.length;
  }
  const size = cen.reduce((a, c) => a + c.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, list.length, true); v.setUint16(10, list.length, true); v.setUint32(12, size, true); v.setUint32(16, off, true);
  return new Uint8Array(await new Blob([...parts, ...cen, end]).arrayBuffer());
}

// ===== XML =====
const xml = (s) => { const d = new DOMParser().parseFromString(s, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('XML inválido dentro do .xlsx'); return d; };
const tags = (n, name) => n.getElementsByTagNameNS('*', name);
const kid = (n, name) => { for (const c of n.children) if (c.localName === name) return c; return null; };
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const ser = (doc) => DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
const xesc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const mk = (doc, name) => { const r = doc.documentElement; return doc.createElementNS(r.namespaceURI, r.prefix ? r.prefix + ':' + name : name); };
// texto de um <si>/<is>: todos os <t>, menos os da pronúncia (<rPh>)
const richText = (n) => [...tags(n, 't')].filter(t => !t.closest('rPh')).map(t => t.textContent).join('');
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relId = (n) => n.getAttributeNS(NS_R, 'id') || [...n.attributes].find(a => a.localName === 'id' && a.prefix)?.value || n.getAttribute('r:id');
const colNum = (ref) => { let n = 0; for (const ch of ref.toUpperCase()) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n - 1; };
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
const MAXR = 1048576, MAXC = 16384;

// ===== cores =====
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
const INDEXED = ('000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF '
  + '800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF '
  + '000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 '
  + '3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333').split(' ');
// tema do Excel: o índice 0 é o claro 1 e o 1 é o escuro 1 (o contrário da ordem do arquivo)
function themeColors(doc) {
  const s = tags(doc, 'clrScheme')[0]; if (!s) return null;
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((n, i) => {
    const c = kid(s, n)?.firstElementChild; return (c && (c.getAttribute('lastClr') || c.getAttribute('val'))) || THEME[i];
  });
}
function tint(hex, t) {
  let [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const f = (p, q, x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < .5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [h + 1 / 3, h, h - 1 / 3].map(x => Math.round((s ? f(p, q, x) : l) * 255).toString(16).padStart(2, '0')).join('');
}
function colorOf(e, theme) {
  if (!e || e.getAttribute('auto') === '1') return undefined;
  let hex;
  if (e.hasAttribute('rgb')) hex = e.getAttribute('rgb').slice(-6);
  else if (e.hasAttribute('theme')) hex = (theme || THEME)[+e.getAttribute('theme')];
  else if (e.hasAttribute('indexed')) hex = INDEXED[+e.getAttribute('indexed')];
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  const t = +(e.getAttribute('tint') || 0);
  return '#' + (t ? tint(hex, t) : hex).toLowerCase();
}
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return .2126 * r + .7152 * g + .0722 * b; };

// ===== formatos de número =====
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'dd/mm/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'hh:mm', 21: 'hh:mm:ss', 22: 'dd/mm/yyyy hh:mm', 37: '#,##0', 38: '#,##0', 39: '#,##0.00', 40: '#,##0.00', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 49: '@' };
const NF_ID = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, 'dd/mm/yyyy': 14, 'hh:mm': 20, 'hh:mm:ss': 21, 'dd/mm/yyyy hh:mm': 22, '@': 49 };
const CURRENCY = '"R$" #,##0.00';
// formato sem o que está entre aspas e colchetes: o que sobra diz se é data, porcentagem, casas decimais...
const bare = (code) => code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '');
const isGeneral = (code) => !code || /^general$/i.test(code);
const isDateFmt = (id, code) => DATE_IDS.has(id) || (!isGeneral(code) && /[dmyhs]/i.test(bare(code)) && !/E\+/i.test(code));
const p2 = (n) => String(n).padStart(2, '0');
function fmtDate(v, code, d1904) {
  const ms = Math.round(((d1904 ? v + 1462 : v) - 25569) * 86400000);
  const d = new Date(ms); if (isNaN(d)) return String(v);
  const b = bare(code || '').toLowerCase();
  const hasTime = /h|s/.test(b) || (v % 1 !== 0 && !b);
  const hasDate = v >= 1 && (/d|y/.test(b) || !/h|s/.test(b) || /m.*m/.test(b));
  const date = `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${/s/.test(b) ? ':' + p2(d.getUTCSeconds()) : ''}`;
  return [hasDate || !hasTime ? date : '', hasTime ? time : ''].filter(Boolean).join(' ');
}
const general = (v) => {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  if (Math.abs(v) >= 1e11 || (v !== 0 && Math.abs(v) < 1e-9)) return v.toExponential(5).replace(/\.?0+e/, 'e').replace('.', ',').replace('e', 'E');
  return String(parseFloat(v.toPrecision(11))).replace('.', ',');
};
function fmtNum(v, code) {
  const secs = code.split(';');
  const sec = v < 0 && secs[1] ? secs[1] : v === 0 && secs[2] ? secs[2] : secs[0];
  const c = bare(sec);
  if (c === '@') return general(v);
  if (/E\+/i.test(c)) return v.toExponential(((c.match(/\.(0+)/) || ['', ''])[1]).length).replace('.', ',').replace('e', 'E');
  const pct = c.includes('%');
  const dec = ((c.match(/\.(0+)/) || ['', ''])[1]).length;
  const sym = ((sec.match(/\[\$([^-\]]+)/) || [])[1] || (sec.match(/"(R\$|\$|€|US\$|£)\s*"/) || [])[1] || '').trim();
  const n = pct ? v * 100 : v;
  const s = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: /#,#|0,0/.test(c) });
  const neg = v < 0 && (!secs[1] || /-/.test(c)) ? '-' : '';
  const paren = v < 0 && secs[1] && /\(/.test(c) ? ['(', ')'] : ['', ''];
  return paren[0] + neg + (sym ? sym + ' ' : '') + s + (pct ? '%' : '') + paren[1];
}
// casas decimais a mais/a menos num formato
function decimals(code, d, v) {
  if (isGeneral(code)) {
    const cur = typeof v === 'number' ? Math.min(10, (String(v).split('.')[1] || '').length) : 0;
    const n = Math.max(0, cur + d); return n ? '0.' + '0'.repeat(n) : '0';
  }
  if (isDateFmt(-1, code)) return code;
  return code.split(';').map(sec => {
    const [m, ...e] = sec.split(/(?=E[+-])/i);
    return m.replace(/(0)(\.0+)?(?![\s\S]*0)/, (_, z, dec) => { const n = Math.max(0, (dec ? dec.length - 1 : 0) + d); return '0' + (n ? '.' + '0'.repeat(n) : ''); }) + e.join('');
  }).join(';');
}

// ===== números digitados =====
const NUM_RE = /^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?%?$|^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?%?$/;
// número, com ou sem símbolo de moeda na frente ("R$ 1.234,50")
const CUR = /^(R\$|US\$|\$|€)\s*/;
const NUM = { test: (s) => NUM_RE.test(String(s).trim().replace(CUR, '')) };
const coll = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const numKey = (s) => {
  const raw = String(s).trim().replace(CUR, ''), pct = raw.endsWith('%'), t = raw.replace(/%$/, '');
  const n = /,/.test(t) || /^[-+]?\d{1,3}(\.\d{3})+$/.test(t) ? +t.replace(/\./g, '').replace(',', '.') : +t;
  return pct ? n / 100 : n;
};
const serial = (y, m, d, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s) / 86400000 + 25569;
// o que o usuário digitou numa célula do .xlsx: número, porcentagem, moeda, data, hora, lógico ou texto
function literal(text) {
  const s = text.trim(); let m;
  if (/^(verdadeiro|true)$/i.test(s)) return { v: true };
  if (/^(falso|false)$/i.test(s)) return { v: false };
  if ((m = /^(-?)\s*(R\$|US\$|\$|€)\s*(.+)$/.exec(s)) && NUM_RE.test(m[3])) return { v: numKey(m[3]) * (m[1] ? -1 : 1), nf: m[2] === 'R$' ? CURRENCY : `"${m[2]}" #,##0.00` };
  if (/%$/.test(s) && NUM_RE.test(s)) { const v = numKey(s); return { v, nf: Number.isInteger(+(v * 100).toFixed(10)) ? '0%' : '0.00%' }; }
  // com separador de milhar ("1.234,56"): o número ganha o formato com milhar, como no Excel
  if (NUM_RE.test(s)) return /^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? { v: numKey(s), nf: '#,##0' + (s.includes(',') ? '.' + '0'.repeat(s.split(',')[1].length) : '') } : { v: numKey(s) };
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
    const y = m[3].length === 2 ? (+m[3] < 50 ? 2000 : 1900) + +m[3] : +m[3];
    if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return { v: serial(y, +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), nf: m[4] ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy' };
  }
  if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s)) && +m[1] < 24 && +m[2] < 60) return { v: (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400, nf: m[3] ? 'hh:mm:ss' : 'hh:mm' };
  return { v: text };
}

// ===== estilos =====
// estilo de célula: { xf (índice no styles.xml de origem), nf (código do formato), nfId, b, i, u, s (tachado),
// fc (cor do texto), bg (preenchimento), ha (alinhamento), bd (bordas), orig (igual ao do arquivo) }
const DEF_STYLE = { xf: 0, nf: 'General', nfId: 0, orig: true };
function restyle(base, ch) {
  const s = { ...(base || DEF_STYLE), ...ch, orig: false }; delete s._css;
  if ('nf' in ch) s.nfId = NF_ID[s.nf] ?? -1;
  return s;
}
const styleKey = (s) => [s.xf ?? 0, s.nf, !!s.b, !!s.i, !!s.u, !!s.s, s.fc || '', s.bg || '', s.ha || '', !!s.bd].join('|');
const isDateStyle = (s) => !!s && isDateFmt(s.nfId ?? -1, s.nf);
function css(s) {
  if (!s) return '';
  if (s._css != null) return s._css;
  let c = '';
  if (s.b) c += 'font-weight:700;';
  if (s.i) c += 'font-style:italic;';
  const deco = [s.u && 'underline', s.s && 'line-through'].filter(Boolean).join(' ');
  if (deco) c += `text-decoration:${deco};`;
  if (s.bg) c += `background-color:${s.bg};color:${s.fc || (lum(s.bg) > .5 ? '#1f2328' : '#f2f3f5')};`;
  else if (s.fc) c += `color:${s.fc};`;
  if (s.ha) c += `text-align:${s.ha};`;
  if (s.bd) c += 'box-shadow:inset 0 0 0 1px var(--fg-2);';
  return (s._css = c);
}

// ===== XLSX: leitura =====
function readStyles(st, theme) {
  const codes = { ...BUILTIN };
  for (const nf of tags(st, 'numFmt')) codes[+nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
  const on = (f, n) => { const e = kid(f, n); return !!e && !/^(0|false)$/.test(e.getAttribute('val') || ''); };
  const fonts = [...(tags(st, 'fonts')[0]?.children || [])].map(f => {
    const fc = colorOf(kid(f, 'color'), theme);
    return { b: on(f, 'b'), i: on(f, 'i'), u: !!kid(f, 'u') && kid(f, 'u').getAttribute('val') !== 'none', s: on(f, 'strike'), fc: fc && fc !== '#000000' ? fc : undefined };
  });
  const fills = [...(tags(st, 'fills')[0]?.children || [])].map(f => {
    const p = kid(f, 'patternFill'); if (!p || p.getAttribute('patternType') !== 'solid') return undefined;
    return colorOf(kid(p, 'fgColor'), theme) || colorOf(kid(p, 'bgColor'), theme);
  });
  const borders = [...(tags(st, 'borders')[0]?.children || [])].map(b => ['left', 'right', 'top', 'bottom'].some(n => { const e = kid(b, n); return e && e.getAttribute('style') && e.getAttribute('style') !== 'none'; }));
  const xfs = tags(st, 'cellXfs')[0];
  const list = [...(xfs?.children || [])].map((xf, i) => {
    const nfId = +(xf.getAttribute('numFmtId') || 0), f = fonts[+(xf.getAttribute('fontId') || 0)] || {};
    const ha = kid(xf, 'alignment')?.getAttribute('horizontal');
    return { xf: i, nfId, nf: codes[nfId] ?? 'General', b: f.b, i: f.i, u: f.u, s: f.s, fc: f.fc, bg: fills[+(xf.getAttribute('fillId') || 0)], bd: borders[+(xf.getAttribute('borderId') || 0)] || undefined, ha: /^(left|center|right)$/.test(ha) ? ha : undefined, orig: true };
  });
  return list.length ? list : [DEF_STYLE];
}
async function openBook(buf) {
  const b = new Uint8Array(buf), files = zipIndex(b), text = (n) => zipText(b, files, n);
  const wbText = await text('xl/workbook.xml');
  if (!wbText) throw new Error('não achei xl/workbook.xml: não parece um .xlsx do Excel');
  const wb = xml(wbText);
  const pr = tags(wb, 'workbookPr')[0]; const d1904 = !!pr && /^(1|true)$/.test(pr.getAttribute('date1904') || '');
  const rels = {}, types = {};
  const relText = await text('xl/_rels/workbook.xml.rels');
  if (relText) for (const r of tags(xml(relText), 'Relationship')) {
    const t = r.getAttribute('Target') || '', path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    rels[r.getAttribute('Id')] = path; types[(r.getAttribute('Type') || '').split('/').pop()] = path;
  }
  const thText = types.theme && await text(types.theme);
  const theme = thText ? themeColors(xml(thText)) : null;
  const ssText = await text(types.sharedStrings || 'xl/sharedStrings.xml');
  const shared = ssText ? [...tags(xml(ssText), 'si')].map(richText) : [];
  const stPath = types.styles || 'xl/styles.xml', stText = await text(stPath);
  const styles = stText ? readStyles(xml(stText), theme) : [DEF_STYLE];
  const book = { b, files, d1904, shared, styles, stPath: stText ? stPath : null, renames: [] };
  book.sheets = [...tags(wb, 'sheet')].map(s => ({ name: s.getAttribute('name') || 'Planilha', rid: relId(s), hidden: (s.getAttribute('state') || 'visible') !== 'visible', path: rels[relId(s)], data: null }));
  // cada planilha é lida quando a aba dela é aberta
  for (const s of book.sheets) s.load = async () => {
    const t = s.path && await zipText(book.b, book.files, s.path);
    return t ? readSheet(xml(t), book) : { rows: [], rowAttr: [] };
  };
  return book;
}
const errOf = (code) => ERRS[code] || new E(code);
function readSheet(doc, book) {
  const rows = [], rowAttr = [], shared = {};
  let rn = 0;
  for (const row of tags(doc, 'row')) {
    rn = row.hasAttribute('r') ? +row.getAttribute('r') - 1 : rn;
    const attrs = [...row.attributes].filter(a => a.name !== 'r' && a.name !== 'spans').map(a => [a.name, a.value]);
    if (attrs.length) rowAttr[rn] = attrs;
    const out = []; let cn = 0;
    for (const c of row.children) {
      if (c.localName !== 'c') continue;
      const ref = c.getAttribute('r'); if (ref) cn = colNum(ref);
      const t = c.getAttribute('t') || 'n', v = kid(c, 'v'), f = kid(c, 'f'), raw = v ? v.textContent : '';
      const si = +(c.getAttribute('s') || 0);
      const x = { v: null };
      if (t === 's') { x.v = book.shared[+raw] ?? ''; x.si = +raw; }
      else if (t === 'inlineStr') { const is = kid(c, 'is'); x.v = is ? richText(is) : ''; }
      else if (t === 'b') x.v = raw === '1';
      else if (t === 'e') x.v = errOf(raw);
      else if (t === 'str') x.v = raw;
      else if (t === 'd') x.v = raw.replace(/^(\d{4})-(\d\d)-(\d\d)T?/, '$3/$2/$1 ').trim();
      else if (raw !== '') x.v = isNaN(+raw) ? raw : +raw;
      if (f) {
        // fórmula compartilhada: só a primeira célula tem o texto; as outras são ela deslocada
        let text = f.textContent; const ft = f.getAttribute('t'), sid = f.getAttribute('si');
        if (ft === 'shared' && sid != null) { if (text) shared[sid] = { f: text, r: rn, c: cn }; else if (shared[sid]) text = moveFormula(shared[sid].f, rn - shared[sid].r, cn - shared[sid].c); }
        if (text) { x.f = text; if (ft === 'array') x.fa = f.getAttribute('ref') || ref; }
      }
      if (si && book.styles[si]) x.s = book.styles[si];
      if (x.v !== null || x.f != null || x.s) out[cn] = x;
      cn++;
    }
    if (out.length) rows[rn] = out;
    rn++;
  }
  const colW = [];
  for (const col of tags(doc, 'col')) {
    const w = +col.getAttribute('width'); if (!w) continue;
    for (let i = +col.getAttribute('min') - 1; i < Math.min(+col.getAttribute('max'), 1024); i++) colW[i] = col.getAttribute('hidden') === '1' ? 0 : Math.round(w * 7 + 5);
  }
  const pane = tags(doc, 'pane')[0];
  return { rows, rowAttr, colW, frozen: !!pane && pane.getAttribute('state') === 'frozen' && pane.getAttribute('ySplit') === '1' };
}

// pacote mínimo de um .xlsx: planilha nova (arquivo vazio) e "Salvar como .xlsx" de um CSV
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const EMPTY_SHEET = `<worksheet xmlns="${MAIN}" xmlns:r="${NS_R}"><sheetData/></worksheet>`;
async function blankBook(name = 'Planilha1') {
  const files = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT_SHEET}"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="${NS_R}"><sheets><sheet name="${xesc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': EMPTY_SHEET,
  };
  const enc = new TextEncoder();
  return openBook((await zipBuild(Object.entries(files).map(([name, s]) => ({ name, bytes: enc.encode(DECL + s) })))).buffer);
}

// ===== fórmulas =====
class E { constructor(code) { this.code = code; } toString() { return this.code; } }
const ERRS = Object.fromEntries(['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#NULL!'].map(c => [c, new E(c)]));
class Unsupported extends Error {}
// referência (com a planilha opcional): A1, $A$1, A1:B2, A:B, 1:2
const REF_RE = /(?:('(?:[^']|'')+'|[A-Za-z_\u00C0-\u024F][\w.\u00C0-\u024F]*)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![\w(.!\u00C0-\u024F])/y;
function lex(src) {
  const out = [], n = src.length; let i = 0, m;
  const at = (re) => { re.lastIndex = i; return re.exec(src); };
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      for (;;) { if (j >= n) throw new SyntaxError('aspas sem fechar'); if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      out.push({ t: 'str', v: s, a: i, b: j + 1 }); i = j + 1; continue;
    }
    if (ch === '#') { if ((m = at(/#(DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!)/y))) { out.push({ t: 'err', v: m[0], a: i, b: i + m[0].length }); i += m[0].length; continue; } throw new SyntaxError('erro desconhecido'); }
    if ((m = at(REF_RE))) { out.push({ t: 'ref', sheet: m[1], ref: m[2], a: i, b: i + m[0].length }); i += m[0].length; continue; }
    if ((m = at(/(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/y))) { out.push({ t: 'num', v: +m[0], a: i, b: i + m[0].length }); i += m[0].length; continue; }
    if ((m = at(/[A-Za-z_\u00C0-\u024F][\w.\u00C0-\u024F]*/y))) { out.push({ t: 'id', v: m[0], a: i, b: i + m[0].length }); i += m[0].length; continue; }
    if ((m = at(/<>|<=|>=|[-+*/^&=<>%(),:;{}]/y))) { out.push({ t: 'op', v: m[0], a: i, b: i + m[0].length }); i += m[0].length; continue; }
    throw new SyntaxError(`caractere inesperado "${ch}"`);
  }
  return out;
}
const unquote = (s) => s == null ? null : s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s;
const quoteSheet = (s) => /^[A-Za-z_\u00C0-\u024F][\w.\u00C0-\u024F]*$/.test(s) && !/^[A-Za-z]{1,3}\d+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
function refEnd(x) { // "$A$1" | "A" | "$3"
  const m = /^(\$?)([A-Za-z]*)(\$?)(\d*)$/.exec(x);
  return { c: m[2] ? colNum(m[2]) : null, ac: !!m[2] && !!m[1], r: m[4] ? +m[4] - 1 : null, ar: m[2] ? !!m[3] : !!m[1] };
}
const splitRef = (s) => { const [a, b] = s.split(':'); return { a: refEnd(a), b: b ? refEnd(b) : null }; };
const endStr = (e) => (e.c == null ? '' : (e.ac ? '$' : '') + colName(e.c)) + (e.r == null ? '' : (e.ar ? '$' : '') + (e.r + 1));
const refStr = (n) => endStr(n.a) + (n.b ? ':' + endStr(n.b) : '');
function parse(src) {
  const tk = lex(src); let p = 0;
  const is = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
  const bin = (next, ops) => () => { let l = next(); while (tk[p] && tk[p].t === 'op' && ops.includes(tk[p].v)) { const o = tk[p++].v; l = { k: 'bin', o, l, r: next() }; } return l; };
  const prim = () => {
    const t = tk[p++]; if (!t) throw new SyntaxError('fórmula incompleta');
    if (t.t === 'num' || t.t === 'str') return { k: 'v', v: t.v };
    if (t.t === 'err') return { k: 'v', v: errOf(t.v) };
    if (t.t === 'ref') return { k: 'ref', sheet: unquote(t.sheet), ...splitRef(t.ref) };
    if (t.t === 'id') {
      const up = t.v.toUpperCase();
      if (is('(')) {
        p++; const args = [];
        if (!is(')')) for (;;) { args.push(is(',') || is(')') ? { k: 'v', v: null } : cmp()); if (is(',')) { p++; continue; } break; }
        if (!is(')')) throw new SyntaxError('falta fechar o parêntese de ' + up);
        p++; return { k: 'fn', n: up.replace(/^_XLFN\./, ''), args };
      }
      if (up === 'TRUE' || up === 'VERDADEIRO') return { k: 'v', v: true };
      if (up === 'FALSE' || up === 'FALSO') return { k: 'v', v: false };
      return { k: 'name', n: t.v };
    }
    if (t.t === 'op' && t.v === '(') { const e = cmp(); if (!is(')')) throw new SyntaxError('falta fechar o parêntese'); p++; return e; }
    if (t.t === 'op' && t.v === '{') throw new Unsupported('matriz constante');
    throw new SyntaxError(`"${t.v}" fora do lugar`);
  };
  const pct = () => { let a = prim(); while (is('%')) { p++; a = { k: 'pct', a }; } return a; };
  const un = () => { if (is('-')) { p++; return { k: 'neg', a: un() }; } if (is('+')) { p++; return un(); } return pct(); };
  const pow = bin(un, ['^']), mul = bin(pow, ['*', '/']), add = bin(mul, ['+', '-']), cat = bin(add, ['&']);
  const cmp = bin(cat, ['=', '<>', '<', '>', '<=', '>=']);
  const e = cmp();
  if (p < tk.length) throw new SyntaxError(`"${tk[p].v || tk[p].ref}" fora do lugar`);
  return e;
}
// reescreve as referências de uma fórmula (fn devolve a referência nova, null para #REF! ou undefined para manter)
function rewrite(f, fn) {
  let tk; try { tk = lex(f); } catch { return f; }
  let out = '', at = 0;
  for (const t of tk) {
    if (t.t !== 'ref') continue;
    const sheet = unquote(t.sheet), n = fn({ sheet, ...splitRef(t.ref) });
    if (n === undefined) continue;
    out += f.slice(at, t.a) + (n === null ? '#REF!' : (n.sheet == null ? '' : n.sheet === sheet ? t.sheet + '!' : quoteSheet(n.sheet) + '!') + refStr(n));
    at = t.b;
  }
  return out + f.slice(at);
}
// fórmula copiada para dr linhas e dc colunas adiante (o que tem $ fica)
function moveFormula(f, dr, dc) {
  if (!dr && !dc) return f;
  return rewrite(f, (n) => {
    for (const e of [n.a, n.b]) {
      if (!e) continue;
      if (e.c != null && !e.ac) { e.c += dc; if (e.c < 0 || e.c >= MAXC) return null; }
      if (e.r != null && !e.ar) { e.r += dr; if (e.r < 0 || e.r >= MAXR) return null; }
    }
    return n;
  });
}
// faixa [lo, hi] depois de inserir n (n > 0) ou excluir -n linhas/colunas a partir de at; null se sumiu
function shiftSpan(lo, hi, at, n) {
  if (n > 0) return [lo >= at ? lo + n : lo, hi >= at ? hi + n : hi];
  const end = at - n, f = (x, top) => x < at ? x : x >= end ? x + n : top ? at - 1 : at;
  const a = f(lo, false), b = f(hi, true);
  return b < a ? null : [a, b];
}
// fórmula da planilha own depois de inserir/excluir linhas (axis 'r') ou colunas ('c') na planilha target
function shiftFormula(f, own, target, axis, at, n) {
  const same = (s) => (s ?? own).toLowerCase() === target.toLowerCase();
  return rewrite(f, (x) => {
    if (!same(x.sheet)) return undefined;
    const lo = x.a[axis], hi = (x.b || x.a)[axis];
    if (lo == null) return undefined; // A:A não muda com linhas, 1:1 não muda com colunas
    const s = shiftSpan(Math.min(lo, hi), Math.max(lo, hi), at, n); if (!s) return null;
    x.a[axis] = s[0]; if (x.b) x.b[axis] = s[1];
    return x;
  });
}
// nomes das funções em português (como no Excel em pt-BR) e o separador ";"
const PT = { SOMA: 'SUM', 'MÉDIA': 'AVERAGE', MEDIA: 'AVERAGE', 'MÁXIMO': 'MAX', MAXIMO: 'MAX', 'MÍNIMO': 'MIN', MINIMO: 'MIN', 'CONT.NÚM': 'COUNT', 'CONT.NUM': 'COUNT', 'CONT.VALORES': 'COUNTA', 'CONTAR.VAZIO': 'COUNTBLANK', SE: 'IF', SEERRO: 'IFERROR', SENÃODISP: 'IFNA', E: 'AND', OU: 'OR', 'NÃO': 'NOT', NAO: 'NOT', ARRED: 'ROUND', ARREDONDAR: 'ROUND', 'ARREDONDAR.PARA.CIMA': 'ROUNDUP', 'ARREDONDAR.PARA.BAIXO': 'ROUNDDOWN', INT: 'INT', ABS: 'ABS', MOD: 'MOD', 'POTÊNCIA': 'POWER', POTENCIA: 'POWER', RAIZ: 'SQRT', PRODUTO: 'PRODUCT', MED: 'MEDIAN', CONCATENAR: 'CONCATENATE', CONCAT: 'CONCAT', 'MAIÚSCULA': 'UPPER', MAIUSCULA: 'UPPER', 'MINÚSCULA': 'LOWER', MINUSCULA: 'LOWER', 'PRI.MAIÚSCULA': 'PROPER', ARRUMAR: 'TRIM', ESQUERDA: 'LEFT', DIREITA: 'RIGHT', 'EXT.TEXTO': 'MID', 'NÚM.CARACT': 'LEN', 'NUM.CARACT': 'LEN', SUBSTITUIR: 'SUBSTITUTE', VALOR: 'VALUE', HOJE: 'TODAY', AGORA: 'NOW', DATA: 'DATE', ANO: 'YEAR', 'MÊS': 'MONTH', MES: 'MONTH', DIA: 'DAY', SOMASE: 'SUMIF', 'SOMASES': 'SUMIFS', 'CONT.SE': 'COUNTIF', 'CONT.SES': 'COUNTIFS', 'MÉDIASE': 'AVERAGEIF', MEDIASE: 'AVERAGEIF', PROCV: 'VLOOKUP', PROCH: 'HLOOKUP', 'ÍNDICE': 'INDEX', INDICE: 'INDEX', CORRESP: 'MATCH', 'ÉCÉL.VAZIA': 'ISBLANK', 'ÉNÚM': 'ISNUMBER', 'ÉTEXTO': 'ISTEXT', 'ÉERROS': 'ISERROR', 'SOMARPRODUTO': 'SUMPRODUCT', 'MÁXIMOSES': 'MAXIFS', 'MÍNIMOSES': 'MINIFS', 'REPT': 'REPT', 'ALEATÓRIO': 'RAND', 'PI': 'PI' };
function normFormula(src) {
  // ";" fora das aspas: o texto está no jeito brasileiro (vírgula decimal, ";" separa os argumentos)
  let semi = false, q = false;
  for (const ch of src) { if (ch === '"') q = !q; else if (!q && ch === ';') { semi = true; break; } }
  let out = '';
  q = false;
  for (const ch of src) { if (ch === '"') q = !q; out += q || ch === '"' ? ch : semi && ch === ',' ? '.' : semi && ch === ';' ? ',' : ch; }
  let tk; try { tk = lex(out); } catch { return out; }
  let res = '', at = 0;
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i]; let rep = null;
    if (t.t === 'id' && tk[i + 1]?.t === 'op' && tk[i + 1].v === '(') { const up = t.v.toUpperCase(); rep = PT[up] || up; }
    else if (t.t === 'ref') rep = (t.sheet ? t.sheet + '!' : '') + t.ref.toUpperCase();
    else if (t.t === 'id' && /^(verdadeiro|falso|true|false)$/i.test(t.v)) rep = /^(verdadeiro|true)$/i.test(t.v) ? 'TRUE' : 'FALSE';
    if (rep != null) { res += out.slice(at, t.a) + rep; at = t.b; }
  }
  return res + out.slice(at);
}
const AST = new Map();
function astOf(f) {
  let a = AST.get(f);
  if (!a) { try { a = parse(f); } catch (e) { a = { k: 'bad', e }; } if (AST.size > 20000) AST.clear(); AST.set(f, a); }
  if (a.k === 'bad') throw a.e instanceof Unsupported ? a.e : new Unsupported(a.e.message);
  return a;
}

// valores: número, texto, lógico, null (vazio), E (erro) ou intervalo { rg, sh, r1, c1, r2, c2 }
function num(v) {
  if (v instanceof E) throw v;
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return +v;
  const s = String(v).trim();
  if (s === '') throw ERRS['#VALUE!'];
  const l = literal(s); if (typeof l.v === 'number') return l.v;
  throw ERRS['#VALUE!'];
}
const str = (v) => { if (v instanceof E) throw v; return v == null ? '' : typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : typeof v === 'number' ? general(v) : String(v); };
const bool = (v) => { if (v instanceof E) throw v; if (typeof v === 'string') { if (/^(true|verdadeiro)$/i.test(v)) return true; if (/^(false|falso)$/i.test(v)) return false; throw ERRS['#VALUE!']; } return !!num(v); };
const typeRank = (v) => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2;
function cmpVals(a, b) {
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  if (a instanceof E) throw a; if (b instanceof E) throw b;
  const ta = typeRank(a), tb = typeRank(b);
  if (ta !== tb) return ta - tb;
  if (ta === 1) return coll.compare(a, b);
  return +a - +b;
}
function evaluate(n, cx) {
  switch (n.k) {
    case 'v': return n.v;
    case 'ref': {
      const sh = sheetOf(cx, n.sheet);
      if (!n.b) return cellVal(sh, n.a.r, n.a.c, cx);
      const r1 = n.a.r ?? 0, r2 = n.b.r ?? Math.max(0, sh.rows.length - 1), c1 = n.a.c ?? 0, c2 = n.b.c ?? Math.max(0, sh.ncol - 1);
      return { rg: true, sh, r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
    }
    case 'neg': return -num(scalar(evaluate(n.a, cx)));
    case 'pct': return num(scalar(evaluate(n.a, cx))) / 100;
    case 'bin': {
      const a = scalar(evaluate(n.l, cx)), b = scalar(evaluate(n.r, cx));
      switch (n.o) {
        case '+': return num(a) + num(b);
        case '-': return num(a) - num(b);
        case '*': return num(a) * num(b);
        case '/': { const d = num(b); if (!d) throw ERRS['#DIV/0!']; return num(a) / d; }
        case '^': { const r = Math.pow(num(a), num(b)); if (!isFinite(r)) throw ERRS['#NUM!']; return r; }
        case '&': return str(a) + str(b);
        case '=': return cmpVals(a, b) === 0;
        case '<>': return cmpVals(a, b) !== 0;
        case '<': return cmpVals(a, b) < 0;
        case '>': return cmpVals(a, b) > 0;
        case '<=': return cmpVals(a, b) <= 0;
        case '>=': return cmpVals(a, b) >= 0;
      }
      break;
    }
    case 'fn': { const f = FN[n.n]; if (!f) throw new Unsupported(n.n); return f(n.args, cx); }
    case 'name': throw new Unsupported(n.n);
  }
  throw new Unsupported(n.k);
}
function sheetOf(cx, name) {
  if (name == null) return cx.sh;
  const s = cx.book.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!s) throw ERRS['#REF!'];
  if (!s.data) throw new Unsupported('planilha não carregada');
  return s.data;
}
function scalar(v) {
  if (!v || !v.rg) return v;
  if (v.r1 === v.r2 && v.c1 === v.c2) return cellVal(v.sh, v.r1, v.c1);
  throw ERRS['#VALUE!'];
}
// valores de um intervalo, linha por linha (só até onde há dados)
function* cells(rg, cx) {
  const r2 = Math.min(rg.r2, rg.sh.rows.length - 1);
  for (let r = rg.r1; r <= r2; r++) { const row = rg.sh.rows[r]; for (let c = rg.c1; c <= rg.c2; c++) yield row ? cellVal(rg.sh, r, c, cx, row[c]) : null; }
}
const grid = (rg, cx) => { const out = []; for (let r = rg.r1; r <= rg.r2; r++) { const row = []; for (let c = rg.c1; c <= rg.c2; c++) row.push(cellVal(rg.sh, r, c, cx)); out.push(row); } return out; };
// números dos argumentos: no intervalo só os números contam; direto no argumento, texto numérico e lógico também
function nums(args, cx) {
  const out = [];
  for (const a of args) {
    const v = evaluate(a, cx);
    if (v && v.rg) { for (const x of cells(v, cx)) { if (x instanceof E) throw x; if (typeof x === 'number') out.push(x); } }
    else if (v instanceof E) throw v;
    else if (v != null) out.push(num(v));
  }
  return out;
}
function* flat(args, cx) { for (const a of args) { const v = evaluate(a, cx); if (v && v.rg) yield* cells(v, cx); else yield v; } }
const ev = (a, cx) => a ? evaluate(a, cx) : null;
const sv = (a, cx) => scalar(ev(a, cx));
// critério do SOMASE/CONT.SE: ">5", "<>x", "a*", 10...
function crit(c) {
  if (c instanceof E) throw c;
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => v === c || (typeof v === 'string' && NUM.test(v) && numKey(v) === c);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(String(c ?? '')), op = m[1] || '=', rhs = m[2];
  const l = rhs === '' ? null : literal(rhs);
  if (l && typeof l.v === 'number') { const x = l.v; return (v) => { if (typeof v === 'string' && NUM.test(v)) v = numKey(v); if (typeof v !== 'number') return op === '<>'; const d = v - x; return op === '=' ? d === 0 : op === '<>' ? d !== 0 : op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0; }; }
  if (rhs === '') return op === '<>' ? (v) => v != null && v !== '' : (v) => v == null || v === '';
  if (op === '=' || op === '<>') {
    const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'i');
    return op === '=' ? (v) => re.test(str(v)) : (v) => !re.test(str(v));
  }
  return (v) => { if (typeof v !== 'string') return false; const d = coll.compare(v, rhs); return op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0; };
}
// pares (intervalo, critério) do *.SES: índices que passam em todos
function ifsMask(args, cx, from) {
  let size = null; const tests = [];
  for (let i = from; i + 1 < args.length; i += 2) {
    const rg = ev(args[i], cx); if (!rg || !rg.rg) throw ERRS['#VALUE!'];
    const vals = [...cells({ ...rg, r2: Math.min(rg.r2, rg.r1 + MAXR) }, cx)];
    tests.push([vals, crit(sv(args[i + 1], cx))]); size = size == null ? vals.length : Math.min(size, vals.length);
  }
  const ok = []; for (let k = 0; k < (size || 0); k++) ok.push(tests.every(([vals, f]) => f(vals[k])));
  return ok;
}
const rnd = (x, d, mode) => { const p = Math.pow(10, d), y = Math.abs(x) * p, r = mode === 'up' ? Math.ceil(y - 1e-9) : mode === 'down' ? Math.floor(y + 1e-9) : Math.round(y + 1e-9); return Math.sign(x) * r / p; };
const today = () => { const d = new Date(); return serial(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const dateParts = (v) => { const d = new Date(Math.round((num(v) - 25569) * 86400000)); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
function lookup(v, list, exact) {
  if (exact) { const k = list.findIndex(x => x != null && cmpVals(x, v) === 0); if (k < 0) throw ERRS['#N/A']; return k; }
  let best = -1; for (let k = 0; k < list.length; k++) { if (list[k] == null) continue; if (cmpVals(list[k], v) <= 0) best = k; else break; }
  if (best < 0) throw ERRS['#N/A']; return best;
}
const FN = {
  SUM: (a, cx) => nums(a, cx).reduce((s, x) => s + x, 0),
  AVERAGE: (a, cx) => { const n = nums(a, cx); if (!n.length) throw ERRS['#DIV/0!']; return n.reduce((s, x) => s + x, 0) / n.length; },
  MIN: (a, cx) => { const n = nums(a, cx); return n.length ? Math.min(...n) : 0; },
  MAX: (a, cx) => { const n = nums(a, cx); return n.length ? Math.max(...n) : 0; },
  COUNT: (a, cx) => { let k = 0; for (const x of flat(a, cx)) if (typeof x === 'number') k++; return k; },
  COUNTA: (a, cx) => { let k = 0; for (const x of flat(a, cx)) if (x != null && x !== '') k++; return k; },
  COUNTBLANK: (a, cx) => { let k = 0; for (const x of flat(a, cx)) if (x == null || x === '') k++; return k; },
  PRODUCT: (a, cx) => nums(a, cx).reduce((s, x) => s * x, 1),
  MEDIAN: (a, cx) => { const n = nums(a, cx).sort((x, y) => x - y); if (!n.length) throw ERRS['#NUM!']; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  SUMPRODUCT: (a, cx) => { const gs = a.map(x => { const v = ev(x, cx); return v && v.rg ? grid(v, cx).flat() : [scalar(v)]; }); let s = 0; for (let k = 0; k < gs[0].length; k++) s += gs.reduce((p, g) => p * (typeof g[k] === 'number' ? g[k] : 0), 1); return s; },
  ROUND: (a, cx) => rnd(num(sv(a[0], cx)), num(sv(a[1], cx))),
  ROUNDUP: (a, cx) => rnd(num(sv(a[0], cx)), num(sv(a[1], cx)), 'up'),
  ROUNDDOWN: (a, cx) => rnd(num(sv(a[0], cx)), num(sv(a[1], cx)), 'down'),
  INT: (a, cx) => Math.floor(num(sv(a[0], cx))),
  ABS: (a, cx) => Math.abs(num(sv(a[0], cx))),
  MOD: (a, cx) => { const n = num(sv(a[0], cx)), d = num(sv(a[1], cx)); if (!d) throw ERRS['#DIV/0!']; return n - d * Math.floor(n / d); },
  POWER: (a, cx) => Math.pow(num(sv(a[0], cx)), num(sv(a[1], cx))),
  SQRT: (a, cx) => { const n = num(sv(a[0], cx)); if (n < 0) throw ERRS['#NUM!']; return Math.sqrt(n); },
  PI: () => Math.PI,
  RAND: () => Math.random(),
  IF: (a, cx) => bool(sv(a[0], cx)) ? (a[1] ? sv(a[1], cx) : true) : (a[2] ? sv(a[2], cx) : false),
  IFERROR: (a, cx) => { try { const v = sv(a[0], cx); if (v instanceof E) return sv(a[1], cx); return v; } catch (e) { if (e instanceof E) return sv(a[1], cx); throw e; } },
  IFNA: (a, cx) => { try { const v = sv(a[0], cx); if (v === ERRS['#N/A']) return sv(a[1], cx); return v; } catch (e) { if (e === ERRS['#N/A']) return sv(a[1], cx); throw e; } },
  AND: (a, cx) => { let r = true; for (const x of flat(a, cx)) if (x != null && !bool(x)) r = false; return r; },
  OR: (a, cx) => { let r = false; for (const x of flat(a, cx)) if (x != null && bool(x)) r = true; return r; },
  NOT: (a, cx) => !bool(sv(a[0], cx)),
  CONCAT: (a, cx) => { let s = ''; for (const x of flat(a, cx)) s += str(x); return s; },
  CONCATENATE: (a, cx) => a.map(x => str(sv(x, cx))).join(''),
  LEN: (a, cx) => str(sv(a[0], cx)).length,
  UPPER: (a, cx) => str(sv(a[0], cx)).toUpperCase(),
  LOWER: (a, cx) => str(sv(a[0], cx)).toLowerCase(),
  PROPER: (a, cx) => str(sv(a[0], cx)).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, l) => p + l.toUpperCase()),
  TRIM: (a, cx) => str(sv(a[0], cx)).trim().replace(/ +/g, ' '),
  LEFT: (a, cx) => str(sv(a[0], cx)).slice(0, a[1] ? num(sv(a[1], cx)) : 1),
  RIGHT: (a, cx) => { const s = str(sv(a[0], cx)), n = a[1] ? num(sv(a[1], cx)) : 1; return n ? s.slice(-n) : ''; },
  MID: (a, cx) => { const s = str(sv(a[0], cx)), i = num(sv(a[1], cx)); if (i < 1) throw ERRS['#VALUE!']; return s.substr(i - 1, num(sv(a[2], cx))); },
  SUBSTITUTE: (a, cx) => { const s = str(sv(a[0], cx)), o = str(sv(a[1], cx)), n = str(sv(a[2], cx)); if (!o) return s; if (!a[3]) return s.split(o).join(n); let k = num(sv(a[3], cx)), i = -1; while (k-- > 0) { i = s.indexOf(o, i + 1); if (i < 0) return s; } return s.slice(0, i) + n + s.slice(i + o.length); },
  REPT: (a, cx) => str(sv(a[0], cx)).repeat(Math.max(0, num(sv(a[1], cx)))),
  VALUE: (a, cx) => num(sv(a[0], cx)),
  TODAY: () => today(),
  NOW: () => { const d = new Date(); return serial(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); },
  DATE: (a, cx) => serial(num(sv(a[0], cx)), num(sv(a[1], cx)), num(sv(a[2], cx))),
  YEAR: (a, cx) => dateParts(sv(a[0], cx))[0],
  MONTH: (a, cx) => dateParts(sv(a[0], cx))[1],
  DAY: (a, cx) => dateParts(sv(a[0], cx))[2],
  ISBLANK: (a, cx) => { const v = sv(a[0], cx); return v == null || v === ''; },
  ISNUMBER: (a, cx) => typeof sv(a[0], cx) === 'number',
  ISTEXT: (a, cx) => typeof sv(a[0], cx) === 'string',
  ISERROR: (a, cx) => { try { return sv(a[0], cx) instanceof E; } catch (e) { if (e instanceof E) return true; throw e; } },
  SUMIF: (a, cx) => {
    const rg = ev(a[0], cx), f = crit(sv(a[1], cx)), sum = a[2] ? ev(a[2], cx) : rg; if (!rg?.rg || !sum?.rg) throw ERRS['#VALUE!'];
    const keys = [...cells(rg, cx)], vals = [...cells({ ...sum, r2: sum.r1 + (rg.r2 - rg.r1), c2: sum.c1 + (rg.c2 - rg.c1) }, cx)];
    let s = 0; keys.forEach((k, i) => { if (f(k) && typeof vals[i] === 'number') s += vals[i]; }); return s;
  },
  COUNTIF: (a, cx) => { const rg = ev(a[0], cx), f = crit(sv(a[1], cx)); if (!rg?.rg) throw ERRS['#VALUE!']; let k = 0; for (const x of cells(rg, cx)) if (f(x)) k++; return k; },
  AVERAGEIF: (a, cx) => {
    const rg = ev(a[0], cx), f = crit(sv(a[1], cx)), av = a[2] ? ev(a[2], cx) : rg; if (!rg?.rg || !av?.rg) throw ERRS['#VALUE!'];
    const keys = [...cells(rg, cx)], vals = [...cells({ ...av, r2: av.r1 + (rg.r2 - rg.r1), c2: av.c1 + (rg.c2 - rg.c1) }, cx)];
    let s = 0, n = 0; keys.forEach((k, i) => { if (f(k) && typeof vals[i] === 'number') { s += vals[i]; n++; } }); if (!n) throw ERRS['#DIV/0!']; return s / n;
  },
  SUMIFS: (a, cx) => { const sum = ev(a[0], cx); if (!sum?.rg) throw ERRS['#VALUE!']; const vals = [...cells(sum, cx)], ok = ifsMask(a, cx, 1); return ok.reduce((s, y, k) => s + (y && typeof vals[k] === 'number' ? vals[k] : 0), 0); },
  COUNTIFS: (a, cx) => ifsMask(a, cx, 0).filter(Boolean).length,
  MAXIFS: (a, cx) => { const v = [...cells(ev(a[0], cx), cx)], ok = ifsMask(a, cx, 1), n = v.filter((x, k) => ok[k] && typeof x === 'number'); return n.length ? Math.max(...n) : 0; },
  MINIFS: (a, cx) => { const v = [...cells(ev(a[0], cx), cx)], ok = ifsMask(a, cx, 1), n = v.filter((x, k) => ok[k] && typeof x === 'number'); return n.length ? Math.min(...n) : 0; },
  VLOOKUP: (a, cx) => {
    const v = sv(a[0], cx), rg = ev(a[1], cx), col = num(sv(a[2], cx)), exact = a[3] ? !bool(sv(a[3], cx)) : false;
    if (!rg?.rg) throw ERRS['#VALUE!']; if (col < 1 || col > rg.c2 - rg.c1 + 1) throw ERRS['#REF!'];
    const r2 = Math.min(rg.r2, rg.sh.rows.length - 1), keys = []; for (let r = rg.r1; r <= r2; r++) keys.push(cellVal(rg.sh, r, rg.c1, cx));
    return cellVal(rg.sh, rg.r1 + lookup(v, keys, exact), rg.c1 + col - 1, cx);
  },
  HLOOKUP: (a, cx) => {
    const v = sv(a[0], cx), rg = ev(a[1], cx), row = num(sv(a[2], cx)), exact = a[3] ? !bool(sv(a[3], cx)) : false;
    if (!rg?.rg) throw ERRS['#VALUE!']; if (row < 1 || row > rg.r2 - rg.r1 + 1) throw ERRS['#REF!'];
    const keys = []; for (let c = rg.c1; c <= rg.c2; c++) keys.push(cellVal(rg.sh, rg.r1, c, cx));
    return cellVal(rg.sh, rg.r1 + row - 1, rg.c1 + lookup(v, keys, exact), cx);
  },
  INDEX: (a, cx) => {
    const rg = ev(a[0], cx); if (!rg?.rg) return scalar(rg);
    let r = num(sv(a[1], cx)), c = a[2] ? num(sv(a[2], cx)) : 1;
    if (rg.r1 === rg.r2 && !a[2]) { c = r; r = 1; }
    if (r < 1 || c < 1 || rg.r1 + r - 1 > rg.r2 || rg.c1 + c - 1 > rg.c2) throw ERRS['#REF!'];
    return cellVal(rg.sh, rg.r1 + r - 1, rg.c1 + c - 1, cx);
  },
  MATCH: (a, cx) => {
    const v = sv(a[0], cx), rg = ev(a[1], cx), type = a[2] ? num(sv(a[2], cx)) : 1; if (!rg?.rg) throw ERRS['#N/A'];
    const list = rg.r1 === rg.r2 ? grid(rg, cx)[0] : [...cells({ ...rg, c2: rg.c1 }, cx)];
    if (type === 0) return lookup(v, list, true) + 1;
    if (type > 0) return lookup(v, list, false) + 1;
    let best = -1; for (let k = 0; k < list.length; k++) { if (list[k] == null) continue; if (cmpVals(list[k], v) >= 0) best = k; else break; }
    if (best < 0) throw ERRS['#N/A']; return best + 1;
  },
};
FN.AVERAGEA = FN.AVERAGE;

// ===== modelo da planilha =====
// rows[r][c]: undefined (vazia), texto (CSV) ou { v, f?, s?, si?, fa? }: valor (número, texto, lógico, E ou null),
// fórmula sem o "=", estilo, índice do texto compartilhado do .xlsx e intervalo da fórmula matricial
const cellAt = (sh, r, c) => { const row = sh.rows[r]; return row ? row[c] : undefined; };
const styleOf = (x) => x && typeof x === 'object' ? x.s : undefined;
const csvVal = (s) => s === '' ? null : NUM.test(s) ? numKey(s) : s;
// valor de uma célula para as fórmulas (calcula a fórmula dela, se tiver)
function cellVal(sh, r, c, cx, x) {
  if (x === undefined) x = cellAt(sh, r, c);
  if (x == null) return null;
  if (typeof x === 'string') return sh.csv ? csvVal(x) : x;
  if (x.f != null && cx) return calcCell(sh, r, c, x, cx);
  const v = x.v;
  return sh.csv && typeof v === 'string' ? csvVal(v) : v === '' ? null : v;
}
function calcCell(sh, r, c, x, cx) {
  let m = cx.memo.get(sh); if (!m) cx.memo.set(sh, m = new Map());
  const key = r * MAXC + c;
  if (m.has(key)) return m.get(key);
  const sk = sh.uid + ':' + key;
  if (cx.stack.has(sk)) { cx.circ = true; return 0; }
  cx.stack.add(sk);
  let v;
  try { v = scalar(evaluate(astOf(x.f), { ...cx, sh })); if (v == null) v = 0; }
  catch (e) {
    if (e instanceof E) v = e;
    else if (e instanceof Unsupported) v = x.v ?? ERRS['#NAME?']; // função que o motor não conhece: fica o valor que o arquivo trouxe
    else v = ERRS['#VALUE!'];
  }
  cx.stack.delete(sk);
  x.v = v; m.set(key, v);
  return v;
}
// recalcula as fórmulas das planilhas abertas
function recalc(t) {
  const book = t.sh.sheets, cx = { book, memo: new Map(), stack: new Set(), circ: false };
  for (const s of book) {
    const sh = s.data; if (!sh || !sh.hasF) continue;
    for (let r = 0; r < sh.rows.length; r++) { const row = sh.rows[r]; if (!row) continue; for (let c = 0; c < row.length; c++) { const x = row[c]; if (x && typeof x === 'object' && x.f != null) calcCell(sh, r, c, x, { ...cx, sh }); } }
  }
  if (cx.circ) toast('Referência circular: uma fórmula depende dela mesma', '', 'sh-circ');
}
// texto mostrado na célula
function show(sh, x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  const v = x.v, s = x.s;
  if (v == null) return '';
  if (v instanceof E) return v.code;
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
  if (typeof v === 'number') {
    if (!s || isGeneral(s.nf)) return general(v);
    if (isDateStyle(s)) return fmtDate(v, s.nf, sh && sh.d1904);
    return fmtNum(v, s.nf);
  }
  if (sh && sh.csv && s && !isGeneral(s.nf) && NUM.test(v)) return isDateStyle(s) ? fmtDate(numKey(v), s.nf) : fmtNum(numKey(v), s.nf);
  return v;
}
// texto que vai para a caixa de edição
function editText(sh, x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (x.f != null) return '=' + x.f;
  const v = x.v;
  if (v == null) return '';
  if (v instanceof E) return v.code;
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
  if (typeof v === 'number') {
    const s = x.s;
    if (isDateStyle(s)) { const b = bare(s.nf).toLowerCase(); return fmtDate(v, /h|s/.test(b) ? 'dd/mm/yyyy hh:mm:ss' : v % 1 ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy', sh && sh.d1904); }
    if (s && /%/.test(bare(s.nf))) return String(parseFloat((v * 100).toPrecision(15))).replace('.', ',') + '%';
    return String(parseFloat(v.toPrecision(15))).replace('.', ',');
  }
  return String(v);
}
const isNumCell = (x) => typeof x === 'string' ? NUM.test(x) : !!x && typeof x.v === 'number';
const baseStyle = (sh) => (sh.book && sh.book.styles[0]) || DEF_STYLE;
// o que foi digitado vira célula (null + erro quando a fórmula não fecha)
function inputCell(sh, text, old) {
  const s = styleOf(old);
  if (text === '') return { x: s ? { v: null, s } : undefined };
  if (text[0] === '=' && text.length > 1) {
    const f = normFormula(text.slice(1));
    try { parse(f); } catch (e) { if (!(e instanceof Unsupported)) return { error: 'Fórmula inválida: ' + e.message }; }
    let st = s;
    if (/^(TODAY|NOW|DATE)\(/.test(f) && (!s || isGeneral(s.nf))) st = restyle(s || baseStyle(sh), { nf: f.startsWith('NOW') ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy' });
    return { x: { f, v: null, s: st } };
  }
  if (sh.csv) return { x: s ? { v: text, s } : text };
  if (text[0] === "'") return { x: { v: text.slice(1), s } };
  if (s && s.nf === '@') return { x: { v: text, s } };
  const l = literal(text);
  let st = s;
  if (l.nf && (!s || isGeneral(s.nf))) st = restyle(s || baseStyle(sh), { nf: l.nf });
  return { x: { v: l.v, s: st } };
}
function put(sh, r, c, x) {
  let row = sh.rows[r];
  if (!row) { if (x === undefined) return; row = sh.rows[r] = []; }
  row[c] = x;
  if (x !== undefined) { if (c >= sh.ncol) sh.ncol = c + 1; if (x && x.f != null) sh.hasF = true; }
}

// ===== tabela =====
function autoWidth(sh, c) {
  let n = 0;
  for (let r = 0; r < Math.min(sh.rows.length, 400); r++) { const x = cellAt(sh, r, c); if (x != null) { const s = show(sh, x); if (s.length > n) n = s.length; } }
  return Math.max(56, Math.min(380, 24 + n * 7.6));
}
let UID = 0;
// planilha da aba: { rows, ncol, head, view (linhas visíveis), sort, filter, sel, w (larguras), csv, book... }
function prepare(t, data, opt) {
  const rows = data.rows; let ncol = 0;
  for (let r = 0; r < rows.length; r++) { const row = rows[r]; if (row && row.length > ncol) ncol = row.length; }
  const empty = (row) => !row || !row.some(x => x != null && (typeof x !== 'object' || x.v != null || x.f != null || x.s));
  while (rows.length && empty(rows[rows.length - 1])) rows.pop();
  const sh = { uid: ++UID, rows, rowAttr: data.rowAttr || [], ncol, sort: null, filter: '', sel: { k: 0, c: 0, k2: 0, c2: 0 }, ver: 0, ops: [], ...opt };
  // CSV: o que começa com "=" e é uma fórmula válida vira fórmula
  if (sh.csv) for (const row of rows) if (row) for (let c = 0; c < row.length; c++) {
    const v = row[c];
    if (typeof v === 'string' && v.length > 1 && v[0] === '=') { try { parse(v.slice(1)); row[c] = { f: v.slice(1), v: null }; sh.hasF = true; } catch {} }
  }
  if (!sh.csv) for (const row of rows) if (row && !sh.hasF) for (const x of row) if (x && x.f != null) { sh.hasF = true; break; }
  // primeira linha como cabeçalho: lembrada por arquivo; sem escolha, no CSV quando ela só tem texto e a de baixo
  // tem número; no .xlsx quando ela está congelada
  const saved = (store.get('sheetHead', {}) || {})[t.path + (opt.name && !sh.csv ? '#' + opt.name : '')];
  const r0 = rows[0] || [], r1 = rows[1] || [];
  const guess = sh.csv ? r0.length > 0 && [...r0].every(x => x && !isNumCell(x)) && (r1.some(isNumCell) || rows.length > 1) : !!data.frozen;
  sh.head = saved ?? guess;
  sh.w = [];
  for (let c = 0; c < ncol + XC; c++) sh.w[c] = data.colW && data.colW[c] != null ? data.colW[c] || 0 : c < ncol ? autoWidth(sh, c) : DEF_W;
  apply(sh);
  return sh;
}
const ensureCols = (sh) => { while (sh.w.length < sh.ncol + XC) sh.w.push(DEF_W); };
// linhas visíveis: filtro e ordenação (sem mexer nos dados); sem filtro, algumas linhas vazias depois do fim
function apply(sh) {
  const start = sh.head ? 1 : 0;
  let v = []; for (let i = start; i < sh.rows.length; i++) v.push(i);
  const q = sh.filter.trim().toLowerCase();
  if (q) v = v.filter(i => (sh.rows[i] || []).some(x => x != null && show(sh, x).toLowerCase().includes(q)));
  if (sh.sort) {
    const { c, dir } = sh.sort, key = (i) => { const x = cellAt(sh, i, c); return x == null || show(sh, x) === '' ? null : typeof x === 'string' ? (NUM.test(x) ? numKey(x) : x) : typeof x.v === 'number' ? x.v : show(sh, x); };
    const keys = new Map(v.map(i => [i, key(i)]));
    v.sort((a, b) => {
      const x = keys.get(a), y = keys.get(b);
      if ((x == null) !== (y == null)) return x == null ? 1 : -1; // vazios sempre no fim
      if (x == null) return 0;
      if (typeof x !== typeof y) return dir * (typeof x === 'number' ? -1 : 1);
      return dir * (typeof x === 'number' ? x - y : coll.compare(x, y));
    });
  }
  if (!q && !sh.sort) { const end = Math.max(sh.rows.length, start); for (let i = 0; i < XR; i++) v.push(end + i); }
  sh.view = v;
  ensureCols(sh);
  sh.x = [0]; for (const w of sh.w) sh.x.push(sh.x[sh.x.length - 1] + w);
}
const colAt = (sh, px) => { let lo = 0, hi = sh.w.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (sh.x[m] <= px) lo = m; else hi = m - 1; } return lo; };
// linha de dados na posição k da tabela (abaixo do fim da lista, continua contando)
const rowOf = (sh, k) => k < sh.view.length ? sh.view[k] : sh.view.length ? sh.view[sh.view.length - 1] + k - sh.view.length + 1 : k + (sh.head ? 1 : 0);
// posição (na tabela) da última linha com dados
const lastDataK = (sh) => sh.filter || sh.sort ? Math.max(0, sh.view.length - 1) : Math.max(0, sh.rows.length - 1 - (sh.head ? 1 : 0));
const rect = (sel) => ({ k1: Math.min(sel.k, sel.k2), k2: Math.max(sel.k, sel.k2), c1: Math.min(sel.c, sel.c2), c2: Math.max(sel.c, sel.c2) });

const ICON = {
  filter: '<svg class="i" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
  undo: '<svg class="i" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/></svg>',
  redo: '<svg class="i" viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/></svg>',
  left: '<svg class="i" viewBox="0 0 24 24"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>',
  center: '<svg class="i" viewBox="0 0 24 24"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>',
  right: '<svg class="i" viewBox="0 0 24 24"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>',
  border: '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/><path d="M12 4v16M4 12h16" stroke-dasharray="2 2"/></svg>',
  fill: '<svg class="i" viewBox="0 0 24 24"><path d="m5 12 7-7 7 7-7 7z"/><path d="M19 15s2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5"/></svg>',
  eraser: '<svg class="i" viewBox="0 0 24 24"><path d="m7 21-4-4 10-10 7 7-7 7z"/><path d="M8 12l7 7M7 21h14"/></svg>',
  save: '<svg class="i" viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h8V3M8 21v-7h8v7"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};
const NF_LIST = [['General', 'Geral'], ['#,##0.00', 'Número'], [CURRENCY, 'Moeda (R$)'], ['0.00%', 'Porcentagem'], ['dd/mm/yyyy', 'Data'], ['dd/mm/yyyy hh:mm', 'Data e hora'], ['hh:mm:ss', 'Hora'], ['0.00E+00', 'Científico'], ['@', 'Texto']];
const PALETTE = ['#000000', '#ffffff', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47',
  '#7f7f7f', '#f2f2f2', '#d0cece', '#d6dce4', '#d9e1f2', '#fce4d6', '#ededed', '#fff2cc', '#ddebf7', '#e2efda',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

function build(t, el) {
  t.sh = { cur: 0, sheets: null, undo: [], redo: [] };
  const csv = EXT[extOf(t.path)] === 'csv';
  el.innerHTML = FV.bar(t, `${csv ? `<select class="sh-delim" data-delim title="Separador das colunas"><option value="">separador: automático</option><option value=",">vírgula ( , )</option><option value=";">ponto e vírgula ( ; )</option><option value="&#9;">tabulação</option><option value="|">barra ( | )</option></select>` : ''}
      <label class="sh-chk" title="Usar a primeira linha como nome das colunas"><input type="checkbox" data-head> cabeçalho</label>
      <span class="sh-find">${ICON.filter}<input data-q placeholder="Filtrar linhas" spellcheck="false"></span>
      ${csv ? '<button class="chip" data-a="text" title="Abrir o arquivo no editor de texto">Editar como texto</button><button class="chip" data-xlsx title="Grava uma cópia .xlsx, com a formatação">Salvar como .xlsx</button>' : ''}
      <button class="chip primary" data-save hidden title="Salvar (Ctrl+S)">${ICON.save}Salvar</button>`)
    + `<div class="sh-tb" data-tb>
        <button class="icon-btn" data-cmd="undo" title="Desfazer (Ctrl+Z)">${ICON.undo}</button><button class="icon-btn" data-cmd="redo" title="Refazer (Ctrl+Y)">${ICON.redo}</button><span class="sh-sep"></span>
        <button class="icon-btn sh-tx" data-cmd="b" title="Negrito (Ctrl+B)"><b>N</b></button><button class="icon-btn sh-tx" data-cmd="i" title="Itálico (Ctrl+I)"><i>I</i></button><button class="icon-btn sh-tx" data-cmd="u" title="Sublinhado (Ctrl+U)"><u>S</u></button><button class="icon-btn sh-tx" data-cmd="s" title="Tachado (Ctrl+5)"><s>abc</s></button><span class="sh-sep"></span>
        <button class="icon-btn sh-color" data-cmd="fc" title="Cor do texto"><b class="sh-a">A</b><span class="sh-bar" data-fcbar></span></button><button class="icon-btn sh-color" data-cmd="bg" title="Cor de preenchimento">${ICON.fill}<span class="sh-bar" data-bgbar></span></button><span class="sh-sep"></span>
        <button class="icon-btn" data-cmd="left" title="Alinhar à esquerda">${ICON.left}</button><button class="icon-btn" data-cmd="center" title="Centralizar">${ICON.center}</button><button class="icon-btn" data-cmd="right" title="Alinhar à direita">${ICON.right}</button><button class="icon-btn" data-cmd="border" title="Bordas em volta das células">${ICON.border}</button><span class="sh-sep"></span>
        <select class="sh-nf" data-nf title="Formato do número">${NF_LIST.map(([v, l]) => `<option value="${esc(v)}">${l}</option>`).join('')}<option value="" hidden>Personalizado</option></select>
        <button class="icon-btn sh-tx" data-cmd="dec+" title="Mais casas decimais">,0<small>+</small></button><button class="icon-btn sh-tx" data-cmd="dec-" title="Menos casas decimais">,0<small>−</small></button><span class="sh-sep"></span>
        <button class="icon-btn sh-tx" data-cmd="sum" title="AutoSoma: soma os números acima (ou os selecionados)">Σ</button><button class="icon-btn" data-cmd="clear" title="Limpar formatação">${ICON.eraser}</button>
        ${csv ? '<span class="sh-note" title="CSV guarda só os valores. A formatação aparece aqui; para gravá-la, salve como .xlsx.">CSV: formatação só no .xlsx</span>' : ''}
      </div>
      <div class="sh-fx"><input class="sh-ref" data-ref spellcheck="false" title="Célula selecionada (digite uma, como B12, e Enter para ir até ela)"><span class="sh-fxi">fx</span><input class="sh-val" data-val spellcheck="false" title="Conteúdo da célula. Fórmulas começam com = e aceitam o jeito brasileiro (SOMA(A1;A2)) ou o do arquivo (SUM(A1,A2))."><span class="sh-stats" data-stats></span></div>
      <div class="sh-grid" data-grid tabindex="0"><div class="sh-head" data-headrow><div class="sh-hin" data-hin></div><div class="sh-corner" data-corner title="Selecionar tudo (Ctrl+A)"></div></div>
        <div class="sh-body" data-body><div class="sh-space" data-space></div><div class="sh-rows" data-rows></div><input class="sh-ed" data-ed spellcheck="false" hidden></div></div>
      <div class="sh-tabs" data-tabs hidden></div><div class="sh-pop" data-pop hidden></div>`;
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => FV.act(t, b.dataset.a));
  $('[data-save]').onclick = () => save(t);
  const xb = $('[data-xlsx]'); if (xb) xb.onclick = () => saveAsXlsx(t);
  const body = $('[data-body]');
  body.addEventListener('scroll', () => draw(t), { passive: true });
  t.sh.ro = new ResizeObserver(() => draw(t)); t.sh.ro.observe(body);
  let qt; $('[data-q]').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { const s = cur(t); if (!s) return; s.filter = e.target.value; apply(s); s.sel = { k: 0, c: s.sel.c, k2: 0, c2: s.sel.c }; body.scrollTop = 0; render(t); }, 160); };
  $('[data-head]').onchange = (e) => {
    const s = cur(t); if (!s) return; commitEdit(t); s.head = e.target.checked;
    const m = store.get('sheetHead', {}) || {}; m[t.path + (s.csv ? '' : '#' + s.name)] = s.head; store.set('sheetHead', m);
    apply(s); render(t);
  };
  const dl = $('[data-delim]'); if (dl) dl.onchange = () => {
    if (t.dirty) { toast('Salve ou desfaça as alterações antes de trocar o separador'); dl.value = t.sh.delim || ''; return; }
    t.sh.delim = dl.value; load(t);
  };
  // barra de formatação
  $('[data-tb]').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // o foco fica na tabela
  $('[data-tb]').addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) cmd(t, b.dataset.cmd, b); });
  $('[data-nf]').onchange = (e) => { const v = e.target.value; formatCells(t, () => ({ nf: v }), 'Formato do número'); grid0(t).focus(); };
  // célula e barra de fórmulas
  const ed = $('[data-ed]'), val = $('[data-val]'), ref = $('[data-ref]');
  ed.addEventListener('keydown', (e) => edKey(t, e, ed));
  ed.addEventListener('input', () => { val.value = ed.value; });
  ed.addEventListener('blur', () => { if (t.sh && t.sh.edit && t.sh.edit.el === ed) commitEdit(t); });
  val.addEventListener('focus', () => { const s = cur(t); if (!s || (t.sh.edit && t.sh.edit.el === ed)) return; const r = rowOf(s, s.sel.k); t.sh.edit = { el: val, r, c: s.sel.c, start: val.value }; });
  val.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (commitEdit(t)) { move(t, e.key === 'Tab' ? 0 : e.shiftKey ? -1 : 1, e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0); grid0(t).focus(); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(t); grid0(t).focus(); }
    else e.stopPropagation();
  });
  val.addEventListener('blur', () => { if (t.sh && t.sh.edit && t.sh.edit.el === val) commitEdit(t); });
  ref.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { fx(t); grid0(t).focus(); }
    if (e.key !== 'Enter') return;
    const s = cur(t), m = /^\s*([A-Za-z]{1,3})(\d+)\s*$/.exec(ref.value); if (!s || !m) return toast('Digite uma célula, como B12');
    const r = +m[2] - 1, c = colNum(m[1]); let k = s.view.indexOf(r);
    if (k < 0) { if (s.filter || s.sort || r < (s.head ? 1 : 0)) return toast('Essa linha não está visível (filtro, ordenação ou cabeçalho)'); k = s.view.length + r - rowOf(s, s.view.length); }
    s.sel = { k, c, k2: k, c2: c }; while (s.w.length <= c) s.w.push(DEF_W); apply(s); render(t); reveal(t); grid0(t).focus();
  });
  // mouse: células, cabeçalhos, alças de largura
  const g = $('[data-grid]');
  body.addEventListener('mousedown', (e) => down(t, e, 'cell'));
  $('[data-hin]').addEventListener('mousedown', (e) => down(t, e, e.target.closest('[data-rz]') ? 'rz' : 'col'));
  $('[data-corner]').addEventListener('mousedown', (e) => { e.preventDefault(); selectAll(t); g.focus(); });
  body.addEventListener('dblclick', (e) => { if (e.target.closest('[data-c]') && !e.target.closest('.sh-rn')) startEdit(t, null); });
  $('[data-hin]').addEventListener('dblclick', (e) => { const z = e.target.closest('[data-rz]'); if (z) autoFit(t, +z.dataset.rz); });
  g.addEventListener('contextmenu', (e) => ctxMenu(t, e));
  g.addEventListener('keydown', (e) => key(t, e));
  g.addEventListener('copy', (e) => copy(t, e, false));
  g.addEventListener('cut', (e) => copy(t, e, true));
  g.addEventListener('paste', (e) => { if (e.target.closest('input')) return; e.preventDefault(); paste(t, e.clipboardData.getData('text/plain')); });
  load(t);
}
const cur = (t) => t.sh && t.sh.sheets && t.sh.sheets[t.sh.cur] && t.sh.sheets[t.sh.cur].data;
const grid0 = (t) => t.el.querySelector('[data-grid]');

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
    t.sh.undo = []; t.sh.redo = []; t.sh.edit = null;
    if (EXT[extOf(t.path)] === 'csv') {
      const { text, enc, bom } = decode(buf);
      const d = t.sh.delim || (extOf(t.path) === 'csv' ? sniff(text) : '\t');
      t.sh.csvOpt = { d, enc, bom, eol: /\r\n/.test(text.slice(0, 200000)) ? '\r\n' : '\n', trail: /[\r\n]$/.test(text) };
      t.sh.book = null;
      t.sh.sheets = [{ name: 'CSV', data: prepare(t, { rows: parseCSV(text, d) }, { csv: true, name: 'CSV' }) }];
      t.sh.info = `${enc} · separador ${({ ',': 'vírgula', ';': 'ponto e vírgula', '\t': 'tabulação', '|': 'barra' })[d] || JSON.stringify(d)}`;
    } else {
      // arquivo vazio (criado pela IDE): pasta de trabalho nova, gravada inteira ao salvar
      const book = buf.byteLength ? await openBook(buf) : await blankBook();
      t.sh.book = book; t.sh.sheets = book.sheets; t.sh.info = buf.byteLength ? '' : 'nova';
      if (!buf.byteLength) book.fresh = true;
      if (!t.sh.sheets.length) return msg('A pasta de trabalho não tem planilhas.');
    }
    t.sh.clean = null; setDirty(t, false);
    const i = keep ? t.sh.sheets.findIndex(s => s.name === keep) : -1;
    await pick(t, i >= 0 ? i : Math.max(0, t.sh.sheets.findIndex(s => !s.hidden)));
  } catch (e) { msg(`Não deu para ler a planilha: ${esc(e.message)}`); }
}
async function ensure(t, s) {
  if (s.data) return s.data;
  s.data = prepare(t, await s.load(), { name: s.name, book: t.sh.book, d1904: t.sh.book.d1904 });
  return s.data;
}
async function pick(t, i) {
  commitEdit(t);
  const s = t.sh.sheets[i]; t.sh.cur = i;
  if (!s.data) {
    t.el.querySelector('[data-rows]').innerHTML = '<div class="vw-msg">Lendo a planilha…</div>';
    try { await ensure(t, s); } catch (e) { t.el.querySelector('[data-rows]').innerHTML = `<div class="vw-msg">Não deu para ler "${esc(s.name)}": ${esc(e.message)}</div>`; return; }
  }
  tabs(t);
  const sh = s.data;
  t.el.querySelector('[data-head]').checked = sh.head;
  t.el.querySelector('[data-q]').value = sh.filter;
  t.el.querySelector('[data-body]').scrollTop = 0;
  render(t);
  if (t.goLine) { const n = t.goLine; t.goLine = 0; FV.custom.sheet.goto(t, n); }
}
function tabs(t) {
  const el = t.el.querySelector('[data-tabs]'), csv = !t.sh.book;
  el.hidden = csv;
  if (csv) return;
  el.innerHTML = t.sh.sheets.map((x, k) => `<button class="sh-tab ${k === t.sh.cur ? 'on' : ''} ${x.hidden ? 'hid' : ''}" data-k="${k}" title="${x.hidden ? 'Planilha oculta · ' : ''}Dois cliques para renomear">${esc(x.name)}</button>`).join('')
    + `<button class="sh-tab sh-add" data-addsheet title="Nova planilha">${ICON.plus}</button>`;
  el.querySelectorAll('[data-k]').forEach(b => { b.onclick = () => { if (+b.dataset.k !== t.sh.cur) pick(t, +b.dataset.k); }; b.ondblclick = () => renameSheet(t, +b.dataset.k, b); });
  el.querySelector('[data-addsheet]').onclick = () => addSheet(t);
}
// cabeçalho, tamanho total e o que está à vista
function render(t) {
  const sh = cur(t); if (!sh) return;
  const el = t.el, digits = String(rowOf(sh, sh.view.length - 1) + 1).length;
  sh.rnw = Math.max(40, 16 + digits * 8);
  sh.total = sh.rnw + sh.x[sh.x.length - 1];
  el.querySelector('[data-corner]').style.width = sh.rnw + 'px';
  el.querySelector('[data-space]').style.cssText = `height:${sh.view.length * RH}px;width:${sh.total}px`;
  t.sh.drawn = null; draw(t);
  const n = sh.rows.length - (sh.head ? 1 : 0);
  t.dims = `${(sh.filter ? sh.view.length : Math.max(0, n)).toLocaleString('pt-BR')}${sh.filter ? ' de ' + Math.max(0, n).toLocaleString('pt-BR') : ''} linhas × ${sh.ncol} colunas${t.sh.info ? ' · ' + t.sh.info : ''}`;
  const m = el.querySelector('[data-meta]'); if (m) m.textContent = [t.dims, FV.size(t.size)].filter(Boolean).join(' · ');
  fx(t);
}
function draw(t) {
  const sh = cur(t); if (!sh || !t.el) return;
  const body = t.el.querySelector('[data-body]');
  const top = body.scrollTop, left = body.scrollLeft;
  const k0 = Math.max(0, Math.floor(top / RH) - 6), k1 = Math.min(sh.view.length, Math.ceil((top + body.clientHeight) / RH) + 6);
  const c0 = Math.max(0, colAt(sh, Math.max(0, left)) - 1), c1 = Math.min(sh.w.length, colAt(sh, left + body.clientWidth) + 2);
  const sel = rect(sh.sel), drawn = [k0, k1, c0, c1, sel.k1, sel.k2, sel.c1, sel.c2, sh.sel.k, sh.sel.c, sh.ver, sh.head].join(':');
  if (t.sh.drawn === drawn) return; t.sh.drawn = drawn;
  const fullRow = sel.c1 === 0 && sel.c2 >= sh.w.length - 1, fullCol = sel.k1 === 0 && sel.k2 >= sh.view.length - 1;
  // cabeçalho das colunas (letra ou o nome da primeira linha)
  const hr = sh.head ? sh.rows[0] || [] : [];
  const arrow = (c) => sh.sort && sh.sort.c === c ? `<span class="sh-arr">${sh.sort.dir === 1 ? '▲' : '▼'}</span>` : '';
  let head = `<div style="width:${sh.rnw + sh.x[c0]}px;flex:none"></div>`;
  for (let c = c0; c < c1; c++) {
    const name = sh.head && hr[c] != null ? show(sh, hr[c]) : '';
    head += `<div class="sh-h${c >= sel.c1 && c <= sel.c2 ? (fullCol ? ' all' : ' hl') : ''}" data-c="${c}" style="width:${sh.w[c]}px" title="Coluna ${colName(c)}${name ? ': ' + esc(name) : ''} · botão direito: ordenar, inserir, excluir"><span>${esc(name || colName(c))}</span>${arrow(c)}<i class="sh-rz" data-rz="${c}"></i></div>`;
  }
  const hin = t.el.querySelector('[data-hin]');
  hin.style.width = sh.total + 'px'; hin.style.transform = `translateX(${-left}px)`; hin.innerHTML = head;
  let html = '';
  for (let k = k0; k < k1; k++) {
    const r = sh.view[k], row = sh.rows[r] || [], inRow = k >= sel.k1 && k <= sel.k2;
    html += `<div class="sh-r" data-k="${k}" style="top:${k * RH}px;width:${sh.total}px"><div class="sh-rn${inRow ? (fullRow ? ' all' : ' hl') : ''}" data-rn="${k}" style="width:${sh.rnw}px">${r + 1}</div><div style="width:${sh.x[c0]}px;flex:none"></div>`;
    for (let c = c0; c < c1; c++) {
      const x = row[c], txt = x == null ? '' : show(sh, x), s = styleOf(x);
      let cls = 'sh-c';
      if (x != null && (s?.ha ? false : isNumCell(x) || (typeof x === 'object' && typeof x.v === 'number'))) cls += ' n';
      if (x != null && typeof x === 'object') { if (x.f != null) cls += ' f'; if (x.v instanceof E) cls += ' e'; if (typeof x.v === 'boolean') cls += ' bo'; }
      if (inRow && c >= sel.c1 && c <= sel.c2) cls += k === sh.sel.k && c === sh.sel.c ? ' on' : ' in';
      html += `<div class="${cls}" data-c="${c}" style="width:${sh.w[c]}px;${css(s)}">${esc(txt)}</div>`;
    }
    html += '</div>';
  }
  if (!sh.view.length) html = `<div class="vw-msg">${sh.filter ? 'Nenhuma linha com esse texto.' : 'Planilha vazia.'}</div>`;
  t.el.querySelector('[data-rows]').innerHTML = html;
}
// barra de fórmulas, endereço, estado dos botões e soma da seleção
function fx(t) {
  const sh = cur(t), el = t.el; if (!sh) return;
  const ref = el.querySelector('[data-ref]'), val = el.querySelector('[data-val]'), stats = el.querySelector('[data-stats]');
  const sel = rect(sh.sel), r = rowOf(sh, sh.sel.k), x = cellAt(sh, r, sh.sel.c);
  const multi = sel.k1 !== sel.k2 || sel.c1 !== sel.c2;
  if (document.activeElement !== ref) ref.value = multi ? `${colName(sel.c1)}${rowOf(sh, sel.k1) + 1}:${colName(sel.c2)}${rowOf(sh, sel.k2) + 1}` : colName(sh.sel.c) + (r + 1);
  if (!t.sh.edit) val.value = editText(sh, x);
  // estado da barra: o da célula ativa
  const s = styleOf(x) || {};
  for (const k of ['b', 'i', 'u', 's']) el.querySelector(`[data-cmd="${k}"]`).classList.toggle('on', !!s[k]);
  for (const k of ['left', 'center', 'right']) el.querySelector(`[data-cmd="${k}"]`).classList.toggle('on', s.ha === k);
  el.querySelector('[data-cmd="border"]').classList.toggle('on', !!s.bd);
  const nf = el.querySelector('[data-nf]'), code = s.nf || 'General';
  nf.value = NF_LIST.some(([v]) => v === code) ? code : isGeneral(code) ? 'General' : '';
  el.querySelector('[data-fcbar]').style.background = t.sh.lastFc || '#e03131';
  el.querySelector('[data-bgbar]').style.background = t.sh.lastBg || '#ffd43b';
  el.querySelector('[data-cmd="undo"]').disabled = !t.sh.undo.length;
  el.querySelector('[data-cmd="redo"]').disabled = !t.sh.redo.length;
  // soma, média e contagem da seleção (como a barra de status do Excel)
  let txt = '';
  if (multi) {
    let n = 0, cnt = 0, sum = 0, seen = 0;
    for (let k = sel.k1; k <= sel.k2 && seen < 300000; k++) {
      const row = sh.rows[rowOf(sh, k)]; if (!row) continue;
      for (let c = sel.c1; c <= Math.min(sel.c2, row.length - 1); c++, seen++) {
        const y = row[c]; if (y == null || show(sh, y) === '') continue; cnt++;
        const v = cellVal(sh, 0, 0, null, typeof y === 'object' && y.f != null ? { v: y.v } : y);
        if (typeof v === 'number') { n++; sum += v; }
      }
    }
    const f = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
    txt = n ? `Soma: ${f(sum)} · Média: ${f(sum / n)} · Contagem: ${cnt}` : cnt ? `Contagem: ${cnt}` : '';
  }
  stats.textContent = txt;
}
function select(t, k, c, extend) {
  const sh = cur(t); if (!sh) return;
  k = Math.max(0, k); c = Math.max(0, Math.min(MAXC - 1, c));
  if (k >= sh.view.length - 5 && !sh.filter && !sh.sort) { while (k >= sh.view.length - 5) sh.view.push(rowOf(sh, sh.view.length)); render(t); }
  if (c >= sh.w.length - 2) { while (c >= sh.w.length - 2) sh.w.push(DEF_W); apply(sh); render(t); }
  sh.sel = extend ? { ...sh.sel, k2: k, c2: c } : { k, c, k2: k, c2: c };
  t.sh.drawn = null; draw(t); fx(t);
}
function selectAll(t) { const sh = cur(t); if (!sh) return; commitEdit(t); sh.sel = { k: 0, c: 0, k2: sh.view.length - 1, c2: sh.w.length - 1 }; t.sh.drawn = null; draw(t); fx(t); }
// mantém a célula (a ponta da seleção) à vista
function reveal(t) {
  const sh = cur(t), body = t.el.querySelector('[data-body]'), k = sh.sel.k2, c = sh.sel.c2;
  const top = k * RH, left = sh.rnw + sh.x[c];
  if (top < body.scrollTop) body.scrollTop = top; else if (top + RH > body.scrollTop + body.clientHeight) body.scrollTop = top + RH - body.clientHeight;
  if (left < body.scrollLeft + sh.rnw) body.scrollLeft = left - sh.rnw; else if (left + sh.w[c] > body.scrollLeft + body.clientWidth) body.scrollLeft = left + sh.w[c] - body.clientWidth;
}
function move(t, dk, dc, extend) {
  const sh = cur(t); if (!sh) return;
  const from = extend ? sh.sel : { ...sh.sel, k2: sh.sel.k, c2: sh.sel.c };
  select(t, extend ? from.k2 + dk : from.k + dk, extend ? from.c2 + dc : from.c + dc, extend);
  reveal(t);
}
// Ctrl+seta: vai até a borda do bloco de dados (como no Excel)
function jump(t, dk, dc, extend) {
  const sh = cur(t), s = sh.sel, k0 = extend ? s.k2 : s.k, c0 = extend ? s.c2 : s.c;
  const filled = (k, c) => { const x = cellAt(sh, rowOf(sh, k), c); return x != null && show(sh, x) !== ''; };
  const lastK = lastDataK(sh), lastC = Math.max(0, sh.ncol - 1);
  let k = k0, c = c0;
  const inside = (k, c) => k >= 0 && c >= 0 && k <= lastK && c <= lastC;
  if (!inside(k + dk, c + dc)) { k = dk ? (dk > 0 ? lastK : 0) : k; c = dc ? (dc > 0 ? lastC : 0) : c; }
  else if (filled(k, c) && filled(k + dk, c + dc)) { while (inside(k + dk, c + dc) && filled(k + dk, c + dc)) { k += dk; c += dc; } }
  else { k += dk; c += dc; while (inside(k, c) && !filled(k, c)) { k += dk; c += dc; } if (!inside(k, c)) { k = Math.max(0, Math.min(lastK, k)); c = Math.max(0, Math.min(lastC, c)); } }
  select(t, k, c, extend); reveal(t);
}

// ----- mouse -----
function down(t, e, where) {
  const sh = cur(t); if (!sh || e.button > 2) return;
  if (e.target.closest('.sh-ed')) return;
  commitEdit(t);
  const body = t.el.querySelector('[data-body]'), g = grid0(t);
  const at = (ev) => { const rc = body.getBoundingClientRect(); return { k: Math.max(0, Math.floor((ev.clientY - rc.top + body.scrollTop) / RH)), c: colAt(sh, Math.max(0, ev.clientX - rc.left + body.scrollLeft - sh.rnw)) }; };
  if (where === 'rz') {
    e.preventDefault(); e.stopPropagation();
    const c = +e.target.closest('[data-rz]').dataset.rz, x0 = e.clientX, w0 = sh.w[c];
    const mv = (ev) => { sh.w[c] = Math.max(16, Math.round(w0 + ev.clientX - x0)); apply(sh); render(t); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (sh.w[c] !== w0) widthChanged(t, sh, c, w0); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
    return;
  }
  const rn = e.target.closest('[data-rn]'), hc = e.target.closest('.sh-h[data-c]');
  if (where === 'cell' && !rn && !e.target.closest('[data-c]')) return;
  const sel = rect(sh.sel);
  let mode = rn ? 'row' : where === 'col' ? 'col' : 'cell', p;
  if (mode === 'row') p = { k: +rn.dataset.rn, c: 0 };
  else if (mode === 'col') { if (!hc) return; p = { k: 0, c: +hc.dataset.c }; }
  else p = at(e);
  // botão direito dentro da seleção: mantém a seleção (o menu age nela)
  if (e.button === 2) {
    const inside = mode === 'row' ? p.k >= sel.k1 && p.k <= sel.k2 && sel.c1 === 0 : mode === 'col' ? p.c >= sel.c1 && p.c <= sel.c2 && sel.k1 === 0 : p.k >= sel.k1 && p.k <= sel.k2 && p.c >= sel.c1 && p.c <= sel.c2;
    if (inside) return;
  }
  e.preventDefault(); g.focus({ preventScroll: true });
  const lastK = sh.view.length - 1, lastC = sh.w.length - 1;
  const set = (q, extend) => {
    if (mode === 'row') sh.sel = extend ? { ...sh.sel, k2: q.k, c2: lastC } : { k: q.k, c: 0, k2: q.k, c2: lastC };
    else if (mode === 'col') sh.sel = extend ? { ...sh.sel, k2: lastK, c2: q.c } : { k: 0, c: q.c, k2: lastK, c2: q.c };
    else { select(t, q.k, q.c, extend); return; }
    t.sh.drawn = null; draw(t); fx(t);
  };
  set(p, e.shiftKey);
  if (e.button !== 0) return;
  // arrastar: estende a seleção (e rola a tabela perto das bordas)
  let last = null, timer = null;
  const mv = (ev) => {
    last = ev; const q = at(ev);
    if (mode === 'row') q.c = lastC; if (mode === 'col') q.k = lastK;
    q.k = Math.min(q.k, sh.view.length - 1);
    if (mode === 'cell') select(t, q.k, q.c, true); else set(q, true);
    const rc = body.getBoundingClientRect();
    clearInterval(timer);
    const dy = ev.clientY < rc.top + 4 ? -RH : ev.clientY > rc.bottom - 4 ? RH : 0, dx = ev.clientX < rc.left + sh.rnw ? -40 : ev.clientX > rc.right - 4 ? 40 : 0;
    if (dy || dx) timer = setInterval(() => { body.scrollTop += dy; body.scrollLeft += dx; if (last) { const q2 = at(last); if (mode === 'cell') select(t, Math.min(q2.k, sh.view.length - 1), q2.c, true); } }, 40);
  };
  const up = () => { clearInterval(timer); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
}

// ----- teclado -----
const combo = (e) => (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.key.length === 1 ? e.key.toUpperCase() : e.key);
function key(t, e) {
  const sh = cur(t); if (!sh || e.target.closest('input, select')) return;
  const k = combo(e), ctrl = e.ctrlKey || e.metaKey;
  const done = () => { e.preventDefault(); e.stopPropagation(); };
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (arrows[e.key] && !e.altKey) { done(); const [dk, dc] = arrows[e.key]; return ctrl ? jump(t, dk, dc, e.shiftKey) : move(t, dk, dc, e.shiftKey); }
  if (e.key === 'PageDown' || e.key === 'PageUp') { done(); const n = Math.max(1, Math.floor(t.el.querySelector('[data-body]').clientHeight / RH) - 1); return move(t, e.key === 'PageDown' ? n : -n, 0, e.shiftKey); }
  if (e.key === 'Home') { done(); return ctrl ? (select(t, 0, 0, e.shiftKey), reveal(t)) : (select(t, e.shiftKey ? sh.sel.k2 : sh.sel.k, 0, e.shiftKey), reveal(t)); }
  if (e.key === 'End' && ctrl) { done(); select(t, lastDataK(sh), Math.max(0, sh.ncol - 1), e.shiftKey); return reveal(t); }
  if (e.key === 'Tab') { done(); return move(t, 0, e.shiftKey ? -1 : 1); }
  if (e.key === 'Enter' && !ctrl && !e.altKey) { done(); return move(t, e.shiftKey ? -1 : 1, 0); }
  if (e.key === 'F2') { done(); return startEdit(t, null, true); }
  if (e.key === 'Delete') { done(); return clearCells(t); }
  if (e.key === 'Backspace') { done(); return startEdit(t, ''); }
  const map = {
    'Ctrl+Z': () => history(t, 'undo'), 'Ctrl+Y': () => history(t, 'redo'), 'Ctrl+Shift+Z': () => history(t, 'redo'),
    'Ctrl+B': () => cmd(t, 'b'), 'Ctrl+I': () => cmd(t, 'i'), 'Ctrl+U': () => cmd(t, 'u'), 'Ctrl+5': () => cmd(t, 's'),
    'Ctrl+A': () => selectAll(t), 'Ctrl+D': () => fill(t, 'down'), 'Ctrl+R': () => fill(t, 'right'),
    'Ctrl+F': () => t.el.querySelector('[data-q]').focus(), 'Alt+=': () => cmd(t, 'sum'),
    'Shift+ ': () => selectRows(t), 'Ctrl+ ': () => selectCols(t),
  };
  if (map[k]) { done(); return map[k](); }
  // tecla de texto: começa a digitar por cima (como no Excel)
  if (e.key.length === 1 && !ctrl && !e.altKey) { done(); startEdit(t, e.key); }
}
function selectRows(t) { const sh = cur(t), s = rect(sh.sel); sh.sel = { k: s.k1, c: 0, k2: s.k2, c2: sh.w.length - 1 }; t.sh.drawn = null; draw(t); fx(t); }
function selectCols(t) { const sh = cur(t), s = rect(sh.sel); sh.sel = { k: 0, c: s.c1, k2: sh.view.length - 1, c2: s.c2 }; t.sh.drawn = null; draw(t); fx(t); }

// ----- edição -----
// text: null mantém o conteúdo (duplo clique, F2); um texto começa a digitar por cima
function startEdit(t, text, caretMode) {
  const sh = cur(t); if (!sh) return;
  const ed = t.el.querySelector('[data-ed]'), k = sh.sel.k, c = sh.sel.c, r = rowOf(sh, k);
  if (sh.head && r === 0) return;
  const x = cellAt(sh, r, c);
  sh.sel = { k, c, k2: k, c2: c }; t.sh.drawn = null; draw(t); reveal(t);
  t.sh.edit = { el: ed, r, c, k, typing: text != null && !caretMode };
  ed.value = text == null ? editText(sh, x) : text;
  const s = styleOf(x);
  ed.style.cssText = `top:${k * RH}px;left:${sh.rnw + sh.x[c]}px;min-width:${sh.w[c]}px;height:${RH}px;${css(s)}${s && s.bg ? '' : 'background-color:var(--bg);'}`;
  ed.style.width = Math.max(sh.w[c], Math.min(600, 16 + ed.value.length * 7.6)) + 'px';
  ed.hidden = false; ed.focus({ preventScroll: true });
  ed.setSelectionRange(ed.value.length, ed.value.length);
  t.el.querySelector('[data-val]').value = ed.value;
}
function edKey(t, e, ed) {
  e.stopPropagation();
  const ed0 = t.sh.edit;
  ed.style.width = Math.max(parseFloat(ed.style.minWidth) || 0, Math.min(600, 16 + ed.value.length * 7.6)) + 'px';
  if (e.key === 'Escape') { e.preventDefault(); cancelEdit(t); grid0(t).focus(); return; }
  const go = (dk, dc) => { e.preventDefault(); if (commitEdit(t)) { grid0(t).focus(); move(t, dk, dc); } };
  if (e.key === 'Enter' && !e.altKey) return go(e.shiftKey ? -1 : 1, 0);
  if (e.key === 'Tab') return go(0, e.shiftKey ? -1 : 1);
  // digitando por cima, as setas confirmam e andam; editando (F2, duplo clique), andam dentro do texto
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (arrows[e.key] && ed0 && ed0.typing && !e.shiftKey && !e.ctrlKey && !ed.value.startsWith('=')) return go(...arrows[e.key]);
  if (e.key === 'F2' && ed0) { e.preventDefault(); ed0.typing = !ed0.typing; }
}
function cancelEdit(t) {
  const ed = t.el && t.el.querySelector('[data-ed]');
  if (t.sh) t.sh.edit = null;
  if (ed) ed.hidden = true;
  if (t.el) fx(t);
}
// grava o que está na caixa de edição; false quando a fórmula não fecha (a caixa continua aberta)
function commitEdit(t) {
  const e = t.sh && t.sh.edit; if (!e) return true;
  const sh = cur(t); if (!sh) { cancelEdit(t); return true; }
  const text = e.el.value;
  const old = cellAt(sh, e.r, e.c);
  if (text === editText(sh, old)) { cancelEdit(t); return true; }
  const res = inputCell(sh, text, old);
  if (res.error) { toast(res.error, 'err'); e.el.focus(); return false; }
  t.sh.edit = null;
  t.el.querySelector('[data-ed]').hidden = true;
  change(t, [{ r: e.r, c: e.c, x: res.x }], 'Editar célula');
  return true;
}

// ----- alterações (com desfazer) -----
function setDirty(t, d) {
  const btn = t.el && t.el.querySelector('[data-save]'); if (btn) btn.hidden = !d;
  if (!!t.dirty === d) return;
  t.dirty = d; renderTabs(); syncUnsaved();
}
function touched(t, sh) {
  sh.ver++; sh.changed = true;
  if (sh.hasF) recalc(t);
  ensureCols(sh);
  if (!sh.filter && !sh.sort) apply(sh); else { sh.x = [0]; for (const w of sh.w) sh.x.push(sh.x[sh.x.length - 1] + w); }
  setDirty(t, true);
  if (typeof autoSaveSoon === 'function') autoSaveSoon();
  render(t);
}
function push(t, op) { t.sh.undo.push(op); if (t.sh.undo.length > 200) t.sh.undo.shift(); t.sh.redo = []; fx(t); }
// list: [{ r, c, x }] (x undefined apaga a célula)
function change(t, list, label) {
  const sh = cur(t), si = t.sh.cur; if (!list.length) return;
  const before = list.map(({ r, c }) => ({ r, c, x: cellAt(sh, r, c) }));
  const run = (arr) => { for (const { r, c, x } of arr) put(sh, r, c, x); touched(t, sh); };
  run(list);
  push(t, { si, label, undo: () => run(before), redo: () => run(list) });
}
// operações que mexem na estrutura (linhas, colunas, ordem): desfazer volta uma cópia rasa das planilhas abertas
function structural(t, label, fn) {
  const snap = t.sh.sheets.filter(s => s.data).map(s => { const d = s.data; return [d, { rows: d.rows.map(r => r && r.slice()), rowAttr: d.rowAttr.slice(), w: d.w.slice(), ncol: d.ncol, ops: d.ops.slice(), colsChanged: d.colsChanged, wUser: new Set(d.wUser || []) }]; });
  const si = t.sh.cur;
  const restore = (list) => { for (const [d, s] of list) { d.rows = s.rows.map(r => r && r.slice()); d.rowAttr = s.rowAttr.slice(); d.w = s.w.slice(); d.ncol = s.ncol; d.ops = s.ops.slice(); d.colsChanged = s.colsChanged; d.wUser = new Set(s.wUser); d.changed = true; } };
  fn();
  const after = t.sh.sheets.filter(s => s.data).map(s => { const d = s.data; return [d, { rows: d.rows.map(r => r && r.slice()), rowAttr: d.rowAttr.slice(), w: d.w.slice(), ncol: d.ncol, ops: d.ops.slice(), colsChanged: d.colsChanged, wUser: new Set(d.wUser || []) }]; });
  for (const s of t.sh.sheets) if (s.data && s.data !== cur(t)) { s.data.ver++; }
  touched(t, cur(t));
  push(t, { si, label, undo: () => { restore(snap); touched(t, cur(t)); }, redo: () => { restore(after); touched(t, cur(t)); } });
}
async function history(t, dir) {
  commitEdit(t);
  const from = t.sh[dir], op = from.pop(); if (!op) return toast(dir === 'undo' ? 'Nada para desfazer' : 'Nada para refazer', null, 'sh-hist');
  if (op.si !== t.sh.cur) await pick(t, op.si);
  op[dir]();
  t.sh[dir === 'undo' ? 'redo' : 'undo'].push(op);
  // voltou ao ponto do último salvamento: a aba deixa de estar "não salva"
  setDirty(t, (t.sh.undo[t.sh.undo.length - 1] || null) !== t.sh.clean);
  toast((dir === 'undo' ? 'Desfeito: ' : 'Refeito: ') + op.label, null, 'sh-hist');
  fx(t);
}
// células da seleção (linhas de dados); limita seleções gigantes (coluna inteira de um CSV enorme)
function selCells(t, fn, max = 500000) {
  const sh = cur(t), s = rect(sh.sel); let n = 0;
  const lastK = Math.min(s.k2, sh.view.length - 1), wide = s.c2 - s.c1 + 1 > sh.ncol + 2;
  const c2 = wide ? Math.min(s.c2, sh.ncol + 1) : s.c2;
  for (let k = s.k1; k <= lastK; k++) { const r = rowOf(sh, k); for (let c = s.c1; c <= c2; c++) { if (++n > max) return false; fn(r, c, k); } }
  return true;
}
function clearCells(t) {
  const sh = cur(t), list = [];
  selCells(t, (r, c) => { const x = cellAt(sh, r, c); if (x == null) return; const s = styleOf(x); list.push({ r, c, x: s ? { v: null, s } : undefined }); });
  change(t, list, 'Limpar conteúdo');
}
// formatação: fn(estilo atual) devolve o que muda
function formatCells(t, fn, label) {
  const sh = cur(t); if (!sh) return;
  commitEdit(t);
  const list = [], memo = new Map(), base = baseStyle(sh);
  const ok = selCells(t, (r, c) => {
    if (sh.head && r === 0) return;
    const x = cellAt(sh, r, c), s = styleOf(x);
    const ch = fn(s || base); if (!ch) return;
    let ns = memo.get(s || base);
    if (!ns) { ns = ch === 'clear' ? undefined : restyle(s || base, ch); memo.set(s || base, ns); }
    if (x == null && !ns) return;
    const nx = x == null ? { v: null, s: ns } : typeof x === 'string' ? { v: x, s: ns } : { ...x, s: ns };
    if (nx.v == null && nx.f == null && !nx.s) list.push({ r, c, x: undefined }); else list.push({ r, c, x: nx });
  });
  if (!ok) toast('Seleção grande demais: formatei as primeiras 500 mil células');
  change(t, list, label);
}
function cmd(t, name, btn) {
  const sh = cur(t); if (!sh) return;
  const s0 = styleOf(cellAt(sh, rowOf(sh, sh.sel.k), sh.sel.c)) || {};
  switch (name) {
    case 'undo': case 'redo': return history(t, name);
    case 'b': case 'i': case 'u': case 's': { const on = !s0[name]; return formatCells(t, () => ({ [name]: on }), { b: 'Negrito', i: 'Itálico', u: 'Sublinhado', s: 'Tachado' }[name]); }
    case 'left': case 'center': case 'right': { const v = s0.ha === name ? undefined : name; return formatCells(t, () => ({ ha: v }), 'Alinhamento'); }
    case 'border': { const on = !s0.bd; return formatCells(t, () => ({ bd: on }), 'Bordas'); }
    case 'fc': case 'bg': return colors(t, name, btn || t.el.querySelector(`[data-cmd="${name}"]`));
    case 'dec+': case 'dec-': {
      const d = name === 'dec+' ? 1 : -1;
      return formatCells(t, (s) => { const x = cellAt(sh, rowOf(sh, sh.sel.k), sh.sel.c); return { nf: decimals(s.nf, d, x && typeof x === 'object' ? x.v : csvVal(x || '')) }; }, 'Casas decimais');
    }
    case 'clear': return formatCells(t, () => 'clear', 'Limpar formatação');
    case 'sum': return autoSum(t);
  }
}
function colors(t, which, btn) {
  const pop = t.el.querySelector('[data-pop]');
  if (!pop.hidden && pop.dataset.for === which) { pop.hidden = true; return; }
  pop.dataset.for = which;
  pop.innerHTML = `<div class="sh-pop-h">${which === 'fc' ? 'Cor do texto' : 'Preenchimento'}</div><div class="sh-pal">${PALETTE.map(c => `<button class="sh-sw" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
    <div class="sh-pop-f"><button class="chip" data-color="">${which === 'fc' ? 'Automática' : 'Sem preenchimento'}</button><label class="chip">Outra…<input type="color" data-custom value="${which === 'fc' ? t.sh.lastFc || '#e03131' : t.sh.lastBg || '#ffd43b'}"></label></div>`;
  const r = btn.getBoundingClientRect(), base = t.el.getBoundingClientRect();
  pop.style.left = (r.left - base.left) + 'px'; pop.style.top = (r.bottom - base.top + 4) + 'px'; pop.hidden = false;
  const pickc = (c) => {
    pop.hidden = true;
    if (c) t.sh[which === 'fc' ? 'lastFc' : 'lastBg'] = c;
    formatCells(t, () => ({ [which]: c || undefined }), which === 'fc' ? 'Cor do texto' : 'Preenchimento');
    grid0(t).focus();
  };
  pop.querySelectorAll('[data-color]').forEach(b => b.onclick = () => pickc(b.dataset.color));
  pop.querySelector('[data-custom]').onchange = (e) => pickc(e.target.value);
  const off = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) { pop.hidden = true; removeEventListener('mousedown', off, true); } };
  addEventListener('mousedown', off, true);
}
// Σ: soma o bloco de números acima da célula, ou põe a soma embaixo de cada coluna selecionada
function autoSum(t) {
  const sh = cur(t); commitEdit(t);
  const s = rect(sh.sel), isN = (r, c) => { const x = cellAt(sh, r, c); return x != null && typeof cellVal(sh, r, c, null, typeof x === 'object' && x.f != null ? { v: x.v } : x) === 'number'; };
  if (s.k1 === s.k2 && s.c1 === s.c2) {
    const r = rowOf(sh, s.k1), c = s.c1; let top = r - 1;
    while (top >= 0 && isN(top, c)) top--;
    if (top === r - 1) { // nada em cima: a linha à esquerda
      let lf = c - 1; while (lf >= 0 && isN(r, lf)) lf--;
      if (lf === c - 1) return startEdit(t, '=SUM()', true);
      return change(t, [{ r, c, x: { f: `SUM(${colName(lf + 1)}${r + 1}:${colName(c - 1)}${r + 1})`, v: null, s: styleOf(cellAt(sh, r, c)) } }], 'AutoSoma');
    }
    return change(t, [{ r, c, x: { f: `SUM(${colName(c)}${top + 2}:${colName(c)}${r})`, v: null, s: styleOf(cellAt(sh, r, c)) } }], 'AutoSoma');
  }
  const r1 = rowOf(sh, s.k1), r2 = rowOf(sh, s.k2), list = [];
  if (r2 - r1 !== s.k2 - s.k1) return toast('Com filtro ou ordenação, selecione uma célula só para a AutoSoma');
  for (let c = s.c1; c <= Math.min(s.c2, sh.ncol - 1); c++) list.push({ r: r2 + 1, c, x: { f: `SUM(${colName(c)}${r1 + 1}:${colName(c)}${r2 + 1})`, v: null, s: styleOf(cellAt(sh, r2 + 1, c)) } });
  change(t, list, 'AutoSoma');
}
// Ctrl+D / Ctrl+R: copia a primeira linha (coluna) da seleção para as outras, ajustando as fórmulas
function fill(t, dir) {
  const sh = cur(t), s = rect(sh.sel), list = []; commitEdit(t);
  if (dir === 'down') {
    if (s.k1 === s.k2) return;
    const r0 = rowOf(sh, s.k1);
    for (let k = s.k1 + 1; k <= Math.min(s.k2, sh.view.length - 1); k++) { const r = rowOf(sh, k); for (let c = s.c1; c <= Math.min(s.c2, sh.ncol); c++) list.push({ r, c, x: shifted(cellAt(sh, r0, c), r - r0, 0) }); }
  } else {
    if (s.c1 === s.c2) return;
    for (let k = s.k1; k <= Math.min(s.k2, sh.view.length - 1); k++) { const r = rowOf(sh, k), x = cellAt(sh, r, s.c1); for (let c = s.c1 + 1; c <= s.c2; c++) list.push({ r, c, x: shifted(x, 0, c - s.c1) }); }
  }
  change(t, list, dir === 'down' ? 'Preencher para baixo' : 'Preencher à direita');
}
const shifted = (x, dr, dc) => x && typeof x === 'object' ? (x.f != null ? { f: moveFormula(x.f, dr, dc), v: null, s: x.s } : { v: x.v, s: x.s }) : x;
function autoFit(t, c) {
  const sh = cur(t), w0 = sh.w[c];
  sh.w[c] = autoWidth(sh, c); if (sh.w[c] === w0) return;
  apply(sh); render(t); widthChanged(t, sh, c, w0);
}
function widthChanged(t, sh, c, w0) {
  const w1 = sh.w[c], si = t.sh.cur;
  (sh.wUser = sh.wUser || new Set()).add(c);
  sh.colsChanged = true; sh.changed = true; setDirty(t, !!t.sh.book || t.dirty);
  const run = (w) => { sh.w[c] = w; apply(sh); render(t); };
  push(t, { si, label: 'Largura da coluna', undo: () => run(w0), redo: () => run(w1) });
}

// ----- copiar e colar -----
let CLIP = null; // última cópia daqui (com fórmulas e formatação); entre abas também
function copy(t, e, cut) {
  if (e.target.closest('input')) return;
  const sh = cur(t); if (!sh) return;
  e.preventDefault();
  const s = rect(sh.sel), lastK = Math.min(s.k2, sh.view.length - 1), c2 = Math.min(s.c2, Math.max(s.c1, sh.ncol - 1));
  if ((lastK - s.k1 + 1) * (c2 - s.c1 + 1) > 2000000) return toast('Seleção grande demais para copiar');
  const cells = [], lines = [];
  for (let k = s.k1; k <= lastK; k++) {
    const r = rowOf(sh, k), row = [], txt = [];
    for (let c = s.c1; c <= c2; c++) { const x = cellAt(sh, r, c); row.push(x); const v = show(sh, x); txt.push(/[\t\r\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v); }
    cells.push(row); lines.push(txt.join('\t'));
  }
  const text = lines.join('\r\n');
  e.clipboardData.setData('text/plain', text);
  CLIP = { text, cells, r0: rowOf(sh, s.k1), c0: s.c1, sh, t: cut ? t : null, si: t.sh.cur, csv: sh.csv, book: sh.book };
  toast(cut ? 'Recortado: cole com Ctrl+V' : `Copiado (${cells.length}×${cells[0] ? cells[0].length : 0})`, null, 'sh-clip');
}
function paste(t, text) {
  const sh = cur(t); if (!sh || text == null) return;
  commitEdit(t);
  const s = rect(sh.sel), list = [], base = baseStyle(sh);
  const k0 = s.k1, c0 = s.c1;
  const target = (i, j) => ({ r: rowOf(sh, k0 + i), c: c0 + j });
  const own = CLIP && CLIP.text === text;
  let src;
  if (own) {
    // estilos de outra pasta de trabalho viram estilos novos nesta
    const restyled = new Map(), conv = (st) => { if (!st) return st; if (st.xf != null && CLIP.book === sh.book) return st; let n = restyled.get(st); if (!n) { const { b, i, u, s, fc, bg, ha, bd, nf } = st; n = restyle(base, { b, i, u, s, fc, bg, ha, bd, nf }); restyled.set(st, n); } return n; };
    src = CLIP.cells.map((row, i) => row.map((x, j) => {
      if (x == null) return undefined;
      const t2 = target(i, j);
      if (typeof x === 'string') return sh.csv ? x : inputCell(sh, x, undefined).x;
      const y = { v: x.v, s: conv(x.s) };
      if (x.f != null) { y.f = moveFormula(x.f, t2.r - (CLIP.r0 + i), t2.c - (CLIP.c0 + j)); y.v = null; }
      else if (sh.csv && typeof y.v !== 'string') y.v = show(CLIP.sh, x);
      return y.v == null && y.f == null && !y.s ? undefined : y;
    }));
  } else {
    const rows = parseCSV(text.replace(/\r?\n$/, ''), '\t');
    if (!rows.length) return;
    src = rows.map((row, i) => row.map((v, j) => { const t2 = target(i, j); return inputCell(sh, v, cellAt(sh, t2.r, t2.c)).x; }));
  }
  // uma célula copiada e várias selecionadas: preenche a seleção toda
  const h = src.length, w = Math.max(...src.map(r => r.length));
  const fillAll = h === 1 && w === 1 && (s.k2 > s.k1 || s.c2 > s.c1);
  const H = fillAll ? Math.min(s.k2, sh.view.length - 1) - s.k1 + 1 : h, W = fillAll ? s.c2 - s.c1 + 1 : w;
  for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
    const t2 = target(i, j); let x = fillAll ? src[0][0] : src[i][j];
    if (fillAll && own && x && typeof x === 'object' && x.f != null) x = { ...x, f: moveFormula(CLIP.cells[0][0].f, t2.r - CLIP.r0, t2.c - CLIP.c0) };
    if (sh.head && t2.r === 0) continue;
    list.push({ r: t2.r, c: t2.c, x });
  }
  // recortar: limpa a origem (na mesma planilha, junto com a colagem, num passo só de desfazer)
  if (own && CLIP.t === t && CLIP.si === t.sh.cur) {
    const dest = new Set(list.map(p => p.r + ',' + p.c));
    CLIP.cells.forEach((row, i) => row.forEach((x, j) => { const r = CLIP.r0 + i, c = CLIP.c0 + j; if (x != null && !dest.has(r + ',' + c)) list.push({ r, c, x: undefined }); }));
    CLIP = null;
  }
  change(t, list, 'Colar');
  sh.sel = { k: k0, c: c0, k2: k0 + H - 1, c2: c0 + W - 1 }; t.sh.drawn = null; draw(t); fx(t);
}

// ----- linhas e colunas -----
function canShape(t) {
  const sh = cur(t);
  if (sh.sort || sh.filter) { toast('Tire a ordenação e o filtro antes de inserir ou excluir linhas e colunas'); return false; }
  return true;
}
// insere n (n > 0) ou exclui -n linhas (axis 'r') ou colunas ('c') a partir de at, ajustando as fórmulas
function reshape(t, axis, at, n, label) {
  if (!canShape(t)) return;
  const sh = cur(t); commitEdit(t);
  structural(t, label, () => {
    if (axis === 'r') {
      if (n > 0) { sh.rows.splice(Math.min(at, sh.rows.length), 0, ...new Array(n)); if (at < sh.rowAttr.length) sh.rowAttr.splice(at, 0, ...new Array(n)); }
      else { sh.rows.splice(at, -n); sh.rowAttr.splice(at, -n); }
    } else {
      for (let r = 0; r < sh.rows.length; r++) { const row = sh.rows[r]; if (!row || row.length <= at) continue; if (n > 0) row.splice(at, 0, ...new Array(n)); else row.splice(at, -n); }
      if (n > 0) sh.w.splice(at, 0, ...new Array(n).fill(DEF_W)); else sh.w.splice(at, -n);
      sh.ncol = Math.max(0, sh.ncol + n); sh.colsChanged = true;
      if (sh.wUser) sh.wUser = new Set([...sh.wUser].map(i => { const s = shiftSpan(i, i, at, n); return s ? s[0] : -1; }).filter(i => i >= 0));
    }
    sh.ops.push({ axis, at, n });
    for (const s of t.sh.sheets) {
      const d = s.data; if (!d || !d.hasF) continue;
      for (const row of d.rows) if (row) for (let c = 0; c < row.length; c++) {
        const x = row[c]; if (!x || typeof x !== 'object' || x.f == null) continue;
        const f = shiftFormula(x.f, s.name, cur(t).name, axis, at, n);
        if (f !== x.f) { row[c] = { ...x, f }; d.changed = true; }
      }
    }
  });
}
function rowsOfSel(t) { const sh = cur(t), s = rect(sh.sel); return { r1: rowOf(sh, s.k1), r2: rowOf(sh, Math.min(s.k2, sh.view.length - 1)), c1: s.c1, c2: Math.min(s.c2, Math.max(s.c1, sh.ncol - 1)) }; }
function sortData(t, c, dir) {
  if (!canShape(t)) return;
  const sh = cur(t), start = sh.head ? 1 : 0;
  structural(t, 'Ordenar planilha', () => {
    const idx = []; for (let r = start; r < sh.rows.length; r++) idx.push(r);
    sh.sort = { c, dir }; const keep = sh.view; apply(sh); const order = sh.view.filter(r => r < sh.rows.length); sh.sort = null; sh.view = keep;
    const rows = order.map(r => sh.rows[r]), attrs = order.map(r => sh.rowAttr[r]);
    for (let i = 0; i < order.length; i++) { sh.rows[start + i] = rows[i]; sh.rowAttr[start + i] = attrs[i]; }
  });
}

// ----- menus -----
function ctxMenu(t, e) {
  const sh = cur(t); if (!sh || e.target.closest('input')) return;
  const onRow = e.target.closest('[data-rn]'), onCol = e.target.closest('.sh-h[data-c]');
  const s = rect(sh.sel), nr = Math.min(s.k2, sh.view.length - 1) - s.k1 + 1, nc = s.c2 - s.c1 + 1;
  const sel = rowsOfSel(t), g = grid0(t);
  const plural = (n, a, b) => n > 1 ? `${n} ${b}` : a;
  const clip = [
    { label: 'Recortar', k: 'Ctrl+X', icon: bs.I.copy, action: () => { g.focus(); document.execCommand('cut'); } },
    { label: 'Copiar', k: 'Ctrl+C', icon: bs.I.copy, action: () => { g.focus(); document.execCommand('copy'); } },
    { label: 'Colar', k: 'Ctrl+V', action: () => navigator.clipboard.readText().then(x => paste(t, x)).catch(() => toast('Use Ctrl+V para colar')) },
  ];
  const rowsItems = [
    { label: `Inserir ${plural(nr, 'linha', 'linhas')} acima`, action: () => reshape(t, 'r', sel.r1, nr, 'Inserir linhas') },
    { label: `Inserir ${plural(nr, 'linha', 'linhas')} abaixo`, action: () => reshape(t, 'r', sel.r2 + 1, nr, 'Inserir linhas') },
    { label: `Excluir ${plural(nr, 'linha', 'linhas')}`, icon: bs.I.x, action: () => reshape(t, 'r', sel.r1, -nr, 'Excluir linhas') },
  ];
  const colItems = [
    { label: `Inserir ${plural(nc, 'coluna', 'colunas')} à esquerda`, action: () => reshape(t, 'c', s.c1, nc, 'Inserir colunas') },
    { label: `Inserir ${plural(nc, 'coluna', 'colunas')} à direita`, action: () => reshape(t, 'c', s.c2 + 1, nc, 'Inserir colunas') },
    { label: `Excluir ${plural(nc, 'coluna', 'colunas')}`, icon: bs.I.x, action: () => reshape(t, 'c', s.c1, -nc, 'Excluir colunas') },
  ];
  const c = onCol ? +onCol.dataset.c : sh.sel.c;
  const sortItems = [
    { label: 'Ordenar A → Z (só a vista)', action: () => { sh.sort = { c, dir: 1 }; apply(sh); render(t); } },
    { label: 'Ordenar Z → A (só a vista)', action: () => { sh.sort = { c, dir: -1 }; apply(sh); render(t); } },
    ...(sh.sort ? [{ label: 'Tirar a ordenação', action: () => { sh.sort = null; apply(sh); render(t); } }] : []),
    { label: 'Ordenar a planilha por esta coluna', sub: [
      { label: 'A → Z (muda a ordem das linhas)', action: () => sortData(t, c, 1) },
      { label: 'Z → A (muda a ordem das linhas)', action: () => sortData(t, c, -1) }] },
  ];
  let items;
  if (onCol) items = [...clip, '-', ...sortItems, '-', ...colItems, '-', { label: 'Largura automática', action: () => { for (let k = s.c1; k <= s.c2; k++) autoFit(t, k); } }];
  else if (onRow) items = [...clip, '-', ...rowsItems, '-', { label: 'Limpar conteúdo', k: 'Delete', action: () => clearCells(t) }];
  else items = [...clip, '-',
    { label: 'Limpar conteúdo', k: 'Delete', action: () => clearCells(t) },
    { label: 'Limpar formatação', icon: ICON.eraser, action: () => cmd(t, 'clear') },
    { label: 'Preencher para baixo', k: 'Ctrl+D', action: () => fill(t, 'down') },
    { label: 'Preencher à direita', k: 'Ctrl+R', action: () => fill(t, 'right') },
    '-', { label: 'Linhas', sub: rowsItems }, { label: 'Colunas', sub: colItems }, { label: 'Ordenar', sub: sortItems }];
  showMenu(e, items);
}

// ----- abas (planilhas do .xlsx) -----
const badName = (n) => !n.trim() ? 'O nome não pode ficar vazio' : n.length > 31 ? 'O nome tem no máximo 31 caracteres' : /[\\/?*[\]:]/.test(n) ? 'O nome não pode ter \\ / ? * [ ] :' : /^'|'$/.test(n) ? 'O nome não pode começar nem terminar com apóstrofo' : '';
function renameSheet(t, i, btn) {
  const s = t.sh.sheets[i], inp = document.createElement('input');
  inp.className = 'sh-tabin'; inp.value = s.name; btn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return; done = true;
    const name = inp.value.trim();
    if (!ok || name === s.name) return tabs(t);
    const bad = badName(name) || (t.sh.sheets.some(x => x !== s && x.name.toLowerCase() === name.toLowerCase()) ? 'Já existe uma planilha com esse nome' : '');
    if (bad) { toast(bad, 'err'); return tabs(t); }
    // as fórmulas de todas as planilhas que citam o nome antigo passam a citar o novo
    try { for (const x of t.sh.sheets) await ensure(t, x); } catch (e) { toast('Não deu para ler as planilhas: ' + e.message, 'err'); return tabs(t); }
    const from = s.name;
    const ren = (a, b) => {
      for (const x of t.sh.sheets) {
        const d = x.data; if (!d.hasF) continue;
        for (const row of d.rows) if (row) for (let c = 0; c < row.length; c++) {
          const y = row[c]; if (!y || typeof y !== 'object' || y.f == null) continue;
          const f = rewrite(y.f, (n) => n.sheet != null && n.sheet.toLowerCase() === a.toLowerCase() ? { ...n, sheet: b } : undefined);
          if (f !== y.f) { row[c] = { ...y, f }; d.changed = true; }
        }
      }
      s.name = b; s.data.name = b; t.sh.book.renames.push([a, b]); t.sh.book.wbChanged = true;
      setDirty(t, true); tabs(t); render(t);
    };
    ren(from, name);
    push(t, { si: i, label: 'Renomear planilha', undo: () => ren(name, from), redo: () => ren(from, name) });
  };
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
}
function addSheet(t) {
  const book = t.sh.book; commitEdit(t);
  let n = t.sh.sheets.length + 1; while (t.sh.sheets.some(s => s.name.toLowerCase() === `planilha${n}`)) n++;
  const s = { name: `Planilha${n}`, isNew: true, hidden: false, data: null, load: async () => ({ rows: [], rowAttr: [] }) };
  t.sh.sheets.push(s); book.wbChanged = true;
  setDirty(t, true);
  pick(t, t.sh.sheets.length - 1);
  push(t, { si: t.sh.sheets.length - 1, label: 'Nova planilha', undo: () => { const k = t.sh.sheets.indexOf(s); if (k >= 0) t.sh.sheets.splice(k, 1); pick(t, Math.max(0, k - 1)); }, redo: () => { t.sh.sheets.push(s); pick(t, t.sh.sheets.length - 1); } });
}

// ===== XLSX: gravação =====
// estilos novos entram no fim do styles.xml (fonte, preenchimento, borda e formato a partir do estilo de origem)
function styleWriter(book, doc) {
  const root = doc.documentElement, el = (n) => mk(doc, n);
  // seção que falta (styles.xml mínimo, de outros programas) entra no lugar certo, com o padrão do Excel
  const ORDER = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors', 'extLst'];
  const sect = (name, fill) => {
    let s = kid(root, name); if (s) return s;
    s = el(name); fill(s);
    const after = ORDER.slice(ORDER.indexOf(name) + 1).map(n => kid(root, n)).find(Boolean);
    root.insertBefore(s, after || null); changed = true;
    return s;
  };
  const add = (box, xmlText) => { for (const n of xml(`<x xmlns="${root.namespaceURI}">${xmlText}</x>`).documentElement.children) box.appendChild(doc.importNode(n, true)); };
  let changed = false;
  const fonts = sect('fonts', (s) => add(s, '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'));
  const fills = sect('fills', (s) => add(s, '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'));
  const borders = sect('borders', (s) => add(s, '<border><left/><right/><top/><bottom/><diagonal/></border>'));
  const xfs = sect('cellXfs', (s) => add(s, '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'));
  const cache = new Map(), assigned = [];
  const nfMap = new Map(Object.entries(NF_ID).map(([c, id]) => [c, id]));
  let nextNf = 164;
  for (const nf of tags(doc, 'numFmt')) { nfMap.set(nf.getAttribute('formatCode'), +nf.getAttribute('numFmtId')); nextNf = Math.max(nextNf, +nf.getAttribute('numFmtId') + 1); }
  const nfId = (code) => {
    if (nfMap.has(code)) return nfMap.get(code);
    const box = sect('numFmts', () => {});
    const n = el('numFmt'); n.setAttribute('numFmtId', nextNf); n.setAttribute('formatCode', code); box.appendChild(n);
    box.setAttribute('count', box.children.length); nfMap.set(code, nextNf); return nextNf++;
  };
  const FONT_ORDER = ['b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u', 'vertAlign', 'sz', 'color', 'name', 'family', 'charset', 'scheme'];
  function idx(s) {
    if (s.orig) return s.xf;
    const key = styleKey(s); if (cache.has(key)) return cache.get(key);
    const base = book.styles[s.xf ?? 0] || book.styles[0] || DEF_STYLE;
    const bx = xfs.children[base.xf] || xfs.children[0];
    const xf = bx ? bx.cloneNode(true) : el('xf');
    if (!xf.hasAttribute('numFmtId')) xf.setAttribute('numFmtId', '0');
    for (const a of ['fontId', 'fillId', 'borderId']) if (!xf.hasAttribute(a)) xf.setAttribute(a, '0');
    if ((s.nf || 'General') !== (base.nf || 'General')) { xf.setAttribute('numFmtId', nfId(s.nf || 'General')); xf.setAttribute('applyNumberFormat', '1'); }
    if (['b', 'i', 'u', 's'].some(k => !!s[k] !== !!base[k]) || s.fc !== base.fc) {
      const f = (fonts.children[+xf.getAttribute('fontId')] || fonts.children[0] || el('font')).cloneNode(true), parts = new Map();
      for (const ch of [...f.children]) parts.set(ch.localName, ch);
      for (const [k, tag] of [['b', 'b'], ['i', 'i'], ['u', 'u'], ['s', 'strike']]) if (!!s[k] !== !!base[k]) { if (s[k]) parts.set(tag, el(tag)); else parts.delete(tag); }
      if (s.fc !== base.fc) { if (s.fc) { const c = el('color'); c.setAttribute('rgb', 'FF' + s.fc.slice(1).toUpperCase()); parts.set('color', c); } else parts.delete('color'); }
      while (f.firstChild) f.removeChild(f.firstChild);
      for (const n of FONT_ORDER) if (parts.has(n)) f.appendChild(parts.get(n));
      fonts.appendChild(f); xf.setAttribute('fontId', fonts.children.length - 1); xf.setAttribute('applyFont', '1');
    }
    if (s.bg !== base.bg) {
      if (s.bg) {
        const f = el('fill'), p = el('patternFill'), fg = el('fgColor'), bgc = el('bgColor');
        p.setAttribute('patternType', 'solid'); fg.setAttribute('rgb', 'FF' + s.bg.slice(1).toUpperCase()); bgc.setAttribute('indexed', '64');
        p.appendChild(fg); p.appendChild(bgc); f.appendChild(p); fills.appendChild(f); xf.setAttribute('fillId', fills.children.length - 1);
      } else xf.setAttribute('fillId', '0');
      xf.setAttribute('applyFill', '1');
    }
    if (!!s.bd !== !!base.bd) {
      if (s.bd) {
        const b = el('border');
        for (const n of ['left', 'right', 'top', 'bottom']) { const e = el(n), c = el('color'); e.setAttribute('style', 'thin'); c.setAttribute('auto', '1'); e.appendChild(c); b.appendChild(e); }
        b.appendChild(el('diagonal')); borders.appendChild(b); xf.setAttribute('borderId', borders.children.length - 1);
      } else xf.setAttribute('borderId', '0');
      xf.setAttribute('applyBorder', '1');
    }
    if (s.ha !== base.ha) {
      let al = kid(xf, 'alignment');
      if (s.ha) { if (!al) { al = el('alignment'); xf.insertBefore(al, xf.firstElementChild); } al.setAttribute('horizontal', s.ha); }
      else if (al) al.removeAttribute('horizontal');
      xf.setAttribute('applyAlignment', '1');
    }
    xfs.appendChild(xf);
    const i = xfs.children.length - 1; cache.set(key, i); assigned.push([s, i]); changed = true;
    return i;
  }
  return {
    idx, assigned,
    text() { if (!changed) return null; for (const b of [fonts, fills, borders, xfs]) b.setAttribute('count', b.children.length); return ser(doc); },
  };
}
function cellXml(x, r, c, st) {
  const ref = colName(c) + (r + 1);
  if (typeof x === 'string') x = { v: x };
  const si = x.s ? st.idx(x.s) : 0, sa = si ? ` s="${si}"` : '';
  const v = x.v;
  if (x.f != null) {
    const f = `<f${x.fa ? ` t="array" ref="${xesc(x.fa)}"` : ''}>${xesc(x.f)}</f>`;
    if (v instanceof E) return `<c r="${ref}"${sa} t="e">${f}<v>${v.code}</v></c>`;
    if (typeof v === 'string') return `<c r="${ref}"${sa} t="str">${f}<v>${xesc(v)}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b">${f}<v>${+v}</v></c>`;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${sa}>${f}<v>${v}</v></c>`;
    return `<c r="${ref}"${sa}>${f}</c>`;
  }
  if (v == null) return sa ? `<c r="${ref}"${sa}/>` : '';
  if (v instanceof E) return `<c r="${ref}"${sa} t="e"><v>${v.code}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${+v}</v></c>`;
  if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}"${sa}><v>${v}</v></c>` : `<c r="${ref}"${sa} t="e"><v>#NUM!</v></c>`;
  if (x.si != null) return `<c r="${ref}"${sa} t="s"><v>${x.si}</v></c>`;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
}
// intervalos de um atributo (ref/sqref) depois das inserções/exclusões; vazio quando tudo sumiu
function shiftRefs(list, op) {
  return list.split(/\s+/).filter(Boolean).map(rf => {
    const n = splitRef(rf.replace(/\$/g, '')), b = n.b || { ...n.a };
    const lo = n.a[op.axis], hi = b[op.axis]; if (lo == null) return rf;
    const s = shiftSpan(Math.min(lo, hi), Math.max(lo, hi), op.at, op.n); if (!s) return null;
    n.a[op.axis] = s[0]; b[op.axis] = s[1];
    return endStr(n.a) + (n.b ? ':' + endStr(b) : '');
  }).filter(Boolean).join(' ');
}
function writeSheet(text, sh, st) {
  const doc = xml(text), root = doc.documentElement, el = (n) => mk(doc, n);
  const sd = tags(doc, 'sheetData')[0]; while (sd.firstChild) sd.removeChild(sd.firstChild);
  // dimensão
  let maxR = 0, maxC = 0;
  for (let r = 0; r < sh.rows.length; r++) { const row = sh.rows[r]; if (!row) continue; for (let c = row.length - 1; c >= 0; c--) if (row[c] != null) { maxR = r; maxC = Math.max(maxC, c); break; } }
  const dim = tags(doc, 'dimension')[0]; if (dim) dim.setAttribute('ref', maxR || maxC ? `A1:${colName(maxC)}${maxR + 1}` : 'A1');
  // larguras das colunas
  if (sh.colsChanged) {
    let cols = kid(root, 'cols');
    const old = []; if (cols) for (const col of cols.children) for (let i = +col.getAttribute('min') - 1; i < Math.min(+col.getAttribute('max'), sh.w.length + 64); i++) old[i] = col;
    if (!cols) { cols = el('cols'); root.insertBefore(cols, sd); }
    while (cols.firstChild) cols.removeChild(cols.firstChild);
    // as colunas antigas acompanham as inserções/exclusões
    let src = old.map((col, i) => [i, col]);
    for (const op of sh.ops) if (op.axis === 'c') src = src.map(([i, col]) => { const s = shiftSpan(i, i, op.at, op.n); return s ? [s[0], col] : null; }).filter(Boolean);
    const byCol = new Map(src);
    for (let i = 0; i < Math.max(sh.w.length - XC, ...[...byCol.keys()].map(k => k + 1), 0); i++) {
      if (!byCol.has(i) && !(sh.wUser && sh.wUser.has(i))) continue; // coluna que o arquivo não fixava e ninguém mexeu
      const c = byCol.has(i) ? byCol.get(i).cloneNode(false) : el('col');
      c.setAttribute('min', i + 1); c.setAttribute('max', i + 1);
      const w = sh.w[i] ?? DEF_W;
      if (w === 0) c.setAttribute('hidden', '1'); else { c.removeAttribute('hidden'); c.setAttribute('width', Math.max(0.5, (w - 5) / 7).toFixed(2)); c.setAttribute('customWidth', '1'); }
      cols.appendChild(c);
    }
    if (!cols.children.length) root.removeChild(cols);
  }
  // referências do XML que acompanham linhas e colunas inseridas/excluídas
  for (const op of sh.ops) {
    for (const [name, attr] of [['mergeCell', 'ref'], ['hyperlink', 'ref'], ['conditionalFormatting', 'sqref'], ['dataValidation', 'sqref'], ['autoFilter', 'ref'], ['selection', 'sqref']]) {
      for (const e of [...tags(doc, name)]) { const v = e.getAttribute(attr); if (!v) continue; const nv = shiftRefs(v, op); if (nv) e.setAttribute(attr, nv); else e.parentNode.removeChild(e); }
    }
  }
  for (const e of tags(doc, 'selection')) e.removeAttribute('activeCell');
  for (const name of ['mergeCells', 'conditionalFormatting', 'dataValidations', 'hyperlinks']) for (const e of [...tags(doc, name)]) if (!e.children.length && e.parentNode) e.parentNode.removeChild(e);
  for (const name of ['mergeCells', 'dataValidations']) for (const e of tags(doc, name)) e.setAttribute('count', e.children.length);
  const parts = [], n = Math.max(sh.rows.length, sh.rowAttr.length);
  for (let r = 0; r < n; r++) {
    const row = sh.rows[r], ra = sh.rowAttr[r];
    let cells = '';
    if (row) for (let c = 0; c < row.length; c++) { const x = row[c]; if (x != null) cells += cellXml(x, r, c, st); }
    if (!cells && !ra) continue;
    parts.push(`<row r="${r + 1}"${ra ? ra.map(([k, v]) => ` ${k}="${xesc(v)}"`).join('') : ''}>${cells}</row>`);
  }
  const tag = sd.tagName;
  return ser(doc).replace(new RegExp(`<${tag}\\s*/>|<${tag}>\\s*</${tag}>`), () => `<${tag}>${parts.join('')}</${tag}>`);
}
async function writeBook(book) {
  const { b, files } = book, out = new Map(), drop = new Set(), enc = new TextEncoder();
  const text = (n) => zipText(b, files, n);
  // estilos
  let stDoc = book.stPath ? xml(await text(book.stPath)) : null;
  if (!stDoc) stDoc = xml(`<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`);
  const st = styleWriter(book, stDoc);
  // planilhas novas ganham arquivo, relação e tipo
  const relDoc = xml((await text('xl/_rels/workbook.xml.rels')) || `<Relationships xmlns="${PKG_REL}"/>`);
  const ctDoc = xml(await text('[Content_Types].xml'));
  const wb = xml(await text('xl/workbook.xml'));
  let relsChanged = false, ctChanged = false;
  const newRel = (type, target) => {
    const ids = new Set([...tags(relDoc, 'Relationship')].map(r => r.getAttribute('Id'))); let k = 1; while (ids.has('rId' + k)) k++;
    const r = relDoc.createElementNS(PKG_REL, 'Relationship'); r.setAttribute('Id', 'rId' + k); r.setAttribute('Type', `${NS_R}/${type}`); r.setAttribute('Target', target);
    relDoc.documentElement.appendChild(r); relsChanged = true; return 'rId' + k;
  };
  const override = (part, type) => { const o = ctDoc.createElementNS(ctDoc.documentElement.namespaceURI, 'Override'); o.setAttribute('PartName', part); o.setAttribute('ContentType', type); ctDoc.documentElement.appendChild(o); ctChanged = true; };
  for (const s of book.sheets) if (s.isNew && !s.path) {
    let k = 1; while (files.has(`xl/worksheets/sheet${k}.xml`) || book.sheets.some(x => x.path === `xl/worksheets/sheet${k}.xml`)) k++;
    s.path = `xl/worksheets/sheet${k}.xml`; s.rid = newRel('worksheet', `worksheets/sheet${k}.xml`);
    override('/' + s.path, CT_SHEET);
  }
  if (!book.stPath) { book.stPath = 'xl/styles.xml'; newRel('styles', 'styles.xml'); override('/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'); }
  let anyF = false;
  for (const s of book.sheets) {
    if (s.data && s.data.hasF) anyF = true;
    if (!s.data || !(s.data.changed || s.isNew)) continue;
    const src = s.isNew ? EMPTY_SHEET : await text(s.path);
    out.set(s.path, enc.encode(writeSheet(src || EMPTY_SHEET, s.data, st)));
  }
  const stText = st.text(); if (stText) out.set(book.stPath, enc.encode(stText));
  // workbook: planilhas novas e renomeadas, nomes definidos e recálculo ao abrir no Excel
  const wbSheets = tags(wb, 'sheets')[0];
  for (const s of book.sheets) {
    let e = [...tags(wb, 'sheet')].find(x => relId(x) === s.rid);
    if (!e) {
      e = mk(wb, 'sheet'); const ids = [...tags(wb, 'sheet')].map(x => +x.getAttribute('sheetId') || 0);
      e.setAttribute('name', s.name); e.setAttribute('sheetId', Math.max(0, ...ids) + 1); e.setAttributeNS(NS_R, 'r:id', s.rid); wbSheets.appendChild(e);
    }
    e.setAttribute('name', s.name);
  }
  for (const [a, z] of book.renames) for (const dn of tags(wb, 'definedName')) dn.textContent = rewrite(dn.textContent, (n) => n.sheet != null && n.sheet.toLowerCase() === a.toLowerCase() ? { ...n, sheet: z } : undefined);
  if (anyF) {
    let calc = tags(wb, 'calcPr')[0];
    if (!calc) { calc = mk(wb, 'calcPr'); const after = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'].map(n => kid(wb.documentElement, n)).find(Boolean); wb.documentElement.insertBefore(calc, after || null); }
    calc.setAttribute('fullCalcOnLoad', '1');
  }
  out.set('xl/workbook.xml', enc.encode(ser(wb)));
  // calcChain (ordem de cálculo do Excel) fica velha com fórmulas mudadas: sai, e o Excel a refaz
  const chain = [...files.keys()].find(n => /^xl\/calcChain\.xml$/i.test(n));
  if (chain) {
    drop.add(chain);
    for (const r of [...tags(relDoc, 'Relationship')]) if (/calcChain\.xml$/i.test(r.getAttribute('Target') || '')) { r.parentNode.removeChild(r); relsChanged = true; }
    for (const o of [...tags(ctDoc, 'Override')]) if (/calcChain\.xml$/i.test(o.getAttribute('PartName') || '')) { o.parentNode.removeChild(o); ctChanged = true; }
  }
  if (relsChanged) out.set('xl/_rels/workbook.xml.rels', enc.encode(ser(relDoc)));
  if (ctChanged) out.set('[Content_Types].xml', enc.encode(ser(ctDoc)));
  const list = [];
  for (const [name, f] of files) {
    if (drop.has(name)) continue;
    if (out.has(name)) { list.push({ name, bytes: out.get(name) }); out.delete(name); }
    else list.push({ name, raw: { ...f, data: zipRaw(b, f) } });
  }
  for (const [name, bytes] of out) list.push({ name, bytes });
  return { bytes: await zipBuild(list), assigned: st.assigned };
}
// depois de gravar: o arquivo novo vira a base (estilos criados passam a ser "do arquivo")
function settle(book, bytes, assigned) {
  book.b = bytes; book.files = zipIndex(bytes);
  for (const [s, i] of assigned) { s.orig = true; s.xf = i; book.styles[i] = s; }
  for (const s of book.sheets) { s.isNew = false; if (s.data) { s.data.changed = false; s.data.ops = []; s.data.colsChanged = false; } }
  book.renames = []; book.wbChanged = false; book.fresh = false;
  if (!book.stPath) book.stPath = 'xl/styles.xml';
}
const hasFormats = (sh) => sh.rows.some(row => row && row.some(x => x && typeof x === 'object' && x.s));

async function write(t, path, bytes) {
  return bs.api('file', { project: t.project, file: path }, { method: 'PUT', body: bytes });
}
async function save(t, auto) {
  if (!t.sh || !t.sh.sheets) return;
  if (!commitEdit(t)) return;
  if (!t.dirty) { if (!auto) toast('Nada para salvar', null, 'save'); return; }
  if (t.sh.saving) return;
  const name = t.path.split('/').pop();
  const sh0 = t.sh.sheets[0].data;
  // CSV com formatação: pergunta uma vez (o salvamento automático grava só os valores)
  if (!t.sh.book && !auto && hasFormats(sh0) && !t.sh.csvOk) return askCsv(t);
  t.sh.saving = true;
  try {
    if (!t.sh.book) {
      await write(t, t.path, encode(toCsv(sh0, t.sh.csvOpt), t.sh.csvOpt.enc, t.sh.csvOpt.bom));
    } else {
      const { bytes, assigned } = await writeBook(t.sh.book);
      await write(t, t.path, bytes);
      settle(t.sh.book, bytes, assigned);
      t.size = bytes.length;
    }
    t.sh.savedAt = Date.now();
    t.sh.clean = t.sh.undo[t.sh.undo.length - 1] || null;
    setDirty(t, false);
    if (!auto) toast(`${name} salvo`, 'ok', 'save');
    if (typeof refreshProject === 'function') refreshProject();
  } catch (e) { toast('Erro ao salvar ' + name + ': ' + e.message, 'err'); }
  finally { if (t.sh) t.sh.saving = false; }
}
function askCsv(t) {
  dialog('shCsv', `<div class="dlg-hd"><span class="dlg-ic">${ICON.save}</span><div><h3>CSV não guarda formatação</h3><p>${esc(t.path.split('/').pop())}</p></div></div>
    <p class="sh-dlg">Cores, negrito, bordas e formatos de número aparecem aqui, mas o CSV grava só os valores. Para manter a formatação, salve uma cópia .xlsx (o CSV fica como está).</p>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip" data-csv>Salvar só os valores</button><button class="chip primary" data-x>Salvar como .xlsx</button></div>`,
    (el) => {
      el.querySelector('[data-csv]').onclick = () => { el.hidden = true; t.sh.csvOk = true; save(t); };
      el.querySelector('[data-x]').onclick = () => { el.hidden = true; saveAsXlsx(t); };
    });
}
// CSV -> .xlsx: os textos com cara de número viram números (com o formato que tinham: moeda, porcentagem, data)
async function saveAsXlsx(t) {
  const sh = cur(t); if (!sh || !commitEdit(t)) return;
  try {
    const base = t.path.replace(/\.[^./]*$/, ''), title = base.split('/').pop().replace(/[\\/?*[\]:']/g, ' ').slice(0, 31).trim() || 'Planilha1';
    const st = await bs.api('file/stat', { project: t.project }, { method: 'POST', body: JSON.stringify({ files: [base + '.xlsx', ...[2, 3, 4, 5, 6, 7, 8, 9].map(n => `${base} (${n}).xlsx`)] }) });
    const path = [base + '.xlsx', ...[2, 3, 4, 5, 6, 7, 8, 9].map(n => `${base} (${n}).xlsx`)].find(p => !st.files[p]);
    if (!path) return toast('Já existem cópias .xlsx demais com esse nome', 'err');
    const book = await blankBook(title), d0 = book.styles[0];
    const conv = new Map(), style = (s) => { if (!s) return undefined; let n = conv.get(s); if (!n) { const { b, i, u, s: k, fc, bg, ha, bd, nf } = s; n = restyle(d0, { b, i, u, s: k, fc, bg, ha, bd, nf: nf || 'General' }); conv.set(s, n); } return n; };
    const cell = (x) => {
      if (x == null || x === '') return undefined;
      const s = typeof x === 'object' ? style(x.s) : undefined;
      if (typeof x === 'object' && x.f != null) return { f: x.f, v: x.v, s };
      const text = typeof x === 'string' ? x : x.v == null ? '' : String(x.v);
      if (text === '') return s ? { v: null, s } : undefined;
      const l = literal(text), y = { v: l.v, s };
      if (l.nf && (!s || isGeneral(s.nf))) y.s = restyle(s || d0, { nf: l.nf });
      return y;
    };
    const rows = sh.rows.map(row => row ? row.map(cell) : undefined);
    const data = { uid: ++UID, rows, rowAttr: [], ncol: sh.ncol, w: sh.w.slice(), wUser: new Set(sh.w.map((_, i) => i).slice(0, sh.ncol)), colsChanged: true, changed: true, ops: [], hasF: sh.hasF, name: title, book };
    book.sheets[0].data = data; book.sheets[0].name = title;
    const { bytes } = await writeBook(book);
    await write(t, path, bytes);
    toast(`Salvo como ${path.split('/').pop()} (o CSV ficou como estava)`, 'ok', 'save');
    setDirty(t, false); closeTab(t);
    if (typeof refreshProject === 'function') refreshProject();
    bs.openFile(path);
  } catch (e) { toast('Não deu para salvar como .xlsx: ' + e.message, 'err'); }
}

FV.custom.sheet = {
  build,
  show(t) { if (t.sh) t.sh.drawn = null; requestAnimationFrame(() => draw(t)); },
  // o arquivo mudou no disco: recarrega (a não ser que a mudança seja o próprio salvamento ou haja edição não salva)
  reload(t) {
    if (!t.el || !t.sh) return;
    if (t.sh.saving || (t.sh.savedAt && Date.now() - t.sh.savedAt < 4000)) return;
    if (t.dirty) { toast(`${t.path.split('/').pop()} mudou no disco; suas alterações não salvas continuam aqui`, 'err', 'sh-ext'); return; }
    load(t);
  },
  save,
  close(t) { if (t.sh && t.sh.ro) t.sh.ro.disconnect(); if (CLIP && CLIP.t === t) CLIP = null; },
  // abrir em uma linha (busca, Problemas): vai até ela e seleciona a primeira célula
  goto(t, line) {
    const sh = cur(t); if (!sh) { t.goLine = line; return; }
    const k = sh.view.indexOf(line - 1); if (k < 0) return;
    t.el.querySelector('[data-body]').scrollTop = Math.max(0, k * RH - 60); select(t, k, 0);
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
