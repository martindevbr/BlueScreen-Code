/* BlueScreen: autocompletar embutido, sem servidor de linguagem (dados em complete-data.js).
   O que faz, em ordem de custo (tudo local, uma leitura do arquivo por versão do texto):
   - lê o arquivo: tira strings e comentários, acha blocos (classes, funções), parâmetros, variáveis e campos, com o tipo
     declarado ou deduzido do valor (new Foo(), "texto", listOf(), Vec::new(), outra variável, chamada de método...)
   - depois de "x." (ou ::, ->): resolve o tipo de x, inclusive em cadeia (System.out., lista.get(0).trim().) e lista os
     membros dele (tabelas da linguagem + classes do próprio arquivo, com herança); um nome de classe mostra os estáticos
   - fora disso: variáveis visíveis no ponto (locais só da função atual), parâmetros, campos, funções e classes do
     arquivo, globais da linguagem, palavras-chave e tipos
   - ranking como o do IntelliJ: prefixo exato > maiúsculas/minúsculas > "camel humps" (gNa -> getName) > trecho >
     subsequência; sobe o que está perto do cursor, o que você escolheu antes e o que o contexto pede (new -> classes,
     começo de linha -> comandos)
   - live templates (sout, psvm, fori, iter...) e postfix (expr.sout, .var, .if, .for, .not, .null...)
   - ajuda de assinatura ao abrir "(" e import automático (Java, Python, Go) ao escolher uma classe ou módulo
   O motor completo é o provedor de prioridade mais baixa: com um servidor de linguagem que responde, valem as
   respostas dele (mais os templates e postfix que já casam com o digitado); sem servidor, ou com um que não devolve
   nada (carregando, arquivo solto fora do projeto), entra o motor. */
(function (bs) {
const D = window.BS_CMPL;
if (!D) return;
const MAX_TEXT = 600_000;
const RECENT_KEY = 'cmplRecent';

// ---------- tabelas da linguagem (lidas uma vez) ----------
const PK = {};
function parseEntry(raw) {
  let s = raw.trim(); if (!s) return null;
  const st = s[0] === '+'; if (st) s = s.slice(1);
  // macro/snippet do Rust: println!($1), vec![$1]
  const mac = /^(\w+!)/.exec(s);
  if (mac) { const ci = s.lastIndexOf('):'); const ret = ci > 0 ? s.slice(ci + 2) : (/\]:(.+)$/.exec(s) || [])[1] || ''; const body = ret ? s.slice(0, s.length - ret.length - 1) : s; return { name: mac[1], snippet: body, ret, st, kind: 'fn' }; }
  let i = 0; while (i < s.length && s[i] !== '(' && s[i] !== ':') i++;
  const name = s.slice(0, i).trim();
  let params = null, rest = s.slice(i);
  if (rest[0] === '(') { let d = 0, j = 0; for (; j < rest.length; j++) { if (rest[j] === '(') d++; else if (rest[j] === ')' && --d === 0) break; } params = rest.slice(1, j); rest = rest.slice(j + 1); }
  const ret = rest[0] === ':' ? rest.slice(1).trim() : '';
  return { name, params, ret, st, kind: params == null ? 'field' : 'fn' };
}
const split = (s) => s ? s.split('|').map(parseEntry).filter(Boolean) : [];
function pack(lang) {
  if (PK[lang]) return PK[lang];
  const P = D[lang]; if (!P) return null;
  const T = new Map();
  for (const [k, v] of Object.entries(P.T || {})) T.set(k, split(v));
  return PK[lang] = { P, T, g: split(P.g), kw: (P.kw || '').split(/\s+/).filter(Boolean), types: (P.types || '').split(/\s+/).filter(Boolean), stmt: new Set((P.stmt || '').split(/\s+/)) };
}

// ---------- strings e comentários ----------
const FAM = {
  c: { line: ['//'], block: [['/*', '*/']], q: ['"', "'"] },
  py: { line: ['#'], block: [], q: ['"', "'"], tri: true },
  rb: { line: ['#'], block: [['=begin', '=end']], q: ['"', "'"] },
  sh: { line: ['#'], block: [], q: ['"', "'"], hash: true },
  ps: { line: ['#'], block: [['<#', '#>']], q: ['"', "'"] },
  sql: { line: ['--', '#'], block: [['/*', '*/']], q: ["'", '"', '`'] },
  lua: { line: ['--'], block: [['--[[', ']]']], q: ['"', "'"] },
};
const famOf = (lang) => ({ python: 'py', ruby: 'rb', shell: 'sh', powershell: 'ps', sql: 'sql', mysql: 'sql', pgsql: 'sql', lua: 'lua' }[lang] || 'c');
// troca o conteúdo de strings e comentários por espaços (mesmo tamanho, mesmas linhas); guarda os trechos
function mask(text, lang) {
  const F = FAM[famOf(lang)];
  const bt = ['javascript', 'typescript', 'go', 'kotlin', 'sql'].includes(lang);
  const tri = F.tri || lang === 'kotlin' || lang === 'java' || lang === 'csharp' || lang === 'swift';
  const out = []; const ranges = []; let last = 0, i = 0; const n = text.length;
  const blank = (a, b) => { out.push(text.slice(last, a), text.slice(a, b).replace(/[^\n]/g, ' ')); last = b; };
  while (i < n) {
    const c = text[i];
    let hit = false;
    for (const [o, e] of F.block) if (text.startsWith(o, i)) { const j = text.indexOf(e, i + o.length); const end = j < 0 ? n : j + e.length; ranges.push([i + 1, end - 1]); blank(i, end); i = end; hit = true; break; }
    if (hit) continue;
    if (F.line.some(t => text.startsWith(t, i)) && (!F.hash || i === 0 || /\s/.test(text[i - 1]))) {
      if (c === '#' && lang === 'php' && text[i + 1] === '[') { i++; continue; }
      let j = text.indexOf('\n', i); if (j < 0) j = n; ranges.push([i + 1, j]); blank(i, j); i = j; continue;
    }
    if (tri && (text.startsWith('"""', i) || (F.tri && text.startsWith("'''", i)))) {
      const q = text.slice(i, i + 3); const j = text.indexOf(q, i + 3); const end = j < 0 ? n : j + 3;
      ranges.push([i + 3, end - 3]); blank(i + 3, Math.max(i + 3, end - 3)); i = end; continue;
    }
    if (F.q.includes(c) || (bt && c === '`')) {
      // Rust: 'a é lifetime; só 'x' ou '\n' é char
      if (c === "'" && lang === 'rust' && !/^'(\\.[^']*|[^\\'])'/.test(text.slice(i, i + 12))) { i++; continue; }
      let j = i + 1; const raw = c === '`';
      for (; j < n; j++) { const d = text[j]; if (d === '\\' && !raw) { j++; continue; } if (d === c) break; if (d === '\n' && !raw && c !== '`') break; }
      const end = Math.min(n, j + 1); ranges.push([i + 1, end - 1]); blank(i + 1, Math.max(i + 1, end - 1)); i = end; continue;
    }
    i++;
  }
  out.push(text.slice(last));
  return { clean: out.join(''), ranges };
}
// o cursor está num trecho (conteúdo de string ou comentário)? Os trechos vêm em ordem
function inRanges(ranges, off) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, [a, b] = ranges[m]; if (off < a) hi = m - 1; else if (off > b) lo = m + 1; else return true; }
  return false;
}

