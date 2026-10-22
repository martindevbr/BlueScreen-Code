/* BlueScreen: coloração pelo significado sem servidor de linguagem. A gramática do Monaco só sabe "identificador";
   aqui os identificadores ganham papel olhando os vizinhos: declaração e chamada de função/método, campo, campo
   estático (Classe.campo), constante (MAIUSCULAS), classe e macro. Sai como tokens semânticos com os mesmos nomes do
   servidor de linguagem ("s-..."; ver semRules em app.js), então as cores são as mesmas com ou sem servidor. Quando o
   servidor da linguagem está ligado, o provedor dele (registrado depois, ver lsp.js) tem prioridade. */
(function () {
'use strict';
// marcação, dados e linguagens em que "palavra(" não é chamada (SQL: INSERT INTO t (a, b); shell: comandos)
const SKIP = new Set(['plaintext', 'markdown', 'json', 'yaml', 'ini', 'xml', 'gherkin', 'dockerfile', 'sql', 'mysql', 'pgsql', 'redis', 'redshift', 'shell', 'bat', 'powershell', 'css', 'scss', 'less', 'csv', 'tsv', 'csp']);
// "Palavra(" é construtor/tipo nessas; em C#, Go e afins é método com letra maiúscula
const CTOR = new Set(['java', 'kotlin', 'scala', 'python', 'javascript', 'typescript', 'dart', 'swift', 'php', 'ruby', 'groovy', 'apex']);
// "List<String> nome(" e "int[] nome(": declaração em linguagens com o tipo antes do nome
const TYPED = new Set(['java', 'csharp', 'cpp', 'c', 'scala', 'dart', 'apex', 'kotlin', 'groovy', 'objective-c']);
// depois destas o nome é um tipo usado, não declarado
const USE_KW = new Set(['extends', 'implements', 'new', 'instanceof', 'throws', 'catch', 'as', 'is']);
const DECL_KW = new Set(['function', 'def', 'fn', 'func', 'fun', 'sub', 'proc', 'procedure', 'method', 'defn', 'defp', 'macro_rules']);
const TYPE_KW = new Set(['class', 'struct', 'interface', 'enum', 'trait', 'record', 'object', 'union', 'impl', 'typealias', 'module', 'protocol', 'extends', 'implements', 'new', 'instanceof', 'throws', 'catch', 'as', 'is']);
// palavras-chave depois das quais "nome(" é chamada, não declaração
const CALL_KW = new Set(['return', 'new', 'else', 'throw', 'await', 'yield', 'in', 'of', 'typeof', 'case', 'and', 'or', 'not', 'is', 'do', 'then', 'echo', 'print', 'delete', 'assert', 'if', 'elif', 'while', 'for', 'when', 'match', 'with', 'from', 'import', 'use', 'go', 'defer', 'let', 'var', 'val', 'const', 'lambda', 'raise', 'except', 'sizeof', 'instanceof', 'as', 'to', 'by', 'where', 'select', 'unless', 'until', 'loop', 'move', 'ref', 'mut', 'out', 'params', 'goto', 'default', 'export', 'extends', 'implements', 'throws', 'super', 'this', 'self']);
const LEGEND = { tokenTypes: ['s-class', 's-function', 's-method', 's-property', 's-variable', 's-macro', 's-enumMember'], tokenModifiers: ['declaration', 'static', 'constant'] };
const T = Object.fromEntries(LEGEND.tokenTypes.map((t, i) => [t.slice(2), i]));
const M = { declaration: 1, static: 2, constant: 4 };
const MAX_LINES = 20000, MAX_CHARS = 1500000;
const WORD = /[A-Za-z_$][\w$]*|\S/g;
const isCap = (w) => /^[A-Z]/.test(w) && /[a-z]/.test(w);
const isConst = (w) => /^[A-Z][A-Z0-9_]*$/.test(w) && w.length > 1;

// texto em pedaços: palavras e símbolos, cada um com o tipo do token da gramática; comentário e texto viram um bloco
function lexemes(model, lang) {
  const out = [], lines = monaco.editor.tokenize(model.getValue(), lang);
  for (let ln = 0; ln < lines.length; ln++) {
    const text = model.getLineContent(ln + 1), toks = lines[ln];
    for (let i = 0; i < toks.length; i++) {
      const a = toks[i].offset, b = i + 1 < toks.length ? toks[i + 1].offset : text.length, type = toks[i].type || '';
      if (/^(comment|string|regexp)|\.(comment|string)/.test(type)) { out.push({ ln, col: a, w: '', type: 'x' }); continue; }
      const s = text.slice(a, b); let m; WORD.lastIndex = 0;
      while ((m = WORD.exec(s))) out.push({ ln, col: a + m.index, w: m[0], type });
    }
  }
  return out;
}
const isId = (x) => x && /^(identifier|type\.identifier)/.test(x.type) && /^[A-Za-z_$]/.test(x.w);
const isKw = (x) => x && /^keyword/.test(x.type) && /^[A-Za-z_]/.test(x.w);
// depois de "nome", pula genéricos colados (nome<T>) e devolve o índice do que vem em seguida
function afterGeneric(L, i) {
  if (!L[i + 1] || L[i + 1].w !== '<' || L[i + 1].col !== L[i].col + L[i].w.length || L[i + 1].ln !== L[i].ln) return i + 1;
  let d = 0;
  for (let j = i + 1; j < L.length && L[j].ln === L[i].ln; j++) {
    const w = L[j].w;
    if (w === '<') d++; else if (w === '>') { if (--d === 0) return j + 1; } else if (!/^[\w$]+$|^[,.?:\[\]*'\s]$/.test(w)) return i + 1;
  }
  return i + 1;
}
// ")" que fecha o "(" em k, na mesma linha
function closeParen(L, k) {
  let d = 0;
  for (let j = k; j < L.length && L[j].ln === L[k].ln; j++) { if (L[j].w === '(') d++; else if (L[j].w === ')' && --d === 0) return j; }
  return -1;
}
function classify(L, lang) {
  const res = []; let skipLine = false;
  const put = (x, type, mods = 0) => res.push([x.ln, x.col, x.w.length, T[type], mods]);
  for (let i = 0; i < L.length; i++) {
    const x = L[i];
    // import java.util.List; package a.b; using X.Y: caminho, não código
    if (!L[i - 1] || L[i - 1].ln !== x.ln) skipLine = isKw(x) && /^(import|package|using|use|from|namespace|module|require|include)$/.test(x.w);
    if (skipLine || !isId(x)) continue;
    const w = x.w, p = L[i - 1], pp = L[i - 2];
    const pw = p ? p.w : '', member = pw === '.' || pw === '->' || (pw === ':' && pp && pp.w === ':') || (pw === '.' && pp && pp.w === '?');
    const owner = member ? (pw === ':' ? L[i - 3] : pp && pp.w === '?' ? L[i - 3] : pp) : null;
    const n = afterGeneric(L, i), nx = L[n], call = nx && nx.w === '(' && nx.ln === x.ln;
    if (lang === 'rust' && nx && nx.w === '!' && L[n + 1] && /^[(\[{]$/.test(L[n + 1].w)) { put(x, 'macro'); continue; }
    if (p && isKw(p) && TYPE_KW.has(p.w) && !call) { const decl = !USE_KW.has(p.w); if (isCap(w) || decl) put(x, 'class', decl ? M.declaration : 0); continue; }
    if (call) {
      if (p && isKw(p) && DECL_KW.has(p.w)) { put(x, member ? 'method' : 'function', M.declaration); continue; }
      if (pw === 'new' || (isCap(w) && CTOR.has(lang) && !member)) { put(x, lang === 'rust' ? 'enumMember' : 'class'); continue; }
      if (lang === 'rust' && isCap(w)) { put(x, 'enumMember'); continue; }
      if (isConst(w) && /^(c|cpp|objective-c)$/.test(lang)) { put(x, 'macro'); continue; }
      if (member) { put(x, 'method'); continue; }
      // tipo antes do nome (void main(, List<X> lista(, int[] f(): declaração
      const typed = p && ((isId(p) && !CALL_KW.has(p.w)) || (isKw(p) && !CALL_KW.has(p.w)) || (TYPED.has(lang) && (pw === '>' || pw === ']')));
      if (typed) { put(x, 'method', M.declaration); continue; }
      // método de classe em JS/TS e afins: nome(...) { no começo da linha
      const c = closeParen(L, n), after = c >= 0 ? L[c + 1] : null;
      if ((!p || p.ln !== x.ln || /^[;{}]$/.test(pw)) && after && (after.w === '{' || (after.w === ':' && /script/.test(lang)))) { put(x, 'method', M.declaration); continue; }
      put(x, 'function'); continue;
    }
    if (isConst(w)) { put(x, 'variable', M.constant); continue; }
    if (member) {
      if (pw === ':' && nx && nx.w === ':' && !isCap(w)) continue; // caminho de módulo: std::fs::...
      if (isCap(w) && owner && isCap(owner.w)) { put(x, 'class'); continue; }
      put(x, 'property', owner && isId(owner) && (isCap(owner.w) || isConst(owner.w)) ? M.static : 0); continue;
    }
    if (isCap(w) && lang !== 'go') put(x, 'class');
  }
  return res;
}
function encode(res) {
  res.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const d = new Uint32Array(res.length * 5); let pl = 0, pc = 0;
  res.forEach((t, k) => { const dl = t[0] - pl; d.set([dl, dl ? t[1] : t[1] - pc, t[2], t[3], t[4]], k * 5); pl = t[0]; pc = t[1]; });
  return d;
}
// a gramática da linguagem carrega sob demanda: até ela chegar, tokenize devolve tudo sem tipo. Nesse caso pede de novo logo depois
let changed = null, timer = 0;
const tries = new WeakMap();
const ready = (model, lang) => {
  const n = Math.min(model.getLineCount(), 50), src = Array.from({ length: n }, (_, i) => model.getLineContent(i + 1)).join('\n');
  return !src.trim() || monaco.editor.tokenize(src, lang).some(l => l.some(t => t.type));
};
const provider = {
  getLegend: () => LEGEND,
  get onDidChange() { return (changed = changed || new monaco.Emitter()).event; },
  provideDocumentSemanticTokens(model) {
    const lang = model.getLanguageId();
    if (SKIP.has(lang) || model.getLineCount() > MAX_LINES || model.getValueLength() > MAX_CHARS) return null;
    if (!ready(model, lang)) {
      const n = (tries.get(model) || 0) + 1; tries.set(model, n);
      if (n <= 40 && !timer) timer = setTimeout(() => { timer = 0; changed && changed.fire(); }, 250);
      return null;
    }
    try { return { data: encode(classify(lexemes(model, lang), lang)) }; } catch { return null; }
  },
  releaseDocumentSemanticTokens() {},
};
// registra em todas as linguagens conhecidas; chamado pelo núcleo assim que o Monaco carrega, antes do servidor de linguagem
const done = new Set();
window.registerSmartTokens = function () {
  for (const { id } of monaco.languages.getLanguages()) {
    if (SKIP.has(id) || done.has(id)) continue; done.add(id);
    monaco.languages.registerDocumentSemanticTokensProvider(id, provider);
  }
};
})();
