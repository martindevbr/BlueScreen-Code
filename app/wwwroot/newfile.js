/* BlueScreen: "Novo ›" do IntelliJ (clique direito ou Alt+Insert) e o erro de pacote
   errado nas classes Java.
   O submenu já recomenda os tipos da pasta: num source root (src/test) vem "Classe Java" (classe, interface, enum,
   record, anotação, exceção, escolhidos com ↑/↓ na entrada) com o "package" certo; em resources, properties/xml/yaml;
   na pasta web, JSP/HTML/CSS/JS; e as extensões que a pasta já tem. Escolhido o tipo, abre só uma entrada de nome
   ali mesmo (sem modal). "Arquivo" cria com o nome exatamente como digitado, sem amarrar extensão; "Pasta"/"Pacote"
   aceita a/b/c (ou a.b.c dentro do código). "Outros…" abre o diálogo com todos os tipos.
   No editor, um .java cujo "package" não bate com a pasta ganha erro (como o IntelliJ: "Package name 'x' does not
   correspond to the file path 'y'") e Alt+Enter oferece mover a classe para o pacote declarado ou corrigir a
   declaração. No Kotlin a diferença é permitida, então vira só aviso. Expõe bs.newFile.open(dir, tipo). */
(function (bs) {
'use strict';

// ---------- pacote de cada pasta (pelo modelo do projeto no núcleo: pom, .classpath, convenção Maven) ----------
const PKG = new Map(); // project|dir -> Promise<{ root, kind, pkg }>
function pkgOf(dir, project = bs.S.project && bs.S.project.path) {
  const k = project + '|' + dir;
  if (!PKG.has(k)) PKG.set(k, api('file/pkg', { project, dir }).catch(() => ({ root: null })));
  return PKG.get(k);
}
const dirOf = (rel) => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
const joinRel = (...p) => p.filter(Boolean).join('/');

// ---------- tipos ----------
const JAVA_KW = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield'.split(' '));
const JAVA_ID = /^[A-Za-z_$][\w$]*$/;
const pkgLine = (pkg, semi = ';') => pkg ? `package ${pkg}${semi}\n\n` : '';
const java = (decl) => (n, pkg) => pkgLine(pkg) + decl(n) + '\n';
const TYPES = [
  { id: 'java-class', label: 'Classe Java', code: true, java: 'class', body: java(n => `public class ${n} {\n}`) },
  { id: 'java-interface', label: 'Interface', code: true, java: 'interface', body: java(n => `public interface ${n} {\n}`) },
  { id: 'java-enum', label: 'Enum', code: true, java: 'enum', body: java(n => `public enum ${n} {\n}`) },
  { id: 'java-record', label: 'Record', code: true, java: 'record', body: java(n => `public record ${n}() {\n}`) },
  { id: 'java-annotation', label: 'Anotação', code: true, java: 'annotation', body: java(n => `public @interface ${n} {\n}`) },
  { id: 'java-exception', label: 'Exceção', code: true, java: 'exception', body: java(n => `public class ${n} extends Exception {\n\n    public ${n}(String message) {\n        super(message);\n    }\n}`) },
  { id: 'java-abstract', label: 'Classe abstrata', code: true, java: 'abstract', body: java(n => `public abstract class ${n} {\n}`) },
  { id: 'kotlin', label: 'Classe Kotlin', code: true, ext: '.kt', cls: true, body: (n, pkg) => pkgLine(pkg, '') + `class ${n} {\n}\n` },
  { id: 'file', label: 'Arquivo', hint: 'nome livre, com ou sem extensão', free: true, body: () => '' },
  { id: 'dir', label: 'Pasta / pacote', dir: true },
  { id: 'html', label: 'HTML', ext: '.html', body: (n) => `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${n}</title>\n</head>\n<body>\n\n</body>\n</html>\n` },
  { id: 'jsp', label: 'JSP', ext: '.jsp', body: (n) => `<%@ page contentType="text/html;charset=UTF-8" language="java" %>\n<!doctype html>\n<html>\n<head>\n  <title>${n}</title>\n</head>\n<body>\n\n</body>\n</html>\n` },
  { id: 'css', label: 'CSS', ext: '.css', body: () => '' },
  { id: 'js', label: 'JavaScript', ext: '.js', body: () => '' },
  { id: 'ts', label: 'TypeScript', ext: '.ts', body: () => '' },
  { id: 'json', label: 'JSON', ext: '.json', body: () => '{\n}\n' },
  { id: 'xml', label: 'XML', ext: '.xml', body: () => '<?xml version="1.0" encoding="UTF-8"?>\n' },
  { id: 'properties', label: 'Properties', ext: '.properties', body: () => '' },
  { id: 'yaml', label: 'YAML', ext: '.yml', body: () => '' },
  { id: 'md', label: 'Markdown', ext: '.md', body: (n) => `# ${n}\n` },
  { id: 'py', label: 'Python', ext: '.py', body: () => '' },
  { id: 'sql', label: 'SQL', ext: '.sql', body: () => '' },
  { id: 'sh', label: 'Shell script', ext: '.sh', body: () => '#!/usr/bin/env bash\n' },
];
const typeIcon = (t) => t.dir ? TI.package : t.java ? treeIcon({ name: 'X.java', java: t.java }) : treeIcon({ name: t.free ? 'arquivo' : 'x' + t.ext });

// O que vai ser criado: { path, dir, content, line } ou { error }
function plan(t, raw, base) {
  let name = raw.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!name) return { error: '' };
  const inCode = base.pkg != null;
  if (t.dir) {
    // dentro do código, "a.b.c" é pacote (pastas a/b/c), como o New Package do IntelliJ
    const parts = (inCode && !name.includes('/') ? name.split('.') : name.split('/'));
    if (inCode && !name.includes('/') && parts.some(p => !JAVA_ID.test(p) || JAVA_KW.has(p))) return { error: 'Nome de pacote inválido' };
    return { path: joinRel(base.dir, parts.join('/')), dir: true };
  }
  if (t.free) return { path: joinRel(base.dir, name), content: '' };
  if (t.java || t.cls) {
    name = name.replace(t.java ? /\.java$/i : /\.kt$/i, '');
    const parts = name.split(/[./]/); const cls = parts.pop();
    if (!JAVA_ID.test(cls) || JAVA_KW.has(cls)) return { error: `"${cls}" não é um nome de classe válido` };
    if (parts.some(p => !JAVA_ID.test(p) || JAVA_KW.has(p))) return { error: 'Nome de pacote inválido' };
    const pkg = [base.pkg, ...parts].filter(Boolean).join('.');
    const content = t.body(cls, pkg);
    const line = content.split('\n').findIndex(l => l.includes(' ' + cls)) + 1;
    return { path: joinRel(base.dir, ...parts, cls + (t.ext || '.java')), content, line: line || 1, pkg };
  }
  const file = name.toLowerCase().endsWith(t.ext) ? name : name + t.ext;
  const stem = file.split('/').pop().slice(0, -t.ext.length);
  return { path: joinRel(base.dir, file), content: t.body(stem) };
}

// ---------- diálogo com todos os tipos ("Outros…") ----------
const NF = { last: store.get('newFileType', 'java-class') };
async function open(dir, typeId) {
  if (!bs.S.project) return toast('Abra um projeto primeiro');
  closeMenu();
  dir = dir || '';
  const base = { dir, ...(await pkgOf(dir)) };
  const inCode = base.pkg != null;
  // no código: Java primeiro; fora dele, os tipos comuns primeiro (Java continua disponível no fim)
  const list = inCode ? TYPES : [...TYPES.filter(t => !t.code), ...TYPES.filter(t => t.code)];
  let sel = Math.max(0, list.findIndex(t => t.id === (typeId || (inCode ? NF.last : NF.lastPlain || 'file'))));
  const where = inCode ? (base.pkg ? `pacote ${base.pkg}` : 'pacote padrão') + ` · ${base.root}` : (dir || bs.S.project.name);
  dialog('newFile', `<div class="dlg-hd"><span class="dlg-ic">${I.newp}</span><div><h3>Novo</h3><p title="${esc(dir)}">em ${esc(where)}</p></div></div>
    <label class="fld">Nome<input id="nfName" spellcheck="false" autocomplete="off"></label>
    <div class="nf-list" id="nfList" role="listbox"></div>
    <p class="where" id="nfWhere"></p>
    <div class="err" id="nfErr"></div>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="nfOk">Criar</button></div>`, (el) => {
    el.querySelector('.dlg-box').classList.add('nf-box');
    const inp = $('#nfName');
    const paint = () => {
      $('#nfList').innerHTML = list.map((t, i) => `${i && !!list[i - 1].code !== !!t.code ? '<div class="nf-sep"></div>' : ''}<div class="nf-it ${i === sel ? 'on' : ''}" data-i="${i}" role="option">${typeIcon(t)}<span>${esc(t.label)}</span>${t.hint ? `<em>${esc(t.hint)}</em>` : t.ext ? `<em>${esc(t.ext)}</em>` : ''}</div>`).join('');
      $('#nfList').querySelectorAll('.nf-it').forEach(r => { r.onclick = () => { sel = +r.dataset.i; paint(); inp.focus(); }; r.ondblclick = go; });
      $('#nfList .nf-it.on')?.scrollIntoView({ block: 'nearest' });
      const t = list[sel];
      inp.placeholder = t.dir ? (inCode ? 'com.empresa.modulo' : 'pasta/subpasta') : t.java || t.cls ? 'NomeDaClasse ou com.empresa.NomeDaClasse' : t.free ? 'nome.ext, Dockerfile, .env…' : 'nome';
      update();
    };
    const update = () => {
      const p = plan(list[sel], inp.value, base);
      $('#nfErr').textContent = p.error || '';
      $('#nfWhere').textContent = p.path ? (p.pkg != null && (list[sel].java || list[sel].cls) ? `${p.path}  ·  package ${p.pkg || '(padrão)'}` : p.path) : '';
      return p;
    };
    const go = async () => {
      const t = list[sel]; const p = update();
      if (!p.path) { if (!p.error) $('#nfErr').textContent = 'Dê um nome'; inp.focus(); return; }
      $('#nfOk').disabled = true;
      try {
        await make(p);
        if (inCode) { NF.last = t.id; store.set('newFileType', t.id); } else NF.lastPlain = t.id;
        el.hidden = true;
      } catch (e) { $('#nfErr').textContent = e.message; $('#nfOk').disabled = false; }
    };
    inp.oninput = update;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; paint(); }
    };
    $('#nfOk').onclick = go;
    paint(); inp.focus();
  });
}
// a árvore relê as pastas no caminho (pacotes compactados podem ter mudado) e mostra o item novo
async function created(path, isDir) {
  PKG.clear();
  for (const k of Object.keys(bs.S.tree)) if (!k || path === k || path.startsWith(k + '/')) delete bs.S.tree[k];
  if (bs.S.treeOpen && dirOf(path)) { let d = dirOf(path); while (d) { bs.S.treeOpen.add(d); d = dirOf(d); } }
  try { await treeReveal(isDir ? path : dirOf(path)); if (!isDir) treeSelect(path, true); } catch {}
  refreshProject();
}
// cria de fato (arquivo ou pasta), mostra na árvore e abre no editor
async function make(p) {
  await api('file/new', { project: bs.S.project.path }, { method: 'POST', body: JSON.stringify({ path: p.path, dir: !!p.dir, content: p.content || '' }) });
  await created(p.path, p.dir);
  if (!p.dir) await openFile(p.path, 'editor', p.line);
}

