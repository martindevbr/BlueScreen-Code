/* BlueScreen: SDKs e runtimes baixados pela própria IDE, como o "Download JDK" do IntelliJ, para todas as linguagens
   que o núcleo sabe baixar (sdk.rs): JDK de vários fornecedores, Maven, Gradle, Node.js, Python, Go, .NET, Rust, Zig e
   Kotlin. Você escolhe a versão (e o fornecedor, no Java), a IDE baixa o pacote oficial, confere a soma e extrai, sem
   instalador e sem administrador. O SDK padrão de cada tipo entra no PATH do terminal, do build e dos servidores de
   linguagem.
     bs.sdk.open(kind)              janela de SDKs (kind: 'jdk', 'node'... abre já naquele tipo)
     bs.sdk.quick(kind, o)          baixa a versão recomendada sem perguntar; o: { min, onStep(st) } → Promise
     bs.sdk.forProgram(prog)        tipo de SDK que fornece um programa (npm → node, mvn → maven...)
   Gancho: 'sdk:installed' (kind) depois de cada download. */
(function (bs) {
'use strict';

const SD = { kinds: null, sel: store.get('sdkKind', 'jdk'), pkgs: {}, pre: false, vendor: store.get('sdkVendor', 'temurin'), busy: {} };
const DL = '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const TRASH = '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
const PROG = { npm: 'node', npx: 'node', node: 'node', yarn: 'node', pnpm: 'node', pip: 'python', python: 'python', py: 'python', go: 'go', dotnet: 'dotnet', cargo: 'rust', rustc: 'rust', rustup: 'rust', mvn: 'maven', gradle: 'gradle', java: 'jdk', javac: 'jdk', zig: 'zig', kotlinc: 'kotlin' };
const NAMES = { jdk: 'Java (JDK)', maven: 'Maven', gradle: 'Gradle', node: 'Node.js', python: 'Python', go: 'Go', dotnet: '.NET SDK', rust: 'Rust', zig: 'Zig', kotlin: 'Kotlin' };
const mb = (n) => n ? (n / 1048576).toFixed(0) + ' MB' : '';

async function loadKinds() { SD.kinds = (await api('sdk/list')).kinds; return SD.kinds; }
async function loadPkgs(kind, fresh) {
  if (SD.pkgs[kind] && !fresh) return SD.pkgs[kind];
  SD.pkgs[kind] = (await api('sdk/versions', { kind, fresh: fresh ? '1' : null })).pkgs;
  return SD.pkgs[kind];
}
// versão recomendada: Java LTS mais novo da Temurin (ou do fornecedor escolhido) que atenda ao mínimo; Node e .NET LTS;
// nos outros, a mais nova que não é pré-lançamento
function recommended(kind, pkgs, min) {
  const ok = pkgs.filter(p => !p.pre && (!min || +p.major >= min));
  if (kind === 'jdk') {
    const v = ok.filter(p => p.vendor === SD.vendor).length ? SD.vendor : 'temurin';
    const mine = ok.filter(p => p.vendor === v);
    return mine.find(p => p.lts) || mine[0] || ok.find(p => p.lts) || ok[0];
  }
  if (kind === 'node' || kind === 'dotnet') return ok.find(p => p.lts) || ok[0];
  return ok[0] || pkgs[0];
}

// acompanha um download (o mesmo formato de andamento das instalações de servidores de linguagem)
async function track(job, onStep) {
  let j = { state: 'running' };
  while (j && j.state === 'running') {
    await new Promise(r => setTimeout(r, 400));
    try { j = await api('sdk/install', { job }); } catch (e) { j = { state: 'error', error: e.message, log: [] }; }
    onStep && onStep(j || {});
  }
  return j || { state: 'error', error: 'o andamento se perdeu' };
}
async function install(kind, pkg, onStep) {
  const key = kind + ':' + pkg.id;
  if (SD.busy[key]) return SD.busy[key];
  const run = (async () => {
    const r = await api('sdk/install', { kind, id: pkg.id }, { method: 'POST' });
    onStep && onStep(r.status || {});
    const j = await track(r.job, onStep);
    if (j.state !== 'done') throw Object.assign(new Error(j.error || 'falhou'), { log: j.log });
    SD.kinds = null;
    bs.hooks.run('sdk:installed', kind);
    return j;
  })();
  SD.busy[key] = run;
  try { return await run; } finally { delete SD.busy[key]; }
}
async function quick(kind, o = {}) {
  const pkgs = await loadPkgs(kind);
  const p = recommended(kind, pkgs, o.min);
  if (!p) throw new Error('nenhuma versão de ' + (NAMES[kind] || kind) + (o.min ? ' ' + o.min + '+' : '') + ' disponível');
  o.onStep && o.onStep({ step: `Baixando ${NAMES[kind] || kind} ${p.vendor_name ? p.vendor_name + ' ' : ''}${p.version}…` });
  await install(kind, p, o.onStep);
  return p;
}

// ---------- janela ----------
function open(kind) {
  if (kind) { SD.sel = kind; store.set('sdkKind', kind); }
  dialog('sdkDlg', `<div class="dlg-hd"><span class="dlg-ic">${I.pkg}</span><div><h3>SDKs e runtimes</h3><p>Baixe qualquer versão direto pela IDE. Sem instalador e sem administrador.</p></div></div>
    <div class="sdk-wrap"><nav class="sdk-nav" id="sdkNav"></nav><section class="sdk-main" id="sdkMain"><div class="empty"><span class="spin"></span> Lendo…</div></section></div>`,
    (el) => el.querySelector('.dlg-box').classList.add('sdk-box'));
  render();
}
async function render() {
  const nav = document.getElementById('sdkNav'); if (!nav) return;
  try { if (!SD.kinds) await loadKinds(); } catch (e) { document.getElementById('sdkMain').innerHTML = `<div class="errbox">${esc(e.message)}</div>`; return; }
  nav.innerHTML = SD.kinds.map(k => `<button class="sdk-k ${k.id === SD.sel ? 'on' : ''}" data-k="${k.id}"><span>${esc(k.name)}</span>${k.installed.length ? `<em>${k.installed.length}</em>` : ''}</button>`).join('');
  nav.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { SD.sel = b.dataset.k; store.set('sdkKind', SD.sel); render(); });
  renderMain();
}
async function renderMain() {
  const main = document.getElementById('sdkMain'); if (!main) return;
  const k = SD.kinds.find(x => x.id === SD.sel) || SD.kinds[0];
  const row = (x) => `<div class="sdk-row ${x.default ? 'def' : ''}"><div class="nm"><b>${esc(x.version)}</b>${x.default ? '<span class="tag ok">padrão</span>' : ''}${x.managed ? '' : '<span class="tag">do sistema</span>'}<small title="${esc(x.path)}">${esc(x.path)}</small></div>
      ${x.managed && !x.default ? `<button class="chip" data-def="${esc(x.path)}" title="Entra no PATH do terminal, do build e dos servidores de linguagem">Usar como padrão</button>` : ''}
      ${x.default && k.explicit && k.id !== 'rust' ? `<button class="chip" data-def="" title="Volta a usar o mais novo baixado (ou o do sistema)">Deixar automático</button>` : ''}
      ${x.managed ? `<button class="icon-btn" data-rm="${esc(x.path)}" title="Remover">${TRASH}</button>` : ''}</div>`;
  main.innerHTML = `<div class="sdk-hd"><b>${esc(k.name)}</b><span>${esc(k.desc)}</span></div>
    <div class="sdk-sec">Instalados</div>
    ${k.installed.length ? k.installed.map(row).join('') : '<div class="sdk-none">Nenhum ainda.</div>'}
    <div class="sdk-sec">Baixar</div>
    <div class="sdk-dl" id="sdkDl"><div class="empty"><span class="spin"></span> Buscando as versões…</div></div>`;
  main.querySelectorAll('[data-def]').forEach(b => b.onclick = async () => { try { await api('sdk/default', { kind: k.id, path: b.dataset.def }, { method: 'POST' }); SD.kinds = null; render(); afterChange(k.id); } catch (e) { toast(e.message); } });
  main.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.classList.add('danger'); b.title = 'Clique de novo para remover'; toast('Clique de novo na lixeira para remover'); return; }
    b.disabled = true;
    try { await api('sdk/remove', { kind: k.id, path: b.dataset.rm }, { method: 'POST' }); SD.kinds = null; render(); afterChange(k.id); } catch (e) { toast(e.message); b.disabled = false; }
  });
  let pkgs;
  try { pkgs = await loadPkgs(k.id); } catch (e) { const d = document.getElementById('sdkDl'); if (d) d.innerHTML = `<div class="errbox"><b>Não deu para buscar a lista.</b><div>${esc(e.message)}</div></div><button class="chip" id="sdkRetry">Tentar de novo</button>`; document.getElementById('sdkRetry')?.addEventListener('click', () => { delete SD.pkgs[k.id]; renderMain(); }); return; }
  if (SD.sel !== k.id) return;
  renderDl(k, pkgs);
}
function renderDl(k, pkgs) {
  const box = document.getElementById('sdkDl'); if (!box) return;
  const isJdk = k.id === 'jdk';
  const vendors = isJdk ? [...new Map(pkgs.map(p => [p.vendor, p.vendor_name])).entries()] : [];
  if (isJdk && !vendors.some(([v]) => v === SD.vendor)) SD.vendor = 'temurin';
  const list = pkgs.filter(p => (SD.pre || !p.pre) && (!isJdk || p.vendor === SD.vendor));
  const rec = recommended(k.id, pkgs);
  const groups = [...new Set(list.map(p => p.major))];
  const label = (p) => `${p.version}${p.lts ? ' · LTS' : ''}${p.pre ? ' · pré-lançamento' : ''}${p.size ? ' · ' + mb(p.size) : ''}`;
  const opts = groups.map(g => { const ps = list.filter(p => p.major === g); return ps.length === 1 && !isJdk ? `<option value="${esc(ps[0].id)}">${esc(label(ps[0]))}</option>` : `<optgroup label="${esc(isJdk ? 'Java ' + g : g)}">${ps.map(p => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('')}</optgroup>`; }).join('');
  const installedDirs = new Set(k.installed.map(x => x.path.split(/[\\/]/).pop().toLowerCase()));
  box.innerHTML = `<div class="sdk-form">
      ${isJdk ? `<label>Fornecedor<select id="sdkVendor">${vendors.map(([v, n]) => `<option value="${esc(v)}" ${v === SD.vendor ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
      <label>Versão<select id="sdkVer">${opts || '<option value="">nenhuma</option>'}</select></label>
      <label class="chk"><input type="checkbox" id="sdkPre" ${SD.pre ? 'checked' : ''}>Mostrar pré-lançamentos</label>
    </div>
    <div class="where" id="sdkWhere"></div>
    <div class="sdk-go"><button class="chip primary" id="sdkGo">${DL}Baixar</button><button class="icon-btn" id="sdkRef" title="Atualizar a lista de versões">${I.refresh}</button></div>
    <div class="nt-row sdk-prog" id="sdkProg" hidden><div class="nt-prog"><div class="nt-bar"><i></i></div><span class="nt-step"></span><a data-a="log">log</a></div><pre class="nt-log" hidden></pre></div>`;
  const sel = box.querySelector('#sdkVer');
  const pick = list.includes(rec) ? rec : list[0];
  if (pick) sel.value = pick.id;
  const cur = () => list.find(p => p.id === sel.value);
  const where = () => {
    const p = cur(); const w = box.querySelector('#sdkWhere'); const go = box.querySelector('#sdkGo');
    if (!p) { w.textContent = ''; go.disabled = true; return; }
    const dup = installedDirs.has(p.dir.toLowerCase());
    w.textContent = k.id === 'rust' ? 'pelo rustup em ~/.cargo e ~/.rustup' : '→ ' + k.root + '\\' + p.dir + (dup ? '   (já instalado: baixa de novo)' : '');
    go.disabled = false;
  };
  where(); sel.onchange = where;
  box.querySelector('#sdkVendor')?.addEventListener('change', (e) => { SD.vendor = e.target.value; store.set('sdkVendor', SD.vendor); renderDl(k, pkgs); });
  box.querySelector('#sdkPre').onchange = (e) => { SD.pre = e.target.checked; renderDl(k, pkgs); };
  box.querySelector('#sdkRef').onclick = () => { delete SD.pkgs[k.id]; renderMain(); };
  const prog = box.querySelector('#sdkProg'), bar = prog.querySelector('.nt-bar'), fill = bar.querySelector('i'), step = prog.querySelector('.nt-step'), log = prog.querySelector('.nt-log');
  prog.querySelector('[data-a="log"]').onclick = () => { log.hidden = !log.hidden; };
  box.querySelector('#sdkGo').onclick = async () => {
    const p = cur(); if (!p) return;
    const go = box.querySelector('#sdkGo'); go.disabled = true; prog.hidden = false; prog.classList.remove('err'); prog.dataset.st = 'running';
    const show = (j) => { bar.classList.toggle('indet', j.progress == null); fill.style.width = j.progress == null ? '' : Math.round(j.progress * 100) + '%'; if (j.step) step.textContent = j.step; if (j.log) log.textContent = j.log.join('\n'); };
    try {
      await install(k.id, p, show);
      prog.dataset.st = 'done'; bar.classList.remove('indet'); fill.style.width = '100%'; step.textContent = 'Instalado';
      toast(`${k.name} ${p.vendor_name ? p.vendor_name + ' ' : ''}${p.version} instalado`, 'ok');
      afterChange(k.id);
      await loadKinds(); if (SD.sel === k.id) render();
    } catch (e) {
      prog.dataset.st = ''; prog.classList.add('err'); bar.classList.remove('indet'); step.textContent = e.message; if (e.log) log.textContent = e.log.join('\n'); go.disabled = false;
    }
  };
}
// o que muda fora da janela: servidores de linguagem (um runtime novo libera npm/pip/go...) e o build (JDK, Maven)
function afterChange(kind) {
  if (bs.lsp && bs.lsp.refresh) bs.lsp.refresh().catch(() => {});
  if (bs.build && bs.build.reload) bs.build.reload();
}

bs.sdk = { open, quick, install, forProgram: (p) => PROG[String(p || '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '')] || null, name: (k) => NAMES[k] || k, recommended: (k, pkgs, min) => recommended(k, pkgs, min), versions: loadPkgs };
bs.actions.add([
  { label: 'SDKs e runtimes…', k: '', run: () => open(), icon: I.pkg },
  ...Object.entries(NAMES).map(([id, n]) => ({ label: `Baixar ${n}…`, k: '', run: () => open(id), icon: I.pkg })),
]);
})(window.BS);
