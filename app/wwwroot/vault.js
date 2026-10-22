/* BlueScreen: Cofre (plugins/vault.rs). Tokens que você guarda uma vez e libera para os plugins que quiser.
   O valor nunca passa por esta tela: é digitado numa janela nativa do Windows aberta pelo núcleo, com os campos que o
   plugin pediu (token, usuário e senha...; "fields" no plugin.json), e fica cifrado (DPAPI).
   Gravar, liberar um plugin e acrescentar sites ou programas pedem um "Sim" numa caixa nativa do Windows, que o
   JavaScript da página não clica; tirar acesso e apagar não pedem. Abre pelo ícone da chave na barra da esquerda
   (Alt+8), pela faixa no topo da aba Plugins, pelo Buscar em tudo ("Cofre") e por plugin.vault.request(nome). */
(function (bs) {
if (bs.doc) return;
const { $, esc, toast, api } = bs;
const KEY = '<svg class="i" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M14 9l2 2"/></svg>';
const V = { data: null, focus: null, form: null, edit: null };

const post = async (body, wait) => {
  // as ações que ampliam acesso esperam o "Sim" na caixa do Windows
  if (wait) toast(body.action === 'enter' ? 'Digite na janela do Windows…' : 'Confirme na janela do Windows…', '', 'vault-ask');
  V.data = await api('vault', {}, { method: 'POST', body: JSON.stringify(body) });
  return V.data;
};
const load = async () => { V.data = await api('vault'); mark(); return V.data; };
const pending = () => (V.data ? V.data.requests : []).filter(r => !r.granted || (r.reveal && !r.revealGranted));
// número no ícone da barra lateral e faixa da aba Plugins: pedidos de plugins ainda não liberados; e a tela de
// configuração de um plugin (gate) aberta é redesenhada se o que ela mostra mudou
function mark() {
  const n = pending().filter(r => !r.granted).length;
  const b = $('#badge-vault'); if (b) { b.hidden = !n; b.textContent = n; }
  const ban = $('.vt-wrap'); if (ban) ban.outerHTML = banner();
  bindBanner(document);
  const t = G.tool && bs.tools.get(G.tool);
  if (t && bs.S.tool === G.tool && gateSig(t.plugin) !== G.sig) bs.renderTool();
}
// faixa no topo da aba Plugins: o que tem no cofre e o que os plugins pedem
function banner() {
  const d = V.data; const n = d ? d.entries.length : 0; const p = pending().filter(r => !r.granted).length;
  const sub = !d ? 'Tokens e senhas que os plugins usam sem ver o valor.' : `${n ? `${n} segredo${n > 1 ? 's' : ''} guardado${n > 1 ? 's' : ''}` : 'Nenhum segredo guardado'}${p ? ` · <b>${p} pedido${p > 1 ? 's' : ''} de plugin</b>` : ''}`;
  return `<div class="vt-wrap"><div class="vt-banner ${p ? 'ask' : ''}"><span class="vt-key">${KEY}</span><div class="vt-tx"><div class="vt-bt">Cofre de credenciais</div><div class="vt-bs">${sub}</div></div><button class="chip ${p ? 'primary' : ''}" data-vault-open>Abrir cofre</button></div></div>`;
}
function bindBanner(root) { root.querySelectorAll('[data-vault-open]').forEach(b => b.onclick = () => open()); }

const chips = (list, empty) => list && list.length ? list.map(h => `<span class="vt-chip">${esc(h)}</span>`).join('') : `<span class="vt-none">${esc(empty)}</span>`;
// campos que o plugin pede (token, usuário e senha...): os rótulos para mostrar e a união de vários pedidos
const TOKEN = [{ key: 'value', label: 'Token', secret: true }];
// tipos prontos (token, usuário e senha, AWS, chave PEM...): vêm do núcleo (vault.rs, KINDS)
const kinds = () => (V.data && V.data.kinds) || [{ id: 'token', label: 'Um token (ou chave de API)', fields: TOKEN }];
const kindChips = (id) => ((kinds().find(k => k.id === id) || kinds()[0]).fields || []).map(x => `<span class="vt-chip">${esc(x.label || x.key)}${x.optional ? ' (opcional)' : ''}</span>`).join('');
const fieldsTxt = (f) => (f && f.length ? f : TOKEN).map(x => typeof x === 'string' ? x : x.label || x.key).join(' + ');
const mergeFields = (list) => { const out = []; for (const r of list) for (const f of r.fields || []) if (!out.some(x => x.key === f.key)) out.push(f); return out; };
const pname = (id) => (bs.plugins.list.find(p => p.id === id) || { name: id }).name;
const picon = (id) => bs.plugIcon(bs.plugins.list.find(p => p.id === id) || { id, name: id }, 'vt-pi');

function requestCard(r) {
  const what = !r.granted ? (r.exists ? 'Permitir' : 'Criar…') : 'Deixar ver o valor';
  const same = !r.exists ? (r.sameHosts || []) : [];
  return `<div class="vt-req ${V.focus && V.focus.plugin === r.plugin && V.focus.key === r.key ? 'focus' : ''}" data-plugin="${esc(r.plugin)}" data-key="${esc(r.key)}">
    ${picon(r.plugin)}
    <div class="vt-tx"><div><b>${esc(r.pluginName)}</b> pede <code>${esc(r.key)}</code>${r.label ? ` · ${esc(r.label)}` : ''}</div>
      ${!r.exists ? `<div class="vt-row">Você digita: <span class="vt-chip">${esc(fieldsTxt(r.fields))}</span></div>` : ''}
      ${r.why ? `<div class="vt-why">${esc(r.why)}</div>` : ''}
      ${r.hosts && r.hosts.length ? `<div class="vt-row">Sites: ${chips(r.hosts)}</div>` : ''}
      ${r.exists && r.entry && r.entry !== r.key ? `<div class="vt-why">Usa o segredo <code>${esc(r.entry)}</code>.</div>` : ''}
      ${!r.granted && r.reveal ? '<div class="vt-warn">Também quer ver o valor (só servidores de plugin).</div>' : ''}
      ${r.granted && r.reveal && !r.revealGranted ? '<div class="vt-warn">Quer ver o valor: só libere para plugins em que você confia.</div>' : ''}</div>
    <div class="vt-gbtns">${same.map(n => `<button class="chip primary" data-use="${esc(n)}" title="Já existe um segredo para este site">Usar “${esc(n)}”</button>`).join('')}<button class="chip ${r.granted || same.length ? '' : 'primary'}" data-req>${what}</button></div></div>`;
}
// pedidos ainda sem segredo para os mesmos sites: um cartão só (um token serve a todos)
const hostKey = (r) => (r.hosts || []).map(h => String(h).toLowerCase()).sort().join(',');
function grouped(reqs) {
  const out = [], by = new Map();
  for (const r of reqs) {
    const k = !r.exists && hostKey(r);
    if (!k) { out.push({ list: [r] }); continue; }
    if (!by.has(k)) { const g = { hosts: r.hosts, list: [] }; by.set(k, g); out.push(g); }
    by.get(k).list.push(r);
  }
  return out;
}
// nome para o segredo comum: o fim igual dos nomes (rastro.dynatrace, drilltrace.dynatrace -> dynatrace) ou o site
function suggestName(list) {
  const tails = list.map(r => r.key.split(/[.\-_:]/).pop().toLowerCase());
  if (tails.every(t => t === tails[0]) && tails[0].length > 2) return tails[0];
  const h = String((list[0].hosts || [])[0] || '').replace(/^\*\./, '').split('.');
  return h.length > 1 ? h[h.length - 2] : list[0].key;
}
function groupCard(g) {
  const same = [...new Set(g.list.flatMap(r => r.sameHosts || []))];
  return `<div class="vt-req vt-group" data-group="${esc(hostKey(g.list[0]))}">
    <span class="vt-key">${KEY}</span>
    <div class="vt-tx"><div><b>${g.list.length} plugins</b> pedem ${esc(fieldsTxt(mergeFields(g.list)).toLowerCase())} para ${chips(g.hosts)}</div>
      ${g.list.map(r => `<div class="vt-gp">${picon(r.plugin)}<div><b>${esc(r.pluginName)}</b> chama de <code>${esc(r.key)}</code>${r.reveal ? ' <span class="vt-warn">· quer ver o valor</span>' : ''}${r.why ? `<div class="vt-why">${esc(r.why)}</div>` : ''}</div></div>`).join('')}
      <div class="vt-why">Um segredo só serve a todos: cada plugin continua usando o nome dele.</div></div>
    <div class="vt-gbtns">${same.map(n => `<button class="chip primary" data-guse="${esc(n)}">Usar “${esc(n)}”</button>`).join('')}<button class="chip ${same.length ? '' : 'primary'}" data-gnew>Criar um para todos…</button></div></div>`;
}
function entryCard(e) {
  const grants = Object.entries(e.grants || {});
  const editing = V.edit === e.name;
  const others = bs.plugins.list.filter(p => !(e.grants || {})[p.id]);
  return `<div class="vt-ent" data-name="${esc(e.name)}">
    <div class="vt-hd"><span class="vt-key">${KEY}</span><div class="vt-tx"><div><b>${esc(e.name)}</b>${e.label ? ` <span class="vt-lbl">${esc(e.label)}</span>` : ''}</div>
      <div class="vt-meta">${e.fields && e.fields.length > 1 ? `${esc(e.fields.map(f => f.label || f.key).join(' + '))} · ` : ''}${e.hint ? `${esc(e.hint)}… · ` : ''}${e.length} caracteres · trocado ${esc(bs.ago(e.updated))}${e.lastUsed ? ` · usado ${esc(bs.ago(e.lastUsed))} por ${esc(pname(e.lastBy))}` : ' · nunca usado'}</div></div>
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
    <div class="vt-grants">${grants.length ? grants.map(([id, g]) => `<div class="vt-g" data-plugin="${esc(id)}">${picon(id)}<span class="vt-gn">${esc(pname(id))}${g.as ? ` <em title="o nome que o plugin usa">como ${esc(g.as)}</em>` : ''}</span>
        <label title="O plugin usa sem ver o valor"><input type="checkbox" data-g="use" ${g.use ? 'checked' : ''}> usar</label>
        <label title="O plugin lê o valor (só servidores de plugin)"><input type="checkbox" data-g="reveal" ${g.reveal ? 'checked' : ''}> ver valor</label>
        <button class="icon-btn" data-g="off" title="Tirar o acesso">${bs.I.x}</button></div>`).join('') : '<div class="vt-none">Nenhum plugin pode usar ainda.</div>'}
      ${others.length ? `<select class="vt-add"><option value="">Liberar para um plugin…</option>${others.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : ''}</div></div>`;
}
function newForm() {
  const f = V.form || {};
  // campos pedidos pelo plugin; sem pedido, você escolhe: um token ou usuário e senha
  const asked = f.fields && f.fields.length;
  return `<div class="vt-new"><div class="vt-sub">Novo segredo</div>
    <p class="vt-why">Clique em <b>Digitar e guardar</b>: abre uma janela do Windows pedindo ${asked ? `<b>${esc(fieldsTxt(f.fields).toLowerCase())}</b>` : 'o valor'}. Digite ou cole ali (Ctrl+V). O que você digita vai direto para o cofre, sem passar por esta tela.</p>
    ${asked ? `<div class="vt-row">O plugin pede: ${f.fields.map(x => `<span class="vt-chip">${esc(x.label || x.key)}${x.optional ? ' (opcional)' : ''}</span>`).join('')}</div>`
      : `<label class="fld">O que guardar<select id="vtKind">${kinds().map(k => `<option value="${esc(k.id)}" ${k.id === (f.kind || 'token') ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
         <div class="vt-row" id="vtKindF">Você digita: ${kindChips(f.kind || 'token')}</div>`}
    <div class="vt-2"><label class="fld">Nome<input id="vtName" value="${esc(f.name || '')}" spellcheck="false" placeholder="github"></label>
      <label class="fld">Descrição<input id="vtLabel" value="${esc(f.label || '')}" spellcheck="false" placeholder="Token do GitHub"></label></div>
    <label class="fld">Sites liberados <small class="pl-help">para onde o token pode ir, em HTTPS: api.github.com, *.atlassian.net</small><input id="vtHosts" value="${esc((f.hosts || []).join(', '))}" spellcheck="false"></label>
    <label class="fld">Programas liberados <small class="pl-help">opcional: recebem o token numa variável de ambiente (gh, git)</small><input id="vtProgs" value="${esc((f.programs || []).join(', '))}" spellcheck="false"></label>
    ${(f.plugins || []).map((p, i) => `<label class="chk vt-chk"><input type="checkbox" data-gp="${i}" checked> Liberar para ${esc(pname(p.plugin))} <span class="vt-mut">(como <code>${esc(p.as)}</code>${p.reveal ? ', vendo o valor' : ''})</span></label>`).join('')}
    <div class="vt-btns"><button class="chip primary" id="vtPaste">${KEY}Digitar e guardar…</button></div></div>`;
}

function render() {
  const d = V.data || { entries: [], requests: [], audit: [] };
  const reqs = pending();
  return `<div class="dlg-hd"><span class="dlg-ic">${KEY}</span><div><h3>Cofre de credenciais</h3><p>Tokens que você guarda uma vez e libera para os plugins. Ficam cifrados neste PC, e os plugins usam sem ver o valor, só nos sites que você liberar.</p></div></div>
    <div class="vt-body">
    ${reqs.length ? `<div class="vt-sub">Pedidos dos plugins</div>${grouped(reqs).map(g => g.list.length > 1 ? groupCard(g) : requestCard(g.list[0])).join('')}` : ''}
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
  const toForm = (list, name) => { const r = list[0]; V.form = { name, label: list.length > 1 ? String(r.label || '').replace(/^[^:]+:\s*/, '') : r.label || '', hosts: r.hosts || [], programs: r.programs || [], plugins: list.map(x => ({ plugin: x.plugin, as: x.key, reveal: !!x.reveal })), fields: mergeFields(list) }; draw(); el.querySelector('#vtPaste')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const grantAll = (name, list) => act(() => post({ action: 'grantMany', name, grants: list.map(x => ({ plugin: x.plugin, as: x.key, use: true, reveal: !!x.reveal })) }, true));
  el.querySelectorAll('.vt-req:not(.vt-group)').forEach(c => {
    const r = V.data.requests.find(x => x.plugin === c.dataset.plugin && x.key === c.dataset.key);
    c.querySelector('[data-req]').onclick = () => {
      if (!r.exists) return toForm([r], r.key);
      act(() => post({ action: 'grant', name: r.entry || r.key, plugin: r.plugin, as: r.key, use: true, reveal: r.granted ? true : undefined }, true));
    };
    c.querySelectorAll('[data-use]').forEach(b => b.onclick = () => grantAll(b.dataset.use, [r]));
  });
  el.querySelectorAll('.vt-group').forEach(c => {
    const list = pending().filter(r => !r.exists && hostKey(r) === c.dataset.group);
    c.querySelector('[data-gnew]').onclick = () => toForm(list, suggestName(list));
    c.querySelectorAll('[data-guse]').forEach(b => b.onclick = () => grantAll(b.dataset.guse, list));
  });
  el.querySelectorAll('.vt-ent').forEach(c => {
    const name = c.dataset.name;
    c.querySelector('[data-act="menu"]').onclick = (ev) => bs.showMenu(ev, [
      { label: 'Trocar o valor…', icon: KEY, action: () => act(() => post({ action: 'enter', name }, true)) },
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
  const ks = el.querySelector('#vtKind');
  if (ks) ks.onchange = () => { el.querySelector('#vtKindF').innerHTML = 'Você digita: ' + kindChips(ks.value); };
  const paste = el.querySelector('#vtPaste');
  if (paste) paste.onclick = () => {
    const name = val('vtName').trim();
    const kind = val('vtKind');
    V.form = { ...(V.form || {}), name, kind, label: val('vtLabel'), hosts: val('vtHosts').split(',').map(s => s.trim()).filter(Boolean), programs: val('vtProgs').split(',').map(s => s.trim()).filter(Boolean) };
    if (!name) { toast('Dê um nome ao segredo (ex.: github)'); return; }
    // os plugins marcados recebem o segredo com o nome que cada um usa (uma confirmação só para todos)
    const grants = (V.form.plugins || []).filter((_, i) => el.querySelector(`[data-gp="${i}"]`)?.checked);
    act(async () => {
      // o que o plugin pediu ou o tipo escolhido (o núcleo monta os campos dele)
      const what = V.form.fields && V.form.fields.length ? { fields: V.form.fields } : { kind: kind || 'token' };
      await post({ action: 'enter', name, label: V.form.label, hosts: V.form.hosts, programs: V.form.programs, ...what }, true);
      V.form = null; toast(`"${name}" guardado no cofre`, 'ok');
      if (grants.length) await post({ action: 'grantMany', name, grants: grants.map(g => ({ plugin: g.plugin, as: g.as, use: true, reveal: g.reveal })) }, true);
    });
  };
}

async function open(focus) {
  V.focus = focus || null;
  try { await load(); } catch (e) { return toast('Cofre: ' + e.message); }
  if (focus && focus.key) {
    // sem segredo e sem outro do mesmo site: o formulário já vem pronto (com os outros plugins que pedem o mesmo site)
    const r = V.data.requests.find(x => x.plugin === focus.plugin && x.key === focus.key);
    if (r && !r.exists && !(r.sameHosts || []).length) {
      const list = hostKey(r) ? pending().filter(x => !x.exists && hostKey(x) === hostKey(r)) : [r];
      V.form = { name: list.length > 1 ? suggestName(list) : r.key, label: list.length > 1 ? String(r.label || '').replace(/^[^:]+:\s*/, '') : r.label || '', hosts: r.hosts || [], programs: r.programs || [], plugins: list.map(x => ({ plugin: x.plugin, as: x.key, reveal: !!x.reveal })), fields: mergeFields(list) };
    }
  }
  draw();
}

// ---------- tela de configuração no lugar do painel de um plugin que só funciona com um token do Cofre ----------
// O plugin marca o que é obrigatório no plugin.json: "vault": [{ "key": "...", "required": true, ... }]. Enquanto faltar
// algo, o painel dele mostra os passos (criar, permitir, deixar ver o valor) e confere sozinho até ficar pronto.
const G = { tool: null, timer: null, sig: '' };
const needs = (id) => { const p = bs.plugins.list.find(x => x.id === id); return p && Array.isArray(p.vaultKeys) ? p.vaultKeys.filter(v => v && v.required && v.key) : []; };
const ready = (r) => r.exists && r.granted && (!r.reveal || r.revealGranted);
function gateItems(id) {
  return needs(id).map(d => ({ ...d, ...((V.data && V.data.requests.find(r => r.plugin === id && r.key === d.key)) || { key: d.key, plugin: id, pluginName: pname(id), reveal: !!d.reveal, exists: false, granted: false }) , title: d.title, revealWhy: d.revealWhy }));
}
const gateSig = (id) => gateItems(id).map(r => [r.exists, r.granted, r.revealGranted].join()).join('|');
function stopGate() { clearInterval(G.timer); G.timer = null; G.tool = null; }
function gate(id, body, tool) {
  if (!needs(id).length) return false;
  if (!V.data) { body.innerHTML = '<div class="empty">Conferindo o Cofre…</div>'; load().then(() => { if (bs.S.tool === tool.id) bs.renderTool(); }).catch(() => {}); return true; }
  const items = gateItems(id);
  if (items.every(ready)) { if (G.tool === tool.id) stopGate(); return false; }
  const name = pname(id);
  const step = (n, on, cur, title, desc, extra = '') => `<li class="vg-st ${on ? 'done' : cur ? 'cur' : ''}"><span class="vg-n">${on ? '✓' : n}</span><div><b>${title}</b>${extra}<div class="vg-d">${desc}</div></div></li>`;
  body.innerHTML = `<div class="vg">${items.map(r => {
    const what = r.title || `Configure ${r.label ? 'o ' + String(r.label).replace(/^[^:]+:\s*/, '') : 'o segredo ' + r.key}`;
    const same = !r.exists && (r.sameHosts || [])[0];
    const s = [r.exists, r.granted, !r.reveal || r.revealGranted];
    const cur = s.findIndex(x => !x);
    let n = 0;
    return `<div class="vg-card"><div class="vg-hd"><span class="vg-ic">${KEY}</span><div><h4>${esc(what)}</h4><p>O ${esc(name)} só abre com ele${r.why ? ': ' + esc(r.why) : ''}.</p></div></div>
      <ol class="vg-steps">
        ${step(++n, s[0], cur === 0, 'Criar o segredo', same ? `Já existe <b>${esc(same)}</b> para o mesmo site: no Cofre, “Usar ${esc(same)}”.` : `Criar… e Digitar e guardar (${esc(fieldsTxt(r.fields).toLowerCase())}).`, `<div><code>${esc(r.key)}</code></div>`)}
        ${step(++n, s[1], cur === 1, `Permitir o ${esc(name)}`, 'Libera o segredo para este plugin.')}
        ${r.reveal ? step(++n, s[2], cur === 2, 'Deixar ver o valor', esc(r.revealWhy || `O servidor do ${name} usa o valor direto.`)) : ''}
        ${step(++n, false, false, `Lido pelo ${esc(name)}`, 'Confere sozinho; não precisa reabrir nada.')}
      </ol>
      <button class="chip primary vg-go" data-key="${esc(r.key)}">${KEY}Abrir no Cofre</button></div>`;
  }).join('')}</div>`;
  body.querySelectorAll('.vg-go').forEach(b => b.onclick = () => open({ plugin: id, key: b.dataset.key }));
  // confere sozinho: quando o que falta é liberado (aqui ou no Cofre), o painel do plugin aparece
  G.tool = tool.id; G.sig = gateSig(id);
  if (!G.timer) G.timer = setInterval(async () => {
    if (bs.S.tool !== G.tool || document.hidden) { if (bs.S.tool !== G.tool) stopGate(); return; }
    try { await load(); } catch {}
  }, 2500);
  return true;
}

bs.vault = { open, refresh: load, banner, bindBanner, gate };
bs.actions.add({ label: 'Cofre de credenciais (tokens dos plugins)', icon: KEY, run: () => open() });
// ícone próprio na barra da esquerda, junto de Plugins: abre o cofre (não é um painel)
bs.tools.register({ id: 'vault', title: 'Cofre de credenciais', icon: KEY, key: 'Alt+8', order: 990, bottom: true, render() {}, toggle() { open(); } });
bs.hooks.on('refresh', () => load().catch(() => {}));
// depois de os plugins carregarem: o ponto na chave avisa pedidos pendentes
setTimeout(() => load().catch(() => {}), 1500);
})(window.BS);
