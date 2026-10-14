/* BlueScreen: Build nativo da IDE (painel Alt+6). Reconhece os sistemas de build do projeto (Maven, Gradle, npm/yarn/pnpm,
   Cargo, Go, .NET, Python, CMake, Make e muitos outros), mostra as tarefas de cada um, executa o arquivo aberto
   (Ctrl+Shift+F10) e mostra a saída num console embaixo do editor, com erros clicáveis. Usa a mesma API dos plugins
   (bs = window.BS) e expõe bs.build para os plugins:
     bs.build.info()            estrutura do build (info.plugins[id] traz os dados do gancho "build.info" do plugin)
     bs.build.selected()        Maven, JDK e repositório escolhidos
     bs.build.run(task, cmd)    roda uma tarefa (id) ou um comando Maven livre
     bs.build.showLog(log)      mostra um log de fora no console: { title, prefix, lines, status, started, ended, url, urlTitle }
     bs.build.current()         o que o console está mostrando agora
     bs.build.render()          redesenha a janela Build
   Ganchos: 'build:render' (body, info) depois de desenhar a janela; filtro 'build:path' (rel, caminho) para
   ligar caminhos de logs de fora a arquivos do checkout. */
(function (bs) {

const BC = { info: null, infoFor: null, loading: false, err: null, run: null, view: 'all', timer: null, last: null, runs: [], q: '', fold: new Set(store.get('buildFold', [])) };
const HAMMER = '<svg class="i" viewBox="0 0 24 24"><path d="M14 6l4 4M3 21l9-9M15.5 3.5l5 5-3 3-5-5z"/></svg>';
const PLAY = '<svg class="i" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>';
const bcPref = () => (S.project ? store.get('buildPref:' + S.project.path, {}) : {});
const bcSet = (k, v) => { const p = bcPref(); p[k] = v; store.set('buildPref:' + S.project.path, p); };
const bcDur = (ms) => { if (!ms && ms !== 0) return ''; const s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s'; };

// console embaixo do editor (painel do plugin dentro da área do editor)
bs.ui.panel(`<div id="buildCon" hidden>
  <div id="bcResize" title="Arraste para ajustar a altura"></div>
  <div class="head"><span class="ttl" id="bcTitle">Build</span><span id="bcState"></span><span class="sub" id="bcSub"></span><span class="spacer"></span>
    <div class="seg" id="bcSeg"><button data-v="all" class="on">Tudo</button><button data-v="issues">Erros e avisos</button></div>
    <a class="icon-btn" id="bcLink" target="_blank" title="Abrir no navegador" hidden>${I.ext}</a>
    <button class="icon-btn" id="bcRerun" title="Rodar de novo (Ctrl+F9)">${I.refresh}</button>
    <button class="icon-btn" id="bcStop" title="Parar" hidden><svg class="i" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg></button>
    <button class="icon-btn" id="bcCopy" title="Copiar a saída inteira">${I.copy}</button>
    <button class="icon-btn" id="bcClose" title="Fechar">${I.x}</button></div>
  <div class="bc-sum" id="bcSum" hidden></div>
  <div class="bc-out" id="bcOut"></div>
</div>`);

async function bcLoadInfo(fresh) {
  if (!S.project) return null;
  if (BC.info && BC.infoFor === S.project.path && !fresh) return BC.info;
  const proj = S.project.path; BC.loading = true; BC.err = null; if (S.tool === 'build') renderBuild();
  try { const i = await api('build/info', { project: proj, fresh: fresh ? '1' : null }); if (S.project && S.project.path === proj) { BC.info = i; BC.infoFor = proj; } }
  catch (e) { BC.err = e.message; }
  BC.loading = false;
  try { BC.runs = await api('build/runs', { project: proj }); } catch {}
  if (S.tool === 'build') renderBuild();
  return BC.info;
}
function renderBuild() {
  const body = $('#toolBody');
  $('#toolActions').innerHTML = `<button class="icon-btn" id="bReload" title="Ler de novo">${I.refresh}</button>`;
  $('#bReload').onclick = () => bcLoadInfo(true);
  if (!S.project) { body.innerHTML = '<div class="empty">Escolha um projeto.</div>'; return; }
  if (!BC.info || BC.infoFor !== S.project.path) {
    body.innerHTML = BC.err ? `<div class="errbox"><b>Não deu para ler o build.</b><div>${esc(BC.err)}</div></div>` : '<div class="empty"><span class="spin"></span> Lendo a estrutura do build…</div>';
    if (!BC.loading && !BC.err) bcLoadInfo(); return;
  }
  const i = BC.info; const p = bcPref(); const running = BC.run && BC.run.kind === 'local' && BC.run.status === 'running';
  const mvnSel = p.mvn && i.mavens.some(m => m.home === p.mvn) ? p.mvn : i.mvnDefault; const jdkSel = p.jdk && i.jdks.some(j => j.home === p.jdk) ? p.jdk : i.jdkDefault;
  const repos = i.repos || []; const repoSel = repos.some(r => r.id === p.repo) || p.repo === 'user' ? p.repo : i.repoDefault;
  // tarefa principal (de um plugin) fica destacada e mostra a descrição; detail lista os passos
  const task = (t) => `<div class="btask ${t.main ? 'main' : ''} ${running ? 'off' : ''}" data-task="${esc(t.id)}" title="${esc(t.steps.map(s => s.label).join('\n'))}">
      <span class="play">${PLAY}</span><div class="tx"><div class="lb">${esc(t.label)}${t.long ? '<span class="tag" title="fica rodando até você parar">contínuo</span>' : ''}</div><div class="ds">${esc(t.main ? t.desc : t.steps[0].label)}</div>
      ${t.detail ? `<div class="steps">${t.steps.map((s, k) => `<div><span class="k">${k + 1}</span><code>${esc(s.args.filter(a => !a.startsWith('-D') || /skipTests/.test(a)).join(' '))}</code></div>`).join('')}</div>` : ''}</div></div>`;
  // tarefas agrupadas por sistema de build (Maven, Gradle, npm, Cargo...), cada grupo recolhível, com filtro
  const q = BC.q.trim().toLowerCase();
  const match = (t) => !q || (t.label + ' ' + t.steps.map(x => x.label).join(' ')).toLowerCase().includes(q);
  const group = (sy) => {
    const ts = i.tasks.filter(t => t.system === sy.id && match(t)); if (!ts.length) return '';
    const fold = BC.fold.has(sy.id) && !q;
    return `<div class="bsys ${fold ? 'fold' : ''} ${sy.available ? '' : 'missing'}" data-sys="${esc(sy.id)}" title="${esc(sy.file || '')}"><svg class="i arr" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg><span class="nm">${esc(sy.name)}</span><span class="fl">${esc(sy.file || '')}</span>${sy.available ? '' : `<span class="tag warn" title="${esc(sy.note || sy.tool + ' não encontrado no PATH')}">sem ${esc(sy.tool || 'ferramenta')}</span>`}<span class="cnt">${ts.length}</span></div>${fold ? '' : ts.map(task).join('')}`;
  };
  const systems = i.systems || [];
  const canFile = S.active && S.active.project === S.project.path;
  const runRow = (r) => `<div class="brun" data-run="${esc(r.id)}"><span class="st ${r.status}">${r.status === 'running' ? '<span class="spin"></span>' : r.status === 'ok' ? '✓' : r.status === 'stopped' ? '■' : '✕'}</span><span class="nm">${esc(r.title)}</span><span class="meta">${r.ended ? bcDur(r.ended - r.started) : ''} · ${esc(ago(r.started))}</span></div>`;
  body.innerHTML = `
    <div class="bhead"><div class="t">${HAMMER}<span>${esc(i.root.split(/[\\/]/).pop())}</span>${i.aggregator ? `<code title="pom agregador">${esc(i.aggregator)}</code>` : ''}</div>
      <div class="m">${i.rel ? `pasta aberta é o módulo <b>${esc(i.rel)}</b>; o build roda na raiz do checkout` : 'build na raiz do checkout'}</div></div>
    <div class="bquick"><button class="chip" id="bcFile" ${canFile ? '' : 'disabled'} title="Executa o arquivo aberto pela linguagem (Ctrl+Shift+F10)">${PLAY}Executar ${canFile ? esc(S.active.path.split('/').pop()) : 'arquivo'}</button>${i.tasks.length > 10 ? `<div class="bfilter"><input id="bcQ" placeholder="Filtrar tarefas" value="${esc(BC.q)}" spellcheck="false"></div>` : ''}</div>
    ${i.tasks.length ? '' : '<div class="empty">Nenhum sistema de build reconhecido nesta pasta (Maven, Gradle, npm, Cargo, Go, .NET, Python, CMake, Make...).</div>'}
    ${i.tasks.length ? `<div class="bsec">Tarefas<span class="meta">${running ? 'rodando…' : systems.length + (systems.length === 1 ? ' sistema' : ' sistemas')}</span></div>${systems.map(group).join('')}
    ${i.aggregator ? `<div class="bcmd"><span>mvn</span><input id="bcCmd" placeholder="-f ${esc(i.aggregator)} clean install" spellcheck="false" value="${esc(p.cmd || '')}"><button class="icon-btn" id="bcCmdGo" title="Rodar (Enter)">${PLAY}</button></div>` : ''}` : ''}
    ${i.aggregator ? `<div class="bsec">Ambiente</div>
    <div class="bcfg">
      <label>Maven<select id="bcMvn">${i.mavens.map(m => `<option value="${esc(m.home)}" ${m.home === mvnSel ? 'selected' : ''}>${esc(m.version)} · ${esc(m.home)}</option>`).join('') || '<option>nenhum encontrado</option>'}</select></label>
      <label>JDK<select id="bcJdk">${i.jdks.map(j => `<option value="${esc(j.home)}" ${j.home === jdkSel ? 'selected' : ''}>${j.major || '?'} · ${esc(j.name)}</option>`).join('') || '<option>nenhum encontrado</option>'}</select></label>
      <label>Repositório<select id="bcRepo">${repos.map(r => `<option value="${esc(r.id)}" ${r.id === repoSel ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}<option value="user" ${repoSel === 'user' ? 'selected' : ''}>settings.xml do usuário</option></select></label>
      <label class="chk"><input type="checkbox" id="bcOff" ${p.offline ? 'checked' : ''}>Offline (-o): só o que já está no ~/.m2</label>
    </div>` : ''}
    ${BC.runs.length ? `<div class="bsec">Execuções nesta sessão</div>${BC.runs.map(runRow).join('')}` : ''}`;
  body.querySelectorAll('.btask').forEach(el => el.onclick = () => { if (running) return toast('Já tem um build rodando. Pare antes de iniciar outro.'); bcRun(el.dataset.task); });
  body.querySelectorAll('.bsys').forEach(el => el.onclick = () => { const k = el.dataset.sys; BC.fold.has(k) ? BC.fold.delete(k) : BC.fold.add(k); store.set('buildFold', [...BC.fold]); renderBuild(); });
  $('#bcFile')?.addEventListener('click', () => bcRunFile());
  const fq = $('#bcQ'); if (fq) { fq.oninput = () => { BC.q = fq.value; renderBuild(); const n = $('#bcQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }; fq.onkeydown = (e) => { if (e.key === 'Escape') { BC.q = ''; renderBuild(); } }; }
  const cmd = $('#bcCmd'); if (cmd) { const go = () => { const v = cmd.value.trim(); if (!v) return; bcSet('cmd', v); bcRun(null, v); }; cmd.onkeydown = (e) => e.key === 'Enter' && go(); $('#bcCmdGo').onclick = go; }
  $('#bcMvn')?.addEventListener('change', (e) => { bcSet('mvn', e.target.value); renderBuild(); });
  $('#bcJdk')?.addEventListener('change', (e) => bcSet('jdk', e.target.value));
  $('#bcRepo')?.addEventListener('change', (e) => bcSet('repo', e.target.value));
  $('#bcOff')?.addEventListener('change', (e) => bcSet('offline', e.target.checked));
  body.querySelectorAll('[data-run]').forEach(el => el.onclick = () => bcOpenLocal(el.dataset.run));
  bs.hooks.run('build:render', body, i); // plugins acrescentam seções e avisos
}
function bcSelected() {
  const i = BC.info; const p = bcPref(); if (!i) return {};
  const mvn = p.mvn && i.mavens.some(m => m.home === p.mvn) ? p.mvn : i.mvnDefault;
  const jdk = p.jdk && i.jdks.some(j => j.home === p.jdk) ? p.jdk : i.jdkDefault;
  const repo = (i.repos || []).some(r => r.id === p.repo) || p.repo === 'user' ? p.repo : i.repoDefault;
  return { mvn, jdk, repo, offline: !!p.offline, mavenVersion: (i.mavens.find(m => m.home === mvn) || {}).version || null };
}
async function bcRun(task, custom) {
  if (!S.project) return;
  if (BC.run && BC.run.kind === 'local' && BC.run.status === 'running') return toast('Já tem um build rodando');
  const p = bcPref(); const i = BC.info || await bcLoadInfo();
  if (!i) return;
  try {
    const r = await api('build/run', {}, { method: 'POST', body: JSON.stringify({ project: S.project.path, task, custom, mvn: p.mvn || i.mvnDefault, jdk: p.jdk || i.jdkDefault, repo: bcSelected().repo, offline: !!p.offline }) });
    BC.last = { task, custom }; store.set('buildLast:' + S.project.path, BC.last);
    bcOpenLocal(r.id, true);
  } catch (e) { toast(e.message); }
}
// Executar o arquivo aberto (Ctrl+Shift+F10, como "Run" do IntelliJ): o servidor escolhe o comando pela extensão
async function bcRunFile() {
  if (!S.project || !S.active || S.active.project !== S.project.path) return toast('Abra um arquivo para executar');
  if (S.active.dirty) await save();
  const p = bcPref(); const i = BC.info || await bcLoadInfo();
  try {
    const r = await api('build/run', {}, { method: 'POST', body: JSON.stringify({ project: S.project.path, file: S.active.path, jdk: p.jdk || (i && i.jdkDefault) }) });
    BC.last = { file: S.active.path }; store.set('buildLast:' + S.project.path, BC.last);
    bcOpenLocal(r.id, true);
  } catch (e) { toast(e.message); }
}
function bcOpenLocal(id, fresh) {
  clearTimeout(BC.timer);
  BC.run = { kind: 'local', id, lines: [], next: 0, status: 'running', title: 'Build', fresh };
  bcShow(); bcPoll();
}
async function bcPoll() {
  const run = BC.run; if (!run || run.kind !== 'local') return;
  let r; try { r = await api('build/read', { id: run.id, from: run.next }); } catch (e) { run.status = 'failed'; run.error = e.message; bcRenderAll(); return; }
  if (BC.run !== run) return;
  const before = run.lines.length;
  if (r.from > run.next) run.lines.push('[BlueScreen] (' + (r.from - run.next) + ' linhas antigas descartadas)');
  run.lines.push(...r.lines); run.next = r.from + r.lines.length;
  const statusChanged = run.status !== r.status;
  Object.assign(run, { status: r.status, title: r.title, step: r.step, steps: r.steps, started: r.started, ended: r.ended });
  bcAppend(before); bcHeader();
  if (r.status === 'running' || r.lines.length >= 5000) BC.timer = setTimeout(bcPoll, r.lines.length ? 250 : 600);
  else if (statusChanged || before === 0) { bcSummary(); try { BC.runs = await api('build/runs', { project: S.project.path }); } catch {} if (S.tool === 'build') renderBuild(); if (r.status !== 'running' && run.fresh) toast(r.status === 'ok' ? 'Build concluído' : r.status === 'stopped' ? 'Build interrompido' : 'Build falhou'); }
  if (r.status === 'running' && S.tool === 'build' && before === 0) renderBuild();
}
// log que vem de fora (ex.: console de um servidor de build, trazido por um plugin): só leitura, mesmos recursos do console
async function bcShowLog(log) {
  clearTimeout(BC.timer);
  const run = BC.run = { ...log, kind: 'ext', lines: log.lines || [], status: log.status || 'ok' };
  bcShow();
  if (run.status === 'loading') return run;
  await bcCheckRefs(run);
  if (BC.run === run) bcRenderAll();
  return run;
}
// confirma no disco quais arquivos citados existem na cópia local
async function bcCheckRefs(run) {
  if (!run || !BC.info) return;
  const set = new Set();
  for (const l of run.lines) { BC_FILE.lastIndex = 0; let m; while ((m = BC_FILE.exec(l))) { const t = bcMap(m[1]); if (t) set.add(t.rr); } }
  try { run.exists = new Set(await api('build/exists', {}, { method: 'POST', body: JSON.stringify({ root: BC.info.root, paths: [...set] }) })); } catch { run.exists = new Set(); }
}
function bcShow() { $('#buildCon').hidden = false; bcRenderAll(); }
function bcRenderAll() { bcHeader(); $('#bcOut').innerHTML = ''; bcAppend(0); bcSummary(); }
function bcHeader() {
  const r = BC.run; if (!r) return;
  const st = { running: '<span class="bst running"><span class="spin"></span>rodando</span>', ok: '<span class="bst ok">sucesso</span>', failed: '<span class="bst failed">falhou</span>', stopped: '<span class="bst stopped">interrompido</span>', loading: '<span class="bst running"><span class="spin"></span>carregando</span>' }[r.status] || '';
  $('#bcTitle').textContent = (r.kind === 'local' ? 'Build · ' : r.prefix || '') + (r.title || '');
  $('#bcState').innerHTML = st;
  const el = r.ended ? r.ended - r.started : r.started ? Date.now() - r.started : 0;
  $('#bcSub').textContent = [r.steps && r.steps.length > 1 ? 'passo ' + (r.step || 1) + '/' + r.steps.length : '', el ? bcDur(el) : '', r.lines.length + ' linhas'].filter(Boolean).join(' · ');
  $('#bcStop').hidden = !(r.kind === 'local' && r.status === 'running');
  $('#bcRerun').hidden = r.kind !== 'local' || r.status === 'running';
  $('#bcLink').hidden = !r.url; if (r.url) { $('#bcLink').href = r.url; $('#bcLink').title = r.urlTitle || 'Abrir no navegador'; }
}
// classificação de linha e caminhos clicáveis
const BC_FILE = /((?:[A-Za-z]:)?[\\/][^\s:[\]"'()<>]+?\.(?:java|jsp|jspf|xml|xhtml|html?|[cm]?[jt]sx?|vue|svelte|properties|sql|groovy|kts?|scala|py|rb|php|go|rs|cs|fs|vb|c|cc|cpp|cxx|h|hpp|swift|dart|ex|exs|erl|hs|ml|zig|nim|lua|pl|r|jl|ya?ml|json|toml|gradle|css|scss|less))(?::\[?(\d+)(?:,(\d+))?\]?|:(\d+))?/g;
function bcClass(l) {
  if (/^\[BlueScreen\] =====/.test(l)) return 'step';
  if (/^\[BlueScreen\]/.test(l)) return 'bs';
  if (/BUILD SUCCESS|BUILD SUCCESSFUL|Concluído com sucesso|Finished: SUCCESS|Build succeeded|^\s*Finished `/.test(l)) return 'ok';
  if (/\[ERROR\]|^ERROR|BUILD FAILURE|BUILD ERROR|Finished: FAILURE|Exception in thread|Falhou \(c|^error(\[|:)|: error\b|\berror (CS|TS|FS)\d+|^FAIL\b|FAILED|^Traceback|panicked at|npm ERR!/.test(l)) return 'err';
  if (/\[WARNING\]|\[WARN\]|^WARNING|^warning(\[|:)|: warning\b|\bwarning (CS|TS)\d+|npm WARN/.test(l)) return 'warn';
  if (/^\[INFO\] -{20,}|^\[INFO\] Building |^\[INFO\] --- /.test(l)) return 'sec';
  if (/^\+ |^\[[^\]]+\] \$ /.test(l)) return 'cmd';
  return '';
}
// caminho do console -> arquivo do projeto aberto ou do checkout (plugins mapeiam caminhos de outras máquinas: 'build:path')
function bcMap(p) {
  const n = (x) => String(x || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const f = n(p), proj = n(S.project && S.project.path), root = n(BC.info && BC.info.root);
  const low = f.toLowerCase();
  if (proj && low.startsWith(proj.toLowerCase() + '/')) { const rel = f.slice(proj.length + 1); return { rel, rr: BC.info && BC.info.rel ? BC.info.rel + '/' + rel : rel }; }
  let relRoot = null;
  if (root && low.startsWith(root.toLowerCase() + '/')) relRoot = f.slice(root.length + 1);
  if (!relRoot) relRoot = bs.hooks.apply('build:path', null, f);
  if (!relRoot) return null;
  const mod = BC.info && BC.info.rel; // pasta aberta é um módulo dentro do checkout
  if (mod && relRoot.toLowerCase().startsWith(mod.toLowerCase() + '/')) return { rel: relRoot.slice(mod.length + 1), rr: relRoot };
  if (!mod) return { rel: relRoot, rr: relRoot };
  return { outside: { root: BC.info.root, rel: relRoot }, rr: relRoot };
}
function bcLineHtml(l, idx) {
  const cls = bcClass(l);
  let html = esc(l).replace(BC_FILE, (m, file, a, b, c) => {
    const t = bcMap(file.replace(/&amp;/g, '&')); if (!t || (BC.run && BC.run.exists && !BC.run.exists.has(t.rr))) return m;
    const line = +(a || c || 0);
    return `<a class="fref" data-rel="${esc(t.rel || '')}" data-root="${esc(t.outside ? t.outside.root : '')}" data-orel="${esc(t.outside ? t.outside.rel : '')}" data-line="${line}">${m}</a>`;
  });
  return `<div class="bl ${cls}" data-i="${idx}">${html || '&nbsp;'}</div>`;
}
function bcAppend(from) {
  const r = BC.run; const out = $('#bcOut'); if (!r || !out) return;
  const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
  const lines = r.lines; let html = '';
  const start = Math.max(from, lines.length - 8000); // DOM: no máximo as últimas 8000 linhas
  if (from === 0 && start > 0) html += `<div class="bl bs">… ${start} linhas anteriores ocultas (use Copiar para ver tudo)</div>`;
  for (let k = start; k < lines.length; k++) { if (BC.view === 'issues' && !/err|warn|ok|step/.test(bcClass(lines[k]))) continue; html += bcLineHtml(lines[k], k); }
  if (from === 0) out.innerHTML = html; else out.insertAdjacentHTML('beforeend', html);
  if (stick || from === 0) out.scrollTop = out.scrollHeight;
}
// resumo do build: resultado, módulos, erros de compilação, dependências faltando, testes
function bcSummary() {
  const r = BC.run; const el = $('#bcSum'); if (!r || !el) return;
  const L = r.lines; const comp = new Map(); const deps = new Set(); const mods = []; let tests = null;
  for (const l of L) {
    let m;
    if ((m = /\[ERROR\]\s+((?:[A-Za-z]:)?[\\/][^\s:[\]]+\.java):\[(\d+)(?:,(\d+))?\]\s*(.*)/.exec(l))) comp.set(m[1] + ':' + m[2], { file: m[1], line: +m[2], msg: m[4] });
    if ((m = /Could not (?:resolve dependencies|find artifact|transfer artifact|resolve artifact)[^:]*?:?\s*([\w.$-]+:[\w.$-]+(?::[\w.$-]+){1,3})/.exec(l))) deps.add(m[1]);
    if ((m = /Non-resolvable parent POM:? Could not find artifact ([\w.$-]+:[\w.$-]+(?::[\w.$-]+){1,3})/.exec(l))) deps.add(m[1] + ' (pom pai)');
    if ((m = /^\[INFO\] (\S.*?) \.{3,} ?(SUCCESS|FAILURE|SKIPPED)/.exec(l))) mods.push({ name: m[1].trim(), st: m[2] });
    if ((m = /Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)$/.exec(l))) tests = m;
  }
  const chips = [];
  if (mods.length) { const last = mods.slice(-30); const bad = last.filter(x => x.st === 'FAILURE'); chips.push(`<span class="bchip ${bad.length ? 'bad' : 'ok'}" title="${esc(last.map(x => x.name + ': ' + x.st).join('\n'))}">${last.filter(x => x.st === 'SUCCESS').length}/${last.length} módulos ok${bad.length ? ' · falhou ' + esc(bad.map(x => x.name).join(', ')) : ''}</span>`); }
  if (tests) chips.push(`<span class="bchip ${+tests[2] + +tests[3] ? 'bad' : 'ok'}">testes: ${tests[1]} · falhas ${tests[2]} · erros ${tests[3]}</span>`);
  if (deps.size) chips.push(`<span class="bchip bad" title="${esc([...deps].join('\n'))}">${deps.size} dependência(s) não encontrada(s): ${esc([...deps][0])}${deps.size > 1 ? '…' : ''}</span><span class="bhint">${bcDepsHint()}</span>`);
  const errs = [...comp.values()];
  el.innerHTML = chips.join('') + (errs.length ? `<div class="berrs"><b>${errs.length} erro(s) de compilação</b>${errs.slice(0, 30).map(e => { const t = bcMap(e.file); return `<a class="fref" data-rel="${esc(t && t.rel || '')}" data-root="${esc(t && t.outside ? t.outside.root : '')}" data-orel="${esc(t && t.outside ? t.outside.rel : '')}" data-line="${e.line}" title="${esc(e.file)}"><span>${esc(e.file.split(/[\\/]/).pop())}:${e.line}</span> ${esc(e.msg)}</a>`; }).join('')}</div>` : '');
  el.hidden = !el.innerHTML;
}
function bcDepsHint() {
  const sel = bcSelected(); const other = BC.info && (BC.info.repos || [])[0];
  if (sel.offline) return 'Desligue o modo offline para baixar.';
  if (sel.repo === 'user' && other) return `Tente o repositório "${esc(other.label)}" na janela Build.`;
  return 'Confira a rede (VPN) e se o artefato existe no repositório escolhido.';
}
// cliques em arquivos do console
document.addEventListener('click', (e) => {
  const a = e.target.closest('#buildCon .fref'); if (!a) return;
  e.preventDefault(); const line = +a.dataset.line || undefined;
  if (a.dataset.rel) openFile(a.dataset.rel, 'editor', line);
  else if (a.dataset.root) openOutside(a.dataset.root, a.dataset.orel, line || 1);
});
$('#bcClose').onclick = () => { $('#buildCon').hidden = true; };
$('#bcStop').onclick = async () => { const r = BC.run; if (r && r.kind === 'local') { try { await api('build/stop', { id: r.id }, { method: 'POST' }); } catch (e) { toast(e.message); } } };
$('#bcRerun').onclick = () => { const l = BC.last || store.get('buildLast:' + (S.project && S.project.path), null); if (l && l.file) bcRunFile(); else if (l) bcRun(l.task, l.custom); };
$('#bcCopy').onclick = () => BC.run && copyText(BC.run.lines.join('\n'));
$('#bcSeg').querySelectorAll('button').forEach(b => b.onclick = () => { BC.view = b.dataset.v; $('#bcSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); bcAppend(0); });
// altura do console: arrastar a borda de cima
$('#bcResize').addEventListener('mousedown', (e) => {
  e.preventDefault(); const con = $('#buildCon'); const y0 = e.clientY, h0 = con.offsetHeight; document.body.classList.add('resizing-v');
  const move = (ev) => { const h = Math.max(120, Math.min(innerHeight - 160, h0 + (y0 - ev.clientY))); con.style.height = h + 'px'; };
  const up = () => { document.body.classList.remove('resizing-v'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); store.set('bcH', con.offsetHeight); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
});
$('#buildCon').style.height = store.get('bcH', 280) + 'px';
// Ctrl+F9 (Build Project no IntelliJ): repete o último build deste projeto, ou compila
function bcBuildShortcut() {
  if (!S.project) return;
  const l = BC.last || store.get('buildLast:' + S.project.path, null);
  if (l && l.file) return bcRunFile();
  if (l) bcRun(l.task, l.custom);
  else { const i = BC.info; const t = i && (i.tasks.find(x => x.id === 'compile') || i.tasks.find(x => /^(Build|Compilar)$/.test(x.label))); if (t) bcRun(t.id); else openTool('build'); }
}

// ----- registro no núcleo -----
bs.tools.register({ id: 'build', title: 'Build', icon: HAMMER, key: 'Alt+6', order: 60, render: renderBuild });
bs.keys.add('Ctrl+F9', () => bcBuildShortcut());
bs.keys.add('Ctrl+Shift+F10', () => bcRunFile());
bs.actions.add([
  { label: 'Build: repetir o último', k: 'Ctrl+F9', run: () => bcBuildShortcut(), icon: HAMMER },
  { label: 'Build: compilar', k: '', run: () => bcRun('compile'), icon: HAMMER },
  { label: 'Executar o arquivo aberto', k: 'Ctrl+Shift+F10', run: () => bcRunFile(), icon: PLAY },
  { label: 'Janela Build', k: 'Alt+6', run: () => openTool('build'), icon: HAMMER },
]);
bs.hooks.on('project:select', () => { BC.info = null; BC.infoFor = null; BC.runs = []; BC.last = null; });
bs.build = {
  info: () => (BC.info && S.project && BC.infoFor === S.project.path ? BC.info : null),
  selected: bcSelected,
  run: (task, custom) => bcRun(task, custom),
  showLog: bcShowLog,
  current: () => BC.run,
  render: () => { if (S.tool === 'build') renderBuild(); },
  icon: HAMMER,
};
})(window.BS);