// ---------- entrada rápida: só o nome, ali mesmo onde foi o clique (o "New Java Class" do IntelliJ) ----------
// Sem fundo escurecido: Enter cria, Esc ou clique fora cancela. Na classe Java, ↑/↓ trocam o tipo (classe, interface...).
let lastClick = null;
document.addEventListener('contextmenu', (e) => { lastClick = { x: e.clientX, y: e.clientY, at: Date.now() }; }, true);
function anchorFor(dir) {
  if (lastClick && Date.now() - lastClick.at < 15000) return lastClick;
  const row = [...document.querySelectorAll('#treeRoot .trow[data-p]')].find(r => r.dataset.p === dir);
  if (row) { const r = row.getBoundingClientRect(); return { x: r.left + 24, y: r.bottom }; }
  return { x: innerWidth / 2 - 160, y: innerHeight / 4 };
}
function closeQuick() { document.getElementById('nfPop')?.remove(); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#nfPop')) closeQuick(); });
async function quick(dir, typeId) {
  if (!bs.S.project) return toast('Abra um projeto primeiro');
  closeMenu(); closeQuick();
  dir = dir || '';
  const at = anchorFor(dir); lastClick = null;
  // a entrada aparece já (o que for digitado não se perde); o pacote da pasta chega do núcleo logo depois
  const info = pkgOf(dir);
  let base = { dir, pkg: null };
  const inCode = context(dir) === 'code';
  const t0 = typeById(typeId) || TYPES.find(t => t.id === 'file');
  // classe Java: o tipo (classe, interface, enum...) escolhe-se na própria entrada
  const kinds = t0.java ? TYPES.filter(t => t.java) : [t0];
  let sel = Math.max(0, kinds.findIndex(t => t.id === (t0.java ? store.get('newJavaKind', t0.id) : t0.id)));
  const title = t0.java ? 'Nova classe Java' : t0.dir ? (inCode ? 'Novo pacote' : 'Nova pasta') : t0.free ? 'Novo arquivo' : `Novo arquivo ${t0.label}`;
  const el = document.createElement('div'); el.id = 'nfPop'; el.className = 'nf-pop';
  el.innerHTML = `<div class="nf-t"><b>${esc(title)}</b><span title="${esc(dir)}">${esc(dir || bs.S.project.name)}</span></div>
    <div class="nf-in"><input id="nfqName" spellcheck="false" autocomplete="off">${t0.ext && !t0.cls ? `<em>${esc(t0.ext)}</em>` : ''}</div>
    ${kinds.length > 1 ? '<div class="nf-kinds" id="nfqKinds"></div>' : ''}
    <div class="nf-msg" id="nfqMsg"></div>`;
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(at.x, innerWidth - r.width - 8)) + 'px'; el.style.top = Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) + 'px';
  const inp = el.querySelector('#nfqName'), msg = el.querySelector('#nfqMsg');
  inp.placeholder = t0.dir ? (inCode ? 'com.empresa.modulo' : 'pasta/subpasta') : t0.java || t0.cls ? 'NomeDaClasse' : t0.free ? 'nome.ext, Dockerfile, .env…' : 'nome';
  const update = () => {
    const p = plan(kinds[sel], inp.value, base);
    msg.className = 'nf-msg' + (p.error ? ' err' : '');
    msg.textContent = p.error || (p.path ? p.path + (p.pkg != null && (kinds[sel].java || kinds[sel].cls) ? `  ·  package ${p.pkg || '(padrão)'}` : '') : '');
    return p;
  };
  let busy = false;
  const go = async () => {
    if (busy) return;
    await info; const p = update();
    if (!p.path) { msg.className = 'nf-msg err'; msg.textContent = p.error || 'Dê um nome'; return; }
    busy = true;
    try { await make(p); if (t0.java) store.set('newJavaKind', kinds[sel].id); closeQuick(); }
    catch (e) { msg.className = 'nf-msg err'; msg.textContent = e.message; busy = false; inp.focus(); }
  };
  const paint = () => {
    const box = el.querySelector('#nfqKinds');
    if (box) {
      box.innerHTML = kinds.map((t, i) => `<div class="nf-it ${i === sel ? 'on' : ''}" data-i="${i}">${typeIcon(t)}<span>${esc(t.label)}</span></div>`).join('');
      box.querySelectorAll('.nf-it').forEach(x => { x.onmousedown = (e) => e.preventDefault(); x.onclick = () => { sel = +x.dataset.i; paint(); }; x.ondblclick = go; });
    }
    update();
  };
  inp.oninput = update;
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQuick(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && kinds.length > 1) { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : kinds.length - 1)) % kinds.length; paint(); }
  };
  paint(); inp.focus();
  info.then((i) => {
    base = { dir, ...i };
    if (base.pkg != null) el.querySelector('.nf-t span').textContent = base.pkg || 'pacote padrão';
    if (el.isConnected) update();
  });
}

