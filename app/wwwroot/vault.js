/* BlueScreen: Cofre (plugins/vault.rs). Tokens que você guarda uma vez e libera para os plugins que quiser.
   O valor nunca passa por esta tela: entra pela área de transferência, lida pelo núcleo, e fica cifrado (DPAPI).
   Gravar, liberar um plugin e acrescentar sites ou programas pedem um "Sim" numa caixa nativa do Windows, que o
   JavaScript da página não clica; tirar acesso e apagar não pedem. Abre pela aba Plugins (ícone da chave), pelo
   Buscar em tudo ("Cofre") e por plugin.vault.request(nome) no ui.js de um plugin. */
(function (bs) {
if (bs.doc) return;
const { $, esc, toast, api } = bs;
const KEY = '<svg class="i" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2"/></svg>';
const V = { data: null, focus: null, form: null, edit: null };

const post = async (body, wait) => {
  // as ações que ampliam acesso esperam o "Sim" na caixa do Windows
  if (wait) toast('Confirme na janela do Windows…', '', 'vault-ask');
  V.data = await api('vault', {}, { method: 'POST', body: JSON.stringify(body) });
  return V.data;
};
const load = async () => { V.data = await api('vault'); mark(); return V.data; };
const pending = () => (V.data ? V.data.requests : []).filter(r => !r.granted || (r.reveal && !r.revealGranted));
// ponto na chave da aba Plugins quando algum plugin pede um segredo que ainda não foi liberado
function mark() { const b = $('#plVault'); if (b) b.classList.toggle('dot', pending().some(r => !r.granted)); }

const chips = (list, empty) => list && list.length ? list.map(h => `<span class="vt-chip">${esc(h)}</span>`).join('') : `<span class="vt-none">${esc(empty)}</span>`;
const pname = (id) => (bs.plugins.list.find(p => p.id === id) || { name: id }).name;
const picon = (id) => bs.plugIcon(bs.plugins.list.find(p => p.id === id) || { id, name: id }, 'vt-pi');

function requestCard(r) {
  const what = !r.granted ? (r.exists ? 'Permitir' : 'Criar…') : 'Deixar ver o valor';
  return `<div class="vt-req ${V.focus && V.focus.plugin === r.plugin && V.focus.key === r.key ? 'focus' : ''}" data-plugin="${esc(r.plugin)}" data-key="${esc(r.key)}">
    ${picon(r.plugin)}
    <div class="vt-tx"><div><b>${esc(r.pluginName)}</b> pede <code>${esc(r.key)}</code>${r.label ? ` · ${esc(r.label)}` : ''}</div>
      ${r.why ? `<div class="vt-why">${esc(r.why)}</div>` : ''}
      ${r.hosts && r.hosts.length ? `<div class="vt-row">Sites: ${chips(r.hosts)}</div>` : ''}
      ${!r.granted && r.reveal ? '<div class="vt-warn">Também quer ver o valor (só servidores de plugin).</div>' : ''}
      ${r.granted && r.reveal && !r.revealGranted ? '<div class="vt-warn">Quer ver o valor: só libere para plugins em que você confia.</div>' : ''}</div>
    <button class="chip ${r.granted ? '' : 'primary'}" data-req>${what}</button></div>`;
}
function entryCard(e) {
  const grants = Object.entries(e.grants || {});
  const editing = V.edit === e.name;
  const others = bs.plugins.list.filter(p => !(e.grants || {})[p.id]);
  return `<div class="vt-ent" data-name="${esc(e.name)}">
    <div class="vt-hd"><span class="vt-key">${KEY}</span><div class="vt-tx"><div><b>${esc(e.name)}</b>${e.label ? ` <span class="vt-lbl">${esc(e.label)}</span>` : ''}</div>
      <div class="vt-meta">${e.hint ? `${esc(e.hint)}… · ` : ''}${e.length} caracteres · trocado ${esc(bs.ago(e.updated))}${e.lastUsed ? ` · usado ${esc(bs.ago(e.lastUsed))} por ${esc(pname(e.lastBy))}` : ' · nunca usado'}</div></div>
      <button class="icon-btn" data-act="menu" title="Mais">${bs.TI.more}</button></div>
    ${editing ? `<div class="vt-form">
        <label class="fld">Descrição<input data-f="label" value="${esc(e.label || '')}" spellcheck="false"></label>
        <label class="fld">Sites liberados <small class="pl-help">separados por vírgula; *.dominio.com vale para os subdomínios</small><input data-f="hosts" value="${esc((e.hosts || []).join(', '))}" spellcheck="false" placeholder="api.github.com"></label>
        <label class="fld">Programas liberados <small class="pl-help">recebem o segredo numa variável de ambiente</small><input data-f="programs" value="${esc((e.programs || []).join(', '))}" spellcheck="false" placeholder="gh, git"></label>
        <label class="fld">Anotação<input data-f="note" value="${esc(e.note || '')}" spellcheck="false"></label>
        <div class="vt-btns"><button class="chip" data-act="cancel">Cancelar</button><button class="chip primary" data-act="save">Salvar</button></div></div>`
    : `<div class="vt-row">Sites: ${chips(e.hosts, 'nenhum (só servidores de plugin usam)')}</div>
       <div class="vt-row">Programas: ${chips(e.programs, 'nenhum')}</div>
       ${e.note ? `<div class="vt-why">${esc(e.note)}</div>` : ''}`}
    <div class="vt-grants">${grants.length ? grants.map(([id, g]) => `<div class="vt-g" data-plugin="${esc(id)}">${picon(id)}<span class="vt-gn">${esc(pname(id))}</span>
        <label title="O plugin usa sem ver o valor"><input type="checkbox" data-g="use" ${g.use ? 'checked' : ''}> usar</label>
        <label title="O plugin lê o valor (só servidores de plugin)"><input type="checkbox" data-g="reveal" ${g.reveal ? 'checked' : ''}> ver valor</label>
        <button class="icon-btn" data-g="off" title="Tirar o acesso">${bs.I.x}</button></div>`).join('') : '<div class="vt-none">Nenhum plugin pode usar ainda.</div>'}
      ${others.length ? `<select class="vt-add"><option value="">Liberar para um plugin…</option>${others.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : ''}</div></div>`;
}
function newForm() {
  const f = V.form || {};
  return `<div class="vt-new"><div class="vt-sub">Novo segredo</div>
    <p class="vt-why">Copie o token (no site do serviço) e clique em <b>Colar e guardar</b>. Ele vai direto da área de transferência para o cofre, sem passar por esta tela.</p>
    <div class="vt-2"><label class="fld">Nome<input id="vtName" value="${esc(f.name || '')}" spellcheck="false" placeholder="github"></label>
      <label class="fld">Descrição<input id="vtLabel" value="${esc(f.label || '')}" spellcheck="false" placeholder="Token do GitHub"></label></div>
    <label class="fld">Sites liberados <small class="pl-help">para onde o token pode ir, em HTTPS: api.github.com, *.atlassian.net</small><input id="vtHosts" value="${esc((f.hosts || []).join(', '))}" spellcheck="false"></label>
    <label class="fld">Programas liberados <small class="pl-help">opcional: recebem o token numa variável de ambiente (gh, git)</small><input id="vtProgs" value="${esc((f.programs || []).join(', '))}" spellcheck="false"></label>
    ${f.plugin ? `<label class="chk vt-chk"><input type="checkbox" id="vtGrant" checked> Liberar para ${esc(pname(f.plugin))}</label>` : ''}
    <label class="chk vt-chk"><input type="checkbox" id="vtClear" checked> Limpar a área de transferência depois</label>
    <div class="vt-btns"><button class="chip primary" id="vtPaste">${KEY}Colar e guardar</button></div></div>`;
}

function render() {
  const d = V.data || { entries: [], requests: [], audit: [] };
  const reqs = pending();
  return `<div class="dlg-hd"><span class="dlg-ic">${KEY}</span><div><h3>Cofre</h3><p>Tokens que você guarda uma vez e libera para os plugins. Ficam cifrados neste PC, e os plugins usam sem ver o valor, só nos sites que você liberar.</p></div></div>
    <div class="vt-body">
    ${reqs.length ? `<div class="vt-sub">Pedidos dos plugins</div>${reqs.map(requestCard).join('')}` : ''}
    <div class="vt-sub">Segredos${d.entries.length ? ` <span class="vt-n">${d.entries.length}</span>` : ''}</div>
    ${d.entries.length ? d.entries.map(entryCard).join('') : '<div class="vt-none vt-empty">O cofre está vazio.</div>'}
    ${newForm()}
    ${d.audit.length ? `<details class="vt-log"><summary>Registro de uso <span class="vt-n">${d.audit.length}</span></summary>${d.audit.slice(0, 60).map(a => `<div class="${a.ok ? '' : 'bad'}"><span>${esc(bs.ago(a.at))}</span><b>${esc(pname(a.plugin))}</b> <code>${esc(a.name)}</code> ${esc(a.target || '')}${a.ok ? '' : ` · <em>${esc(a.why)}</em>`}</div>`).join('')}</details>` : ''}
    </div>
    <div class="actions"><span class="vt-file" title="${esc(d.file || '')}">~/.bluescreen/vault.json</span><span class="spacer"></span><button class="chip" data-close>Fechar</button></div>`;
}

async function act(fn, wait) {
  try { await fn(); } catch (e) { if (e.message !== 'cancelado') toast(e.message); else toast('Cancelado'); }
  draw();
}
function draw() {
  const el = window.dialog('vaultDlg', render(), bind);
  el.querySelector('.dlg-box').classList.add('vt-box');
  mark();
}
function bind(el) {
  const val = (id) => (el.querySelector('#' + id) || {}).value || '';
  // pedidos: liberar ou criar já com os sites que o plugin sugeriu
  el.querySelectorAll('.vt-req').forEach(c => c.querySelector('[data-req]').onclick = () => {
    const r = V.data.requests.find(x => x.plugin === c.dataset.plugin && x.key === c.dataset.key);
    if (!r.exists) { V.form = { name: r.key, label: r.label || '', hosts: r.hosts || [], programs: r.programs || [], plugin: r.plugin }; draw(); el.querySelector('#vtPaste')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    act(() => post({ action: 'grant', name: r.key, plugin: r.plugin, use: true, reveal: r.granted ? true : undefined }, true));
  });
  el.querySelectorAll('.vt-ent').forEach(c => {
    const name = c.dataset.name;
    c.querySelector('[data-act="menu"]').onclick = (ev) => bs.showMenu(ev, [
      { label: 'Trocar o valor (colar)', icon: KEY, action: () => act(() => post({ action: 'paste', name, clear: true }, true)) },
      { label: 'Editar sites e programas', icon: bs.I.edit, action: () => { V.edit = name; draw(); } },
      '-',
      { label: 'Apagar do cofre…', icon: bs.I.x, action: () => window.dialog('vtDel', `<div class="dlg-hd"><span class="dlg-ic del">${bs.I.x}</span><div><h3>Apagar "${esc(name)}" do cofre?</h3><p>Os plugins que usam este segredo param de funcionar até você guardar outro com o mesmo nome.</p></div></div>
          <div class="actions"><button class="chip" data-close>Cancelar</button><button class="chip danger" id="vtDelOk">Apagar</button></div>`, (d) => { d.querySelector('#vtDelOk').onclick = () => { d.hidden = true; act(() => post({ action: 'delete', name })); }; }) },
    ], name);
    const save = c.querySelector('[data-act="save"]');
    if (save) {
      save.onclick = () => { const f = (k) => c.querySelector(`[data-f="${k}"]`).value; V.edit = null; act(() => post({ action: 'edit', name, label: f('label'), note: f('note'), hosts: f('hosts'), programs: f('programs') }, true)); };
      c.querySelector('[data-act="cancel"]').onclick = () => { V.edit = null; draw(); };
    }
    c.querySelectorAll('.vt-g').forEach(g => {
      const plugin = g.dataset.plugin, cur = (V.data.entries.find(x => x.name === name).grants || {})[plugin] || {};
      g.querySelectorAll('input[data-g]').forEach(cb => cb.onchange = () => {
        const next = { use: !!cur.use, reveal: !!cur.reveal, [cb.dataset.g]: cb.checked };
        act(() => post({ action: 'grant', name, plugin, use: next.use, reveal: next.reveal }, cb.checked));
      });
      g.querySelector('[data-g="off"]').onclick = () => act(() => post({ action: 'grant', name, plugin, use: false, reveal: false }));
    });
    const add = c.querySelector('.vt-add');
    if (add) add.onchange = () => add.value && act(() => post({ action: 'grant', name, plugin: add.value, use: true }, true));
  });
  const paste = el.querySelector('#vtPaste');
  if (paste) paste.onclick = () => {
    const name = val('vtName').trim();
    V.form = { ...(V.form || {}), name, label: val('vtLabel'), hosts: val('vtHosts').split(',').map(s => s.trim()).filter(Boolean), programs: val('vtProgs').split(',').map(s => s.trim()).filter(Boolean) };
    if (!name) { toast('Dê um nome ao segredo (ex.: github)'); return; }
    const grantTo = V.form.plugin && el.querySelector('#vtGrant')?.checked ? V.form.plugin : null;
    act(async () => {
      await post({ action: 'paste', name, label: V.form.label, hosts: V.form.hosts, programs: V.form.programs, clear: el.querySelector('#vtClear').checked }, true);
      V.form = null; toast(`"${name}" guardado no cofre`, 'ok');
      if (grantTo) await post({ action: 'grant', name, plugin: grantTo, use: true }, true);
    });
  };
}

async function open(focus) {
  V.focus = focus || null;
  try { await load(); } catch (e) { return toast('Cofre: ' + e.message); }
  if (focus && focus.key) {
    const r = V.data.requests.find(x => x.plugin === focus.plugin && x.key === focus.key);
    if (!V.data.entries.some(e => e.name === focus.key)) V.form = { name: focus.key, label: r?.label || '', hosts: r?.hosts || [], programs: r?.programs || [], plugin: focus.plugin };
  }
  draw();
}

bs.vault = { open, refresh: load };
bs.actions.add({ label: 'Cofre de segredos (tokens dos plugins)', icon: KEY, run: () => open() });
bs.hooks.on('refresh', () => load().catch(() => {}));
// depois de os plugins carregarem: o ponto na chave avisa pedidos pendentes
setTimeout(() => load().catch(() => {}), 1500);
})(window.BS);
