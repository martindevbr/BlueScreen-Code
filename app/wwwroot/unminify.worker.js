'use strict';
// ===== Desminificar (roda num Worker: um bundle de MB levaria segundos e travaria o editor) =====
// JavaScript: acorn lê a árvore, as transformações abaixo desfazem o que o minificador (terser, uglify, esbuild) faz
// para economizar bytes, e o astring escreve o código de volta já indentado:
// - "a ? b() : c()" e "a && b()" usados como instrução viram if/else; "a || b()" vira "if (!a) b()";
// - "a(), b(), c()" e "return a(), b" viram instruções separadas; "var a = 1, b = 2" vira uma declaração por linha;
// - "!0" / "!1" viram true / false e "void 0" vira undefined.
// Só mexe em posição de instrução (onde o valor é descartado), então o comportamento do código não muda.
// O astring também devolve, para cada identificador e literal, onde ele estava no original: é o mapa que deixa ir e
// voltar entre o formatado e o arquivo de verdade na mesma posição.
// Empacotado com o packer do Dean Edwards (eval(function(p,a,c,k,e,d)...)): desempacota sem executar nada.
// Se o acorn não entende (TypeScript, JSX, erro de sintaxe) ou o arquivo é CSS/HTML/JSON, quem formata é o js-beautify.
if (typeof importScripts === 'function') importScripts('vendor/unminify/acorn.js', 'vendor/unminify/astring.min.js', 'vendor/unminify/beautifier.min.js');

// ----- packer do Dean Edwards, sem eval -----
function unpackDeanEdwards(src) {
  const re = /eval\(\(?function\(p,a,c,k,e,(?:r|d)\)\{[\s\S]*?\}\s*\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+|\[\])\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)[^)]*\)\)\)?/g;
  let n = 0;
  const out = src.replace(re, (all, p, a, c, k) => {
    const radix = a === '[]' ? 62 : +a, count = +c, words = k.split('|');
    const unq = (s) => s.replace(/\\(.)/g, (m, ch) => ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch);
    const enc = (v) => (v < radix ? '' : enc(Math.floor(v / radix))) + ((v = v % radix) > 35 ? String.fromCharCode(v + 29) : v.toString(36));
    const dict = new Map(); for (let i = count - 1; i >= 0; i--) dict.set(enc(i), words[i] || enc(i));
    n++; return unq(p).replace(/\b\w+\b/g, (w) => dict.has(w) ? dict.get(w) : w);
  });
  return n ? out : null;
}

// ----- transformações na árvore -----
const isStmtList = (node, key) => (node.type === 'Program' || node.type === 'BlockStatement' || node.type === 'StaticBlock') && key === 'body' || node.type === 'SwitchCase' && key === 'consequent';
const expr = (e) => ({ type: 'ExpressionStatement', expression: e });
const block = (list) => list.length === 1 && list[0].type === 'BlockStatement' ? list[0] : { type: 'BlockStatement', body: list };
const not = (e) => e.type === 'UnaryExpression' && e.operator === '!' && !(e.argument.type === 'UnaryExpression' && e.argument.operator === '!') && e.argument.type !== 'Literal' ? e.argument : { type: 'UnaryExpression', operator: '!', prefix: true, argument: e };

