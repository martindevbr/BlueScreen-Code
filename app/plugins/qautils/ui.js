// QAutils: o kit do QA (plugin nativo, só interface). Usa o índice e a busca do núcleo, a pasta de dados do plugin e o
// console de Build; nada de servidor próprio. O painel QA (Alt+9) tem quatro abas:
// - Cenários (Gherkin/Cucumber): features por pasta e por chamado, busca por texto, @tag ou chamado, passos do projeto,
//   tags e o andamento da execução manual. No editor (.feature): autocompletar com os passos do projeto e as step
//   definitions, aviso de passo parecido, Contexto automático, renumeração dos CTs, formatação (Shift+Alt+F); acima de
//   cada cenário o status (Passou/Falhou/Bloqueado), as evidências coladas e "Copiar"; relatório de evidências (HTML)
//   e casos de teste (CSV). Em projetos automatizados: steps sem definição, F12, gerar a definição e ▶ executar
// - Kit: dados de teste (CPF, CNPJ, RG, PIS, CNH, título, Renavam, placa, CEP, telefone, cartão de teste...), massa de
//   dados, validar documentos, valores limite, entradas especiais, JSON, Base64/URL/HTML/JWT, data e hora, texto,
//   hash, regex, comparar textos, relatório de bug e ambientes
// - Checklists: modelos (smoke, formulário, login, regressão, acessibilidade, responsividade, API) e as suas
// - Sessão: teste exploratório com missão, cronômetro (também na status bar) e anotações com horário
const { S, api, esc, toast, store, $ } = bs;
// onde o mouse clicou por último: os menus abertos pelo editor (CodeLens) aparecem ali
const mouse = { x: innerWidth / 2, y: innerHeight / 3 };
document.addEventListener('mousedown', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, true);
const atMouse = () => ({ preventDefault() {}, stopPropagation() {}, clientX: mouse.x, clientY: mouse.y + 8 });

const ICO = {
  qa: '<svg class="i" viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg class="i" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  cam: '<svg class="i" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  doc: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  csv: '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/></svg>',
  chev: '<svg class="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  fail: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  block: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
  link: '<svg class="i" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  folder: '<svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  feat: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9 9h.01M14 8h.01M12 12h.01M9 15h.01M15 14h.01"/></svg>',
};
const STATUS = {
  pass: { label: 'Passou', ico: ICO.ok, sym: '✓' },
  fail: { label: 'Falhou', ico: ICO.fail, sym: '✗' },
  blocked: { label: 'Bloqueado', ico: ICO.block, sym: '⊘' },
};

// ---------- Gherkin ----------
const KW = {
  en: { feature: ['Feature', 'Business Need', 'Ability'], rule: ['Rule'], background: ['Background'], scenario: ['Scenario', 'Example'], outline: ['Scenario Outline', 'Scenario Template'], examples: ['Examples', 'Scenarios'], given: ['Given'], when: ['When'], then: ['Then'], and: ['And'], but: ['But'] },
  pt: { feature: ['Funcionalidade', 'Característica', 'Caracteristica'], rule: ['Regra'], background: ['Contexto', 'Cenário de Fundo', 'Cenario de Fundo', 'Fundo'], scenario: ['Cenário', 'Cenario', 'Exemplo'], outline: ['Esquema do Cenário', 'Esquema do Cenario', 'Delineação do Cenário', 'Delineacao do Cenario'], examples: ['Exemplos', 'Cenários', 'Cenarios'], given: ['Dado', 'Dada', 'Dados', 'Dadas'], when: ['Quando'], then: ['Então', 'Entao'], and: ['E'], but: ['Mas'] },
  es: { feature: ['Característica', 'Necesidad del negocio', 'Requisito'], rule: ['Regla', 'Regla de negocio'], background: ['Antecedentes'], scenario: ['Escenario', 'Ejemplo'], outline: ['Esquema del escenario'], examples: ['Ejemplos'], given: ['Dado', 'Dada', 'Dados', 'Dadas'], when: ['Cuando'], then: ['Entonces'], and: ['Y', 'E'], but: ['Pero'] },
};
const HEADS = ['feature', 'rule', 'background', 'outline', 'scenario', 'examples'];
const STEPS = ['given', 'when', 'then', 'and', 'but'];
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RX = {};
function rx(lang) {
  if (RX[lang]) return RX[lang];
  const K = KW[lang];
  const heads = HEADS.flatMap(h => K[h].map(w => [w, h])).sort((a, b) => b[0].length - a[0].length);
  const steps = STEPS.flatMap(s => K[s].map(w => [w, s])).sort((a, b) => b[0].length - a[0].length);
  return RX[lang] = {
    head: new RegExp(`^(\\s*)(${heads.map(x => reEsc(x[0])).join('|')})\\s*:\\s?(.*)$`), headOf: new Map(heads),
    step: new RegExp(`^(\\s*)(${steps.map(x => reEsc(x[0])).join('|')}|\\*)\\s+(.*)$`), stepOf: new Map(steps),
  };
}
// idioma: "# language: pt" ou o das palavras-chave usadas (muita feature em português usa Feature/Scenario)
function langOf(text) {
  const m = /^\s*#\s*language\s*:\s*([\w-]+)/m.exec(text);
  if (m) { const l = m[1].toLowerCase().split('-')[0]; return KW[l] ? l : 'en'; }
  for (const ln of text.split('\n', 400)) for (const l of ['en', 'pt', 'es']) if (rx(l).head.test(ln)) return l;
  return 'en';
}
const cells = (ln) => ln.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(c => c.trim());
// lê a feature: funcionalidade, contexto, cenários (com passos, tags e Exemplos), tags e comentários
function parse(text) {
  const lang = langOf(text); const R = rx(lang);
  const lines = text.split('\n');
  const doc = { lang, lines, feature: null, background: null, scenarios: [], rules: [], tags: [], comments: [] };
  let tags = [], cur = null, lastStep = null, prim = 'given', inDoc = null, ex = null, rule = null;
  const close = (i) => { if (cur && cur.end == null) cur.end = i - 1; };
  lines.forEach((raw, i) => {
    const ln = raw.replace(/\r$/, '');
    const t = ln.trim();
    if (inDoc) { if (t.startsWith(inDoc)) inDoc = null; else if (lastStep) lastStep.doc.push(ln); return; }
    if (t.startsWith('"""') || t.startsWith('```')) { inDoc = t.slice(0, 3); if (lastStep) lastStep.doc = []; return; }
    if (!t) return;
    if (t.startsWith('#')) { doc.comments.push({ line: i, text: t }); return; }
    if (t.startsWith('@')) { for (const x of t.split(/\s+/)) if (x.startsWith('@')) { tags.push(x); doc.tags.push({ tag: x, line: i }); } else break; return; }
    let m = R.head.exec(ln);
    if (m) {
      const kind = R.headOf.get(m[2]); const name = m[3].trim();
      if (kind === 'feature') doc.feature = { line: i, name, kw: m[2], tags, desc: [] };
      else if (kind === 'rule') { close(i); cur = null; rule = { line: i, name, kw: m[2], tags }; doc.rules.push(rule); }
      else if (kind === 'background') { close(i); cur = { kind, line: i, name, kw: m[2], tags: [], steps: [], examples: [], rule }; doc.background = cur; }
      else if (kind === 'scenario' || kind === 'outline') { close(i); cur = { kind, line: i, name, kw: m[2], tags, steps: [], examples: [], rule }; doc.scenarios.push(cur); }
      else if (kind === 'examples' && cur) { ex = { line: i, kw: m[2], header: null, rows: [], rowLines: [], tags }; cur.examples.push(ex); }
      tags = []; lastStep = null; prim = 'given'; if (kind !== 'examples') ex = null;
      return;
    }
    m = R.step.exec(ln);
    if (m && cur) {
      const kw = m[2]; const raw2 = m[2] === '*' ? 'and' : R.stepOf.get(kw);
      if (raw2 === 'given' || raw2 === 'when' || raw2 === 'then') prim = raw2;
      lastStep = { kw, raw: raw2, type: prim, text: m[3].trim(), line: i, col: m[1].length + kw.length + 2, table: [], doc: null };
      cur.steps.push(lastStep); ex = null; return;
    }
    if (t.startsWith('|')) {
      if (ex) { if (!ex.header) ex.header = cells(t); else { ex.rows.push(cells(t)); ex.rowLines.push(i); } }
      else if (lastStep) lastStep.table.push({ cells: cells(t), line: i });
      return;
    }
    if (doc.feature && !cur && !rule && !doc.scenarios.length) doc.feature.desc.push(t);
  });
  close(lines.length);
  return doc;
}
// texto do passo para conferir com as definições: <coluna> vira o valor da 1ª linha dos Exemplos
function concrete(step, sc) {
  if (!/<[^<>]+>/.test(step.text)) return step.text;
  const ex = sc && sc.examples.find(e => e.header && e.rows.length);
  return step.text.replace(/<([^<>]+)>/g, (all, n) => { const k = ex ? ex.header.indexOf(n) : -1; return k >= 0 ? ex.rows[0][k] : 'x'; });
}
const norm = (s) => s.trim().replace(/\s+/g, ' ');
const plain = (s) => norm(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// chamado no nome do arquivo: INC1753202, PRB0068833, SDIGBSID00-2429 (Jira)
const TICKET = /\b(?:INC|PRB|RITM|CHG|TASK|SCTASK|REQ)\d{5,}\b|\b[A-Z][A-Z0-9]{1,15}-\d{1,7}\b/g;
const fileName = (rel) => rel.split('/').pop();
const stemOf = (rel) => fileName(rel).replace(/\.feature$/i, '');
const dirOf = (rel) => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
const ticketsOf = (rel) => [...new Set(stemOf(rel).match(TICKET) || [])];
function titleOf(rel) {
  const t = stemOf(rel).replace(TICKET, '').replace(/^[\s\-_–.\[\]]+|[\s\-_–.\[\]]+$/g, '').replace(/\s*[-–]\s*[-–]\s*/g, ' - ').replace(/^[-–\s]+/, '');
  return t || stemOf(rel);
}
// CT001 do nome do cenário (ou um nome curto para arquivos de evidência)
function scKey(sc) {
  const m = /^\s*([A-Za-z]{1,6})\s*[-_]?\s*(\d{1,5})\b/.exec(sc.name);
  if (m) return (m[1] + m[2]).toUpperCase();
  return (sc.name || 'cenario').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'cenario';
}

// ---------- índice do projeto: features, passos e step definitions ----------
const P = { for: null, files: new Map(), steps: new Map(), tags: new Map(), defs: [], all: [], runner: null, loading: null, at: 0, status: {}, settings: {} };
const proj = () => S.project && S.project.path;
const absOf = (rel) => proj().replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\');
const rawUrl = (rel) => '/api/raw?project=' + encodeURIComponent(proj()) + '&file=' + encodeURIComponent(rel);
const docFor = (rel) => { const t = S.tabs.find(x => x.project === proj() && x.path === rel && x.model); return t ? parse(t.model.getValue()) : (P.files.get(rel) || {}).doc; };

async function settings() { try { P.settings = await plugin.settings.get(); } catch { P.settings = {}; } return P.settings; }
plugin.settings.onChange((v) => { P.settings = v || {}; refreshAll(); });
const automation = () => P.settings.mode === 'automation' || (P.settings.mode !== 'doc' && P.defs.length > 0);

async function index(fresh) {
  const pp = proj(); if (!pp) return;
  if (P.loading && P.for === pp && !fresh) return P.loading;
  if (P.for !== pp) { P.for = pp; P.files = new Map(); P.status = {}; }
  P.loading = (async () => {
    await settings();
    let ix = []; try { ix = await api('index', { project: pp, fresh: fresh ? '1' : null }); } catch { return; }
    if (proj() !== pp) return;
    P.all = ix;
    const feats = ix.filter(f => /\.feature$/i.test(f.p));
    const keep = new Set(feats.map(f => f.p));
    for (const k of [...P.files.keys()]) if (!keep.has(k)) P.files.delete(k);
    const todo = feats.filter(f => { const c = P.files.get(f.p); return !c || c.mtime !== f.mtime; });
    // leitura em paralelo, 8 de cada vez
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map(async f => {
        try { const r = await api('file', { project: pp, file: f.p }); if (!r.binary && !r.tooBig) P.files.set(f.p, { mtime: f.mtime, doc: parse(r.content) }); } catch {}
      }));
    }
    catalog();
    await Promise.all([findDefs(pp), loadStatus(pp)]);
    P.runner = detectRunner(ix);
    P.at = Date.now();
  })();
  try { await P.loading; } finally { P.loading = null; }
  if (proj() === pp) { if (S.tool === 'qa') bs.renderTool(); fireLens(); S.tabs.forEach(t => isFeature(t) && diagnose(t.model)); }
}
// passos únicos (com quantas vezes aparecem e onde) e tags
function catalog() {
  P.steps = new Map(); P.tags = new Map();
  for (const [rel, f] of P.files) {
    const d = f.doc;
    for (const t of d.tags) P.tags.set(t.tag, (P.tags.get(t.tag) || 0) + 1);
    for (const sc of [d.background, ...d.scenarios].filter(Boolean)) for (const st of sc.steps) {
      const k = norm(st.text);
      let e = P.steps.get(k); if (!e) P.steps.set(k, e = { text: k, n: 0, types: {}, uses: [] });
      e.n++; e.types[st.type] = (e.types[st.type] || 0) + 1; if (e.uses.length < 200) e.uses.push({ rel, line: st.line, kw: st.kw });
    }
  }
}