// ---------- tipos ----------
function splitTop(s, sep = ',') {
  const out = []; let d = 0, cur = '';
  for (const ch of s) { if ('<([{'.includes(ch)) d++; else if ('>)]}'.includes(ch)) d--; if (ch === sep && d === 0) { out.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
// "List<String>" -> { base: 'List', args: ['String'] }; "[]string" e "int[]" -> { base: '[]', args: [...] }
function ty(t) {
  if (!t) return null;
  if (typeof t === 'object') return t;
  let s = String(t).trim().replace(/^(?:&\s*mut\s+|&|\*+|mut\s+|const\s+|final\s+|readonly\s+|ref\s+|out\s+|in\s+|dyn\s+|impl\s+)+/, '').replace(/[?*&!]+$/, '').replace(/^\((.*)\)$/, (m, a) => splitTop(a)[0] || '').trim();
  if (!s) return null;
  if (s.startsWith('@')) return { base: s, args: [] };
  if (s.startsWith('[]')) return { base: '[]', args: [s.slice(2)] };
  if (/\[\s*\]$/.test(s)) return { base: '[]', args: [s.replace(/\[\s*\]$/, '')] };
  if (/^\[.*\]$/.test(s)) return { base: 'slice', args: [s.slice(1, -1).split(';')[0]] };
  if (/^map\[/.test(s)) return { base: 'map', args: [] };
  let args = [];
  const g = /^([^<]+)<(.*)>$/.exec(s); if (g) { s = g[1]; args = splitTop(g[2]); }
  const gb = /^([^[]+)\[(.*)\]$/.exec(s); if (gb && /^[A-Za-z_][\w.]*$/.test(gb[1])) { s = gb[1]; args = splitTop(gb[2]); } // list[str], dict[str, int]
  s = s.trim();
  if (!s.startsWith('@')) s = s.split(/::|\./).pop();
  return { base: s, args };
}
const GEN1 = new Set(['E', 'T', 'K', 'TKey', 'A', 'T1']), GEN2 = new Set(['V', 'TValue', 'B', 'T2']);
function subst(ret, owner) {
  if (!ret) return null;
  const t = ty(ret); if (!t) return null;
  if (owner && owner.args && owner.args.length) {
    if (GEN1.has(t.base)) return ty(owner.args[0]);
    if (GEN2.has(t.base)) return ty(owner.args[1] || owner.args[0]);
    t.args = t.args.map(a => GEN1.has(a) ? owner.args[0] : GEN2.has(a) ? (owner.args[1] || owner.args[0]) : a);
  }
  return t;
}
// elemento de uma coleção (for x in xs)
function elemOf(t, lang) {
  t = ty(t); if (!t) return null;
  if (['str', 'String'].includes(t.base) && ['python', 'rust', 'kotlin'].includes(lang)) return ty(lang === 'python' ? 'str' : 'char');
  if (t.base === 'Map' || t.base === 'HashMap' || t.base === 'dict' || t.base === 'Dictionary' || t.base === 'map') return lang === 'java' ? { base: 'Entry', args: t.args } : ty(t.args[0]);
  if (t.base === 'range') return ty('int');
  return t.args.length ? ty(t.args[0]) : null;
}

// ---------- leitura do arquivo ----------
const CTRL = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'using', 'lock', 'foreach', 'else', 'do', 'try', 'finally', 'return', 'new', 'sizeof', 'when', 'match', 'loop', 'unsafe', 'select', 'defer', 'go', 'fixed', 'checked', 'static', 'get', 'set', 'init', 'case', 'default', 'async', 'await', 'elif', 'except', 'with', 'repeat', 'until']);
const NOT_TYPE = new Set(['return', 'new', 'else', 'throw', 'case', 'goto', 'package', 'import', 'using', 'namespace', 'yield', 'await', 'delete', 'typeof', 'sizeof', 'instanceof', 'in', 'is', 'as', 'and', 'or', 'not', 'echo', 'print', 'extends', 'implements', 'throws', 'from', 'class', 'struct', 'enum', 'interface', 'record', 'if', 'while', 'for', 'switch', 'catch', 'do', 'def', 'fn', 'func', 'fun', 'let', 'val', 'var', 'const', 'type', 'public', 'private', 'protected', 'static', 'final', 'abstract', 'override', 'virtual', 'readonly', 'async', 'export', 'default', 'lambda', 'struct', 'union', 'typedef', 'friend', 'operator', 'template', 'go', 'defer', 'select', 'chan', 'pub', 'mut', 'ref', 'out', 'params', 'this', 'super', 'self']);
const KIND = { var: 1, param: 1, field: 2, fn: 3, class: 4, module: 5, global: 3, kw: 6, type: 4, tpl: 7, word: 9 };
const CACHE = new WeakMap();

function analyze(model) {
  const ver = model.getVersionId(), lang = model.getLanguageId();
  const c = CACHE.get(model); if (c && c.ver === ver && c.lang === lang) return c;
  const text = model.getValue();
  const A = { ver, lang, big: text.length > MAX_TEXT, ranges: [], blocks: [], syms: [], symKeys: new Set(), classes: new Map(), imports: new Map(), words: new Map(), usingStd: false };
  CACHE.set(model, A);
  if (A.big) return A;
  const { clean, ranges } = mask(text, lang);
  A.ranges = ranges;
  const lines = clean.split('\n');
  A.lines = lines;
  // palavras do arquivo (para frequência e para o último recurso)
  for (const m of clean.matchAll(/[A-Za-z_$][\w$]{2,}/g)) A.words.set(m[0], (A.words.get(m[0]) || 0) + 1);
  const fam = famOf(lang);
  if (fam === 'py') readIndent(A, lines, lang); else if (lang === 'ruby' || lang === 'lua') readEnds(A, lines, lang); else if (fam === 'c' || lang === 'powershell') readBraces(A, clean, lines, lang);
  readDecls(A, lines, lang);
  readImports(A, clean, lang);
  // classes: membros e herança
  for (const s of A.syms) if (s.owner && A.classes.has(s.owner)) A.classes.get(s.owner).members.push(s);
  return A;
}
const addSym = (A, s) => {
  // palavras reservadas não são variáveis, mas podem ser método ou campo (fn new, campo type)
  if (!s.name || ((s.kind === 'var' || s.kind === 'param') && NOT_TYPE.has(s.name)) || !/^[$@A-Za-z_][\w$]*!?$/.test(s.name)) return;
  const key = s.name + '\u0000' + s.line + '\u0000' + s.kind;
  if (A.symKeys.has(key)) return;
  A.symKeys.add(key); A.syms.push(s);
};
function blockAt(A, line) { let b = null; for (const x of A.blocks) if (line > x.start && line <= x.end && (!b || x.start >= b.start)) b = x; return b; }
function fnAt(A, line) { let b = blockAt(A, line); while (b && b.kind !== 'fn') b = b.parent; return b; }
function clsAt(A, line) { let b = blockAt(A, line); while (b && b.kind !== 'class') b = b.parent; return b; }

// parâmetros "Tipo nome", "nome: Tipo", "a, b int" (Go), "Tipo $nome" (PHP), "self, x=1" (Python)
function params(text, lang) {
  const out = [];
  const parts = splitTop(text || '');
  let pendingGo = [];
  for (let p of parts) {
    p = p.replace(/@\w+(\([^)]*\))?\s*/g, '').replace(/\b(final|const|readonly|in|out|ref|params|this|mut|vararg|noalias)\s+/g, '').trim();
    if (!p || p === '...' || /^&?(mut\s+)?self$/.test(p) || p === 'self' || p === 'cls') continue;
    p = p.replace(/\s*=\s*[\s\S]*$/, '');
    let m;
    if (lang === 'go') {
      const w = p.split(/\s+/);
      if (w.length === 1) { pendingGo.push(w[0]); continue; }
      const t = w.slice(1).join(' ');
      for (const n of [...pendingGo, w[0]]) out.push({ name: n, type: t });
      pendingGo = []; continue;
    }
    if ((m = /^\*{0,2}([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(p))) { out.push({ name: m[1].replace(/^\$/, ''), type: m[2] }); continue; }
    if ((m = /^(.*?)[\s&*]*\.{3}\s*\$?([A-Za-z_]\w*)$/.exec(p))) { out.push({ name: m[2], type: m[1] + '[]' }); continue; }
    if ((m = /^(.+?)[\s&*]+\$?([A-Za-z_]\w*)(\s*\[\s*\])?$/.exec(p))) { out.push({ name: m[2], type: m[1] + (m[3] ? '[]' : '') }); continue; }
    if ((m = /^\*{0,2}\$?([A-Za-z_]\w*)$/.exec(p))) out.push({ name: m[1], type: null });
  }
  for (const n of pendingGo) out.push({ name: n, type: null });
  return out;
}

// cabeçalho de um bloco { ... }: classe, função ou outro
function header(lang, h) {
  h = h.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = /\btype\s+(\w+)\s+(struct|interface)\b/.exec(h))) return { kind: 'class', name: m[1] };
  if ((m = /\bimpl(?:\s*<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_]\w*)(?:<[^>]*>)?\s*(?:where.*)?$/.exec(h)) && lang === 'rust') return { kind: 'class', name: m[1], impl: true };
  if ((m = /\b(?:class|interface|enum|record|struct|object|trait|union|namespace)\s+([A-Za-z_]\w*)([^{]*)$/.exec(h)) && !/\benum\s+class\b/.test(h.slice(0, m.index + 10)) || (m = /\benum\s+class\s+(\w+)(.*)$/.exec(h))) {
    const rest = m[2] || '';
    const ext = (/(?:extends|:|<)\s*([A-Z]\w*)/.exec(rest) || [])[1] || null;
    // Kotlin: class X(val a: Int, var b: String)
    const ctor = /^\s*(?:<[^>]*>)?\s*\(([^)]*)\)/.exec(rest);
    return { kind: 'class', name: m[1], ext, ctor: ctor ? ctor[1] : null };
  }
  if (lang === 'go' && (m = /\bfunc\s*(?:\(\s*(\w+)\s+\*?(\w+)[^)]*\))?\s*(\w+)\s*\(([^)]*)\)\s*(.*)$/.exec(h))) return { kind: 'fn', name: m[3], recv: m[1], recvType: m[2], params: m[4], ret: m[5].replace(/\s*\{?$/, '') };
  if (lang === 'rust' && (m = /\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*\((.*)\)\s*(?:->\s*(.+?))?\s*(?:where\b.*)?$/.exec(h))) return { kind: 'fn', name: m[1], params: m[2], ret: m[3], self: /^\s*&?\s*(mut\s+)?self\b/.test(m[2]) };
  if ((lang === 'kotlin' || lang === 'swift' || lang === 'scala' || lang === 'groovy') && (m = /\b(?:fun|func|def)\s+(?:<[^>]*>\s*)?(?:[\w.<>]+\.)?(\w+)\s*\((.*)\)\s*(?:(?::|->)\s*(.+))?$/.exec(h))) return { kind: 'fn', name: m[1], params: m[2], ret: m[3] };
  if (lang === 'php' && (m = /\bfunction\s+&?(\w+)\s*\((.*)\)\s*(?::\s*\??(.+))?$/.exec(h))) return { kind: 'fn', name: m[1], params: m[2], ret: m[3], st: /\bstatic\b/.test(h) };
  if (lang === 'powershell' && (m = /\bfunction\s+([\w-]+)/i.exec(h))) return { kind: 'fn', name: m[1] };
  if ((m = /^(.*?)([~A-Za-z_]\w*)\s*\(((?:[^()]|\([^()]*\))*)\)\s*(?:const\b|noexcept\b|override\b|throws\s+[\w.,\s]+|where\b.*|:\s*(?:base|this)\s*\(.*\))*\s*(?:->\s*(.+))?$/.exec(h))) {
    const name = m[2], pre = m[1].trim();
    if (CTRL.has(name) || /(?:^|[^\w\s])$/.test(pre) && pre && !/[>\]*&]$/.test(pre)) return { kind: 'block' };
    const words = pre.split(/\s+/).filter(Boolean);
    if (words.some(w => CTRL.has(w) && !['static', 'async', 'get', 'set', 'init', 'default'].includes(w))) return { kind: 'block' };
    const type = m[4] || words.filter(w => !/^(public|private|protected|internal|static|final|abstract|virtual|override|async|synchronized|native|inline|extern|unsafe|sealed|new|default|constexpr|explicit|friend|open|partial)$/.test(w)).join(' ');
    if (!type && !/^[A-Z~]/.test(name) && lang !== 'javascript') return { kind: 'block' }; // chamada (foo(x) {) ou lambda
    return { kind: 'fn', name, params: m[3], ret: type || null, st: /\bstatic\b/.test(pre) };
  }
  return { kind: 'block' };
}
function readBraces(A, clean, lines, lang) {
  const stack = []; let line = 0, delim = -1;
  const lineStart = [0]; for (let i = 0; i < clean.length; i++) if (clean[i] === '\n') lineStart.push(i + 1);
  const semis = !['go', 'kotlin', 'swift', 'scala', 'groovy', 'powershell'].includes(lang);
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '\n') { line++; continue; }
    if (ch === ';') { delim = i; continue; }
    if (ch === '{') {
      let h = clean.slice(delim + 1, i);
      if (!semis) {
        // sem ";": o cabeçalho começa na linha do "{" (e nas de cima que continuam: params em várias linhas)
        const ls = h.split('\n'); let k = ls.length - 1;
        while (k > 0 && (/[,(\[=:|&+\-.]\s*$/.test(ls[k - 1]) || /^\s*[).]/.test(ls[k]))) k--;
        h = ls.slice(k).join('\n');
      }
      const info = header(lang, h);
      const startLine = line - (h.match(/\n/g) || []).length;
      const b = { ...info, start: line, headLine: Math.max(0, startLine + (h.length - h.trimStart().length ? (h.slice(0, h.length - h.trimStart().length).match(/\n/g) || []).length : 0)), end: lines.length, parent: stack[stack.length - 1] || null };
      stack.push(b); A.blocks.push(b); delim = i; continue;
    }
    if (ch === '}') { const b = stack.pop(); if (b) b.end = line; delim = i; continue; }
  }
  for (const b of A.blocks) {
    if (b.kind === 'class' && b.name) {
      const ex = A.classes.get(b.name);
      if (ex) { ex.blocks.push(b); if (!ex.ext && b.ext) ex.ext = b.ext; }
      else A.classes.set(b.name, { name: b.name, ext: b.ext, members: [], blocks: [b], line: b.headLine });
      if (b.ctor) for (const p of params(b.ctor, lang)) addSym(A, { name: p.name, type: p.type, kind: 'field', line: b.headLine, owner: b.name });
    }
    if (b.kind === 'fn') {
      const cls = b.recvType || (b.parent && b.parent.kind === 'class' ? b.parent.name : null);
      b.owner = cls;
      if (!A.classes.has(cls) && b.recvType) A.classes.set(cls, { name: cls, ext: null, members: [], blocks: [], line: b.headLine });
      addSym(A, { name: b.name, kind: 'fn', params: b.params, ret: b.ret, line: b.headLine, owner: cls, st: lang === 'rust' ? !b.self : b.st, fnBlock: b.parent && b.parent.kind === 'fn' ? b.parent : null });
      for (const p of params(b.params, lang)) addSym(A, { name: p.name, type: p.type, kind: 'param', line: b.headLine, fnBlock: b });
      if (b.recv) addSym(A, { name: b.recv, type: b.recvType, kind: 'param', line: b.headLine, fnBlock: b });
    }
  }
}
// Python: blocos por recuo
function readIndent(A, lines, lang) {
  const open = [];
  const ind = (s) => s.length - s.trimStart().length;
  lines.forEach((ln, i) => {
    if (!ln.trim()) return;
    const d = ind(ln);
    while (open.length && d <= open[open.length - 1].ind) { const b = open.pop(); b.end = i - 1; }
    let m;
    if ((m = /^\s*(?:async\s+)?def\s+(\w+)\s*\((.*)\)\s*(?:->\s*([^:]+))?:/.exec(ln))) {
      const b = { kind: 'fn', name: m[1], params: m[2], ret: m[3], start: i, headLine: i, end: lines.length, ind: d, parent: open[open.length - 1] || null };
      A.blocks.push(b); open.push(b);
    } else if ((m = /^\s*class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/.exec(ln))) {
      const b = { kind: 'class', name: m[1], ext: (m[2] || '').split(',')[0].trim() || null, start: i, headLine: i, end: lines.length, ind: d, parent: open[open.length - 1] || null };
      A.blocks.push(b); open.push(b); A.classes.set(b.name, { name: b.name, ext: b.ext, members: [], blocks: [b], line: i });
    } else if (/:\s*$/.test(ln)) {
      const b = { kind: 'block', start: i, headLine: i, end: lines.length, ind: d, parent: open[open.length - 1] || null }; A.blocks.push(b); open.push(b);
    }
  });
  for (const b of A.blocks) {
    if (b.kind !== 'fn') continue;
    const cls = b.parent && b.parent.kind === 'class' ? b.parent.name : null; b.owner = cls;
    const isStatic = cls && !/^\s*self\b/.test(b.params || '');
    addSym(A, { name: b.name, kind: 'fn', params: (b.params || '').replace(/^\s*(self|cls)\s*,?\s*/, ''), ret: b.ret, line: b.headLine, owner: cls, st: isStatic, fnBlock: b.parent && b.parent.kind === 'fn' ? b.parent : null });
    for (const p of params(b.params, lang)) addSym(A, { name: p.name, type: p.type, kind: 'param', line: b.headLine, fnBlock: b });
  }
}
// Ruby e Lua: blocos que fecham com "end"
function readEnds(A, lines, lang) {
  const stack = [];
  const opener = lang === 'ruby' ? /^\s*(def|class|module|begin|case|if|unless|while|until|for)\b|\bdo\s*(\|[^|]*\|)?\s*$/ : /\b(function)\b|\b(do|then)\s*$|^\s*repeat\b/;
  lines.forEach((ln, i) => {
    const t = ln.trim(); if (!t) return;
    let m;
    const b = { start: i, headLine: i, end: lines.length, parent: stack[stack.length - 1] || null, kind: 'block' };
    if ((m = /^\s*def\s+(?:self\.)?([\w?!=]+)\s*(?:\(([^)]*)\))?/.exec(ln)) && lang === 'ruby') Object.assign(b, { kind: 'fn', name: m[1], params: m[2] || '' });
    else if ((m = /^\s*class\s+(\w+)(?:\s*<\s*(\w+))?/.exec(ln)) && lang === 'ruby') { Object.assign(b, { kind: 'class', name: m[1], ext: m[2] }); A.classes.set(m[1], { name: m[1], ext: m[2], members: [], blocks: [b], line: i }); }
    else if ((m = /\bfunction\s+([\w.:]+)?\s*\(([^)]*)\)/.exec(ln)) && lang === 'lua') Object.assign(b, { kind: 'fn', name: (m[1] || '').split(/[.:]/).pop(), params: m[2] });
    if (opener.test(ln) && !(lang === 'ruby' && /^\s*(if|unless|while|until)\b/.test(ln) === false && /\b(if|unless|while|until)\b/.test(ln) && !/\bdo\b/.test(ln) && !/^\s*(def|class|module|begin|case)\b/.test(ln))) {
      if (!(lang === 'ruby' && /\bend\s*$/.test(t) && /^\s*def\b/.test(ln))) { stack.push(b); A.blocks.push(b); }
    }
    const ends = (t.match(/\bend\b/g) || []).length - (/^\s*def\b.*\bend\s*$/.test(ln) ? 0 : 0);
    for (let k = 0; k < ends && stack.length; k++) { const x = stack.pop(); x.end = i; }
    if (lang === 'lua' && /^\s*until\b/.test(ln) && stack.length) stack.pop().end = i;
  });
  for (const b of A.blocks) {
    if (b.kind !== 'fn') continue;
    const cls = b.parent && b.parent.kind === 'class' ? b.parent.name : null; b.owner = cls;
    addSym(A, { name: b.name, kind: 'fn', params: b.params, line: b.headLine, owner: cls });
    for (const p of params(b.params, lang)) addSym(A, { name: p.name, type: p.type, kind: 'param', line: b.headLine, fnBlock: b });
  }
}
// valor de uma atribuição até o fim do comando (sem ; nem , de fora)
function initOf(s) {
  let d = 0, out = '';
  for (const ch of s) { if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) { if (d === 0) break; d--; } else if ((ch === ';' || ch === ',') && d === 0) break; out += ch; }
  return out.trim();
}
function readDecls(A, lines, lang) {
  const owner = (i) => { const f = fnAt(A, i); if (f) return { fnBlock: f }; const c = clsAt(A, i); return c ? { owner: c.name, kind: 'field' } : {}; };
  const put = (i, name, type, init, extra = {}) => { const o = owner(i); addSym(A, { name, type, init, line: i, kind: o.fnBlock ? 'var' : o.owner ? 'field' : 'var', ...o, ...extra }); };
  const typed = ['java', 'csharp', 'c', 'cpp', 'dart', 'groovy'].includes(lang);
  lines.forEach((ln, i) => {
    let m;
    if (typed) {
      const re = /(?:^|[;{(,]|\b(?:final|const|static|private|public|protected|readonly|internal|volatile|transient|unsigned|signed|auto|register|mutable|constexpr|thread_local)\b)\s*([A-Za-z_][\w.:]*(?:\s*<[^;=(){}]*?>)?(?:\s*\[\s*\])*[\s*&]+)([A-Za-z_]\w*)\s*(\[[^\]]*\]\s*)?(=(?!=)|;|,|:(?!:)|\)|$)/g;
      for (const x of ln.matchAll(re)) {
        const type = x[1].trim().replace(/[*&\s]+$/, ''); const name = x[2];
        if ((NOT_TYPE.has(type) && type !== 'var') || NOT_TYPE.has(name) || /^\d/.test(type) || (CTRL.has(type) && type !== 'auto')) continue;
        // "(Tipo nome)" é parâmetro (lido no cabeçalho da função) ou cast
        if (x[4] === ')') continue;
        const rest = ln.slice(x.index + x[0].length);
        const each = x[4] === ':' && /\bfor\s*\(/.test(ln);
        const t = type === 'var' || type === 'auto' ? null : type + (x[3] ? '[]' : '');
        put(i, name, each && !t ? null : t, x[4] === '=' ? initOf(rest) : each ? initOf(rest.replace(/\)\s*\{?\s*$/, '')) : null, each ? { each: true } : {});
      }
      // C#/Java/C++ "foreach (var x in xs)"
      if ((m = /\bforeach\s*\(\s*(?:var|[\w<>[\]]+)\s+(\w+)\s+in\s+(.+?)\)/.exec(ln))) put(i, m[1], null, m[2], { each: true });
      if ((m = /\bcatch\s*\(\s*(?:final\s+)?([\w.]+)(?:\s*\|[\w.\s|]+)?\s+(\w+)\s*\)/.exec(ln))) put(i + 1, m[2], m[1]);
    }
    // classe sem corpo: data class P(val nome: String), class Caixa(var x: Int)
    if ((lang === 'kotlin' || lang === 'scala') && (m = /\bclass\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*(\w+))?\s*$/.exec(ln))) {
      if (!A.classes.has(m[1])) A.classes.set(m[1], { name: m[1], ext: m[3] || null, members: [], blocks: [], line: i });
      for (const p of params(m[2].replace(/\b(?:val|var|private|override)\s+/g, ''), lang)) addSym(A, { name: p.name, type: p.type, kind: 'field', line: i, owner: m[1] });
    }
    if (lang === 'kotlin' || lang === 'swift' || lang === 'scala') {
      for (const x of ln.matchAll(/\b(?:val|var|let)\s+(\w+)\s*(?::\s*([^=]+?))?\s*(?:=(?!=)\s*(.*))?$/g)) put(i, x[1], x[2] && x[2].trim(), x[3] ? initOf(x[3]) : null);
      if ((m = /\bfor\s*\(\s*(\w+)\s+in\s+(.+)\)/.exec(ln))) put(i, m[1], null, m[2], { each: true });
    }
    if (lang === 'rust') {
      for (const x of ln.matchAll(/\blet\s+(?:mut\s+)?(\w+)\s*(?::\s*([^=;]+?))?\s*(?:=(?!=)\s*(.*))?(?:;|$)/g)) put(i, x[1], x[2] && x[2].trim(), x[3] ? initOf(x[3]) : null);
      if ((m = /\bfor\s+(?:\(?\s*\w+\s*,\s*)?(\w+)\)?\s+in\s+(.+?)\s*\{/.exec(ln))) put(i, m[1], null, m[2], { each: true });
      if ((m = /\b(?:if|while)\s+let\s+(?:Some|Ok)\((?:mut\s+)?(\w+)\)\s*=\s*(.+?)\s*\{/.exec(ln))) put(i, m[1], null, m[2] + '.unwrap()');
      const c = clsAt(A, i); if (c && !fnAt(A, i) && (m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*([^,]+),?\s*$/.exec(ln))) addSym(A, { name: m[1], type: m[2], kind: 'field', line: i, owner: c.name });
      // struct numa linha só: struct Ponto { x: i32, y: i32 }
      if ((m = /\bstruct\s+(\w+)(?:<[^>]*>)?\s*\{([^}]*)\}/.exec(ln))) for (const f of splitTop(m[2])) { const fm = /^(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*(.+)$/.exec(f); if (fm) addSym(A, { name: fm[1], type: fm[2], kind: 'field', line: i, owner: m[1] }); }
    }
    if (lang === 'go') {
      if ((m = /^\s*([\w, ]+?)\s*:=\s*(.+)$/.exec(ln)) && !/^\s*(for|if|switch)\b/.test(ln)) {
        const names = m[1].split(',').map(s => s.trim());
        names.forEach((n, k) => n !== '_' && put(i, n, n === 'err' && k > 0 ? 'error' : null, k === 0 ? m[2] : null, k > 0 ? { tuple: k, tupleOf: m[2] } : {}));
      }
      if ((m = /\bfor\s+(\w+)\s*,\s*(\w+)\s*:=\s*range\s+(.+?)\s*\{/.exec(ln))) { put(i, m[2], null, m[3], { each: true }); if (m[1] !== '_') put(i, m[1], 'int'); }
      else if ((m = /\bfor\s+(\w+)\s*:=\s*range\s+(.+?)\s*\{/.exec(ln))) put(i, m[1], 'int');
      if ((m = /\b(?:if|switch)\s+([\w, ]+?)\s*:=\s*([^;]+);/.exec(ln))) m[1].split(',').map(s => s.trim()).forEach((n, k) => n !== '_' && put(i, n, n === 'err' ? 'error' : null, k === 0 ? m[2] : null));
      for (const x of ln.matchAll(/\bvar\s+(\w+)\s+([^=\s][^=]*?)?\s*(?:=\s*(.*))?$/g)) put(i, x[1], x[2] && x[2].trim(), x[3] ? initOf(x[3]) : null);
      const c = clsAt(A, i); if (c && !fnAt(A, i) && (m = /^\s*(\w+)\s+([*\[\]\w.]+)/.exec(ln)) && !/^\s*(func|type|var)\b/.test(ln)) addSym(A, { name: m[1], type: m[2], kind: 'field', line: i, owner: c.name });
      if ((m = /\btype\s+(\w+)\s+struct\s*\{([^}]*)\}/.exec(ln))) for (const f of m[2].split(';')) { const fm = /^\s*(\w+)\s+([*\[\]\w.]+)/.exec(f); if (fm) addSym(A, { name: fm[1], type: fm[2], kind: 'field', line: i, owner: m[1] }); }
    }
    if (lang === 'python') {
      if ((m = /^\s*([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*=(?!=)\s*(.+)$/.exec(ln))) put(i, m[1], m[2] && m[2].trim(), m[3]);
      else if ((m = /^\s*([A-Za-z_]\w*)\s*:\s*([^=]+)$/.exec(ln)) && !/^\s*(else|try|finally|elif|except|lambda|return)\b/.test(ln)) put(i, m[1], m[2].trim(), null);
      if ((m = /^\s*self\.(\w+)\s*(?::\s*([^=]+?))?\s*=(?!=)\s*(.+)$/.exec(ln))) { const c = clsAt(A, i); if (c) addSym(A, { name: m[1], type: m[2], init: m[3], kind: 'field', line: i, owner: c.name }); }
      if ((m = /^\s*for\s+(\w+)(?:\s*,\s*(\w+))?\s+in\s+(.+):/.exec(ln))) { if (m[2]) { put(i, m[1], /enumerate\(/.test(m[3]) ? 'int' : null); put(i, m[2], null, m[3].replace(/^enumerate\((.*)\)$/, '$1').replace(/\.items\(\)$/, '.values()'), { each: true }); } else put(i, m[1], null, m[3], { each: true }); }
      if ((m = /\bwith\s+(.+?)\s+as\s+(\w+)\s*:/.exec(ln))) put(i, m[2], null, m[1]);
      if ((m = /\bexcept\s+(\w+)\s+as\s+(\w+)/.exec(ln))) put(i, m[2], m[1]);
    }
    if (lang === 'php') {
      for (const x of ln.matchAll(/\$(\w+)\s*=(?![=>])\s*(.*)$/g)) if (x[1] !== 'this') put(i, x[1], null, initOf(x[2]));
      if ((m = /\bforeach\s*\(\s*(.+?)\s+as\s+(?:\$(\w+)\s*=>\s*)?\$(\w+)/.exec(ln))) { put(i, m[3], null, m[1], { each: true }); if (m[2]) put(i, m[2], null); }
      if ((m = /^\s*(?:public|private|protected|var)\s+(?:static\s+)?(?:readonly\s+)?(\??[\w\\]+\s+)?\$(\w+)/.exec(ln))) { const c = clsAt(A, i); if (c) addSym(A, { name: m[2], type: m[1] && m[1].trim(), kind: 'field', line: i, owner: c.name }); }
      if ((m = /\$this->(\w+)\s*=(?!=)\s*(.*)$/.exec(ln))) { const c = clsAt(A, i); if (c) addSym(A, { name: m[1], init: initOf(m[2]), kind: 'field', line: i, owner: c.name }); }
    }
    if (lang === 'ruby') {
      if ((m = /^\s*([a-z_]\w*)\s*=(?![=~>])\s*(.+)$/.exec(ln))) put(i, m[1], null, m[2]);
      if ((m = /^\s*@(\w+)\s*=(?!=)\s*(.+)$/.exec(ln))) { const c = clsAt(A, i); if (c) addSym(A, { name: '@' + m[1], init: m[2], kind: 'field', line: i, owner: c.name }); }
      if ((m = /^\s*attr_(?:accessor|reader|writer)\s+(.+)$/.exec(ln))) { const c = clsAt(A, i); if (c) for (const a of m[1].matchAll(/:(\w+)/g)) addSym(A, { name: a[1], kind: 'field', line: i, owner: c.name }); }
      if ((m = /\.each(?:_with_index)?\s+do\s*\|\s*(\w+)/.exec(ln)) || (m = /\{\s*\|\s*(\w+)/.exec(ln))) put(i, m[1], null);
    }
    if (lang === 'lua' && (m = /\blocal\s+([\w, ]+?)\s*(?:=\s*(.+))?$/.exec(ln)) && !/\blocal\s+function\b/.test(ln)) m[1].split(',').forEach((n, k) => put(i, n.trim(), null, k === 0 && m[2] ? m[2] : null));
    if (lang === 'shell' && (m = /^\s*(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)?)?([A-Za-z_]\w*)=/.exec(ln))) put(i, m[1], null, null, { shellVar: true });
    if (lang === 'shell' && (m = /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/.exec(ln))) addSym(A, { name: m[1], kind: 'fn', params: '', line: i });
    if (lang === 'powershell') for (const x of ln.matchAll(/\$(\w+)\s*=(?!=)\s*(.*)$/g)) put(i, '$' + x[1], null, initOf(x[2]));
    if (['sql', 'mysql', 'pgsql'].includes(lang)) readSql(A, ln, i);
  });
}
function readSql(A, ln, i) {
  let m;
  if ((m = /\bcreate\s+(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/i.exec(ln))) { const name = m[1].split('.').pop(); A.classes.set(name, { name, members: [], blocks: [], line: i }); A.sqlTable = name; addSym(A, { name, kind: 'class', line: i }); return; }
  if (A.sqlTable && (m = /^\s*([A-Za-z_]\w*)\s+([A-Za-z]+)/.exec(ln)) && !/^\s*(primary|foreign|constraint|unique|check|key|index)\b/i.test(ln)) addSym(A, { name: m[1], type: m[2], kind: 'field', line: i, owner: A.sqlTable });
  if (/\)\s*;?\s*$/.test(ln) && A.sqlTable && !/\(/.test(ln)) A.sqlTable = null;
  for (const x of ln.matchAll(/\b(?:from|join|update|into)\s+([\w.]+)(?:\s+(?:as\s+)?(\w+))?/gi)) {
    const t = x[1].split('.').pop();
    if (!A.classes.has(t)) { A.classes.set(t, { name: t, members: [], blocks: [], line: i }); addSym(A, { name: t, kind: 'class', line: i }); }
    if (x[2] && !/^(where|on|set|values|join|inner|left|right|full|cross|group|order|limit|as|using|natural)$/i.test(x[2])) addSym(A, { name: x[2], type: t, kind: 'var', line: i });
  }
}
// import: módulos visíveis (Python, Go, Java, C++)
function readImports(A, clean, lang) {
  let m;
  if (lang === 'python') {
    for (const x of clean.matchAll(/^\s*import\s+([\w., ]+)$/gm)) for (const part of x[1].split(',')) { const [mod, as] = part.trim().split(/\s+as\s+/); A.imports.set(as || mod.split('.')[0], '@' + (as ? mod : mod.split('.')[0])); if (!as && mod.includes('.')) A.imports.set(mod, '@' + mod); }
    for (const x of clean.matchAll(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm)) for (const part of x[2].replace(/[()]/g, '').split(',')) { const [n, as] = part.trim().split(/\s+as\s+/); if (n && n !== '*') A.imports.set(as || n, { from: '@' + x[1], name: n }); }
  } else if (lang === 'go') {
    const blk = /\bimport\s*\(([^)]*)\)/.exec(clean); const list = blk ? [...blk[1].matchAll(/(\w+\s+)?"([^"]+)"/g)] : [...clean.matchAll(/\bimport\s+(\w+\s+)?"([^"]+)"/g)];
    // os caminhos estão em strings, que a limpeza apagou: lê do texto original quando preciso
    for (const x of list) { const p = x[2].trim(); A.imports.set((x[1] || '').trim() || p.split('/').pop(), '@' + p.split('/').pop()); }
    A.goImport = blk ? { block: true, at: blk.index } : (m = /\bimport\s+"/.exec(clean)) ? { block: false, at: m.index } : null;
  } else if (lang === 'java' || lang === 'kotlin' || lang === 'groovy') {
    for (const x of clean.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?;?\s*$/gm)) A.imports.set(x[1].split('.').pop(), x[1]);
  } else if (lang === 'cpp') A.usingStd = /\busing\s+namespace\s+std\s*;/.test(clean);
  else if (lang === 'rust') for (const x of clean.matchAll(/\buse\s+std::(\w+)(?:::\{([^}]*)\}|::(\w+))?\s*;/g)) { A.imports.set(x[1], '@' + x[1]); for (const n of (x[2] || x[3] || '').split(',').map(s => s.trim()).filter(Boolean)) A.imports.set(n, n); }
}

// ---------- visibilidade e tipos dos nomes ----------
function visible(A, line) {
  const f = fnAt(A, line); const cls = clsAt(A, line);
  const chain = []; for (let b = f; b; b = b.parent) if (b.kind === 'fn') chain.push(b);
  return A.syms.filter(s => {
    if (s.kind === 'param' || (s.kind === 'var' && s.fnBlock)) return chain.includes(s.fnBlock) && (s.kind === 'param' || s.line <= line);
    // nessas linguagens campo e método só com receptor (self., $this->, r.)
    if ((s.kind === 'field' || (s.kind === 'fn' && s.owner)) && RECV_ONLY.has(A.lang)) return false;
    if (s.kind === 'field') return A.lang === 'sql' || (!!cls && classChain(A, cls.name).includes(s.owner));
    if (s.kind === 'fn' && s.owner) return !!cls && classChain(A, cls.name).includes(s.owner);
    return true;
  });
}
const RECV_ONLY = new Set(['python', 'php', 'ruby', 'go', 'rust', 'lua']);
function classChain(A, name) { const out = []; let n = name, k = 0; while (n && k++ < 10 && !out.includes(n)) { out.push(n); n = A.classes.get(n) && A.classes.get(n).ext; } return out; }

// tipo de um nome no ponto: variável, parâmetro, campo, classe ou módulo
function typeOfName(A, K, name, line, depth) {
  const syms = A.syms.filter(s => s.name === name && (s.kind !== 'fn'));
  // o mais perto acima do cursor, da função atual primeiro
  const f = fnAt(A, line);
  const pick = syms.filter(s => !s.fnBlock || s.fnBlock === f || (f && isAncestor(s.fnBlock, f))).sort((a, b) => (b.line <= line) - (a.line <= line) || b.line - a.line)[0];
  if (pick) {
    if (pick.kind === 'class') return { base: name, args: [], st: true };
    if (pick.type) return ty(pick.type);
    if (pick.tupleOf && depth < 4) { const t = exprType(A, K, pick.tupleOf, line, depth + 1); if (t && t.tuple) return ty(t.tuple[pick.tuple]); return null; }
    if (pick.init && depth < 4) { const t = exprType(A, K, pick.init, pick.line, depth + 1); return pick.each ? elemOf(t, A.lang) : t && { ...t, st: false }; }
  }
  if (A.classes.has(name)) return { base: name, args: [], st: true };
  const imp = A.imports.get(name);
  if (imp) { if (typeof imp === 'string' && imp.startsWith('@')) return { base: imp, args: [], st: true }; if (imp && imp.from) { const e = members(A, K, { base: imp.from, args: [], st: true }).find(m => m.name === imp.name); if (e) return e.ret ? { ...ty(e.ret), st: e.kind === 'field' && /^[A-Z]/.test(e.ret) && !e.params } : null; } }
  if (K.T.has(name) && (/^[A-Z]/.test(name) || K.T.has('@' + name) === false)) return { base: name, args: [], st: true };
  if (K.T.has('@' + name)) return { base: '@' + name, args: [], st: true };
  if (A.lang === 'cpp' && A.usingStd) { const e = K.T.get('@std').find(x => x.name === name); if (e) return ty(e.ret); }
  return null;
}
const isAncestor = (a, b) => { for (let x = b; x; x = x.parent) if (x === a) return true; return false; };

// tipo de uma expressão: "System.out", "lista.get(0)", "new Foo<>()", "\"x\".trim()", "Vec::new()", "self.campo"
function exprType(A, K, expr, line, depth = 0) {
  expr = expr.trim().replace(/^await\s+/, '').replace(/[?!]$/, '').replace(/\?$/, '');
  if (!expr || depth > 6) return null;
  const P = K.P;
  const segs = splitChain(expr, P.sep || ['.']);
  if (!segs.length) return null;
  let t = null;
  const first = segs[0].trim();
  let m;
  if (/^(["'`]).*\1$/s.test(first) || /^[rbfu]?["']/.test(first) && A.lang === 'python') t = P.lit && P.lit.s ? ty(P.lit.s) : null;
  else if (/^\[/.test(first)) {
    // ["a", "b"] -> lista de texto (o tipo vem do 1º elemento)
    t = P.lit && P.lit.l ? ty(P.lit.l) : null;
    const el = splitTop(first.replace(/^\[|\]$/g, ''))[0];
    if (t && el && depth < 5) { const a = exprType(A, K, el, line, depth + 1); if (a && a.base) t = { ...t, args: [a] }; }
  }
  else if (/^\{/.test(first)) t = P.lit && P.lit.d ? ty(P.lit.d) : null;
  else if (/^\d/.test(first)) t = ty(/\./.test(first) ? (A.lang === 'python' ? 'float' : 'double') : (A.lang === 'python' ? 'int' : 'int'));
  else if ((m = /^new\s+([\w.:]+)\s*(<[^(]*>)?\s*[([{]/.exec(first))) t = { ...ty(m[1] + (m[2] && m[2] !== '<>' ? m[2] : '')), st: false };
  else if ((m = /^(\w+!)/.exec(first))) { const e = K.g.find(x => x.name === m[1]); t = e && e.ret ? ty(e.ret) : null; }
  // struct literal: Pessoa{Nome: "x"} (Go), Ponto { x, y } (Rust), &Foo{}
  else if ((m = /^&?([A-Z]\w*)\s*\{/.exec(first)) && (A.lang === 'go' || A.lang === 'rust')) t = { base: m[1], args: [] };
  // indexação: partes[0], mapa["k"]
  else if ((m = /^([$\w]+)\s*\[.*\]$/s.exec(first))) t = elemOf(typeOfName(A, K, m[1], line, depth), A.lang);
  else if ((m = /^\(?\s*([$\w]+)\s*(<[^()]*>)?\s*(\((.*)\))?$/s.exec(first))) {
    const name = m[1].replace(/^\$/, A.lang === 'php' ? '' : '$'), call = !!m[3];
    if (name === 'this' || name === 'self' || name === 'Self') { const c = clsAt(A, line); t = c ? { base: c.name, args: [], st: name === 'Self' } : null; }
    else if (name === 'super') { const c = clsAt(A, line); const cl = c && A.classes.get(c.name); t = cl && cl.ext ? { base: cl.ext, args: [] } : null; }
    else if (call) {
      const fn = A.syms.find(s => s.kind === 'fn' && s.name === name && !s.owner) || K.g.find(e => e.name === name);
      if (fn && (fn.ret || fn.kind === 'fn')) t = fn.ret ? ty(fn.ret) : null;
      if (!t && (A.classes.has(name) || (K.T.has(name) && /^[A-Z]|^(str|list|dict|set|tuple|int|float|bytes|object|datetime|Path|deque|Counter)$/.test(name)))) t = { base: name, args: [], st: false };
      if (fn && fn.ret && /\(.+,.+\)/.test(fn.ret)) t = { ...(t || {}), tuple: splitTop(fn.ret.replace(/^\(|\)$/g, '')).map(x => x.split(/\s+/).pop()) };
      // coleção sem o tipo do elemento (listOf, mutableListOf, setOf, arrayOf...): o genérico explícito ou o 1º argumento
      if (t && !t.args.length && fn && !fn.doc) {
        if (m[2]) t = { ...t, args: splitTop(m[2].slice(1, -1)) };
        else if (m[4] && m[4].trim()) { const a = exprType(A, K, splitTop(m[4])[0], line, depth + 1); if (a && a.base) t = { ...t, args: [a] }; }
      }
    } else t = typeOfName(A, K, name, line, depth);
  }
  for (let i = 1; i < segs.length && t; i++) {
    const s = segs[i].trim();
    const mm = /^(\w+!?)\s*(?:::\s*<[^>]*>)?\s*(\((.*)\))?$/s.exec(s);
    if (!mm) return null;
    const list = members(A, K, t);
    const e = list.find(x => x.name === mm[1] && (!!mm[2] === (x.kind === 'fn') || x.kind === 'field')) || list.find(x => x.name === mm[1]);
    if (!e) return null;
    if (e.ret && e.ret.startsWith('@')) { t = { base: e.ret, args: [], st: true }; continue; }
    // Rust: Self é o tipo dono do método (Ponto::new() -> Ponto)
    if (e.ret && /^(Self|Result<Self.*|Option<Self>)$/.test(e.ret.trim())) { t = e.ret.trim() === 'Self' ? { base: e.from || t.base, args: [] } : { base: /^Result/.test(e.ret) ? 'Result' : 'Option', args: [e.from || t.base] }; continue; }
    const nt = subst(e.ret, t);
    if (e.ret && /^\(.+,.+\)$/.test(e.ret.trim())) { t = { ...(subst(splitTop(e.ret.trim().slice(1, -1))[0].split(/\s+/).pop(), t) || {}), tuple: splitTop(e.ret.trim().slice(1, -1)).map(x => x.split(/\s+/).pop()) }; continue; }
    t = nt ? { ...nt, st: false } : null;
    // Rust: Some/Ok embrulhados; unwrap/expect/? tiram
    if (t && A.lang === 'rust' && /^(unwrap|expect|unwrap_or\w*)$/.test(mm[1]) === false && (t.base === 'Self')) { const c = clsAt(A, line); t = c ? { base: c.name, args: [] } : t; }
  }
  if (t && t.base === 'Self') { const c = clsAt(A, line); t = c ? { base: c.name, args: [] } : null; }
  return t;
}
function splitChain(expr, seps) {
  const out = []; let d = 0, cur = '', q = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (q) { cur += ch; if (ch === q && expr[i - 1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{<'.includes(ch) && !(ch === '<' && !/[\w>]\s*$/.test(cur))) d++;
    else if (')]}>'.includes(ch) && d > 0 && !(ch === '>' && expr[i - 1] === '-')) d--;
    if (d === 0) {
      const sep = seps.find(s => expr.startsWith(s, i)) || (expr.startsWith('?.', i) ? '?.' : null);
      if (sep && !(sep === ':' && expr[i + 1] === ':') && !(sep === '.' && /^\d+$/.test(cur.trim()) && /\d/.test(expr[i + 1]))) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    }
    cur += ch;
  }
  out.push(cur);
  return out.filter(s => s.trim() !== '');
}

// membros de um tipo: tabelas da linguagem (com herança) e classes do arquivo
function members(A, K, t) {
  if (!t) return [];
  const out = []; const seen = new Set();
  const P = K.P; let base = t.base; let depth = 0;
  const addList = (list, d, from) => { for (const e of list) { const key = e.name + (e.kind === 'fn' ? '()' : ''); if (seen.has(key)) continue; seen.add(key); out.push({ ...e, depth: d, from }); } };
  const docChain = A.classes.has(base) ? classChain(A, base) : [];
  docChain.forEach((n, d) => addList(A.syms.filter(s => s.owner === n && (s.kind === 'fn' || s.kind === 'field')).map(s => ({ name: s.name, params: s.kind === 'fn' ? (s.params || '') : null, ret: s.kind === 'fn' ? s.ret : (s.type || null), kind: s.kind, st: !!s.st, doc: true, sym: s })), d, n));
  if (docChain.length) base = A.classes.get(docChain[docChain.length - 1]).ext || null;
  const lower = (b) => K.T.has(b) ? b : K.T.has(b && b.toLowerCase()) ? b.toLowerCase() : b;
  let b = lower(base);
  const visited = new Set();
  while (b && depth < 10 && !visited.has(b)) {
    visited.add(b);
    if (K.T.has(b)) addList(K.T.get(b), depth + docChain.length, b);
    b = lower((P.ext || {})[b]); depth++;
  }
  // raiz comum (Object, object, Any) quando a tabela existe
  for (const root of ['Object', 'object', 'Any']) if (K.T.has(root) && !visited.has(root) && !String(t.base).startsWith('@') && !['[]', 'str'].includes(t.base)) addList(K.T.get(root), 20, root);
  return out;
}

// ---------- pontuação (IntelliJ: prefixo > camel humps > trecho > subsequência) ----------
function humps(s) { const h = [0]; for (let i = 1; i < s.length; i++) { const c = s[i], p = s[i - 1]; if ((c >= 'A' && c <= 'Z' && !(p >= 'A' && p <= 'Z')) || (p === '_' || p === '-' || p === '$') && c !== '_') h.push(i); } return h; }
function matchScore(q, label) {
  if (!q) return 1;
  if (label.startsWith(q)) return label.length === q.length ? 120 : 100;
  const ql = q.toLowerCase(), ll = label.toLowerCase();
  if (ll.startsWith(ql)) return 88;
  // camel humps: cada letra continua a palavra atual ou pula para o começo de uma das próximas
  const H = humps(label);
  const camel = (() => {
    if (ll[0] !== ql[0]) return false;
    let li = 1, hi = 1;
    for (let qi = 1; qi < q.length; qi++) {
      const c = ql[qi];
      if (li < label.length && ll[li] === c && !(q[qi] >= 'A' && q[qi] <= 'Z' && !H.includes(li))) { li++; continue; }
      while (hi < H.length && H[hi] < li) hi++;
      let found = false;
      for (; hi < H.length; hi++) if (ll[H[hi]] === c) { li = H[hi] + 1; hi++; found = true; break; }
      if (!found) return false;
    }
    return true;
  })();
  if (camel) return 75;
  // no meio: no começo de uma palavra (getUserName <- "user") ou, com 3+ letras, em qualquer lugar
  const at = ll.indexOf(ql);
  if (at > 0 && H.includes(at)) return 55;
  if (at > 0 && ql.length >= 3) return 40;
  return -1;
}

// ---------- usados recentemente ----------
let recent = null;
const recentOf = () => recent || (recent = (() => { try { return bs.store.get(RECENT_KEY, {}) || {}; } catch { return {}; } })());
function used(lang, label) {
  const r = recentOf(); const k = lang + ':' + label; const now = Date.now();
  const v = r[k] || { n: 0, t: 0 }; r[k] = { n: Math.min(v.n + 1, 50), t: now };
  const keys = Object.keys(r); if (keys.length > 600) keys.sort((a, b) => r[a].t - r[b].t).slice(0, keys.length - 500).forEach(x => delete r[x]);
  clearTimeout(used.t); used.t = setTimeout(() => { try { bs.store.set(RECENT_KEY, r); } catch {} }, 800);
}
function recency(lang, label) { const v = recentOf()[lang + ':' + label]; if (!v) return 0; const days = (Date.now() - v.t) / 864e5; return Math.round(Math.min(45, v.n * 9) * (days < 1 ? 1 : days < 7 ? 0.6 : 0.3)); }

// ---------- texto antes do cursor ----------
// começo da expressão que termina em "end" (anda para trás por nomes, separadores e parênteses equilibrados)
function exprStart(line, end, seps) {
  let i = end, d = 0;
  while (i > 0) {
    const ch = line[i - 1];
    if (d > 0) { if (')]}>'.includes(ch)) d++; else if ('([{<'.includes(ch)) d--; i--; continue; }
    if (')]}'.includes(ch) || (ch === '>' && /[\w>]\s*$/.test(line.slice(0, i - 1)) && line.slice(0, i).match(/<[^<>]*>$/))) { d++; i--; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { const j = line.lastIndexOf(ch, i - 2); if (j < 0) break; i = j; continue; }
    if (/[\w$!?@]/.test(ch)) { i--; continue; }
    const sep = seps.find(s => line.slice(i - s.length, i) === s);
    if (sep) { i -= sep.length; continue; }
    if (ch === '.' ) { i--; continue; }
    break;
  }
  // "new Foo()" faz parte da expressão
  const before = line.slice(0, i); const nw = /\bnew\s+$/.exec(before); if (nw) i = nw.index;
  return i;
}
function memberCtx(lineClean, col, seps) {
  const before = lineClean.slice(0, col);
  const w = /[\w$]*$/.exec(before)[0];
  const pre = before.slice(0, before.length - w.length);
  const all = [...seps, '?.'].sort((a, b) => b.length - a.length);
  const sep = all.find(s => pre.endsWith(s));
  if (!sep) return null;
  if (sep === '.' && /\d\.$/.test(pre) && !/[\w)\]]\d+\.$/.test(pre) && /(^|[^\w.])\d+\.$/.test(pre)) return null; // 1.5
  const end = pre.length - sep.length;
  const start = exprStart(lineClean, end, seps);
  const expr = lineClean.slice(start, end);
  if (!expr.trim()) return null;
  return { expr, sep, start, word: w };
}

// ---------- montagem das sugestões ----------
const kindOf = (k, m) => ({ var: m.Variable, param: m.Variable, field: m.Field, fn: m.Method, gfn: m.Function, class: m.Class, module: m.Module, kw: m.Keyword, type: m.TypeParameter, tpl: m.Snippet, pfx: m.Snippet, word: m.Text, const: m.Constant })[k] ?? m.Text;
const escSnip = (s) => s.replace(/[\\$}]/g, '\\$&');
function callInsert(name, params, nextCh) {
  if (nextCh === '(') return { text: name, snip: false };
  if (params == null) return { text: name, snip: false };
  return params.trim() ? { text: escSnip(name) + '($0)', snip: true } : { text: name + '()', snip: false };
}

// imports automáticos (só quando a classe/módulo vem de fora e ainda não foi importado)
const JAVA_PKG = { List: 'java.util', ArrayList: 'java.util', LinkedList: 'java.util', Map: 'java.util', HashMap: 'java.util', TreeMap: 'java.util', LinkedHashMap: 'java.util', Set: 'java.util', HashSet: 'java.util', TreeSet: 'java.util', Optional: 'java.util', Arrays: 'java.util', Collections: 'java.util', Objects: 'java.util', Scanner: 'java.util', Iterator: 'java.util', Queue: 'java.util', Deque: 'java.util', ArrayDeque: 'java.util', Stream: 'java.util.stream', Collectors: 'java.util.stream', IntStream: 'java.util.stream', Files: 'java.nio.file', Path: 'java.nio.file', Paths: 'java.nio.file', File: 'java.io', BufferedReader: 'java.io', IOException: 'java.io', LocalDate: 'java.time', LocalDateTime: 'java.time', Duration: 'java.time', ConcurrentHashMap: 'java.util.concurrent' };
const GO_PATH = { json: 'encoding/json', http: 'net/http', filepath: 'path/filepath' };
function importEdit(model, A, lang, name) {
  const lines = model.getLineCount();
  const findLast = (re) => { let at = 0; for (let i = 1; i <= Math.min(lines, 400); i++) if (re.test(model.getLineContent(i))) at = i; return at; };
  if (lang === 'java' && JAVA_PKG[name] && !A.imports.has(name)) {
    const after = findLast(/^\s*import\s/) || findLast(/^\s*package\s/);
    const text = `import ${JAVA_PKG[name]}.${name};\n` + (after && !/^\s*import\s/.test(model.getLineContent(after)) ? '\n' : '');
    return [{ range: new monaco.Range(after + 1, 1, after + 1, 1), text: after ? text : text + '\n' }];
  }
  if (lang === 'python' && !A.imports.has(name)) {
    const after = findLast(/^\s*(import|from)\s/);
    return [{ range: new monaco.Range(after + 1, 1, after + 1, 1), text: `import ${name}\n` + (after ? '' : '\n') }];
  }
  if (lang === 'go' && !A.imports.has(name)) {
    const path = GO_PATH[name] || name;
    const blk = findLast(/^\s*import\s*\($/);
    if (blk) return [{ range: new monaco.Range(blk + 1, 1, blk + 1, 1), text: `\t"${path}"\n` }];
    const one = findLast(/^\s*import\s+"/);
    if (one) return [{ range: new monaco.Range(one + 1, 1, one + 1, 1), text: `import "${path}"\n` }];
    const pkg = findLast(/^\s*package\s/);
    return [{ range: new monaco.Range(pkg + 1, 1, pkg + 1, 1), text: `\nimport "${path}"\n` }];
  }
  return null;
}

// lite: só templates e postfix que já casam com o que foi digitado (convive com o servidor de linguagem)
function provide(model, pos, lite = false) {
  const lang = model.getLanguageId(); const K = pack(lang); if (!K) return null;
  const P = K.P; const M = monaco.languages.CompletionItemKind;
  const A = analyze(model);
  const off = model.getOffsetAt(pos);
  if (!A.big && inRanges(A.ranges, off)) return { suggestions: [] };
  const raw = model.getLineContent(pos.lineNumber);
  const lineClean = A.lines ? A.lines[pos.lineNumber - 1] || raw : raw;
  const col = pos.column - 1;
  const word = model.getWordUntilPosition(pos); const q = raw.slice(word.startColumn - 1, col);
  const wr = new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn);
  const nextCh = raw[word.endColumn - 1];
  const full = !lite && P.only !== 'templates' && !A.big;
  const items = [];
  const seen = new Set();
  // um nome aparece uma vez (o primeiro a chegar é o de maior prioridade); templates e postfix são à parte
  const add = (label, kind, score, o = {}) => {
    if (lite && (!q || matchScore(q, label) < 88)) return;
    const key = kind === 'tpl' || kind === 'pfx' ? label + '|' + kind : label; if (seen.has(key)) return; seen.add(key);
    const ms = matchScore(o.filter || q, o.filterText ? o.filterText : label); if (ms < 0 && !o.always) return;
    const total = Math.max(0, ms) * 10 + score + recency(lang, label) + (A.words && o.freq !== false ? Math.min(20, (A.words.get(label) || 0) * 2) : 0);
    items.push({ label: o.labelObj || label, kind: kindOf(kind, M), detail: o.detail, documentation: o.doc, insertText: o.insert ?? label, insertTextRules: o.snip ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
      range: o.range || wr, filterText: o.filterText, sortText: String(100000 - total).padStart(6, '0'), additionalTextEdits: o.edits || undefined,
      command: { id: CMD, title: '', arguments: [lang, typeof label === 'string' ? label : label.label] }, _score: total });
  };
  const fnLabel = (e) => ({ label: e.name, detail: e.params != null ? `(${e.params})` : '', description: e.ret || '' });

  const mc = memberCtx(lineClean, col, P.sep || ['.']);
  if (mc) {
    // membros do tipo do receptor
    if (full) {
      const t = exprType(A, K, mc.expr, pos.lineNumber - 1);
      if (t) {
        const isStatic = !!t.st && !String(t.base).startsWith('@');
        let list = members(A, K, t);
        if (isStatic) { const st = list.filter(e => e.st); if (st.length || !['python', 'ruby', 'kotlin'].includes(lang)) list = st; }
        else if (!String(t.base).startsWith('@')) { const inst = list.filter(e => !e.st); if (inst.length) list = inst; }
        if (mc.sep === '::' && lang === 'rust') list = list.filter(e => e.st || e.kind === 'field' || String(t.base).startsWith('@'));
        for (const e of list) {
          const ins = e.snippet ? { text: e.snippet, snip: true } : callInsert(e.name, e.kind === 'fn' ? e.params || '' : null, nextCh);
          add(e.name, e.kind === 'fn' ? 'fn' : (String(e.ret || '').startsWith('@') ? 'module' : 'field'), 300 - Math.min(e.depth, 20) * 6 + (e.doc ? 20 : 0), { labelObj: fnLabel(e), insert: ins.text, snip: ins.snip, detail: e.ret || undefined, key: 'm' });
        }
      } else if (A.classes.has(mc.expr.trim()) === false) {
        // tipo desconhecido: nomes usados depois de "<expr>." no arquivo (como o IntelliJ faz sem índice)
        const re = new RegExp(escRe(mc.expr.trim()) + '\\s*' + escRe(mc.sep) + '\\s*([A-Za-z_]\\w*)', 'g');
        const seenNames = new Set();
        for (const ln of A.lines || []) for (const x of ln.matchAll(re)) if (!seenNames.has(x[1])) { seenNames.add(x[1]); add(x[1], 'field', 120, { key: 'u' }); }
      }
    }
    // postfix: expr.sout -> System.out.println(expr)
    // filtra só pela chave digitada (como o IntelliJ, o postfix fica abaixo dos membros) e apaga "expr." numa edição à parte
    if (mc.sep === '.' && P.pfx && P.pfx.length) {
      const lead = raw.slice(mc.start).length - raw.slice(mc.start).trimStart().length;
      const startCol = mc.start + lead + 1;
      const exprRaw = raw.slice(startCol - 1, mc.start + mc.expr.length).trim();
      const del = [{ range: new monaco.Range(pos.lineNumber, startCol, pos.lineNumber, word.startColumn), text: '' }];
      for (const [k, body, desc] of P.pfx) {
        add(k, 'pfx', q === k ? 600 : -20, { key: 'p', detail: desc, doc: { value: '```\n' + body.replace(/EXPR/g, exprRaw).replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, '') + '\n```' }, insert: body.replace(/EXPR/g, escSnip(exprRaw)), snip: true, edits: del, freq: false });
      }
    }
    return finish(items);
  }

  // sem receptor: templates, nomes visíveis, globais, palavras-chave
  const lineHead = lineClean.slice(0, word.startColumn - 1);
  const atStmt = /^\s*$/.test(lineHead) || /[;{}]\s*$/.test(lineHead);
  const afterNew = P.newKw && /\bnew\s+$/.test(lineHead);
  for (const [k, body, desc] of P.tpl || []) {
    if (afterNew) break;
    add(k, 'tpl', (q === k ? 600 : 40) + (atStmt ? 20 : -40), { key: 't', detail: desc, doc: { value: '```\n' + body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, '').replace(/\\\$/g, '$') + '\n```' }, insert: body, snip: true, freq: false });
  }
  if (!full) return finish(items);
  if (lang === 'python' && /^\s*(import|from)\s+[\w.]*$/.test(lineHead + q)) {
    for (const k of K.T.keys()) if (k.startsWith('@')) add(k.slice(1), 'module', 200, {});
    return finish(items);
  }
  const line = pos.lineNumber - 1;
  if (!afterNew) {
    for (const s of visible(A, line)) {
      if (s.name === q && s.line === line) continue;
      if (s.kind === 'class') { add(s.name, 'class', 150, {}); continue; }
      const near = Math.max(0, 60 - Math.abs(line - s.line));
      if (s.kind === 'fn') { const ins = callInsert(s.name, s.params || '', nextCh); add(s.name, 'fn', 210, { labelObj: fnLabel(s), insert: ins.text, snip: ins.snip, detail: s.ret || undefined }); continue; }
      const kind = s.kind === 'param' ? 'param' : s.kind === 'field' ? 'field' : 'var';
      add(s.name, kind, (kind === 'field' ? 230 : 260) + near, { detail: s.type || undefined });
    }
    for (const e of K.g) {
      if (e.snippet) { add(e.name, 'gfn', 170, { insert: e.snippet, snip: true, detail: e.ret || undefined, labelObj: { label: e.name, description: e.ret || '' } }); continue; }
      const ins = callInsert(e.name, e.kind === 'fn' ? e.params || '' : null, nextCh);
      add(e.name, e.kind === 'fn' ? 'gfn' : 'const', 170, { labelObj: fnLabel(e), insert: ins.text, snip: ins.snip, detail: e.ret || undefined });
    }
    // módulos (Python: importados primeiro; os outros ganham o import ao escolher) e pacotes do Go
    if (lang === 'python' || lang === 'go') for (const k of K.T.keys()) {
      if (!k.startsWith('@') || k.includes('.')) continue;
      const name = k.slice(1); const has = A.imports.has(name);
      add(name, 'module', has ? 190 : 90, { edits: has ? null : importEdit(model, A, lang, name), detail: has ? 'módulo' : (lang === 'go' ? 'import "' + (GO_PATH[name] || name) + '"' : 'import ' + name) });
    }
    if (lang === 'rust') for (const k of K.T.keys()) if (k.startsWith('@')) add(k.slice(1), 'module', 80, {});
    if (lang === 'cpp' && A.usingStd) for (const e of K.T.get('@std')) add(e.name, e.kind === 'fn' ? 'gfn' : 'const', 160, { labelObj: fnLabel(e), insert: callInsert(e.name, e.kind === 'fn' ? e.params || '' : null, nextCh).text });
    if (lang === 'cpp') add('std', 'module', 150, {});
    for (const k of K.kw) add(P.upper && q && q === q.toLowerCase() ? k.toLowerCase() : k, 'kw', (atStmt && K.stmt.has(k) ? 140 : 30), { freq: false });
  }
  // classes e tipos (depois de "new", só elas)
  for (const t of K.types) add(t, 'type', afterNew ? 300 : 60, { freq: false });
  for (const k of K.T.keys()) if (!k.startsWith('@') && /^[A-Za-z]/.test(k) && !/^(Object|object|Any|Iterable|Iterator|Collection|slice|str|\[\])$/.test(k) || (afterNew && k === 'Object')) {
    if (lang === 'python' && /^[a-z]/.test(k) && !['str', 'list', 'dict', 'set', 'tuple', 'bytes'].includes(k)) continue;
    add(k, 'class', afterNew ? 320 : 120, { edits: importEdit(model, A, lang, k), detail: JAVA_PKG[k] && lang === 'java' ? JAVA_PKG[k] : undefined });
  }
  // classes concretas que só existem como apelido (ArrayList -> List, HashMap -> Map)
  for (const k of Object.keys(P.ext || {})) if (/^[A-Z]/.test(k)) add(k, 'class', afterNew ? 330 : 110, { edits: importEdit(model, A, lang, k), detail: JAVA_PKG[k] && lang === 'java' ? JAVA_PKG[k] : undefined });
  for (const [n] of A.classes) add(n, 'class', afterNew ? 340 : 160, {});
  // último recurso: palavras do arquivo que não são nada acima (sem prefixo não aparecem)
  // (sem a própria palavra que está sendo digitada, com ou sem o $ do shell/PHP)
  if (q.length >= 1 && !afterNew) for (const [w2, n] of A.words) if (w2 !== q && w2.replace(/^[$@]/, '') !== q && !K.kw.includes(w2)) add(w2, 'word', -60 + Math.min(n, 10), { key: 'w' });
  return finish(items);
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function finish(items) {
  // a ordem é a do ranking: sortText é a posição (sem empates, o Monaco não reordena por nome)
  items.sort((a, b) => b._score - a._score);
  const list = items.slice(0, 400);
  list.forEach((it, i) => { it.sortText = String(i).padStart(4, '0'); });
  return { suggestions: list, incomplete: false };
}

// ---------- ajuda de assinatura ----------
function signature(model, pos) {
  const lang = model.getLanguageId(); const K = pack(lang); if (!K || K.P.only) return null;
  const A = analyze(model); if (A.big || !A.lines) return null;
  // anda para trás até o "(" aberto, contando vírgulas de fora
  const startLine = Math.max(0, pos.lineNumber - 1 - 20);
  let txt = A.lines.slice(startLine, pos.lineNumber - 1).join('\n'); txt += (txt ? '\n' : '') + A.lines[pos.lineNumber - 1].slice(0, pos.column - 1);
  let d = 0, commas = 0, i = txt.length - 1;
  for (; i >= 0; i--) { const ch = txt[i]; if (')]}'.includes(ch)) d++; else if ('([{'.includes(ch)) { if (d === 0) { if (ch === '(') break; return null; } d--; } else if (ch === ',' && d === 0) commas++; else if (ch === ';' && d === 0) return null; }
  if (i < 0) return null;
  const head = txt.slice(0, i); const lastLine = head.split('\n').pop();
  const st = exprStart(lastLine, lastLine.length, K.P.sep || ['.']);
  const callee = lastLine.slice(st).trim(); if (!callee) return null;
  const segs = splitChain(callee, K.P.sep || ['.']);
  const name = segs.pop().trim().replace(/^new\s+/, '');
  let cands = [];
  if (segs.length) { const t = exprType(A, K, segs.join(K.P.sep[0] === '::' ? '::' : (callee.includes('::') ? '::' : K.P.sep[0])), pos.lineNumber - 1); cands = members(A, K, t).filter(e => e.name === name && e.kind === 'fn'); }
  else cands = [...A.syms.filter(s => s.kind === 'fn' && s.name === name).map(s => ({ name, params: s.params || '', ret: s.ret })), ...K.g.filter(e => e.name === name && e.kind === 'fn')];
  if (!cands.length) return null;
  const sigs = cands.slice(0, 10).map(e => { const ps = splitTop(e.params || ''); return { label: `${e.name}(${ps.join(', ')})${e.ret ? ': ' + e.ret : ''}`, parameters: ps.map(p => ({ label: p })) }; });
  const fit = Math.max(0, sigs.findIndex(s => s.parameters.length > commas || /\.\.\.|\*/.test(s.label)));
  return { value: { signatures: sigs, activeSignature: fit, activeParameter: commas }, dispose() {} };
}

// ---------- registro ----------
let CMD = 'bs.cmpl.used';
let done = false;
function setup() {
  if (done || !window.monaco) return; done = true;
  try { monaco.editor.registerCommand(CMD, (_a, lang, label) => used(lang, label)); } catch { CMD = undefined; }
  const run = (model, pos, lite) => { try { const r = provide(model, pos, lite); if (r && !CMD) r.suggestions.forEach(s => delete s.command); return r || { suggestions: [] }; } catch (e) { console.warn('autocompletar', e); return { suggestions: [] }; } };
  // O Monaco pergunta aos provedores em grupos, do mais específico ao menos, e para no primeiro grupo que responde.
  // 1) junto do servidor de linguagem (seletor da linguagem): templates e postfix que já casam com o digitado
  for (const lang of Object.keys(D)) monaco.languages.registerCompletionItemProvider(lang, { triggerCharacters: ['.', ':', '>', '$', '@'], provideCompletionItems: (model, pos) => run(model, pos, true) });
  // 2) grupo de baixo ("*"): o motor completo, quando não há servidor ou ele não devolveu nada (carregando, arquivo solto)
  monaco.languages.registerCompletionItemProvider({ language: '*' }, { triggerCharacters: ['.', ':', '>', '$', '@'], provideCompletionItems: (model, pos) => D[model.getLanguageId()] ? run(model, pos, false) : { suggestions: [] } });
  // assinatura: o servidor de linguagem vem antes; esta só responde se ele não responder
  monaco.languages.registerSignatureHelpProvider({ language: '*' }, { signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [')'], provideSignatureHelp: (model, pos) => { try { return D[model.getLanguageId()] ? signature(model, pos) : null; } catch { return null; } } });
}
bs.hooks.on('editor:ready', setup);
if (window.monaco) setup();
bs.complete = { analyze, exprType: (model, expr, line) => exprType(analyze(model), pack(model.getLanguageId()), expr, line), matchScore, provide };
})(window.BS);