// uma instrução -> lista de instruções equivalentes, já expandidas
function expand(s) {
  switch (s.type) {
    case 'ExpressionStatement': {
      const e = s.expression;
      if (s.directive) return [s];
      if (e.type === 'SequenceExpression') return e.expressions.flatMap(x => expand(expr(x)));
      if (e.type === 'ConditionalExpression') return [ifOf(e.test, expand(expr(e.consequent)), expand(expr(e.alternate)))];
      if (e.type === 'LogicalExpression' && (e.operator === '&&' || e.operator === '||')) return [ifOf(e.operator === '&&' ? e.left : not(e.left), expand(expr(e.right)), null)];
      return [s];
    }
    case 'ReturnStatement': case 'ThrowStatement':
      if (s.argument && s.argument.type === 'SequenceExpression') { const l = s.argument.expressions; return [...l.slice(0, -1).flatMap(x => expand(expr(x))), { ...s, argument: l[l.length - 1] }]; }
      return [s];
    case 'IfStatement': {
      if (s.test.type === 'SequenceExpression') { const l = s.test.expressions; return [...l.slice(0, -1).flatMap(x => expand(expr(x))), ...expand({ ...s, test: l[l.length - 1] })]; }
      return [ifOf(s.test, expand(s.consequent), s.alternate ? expand(s.alternate) : null)];
    }
    case 'VariableDeclaration': {
      if (s.declarations.length > 1) return s.declarations.flatMap(d => expand({ type: 'VariableDeclaration', kind: s.kind, declarations: [d] }));
      const d = s.declarations[0], init = d && d.init;
      // "var e = (a(), b)" -> "a(); var e = b"
      if (init && init.type === 'SequenceExpression') { const l = init.expressions; return [...l.slice(0, -1).flatMap(x => expand(expr(x))), { ...s, declarations: [{ ...d, init: l[l.length - 1] }] }]; }
      return [s];
    }
    case 'BlockStatement': return [{ ...s, body: s.body.flatMap(expand) }];
    case 'EmptyStatement': return [];
    default: return [s];
  }
}
// sempre com chaves no "então" (evita o else pendurado no if de dentro); "else if" continua encadeado
function ifOf(test, cons, alt) {
  const s = { type: 'IfStatement', test, consequent: block(cons.length ? cons : []), alternate: null };
  if (alt && alt.length) s.alternate = alt.length === 1 && alt[0].type === 'IfStatement' ? alt[0] : block(alt);
  return s;
}
// corpo único de for/while/do/with/label: vira bloco quando a expansão gerar mais de uma instrução
function wrapBody(node, key) {
  const b = node[key]; if (!b || b.type === 'BlockStatement') return;
  const l = expand(b); node[key] = l.length === 1 ? l[0] : block(l);
}
function simplify(n) {
  if (n.type === 'UnaryExpression' && n.operator === '!' && n.argument.type === 'Literal' && typeof n.argument.value === 'number' && (n.argument.value === 0 || n.argument.value === 1))
    return { type: 'Literal', value: n.argument.value === 0, raw: n.argument.value === 0 ? 'true' : 'false', loc: n.loc };
  if (n.type === 'UnaryExpression' && n.operator === 'void' && n.argument.type === 'Literal' && n.argument.value === 0)
    return { type: 'Identifier', name: 'undefined', loc: n.loc };
  return n;
}
function walk(node) {
  if (!node || typeof node.type !== 'string') return node;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'comments' || key === 'trailingComments') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (v[i] && typeof v[i].type === 'string') v[i] = simplify(walk(v[i]));
      if (isStmtList(node, key)) node[key] = v.flatMap(expand);
    } else if (v && typeof v.type === 'string') node[key] = simplify(walk(v));
  }
  if (/^(For|ForIn|ForOf|While|DoWhile|With|Labeled)Statement$/.test(node.type)) wrapBody(node, 'body');
  if (node.type === 'IfStatement') { wrapBody(node, 'consequent'); if (node.alternate && node.alternate.type !== 'IfStatement') wrapBody(node, 'alternate'); }
  return node;
}

// comentários (as licenças /*! */ no topo, os que sobraram no meio): presos à primeira instrução depois deles
function attachComments(ast, comments) {
  if (!comments.length) return;
  const stmts = [];
  (function collect(n) {
    if (!n || typeof n.type !== 'string') return;
    if (/Statement$|Declaration$/.test(n.type) && n.start != null) stmts.push(n);
    for (const k of Object.keys(n)) { const v = n[k]; if (k === 'loc') continue; if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v.type === 'string') collect(v); }
  })(ast);
  stmts.sort((a, b) => a.start - b.start);
  for (const c of comments) {
    let lo = 0, hi = stmts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (stmts[m].start < c.end) lo = m + 1; else hi = m; }
    const t = stmts[lo];
    if (t) (t.comments = t.comments || []).push({ type: c.type, value: c.value });
    else (ast.trailingComments = ast.trailingComments || []).push({ type: c.type, value: c.value });
  }
}

