/* BlueScreen: depurador, pelo Debug Adapter Protocol (o mesmo do VS Code). O BlueScreen não depura sozinho: ele
   conduz o depurador oficial de cada linguagem (debugpy, Delve, lldb-dap, CodeLLDB, netcoredbg), aberto pelo núcleo
   e ligado por WebSocket (/api/rpc/ws), como o servidor de linguagem.
   Atalhos do IntelliJ: clique na margem ou Ctrl+F8 marca breakpoint (botão direito: condição), Shift+F9 depura o
   arquivo aberto, F9 continua, F8 passa por cima, F7 entra, Shift+F8 sai, Ctrl+F2 para.
   Painel embaixo do editor: frames da pilha, variáveis (em árvore) e console, que avalia expressões no frame
   escolhido. Pausado, passar o mouse sobre uma variável mostra o valor.
   Expõe bs.debug: start(tab), stop(), session(). */
(function (bs) {

const DB = { s: null, bps: new Map(), decos: new Map(), cur: null, curDecos: [], hover: [], frames: [], frameId: null, vars: new Map(), open: new Set() };
const BUG = '<svg class="i" viewBox="0 0 24 24"><path d="M8 8a4 4 0 0 1 8 0v1H8z"/><rect x="7" y="9" width="10" height="11" rx="5"/><path d="M12 13v7M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 20l3-2M20 20l-3-2"/></svg>';
const srcName = (src) => src ? (src.name || (src.path || '').split(/[\\/]/).pop()) : '';
const IC = {
  go: '<svg class="i" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  over: '<svg class="i" viewBox="0 0 24 24"><path d="M4 14a8 8 0 0 1 15-4"/><path d="M19 5v5h-5"/><circle cx="12" cy="19" r="1.6"/></svg>',
  into: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3v11M7 9l5 5 5-5"/><circle cx="12" cy="19.5" r="1.6"/></svg>',
  out: '<svg class="i" viewBox="0 0 24 24"><path d="M12 15V4M7 9l5-5 5 5"/><circle cx="12" cy="19.5" r="1.6"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  again: '<svg class="i" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/></svg>',
  pause: '<svg class="i" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
};

bs.ui.panel(`<div id="dbgCon" hidden>
  <div id="dbResize" title="Arraste para ajustar a altura"></div>
  <div class="head"><span class="ttl">Depurar</span><span class="db-state" id="dbState"></span><span class="spacer"></span>
    <button class="icon-btn" id="dbGo" title="Continuar (F9)">${IC.go}</button>
    <button class="icon-btn" id="dbPause" title="Pausar">${IC.pause}</button>
    <button class="icon-btn" id="dbOver" title="Passar por cima (F8)">${IC.over}</button>
    <button class="icon-btn" id="dbInto" title="Entrar (F7)">${IC.into}</button>
    <button class="icon-btn" id="dbOut" title="Sair (Shift+F8)">${IC.out}</button>
    <button class="icon-btn" id="dbAgain" title="Depurar de novo (Shift+F9)">${IC.again}</button>
    <button class="icon-btn db-stop" id="dbStop" title="Parar (Ctrl+F2)">${IC.stop}</button>
    <button class="icon-btn" id="dbHide" title="Esconder"><svg class="i" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button></div>
  <div class="db-body">
    <section class="db-col"><h4>Frames</h4><div class="db-list" id="dbFrames"></div></section>
    <section class="db-col"><h4>Variáveis</h4><div class="db-list" id="dbVars"></div></section>
    <section class="db-col db-con"><h4>Console</h4><div class="db-out" id="dbOut2"></div><input id="dbEval" placeholder="Avaliar expressão" spellcheck="false" autocomplete="off"></section>
  </div>
</div>`);

// ----- caminhos -----
const absOf = (t) => t.project.replace(/[\\/]+$/, '') + '\\' + t.path.replace(/\//g, '\\');
const keyOf = (abs) => abs.replace(/\//g, '\\').toLowerCase();
const relOf = (abs) => { if (!S.project) return null; const r = S.project.path.replace(/[\\/]+$/, '') + '\\'; return keyOf(abs).startsWith(keyOf(r)) ? abs.slice(r.length).replace(/\\/g, '/') : null; };
const tabFor = (abs) => S.tabs.find(t => t.mode === 'editor' && keyOf(absOf(t)) === keyOf(abs));

// ----- breakpoints: guardados por projeto, desenhados na margem e levados junto quando o código muda de linha -----
const bpKey = () => 'bp:' + (S.project ? S.project.path : '');
function bpLoad() { DB.bps = new Map(); const o = store.get(bpKey(), {}); for (const [rel, list] of Object.entries(o)) DB.bps.set(rel, new Map(list.map(b => [b.line, b]))); }
function bpSave() { const o = {}; for (const [rel, m] of DB.bps) if (m.size) o[rel] = [...m.values()]; store.set(bpKey(), o); }
const bpsOf = (rel) => { if (!DB.bps.has(rel)) DB.bps.set(rel, new Map()); return DB.bps.get(rel); };
function bpPaint(tab) {
  if (!tab || tab.mode !== 'editor' || !tab.model || tab.model.isDisposed()) return;
  const list = [...bpsOf(tab.path).values()];
  const decos = list.map(b => ({ range: new monaco.Range(b.line, 1, b.line, 1), options: { glyphMarginClassName: 'bp-dot' + (b.condition ? ' cond' : '') + (b.verified === false ? ' off' : ''), glyphMarginHoverMessage: { value: b.condition ? 'Breakpoint com condição: `' + b.condition + '`' : 'Breakpoint (clique para remover)' }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } }));
  DB.decos.set(tab.model.id, tab.model.deltaDecorations(DB.decos.get(tab.model.id) || [], decos));
}
// edições movem as decorações; as linhas dos breakpoints acompanham
function bpTrack(tab) {
  const ids = DB.decos.get(tab.model.id); if (!ids || !ids.length) return;
  const m = bpsOf(tab.path); const old = [...m.values()]; const next = new Map();
  ids.forEach((id, i) => { const r = tab.model.getDecorationRange(id); const b = old[i]; if (r && b) next.set(r.startLineNumber, { ...b, line: r.startLineNumber }); });
  DB.bps.set(tab.path, next); bpSave();
}
function bpToggle(tab, line, opts) {
  const m = bpsOf(tab.path);
  if (m.has(line) && !opts) m.delete(line); else m.set(line, { line, ...(m.get(line) || {}), ...(opts || {}) });
  bpSave(); bpPaint(tab); bpSync(tab.path);
}
function bpCondition(tab, line) {
  const b = bpsOf(tab.path).get(line) || {};
  dialog('bpDlg', `<div class="dlg-hd"><span class="dlg-ic">${BUG}</span><div><h3>Condição do breakpoint</h3><p>Pausa na linha ${line} só quando a expressão for verdadeira. Vazio pausa sempre.</p></div></div>
    <label class="fld">Condição<input id="bpIn" spellcheck="false" autocomplete="off" value="${esc(b.condition || '')}" placeholder="i == 2"></label>
    <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip primary" id="bpOk">Salvar</button></div>`, (el) => {
    const go = () => { el.hidden = true; bpToggle(tab, line, { condition: $('#bpIn').value.trim() || undefined }); };
    $('#bpOk').onclick = go; $('#bpIn').onkeydown = (e) => { if (e.key === 'Enter') go(); }; $('#bpIn').focus();
  });
}
// com a sessão aberta, breakpoint novo vale na hora
async function bpSync(rel) {
  const s = DB.s; if (!s || !s.ready || !S.project) return;
  const list = [...bpsOf(rel).values()];
  const abs = S.project.path.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\');
  try {
    const r = await s.req('setBreakpoints', { source: { path: abs, name: rel.split('/').pop() }, breakpoints: list.map(b => ({ line: b.line, condition: b.condition })), sourceModified: false });
    (r.breakpoints || []).forEach((v, i) => { if (list[i]) list[i].verified = v.verified; });
    const t = tabFor(abs); if (t) bpPaint(t);
  } catch {}
}

// ----- sessão DAP -----
class DapSession extends bs.lsp.RpcClient {
  constructor(tool, root) { super(tool, root); this.seq = 0; this.waiters = new Map(); this.events = {}; }
  req(command, args, ms = 30000) {
    const seq = ++this.seq; this.send({ seq, type: 'request', command, arguments: args });
    return new Promise((ok, fail) => { const t = setTimeout(() => { this.waiters.delete(seq); fail(new Error(command + ': sem resposta')); }, ms); this.waiters.set(seq, { ok: (b) => { clearTimeout(t); ok(b); }, fail: (e) => { clearTimeout(t); fail(e); } }); });
  }
  receive(m) {
    if (m.type === 'response') { const w = this.waiters.get(m.request_seq); if (!w) return; this.waiters.delete(m.request_seq); m.success ? w.ok(m.body || {}) : w.fail(new Error(m.message || m.command)); return; }
    if (m.type === 'event') { const h = this.events[m.event]; h && h(m.body || {}); return; }
    // pedidos do adaptador (runInTerminal, startDebugging): não suportados
    if (m.type === 'request') this.send({ seq: ++this.seq, type: 'response', request_seq: m.seq, command: m.command, success: false, message: 'não suportado pelo BlueScreen' });
  }
}

// configuração de "depurar este arquivo" para cada adaptador
async function launchArgs(tool, tab) {
  const abs = absOf(tab); const root = tab.project; const dir = abs.replace(/[\\/][^\\/]*$/, '');
  switch (tool.id) {
    case 'debugpy': return { type: 'python', request: 'launch', name: tab.path, program: abs, cwd: root, console: 'internalConsole', justMyCode: true, redirectOutput: true };
    case 'delve': return { request: 'launch', mode: 'debug', program: dir, cwd: root };
    default: {
      // C, C++, Rust e .NET depuram o programa compilado: pergunta qual (e lembra)
      const k = 'dbgProgram:' + root; const guess = store.get(k, '') || (tool.id === 'netcoredbg' ? root + '\\bin\\Debug\\' : root + '\\target\\debug\\' + root.split(/[\\/]/).pop() + '.exe');
      const program = await new Promise((ok) => dialog('dbgProg', `<div class="dlg-hd"><span class="dlg-ic">${BUG}</span><div><h3>Programa a depurar</h3><p>${tool.id === 'netcoredbg' ? 'A .dll compilada do projeto (dotnet build gera em bin\\Debug).' : 'O executável compilado com símbolos de depuração (cargo build, cmake, make).'}</p></div></div>
        <label class="fld">Programa<input id="dpIn" spellcheck="false" autocomplete="off" value="${esc(guess)}"></label>
        <label class="fld">Argumentos<input id="dpArgs" spellcheck="false" autocomplete="off" value="${esc(store.get(k + ':args', ''))}"></label>
        <div class="actions"><button class="chip" data-close id="dpNo">Cancelar</button><button class="chip primary" id="dpOk">Depurar</button></div>`, (el) => {
        const go = () => { el.hidden = true; store.set(k, $('#dpIn').value.trim()); store.set(k + ':args', $('#dpArgs').value); ok($('#dpIn').value.trim()); };
        $('#dpOk').onclick = go; $('#dpNo').addEventListener('click', () => ok(null)); $('#dpIn').onkeydown = (e) => { if (e.key === 'Enter') go(); }; $('#dpIn').focus();
      }));
      if (!program) return null;
      const args = (store.get(k + ':args', '') || '').match(/"[^"]*"|\S+/g) || [];
      return tool.id === 'codelldb' ? { type: 'lldb', request: 'launch', program, args, cwd: root } : { request: 'launch', program, args, cwd: root, stopAtEntry: false };
    }
  }
}

async function start(tab = S.active) {
  if (!tab || tab.mode !== 'editor') { toast('Abra o arquivo que quer depurar'); return; }
  if (DB.s) await stop(true);
  const tools = await bs.lsp.tools();
  const tool = tools.find(t => t.kind === 'dap' && t.installed && t.langs.includes(tab.lang));
  if (!tool) {
    const known = tools.filter(t => t.kind === 'dap' && t.langs.includes(tab.lang));
    if (!known.length) { toast('Ainda não há depurador para ' + tab.lang); return; }
    const e = { clientX: innerWidth / 2 - 150, clientY: innerHeight / 3, preventDefault() {}, stopPropagation() {} };
    showMenu(e, known.map(t => ({ label: 'Instalar ' + t.name, icon: BUG, action: () => { const c = t.install.split('  (')[0]; if (bs.terminal && /^(pip|go|winget|scoop|npm|dotnet) /.test(c)) { bs.terminal.run(c); toast('Depois de instalar, use Shift+F9 de novo'); bs.lsp.tools(true); } else { copyText(t.install); toast(t.install); } } })), 'Sem depurador para ' + tab.lang);
    return;
  }
  if (tab.dirty) await save();
  const args = await launchArgs(tool, tab); if (!args) return;
  DB.last = tab;
  const s = DB.s = new DapSession(tool, tab.project);
  show(true); clearOut(); out(`Depurando ${tab.path} com ${tool.name}`, 'bs'); state('iniciando', 'busy');
  s.events.output = (b) => { if (b.category !== 'telemetry') out(b.output, b.category); };
  s.events.stopped = (b) => onStopped(b);
  s.events.continued = () => onContinued();
  s.events.terminated = () => end();
  s.events.exited = (b) => out(`Processo terminou com código ${b.exitCode}`, 'bs');
  s.events.breakpoint = (b) => { const bp = b.breakpoint; if (!bp || !bp.source || !bp.source.path) return; const rel = relOf(bp.source.path); if (rel == null) return; const m = bpsOf(rel); const x = m.get(bp.line); if (x) { x.verified = bp.verified; const t = tabFor(bp.source.path); if (t) bpPaint(t); } };
  const initialized = new Promise((ok) => { s.events.initialized = ok; });
  s.onclose = () => { if (DB.s === s) end(); };
  try {
    await s.connect();
    s.caps = await s.req('initialize', { clientID: 'bluescreen', clientName: 'BlueScreen', adapterID: tool.id, locale: 'pt-BR', pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsVariablePaging: false, supportsRunInTerminalRequest: false, supportsProgressReporting: false });
    // launch só responde depois do configurationDone: os breakpoints vão no meio
    const launched = s.req('launch', args, 120000);
    await Promise.race([initialized, launched]);
    s.ready = true;
    for (const rel of DB.bps.keys()) await bpSync(rel);
    try { await s.req('setExceptionBreakpoints', { filters: [] }); } catch {}
    if (s.caps.supportsConfigurationDoneRequest !== false) await s.req('configurationDone', {});
    await launched;
    if (DB.s === s && !DB.cur) state('rodando', 'run');
  } catch (e) { out(e.message, 'stderr'); if (DB.s === s) end(); }
}
async function stop(quiet) {
  const s = DB.s; if (!s) return;
  try { await s.req(s.caps && s.caps.supportsTerminateRequest ? 'terminate' : 'disconnect', { terminateDebuggee: true }, 3000); } catch {}
  try { await s.req('disconnect', { terminateDebuggee: true }, 2000); } catch {}
  s.close(); if (!quiet) end();
}
function end() {
  if (!DB.s) return; DB.s = null; clearPaused(); state('encerrado', 'end');
  $('#dbFrames').innerHTML = '<div class="db-empty">A sessão terminou.</div>'; $('#dbVars').innerHTML = '';
  buttons();
}
const step = (cmd) => { const s = DB.s; if (!s || !DB.cur) return false; s.req(cmd, { threadId: DB.cur.threadId }).catch(e => out(e.message, 'stderr')); onContinued(); };

// ----- pausado: pilha, variáveis e a linha no editor -----
async function onStopped(b) {
  const s = DB.s; if (!s) return;
  let threadId = b.threadId;
  if (!threadId) { try { const t = await s.req('threads', {}); threadId = t.threads && t.threads[0] && t.threads[0].id; } catch {} }
  DB.cur = { threadId, reason: b.reason };
  let st; try { st = await s.req('stackTrace', { threadId, startFrame: 0, levels: 60 }); } catch (e) { out(e.message, 'stderr'); return; }
  DB.frames = st.stackFrames || [];
  const why = { breakpoint: 'breakpoint', step: 'passo', exception: 'exceção', pause: 'pausa', entry: 'início', 'function breakpoint': 'breakpoint' }[b.reason] || b.reason;
  const f0 = DB.frames.find(f => f.source && f.source.path) || DB.frames[0];
  state(`pausado: ${why}${f0 && f0.source ? ' em ' + srcName(f0.source) + ':' + f0.line : ''}`, 'pause');
  if (b.reason === 'exception' && b.text) out(b.text, 'stderr');
  renderFrames(); buttons();
  if (f0) await selectFrame(f0);
}
function onContinued() { DB.cur = null; clearPaused(); state('rodando', 'run'); $('#dbVars').innerHTML = ''; renderFrames(); buttons(); }
function renderFrames() {
  const el = $('#dbFrames');
  if (!DB.cur) { el.innerHTML = DB.s ? '<div class="db-empty">Rodando…</div>' : ''; return; }
  el.innerHTML = DB.frames.map((f, i) => `<div class="db-row fr ${f.id === DB.frameId ? 'on' : ''} ${f.source && f.source.path && relOf(f.source.path) != null ? '' : 'ext'}" data-i="${i}" title="${esc(f.source && f.source.path || '')}"><b>${esc(f.name)}</b><span>${esc(f.source ? srcName(f.source) + ':' + f.line : '')}</span></div>`).join('') || '<div class="db-empty">Sem frames.</div>';
  el.querySelectorAll('.fr').forEach(r => r.onclick = () => selectFrame(DB.frames[+r.dataset.i]));
}
async function selectFrame(f) {
  const s = DB.s; if (!s) return;
  DB.frameId = f.id; renderFrames();
  if (f.source && f.source.path) await showLine(f.source.path, f.line);
  DB.vars = new Map(); DB.open = new Set();
  try {
    const sc = await s.req('scopes', { frameId: f.id });
    DB.scopes = sc.scopes || [];
    // escopos locais já abertos, os globais fechados (como no IntelliJ)
    for (const x of DB.scopes) if (!x.expensive && !/global/i.test(x.name)) DB.open.add(x.variablesReference);
    await renderVars();
  } catch (e) { $('#dbVars').innerHTML = `<div class="db-empty">${esc(e.message)}</div>`; }
}
async function children(ref) {
  if (DB.vars.has(ref)) return DB.vars.get(ref);
  let v = []; try { v = (await DB.s.req('variables', { variablesReference: ref })).variables || []; } catch {}
  DB.vars.set(ref, v); return v;
}
async function renderVars() {
  const rows = [];
  const walk = async (list, depth) => {
    for (const v of list) {
      const ref = v.variablesReference; const open = ref && DB.open.has(ref);
      rows.push(`<div class="db-row va" style="padding-left:${8 + depth * 14}px" data-ref="${ref || 0}"><span class="ar ${ref ? (open ? 'open' : '') : 'leaf'}"></span><span class="nm">${esc(v.name)}</span>${v.value != null && v.value !== '' ? `<span class="eq">=</span><span class="vl" title="${esc(v.value)}">${esc(v.value)}</span>` : ''}${v.type ? `<span class="ty">${esc(v.type)}</span>` : ''}</div>`);
      if (open) await walk(await children(ref), depth + 1);
    }
  };
  await walk((DB.scopes || []).map(s => ({ name: s.name, variablesReference: s.variablesReference, value: null })), 0);
  $('#dbVars').innerHTML = rows.join('') || '<div class="db-empty">Sem variáveis.</div>';
  $('#dbVars').querySelectorAll('.va').forEach(r => r.onclick = async () => { const ref = +r.dataset.ref; if (!ref) return; DB.open.has(ref) ? DB.open.delete(ref) : DB.open.add(ref); await renderVars(); });
}
async function showLine(abs, line) {
  const rel = relOf(abs);
  if (rel != null) await openFile(rel, 'editor', line);
  else { const root = abs.replace(/[\\/][^\\/]*$/, ''); await openOutside(root, abs.slice(root.length + 1), line); }
  const t = S.active; if (!t || !t.model) return;
  clearPaused();
  DB.paused = { model: t.model, ids: t.model.deltaDecorations([], [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'dbg-line', glyphMarginClassName: 'dbg-arrow' } }]) };
}
function clearPaused() { const p = DB.paused; if (p && !p.model.isDisposed()) p.model.deltaDecorations(p.ids, []); DB.paused = null; }

// ----- console -----
function clearOut() { $('#dbOut2').innerHTML = ''; }
function out(text, cat) {
  const el = $('#dbOut2'); const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  const d = document.createElement('div'); d.className = 'db-ln ' + (cat || 'stdout'); d.textContent = String(text).replace(/\n$/, ''); el.appendChild(d);
  while (el.childElementCount > 3000) el.firstElementChild.remove();
  if (atEnd) el.scrollTop = el.scrollHeight;
}
$('#dbEval').addEventListener('keydown', async (e) => {
  e.stopPropagation(); if (e.key !== 'Enter') return;
  const expr = $('#dbEval').value.trim(); if (!expr) return; $('#dbEval').value = '';
  out('› ' + expr, 'in');
  if (!DB.s) { out('Nenhuma sessão de depuração aberta.', 'stderr'); return; }
  try { const r = await DB.s.req('evaluate', { expression: expr, frameId: DB.frameId || undefined, context: 'repl' }); out(r.result, 'res'); if (r.variablesReference) { DB.vars.delete(r.variablesReference); } }
  catch (err) { out(err.message, 'stderr'); }
});

// ----- painel -----
function show(on) { const c = $('#dbgCon'); c.hidden = !(on ?? c.hidden); document.querySelector('#strip [data-tool="debug"]')?.classList.toggle('on', !c.hidden); }
function state(text, kind) { const el = $('#dbState'); el.textContent = text; el.className = 'db-state ' + (kind || ''); buttons(); }
function buttons() {
  const on = !!DB.s, paused = !!DB.cur;
  DB.ctx && DB.ctx.set(paused);
  $('#dbGo').disabled = !paused; $('#dbOver').disabled = !paused; $('#dbInto').disabled = !paused; $('#dbOut').disabled = !paused;
  $('#dbPause').disabled = !on || paused; $('#dbStop').disabled = !on; $('#dbAgain').disabled = !DB.last;
}
$('#dbGo').onclick = () => step('continue'); $('#dbOver').onclick = () => step('next'); $('#dbInto').onclick = () => step('stepIn'); $('#dbOut').onclick = () => step('stepOut');
$('#dbPause').onclick = () => DB.s && DB.s.req('pause', { threadId: (DB.cur && DB.cur.threadId) || 1 }).catch(() => {});
$('#dbStop').onclick = () => stop(); $('#dbAgain').onclick = () => start(DB.last && S.tabs.includes(DB.last) ? DB.last : S.active); $('#dbHide').onclick = () => show(false);
$('#dbResize').addEventListener('mousedown', (e) => {
  e.preventDefault(); const con = $('#dbgCon'); const y0 = e.clientY, h0 = con.offsetHeight; document.body.classList.add('resizing-v');
  const move = (ev) => { con.style.height = Math.max(140, Math.min(innerHeight - 160, h0 + (y0 - ev.clientY))) + 'px'; };
  const up = () => { document.body.classList.remove('resizing-v'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); store.set('dbgH', con.offsetHeight); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
});
$('#dbgCon').style.height = store.get('dbgH', 300) + 'px';
$('#dbFrames').innerHTML = '<div class="db-empty">Marque um breakpoint na margem e use Shift+F9 para depurar o arquivo aberto.</div>';
buttons();

// ----- editor: margem dos breakpoints, valor no hover -----
bs.hooks.on('editor:ready', (ed) => {
  ed.updateOptions({ glyphMargin: true });
  // com o foco no editor o Monaco fica com F7/F8/F9 (F8 é "próximo problema"): pausado, as teclas são da depuração
  DB.ctx = ed.createContextKey('bsDebugPaused', false);
  const K = monaco.KeyMod, C = monaco.KeyCode;
  ed.addCommand(C.F9, () => step('continue'), 'bsDebugPaused');
  ed.addCommand(C.F8, () => step('next'), 'bsDebugPaused');
  ed.addCommand(C.F7, () => step('stepIn'), 'bsDebugPaused');
  ed.addCommand(K.Shift | C.F8, () => step('stepOut'), 'bsDebugPaused');
  ed.addCommand(K.CtrlCmd | C.F2, () => stop());
  ed.addCommand(K.Shift | C.F9, () => start());
  ed.addCommand(K.CtrlCmd | C.F8, () => { const t = S.active; if (t && t.mode === 'editor') bpToggle(t, ed.getPosition().lineNumber); });
  const GM = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
  // a faixa da esquerda da margem é dos plugins (ex.: ▶ do main, do plugin runtimes); a do meio é dos breakpoints
  const LEFT = monaco.editor.GlyphMarginLane.Left;
  const OTHER_LANE = (e) => { const m = ed.getModel(); return !!(m && e.target.detail && e.target.detail.glyphMarginLane === LEFT && e.target.position && m.getLineDecorations(e.target.position.lineNumber).some(d => d.options.glyphMargin && d.options.glyphMargin.position === LEFT)); };
  ed.onMouseDown((e) => { if (e.target.type === GM && !OTHER_LANE(e) && e.event.leftButton && S.active && S.active.mode === 'editor') bpToggle(S.active, e.target.position.lineNumber); });
  ed.onContextMenu((e) => { if (e.target.type !== GM || OTHER_LANE(e) || !S.active) return; const line = e.target.position.lineNumber; const t = S.active; const has = bpsOf(t.path).has(line);
    showMenu(e.event.browserEvent, [{ label: has ? 'Remover breakpoint' : 'Adicionar breakpoint', icon: BUG, action: () => bpToggle(t, line) }, { label: 'Condição…', icon: I.edit, action: () => bpCondition(t, line) }], 'Linha ' + line); });
  // prévia do breakpoint ao passar pela margem
  let ghost = [];
  ed.onMouseMove((e) => { const m = ed.getModel(); if (!m) return; const line = e.target.type === GM ? e.target.position.lineNumber : 0; const has = line && S.active && bpsOf(S.active.path).has(line); ghost = m.deltaDecorations(ghost, line && !has ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'bp-ghost' } }] : []); });
  ed.onMouseLeave(() => { const m = ed.getModel(); if (m) ghost = m.deltaDecorations(ghost, []); });
  ed.onDidChangeModelContent(() => { if (S.active && S.active.mode === 'editor') bpTrack(S.active); });
  ed.addAction({ id: 'bs.debug', label: 'Depurar este arquivo', keybindings: [], contextMenuGroupId: 'navigation', contextMenuOrder: 3, run: () => start() });
  // pausado: o valor da expressão sob o mouse
  const hov = { provideHover: async (model, pos) => {
    if (!DB.s || !DB.cur) return null; const w = model.getWordAtPosition(pos); if (!w) return null;
    const line = model.getLineContent(pos.lineNumber); let a = w.startColumn - 1; while (a > 0 && /[\w.$]/.test(line[a - 1])) a--;
    const expr = line.slice(a, w.endColumn - 1);
    try { const r = await DB.s.req('evaluate', { expression: expr, frameId: DB.frameId || undefined, context: 'hover' }, 3000); return { range: new monaco.Range(pos.lineNumber, a + 1, pos.lineNumber, w.endColumn), contents: [{ value: '`' + expr + '` = `' + String(r.result).replace(/`/g, "'").slice(0, 500) + '`' }] }; } catch { return null; }
  } };
  for (const l of ['python', 'go', 'c', 'cpp', 'rust', 'csharp']) monaco.languages.registerHoverProvider(l, hov);
});
bs.hooks.on('tab:activate', (t) => bpPaint(t));
bs.hooks.on('tab:open', (t) => setTimeout(() => bpPaint(t)));
bs.hooks.on('project:select', () => bpLoad());
bpLoad();

// ----- teclas e registro -----
const ifDbg = (fn) => () => { if (!DB.s) return false; fn(); };
bs.keys.add('Shift+F9', () => { start(); });
bs.keys.add('F9', ifDbg(() => step('continue')));
bs.keys.add('F8', ifDbg(() => step('next')));
bs.keys.add('F7', ifDbg(() => step('stepIn')));
bs.keys.add('Shift+F8', ifDbg(() => step('stepOut')));
bs.keys.add('Ctrl+F2', ifDbg(() => stop()));
bs.keys.add('Ctrl+F8', () => { const t = S.active; if (!t || t.mode !== 'editor') return false; bpToggle(t, editor.getPosition().lineNumber); });
bs.tools.register({ id: 'debug', title: 'Depurar', icon: BUG, order: 85, bottom: true, toggle: (on) => show(on) });
bs.actions.add([
  { label: 'Depurar o arquivo aberto', k: 'Shift+F9', run: () => start(), icon: BUG },
  { label: 'Marcar ou tirar breakpoint', k: 'Ctrl+F8', run: () => { const t = S.active; if (t && t.mode === 'editor') bpToggle(t, editor.getPosition().lineNumber); }, icon: BUG },
  { label: 'Parar a depuração', k: 'Ctrl+F2', run: () => stop(), icon: BUG },
  { label: 'Remover todos os breakpoints', run: () => { const rels = [...DB.bps.keys()]; DB.bps = new Map(); bpSave(); S.tabs.forEach(bpPaint); rels.forEach(bpSync); }, icon: BUG },
]);
window.addEventListener('beforeunload', () => { if (DB.s) DB.s.close(); });
bs.debug = { start, stop, session: () => DB.s };
})(window.BS);
