// Runtimes e execução (parte da página). A lógica fica no servidor do plugin (runtimes/*):
// - ▶ na margem de cada main (public static void main, fun main, if __name__ == "__main__", func main, fn main...).
//   Clique: menu com Executar, Executar com argumentos, Depurar e Copiar comando. Ctrl+Shift+F10 executa o main mais
//   perto do cursor. A execução usa o console do Build (com entrada para o programa).
// - Aviso em cima do editor quando falta o runtime da linguagem (ou a versão que o projeto pede): baixar pela IDE,
//   escolher outra versão, apontar uma pasta já instalada, instalar com winget/scoop ou abrir a página oficial.
// - Janela "Runtimes do projeto" (status bar, Buscar em tudo e resumo do projeto): cada linguagem do projeto e o que
//   ela precisa, com as mesmas ações.
const { S, api, esc, toast, store } = bs;
if (S.remote) return; // pela rede local não se executa nada nem se instala nada no PC

const ICO = {
  play: '<svg class="i" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  args: '<svg class="i" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/><path d="M3 20h8" /></svg>',
  bug: '<svg class="i" viewBox="0 0 24 24"><path d="M8 8h8v8a4 4 0 0 1-8 0zM9 8a3 3 0 0 1 6 0M4 12h4M16 12h4M5 7l3 2M19 7l-3 2M5 18l3-2M19 18l-3-2"/></svg>',
  copy: bs.I.copy,
  rt: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M10 8.5v5l4-2.5zM8 21h8"/></svg>',
  dl: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  folder: '<svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  term: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg>',
  ext: bs.I.ext,
  warn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3 2 20h20zM12 10v4M12 17v.5"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  x: bs.I.x,
  refresh: bs.I.refresh,
};
// extensões que o plugin conhece (as mesmas do catálogo do servidor, langs.rs)
const EXTS = new Set('java kt kts scala sc groovy gvy clj cljc py pyw js mjs cjs jsx ts mts cts tsx go rs cs csx fs fsx vb c cpp cc cxx c++ zig rb php pl pm lua r jl dart swift ex exs erl hs nim ml d sh bash tex'.split(' '));
// linguagens em que o depurador da IDE (Shift+F9) funciona
const DEBUG = new Set(['python', 'go', 'rust', 'c', 'cpp', 'csharp']);
const extOf = (p) => String(p || '').toLowerCase().split('/').pop().split('.').slice(1).pop() || '';
const known = (t) => t && t.mode === 'editor' && t.model && EXTS.has(extOf(t.path));
const LEFT = () => bs.monaco.editor.GlyphMarginLane.Left;