function parseJs(src) {
  const base = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true };
  let err;
  for (const sourceType of ['module', 'script']) {
    const comments = [];
    try { return { ast: acorn.parse(src, { ...base, sourceType, onComment: comments }), comments }; } catch (e) { err = e; }
  }
  throw err;
}

// listas longas (tabelas de dados, CPFs, dicionários) quebradas em linhas de até ~100 colunas em vez de uma linha só
let GEN = null;
function generator() {
  if (GEN) return GEN;
  const base = astring.GENERATOR, width = (n) => n && n.end != null ? n.end - n.start : 8;
  GEN = Object.assign({}, base, {
    ArrayExpression(node, state) {
      const els = node.elements;
      if (!els.length || node.end - node.start <= 100) return base.ArrayExpression.call(this, node, state);
      const outer = state.indent.repeat(state.indentLevel++), inner = outer + state.indent;
      state.write('[' + state.lineEnd); state.write(inner);
      let col = 0;
      els.forEach((el, i) => {
        const w = width(el);
        if (i) { if (col + w > 100) { state.write(',' + state.lineEnd); state.write(inner); col = 0; } else state.write(', '); }
        if (el) this[el.type](el, state); else if (i === els.length - 1) state.write(',');
        col += w + 2;
      });
      state.indentLevel--;
      state.write(state.lineEnd); state.write(outer + ']');
    },
  });
  return GEN;
}

function unminifyJs(src, indent) {
  const { ast, comments } = parseJs(src);
  walk(ast);
  attachComments(ast, comments);
  const map = [];
  const sourceMap = { file: 'x', addMapping: (m) => map.push(m.generated.line, m.generated.column, m.original.line, m.original.column) };
  const code = astring.generate(ast, { indent: ' '.repeat(indent), comments: true, sourceMap, generator: generator() });
  return { code, map };
}

const BEAUTY = {
  js: (t, o) => beautifier.js(t, { ...o, preserve_newlines: true, max_preserve_newlines: 2, e4x: true }),
  css: (t, o) => beautifier.css(t, { ...o, newline_between_rules: true }),
  html: (t, o) => beautifier.html(t, { ...o, wrap_line_length: 0, indent_inner_html: true, extra_liners: [] }),
};

// kind: 'js' | 'json' | 'css' | 'html'. Devolve { code, map?, how, unpacked? }
function unminify(text, kind, indent = 4) {
  const o = { indent_size: indent, indent_char: ' ', end_with_newline: true };
  if (kind === 'json') {
    try { return { code: JSON.stringify(JSON.parse(text), null, indent) + '\n', how: 'json' }; } catch { return { code: BEAUTY.js(text, o), how: 'beautify' }; }
  }
  if (kind === 'css' || kind === 'html') return { code: BEAUTY[kind](text, o), how: 'beautify' };
  const unpacked = unpackDeanEdwards(text);
  const src = unpacked || text;
  try { const r = unminifyJs(src, indent); return { ...r, how: 'ast', unpacked: !!unpacked, map: unpacked ? null : r.map }; }
  catch (e) { return { code: BEAUTY.js(src, o), how: 'beautify', unpacked: !!unpacked, error: e.message }; }
}

if (typeof importScripts === 'function') {
  self.onmessage = (ev) => {
    const { id, text, kind, indent } = ev.data;
    try { self.postMessage({ id, ...unminify(text, kind, indent) }); }
    catch (e) { self.postMessage({ id, error: String(e && e.message || e) }); }
  };
} else if (typeof module !== 'undefined') module.exports = { unminify, unpackDeanEdwards };