// ---------- step definitions (Java, Kotlin, JS/TS, Ruby, Python, C#) ----------
const DEF_EXT = /\.(java|kt|groovy|scala|js|mjs|cjs|ts|mts|rb|py|cs)$/i;
const DEF_SEARCH = String.raw`@(?:Given|When|Then|And|But|Step|Dado|Dada|Dados|Dadas|Quando|Entao|Então|E|Mas|Cuando|Entonces|Y|Pero|given|when|then|step)\s*\(|^\s*(?:Given|When|Then|And|But|Dado|Quando|Entao|Então|E|Mas|defineStep|Step)\s*\(\s*['"/` + '`' + String.raw`]|\[(?:Given|When|Then|StepDefinition)\s*\(\s*@?"`;
async function findDefs(pp) {
  let hits = [];
  try { hits = (await api('search', { project: pp, q: DEF_SEARCH, regex: '1', case: '1' })).hits || []; } catch {}
  const defs = [];
  for (const h of hits) {
    if (!DEF_EXT.test(h.p)) continue;
    const d = defLine(h.text, h.p); if (!d) continue;
    defs.push({ ...d, rel: h.p, line: h.line });
  }
  P.defs = defs;
}
const PT = { int: '-?\\d+', float: '-?\\d*[.,]?\\d+', double: '-?\\d*[.,]?\\d+', bigdecimal: '-?\\d*[.,]?\\d+', long: '-?\\d+', short: '-?\\d+', byte: '-?\\d+', biginteger: '-?\\d+', word: '[^\\s]+', string: '"[^"]*"|\'[^\']*\'', '': '.*' };
// expressão do Cucumber ("tenho {int} itens(s) no carrinho/cesto") -> regex
function cucumberExpr(src) {
  const part = (s) => {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { out += reEsc(s[++i]); continue; }
      if (c === '{') { const j = s.indexOf('}', i); const name = s.slice(i + 1, j < 0 ? s.length : j); out += `(${PT[name] ?? '.*'})`; i = j < 0 ? s.length : j; continue; }
      if (c === '(') { const j = s.indexOf(')', i); out += `(?:${reEsc(s.slice(i + 1, j < 0 ? s.length : j))})?`; i = j < 0 ? s.length : j; continue; }
      out += reEsc(c);
    }
    return out;
  };
  return src.split(' ').map(tok => /(?<!\\)\//.test(tok) && !/[{]/.test(tok) ? `(?:${tok.split(/(?<!\\)\//).map(part).join('|')})` : part(tok)).join(' ');
}
function defLine(text, rel) {
  const m = /(?:@|\[|^\s*)([A-Za-zÀ-ú]+)\s*\(\s*(?:value\s*=\s*)?(@"(?:[^"]|"")*"|[rRuUbB]?"(?:[^"\\]|\\.)*"|[rRuUbB]?'(?:[^'\\]|\\.)*'|`[^`]*`|\/(?:[^/\\\n]|\\.)+\/[gimsuy]*)/.exec(text);
  if (!m) return null;
  const kw = m[1]; let lit = m[2]; const ext = (rel.split('.').pop() || '').toLowerCase();
  let src, kind = 'expr';
  try {
    if (lit.startsWith('/')) { const k = lit.lastIndexOf('/'); src = lit.slice(1, k); kind = 'regex'; }
    else {
      const verbatim = lit.startsWith('@'); const raw = /^[rR]/.test(lit);
      lit = lit.replace(/^[@rRuUbB]+/, ''); let s = lit.slice(1, -1);
      if (verbatim) s = s.replace(/""/g, '"'); else if (!raw) s = s.replace(/\\(["'\\`])/g, '$1');
      // ^...$ é regex (regra do Cucumber); SpecFlow (C#) também é regex; behave usa {nome} como parâmetro
      if (/^\^|\$$/.test(s) || (ext === 'cs' && /[()\\[\]]/.test(s))) { src = s.replace(/^\^/, '').replace(/\$$/, ''); kind = 'regex'; }
      else if (ext === 'py') src = s.split(/\{[^}]*\}/).map(reEsc).join('(.+?)');
      else src = cucumberExpr(s);
      lit = s;
    }
    const re = new RegExp('^(?:' + src + ')$');
    // começo literal (para descartar rápido o que não tem chance)
    const pre = kind === 'expr' ? plain(lit.split(/[{(\\/]/)[0]).split(' ').slice(0, -1).join(' ') : '';
    return { kw, pattern: lit, re, kind, pre };
  } catch { return null; }
}
function defsFor(text) { const p = plain(text); return P.defs.filter(d => (!d.pre || p.startsWith(d.pre)) && d.re.test(text)); }

// ---------- execução manual (status por cenário) ----------
const stKey = (rel, sc) => rel + '::' + norm(sc.name || ('linha ' + (sc.line + 1)));
async function loadStatus(pp) { try { P.status = (await plugin.data.get('st:' + pp)) || {}; } catch { P.status = {}; } }
async function setStatus(rel, sc, s, note) {
  const k = stKey(rel, sc);
  if (s) P.status[k] = { s, at: Date.now(), by: P.settings.qaName || '', note: note || (P.status[k] && P.status[k].note) || '' }; else delete P.status[k];
  try { await plugin.data.set('st:' + proj(), P.status); } catch (e) { toast(e.message); }
  fireLens(); if (S.tool === 'qa') bs.renderTool();
}
const statusOf = (rel, sc) => P.status[stKey(rel, sc)] || null;

// ---------- evidências: <pasta da feature>/<evidencias>/<nome da feature>/CT001_1.png ----------
const evDir = (rel) => { const d = dirOf(rel); const e = (P.settings.evidenceDir || 'evidencias').replace(/[\\/]+$/, ''); return (d ? d + '/' : '') + e + '/' + stemOf(rel); };
const IMG = /\.(png|jpe?g|gif|webp|bmp)$/i;
function evidences(rel, sc) {
  const dir = evDir(rel) + '/'; const key = scKey(sc) + '_';
  return P.all.filter(f => f.p.startsWith(dir) && fileName(f.p).startsWith(key) && IMG.test(f.p)).map(f => f.p).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
async function ensureDir(dir) { try { await api('file/new', { project: proj() }, { method: 'POST', body: JSON.stringify({ path: dir, dir: true }) }); } catch (e) { if (!/existe/i.test(e.message)) throw e; } }
async function saveEvidence(rel, sc, blob, ext) {
  const dir = evDir(rel); await ensureDir(dir);
  const used = evidences(rel, sc).map(p => +((/_(\d+)\.\w+$/.exec(p) || [])[1] || 0));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  const path = `${dir}/${scKey(sc)}_${n}.${ext}`;
  await api('file', { project: proj(), file: path }, { method: 'PUT', body: blob });
  P.all.push({ p: path, size: blob.size, mtime: Date.now() });
  return path;
}

// ---------- texto, CSV e relatório ----------
const fmtDate = (ms) => ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
function scenarioText(rel, d, sc) {
  const out = [`${sc.name}`];
  if (d.background && d.background.steps.length) out.push(...d.background.steps.map(s => `${s.kw} ${s.text}`), '—');
  for (const s of sc.steps) { out.push(`${s.kw} ${s.text}`); for (const r of s.table) out.push('  | ' + r.cells.join(' | ') + ' |'); }
  for (const ex of sc.examples) if (ex.header) { out.push(`${ex.kw}:`, '  | ' + ex.header.join(' | ') + ' |', ...ex.rows.map(r => '  | ' + r.join(' | ') + ' |')); }
  const st = statusOf(rel, sc);
  if (st) out.push('', `Resultado: ${STATUS[st.s].sym} ${STATUS[st.s].label} em ${fmtDate(st.at)}${st.by ? ' (' + st.by + ')' : ''}${st.note ? ' — ' + st.note : ''}`);
  return out.join('\n');
}
function csvOf(rels) {
  const q = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Chamado', 'Arquivo', 'Funcionalidade', 'ID', 'Cenário', 'Tags', 'Pré-condições', 'Passos', 'Resultado esperado', 'Exemplos', 'Status', 'Executado em', 'QA', 'Observação']];
  for (const rel of rels) {
    const d = docFor(rel); if (!d) continue;
    const bg = d.background ? d.background.steps.map(s => `${s.kw} ${s.text}`) : [];
    for (const sc of d.scenarios) {
      const by = (t) => sc.steps.filter(s => s.type === t).map(s => `${s.kw} ${s.text}`);
      const st = statusOf(rel, sc); const id = /^([A-Za-z]{1,6}\s*-?\s*\d+)/.exec(sc.name);
      rows.push([ticketsOf(rel).join(' '), rel, d.feature ? d.feature.name : '', id ? id[1].replace(/\s+/g, '') : '', id ? sc.name.slice(id[0].length).replace(/^[\s\-–:]+/, '') : sc.name,
        [...(d.feature ? d.feature.tags : []), ...sc.tags].join(' '), [...bg, ...by('given')].join('\n'), by('when').join('\n'), by('then').join('\n'),
        sc.examples.reduce((n, e) => n + e.rows.length, 0) || '', st ? STATUS[st.s].label : 'Não executado', st ? fmtDate(st.at) : '', st ? st.by : '', st ? st.note : '']);
    }
  }
  return '\uFEFF' + rows.map(r => r.map(q).join(';')).join('\r\n') + '\r\n';
}
function relFrom(fromDir, to) {
  const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
  let i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].map(encodeURIComponent).join('/');
}
function ticketLink(id) {
  for (const line of String(P.settings.ticketUrl || '').split('\n')) { const m = /^\s*([^=\s]+)\s*=\s*(\S+)/.exec(line); if (m && id.toUpperCase().startsWith(m[1].toUpperCase())) return m[2].replace(/\{id\}/g, encodeURIComponent(id)); }
  return null;
}
// relatório de evidências em HTML (abre no navegador; dá para imprimir em PDF); as imagens ficam com caminho relativo
function reportHtml(rels, outDir) {
  const h = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let pass = 0, fail = 0, blocked = 0, none = 0;
  const parts = rels.map(rel => {
    const d = docFor(rel); if (!d) return '';
    const tk = ticketsOf(rel).map(id => { const u = ticketLink(id); return u ? `<a href="${h(u)}">${h(id)}</a>` : h(id); }).join(' · ');
    const bg = d.background && d.background.steps.length ? `<div class="bg"><b>${h(d.background.kw)}</b>${d.background.steps.map(s => `<div class="st"><b>${h(s.kw)}</b> ${h(s.text)}</div>`).join('')}</div>` : '';
    const scs = d.scenarios.map(sc => {
      const st = statusOf(rel, sc); if (!st) none++; else if (st.s === 'pass') pass++; else if (st.s === 'fail') fail++; else blocked++;
      const ev = evidences(rel, sc).map(p => `<figure><img src="${relFrom(outDir, p)}" alt=""><figcaption>${h(fileName(p))}</figcaption></figure>`).join('');
      const steps = sc.steps.map(s => `<div class="st"><b>${h(s.kw)}</b> ${h(s.text).replace(/&lt;([^&]+)&gt;/g, '<i>&lt;$1&gt;</i>')}${s.table.length ? `<table>${s.table.map(r => `<tr>${r.cells.map(c => `<td>${h(c)}</td>`).join('')}</tr>`).join('')}</table>` : ''}</div>`).join('');
      const exs = sc.examples.filter(e => e.header).map(e => `<div class="ex"><b>${h(e.kw)}</b><table><tr>${e.header.map(c => `<th>${h(c)}</th>`).join('')}</tr>${e.rows.map(r => `<tr>${r.map(c => `<td>${h(c)}</td>`).join('')}</tr>`).join('')}</table></div>`).join('');
      return `<section class="sc ${st ? st.s : 'none'}"><header><h3>${h(sc.name)}</h3><span class="badge">${st ? STATUS[st.s].sym + ' ' + STATUS[st.s].label : 'Não executado'}</span></header>
        ${sc.tags.length ? `<div class="tags">${sc.tags.map(h).join(' ')}</div>` : ''}${steps}${exs}
        ${st ? `<p class="meta">${h(fmtDate(st.at))}${st.by ? ' · ' + h(st.by) : ''}${st.note ? ' · ' + h(st.note) : ''}</p>` : ''}${ev ? `<div class="ev">${ev}</div>` : ''}</section>`;
    }).join('');
    return `<article><h2>${h(d.feature ? d.feature.name : titleOf(rel))}</h2><p class="file">${tk ? tk + ' · ' : ''}${h(rel)}</p>${d.feature && d.feature.desc.length ? `<p class="desc">${d.feature.desc.map(h).join('<br>')}</p>` : ''}${bg}${scs}</article>`;
  }).join('');
  const total = pass + fail + blocked + none;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório de evidências</title><style>
body{font:14px/1.5 system-ui,Segoe UI,sans-serif;color:#1d2330;max-width:1000px;margin:24px auto;padding:0 16px;background:#fff}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 2px;border-bottom:2px solid #e3e7ee;padding-bottom:4px}h3{font-size:15px;margin:0}
.sum{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 4px}.sum span{padding:4px 10px;border-radius:999px;background:#f1f3f7;font-weight:600}
.sum .p{background:#e3f6ea;color:#17703f}.sum .f{background:#fde7e7;color:#a32020}.sum .b{background:#fff3d6;color:#8a5a00}
.file,.meta{color:#667;font-size:12px;margin:0}.desc{color:#445}.sc{border:1px solid #e3e7ee;border-left:5px solid #c5ccd8;border-radius:8px;padding:10px 14px;margin:12px 0;break-inside:avoid}
.sc.pass{border-left-color:#2fa35c}.sc.fail{border-left-color:#d93636}.sc.blocked{border-left-color:#e3a21a}
.sc header{display:flex;justify-content:space-between;gap:10px;align-items:center}.badge{font-size:12px;font-weight:700;white-space:nowrap}
.pass .badge{color:#17703f}.fail .badge{color:#a32020}.blocked .badge{color:#8a5a00}.none .badge{color:#778}
.st{margin:2px 0 2px 8px}.st b{color:#2357b5}.bg{background:#f7f8fb;border-radius:6px;padding:6px 10px;margin:8px 0}.tags{color:#7a4fc0;font-size:12px}
table{border-collapse:collapse;margin:4px 0 4px 16px;font-size:13px}td,th{border:1px solid #d8dde6;padding:2px 8px}th{background:#f1f3f7}
.ev{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:10px}figure{margin:0}img{width:100%;border:1px solid #d8dde6;border-radius:6px}
figcaption{font-size:11px;color:#778}@media print{body{margin:0}.sc{page-break-inside:avoid}}</style></head><body>
<h1>Relatório de evidências</h1><p class="meta">${h(fmtDate(Date.now()))}${P.settings.qaName ? ' · QA: ' + h(P.settings.qaName) : ''} · ${h(S.project.name || '')}</p>
<div class="sum"><span>${total} cenário(s)</span><span class="p">✓ ${pass} passou</span><span class="f">✗ ${fail} falhou</span><span class="b">⊘ ${blocked} bloqueado</span><span>${none} não executado</span></div>
${parts}</body></html>`;
}
async function openOutside(rel) { try { await plugin.exec('explorer.exe', [absOf(rel)], { timeout: 15000 }); } catch (e) { toast(e.message); } }
async function writeText(rel, text) {
  const dir = dirOf(rel); if (dir) await ensureDir(dir);
  await api('file', { project: proj(), file: rel }, { method: 'PUT', body: text });
  if (!P.all.some(f => f.p === rel)) P.all.push({ p: rel, size: text.length, mtime: Date.now() });
}
const featuresIn = (dir) => [...P.files.keys()].filter(r => !dir || r === dir || r.startsWith(dir + '/')).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
async function makeReport(target, isDir) {
  await index();
  const rels = isDir ? featuresIn(target) : [target]; if (!rels.length) return toast('Nenhuma feature aqui');
  const out = isDir ? (target ? target + '/' : '') + 'relatorio-evidencias.html' : evDir(target) + '/relatorio.html';
  try { await writeText(out, reportHtml(rels, dirOf(out))); toast('Relatório gerado: ' + out, 'ok'); openOutside(out); } catch (e) { toast(e.message); }
}
async function exportCsv(target, isDir) {
  await index();
  const rels = isDir ? featuresIn(target) : [target]; if (!rels.length) return toast('Nenhuma feature aqui');
  const out = isDir ? (target ? target + '/' : '') + 'casos-de-teste.csv' : (dirOf(target) ? dirOf(target) + '/' : '') + stemOf(target) + ' - casos de teste.csv';
  try { await writeText(out, csvOf(rels)); toast(`${rels.length === 1 ? 'Casos de teste exportados' : rels.length + ' features exportadas'}: ${out}`, 'ok'); bs.openFile(out, 'editor'); } catch (e) { toast(e.message); }
}

// ---------- formatação (Shift+Alt+F): recuo padrão e tabelas alinhadas ----------
function format(text) {
  const d = parse(text); const R = rx(d.lang);
  const lines = text.replace(/\r/g, '').split('\n');
  const out = []; let inDoc = null, docIn = 0, docBase = 0, ruleDepth = 0, level = 0, blank = 0;
  const pad = (n) => ' '.repeat(n);
  const tableAt = (i) => { let j = i; while (j < lines.length && lines[j].trim().startsWith('|')) j++; return j; };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i], t = ln.trim();
    if (inDoc) { out.push(t.startsWith(inDoc) ? pad(docIn) + t : (ln.length - ln.trimStart().length >= docBase ? pad(docIn) + ln.slice(docBase) : pad(docIn) + ln.trimStart()).replace(/\s+$/, '')); if (t.startsWith(inDoc)) inDoc = null; continue; }
    if (!t) { if (++blank <= 1 && out.length) out.push(''); continue; }
    blank = 0;
    if (t.startsWith('"""') || t.startsWith('```')) { inDoc = t.slice(0, 3); docIn = level + 2; docBase = ln.length - ln.trimStart().length; out.push(pad(docIn) + t); continue; }
    if (t.startsWith('|')) {
      const end = tableAt(i); const rows = lines.slice(i, end).map(cells);
      const w = []; rows.forEach(r => r.forEach((c, k) => { w[k] = Math.max(w[k] || 0, [...c].length); }));
      const ind = level + 2;
      for (const r of rows) out.push(pad(ind) + '| ' + w.map((n, k) => (r[k] ?? '') + ' '.repeat(n - [...(r[k] ?? '')].length)).join(' | ') + ' |');
      i = end - 1; continue;
    }
    const m = R.head.exec(ln);
    if (m) {
      const kind = R.headOf.get(m[2]);
      if (kind === 'feature') { level = 0; ruleDepth = 0; }
      else if (kind === 'rule') { level = 2; ruleDepth = 2; }
      else if (kind === 'examples') level = 4 + ruleDepth;
      else level = 2 + ruleDepth;
      // tags e comentários logo acima ficam no recuo do que vem a seguir
      for (let k = out.length - 1; k >= 0 && /^\s*[@#]/.test(out[k]) && !/^\s*#\s*language/.test(out[k]); k--) out[k] = pad(level) + out[k].trim();
      out.push(pad(level) + `${m[2]}:${m[3].trim() ? ' ' + m[3].trim() : ''}`);
      if (kind !== 'examples') level += 2; else level += 0;
      continue;
    }
    if (R.step.test(ln)) { const s = R.step.exec(ln); out.push(pad(level) + `${s[2]} ${s[3].trim()}`); continue; }
    if (/^#\s*language/.test(t)) { out.push(t); continue; }
    out.push(pad(t.startsWith('@') || t.startsWith('#') ? level : level) + t);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n') + '\n';
}

// ---------- refatorações ----------
// passos que abrem todos os cenários do mesmo jeito -> Contexto
function commonPrefix(d) {
  const scs = d.scenarios.filter(s => !s.rule);
  if (scs.length < 2 || scs.some(s => !s.steps.length)) return [];
  const out = [];
  for (let i = 0; ; i++) {
    // só pré-condições (Dado/Given e os E/And que as seguem): ação e resultado continuam no cenário
    const first = scs[0].steps[i]; if (!first || first.type !== 'given') break;
    if (!scs.every(s => s.steps[i] && norm(s.steps[i].text) === norm(first.text) && s.steps[i].type === first.type && s.steps.length > i + 1)) break;
    out.push(first);
  }
  return out;
}
function toBackgroundEdits(model, d) {
  const n = commonPrefix(d).length; if (!n) return null;
  const K = KW[d.lang];
  const edits = [];
  const steps = d.scenarios[0].steps.slice(0, n);
  const ind = (l) => (d.lines[l].match(/^\s*/) || [''])[0];
  // o 1º passo que sobra em cada cenário não pode começar com E/And: vira a palavra principal
  for (const sc of d.scenarios) {
    const lastSt = sc.steps[n - 1]; const first = sc.steps[0].line, last = lastSt.table.length ? lastSt.table[lastSt.table.length - 1].line : lastSt.line;
    edits.push({ range: new bs.monaco.Range(first + 1, 1, last + 2, 1), text: '' });
    const next = sc.steps[n];
    if (next && (next.raw === 'and' || next.raw === 'but')) edits.push({ range: new bs.monaco.Range(next.line + 1, next.col - next.kw.length - 1, next.line + 1, next.col - 1), text: K[next.type][0] });
  }
  const sc0 = d.scenarios[0]; let at = sc0.line; while (at > 0 && /^\s*[@#]/.test(d.lines[at - 1])) at--;
  const kwOf = (s, i) => i === 0 && (s.raw === 'and' || s.raw === 'but') ? K[s.type][0] : s.kw;
  const head = ind(sc0.line);
  const bgText = `${head}${K.background[0]}:\n` + steps.map((s, i) => `${ind(s.line)}${kwOf(s, i)} ${s.text}\n${s.table.map(r => d.lines[r.line] + '\n').join('')}`).join('') + '\n';
  if (d.background) {
    const lastBg = d.background.steps[d.background.steps.length - 1];
    const line = lastBg ? lastBg.line + 1 + lastBg.table.length : d.background.line + 1;
    edits.push({ range: new bs.monaco.Range(line + 1, 1, line + 1, 1), text: steps.map(s => `${ind(s.line)}${s.raw === 'given' && lastBg ? K.and[0] : s.kw} ${s.text}\n`).join('') });
  } else edits.push({ range: new bs.monaco.Range(at + 1, 1, at + 1, 1), text: bgText });
  return edits;
}
// CT001, CT002... na ordem do arquivo (mantém o prefixo e a largura que já existem)
function renumberEdits(d) {
  const pre = (P.settings.prefix || 'CT').trim() || 'CT';
  const ex = d.scenarios.map(s => /^\s*([A-Za-z]{1,6})(\s*[-_]?\s*)(\d{1,5})(\s*[-–:]?\s*)/.exec(s.name));
  const width = Math.max(3, ...ex.filter(Boolean).map(m => m[3].length));
  const prefix = (ex.find(Boolean) || [null, pre])[1];
  const edits = [];
  d.scenarios.forEach((s, i) => {
    const id = prefix + String(i + 1).padStart(width, '0');
    const m = ex[i]; const ln = d.lines[s.line]; const col = ln.indexOf(':') + 1 + (ln[ln.indexOf(':') + 1] === ' ' ? 1 : 0);
    const name = m ? s.name.slice(m[0].length) : s.name;
    const text = `${id}${m ? (m[4] || ' ') : ' '}${name}`.replace(/\s+$/, '');
    if (text !== s.name) edits.push({ range: new bs.monaco.Range(s.line + 1, col + 1, s.line + 1, ln.length + 1), text });
  });
  return edits;
}
const nextId = (d) => {
  const ns = d.scenarios.map(s => /^\s*([A-Za-z]{1,6})\s*[-_]?\s*(\d{1,5})/.exec(s.name)).filter(Boolean);
  const pre = ns.length ? ns[ns.length - 1][1] : (P.settings.prefix || 'CT');
  const w = ns.length ? ns[ns.length - 1][2].length : 3;
  return pre + String((ns.length ? Math.max(...ns.map(m => +m[2])) : 0) + 1).padStart(w, '0');
};

// ---------- passo parecido (o padrão é o mais usado no projeto) ----------
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
let pool = null, poolAt = 0;
// Parecido = as mesmas palavras, na mesma ordem, com até 2 delas diferentes só por digitação ou acento. Palavra a
// mais ou a menos ("não", "nenhum") e número diferente mudam o sentido do teste: nunca contam como parecido.
function similarTo(text) {
  if (!pool || poolAt !== P.at) { pool = [...P.steps.values()].filter(e => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, 1500).map(e => ({ e, p: plain(e.text), w: plain(e.text).split(' ') })); poolAt = P.at; }
  const p = plain(text); const w = p.split(' '); const own = P.steps.get(norm(text)); const ownN = own ? own.n : 0;
  let best = null;
  for (const c of pool) {
    if (c.e.n <= ownN || c.e.text === norm(text) || c.w.length !== w.length) continue;
    if (c.p === p) return { e: c.e, dist: 0 }; // só acento, maiúscula ou espaço
    let diff = 0, dist = 0;
    for (let i = 0; i < w.length && diff <= 2; i++) {
      if (w[i] === c.w[i]) continue;
      if (/\d|["'<]/.test(w[i] + c.w[i])) { diff = 9; break; }
      const max = Math.max(1, Math.floor(Math.min(w[i].length, c.w[i].length) / 4));
      const d = lev(w[i], c.w[i], max); if (d > max) { diff = 9; break; }
      diff++; dist += d;
    }
    if (diff <= 2 && (!best || dist < best.dist || (dist === best.dist && c.e.n > best.e.n))) best = { e: c.e, dist };
  }
  return best;
}

// ---------- editor ----------
const isFeature = (t) => t && t.model && /\.feature$/i.test(t.path || '');
const relOfModel = (m) => (m && m._tab && m._tab.project === proj()) ? m._tab.path : null;
const hold = new WeakMap(); // modelo -> { doc, marks }
const lensEmitter = { list: new Set(), fire() { this.list.forEach(f => { try { f(); } catch {} }); } };
const fireLens = () => lensEmitter.fire();
const watched = new WeakSet();
function watch(tab) {
  if (!isFeature(tab) || watched.has(tab.model)) return;
  watched.add(tab.model);
  let tm = null;
  tab.model.onDidChangeContent(() => { clearTimeout(tm); tm = setTimeout(() => diagnose(tab.model), 350); });
  diagnose(tab.model);
}
function diagnose(model) {
  const monaco = bs.monaco; if (!monaco || model.isDisposed()) return;
  const d = parse(model.getValue());
  const marks = []; const data = [];
  const auto = automation(); const sim = P.settings.similar !== false;
  const mk = (line, c1, c2, sev, msg, code, extra) => { marks.push({ startLineNumber: line + 1, startColumn: c1, endLineNumber: line + 1, endColumn: c2, severity: sev, message: msg, source: 'Cucumber', code }); data.push({ line, code, ...extra }); };
  for (const sc of [d.background, ...d.scenarios].filter(Boolean)) for (const st of sc.steps) {
    const c1 = st.col, c2 = d.lines[st.line].replace(/\s+$/, '').length + 1;
    if (auto && P.defs.length) {
      const defs = defsFor(concrete(st, sc));
      if (!defs.length) mk(st.line, c1, c2, monaco.MarkerSeverity.Warning, 'Passo sem definição (step definition). Alt+Enter cria.', 'undefined', { st, sc });
      else if (defs.length > 1) mk(st.line, c1, c2, monaco.MarkerSeverity.Warning, `Passo ambíguo: ${defs.length} definições (${defs.slice(0, 3).map(x => fileName(x.rel) + ':' + x.line).join(', ')})`, 'ambiguous', {});
      continue;
    }
    if (sim && P.steps.size) {
      const s = similarTo(st.text);
      if (s) mk(st.line, c1, c2, monaco.MarkerSeverity.Info, `Parecido com o passo padrão “${s.e.text}” (usado ${s.e.n} vezes no projeto). Alt+Enter troca.`, 'similar', { to: s.e.text });
    }
  }
  // comentário que parece uma tag (#Sistema_E2E_...): vira @tag
  for (const c of d.comments) if (/^#[A-Za-zÀ-ú][\w.\-À-ú]{3,}$/.test(c.text) && !/^#\s*language/i.test(c.text)) mk(c.line, 1, d.lines[c.line].length + 1, monaco.MarkerSeverity.Hint, 'Comentário com cara de tag: como tag (@...) ele filtra execução e aparece no painel QA. Alt+Enter converte.', 'comment-tag', { tag: '@' + c.text.slice(1) });
  monaco.editor.setModelMarkers(model, 'cucumber', marks);
  hold.set(model, { doc: d, data });
}

function stepAt(d, line) {
  for (const sc of [d.background, ...d.scenarios].filter(Boolean)) { const st = sc.steps.find(s => s.line === line); if (st) return { st, sc }; }
  return null;
}
async function modelForRel(rel) {
  const monaco = bs.monaco; const uri = monaco.Uri.parse(bs.lsp.pathToUri(absOf(rel)));
  let m = monaco.editor.getModel(uri);
  if (!m) { try { const f = await api('file', { project: proj(), file: rel }); if (!f.binary) m = monaco.editor.createModel(f.content, undefined, uri); } catch {} }
  return m;
}

// definição do passo (código), com Java/Kotlin/JS... no idioma da feature
function exprFrom(text) {
  const params = []; let n = 0;
  let expr = text.replace(/\\/g, '\\\\').replace(/([(){}/])/g, '\\$1');
  expr = expr.replace(/"[^"]*"|'[^']*'|-?\b\d+(?:[.,]\d+)?\b|<[^<>]+>/g, (m) => {
    if (m.startsWith('"') || m.startsWith("'") || m.startsWith('<')) { params.push(['string', 'String', 'string' + (++n > 1 ? n : '')]); return '{string}'; }
    const f = /[.,]/.test(m); params.push(f ? ['float', 'Double', 'double' + (++n)] : ['int', 'Integer', 'int' + (++n)]); return f ? '{float}' : '{int}';
  });
  return { expr, params };
}
function methodName(text) {
  const w = text.replace(/"[^"]*"|'[^']*'|<[^<>]+>|-?\d+(?:[.,]\d+)?/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 10);
  const s = w.map((x, i) => i ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase()).join('');
  return /^[a-z]/.test(s) ? s : 'passo' + s;
}
function defLanguage() {
  const exts = P.defs.map(d => d.rel.split('.').pop().toLowerCase());
  const most = exts.sort((a, b) => exts.filter(x => x === b).length - exts.filter(x => x === a).length)[0];
  if (most) return { java: 'java', kt: 'kotlin', js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', mts: 'ts', rb: 'ruby', py: 'python', cs: 'csharp' }[most] || 'java';
  return { maven: 'java', gradle: 'java', npm: 'js', ruby: 'ruby', behave: 'python' }[P.runner && P.runner.kind] || 'java';
}
function defCode(lang, flang, st) {
  const { expr, params } = exprFrom(st.text);
  const ptAnn = { given: 'Dado', when: 'Quando', then: 'Entao' }, enAnn = { given: 'Given', when: 'When', then: 'Then' }, esAnn = { given: 'Dado', when: 'Cuando', then: 'Entonces' };
  const ann = (flang === 'pt' ? ptAnn : flang === 'es' ? esAnn : enAnn)[st.type];
  const q = (s) => s.replace(/"/g, '\\"');
  switch (lang) {
    case 'kotlin': return { ann, pkg: `io.cucumber.java.${flang}.${ann}`, code: `\n    @${ann}("${q(expr)}")\n    fun ${methodName(st.text)}(${params.map(p => `${p[2]}: ${p[1] === 'Integer' ? 'Int' : p[1]}`).join(', ')}) {\n        // TODO: implementar\n        throw io.cucumber.java.PendingException()\n    }\n` };
    case 'js': case 'ts': return { code: `\n${enAnn[st.type]}('${expr.replace(/'/g, "\\'")}', async function (${params.map(p => p[2] + (lang === 'ts' ? ': ' + (p[0] === 'string' ? 'string' : 'number') : '')).join(', ')}) {\n  // TODO: implementar\n  return 'pending';\n});\n` };
    case 'ruby': return { code: `\n${ann}('${expr.replace(/'/g, "\\'")}') do |${params.map(p => p[2]).join(', ')}|\n  pending # TODO: implementar\nend\n` };
    case 'python': { let k = 0; return { code: `\n@${enAnn[st.type].toLowerCase()}('${expr.replace(/\{(string|int|float)\}/g, () => '{p' + (++k) + '}').replace(/'/g, "\\'")}')\ndef step_impl(context${params.map((_, i) => ', p' + (i + 1)).join('')}):\n    raise NotImplementedError('TODO: implementar')\n` }; }
    case 'csharp': return { code: `\n    [${enAnn[st.type]}("${q(expr)}")]\n    public void ${methodName(st.text).replace(/^./, c => c.toUpperCase())}(${params.map(p => (p[0] === 'string' ? 'string ' : p[0] === 'int' ? 'int ' : 'double ') + p[2]).join(', ')})\n    {\n        throw new PendingStepException();\n    }\n` };
    default: return { ann, pkg: `io.cucumber.java.${flang}.${ann}`, code: `\n    @${ann}("${q(expr)}")\n    public void ${methodName(st.text)}(${params.map(p => p[1] + ' ' + p[2]).join(', ')}) {\n        // TODO: implementar\n        throw new io.cucumber.java.PendingException();\n    }\n` };
  }
}
async function createDefinition(rel, line) {
  const t = S.tabs.find(x => x.path === rel && x.model); const d = t ? parse(t.model.getValue()) : docFor(rel); if (!d) return;
  const hit = stepAt(d, line); if (!hit) return;
  const lang = defLanguage(); const c = defCode(lang, d.lang, hit.st);
  const extRe = { java: /\.java$/, kotlin: /\.kt$/, js: /\.(js|mjs|cjs)$/, ts: /\.(ts|mts)$/, ruby: /\.rb$/, python: /\.py$/, csharp: /\.cs$/ }[lang];
  const files = [...new Set(P.defs.map(x => x.rel).filter(r => extRe.test(r)))];
  dialog('qaDef', `<div class="dlg-hd"><span class="dlg-ic">${ICO.qa}</span><div><h3>Criar definição do passo</h3><p>${esc(hit.st.kw + ' ' + hit.st.text)}</p></div></div>
    <pre class="qa-code">${esc(c.code.replace(/^\n/, ''))}</pre>
    <label class="fld">Onde colocar<select id="qaDefFile">${files.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}<option value="">Só copiar o código</option></select></label>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="qaDefOk">${files.length ? 'Inserir' : 'Copiar'}</button></div>`, (el) => {
    const sel = el.querySelector('#qaDefFile'); const ok = el.querySelector('#qaDefOk');
    sel.onchange = () => { ok.textContent = sel.value ? 'Inserir' : 'Copiar'; };
    ok.onclick = async () => {
      if (!sel.value) { bs.copyText(c.code.replace(/^\n/, '')); el.hidden = true; return toast('Código copiado', 'ok'); }
      try {
        const f = await api('file', { project: proj(), file: sel.value }); let txt = f.content;
        if (lang === 'java' || lang === 'kotlin' || lang === 'csharp') {
          const k = txt.lastIndexOf('}'); txt = k >= 0 ? txt.slice(0, k).replace(/\s*$/, '\n') + c.code + txt.slice(k) : txt + c.code;
          // import da anotação no idioma da feature (io.cucumber.java.pt.Dado)
          if (c.pkg && !txt.includes(c.pkg) && !txt.includes(c.pkg.replace(/\.\w+$/, '.*'))) { const im = [...txt.matchAll(/^import .*$/gm)].pop(); txt = im ? txt.slice(0, im.index + im[0].length) + `\nimport ${c.pkg}${lang === 'java' ? ';' : ''}` + txt.slice(im.index + im[0].length) : txt; }
        } else txt = txt.replace(/\s*$/, '\n') + c.code;
        // aberto numa aba: muda o texto da aba (dá para desfazer com Ctrl+Z) e salva; fechado: grava direto
        const open = S.tabs.find(x => x.path === sel.value && x.model);
        if (open) open.model.pushEditOperations([], [{ range: open.model.getFullModelRange(), text: txt }], () => null);
        else await api('file', { project: proj(), file: sel.value }, { method: 'PUT', body: txt });
        el.hidden = true; toast('Definição criada em ' + fileName(sel.value), 'ok');
        await bs.openFile(sel.value, 'editor', txt.slice(0, txt.lastIndexOf(c.code.trim())).split('\n').length);
        if (open) await bs.save();
        setTimeout(() => index(true), 600);
      } catch (e) { toast(e.message); }
    };
  });
}

// ---------- executar (projetos automatizados) ----------
function detectRunner(ix) {
  const has = (re) => ix.some(f => re.test(f.p));
  if (has(/^pom\.xml$/)) return { kind: 'maven', label: 'Maven' };
  if (has(/^build\.gradle(\.kts)?$/)) return { kind: 'gradle', label: 'Gradle', wrapper: has(/^gradlew\.bat$/) };
  if (has(/^package\.json$/) && P.defs.some(d => /\.(js|ts|mjs|cjs|mts)$/.test(d.rel))) return { kind: 'npm', label: 'cucumber-js' };
  if (has(/(^|\/)Gemfile$/) || P.defs.some(d => /\.rb$/.test(d.rel))) return { kind: 'ruby', label: 'Cucumber (Ruby)' };
  if (P.defs.some(d => /\.py$/.test(d.rel)) || has(/features\/steps\/.*\.py$/)) return { kind: 'behave', label: 'behave' };
  return null;
}
async function runner(target, tags, title) {
  const r = P.runner; if (!r) return toast('Não achei como rodar os testes (Maven, Gradle, npm, Ruby ou behave)');
  const cwd = proj(); const env = {};
  if (target) env.CUCUMBER_FEATURES = target; if (tags) env.CUCUMBER_FILTER_TAGS = tags;
  // classe que liga o Cucumber ao JUnit (@Suite, @RunWith(Cucumber.class), @CucumberOptions): roda só ela
  let runnerClass = null;
  if (r.kind === 'maven' || r.kind === 'gradle') {
    try { const h = (await api('search', { project: cwd, q: String.raw`@Suite\b|@RunWith\s*\(\s*Cucumber\.class|@CucumberOptions|@IncludeEngines\s*\(\s*"cucumber"`, regex: '1', case: '1' })).hits || []; const f = h.find(x => /\.(java|kt)$/.test(x.p)); if (f) runnerClass = fileName(f.p).replace(/\.(java|kt)$/, ''); } catch {}
  }
  let step;
  if (r.kind === 'maven') step = { kind: 'maven', label: 'mvn test', args: ['-f', cwd + '\\pom.xml', 'test', ...(target ? ['-Dcucumber.features=' + target] : []), ...(tags ? ['-Dcucumber.filter.tags=' + tags] : []), ...(runnerClass ? ['-Dtest=' + runnerClass, '-Dsurefire.failIfNoSpecifiedTests=false'] : [])], cwd, env, java: true };
  else if (r.kind === 'gradle') step = { program: r.wrapper ? cwd + '\\gradlew.bat' : 'gradle', args: ['cleanTest', 'test', ...(runnerClass ? ['--tests', runnerClass] : [])], cwd, env, java: true };
  else if (r.kind === 'npm') step = { program: 'npx', args: ['cucumber-js', ...(target ? [target] : []), ...(tags ? ['--tags', tags] : [])], cwd, env };
  else if (r.kind === 'ruby') step = { program: 'bundle', args: ['exec', 'cucumber', ...(target ? [target] : []), ...(tags ? ['--tags', tags] : [])], cwd, env };
  else step = { program: 'behave', args: [...(target ? [target] : []), ...(tags ? ['--tags', tags] : [])], cwd, env };
  bs.build.runSteps({ title: 'Cucumber · ' + title, steps: [step] });
}

// ---------- janelas: status, evidências, nova feature ----------
function statusMenu(e, rel, sc) {
  const st = statusOf(rel, sc);
  bs.showMenu(e, [
    ...Object.entries(STATUS).map(([k, v]) => ({ label: v.label + (st && st.s === k ? ' ✓' : ''), icon: v.ico, action: () => setStatus(rel, sc, k) })),
    { label: 'Anotação…', icon: bs.I.edit, action: () => noteDialog(rel, sc) },
    { label: 'Abrir relatório de bug deste cenário…', icon: KI.bug, action: () => bugFromScenario(rel, sc) },
    '-', { label: 'Não executado', icon: bs.I.x, action: () => setStatus(rel, sc, null) },
  ], sc.name);
}
function noteDialog(rel, sc) {
  const st = statusOf(rel, sc) || {};
  dialog('qaNote', `<div class="dlg-hd"><span class="dlg-ic">${ICO.qa}</span><div><h3>Anotação do cenário</h3><p>${esc(sc.name)}</p></div></div>
    <label class="fld">Observação (vai no relatório e no CSV)<textarea id="qaNoteIn" rows="4">${esc(st.note || '')}</textarea></label>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="qaNoteOk">Salvar</button></div>`, (el) => {
    el.querySelector('#qaNoteIn').focus();
    el.querySelector('#qaNoteOk').onclick = async () => { const v = el.querySelector('#qaNoteIn').value.trim(); el.hidden = true; const k = stKey(rel, sc); if (P.status[k]) { P.status[k].note = v; await plugin.data.set('st:' + proj(), P.status); fireLens(); } else await setStatus(rel, sc, 'pass', v); };
  });
}
function evidenceDialog(rel, sc) {
  const draw = (el) => {
    const list = evidences(rel, sc);
    el.querySelector('.qa-evs').innerHTML = list.length ? list.map(p => `<figure data-p="${esc(p)}"><img src="${esc(rawUrl(p))}&t=${Date.now()}" alt="" loading="lazy"><figcaption>${esc(fileName(p))}<button class="icon-btn" data-del title="Excluir">${bs.I.x}</button></figcaption></figure>`).join('') : '<div class="qa-none">Nenhuma evidência ainda. Tire o print (Win+Shift+S) e cole aqui com Ctrl+V.</div>';
    el.querySelectorAll('figure').forEach(f => {
      f.querySelector('img').onclick = () => bs.openFile(f.dataset.p, 'editor');
      f.querySelector('[data-del]').onclick = async () => { try { await api('file/delete', { project: proj() }, { method: 'POST', body: JSON.stringify({ paths: [f.dataset.p] }) }); P.all = P.all.filter(x => x.p !== f.dataset.p); draw(el); fireLens(); } catch (e) { toast(e.message); } };
    });
  };
  const add = async (el, files) => {
    for (const f of files) {
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
      if (!/^image\//.test(f.type)) continue;
      try { await saveEvidence(rel, sc, f, ext); } catch (e) { toast(e.message); }
    }
    draw(el); fireLens();
  };
  const el = dialog('qaEv', `<div class="dlg-hd"><span class="dlg-ic">${ICO.cam}</span><div><h3>Evidências</h3><p>${esc(sc.name)}</p></div></div>
    <div class="qa-drop" tabindex="0">Cole um print (<b>Ctrl+V</b>), arraste imagens para cá ou <button class="chip" id="qaEvPick">escolha arquivos</button><input type="file" id="qaEvFile" accept="image/*" multiple hidden></div>
    <div class="qa-evs"></div>
    <div class="actions"><span class="qa-path">${esc(evDir(rel))}/</span><span class="spacer"></span><button class="chip" id="qaEvSt">Marcar status…</button><button class="chip primary" data-close>Pronto</button></div>`, (el) => {
    el.querySelector('.dlg-box').classList.add('qa-ev-box');
    draw(el);
    const drop = el.querySelector('.qa-drop'); drop.focus();
    el.querySelector('#qaEvPick').onclick = () => el.querySelector('#qaEvFile').click();
    el.querySelector('#qaEvFile').onchange = (e) => add(el, [...e.target.files]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
    drop.ondragleave = () => drop.classList.remove('on');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('on'); add(el, [...e.dataTransfer.files]); };
    el.onpaste = (e) => { const fs = [...(e.clipboardData || {}).items || []].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean); if (fs.length) { e.preventDefault(); add(el, fs); } };
    el.querySelector('#qaEvSt').onclick = (e) => statusMenu(e, rel, sc);
  });
  return el;
}
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// pasta do mês no estilo que o projeto já usa (OUTUBRO, OUTUBRO-2026, outubro_2026...)
function monthFolder(parent) {
  const kids = new Set(P.all.map(f => f.p).filter(p => (parent ? p.startsWith(parent + '/') : true)).map(p => (parent ? p.slice(parent.length + 1) : p).split('/')).filter(a => a.length > 1).map(a => a[0]));
  const ex = [...kids].map(k => ({ k, m: /^(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)([-_ ]?)(\d{4})?$/i.exec(k) })).filter(x => x.m);
  if (!ex.length) return null;
  const last = ex[ex.length - 1].m; const now = new Date();
  let name = MONTHS[now.getMonth()]; if (!/ç/i.test(ex.map(x => x.k).join('')) && ex.some(x => /marco/i.test(x.k))) name = name.replace('ç', 'c');
  if (last[1] === last[1].toUpperCase()) name = name.toUpperCase(); else if (last[1][0] === last[1][0].toUpperCase()) name = name[0].toUpperCase() + name.slice(1);
  return name + (last[3] ? (last[2] || '') + now.getFullYear() : '');
}
async function newFeature(dirHint) {
  await index();
  const dirs = [...new Set([...P.files.keys()].map(dirOf).flatMap(d => { const out = []; const a = d.split('/'); for (let i = 1; i <= a.length; i++) out.push(a.slice(0, i).join('/')); return out; }).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const flang = P.settings.lang && P.settings.lang !== 'auto' ? P.settings.lang : (() => { const c = { pt: 0, en: 0, es: 0 }; for (const f of P.files.values()) c[f.doc.lang]++; return c.pt > c.en ? 'pt' : c.en ? 'en' : 'pt'; })();
  const start = dirHint ?? (S.active && isFeature(S.active) ? dirOf(S.active.path) : '');
  dialog('qaNew', `<div class="dlg-hd"><span class="dlg-ic">${ICO.feat}</span><div><h3>Nova feature</h3><p>Arquivo no padrão do time: <code>CHAMADO - Título.feature</code></p></div></div>
    <div class="qa-2"><label class="fld">Chamado / card<input id="qaTk" placeholder="INC1753202, PRB0068833, SDIG-123" spellcheck="false" autocomplete="off"></label>
      <label class="fld">Idioma<select id="qaLang"><option value="pt" ${flang === 'pt' ? 'selected' : ''}>Português</option><option value="en" ${flang === 'en' ? 'selected' : ''}>Inglês</option><option value="es" ${flang === 'es' ? 'selected' : ''}>Espanhol</option></select></label></div>
    <label class="fld">Título<input id="qaTitle" placeholder="Campanha não está respeitando o retorno do serviço" autocomplete="off"></label>
    <label class="fld">Pasta<input id="qaDir" list="qaDirs" value="${esc(start)}" spellcheck="false" autocomplete="off"><datalist id="qaDirs">${dirs.map(d => `<option value="${esc(d)}">`).join('')}</datalist></label>
    <label class="chk" id="qaMonthRow" hidden><input type="checkbox" id="qaMonth" checked> Na pasta do mês: <code id="qaMonthName"></code></label>
    <div class="qa-2"><label class="fld">Cenários<input id="qaN" type="number" min="1" max="50" value="1"></label><label class="fld">Tags (opcional)<input id="qaTags" placeholder="@regressao @portal" spellcheck="false"></label></div>
    <label class="chk"><input type="checkbox" id="qaStory" checked> História de usuário (Como / Eu quero / Para que)</label>
    <div class="qa-path" id="qaPrev"></div><div class="err" id="qaErr"></div>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="qaOk">Criar</button></div>`, (el) => {
    const $q = (s) => el.querySelector(s);
    const path = () => {
      const tk = $q('#qaTk').value.trim(), ti = $q('#qaTitle').value.trim().replace(/[\\/:*?"<>|]+/g, '-');
      let dir = $q('#qaDir').value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const mf = monthFolder(dir);
      $q('#qaMonthRow').hidden = !mf || dir.split('/').pop() === mf; $q('#qaMonthName').textContent = mf || '';
      if (mf && !$q('#qaMonthRow').hidden && $q('#qaMonth').checked) dir = (dir ? dir + '/' : '') + mf;
      const name = [tk, ti].filter(Boolean).join(' - ') || 'nova';
      return (dir ? dir + '/' : '') + name + '.feature';
    };
    const upd = () => { $q('#qaPrev').textContent = path(); };
    el.querySelectorAll('input,select').forEach(i => { i.oninput = upd; i.onchange = upd; }); upd();
    $q('#qaTk').focus();
    $q('#qaOk').onclick = async () => {
      const L = KW[$q('#qaLang').value]; const tk = $q('#qaTk').value.trim(); const ti = $q('#qaTitle').value.trim();
      if (!tk && !ti) { $q('#qaErr').textContent = 'Informe o chamado ou o título.'; return; }
      const n = Math.max(1, Math.min(50, +$q('#qaN').value || 1)); const pre = (P.settings.prefix || 'CT').trim() || 'CT';
      const tags = [...new Set([...(tk ? ['@' + tk.replace(/\s+/g, '_')] : []), ...$q('#qaTags').value.split(/\s+/).filter(Boolean).map(t => t.startsWith('@') ? t : '@' + t)])];
      const es = $q('#qaLang').value === 'es';
      // a história segue o idioma das descrições que o time já escreve (muitos usam Feature: com o texto em português)
      const desc = [...P.files.values()].flatMap(f => f.doc.feature ? f.doc.feature.desc : []);
      const ptDesc = desc.filter(l => /^(como|eu quero|para que)\b/i.test(l)).length, enDesc = desc.filter(l => /^(as an?|i want|so that)\b/i.test(l)).length;
      const pt = $q('#qaLang').value === 'pt' || (!es && ptDesc > enDesc);
      const story = $q('#qaStory').checked ? (pt ?'  Como <papel>\n  Eu quero <objetivo>\n  Para que <benefício>\n' : es ? '  Como <rol>\n  Quiero <objetivo>\n  Para <beneficio>\n' : '  As a <role>\n  I want <goal>\n  So that <benefit>\n') : '';
      const sc = (i) => `\n  ${L.scenario[0]}: ${pre}${String(i).padStart(3, '0')} \n    ${L.given[0]} \n    ${L.when[0]} \n    ${L.then[0]} \n`;
      const text = `${$q('#qaLang').value === 'pt' ? '# language: pt\n' : es ? '# language: es\n' : ''}${tags.length ? tags.join(' ') + '\n' : ''}${L.feature[0]}: ${ti || tk}\n${story}${Array.from({ length: n }, (_, i) => sc(i + 1)).join('')}`;
      const p = path();
      try { await api('file/new', { project: proj() }, { method: 'POST', body: JSON.stringify({ path: p, content: text }) }); }
      catch (e) { $q('#qaErr').textContent = e.message; return; }
      el.hidden = true;
      await bs.refreshProject(); await bs.openFile(p, 'editor');
      const lines = text.split('\n'); const ln = lines.findIndex(l => l.trim().startsWith(L.given[0] + ' ')) + 1;
      if (bs.editor && ln) { bs.editor.setPosition({ lineNumber: ln, column: lines[ln - 1].length + 1 }); bs.editor.focus(); }
      index(true);
    };
  });
}

// ---------- provedores do Monaco ----------
let ready = false;
function setup() {
  const monaco = bs.monaco; if (ready || !monaco) return; ready = true;
  const L = monaco.languages; const R = monaco.Range;
  const cmd = (id, fn) => { try { monaco.editor.registerCommand(id, (_a, ...args) => fn(...args)); } catch {} };
  cmd('qa.status', (rel, line) => { const d = docFor(rel); const sc = d && d.scenarios.find(s => s.line === line); if (sc) statusMenu(atMouse(), rel, sc); });
  cmd('qa.evidence', (rel, line) => { const d = docFor(rel); const sc = d && d.scenarios.find(s => s.line === line); if (sc) evidenceDialog(rel, sc); });
  cmd('qa.copy', (rel, line) => { const d = docFor(rel); const sc = d && d.scenarios.find(s => s.line === line); if (sc) { bs.copyText(scenarioText(rel, d, sc)); toast('Cenário copiado (texto para o chamado)', 'ok'); } });
  cmd('qa.run', (rel, line, title) => runner(line != null ? `${rel}:${line + 1}` : rel, null, title));
  cmd('qa.report', (rel) => makeReport(rel, false));
  cmd('qa.csv', (rel) => exportCsv(rel, false));
  cmd('qa.createDef', (rel, line) => createDefinition(rel, line));

  // acima da funcionalidade e de cada cenário: status, evidências, copiar, executar
  L.registerCodeLensProvider('gherkin', {
    onDidChange: (fn) => { lensEmitter.list.add(fn); return { dispose: () => lensEmitter.list.delete(fn) }; },
    provideCodeLenses(model) {
      const rel = relOfModel(model); if (!rel) return { lenses: [], dispose() {} };
      const d = parse(model.getValue()); const lenses = [];
      const at = (line, title, id, args) => lenses.push({ range: new R(line + 1, 1, line + 1, 1), command: { id, title, arguments: args } });
      const run = automation() && P.runner;
      if (d.feature) {
        const sts = d.scenarios.map(s => statusOf(rel, s));
        const pass = sts.filter(s => s && s.s === 'pass').length, fail = sts.filter(s => s && s.s === 'fail').length, blk = sts.filter(s => s && s.s === 'blocked').length;
        if (run) at(d.feature.line, '▶ Executar feature', 'qa.run', [rel, null, titleOf(rel)]);
        at(d.feature.line, `${d.scenarios.length} cenário(s) · ✓ ${pass}  ✗ ${fail}  ⊘ ${blk}`, 'qa.report', [rel]);
        at(d.feature.line, 'Relatório de evidências', 'qa.report', [rel]);
        at(d.feature.line, 'Exportar CSV', 'qa.csv', [rel]);
      }
      for (const sc of d.scenarios) {
        const st = statusOf(rel, sc); const ev = evidences(rel, sc).length;
        if (run) at(sc.line, '▶ Executar', 'qa.run', [rel, sc.line, sc.name]);
        at(sc.line, st ? `${STATUS[st.s].sym} ${STATUS[st.s].label}` : '○ Não executado', 'qa.status', [rel, sc.line]);
        at(sc.line, ev ? `▣ Evidências (${ev})` : '▣ Evidência', 'qa.evidence', [rel, sc.line]);
        at(sc.line, 'Copiar', 'qa.copy', [rel, sc.line]);
      }
      return { lenses, dispose() {} };
    },
  });

  // autocompletar: palavras-chave, passos do projeto e das step definitions, tags e <colunas>
  L.registerCompletionItemProvider('gherkin', {
    triggerCharacters: ['@', '<', ' '],
    provideCompletionItems(model, pos) {
      const K = KW[langOf(model.getValue())]; const M = L.CompletionItemKind; const S2 = L.CompletionItemInsertTextRule.InsertAsSnippet;
      const ln = model.getLineContent(pos.lineNumber); const before = ln.slice(0, pos.column - 1);
      const d = parse(model.getValue()); const R2 = rx(d.lang);
      const items = []; const add = (o) => items.push(o);
      // @tag
      const tg = /(^|\s)@([\w.\-À-ú]*)$/.exec(before);
      if (tg) {
        const range = new R(pos.lineNumber, pos.column - tg[2].length - 1, pos.lineNumber, pos.column);
        const rel = relOfModel(model); const own = rel ? ticketsOf(rel).map(t => '@' + t) : [];
        [...new Set([...own, ...[...P.tags.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])])].slice(0, 300).forEach((t, i) => add({ label: t, kind: M.Keyword, insertText: t, range, detail: P.tags.get(t) ? `${P.tags.get(t)}× no projeto` : 'chamado deste arquivo', sortText: String(i).padStart(4, '0') }));
        return { suggestions: items };
      }
      // <coluna> dos Exemplos
      const lt = /<([^<>]*)$/.exec(before);
      if (lt) {
        const sc = d.scenarios.find(s => s.line < pos.lineNumber - 1 && (s.end == null || s.end >= pos.lineNumber - 1));
        const cols = sc ? [...new Set(sc.examples.flatMap(e => e.header || []))] : [];
        const range = new R(pos.lineNumber, pos.column - lt[1].length, pos.lineNumber, pos.column + (ln[pos.column - 1] === '>' ? 1 : 0));
        cols.forEach(c => add({ label: c, kind: M.Variable, insertText: c + '>', range }));
        return { suggestions: items };
      }
      // passo: depois da palavra-chave, o resto da linha vira o passo escolhido
      const sm = R2.step.exec(ln);
      if (sm && pos.column - 1 >= sm[1].length + sm[2].length) {
        const start = sm[1].length + sm[2].length + 2;
        const range = new R(pos.lineNumber, start, pos.lineNumber, ln.length + 1);
        const prev = (() => { const h = stepAt(d, pos.lineNumber - 1); return h ? h.st.type : R2.stepOf.get(sm[2]) || 'given'; })();
        const rel = relOfModel(model);
        let i = 0;
        const scored = [...P.steps.values()].map(e => ({ e, s: e.n * 3 + (e.types[prev] || 0) * 8 + (e.uses.some(u => u.rel === rel) ? 10 : 0) })).sort((a, b) => b.s - a.s).slice(0, 600);
        for (const { e } of scored) add({ label: { label: e.text, description: `${e.n}×` }, kind: M.Text, insertText: e.text, filterText: e.text, range, sortText: String(i++).padStart(4, '0'), detail: `Usado ${e.n} vez(es) no projeto` });
        if (automation()) for (const df of P.defs) {
          let k = 0; const snip = df.kind === 'expr' ? df.pattern.replace(/\\([(){}/])/g, '$1').replace(/\{(\w*)\}/g, (m, n) => n === 'string' ? `"\${${++k}:texto}"` : `\${${++k}:${n || 'valor'}}`).replace(/\(([^)]*)\)/g, '$1').replace(/(\S+)\/(\S+)/g, '$1')
            : df.pattern.replace(/^\^|\$$/g, '').replace(/"\([^)]*\)"/g, () => `"\${${++k}:texto}"`).replace(/\((?:\\d|-?\\d)[^)]*\)/g, () => `\${${++k}:0}`).replace(/\([^)]*\)/g, () => `\${${++k}:valor}`).replace(/\\(.)/g, '$1');
          add({ label: { label: snip.replace(/\$\{\d+:([^}]*)\}/g, '$1'), description: fileName(df.rel) }, kind: M.Function, insertText: snip, insertTextRules: S2, filterText: snip.replace(/\$\{\d+:([^}]*)\}/g, '$1'), range, sortText: 'z' + String(i++).padStart(4, '0'), detail: `${df.kw} · ${df.rel}:${df.line}` });
        }
        return { suggestions: items };
      }
      // começo da linha: palavras-chave (passos dentro de cenário; cabeçalhos fora)
      if (/^\s*[\wÀ-ú]*$/.test(before)) {
        const w = /[\wÀ-ú]*$/.exec(before)[0]; const range = new R(pos.lineNumber, pos.column - w.length, pos.lineNumber, pos.column);
        const inSc = !!d.scenarios.concat(d.background || []).find(s => s.line < pos.lineNumber - 1 && (s.end == null || s.end >= pos.lineNumber - 2));
        let i = 0; const o = (n) => String(n).padStart(3, '0');
        const steps = [...K.given.slice(0, 1), ...K.when, ...K.then.slice(0, 1), ...K.and, ...K.but];
        steps.forEach(k => add({ label: k, kind: M.Keyword, insertText: k + ' ', range, sortText: (inSc ? 'a' : 'b') + o(i++), command: { id: 'editor.action.triggerSuggest', title: '' } }));
        add({ label: `${K.scenario[0]}: ${nextId(d)}`, kind: M.Snippet, insertText: `${K.scenario[0]}: ${nextId(d)} \${1:título}\n\t${K.given[0]} \${2}\n\t${K.when[0]} \${3}\n\t${K.then[0]} \${4}`, insertTextRules: S2, range, sortText: (inSc ? 'c' : 'a') + o(i++), detail: 'cenário novo com o próximo número', filterText: K.scenario[0] });
        add({ label: `${K.outline[0]}`, kind: M.Snippet, insertText: `${K.outline[0]}: ${nextId(d)} \${1:título}\n\t${K.given[0]} \${2:passo com <valor>}\n\n\t${K.examples[0]}:\n\t\t| valor |\n\t\t| \${3:a}     |`, insertTextRules: S2, range, sortText: (inSc ? 'c' : 'a') + o(i++), detail: 'esquema com Exemplos' });
        if (!d.background) add({ label: K.background[0], kind: M.Snippet, insertText: `${K.background[0]}:\n\t${K.given[0]} \${1}`, insertTextRules: S2, range, sortText: (inSc ? 'c' : 'a') + o(i++), detail: 'passos que valem para todos os cenários' });
        add({ label: K.examples[0], kind: M.Keyword, insertText: `${K.examples[0]}:\n\t| \${1:coluna} |\n\t| \${2:valor}  |`, insertTextRules: S2, range, sortText: 'c' + o(i++) });
        if (!d.feature) add({ label: K.feature[0], kind: M.Snippet, insertText: `${K.feature[0]}: \${1:título}\n`, insertTextRules: S2, range, sortText: 'a000' });
        add({ label: K.rule[0], kind: M.Keyword, insertText: `${K.rule[0]}: \${1:regra}\n`, insertTextRules: S2, range, sortText: 'd' + o(i++) });
        add({ label: 'tabela', kind: M.Snippet, insertText: '| ${1:coluna} | ${2:coluna} |\n| ${3:valor}  | ${4:valor}  |', insertTextRules: S2, range, sortText: 'd' + o(i++), detail: 'tabela de dados' });
        add({ label: 'docstring', kind: M.Snippet, insertText: '"""\n${1}\n"""', insertTextRules: S2, range, sortText: 'd' + o(i++), detail: 'texto em várias linhas' });
        return { suggestions: items };
      }
      return { suggestions: [] };
    },
  });

  // passar o mouse num passo: quantas vezes é usado e a definição (automação)
  L.registerHoverProvider('gherkin', {
    provideHover(model, pos) {
      const d = parse(model.getValue()); const h = stepAt(d, pos.lineNumber - 1); if (!h) return null;
      const e = P.steps.get(norm(h.st.text)); const parts = [];
      parts.push(`Usado **${e ? e.n : 1}** vez(es) no projeto${e && e.uses.length > 1 ? ` (${new Set(e.uses.map(u => u.rel)).size} arquivo(s))` : ''}`);
      if (automation() && P.defs.length) { const defs = defsFor(concrete(h.st, h.sc)); parts.push(defs.length ? defs.map(x => `\`${x.rel}:${x.line}\` · ${x.kw}(\`${x.pattern}\`)`).join('  \n') : '_Sem step definition_'); }
      return { contents: [{ value: parts.join('\n\n') }] };
    },
  });
  // F12 / Ctrl+clique: a step definition
  L.registerDefinitionProvider('gherkin', {
    async provideDefinition(model, pos) {
      if (!P.defs.length) return null;
      const d = parse(model.getValue()); const h = stepAt(d, pos.lineNumber - 1); if (!h) return null;
      const defs = defsFor(concrete(h.st, h.sc)); const out = [];
      for (const x of defs.slice(0, 10)) { const m = await modelForRel(x.rel); if (m) out.push({ uri: m.uri, range: new R(x.line, 1, x.line, 1) }); }
      return out;
    },
  });
  // Shift+F12: onde mais o passo é usado
  L.registerReferenceProvider('gherkin', {
    async provideReferences(model, pos) {
      const d = parse(model.getValue()); const h = stepAt(d, pos.lineNumber - 1); if (!h) return [];
      const e = P.steps.get(norm(h.st.text)); if (!e) return [];
      const out = [];
      for (const u of e.uses.slice(0, 80)) { const m = await modelForRel(u.rel); if (m) out.push({ uri: m.uri, range: new R(u.line + 1, 1, u.line + 1, m.getLineMaxColumn(u.line + 1)) }); }
      return out;
    },
  });
  // Shift+Alt+F
  L.registerDocumentFormattingEditProvider('gherkin', { provideDocumentFormattingEdits: (model) => { const t = format(model.getValue()); return t === model.getValue() ? [] : [{ range: model.getFullModelRange(), text: t }]; } });
  // Ctrl+F12, trilha e rolagem fixa: funcionalidade > cenários
  L.registerDocumentSymbolProvider('gherkin', {
    provideDocumentSymbols(model) {
      const d = parse(model.getValue()); const SK = L.SymbolKind; const n = model.getLineCount();
      const rng = (a, b) => new R(a + 1, 1, Math.min(n, (b ?? a) + 1), 1);
      const kids = [d.background, ...d.scenarios].filter(Boolean).map(s => ({ name: s.name || s.kw, detail: s.kw, kind: s.kind === 'background' ? SK.Constructor : SK.Method, range: rng(s.line, s.end), selectionRange: rng(s.line), tags: [], children: [] }));
      return d.feature ? [{ name: d.feature.name, detail: d.feature.kw, kind: SK.Class, range: rng(d.feature.line, n - 1), selectionRange: rng(d.feature.line), tags: [], children: kids }] : kids;
    },
  });
  // Alt+Enter
  L.registerCodeActionProvider('gherkin', {
    provideCodeActions(model, range, ctx) {
      const rel = relOfModel(model); const d = parse(model.getValue()); const actions = [];
      const st = hold.get(model);
      for (const mk of ctx.markers.filter(m => m.source === 'Cucumber')) {
        const info = st && st.data.find(x => x.line === mk.startLineNumber - 1 && x.code === mk.code);
        if (mk.code === 'similar' && info) actions.push({ title: `Trocar por “${info.to}”`, kind: 'quickfix', diagnostics: [mk], isPreferred: true, edit: { edits: [{ resource: model.uri, textEdit: { range: new R(mk.startLineNumber, mk.startColumn, mk.endLineNumber, mk.endColumn), text: info.to }, versionId: undefined }] } });
        if (mk.code === 'undefined' && rel) actions.push({ title: 'Criar definição do passo…', kind: 'quickfix', diagnostics: [mk], isPreferred: true, command: { id: 'qa.createDef', title: '', arguments: [rel, mk.startLineNumber - 1] } });
        if (mk.code === 'comment-tag' && info && d.feature) {
          actions.push({ title: `Transformar em tag ${info.tag} (acima da funcionalidade)`, kind: 'quickfix', diagnostics: [mk], edit: { edits: [
            { resource: model.uri, textEdit: { range: new R(mk.startLineNumber, 1, mk.startLineNumber + 1, 1), text: '' } },
            { resource: model.uri, textEdit: { range: new R(d.feature.line + 1, 1, d.feature.line + 1, 1), text: info.tag + '\n' } },
          ] } });
        }
      }
      // refatorações: no cabeçalho da funcionalidade ou de um cenário
      const line = range.startLineNumber - 1;
      const onHead = (d.feature && d.feature.line === line) || d.scenarios.some(s => s.line === line) || (d.background && d.background.line === line);
      if (onHead) {
        const common = commonPrefix(d);
        if (common.length) { const edits = toBackgroundEdits(model, d); if (edits) actions.push({ title: `Mover ${common.length} passo(s) repetido(s) para o ${KW[d.lang].background[0]}`, kind: 'refactor', edit: { edits: edits.map(e => ({ resource: model.uri, textEdit: e })) } }); }
        const ren = renumberEdits(d); if (ren.length) actions.push({ title: 'Renumerar cenários (' + (P.settings.prefix || 'CT') + '001, 002...)', kind: 'refactor', edit: { edits: ren.map(e => ({ resource: model.uri, textEdit: e })) } });
        const f = format(model.getValue()); if (f !== model.getValue()) actions.push({ title: 'Formatar e alinhar tabelas', kind: 'refactor', edit: { edits: [{ resource: model.uri, textEdit: { range: model.getFullModelRange(), text: f } }] } });
      }
      return { actions, dispose() {} };
    },
  });
  S.tabs.forEach(watch);
}

// ---------- painel QA (Alt+9) ----------
const V = { view: store.get('qaView', 'features'), q: '', open: new Set(store.get('qaOpen', [])), openFeat: new Set(), sort: store.get('qaSort', 'name'), stepOpen: null };
function matches(rel, f, q) {
  if (!q) return true;
  const ql = q.toLowerCase();
  if (q.startsWith('@')) return f.doc.tags.some(t => t.tag.toLowerCase().startsWith(ql));
  if (rel.toLowerCase().includes(ql) || (f.doc.feature && f.doc.feature.name.toLowerCase().includes(ql))) return true;
  return f.doc.scenarios.some(s => s.name.toLowerCase().includes(ql) || s.steps.some(st => st.text.toLowerCase().includes(ql)));
}
function counts(rel, d) {
  const o = { pass: 0, fail: 0, blocked: 0, none: 0 };
  for (const s of d.scenarios) { const st = statusOf(rel, s); o[st ? st.s : 'none']++; }
  return o;
}
const bar = (c, total) => total ? `<span class="qa-bar">${['pass', 'fail', 'blocked'].map(k => c[k] ? `<i class="${k}" style="flex:${c[k]}"></i>` : '').join('')}<i class="none" style="flex:${c.none}"></i></span>` : '';
// abas do painel: Cenários (Gherkin), Kit (ferramentas), Checklists e Sessão (teste exploratório)
const TOPS = [['cen', 'Cenários'], ['kit', 'Kit'], ['chk', 'Checklists'], ['ses', 'Sessão']];
function render() {
  const body = $('#toolBody');
  if (!S.project) { body.innerHTML = '<div class="empty">Abra um projeto.</div>'; return; }
  V.top = V.top || store.get('qaTop', 'cen');
  body.innerHTML = `<div class="qa"><div class="qa-top"><div class="qa-tabs qa-main">${TOPS.map(([k, l]) => `<button class="${V.top === k ? 'on' : ''}" data-top="${k}">${l}${k === 'ses' && SES.cur && !SES.cur.end ? ' <i class="qa-rec"></i>' : ''}</button>`).join('')}</div><div class="qa-sub"></div></div><div class="qa-body"></div></div>`;
  body.querySelectorAll('[data-top]').forEach(b => b.onclick = () => { V.top = b.dataset.top; store.set('qaTop', V.top); render(); });
  const sub = body.querySelector('.qa-sub'), el = body.querySelector('.qa-body');
  $('#toolActions').innerHTML = ''; $('#toolSub').textContent = '';
  if (V.top === 'kit') return renderKit(sub, el);
  if (V.top === 'chk') return renderChecklists(sub, el);
  if (V.top === 'ses') return renderSession(sub, el);
  renderScenarios(sub, el);
}
function renderScenarios(sub, el) {
  if (P.for !== proj() || (!P.at && !P.loading)) { el.innerHTML = '<div class="empty">Lendo as features…</div>'; index(); return; }
  const files = [...P.files.entries()];
  const nsc = files.reduce((n, [, f]) => n + f.doc.scenarios.length, 0);
  $('#toolSub').textContent = `${files.length} features · ${nsc} cenários`;
  $('#toolActions').innerHTML = `<button class="icon-btn" id="qaNewBtn" title="Nova feature">${ICO.plus}</button><button class="icon-btn" id="qaRef" title="Ler de novo">${bs.I.refresh}</button>`;
  $('#qaNewBtn').onclick = () => newFeature(); $('#qaRef').onclick = () => index(true);
  const tabs = [['features', 'Features'], ['steps', 'Passos'], ['tags', 'Tags'], ['run', 'Execução']];
  sub.innerHTML = `<input class="qa-q" placeholder="Buscar: texto, @tag ou chamado (INC...)" value="${esc(V.q)}" spellcheck="false">
    <div class="qa-tabs">${tabs.map(([k, l]) => `<button class="${V.view === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>`;
  const qi = sub.querySelector('.qa-q');
  qi.oninput = () => { V.q = qi.value.trim(); draw(); };
  sub.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { V.view = b.dataset.v; store.set('qaView', V.view); render(); });
  const draw = () => { el.innerHTML = ({ features: viewFeatures, steps: viewSteps, tags: viewTags, run: viewRun })[V.view](); bindView(el); };
  draw();
}
function viewFeatures() {
  const files = [...P.files.entries()].filter(([rel, f]) => matches(rel, f, V.q));
  if (!files.length) return `<div class="empty">${P.files.size ? 'Nada encontrado.' : 'Nenhum arquivo .feature no projeto.'}<br><br><button class="chip primary" data-new>${ICO.plus} Nova feature</button></div>`;
  if (V.sort === 'recent') files.sort((a, b) => (b[1].mtime || 0) - (a[1].mtime || 0));
  const groups = new Map();
  for (const [rel, f] of files) { const g = V.sort === 'recent' ? '' : dirOf(rel); if (!groups.has(g)) groups.set(g, []); groups.get(g).push([rel, f]); }
  const forceOpen = !!V.q || V.sort === 'recent';
  const sorted = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  return `<div class="qa-sort"><button class="${V.sort === 'name' ? 'on' : ''}" data-sort="name">Por pasta</button><button class="${V.sort === 'recent' ? 'on' : ''}" data-sort="recent">Recentes</button></div>` + sorted.map(g => {
    const list = groups.get(g); const open = forceOpen || V.open.has(g) || sorted.length === 1;
    const c = list.reduce((o, [rel, f]) => { const x = counts(rel, f.doc); for (const k in x) o[k] += x[k]; return o; }, { pass: 0, fail: 0, blocked: 0, none: 0 });
    const total = c.pass + c.fail + c.blocked + c.none;
    const head = V.sort === 'recent' ? '' : `<div class="qa-dir ${open ? 'open' : ''}" data-dir="${esc(g)}">${ICO.chev}${ICO.folder}<span class="qa-dn">${esc(g || '(raiz do projeto)')}</span><span class="qa-n">${list.length}</span>${bar(c, total)}</div>`;
    return head + (open ? `<div class="qa-list">${list.sort((a, b) => V.sort === 'recent' ? 0 : a[0].localeCompare(b[0], 'pt-BR', { numeric: true })).map(([rel, f]) => featRow(rel, f)).join('')}</div>` : '');
  }).join('');
}
function featRow(rel, f) {
  const d = f.doc; const c = counts(rel, d); const tk = ticketsOf(rel); const op = V.openFeat.has(rel);
  return `<div class="qa-feat ${op ? 'open' : ''}" data-rel="${esc(rel)}" title="${esc(rel)}">
    <button class="qa-car" data-tog>${ICO.chev}</button>
    <div class="qa-ft">${tk.map(t => `<span class="qa-tk" data-tk="${esc(t)}" title="${ticketLink(t) ? 'Abrir o chamado' : 'Copiar'}">${esc(t)}</span>`).join('')}<span class="qa-fn">${esc(titleOf(rel))}</span></div>
    <span class="qa-n" title="cenários">${d.scenarios.length}</span>${bar(c, d.scenarios.length)}</div>` +
    (op ? `<div class="qa-scs">${d.scenarios.map(s => { const st = statusOf(rel, s); return `<div class="qa-sc ${st ? st.s : ''}" data-rel="${esc(rel)}" data-line="${s.line}"><span class="qa-st">${st ? STATUS[st.s].sym : '○'}</span><span>${esc(s.name)}</span>${evidences(rel, s).length ? `<span class="qa-ev" title="evidências">📷${evidences(rel, s).length}</span>` : ''}</div>`; }).join('')}</div>` : '');
}
function viewSteps() {
  const q = V.q.toLowerCase();
  const list = [...P.steps.values()].filter(e => !q || e.text.toLowerCase().includes(q)).sort((a, b) => b.n - a.n).slice(0, 400);
  const auto = automation() && P.defs.length;
  const und = auto ? list.filter(e => !defsFor(e.text.replace(/<[^<>]+>/g, 'x')).length).length : 0;
  return `<div class="qa-hint">${P.steps.size} passos diferentes${auto ? ` · <b>${und}</b> sem definição nesta lista` : ''}. Clique para ver onde é usado; os mais usados são os "padrões" que o autocompletar sugere.</div>` + list.map(e => {
    const bad = auto && !defsFor(e.text.replace(/<[^<>]+>/g, 'x')).length;
    const op = V.stepOpen === e.text;
    return `<div class="qa-step ${bad ? 'bad' : ''} ${op ? 'open' : ''}" data-step="${esc(e.text)}"><span class="qa-n">${e.n}×</span><span class="qa-stt">${esc(e.text)}</span></div>` +
      (op ? `<div class="qa-uses">${e.uses.map(u => `<div class="qa-use" data-rel="${esc(u.rel)}" data-line="${u.line}">${esc(u.kw)} · ${esc(titleOf(u.rel))}<span>:${u.line + 1}</span></div>`).join('')}</div>` : '');
  }).join('');
}
function viewTags() {
  const tags = [...P.tags.entries()].sort((a, b) => b[1] - a[1]);
  const run = automation() && P.runner;
  return tags.length ? `<div class="qa-hint">Clique numa tag para filtrar as features.${run ? ' ▶ roda os cenários da tag.' : ''}</div><div class="qa-tags">${tags.map(([t, n]) => `<span class="qa-tag" data-tag="${esc(t)}">${esc(t)}<em>${n}</em>${run ? `<button data-runtag="${esc(t)}" title="Executar ${esc(t)}">${ICO.play}</button>` : ''}</span>`).join('')}</div>`
    : '<div class="empty">Nenhuma tag. Tags (@regressao, @INC123) ficam acima de Funcionalidade, Cenário ou Exemplos.</div>';
}
function viewRun() {
  const files = [...P.files.entries()].filter(([rel, f]) => matches(rel, f, V.q));
  const tot = { pass: 0, fail: 0, blocked: 0, none: 0 };
  const rows = files.map(([rel, f]) => { const c = counts(rel, f.doc); for (const k in c) tot[k] += c[k]; return { rel, c, n: f.doc.scenarios.length }; }).filter(r => r.n);
  const total = tot.pass + tot.fail + tot.blocked + tot.none;
  const pct = total ? Math.round((total - tot.none) * 100 / total) : 0;
  return `<div class="qa-sum"><div class="qa-big">${pct}%<small>executado</small></div><div>✓ ${tot.pass} passou<br>✗ ${tot.fail} falhou<br>⊘ ${tot.blocked} bloqueado<br>○ ${tot.none} não executado</div></div>
    <div class="qa-acts"><button class="chip" data-rep>${ICO.doc} Relatório de evidências</button><button class="chip" data-csv>${ICO.csv} Exportar CSV</button></div>
    <div class="qa-hint">${V.q ? 'Só o que a busca encontrou. ' : ''}O status de cada cenário fica acima dele no editor (clique em "○ Não executado").</div>` +
    rows.filter(r => r.c.fail || r.c.blocked).concat(rows.filter(r => !r.c.fail && !r.c.blocked)).map(r => `<div class="qa-feat" data-rel="${esc(r.rel)}"><div class="qa-ft"><span class="qa-fn">${esc(titleOf(r.rel))}</span></div><span class="qa-n">${r.n - r.c.none}/${r.n}</span>${bar(r.c, r.n)}</div>`).join('');
}
function bindView(el) {
  el.querySelectorAll('[data-new]').forEach(b => b.onclick = () => newFeature());
  el.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { V.sort = b.dataset.sort; store.set('qaSort', V.sort); render(); });
  el.querySelectorAll('.qa-dir').forEach(r => r.onclick = () => { const g = r.dataset.dir; V.open.has(g) ? V.open.delete(g) : V.open.add(g); store.set('qaOpen', [...V.open].slice(0, 300)); render(); });
  el.querySelectorAll('.qa-feat').forEach(r => {
    r.onclick = (e) => {
      const tk = e.target.closest('[data-tk]');
      if (tk) { e.stopPropagation(); const u = ticketLink(tk.dataset.tk); if (u) window.open(u, '_blank'); else { bs.copyText(tk.dataset.tk); toast('Copiado: ' + tk.dataset.tk); } return; }
      if (e.target.closest('[data-tog]')) { V.openFeat.has(r.dataset.rel) ? V.openFeat.delete(r.dataset.rel) : V.openFeat.add(r.dataset.rel); render(); return; }
      bs.openFile(r.dataset.rel, 'editor');
    };
    r.oncontextmenu = (e) => featMenu(e, r.dataset.rel);
  });
  el.querySelectorAll('.qa-sc, .qa-use').forEach(r => r.onclick = () => bs.openFile(r.dataset.rel, 'editor', +r.dataset.line + 1));
  el.querySelectorAll('.qa-sc').forEach(r => r.oncontextmenu = (e) => { const d = docFor(r.dataset.rel); const sc = d && d.scenarios.find(s => s.line === +r.dataset.line); if (sc) statusMenu(e, r.dataset.rel, sc); });
  el.querySelectorAll('.qa-step').forEach(r => r.onclick = () => { V.stepOpen = V.stepOpen === r.dataset.step ? null : r.dataset.step; render(); });
  el.querySelectorAll('.qa-tag').forEach(r => r.onclick = (e) => { const run = e.target.closest('[data-runtag]'); if (run) { e.stopPropagation(); return runner(null, run.dataset.runtag, run.dataset.runtag); } V.q = r.dataset.tag; V.view = 'features'; store.set('qaView', V.view); render(); });
  el.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => runScope('report'));
  el.querySelectorAll('[data-csv]').forEach(b => b.onclick = () => runScope('csv'));
}
// relatório/CSV do painel: o que a busca encontrou (ou tudo)
async function runScope(kind) {
  const rels = [...P.files.entries()].filter(([rel, f]) => matches(rel, f, V.q)).map(([rel]) => rel);
  if (!rels.length) return toast('Nenhuma feature');
  const dirs = rels.map(dirOf); let common = dirs[0] || '';
  for (const d of dirs) while (common && !(d === common || d.startsWith(common + '/'))) common = dirOf(common);
  if (kind === 'report') { const out = (common ? common + '/' : '') + 'relatorio-evidencias.html'; await writeText(out, reportHtml(rels, dirOf(out))); toast('Relatório gerado: ' + out, 'ok'); openOutside(out); }
  else { const out = (common ? common + '/' : '') + 'casos-de-teste.csv'; await writeText(out, csvOf(rels)); toast('CSV gerado: ' + out, 'ok'); bs.openFile(out, 'editor'); }
}
function featMenu(e, rel) {
  bs.showMenu(e, [
    { label: 'Abrir', icon: bs.I.edit, action: () => bs.openFile(rel, 'editor') },
    ...ticketsOf(rel).map(t => ({ label: (ticketLink(t) ? 'Abrir ' : 'Copiar ') + t, icon: ICO.link, action: () => { const u = ticketLink(t); if (u) window.open(u, '_blank'); else bs.copyText(t); } })),
    '-',
    { label: 'Relatório de evidências', icon: ICO.doc, action: () => makeReport(rel, false) },
    { label: 'Exportar casos de teste (CSV)', icon: ICO.csv, action: () => exportCsv(rel, false) },
    { label: 'Copiar todos os cenários (texto)', icon: bs.I.copy, action: () => { const d = docFor(rel); if (d) { bs.copyText(`${d.feature ? d.feature.kw + ': ' + d.feature.name + '\n\n' : ''}${d.scenarios.map(s => scenarioText(rel, d, s)).join('\n\n')}`); toast('Cenários copiados', 'ok'); } } },
    ...(automation() && P.runner ? [{ label: 'Executar feature', icon: ICO.play, action: () => runner(rel, null, titleOf(rel)) }] : []),
    '-', { label: 'Nova feature nesta pasta', icon: ICO.plus, action: () => newFeature(dirOf(rel)) },
  ], titleOf(rel));
}

// ====================================================================================================================
// Kit do QA: dados de teste, validadores, valores limite, entradas especiais, JSON, codificação, JWT, datas, texto,
// hash, regex, comparar textos, relatório de bug e ambientes. Tudo local, na página.
// ====================================================================================================================
const KI = {
  id: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.8-1.6 5.2-1.6 6 0M14 10h4M14 13h3"/></svg>',
  table: ICO.csv,
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  ruler: '<svg class="i" viewBox="0 0 24 24"><path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
  bomb: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="14" r="7"/><path d="M15 8l3-3M18 5l1.5-1.5M19 8h2M16 3V1"/></svg>',
  json: '<svg class="i" viewBox="0 0 24 24"><path d="M8 4c-2 0-2 2-2 4s-2 4-2 4 2 2 2 4 0 4 2 4M16 4c2 0 2 2 2 4s2 4 2 4-2 2-2 4 0 4-2 4"/></svg>',
  code: '<svg class="i" viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
  key: '<svg class="i" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2"/></svg>',
  clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  text: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg>',
  hash: '<svg class="i" viewBox="0 0 24 24"><path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/></svg>',
  regex: '<svg class="i" viewBox="0 0 24 24"><path d="M17 3v8M13.5 5l7 4M13.5 9l7-4"/><circle cx="6" cy="18" r="2.5"/></svg>',
  diff: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9v3a3 3 0 0 1-3 3H9"/></svg>',
  bug: '<svg class="i" viewBox="0 0 24 24"><path d="M8 8h8v8a4 4 0 0 1-8 0zM9 8a3 3 0 0 1 6 0M4 12h4M16 12h4M5 7l3 2M19 7l-3 2M5 18l3-2M19 18l-3-2"/></svg>',
  globe: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  list: '<svg class="i" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  timer: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>',
};
const copy = (v, what) => { bs.copyText(String(v)); toast((what || 'Copiado') + ': ' + (String(v).length > 60 ? String(v).slice(0, 60) + '…' : v), 'ok'); };
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const digits = (n) => Array.from({ length: n }, () => rnd(10));
const onlyDigits = (s) => String(s).replace(/\D/g, '');
const pad = (n, w = 2) => String(n).padStart(w, '0');
// 2026-10-21-19-02 no horário local (nome de arquivo)
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;

// ---------- geradores (documentos brasileiros com dígito verificador válido) ----------
const G = {
  cpf(f) {
    const d = digits(9);
    if (d.every(x => x === d[0])) d[8] = (d[8] + 1) % 10;
    const dv = (arr) => { const s = arr.reduce((a, x, i) => a + x * (arr.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
    d.push(dv(d)); d.push(dv(d));
    const s = d.join(''); return f ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` : s;
  },
  cnpj(f) {
    const d = [...digits(8), 0, 0, 0, 1];
    const dv = (arr) => { const w = arr.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = arr.reduce((a, x, i) => a + x * w[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
    d.push(dv(d)); d.push(dv(d));
    const s = d.join(''); return f ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s;
  },
  rg(f) { // padrão SP
    const d = digits(8); const s = d.reduce((a, x, i) => a + x * (i + 2), 0) % 11; const dv = 11 - s === 10 ? 'X' : 11 - s === 11 ? '0' : String(11 - s);
    const t = d.join('') + dv; return f ? `${t.slice(0, 2)}.${t.slice(2, 5)}.${t.slice(5, 8)}-${t.slice(8)}` : t;
  },
  pis(f) {
    const d = digits(10); const w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = 11 - (d.reduce((a, x, i) => a + x * w[i], 0) % 11); d.push(r >= 10 ? 0 : r);
    const s = d.join(''); return f ? `${s.slice(0, 3)}.${s.slice(3, 8)}.${s.slice(8, 10)}-${s.slice(10)}` : s;
  },
  cnh() {
    for (;;) {
      const d = digits(9); let v = 0; for (let i = 0; i < 9; i++) v += d[i] * (9 - i);
      let dv1 = v % 11, dsc = 0; if (dv1 >= 10) { dv1 = 0; dsc = 2; }
      v = 0; for (let i = 0; i < 9; i++) v += d[i] * (i + 1);
      let dv2 = v % 11; dv2 = dv2 >= 10 ? 0 : dv2 - dsc; if (dv2 < 0) continue;
      return d.join('') + dv1 + dv2;
    }
  },
  titulo(f) {
    const seq = digits(8); const uf = 1 + rnd(28); const u = [Math.floor(uf / 10), uf % 10];
    let r = seq.reduce((a, x, i) => a + x * (i + 2), 0) % 11; if (r === 10) r = 0; if (r === 0 && (uf === 1 || uf === 2)) r = 1;
    let r2 = (u[0] * 7 + u[1] * 8 + r * 9) % 11; if (r2 === 10) r2 = 0; if (r2 === 0 && (uf === 1 || uf === 2)) r2 = 1;
    const s = seq.join('') + u.join('') + r + r2; return f ? `${s.slice(0, 4)} ${s.slice(4, 8)} ${s.slice(8)}` : s;
  },
  renavam() { const d = digits(10); const w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let r = (d.reduce((a, x, i) => a + x * w[i], 0) * 10) % 11; if (r === 10) r = 0; return d.join('') + r; },
  placa() { const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; return pick(L) + pick(L) + pick(L) + rnd(10) + pick(L) + rnd(10) + rnd(10); },
  cep(f) { const c = pick(CEPS); return { cep: f ? c[0] : onlyDigits(c[0]), cidade: c[1], uf: c[2], logradouro: c[3] }; },
  telefone(f) { const ddd = pick(DDDS); const n = '9' + digits(8).join(''); return f ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}` : ddd + n; },
  nome() { const sexo = rnd(2); return `${pick(sexo ? NOMES_F : NOMES_M)} ${pick(SOBRENOMES)} ${pick(SOBRENOMES)}`; },
  email(nome) { const n = (nome || G.nome()).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(' '); return `${n[0]}.${n[n.length - 1]}${rnd(100)}@example.com`; },
  nascimento(min = 18, max = 80) { const now = new Date(); const age = min + rnd(max - min + 1); const d = new Date(now.getFullYear() - age, rnd(12), 1 + rnd(28)); return { br: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`, iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, idade: age }; },
  cartao(bandeira) {
    const pre = { Visa: ['4'], Mastercard: ['51', '52', '53', '54', '55', '2221', '2720'], Amex: ['34', '37'], Elo: ['636368', '438935', '504175', '451416'], Hipercard: ['606282'] }[bandeira] || ['4'];
    const len = bandeira === 'Amex' ? 15 : 16;
    const n = (pick(pre) + digits(len).join('')).slice(0, len - 1).split('').map(Number);
    let s = 0; for (let i = n.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) { let x = n[i]; if (dbl) { x *= 2; if (x > 9) x -= 9; } s += x; }
    n.push((10 - (s % 10)) % 10);
    const now = new Date();
    return { numero: n.join('').replace(bandeira === 'Amex' ? /(\d{4})(\d{6})(\d{5})/ : /(\d{4})(?=\d)/g, bandeira === 'Amex' ? '$1 $2 $3' : '$1 '), validade: `${pad(1 + rnd(12))}/${String(now.getFullYear() + 1 + rnd(5)).slice(2)}`, cvv: digits(bandeira === 'Amex' ? 4 : 3).join(''), bandeira };
  },
  uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = rnd(16); return (c === 'x' ? r : (r & 3) | 8).toString(16); }); },
  senha(n = 14) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', b = 'abcdefghijkmnopqrstuvwxyz', c = '23456789', e = '!@#$%&*?-_'; const all = a + b + c + e; const out = [pick(a), pick(b), pick(c), pick(e)]; while (out.length < n) out.push(pick(all)); return out.sort(() => Math.random() - .5).join(''); },
};
const NOMES_M = 'Miguel Arthur Gael Heitor Theo Davi Gabriel Bernardo Samuel João Pedro Lucas Rafael Gustavo Felipe Matheus Bruno Diego Thiago Rodrigo Leonardo Eduardo Vinícius Henrique Caio'.split(' ');
const NOMES_F = 'Helena Alice Laura Maria Valentina Heloísa Sophia Isabella Manuela Júlia Cecília Beatriz Larissa Mariana Fernanda Camila Juliana Patrícia Aline Bruna Letícia Gabriela Renata Carolina Ana'.split(' ');
const SOBRENOMES = 'Silva Santos Oliveira Souza Rodrigues Ferreira Alves Pereira Lima Gomes Costa Ribeiro Martins Carvalho Almeida Lopes Soares Fernandes Vieira Barbosa Rocha Dias Nascimento Andrade Moreira Nunes Marques Machado Mendes Freitas Cardoso Ramos Teixeira Araújo Moura'.split(' ');
const DDDS = [11, 12, 13, 15, 19, 21, 24, 27, 31, 34, 41, 43, 47, 48, 51, 54, 61, 62, 65, 67, 71, 73, 79, 81, 82, 83, 84, 85, 86, 91, 92, 98];
const CEPS = [['01001-000', 'São Paulo', 'SP', 'Praça da Sé'], ['20040-002', 'Rio de Janeiro', 'RJ', 'Avenida Rio Branco'], ['30130-010', 'Belo Horizonte', 'MG', 'Praça Sete de Setembro'], ['70040-010', 'Brasília', 'DF', 'Esplanada dos Ministérios'], ['40020-000', 'Salvador', 'BA', 'Rua Chile'], ['80010-000', 'Curitiba', 'PR', 'Praça Tiradentes'], ['90010-000', 'Porto Alegre', 'RS', 'Rua dos Andradas'], ['60060-000', 'Fortaleza', 'CE', 'Rua Senador Pompeu'], ['50010-000', 'Recife', 'PE', 'Avenida Martins de Barros'], ['69005-000', 'Manaus', 'AM', 'Avenida Eduardo Ribeiro'], ['88010-000', 'Florianópolis', 'SC', 'Praça XV de Novembro'], ['74003-010', 'Goiânia', 'GO', 'Avenida Goiás']];

// ---------- validadores ----------
const VAL = {
  cpf(v) { const d = onlyDigits(v); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false; const n = d.split('').map(Number); const dv = (k) => { const s = n.slice(0, k).reduce((a, x, i) => a + x * (k + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; }; return dv(9) === n[9] && dv(10) === n[10]; },
  cnpj(v) { const d = onlyDigits(v); if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false; const n = d.split('').map(Number); const dv = (k) => { const w = k === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = n.slice(0, k).reduce((a, x, i) => a + x * w[i], 0) % 11; return s < 2 ? 0 : 11 - s; }; return dv(12) === n[12] && dv(13) === n[13]; },
  luhn(v) { const d = onlyDigits(v); if (d.length < 12 || d.length > 19) return false; let s = 0; for (let i = d.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) { let x = +d[i]; if (dbl) { x *= 2; if (x > 9) x -= 9; } s += x; } return s % 10 === 0; },
  email(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()); },
  cep(v) { return /^\d{5}-?\d{3}$/.test(String(v).trim()); },
};
function detectDoc(v) {
  const d = onlyDigits(v), t = String(v).trim();
  if (!t) return null;
  if (/@/.test(t)) return ['E-mail', VAL.email(t)];
  if (d.length === 11 && !/[a-z]/i.test(t)) return ['CPF', VAL.cpf(d)];
  if (d.length === 14) return ['CNPJ', VAL.cnpj(d)];
  if (d.length === 8 && /^\d{5}-?\d{3}$/.test(t)) return ['CEP (formato)', VAL.cep(t)];
  if (d.length >= 12 && d.length <= 19) return ['Cartão (Luhn)', VAL.luhn(d)];
  return ['Desconhecido', null];
}

// ---------- janelas do kit ----------
function kit(id, title, desc, html, bind, wide = true) {
  return dialog('qk_' + id, `<div class="dlg-hd"><span class="dlg-ic">${KITS.find(k => k.id === id)?.ico || KI.check}</span><div><h3>${esc(title)}</h3>${desc ? `<p>${desc}</p>` : ''}</div></div>
    <div class="qk">${html}</div>
    <div class="actions"><span class="spacer"></span><button class="chip" data-close>Fechar</button></div>`, (el) => { if (wide) el.querySelector('.dlg-box').classList.add('qk-box'); bind && bind(el); });
}
const out = (label, value, extra = '') => `<div class="qk-out"><span class="qk-l">${esc(label)}</span><code class="qk-v" data-copy="${esc(value)}" title="Clique para copiar">${esc(value)}</code>${extra}</div>`;
const bindCopy = (el) => el.querySelectorAll('[data-copy]').forEach(c => c.onclick = () => copy(c.dataset.copy, c.closest('.qk-out')?.querySelector('.qk-l')?.textContent));

function kitData() {
  const fmt = () => store.get('qkFmt', true);
  const draw = (el) => {
    const f = fmt(); const nome = G.nome(); const nasc = G.nascimento(); const cep = G.cep(f); const card = G.cartao(el.querySelector('#qkBand')?.value || 'Visa');
    el.querySelector('.qk-grid').innerHTML = [
      out('Nome', nome), out('E-mail', G.email(nome)), out('CPF', G.cpf(f)), out('CNPJ', G.cnpj(f)), out('RG (SP)', G.rg(f)), out('PIS/PASEP', G.pis(f)),
      out('CNH', G.cnh()), out('Título de eleitor', G.titulo(f)), out('Renavam', G.renavam()), out('Placa (Mercosul)', G.placa()),
      out('Telefone (celular)', G.telefone(f)), out('Nascimento', nasc.br, `<span class="qk-mut">${nasc.idade} anos · ${nasc.iso}</span>`),
      out('CEP', cep.cep, `<span class="qk-mut">${esc(cep.logradouro)} · ${esc(cep.cidade)}/${cep.uf}</span>`),
      out(`Cartão de teste (${card.bandeira})`, card.numero, `<span class="qk-mut">val ${card.validade} · CVV ${card.cvv}</span>`),
      out('UUID', G.uuid()), out('Senha forte', G.senha()),
    ].join('');
    bindCopy(el);
  };
  kit('data', 'Dados de teste', 'Documentos com dígito verificador válido (gerados, não são de ninguém). Clique num valor para copiar. Cartões passam no Luhn e servem só em ambientes de teste.', `
    <div class="qk-bar"><label class="chk"><input type="checkbox" id="qkFmt" ${fmt() ? 'checked' : ''}> Com máscara (pontos e traços)</label>
      <label>Bandeira <select id="qkBand">${['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard'].map(b => `<option>${b}</option>`).join('')}</select></label>
      <span class="spacer"></span><button class="chip primary" id="qkNew">Gerar de novo</button></div>
    <div class="qk-grid"></div>`, (el) => {
    draw(el);
    el.querySelector('#qkNew').onclick = () => draw(el);
    el.querySelector('#qkFmt').onchange = (e) => { store.set('qkFmt', e.target.checked); draw(el); };
    el.querySelector('#qkBand').onchange = () => draw(el);
  });
}
const MASS = [['nome', 'Nome'], ['email', 'E-mail'], ['cpf', 'CPF'], ['rg', 'RG'], ['nascimento', 'Nascimento'], ['telefone', 'Telefone'], ['cep', 'CEP'], ['cidade', 'Cidade'], ['uf', 'UF'], ['cnpj', 'CNPJ'], ['cartao', 'Cartão de teste'], ['placa', 'Placa'], ['uuid', 'UUID'], ['senha', 'Senha']];
function kitMass() {
  kit('mass', 'Massa de dados', 'Várias linhas de uma vez, para importar ou cadastrar em lote. CSV abre como planilha no BlueScreen.', `
    <div class="qk-chks">${MASS.map(([k, l], i) => `<label class="chk"><input type="checkbox" value="${k}" ${i < 7 ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div class="qk-bar"><label>Linhas <input id="qkN" type="number" min="1" max="5000" value="20"></label><label class="chk"><input type="checkbox" id="qkMF" checked> Com máscara</label>
      <label>Formato <select id="qkOut"><option value="csv">CSV (;)</option><option value="json">JSON</option></select></label><span class="spacer"></span>
      <button class="chip" id="qkCopy">Copiar</button><button class="chip primary" id="qkSave">Salvar no projeto</button></div>
    <pre class="qa-code qk-prev"></pre>`, (el) => {
    const gen = () => {
      const keys = [...el.querySelectorAll('.qk-chks input:checked')].map(i => i.value); const n = Math.max(1, Math.min(5000, +el.querySelector('#qkN').value || 1)); const f = el.querySelector('#qkMF').checked;
      const rows = Array.from({ length: n }, () => { const nome = G.nome(), cep = G.cep(f), card = G.cartao(pick(['Visa', 'Mastercard', 'Elo'])); const all = { nome, email: G.email(nome), cpf: G.cpf(f), rg: G.rg(f), nascimento: G.nascimento().br, telefone: G.telefone(f), cep: cep.cep, cidade: cep.cidade, uf: cep.uf, cnpj: G.cnpj(f), cartao: card.numero, placa: G.placa(), uuid: G.uuid(), senha: G.senha() }; return Object.fromEntries(keys.map(k => [k, all[k]])); });
      const fmt = el.querySelector('#qkOut').value;
      const q = (v) => /[;"\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
      const text = fmt === 'json' ? JSON.stringify(rows, null, 2) : '﻿' + [keys.map(k => MASS.find(m => m[0] === k)[1]).join(';'), ...rows.map(r => keys.map(k => q(r[k])).join(';'))].join('\r\n') + '\r\n';
      el.querySelector('.qk-prev').textContent = text.replace('﻿', '').split('\n').slice(0, 12).join('\n') + (n > 10 ? `\n… (${n} linhas)` : '');
      return { text, fmt };
    };
    let last = gen();
    el.querySelectorAll('input,select').forEach(i => i.onchange = () => { last = gen(); });
    el.querySelector('#qkCopy').onclick = () => copy(last.text.replace('﻿', ''), 'Massa copiada');
    el.querySelector('#qkSave').onclick = async () => {
      const dir = (P.settings.bugsDir || 'qa').replace(/^\/+|\/+$/g, '') + '/massas';
      const rel = `${dir}/massa-${stamp()}.${last.fmt}`;
      try { await writeText(rel, last.text); toast('Salvo em ' + rel, 'ok'); bs.openFile(rel, 'editor'); } catch (e) { toast(e.message); }
    };
  });
}
function kitValidate() {
  kit('validate', 'Validar documento', 'Cole um CPF, CNPJ, número de cartão, e-mail ou CEP (com ou sem máscara). Uma linha por valor.', `
    <textarea id="qkIn" rows="6" placeholder="123.456.789-09\n11.222.333/0001-81\n4111 1111 1111 1111"></textarea><div class="qk-res"></div>`, (el) => {
    const run = () => { el.querySelector('.qk-res').innerHTML = el.querySelector('#qkIn').value.split('\n').filter(l => l.trim()).map(l => { const r = detectDoc(l); return `<div class="qk-vr ${r && r[1] === true ? 'ok' : r && r[1] === false ? 'bad' : ''}"><code>${esc(l.trim())}</code><span>${r ? esc(r[0]) : ''}</span><b>${r && r[1] === true ? '✓ válido' : r && r[1] === false ? '✗ inválido' : '?'}</b></div>`; }).join(''); };
    el.querySelector('#qkIn').oninput = run; el.querySelector('#qkIn').focus();
  }, false);
}
function kitBoundary() {
  kit('boundary', 'Valores limite', 'Os valores que mais acham bug num campo: nas bordas do permitido e logo fora delas.', `
    <div class="qk-bar"><label>Tipo <select id="qkT"><option value="text">Texto (tamanho)</option><option value="num">Número</option><option value="date">Data</option></select></label>
      <label>Mínimo <input id="qkMin" value="3"></label><label>Máximo <input id="qkMax" value="50"></label></div><div class="qk-grid"></div>`, (el) => {
    const run = () => {
      const t = el.querySelector('#qkT').value, a = el.querySelector('#qkMin').value.trim(), b = el.querySelector('#qkMax').value.trim();
      const rows = [];
      if (t === 'text') {
        const mn = Math.max(0, parseInt(a) || 0), mx = Math.max(mn, parseInt(b) || 0);
        const s = (n) => n <= 0 ? '' : ('Teste' + 'abcdefghijklmnopqrstuvwxyz'.repeat(Math.ceil(n / 26) + 1)).slice(0, n);
        rows.push(['Vazio', '', 'inválido se obrigatório'], ['Só espaços', '   ', 'deve ser recusado ou aparado']);
        if (mn > 0) rows.push([`${mn - 1} caracteres (mín−1)`, s(mn - 1), 'inválido']);
        rows.push([`${mn} caracteres (mín)`, s(mn), 'válido'], [`${mn + 1} caracteres (mín+1)`, s(mn + 1), 'válido'], [`${mx - 1} caracteres (máx−1)`, s(mx - 1), 'válido'], [`${mx} caracteres (máx)`, s(mx), 'válido'], [`${mx + 1} caracteres (máx+1)`, s(mx + 1), 'inválido / cortado']);
      } else if (t === 'num') {
        const mn = Number(a.replace(',', '.')), mx = Number(b.replace(',', '.')); const step = /[.,]/.test(a + b) ? 0.01 : 1;
        const f = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
        rows.push(['Vazio', '', 'inválido se obrigatório'], [`mín−${f(step)}`, f(mn - step), 'inválido'], ['mín', f(mn), 'válido'], [`mín+${f(step)}`, f(mn + step), 'válido'], [`máx−${f(step)}`, f(mx - step), 'válido'], ['máx', f(mx), 'válido'], [`máx+${f(step)}`, f(mx + step), 'inválido'], ['Zero', '0', 'conferir'], ['Negativo', '-1', 'conferir'], ['Letras', 'abc', 'inválido'], ['Decimal com ponto', '1.5', 'conferir separador'], ['Muito grande', '99999999999999999999', 'inválido / estouro']);
      } else {
        const p = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s) || /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null; return s.includes('/') ? new Date(+m[3], m[2] - 1, +m[1]) : new Date(+m[1], m[2] - 1, +m[3]); };
        const br = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
        const mn = p(a) || new Date(), mx = p(b) || add(new Date(), 30);
        rows.push(['Vazio', '', 'inválido se obrigatório'], ['mín−1 dia', br(add(mn, -1)), 'inválido'], ['mín', br(mn), 'válido'], ['mín+1 dia', br(add(mn, 1)), 'válido'], ['máx−1 dia', br(add(mx, -1)), 'válido'], ['máx', br(mx), 'válido'], ['máx+1 dia', br(add(mx, 1)), 'inválido'], ['29/02 de ano não bissexto', '29/02/2025', 'inválido'], ['29/02 de ano bissexto', '29/02/2028', 'válido'], ['Dia 31 em mês de 30', '31/04/2026', 'inválido'], ['Mês 13', '01/13/2026', 'inválido'], ['Formato errado', '2026-13-45', 'inválido']);
      }
      el.querySelector('.qk-grid').innerHTML = rows.map(([l, v, e]) => out(l, v, `<span class="qk-mut">${esc(e)}${v.length > 40 ? ' · ' + v.length + ' car.' : ''}</span>`)).join('');
      bindCopy(el);
    };
    el.querySelectorAll('input,select').forEach(i => i.oninput = run); el.querySelector('#qkT').onchange = () => { const t = el.querySelector('#qkT').value; el.querySelector('#qkMin').value = t === 'num' ? '1' : t === 'date' ? new Date().toLocaleDateString('pt-BR') : '3'; el.querySelector('#qkMax').value = t === 'num' ? '100' : t === 'date' ? new Date(Date.now() + 30 * 864e5).toLocaleDateString('pt-BR') : '50'; run(); };
    run();
  });
}
const SPECIAL = [
  ['Básico', [['Vazio', ''], ['Só espaços', '     '], ['Espaço no começo e no fim', '  texto  '], ['Tab e quebra de linha', 'linha 1\n\tlinha 2']]],
  ['Acentos e símbolos', [['Acentos', 'Ação Ñandú Über çãõ êéè'], ['Apóstrofo', "D'Ávila O'Connor"], ['Aspas', '"aspas" e \'simples\''], ['Símbolos', '!@#$%¨&*()_+-=[]{}|;:,.<>?/~`^'], ['Emoji', 'Teste 😀👍🏽👨‍👩‍👧 ✔'], ['Moeda', 'R$ 1.234,56 · US$ 1,234.56 · € 9,99']]],
  ['Unicode traiçoeiro', [['Caractere invisível (zero-width)', 'te​ste'], ['Espaço não separável', 'te ste'], ['Texto da direita p/ esquerda', '‮etset'], ['Letras parecidas (cirílico)', 'аdmin'], ['Ideogramas', '测试 テスト 테스트']]],
  ['Tamanho', [['255 caracteres', 'a'.repeat(255)], ['256 caracteres', 'a'.repeat(256)], ['1000 caracteres', 'a'.repeat(1000)], ['Palavra enorme sem espaço', 'Supercalifragilisticexpialidocious'.repeat(8)]]],
  ['Números', [['Zero', '0'], ['Negativo', '-1'], ['Decimal com vírgula', '1,5'], ['Decimal com ponto', '1.5'], ['Notação científica', '1e10'], ['Muito grande', '9999999999999999999999'], ['Com espaço', '1 000']]],
  ['Injeção (teste o seu sistema)', [['HTML', '<b>negrito</b><i>itálico</i>'], ['Script (XSS)', '<script>alert(1)</script>'], ['Imagem com onerror', '<img src=x onerror=alert(1)>'], ['SQL', "' OR '1'='1' --"], ['SQL com ponto e vírgula', "'; DROP TABLE teste; --"], ['Template', '{{7*7}} ${7*7} <%= 7*7 %>'], ['Caminho', '../../etc/passwd'], ['Comando', '; ls -la && whoami'], ['Formato printf', '%s%s%s%n%d']]],
  ['E-mail', [['Válido simples', 'teste@example.com'], ['Com +', 'teste+qa@example.com'], ['Sem @', 'teste.example.com'], ['Dois @', 'a@@example.com'], ['Sem domínio', 'teste@'], ['Com espaço', 'te ste@example.com'], ['Maiúsculas', 'TESTE@EXAMPLE.COM']]],
];
function kitSpecial() {
  kit('special', 'Entradas especiais', 'Valores que costumam quebrar campos, máscaras, banco e tela. Clique para copiar. Use a parte de injeção só nos sistemas que você testa.', SPECIAL.map(([g, list]) => `<div class="qk-sub">${esc(g)}</div><div class="qk-grid">${list.map(([l, v]) => out(l, v, v.length > 60 ? `<span class="qk-mut">${v.length} caracteres</span>` : '')).join('')}</div>`).join(''), bindCopy);
}
function kitJson() {
  kit('json', 'JSON', 'Formatar, validar, minificar e comparar. O erro aponta linha e coluna.', `
    <div class="qk-bar"><button class="chip" data-a="fmt">Formatar</button><button class="chip" data-a="min">Minificar</button><button class="chip" data-a="sort">Ordenar chaves</button><button class="chip" data-a="esc">Virar string</button><button class="chip" data-a="unesc">Tirar de string</button><span class="spacer"></span><button class="chip" data-a="cmp">Comparar com outro…</button><button class="chip primary" data-a="copy">Copiar</button></div>
    <textarea id="qkJ" rows="16" spellcheck="false" placeholder='{"exemplo": [1, 2, 3]}'></textarea><div class="qk-msg"></div>`, (el) => {
    const ta = el.querySelector('#qkJ'), msg = el.querySelector('.qk-msg');
    const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
    const parse = () => { try { const v = JSON.parse(ta.value); msg.className = 'qk-msg ok'; msg.textContent = '✓ JSON válido' + (Array.isArray(v) ? ` · lista com ${v.length} itens` : v && typeof v === 'object' ? ` · ${Object.keys(v).length} chaves` : ''); return v; } catch (e) { const m = /position (\d+)/.exec(e.message); let where = ''; if (m) { const before = ta.value.slice(0, +m[1]); where = ` (linha ${before.split('\n').length}, coluna ${before.length - before.lastIndexOf('\n')})`; } msg.className = 'qk-msg bad'; msg.textContent = '✗ ' + e.message + where; return undefined; } };
    ta.oninput = () => ta.value.trim() && parse();
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'copy') return copy(ta.value, 'JSON copiado');
      if (a === 'cmp') return kitDiff(ta.value, '', 'json');
      if (a === 'unesc') { try { ta.value = JSON.parse(ta.value); parse(); } catch (e) { msg.className = 'qk-msg bad'; msg.textContent = '✗ não é uma string JSON'; } return; }
      const v = parse(); if (v === undefined) return;
      ta.value = a === 'min' ? JSON.stringify(v) : a === 'esc' ? JSON.stringify(JSON.stringify(v)) : JSON.stringify(a === 'sort' ? sortKeys(v) : v, null, 2);
    });
    ta.focus();
  });
}
function b64e(s) { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }
function b64d(s) { const t = s.trim().replace(/-/g, '+').replace(/_/g, '/'); return new TextDecoder().decode(Uint8Array.from(atob(t + '==='.slice((t.length + 3) % 4)), c => c.charCodeAt(0))); }
function kitCode() {
  kit('code', 'Codificar e decodificar', 'Base64, URL, HTML e JWT. Cole no campo de cima.', `
    <textarea id="qkC" rows="6" spellcheck="false" placeholder="texto, Base64, URL ou um JWT (eyJ...)"></textarea>
    <div class="qk-bar"><button class="chip" data-a="b64e">Base64 ←</button><button class="chip" data-a="b64d">Base64 →</button><button class="chip" data-a="urle">URL ←</button><button class="chip" data-a="urld">URL →</button><button class="chip" data-a="htmle">HTML ←</button><button class="chip" data-a="htmld">HTML →</button><button class="chip" data-a="jwt">Ler JWT</button></div>
    <textarea id="qkR" rows="10" spellcheck="false" readonly></textarea><div class="qk-msg"></div>
    <div class="qk-bar"><span class="qk-mut">← codifica · → decodifica</span><span class="spacer"></span><button class="chip primary" id="qkRC">Copiar resultado</button></div>`, (el) => {
    const i = el.querySelector('#qkC'), o = el.querySelector('#qkR'), msg = el.querySelector('.qk-msg');
    const jwt = (t) => {
      const p = t.trim().replace(/^Bearer\s+/i, '').split('.'); if (p.length < 2) throw new Error('não parece um JWT (header.payload.assinatura)');
      const h = JSON.parse(b64d(p[0])), pl = JSON.parse(b64d(p[1]));
      const when = (s) => s ? `${new Date(s * 1000).toLocaleString('pt-BR')}` : '';
      const now = Date.now() / 1000;
      msg.className = 'qk-msg ' + (pl.exp && pl.exp < now ? 'bad' : 'ok');
      msg.textContent = [pl.exp ? (pl.exp < now ? `✗ expirou em ${when(pl.exp)}` : `✓ válido até ${when(pl.exp)} (${Math.round((pl.exp - now) / 60)} min)`) : 'sem exp', pl.iat ? `emitido ${when(pl.iat)}` : '', h.alg ? `alg ${h.alg}` : ''].filter(Boolean).join(' · ') + ' · a assinatura não é conferida aqui';
      return JSON.stringify({ header: h, payload: pl }, null, 2);
    };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      msg.textContent = ''; msg.className = 'qk-msg';
      try {
        const v = i.value; const ta = document.createElement('textarea');
        o.value = ({ b64e: () => b64e(v), b64d: () => b64d(v), urle: () => encodeURIComponent(v), urld: () => decodeURIComponent(v.replace(/\+/g, ' ')), htmle: () => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), htmld: () => { ta.innerHTML = v; return ta.value; }, jwt: () => jwt(v) })[b.dataset.a]();
      } catch (e) { msg.className = 'qk-msg bad'; msg.textContent = '✗ ' + e.message; }
    });
    i.oninput = () => { if (/^\s*(Bearer\s+)?eyJ[\w-]+\.[\w-]+\./.test(i.value)) el.querySelector('[data-a="jwt"]').click(); };
    el.querySelector('#qkRC').onclick = () => copy(o.value, 'Resultado copiado');
    i.focus();
  });
}
function kitDate() {
  const br = (d) => d.toLocaleString('pt-BR');
  kit('date', 'Data e hora', 'Converte epoch (segundos ou milissegundos) e datas; soma dias; conta dias corridos e úteis (seg a sex, sem feriados).', `
    <div class="qk-sub">Converter</div><input id="qkD" placeholder="1792617444 · 1792617444203 · 21/10/2026 18:30 · 2026-10-21T18:30:00Z" spellcheck="false"><div class="qk-grid" id="qkDo"></div>
    <div class="qk-sub">Somar</div><div class="qk-bar"><input id="qkA" placeholder="data (vazio = hoje)" spellcheck="false"><label>+ dias <input id="qkAd" type="number" value="30"></label><label class="chk"><input type="checkbox" id="qkAu"> só úteis</label></div><div class="qk-grid" id="qkAo"></div>
    <div class="qk-sub">Entre duas datas</div><div class="qk-bar"><input id="qkB1" placeholder="de" spellcheck="false"><input id="qkB2" placeholder="até" spellcheck="false"></div><div class="qk-grid" id="qkBo"></div>`, (el) => {
    const parse = (s) => {
      s = String(s || '').trim(); if (!s) return new Date();
      if (/^\d{10}$/.test(s)) return new Date(+s * 1000); if (/^\d{13}$/.test(s)) return new Date(+s);
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
      if (m) return new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      const d = new Date(s); return isNaN(d) ? null : d;
    };
    const work = (a, b) => { let n = 0; const d = new Date(Math.min(a, b)); d.setHours(0, 0, 0, 0); const e = new Date(Math.max(a, b)); e.setHours(0, 0, 0, 0); while (d < e) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n++; } return n; };
    const conv = () => { const d = parse(el.querySelector('#qkD').value); el.querySelector('#qkDo').innerHTML = d ? [out('Data e hora (BR)', br(d)), out('ISO 8601 (UTC)', d.toISOString()), out('Epoch (s)', String(Math.floor(d / 1000))), out('Epoch (ms)', String(+d)), out('Dia da semana', d.toLocaleDateString('pt-BR', { weekday: 'long' }))].join('') : '<div class="qk-msg bad">✗ não reconheci a data</div>'; bindCopy(el); };
    const add = () => { const d = parse(el.querySelector('#qkA').value); const n = +el.querySelector('#qkAd').value || 0; if (!d) return; const r = new Date(d); if (el.querySelector('#qkAu').checked) { let k = Math.abs(n); while (k) { r.setDate(r.getDate() + Math.sign(n)); if (r.getDay() % 6) k--; } } else r.setDate(r.getDate() + n); el.querySelector('#qkAo').innerHTML = out('Resultado', r.toLocaleDateString('pt-BR'), `<span class="qk-mut">${r.toLocaleDateString('pt-BR', { weekday: 'long' })}</span>`); bindCopy(el); };
    const between = () => { const a = parse(el.querySelector('#qkB1').value), b = parse(el.querySelector('#qkB2').value); if (!a || !b) return; const days = Math.round((b - a) / 864e5); el.querySelector('#qkBo').innerHTML = [out('Dias corridos', String(days)), out('Dias úteis', String(work(a, b))), out('Horas', String(Math.round((b - a) / 36e5)))].join(''); bindCopy(el); };
    el.querySelector('#qkD').oninput = conv; ['#qkA', '#qkAd', '#qkAu'].forEach(s => el.querySelector(s).oninput = add); el.querySelector('#qkAu').onchange = add; ['#qkB1', '#qkB2'].forEach(s => el.querySelector(s).oninput = between);
    conv(); add();
  });
}
function kitText() {
  kit('text', 'Texto', 'Contar, gerar texto do tamanho exato que o campo pede e transformar.', `
    <div class="qk-bar"><label>Gerar texto com <input id="qkLen" type="number" min="1" value="255"> caracteres</label><button class="chip primary" id="qkGen">Gerar e copiar</button></div>
    <textarea id="qkTx" rows="10" spellcheck="false" placeholder="Cole ou digite um texto"></textarea><div class="qk-stats"></div>
    <div class="qk-bar">${[['up', 'MAIÚSCULAS'], ['low', 'minúsculas'], ['title', 'Título'], ['noacc', 'Sem acentos'], ['trim', 'Tirar espaços extras'], ['uniq', 'Linhas únicas'], ['sort', 'Ordenar linhas'], ['slug', 'slug-de-url']].map(([k, l]) => `<button class="chip" data-a="${k}">${l}</button>`).join('')}<span class="spacer"></span><button class="chip" id="qkTC">Copiar</button></div>`, (el) => {
    const ta = el.querySelector('#qkTx');
    const stats = () => { const v = ta.value; el.querySelector('.qk-stats').textContent = `${[...v].length} caracteres · ${new TextEncoder().encode(v).length} bytes (UTF-8) · ${v.trim() ? v.trim().split(/\s+/).length : 0} palavras · ${v ? v.split('\n').length : 0} linhas`; };
    const noacc = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    ta.oninput = stats;
    el.querySelector('#qkGen').onclick = () => { const n = Math.max(1, Math.min(1e6, +el.querySelector('#qkLen').value || 1)); const base = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua '; ta.value = base.repeat(Math.ceil(n / base.length)).slice(0, n - 3) + (n >= 3 ? 'FIM' : '').slice(0, n); ta.value = ta.value.slice(0, n); stats(); copy(ta.value, `Texto com ${n} caracteres copiado`); };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const v = ta.value; const lines = v.split('\n');
      ta.value = ({ up: () => v.toUpperCase(), low: () => v.toLowerCase(), title: () => v.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()), noacc: () => noacc(v), trim: () => lines.map(l => l.trim().replace(/\s+/g, ' ')).join('\n').trim(), uniq: () => [...new Set(lines)].join('\n'), sort: () => [...lines].sort((a, b) => a.localeCompare(b, 'pt-BR')).join('\n'), slug: () => noacc(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })[b.dataset.a]();
      stats();
    });
    el.querySelector('#qkTC').onclick = () => copy(ta.value, 'Texto copiado');
    stats();
  });
}
function kitHash() {
  kit('hash', 'Hash e UUID', 'SHA do texto (como sai num log, numa API ou num banco) e identificadores aleatórios.', `
    <textarea id="qkH" rows="5" spellcheck="false" placeholder="texto"></textarea><div class="qk-grid" id="qkHo"></div>
    <div class="qk-sub">UUIDs</div><div class="qk-grid" id="qkU"></div>`, (el) => {
    const hex = (b) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    const run = async () => { const data = new TextEncoder().encode(el.querySelector('#qkH').value); const rows = []; for (const a of ['SHA-1', 'SHA-256', 'SHA-512']) rows.push(out(a, hex(await crypto.subtle.digest(a, data)))); rows.push(out('Base64', b64e(el.querySelector('#qkH').value))); el.querySelector('#qkHo').innerHTML = rows.join(''); bindCopy(el); };
    el.querySelector('#qkH').oninput = run;
    el.querySelector('#qkU').innerHTML = Array.from({ length: 5 }, () => out('UUID v4', G.uuid())).join('');
    run();
  }, false);
}
function kitRegex() {
  kit('regex', 'Testar regex', 'Confira a expressão de uma validação com vários valores de uma vez (um por linha).', `
    <div class="qk-bar"><input id="qkRe" placeholder="^\\d{5}-?\\d{3}$" spellcheck="false" style="flex:1"><input id="qkFl" value="" placeholder="flags (i, g, m)" spellcheck="false" style="width:110px"></div>
    <textarea id="qkRv" rows="8" spellcheck="false" placeholder="01001-000\n01001000\n0100-1000"></textarea><div class="qk-res"></div>`, (el) => {
    const run = () => {
      let re; try { re = new RegExp(el.querySelector('#qkRe').value, el.querySelector('#qkFl').value.replace(/[^gimsuy]/g, '')); } catch (e) { el.querySelector('.qk-res').innerHTML = `<div class="qk-msg bad">✗ ${esc(e.message)}</div>`; return; }
      el.querySelector('.qk-res').innerHTML = el.querySelector('#qkRv').value.split('\n').filter(Boolean).map(l => { const m = l.match(re); return `<div class="qk-vr ${m ? 'ok' : 'bad'}"><code>${esc(l)}</code><span>${m ? esc(m.slice(0, 4).filter(x => x !== undefined).join(' · ')) : ''}</span><b>${m ? '✓ casa' : '✗ não casa'}</b></div>`; }).join('');
    };
    el.querySelectorAll('input,textarea').forEach(i => i.oninput = run); el.querySelector('#qkRe').focus();
  });
}
// comparar: o editor de diferenças do Monaco, lado a lado
function kitDiff(a = '', b = '', lang = 'plaintext') {
  kit('diff', 'Comparar textos', 'Cole o esperado à esquerda e o obtido à direita: as diferenças aparecem marcadas.', `
    <div class="qk-bar"><label>Formato <select id="qkDl">${[['plaintext', 'Texto'], ['json', 'JSON'], ['xml', 'XML'], ['sql', 'SQL'], ['html', 'HTML']].map(([v, l]) => `<option value="${v}" ${v === lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="chk"><input type="checkbox" id="qkDj"> Formatar JSON antes</label></div>
    <div class="qk-dhead"><span>Esperado</span><span>Obtido</span></div><div class="qk-diff"></div>`, (el) => {
    const m = bs.monaco; const host = el.querySelector('.qk-diff');
    const A = m.editor.createModel(a, lang), B = m.editor.createModel(b, lang);
    const de = m.editor.createDiffEditor(host, { originalEditable: true, automaticLayout: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, theme: undefined });
    de.setModel({ original: A, modified: B });
    el.querySelector('#qkDl').onchange = (e) => { m.editor.setModelLanguage(A, e.target.value); m.editor.setModelLanguage(B, e.target.value); };
    el.querySelector('#qkDj').onchange = (e) => { if (!e.target.checked) return; for (const x of [A, B]) { try { x.setValue(JSON.stringify(JSON.parse(x.getValue()), null, 2)); } catch {} } };
    // fechar a janela libera os editores
    const obs = new MutationObserver(() => { if (el.hidden) { obs.disconnect(); de.dispose(); A.dispose(); B.dispose(); } });
    obs.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });
}
// ---------- relatório de bug ----------
const SEV = ['Bloqueante', 'Crítica', 'Alta', 'Média', 'Baixa'];
const envList = () => String(P.settings.envs || '').split('\n').map(l => /^\s*([^=]+?)\s*=\s*(\S+)/.exec(l)).filter(Boolean).map(m => ({ name: m[1], url: m[2] }));
function bugText(b, md) {
  const L = (t, v) => v ? (md ? `**${t}:** ${v}` : `${t}: ${v}`) : null;
  const sec = (t, v) => v ? (md ? `\n### ${t}\n${v}` : `\n${t.toUpperCase()}\n${v}`) : '';
  const steps = b.steps.split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => /^\d+[.)]/.test(s) ? s : `${i + 1}. ${s}`).join('\n');
  return [md ? `## ${b.title}` : b.title, '', [L('Severidade', b.sev), L('Prioridade', b.prio), L('Ambiente', b.env), L('Navegador / dispositivo', b.device), L('Chamado relacionado', b.ticket), L('Cenário', b.scenario), L('Reportado por', b.by), L('Data', new Date().toLocaleString('pt-BR'))].filter(Boolean).join(md ? '  \n' : '\n'),
    sec('Pré-condição', b.pre), sec('Passos para reproduzir', steps), sec('Resultado esperado', b.expected), sec('Resultado obtido', b.actual), sec('Evidências', b.evidence)].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function kitBug(seed = {}) {
  const envs = envList();
  kit('bug', 'Relatório de bug', 'Preencha e copie (texto para o chamado ou Markdown para Jira/Azure/GitHub), ou salve em ' + esc((P.settings.bugsDir || 'qa') + '/bugs') + '.', `
    <label class="fld">Título<input id="bT" value="${esc(seed.title || '')}" placeholder="Ao salvar o cadastro com CPF válido, a tela mostra erro 500"></label>
    <div class="qa-2"><label class="fld">Severidade<select id="bS">${SEV.map(s => `<option ${s === (seed.sev || 'Média') ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="fld">Prioridade<select id="bP">${['Alta', 'Média', 'Baixa'].map(s => `<option ${s === 'Média' ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
    <div class="qa-2"><label class="fld">Ambiente<input id="bE" list="bEl" value="${esc(seed.env || (envs[1] || envs[0] || {}).name || '')}"><datalist id="bEl">${envs.map(e => `<option value="${esc(e.name)}">${esc(e.url)}</option>`).join('')}</datalist></label>
      <label class="fld">Navegador / dispositivo<input id="bD" value="${esc(seed.device || navigator.userAgent.match(/(Edg|Chrome|Firefox)\/[\d]+/)?.[0]?.replace('Edg', 'Edge') || '')}"></label></div>
    <div class="qa-2"><label class="fld">Chamado relacionado<input id="bK" value="${esc(seed.ticket || '')}" placeholder="INC1753202"></label><label class="fld">Cenário<input id="bC" value="${esc(seed.scenario || '')}" placeholder="CT002 ..."></label></div>
    <label class="fld">Pré-condição<textarea id="bPre" rows="2">${esc(seed.pre || '')}</textarea></label>
    <label class="fld">Passos para reproduzir <small class="pl-help">um por linha; a numeração entra sozinha</small><textarea id="bSt" rows="5">${esc(seed.steps || '')}</textarea></label>
    <div class="qa-2"><label class="fld">Resultado esperado<textarea id="bEx" rows="3">${esc(seed.expected || '')}</textarea></label><label class="fld">Resultado obtido<textarea id="bAc" rows="3">${esc(seed.actual || '')}</textarea></label></div>
    <label class="fld">Evidências <small class="pl-help">links, nomes dos prints, trecho de log</small><textarea id="bEv" rows="2">${esc(seed.evidence || '')}</textarea></label>
    <div class="qk-bar"><span class="spacer"></span><button class="chip" id="bCopyT">Copiar texto</button><button class="chip" id="bCopyM">Copiar Markdown</button><button class="chip primary" id="bSave">Salvar .md</button></div>`, (el) => {
    const v = (id) => el.querySelector('#' + id).value.trim();
    const get = () => { const env = v('bE'); const e = envs.find(x => x.name === env); return { title: v('bT') || 'Bug sem título', sev: v('bS'), prio: v('bP'), env: e ? `${e.name} (${e.url})` : env, device: v('bD'), ticket: v('bK'), scenario: v('bC'), pre: v('bPre'), steps: v('bSt'), expected: v('bEx'), actual: v('bAc'), evidence: v('bEv'), by: P.settings.qaName || '' }; };
    el.querySelector('#bCopyT').onclick = () => copy(bugText(get(), false), 'Bug copiado (texto)');
    el.querySelector('#bCopyM').onclick = () => copy(bugText(get(), true), 'Bug copiado (Markdown)');
    el.querySelector('#bSave').onclick = async () => {
      const b = get(); const dir = (P.settings.bugsDir || 'qa').replace(/^\/+|\/+$/g, '') + '/bugs';
      const name = `${stamp().slice(0, 10)} -${(b.ticket ? b.ticket + ' - ' : '') + b.title}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
      try { await writeText(`${dir}/${name}.md`, bugText(b, true)); el.hidden = true; toast('Bug salvo em ' + dir, 'ok'); bs.openFile(`${dir}/${name}.md`, 'editor'); } catch (e) { toast(e.message); }
    };
    el.querySelector('#bT').focus();
  });
}
// bug de um cenário (Falhou): passos, esperado e chamado já preenchidos
function bugFromScenario(rel, sc) {
  const d = docFor(rel); if (!d) return kitBug();
  const all = [...(d.background ? d.background.steps : []), ...sc.steps];
  const st = statusOf(rel, sc);
  kitBug({
    title: `${scKey(sc)} falhou: ${sc.name.replace(/^\s*[A-Za-z]{1,6}\s*-?\s*\d+\s*[-–:]?\s*/, '')}`,
    ticket: ticketsOf(rel)[0] || '', scenario: sc.name, sev: 'Média',
    pre: all.filter(s => s.type === 'given').map(s => `${s.kw} ${s.text}`).join('\n'),
    steps: all.filter(s => s.type === 'when').map(s => `${s.kw} ${s.text}`).join('\n'),
    expected: all.filter(s => s.type === 'then').map(s => `${s.kw} ${s.text}`).join('\n'),
    actual: st && st.note || '',
    evidence: evidences(rel, sc).map(p => p).join('\n'),
  });
}
function kitEnvs() {
  const envs = envList();
  kit('envs', 'Ambientes', envs.length ? 'Clique para abrir no navegador; o endereço também copia.' : 'Cadastre os ambientes nas configurações do QAutils (engrenagem na aba Plugins): um por linha, NOME=endereço.', envs.length ? `<div class="qk-grid">${envs.map(e => `<div class="qk-out"><span class="qk-l">${esc(e.name)}</span><code class="qk-v" data-copy="${esc(e.url)}">${esc(e.url)}</code><button class="chip" data-open="${esc(e.url)}">Abrir</button></div>`).join('')}</div>` : `<button class="chip primary" id="qkCfg">Abrir configurações</button>`, (el) => {
    bindCopy(el); el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => window.open(b.dataset.open, '_blank'));
    const c = el.querySelector('#qkCfg'); if (c) c.onclick = () => { el.hidden = true; plugin.settings.open(); };
  }, false);
}
const KITS = [
  { id: 'data', ico: KI.id, name: 'Dados de teste', desc: 'CPF, CNPJ, RG, CNH, cartão, CEP…', run: kitData },
  { id: 'mass', ico: KI.table, name: 'Massa de dados', desc: 'N linhas em CSV ou JSON', run: kitMass },
  { id: 'validate', ico: KI.check, name: 'Validar', desc: 'CPF, CNPJ, cartão, e-mail', run: kitValidate },
  { id: 'boundary', ico: KI.ruler, name: 'Valores limite', desc: 'mín−1, mín, máx, máx+1', run: kitBoundary },
  { id: 'special', ico: KI.bomb, name: 'Entradas especiais', desc: 'emoji, invisíveis, XSS, SQL', run: kitSpecial },
  { id: 'json', ico: KI.json, name: 'JSON', desc: 'formatar, validar, comparar', run: kitJson },
  { id: 'code', ico: KI.code, name: 'Base64 · URL · JWT', desc: 'codificar e decodificar', run: kitCode },
  { id: 'date', ico: KI.clock, name: 'Data e hora', desc: 'epoch, somar, dias úteis', run: kitDate },
  { id: 'text', ico: KI.text, name: 'Texto', desc: 'N caracteres, contar, acentos', run: kitText },
  { id: 'hash', ico: KI.hash, name: 'Hash e UUID', desc: 'SHA-1/256/512', run: kitHash },
  { id: 'regex', ico: KI.regex, name: 'Regex', desc: 'testar uma validação', run: kitRegex },
  { id: 'diff', ico: KI.diff, name: 'Comparar', desc: 'esperado × obtido', run: () => kitDiff() },
  { id: 'bug', ico: KI.bug, name: 'Relatório de bug', desc: 'texto, Markdown ou .md', run: () => kitBug() },
  { id: 'envs', ico: KI.globe, name: 'Ambientes', desc: 'PRD, HML, DSV', run: kitEnvs },
];
function renderKit(sub, el) {
  $('#toolSub').textContent = 'ferramentas';
  sub.innerHTML = '';
  // geração rápida: um clique copia (sem abrir janela)
  const quick = [['CPF', () => G.cpf(store.get('qkFmt', true))], ['CNPJ', () => G.cnpj(store.get('qkFmt', true))], ['Nome', G.nome], ['E-mail', () => G.email()], ['Celular', () => G.telefone(true)], ['UUID', G.uuid]];
  el.innerHTML = `<div class="qk-quick">${quick.map(([l], i) => `<button class="chip" data-q="${i}" title="Gera e copia">${esc(l)}</button>`).join('')}</div>
    <div class="qk-tools">${KITS.map(k => `<button class="qk-tool" data-k="${k.id}">${k.ico}<span><b>${esc(k.name)}</b><small>${esc(k.desc)}</small></span></button>`).join('')}</div>`;
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => copy(quick[+b.dataset.q][1](), quick[+b.dataset.q][0]));
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => KITS.find(k => k.id === b.dataset.k).run());
}

// ====================================================================================================================
// Checklists de teste (por projeto, na pasta de dados do plugin)
// ====================================================================================================================
const CHK_TPL = {
  'Smoke test': ['A aplicação abre sem erro', 'Login com usuário válido', 'Menu principal e navegação', 'Tela principal carrega os dados', 'Cadastro principal salva', 'Busca devolve resultado', 'Logout'],
  'Formulário': ['Campos obrigatórios marcados e validados', 'Mensagens de erro claras e no campo certo', 'Máscaras (CPF, CNPJ, telefone, CEP, data, moeda)', 'Tamanho máximo de cada campo (valores limite)', 'Caracteres especiais, acentos e emoji', 'Colar texto (Ctrl+V) nos campos', 'Tab segue a ordem lógica', 'Enter envia (ou não) como esperado', 'Duplo clique em Salvar não duplica o registro', 'Dados mantidos depois de um erro', 'Cancelar/voltar não salva'],
  'Login e sessão': ['Usuário e senha válidos', 'Senha errada mostra mensagem genérica', 'Usuário bloqueado / inativo', 'Campos vazios', 'Esqueci a senha', 'Sessão expira e pede login de novo', 'Logout invalida a sessão (voltar no navegador)', 'Login em duas abas ou dispositivos', 'Perfis veem só o que podem (permissões)'],
  'Regressão': ['Fluxo principal de ponta a ponta', 'Funcionalidades vizinhas da alteração', 'Integrações (APIs, filas, e-mails)', 'Relatórios e exportações', 'Permissões por perfil', 'Dados antigos continuam abrindo', 'Desempenho percebido não piorou', 'Logs sem erros novos'],
  'Acessibilidade básica': ['Navegação só com o teclado', 'Foco visível em todos os elementos', 'Imagens com texto alternativo', 'Contraste de cores suficiente', 'Rótulos nos campos de formulário', 'Zoom de 200% sem quebrar a tela', 'Leitor de tela anuncia botões e erros'],
  'Responsividade': ['Celular (360px)', 'Tablet (768px)', 'Notebook (1366px)', 'Monitor grande (1920px)', 'Retrato e paisagem', 'Menus e tabelas no celular', 'Chrome, Edge e Firefox'],
  'API': ['Status HTTP corretos (200, 201, 400, 401, 403, 404, 500)', 'Contrato: campos, tipos e obrigatórios', 'Sem token / token expirado', 'Payload inválido e campos extras', 'Paginação e filtros', 'Idempotência (repetir a chamada)', 'Tempo de resposta', 'Mensagens de erro sem dados sensíveis'],
};
const CHK = { list: null, for: null, open: store.get('qaChkOpen', null) };
async function chkLoad() { if (CHK.for !== proj()) { CHK.for = proj(); try { CHK.list = (await plugin.data.get('chk:' + proj())) || []; } catch { CHK.list = []; } } return CHK.list; }
const chkSave = () => plugin.data.set('chk:' + proj(), CHK.list).catch(e => toast(e.message));
function chkMd(c) { return `# ${c.title}\n\n${c.items.map(i => `- [${i.done ? 'x' : ' '}] ${i.t}${i.note ? ` — ${i.note}` : ''}`).join('\n')}\n\n${c.items.filter(i => i.done).length}/${c.items.length} · ${new Date().toLocaleString('pt-BR')}${P.settings.qaName ? ' · ' + P.settings.qaName : ''}\n`; }
async function renderChecklists(sub, el) {
  await chkLoad();
  $('#toolSub').textContent = `${CHK.list.length} checklist(s)`;
  $('#toolActions').innerHTML = `<button class="icon-btn" id="ckNew" title="Nova checklist">${ICO.plus}</button>`;
  $('#ckNew').onclick = (e) => bs.showMenu(e, [...Object.keys(CHK_TPL).map(k => ({ label: k, icon: KI.list, action: () => chkNew(k, CHK_TPL[k]) })), '-', { label: 'Em branco…', icon: ICO.plus, action: () => chkNew('', []) }], 'Nova checklist');
  sub.innerHTML = '';
  const c = CHK.list.find(x => x.id === CHK.open);
  if (!c) {
    el.innerHTML = CHK.list.length ? CHK.list.map(c => { const d = c.items.filter(i => i.done).length; return `<div class="qa-feat" data-ck="${c.id}"><div class="qa-ft"><span class="qa-fn">${esc(c.title)}</span></div><span class="qa-n">${d}/${c.items.length}</span>${bar({ pass: d, fail: 0, blocked: 0, none: c.items.length - d }, c.items.length)}</div>`; }).join('')
      : `<div class="empty">Nenhuma checklist ainda.<br><br>${Object.keys(CHK_TPL).map(k => `<button class="chip" data-tpl="${esc(k)}">${esc(k)}</button>`).join(' ')}</div>`;
    el.querySelectorAll('[data-ck]').forEach(r => { r.onclick = () => { CHK.open = r.dataset.ck; store.set('qaChkOpen', CHK.open); render(); }; r.oncontextmenu = (e) => bs.showMenu(e, [{ label: 'Apagar', icon: bs.I.x, action: async () => { CHK.list = CHK.list.filter(x => x.id !== r.dataset.ck); await chkSave(); render(); } }], ''); });
    el.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => chkNew(b.dataset.tpl, CHK_TPL[b.dataset.tpl]));
    return;
  }
  const d = c.items.filter(i => i.done).length;
  el.innerHTML = `<div class="ck-hd"><button class="icon-btn" id="ckBack" title="Voltar">${ICO.chev}</button><input class="ck-title" value="${esc(c.title)}"><span class="qa-n">${d}/${c.items.length}</span></div>
    ${bar({ pass: d, fail: 0, blocked: 0, none: c.items.length - d }, c.items.length).replace('qa-bar', 'qa-bar ck-bar')}
    <div class="ck-items">${c.items.map((it, i) => `<div class="ck-it ${it.done ? 'done' : ''}" data-i="${i}"><input type="checkbox" ${it.done ? 'checked' : ''}><div><div class="ck-t">${esc(it.t)}</div>${it.note ? `<div class="ck-note">${esc(it.note)}</div>` : ''}</div><button class="icon-btn" data-more title="Mais">${bs.TI.more}</button></div>`).join('')}</div>
    <input class="qa-q ck-add" placeholder="+ item (Enter)">
    <div class="qa-acts"><button class="chip" id="ckCopy">Copiar (Markdown)</button><button class="chip" id="ckSave">Salvar .md</button><button class="chip" id="ckReset">Desmarcar tudo</button></div>`;
  el.querySelector('#ckBack').onclick = () => { CHK.open = null; store.set('qaChkOpen', null); render(); };
  el.querySelector('.ck-title').onchange = (e) => { c.title = e.target.value.trim() || c.title; chkSave(); };
  el.querySelectorAll('.ck-it').forEach(r => {
    const it = c.items[+r.dataset.i];
    r.querySelector('input').onchange = (e) => { it.done = e.target.checked; chkSave(); render(); };
    r.querySelector('[data-more]').onclick = (e) => bs.showMenu(e, [
      { label: 'Observação…', icon: bs.I.edit, action: () => dialog('ckNote', `<div class="dlg-hd"><span class="dlg-ic">${KI.list}</span><div><h3>Observação</h3><p>${esc(it.t)}</p></div></div>
          <label class="fld">Observação<textarea id="ckNoteIn" rows="3">${esc(it.note || '')}</textarea></label>
          <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="ckNoteOk">Salvar</button></div>`, (d) => {
          d.querySelector('#ckNoteIn').focus();
          d.querySelector('#ckNoteOk').onclick = () => { it.note = d.querySelector('#ckNoteIn').value.trim(); d.hidden = true; chkSave(); render(); };
        }) },
      { label: 'Apagar item', icon: bs.I.x, action: () => { c.items.splice(+r.dataset.i, 1); chkSave(); render(); } },
    ], it.t);
  });
  const add = el.querySelector('.ck-add');
  add.onkeydown = (e) => { if (e.key === 'Enter' && add.value.trim()) { c.items.push({ t: add.value.trim(), done: false }); chkSave(); render(); setTimeout(() => $('.ck-add')?.focus(), 30); } };
  el.querySelector('#ckCopy').onclick = () => copy(chkMd(c), 'Checklist copiada');
  el.querySelector('#ckSave').onclick = async () => { const rel = `${(P.settings.bugsDir || 'qa').replace(/^\/+|\/+$/g, '')}/checklists/${c.title.replace(/[\\/:*?"<>|]+/g, '-')} - ${stamp().slice(0, 10)}.md`; try { await writeText(rel, chkMd(c)); toast('Salvo em ' + rel, 'ok'); bs.openFile(rel, 'editor'); } catch (e) { toast(e.message); } };
  el.querySelector('#ckReset').onclick = () => { c.items.forEach(i => { i.done = false; }); chkSave(); render(); };
}
async function chkNew(title, items) {
  await chkLoad();
  const c = { id: Date.now().toString(36), title: title || 'Checklist', created: Date.now(), items: items.map(t => ({ t, done: false })) };
  CHK.list.unshift(c); await chkSave(); CHK.open = c.id; store.set('qaChkOpen', c.id); V.top = 'chk'; store.set('qaTop', 'chk'); bs.openTool('qa'); render();
}

// ====================================================================================================================
// Sessão de teste exploratório: missão, cronômetro e anotações com horário (Bug, Dúvida, Ideia, Nota)
// ====================================================================================================================
const SES = { cur: null, timer: null, st: null };
const NOTE_KINDS = [['bug', 'Bug', '🐞'], ['q', 'Dúvida', '❓'], ['idea', 'Ideia', '💡'], ['note', 'Nota', '📝']];
async function sesLoad() { try { SES.cur = (await plugin.data.get('ses')) || null; } catch { SES.cur = null; } sesTick(); }
const sesSave = () => plugin.data.set('ses', SES.cur).catch(() => {});
const elapsed = (s) => s ? (s.end || (s.paused ? s.pausedAt : Date.now())) - s.start - (s.pauseTotal || 0) : 0;
const hms = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 3600) ? Math.floor(t / 3600) + ':' : ''}${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`; };
function sesTick() {
  if (!SES.st) SES.st = bs.status.add({ id: 'stQaSes', title: 'Sessão de teste exploratório (QAutils)', onclick: () => { V.top = 'ses'; store.set('qaTop', 'ses'); bs.openTool('qa'); render(); } });
  const on = SES.cur && !SES.cur.end;
  SES.st.hidden = !on;
  clearInterval(SES.timer);
  if (!on) return;
  const upd = () => { SES.st.innerHTML = `<i class="qa-rec ${SES.cur.paused ? 'paused' : ''}"></i> ${hms(elapsed(SES.cur))}`; const c = $('#sesClock'); if (c) c.textContent = hms(elapsed(SES.cur)); };
  upd(); SES.timer = setInterval(upd, 1000);
}
function sesMd(s) {
  const dur = hms(elapsed(s));
  const by = (k) => s.notes.filter(n => n.k === k);
  const t = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `# Sessão exploratória: ${s.charter}\n\n**Área:** ${s.area || '-'}  \n**Início:** ${new Date(s.start).toLocaleString('pt-BR')}  \n**Duração:** ${dur}${s.plan ? ` de ${s.plan} min planejados` : ''}  \n**QA:** ${P.settings.qaName || '-'}  \n${s.env ? `**Ambiente:** ${s.env}  \n` : ''}
**Resumo:** ${by('bug').length} bug(s) · ${by('q').length} dúvida(s) · ${by('idea').length} ideia(s) · ${by('note').length} nota(s)
${NOTE_KINDS.map(([k, l, e]) => by(k).length ? `\n## ${e} ${l}s\n${by(k).map(n => `- **${t(n.at)}** ${n.text}`).join('\n')}` : '').join('\n')}

## Linha do tempo
${s.notes.map(n => `- ${t(n.at)} ${NOTE_KINDS.find(x => x[0] === n.k)[2]} ${n.text}`).join('\n') || '- (sem anotações)'}
`;
}
async function renderSession(sub, el) {
  if (SES.cur === null && !SES.loaded) { SES.loaded = true; await sesLoad(); }
  sub.innerHTML = '';
  const s = SES.cur;
  if (!s || s.end) {
    $('#toolSub').textContent = 'teste exploratório';
    const envs = envList();
    el.innerHTML = `<div class="ses-new"><p class="qa-hint">Uma sessão com missão e tempo definidos: você explora, anota o que achar e no fim sai um relatório com tudo e os horários.</p>
      <label class="fld">Missão (o que explorar e com qual objetivo)<textarea id="sCh" rows="3" placeholder="Explorar o cadastro de corretor com CPFs e CNPJs inválidos para achar falhas de validação"></textarea></label>
      <label class="fld">Área / funcionalidade<input id="sAr" placeholder="Portal de negócios › Campanhas"></label>
      <div class="qa-2"><label class="fld">Tempo planejado<select id="sPl">${[30, 45, 60, 90, 120].map(m => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
        <label class="fld">Ambiente<input id="sEn" list="sEnL"><datalist id="sEnL">${envs.map(e => `<option value="${esc(e.name)}">`).join('')}</datalist></label></div>
      <button class="chip primary" id="sGo">${ICO.play} Começar sessão</button>
      ${s && s.end ? `<div class="ses-last"><b>Última sessão:</b> ${esc(s.charter)} · ${hms(elapsed(s))} · ${s.notes.length} anotações <button class="chip" id="sLastCopy">Copiar relatório</button></div>` : ''}</div>`;
    el.querySelector('#sGo').onclick = async () => {
      const ch = el.querySelector('#sCh').value.trim(); if (!ch) return toast('Escreva a missão da sessão');
      SES.cur = { charter: ch, area: el.querySelector('#sAr').value.trim(), plan: +el.querySelector('#sPl').value, env: el.querySelector('#sEn').value.trim(), start: Date.now(), notes: [], pauseTotal: 0 };
      await sesSave(); sesTick(); render();
    };
    const lc = el.querySelector('#sLastCopy'); if (lc) lc.onclick = () => copy(sesMd(s), 'Relatório da sessão copiado');
    return;
  }
  $('#toolSub').textContent = s.paused ? 'pausada' : 'gravando';
  const over = s.plan && elapsed(s) > s.plan * 60000;
  el.innerHTML = `<div class="ses-run"><div class="ses-clock ${over ? 'over' : ''}"><i class="qa-rec ${s.paused ? 'paused' : ''}"></i><span id="sesClock">${hms(elapsed(s))}</span><small>de ${s.plan} min</small></div>
    <div class="ses-ch">${esc(s.charter)}${s.area ? `<small>${esc(s.area)}</small>` : ''}</div>
    <div class="ses-kinds">${NOTE_KINDS.map(([k, l, e], i) => `<button class="chip ${i === 0 ? '' : ''}" data-k="${k}" title="Anotar como ${l}">${e} ${l}</button>`).join('')}</div>
    <textarea id="sNote" rows="3" placeholder="O que você viu? Ctrl+Enter anota como Nota; escolha o tipo acima"></textarea>
    <div class="ses-notes">${[...s.notes].reverse().map((n, i) => `<div class="ses-n ${n.k}"><span>${new Date(n.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span><b>${NOTE_KINDS.find(x => x[0] === n.k)[2]}</b><div>${esc(n.text)}</div>${n.k === 'bug' ? `<button class="icon-btn" data-bug="${s.notes.length - 1 - i}" title="Abrir relatório de bug">${KI.bug}</button>` : ''}</div>`).join('') || '<div class="qa-hint">As anotações aparecem aqui, com o horário.</div>'}</div>
    <div class="qa-acts"><button class="chip" id="sPause">${s.paused ? 'Continuar' : 'Pausar'}</button><button class="chip" id="sCopy">Copiar relatório</button><button class="chip primary" id="sEnd">Encerrar e salvar</button></div></div>`;
  const ta = el.querySelector('#sNote');
  const addNote = async (k) => { const t = ta.value.trim(); if (!t) return ta.focus(); s.notes.push({ k, text: t, at: Date.now() }); await sesSave(); render(); setTimeout(() => $('#sNote')?.focus(), 30); };
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => addNote(b.dataset.k));
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote('note'); } };
  el.querySelectorAll('[data-bug]').forEach(b => b.onclick = () => { const n = s.notes[+b.dataset.bug]; kitBug({ title: n.text.split('\n')[0].slice(0, 120), actual: n.text, env: s.env, evidence: `Sessão exploratória "${s.charter}" às ${new Date(n.at).toLocaleTimeString('pt-BR')}` }); });
  el.querySelector('#sPause').onclick = async () => { if (s.paused) { s.pauseTotal += Date.now() - s.pausedAt; s.paused = false; } else { s.paused = true; s.pausedAt = Date.now(); } await sesSave(); sesTick(); render(); };
  el.querySelector('#sCopy').onclick = () => copy(sesMd(s), 'Relatório da sessão copiado');
  el.querySelector('#sEnd').onclick = async () => {
    if (s.paused) { s.pauseTotal += Date.now() - s.pausedAt; s.paused = false; }
    s.end = Date.now();
    const rel = `${(P.settings.bugsDir || 'qa').replace(/^\/+|\/+$/g, '')}/sessoes/${stamp(new Date(s.start))} -${s.charter.slice(0, 60).replace(/[\\/:*?"<>|\n]+/g, '-')}.md`;
    try { await writeText(rel, sesMd(s)); toast('Sessão salva em ' + rel, 'ok'); bs.openFile(rel, 'editor'); } catch (e) { toast(e.message); }
    await sesSave(); sesTick(); render();
  };
  ta.focus();
}
setTimeout(() => sesLoad(), 1500);

// ---------- registro ----------
bs.tools.register({ id: 'qa', title: 'QAutils', icon: ICO.qa, key: 'Alt+9', order: 75, render });
// cada ferramenta do kit também no Buscar em tudo ("QA: CPF", "QA: JSON"...)
bs.actions.add(KITS.map(k => ({ label: 'QA: ' + k.name, icon: k.ico, run: k.run })));
bs.actions.add([
  { label: 'QA: Nova checklist de teste', icon: KI.list, run: () => { V.top = 'chk'; store.set('qaTop', 'chk'); bs.openTool('qa'); render(); } },
  { label: 'QA: Sessão de teste exploratório', icon: KI.timer, run: () => { V.top = 'ses'; store.set('qaTop', 'ses'); bs.openTool('qa'); render(); } },
  { label: 'QA: Nova feature (chamado)', icon: ICO.feat, run: () => newFeature() },
  { label: 'QA: Painel de features e execução', icon: ICO.qa, run: () => bs.openTool('qa') },
  { label: 'QA: Relatório de evidências do projeto', icon: ICO.doc, run: () => makeReport('', true) },
  { label: 'QA: Exportar casos de teste do projeto (CSV)', icon: ICO.csv, run: () => exportCsv('', true) },
  { label: 'QA: Formatar feature e alinhar tabelas', icon: ICO.feat, k: 'Shift+Alt+F', run: () => bs.editor && bs.editor.trigger('qa', 'editor.action.formatDocument') },
]);
// árvore: pasta -> nova feature, relatório, CSV; arquivo .feature -> relatório, CSV, copiar
bs.hooks.filter('menu:file', (items, ctx) => {
  if (!ctx || !ctx.rel) return items;
  if (ctx.isDir) return [...items, '-', { label: 'Nova feature aqui…', icon: ICO.feat, action: () => newFeature(ctx.rel) }, { label: 'Relatório de evidências da pasta', icon: ICO.doc, action: () => makeReport(ctx.rel, true) }, { label: 'Exportar casos de teste (CSV)', icon: ICO.csv, action: () => exportCsv(ctx.rel, true) }];
  if (/\.feature$/i.test(ctx.rel)) return [...items, '-', { label: 'Relatório de evidências', icon: ICO.doc, action: () => makeReport(ctx.rel, false) }, { label: 'Exportar casos de teste (CSV)', icon: ICO.csv, action: () => exportCsv(ctx.rel, false) }];
  return items;
});
// resumo do projeto: andamento dos cenários
bs.dashboard.card({
  id: 'qa', order: 45,
  html() {
    if (!S.project || P.for !== proj() || !P.files.size) return '';
    const t = { pass: 0, fail: 0, blocked: 0, none: 0 }; let n = 0;
    for (const [rel, f] of P.files) { const c = counts(rel, f.doc); for (const k in c) t[k] += c[k]; n += f.doc.scenarios.length; }
    return `<div class="qa-card"><h4>${ICO.qa} QAutils</h4><p>${P.files.size} features · ${n} cenários</p>${bar(t, n)}<p class="qa-mut">✓ ${t.pass} · ✗ ${t.fail} · ⊘ ${t.blocked} · ○ ${t.none}</p><button class="chip" data-qa-open>Abrir painel QA</button></div>`;
  },
  bind(el) { const b = el.querySelector('[data-qa-open]'); if (b) b.onclick = () => bs.openTool('qa'); },
});
// para outros plugins: ler features, reindexar e consultar o estado (features, passos, definições, status)
bs.qautils = { parse, index: () => index(true), state: () => P, defsFor, automation, generate: G, validate: VAL, bug: kitBug };
function refreshAll() { S.tabs.forEach(t => isFeature(t) && diagnose(t.model)); fireLens(); if (S.tool === 'qa') bs.renderTool(); }
bs.hooks.on('editor:ready', setup); if (bs.monaco) setup();
bs.hooks.on('tab:open', (t) => { if (ready) watch(t); });
bs.hooks.on('tab:activate', (t) => { if (ready) watch(t); });
bs.hooks.on('project:select', () => { P.at = 0; P.for = null; if (S.project) setTimeout(() => index(), 800); });
bs.hooks.on('tab:save', (t) => {
  if (!t || !S.project) return;
  if (/\.feature$/i.test(t.path)) { P.files.set(t.path, { mtime: -1, doc: parse(t.model.getValue()) }); catalog(); P.at = Date.now(); if (S.tool === 'qa') bs.renderTool(); fireLens(); }
  else if (DEF_EXT.test(t.path)) setTimeout(() => index(true), 300);
});
// arquivos mudados por fora (git pull, outro editor): features e step definitions entram no índice
let ext = null;
bs.hooks.on('files:changed', (list) => {
  const rels = (Array.isArray(list) ? list : []).map(x => String(x && (x.path || x.rel || x) || '').replace(/\\/g, '/'));
  if (rels.length && !rels.some(r => /\.feature$/i.test(r) || DEF_EXT.test(r))) return;
  clearTimeout(ext); ext = setTimeout(() => index(true), 800);
});
bs.hooks.on('file:rename', () => setTimeout(() => index(true), 300));
bs.hooks.on('file:delete', () => setTimeout(() => index(true), 300));
if (S.project) setTimeout(() => index(), 1200);
