'use strict';
const $ = (s) => document.querySelector(s);
// pedidos ao servidor; a barra fina no topo aparece quando algum demora
let busyN = 0;
const busy = (d) => { busyN = Math.max(0, busyN + d); document.getElementById('busy').classList.toggle('on', busyN > 0); };
const api = async (p, params = {}, opt = {}) => {
  const u = new URL('/api/' + p, location.origin);
  Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
  busy(1);
  try {
    const r = await fetch(u, opt);
    if (r.status === 401) { showLogin(); throw new Error('login'); }
    const j = await r.json();
    if (j && j.error) throw new Error(j.error);
    return j;
  } finally { busy(-1); }
};
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// avisos empilhados; kind: 'ok' | 'err' (sem kind: neutro). Erros ficam mais tempo na tela.
// key: avisos com a mesma chave (ex.: 'font') se atualizam no lugar em vez de empilhar
const toast = (m, kind, key) => {
  const box = $('#toasts'); if (!box) return;
  if (!kind && /^(Erro|Falh|Lint falhou|Não )/i.test(String(m))) kind = 'err';
  const same = key ? [...box.children].find(x => x.dataset.key === key) : [...box.children].find(x => x.textContent === String(m));
  if (same) { same.textContent = m; same.className = 'toast' + (kind ? ' ' + kind : ''); clearTimeout(same._t); same._t = setTimeout(() => { same.classList.add('out'); setTimeout(() => same.remove(), 220); }, 1600); return; }
  const t = document.createElement('div'); t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = m; if (key) t.dataset.key = key;
  box.prepend(t); while (box.children.length > 4) box.lastElementChild.remove();
  t._t = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, kind === 'err' ? 4500 : 2000);
};
// erro inesperado de script: aparece na tela em vez de sumir no console
window.addEventListener('error', (e) => { try { toast('Erro na interface: ' + (e.message || e.error), 'err'); } catch {} });
window.addEventListener('unhandledrejection', (e) => { const m = e.reason && e.reason.message; if (m && m !== 'login' && m !== 'Canceled') try { toast('Erro na interface: ' + m, 'err'); } catch {} });
const DOC = new URLSearchParams(location.search).get('doc'); // janela de documento (docMode)
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('bs.' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('bs.' + k, JSON.stringify(v)); } catch {} } };

const S = {
  root: store.get('root', null), projects: [], outside: new Map(), project: null, summary: null,
  tool: 'project', changeMode: store.get('changeMode', 'working'), rev: null, changes: [], log: [],
  tabs: [], active: null, inline: store.get('inline', false), wrap: store.get('wrap', false),
  net: null, tree: {}, lintTool: '', sortRecent: store.get('sortRecent', true),
  compact: store.get('compact', true), singleClick: store.get('singleClick', false), showProjects: false, treeOpen: null, treeSel: null, walk: {}, workFiles: [], lastFiles: [],
};
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString('pt-BR') : '';
const daysAgo = (ms) => Math.round((Date.now() - ms) / 86400000);
function ago(ms) { if (!ms) return ''; const s = (Date.now() - ms) / 1000; if (s < 60) return 'agora'; if (s < 3600) return Math.round(s / 60) + ' min'; if (s < 86400) return Math.round(s / 3600) + ' h'; if (s < 86400 * 30) return Math.round(s / 86400) + ' d'; return new Date(ms).toLocaleDateString('pt-BR'); }
function sorted(items, dirsFirst) { const a = items.slice(); return a.sort((x, y) => (dirsFirst ? ((y.dir ? 1 : 0) - (x.dir ? 1 : 0)) : 0) || (S.sortRecent ? (y.mtime || 0) - (x.mtime || 0) : x.name.localeCompare(y.name, 'pt-BR'))); }
let monaco, editor, diffEditor, viewer = null; // viewer: 'editor' | 'diff'
const chgOf = (p) => S.changes.find(c => c.path === p);
const codeCls = (p) => { const c = chgOf(p); return c ? ' c-' + c.code.replace('?', '\\?') : ''; };
const statHtml = (c) => (c && (c.add || c.del)) ? `<span class="stat">${c.add ? `<span class="a">+${c.add}</span>` : ''}${c.del ? `<span class="d">−${c.del}</span>` : ''}</span>` : '';
const unsavedPaths = () => new Set(S.tabs.filter(t => t.dirty).map(t => t.path));
function syncUnsaved() {
  const u = unsavedPaths();
  document.querySelectorAll('#toolBody .row.chg[data-p]').forEach(r => r.classList.toggle('unsaved', u.has(r.dataset.p)));
  document.querySelectorAll('#treeRoot .trow[data-p]').forEach(r => r.classList.toggle('unsaved', u.has(r.dataset.p)));
  const any = S.tabs.some(t => t.dirty); const act = S.active && S.active.dirty;
  $('#stDirty').hidden = !act; $('#stDirty').className = 's dirty';
  document.title = (any ? '● ' : '') + (DOC ? DOC.split(/[\\/]/).pop() + ' - BlueScreen' : 'BlueScreen' + (S.project ? ' · ' + S.project.name : ''));
}