// pasta de destino: a pasta clicada, a pasta do arquivo clicado, a seleção da árvore ou a pasta da aba aberta
function targetDir() {
  const S = bs.S;
  if (document.activeElement && document.activeElement.closest('#treeRoot') && S.treeSel != null) {
    const r = (S.treeRowsCache || []).find(x => x.p === S.treeSel);
    return r && r.dir ? S.treeSel : dirOf(S.treeSel);
  }
  if (S.active && S.active.project === S.project?.path && S.active.mode === 'editor') return dirOf(S.active.path);
  if (S.treeSel != null) { const r = (S.treeRowsCache || []).find(x => x.p === S.treeSel); return r && r.dir ? S.treeSel : dirOf(S.treeSel); }
  return '';
}
// que tipo de pasta é (pelo que a árvore já sabe): 'code' (source root ou pacote), 'res', 'web' ou ''
function context(dir) {
  const rows = bs.S.treeRowsCache || [];
  for (let d = dir; ; d = dirOf(d)) {
    const k = rows.find(x => x.p === d)?.it?.kind;
    if (k === 'src' || k === 'test' || k === 'package') return 'code';
    if (k === 'res' || k === 'testres') return 'res';
    if (k === 'web') return 'web';
    if (!d) return '';
  }
}
// ---------- recomendados: as extensões que existem no projeto ----------
// Qualquer extensão vira um tipo (".tsx", ".vue", ".go"...): as da própria pasta vêm primeiro, depois as mais usadas
// no projeto todo (pelo índice do Buscar em tudo). As que têm modelo pronto (TYPES) usam o modelo; as outras nascem vazias.
const EXT_TYPE = { htm: 'html', mjs: 'js', cjs: 'js', yaml: 'yaml', yml: 'yaml', kt: 'kotlin', java: 'java-class' };
const EXT_LABEL = { tsx: 'React (TSX)', jsx: 'React (JSX)', ts: 'TypeScript', js: 'JavaScript', mjs: 'JavaScript (módulo)', vue: 'Vue', svelte: 'Svelte', scss: 'Sass', less: 'Less', py: 'Python', go: 'Go', rs: 'Rust', cs: 'C#', cpp: 'C++', c: 'C', h: 'Cabeçalho C', php: 'PHP', rb: 'Ruby', kts: 'Kotlin script', gradle: 'Gradle', groovy: 'Groovy', scala: 'Scala', dart: 'Dart', swift: 'Swift', lua: 'Lua', ps1: 'PowerShell', bat: 'Batch', cmd: 'Batch', toml: 'TOML', ini: 'INI', env: 'Env', txt: 'Texto', csv: 'CSV', graphql: 'GraphQL', gql: 'GraphQL', prisma: 'Prisma', proto: 'Protobuf', tf: 'Terraform', svg: 'SVG', mdx: 'MDX' };
const pascal = (s) => s.replace(/(^|[-_.\s]+)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^\w$]/g, '') || 'Componente';
const EXT_BODY = {
  tsx: (n) => `export default function ${pascal(n)}() {\n  return (\n    <div></div>\n  );\n}\n`,
  jsx: (n) => `export default function ${pascal(n)}() {\n  return (\n    <div></div>\n  );\n}\n`,
  vue: () => '<script setup>\n</script>\n\n<template>\n  <div></div>\n</template>\n',
  svelte: () => '<script>\n</script>\n\n<div></div>\n',
};
// binários, gerados e afins não são coisas que se cria por aqui
const SKIP_EXT = /^(png|jpe?g|gif|ico|webp|bmp|avif|pdf|jar|war|ear|zip|gz|tgz|7z|rar|tar|class|exe|dll|so|dylib|o|obj|pdb|lib|woff2?|ttf|eot|otf|mp[34]|wav|ogg|avi|mov|webm|xlsx?|docx?|pptx?|lock|map|log|tsbuildinfo|snap|pyc|min|bak|tmp|swp|db|sqlite)$/i;
const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
function typeForExt(ext) {
  const id = EXT_TYPE[ext]; if (id) return TYPES.find(t => t.id === id);
  return TYPES.find(t => t.ext === '.' + ext) || { id: 'ext:' + ext, label: EXT_LABEL[ext] || ext.toUpperCase(), ext: '.' + ext, body: EXT_BODY[ext] || (() => '') };
}
const typeById = (id) => id && id.startsWith('ext:') ? typeForExt(id.slice(4)) : TYPES.find(t => t.id === id);
// contagem de extensões do projeto, refeita só quando o índice muda
let extCount = { index: null, list: [] };
function projectExts() {
  if (typeof SE === 'undefined') return [];
  if (!SE.index || SE.indexFor !== bs.S.project?.path) { seIndex(); return extCount.list; }
  if (extCount.index !== SE.index) {
    const n = {};
    for (const f of SE.index) { const e = extOf(f.p.slice(f.p.lastIndexOf('/') + 1)); if (e && !SKIP_EXT.test(e)) n[e] = (n[e] || 0) + 1; }
    extCount = { index: SE.index, list: Object.keys(n).sort((a, b) => n[b] - n[a]) };
  }
  return extCount.list;
}
const CTX_EXTS = { code: [], res: ['properties', 'xml', 'yml'], web: ['jsp', 'html', 'css', 'js'], '': ['md', 'json'] };
function recommend(dir, ctx) {
  const n = {};
  for (const it of bs.S.tree[dir] || []) { const e = !it.dir && extOf(it.name); if (e && !SKIP_EXT.test(e)) n[e] = (n[e] || 0) + 1; }
  const here = Object.keys(n).sort((a, b) => n[b] - n[a]);
  // no código Java a "Classe Java" já está no topo do menu
  const exts = [...new Set([...here, ...projectExts(), ...CTX_EXTS[ctx]])].filter(e => !(ctx === 'code' && e === 'java'));
  // extensões diferentes com o mesmo tipo (yml/yaml, htm/html) aparecem uma vez só
  const seen = new Set(); const out = [];
  for (const e of exts) { const t = typeForExt(e); if (seen.has(t.id)) continue; seen.add(t.id); out.push(t); if (out.length >= 8) break; }
  return out;
}
// o submenu "Novo ›": recomendados primeiro, "Arquivo" (nome livre, sem extensão amarrada) e "Outros…" com todos os tipos
function newItems(dir) {
  const ctx = context(dir); const T = (id) => TYPES.find(t => t.id === id);
  pkgOf(dir); // já busca o pacote da pasta enquanto o menu está aberto
  const item = (t, label, k) => ({ label: label || t.label, icon: typeIcon(t), k: k != null ? k : t.ext || '', action: () => quick(dir, t.id) });
  const recs = recommend(dir, ctx).map(t => item(t));
  return [
    ...(ctx === 'code' ? [item(T('java-class'), 'Classe Java', '.java')] : []),
    item(T('file'), 'Arquivo', 'qualquer nome'),
    item(T('dir'), ctx === 'code' ? 'Pacote' : 'Pasta', ''),
    ...(recs.length ? ['-', ...recs] : []),
    '-',
    { label: 'Outros…', icon: I.newp, action: () => open(dir) },
  ];
}
const newEntry = (dir) => ({ label: 'Novo', icon: I.newp, sub: newItems(dir) });

