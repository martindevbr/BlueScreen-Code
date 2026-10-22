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
// linguagens em que "Depurar" funciona (depurador da IDE, debug.js; o que falta instalar ele oferece na hora)
const DEBUG = new Set(['java', 'python', 'javascript', 'typescript', 'go', 'rust', 'c', 'cpp', 'csharp', 'ruby']);
const extOf = (p) => String(p || '').toLowerCase().split('/').pop().split('.').slice(1).pop() || '';
const known = (t) => t && t.mode === 'editor' && !t.virtual && t.model && EXTS.has(extOf(t.path));
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
  if (bs.debug && DEBUG.has(t.lang)) items.push({ label: `Depurar '${en.label}'`, k: 'Shift+F9', icon: ICO.bug, action: () => debug(t, en) });
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
// ---------- depurar ----------
// O plano de execução é o mesmo do Executar; muda como ele roda:
// - Java: o programa roda no console do Build com o agente JDWP (javac/java, Maven exec:java, Gradle bsRun) e o
//   java-debug (plugin do jdtls, o mesmo do VS Code) se liga nele. Entrada do programa continua no console.
// - Ruby: o mesmo, com o rdbg abrindo a porta junto do programa.
// - C, C++ e Rust (rustc / cargo): compila no console do Build e o LLDB abre o executável.
// - Python (debugpy), JavaScript/TypeScript (js-debug) e Go (Delve): o depurador abre o programa com os mesmos
//   interpretador, argumentos, pasta e ambiente do Executar.
// - C#: o caminho de sempre do debug.js (pergunta a .dll).
const freePort = () => 20000 + Math.floor(Math.random() * 40000);
const isProg = (p, n) => String(p || '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '') === n;
// lê o console de uma execução até achar `re` (devolve o match) ou ela acabar (devolve o estado, ou null com re)
async function waitRun(id, re, ms = 300000) {
  let from = 0; const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let r; try { r = await api('build/read', { id, from }); } catch { return null; }
    for (const l of r.lines || []) { const m = re && re.exec(l); if (m) return m; }
    from = r.from + (r.lines || []).length;
    if (r.status !== 'running') return re ? null : r.status;
    await new Promise(ok => setTimeout(ok, 200));
  }
  return null;
}
async function planFor(t, en, args) {
  let r;
  try { r = await api('runtimes/plan', {}, { method: 'POST', body: JSON.stringify({ project: t.project, file: t.path, line: en ? en.line : 0, args }) }); }
  catch (e) { toast(e.message); return null; }
  if (r.missing) { needDialog(r, () => debug(t, en)); return false; }
  return r.plan || null;
}
async function debug(t, en) {
  if (!S.project || !t || !bs.debug) return;
  if (t.dirty) await bs.save();
  if (bs.debug.session()) await bs.debug.stop();
  const userArgs = store.get('rtArgs', {})[argKey(t, en)] || '';
  const title = `Depurar ${en ? en.label : t.path.split('/').pop()}`;
  // sem plano próprio (ou C#): o caminho de sempre do debug.js
  const plain = () => bs.debug.start(t, {}); // com o: {} o debug.js não chama o lançador de novo
  if (t.lang === 'csharp') return plain();
  const plan = await planFor(t, en, userArgs); if (plan === false) return; if (!plan) return plain();
  const steps = plan.steps.map(x => ({ ...x, args: [...(x.args || [])], env: { ...(x.env || {}) } }));
  const last = steps[steps.length - 1];
  const B = bs.build;
  const runInConsole = async (st, tt) => { const id = B && B.runSteps ? await B.runSteps({ title: tt, steps: st, jdk: plan.jdk }) : null; if (!id) toast('O console de Build não está disponível'); return id; };
  switch (t.lang) {
    case 'java': {
      const jd = await bs.debug.need('java-debug'); if (!jd) return;
      // o programa espera parado o depurador se ligar (suspend=y)
      const port = freePort(), agent = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:${port}`;
      if (last.kind === 'maven') last.env.MAVEN_OPTS = ((last.env.MAVEN_OPTS || '') + ' ' + agent).trim();
      else if (last.args.some(a => /:bsRun$/.test(a))) last.args.push('--debug-jvm'); // Gradle: porta 5005
      else if (isProg(last.program, 'java')) last.args.unshift(agent);
      else { toast('Este projeto roda por ' + (last.label || last.program).split(' ')[0] + ': a depuração de Java funciona com javac/java, Maven e Gradle'); return; }
      const dap = await javaDap(t); if (!dap) return;
      const id = await runInConsole(steps, title); if (!id) return;
      const m = await waitRun(id, /Listening for transport dt_socket at address: ?(?:[\d.]+:)?(\d+)/);
      if (!m) { toast('O programa não chegou a esperar o depurador (veja o console do Build)'); return; }
      return bs.debug.start(t, { tool: 'java-debug', params: { port: dap }, request: 'attach', title, args: { type: 'java', request: 'attach', name: title, hostName: '127.0.0.1', port: +m[1], timeout: 30000,
        // F7 não entra no JDK nem em código gerado (como o IntelliJ): System.out.println passa direto
        stepFilters: { classNameFilters: ['java.*', 'javax.*', 'jdk.*', 'sun.*', 'com.sun.*', 'junit.*', 'org.junit.*'], skipSynthetics: true, skipStaticInitializers: true, skipConstructors: false } } });
    }
    case 'ruby': {
      if (!await bs.debug.need('rdbg')) return;
      const port = freePort();
      const st = { ...last, program: 'rdbg', args: ['--open', `--port=${port}`, '--host=127.0.0.1', '--command', '--', last.program, ...last.args], label: `rdbg ${last.label}` };
      const id = await runInConsole([...steps.slice(0, -1), st], title); if (!id) return;
      if (!await waitRun(id, /Debugger can attach via TCP\/IP|wait for debugger connection/i)) { toast('O rdbg não abriu a porta (veja o console do Build)'); return; }
      return bs.debug.start(t, { tool: 'rdbg', params: { port }, request: 'attach', title, args: { type: 'rdbg', request: 'attach', name: title } });
    }
    case 'c': case 'cpp': case 'rust': {
      const tool = await bs.debug.need(t.lang); if (!tool) return;
      let build = steps.slice(0, -1), program = last.program, args = last.args, cwd = last.cwd;
      if (isProg(last.program, 'cargo')) {
        // cargo run -> cargo build; o executável fica em target/debug (exemplos em target/debug/examples)
        const a = last.args, cut = a.indexOf('--'), sel = a.slice(1, cut < 0 ? a.length : cut);
        args = cut < 0 ? [] : a.slice(cut + 1);
        build = [{ ...last, args: ['build', ...sel], label: 'cargo build ' + sel.join(' ') }];
        const bin = sel[sel.indexOf('--bin') + 1], ex = sel[sel.indexOf('--example') + 1];
        program = sel.includes('--bin') ? `${cwd}/target/debug/${bin}.exe` : sel.includes('--example') ? `${cwd}/target/debug/examples/${ex}.exe` : null;
      } else if (isProg(build[0] && build[0].program, 'rustc')) build[0].args.push('-g');
      if (build.length) {
        const id = await runInConsole(build, 'Compilar para depurar'); if (!id) return;
        if (await waitRun(id, null) !== 'ok') { toast('A compilação falhou (veja o console do Build)'); return; }
      }
      if (!program) return plain(); // cargo sem --bin: pergunta o executável (debug.js)
      const cfg = tool.id === 'codelldb' ? { type: 'lldb', request: 'launch', program, args, cwd } : { request: 'launch', program, args, cwd, stopOnEntry: false };
      return bs.debug.start(t, { tool: tool.id, title, args: cfg });
    }
    case 'python': {
      const tool = await bs.debug.need('python'); if (!tool) return;
      let a = last.args.filter(x => x !== '-u'); const pi = a.indexOf('python');
      if (pi >= 0 && !/python/i.test(last.program)) a = a.slice(pi + 1); // uv run python / poetry run python
      const mi = a.indexOf('-m');
      const target = mi >= 0 ? { module: a[mi + 1], args: a.slice(mi + 2) } : { program: a[0], args: a.slice(1) };
      // .venv do projeto: o programa roda com o Python dele (uv/poetry/py ficam com o Python do debugpy)
      const python = /python(\.exe)?$/i.test(last.program) && /[\\/]/.test(last.program) ? last.program : undefined;
      return bs.debug.start(t, { tool: tool.id, title, args: { type: 'python', request: 'launch', name: title, ...target, python, cwd: last.cwd, env: last.env, console: 'internalConsole', justMyCode: true, redirectOutput: true } });
    }
    case 'javascript': case 'typescript': {
      const tool = await bs.debug.need('js-debug'); if (!tool) return;
      const f = last.args.find(x => /\.[cm]?[jt]sx?$/i.test(x)) || ''; const rest = last.args.slice(last.args.indexOf(f) + 1);
      const rt = isProg(last.program, 'node') ? {} : isProg(last.program, 'npx') ? { runtimeExecutable: last.program, runtimeArgs: last.args.slice(0, last.args.indexOf(f)) }
        : isProg(last.program, 'tsx') ? { runtimeExecutable: last.program } : null;
      if (!rt) { toast('O js-debug depura programas do Node.js (este roda por ' + last.program + ')'); return; }
      return bs.debug.start(t, { tool: tool.id, title, args: { type: 'pwa-node', request: 'launch', name: title, program: f, args: rest, cwd: last.cwd, env: last.env, console: 'internalConsole', outputCapture: 'std', skipFiles: ['<node_internals>/**'], ...rt } });
    }
    case 'go': {
      const tool = await bs.debug.need('go'); if (!tool) return;
      const a = last.args; // run <arquivo|.> [args]
      const program = a[1] === '.' ? last.cwd : a[1];
      return bs.debug.start(t, { tool: tool.id, title, args: { request: 'launch', mode: 'debug', program, args: a.slice(2), cwd: last.cwd } });
    }
    default: return plain();
  }
}
// porta DAP do java-debug: o jdtls precisa ter subido com o plugin (senão reinicia com ele)
async function javaDap(t) {
  const L = bs.lsp; let c = L && await L.clientFor(t).catch(() => null);
  if (!c) { toast('A depuração de Java precisa do jdtls (servidor de linguagem do Java) ligado'); return null; }
  if (!(c.bundles || []).length) {
    toast('Reiniciando o jdtls com o depurador…');
    const tools = await L.tools(true); const jt = tools.find(x => x.id === 'jdtls');
    await L.restart(jt, t.project); c = await L.clientFor(t).catch(() => null);
    if (!c || !(c.bundles || []).length) { toast('O jdtls não carregou o plugin de depuração'); return null; }
  }
  try { return await c.request('workspace/executeCommand', { command: 'vscode.java.startDebugSession', arguments: [] }, 60000); }
  catch (e) { toast('O jdtls não abriu o depurador: ' + e.message); return null; }
}
// Shift+F9 e "Depurar este arquivo": o main mais perto do cursor; arquivo sem main segue o caminho de sempre
for (const l of DEBUG) if (l !== 'csharp') bs.debug && (bs.debug.launchers[l] = (t) => {
  if (!known(t) || !S.project || t.project !== S.project.path) return false;
  const list = entriesOf(t); if (!list.length) return false;
  const line = (bs.editor && bs.editor.getPosition() && bs.editor.getPosition().lineNumber) || 1;
  return debug(t, nearest(list, line));
});

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