// cores dos tokens semânticos (vindos do servidor de linguagem, com prefixo "s-"; ver lsp.js). O que não tem regra aqui
// fica com a cor da sintaxe. c: { fn, type, field, konst, macro, lifetime, kw }
function semRules(c) {
  const r = (token, fg, style) => fg ? { token, foreground: String(fg).replace('#', ''), ...(style ? { fontStyle: style } : {}) } : null;
  return [
    r('s-function', c.fn), r('s-method', c.fn), r('s-macro', c.macro), r('s-decorator', c.macro), r('s-attribute', c.macro),
    r('s-type', c.type), r('s-class', c.type), r('s-struct', c.type), r('s-enum', c.type), r('s-interface', c.type), r('s-typeAlias', c.type), r('s-builtinType', c.kw), r('s-typeParameter', c.type, 'italic'),
    r('s-property', c.field), r('s-enumMember', c.konst, 'italic'), r('s-variable.static', c.konst, 'italic'), r('s-variable.constant', c.konst, 'italic'), r('s-const', c.konst, 'italic'), r('s-static', c.konst, 'italic'),
    r('s-lifetime', c.lifetime, 'italic'), r('s-selfKeyword', c.kw), r('s-selfTypeKeyword', c.kw), r('s-keyword', c.kw),
    // o Monaco pinta token semântico sem regra com a cor da regra raiz (código comum), por cima da sintaxe: comentário,
    // texto, número e pontuação que o servidor manda (o rust-analyzer manda até os /// e //!) precisam de regra própria
    r('s-comment', c.comment, 'italic'), r('s-string', c.str), r('s-character', c.str), r('s-regexp', c.str),
    r('s-escapeSequence', c.num), r('s-formatSpecifier', c.num), r('s-invalidEscapeSequence', c.num), r('s-number', c.num), r('s-boolean', c.kw),
    ...['operator', 'punctuation', 'arithmetic', 'bitwise', 'comparison', 'logical', 'angle', 'brace', 'bracket', 'parenthesis', 'colon', 'comma', 'dot', 'semicolon', 'attributeBracket', 'macroBang'].map(t => r('s-' + t, c.delim)),
    r('s-builtinAttribute', c.macro), r('s-derive', c.macro), r('s-deriveHelper', c.macro), r('s-procMacro', c.macro), r('s-label', c.lifetime, 'italic'),
    // variável mutável sublinhada (como o rust-analyzer e o IntelliJ)
    { token: 's-variable.mutable', fontStyle: 'underline' }, { token: 's-parameter.mutable', fontStyle: 'underline' },
  ].filter(Boolean);
}
// ===== Monaco =====
// Monaco vem junto do aplicativo (sem CDN): abre offline e mais rápido
const VS = location.origin + '/vendor/monaco/vs';
window.MonacoEnvironment = { getWorkerUrl: () => VS + '/base/worker/workerMain.js' };
require.config({ paths: { vs: VS } });
require(['vs/editor/editor.main'], () => {
  monaco = window.monaco;
  monaco.editor.defineTheme('bs-dark', { base: 'vs-dark', inherit: true, rules: [
    { token: '', foreground: 'BCBEC4' }, { token: 'comment', foreground: '7A7E85', fontStyle: 'italic' }, { token: 'keyword', foreground: 'CF8E6D' },
    { token: 'string', foreground: '6AAB73' }, { token: 'number', foreground: '2AACB8' }, { token: 'type', foreground: 'BCBEC4' }, { token: 'type.identifier', foreground: 'C77DBB' },
    { token: 'identifier', foreground: 'BCBEC4' }, { token: 'delimiter', foreground: 'BCBEC4' }, { token: 'tag', foreground: 'D5B778' }, { token: 'attribute.name', foreground: 'BCBEC4' }, { token: 'attribute.value', foreground: '6AAB73' },
    { token: 'annotation', foreground: 'B3AE60' }, { token: 'metatag', foreground: 'B3AE60' }, { token: 'variable', foreground: 'C77DBB' },
    ...semRules({ fn: '#56A8F5', type: '#C77DBB', field: '#C77DBB', konst: '#C77DBB', macro: '#B3AE60', lifetime: '#20999D', kw: '#CF8E6D', comment: '#7A7E85', str: '#6AAB73', num: '#2AACB8', delim: '#BCBEC4' }),
  ], colors: {
    'editor.background': '#191B21', 'editor.foreground': '#BCBEC4', 'editorLineNumber.foreground': '#4B5059', 'editorLineNumber.activeForeground': '#A1A3AB',
    'editor.lineHighlightBackground': '#20232B', 'editor.selectionBackground': '#24467F', 'editorCursor.foreground': '#CED0D6', 'editorGutter.background': '#191B21',
    'editorIndentGuide.background1': '#313438', 'editorIndentGuide.activeBackground1': '#4B5059', 'diffEditor.insertedTextBackground': '#294436', 'diffEditor.removedTextBackground': '#4a2b2b',
    'diffEditor.insertedLineBackground': '#2a3b2d80', 'diffEditor.removedLineBackground': '#3f2a2a80', 'editorWidget.background': '#23262F', 'editorWidget.border': '#343A47', 'editorSuggestWidget.background': '#23262F', 'editorHoverWidget.background': '#23262F', 'editorHoverWidget.border': '#343A47', 'scrollbarSlider.background': '#343A4799', 'scrollbarSlider.hoverBackground': '#4A5263aa',
    'minimap.background': '#191B21', 'editorOverviewRuler.background': '#191B21', 'editorOverviewRuler.border': '#191B21', 'diffEditor.border': '#2A2F3A',
  }});
  monaco.editor.defineTheme('bs-light', { base: 'vs', inherit: true, rules: [
    { token: 'comment', foreground: '8C8C8C', fontStyle: 'italic' }, { token: 'keyword', foreground: '0033B3' }, { token: 'string', foreground: '067D17' }, { token: 'number', foreground: '1750EB' },
    { token: 'type.identifier', foreground: '871094' }, { token: 'tag', foreground: '0033B3' }, { token: 'attribute.value', foreground: '067D17' },
    ...semRules({ fn: '#00627A', type: '#000000', field: '#871094', konst: '#871094', macro: '#9E880D', lifetime: '#20999D', kw: '#0033B3' }),
  ], colors: { 'editor.background': '#FFFFFF', 'editor.lineHighlightBackground': '#F5F8FE', 'editor.selectionBackground': '#A6D2FF', 'editorLineNumber.foreground': '#AEB3C2', 'editorGutter.background': '#FFFFFF', 'diffEditor.insertedTextBackground': '#BEE6BE80', 'diffEditor.removedTextBackground': '#FFD5CC80' } });
  try { const ts = monaco.languages.typescript; const co = { allowJs: true, checkJs: false, allowNonTsExtensions: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs, experimentalDecorators: true, noEmit: true, jsx: ts.JsxEmit.Preserve }; ts.typescriptDefaults.setCompilerOptions(co); ts.javascriptDefaults.setCompilerOptions(co); ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false }); } catch {}
  registerJsp();
  registerGherkin();
  applyTheme();
  boot();
});
// JSP: a gramática de HTML do próprio Monaco com o Java dos scriptlets (<% %>, <%= %>, <%! %>) colorido como Java,
// diretivas <%@ %>, comentários <%-- --%> e EL ${ } / #{ }. Completar tags e atributos: html.js.
function registerJsp() {
  const L = monaco.languages;
  L.register({ id: 'jsp', extensions: ['.jsp', '.jspf', '.tag'], aliases: ['JSP'] });
  const html = new Promise((ok, no) => require(['vs/basic-languages/html/html'], ok, no));
  html.then(m => L.setLanguageConfiguration('jsp', m.conf)).catch(() => {});
  L.setMonarchTokensProvider('jsp', html.then(({ language: h }) => {
    const code = { token: 'tag', next: '@jspCode', nextEmbedded: 'java' };
    // o texto solto do HTML ([^<]+) engoliria ${ e %>: para antes deles
    const root = h.tokenizer.root.map(r => String(r[0]) === '/[^<]+/' ? [/[^<$#%]+/] : r);
    return { ...h, tokenizer: { ...h.tokenizer,
      root: [
        [/<%--/, 'comment', '@jspComment'],
        [/(<%@)(\s*)([\w:-]+)/, ['tag', '', { token: 'keyword', next: '@jspDirective' }]],
        [/<%[!=]?/, code],
        [/%>/, 'tag'],
        [/[$#]\{/, 'keyword', '@el'],
        ...root, [/[$#%]/, ''],
      ],
      otherTag: [[/<%=?/, code], [/[$#]\{/, 'keyword', '@el'], ...h.tokenizer.otherTag],
      jspComment: [[/--%>/, 'comment', '@pop'], [/[^-]+/, 'comment'], [/./, 'comment']],
      jspDirective: [[/%>/, 'tag', '@pop'], [/[\w.-]+(?=\s*=)/, 'attribute.name'], [/=/, 'delimiter'], [/"[^"]*"|'[^']*'/, 'attribute.value'], [/\s+/, ''], [/./, '']],
      jspCode: [[/%>/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }]],
      el: [[/\}/, 'keyword', '@pop'], [/"[^"]*"|'[^']*'/, 'string'], [/\b(?:empty|not|and|or|eq|ne|lt|gt|le|ge|div|mod|instanceof|true|false|null)\b/, 'keyword'], [/\d+(?:\.\d+)?/, 'number'], [/[A-Za-z_]\w*/, 'identifier'], [/[^}]/, 'delimiter']],
    } };
  }));
}
// Gherkin (.feature do Cucumber, Behave, SpecFlow): palavras-chave em inglês, português e espanhol, as mesmas do
// lint (lint_formats.rs); tags, <colunas> dos Exemplos, tabelas e docstrings
function registerGherkin() {
  const L = monaco.languages;
  L.register({ id: 'gherkin', extensions: ['.feature', '.gherkin'], aliases: ['Gherkin', 'Cucumber'] });
  L.setLanguageConfiguration('gherkin', {
    comments: { lineComment: '#' },
    autoClosingPairs: [{ open: '"', close: '"' }, { open: "'", close: "'" }, { open: '<', close: '>' }, { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' }],
    surroundingPairs: [{ open: '"', close: '"' }, { open: '<', close: '>' }],
    folding: { offSide: true },
  });
  const heads = ['Feature', 'Business Need', 'Ability', 'Rule', 'Background', 'Scenario Outline', 'Scenario Template', 'Scenario', 'Example', 'Examples', 'Scenarios',
    'Funcionalidade', 'Característica', 'Caracteristica', 'Regra', 'Contexto', 'Cenário de Fundo', 'Cenario de Fundo', 'Fundo', 'Esquema do Cenário', 'Esquema do Cenario',
    'Delineação do Cenário', 'Delineacao do Cenario', 'Cenário', 'Cenario', 'Exemplos', 'Exemplo', 'Cenários', 'Cenarios',
    'Necesidad del negocio', 'Requisito', 'Regla de negocio', 'Regla', 'Antecedentes', 'Esquema del escenario', 'Escenario', 'Ejemplos', 'Ejemplo'];
  const steps = ['Given', 'When', 'Then', 'And', 'But', 'Dado', 'Dada', 'Dados', 'Dadas', 'Quando', 'Então', 'Entao', 'E', 'Mas', 'Cuando', 'Entonces', 'Y', 'Pero'];
  const alt = (w) => w.sort((a, b) => b.length - a.length).join('|');
  L.setMonarchTokensProvider('gherkin', {
    tokenizer: {
      root: [
        [/^\s*#\s*language\s*:.*$/, 'keyword'],
        [/^\s*#.*$/, 'comment'],
        [new RegExp(`^(\\s*)(${alt(heads)})(:)`), ['', 'keyword', 'delimiter']],
        [new RegExp(`^(\\s*)(${alt(steps)}|\\*)(?= )`), ['', 'type.identifier']],
        [/^\s*("""|```).*$/, 'string', '@doc'],
        [/@[^\s@#]+/, 'tag'],
        [/\|/, 'delimiter'],
        [/<[^<>\s][^<>]*>/, 's-typeParameter'], // a regra existe em todos os temas (semRules): itálico
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/'(?:[^'\\]|\\.)*'/, 'string'],
        [/-?\b\d+(?:[.,]\d+)?\b/, 'number'],
        [/[^\s|<"'@\d-]+|./, ''],
      ],
      doc: [
        [/^\s*("""|```)\s*$/, 'string', '@pop'],
        [/<[^<>\s][^<>]*>/, 's-typeParameter'],
        [/[^<]+|</, 'string'],
      ],
    },
  });
}
const editorOpts = () => ({ fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace", fontSize: S.fontSize || 13, fontLigatures: true, lineHeight: Math.round((S.fontSize || 13) * 1.7), minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'all', smoothScrolling: true, cursorBlinking: 'smooth', padding: { top: 8 }, wordWrap: S.wrap ? 'on' : 'off', automaticLayout: true, bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, scrollbar: { verticalScrollbarSize: 10 }, roundedSelection: false, stickyScroll: { enabled: true }, showFoldingControls: 'mouseover', cursorSmoothCaretAnimation: 'on', lineNumbersMinChars: 4, renderWhitespace: 'trailing', 'semanticHighlighting.enabled': true, inlayHints: { enabled: 'on', fontSize: Math.max(10, (S.fontSize || 13) - 2), padding: true }, theme: themeName() });
const themeName = () => window.BS_MONACO_THEME || (document.documentElement.dataset.theme === 'light' ? 'bs-light' : 'bs-dark');
// tema: Monaco + barra de título da janela nativa (cor do fundo azul)
function applyTheme() {
  if (monaco) monaco.editor.setTheme(themeName());
  const dark = themeName() === 'bs-dark';
  desktop({ type: 'theme', dark, caption: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() });
}
// janela do aplicativo (WebView2): mensagens para a parte nativa; no navegador não faz nada
const desktop = (msg) => { try { if (window.BS_DESKTOP && window.ipc) window.ipc.postMessage(JSON.stringify(msg)); } catch {} };

const LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', html: 'html', htm: 'html', jsp: 'jsp', jspf: 'jsp', tag: 'jsp', vue: 'html', xml: 'xml', xsd: 'xml', wsdl: 'xml', css: 'css', scss: 'scss', less: 'less', md: 'markdown', py: 'python', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', sh: 'shell', bat: 'bat', ps1: 'powershell', yml: 'yaml', yaml: 'yaml', sql: 'sql', properties: 'ini', ini: 'ini', toml: 'ini', dockerfile: 'dockerfile', gradle: 'groovy', groovy: 'groovy', feature: 'gherkin', gherkin: 'gherkin', txt: 'plaintext' };
const langOf = (f) => { const n = f.toLowerCase(); if (n.endsWith('dockerfile')) return 'dockerfile'; return LANG[n.split('.').pop()] || 'plaintext'; };

// ===== Boot =====
const splash = (t) => { if (window.BS_SPLASH) t ? BS_SPLASH.step(t) : BS_SPLASH.done(); };
async function boot() {
  splash('Conectando…');
  const sess = await fetch('/api/session').then(r => r.json());
  S.remote = !!sess.remote;
  if (sess.remote && !sess.authed) { splash(); showLogin(); return; }
  try { await start(); } finally { splash(); }
}
async function start() {
  const cfg = await api('config');
  if (!S.root) S.root = cfg.root;
  S.net = cfg.network; S.hostName = cfg.host; renderNet(); BS.version = cfg.version;
  splash('Carregando plugins…');
  await BS.plugins.load(cfg.plugins); // plugins antes de tudo: eles registram painéis, atalhos e cards
  const reopen = store.get('reopenTool', null);
  if (reopen) { store.set('reopenTool', null); if (BS.tools.get(reopen)) S.tool = reopen; }
  if (DOC) return docMode(DOC);
  renderStrip();
  splash('Lendo os projetos…');
  // a abertura não espera o resumo Git de cada projeto: ele chega depois e atualiza a lista
  await loadProjects(false);
  const lastProj = store.get('project', null);
  if (lastProj) splash('Abrindo ' + lastProj.split(/[\\/]/).pop() + '…');
  if (S.project) { /* usuário já escolheu enquanto carregava */ }
  else if (lastProj && S.projects.find(p => p.path === lastProj)) await selectProject(lastProj);
  else if (lastProj && S.outside.has(lastProj)) await openProject(lastProj);
  else if (S.projects.length === 1) await selectProject(S.projects[0].path);
  renderTool(); renderDashboard();
  welcomeMode(!S.project);
}
// ===== Janela de documento (BlueScreen.exe --doc, o "Abrir com" do Windows) =====
// Só o arquivo, na tela inteira: sem projetos, árvore, painéis nem abas. A pasta do arquivo faz o papel de projeto
// (sem Git, sem índice), e fechar o documento fecha a janela, perguntando antes se há alterações não salvas.
function docMode(file) {
  document.body.classList.add('doc-mode');
  const i = file.search(/[\\/][^\\/]*$/), name = file.slice(i + 1);
  const dir = /^[A-Za-z]:$/.test(file.slice(0, i)) ? file.slice(0, i + 1) : file.slice(0, i); // C:\planilha.csv: a pasta é C:\, não C:
  S.project = { path: dir, name: dir.split(/[\\/]/).pop() || dir, vcs: null };
  $('#projName').textContent = name; $('#projChip').title = file;
  welcomeMode(false); syncUnsaved();
  // sem nada a perder, a janela fecha direto (até no meio da leitura do arquivo, quando a aba ainda nem terminou de abrir)
  window.BS_DOC_CLOSE = () => S.tabs.some(losesWork) ? askClose(S.tabs.slice()) : desktop({ type: 'close' });
  return openFile(name);
}
function showLogin() { $('#login').hidden = false; $('#loginPin').focus(); }
$('#loginBtn').onclick = async () => {
  const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ pin: $('#loginPin').value.trim() }) });
  if (r.ok) { $('#login').hidden = true; start(); } else $('#loginErr').textContent = 'PIN incorreto';
};
$('#loginPin').addEventListener('keydown', e => e.key === 'Enter' && $('#loginBtn').click());

// ===== Projetos =====
async function loadProjects(waitSummaries = true) {
  try { const r = await api('projects', { root: S.root }); S.root = r.root; S.projects = r.projects; store.set('root', S.root); }
  catch (e) { toast(e.message); S.projects = []; }
  // projetos abertos antes de outras pastas (Abrir… / Novo projeto) continuam nos recentes
  const info = store.get('recentInfo', {});
  S.outside = new Map(store.get('recents', []).filter(p => info[p] && !S.projects.some(x => x.path === p)).map(p => [p, { path: p, name: info[p].name, vcs: info[p].vcs || null, outside: true }]));
  renderTool();
  // resumo em paralelo (limite 4)
  const queue = [...S.projects, ...S.outside.values()].filter(p => p.vcs);
  renderHome();
  const worker = async () => { while (queue.length) { const p = queue.shift(); try { p.summary = await api('summary', { project: p.path }); } catch { p.summary = null; } if (S.tool === 'project') renderProjectRows(); renderHome(); } };
  const all = Promise.all([worker(), worker(), worker(), worker()]);
  if (waitSummaries) await all;
}
// Abrir um projeto: mostra a árvore e o resumo. Nada de diff ou commit aberto sozinho;
// isso só acontece quando o usuário pede (Alterações, Histórico ou menu de contexto).
async function selectProject(p) {
  if (S.project && S.project.path === p) { if (S.showProjects) { S.showProjects = false; renderTool(); } return; }
  welcomeMode(false);
  S.project = S.projects.find(x => x.path === p) || S.outside.get(p) || { path: p, name: p.split(/[\\/]/).pop(), vcs: (await api('summary', { project: p }).catch(() => ({}))).vcs || null };
  store.set('project', p);
  S.rev = null; S.logN = 0; S.chgFilter = ''; S.chgPick = false; S.tree = {}; S.walk = {}; S.treeSel = null; S.showProjects = false;
  S.changeMode = 'working'; store.set('changeMode', 'working'); S.changes = []; S.workFiles = []; S.lastFiles = []; S.log = []; S.summary = null;
  const rec = store.get('recents', []).filter(x => x !== p); rec.unshift(p); store.set('recents', rec.slice(0, 12));
  rememberProject(S.project);
  $('#projName').textContent = S.project.name;
  // abas de outro projeto saem (as não salvas ficam, para não perder trabalho)
  S.tabs.filter(t => t.project !== p && !t.dirty).forEach(closeTab);
  if (S.tool === 'changes' || S.tool === 'history') S.tool = 'project';
  btnState(); renderTool(); renderDashboard();
  SE.index = null; SE.indexFor = null; seIndex(); // índice da busca primeiro: é leve e o Shift Shift depende dele
  BS.hooks.run('project:select', S.project); // plugins (e o Build) zeram o estado e carregam em paralelo com o Git/SVN
  await refreshProject();
}

// ===== Abrir, criar e fechar projetos (como o File › New / Open / Close Project do IntelliJ) =====
// Um projeto é qualquer pasta: a da lista de projetos ou uma aberta de outro lugar (fica nos recentes).
function rememberProject(p) {
  const rec = store.get('recents', []); const info = store.get('recentInfo', {});
  info[p.path] = { name: p.name, vcs: p.vcs || null };
  for (const k of Object.keys(info)) if (!rec.includes(k)) delete info[k];
  store.set('recentInfo', info);
  if (!S.projects.some(x => x.path === p.path)) S.outside.set(p.path, { ...p, outside: true });
}
function forgetProject(path) {
  store.set('recents', store.get('recents', []).filter(x => x !== path));
  const info = store.get('recentInfo', {}); delete info[path]; store.set('recentInfo', info);
  S.outside.delete(path); renderHome();
}
// recentes primeiro (de qualquer pasta), depois os da pasta de projetos
function recentProjects() { return store.get('recents', []).map(p => S.projects.find(x => x.path === p) || S.outside.get(p)).filter(Boolean); }
const parentName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2, -1)[0] || '';
const parentDir = (p) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
// abre qualquer pasta como projeto (confere se ela existe)
async function openProject(path) {
  if (!path) return;
  let info; try { info = await api('project/info', { path }); } catch (e) { return toast(e.message); }
  if (!info.exists) { forgetProject(path); if (store.get('project', null) === path) store.set('project', null); return toast('A pasta não existe mais: ' + path); }
  if (!S.projects.some(x => x.path === info.path) && !S.outside.has(info.path)) S.outside.set(info.path, { path: info.path, name: info.name, vcs: info.vcs, outside: true });
  await selectProject(info.path);
}
async function openProjectDialog() {
  closeMenu();
  const start = S.project ? parentDir(S.project.path) : S.root;
  if (!S.remote) {
    // seletor de pasta do Windows (abre no PC, não pela rede)
    try { const r = await api('project/pick', { start, title: 'Abrir projeto' }, { method: 'POST' }); if (r.path) await openProject(r.path); return; }
    catch (e) { toast(e.message); }
  }
  dialog('openProj', `<div class="dlg-hd"><span class="dlg-ic">${I.open}</span><div><h3>Abrir projeto</h3><p>Qualquer pasta vira projeto e fica nos recentes.</p></div></div>
    <label class="fld">Pasta<input id="opPath" spellcheck="false" autocomplete="off" value="${esc(start || '')}"></label>
    <div class="err" id="opErr"></div>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="opOk">Abrir</button></div>`, (el) => {
    const go = async () => { const v = $('#opPath').value.trim(); if (!v) return; el.hidden = true; await openProject(v); };
    $('#opOk').onclick = go; $('#opPath').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    const i = $('#opPath'); i.focus(); i.select();
  });
}
function newProjectDialog() {
  closeMenu();
  if (S.remote) return toast('Novo projeto só pelo PC');
  // projetos novos vão para a pasta Projects da raiz (criada se faltar); o local guardado que era a própria raiz também
  const root = (S.root || '').replace(/[\\/]+$/, '');
  const def = root ? root + (root.includes('/') && !root.includes('\\') ? '/' : '\\') + 'Projects' : '';
  const saved = (store.get('newProjLoc', null) || '').replace(/[\\/]+$/, '');
  const loc = saved && saved.toLowerCase() !== root.toLowerCase() ? saved : def;
  dialog('newProj', `<div class="dlg-hd"><span class="dlg-ic">${I.newp}</span><div><h3>Novo projeto</h3><p>Cria a pasta e, se quiser, o repositório Git e o README.</p></div></div>
    <label class="fld">Nome<input id="npName" spellcheck="false" autocomplete="off" placeholder="meu-projeto"></label>
    <label class="fld">Local<span class="line"><input id="npLoc" spellcheck="false" autocomplete="off" value="${esc(loc)}"><button class="chip" id="npPick" type="button">Procurar…</button></span></label>
    <p class="where" id="npWhere"></p>
    <label class="chk"><input type="checkbox" id="npGit" ${store.get('newProjGit', true) ? 'checked' : ''}>Criar repositório Git</label>
    <label class="chk"><input type="checkbox" id="npReadme" ${store.get('newProjReadme', true) ? 'checked' : ''}>Criar README.md</label>
    <div class="err" id="npErr"></div>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="npOk">Criar</button></div>`, (el) => {
    const where = () => { const n = $('#npName').value.trim(), l = $('#npLoc').value.trim().replace(/[\\/]+$/, ''); const full = n && l ? l + (l.includes('/') && !l.includes('\\') ? '/' : '\\') + n : ''; $('#npWhere').textContent = full.length > 66 ? '…' + full.slice(-65) : full; $('#npWhere').title = full; };
    $('#npName').oninput = where; $('#npLoc').oninput = where; where();
    $('#npPick').onclick = async () => { try { const r = await api('project/pick', { start: $('#npLoc').value.trim(), title: 'Local do novo projeto' }, { method: 'POST' }); if (r.path) { $('#npLoc').value = r.path; where(); } } catch (e) { $('#npErr').textContent = e.message; } };
    const go = async () => {
      const body = { name: $('#npName').value.trim(), parent: $('#npLoc').value.trim(), git: $('#npGit').checked, readme: $('#npReadme').checked };
      if (!body.name) { $('#npErr').textContent = 'Dê um nome ao projeto'; $('#npName').focus(); return; }
      $('#npOk').disabled = true; $('#npErr').textContent = '';
      try {
        const r = await api('project/new', {}, { method: 'POST', body: JSON.stringify(body) });
        store.set('newProjLoc', body.parent); store.set('newProjGit', body.git); store.set('newProjReadme', body.readme);
        el.hidden = true;
        if (r.warning) toast(r.warning);
        await loadProjects(); await openProject(r.path);
      } catch (e) { $('#npErr').textContent = e.message; $('#npOk').disabled = false; }
    };
    $('#npOk').onclick = go;
    el.querySelectorAll('input:not([type=checkbox])').forEach(i => i.onkeydown = (e) => { if (e.key === 'Enter') go(); });
    $('#npName').focus();
  });
}
function closeProject() {
  if (!S.project) return;
  S.tabs.filter(t => !t.dirty).forEach(closeTab); // não salvas ficam abertas, para não perder trabalho
  S.project = null; store.set('project', null);
  S.summary = null; S.changes = []; S.workFiles = []; S.lastFiles = []; S.log = []; S.logN = 0; S.tree = {}; S.walk = {}; S.showProjects = false;
  if (S.tool === 'changes' || S.tool === 'history') S.tool = 'project';
  $('#projName').textContent = 'Nenhum projeto'; $('#projBranch').innerHTML = ''; $('#stVcs').textContent = '';
  const b = $('#badge-changes'); if (b) b.hidden = true;
  SE.index = null; SE.indexFor = null;
  BS.hooks.run('project:select', null);
  btnState(); renderTool(); renderDashboard(); welcomeMode(true);
}
// diálogo modal: fundo escurecido e desfocado; Esc, Cancelar, o X ou um clique fora fecham
function dialog(id, html, bind) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div'); el.id = id; el.className = 'dlg scrim'; document.body.appendChild(el);
    el.addEventListener('mousedown', (e) => { if (e.target === el) el.hidden = true; });
  }
  el.innerHTML = `<div class="dlg-box" role="dialog" aria-modal="true"><button class="icon-btn dlg-x" data-close title="Fechar (Esc)">${I.x}</button>${html}</div>`; el.hidden = false;
  el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { el.hidden = true; });
  bind && bind(el);
  return el;
}
// menu do projeto no topo (como o seletor de projeto da barra do IntelliJ)
function projectSwitcher() {
  const r = $('#projChip').getBoundingClientRect();
  const rec = recentProjects().filter(p => !S.project || p.path !== S.project.path).slice(0, 10);
  showMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, [
    ...(S.remote ? [] : [{ label: 'Novo projeto…', icon: I.newp, action: () => newProjectDialog() }]),
    { label: 'Abrir…', icon: I.open, action: () => openProjectDialog() },
    { label: 'Trocar projeto…', icon: TI.module, k: 'Alt+P', action: () => quickProject() },
    ...(rec.length ? ['-', ...rec.map(p => ({ label: p.name, k: parentName(p.path), icon: TI.module, action: () => openProject(p.path) }))] : []),
    '-',
    { label: 'Lista de projetos', icon: TI.list, action: () => { S.showProjects = true; openTool('project'); } },
    ...(S.project ? [{ label: 'Fechar projeto', icon: I.x, action: () => closeProject() }] : []),
  ], 'Projetos');
}

// ===== Menu de contexto =====
function showMenu(e, items, header) {
  e.preventDefault(); e.stopPropagation(); closeMenu();
  const m = menuEl('ctx', items, header);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
}
// itens com sub: [...] abrem um submenu ao lado (passar o mouse ou clicar), como o "New ›" do IntelliJ
function menuEl(id, items, header) {
  const m = document.createElement('div'); m.className = 'ctx'; m.id = id;
  m.innerHTML = (header ? `<div class="hd">${esc(header)}</div><div class="sep"></div>` : '') + items.map((it, i) => it === '-' ? '<div class="sep"></div>' : `<div class="it${it.sub ? ' has-sub' : ''}" data-i="${i}">${it.icon || '<span style="width:16px;flex:none"></span>'}<span>${esc(it.label)}</span>${it.sub ? '<span class="k">›</span>' : it.k ? `<span class="k">${esc(it.k)}</span>` : ''}</div>`).join('');
  document.body.appendChild(m);
  m.querySelectorAll('.it').forEach(el => {
    const it = items[el.dataset.i];
    if (it.sub) { el.onmouseenter = el.onclick = () => subMenu(el, it.sub); return; }
    if (id === 'ctx') el.onmouseenter = () => $('#ctxSub')?.remove();
    el.onclick = () => { closeMenu(); it.action(); };
  });
  return m;
}
function subMenu(row, items) {
  if ($('#ctxSub')?.dataset.for === row.dataset.i) return;
  $('#ctxSub')?.remove(); $('#ctx .it.open')?.classList.remove('open'); row.classList.add('open');
  const s = menuEl('ctxSub', items); s.dataset.for = row.dataset.i;
  const r = row.getBoundingClientRect(), w = s.getBoundingClientRect();
  s.style.left = (r.right + w.width + 4 > innerWidth ? r.left - w.width - 2 : r.right + 2) + 'px';
  s.style.top = Math.max(8, Math.min(r.top - 5, innerHeight - w.height - 8)) + 'px';
}
function closeMenu() { $('#ctx')?.remove(); $('#ctxSub')?.remove(); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.ctx, #btnSaveMenu')) closeMenu(); });
window.addEventListener('blur', closeMenu);
const I = {
  open: '<svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  newp: '<svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/></svg>',
  diff: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3v18M3 7h6v10H3zM15 7h6v10h-6z"/></svg>',
  commit: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/></svg>',
  local: '<svg class="i" viewBox="0 0 24 24"><path d="M12 20V10M6 20v-4M18 20v-7"/></svg>',
  hist: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  copy: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  explorer: '<svg class="i" viewBox="0 0 24 24"><path d="M3 5h18v14H3zM3 9h18"/></svg>',
  edit: '<svg class="i" viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  lint: '<svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  present: '<svg class="i" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
  refresh: '<svg class="i" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
  pkg: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  shield: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  ext: '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  plug: '<svg class="i" viewBox="0 0 24 24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>',
  changes: '<svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-3 4-6 4H8.5"/></svg>',
  problems: '<svg class="i" viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
};
const SEARCH_ICO = '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';
const copyText = (t) => navigator.clipboard.writeText(t).then(() => toast('Copiado')).catch(() => toast('Não foi possível copiar'));
const reveal = (p) => api('reveal', { path: p }).catch(e => toast(e.message));
const absPath = (rel) => S.project.path + '\\' + rel.replace(/\//g, '\\');
function projectMenu(e, p) {
  const go = async (fn) => { await selectProject(p.path); fn && fn(); };
  showMenu(e, BS.hooks.apply('menu:project', [
    { label: 'Abrir', icon: I.open, action: () => selectProject(p.path) },
    ...(p.vcs ? [
      '-',
      { label: 'Ver alterações locais', icon: I.local, action: () => go(() => openTool('changes')) },
      { label: 'Ver último commit', icon: I.commit, action: () => go(async () => { S.changeMode = 'last'; S.rev = null; store.set('changeMode', 'last'); await refreshProject(); openTool('changes'); }) },
      { label: 'Histórico', icon: I.hist, action: () => go(() => openTool('history')) },
      { label: 'Lint das alterações', icon: I.lint, action: () => go(() => lintAll()) },
    ] : []),
    '-',
    { label: 'Mostrar no Explorer', icon: I.explorer, action: () => reveal(p.path) },
    { label: 'Copiar caminho', icon: I.copy, action: () => copyText(p.path) },
    { label: 'Atualizar', icon: I.refresh, k: 'F5', action: () => refreshAll() },
    ...(store.get('recents', []).includes(p.path) && !(S.project && S.project.path === p.path) ? [{ label: 'Remover dos recentes', icon: I.x, action: () => forgetProject(p.path) }] : []),
  ], p), p.path);
}
function fileMenu(e, rel, isDir, vcsSub) {
  const chg = S.changes.find(c => c.path === rel);
  showMenu(e, BS.hooks.apply('menu:file', [
    ...(vcsSub ? [{ label: 'Abrir como projeto (' + vcsSub + ')', icon: I.open, action: () => selectProject(absPath(rel)) }, '-'] : []),
    ...(isDir ? [] : [{ label: 'Abrir', icon: I.edit, action: () => openFile(rel, 'editor') }]),
    ...(!isDir && S.project.vcs ? [
      { label: 'Diff local', icon: I.local, action: async () => { if (S.changeMode !== 'working') { S.changeMode = 'working'; S.rev = null; store.set('changeMode', 'working'); await refreshProject(); } openFile(rel, 'diff'); } },
      { label: 'Diff do último commit', icon: I.commit, action: async () => { S.changeMode = 'last'; S.rev = null; store.set('changeMode', 'last'); await refreshProject(); openFile(rel, 'diff'); } },
    ] : []),
    ...(!isDir ? [{ label: 'Lint', icon: I.lint, action: async () => { await openFile(rel, 'editor'); runLint(); } }] : []),
    '-',
    { label: 'Mostrar no Explorer', icon: I.explorer, action: () => reveal(absPath(rel)) },
    { label: 'Copiar caminho', icon: I.copy, action: () => copyText(absPath(rel)) },
    { label: 'Copiar caminho relativo', icon: I.copy, action: () => copyText(rel) },
    ...(S.remote ? [] : ['-', { label: 'Excluir…', icon: I.x, k: 'Delete', action: () => deletePath(rel, isDir) }]),
  ], { rel, isDir, chg }), rel + (chg ? `  ·  ${chg.code}` : ''));
}
// Excluir (como o IntelliJ): confirma e manda para a Lixeira do Windows, então dá para desfazer por lá.
// As abas do que foi excluído fecham sem salvar (salvar recriaria o arquivo).
function deletePath(rel, isDir) {
  if (!S.project || !rel) return;
  const inside = (t) => t.project === S.project.path && (t.path === rel || (isDir && t.path.startsWith(rel + '/')));
  const dirty = S.tabs.filter(t => inside(t) && t.dirty);
  const name = rel.split('/').pop();
  dialog('delDlg', `<div class="dlg-hd"><span class="dlg-ic del">${I.x}</span><div><h3>Excluir ${isDir ? 'a pasta' : 'o arquivo'} "${esc(name)}"?</h3><p>${esc(rel)}</p></div></div>
    <p class="del-msg">${isDir ? 'A pasta e tudo o que está dentro dela vão' : 'O arquivo vai'} para a Lixeira do Windows; dá para restaurar por lá.</p>
    ${dirty.length ? `<p class="del-msg warn">${dirty.length === 1 ? `${esc(dirty[0].path.split('/').pop())} tem alterações não salvas, que serão perdidas.` : `${dirty.length} arquivos abertos têm alterações não salvas, que serão perdidas.`}</p>` : ''}
    <div class="err" id="delErr"></div>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary danger" id="delOk">Excluir</button></div>`, (el) => {
    const ok = $('#delOk'); ok.focus();
    el.onkeydown = (e) => { if (e.key === 'Escape') el.hidden = true; };
    ok.onclick = async () => {
      ok.disabled = true; $('#delErr').textContent = '';
      // a linha que fica selecionada depois: a seguinte (ou a anterior) que não está dentro do que sai
      const rows = S.treeRowsCache || [], at = rows.findIndex(r => r.p === rel);
      const out = (p) => p === rel || p.startsWith(rel + '/');
      const next = rows.slice(at + 1).find(r => !out(r.p)) || rows.slice(0, Math.max(0, at)).reverse().find(r => !out(r.p));
      try { await api('file/delete', { project: S.project.path }, { method: 'POST', body: JSON.stringify({ paths: [rel] }) }); }
      catch (e) { $('#delErr').textContent = e.message; ok.disabled = false; return; }
      el.hidden = true;
      S.tabs.filter(inside).forEach(t => { t.gone = true; t.dirty = false; closeTab(t); });
      const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      for (const k of Object.keys(S.tree)) if (k === parent || out(k) || !k || parent.startsWith(k + '/')) delete S.tree[k];
      for (const p of [...S.treeOpen]) if (out(p)) S.treeOpen.delete(p);
      if (S.treeSel && out(S.treeSel)) S.treeSel = next ? next.p : null;
      await refreshProject();
      if (next) treeSelect(next.p, true);
      toast(`${name} foi para a Lixeira`, 'ok');
      BS.hooks.run('file:delete', rel, isDir);
    };
  });
}
function tabMenu(e, t) {
  showMenu(e, BS.hooks.apply('menu:tab', [
    { label: t.mode === 'diff' ? 'Abrir como editor' : 'Ver diff', icon: t.mode === 'diff' ? I.edit : I.diff, action: () => openFile(t.path, t.mode === 'diff' ? 'editor' : 'diff') },
    { label: 'Apresentar', icon: I.present, k: 'F11', action: () => { activate(t); present(true); } },
    '-',
    { label: 'Fechar', icon: I.x, k: 'Ctrl+W', action: () => askClose(t) },
    { label: 'Fechar outras', action: () => askClose(S.tabs.filter(x => x !== t)) },
    { label: 'Fechar todas', action: () => askClose(S.tabs.slice()) },
    '-',
    { label: 'Mostrar no Explorer', icon: I.explorer, action: () => reveal(t.project + '\\' + t.path.replace(/\//g, '\\')) },
    { label: 'Copiar caminho', icon: I.copy, action: () => copyText(t.project + '\\' + t.path.replace(/\//g, '\\')) },
    ...(S.remote || t.project !== S.project?.path ? [] : ['-', { label: 'Excluir arquivo…', icon: I.x, action: () => deletePath(t.path, false) }]),
  ], t), t.path);
}
function commitMenu(e, c) {
  showMenu(e, BS.hooks.apply('menu:commit', [
    { label: 'Ver arquivos do commit', icon: I.commit, action: () => goCommit(S.log.findIndex(l => l.id === c.id)) },
    '-',
    { label: 'Copiar hash', icon: I.copy, action: () => copyText(c.hash) },
    { label: 'Copiar mensagem', icon: I.copy, action: () => copyText(c.subject) },
  ], c), `${c.hash} · ${c.author}`);
}

// ===== Boas-vindas (sem projeto aberto) =====
// Sem projeto, a IDE some e fica só esta tela; na janela do aplicativo ela também encolhe e vai para o centro.
// O trabalho dela é levar de volta ao código: o último projeto vem em destaque, com o estado dele e as ações
// mais comuns; a lista embaixo filtra enquanto você digita (sem clicar na busca), fixa projetos e tira dos recentes.
const WEL = { sel: 0, items: [], view: store.get('welView', 'recent') };
if (window.BS_WELCOME) document.body.classList.add('welcome');
function welcomeMode(on) {
  on = !!on;
  const was = document.body.classList.contains('welcome');
  document.body.classList.toggle('welcome', on);
  desktop({ type: 'welcome', on });
  if (on) { renderHome(); if (!was) setTimeout(() => $('#welList')?.focus(), 30); }
}
const welColor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 48% 44%)`; };
const welInitials = (n) => { const w = n.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s\-_.]+/).filter(Boolean); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase(); };
const welPinned = () => store.get('pinned', []);
function welPin(p) { const l = welPinned(); store.set('pinned', l.includes(p.path) ? l.filter(x => x !== p.path) : [p.path, ...l]); renderHome(); }
const welKnown = (path) => S.projects.find(x => x.path === path) || S.outside.get(path);
const welChanges = (p) => (p.summary && p.summary.dirty) || 0;
const welPlural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
async function welOpenWith(p, then) { await openProject(p.path); if (S.project && S.project.path === p.path) then(); }
function renderHome() {
  const el = $('#welList'); if (!el) return;
  $('#welVer').textContent = BS.version || '';
  $('#welRootPath').textContent = S.root || 'nenhuma'; $('#welRootPath').title = S.root || '';
  $('#welNew').hidden = !!S.remote;
  const rec = store.get('recents', []); const pins = welPinned();
  const all = [...recentProjects(), ...S.projects.filter(p => !rec.includes(p.path))];
  const last = recentProjects()[0] || null;
  renderResume(last, all.length);
  // filtros: contagens sempre do conjunto inteiro, para saber o que tem em cada um antes de trocar
  const sets = { recent: recentProjects(), all, dirty: all.filter(welChanges) };
  // sem recentes ainda, a aba Recentes mostra todos (sem trocar a escolha guardada)
  const view = WEL.view === 'recent' && !sets.recent.length ? 'all' : WEL.view;
  $('#welSeg').innerHTML = [['recent', 'Recentes'], ['all', 'Todos'], ['dirty', 'Com alterações']].map(([k, t]) => `<button role="tab" data-v="${k}" class="${view === k ? 'on' : ''}" aria-selected="${view === k}">${t}<span>${sets[k].length}</span></button>`).join('');
  $('#welSeg').querySelectorAll('button').forEach(b => b.onclick = () => { WEL.view = b.dataset.v; store.set('welView', WEL.view); WEL.sel = 0; renderHome(); $('#welList').focus(); });
  const q = $('#welQ').value.trim().toLowerCase();
  const match = (p) => !q || (p.name + ' ' + p.path + ' ' + ((p.summary && p.summary.branch) || '')).toLowerCase().includes(q);
  let list = (q ? all : sets[view]).filter(match);
  // fixados sempre no topo da lista
  list = [...list.filter(p => pins.includes(p.path)).sort((a, b) => pins.indexOf(a.path) - pins.indexOf(b.path)), ...list.filter(p => !pins.includes(p.path))];
  WEL.items = list; WEL.sel = Math.min(WEL.sel, Math.max(0, list.length - 1));
  el.innerHTML = list.map((p, k) => {
    const s = p.summary; const l = s && s.last; const n = welChanges(p); const pin = pins.includes(p.path);
    return `<div class="wel-row${k === WEL.sel ? ' sel' : ''}" role="option" aria-selected="${k === WEL.sel}" data-k="${k}" title="${esc(p.path)}">
      <span class="av" style="background:${welColor(p.name)}">${esc(welInitials(p.name))}</span>
      <div class="tx"><b>${esc(p.name)}${pin ? '<svg class="pinned" viewBox="0 0 24 24" aria-label="fixado"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/></svg>' : ''}</b><span class="pa">${esc(p.path)}</span></div>
      <div class="wm">${s && s.branch ? `<code class="br">${esc(s.branch)}</code>` : p.vcs ? `<span class="pill ${p.vcs}">${p.vcs}</span>` : '<span class="novcs">sem Git/SVN</span>'}${n ? `<span class="dirty">${welPlural(n, 'alteração', 'alterações')}</span>` : ''}<span class="wh">${l ? esc(l.when) : esc(ago(p.mtime))}</span></div>
      <div class="wa">
        <button class="icon-btn" data-a="pin" title="${pin ? 'Desafixar' : 'Fixar no topo'}"><svg class="i" viewBox="0 0 24 24"${pin ? ' style="fill:currentColor"' : ''}><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 20.9l1.6-7L2 9.2l7.1-.6z"/></svg></button>
        <button class="icon-btn" data-a="term" title="Abrir com terminal"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg></button>
        ${rec.includes(p.path) ? `<button class="icon-btn" data-a="forget" title="Tirar dos recentes">${I.x}</button>` : ''}
      </div></div>`;
  }).join('') || (q ? `<div class="wel-empty">Nenhum projeto com “${esc(q)}”. <a id="welClear">Limpar o filtro</a></div>`
    : view === 'dirty' ? '<div class="wel-empty">Nenhum projeto com alterações locais.</div>'
    : all.length ? '' : '<div class="wel-empty">A pasta de projetos está vazia.</div>');
  $('#welClear')?.addEventListener('click', () => { $('#welQ').value = ''; renderHome(); $('#welList').focus(); });
  el.querySelectorAll('.wel-row').forEach(r => {
    const p = WEL.items[+r.dataset.k];
    r.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'pin') return welPin(p);
      if (a === 'forget') { forgetProject(p.path); return renderHome(); }
      if (a === 'term') return welOpenWith(p, () => BS.terminal && BS.terminal.open());
      openProject(p.path);
    };
    r.oncontextmenu = (e) => projectMenu(e, p);
  });
}
// destaque: o último projeto, com o que mudou desde que você saiu
function renderResume(p, total) {
  const box = $('#welResume');
  if (!p) {
    box.classList.add('first');
    box.innerHTML = `<div class="rs-main"><h1>${total ? 'Escolha um projeto para começar' : 'Nenhum projeto ainda'}</h1>
      <p>${total ? 'Os projetos que você abrir aparecem aqui, prontos para continuar.' : 'Crie um projeto novo ou abra uma pasta que já existe no computador.'}</p></div>
      <div class="rs-act">${S.remote ? '' : '<button class="rs-btn primary" data-r="new">Novo projeto</button>'}<button class="rs-btn" data-r="open">Abrir pasta</button></div>`;
  } else {
    box.classList.remove('first');
    const s = p.summary; const l = s && s.last; const n = welChanges(p);
    box.innerHTML = `<div class="rs-main"><span class="rs-k">Continuar de onde parou</span>
      <h1 title="${esc(p.path)}">${esc(p.name)}</h1>
      <div class="rs-meta">${s && s.branch ? `<span class="rs-br"><svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/></svg><code>${esc(s.branch)}</code></span>` : ''}
        ${n ? `<span class="rs-dirty">${welPlural(n, 'alteração não commitada', 'alterações não commitadas')}</span>` : s ? '<span>nada pendente</span>' : ''}</div>
      ${l ? `<p class="rs-last"><span class="rs-subj">${esc(l.subject)}</span><span class="rs-by">${esc(l.author)}, ${esc(l.when)}</span></p>` : `<p class="rs-last"><span class="rs-by">${esc(p.path)}</span></p>`}</div>
      <div class="rs-act"><button class="rs-btn primary" data-r="go">Abrir</button><button class="rs-btn" data-r="term">Abrir com terminal</button>${n ? '<button class="rs-btn" data-r="chg">Ver alterações</button>' : ''}</div>`;
  }
  box.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const r = b.dataset.r;
    if (r === 'new') newProjectDialog(); else if (r === 'open') openProjectDialog();
    else if (r === 'go') openProject(p.path);
    else if (r === 'term') welOpenWith(p, () => BS.terminal && BS.terminal.open());
    else if (r === 'chg') welOpenWith(p, () => setTool('changes'));
  });
}
function welMove(d) {
  if (!WEL.items.length) return;
  WEL.sel = Math.max(0, Math.min(WEL.items.length - 1, WEL.sel + d));
  $('#welList').querySelectorAll('.wel-row').forEach(r => { const on = +r.dataset.k === WEL.sel; r.classList.toggle('sel', on); r.setAttribute('aria-selected', on); });
  $('#welList .wel-row.sel')?.scrollIntoView({ block: 'nearest' });
}
$('#welQ').oninput = () => { WEL.sel = 0; renderHome(); };
// teclado: setas e Enter na lista; qualquer letra digitada vai para o filtro, Esc limpa
$('#wel').addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('welcome') || e.target.closest('.dlg, #ctx')) return;
  const inQ = e.target === $('#welQ');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); welMove(e.key === 'ArrowDown' ? 1 : -1); return; }
  if (e.key === 'Enter' && (inQ || e.target === $('#welList'))) { const p = WEL.items[WEL.sel]; if (p) openProject(p.path); return; }
  if (e.key === 'Escape' && $('#welQ').value) { e.stopPropagation(); $('#welQ').value = ''; renderHome(); $('#welList').focus(); return; }
  if (!inQ && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.target.closest('input, textarea')) { $('#welQ').focus(); }
});
$('#welNew').onclick = () => newProjectDialog();
$('#welOpen').onclick = () => openProjectDialog();
$('#welTheme').onclick = () => $('#btnTheme').click();
$('#welLook').onclick = () => $('#btnAppearance').click();
const welRoot = () => dialog('rootDlg', `<div class="dlg-hd"><span class="dlg-ic">${I.open}</span><div><h3>Pasta de projetos</h3><p>Cada pasta dentro dela aparece na lista de projetos.</p></div></div>
    <label class="fld">Pasta<span class="line"><input id="rdIn" spellcheck="false" autocomplete="off" value="${esc(S.root || '')}">${S.remote ? '' : '<button class="chip" id="rdPick" type="button">Procurar…</button>'}</span></label>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="rdOk">Usar esta pasta</button></div>`, (el) => {
  const go = async () => { const v = $('#rdIn').value.trim(); if (!v) return; el.hidden = true; S.root = v; await loadProjects(); };
  $('#rdOk').onclick = go; $('#rdIn').onkeydown = (e) => { if (e.key === 'Enter') go(); }; $('#rdIn').focus();
  $('#rdPick')?.addEventListener('click', async () => { try { const r = await api('project/pick', { start: $('#rdIn').value.trim(), title: 'Pasta de projetos' }, { method: 'POST' }); if (r.path) $('#rdIn').value = r.path; } catch (e) { toast(e.message); } });
});
$('#welRoot').onclick = welRoot; $('#welRoot').onkeydown = (e) => { if (e.key === 'Enter') welRoot(); };
if (window.BS_DESKTOP) {
  $('#welCtl').hidden = false;
  $('#welCtl').querySelectorAll('button').forEach(b => b.onclick = () => desktop({ type: b.dataset.w }));
  // a barra de cima arrasta a janela
  $('#wel').querySelector('.wel-top').addEventListener('mousedown', (e) => { if (e.button === 0 && e.detail === 1 && !e.target.closest('button')) desktop({ type: 'drag' }); });
}

// ===== Seletor rápido de projeto (Alt+P) =====
function quickProject() {
  let pal = $('#ppal');
  if (!pal) { pal = document.createElement('div'); pal.id = 'ppal'; pal.className = 'pop'; pal.style.cssText = 'top:60px;left:50%;transform:translateX(-50%);width:520px;padding:8px'; pal.innerHTML = '<input id="ppalIn" placeholder="Projeto…" style="width:100%" autocomplete="off"><div id="ppalList" style="max-height:360px;overflow:auto;margin-top:6px"></div>'; document.body.appendChild(pal); }
  pal.hidden = false; const inp = $('#ppalIn'); inp.value = ''; inp.focus();
  const rec = store.get('recents', []);
  const ordered = [...recentProjects(), ...S.projects.filter(p => !rec.includes(p.path))];
  const known = (p) => S.projects.find(x => x.path === p) || S.outside.get(p);
  const render = () => { const v = inp.value.toLowerCase(); const hits = ordered.filter(p => p.name.toLowerCase().includes(v));
    $('#ppalList').innerHTML = hits.map(p => `<div class="row" data-p="${esc(p.path)}" title="${esc(p.path)}">${I.open}<span class="name">${esc(p.name)}</span><span class="meta">${p.outside ? `<span>${esc(parentName(p.path))}</span>` : ''}${p.summary && p.summary.dirty ? `<span class="dot"></span>${p.summary.dirty}` : ''}${p.summary && p.summary.last ? `<span>${esc(p.summary.last.when)}</span>` : ''}${p.vcs ? `<span class="pill ${p.vcs}">${p.vcs}</span>` : ''}</span></div>`).join('')
      + `<div class="row act" data-a="open">${I.open}<span class="name">Abrir outra pasta…</span></div>` + (S.remote ? '' : `<div class="row act" data-a="new">${I.newp}<span class="name">Novo projeto…</span></div>`);
    $('#ppalList').querySelectorAll('.row[data-p]').forEach(r => { r.onclick = () => { pal.hidden = true; openProject(r.dataset.p); }; r.oncontextmenu = (e) => { pal.hidden = true; projectMenu(e, known(r.dataset.p)); }; });
    $('#ppalList').querySelectorAll('.row[data-a]').forEach(r => r.onclick = () => { pal.hidden = true; r.dataset.a === 'new' ? newProjectDialog() : openProjectDialog(); }); };
  inp.oninput = render; render();
  inp.onkeydown = (e) => { if (e.key === 'Escape') pal.hidden = true; if (e.key === 'Enter') $('#ppalList .row')?.click(); };
}
async function refreshProject() {
  if (!S.project) return;
  const other = S.changeMode === 'working' ? 'last' : 'working';
  const [sum, ch, lg, oth] = await Promise.all([
    api('summary', { project: S.project.path }).catch(() => null),
    S.project.vcs ? api('changes', { project: S.project.path, mode: S.changeMode, rev: S.rev }).catch(() => ({ files: [] })) : { files: [] },
    S.project.vcs ? api('log', { project: S.project.path, n: S.logN || 30 }).catch(() => []) : [],
    S.project.vcs ? api('changes', { project: S.project.path, mode: other }).catch(() => ({ files: [] })) : { files: [] },
  ]);
  // o Git/SVN pode ter sido criado (git init, checkout) ou apagado depois que a pasta entrou nos recentes: o resumo
  // de agora manda. Mudou: guarda e busca de novo as alterações e o histórico com o tipo certo
  if (sum && (sum.vcs || null) !== (S.project.vcs || null)) {
    S.project.vcs = sum.vcs || null;
    if (S.project.outside) rememberProject(S.project);
    return refreshProject();
  }
  S.summary = sum; S.project.summary = sum; S.changes = ch.files; S.log = lg;
  S.workFiles = S.changeMode === 'working' ? ch.files : oth.files;
  S.lastFiles = S.changeMode === 'working' ? oth.files : (S.rev ? oth.files : ch.files);
  const br = $('#projBranch');
  br.innerHTML = sum && sum.vcs ? `<span class="pill ${sum.vcs}">${sum.vcs}</span>${sum.branch ? esc(sum.branch) : ''}` : '<span class="pill">sem Git/SVN</span>';
  $('#stVcs').textContent = sum && sum.last ? `${sum.last.hash} · ${sum.last.author} · ${sum.last.when}` : '';
  const dirty = sum ? sum.dirty : 0; const b = $('#badge-changes'); if (b) { b.hidden = !dirty; b.textContent = dirty; }
  renderTool(); renderDashboard();
  BS.hooks.run('project:refresh', S.project);
}

// ===== Tool windows =====
// Os painéis (do núcleo e dos plugins) ficam em BS.tools; a barra da esquerda é desenhada a partir deles.
function renderStrip() {
  const el = $('#strip'); const tools = BS.tools.list();
  // Ao passar o mouse a barra se expande e mostra o nome de cada painel; --i escalona a entrada dos rótulos.
  let i = 0;
  const item = (attrs, icon, label, key, extra = '') => `<button class="icon-btn" ${attrs} aria-label="${esc(label)}" style="--i:${i++}">${icon}<span class="lbl">${esc(label)}</span>${key ? `<kbd class="k">${esc(key)}</kbd>` : ''}${extra}</button>`;
  const btn = (t) => item(`data-tool="${esc(t.id)}"`, t.icon, t.title, t.key, `<span class="badge" id="badge-${esc(t.id)}" hidden></span>`);
  const top = tools.filter(t => !t.bottom).map(btn).join('');
  const bottom = tools.filter(t => t.bottom).map(btn).join('') + item('id="btnRefresh"', I.refresh, 'Atualizar', 'F5');
  el.innerHTML = top + '<div class="grow"></div>' + bottom;
  el.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#btnRefresh').onclick = refreshAll;
  btnState();
}
function setTool(t) {
  const def = BS.tools.get(t); if (!def) return;
  if (def.toggle) { if (!BS.dock || !BS.dock.claim(t)) def.toggle(); return; }
  if (S.tool === t && !$('#app').classList.contains('no-tool')) { $('#app').classList.add('no-tool'); btnState(); BS.hooks.run('tool:show', t, false); return; }
  $('#app').classList.remove('no-tool'); S.tool = t; btnState(); renderTool(); BS.hooks.run('tool:show', t, true);
}
function openTool(t) { const def = BS.tools.get(t); if (!def) return; if (def.toggle) { BS.dock && BS.dock.claim(t); def.toggle(true); return; } $('#app').classList.remove('no-tool'); S.tool = t; btnState(); renderTool(); BS.hooks.run('tool:show', t, true); }
function btnState() { document.querySelectorAll('#strip [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool && !$('#app').classList.contains('no-tool'))); }
function renderTool() {
  const t = BS.tools.get(S.tool) || BS.tools.get('project'); S.tool = t.id;
  $('#toolTitle').textContent = t.title; $('#toolSub').textContent = ''; $('#toolActions').innerHTML = ''; $('#toolBody').onscroll = null;
  try { t.render(); }
  catch (e) { console.error(e); $('#toolBody').innerHTML = `<div class="errbox"><b>O painel ${esc(t.title)} falhou.</b><div>${esc(e.message)}</div></div>`; }
}
function renderProject() {
  const body = $('#toolBody');
  if (!S.project || S.showProjects) return renderProjectList();
  $('#toolSub').textContent = '';
  $('#toolActions').innerHTML = `<button class="icon-btn" id="tLocate" title="Selecionar arquivo aberto (Alt+F1)">${TI.locate}</button><button class="icon-btn" id="tCollapse" title="Recolher tudo">${TI.collapse}</button><button class="icon-btn" id="tMore" title="Opções">${TI.more}</button>`;
  $('#tLocate').onclick = () => treeLocate();
  $('#tCollapse').onclick = () => { S.treeOpen = new Set(['']); saveTreeOpen(); renderTree(); };
  $('#tMore').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, [
    { label: (S.compact ? '✓ ' : '   ') + 'Compactar pacotes intermediários', action: () => { S.compact = !S.compact; store.set('compact', S.compact); S.tree = {}; renderTree(); } },
    { label: (S.singleClick ? '✓ ' : '   ') + 'Abrir arquivo com um clique', action: () => { S.singleClick = !S.singleClick; store.set('singleClick', S.singleClick); } },
    '-',
    { label: 'Trocar projeto…', icon: I.open, k: 'Alt+P', action: () => quickProject() },
    { label: 'Abrir…', icon: I.open, action: () => openProjectDialog() },
    ...(S.remote ? [] : [{ label: 'Novo projeto…', icon: I.newp, action: () => newProjectDialog() }]),
    { label: 'Lista de projetos', icon: TI.list, action: () => { S.showProjects = true; renderTool(); } },
    { label: 'Fechar projeto', icon: I.x, action: () => closeProject() },
  ], 'Projeto'); };
  body.innerHTML = '<div class="tree" id="treeRoot" tabindex="0" role="tree"></div>';
  bindTree($('#treeRoot'));
  let raf = 0; body.onscroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintTree(); }); };
  renderTree();
}
function renderProjectList() {
  const body = $('#toolBody');
  $('#toolActions').innerHTML = '<div class="seg"><button data-s="1" class="' + (S.sortRecent ? 'on' : '') + '">Recentes</button><button data-s="0" class="' + (S.sortRecent ? '' : 'on') + '">A-Z</button></div>' + (S.project ? `<button class="icon-btn" id="tBack" title="Voltar para a árvore de ${esc(S.project.name)}">${I.x}</button>` : '');
  $('#toolActions').querySelectorAll('button[data-s]').forEach(b => b.onclick = () => { S.sortRecent = b.dataset.s === '1'; store.set('sortRecent', S.sortRecent); renderTool(); });
  $('#tBack')?.addEventListener('click', () => { S.showProjects = false; renderTool(); });
  body.innerHTML = `<div class="rootbar"><input id="rootInput" value="${esc(S.root || '')}" title="Pasta com os projetos" spellcheck="false"><button class="icon-btn" id="rootGo" title="Abrir pasta"><svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>
    <div class="section">Projetos <span class="meta" id="projCount"></span></div><div id="projRows"></div>`;
  $('#rootGo').onclick = () => { S.root = $('#rootInput').value.trim(); loadProjects(); };
  $('#rootInput').addEventListener('keydown', e => e.key === 'Enter' && $('#rootGo').click());
  renderProjectRows();
}
function renderProjectRows() {
  const el = $('#projRows'); if (!el) return;
  $('#projCount').textContent = S.projects.length;
  el.innerHTML = sorted(S.projects, false).map(p => {
    const s = p.summary; const d = s && s.dirty;
    return `<div class="row ${S.project && S.project.path === p.path ? 'sel' : ''}" data-p="${esc(p.path)}" title="${esc(p.path)}">
      ${TI.module}<span class="name">${esc(p.name)}</span>
      <span class="meta">${d ? `<span class="dot" title="${d} alterações locais"></span>${d}` : ''}<span title="última alteração na pasta">${ago(p.mtime)}</span>${p.vcs ? `<span class="pill ${p.vcs}">${p.vcs}</span>` : ''}</span></div>`;
  }).join('') || '<div class="empty">Nenhuma pasta aqui.</div>';
  el.querySelectorAll('.row').forEach(r => { r.onclick = () => selectProject(r.dataset.p); r.oncontextmenu = (e) => projectMenu(e, S.projects.find(x => x.path === r.dataset.p)); });
}


// ===== Árvore do projeto (Project View do IntelliJ) =====
// Clique seleciona; duplo clique ou Enter abre. Setas navegam; esquerda/direita fecham e abrem pastas.
const treeKey = () => 'treeOpen:' + S.project.path;
function treeState() {
  if (!S.treeOpen || S.treeOpenFor !== S.project.path) { S.treeOpen = new Set(store.get(treeKey(), [''])); S.treeOpen.add(''); S.treeOpenFor = S.project.path; }
  return S.treeOpen;
}
const saveTreeOpen = () => store.set(treeKey(), [...S.treeOpen].slice(0, 400));
const treeLoading = new Map();
function loadDir(rel) {
  if (S.tree[rel]) return Promise.resolve(S.tree[rel]);
  if (treeLoading.has(rel)) return treeLoading.get(rel);
  const proj = S.project.path;
  const pr = api('tree', { project: proj, dir: rel, compact: S.compact ? '1' : '0', fresh: S.treeFresh && !rel ? '1' : null })
    .then(items => { if (S.project && S.project.path === proj) { S.tree[rel] = items; if (!rel) S.treeFresh = false; } return items; })
    .catch(e => { toast(e.message); if (S.project && S.project.path === proj) S.tree[rel] = []; return []; })
    .finally(() => treeLoading.delete(rel));
  treeLoading.set(rel, pr); return pr;
}
const childPath = (rel, it) => (rel ? rel + '/' : '') + (it.sub || it.name);
function treeRows() {
  const open = treeState(); const rows = [{ p: '', root: true, depth: 0, dir: true }]; const pending = [];
  const walk = (rel, depth) => {
    const items = S.tree[rel];
    if (!items) { rows.push({ loading: true, depth }); pending.push(rel); return; }
    if (!items.length && rel) rows.push({ empty: true, depth });
    for (const it of items) { const p = childPath(rel, it); rows.push({ it, p, depth, dir: it.dir }); if (it.dir && open.has(p)) walk(p, depth + 1); }
  };
  if (open.has('')) walk('', 1);
  return { rows, pending };
}
// cores e sublinhados: alterações locais (como o IntelliJ) e marcas dos plugins (ul: caminho -> { cls, tip }),
// ex.: um plugin de análise sublinha em ondulado vermelho/amarelo os arquivos e pastas com problemas
function treeMarks() {
  const chg = new Map(), chgDirs = new Set();
  S.workFiles.forEach(c => { chg.set(c.path, c.code); const ps = c.path.split('/'); for (let i = 1; i < ps.length; i++) chgDirs.add(ps.slice(0, i).join('/')); });
  return BS.hooks.apply('tree:marks', { chg, chgDirs, ul: new Map(), unsaved: unsavedPaths() });
}
const CHEV = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
function treeRowHtml(r, m, i) {
  const pos = `top:${i * TREE_ROW}px;`;
  if (r.loading) return `<div class="trow ghost" style="${pos}--d:${r.depth}"><span class="arrow"></span><span class="spin"></span><span class="name">carregando…</span></div>`;
  if (r.empty) return `<div class="trow ghost" style="${pos}--d:${r.depth}"><span class="arrow"></span><span class="name">vazio</span></div>`;
  const open = r.dir && S.treeOpen.has(r.p); const sel = S.treeSel === r.p;
  if (r.root) return `<div class="trow root ${open ? 'open' : ''} ${sel ? 'sel' : ''}" data-p="" data-dir="1" style="${pos}--d:0"><span class="arrow">${CHEV}</span>${TI.project}<span class="name mod">${esc(S.project.name)}</span><span class="path" title="${esc(S.project.path)}">${esc(S.project.path)}</span></div>`;
  const it = r.it; const code = !r.dir && m.chg.get(r.p); const ul = m.ul.get(r.p);
  const cls = ['name', code ? 'c-' + code : r.dir && m.chgDirs.has(r.p) ? 'c-M' : '', ul ? ul.cls : '', it.name.startsWith('.') ? 'dim' : '', it.module || (r.dir && it.kind === 'module') ? 'mod' : ''].filter(Boolean).join(' ');
  const tip = r.p + (it.kind && KIND_PT[it.kind] ? '  ·  ' + KIND_PT[it.kind] : '') + (it.java ? '  ·  ' + (JAVA_PT[it.java] || it.java) : '') + (ul && ul.tip ? '  ·  ' + ul.tip : '');
  return `<div class="trow ${open ? 'open' : ''} ${sel ? 'sel' : ''} ${m.unsaved.has(r.p) ? 'unsaved' : ''}" data-p="${esc(r.p)}"${r.dir ? ' data-dir="1"' : ''} style="${pos}--d:${r.depth}" title="${esc(tip)}"><span class="arrow">${r.dir ? CHEV : ''}</span>${treeIcon(it)}<span class="${cls}">${esc(it.label || it.name)}</span>${it.vcs ? `<span class="pill ${it.vcs}">${it.vcs}</span>` : ''}</div>`;
}
const KIND_PT = { module: 'módulo', src: 'código-fonte', test: 'testes', res: 'resources', testres: 'resources de teste', web: 'web', package: 'pacote' };
const JAVA_PT = { class: 'classe', abstract: 'classe abstrata', interface: 'interface', enum: 'enum', annotation: 'anotação', record: 'record', exception: 'exceção' };
// Árvore virtualizada: só as linhas visíveis (mais uma margem) ficam no DOM; projetos grandes abrem e rolam sem travar.
const TREE_ROW = 24;
function renderTree() {
  const el = $('#treeRoot'); if (!el || !S.project) return;
  const { rows, pending } = treeRows();
  S.treeRowsAll = rows; S.treeRowsCache = rows.filter(r => !r.loading && !r.empty);
  S.treeMarks = treeMarks();
  el.style.height = rows.length * TREE_ROW + 'px';
  paintTree();
  if (pending.length) Promise.all(pending.map(loadDir)).then(() => renderTree());
}
function paintTree() {
  const el = $('#treeRoot'), body = $('#toolBody'); if (!el || !S.treeRowsAll) return;
  const rows = S.treeRowsAll; const top = Math.max(0, body.scrollTop - el.offsetTop);
  const a = Math.max(0, Math.floor(top / TREE_ROW) - 15), b = Math.min(rows.length, Math.ceil((top + body.clientHeight) / TREE_ROW) + 15);
  let html = ''; for (let i = a; i < b; i++) html += treeRowHtml(rows[i], S.treeMarks, i);
  el.innerHTML = html;
}
const rowOf = (p) => [...document.querySelectorAll('#treeRoot .trow[data-p]')].find(r => r.dataset.p === p);
function treeSelect(p, scroll) {
  S.treeSel = p;
  if (scroll && S.treeRowsAll) {
    const i = S.treeRowsAll.findIndex(r => r.p === p && !r.loading && !r.empty); const body = $('#toolBody'); const el = $('#treeRoot');
    if (i >= 0 && body && el) {
      const y = el.offsetTop + i * TREE_ROW;
      if (scroll === 'center') body.scrollTop = y - body.clientHeight / 2;
      else if (y < body.scrollTop) body.scrollTop = y;
      else if (y + TREE_ROW > body.scrollTop + body.clientHeight) body.scrollTop = y + TREE_ROW - body.clientHeight;
      paintTree(); return;
    }
  }
  document.querySelectorAll('#treeRoot .trow.sel').forEach(r => r.classList.remove('sel'));
  rowOf(p)?.classList.add('sel');
}
function treeToggle(p, force) {
  treeState(); const open = force != null ? force : !S.treeOpen.has(p);
  if (open) S.treeOpen.add(p); else S.treeOpen.delete(p);
  saveTreeOpen(); renderTree();
}
function treeActivate(p) {
  const r = S.treeRowsCache.find(x => x.p === p); if (!r) return;
  if (r.dir) treeToggle(p); else openFile(p, 'editor');
}
function bindTree(el) {
  const rowFrom = (e) => { const r = e.target.closest('.trow[data-p]'); return r && !r.classList.contains('ghost') ? r : null; };
  el.onclick = (e) => {
    const row = rowFrom(e); if (!row) return; const p = row.dataset.p;
    treeSelect(p); el.focus({ preventScroll: true });
    // pasta: todo clique abre/fecha, por mais rápido que venha; "Abrir arquivo com um clique" vale só para arquivos
    if (row.dataset.dir) treeToggle(p);
    else if (S.singleClick) treeActivate(p);
  };
  el.ondblclick = (e) => { const row = rowFrom(e); if (!row || row.dataset.dir || S.singleClick) return; treeActivate(row.dataset.p); };
  el.oncontextmenu = (e) => {
    const row = rowFrom(e); if (!row) return; const p = row.dataset.p; treeSelect(p);
    if (!p) return projectMenu(e, S.project);
    const r = S.treeRowsCache.find(x => x.p === p);
    fileMenu(e, p, !!row.dataset.dir, r && r.it && r.it.vcs);
  };
  el.onkeydown = (e) => {
    const rows = S.treeRowsCache; if (!rows || !rows.length) return;
    let i = rows.findIndex(r => r.p === S.treeSel); const cur = rows[i];
    const go = (j) => { if (rows[j]) treeSelect(rows[j].p, true); };
    if (e.key === 'ArrowDown') go(i < 0 ? 0 : Math.min(rows.length - 1, i + 1));
    else if (e.key === 'ArrowUp') go(i < 0 ? 0 : Math.max(0, i - 1));
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'ArrowRight' && cur && cur.dir) { if (!S.treeOpen.has(cur.p)) treeToggle(cur.p, true); else go(i + 1); }
    else if (e.key === 'ArrowLeft' && cur) {
      if (cur.dir && S.treeOpen.has(cur.p)) treeToggle(cur.p, false);
      else { for (let j = i - 1; j >= 0; j--) if (rows[j].depth < cur.depth) { go(j); break; } }
    }
    else if ((e.key === 'Enter' || e.key === 'F4') && cur) treeActivate(cur.p);
    else if (e.key === 'Delete' && cur && cur.p && !S.remote) deletePath(cur.p, !!cur.dir);
    else return;
    e.preventDefault();
  };
}
// abre a árvore até uma pasta (trilha do editor)
async function treeReveal(target) {
  if (!S.project) return; treeState(); S.showProjects = false;
  if (target) {
    let rel = '';
    for (let i = 0; i < 60; i++) {
      const items = await loadDir(rel);
      const hit = items.find(it => { const p = childPath(rel, it); return p === target || (it.dir && (target.startsWith(p + '/') || p.startsWith(target + '/'))); });
      if (!hit) break;
      const p = childPath(rel, hit); S.treeOpen.add(p);
      // pasta no meio de uma cadeia compactada (a/b/c): seleciona a linha agrupada
      if (p !== target && p.startsWith(target + '/')) { target = p; break; }
      if (p === target) break; rel = p;
    }
  }
  saveTreeOpen(); S.treeSel = target;
  if (S.tool !== 'project' || $('#app').classList.contains('no-tool')) openTool('project'); else renderTree();
  treeSelect(target, 'center'); $('#treeRoot')?.focus({ preventScroll: true });
}
// "Select Opened File" do IntelliJ: abre as pastas até o arquivo da aba ativa e seleciona
async function treeLocate() {
  if (!S.project) return;
  if (!S.active || S.active.project !== S.project.path) return toast('Nenhum arquivo deste projeto aberto');
  const target = S.active.path; treeState(); S.showProjects = false;
  let rel = '';
  for (let i = 0; i < 60; i++) {
    const items = await loadDir(rel);
    const hit = items.find(it => { const p = childPath(rel, it); return p === target || (it.dir && target.startsWith(p + '/')); });
    if (!hit) break;
    const p = childPath(rel, hit); if (p === target) break;
    S.treeOpen.add(p); rel = p;
  }
  saveTreeOpen(); S.treeSel = target;
  if (S.tool !== 'project' || $('#app').classList.contains('no-tool')) openTool('project'); else renderTree();
  treeSelect(target, 'center'); $('#treeRoot')?.focus({ preventScroll: true });
}

// ===== Ícones da árvore (traço fino, cores do IntelliJ New UI) =====
const FOLDER = 'M1.5 4a1 1 0 0 1 1-1h3.3l1.5 1.6h6.2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z';
const tsvg = (b, t) => `<svg class="ti" viewBox="0 0 16 16"${t ? ` aria-label="${t}"` : ''}>${b}</svg>`;
const fold = (c, fill) => `<path d="${FOLDER}" fill="${fill ? c : 'none'}" fill-opacity="${fill ? .22 : 0}" stroke="${c}" stroke-width="1.1" stroke-linejoin="round"/>`;
const TI = {
  dir: tsvg(fold('var(--ico)')),
  package: tsvg(fold('var(--ico)') + '<circle cx="8" cy="8.6" r="1.6" fill="var(--ico)"/>'),
  module: tsvg(fold('var(--ico)') + '<rect x="9.3" y="8.3" width="4.4" height="4.4" rx=".8" fill="var(--ico-src)"/>'),
  project: tsvg(fold('var(--ico-src)', true) + '<rect x="9.3" y="8.3" width="4.4" height="4.4" rx=".8" fill="var(--ico-src)"/>'),
  src: tsvg(fold('var(--ico-src)', true)),
  test: tsvg(fold('var(--ico-test)', true)),
  res: tsvg(fold('var(--ico-res)') + '<path d="M4.5 8h7M4.5 10.3h7" stroke="var(--ico-res)" stroke-width="1.1"/>'),
  testres: tsvg(fold('var(--ico-test)') + '<path d="M4.5 8h7M4.5 10.3h7" stroke="var(--ico-test)" stroke-width="1.1"/>'),
  web: tsvg(fold('var(--ico-web)') + '<circle cx="8" cy="8.7" r="2.4" fill="none" stroke="var(--ico-web)" stroke-width="1"/><path d="M5.6 8.7h4.8" stroke="var(--ico-web)" stroke-width=".9"/>'),
  locate: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  collapse: '<svg class="i" viewBox="0 0 24 24"><path d="M7 4l5 5 5-5M7 20l5-5 5 5"/></svg>',
  more: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>',
  list: '<svg class="i" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
};
const JAVA_IC = { class: ['C', 'var(--j-class)'], abstract: ['C', 'var(--j-class)'], exception: ['C', 'var(--j-exc)'], interface: ['I', 'var(--j-int)'], enum: ['E', 'var(--j-enum)'], annotation: ['@', 'var(--j-int)'], record: ['R', 'var(--j-class)'] };
const FILE_IC = [
  [/^pom\.xml$/i, 'm', 'var(--j-exc)'], [/\.(xml|xsd|wsdl|xsl|xslt|tld|jrxml|xmi|dtd)$/i, '<>', 'var(--ico-res)'], [/\.(jsp|jspf|jsf|xhtml|html?|vue|ftl|vm)$/i, '<>', 'var(--j-exc)'],
  [/\.(js|mjs|cjs|jsx)$/i, 'JS', '#C9A227'], [/\.tsx?$/i, 'TS', 'var(--ico-src)'], [/\.(css|scss|less|sass)$/i, '#', 'var(--j-enum)'], [/\.json$/i, '{}', 'var(--ico-res)'],
  [/\.(properties|ya?ml|ini|toml|conf|cfg|env|factorypath|classpath|project|prefs|editorconfig|gitignore)$|^\.?(classpath|project|gitignore)$/i, '≡', 'var(--ico)'],
  [/\.(md|markdown|txt|adoc|log)$/i, '¶', 'var(--ico-src)'], [/\.sql$/i, 'DB', 'var(--ico-web)'], [/\.(sh|bat|cmd|ps1|vbs)$/i, '>_', 'var(--ico-test)'],
  [/\.(jar|war|ear|zip|gz|tar|7z|rar)$/i, '▤', 'var(--ico)'], [/\.(png|jpe?g|gif|svg|ico|webp|bmp)$/i, '◆', 'var(--ico-web)'], [/\.(java|kt|groovy|scala|class)$/i, 'J', 'var(--ico-res)'],
];
function treeIcon(it) {
  if (it.dir) return TI[it.kind] || TI.dir;
  if (it.java) {
    const [l, c] = JAVA_IC[it.java] || JAVA_IC.class;
    return tsvg(`<circle cx="8" cy="8" r="6.3" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="1.1"${it.java === 'abstract' ? ' stroke-dasharray="2.2 1.6"' : ''}/><text x="8" y="10.9" text-anchor="middle" font-size="8.2" font-weight="700" fill="${c}" font-family="Inter,Segoe UI,sans-serif">${l}</text>${it.test ? '<circle cx="13" cy="13" r="2.4" fill="var(--ico-test)"/>' : ''}`, it.java);
  }
  const f = FILE_IC.find(([re]) => re.test(it.name));
  const doc = '<path d="M3.5 1.5h5.6l3.4 3.4v9.6h-9z" fill="none" stroke="var(--ico)" stroke-width="1.05" stroke-linejoin="round"/><path d="M9 1.6v3.4h3.4" fill="none" stroke="var(--ico)" stroke-width="1.05"/>';
  if (!f) return tsvg(doc);
  const [, l, c] = f;
  return tsvg(doc + `<text x="8" y="12.6" text-anchor="middle" font-size="${l.length > 1 ? 5.4 : 6.6}" font-weight="800" fill="${c}" font-family="Inter,Segoe UI,sans-serif">${esc(l)}</text>`);
}

// ----- Alterações: navegar commit a commit e revisar arquivo a arquivo -----
// O commit mostrado é S.log[i] (S.rev vazio = o último). Commits grandes: os arquivos vão de um em um (Alt+← / Alt+→),
// cada diff aberto fica marcado como visto, as pastas recolhem e um filtro corta a lista. Vale para Git e SVN.
const commitIx = () => S.rev ? S.log.findIndex(l => l.id === S.rev) : 0;
async function moreLog(n = 50) {
  const more = await api('log', { project: S.project.path, n: S.log.length + n }).catch(() => null);
  if (!more || more.length <= S.log.length) return false;
  S.log = more; S.logN = more.length; return true;
}
async function goCommit(ix) {
  if (!S.project || !S.project.vcs) return;
  if (ix < 0) return toast('Este já é o commit mais recente');
  if (ix >= S.log.length && !(await moreLog())) return toast('Não há commits mais antigos');
  const c = S.log[ix]; if (!c) return;
  const reviewing = S.active && S.active.preview && S.active.mode === 'diff';
  // os diffs de commit são só leitura: as abas de prévia do commit anterior saem para não acumular
  S.tabs.filter(t => t.preview && t.mode === 'diff' && t.changeMode === 'last' && !t.dirty).forEach(closeTab);
  S.rev = ix === 0 ? null : c.id; S.changeMode = 'last'; store.set('changeMode', 'last'); S.chgPick = false;
  await refreshProject();
  if (S.tool !== 'changes' || $('#app').classList.contains('no-tool')) openTool('changes');
  if (reviewing) stepFile(1); // estava revisando: já abre o primeiro arquivo do commit novo
}
// arquivos na mesma ordem da lista (pasta, depois nome), já com o filtro
function chgGroups() {
  const f = (S.chgFilter || '').toLowerCase(); const g = {};
  S.changes.filter(c => !f || c.path.toLowerCase().includes(f)).forEach(c => { const i = c.path.lastIndexOf('/'); const d = i < 0 ? '' : c.path.slice(0, i); (g[d] = g[d] || []).push(c); });
  return Object.keys(g).sort().map(d => [d, g[d]]);
}
const chgList = () => chgGroups().flatMap(([, l]) => l);
// a aba ativa é um diff da lista que está na tela (mesmo modo e mesmo commit)?
const tabInList = (t = S.active) => !!t && t.mode === 'diff' && t.changeMode === S.changeMode && (t.rev || null) === (S.rev || null);
// vistos por commit (guarda os 60 mais recentes)
const SEEN = store.get('chgSeen', {});
const seenKey = (rev = S.rev) => S.project.path + '|' + (rev || S.log[0]?.id || 'HEAD');
const seenOf = (rev) => new Set(SEEN[seenKey(rev)] || []);
function markSeen(path, rev, on = true) {
  const k = seenKey(rev); const s = new Set(SEEN[k] || []); if (on === s.has(path)) return;
  on ? s.add(path) : s.delete(path); delete SEEN[k]; if (s.size) SEEN[k] = [...s];
  const ks = Object.keys(SEEN); ks.slice(0, Math.max(0, ks.length - 60)).forEach(x => delete SEEN[x]);
  store.set('chgSeen', SEEN);
}
// abre o arquivo seguinte/anterior; a aba de prévia de antes é trocada (não empilha 200 abas num commit grande)
async function stepFile(dir, unseen) {
  if (!S.project || !S.project.vcs) return;
  const list = chgList(); if (!list.length) return toast('Nenhum arquivo nesta lista');
  const prev = S.active; const cur = tabInList(prev) ? list.findIndex(c => c.path === prev.path) : -1;
  let next;
  if (unseen) { const seen = seenOf(); next = list.slice(cur + 1).concat(list.slice(0, cur + 1)).find(c => !seen.has(c.path)); if (!next) return toast('Todos os arquivos já foram vistos'); }
  else if (cur < 0) next = dir > 0 ? list[0] : list[list.length - 1];
  else next = list[cur + dir];
  if (!next) return toast(dir > 0 ? (S.changeMode === 'last' ? 'Último arquivo do commit. Alt+PageDown: commit anterior' : 'Último arquivo') : 'Primeiro arquivo');
  await openFile(next.path, 'diff', undefined, true);
  if (prev && prev !== S.active && prev.preview && prev.mode === 'diff' && !prev.dirty && S.tabs.includes(prev)) closeTab(prev);
  $('#toolBody .row.chg.sel')?.scrollIntoView({ block: 'nearest' });
}
function renderChanges() {
  const body = $('#toolBody');
  if (!S.project) { body.innerHTML = '<div class="empty">Escolha um projeto.</div>'; return; }
  if (!S.project.vcs) { body.innerHTML = '<div class="empty">Esta pasta não tem Git nem SVN.</div>'; return; }
  const isLast = S.changeMode === 'last';
  $('#toolActions').innerHTML = `<div class="seg"><button data-m="working" class="${!isLast ? 'on' : ''}">Local</button><button data-m="last" class="${isLast ? 'on' : ''}">Commit</button></div>`;
  $('#toolActions').querySelectorAll('button[data-m]').forEach(b => b.onclick = async () => { S.changeMode = b.dataset.m; store.set('changeMode', S.changeMode); if (S.changeMode === 'working') S.rev = null; S.chgPick = false; await refreshProject(); });
  const ix = commitIx(); const c = isLast ? (ix >= 0 ? S.log[ix] : null) || (!S.rev && S.summary && S.summary.last) : null;
  const chev = (d) => `<svg class="i" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const more = S.log.length >= (S.logN || 30);
  // navegador de commits: ‹ mais novo | commit atual (clique: escolher outro) | mais antigo ›
  const head = !isLast ? '' : `<div class="cnav">
      <button class="icon-btn" id="cNewer" title="Commit mais novo (Alt+PageUp)" ${ix <= 0 ? 'disabled' : ''}>${chev('M15 6l-6 6 6 6')}</button>
      <button class="cpick ${S.chgPick ? 'on' : ''}" id="cPick" title="Escolher o commit">${c ? `<div class="subj">${esc(c.subject)}</div><div class="m"><code>${esc(c.hash)}</code><span>${esc(c.author)}</span><span>${esc(c.when)}</span>${ix >= 0 ? `<span class="pos">${ix + 1}/${S.log.length}${more ? '+' : ''}</span>` : ''}</div>` : '<div class="subj">Sem commits</div>'}</button>
      <button class="icon-btn" id="cOlder" title="Commit mais antigo (Alt+PageDown)" ${ix >= S.log.length - 1 && !more ? 'disabled' : ''}>${chev('M9 6l6 6-6 6')}</button>
    </div>${S.chgPick ? `<div class="clist">${S.log.map((l, i) => `<div class="commit ${i === ix ? 'sel' : ''}" data-i="${i}"><div class="subj" title="${esc(l.subject)}">${esc(l.subject)}</div><div class="m"><code>${esc(l.hash)}</code><span>${esc(l.author)}</span><span>${esc(l.when)}</span></div></div>`).join('')}${more ? '<div class="row more" id="cMore"><span class="name">Carregar mais antigos…</span></div>' : ''}</div>` : ''}`;
  const groups = chgGroups(); const shown = groups.reduce((n, [, l]) => n + l.length, 0);
  const seen = isLast ? seenOf() : new Set(); const nSeen = isLast ? S.changes.filter(x => seen.has(x.path)).length : 0;
  const fold = S.chgFold || (S.chgFold = new Set());
  const rows = groups.map(([d, list]) => {
    const closed = fold.has(d) && !S.chgFilter;
    return `${d ? `<div class="section dir ${closed ? 'closed' : ''}" data-d="${esc(d)}" title="${esc(d)}">${chev(closed ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6')}<span class="dn">${esc(d)}</span><span class="meta">${list.length}</span></div>` : ''}${closed ? '' : list.map(x => `<div class="row chg ${tabInList() && S.active.path === x.path ? 'sel' : ''} ${unsavedPaths().has(x.path) ? 'unsaved' : ''} ${seen.has(x.path) ? 'seen' : ''}" data-p="${esc(x.path)}" title="${esc(x.path)}"><span class="st ${esc(x.code)}">${esc(x.code)}</span><span class="name c-${esc(x.code.replace('?', '\\?'))}">${esc(x.path.split('/').pop())}</span><span class="meta">${statHtml(x)}${isLast ? `<span class="ck" title="${seen.has(x.path) ? 'Visto (clique para desmarcar)' : 'Marcar como visto'}">${I.lint}</span>` : ''}</span></div>`).join('')}`;
  }).join('');
  const tot = S.changes.reduce((a, x) => ({ add: a.add + (x.add || 0), del: a.del + (x.del || 0) }), { add: 0, del: 0 });
  const many = S.changes.length > 12;
  const tools = S.changes.length ? `<div class="ctools">
      ${many || S.chgFilter ? `<input id="chgFilter" placeholder="Filtrar arquivos…" value="${esc(S.chgFilter || '')}" spellcheck="false">` : '<span style="flex:1"></span>'}
      ${isLast ? `<span class="prog" title="Arquivos vistos neste commit"><i style="width:${Math.round(nSeen * 100 / S.changes.length)}%"></i></span><span class="pn" title="Arquivos vistos neste commit">${nSeen}/${S.changes.length}</span>` : ''}
      <button class="icon-btn" id="chgPrev" title="Arquivo anterior (Alt+←)">${chev('M15 6l-6 6 6 6')}</button>
      <button class="icon-btn" id="chgNext" title="${isLast ? 'Próximo arquivo não visto' : 'Próximo arquivo'} (Alt+→)">${chev('M9 6l6 6-6 6')}</button>
      ${groups.length > 1 ? `<button class="icon-btn" id="chgFold" title="${fold.size ? 'Expandir pastas' : 'Recolher pastas'}">${fold.size ? chev('M7 9l5-5 5 5M7 15l5 5 5-5') : TI.collapse}</button>` : ''}
    </div>` : '';
  body.innerHTML = head + `<div class="section">${isLast ? 'Arquivos do commit' : 'Não commitado'} <span class="meta">${statHtml(tot)} ${S.chgFilter ? shown + ' de ' : ''}${S.changes.length}</span></div>` + tools + (rows || `<div class="empty">${S.chgFilter ? 'Nenhum arquivo com esse nome.' : 'Nada por aqui. Tudo limpo.'}</div>`);
  if (isLast) {
    $('#cNewer').onclick = () => goCommit(commitIx() - 1);
    $('#cOlder').onclick = () => goCommit(commitIx() + 1);
    $('#cPick').onclick = () => { S.chgPick = !S.chgPick; renderChanges(); if (S.chgPick) $('#toolBody .clist .commit.sel')?.scrollIntoView({ block: 'center' }); };
    $('#cPick').oncontextmenu = (e) => c && c.id && commitMenu(e, c);
    body.querySelectorAll('.clist .commit').forEach(el => { el.onclick = () => goCommit(+el.dataset.i); el.oncontextmenu = (e) => commitMenu(e, S.log[+el.dataset.i]); });
    const m = $('#cMore'); if (m) m.onclick = async () => { if (await moreLog()) renderChanges(); else { toast('Não há commits mais antigos'); m.remove(); } };
  }
  const fi = $('#chgFilter');
  if (fi) {
    fi.oninput = () => { const pos = fi.selectionStart; S.chgFilter = fi.value; renderChanges(); const n = $('#chgFilter'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    fi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFile(1); } if (e.key === 'Escape' && fi.value) { e.stopPropagation(); S.chgFilter = ''; renderChanges(); } };
  }
  if ($('#chgPrev')) { $('#chgPrev').onclick = () => stepFile(-1); $('#chgNext').onclick = () => stepFile(1, isLast); }
  if ($('#chgFold')) $('#chgFold').onclick = () => { if (fold.size) fold.clear(); else groups.forEach(([d]) => d && fold.add(d)); renderChanges(); };
  body.querySelectorAll('.section.dir').forEach(el => el.onclick = () => { const d = el.dataset.d; fold.has(d) ? fold.delete(d) : fold.add(d); renderChanges(); });
  body.querySelectorAll('.row.chg').forEach(r => {
    r.onclick = (e) => { if (e.target.closest('.ck')) { e.stopPropagation(); markSeen(r.dataset.p, S.rev, !r.classList.contains('seen')); renderChanges(); return; } openFile(r.dataset.p, 'diff', undefined, true); };
    r.oncontextmenu = (e) => fileMenu(e, r.dataset.p, false);
  });
}
function renderHistory() {
  const body = $('#toolBody');
  if (!S.project || !S.project.vcs) { body.innerHTML = '<div class="empty">Sem histórico.</div>'; return; }
  body.innerHTML = (S.log.map(c => `<div class="commit ${S.rev === c.id || (!S.rev && S.changeMode === 'last' && S.log[0] === c) ? 'sel' : ''}" data-id="${esc(c.id)}"><div class="subj" title="${esc(c.subject)}">${esc(c.subject)}</div><div class="m"><code>${esc(c.hash)}</code><span>${esc(c.author)}</span><span>${esc(c.when)}</span></div></div>`).join('') + (S.log.length >= (S.logN || 30) ? '<div class="row more" id="histMore"><span class="name">Carregar mais antigos…</span></div>' : '')) || '<div class="empty">Sem commits.</div>';
  const hm = $('#histMore'); if (hm) hm.onclick = async () => { if (await moreLog()) renderHistory(); else { toast('Não há commits mais antigos'); hm.remove(); } };
  body.querySelectorAll('.commit').forEach(el => {
    el.onclick = () => goCommit(S.log.findIndex(c => c.id === el.dataset.id));
    el.oncontextmenu = (e) => commitMenu(e, S.log.find(c => c.id === el.dataset.id));
  });
}

// ===== Editor / abas =====
function ensureEditors() {
  const mon = $('#mon');
  if (!editor) {
    const d = document.createElement('div'); d.id = 'ed'; mon.appendChild(d);
    editor = monaco.editor.create(d, editorOpts());
    editor.onDidChangeCursorPosition(e => $('#stPos').textContent = `${e.position.lineNumber}:${e.position.column}`);
    editor.onDidChangeModelContent(() => markDirty(editor.getModel()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    editor.addAction({ id: 'bs.diff', label: 'Ver diff', contextMenuGroupId: 'navigation', contextMenuOrder: 0, run: () => S.active && openFile(S.active.path, 'diff') });
    editor.addAction({ id: 'bs.lint', label: 'Lint', contextMenuGroupId: 'navigation', contextMenuOrder: 1, run: () => runLint() });
    editor.addAction({ id: 'bs.present', label: 'Apresentar', contextMenuGroupId: 'navigation', contextMenuOrder: 2, run: () => present(true) });
  }
  if (!diffEditor) {
    const d = document.createElement('div'); d.id = 'dd'; mon.appendChild(d);
    diffEditor = monaco.editor.createDiffEditor(d, { ...editorOpts(), renderSideBySide: !S.inline, originalEditable: false, renderIndicators: true, ignoreTrimWhitespace: false, diffWordWrap: S.wrap ? 'on' : 'off', renderOverviewRuler: false, renderGutterMenu: false, useInlineViewWhenSpaceIsLimited: false });
    diffEditor.getModifiedEditor().onDidChangeCursorPosition(e => $('#stPos').textContent = `${e.position.lineNumber}:${e.position.column}`);
    diffEditor.getModifiedEditor().onDidChangeModelContent(() => { const m = diffEditor.getModifiedEditor().getModel(); if (m && m._tab) m._tab.preview = false; markDirty(m); });
    diffEditor.getModifiedEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    diffEditor.getModifiedEditor().addAction({ id: 'bs.edit', label: 'Abrir como editor', contextMenuGroupId: 'navigation', contextMenuOrder: 0, run: () => S.active && openFile(S.active.path, 'editor') });
    diffEditor.getModifiedEditor().addAction({ id: 'bs.inline', label: 'Lado a lado / em linha', contextMenuGroupId: 'navigation', contextMenuOrder: 1, run: () => $('#btnInline').click() });
    diffEditor.getModifiedEditor().addAction({ id: 'bs.present2', label: 'Apresentar', contextMenuGroupId: 'navigation', contextMenuOrder: 2, run: () => present(true) });
    diffEditor.onDidUpdateDiff(() => updateDiffInfo());
    $('#diffInfo').innerHTML = '<span id="diffStat"></span><button class="icon-btn" id="diffPrev" title="Alteração anterior (Alt+↑)"><svg class="i" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button><button class="icon-btn" id="diffNext" title="Próxima alteração (Alt+↓)"><svg class="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><span id="diffFile"><button class="icon-btn" id="fileePrev" title="Arquivo anterior (Alt+←)"><svg class="i" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><span id="diffFileN"></span><button class="icon-btn" id="fileeNext" title="Próximo arquivo (Alt+→)"><svg class="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></span>';
    $('#diffPrev').onclick = () => goDiff('previous'); $('#diffNext').onclick = () => goDiff('next');
    $('#fileePrev').onclick = () => stepFile(-1); $('#fileeNext').onclick = () => stepFile(1);
    BS.hooks.run('editor:ready', editor, diffEditor); // plugins acrescentam comandos e ações aos dois editores
  }
}
function goDiff(dir) {
  if (!diffEditor || viewer !== 'diff') return;
  try { diffEditor.goToDiff(dir); diffEditor.getModifiedEditor().focus(); return; } catch {}
  const ch = diffEditor.getLineChanges() || []; if (!ch.length) return;
  const cur = diffEditor.getModifiedEditor().getPosition().lineNumber;
  const next = dir === 'next' ? (ch.find(c => c.modifiedStartLineNumber > cur) || ch[0]) : (ch.slice().reverse().find(c => c.modifiedStartLineNumber < cur) || ch[ch.length - 1]);
  const ln = next.modifiedStartLineNumber || 1; diffEditor.getModifiedEditor().revealLineInCenter(ln); diffEditor.getModifiedEditor().setPosition({ lineNumber: ln, column: 1 }); diffEditor.getModifiedEditor().focus();
}
function updateDiffInfo() {
  const el = $('#diffInfo'); if (!S.active || S.active.mode !== 'diff') { el.hidden = true; return; }
  el.hidden = false; const ch = diffEditor.getLineChanges() || [];
  let add = 0, del = 0; ch.forEach(c => { if (c.modifiedEndLineNumber) add += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1; if (c.originalEndLineNumber) del += c.originalEndLineNumber - c.originalStartLineNumber + 1; });
  $('#diffStat').innerHTML = `${statHtml({ add, del })} <span>${ch.length} ${ch.length === 1 ? 'alteração' : 'alterações'}</span>`;
  const list = tabInList() ? chgList() : []; const fi = list.findIndex(c => c.path === S.active.path);
  $('#diffFile').hidden = fi < 0; if (fi >= 0) $('#diffFileN').textContent = `arquivo ${fi + 1}/${list.length}`;
}
function tabKey(path, mode) { return path + '::' + (mode === 'diff' ? S.changeMode + ':' + (S.rev || '') : 'editor'); }
// preview: aberta pela lista de Alterações; ao andar para o próximo arquivo, ela é trocada em vez de empilhar
async function openFile(path, mode, line, preview) {
  ensureEditors();
  // imagens, PDF, áudio, vídeo, fontes e binários conhecidos abrem no visualizador (viewer.js)
  const vk = mode !== 'diff' && BS.fileViewer && BS.fileViewer.kind(path);
  if (vk) return BS.fileViewer.open(path, vk, line);
  const key = tabKey(path, mode);
  let tab = S.tabs.find(t => t.key === key);
  if (!tab) {
    tab = { key, path, mode, project: S.project.path, lang: langOf(path), changeMode: S.changeMode, rev: S.rev };
    try {
      if (mode === 'diff') {
        const d = await api('diff', { project: S.project.path, file: path, mode: S.changeMode, rev: S.rev });
        tab.original = monaco.editor.createModel(d.original, tab.lang);
        tab.model = monaco.editor.createModel(d.modified, tab.lang, monaco.Uri.parse('bs:/' + encodeURIComponent(tab.key)));
        tab.editable = S.changeMode === 'working';
      } else {
        const f = await api('file', { project: S.project.path, file: path });
        if (f.binary) return BS.fileViewer ? BS.fileViewer.open(path, 'hex') : toast('Arquivo binário');
        if (f.tooBig) return BS.fileViewer ? BS.fileViewer.openBig(path, f.size, line) : toast('Arquivo grande demais');
        tab.model = monaco.editor.createModel(f.content, tab.lang, monaco.Uri.parse('bs:/' + encodeURIComponent(tab.key)));
        tab.editable = true; tab.stamp = f.mtime + ':' + f.size; // data/tamanho no disco: base para notar alterações de fora
        if (S.project.vcs && S.changes.some(c => c.path === path && c.code !== '?')) {
          api('diff', { project: S.project.path, file: path, mode: 'working' }).then(d => { tab.base = d.original; gutterMarks(tab); }).catch(() => {});
        }
      }
      tab.saved = tab.model.getValue(); tab.model._tab = tab;
    } catch (e) { toast(e.message); return; }
    tab.preview = !!preview;
    S.tabs.push(tab); BS.hooks.run('tab:open', tab); liveLintSoon(tab, 0);
  } else if (!preview) tab.preview = false; // aberta de propósito por outro caminho: fica
  if (tab.mode === 'diff' && tab.changeMode === 'last') markSeen(path, tab.rev);
  activate(tab); seRemember(path);
  if (line) revealAt(tab.mode === 'diff' ? diffEditor.getModifiedEditor() : editor, line);
}
// O editor acabou de sair de display:none: sem layout() o Monaco ainda acha que tem altura 0 e não rola.
// Repete depois do próximo frame (o diff recalcula as linhas de forma assíncrona) e pisca a linha de destino.
function revealAt(ed, line, col = 1) {
  const n = Math.max(1, Math.min(line, ed.getModel() ? ed.getModel().getLineCount() : line));
  const go = () => { ed.layout(); ed.setPosition({ lineNumber: n, column: col }); ed.revealLineInCenter(n, monaco.editor.ScrollType.Immediate); };
  go(); requestAnimationFrame(go); setTimeout(go, 120);
  ed.focus();
  const ids = ed.deltaDecorations([], [{ range: new monaco.Range(n, 1, n, 1), options: { isWholeLine: true, className: 'flash-line' } }]);
  setTimeout(() => ed.deltaDecorations(ids, []), 1500);
}
function activate(tab) {
  if (S.active && S.active !== tab) autoSaveAll(); // trocar de aba salva as outras
  S.active = tab; viewer = tab.mode;
  $('#welcome').hidden = true;
  $('#ed').style.display = tab.mode === 'editor' ? '' : 'none';
  $('#dd').style.display = tab.mode === 'diff' ? '' : 'none';
  $('#vw').style.display = tab.mode === 'view' ? '' : 'none';
  if (tab.mode === 'view') BS.fileViewer.show(tab);
  else if (tab.mode === 'diff') { diffEditor.setModel({ original: tab.original, modified: tab.model }); diffEditor.getModifiedEditor().updateOptions({ readOnly: !tab.editable }); diffEditor.getModifiedEditor().focus(); }
  else { editor.setModel(tab.model); editor.updateOptions({ readOnly: !tab.editable }); editor.focus(); if (tab.base) gutterMarks(tab); }
  $('#stLang').textContent = tab.lang;
  renderTabs(); renderCrumbs(); lintMarkers(tab); updateDiffInfo(); syncUnsaved();
  if (S.tool === 'changes') renderChanges();
  BS.hooks.run('tab:activate', tab); // plugins decoram o editor (ex.: linhas com problemas apontados por um plugin)
}
function renderTabs() {
  $('#editor').classList.toggle('no-tabs', !S.tabs.length);
  $('#tabs').innerHTML = S.tabs.map(t => `<div class="tab ${t === S.active ? 'on' : ''} ${t.dirty ? 'dirty' : ''} ${t.conflict || t.gone ? 'ext-c' : ''}" data-k="${esc(t.key)}" title="${esc(t.path)}" draggable="true" role="tab">${treeIcon({ name: t.path.split('/').pop() })}${t.mode === 'diff' ? `<span class="mode${t.owner ? ' ext' : ''}">${t.owner ? 'EXTERNO' : t.changeMode === 'working' ? 'DIFF' : 'COMMIT'}</span>` : ''}<span class="nm${t.project === S.project?.path ? codeCls(t.path) : ''}">${esc(t.path.split('/').pop())}</span><button class="x" title="${t.dirty ? 'Não salvo. Fechar' : 'Fechar'}"><svg class="i" viewBox="0 0 24 24" style="width:12px;height:12px"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach(el => {
    const t = S.tabs.find(x => x.key === el.dataset.k);
    el.onclick = (e) => e.shiftKey ? askClose(t) : activate(t);
    el.querySelector('.x').onclick = (e) => { e.stopPropagation(); askClose(t); };
    el.onauxclick = (e) => { if (e.button === 1) askClose(t); };
    el.oncontextmenu = (e) => tabMenu(e, t);
    // arrastar para reordenar
    el.ondragstart = (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/bs-tab', t.key); el.classList.add('drag'); };
    el.ondragend = () => { el.classList.remove('drag'); document.querySelectorAll('.tab.drop-l,.tab.drop-r').forEach(x => x.classList.remove('drop-l', 'drop-r')); };
    el.ondragover = (e) => { if (!e.dataTransfer.types.includes('text/bs-tab')) return; e.preventDefault(); const r = el.getBoundingClientRect(); const left = e.clientX < r.left + r.width / 2; el.classList.toggle('drop-l', left); el.classList.toggle('drop-r', !left); };
    el.ondragleave = () => el.classList.remove('drop-l', 'drop-r');
    el.ondrop = (e) => {
      e.preventDefault(); const from = S.tabs.find(x => x.key === e.dataTransfer.getData('text/bs-tab')); if (!from || from === t) return renderTabs();
      const r = el.getBoundingClientRect(); const after = e.clientX >= r.left + r.width / 2;
      S.tabs.splice(S.tabs.indexOf(from), 1); S.tabs.splice(S.tabs.indexOf(t) + (after ? 1 : 0), 0, from); renderTabs();
    };
  });
  $('#tabs').querySelector('.tab.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  syncUnsaved();
}
function closeTab(t) {
  S.tabs.filter(x => x.owner === t).forEach(closeTab); // diff "EXTERNO" usa o mesmo modelo da aba dona
  if (S.autoSave && t.dirty && !t.owner && !t.conflict && !t.gone) saveTab(t, true, t.model?.getValue()); // fechar = salvar (o texto vai junto: o modelo é descartado já)
  const i = S.tabs.indexOf(t); S.tabs.splice(i, 1);
  if (t.original && diffEditor && diffEditor.getModel()?.original === t.original) diffEditor.setModel(null); // o Monaco reclama de modelo descartado ainda em uso
  if (!t.owner) { BS.hooks.run('tab:close', t); t.model?.dispose(); }
  t.original?.dispose();
  if (S.active === t) { const n = S.tabs[i] || S.tabs[i - 1]; if (n) activate(n); else { S.active = null; viewer = null; $('#welcome').hidden = false; $('#ed').style.display = 'none'; $('#dd').style.display = 'none'; $('#vw').style.display = 'none'; $('#diffInfo').hidden = true; $('#stLang').textContent = ''; $('#stPos').textContent = ''; renderTabs(); renderCrumbs(); renderDashboard(); } }
  else renderTabs();
  if (DOC && !S.tabs.length) desktop({ type: 'close' }); // janela de documento: sem o documento, a janela fecha
}
// fechar pelo usuário (X, Ctrl+W, menu): se alguma aba perderia alterações, pergunta antes.
// Com o salvamento automático, fechar já salva; só pergunta quando ele não pode gravar (conflito, arquivo apagado).
const losesWork = (t) => t.dirty && !t.owner && !(S.autoSave && !t.conflict && !t.gone);
function askClose(list) {
  list = [].concat(list).filter(t => t && S.tabs.includes(t));
  const risky = list.filter(losesWork);
  if (!risky.length) return list.forEach(t => S.tabs.includes(t) && closeTab(t));
  const one = risky.length === 1, name = one ? risky[0].path.split('/').pop() : '';
  dialog('closeDlg', `<div class="dlg-hd"><span class="dlg-ic warn">${SAVE_ICO}</span><div><h3>${one ? `Fechar "${esc(name)}" sem salvar?` : `Fechar ${risky.length} arquivos sem salvar?`}</h3><p>${one ? esc(risky[0].path) : risky.map(t => esc(t.path.split('/').pop())).join(', ')}</p></div></div>
    <p class="del-msg">${one ? 'O arquivo tem alterações que ainda não foram salvas.' : 'Esses arquivos têm alterações que ainda não foram salvas.'} Se fechar sem salvar, elas serão perdidas.</p>
    <div class="actions"><button class="chip" data-close>Cancelar</button><span class="spacer"></span><button class="chip danger" id="clsDrop">Fechar sem salvar</button><button class="chip primary" id="clsSave">Salvar e fechar</button></div>`, (el) => {
    const go = $('#clsSave'), drop = $('#clsDrop');
    go.focus();
    el.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; } };
    go.onclick = async () => {
      go.disabled = drop.disabled = true;
      for (const t of risky) if (S.tabs.includes(t)) await saveTab(t);
      el.hidden = true;
      const left = risky.filter(t => S.tabs.includes(t) && t.dirty); // não gravou (erro, conflito): fica aberta
      list.filter(t => !left.includes(t) && S.tabs.includes(t)).forEach(closeTab);
      if (left.length) activate(left[0]);
    };
    drop.onclick = async () => {
      go.disabled = drop.disabled = true; el.hidden = true;
      for (const t of risky) { await BS.fileViewer.custom[t.kind]?.discard?.(t); t.dirty = false; } // arquivo grande: o núcleo guarda as edições, descarta lá também
      list.filter(t => S.tabs.includes(t)).forEach(closeTab);
    };
  });
}
function renderCrumbs() {
  const el = $('#crumbPath');
  if (!S.active) { el.innerHTML = ''; return; }
  // trilha clicável: cada pasta abre a árvore naquele ponto
  const segs = S.active.path.split('/'); const parts = [S.project?.name, ...segs];
  el.innerHTML = parts.map((p, i) => `<span class="cr ${i === parts.length - 1 ? 'last' : ''}" data-i="${i}">${esc(p)}</span>`).join('<span class="sep">›</span>');
  el.querySelectorAll('.cr').forEach(c => c.onclick = () => { const i = +c.dataset.i; if (i === parts.length - 1) return treeLocate(); treeReveal(segs.slice(0, i).join('/')); });
  $('#btnView').classList.toggle('on', S.active.mode === 'diff');
}
function markDirty(model) {
  const t = model._tab; if (!t) return;
  const d = model.getValue() !== t.saved;
  if (d !== t.dirty) { t.dirty = d; renderTabs(); syncUnsaved(); }
  if (d) autoSaveSoon();
  liveLintSoon(t);
}
// abas com o que salvar (as de arquivo grande editam pelo núcleo, sem modelo do Monaco)
const savable = (t) => t.dirty && !t.owner && (t.editable || t.mode === 'view');
async function save() { const t = S.active && (S.active.owner || S.active); if (t) await saveTab(t); }
async function saveAll() {
  const list = S.tabs.filter(savable);
  for (const t of list) await saveTab(t, list.length > 1 ? 'all' : false);
  if (list.length > 1) toast(`${list.length} arquivos salvos`, 'ok', 'save'); else if (!list.length) toast('Nada para salvar', null, 'save');
}
// auto: salvamento automático (sem aviso, não grava por cima de conflito com o disco)
// body: texto já capturado (a aba está sendo fechada e o modelo vai ser descartado)
async function saveTab(t, auto, body) {
  if (t && t.mode === 'view') return BS.fileViewer.save(t, auto); // arquivo grande: o núcleo grava as edições
  if (!t || !t.editable || t.owner) return;
  if (auto === true && (t.conflict || t.gone || !t.dirty || t.saving)) return;
  // o arquivo mudou fora da IDE desde a última leitura? confere (e mescla) antes de gravar por cima
  if (BS.ext && !(await BS.ext.beforeSave(t))) return;
  const live = () => !t.model.isDisposed();
  t.saving = true;
  try {
    if (body == null) body = t.model.getValue();
    t.pending = body;
    const r = await api('file', { project: t.project, file: t.path }, { method: 'PUT', body });
    t.saved = body; if (r.mtime) t.stamp = r.mtime + ':' + r.size;
    if (!live()) return;
    t.dirty = t.model.getValue() !== body; renderTabs();
    BS.hooks.run('tab:save', t);
    // sincroniza outras abas do mesmo arquivo
    S.tabs.filter(x => x !== t && x.model !== t.model && x.path === t.path && x.project === t.project && x.editable).forEach(x => { x.model.setValue(t.saved); x.saved = t.saved; x.dirty = false; x.stamp = t.stamp; });
    // sem aviso: a aba perde a marca de "não salvo" e o lint aparece na barra de status (e em Problemas, se houver)
    runLint(t, auto ? 'auto' : true);
    refreshProject();
  } catch (e) { toast('Erro ao salvar ' + t.path.split('/').pop() + ': ' + e.message, 'err'); }
  finally { t.pending = null; t.saving = false; }
}

// ===== Salvamento automático (como o IntelliJ) =====
// Grava sozinho quando você para de digitar (1,5 s), troca de aba, fecha a aba ou sai da janela.
// Arquivo em conflito com uma alteração externa não é gravado: espera você decidir no diff EXTERNO.
const AUTO_IDLE = 1500;
S.autoSave = store.get('autoSave', false);
let autoT = null;
function autoSaveSoon() { if (!S.autoSave) return; clearTimeout(autoT); autoT = setTimeout(autoSaveAll, AUTO_IDLE); }
function autoSaveAll() { clearTimeout(autoT); if (!S.autoSave) return; S.tabs.filter(savable).forEach(t => saveTab(t, true)); }
function setAutoSave(on) {
  S.autoSave = !!on; store.set('autoSave', S.autoSave); renderSaveBtn();
  toast(S.autoSave ? 'Salvamento automático ligado' : 'Salvamento automático desligado', 'ok', 'save');
  if (S.autoSave) autoSaveAll();
}
function renderSaveBtn() {
  $('#saveGrp').classList.toggle('auto', S.autoSave);
  const b = $('#btnSave');
  b.title = S.autoSave ? 'Salvamento automático ligado · clique para salvar o arquivo atual agora (Ctrl+S)' : 'Salvar arquivo atual (Ctrl+S)';
  b.querySelector('span').textContent = S.autoSave ? 'Auto' : 'Salvar';
}
const SAVE_ICO = '<svg class="i" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>';
function saveMenu(e) {
  e.preventDefault(); e.stopPropagation();
  if ($('#ctx')?.dataset.menu === 'save') return closeMenu();
  closeMenu();
  const m = document.createElement('div'); m.className = 'ctx save-menu'; m.id = 'ctx'; m.dataset.menu = 'save';
  const n = S.tabs.filter(savable).length;
  const cur = S.active && (S.active.owner || S.active);
  m.innerHTML = `<div class="it${cur && (cur.editable || cur.mode === 'view' && cur.dirty) ? '' : ' off'}" data-a="cur">${SAVE_ICO}<span>Salvar arquivo atual</span><span class="k">Ctrl+S</span></div>`
    + `<div class="it${n ? '' : ' off'}" data-a="all">${SAVE_ICO}<span>Salvar todos${n ? ` (${n})` : ''}</span><span class="k">Ctrl+Shift+S</span></div>`
    + `<div class="sep"></div><label class="it chk"><input type="checkbox" ${S.autoSave ? 'checked' : ''}><span class="tx"><span>Salvar automaticamente</span><small>Ao parar de digitar, trocar de aba ou sair da janela</small></span></label>`;
  document.body.appendChild(m);
  const r = $('#saveGrp').getBoundingClientRect(), w = m.getBoundingClientRect().width;
  m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
  m.querySelector('[data-a="cur"]').onclick = () => { closeMenu(); save(); };
  m.querySelector('[data-a="all"]').onclick = () => { closeMenu(); saveAll(); };
  m.querySelector('input').onchange = (ev) => setAutoSave(ev.target.checked);
}
window.addEventListener('blur', () => autoSaveAll());
document.addEventListener('visibilitychange', () => { if (document.hidden) autoSaveAll(); });

// ===== Marcadores de alteração na margem (estilo IntelliJ) =====
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n'); const n = A.length, m = B.length;
  if (n * m > 4e6) return null; // grande demais: pula
  const dp = new Uint16Array((n + 1) * (m + 1)); const W = m + 1;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { i++; j++; } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { out.push({ t: 'del', at: j }); i++; } else { out.push({ t: 'add', line: j + 1 }); j++; } }
  while (i < n) { out.push({ t: 'del', at: j }); i++; } while (j < m) { out.push({ t: 'add', line: j + 1 }); j++; }
  return out;
}
function gutterMarks(tab) {
  if (!tab.base || tab.mode !== 'editor') return;
  const d = lineDiff(tab.base, tab.model.getValue()); if (!d) return;
  const dels = new Set(d.filter(x => x.t === 'del').map(x => x.at + 1));
  const decos = [];
  d.filter(x => x.t === 'add').forEach(x => decos.push({ range: new monaco.Range(x.line, 1, x.line, 1), options: { linesDecorationsClassName: dels.has(x.line) ? 'gut-mod' : 'gut-add', isWholeLine: true } }));
  dels.forEach(l => { if (!d.some(x => x.t === 'add' && x.line === l)) decos.push({ range: new monaco.Range(Math.min(l, tab.model.getLineCount()), 1, Math.min(l, tab.model.getLineCount()), 1), options: { linesDecorationsClassName: 'gut-del' } }); });
  tab.decos = editor.deltaDecorations(tab.decos || [], decos);
}

// ===== Lint =====
async function tsDiagnostics(tab) {
  try {
    const ts = monaco.languages.typescript; if (!ts) return [];
    const getW = tab.lang === 'typescript' ? ts.getTypeScriptWorker : ts.getJavaScriptWorker;
    const w = await (await getW())(tab.model.uri); const u = tab.model.uri.toString();
    const diags = [...await w.getSyntacticDiagnostics(u), ...await w.getSemanticDiagnostics(u)];
    const flat = (m) => typeof m === 'string' ? m : (m.messageText + (m.next ? ' → ' + m.next.map(flat).join(' ') : ''));
    const SOFT = new Set([2307, 2304, 2305, 2339, 2503, 2580, 2582, 2583, 2584, 2591, 2792, 7016, 1259, 1192]);
    return diags.map(d => { const pos = tab.model.getPositionAt(d.start || 0); const soft = SOFT.has(d.code); return { line: pos.lineNumber, col: pos.column, sev: d.category === 1 && !soft ? 'error' : 'warning', msg: flat(d.messageText) + (soft ? ' (sem tipos do projeto)' : ''), rule: 'TS' + d.code }; });
  } catch { return []; }
}
async function lintAll() {
  if (!S.project || !S.changes.length) { toast('Nada para lintar'); return; }
  const files = S.changes.filter(c => c.code !== 'D').slice(0, 150);
  $('#stLint').textContent = `lint 0/${files.length}…`; $('#problems').hidden = false; $('#probSub').textContent = 'alterações do projeto';
  const all = []; let done = 0;
  const worker = async () => { while (files.length) { const c = files.shift(); try { const r = await api('lint', { project: S.project.path, file: c.path }); r.problems.forEach(p => all.push({ ...p, file: c.path })); } catch {} done++; $('#stLint').textContent = `lint ${done}…`; renderProblemList(all, true); } };
  await Promise.all([worker(), worker(), worker()]);
  renderProblemList(all, true);
  $('#stLint').textContent = all.length ? `${all.length} problema(s) em ${new Set(all.map(p => p.file)).size} arquivo(s)` : 'alterações: ok';
  $('#stLint').className = 's ' + (all.length ? '' : 'ok');
  if (!all.length) toast('Lint ok nas alterações');
}
// quiet: quem chamou (o salvar) mostra o resultado no próprio aviso; devolve a resposta do lint
async function runLint(tab = S.active, quiet) {
  if (!tab) { lintAll(); return; }
  $('#stLint').textContent = 'lint…';
  try {
    const r = await api('lint', { project: tab.project, file: tab.path });
    if (!S.tabs.includes(tab)) return; // a aba fechou (ou o arquivo foi movido) enquanto o lint rodava
    if (r.client === 'ts' && (tab.lang === 'typescript' || tab.lang === 'javascript')) { const d = await tsDiagnostics(tab); r.problems = r.problems.concat(d); if (d.length || !r.problems.length) r.tool = (r.tool || '') + (r.tool && r.tool.includes('typescript') ? '' : ' + typescript'); }
    tab.problems = r.problems; tab.lintTool = r.tool || r.note;
    lintMarkers(tab); renderProblems(tab);
    $('#stLint').textContent = r.tool ? `${r.tool}: ${r.problems.length ? r.problems.length + ' problema(s)' : 'ok'}` : r.note;
    $('#stLint').className = 's ' + (r.tool && !r.problems.length ? 'ok' : '');
    if (r.problems.length) { if (quiet !== 'auto') $('#problems').hidden = false; } else if (!quiet) toast(r.tool ? 'Lint ok' : r.note);
    return r;
  } catch (e) { toast('Lint falhou: ' + e.message); $('#stLint').textContent = ''; }
}
// lint ao vivo: as regras de texto do núcleo (HTML, JSP, XML, JSON, TOML, YAML, Dockerfile, Makefile, LaTeX, shaders,
// centenas de formatos: lint_formats.rs) sobre o texto do editor, ao abrir e enquanto digita, sem esperar o salvar.
// O núcleo responde live: false para o que precisa do arquivo em disco ou de ferramenta (Java, Python...): esses tipos
// ficam anotados e seguem só no salvar.
const NO_LIVE = new Set();
const liveKey = (p) => { const n = p.split('/').pop().toLowerCase(); return n.includes('.') ? n.slice(n.lastIndexOf('.')) : n; };
function liveLintSoon(tab, ms = 600) {
  if (!tab || tab.mode !== 'editor' || !tab.model || NO_LIVE.has(liveKey(tab.path))) return;
  clearTimeout(tab.liveT); tab.liveT = setTimeout(() => liveLint(tab), ms);
}
async function liveLint(tab) {
  if (tab.model.isDisposed()) return;
  const body = tab.model.getValue(); if (body.length > 2e6) return;
  const u = new URL('/api/lint', location.origin); u.searchParams.set('project', tab.project); u.searchParams.set('file', tab.path);
  let r; try { r = await (await fetch(u, { method: 'POST', body })).json(); } catch { return; }
  if (r && r.live === false) { NO_LIVE.add(liveKey(tab.path)); return; }
  // resposta velha (você continuou digitando) ou aba fechada: descarta
  if (!r || r.error || !r.problems || tab.model.isDisposed() || tab.model.getValue() !== body) return;
  tab.problems = r.problems; tab.lintTool = r.tool || r.note;
  if (tab !== S.active) return; // ao ativar a aba, lintMarkers aplica o que ficou guardado
  lintMarkers(tab);
  $('#stLint').textContent = r.tool ? `${r.tool}: ${r.problems.length ? r.problems.length + ' problema(s)' : 'ok'}` : r.note || '';
  $('#stLint').className = 's ' + (r.tool && !r.problems.length ? 'ok' : '');
}
function lintMarkers(tab) {
  const p = tab.problems || [];
  if (tab.model) monaco.editor.setModelMarkers(tab.model, 'bs-lint', p.map(x => ({ startLineNumber: x.line, startColumn: x.col, endLineNumber: x.end_line || x.line, endColumn: x.end_line ? x.end_col : x.col + 1, message: x.msg + (x.rule ? ` (${x.rule})` : ''), severity: x.sev === 'error' ? monaco.MarkerSeverity.Error : x.sev === 'info' ? monaco.MarkerSeverity.Info : monaco.MarkerSeverity.Warning })));
  const b = $('#badge-problems'); if (b) { b.hidden = !p.length; b.textContent = p.length; }
  renderProblems(tab);
}
function renderProblems(tab) {
  const p = tab.problems || [];
  $('#probSub').textContent = tab.lintTool ? `${tab.path.split('/').pop()} · ${tab.lintTool}` : '';
  renderProblemList(p.map(x => ({ ...x, file: tab.path })), false, tab);
}
function renderProblemList(p, multi, tab) {
  const e = p.filter(x => x.sev === 'error').length, w = p.length - e;
  $('#probCnts').innerHTML = p.length ? `<span class="e">${e} erro${e === 1 ? '' : 's'}</span><span class="w">${w} aviso${w === 1 ? '' : 's'}</span>` : '';
  const sorted = p.slice().sort((a, b) => (a.file || '').localeCompare(b.file || '') || (a.sev === 'error' ? 0 : 1) - (b.sev === 'error' ? 0 : 1) || a.line - b.line);
  $('#probList').innerHTML = sorted.map((x, i) => `<div class="prob" data-i="${i}"><span class="sev ${x.sev}"></span>${multi ? `<span class="file" title="${esc(x.file)}">${esc(x.file.split('/').pop())}</span>` : ''}<span class="loc">${x.line}:${x.col}</span><span>${esc(x.msg)}</span><span class="rule">${esc(x.rule)}</span></div>`).join('') || '<div class="empty">Nenhum problema.</div>';
  $('#probList').querySelectorAll('.prob').forEach(el => el.onclick = async () => {
    const x = sorted[el.dataset.i];
    if (multi || !tab) { await openFile(x.file, 'editor'); tab = S.active; }
    revealAt(tab.mode === 'diff' ? diffEditor.getModifiedEditor() : editor, x.line, x.col);
  });
}
$('#btnProbClose').onclick = () => $('#problems').hidden = true;

// ===== Toolbar =====
$('#btnSave').onclick = save; $('#btnSaveMenu').onclick = saveMenu; renderSaveBtn();
function refreshAll() { S.overview = null; S.tree = {}; S.walk = {}; S.treeFresh = true; SE.index = null; SE.indexFor = null; if (S.project) seIndex(true); refreshProject(); loadProjects(); BS.hooks.run('refresh'); }
$('#btnView').onclick = () => { if (!S.active) return; const t = S.active; openFile(t.path, t.mode === 'diff' ? 'editor' : 'diff'); };
$('#btnInline').onclick = () => { S.inline = !S.inline; store.set('inline', S.inline); $('#btnInline').classList.toggle('on', S.inline); diffEditor?.updateOptions({ renderSideBySide: !S.inline }); };
$('#btnWrap').onclick = () => { S.wrap = !S.wrap; store.set('wrap', S.wrap); $('#btnWrap').classList.toggle('on', S.wrap); editor?.updateOptions({ wordWrap: S.wrap ? 'on' : 'off' }); diffEditor?.updateOptions({ diffWordWrap: S.wrap ? 'on' : 'off', wordWrap: S.wrap ? 'on' : 'off' }); };
$('#btnInline').classList.toggle('on', S.inline); $('#btnWrap').classList.toggle('on', S.wrap);
$('#seBtn').onclick = () => openSearch();
// janela do aplicativo: barra de cima arrasta a janela, duplo clique maximiza, botões e bordas próprios
if (window.BS_DESKTOP) {
  document.documentElement.classList.add('desktop'); $('#winCtl').hidden = false;
  const free = (e) => e.button === 0 && !e.target.closest('button, input, a, select, .chip, #seBtn, .winctl');
  $('#top').addEventListener('mousedown', (e) => { if (free(e) && e.detail === 1) desktop({ type: 'drag' }); });
  $('#top').addEventListener('dblclick', (e) => { if (free(e)) desktop({ type: 'max' }); });
  $('#winCtl').querySelectorAll('button').forEach(b => b.onclick = () => DOC && b.dataset.w === 'close' ? BS_DOC_CLOSE() : desktop({ type: b.dataset.w }));
  document.querySelectorAll('.rz').forEach(r => r.addEventListener('mousedown', (e) => { e.preventDefault(); desktop({ type: 'resize', dir: r.dataset.r }); }));
  window.BS_WIN = { max(on) { document.documentElement.classList.toggle('maxed', !!on); const b = $('#winCtl [data-w="max"]'); if (b) b.title = on ? 'Restaurar' : 'Maximizar'; } };
  BS_WIN.max(window.BS_MAX);
}

// ===== Zoom da fonte do código: Ctrl + roda do mouse (Ctrl+0 volta, Ctrl+= / Ctrl+- também) =====
const FONT = { min: 9, max: 36, def: 13 };
function codeFont(size, quiet) {
  const n = Math.max(FONT.min, Math.min(FONT.max, Math.round(size)));
  S.fontSize = n; store.set('fontSize', n);
  const o = { fontSize: n, lineHeight: Math.round(n * 1.7) };
  editor?.updateOptions(o); diffEditor?.updateOptions(o); BS.hooks.run('codefont', n);
  if (!quiet) toast(`Fonte do código: ${n}px`, null, 'font');
}
S.fontSize = store.get('fontSize', FONT.def);
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault(); // sem isso o navegador dá zoom na página inteira
  if ($('#app').classList.contains('present')) return;
  codeFont(S.fontSize + (e.deltaY < 0 ? 1 : -1));
}, { passive: false, capture: true });

$('#projChip').onclick = () => projectSwitcher();
$('#projChip').oncontextmenu = (e) => S.project && projectMenu(e, S.project);
function present(on) {
  $('#app').classList.toggle('present', on); const fs = on ? Math.max(18, S.fontSize + 5) : S.fontSize;
  const fs2 = on ? fs : S.fontSize; editor?.updateOptions({ fontSize: fs2, lineHeight: Math.round(fs2 * 1.7) }); diffEditor?.updateOptions({ fontSize: fs2, lineHeight: Math.round(fs2 * 1.7) });
  if (window.BS_DESKTOP) return desktop({ type: 'fullscreen', on }); // janela nativa em tela cheia
  if (on && document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$('#present-exit').onclick = () => present(false);

// ===== Rede =====
$('#btnNet').onclick = () => { const p = $('#netPop'); p.hidden = !p.hidden; const r = $('#btnNet').getBoundingClientRect(); p.style.top = r.bottom + 6 + 'px'; p.style.right = (innerWidth - r.right) + 'px'; BS.hooks.run('net:pop', !p.hidden); };
$('#netClose').onclick = () => { $('#netPop').hidden = true; BS.hooks.run('net:pop', false); };
$('#netToggle').onclick = async () => { try { S.net = await api('network', {}, { method: 'POST', body: JSON.stringify({ enable: !S.net.enabled }) }); renderNet(); toast(S.net.enabled ? 'Rede ligada' : 'Rede desligada'); } catch (e) { toast(e.message); } };
function renderNet() {
  const n = S.net || { enabled: false, urls: [] };
  $('#netToggle').classList.toggle('on', n.enabled); $('#netInfo').hidden = !n.enabled;
  $('#btnNet').classList.toggle('on', n.enabled);
  $('#stNet').textContent = n.enabled ? `rede · ${n.urls[0]?.url || ''}` : ''; $('#stNet').className = 's ' + (n.enabled ? 'net-on' : '');
  $('#netUrls').innerHTML = n.urls.map(u => `<div class="url"><span title="${esc(u.iface)}">${esc(u.url)}</span><button class="icon-btn" data-c="${esc(u.url)}" title="Copiar"><svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></div>`).join('');
  $('#netUrls').querySelectorAll('button').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.c).then(() => toast('Copiado')).catch(() => {}));
  $('#netPin').textContent = n.pin || '';
  if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') { $('#netToggle').style.display = 'none'; }
}

// ===== Search Everywhere (Shift duas vezes, como no IntelliJ) =====
// Abas: Tudo, Classes, Arquivos, Texto, Ações. Classes e arquivos usam CamelHumps ("PaCo" acha ParcelasController),
// "Nome:120" vai direto para a linha, "pacote.Classe" e "pasta/arquivo" filtram pelo caminho.
const SE_TABS = [['all', 'Tudo'], ['classes', 'Classes'], ['files', 'Arquivos'], ['text', 'Texto'], ['actions', 'Ações']];
const SE = { tab: 'all', q: '', sel: 0, items: [], index: null, indexFor: null, text: null, textQ: null, textTimer: null, case: store.get('seCase', false), regex: store.get('seRegex', false), seq: 0 };
async function seIndex(fresh) {
  if (!S.project) return [];
  if (SE.index && SE.indexFor === S.project.path && !fresh) return SE.index;
  const proj = S.project.path;
  if (SE.loading && SE.loading.proj === proj && !fresh) return SE.loading.pr;
  const pr = api('index', { project: proj, fresh: fresh ? '1' : null }).catch(() => []).then(idx => { if (S.project && S.project.path === proj) { SE.index = idx; SE.indexFor = proj; } SE.loading = null; return idx; });
  SE.loading = { proj, pr }; return pr;
}
// início de palavra: maiúscula depois de minúscula, letra depois de separador, número depois de letra
function seStarts(s) {
  const st = new Set([0]);
  for (let i = 1; i < s.length; i++) {
    const c = s[i], p = s[i - 1];
    if ((/[A-Z]/.test(c) && !/[A-Z]/.test(p)) || (/[A-Za-z0-9]/.test(c) && !/[A-Za-z0-9]/.test(p)) || (/[0-9]/.test(c) && !/[0-9]/.test(p))) st.add(i);
    if (/[A-Z]/.test(c) && /[A-Z]/.test(p) && /[a-z]/.test(s[i + 1] || '')) st.add(i); // "XMLParser": P é início
  }
  return st;
}
// devolve { score, idx } ou null
function seMatch(q, s) {
  if (!q) return { score: 0, idx: [] };
  const ql = q.toLowerCase().replace(/\s+/g, ''), sl = s.toLowerCase(); if (!ql) return { score: 0, idx: [] };
  const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
  if (sl === ql) return { score: 4000, idx: range(0, ql.length) };
  if (sl.startsWith(ql)) return { score: 3000 - s.length, idx: range(0, ql.length) };
  const starts = seStarts(s); const idx = []; let steps = 0;
  const rec = (qi, si, cont) => {
    if (qi === ql.length) return true;
    for (let i = si; i < sl.length; i++) {
      if (++steps > 4000) return false;
      if (sl[i] !== ql[qi] || !(starts.has(i) || (cont && i === si))) continue;
      idx.push(i); if (rec(qi + 1, i + 1, true)) return true; idx.pop();
    }
    return false;
  };
  if (/[a-z0-9]/i.test(ql[0]) && rec(0, 0, false)) { const gaps = idx[idx.length - 1] - idx[0] - idx.length; return { score: 2000 - gaps * 4 - s.length, idx: idx.slice() }; }
  const at = sl.indexOf(ql);
  if (at >= 0) return { score: 1000 - at * 2 - s.length, idx: range(at, ql.length) };
  return null;
}
const seHl = (s, idx) => { const set = new Set(idx || []); let out = ''; for (let i = 0; i < s.length; i++) out += set.has(i) ? `<b class="hl">${esc(s[i])}</b>` : esc(s[i]); return out; };
const seThird = (p) => /(\/|^)(vendor|lib|libs|plugins?|node_modules)\/|\.min\.(js|css)$/i.test(p);
function seParse(raw) {
  let q = raw.trim(), line = 0, col = 0;
  const m = /^(.*?)[:#](\d+)(?:[:#](\d+))?$/.exec(q); if (m && m[1]) { q = m[1]; line = +m[2]; col = +(m[3] || 0); }
  let dir = '';
  const sl = q.replace(/\\/g, '/'); if (sl.includes('/')) { dir = sl.slice(0, sl.lastIndexOf('/')).toLowerCase(); q = sl.slice(sl.lastIndexOf('/') + 1); }
  let pkg = ''; if (/^[\w$]+(\.[\w$]+)+$/.test(q) && !/\.(java|jsp|xml|js|ts|css|json|properties|html|sql|md|ya?ml|txt)$/i.test(q)) { pkg = q.slice(0, q.lastIndexOf('.')).toLowerCase(); q = q.slice(q.lastIndexOf('.') + 1); }
  return { q, line, col, dir, pkg };
}
function seRecent() { return S.project ? store.get('recentFiles:' + S.project.path, []) : []; }
function seRemember(p) { if (!S.project) return; const k = 'recentFiles:' + S.project.path; store.set(k, [p, ...store.get(k, []).filter(x => x !== p)].slice(0, 30)); }
function seFind(kind, raw, limit) {
  const idx = SE.index || []; const { q, line, col, dir, pkg } = seParse(raw); const rec = seRecent(); const out = [];
  if (!q && !dir) {
    if (kind === 'files') return rec.map(p => idx.find(f => f.p === p) || { p }).slice(0, limit).map(f => ({ type: 'file', f, nm: f.p.split('/').pop(), m: { idx: [] }, recent: true }));
    return [];
  }
  for (const f of idx) {
    if (kind === 'classes' && !f.cls) continue;
    const name = kind === 'classes' ? f.cls : f.p.split('/').pop();
    if (dir && !f.p.toLowerCase().slice(0, f.p.lastIndexOf('/')).includes(dir)) continue;
    if (pkg && !(f.pkg || f.p.replace(/\//g, '.')).toLowerCase().includes(pkg)) continue;
    const m = q ? seMatch(q, name) : { score: 0, idx: [] }; if (!m) continue;
    let score = m.score + (rec.includes(f.p) ? 300 : 0) - (seThird(f.p) ? 400 : 0) - (f.test ? 40 : 0);
    out.push({ type: kind === 'classes' ? 'class' : 'file', f, nm: name, m, score, line, col });
  }
  return out.sort((a, b) => b.score - a.score || a.f.p.length - b.f.p.length).slice(0, limit);
}
function seActions() {
  const A = (label, k, run, icon) => ({ label, k, run, icon });
  return [
    A('Projeto (árvore)', 'Alt+1', () => openTool('project'), I.open), A('Alterações', 'Alt+2', () => openTool('changes'), I.diff), A('Histórico', 'Alt+3', () => openTool('history'), I.hist),
    A('Problemas', 'Alt+4', () => openTool('problems'), I.lint), A('Plugins', 'Alt+7', () => openTool('plugins'), I.plug),
    A('Trocar projeto', 'Alt+P', () => quickProject(), I.open), A('Lista de projetos', '', () => { S.showProjects = true; openTool('project'); }, I.open),
    A('Abrir projeto…', '', () => openProjectDialog(), I.open), ...(S.remote ? [] : [A('Novo projeto…', '', () => newProjectDialog(), I.newp)]), A('Fechar projeto', '', () => closeProject(), I.x),
    A('Selecionar arquivo aberto na árvore', 'Alt+F1', () => treeLocate(), TI.locate), A('Recolher árvore', '', () => { if (!S.project) return; S.treeOpen = new Set(['']); saveTreeOpen(); openTool('project'); }, TI.collapse),
    A('Salvar', 'Ctrl+S', () => save(), I.edit), A('Salvar todos', 'Ctrl+Shift+S', () => saveAll(), I.edit), A('Salvamento automático (liga/desliga)', '', () => setAutoSave(!S.autoSave), I.edit), A('Lint do arquivo', 'Ctrl+Alt+L', () => runLint(), I.lint), A('Lint das alterações', '', () => lintAll(), I.lint),
    A('Ver diff / editor do arquivo atual', '', () => $('#btnView').click(), I.diff), A('Diff lado a lado / em linha', '', () => $('#btnInline').click(), I.diff), A('Quebra de linha', '', () => $('#btnWrap').click(), I.edit),
    A('Apresentar (tela cheia)', 'F11', () => present(true), I.present), A('Tema claro / escuro', '', () => $('#btnTheme').click(), I.edit), A('Rede local', '', () => $('#btnNet').click(), I.ext),
    A('Atualizar projeto', 'F5', () => refreshAll(), I.refresh), A('Mostrar projeto no Explorer', '', () => S.project && reveal(S.project.path), I.explorer),
    A('Fechar todas as abas', '', () => S.tabs.slice().forEach(closeTab), I.x), A('Compactar pacotes intermediários (liga/desliga)', '', () => { S.compact = !S.compact; store.set('compact', S.compact); S.tree = {}; renderTool(); }, I.pkg),
    ...BS.actions.list().map(a => A(a.label, a.k || '', a.run, a.icon)),
  ];
}
function seFindActions(raw, limit) {
  const q = raw.trim(); const all = seActions();
  if (!q) return all.slice(0, limit).map(a => ({ type: 'action', a, m: { idx: [] } }));
  // ações aceitam também subsequência solta ("exaa" acha "Executar o arquivo aberto"), como no Find Action do IntelliJ
  const loose = (t) => { const ql = q.toLowerCase().replace(/\s+/g, ''), tl = t.toLowerCase(); const idx = []; let j = 0; for (let i = 0; i < tl.length && j < ql.length; i++) if (tl[i] === ql[j]) { idx.push(i); j++; } return j === ql.length ? { score: 200 - (idx[idx.length - 1] - idx[0]), idx } : null; };
  return all.map(a => { const m = seMatch(q, a.label) || (a.label.toLowerCase().split(/\s+/).some(w => w.startsWith(q.toLowerCase())) ? { score: 500, idx: [] } : null) || loose(a.label); return m ? { type: 'action', a, m, score: m.score } : null; })
    .filter(Boolean).sort((x, y) => y.score - x.score).slice(0, limit);
}
function seBuild() {
  const q = SE.q; const t = SE.tab; let items = [];
  const sec = (title, list, tab, total) => { if (!list.length) return; items.push({ type: 'sec', title, tab, more: total > list.length ? total - list.length : 0 }); items.push(...list); };
  if (!S.project && (t === 'classes' || t === 'files' || t === 'text')) items.push({ type: 'note', text: 'Abra um projeto para buscar classes, arquivos e texto.' });
  else if (S.project && SE.indexFor !== S.project.path && t !== 'actions' && t !== 'text' && q.trim()) { SE.items = [{ type: 'note', text: 'Indexando o projeto…', spin: true }]; SE.sel = -1; return; }
  if (t === 'all') {
    if (!q.trim()) { sec('Arquivos recentes', seFind('files', '', 12), 'files', 0); sec('Ações', seFindActions('', 6), 'actions', 0); }
    else {
      const c = seFind('classes', q, 60), f = seFind('files', q, 60), a = seFindActions(q, 20);
      const seen = new Set(c.slice(0, 8).map(x => x.f.p)); const f2 = f.filter(x => !seen.has(x.f.p));
      sec('Classes', c.slice(0, 8), 'classes', c.length); sec('Símbolos', seSyms(q).slice(0, 8), 'classes', seSyms(q).length); sec('Arquivos', f2.slice(0, 8), 'files', f2.length); sec('Ações', a.slice(0, 5), 'actions', a.length);
      if (S.project) items.push({ type: 'gotext', text: q });
    }
  } else if (t === 'classes') { items = seFind('classes', q, 200); const sy = seSyms(q); if (sy.length) { if (items.length) items.unshift({ type: 'sec', title: 'Classes' }); items.push({ type: 'sec', title: 'Símbolos (servidor de linguagem)' }, ...sy); } }
  else if (t === 'files') { items = seFind('files', q, 200); if (!q.trim() && items.length) items.unshift({ type: 'sec', title: 'Arquivos recentes' }); }
  else if (t === 'actions') items = seFindActions(q, 100);
  else if (t === 'text') {
    if (!q.trim()) items.push({ type: 'note', text: 'Digite para buscar em todos os arquivos do projeto. Aa diferencia maiúsculas; .* usa regex.' });
    else if (SE.text && SE.textQ === seTextKey()) {
      if (SE.text.error) items.push({ type: 'note', text: SE.text.error });
      else { items = SE.text.hits.map(h => ({ type: 'hit', h })); if (!items.length) items.push({ type: 'note', text: 'Nada encontrado.' }); }
    } else items.push({ type: 'note', text: 'Procurando…', spin: true });
  }
  if (!items.some(x => x.type !== 'sec' && x.type !== 'note') && !items.some(x => x.type === 'note') && q.trim()) items.push({ type: 'note', text: 'Nada encontrado' + (t === 'all' ? '. Tab troca de aba; a aba Texto busca dentro dos arquivos.' : '.') });
  SE.items = items;
  const sel = items.findIndex((x, i) => i >= SE.sel && seSelectable(x)); SE.sel = sel >= 0 ? sel : items.findIndex(seSelectable);
}
const seSelectable = (x) => x && x.type !== 'sec' && x.type !== 'note';
const seTextKey = () => [S.project && S.project.path, SE.q, SE.case, SE.regex].join('|');
function seRow(x, i) {
  const on = i === SE.sel ? ' on' : '';
  if (x.type === 'sec') return `<div class="se-sec"><span>${esc(x.title)}</span>${x.more ? `<a data-tab="${x.tab}">mais ${x.more}</a>` : ''}</div>`;
  if (x.type === 'note') return `<div class="se-note">${x.spin ? '<span class="spin"></span> ' : ''}${esc(x.text)}</div>`;
  if (x.type === 'gotext') return `<div class="se-row${on}" data-i="${i}">${SEARCH_ICO}<span class="nm">Buscar <b>${esc(x.text)}</b> no texto dos arquivos</span><span class="kb" style="margin-left:auto">Ctrl+Shift+F</span></div>`;
  if (x.type === 'sym') { const s = x.s, k = SE_KIND[s.kind] || ['•', 'sym'];
    return `<div class="se-row${on}" data-i="${i}" title="${esc(s.p)}:${s.line}"><span class="se-kind k-${k[1]}">${k[0]}</span><span class="nm">${esc(s.name)}</span>${s.container ? `<span class="kb">${esc(s.container)}</span>` : ''}<span class="loc">${esc(s.p)}:${s.line}</span></div>`; }
  if (x.type === 'action') return `<div class="se-row${on}" data-i="${i}">${x.a.icon || ''}<span class="nm">${seHl(x.a.label, x.m.idx)}</span>${x.a.k ? `<span class="kb">${esc(x.a.k)}</span>` : ''}</div>`;
  if (x.type === 'hit') { const h = x.h; const t = h.text; const a = h.off, b = h.off + h.len;
    return `<div class="se-row hit${on}" data-i="${i}"><span class="code">${h.cut ? '…' : ''}${esc(t.slice(0, a).trimStart())}<b class="hl">${esc(t.slice(a, b))}</b>${esc(t.slice(b))}</span><span class="loc" title="${esc(h.p)}">${esc(h.p.split('/').pop())}:${h.line}</span></div>`; }
  const f = x.f; const dir = f.p.includes('/') ? f.p.slice(0, f.p.lastIndexOf('/')) : '';
  const icon = treeIcon({ name: f.p.split('/').pop(), java: f.java, test: f.test });
  const where = x.type === 'class' ? (f.pkg || dir) : dir;
  const line = x.line ? `<span class="kb">:${x.line}</span>` : '';
  return `<div class="se-row${on}${seThird(f.p) ? ' dim' : ''}" data-i="${i}" title="${esc(f.p)}">${icon}<span class="nm">${seHl(x.nm, x.m.idx)}</span>${line}<span class="loc">${esc(where)}</span></div>`;
}
function seRender(keepScroll) {
  const box = $('#se'); if (!box || box.hidden) return;
  $('#seTabs').innerHTML = SE_TABS.map(([k, l]) => `<button data-tab="${k}" class="${SE.tab === k ? 'on' : ''}">${l}</button>`).join('');
  $('#seOpts').innerHTML = SE.tab === 'text' ? `<button id="seCase" class="${SE.case ? 'on' : ''}" title="Diferenciar maiúsculas">Aa</button><button id="seRegex" class="${SE.regex ? 'on' : ''}" title="Expressão regular">.*</button>` + (SE.text && SE.textQ === seTextKey() && !SE.text.error ? `<span class="cnt2">${SE.text.hits.length}${SE.text.truncated ? '+' : ''} em ${SE.text.files} arquivo(s)</span>` : '') : (S.project ? `<span class="cnt2">${esc(S.project.name)}</span>` : '');
  $('#seIn').placeholder = { all: 'Buscar em tudo (classes, arquivos, ações)', classes: 'Classe (CamelHumps: PaCo, pacote.Classe, Classe:linha)', files: 'Arquivo (nome, pasta/arquivo, arquivo:linha)', text: 'Texto em todos os arquivos', actions: 'Ação' }[SE.tab];
  const list = $('#seList'); const st = list.scrollTop;
  list.innerHTML = SE.items.map(seRow).join('');
  if (keepScroll) list.scrollTop = st;
  list.querySelector('.se-row.on')?.scrollIntoView({ block: 'nearest' });
  $('#seTabs').querySelectorAll('button').forEach(b => b.onclick = () => seTab(b.dataset.tab));
  list.querySelectorAll('.se-sec a[data-tab]').forEach(a => a.onclick = () => seTab(a.dataset.tab));
  list.querySelectorAll('.se-row').forEach(r => { r.onmousemove = () => { const i = +r.dataset.i; if (SE.sel !== i) { SE.sel = i; list.querySelectorAll('.se-row.on').forEach(x => x.classList.remove('on')); r.classList.add('on'); } }; r.onclick = () => seGo(+r.dataset.i); });
  $('#seCase')?.addEventListener('click', () => { SE.case = !SE.case; store.set('seCase', SE.case); seTextSearch(); });
  $('#seRegex')?.addEventListener('click', () => { SE.regex = !SE.regex; store.set('seRegex', SE.regex); seTextSearch(); });
}
function seTextSearch() {
  clearTimeout(SE.textTimer);
  if (SE.tab !== 'text' || !SE.q.trim() || !S.project) { seBuild(); seRender(); return; }
  const key = seTextKey(); if (SE.textQ === key && SE.text) { seBuild(); seRender(); return; }
  SE.text = null; SE.textQ = key; seBuild(); seRender();
  const seq = ++SE.seq;
  SE.textTimer = setTimeout(async () => {
    let r; try { r = await api('search', { project: S.project.path, q: SE.q, case: SE.case ? '1' : null, regex: SE.regex ? '1' : null }); } catch (e) { r = { error: e.message, hits: [] }; }
    if (seq !== SE.seq) return; SE.text = r; seBuild(); seRender();
  }, 250);
}
function seTab(t) { SE.tab = t; SE.sel = 0; store.set('seTab', t); if (t === 'text') seTextSearch(); else { seBuild(); seRender(); } $('#seIn').focus(); }
async function seGo(i) {
  const x = SE.items[i];
  if (!seSelectable(x)) { if (S.project && SE.indexFor !== S.project.path) SE.pendingEnter = true; return; }
  SE.pendingEnter = false;
  if (x.type === 'gotext') return seTab('text');
  seClose();
  if (x.type === 'action') return x.a.run();
  if (x.type === 'hit') { await openFile(x.h.p, 'editor', x.h.line); seSelectRange(x.h.line, x.h.col, x.h.len); return; }
  if (x.type === 'sym') { await openFile(x.s.p, 'editor', x.s.line); seSelectRange(x.s.line, x.s.col, x.s.name.length); return; }
  await openFile(x.f.p, 'editor', x.line || undefined);
  if (x.line && x.col) seSelectRange(x.line, x.col, 0);
}
// símbolos do projeto vindos dos servidores de linguagem (funções, structs, traits, métodos...), além do índice próprio
const SE_KIND = { 2: ['M', 'mod'], 3: ['N', 'mod'], 5: ['C', 'type'], 6: ['m', 'fn'], 7: ['p', 'var'], 8: ['f', 'var'], 9: ['c', 'fn'], 10: ['E', 'type'], 11: ['I', 'type'], 12: ['ƒ', 'fn'], 13: ['v', 'var'], 14: ['K', 'const'], 22: ['e', 'const'], 23: ['S', 'type'], 26: ['T', 'type'] };
const seSyms = (q) => SE.sym && SE.symQ === q && SE.symFor === (S.project && S.project.path) ? SE.sym.map(s => ({ type: 'sym', s })) : [];
let seSymT = null;
function seSymSearch() {
  clearTimeout(seSymT);
  const q = SE.q.trim(); if (!q || SE.tab === 'files' || SE.tab === 'actions' || !BS.lsp || !BS.lsp.workspaceSymbols) return;
  seSymT = setTimeout(async () => {
    const proj = S.project && S.project.path, r = await BS.lsp.workspaceSymbols(q);
    if (!r || SE.q.trim() !== q) return;
    SE.sym = r; SE.symQ = SE.q; SE.symFor = proj;
    if (!$('#se').hidden) { seBuild(); seRender(true); }
  }, 120);
}
function seSelectRange(line, col, len) {
  if (!editor || !S.active || S.active.mode !== 'editor') return;
  setTimeout(() => { editor.setSelection(new monaco.Range(line, col, line, col + len)); editor.revealRangeInCenter(new monaco.Range(line, col, line, col + len)); editor.focus(); }, 150);
}
function seClose() { const b = $('#se'); if (b) b.hidden = true; $('#seBack')?.setAttribute('hidden', ''); }
async function openSearch(tab) {
  let box = $('#se');
  if (!box) {
    document.body.insertAdjacentHTML('beforeend', `<div id="seBack" hidden></div><div id="se" hidden role="dialog" aria-label="Buscar em tudo">
      <div class="se-head"><div id="seTabs" class="se-tabs"></div><div id="seOpts" class="se-opts"></div></div>
      <div class="se-in">${SEARCH_ICO}<input id="seIn" spellcheck="false" autocomplete="off"></div>
      <div id="seList" class="se-list"></div></div>`);
    box = $('#se');
    $('#seBack').onclick = seClose;
    const inp = $('#seIn');
    inp.oninput = () => { SE.q = inp.value; SE.sel = 0; if (SE.tab === 'text') seTextSearch(); else { seBuild(); seRender(); seSymSearch(); } };
    inp.onkeydown = (e) => {
      const move = (d) => { const n = SE.items.length; let i = SE.sel; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (seSelectable(SE.items[i])) break; } SE.sel = i; seRender(true); };
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'PageDown') { e.preventDefault(); for (let k = 0; k < 10; k++) move(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); for (let k = 0; k < 10; k++) move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); seGo(SE.sel); }
      else if (e.key === 'Tab') { e.preventDefault(); const i = SE_TABS.findIndex(([k]) => k === SE.tab); seTab(SE_TABS[(i + (e.shiftKey ? -1 : 1) + SE_TABS.length) % SE_TABS.length][0]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); seClose(); }
    };
  }
  const wasOpen = !box.hidden;
  SE.tab = tab || (wasOpen ? 'all' : store.get('seTab', 'all')); SE.sel = 0;
  box.hidden = false; $('#seBack').hidden = false;
  const inp = $('#seIn');
  // texto selecionado no editor vira a busca (como no IntelliJ)
  const selText = editor && S.active && S.active.mode === 'editor' && document.activeElement && document.activeElement.closest('#mon') ? editor.getModel().getValueInRange(editor.getSelection()) : '';
  if (selText && !selText.includes('\n') && selText.length < 120) inp.value = selText;
  SE.q = inp.value; inp.focus(); inp.select();
  if (SE.tab === 'text') seTextSearch(); else { seBuild(); seRender(); }
  if (S.project && (!SE.index || SE.indexFor !== S.project.path)) { await seIndex(); if (!box.hidden) { seBuild(); seRender(); if (SE.pendingEnter) seGo(SE.sel); } }
}
// Shift duas vezes, sem outra tecla no meio (vale também com o foco dentro do editor)
(() => {
  let last = 0, clean = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') { if (!e.repeat) clean = true; } else { clean = false; last = 0; } }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Shift' || !clean) return; clean = false;
    const now = performance.now();
    if (now - last < 400) { last = 0; openSearch(); } else last = now;
  }, true);
  window.addEventListener('mousedown', () => { last = 0; clean = false; }, true);
})();
function quickOpen() { openSearch('files'); }

// ===== Sidebar redimensionável =====
$('#app').style.setProperty('--tw', (store.get('tw', 300)) + 'px');
$('#toolResize').addEventListener('mousedown', (e) => {
  e.preventDefault(); const h = $('#toolResize'); h.classList.add('on'); document.body.classList.add('resizing');
  const move = (ev) => { const w = Math.max(180, Math.min(innerWidth - 400, ev.clientX - 40)); $('#app').style.setProperty('--tw', w + 'px'); $('#app').classList.remove('no-tool'); btnState(); };
  const up = () => { h.classList.remove('on'); document.body.classList.remove('resizing'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); store.set('tw', parseInt($('#app').style.getPropertyValue('--tw')) || 300); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
});
$('#toolResize').addEventListener('dblclick', () => { $('#app').style.setProperty('--tw', '300px'); store.set('tw', 300); });


// ===== Plugins: a API que os plugins usam (window.BS) =====
// O ui.js de cada plugin roda nesta página, dentro de function (bs, plugin) { ... }, e enxerga tudo o que está
// declarado aqui (S, api, $, esc, toast, store, I, TI, monaco, editor, openFile...). Além disso, registra-se nos
// pontos de extensão abaixo: painéis (tools), teclas (keys), ações do Buscar em tudo (actions), status bar (status),
// cards e botões do resumo (dashboard), dicas (hints), painéis na área do editor (ui.panel) e ganchos (hooks).
// Funções do núcleo declaradas com "function" também podem ser substituídas: window.renderTree = function () { ... }.
const keyName = (k) => k.length === 1 ? k.toUpperCase() : k;
// tecla física (e.code) para letras e números: Alt+7 e Ctrl+P funcionam em qualquer layout (ABNT2, AltGr...)
const keyBase = (e) => /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : keyName(e.key);
const keyCombo = (e) => (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + keyBase(e);
function normCombo(s) {
  const parts = String(s).split('+').map(x => x.trim()).filter(Boolean); const key = parts.pop() || ''; const mods = new Set(parts.map(p => p.toLowerCase()));
  return (mods.has('ctrl') || mods.has('cmd') || mods.has('meta') ? 'Ctrl+' : '') + (mods.has('alt') ? 'Alt+' : '') + (mods.has('shift') ? 'Shift+' : '') + keyName(key);
}
const BS = window.BS = {
  version: null, S, state: S, api, $, esc, toast, store, I, TI, treeIcon, fmtDate, ago, daysAgo, statHtml, copyText, reveal, absPath, showMenu, closeMenu,
  openFile, openTool, setTool, renderTool, renderStrip, renderTree, renderDashboard, refreshProject, refreshAll, selectProject, revealAt, openOutside, openSearch, present, save, saveAll, runLint, lintAll, quickProject,
  get editor() { return editor; }, get diffEditor() { return diffEditor; }, get monaco() { return monaco; }, get viewer() { return viewer; },
  // painéis da barra da esquerda: { id, title, icon, key: 'Alt+5', order, render(), bottom?, toggle?() }
  tools: {
    defs: new Map(),
    register(def) { if (!def || !def.id || !def.title) throw new Error('tool precisa de id e title'); BS.tools.defs.set(def.id, def); if (def.key) BS.keys.add(def.key, () => setTool(def.id)); return def; },
    get: (id) => BS.tools.defs.get(id) || null,
    list: () => [...BS.tools.defs.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  },
  // teclas: add('Ctrl+F9', fn); o fn devolve false para não tratar
  keys: { map: new Map(), add(combo, fn) { BS.keys.map.set(normCombo(combo), fn); }, remove(combo) { BS.keys.map.delete(normCombo(combo)); }, get: (combo) => BS.keys.map.get(combo) || null },
  // ganchos: on/run (avisos) e filter/apply (transformam um valor, ex.: marcas da árvore, itens de menu)
  hooks: {
    ons: {}, filters: {},
    on(name, fn) { (BS.hooks.ons[name] = BS.hooks.ons[name] || []).push(fn); },
    run(name, ...a) { for (const fn of BS.hooks.ons[name] || []) { try { fn(...a); } catch (e) { console.error('hook ' + name, e); } } },
    filter(name, fn) { (BS.hooks.filters[name] = BS.hooks.filters[name] || []).push(fn); },
    apply(name, value, ...a) { for (const fn of BS.hooks.filters[name] || []) { try { const r = fn(value, ...a); if (r !== undefined) value = r; } catch (e) { console.error('filter ' + name, e); } } return value; },
  },
  actions: { items: [], add(list) { BS.actions.items.push(...(Array.isArray(list) ? list : [list])); }, list: () => BS.actions.items },
  // item na status bar: add({ id, title, onclick }) devolve o <span>; o plugin preenche textContent/className
  status: {
    add({ id, title, onclick, html }) {
      const el = document.createElement('span'); el.className = 's'; if (id) el.id = id; if (title) el.title = title; if (html) el.innerHTML = html; el.hidden = true;
      if (onclick) el.onclick = onclick; $('#stDirty').before(el); return el;
    },
  },
  // resumo do projeto: card({ id, order, wide, html(), bind(el) }) e action({ label, icon, go, title })
  dashboard: { cards: [], actions: [], card(c) { BS.dashboard.cards.push(c); }, action(a) { BS.dashboard.actions.push(a); } },
  hints: [],
  // painel na área do editor, abaixo do código: entra no dock como uma aba (ver dock.js), como o console de build
  ui: { panel(html) { $('#problems').insertAdjacentHTML('beforebegin', html); return $('#problems').previousElementSibling; } },
  plugins: {
    list: [], dirs: [], defs: new Map(),
    define(id, fn) { BS.plugins.defs.set(id, fn); },
    // lê a lista do servidor, carrega o script de cada plugin ligado e roda o ui.js de cada um, na ordem
    async load(pre) {
      let r = pre ? { plugins: pre } : null;
      try { r = await api('plugins'); } catch (e) { if (!r) { toast('Plugins: ' + e.message); r = { plugins: [] }; } }
      BS.plugins.list = r.plugins || []; BS.plugins.dirs = r.dirs || []; BS.plugins.config = r.config || '';
      for (const p of BS.plugins.list.filter(x => x.enabled && !x.error && x.ui)) {
        await new Promise((ok) => { const s = document.createElement('script'); s.src = '/plugins/' + encodeURIComponent(p.id) + '.js?v=' + encodeURIComponent(p.version || '') + '&t=' + Date.now(); s.onload = ok; s.onerror = () => { p.error = 'o script da interface não carregou'; ok(); }; document.head.appendChild(s); });
      }
      for (const p of BS.plugins.list) {
        const fn = BS.plugins.defs.get(p.id); if (!fn || !p.enabled || p.error) continue;
        try { fn(BS, p); p.loaded = true; } catch (e) { p.error = 'interface: ' + e.message; console.error('plugin ' + p.id, e); }
      }
    },
  },
};
BS.define = BS.plugins.define;
BS.doc = DOC; // janela de documento: os módulos deixam de lado o que é só da IDE (atualização, servidores, dependências)

// abre outro projeto/pasta (ex.: a raiz do checkout) e vai ao arquivo e linha; não espera o Git/SVN da pasta nova
async function openOutside(root, rel, line) {
  if (!root || !rel) return;
  selectProject(root);
  for (let i = 0; i < 100 && (!S.project || S.project.path !== root); i++) await new Promise(r => setTimeout(r, 20));
  await openFile(rel, 'editor', line);
}

// ----- painéis do núcleo -----
BS.tools.register({ id: 'project', title: 'Projeto', icon: I.open, key: 'Alt+1', order: 10, render: renderProject });
BS.tools.register({ id: 'changes', title: 'Alterações', icon: I.changes, key: 'Alt+2', order: 20, render: renderChanges });
BS.tools.register({ id: 'history', title: 'Histórico', icon: I.hist, key: 'Alt+3', order: 30, render: renderHistory });
BS.tools.register({ id: 'problems', title: 'Problemas', icon: I.problems, key: 'Alt+4', order: 80, render() {}, toggle(open) { $('#problems').hidden = open === true ? false : !$('#problems').hidden; } });
BS.tools.register({ id: 'plugins', title: 'Plugins', icon: I.plug, key: 'Alt+7', order: 1000, bottom: true, render: renderPlugins });

// ----- aba Plugins (Alt+7): ligar/desligar, erros, pastas -----
function renderPlugins() {
  const body = $('#toolBody'); const list = BS.plugins.list;
  $('#toolSub').textContent = `${list.filter(p => p.enabled && !p.error).length} de ${list.length}`;
  $('#toolActions').innerHTML = `<button class="icon-btn" id="plDir" title="Abrir a pasta dos seus plugins">${I.explorer}</button><button class="icon-btn" id="plReload" title="Recarregar plugins">${I.refresh}</button>`;
  $('#plReload').onclick = () => pluginsPost({ reload: true });
  $('#plDir').onclick = () => reveal(BS.plugins.dirs[1] || BS.plugins.dirs[0]);
  // um cartão por plugin: ícone, nome, descrição (duas linhas; "mais" abre o resto) e o interruptor à direita
  body.innerHTML = list.length ? `<div class="plugs">${list.map(p => `<div class="plug ${p.enabled ? '' : 'off'} ${p.error ? 'bad' : ''}" data-id="${esc(p.id)}">
      ${plugIcon(p)}
      <div class="tx"><div class="nm"><span class="pl-name">${esc(p.name)}</span></div>
        ${p.description ? `<div class="ds">${esc(p.description)}</div><button class="pl-more" hidden>mais</button>` : ''}
        ${p.requires && p.requires.length ? `<div class="pl-req">Precisa de: ${p.requires.map(esc).join(', ')}</div>` : ''}
        ${p.error ? `<div class="er">${esc(p.error)}</div>` : ''}</div>
      <button class="sw2 ${p.enabled ? 'on' : ''}" role="switch" aria-checked="${p.enabled}" title="${p.enabled ? 'Desligar' : 'Ligar'} ${esc(p.name)}"><span class="kn"></span></button></div>`).join('')}</div>` : '<div class="empty">Nenhum plugin instalado.</div>';
  body.querySelectorAll('.plug').forEach(el => {
    const p = list.find(x => x.id === el.dataset.id), sw = el.querySelector('.sw2');
    sw.onclick = () => { if (sw.disabled) return; sw.disabled = true; sw.classList.toggle('on'); sw.classList.add('busy'); sw.setAttribute('aria-checked', String(!p.enabled)); setTimeout(() => pluginsPost({ id: p.id, enabled: !p.enabled }), 180); };
    const more = el.querySelector('.pl-more');
    if (more) more.onclick = () => { const open = el.classList.toggle('open'); more.textContent = open ? 'menos' : 'mais'; };
    el.oncontextmenu = (e) => showMenu(e, [{ label: p.enabled ? 'Desligar' : 'Ligar', action: () => pluginsPost({ id: p.id, enabled: !p.enabled }) }, '-', { label: 'Mostrar pasta', icon: I.explorer, action: () => reveal(p.path) }, ...(BS.pluginStore ? BS.pluginStore.menu(p) : [])], `${p.name} v${p.version}`);
  });
  plugClamp(body);
  // servidores de plugins (plugstore.js): atualizações, catálogo e a lista de servidores
  if (BS.pluginStore) BS.pluginStore.decorate(body);
}
// ícone do plugin: a imagem do plugin.json ou, sem ela, um padrão com as iniciais numa cor tirada do id
function plugIcon(p, cls = '') {
  if (typeof p.icon === 'string' && /^data:image\/(svg\+xml|png|jpeg|webp);base64,/.test(p.icon)) return `<span class="pl-icon ${cls}"><img src="${esc(p.icon)}" alt="" draggable="false"></span>`;
  let h = 0; for (const c of String(p.id || p.name || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
  const words = String(p.name || p.id || '').replace(/\(.*?\)/g, ' ').split(/[\s_-]+/).filter(w => /^[\p{L}\p{N}]/u.test(w));
  const ini = (words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] || '?')][0]).toUpperCase();
  return `<span class="pl-icon def ${cls}" style="--h:${h % 360}">${esc(ini)}</span>`;
}
// descrição em duas linhas: o "mais" só aparece quando o texto não cabe (e é refeito quando o painel muda de largura)
function plugClamp(body) {
  const fit = () => body.querySelectorAll('.plug').forEach(el => {
    const ds = el.querySelector('.ds'), more = el.querySelector('.pl-more'); if (!ds || !more || el.classList.contains('open')) return;
    more.hidden = ds.scrollHeight <= ds.clientHeight + 1;
  });
  fit();
  if (!body._plugRO && window.ResizeObserver) { body._plugRO = new ResizeObserver(() => { if (S.tool === 'plugins') fit(); }); body._plugRO.observe(body); }
}
BS.plugIcon = plugIcon;
async function pluginsPost(body) {
  // a janela recarrega para aplicar o plugin; volta direto para a aba Plugins
  try { await api('plugins', {}, { method: 'POST', body: JSON.stringify(body) }); store.set('reopenTool', 'plugins'); toast('Recarregando…'); setTimeout(() => location.reload(), 150); }
  catch (e) { toast(e.message); }
}

// ===== Tela do projeto (sem abas abertas) =====
// Coluna principal: o README do projeto (Markdown renderizado) ou, sem README, uma visão geral nativa (linguagens,
// sistemas de build, arquivos recentes). Coluna da direita: alterações, último commit, histórico e os cards dos
// plugins (BS.dashboard.card), que continuam com o mesmo contrato.
const LANG_COLOR = { Java: '#C9853B', Kotlin: '#A97BFF', Scala: '#DC322F', Groovy: '#4298B8', JavaScript: '#E8C547', TypeScript: '#3B82C4', Vue: '#41B883', HTML: '#E34C26', JSP: '#D9734E', CSS: '#7C5BC0', Sass: '#C6538C', Python: '#3572A5', Ruby: '#B8312F', PHP: '#7A86B8', Go: '#00ADD8', Rust: '#DEA584', C: '#7C8794', 'C++': '#F34B7D', 'C#': '#3FA34D', 'F#': '#B845FC', Swift: '#F05138', Dart: '#00B4AB', SQL: '#E38C00', Shell: '#89E051', PowerShell: '#4F8CC9', XML: '#0060AC', JSON: '#8A8F98', YAML: '#CB171E', Docs: '#5B7FA6', Elixir: '#6E4A7E', Haskell: '#5E5086', Lua: '#3D5CA8', Terraform: '#7B42BC' };
function loadOverview(force) {
  if (!S.project) return;
  const proj = S.project.path;
  if (!force && S.overview && S.overview.for === proj) return;
  if (!force && S.overviewLoading === proj) return;
  S.overviewLoading = proj;
  api('overview', { project: proj }).then(o => { if (S.project && S.project.path === proj) { S.overview = { ...o, for: proj }; renderDashboard(); } })
    .catch(e => { if (S.project && S.project.path === proj) { S.overview = { for: proj, error: e.message }; renderDashboard(); } })
    .finally(() => { if (S.overviewLoading === proj) S.overviewLoading = null; });
}
const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
function langBar(langs) {
  const tot = langs.reduce((a, l) => a + l.bytes, 0) || 1;
  return `<div class="lbar">${langs.map(l => `<i style="flex:${l.bytes};background:${LANG_COLOR[l.name] || 'var(--muted)'}" title="${esc(l.name)} · ${(l.bytes * 100 / tot).toFixed(1)}%"></i>`).join('')}</div>
    <div class="llist">${langs.map(l => `<span><i style="background:${LANG_COLOR[l.name] || 'var(--muted)'}"></i>${esc(l.name)}<em>${(l.bytes * 100 / tot).toFixed(l.bytes * 100 / tot < 10 ? 1 : 0)}%</em></span>`).join('')}</div>`;
}
// README em Markdown: renderiza, limpa o HTML e liga imagens e links relativos ao projeto
function renderReadme(el, o) {
  el.innerHTML = window.DOMPurify ? DOMPurify.sanitize(window.marked ? marked.parse(o.readme.text, { gfm: true, breaks: false }) : `<pre>${esc(o.readme.text)}</pre>`, { ADD_ATTR: ['target'] }) : esc(o.readme.text);
  mdBind(el, el, '', S.project.path);
}
// HTML já renderizado de Markdown (el, dentro de scope): imagens e links relativos à pasta dir do projeto,
// âncoras rolam dentro de scope e blocos de código ganham as cores do editor
function mdBind(el, scope, dir, project) {
  const raw = (rel) => '/api/raw?project=' + encodeURIComponent(project) + '&file=' + encodeURIComponent(rel);
  const isLocal = (u) => u && !/^([a-z]+:|\/\/|#|data:)/i.test(u);
  const resolve = (u) => { const parts = (dir ? dir.split('/') : []); for (const seg of u.replace(/^\.\//, '').split(/[?#]/)[0].split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); } return parts.join('/'); };
  el.querySelectorAll('img').forEach(img => { const s = img.getAttribute('src'); if (isLocal(s)) img.src = raw(decodeURIComponent(resolve(s))); img.loading = 'lazy'; });
  el.querySelectorAll('a[href]').forEach(a => {
    const h = a.getAttribute('href');
    if (h.startsWith('#')) { a.onclick = (e) => { e.preventDefault(); const t = scope.querySelector('#' + CSS.escape(h.slice(1))) || [...scope.querySelectorAll('h1,h2,h3,h4')].find(x => x.textContent.trim().toLowerCase().replace(/\s+/g, '-') === h.slice(1).toLowerCase()); t?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; }
    else if (isLocal(h)) { a.onclick = (e) => { e.preventDefault(); openFile(decodeURIComponent(resolve(h)), 'editor'); }; a.title = 'Abrir no editor'; }
    else a.target = '_blank';
  });
  // blocos de código com as cores do editor
  if (monaco) el.querySelectorAll('pre > code').forEach(c => {
    const m = /language-([\w+-]+)/.exec(c.className); const lang = m && (LANG[m[1].toLowerCase()] || m[1].toLowerCase());
    if (!lang) return;
    monaco.editor.colorize(c.textContent, lang, {}).then(h => { c.innerHTML = h; c.classList.add('colorized'); }).catch(() => {});
  });
}
function renderDashboard() {
  const dash = $('#dash'); if (!dash) return;
  if (!S.project || S.active) { dash.hidden = true; return; }
  dash.hidden = false;
  loadOverview();
  const p = S.project, s = S.summary || p.summary; const last = s && s.last; const o = S.overview && S.overview.for === p.path ? S.overview : null;
  const chgRow = (c, cls) => `<div class="row chg ${cls || ''}" data-p="${esc(c.path)}" title="${esc(c.path)}"><span class="st ${esc(c.code)}">${esc(c.code)}</span><span class="name c-${esc(c.code.replace('?', '\\?'))}">${esc(c.path.split('/').pop())}</span><span class="meta">${statHtml(c)}</span></div>`;
  const tot = (fs) => fs.reduce((a, c) => ({ add: a.add + (c.add || 0), del: a.del + (c.del || 0) }), { add: 0, del: 0 });
  // coluna da direita: Git/SVN do núcleo + cards dos plugins
  const core = [
    { id: 'changes', order: 10, html: `<div class="t">${I.local}Alterações locais<span class="meta">${statHtml(tot(S.workFiles))}<span class="cnt">${S.workFiles.length}</span></span></div>
        ${p.vcs ? (S.workFiles.slice(0, 6).map(f => chgRow(f)).join('') || '<div class="empty">Nada pendente.</div>') + (S.workFiles.length > 6 ? `<a data-go="changes" data-mode="working" class="more">ver todas (${S.workFiles.length})</a>` : '') : '<div class="empty">Sem Git nem SVN nesta pasta.</div>'}` },
    ...(p.vcs ? [{ id: 'commit', order: 20, html: `<div class="t">${I.commit}Último commit<span class="meta">${last ? `<code>${esc(last.hash)}</code><span>${esc(last.when)}</span>` : ''}</span></div>
        ${last ? `<div class="subj" title="${esc(last.subject)}">${esc(last.subject)}</div><div class="m"><span>${esc(last.author)}</span></div>` + S.lastFiles.slice(0, 4).map(f => chgRow(f, 'last')).join('') + (S.lastFiles.length > 4 ? `<a data-go="changes" data-mode="last" class="more">ver todos (${S.lastFiles.length})</a>` : '') : '<div class="empty">Sem commits.</div>'}` },
      { id: 'history', order: 30, html: `<div class="t">${I.hist}Histórico<span class="meta"><a data-go="history">ver tudo</a></span></div>
        ${S.log.slice(0, 5).map(cm => `<div class="row" data-rev="${esc(cm.id)}" title="${esc(cm.subject)}"><span class="name" style="flex:1">${esc(cm.subject)}</span><span class="meta"><span>${esc(cm.when)}</span></span></div>`).join('') || '<div class="empty">Sem histórico.</div>'}` }] : []),
  ];
  const plug = BS.dashboard.cards.map(c => { let html = ''; try { html = c.html() || ''; } catch (e) { console.error(e); html = `<div class="errbox"><b>Card ${esc(c.id)} falhou.</b><div>${esc(e.message)}</div></div>`; } return { ...c, html, plugin: true }; }).filter(c => c.html);
  const cards = [...core, ...plug].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  // coluna principal: README ou visão geral nativa
  let main;
  if (!o) main = '<div class="ovload"><span class="spin"></span> Lendo o projeto…</div>';
  else if (o.readme && o.readme.text && o.readme.text.trim()) main = `<div class="mdbar">${I.open}<span>${esc(o.readme.file)}</span><a id="mdOpen">editar</a></div><article class="md" id="readme"></article>`;
  else {
    const sys = o.systems || [];
    const rec = seRecent().slice(0, 8);
    main = `<div class="ov">
      <section><h2>${esc(p.name)}</h2><p class="lead">${o.files} arquivos · ${fmtBytes(o.bytes || 0)}${o.languages && o.languages.length ? ' · principalmente ' + esc(o.languages[0].name) : ''}. Este projeto não tem README.md; <a id="ovNewReadme">criar um</a> deixa esta tela com a descrição do projeto.</p></section>
      ${o.languages && o.languages.length ? `<section><h3>Linguagens</h3>${langBar(o.languages)}</section>` : ''}
      <section><h3>Build</h3>${sys.length ? `<div class="ovsys">${sys.map(x => `<button class="ovs ${x.available ? '' : 'missing'}" data-go="build" title="${esc(x.note || x.file)}"><b>${esc(x.name)}</b><span>${esc(x.file || '')}</span>${x.available ? '' : `<em>sem ${esc(x.tool)}</em>`}</button>`).join('')}</div>` : '<p class="muted">Nenhum sistema de build reconhecido. Arquivos soltos podem ser executados com <kbd>Ctrl+Shift+F10</kbd>.</p>'}</section>
      <section><h3>Comece por aqui</h3><div class="ovgo">
        <button class="chip" data-act="files">${SEARCH_ICO}Abrir arquivo</button>
        <button class="chip" data-act="text">${SEARCH_ICO}Buscar texto</button>
        ${p.vcs ? `<button class="chip" data-go="changes">${I.changes}Alterações</button>` : ''}
        <button class="chip" data-go="build">${I.pkg}Build</button></div></section>
      ${rec.length ? `<section><h3>Abertos recentemente</h3>${rec.map(r => `<div class="row" data-open="${esc(r)}" title="${esc(r)}">${treeIcon({ name: r.split('/').pop() })}<span class="name">${esc(r.split('/').pop())}</span><span class="meta">${esc(r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '')}</span></div>`).join('')}</section>` : ''}
    </div>`;
  }
  const acts = [{ label: 'Alterações', icon: I.diff, go: 'changes', title: 'Alt+2' }, { label: 'Build', icon: I.pkg, go: 'build', title: 'Alt+6' }, ...BS.dashboard.actions];
  dash.innerHTML = `
    <div class="hd">${TI.project}<h1>${esc(p.name)}</h1>${p.vcs ? `<span class="pill ${p.vcs}">${p.vcs}</span>` : ''}${s && s.branch ? `<span class="br">${esc(s.branch)}</span>` : ''}<span class="path" title="${esc(p.path)}">${esc(p.path)}</span>
      <div class="acts">${acts.map(a => `<button class="chip" data-go="${esc(a.go)}" title="${esc(a.title || '')}">${a.icon || ''}${esc(a.label)}</button>`).join('')}<button class="icon-btn" id="dashRefresh" title="Atualizar (F5)">${I.refresh}</button></div></div>
    <div class="pgrid"><div class="pmain">${main}</div>
      <aside class="prail">${cards.map(c => `<div class="dcard ${c.plugin ? 'plugin' : ''}" data-card="${esc(c.id)}">${c.html}</div>`).join('')}
        ${o && o.readme && o.languages && o.languages.length ? `<div class="dcard"><div class="t">${I.local}Linguagens<span class="meta">${o.files} arquivos</span></div>${langBar(o.languages.slice(0, 6))}</div>` : ''}</aside></div>`;
  if (o && o.readme && o.readme.text && o.readme.text.trim()) { renderReadme($('#readme'), o); $('#mdOpen').onclick = () => openFile(o.readme.file, 'editor'); }
  $('#ovNewReadme')?.addEventListener('click', async () => {
    try { await api('file', { project: p.path, file: 'README.md' }, { method: 'PUT', body: `# ${p.name}\n\nO que é este projeto, como rodar e onde mexer.\n` }); S.overview = null; await openFile('README.md', 'editor'); } catch (e) { toast(e.message); }
  });
  dash.querySelectorAll('[data-go]').forEach(el => el.onclick = async () => { const m = el.dataset.mode; if (m && S.changeMode !== m) { S.changeMode = m; S.rev = null; store.set('changeMode', m); await refreshProject(); } openTool(el.dataset.go); });
  dash.querySelectorAll('[data-act]').forEach(el => el.onclick = () => openSearch(el.dataset.act));
  dash.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openFile(el.dataset.open, 'editor'));
  $('#dashRefresh').onclick = () => refreshAll();
  dash.querySelectorAll('.prail .row.chg').forEach(r => r.onclick = async () => { const m = r.classList.contains('last') ? 'last' : 'working'; if (S.changeMode !== m || S.rev) { S.changeMode = m; S.rev = null; store.set('changeMode', m); await refreshProject(); } openFile(r.dataset.p, 'diff'); });
  dash.querySelectorAll('.prail .row[data-rev]').forEach(r => r.onclick = () => goCommit(S.log.findIndex(c => c.id === r.dataset.rev)));
  for (const c of cards) if (c.bind) { const el = dash.querySelector(`[data-card="${c.id}"]`); try { if (el) c.bind(el); } catch (e) { console.error(e); } }
  BS.hooks.run('dashboard:render', dash);
}

// ===== Tela de atalhos (F1) =====
function showKeys() {
  const back = $('#keysBack'); if (!back.hidden) { back.hidden = true; return; }
  const k = (c) => c.split(' ').map(x => x.split('+').map(y => `<kbd>${esc(y)}</kbd>`).join('+')).join(' ');
  const groups = [
    ['Navegar', [['Buscar em tudo', 'Shift Shift'], ['Classes', 'Ctrl+N'], ['Arquivos', 'Ctrl+P'], ['Texto em todos os arquivos', 'Ctrl+Shift+F'], ['Ações', 'Ctrl+Shift+A'], ['Trocar projeto', 'Alt+P'], ['Selecionar arquivo aberto na árvore', 'Alt+F1']]],
    ['Janelas', BS.tools.list().filter(t => t.key).map(t => [t.title, t.key])],
    ['Editor', [['Salvar', 'Ctrl+S'], ['Salvar todos', 'Ctrl+Shift+S'], ['Fechar aba', 'Ctrl+W'], ['Próxima alteração do diff', 'Alt+↓'], ['Alteração anterior do diff', 'Alt+↑'], ['Próximo / anterior arquivo alterado', 'Alt+→ / Alt+←'], ['Commit mais antigo / mais novo', 'Alt+PageDown / Alt+PageUp'], ['Lint do arquivo', 'Ctrl+Alt+L'], ['Apresentar em tela cheia', 'F11']]],
    ['Geral', [['Atualizar projeto', 'F5'], ['Fechar menus e buscas', 'Esc'], ['Esta tela', 'F1']]],
  ];
  const known = new Set(groups.flatMap(g => g[1].map(x => x[1])));
  const extra = BS.actions.list().filter(a => a.k && !known.has(a.k));
  if (extra.length) groups.push(['Plugins', extra.map(a => [a.label, a.k])]);
  $('#keys').innerHTML = `<h2>Atalhos<button class="icon-btn" id="keysX" title="Fechar (Esc)">${I.x}</button></h2><div class="kcols">${groups.map(([t, list]) => `<div class="kg"><h3>${esc(t)}</h3>${list.map(([l, c]) => `<div class="kr"><span>${esc(l)}</span><span>${k(c)}</span></div>`).join('')}</div>`).join('')}</div>`;
  back.hidden = false; $('#keysX').onclick = () => { back.hidden = true; };
}
$('#keysBack').onclick = (e) => { if (e.target.id === 'keysBack') $('#keysBack').hidden = true; };
$('#btnKeys').onclick = showKeys;

// ===== Atalhos =====
// Tabela única de teclas (BS.keys): o núcleo registra as suas e os plugins registram as deles (ou substituem).
// Um handler que devolve false diz "não era comigo" e deixa o navegador seguir.
BS.keys.add('Ctrl+S', () => save());
BS.keys.add('Ctrl+Shift+S', () => saveAll());
BS.keys.add('Ctrl+P', () => openSearch('files'));
BS.keys.add('Ctrl+N', () => openSearch('classes'));
BS.keys.add('Ctrl+Shift+N', () => openSearch('files'));
BS.keys.add('Ctrl+Shift+F', () => openSearch('text'));
BS.keys.add('Ctrl+Shift+A', () => openSearch('actions'));
BS.keys.add('Ctrl+Alt+L', () => runLint());
BS.keys.add('F11', () => present(!$('#app').classList.contains('present')));
BS.keys.add('F5', () => refreshAll());
BS.keys.add('Alt+F1', () => treeLocate());
BS.keys.add('F1', () => showKeys());
BS.keys.add('Ctrl+=', () => codeFont(S.fontSize + 1)); BS.keys.add('Ctrl++', () => codeFont(S.fontSize + 1)); BS.keys.add('Ctrl+Shift+=', () => codeFont(S.fontSize + 1));
BS.keys.add('Ctrl+-', () => codeFont(S.fontSize - 1)); BS.keys.add('Ctrl+0', () => codeFont(FONT.def));
BS.keys.add('Escape', () => { $('#keysBack').hidden = true; seClose(); if ($('#app').classList.contains('present')) present(false); $('#netPop').hidden = true; const pp = $('#ppal'); if (pp) pp.hidden = true; document.querySelectorAll('.dlg').forEach(d => { d.hidden = true; }); closeMenu(); BS.hooks.run('escape'); return false; });
BS.keys.add('Alt+P', () => quickProject());
BS.keys.add('Ctrl+W', () => { if (!S.active) return false; askClose(S.active); });
BS.keys.add('Alt+ArrowDown', () => goDiff('next'));
BS.keys.add('Alt+ArrowUp', () => goDiff('previous'));
BS.keys.add('Alt+ArrowRight', () => { stepFile(1); });
BS.keys.add('Alt+ArrowLeft', () => { stepFile(-1); });
BS.keys.add('Alt+PageDown', () => { goCommit(S.changeMode === 'last' ? commitIx() + 1 : 0); });
BS.keys.add('Alt+PageUp', () => { if (S.changeMode === 'last') goCommit(commitIx() - 1); });
document.addEventListener('keydown', (e) => {
  const c = keyCombo(e);
  if (document.body.classList.contains('welcome') && !/^(Escape|F1|Ctrl\+Alt\+S|Alt\+P)$/.test(c)) return; // sem projeto, a IDE está escondida
  const h = BS.keys.get(c); if (!h) return;
  if (h(e) !== false) e.preventDefault();
});
window.addEventListener('beforeunload', (e) => { if (S.tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; } });
