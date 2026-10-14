/* BlueScreen: Aparência. Temas (cores da interface, do código e da sintaxe), fontes, tamanho da interface e forma.
   Vem com predefinições prontas; tudo pode ser editado ao vivo e salvo como predefinição própria (exportável em JSON).
   O tema atual e as predefinições do usuário ficam em ~/.bluescreen/settings.json (rota /api/settings) e numa cópia
   local para pintar a tela já na abertura, sem piscar. */
(function () {
'use strict';
// ---------- o que um tema define ----------
// ui: variáveis CSS da interface. syntax: cores do código. fonts: famílias e tamanhos. shape: cantos e espaçamento.
const GROUPS = [
  ['Fundo da janela', [['canvas', 'Fundo (atrás das ilhas)'], ['canvas-fg', 'Texto sobre o fundo']]],
  ['Superfícies', [['bg', 'Editor de código'], ['panel', 'Painéis'], ['panel-2', 'Painel secundário'], ['hover', 'Passar o mouse'], ['sel', 'Seleção'], ['line', 'Bordas'], ['line-2', 'Bordas fortes']]],
  ['Texto', [['fg', 'Texto principal'], ['fg-2', 'Texto secundário'], ['muted', 'Texto apagado']]],
  ['Destaque', [['accent', 'Destaque'], ['accent-2', 'Destaque claro'], ['on-accent', 'Texto sobre o destaque']]],
  ['Estados', [['add', 'Adicionado / sucesso'], ['mod', 'Modificado'], ['del', 'Removido / erro'], ['warn', 'Aviso'], ['unk', 'Desconhecido']]],
  ['Ícones', [['ico', 'Pasta e arquivo'], ['ico-src', 'Código-fonte'], ['ico-test', 'Testes'], ['ico-res', 'Resources'], ['ico-web', 'Web'], ['j-class', 'Classe'], ['j-int', 'Interface'], ['j-enum', 'Enum'], ['j-exc', 'Exceção']]],
];
const SYNTAX = [['comment', 'Comentários'], ['keyword', 'Palavras-chave'], ['string', 'Textos'], ['number', 'Números'], ['type', 'Tipos'], ['function', 'Variáveis e membros'], ['annotation', 'Anotações'], ['tag', 'Tags (HTML/XML)'], ['attr', 'Atributos'], ['delimiter', 'Pontuação'], ['plain', 'Código comum']];
const UI_FONTS = ['IBM Plex Sans', 'Segoe UI Variable Text', 'Segoe UI', 'Inter', 'Bahnschrift', 'Calibri', 'Verdana', 'Tahoma', 'Arial', 'system-ui'];
const CODE_FONTS = ['JetBrains Mono', 'Cascadia Code', 'Cascadia Mono', 'Fira Code', 'Source Code Pro', 'Consolas', 'Lucida Console', 'Courier New'];

// ---------- predefinições ----------
const base = { fonts: { ui: 'IBM Plex Sans', uiZoom: 100, code: 'JetBrains Mono', codeSize: 13, lineHeight: 1.7, ligatures: true }, shape: { radius: 10, gap: 6 } };
const icons = (o) => Object.assign({ ico: '#9CA3B0', 'ico-src': '#6CA2FF', 'ico-test': '#6CC271', 'ico-res': '#D9B25E', 'ico-web': '#47B2D4', 'j-class': '#6CA2FF', 'j-int': '#6CC271', 'j-enum': '#B794F6', 'j-exc': '#F0606E', unk: '#9AA7B0' }, o);
const P = (id, name, mode, ui, syntax, extra = {}) => ({ id, name, mode, builtin: true, ui, syntax, fonts: { ...base.fonts, ...(extra.fonts || {}) }, shape: { ...base.shape, ...(extra.shape || {}) } });
const PRESETS = [
  P('bluescreen', 'BlueScreen', 'dark', icons({ canvas: '#0F1A2E', 'canvas-fg': '#9FB0CE', bg: '#191B21', panel: '#1E2129', 'panel-2': '#23262F', hover: '#2A2E39', sel: '#23365C', line: '#2A2F3A', 'line-2': '#343A47', fg: '#E1E4EA', 'fg-2': '#B4B9C4', muted: '#737B8C', accent: '#4C8DFF', 'accent-2': '#6CA2FF', 'on-accent': '#FFFFFF', add: '#5FB865', mod: '#4C8DFF', del: '#F0606E', warn: '#E3A63A' }),
    { comment: '#6E7581', keyword: '#CF8E6D', string: '#6AAB73', number: '#2AACB8', type: '#C77DBB', function: '#BCBEC4', annotation: '#B3AE60', tag: '#D5B778', attr: '#BCBEC4', delimiter: '#A1A6B0', plain: '#BCBEC4' }),
  P('bluescreen-claro', 'BlueScreen Claro', 'light', icons({ canvas: '#D9E3F5', 'canvas-fg': '#3D4F72', bg: '#FFFFFF', panel: '#F8F9FB', 'panel-2': '#EFF2F7', hover: '#E7EBF2', sel: '#D3E1FF', line: '#E2E6ED', 'line-2': '#D3D9E3', fg: '#1C1F26', 'fg-2': '#3E4450', muted: '#7D8594', accent: '#2E63D4', 'accent-2': '#2457C4', 'on-accent': '#FFFFFF', add: '#2E8540', mod: '#2E63D4', del: '#CF3B4A', warn: '#B87A10', ico: '#6C7380', 'ico-src': '#2E63D4', 'ico-test': '#208A3C', 'ico-res': '#A87100', 'ico-web': '#1D8AAE', 'j-class': '#2E63D4', 'j-int': '#208A3C', 'j-enum': '#7E4FD3', 'j-exc': '#CF3B4A', unk: '#6E7681' }),
    { comment: '#8C8C8C', keyword: '#0033B3', string: '#067D17', number: '#1750EB', type: '#871094', function: '#1C1F26', annotation: '#9E880D', tag: '#0033B3', attr: '#174AD4', delimiter: '#555A66', plain: '#1C1F26' }),
  P('meia-noite', 'Meia-noite', 'dark', icons({ canvas: '#100D22', 'canvas-fg': '#A9A2D6', bg: '#16132B', panel: '#1B1834', 'panel-2': '#221E3F', hover: '#2A2550', sel: '#3A2F7A', line: '#2A2548', 'line-2': '#372F5E', fg: '#ECE9FB', 'fg-2': '#BDB7DD', muted: '#7E77A6', accent: '#8B7CFF', 'accent-2': '#A99DFF', 'on-accent': '#FFFFFF', add: '#4FD1A5', mod: '#8B7CFF', del: '#FF6B8B', warn: '#F5B85C', 'ico-src': '#A99DFF', 'j-class': '#A99DFF', 'j-int': '#4FD1A5', 'ico-test': '#4FD1A5', 'j-enum': '#FF9BD2' }),
    { comment: '#6B6591', keyword: '#C792EA', string: '#C3E88D', number: '#F78C6C', type: '#FFCB6B', function: '#82AAFF', annotation: '#FF9BD2', tag: '#FF7AA8', attr: '#C792EA', delimiter: '#89DDFF', plain: '#D6D2F0' }),
  P('floresta', 'Floresta', 'dark', icons({ canvas: '#0D1913', 'canvas-fg': '#9DB8A6', bg: '#111D17', panel: '#16231C', 'panel-2': '#1B2B22', hover: '#22352A', sel: '#2C4A36', line: '#223429', 'line-2': '#2D4334', fg: '#E3EDE5', 'fg-2': '#B5C6B9', muted: '#6F8677', accent: '#E0A44A', 'accent-2': '#F0BA66', 'on-accent': '#1A1205', add: '#7CC67C', mod: '#6FB3D2', del: '#E86B5F', warn: '#E0A44A', 'ico-src': '#7CC67C', 'j-class': '#E0A44A', 'j-int': '#7CC67C', 'ico-test': '#9FD49F' }),
    { comment: '#5E7366', keyword: '#E0A44A', string: '#A3C98A', number: '#D98E73', type: '#8DC5B8', function: '#D7E3D9', annotation: '#C9B458', tag: '#E0A44A', attr: '#8DC5B8', delimiter: '#93A79A', plain: '#D2DED5' }),
  P('aurora', 'Aurora', 'dark', icons({ canvas: '#061A1F', 'canvas-fg': '#8FBFC4', bg: '#0A1F24', panel: '#0E252B', 'panel-2': '#122E35', hover: '#183A42', sel: '#1C4D57', line: '#173A41', 'line-2': '#21484F', fg: '#DDF4F4', 'fg-2': '#A6CDD0', muted: '#5F8A90', accent: '#2ED3C6', 'accent-2': '#5EE6DA', 'on-accent': '#04201D', add: '#7EE08A', mod: '#2ED3C6', del: '#FF6FA3', warn: '#FFC857', 'ico-src': '#5EE6DA', 'j-class': '#5EE6DA', 'j-int': '#7EE08A', 'j-enum': '#FF8FCB' }),
    { comment: '#4F767C', keyword: '#FF8FCB', string: '#9BE7A8', number: '#FFC857', type: '#5EE6DA', function: '#BFE9EC', annotation: '#FFB86B', tag: '#FF8FCB', attr: '#5EE6DA', delimiter: '#7FAAB0', plain: '#D2EEEF' }),
  P('grafite', 'Grafite', 'dark', icons({ canvas: '#121212', 'canvas-fg': '#A3A3A3', bg: '#171717', panel: '#1C1C1C', 'panel-2': '#222222', hover: '#2A2A2A', sel: '#3A2A1C', line: '#2A2A2A', 'line-2': '#363636', fg: '#EDEDED', 'fg-2': '#BDBDBD', muted: '#7A7A7A', accent: '#FF7A1A', 'accent-2': '#FF9447', 'on-accent': '#1A0D00', add: '#8BC34A', mod: '#5AA9E6', del: '#F2545B', warn: '#FFB020', ico: '#9A9A9A', 'ico-src': '#FF9447', 'j-class': '#FF9447', 'j-int': '#8BC34A', 'j-enum': '#C79BFF' }),
    { comment: '#6A6A6A', keyword: '#FF9447', string: '#B5CEA8', number: '#79C0FF', type: '#E6E6E6', function: '#D4D4D4', annotation: '#FFB020', tag: '#FF9447', attr: '#9CDCFE', delimiter: '#9A9A9A', plain: '#D4D4D4' },
    { fonts: { ui: 'Segoe UI Variable Text', code: 'Cascadia Code' }, shape: { radius: 6, gap: 4 } }),
  P('cafe', 'Café', 'dark', icons({ canvas: '#1A120E', 'canvas-fg': '#BFA693', bg: '#1F1713', panel: '#251C17', 'panel-2': '#2C221C', hover: '#352921', sel: '#4A3426', line: '#3A2C24', 'line-2': '#47372D', fg: '#F2E7DD', 'fg-2': '#CFBDAD', muted: '#8E7867', accent: '#D9885B', 'accent-2': '#E9A27A', 'on-accent': '#1F0F06', add: '#9DBF6E', mod: '#7FA9C9', del: '#E06C5F', warn: '#E8B04B', 'ico-src': '#E9A27A', 'j-class': '#E9A27A', 'j-int': '#9DBF6E', 'ico-res': '#E8B04B' }),
    { comment: '#7E6A5C', keyword: '#D9885B', string: '#B5C98A', number: '#E8B04B', type: '#C9A0DC', function: '#E8D9CB', annotation: '#D4B26A', tag: '#D9885B', attr: '#C9A0DC', delimiter: '#A99484', plain: '#E3D4C6' },
    { shape: { radius: 12 } }),
  P('papel', 'Papel', 'light', icons({ canvas: '#E7DFD0', 'canvas-fg': '#5A5040', bg: '#FFFCF5', panel: '#FBF7EF', 'panel-2': '#F3EDE1', hover: '#EDE5D5', sel: '#DCE6F0', line: '#E6DDCB', 'line-2': '#D8CCB6', fg: '#2B2620', 'fg-2': '#4E463B', muted: '#8C8170', accent: '#2F5D8A', 'accent-2': '#24507A', 'on-accent': '#FFFFFF', add: '#3D7A3A', mod: '#2F5D8A', del: '#B23A3A', warn: '#A86A10', ico: '#7A6F5E', 'ico-src': '#2F5D8A', 'ico-test': '#3D7A3A', 'ico-res': '#A86A10', 'ico-web': '#2E7C8C', 'j-class': '#2F5D8A', 'j-int': '#3D7A3A', 'j-enum': '#7B4F9E', 'j-exc': '#B23A3A', unk: '#7A6F5E' }),
    { comment: '#9A8F7C', keyword: '#2F5D8A', string: '#4D7A2E', number: '#9A4A1F', type: '#7B4F9E', function: '#2B2620', annotation: '#8A6A10', tag: '#2F5D8A', attr: '#9A4A1F', delimiter: '#6B6152', plain: '#2B2620' },
    { fonts: { lineHeight: 1.8 }, shape: { radius: 8 } }),
  P('solar', 'Solar Claro', 'light', icons({ canvas: '#E4DCC4', 'canvas-fg': '#586E75', bg: '#FDF6E3', panel: '#FBF3DD', 'panel-2': '#F2EAD3', hover: '#EEE6CE', sel: '#E6DCC0', line: '#E6DFCB', 'line-2': '#D9D0B5', fg: '#073642', 'fg-2': '#2E4D57', muted: '#839496', accent: '#268BD2', 'accent-2': '#1F78B8', 'on-accent': '#FFFFFF', add: '#859900', mod: '#268BD2', del: '#DC322F', warn: '#B58900', ico: '#839496', 'ico-src': '#268BD2', 'ico-test': '#859900', 'ico-res': '#B58900', 'ico-web': '#2AA198', 'j-class': '#268BD2', 'j-int': '#859900', 'j-enum': '#6C71C4', 'j-exc': '#DC322F', unk: '#93A1A1' }),
    { comment: '#93A1A1', keyword: '#859900', string: '#2AA198', number: '#D33682', type: '#B58900', function: '#268BD2', annotation: '#CB4B16', tag: '#268BD2', attr: '#93A1A1', delimiter: '#657B83', plain: '#586E75' }),
  P('contraste', 'Alto contraste', 'dark', icons({ canvas: '#000000', 'canvas-fg': '#E0E0E0', bg: '#000000', panel: '#0A0A0A', 'panel-2': '#121212', hover: '#1F1F1F', sel: '#3D3300', line: '#5C5C5C', 'line-2': '#8A8A8A', fg: '#FFFFFF', 'fg-2': '#F0F0F0', muted: '#BDBDBD', accent: '#FFD400', 'accent-2': '#FFE45C', 'on-accent': '#000000', add: '#3DFF7A', mod: '#4DC3FF', del: '#FF4D4D', warn: '#FFB000', ico: '#E0E0E0', 'ico-src': '#4DC3FF', 'j-class': '#4DC3FF', 'j-int': '#3DFF7A', 'j-enum': '#E59BFF', 'j-exc': '#FF4D4D' }),
    { comment: '#9AE6B4', keyword: '#4DC3FF', string: '#FFD866', number: '#E59BFF', type: '#3DFF7A', function: '#FFFFFF', annotation: '#FFB000', tag: '#4DC3FF', attr: '#FFD866', delimiter: '#FFFFFF', plain: '#FFFFFF' },
    { shape: { radius: 4, gap: 4 } }),
];

// ---------- estado ----------
const clone = (o) => JSON.parse(JSON.stringify(o));
const A = { settings: { theme: null, presets: [], dark: 'bluescreen', light: 'bluescreen-claro' }, theme: null, open: false, tab: 'cores', dirty: false };
const allPresets = () => [...PRESETS, ...(A.settings.presets || [])];
const normalize = (t) => {
  const b = PRESETS.find(p => p.id === (t && t.from)) || PRESETS.find(p => p.mode === (t && t.mode)) || PRESETS[0];
  return { ...clone(b), ...clone(t || {}), ui: { ...b.ui, ...((t && t.ui) || {}) }, syntax: { ...b.syntax, ...((t && t.syntax) || {}) }, fonts: { ...b.fonts, ...((t && t.fonts) || {}) }, shape: { ...b.shape, ...((t && t.shape) || {}) }, builtin: false };
};

// ---------- aplicar ----------
const rgbOf = (hex) => { let h = (hex || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h.slice(0, 6), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// CSS aceita rgba(); o Monaco só aceita hex (#RRGGBBAA) e pinta de vermelho o que não entende
const hexA = (hex, a) => `rgba(${rgbOf(hex).join(',')},${a})`;
const hexM = (hex, a) => '#' + [...rgbOf(hex), Math.round(Math.max(0, Math.min(1, a)) * 255)].map(v => v.toString(16).padStart(2, '0')).join('');
const q = (f) => /[\s,]/.test(f) && !/^["']/.test(f) && f !== 'system-ui' ? `'${f}'` : f;
function cssVars(t) {
  const v = { ...t.ui };
  v['canvas-hover'] = hexA(t.ui['canvas-fg'], t.mode === 'light' ? .12 : .09);
  v['canvas-on'] = hexA(t.ui['accent-2'], .18);
  v['tree-sel'] = t.ui.sel; v['tree-sel-blur'] = t.ui.hover; v['tab-active-bg'] = t.ui.bg;
  v.shadow = t.mode === 'light' ? `0 12px 32px ${hexA(t.ui.fg, .16)}, 0 0 0 1px ${hexA(t.ui.fg, .05)}` : '0 12px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04)';
  v.ui = `${q(t.fonts.ui)}, 'Segoe UI', system-ui, sans-serif`;
  v.mono = `${q(t.fonts.code)}, 'Cascadia Code', Consolas, monospace`;
  v.r = t.shape.radius + 'px'; v['r-sm'] = Math.max(2, Math.round(t.shape.radius * .6)) + 'px'; v.gap = t.shape.gap + 'px';
  return v;
}
function monacoTheme(t) {
  const s = t.syntax, u = t.ui, x = (c) => (c || '').replace('#', '');
  const it = (tok, c, style) => ({ token: tok, foreground: x(c), ...(style ? { fontStyle: style } : {}) });
  return {
    base: t.mode === 'light' ? 'vs' : 'vs-dark', inherit: true,
    rules: [it('', s.plain), it('comment', s.comment, 'italic'), it('keyword', s.keyword), it('string', s.string), it('string.escape', s.number), it('number', s.number), it('regexp', s.string),
      it('type', s.type), it('type.identifier', s.type), it('identifier', s.function), it('variable', s.function), it('variable.predefined', s.keyword), it('constant', s.number), it('predefined', s.keyword),
      it('delimiter', s.delimiter), it('operator', s.delimiter), it('tag', s.tag), it('metatag', s.annotation), it('annotation', s.annotation), it('attribute.name', s.attr), it('attribute.value', s.string)],
    colors: {
      'editor.background': u.bg, 'editor.foreground': s.plain, 'editorGutter.background': u.bg, 'minimap.background': u.bg,
      'editorLineNumber.foreground': hexM(u.muted, .7), 'editorLineNumber.activeForeground': u['fg-2'], 'editorCursor.foreground': u.fg,
      'editor.lineHighlightBackground': hexM(u.fg, t.mode === 'light' ? .04 : .035), 'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': hexM(u['accent-2'], t.mode === 'light' ? .25 : .32), 'editor.inactiveSelectionBackground': hexM(u['accent-2'], .16),
      'editor.wordHighlightBackground': hexM(u['accent-2'], .14), 'editor.findMatchBackground': hexM(u.warn, .45), 'editor.findMatchHighlightBackground': hexM(u.warn, .22),
      'editorIndentGuide.background1': hexM(u.muted, .18), 'editorIndentGuide.activeBackground1': hexM(u.muted, .45), 'editorBracketMatch.background': hexM(u.accent, .18), 'editorBracketMatch.border': hexM(u.accent, .5),
      'editorWidget.background': u['panel-2'], 'editorWidget.border': u['line-2'], 'editorSuggestWidget.background': u['panel-2'], 'editorSuggestWidget.selectedBackground': u.sel, 'editorHoverWidget.background': u['panel-2'], 'editorHoverWidget.border': u['line-2'],
      'scrollbarSlider.background': hexM(u.muted, .28), 'scrollbarSlider.hoverBackground': hexM(u.muted, .45), 'editorOverviewRuler.border': u.bg, 'editorOverviewRuler.background': u.bg,
      'diffEditor.insertedTextBackground': hexM(u.add, .22), 'diffEditor.removedTextBackground': hexM(u.del, .22), 'diffEditor.insertedLineBackground': hexM(u.add, .1), 'diffEditor.removedLineBackground': hexM(u.del, .1), 'diffEditor.border': u.line,
      'stickyScroll.background': u.bg, 'editorStickyScrollHover.background': u.hover,
    },
  };
}
function apply(t, persistLocal = true) {
  A.theme = t;
  const root = document.documentElement;
  root.dataset.theme = t.mode === 'light' ? 'light' : 'dark';
  const v = cssVars(t);
  for (const [k, val] of Object.entries(v)) root.style.setProperty('--' + k, val);
  if (window.monaco) {
    monaco.editor.defineTheme('bs-custom', monacoTheme(t)); window.BS_MONACO_THEME = 'bs-custom'; monaco.editor.setTheme('bs-custom');
    const o = { fontFamily: v.mono, fontSize: t.fonts.codeSize, lineHeight: Math.round(t.fonts.codeSize * t.fonts.lineHeight), fontLigatures: !!t.fonts.ligatures };
    if (!document.getElementById('app').classList.contains('present')) { BS.editor?.updateOptions(o); BS.diffEditor?.updateOptions(o); }
    monaco.editor.remeasureFonts?.();
  }
  S.fontSize = t.fonts.codeSize;
  try { if (window.BS_DESKTOP && window.ipc) { window.ipc.postMessage(JSON.stringify({ type: 'theme', dark: t.mode !== 'light', caption: t.ui.canvas })); window.ipc.postMessage(JSON.stringify({ type: 'zoom', factor: (t.fonts.uiZoom || 100) / 100 })); } } catch {}
  if (persistLocal) try { localStorage.setItem('bs.themeCache', JSON.stringify(v)); localStorage.setItem('bs.theme', JSON.stringify(root.dataset.theme)); } catch {}
}
let saveTimer = 0;
function persist() {
  A.settings.theme = A.theme;
  if (A.theme.mode === 'light') A.settings.light = A.theme.from || A.settings.light; else A.settings.dark = A.theme.from || A.settings.dark;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api('settings', {}, { method: 'POST', body: JSON.stringify(A.settings) }).catch(() => {}), 400);
}
function usePreset(id) {
  const p = allPresets().find(x => x.id === id); if (!p) return;
  const t = normalize(p); t.from = p.id; t.name = p.name;
  apply(t); persist(); if (A.open) renderPanel();
}

// ---------- integração com o núcleo ----------
// o núcleo chama applyTheme() ao criar o editor; aqui o tema vem da Aparência
window.applyTheme = function () { if (A.theme) apply(A.theme, false); else if (window.monaco) monaco.editor.setTheme(document.documentElement.dataset.theme === 'light' ? 'bs-light' : 'bs-dark'); };
// zoom da fonte do código (Ctrl+roda, Ctrl+0...): vira o tamanho do código no tema atual
window.codeFont = function (size, quiet) {
  if (!A.theme) return;
  const n = Math.max(9, Math.min(36, Math.round(size)));
  A.theme.fonts.codeSize = n; apply(A.theme); persist();
  if (!quiet) toast(`Fonte do código: ${n}px`, null, 'font');
  if (A.open && A.tab === 'fontes') renderPanel();
};
// botão da lua: alterna entre o tema escuro e o claro escolhidos por último
document.getElementById('btnTheme').onclick = () => usePreset(A.theme && A.theme.mode === 'light' ? (A.settings.dark || 'bluescreen') : (A.settings.light || 'bluescreen-claro'));
document.getElementById('btnTheme').title = 'Tema claro / escuro (Aparência: Ctrl+Alt+S)';

// ---------- painel Aparência ----------
const swatch = (t) => { const u = { ...PRESETS[0].ui, ...(t.ui || {}) }; return `<span class="sw4"><i style="background:${u.canvas}"></i><i style="background:${u.panel}"></i><i style="background:${u.accent}"></i><i style="background:${(t.syntax || {}).keyword || u.accent}"></i><i style="background:${(t.syntax || {}).string || u.add}"></i></span>`; };
function renderPanel() {
  const box = document.getElementById('apr'); if (!box) return;
  const t = A.theme; const cur = t.from;
  const presets = allPresets();
  const color = (path, key, label) => { const val = (path === 'ui' ? t.ui : t.syntax)[key] || '#000000'; return `<label class="crow"><span>${esc(label)}</span><input type="color" data-p="${path}" data-k="${esc(key)}" value="${esc(val.slice(0, 7))}"><input class="hex" data-p="${path}" data-k="${esc(key)}" value="${esc(val)}" spellcheck="false" maxlength="9"></label>`; };
  let body = '';
  if (A.tab === 'cores') body = GROUPS.map(([g, list]) => `<div class="cgrp"><h4>${esc(g)}</h4>${list.map(([k, l]) => color('ui', k, l)).join('')}</div>`).join('');
  else if (A.tab === 'sintaxe') body = `<div class="cgrp"><h4>Cores do código</h4>${SYNTAX.map(([k, l]) => color('syntax', k, l)).join('')}</div><pre class="apr-prev" id="aprPrev"></pre>`;
  else if (A.tab === 'fontes') body = `<div class="fgrid">
      <label>Fonte da interface<input list="aprUiFonts" data-f="ui" value="${esc(t.fonts.ui)}" spellcheck="false"></label>
      <label>Tamanho da interface<span class="rng"><input type="range" min="80" max="150" step="5" data-f="uiZoom" value="${t.fonts.uiZoom || 100}"><b>${t.fonts.uiZoom || 100}%</b></span></label>
      <label>Fonte do código<input list="aprCodeFonts" data-f="code" value="${esc(t.fonts.code)}" spellcheck="false"></label>
      <label>Tamanho do código<span class="rng"><input type="range" min="9" max="28" step="1" data-f="codeSize" value="${t.fonts.codeSize}"><b>${t.fonts.codeSize}px</b></span></label>
      <label>Altura da linha do código<span class="rng"><input type="range" min="1.2" max="2.2" step="0.05" data-f="lineHeight" value="${t.fonts.lineHeight}"><b>${Number(t.fonts.lineHeight).toFixed(2)}</b></span></label>
      <label class="chk"><input type="checkbox" data-f="ligatures" ${t.fonts.ligatures ? 'checked' : ''}>Ligaduras no código (=>, !=, ===)</label>
      <datalist id="aprUiFonts">${UI_FONTS.map(f => `<option value="${esc(f)}">`).join('')}</datalist><datalist id="aprCodeFonts">${CODE_FONTS.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
      <p class="fnote">Vale qualquer fonte instalada no Windows: digite o nome. IBM Plex Sans e JetBrains Mono vêm com o BlueScreen. <a id="aprLocalFonts">Listar as fontes instaladas</a></p>
      <div class="fprev"><div style="font-family:${esc(cssVars(t).ui)}">Interface: Alterações locais · Último commit · Buscar em tudo</div><div style="font-family:${esc(cssVars(t).mono)};font-size:${t.fonts.codeSize}px;line-height:${t.fonts.lineHeight}">public long total(int a, int b) { return a + b; } // =&gt; != ===</div></div></div>`;
  else if (A.tab === 'forma') body = `<div class="fgrid">
      <label>Base<span class="seg"><button data-mode="dark" class="${t.mode !== 'light' ? 'on' : ''}">Escuro</button><button data-mode="light" class="${t.mode === 'light' ? 'on' : ''}">Claro</button></span></label>
      <label>Cantos arredondados<span class="rng"><input type="range" min="0" max="18" step="1" data-s="radius" value="${t.shape.radius}"><b>${t.shape.radius}px</b></span></label>
      <label>Espaço entre as ilhas<span class="rng"><input type="range" min="0" max="16" step="1" data-s="gap" value="${t.shape.gap}"><b>${t.shape.gap}px</b></span></label></div>`;
  box.innerHTML = `<div class="apr-side">
      <div class="apr-h">Predefinições</div>
      <div class="apr-list">${presets.map(p => `<div class="apr-p ${p.id === cur ? 'on' : ''}" data-id="${esc(p.id)}" tabindex="0">${swatch(p)}<span class="nm">${esc(p.name)}</span>${p.builtin ? '' : `<button class="icon-btn del" data-del="${esc(p.id)}" title="Apagar predefinição">${I.x}</button>`}</div>`).join('')}</div>
      <div class="apr-save"><input id="aprName" placeholder="Nome da predefinição" value="${esc(A.dirty ? '' : '')}" spellcheck="false"><button class="chip primary" id="aprSave">Salvar</button></div>
      <div class="apr-io"><a id="aprExport">Exportar</a><a id="aprImport">Importar</a><a id="aprReset">Restaurar padrão</a></div>
    </div>
    <div class="apr-main">
      <div class="apr-top"><div class="apr-tabs">${[['cores', 'Interface'], ['sintaxe', 'Código'], ['fontes', 'Fontes'], ['forma', 'Forma']].map(([k, l]) => `<button data-tab="${k}" class="${A.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="apr-cur">${esc(t.name || 'Personalizado')}${A.dirty ? ' (alterado)' : ''}</span><button class="icon-btn" id="aprClose" title="Fechar (Esc)">${I.x}</button></div>
      <div class="apr-body">${body}</div>
    </div>`;
  bindPanel(box);
  if (A.tab === 'sintaxe') previewCode();
}
function previewCode() {
  const el = document.getElementById('aprPrev'); if (!el || !window.monaco) return;
  const src = '// Calcula o total das parcelas\n@Service\npublic class ParcelasController implements Repositorio {\n    private static final int LIMITE = 12;\n    public long total(List<Parcela> itens) {\n        String msg = "total: " + itens.size();\n        return itens.stream().mapToLong(Parcela::valor).sum();\n    }\n}';
  monaco.editor.colorize(src, 'java', {}).then(h => { el.innerHTML = h; });
}
function changed() { A.dirty = true; apply(A.theme); persist(); }
function bindPanel(box) {
  box.querySelectorAll('.apr-p').forEach(el => { el.onclick = (e) => { if (e.target.closest('[data-del]')) return; A.dirty = false; usePreset(el.dataset.id); }; el.onkeydown = (e) => { if (e.key === 'Enter') el.click(); }; });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { A.settings.presets = A.settings.presets.filter(p => p.id !== b.dataset.del); persist(); renderPanel(); toast('Predefinição apagada'); });
  box.querySelectorAll('.apr-tabs button').forEach(b => b.onclick = () => { A.tab = b.dataset.tab; renderPanel(); });
  box.querySelector('#aprClose').onclick = close;
  // cores: seletor e campo hex andam juntos
  box.querySelectorAll('input[type=color], input.hex').forEach(inp => inp.oninput = () => {
    let val = inp.value.trim(); if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(val)) return;
    const obj = inp.dataset.p === 'ui' ? A.theme.ui : A.theme.syntax; obj[inp.dataset.k] = val;
    box.querySelectorAll(`[data-p="${inp.dataset.p}"][data-k="${inp.dataset.k}"]`).forEach(o => { if (o !== inp) o.value = o.type === 'color' ? val.slice(0, 7) : val; });
    changed(); if (A.tab === 'sintaxe') previewCode();
  });
  box.querySelectorAll('[data-f]').forEach(inp => inp.oninput = inp.onchange = () => {
    const k = inp.dataset.f; A.theme.fonts[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value.trim();
    const b = inp.parentElement.querySelector('b'); if (b) b.textContent = k === 'uiZoom' ? inp.value + '%' : k === 'codeSize' ? inp.value + 'px' : Number(inp.value).toFixed(2);
    changed(); const pv = box.querySelector('.fprev'); if (pv && inp.type !== 'range') renderPanel();
  });
  box.querySelectorAll('[data-s]').forEach(inp => inp.oninput = () => { A.theme.shape[inp.dataset.s] = Number(inp.value); inp.parentElement.querySelector('b').textContent = inp.value + 'px'; changed(); });
  box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { A.theme.mode = b.dataset.mode; changed(); renderPanel(); });
  box.querySelector('#aprSave').onclick = () => {
    const name = box.querySelector('#aprName').value.trim(); if (!name) { box.querySelector('#aprName').focus(); return toast('Dê um nome à predefinição'); }
    const id = 'u-' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const p = { ...clone(A.theme), id, name, builtin: false, from: id };
    A.settings.presets = [...(A.settings.presets || []).filter(x => x.id !== id), p];
    A.theme.from = id; A.theme.name = name; A.dirty = false; persist(); renderPanel(); toast(`Predefinição "${name}" salva`, 'ok');
  };
  box.querySelector('#aprExport').onclick = () => { const j = JSON.stringify({ bluescreenTheme: 1, ...A.theme }, null, 2); navigator.clipboard.writeText(j).then(() => toast('Tema copiado (JSON). Cole em Importar em outro BlueScreen.', 'ok')).catch(() => toast('Não foi possível copiar')); };
  box.querySelector('#aprImport').onclick = () => {
    const body = box.querySelector('.apr-body');
    body.innerHTML = `<div class="imp"><p>Cole o JSON de um tema exportado:</p><textarea id="aprJson" spellcheck="false"></textarea><div><button class="chip primary" id="aprDoImport">Importar</button> <button class="chip" id="aprCancel">Cancelar</button></div></div>`;
    body.querySelector('#aprCancel').onclick = renderPanel;
    body.querySelector('#aprDoImport').onclick = () => {
      try { const j = JSON.parse(body.querySelector('#aprJson').value); const t = normalize(j); t.name = j.name || 'Importado'; t.from = 'u-' + Date.now(); A.settings.presets = [...(A.settings.presets || []), { ...clone(t), id: t.from, builtin: false }]; apply(t); persist(); renderPanel(); toast('Tema importado', 'ok'); }
      catch (e) { toast('JSON inválido: ' + e.message, 'err'); }
    };
  };
  box.querySelector('#aprReset').onclick = () => { A.dirty = false; usePreset('bluescreen'); };
  const lf = box.querySelector('#aprLocalFonts'); if (lf) lf.onclick = async () => {
    try { const fonts = await window.queryLocalFonts(); const fam = [...new Set(fonts.map(f => f.family))].sort(); const fill = (id, list) => { const d = document.getElementById(id); d.innerHTML = list.map(f => `<option value="${esc(f)}">`).join(''); }; fill('aprUiFonts', fam); fill('aprCodeFonts', fam); toast(`${fam.length} fontes instaladas: comece a digitar no campo`, 'ok'); }
    catch { toast('Este ambiente não deixou listar as fontes. Digite o nome da fonte instalada.'); }
  };
}
function open() {
  if (!A.theme) return;
  let back = document.getElementById('aprBack');
  if (!back) { document.body.insertAdjacentHTML('beforeend', '<div id="aprBack" hidden><div id="apr" role="dialog" aria-label="Aparência"></div></div>'); back = document.getElementById('aprBack'); back.onclick = (e) => { if (e.target === back) close(); }; }
  A.open = true; back.hidden = false; renderPanel();
}
function close() { A.open = false; const b = document.getElementById('aprBack'); if (b) b.hidden = true; }

// ---------- registro ----------
BS.appearance = { open, close, use: usePreset, presets: () => allPresets(), current: () => A.theme };
BS.keys.add('Ctrl+Alt+S', () => open());
BS.hooks.on('escape', () => close());
BS.actions.add([{ label: 'Aparência: temas e fontes', k: 'Ctrl+Alt+S', run: () => open(), icon: I.edit }, ...PRESETS.map(p => ({ label: 'Tema: ' + p.name, k: '', run: () => usePreset(p.id), icon: I.edit }))]);
document.getElementById('btnAppearance')?.addEventListener('click', () => open());

// carrega: cópia local (já aplicada pelo index.html) e depois o que está salvo em ~/.bluescreen/settings.json
(async () => {
  let s = {};
  try { s = await api('settings'); } catch {}
  A.settings = { presets: [], dark: 'bluescreen', light: 'bluescreen-claro', ...s };
  A.theme = A.settings.theme ? normalize(A.settings.theme) : (() => { const legacy = store.get('theme', 'dark'); const p = PRESETS.find(x => x.id === (legacy === 'light' ? 'bluescreen-claro' : 'bluescreen')); const t = normalize(p); t.from = p.id; t.name = p.name; return t; })();
  if (store.get('fontSize', null) && !A.settings.theme) A.theme.fonts.codeSize = store.get('fontSize', 13);
  apply(A.theme);
  const wait = setInterval(() => { if (window.monaco) { clearInterval(wait); apply(A.theme, false); } }, 100);
})();
})();