// ---------- ▶ na margem ----------
const timers = new WeakMap();
function scanSoon(tab, ms = 450) {
  if (!known(tab)) return;
  clearTimeout(timers.get(tab));
  timers.set(tab, setTimeout(() => scan(tab), ms));
}
async function scan(tab) {
  if (!known(tab) || tab.model.isDisposed()) return;
  const ver = tab.model.getVersionId();
  let r; try { r = await api('runtimes/entries', {}, { method: 'POST', body: JSON.stringify({ file: tab.path, text: tab.model.getValue() }) }); } catch { return; }
  if (tab.model.isDisposed() || tab.model.getVersionId() !== ver) return; // mudou enquanto perguntava: a próxima varredura vale
  const rt = tab._rt = tab._rt || { entries: [], decos: [] };
  rt.entries = r.entries || []; rt.lang = r.lang;
  const monaco = bs.monaco;
  rt.decos = tab.model.deltaDecorations(rt.decos, rt.entries.map(en => ({
    range: new monaco.Range(en.line, 1, en.line, 1),
    options: { glyphMarginClassName: 'rt-run', glyphMargin: { position: LEFT() }, glyphMarginHoverMessage: { value: `**Executar** \`${en.label}\` · Ctrl+Shift+F10  \nClique para mais opções` }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
  })));
  if (S.active === tab && ctxKey) ctxKey.set(rt.entries.length > 0);
}
const entriesOf = (t) => (t && t._rt && t._rt.entries) || [];
// o main da linha do cursor, ou o último acima dela, ou o primeiro
function nearest(list, line) { return list.find(e => e.line === line) || [...list].reverse().find(e => e.line <= line) || list[0] || null; }
const argKey = (t, en) => t.project + '|' + t.path + '|' + (en ? en.target || en.label : '');

let ctxKey = null;
bs.hooks.on('editor:ready', (ed) => {
  const monaco = bs.monaco;
  ctxKey = ed.createContextKey('bsHasMain', false);
  const GM = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
  ed.onMouseDown((e) => {
    if (e.target.type !== GM || !e.event.leftButton) return;
    const t = S.active; if (!t || !e.target.position) return;
    const onRun = (e.target.element && e.target.element.classList && e.target.element.classList.contains('rt-run')) || (e.target.detail && e.target.detail.glyphMarginLane === LEFT());
    if (!onRun) return;
    const en = entriesOf(t).find(x => x.line === e.target.position.lineNumber); if (!en) return;
    const be = e.event.browserEvent;
    // depois do mousedown do documento (que fecha os menus abertos)
    setTimeout(() => menu({ preventDefault() {}, stopPropagation() {}, clientX: be.clientX + 6, clientY: be.clientY + 4 }, t, en), 0);
  });
  ed.onDidChangeModelContent(() => { const t = S.active; if (t && t.model === ed.getModel()) scanSoon(t); });
  ed.addAction({ id: 'bs.runtimes.run', label: 'Executar o main', precondition: 'bsHasMain', contextMenuGroupId: 'navigation', contextMenuOrder: 2,
    run: () => runAtCursor() });
});
bs.hooks.on('tab:open', (t) => scanSoon(t, 50));
bs.hooks.on('tab:activate', (t) => { if (ctxKey) ctxKey.set(entriesOf(t).length > 0); if (known(t) && !t._rt) scanSoon(t, 0); checkSoon(t); });
bs.hooks.on('tab:save', (t) => scanSoon(t, 0));

function menu(ev, t, en) {
  const items = [
    { label: `Executar '${en.label}'`, k: 'Ctrl+Shift+F10', icon: ICO.play, action: () => run(t, en) },
    { label: 'Executar com argumentos…', icon: ICO.args, action: () => askArgs(t, en) },
  ];
  if (bs.debug && DEBUG.has(t.lang)) items.push({ label: `Depurar '${en.label}'`, k: 'Shift+F9', icon: ICO.bug, action: async () => { if (t.dirty) await bs.save(); bs.debug.start(t); } });
  items.push('-', { label: 'Copiar o comando', icon: ICO.copy, action: () => copyCommand(t, en) });
  bs.showMenu(ev, items, en.label);
}

// ---------- executar ----------
async function run(t, en, args) {
  if (!S.project || !t) return;
  if (args == null) args = store.get('rtArgs', {})[argKey(t, en)] || '';
  if (t.dirty && S.active === t) await bs.save();
  let r;
  try { r = await api('runtimes/plan', {}, { method: 'POST', body: JSON.stringify({ project: t.project, file: t.path, line: en ? en.line : 0, args }) }); }
  catch (e) { toast(e.message); return; }
  if (r.missing) { needDialog(r, () => run(t, en, args)); return; }
  if (r.fallback || !r.plan) { if (bs.build && bs.build.runFile) bs.build.runFile(); return; }
  if (!bs.build || !bs.build.runSteps) { toast('O console de Build não está disponível'); return; }
  await bs.build.runSteps({ title: r.plan.title, steps: r.plan.steps, jdk: r.plan.jdk });
}
function runAtCursor() {
  const t = S.active; if (!t) return;
  const line = (bs.editor && bs.editor.getPosition() && bs.editor.getPosition().lineNumber) || 1;
  return run(t, nearest(entriesOf(t), line));
}
async function copyCommand(t, en) {
  try {
    const r = await api('runtimes/plan', {}, { method: 'POST', body: JSON.stringify({ project: t.project, file: t.path, line: en.line, args: store.get('rtArgs', {})[argKey(t, en)] || '' }) });
    if (!r.plan) return toast(r.missing ? 'Falta instalar: ' + r.missing.map(m => m.name).join(', ') : 'Sem comando próprio: o arquivo roda pela extensão (Ctrl+Shift+F10)');
    const q = (a) => /[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a;
    bs.copyText(r.plan.steps.map(s => (s.kind === 'maven' ? 'mvn' : q(s.program)) + ' ' + s.args.map(q).join(' ')).join('\n'));
  } catch (e) { toast(e.message); }
}
function askArgs(t, en) {
  const all = store.get('rtArgs', {}); const cur = all[argKey(t, en)] || '';
  dialog('rtArgsDlg', `<div class="dlg-hd"><span class="dlg-ic">${ICO.args}</span><div><h3>Executar ${esc(en.label)}</h3><p>Argumentos do programa (ficam guardados para as próximas execuções deste main).</p></div></div>
    <form class="rt-args" id="rtArgsF"><input id="rtArgsIn" value="${esc(cur)}" placeholder='ex.: entrada.txt --verbose "com espaço"' spellcheck="false" autocomplete="off">
    <div class="rt-dlg-go"><button type="button" class="chip" data-close>Cancelar</button><button class="chip primary">${ICO.play}Executar</button></div></form>`,
    (el) => {
      const inp = el.querySelector('#rtArgsIn'); setTimeout(() => { inp.focus(); inp.select(); }, 30);
      el.querySelector('#rtArgsF').onsubmit = (e) => {
        e.preventDefault(); const v = inp.value.trim(); const a = store.get('rtArgs', {});
        if (v) a[argKey(t, en)] = v; else delete a[argKey(t, en)];
        store.set('rtArgs', a); el.hidden = true; run(t, en, v);
      };
    });
}
// Ctrl+Shift+F10: o main mais perto do cursor; arquivo sem main nem runtime faltando segue o "Executar arquivo" do núcleo
const prevRun = bs.keys.map.get('Ctrl+Shift+F10');
bs.keys.add('Ctrl+Shift+F10', () => {
  const t = S.active;
  if (known(t) && S.project && t.project === S.project.path) { runAtCursor(); return; }
  return prevRun ? prevRun() : false;
});

// ---------- o que falta instalar ----------
const CHECK = new Map(); // projeto|linguagem -> { at, r }
const dismissed = () => new Set(store.get('rtDismiss', []));
const dkey = (n) => (S.project ? S.project.path : '') + '|' + n.id;
let checkTimer = null;
function checkSoon(t) { clearTimeout(checkTimer); checkTimer = setTimeout(() => check(t), 250); }
async function check(t, fresh) {
  t = t || S.active;
  if (!known(t) || !S.project || t.project !== S.project.path) { banner(null); status(null); return; }
  const k = t.project + '|' + extOf(t.path);
  let c = CHECK.get(k);
  if (!c || fresh || Date.now() - c.at > 60e3) {
    try { c = { at: Date.now(), r: await api('runtimes/check', { project: t.project, file: t.path }) }; CHECK.set(k, c); } catch { return; }
  }
  if (S.active !== t) return;
  status(c.r);
  const nv = dismissed();
  banner(c.r.lang ? { ...c.r, needs: c.r.needs.filter(n => !n.ok && !nv.has(dkey(n))) } : null);
}
function recheckAll() { CHECK.clear(); return api('runtimes/forget', {}, { method: 'POST' }).catch(() => {}).then(() => { check(S.active, true); if (!$dlg().hidden) renderDialog(); }); }
bs.hooks.on('sdk:installed', () => recheckAll());
bs.hooks.on('project:select', () => { CHECK.clear(); banner(null); status(null); });

// texto do problema de um requisito
function problem(n, langName) {
  if (n.status === 'old') return { title: `${n.name} ${n.need ? n.need.version + ' ou mais novo' : 'mais novo'}`, text: `${n.need ? `O projeto pede ${esc(n.name)} ${esc(n.need.version)} (${esc(n.need.source)})` : 'Versão antiga'}, mas o encontrado é o ${esc(n.version || '?')}.` };
  const why = [langName ? `Necessário para compilar e executar ${esc(langName)}` : 'Necessário', n.need ? ` (o projeto pede ${esc(n.need.version)}, em ${esc(n.need.source)})` : ''].join('');
  return { title: `${n.name} não encontrado`, text: `${why}.${n.alts && n.alts.length ? ` Também serve: ${n.alts.map(esc).join(', ')}.` : ''}` };
}
const sdkLabel = (n) => {
  const nm = bs.sdk ? bs.sdk.name(n.sdk) : n.sdk;
  if (n.sdk === 'zig' && n.id !== 'zig') return 'Baixar Zig (compila C/C++)';
  return `Baixar ${n.id === 'jdk' ? 'JDK' : nm}${n.need ? ' ' + n.need.version : ''}`;
};
// botões das ações de um requisito
function actions(n, pm) {
  const b = [];
  if (n.sdk && bs.sdk) {
    b.push(`<button class="chip primary" data-a="dl">${ICO.dl}<span>${esc(sdkLabel(n))}</span></button>`);
    b.push(`<button class="chip" data-a="versions" title="Escolher fornecedor e versão">Outras versões…</button>`);
  }
  b.push(`<button class="chip" data-a="pick" title="Apontar a pasta de uma instalação que já existe">${ICO.folder}<span>Já tenho instalado…</span></button>`);
  if (n.winget && (!pm || pm.winget)) b.push(`<button class="chip" data-a="winget" title="winget install --id ${esc(n.winget)}">${ICO.term}<span>winget</span></button>`);
  if (n.scoop && pm && pm.scoop) b.push(`<button class="chip" data-a="scoop" title="scoop install ${esc(n.scoop)}">${ICO.term}<span>scoop</span></button>`);
  b.push(`<a class="chip" href="${esc(n.url)}" target="_blank" rel="noopener" title="${esc(n.url)}">${ICO.ext}<span>Página oficial</span></a>`);
  return b.join('');
}
// liga os botões de um bloco às ações; onDone depois de instalar/apontar
function bindActions(el, n, onDone) {
  const prog = el.querySelector('.rt-prog'), step = prog && prog.querySelector('.rt-step'), fill = prog && prog.querySelector('i');
  const busy = (on) => el.querySelectorAll('button').forEach(x => { if (x.dataset.a) x.disabled = on; });
  const show = (j) => { if (!prog) return; prog.hidden = false; prog.classList.toggle('indet', j.progress == null); if (fill) fill.style.width = j.progress == null ? '' : Math.round(j.progress * 100) + '%'; if (j.step && step) step.textContent = j.step; };
  el.querySelectorAll('[data-a]').forEach(btn => btn.onclick = async () => {
    const a = btn.dataset.a;
    if (a === 'versions') return bs.sdk.open(n.sdk);
    if (a === 'winget' || a === 'scoop') {
      const cmd = a === 'winget' ? `winget install --id ${n.winget} -e --accept-source-agreements --accept-package-agreements` : `scoop install ${n.scoop}`;
      try { await bs.terminal.run(cmd); toast('Instalando no terminal. Quando terminar, clique em "Verificar de novo".'); el.classList.add('rt-waiting'); } catch (e) { toast('Terminal: ' + e.message); }
      return;
    }
    if (a === 'pick') {
      let r; try { r = await api('project/pick', { title: `Pasta do ${n.name}`, start: n.path ? n.path.replace(/[\\/][^\\/]*$/, '') : null }); } catch (e) { return toast(e.message); }
      if (!r || !r.path) return;
      busy(true);
      try {
        const s = await api('runtimes/select', {}, { method: 'POST', body: JSON.stringify({ tool: n.id, path: r.path }) });
        toast(`${n.name}${s.version ? ' ' + s.version : ''}: ${s.path}`, 'ok');
        bs.hooks.run('sdk:installed', n.sdk || n.id);
        if (bs.lsp && bs.lsp.refresh) bs.lsp.refresh().catch(() => {});
        onDone && onDone();
      } catch (e) { toast(e.message); }
      busy(false);
      return;
    }
    if (a === 'dl') {
      busy(true); show({ step: 'Procurando a versão…' });
      const min = n.need ? (n.id === 'jdk' ? parseInt(n.need.version, 10) : parseFloat(n.need.version)) : undefined;
      try {
        const p = await bs.sdk.quick(n.sdk, { min: isNaN(min) ? undefined : min, onStep: show });
        toast(`${bs.sdk.name(n.sdk)} ${p.vendor_name ? p.vendor_name + ' ' : ''}${p.version} instalado`, 'ok');
        // um JDK baixado só vira o padrão quando escolhido: aqui ele foi pedido para este projeto, então vira
        if (n.sdk === 'jdk') { try { const k = await api('sdk/list'); const j = k.kinds.find(x => x.id === 'jdk'); const it = j && j.installed.find(x => x.path.toLowerCase().endsWith(p.dir.toLowerCase())); if (it) await api('sdk/default', { kind: 'jdk', path: it.path }, { method: 'POST' }); } catch {} }
        onDone && onDone();
      } catch (e) { show({ step: e.message, progress: null }); if (prog) prog.classList.add('err'); }
      busy(false);
    }
  });
}

// aviso no canto de cima do editor (como o de "mudou fora da IDE")
const ban = document.createElement('div'); ban.id = 'rtBanner'; ban.hidden = true; ban.setAttribute('role', 'alert');
document.getElementById('mon').appendChild(ban);
function banner(r) {
  if (!r || !r.needs || !r.needs.length) { ban.hidden = true; ban.innerHTML = ''; return; }
  const n = r.needs[0];
  const p = problem(n, r.name);
  ban.className = n.status === 'old' ? 'old' : '';
  ban.innerHTML = `<span class="rt-bi">${ICO.warn}</span>
    <div class="rt-bt"><b>${esc(p.title)}</b><span>${p.text}${r.needs.length > 1 ? ` <a data-more>e mais ${r.needs.length - 1}</a>` : ''}</span>
      <div class="rt-prog" hidden><div class="rt-bar"><i></i></div><span class="rt-step"></span></div></div>
    <div class="rt-ba">${actions(n, r.pm)}<button class="chip" data-recheck title="Depois de instalar por fora">${ICO.refresh}<span>Verificar de novo</span></button>
    <button class="icon-btn" data-dismiss title="Não avisar neste projeto">${ICO.x}</button></div>`;
  ban.hidden = false;
  bindActions(ban, n, () => recheckAll());
  ban.querySelector('[data-recheck]').onclick = () => recheckAll();
  ban.querySelector('[data-more]')?.addEventListener('click', () => openDialog());
  ban.querySelector('[data-dismiss]').onclick = () => { const d = dismissed(); r.needs.forEach(x => d.add(dkey(x))); store.set('rtDismiss', [...d]); banner(null); toast('Sem aviso neste projeto. Os runtimes continuam na status bar.'); };
}
// janela quando se tenta executar sem o runtime
function needDialog(r, retry) {
  const rows = r.missing.map((n, i) => { const p = problem(n, r.name); return `<div class="rt-need" data-i="${i}"><div class="rt-nt"><span class="rt-st ${n.status}">${ICO.warn}</span><div><b>${esc(p.title)}</b><span>${p.text}</span>${n.note ? `<small>${esc(n.note)}</small>` : ''}</div></div>
    <div class="rt-na">${actions(n, r.pm)}</div><div class="rt-prog" hidden><div class="rt-bar"><i></i></div><span class="rt-step"></span></div></div>`; }).join('');
  const el = dialog('rtNeedDlg', `<div class="dlg-hd"><span class="dlg-ic">${ICO.rt}</span><div><h3>Falta instalar para executar ${esc(r.name || '')}</h3><p>Baixe pela IDE (sem instalador e sem administrador), escolha outra versão ou aponte uma instalação que já existe.</p></div></div>
    <div class="rt-needs">${rows}</div><div class="rt-dlg-go"><button class="chip" data-close>Fechar</button><button class="chip" id="rtRe">${ICO.refresh}Verificar de novo</button><button class="chip primary" id="rtRetry">${ICO.play}Executar</button></div>`);
  r.missing.forEach((n, i) => bindActions(el.querySelector(`.rt-need[data-i="${i}"]`), n, () => { el.querySelector(`.rt-need[data-i="${i}"]`).classList.add('done'); recheckAll(); }));
  el.querySelector('#rtRe').onclick = () => recheckAll().then(() => toast('Verificado'));
  el.querySelector('#rtRetry').onclick = async () => { el.hidden = true; await api('runtimes/forget', {}, { method: 'POST' }).catch(() => {}); retry(); };
}

// ---------- status bar e janela do projeto ----------
const st = bs.status.add({ id: 'stRt', title: 'Runtime da linguagem (clique: runtimes do projeto)', onclick: () => openDialog() });
function status(r) {
  if (!r || !r.lang || !r.needs || !r.needs.length) { st.hidden = true; return; }
  const bad = r.needs.find(n => !n.ok);
  const main = bad || r.needs[0];
  st.hidden = false;
  st.className = 's rt-s' + (bad ? ' bad' : '');
  const ver = main.version ? ' ' + main.version : '';
  st.innerHTML = bad ? `${ICO.warn}<span>${esc(bad.status === 'old' ? `${bad.name}${ver} (pede ${bad.need ? bad.need.version : '?'})` : 'sem ' + bad.name)}</span>` : `<span>${esc(main.name.replace(/ \(JDK\)$/, '') + ver)}</span>`;
  st.title = r.needs.map(n => `${n.name}: ${n.ok ? (n.version || 'ok') + (n.path ? ' · ' + n.path : '') : n.status === 'old' ? 'versão antiga' : 'não encontrado'}`).join('\n') + '\n\nClique: runtimes do projeto';
}
const $dlg = () => document.getElementById('rtDlg') || { hidden: true };
function openDialog() {
  if (!S.project) return toast('Abra um projeto');
  dialog('rtDlg', `<div class="dlg-hd"><span class="dlg-ic">${ICO.rt}</span><div><h3>Runtimes do projeto</h3><p>O que cada linguagem de ${esc(S.project.name)} precisa para compilar e executar, e a versão que o projeto pede.</p></div></div>
    <div class="rt-list" id="rtList"><div class="empty"><span class="spin"></span> Procurando as linguagens…</div></div>
    <div class="rt-dlg-go"><button class="chip" id="rtSdks">SDKs e runtimes…</button><span class="spacer"></span><button class="chip" id="rtRe2">${ICO.refresh}Verificar de novo</button><button class="chip primary" data-close>Fechar</button></div>`,
    (el) => { el.querySelector('.dlg-box').classList.add('rt-box'); el.querySelector('#rtRe2').onclick = () => recheckAll(); el.querySelector('#rtSdks').onclick = () => bs.sdk && bs.sdk.open(); });
  renderDialog();
}
async function renderDialog() {
  const box = document.getElementById('rtList'); if (!box || !S.project) return;
  let r; try { r = await api('runtimes/project', { project: S.project.path }); } catch (e) { box.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; return; }
  if (!r.langs.length) { box.innerHTML = '<div class="empty">Nenhum código de linguagem conhecida neste projeto.</div>'; return; }
  const rows = [];
  r.langs.forEach((l, li) => l.needs.forEach((n, ni) => rows.push({ l, n, key: li + '-' + ni })));
  box.innerHTML = r.langs.map((l, li) => `<div class="rt-lang"><div class="rt-lh"><b>${esc(l.name)}</b><span>${l.files} arquivo${l.files === 1 ? '' : 's'}</span></div>
    ${l.needs.map((n, ni) => `<div class="rt-row ${n.ok ? 'ok' : n.status}" data-k="${li}-${ni}">
      <span class="rt-st ${n.ok ? 'ok' : n.status}">${n.ok ? ICO.ok : ICO.warn}</span>
      <div class="rt-nm"><b>${esc(n.name)}${n.version ? ' <em>' + esc(n.version) + '</em>' : ''}</b>
        <small>${n.ok ? esc(n.path || '') : esc(problem(n, l.name).text.replace(/<[^>]+>/g, ''))}${n.need ? ` · pede ${esc(n.need.version)} (${esc(n.need.source)})` : ''}</small>
        ${n.id === 'jdk' && n.jdks && n.jdks.length > 1 ? `<label class="rt-jdk">JDK padrão da IDE <select data-jdk>${n.jdks.map(j => `<option value="${esc(j.home)}" ${j.home === n.path ? 'selected' : ''}>${esc((j.major || '?') + ' · ' + j.name)}</option>`).join('')}</select></label>` : ''}
        <div class="rt-prog" hidden><div class="rt-bar"><i></i></div><span class="rt-step"></span></div></div>
      <div class="rt-na">${n.ok ? `<button class="chip" data-a="pick" title="Usar outra instalação">${ICO.folder}<span>Trocar…</span></button>${n.sdk && bs.sdk ? `<button class="chip" data-a="versions">Versões…</button>` : ''}` : actions(n, r.pm)}</div></div>`).join('')}</div>`).join('');
  for (const x of rows) {
    const row = box.querySelector(`.rt-row[data-k="${x.key}"]`); if (!row) continue;
    bindActions(row, x.n, () => recheckAll());
    row.querySelector('[data-jdk]')?.addEventListener('change', async (e) => {
      try { await api('sdk/default', { kind: 'jdk', path: e.target.value }, { method: 'POST' }); toast('JDK padrão trocado', 'ok'); bs.hooks.run('sdk:installed', 'jdk'); } catch (er) { toast(er.message); }
    });
  }
}
bs.actions.add([
  { label: 'Runtimes do projeto…', k: '', icon: ICO.rt, run: () => openDialog() },
  { label: 'Executar o main deste arquivo', k: 'Ctrl+Shift+F10', icon: ICO.play, run: () => runAtCursor() },
  { label: 'Executar o main com argumentos…', k: '', icon: ICO.args, run: () => { const t = S.active; const en = t && nearest(entriesOf(t), (bs.editor && bs.editor.getPosition() && bs.editor.getPosition().lineNumber) || 1); if (en) askArgs(t, en); else toast('Este arquivo não tem main'); } },
]);
bs.dashboard.action({ label: 'Runtimes', icon: ICO.rt, title: 'O que cada linguagem do projeto precisa instalado', go: () => openDialog() });
// abas já abertas quando o plugin liga
setTimeout(() => { for (const t of S.tabs || []) scanSoon(t, 0); if (S.active) check(S.active); }, 600);