bs.hooks.filter('menu:file', (items, { rel, isDir }) => [newEntry(isDir ? rel : dirOf(rel)), '-', ...items]);
bs.hooks.filter('menu:project', (items, p) => bs.S.project && p && p.path === bs.S.project.path ? [newEntry(''), '-', ...items] : items);
// Alt+Insert: o mesmo menu "Novo", aberto na pasta da seleção (ou do arquivo aberto)
bs.keys.add('Alt+Insert', () => {
  if (!bs.S.project) return false;
  const dir = targetDir(); const a = anchorFor(dir); lastClick = null;
  showMenu({ preventDefault() {}, stopPropagation() {}, clientX: a.x, clientY: a.y }, newItems(dir), 'Novo · ' + (dir || bs.S.project.name));
});
bs.actions.add([
  { label: 'Novo arquivo…', icon: I.newp, run: () => quick(targetDir(), 'file') },
  { label: 'Nova classe Java…', icon: I.newp, run: () => quick(targetDir(), 'java-class') },
  { label: 'Nova pasta / pacote…', icon: I.newp, run: () => quick(targetDir(), 'dir') },
  { label: 'Novo (todos os tipos)…', icon: I.newp, run: () => open(targetDir()) },
]);

// ---------- pacote errado: erro no editor + correções no Alt+Enter ----------
const OWNER = 'bs-pkg';
const isJvm = (p) => /\.(java|kt)$/i.test(p);
// comentários e textos viram espaços (as posições continuam as mesmas) para achar o "package" de verdade
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"/g, m => m.replace(/[^\n]/g, ' '));
const DECL = /^[ \t]*package\s+([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*;?/m;
async function check(tab) {
  const monaco = bs.monaco;
  if (!monaco || !tab.model || tab.model.isDisposed() || tab.mode !== 'editor' || !isJvm(tab.path)) return;
  const info = await pkgOf(dirOf(tab.path), tab.project);
  if (tab.model.isDisposed()) return;
  tab.pkgInfo = info;
  if (info.pkg == null) { monaco.editor.setModelMarkers(tab.model, OWNER, []); return; }
  const kotlin = /\.kt$/i.test(tab.path);
  const text = tab.model.getValue(); const m = DECL.exec(blank(text));
  const declared = m ? m[1].replace(/\s+/g, '') : '';
  const want = info.pkg;
  let marker = null;
  const sev = kotlin ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error;
  if (m && declared !== want) {
    const s = tab.model.getPositionAt(m.index + m[0].indexOf(m[1])), e = tab.model.getPositionAt(m.index + m[0].indexOf(m[1]) + m[1].length);
    marker = { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column,
      message: want ? `O pacote "${declared}" não corresponde ao caminho do arquivo ("${want}")` : `O pacote "${declared}" não corresponde ao caminho do arquivo (ele está no pacote padrão)` };
  } else if (!m && want && !kotlin) {
    // sem declaração: marca a primeira linha com código (ou a primeira linha)
    const lines = text.split('\n'); const b = blank(text).split('\n');
    const i = Math.max(0, b.findIndex(l => l.trim()));
    marker = { startLineNumber: i + 1, startColumn: 1, endLineNumber: i + 1, endColumn: (lines[i] || '').length + 1, message: `Falta a declaração de pacote: "${want}"` };
  }
  monaco.editor.setModelMarkers(tab.model, OWNER, marker ? [{ ...marker, severity: sev, source: 'BlueScreen', code: 'package' }] : []);
  tab.pkgDecl = m ? { declared, index: m.index, length: m[0].length } : null;
}
const soon = new WeakMap();
function checkSoon(tab, ms = 350) { clearTimeout(soon.get(tab)); soon.set(tab, setTimeout(() => check(tab), ms)); }

bs.hooks.on('tab:open', (tab) => {
  if (tab.mode !== 'editor' || !isJvm(tab.path) || !tab.model) return;
  tab.model.onDidChangeContent(() => checkSoon(tab));
  checkSoon(tab, 0);
});

function fixes(model) {
  const tab = model._tab; if (!tab || !tab.pkgInfo || tab.pkgInfo.pkg == null) return [];
  const want = tab.pkgInfo.pkg; const d = tab.pkgDecl; const out = [];
  const edit = (title, range, text, preferred) => out.push({ title, kind: 'quickfix', isPreferred: preferred, edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range, text } }] } });
  if (d) {
    const s = model.getPositionAt(d.index), e = model.getPositionAt(d.index + d.length);
    const range = { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column };
    if (d.declared) out.push({ title: `Mover para o pacote "${d.declared}"`, kind: 'quickfix', isPreferred: true, command: { id: 'bs.pkg.move', title: 'Mover', arguments: [tab.key, d.declared] } });
    if (want) edit(`Mudar a declaração para "package ${want}"`, range, `package ${want}${/\.kt$/i.test(tab.path) ? '' : ';'}`);
    else {
      // tira a linha inteira (e a linha em branco depois dela)
      const next = model.getLineCount() > e.lineNumber && !model.getLineContent(e.lineNumber + 1).trim() ? e.lineNumber + 2 : e.lineNumber + 1;
      edit('Remover a declaração de pacote', { startLineNumber: s.lineNumber, startColumn: 1, endLineNumber: next, endColumn: 1 }, '');
    }
  } else if (want) {
    edit(`Adicionar "package ${want};"`, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, `package ${want};\n\n`, true);
    out.push({ title: 'Mover para o pacote padrão', kind: 'quickfix', command: { id: 'bs.pkg.move', title: 'Mover', arguments: [tab.key, ''] } });
  }
  return out;
}

// move o arquivo da aba para root/pacote, mantendo cursor e rolagem; salva antes se tiver alteração
async function moveToPackage(key, pkg) {
  const S = bs.S; const tab = S.tabs.find(t => t.key === key); if (!tab) return;
  const info = tab.pkgInfo || await pkgOf(dirOf(tab.path), tab.project);
  if (!info.root) return toast('Este arquivo não está num source root');
  if (tab.project !== S.project?.path) return toast('O arquivo é de outro projeto');
  if (tab.dirty) { await saveTab(tab); if (tab.dirty) return toast('Salve o arquivo antes de mover'); }
  const to = joinRel(info.root, ...(pkg ? pkg.split('.') : []), tab.path.split('/').pop());
  if (to === tab.path) return;
  try { await api('file/move', { project: tab.project }, { method: 'POST', body: JSON.stringify({ from: tab.path, to }) }); }
  catch (e) { return toast('Não foi possível mover: ' + e.message, 'err'); }
  const view = S.active === tab && bs.editor ? bs.editor.saveViewState() : null;
  const from = tab.path;
  // a aba agora aponta para o caminho novo (sem salvar de novo: o conteúdo já está gravado)
  tab.dirty = false; closeTab(tab);
  for (const k of Object.keys(S.tree)) if (from.startsWith(k + '/') || !k) delete S.tree[k];
  await created(to, false);
  await openFile(to, 'editor');
  if (view && bs.editor) bs.editor.restoreViewState(view);
  if (bs.S.active && bs.S.active.path === to) runLint(bs.S.active, 'auto'); // o painel Problemas passa a falar do caminho novo
  toast(`Movido para ${pkg ? 'o pacote ' + pkg : 'o pacote padrão'}`, 'ok');
}

let wired = false;
function wire() {
  const monaco = bs.monaco; if (!monaco || wired) return; wired = true;
  monaco.editor.registerCommand('bs.pkg.move', (_, key, pkg) => moveToPackage(key, pkg));
  for (const lang of ['java', 'kotlin']) {
    monaco.languages.registerCodeActionProvider(lang, {
      provideCodeActions: (model, range, ctx) => {
        if (!ctx.markers.some(m => m.owner === OWNER)) return { actions: [], dispose() {} };
        const actions = fixes(model).map(a => ({ ...a, diagnostics: ctx.markers.filter(m => m.owner === OWNER) }));
        return { actions, dispose() {} };
      },
    }, { providedCodeActionKinds: ['quickfix'] });
  }
}
bs.hooks.on('editor:ready', wire);
if (bs.editor) wire(); // o editor pode ter nascido antes deste arquivo carregar

bs.newFile = { open, quick, items: newItems, check };
})(window.BS);
