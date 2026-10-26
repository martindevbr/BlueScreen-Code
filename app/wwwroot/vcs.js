'use strict';
// ===== Git e SVN na interface: Alterações, Histórico, Comparar e "quem mudou esta linha" =====
// Alterações tem três modos (S.changeMode):
// - working: o que ainda não foi commitado (diff editável);
// - last: um commit (S.rev; vazio = o mais recente), navegado commit a commit (Alt+PageUp/PageDown) e revisado
//   arquivo a arquivo (Alt+← / Alt+→), com os vistos marcados;
// - range: Comparar duas versões quaisquer, S.base × S.rev (commit, branch, tag, revisão; sem S.rev, o disco, e aí o
//   lado direito do diff é editável).
// Rapidez: trocar de commit busca só a lista de arquivos dele (não o status, o resumo e o log de novo). Um commit não
// muda, então a lista e os diffs ficam guardados aqui e no núcleo (vcs.rs), e os commits vizinhos e os primeiros
// diffs do commit aberto são pré-carregados em segundo plano: Alt+PageDown e Alt+→ abrem na hora.
// Histórico: busca por mensagem, autor ou hash, agrupado por dia, com os arquivos de cada commit abrindo ali mesmo;
// "Arquivo" mostra só os commits que mexeram no arquivo aberto. Botão direito num commit: comparar com o local ou
// marcar como base e comparar com outro.
// Investigar: Alt+Shift+B (ou o fim da linha do cursor, no Git) diz quem deixou a linha como está e leva ao diff dela
// naquele commit; "Comparar com…" (arquivo e aba) compara dois arquivos, ou um arquivo com a área de transferência,
// com o lado direito editável.
const VC = { files: new Map(), diffs: new Map(), hist: { q: '', file: null, log: [], n: 0, open: new Set() }, mark: null, base: null, blame: { on: store.get('blameInline', true), col: null, t: 0, cache: new Map() } };
const VC_MAX_FILES = 300, VC_MAX_DIFFS = 150;

// ----- cache: só o que não muda (commit pelo hash do Git ou revisão do SVN) -----
const vcFixed = (r) => !!r && (/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(r) || /^\d{1,11}$/.test(r));
// "o último commit" (rev vazio) é o topo do histórico carregado
const vcRev = (q) => q.mode === 'last' ? (q.rev || (S.log[0] && S.log[0].id) || null) : q.rev;
function vcKey(q) {
  if (!S.project) return null;
  if (q.mode === 'last') { const r = vcRev(q); return vcFixed(r) ? `${S.project.path}|${r}` : null; }
  if (q.mode === 'range') return vcFixed(q.base) && vcFixed(q.rev) ? `${S.project.path}|${q.base}..${q.rev}` : null;
  return null;
}
const vcPut = (map, max, k, v) => { map.delete(k); map.set(k, v); while (map.size > max) map.delete(map.keys().next().value); };
const vcQ = () => ({ mode: S.changeMode, rev: S.rev, base: S.changeMode === 'range' ? S.base : null });
async function vcFiles(q, quiet) {
  const k = vcKey(q); if (k && VC.files.has(k)) return VC.files.get(k);
  const r = await api('changes', { project: S.project.path, mode: q.mode, rev: q.rev, base: q.base }, quiet ? { quiet: true } : {});
  if (k) vcPut(VC.files, VC_MAX_FILES, k, r.files);
  return r.files;
}
async function vcDiff(path, q = vcQ(), quiet) {
  const k = vcKey(q), dk = k && k + '|' + path;
  if (dk && VC.diffs.has(dk)) return VC.diffs.get(dk);
  const d = await api('diff', { project: S.project.path, file: path, mode: q.mode, rev: q.rev, base: q.base }, quiet ? { quiet: true } : {});
  if (dk) vcPut(VC.diffs, VC_MAX_DIFFS, dk, d);
  return d;
}
// em segundo plano, sem a barra de "carregando": os commits ao lado e os primeiros arquivos deste
function vcPrefetch() {
  if (!S.project || !S.project.vcs || S.changeMode === 'working') return;
  const proj = S.project.path, q = vcQ();
  setTimeout(async () => {
    if (!S.project || S.project.path !== proj) return;
    try {
      const list = chgList(), cur = tabInList() ? list.findIndex(c => c.path === S.active.path) : -1;
      for (const f of list.slice(cur + 1, cur + 3)) await vcDiff(f.path, q, true);
      if (q.mode === 'last') { const ix = commitIx(); for (const i of [ix + 1, ix - 1]) { const c = S.log[i]; if (c) await vcFiles({ mode: 'last', rev: i === 0 ? null : c.id }, true); } }
    } catch { /* pré-carregar é bônus */ }
  }, 150);
}

// ----- Alterações: navegar commit a commit e revisar arquivo a arquivo -----
// O commit mostrado é S.log[i] (S.rev vazio = o último). Commits grandes: os arquivos vão de um em um (Alt+← / Alt+→),
// cada diff aberto fica marcado como visto, as pastas recolhem e um filtro corta a lista. Vale para Git e SVN.
const commitIx = () => S.rev ? S.log.findIndex(l => l.id === S.rev) : 0;
// commit aberto que não está no histórico carregado (veio do "quem mudou esta linha"): S.revInfo
const curCommit = () => { const ix = commitIx(); return (ix >= 0 ? S.log[ix] : null) || S.revInfo || (!S.rev && S.summary && S.summary.last) || null; };
async function moreLog(n = 50) {
  const more = await api('log', { project: S.project.path, n: S.log.length + n }).catch(() => null);
  if (!more || more.length <= S.log.length) return false;
  S.log = more; S.logN = more.length; return true;
}
// só a lista de arquivos do modo atual: trocar de commit não refaz status, resumo e histórico
async function loadChanges() {
  if (!S.project || !S.project.vcs) return;
  const proj = S.project.path, q = vcQ();
  let files; try { files = await vcFiles(q); } catch (e) { toast(e.message); files = []; }
  if (!S.project || S.project.path !== proj) return;
  S.changes = files;
  if (q.mode === 'last' && !q.rev) S.lastFiles = files;
  renderTool(); vcPrefetch();
}
function setMode(mode, rev = null, base) {
  S.changeMode = mode; store.set('changeMode', mode); S.rev = rev; S.chgPick = false;
  if (base !== undefined) S.base = base;
  if (mode !== 'last') S.revInfo = null;
}
async function goCommit(ix) {
  if (!S.project || !S.project.vcs) return;
  if (ix < 0) return toast('Este já é o commit mais recente');
  if (ix >= S.log.length && !(await moreLog())) return toast('Não há commits mais antigos');
  const c = S.log[ix]; if (!c) return;
  const reviewing = S.active && S.active.preview && S.active.mode === 'diff';
  // os diffs de commit são só leitura: as abas de prévia do commit anterior saem para não acumular
  S.tabs.filter(t => t.preview && t.mode === 'diff' && t.changeMode === 'last' && !t.dirty).forEach(closeTab);
  setMode('last', ix === 0 ? null : c.id); S.revInfo = null;
  await loadChanges();
  if (S.tool !== 'changes' || $('#app').classList.contains('no-tool')) openTool('changes');
  if (reviewing) stepFile(1); // estava revisando: já abre o primeiro arquivo do commit novo
}
// um commit qualquer (do histórico de um arquivo, do blame), e opcionalmente um arquivo dele na linha
async function openAtCommit(c, path, line) {
  if (!S.project || !S.project.vcs || !c) return;
  const ix = S.log.findIndex(l => l.id === c.id);
  S.tabs.filter(t => t.preview && t.mode === 'diff' && t.changeMode === 'last' && !t.dirty).forEach(closeTab);
  setMode('last', ix === 0 ? null : c.id); S.revInfo = ix < 0 ? c : null;
  await loadChanges();
  if (path) await openFile(path, 'diff', line, true);
}
// Comparar: base × target (sem target, a cópia local)
async function compare(base, target = null, path) {
  if (!S.project || !S.project.vcs) return;
  if (!base) return toast('Escolha a versão base');
  setMode('range', target || null, base);
  await loadChanges();
  if (S.tool !== 'changes' || $('#app').classList.contains('no-tool')) openTool('changes');
  if (path) await openFile(path, 'diff', undefined, true);
}
// arquivos na mesma ordem da lista (pasta, depois nome), já com o filtro
function chgGroups() {
  const f = (S.chgFilter || '').toLowerCase(); const g = {};
  S.changes.filter(c => !f || c.path.toLowerCase().includes(f)).forEach(c => { const i = c.path.lastIndexOf('/'); const d = i < 0 ? '' : c.path.slice(0, i); (g[d] = g[d] || []).push(c); });
  return Object.keys(g).sort().map(d => [d, g[d]]);
}
const chgList = () => chgGroups().flatMap(([, l]) => l);
// a aba ativa é um diff da lista que está na tela (mesmo modo, mesmo commit e, no Comparar, mesma base)?
const tabInList = (t = S.active) => !!t && t.mode === 'diff' && !t.owner && !t.virtual && t.changeMode === S.changeMode && (t.rev || null) === (S.rev || null) && (S.changeMode !== 'range' || t.cmpBase === S.base);
// vistos por commit (guarda os 60 mais recentes)
const SEEN = store.get('chgSeen', {});
const seenKey = (rev = S.rev) => S.project.path + '|' + (rev || S.log[0]?.id || 'HEAD');
const seenOf = (rev) => new Set(SEEN[seenKey(rev)] || []);
function markSeen(path, rev, on = true) {
  const k = seenKey(rev); const s = new Set(SEEN[k] || []); if (on === s.has(path)) return;
  on ? s.add(path) : s.delete(path); delete SEEN[k]; if (s.size) SEEN[k] = [...s];
  const ks = Object.keys(SEEN); ks.slice(0, Math.max(0, ks.length - 60)).forEach(x => delete SEEN[x]);
  store.set('chgSeen', SEEN);
}
// abre o arquivo seguinte/anterior; a aba de prévia de antes é trocada (não empilha 200 abas num commit grande)
async function stepFile(dir, unseen) {
  if (!S.project || !S.project.vcs) return;
  const list = chgList(); if (!list.length) return toast('Nenhum arquivo nesta lista');
  const prev = S.active; const cur = tabInList(prev) ? list.findIndex(c => c.path === prev.path) : -1;
  let next;
  if (unseen) { const seen = seenOf(); next = list.slice(cur + 1).concat(list.slice(0, cur + 1)).find(c => !seen.has(c.path)); if (!next) return toast('Todos os arquivos já foram vistos'); }
  else if (cur < 0) next = dir > 0 ? list[0] : list[list.length - 1];
  else next = list[cur + dir];
  if (!next) return toast(dir > 0 ? (S.changeMode === 'last' ? 'Último arquivo do commit. Alt+PageDown: commit anterior' : 'Último arquivo') : 'Primeiro arquivo');
  await openFile(next.path, 'diff', undefined, true);
  if (prev && prev !== S.active && prev.preview && prev.mode === 'diff' && !prev.dirty && S.tabs.includes(prev)) closeTab(prev);
  $('#toolBody .row.chg.sel')?.scrollIntoView({ block: 'nearest' });
  vcPrefetch();
}

const chev = (d) => `<svg class="i" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
// rótulo curto de uma versão: o hash e o assunto se for um commit do histórico carregado
const refInfo = (r) => r ? S.log.find(l => l.id === r || l.hash === r) : null;
const refShort = (r) => { const c = refInfo(r); return c ? c.hash : (r || ''); };
const refLong = (r) => { const c = refInfo(r); return c ? `${c.hash} · ${c.subject}` : (r || 'Local (disco)'); };
// o que foi digitado: hash curto de um commit da lista vira o id completo (o cache só guarda versões fixas)
const refResolve = (v) => { v = (v || '').trim(); const c = v && S.log.find(l => l.hash === v || l.id === v || l.hash === 'r' + v); return c ? c.id : v.replace(/^r(\d+)$/, '$1'); };

function renderChanges() {
  const body = $('#toolBody');
  if (!S.project) { body.innerHTML = '<div class="empty">Escolha um projeto.</div>'; return; }
  if (!S.project.vcs) { body.innerHTML = '<div class="empty">Esta pasta não tem Git nem SVN.</div>'; return; }
  const mode = S.changeMode, isLast = mode === 'last', isCmp = mode === 'range';
  $('#toolActions').innerHTML = `<div class="seg"><button data-m="working" class="${mode === 'working' ? 'on' : ''}" title="O que ainda não foi commitado">Local</button><button data-m="last" class="${isLast ? 'on' : ''}" title="Navegar commit a commit">Commit</button><button data-m="range" class="${isCmp ? 'on' : ''}" title="Comparar duas versões quaisquer (ou uma versão com o disco)">Comparar</button></div>`;
  $('#toolActions').querySelectorAll('button[data-m]').forEach(b => b.onclick = async () => {
    const m = b.dataset.m; if (m === mode) return;
    if (m === 'range') setMode('range', null, S.base || VC.base || (curCommit() && curCommit().id) || (S.log[0] && S.log[0].id) || 'HEAD');
    else setMode(m);
    await loadChanges();
  });
  const ix = commitIx(); const c = isLast ? curCommit() : null;
  const more = S.log.length >= (S.logN || 30);
  let head = '';
  // navegador de commits: ‹ mais novo | commit atual (clique: escolher outro) | mais antigo ›
  if (isLast) head = `<div class="cnav">
      <button class="icon-btn" id="cNewer" title="Commit mais novo (Alt+PageUp)" ${ix <= 0 ? 'disabled' : ''}>${chev('M15 6l-6 6 6 6')}</button>
      <button class="cpick ${S.chgPick ? 'on' : ''}" id="cPick" title="Escolher o commit">${c ? `<div class="subj">${esc(c.subject)}</div><div class="m"><code>${esc(c.hash)}</code><span>${esc(c.author)}</span><span>${esc(c.when)}</span>${ix >= 0 ? `<span class="pos">${ix + 1}/${S.log.length}${more ? '+' : ''}</span>` : '<span class="pos">fora da lista</span>'}</div>` : '<div class="subj">Sem commits</div>'}</button>
      <button class="icon-btn" id="cOlder" title="Commit mais antigo (Alt+PageDown)" ${ix < 0 || (ix >= S.log.length - 1 && !more) ? 'disabled' : ''}>${chev('M9 6l6 6-6 6')}</button>
    </div>${S.chgPick ? `<div class="clist">${S.log.map((l, i) => `<div class="commit ${i === ix ? 'sel' : ''}" data-i="${i}"><div class="subj" title="${esc(l.subject)}">${esc(l.subject)}</div><div class="m"><code>${esc(l.hash)}</code><span>${esc(l.author)}</span><span>${esc(l.when)}</span></div></div>`).join('')}${more ? '<div class="row more" id="cMore"><span class="name">Carregar mais antigos…</span></div>' : ''}</div>` : ''}`;
  // Comparar: base ⇄ alvo, digitando um hash/branch/tag/revisão ou escolhendo da lista
  if (isCmp) head = `<div class="cmpbar">
      <label title="${esc(refLong(S.base))}"><span>de</span><input id="cmpBase" list="cmpRefs" value="${esc(refShort(S.base))}" placeholder="commit, branch, tag" spellcheck="false"></label>
      <button class="icon-btn" id="cmpSwap" title="Inverter os lados" ${S.rev ? '' : 'disabled'}>⇄</button>
      <label title="${esc(refLong(S.rev))}"><span>para</span><input id="cmpTarget" list="cmpRefs" value="${esc(refShort(S.rev))}" placeholder="Local (disco)" spellcheck="false"></label>
      <datalist id="cmpRefs">${S.log.slice(0, 300).map(l => `<option value="${esc(l.hash)}">${esc(l.subject)} · ${esc(l.author)}, ${esc(l.when)}</option>`).join('')}<option value="HEAD">último commit</option></datalist>
    </div><div class="cmpsub">${esc(refLong(S.base))} <b>→</b> ${esc(refLong(S.rev))}</div>`;
  const groups = chgGroups(); const shown = groups.reduce((n, [, l]) => n + l.length, 0);
  const seen = isLast ? seenOf() : new Set(); const nSeen = isLast ? S.changes.filter(x => seen.has(x.path)).length : 0;
  const fold = S.chgFold || (S.chgFold = new Set());
  const rows = groups.map(([d, list]) => {
    const closed = fold.has(d) && !S.chgFilter;
    return `${d ? `<div class="section dir ${closed ? 'closed' : ''}" data-d="${esc(d)}" title="${esc(d)}">${chev(closed ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6')}<span class="dn">${esc(d)}</span><span class="meta">${list.length}</span></div>` : ''}${closed ? '' : list.map(x => `<div class="row chg ${tabInList() && S.active.path === x.path ? 'sel' : ''} ${unsavedPaths().has(x.path) ? 'unsaved' : ''} ${seen.has(x.path) ? 'seen' : ''}" data-p="${esc(x.path)}" title="${esc(x.path)}"><span class="st ${esc(x.code)}">${esc(x.code)}</span><span class="name c-${esc(x.code.replace('?', '\\?'))}">${esc(x.path.split('/').pop())}</span><span class="meta">${statHtml(x)}${isLast ? `<span class="ck" title="${seen.has(x.path) ? 'Visto (clique para desmarcar)' : 'Marcar como visto'}">${I.lint}</span>` : ''}</span></div>`).join('')}`;
  }).join('');
  const tot = S.changes.reduce((a, x) => ({ add: a.add + (x.add || 0), del: a.del + (x.del || 0) }), { add: 0, del: 0 });
  const many = S.changes.length > 12;
  const tools = S.changes.length ? `<div class="ctools">
      ${many || S.chgFilter ? `<input id="chgFilter" placeholder="Filtrar arquivos…" value="${esc(S.chgFilter || '')}" spellcheck="false">` : '<span style="flex:1"></span>'}
      ${isLast ? `<span class="prog" title="Arquivos vistos neste commit"><i style="width:${Math.round(nSeen * 100 / S.changes.length)}%"></i></span><span class="pn" title="Arquivos vistos neste commit">${nSeen}/${S.changes.length}</span>` : ''}
      <button class="icon-btn" id="chgPrev" title="Arquivo anterior (Alt+←)">${chev('M15 6l-6 6 6 6')}</button>
      <button class="icon-btn" id="chgNext" title="${isLast ? 'Próximo arquivo não visto' : 'Próximo arquivo'} (Alt+→)">${chev('M9 6l6 6-6 6')}</button>
      ${groups.length > 1 ? `<button class="icon-btn" id="chgFold" title="${fold.size ? 'Expandir pastas' : 'Recolher pastas'}">${fold.size ? chev('M7 9l5-5 5 5M7 15l5 5 5-5') : TI.collapse}</button>` : ''}
    </div>` : '';
  const title = isLast ? 'Arquivos do commit' : isCmp ? 'Diferenças' : 'Não commitado';
  body.innerHTML = head + `<div class="section">${title} <span class="meta">${statHtml(tot)} ${S.chgFilter ? shown + ' de ' : ''}${S.changes.length}</span></div>` + tools + (rows || `<div class="empty">${S.chgFilter ? 'Nenhum arquivo com esse nome.' : isCmp ? 'As duas versões são iguais (ou a versão não existe).' : 'Nada por aqui. Tudo limpo.'}</div>`);
  if (isLast) {
    $('#cNewer').onclick = () => goCommit(commitIx() - 1);
    $('#cOlder').onclick = () => goCommit(commitIx() + 1);
    $('#cPick').onclick = () => { S.chgPick = !S.chgPick; renderChanges(); if (S.chgPick) $('#toolBody .clist .commit.sel')?.scrollIntoView({ block: 'center' }); };
    $('#cPick').oncontextmenu = (e) => c && c.id && commitMenu(e, c);
    body.querySelectorAll('.clist .commit').forEach(el => { el.onclick = () => goCommit(+el.dataset.i); el.oncontextmenu = (e) => commitMenu(e, S.log[+el.dataset.i]); });
    const m = $('#cMore'); if (m) m.onclick = async () => { if (await moreLog()) renderChanges(); else { toast('Não há commits mais antigos'); m.remove(); } };
  }
  if (isCmp) {
    const apply = () => compare(refResolve($('#cmpBase').value) || 'HEAD', refResolve($('#cmpTarget').value) || null);
    for (const id of ['#cmpBase', '#cmpTarget']) { const el = $(id); el.onchange = apply; el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } }; el.onfocus = () => el.select(); }
    $('#cmpSwap').onclick = () => S.rev && compare(S.rev, S.base);
  }
  const fi = $('#chgFilter');
  if (fi) {
    fi.oninput = () => { const pos = fi.selectionStart; S.chgFilter = fi.value; renderChanges(); const n = $('#chgFilter'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    fi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFile(1); } if (e.key === 'Escape' && fi.value) { e.stopPropagation(); S.chgFilter = ''; renderChanges(); } };
  }
  if ($('#chgPrev')) { $('#chgPrev').onclick = () => stepFile(-1); $('#chgNext').onclick = () => stepFile(1, isLast); }
  if ($('#chgFold')) $('#chgFold').onclick = () => { if (fold.size) fold.clear(); else groups.forEach(([d]) => d && fold.add(d)); renderChanges(); };
  body.querySelectorAll('.section.dir').forEach(el => el.onclick = () => { const d = el.dataset.d; fold.has(d) ? fold.delete(d) : fold.add(d); renderChanges(); });
  body.querySelectorAll('.row.chg').forEach(r => {
    r.onclick = (e) => { if (e.target.closest('.ck')) { e.stopPropagation(); markSeen(r.dataset.p, S.rev, !r.classList.contains('seen')); renderChanges(); return; } openFile(r.dataset.p, 'diff', undefined, true); };
    r.oncontextmenu = (e) => fileMenu(e, r.dataset.p, false);
  });
}

// ----- Histórico -----
const DAY = 86400000;
function dayLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.floor((t - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  if (diff <= 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/^./, (x) => x.toUpperCase());
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
const histLog = () => VC.hist.file ? VC.hist.log : S.log;
const histMore = () => VC.hist.file ? VC.hist.log.length >= VC.hist.n : S.log.length >= (S.logN || 30);
const histMatch = (q) => { const w = q.toLowerCase().split(/\s+/).filter(Boolean); return (c) => w.every(x => (c.subject + ' ' + c.author + ' ' + c.hash + ' ' + (c.id || '')).toLowerCase().includes(x)); };
async function histLoadFile(path, n = 100) {
  VC.hist.file = path; VC.hist.n = n;
  try { VC.hist.log = await api('log', { project: S.project.path, n, file: path }); } catch (e) { toast(e.message); VC.hist.log = []; }
}
async function histMoreLoad(n) {
  if (VC.hist.file) { const before = VC.hist.log.length; await histLoadFile(VC.hist.file, VC.hist.n + n); return VC.hist.log.length > before; }
  return moreLog(n);
}
// Histórico do arquivo aberto (ou de path)
async function fileHistory(path) {
  const t = S.active, p = path || (t && !t.virtual && t.project === S.project?.path && t.path);
  if (!p) return toast('Abra um arquivo para ver o histórico dele');
  VC.hist.open.clear(); await histLoadFile(p);
  openTool('history');
}
function renderHistory() {
  const body = $('#toolBody');
  if (!S.project || !S.project.vcs) { body.innerHTML = '<div class="empty">Sem histórico.</div>'; return; }
  const H = VC.hist, f = H.file;
  $('#toolActions').innerHTML = `<div class="seg"><button data-h="proj" class="${f ? '' : 'on'}" title="Todos os commits do projeto">Projeto</button><button data-h="file" class="${f ? 'on' : ''}" title="Só os commits que mexeram no arquivo aberto">Arquivo</button></div>`;
  $('#toolActions').querySelectorAll('button[data-h]').forEach(b => b.onclick = async () => { if (b.dataset.h === 'file') await fileHistory(); else { H.file = null; renderHistory(); } });
  const all = histLog(), list = H.q ? all.filter(histMatch(H.q)) : all;
  const sel = (c) => S.changeMode === 'last' && (S.rev === c.id || (!S.rev && S.log[0] && S.log[0].id === c.id));
  let day = null, html = '';
  for (const c of list) {
    const dl = dayLabel(c.ts); if (dl && dl !== day) { day = dl; html += `<div class="section hday">${esc(dl)}</div>`; }
    const open = !f && H.open.has(c.id), base = VC.base === c.id;
    html += `<div class="commit hc ${sel(c) ? 'sel' : ''} ${open ? 'open' : ''} ${base ? 'base' : ''}" data-id="${esc(c.id)}">
      <div class="subj" title="${esc(c.subject)}">${f ? '' : chev(open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6')}${esc(c.subject)}</div>
      <div class="m"><code>${esc(c.hash)}</code><span>${esc(c.author)}</span><span>${esc(c.when)}</span>${base ? '<span class="tag">base</span>' : ''}${f && c.path && c.path !== f ? `<span class="ren" title="Nome do arquivo neste commit">${esc(c.path.split('/').pop())}</span>` : ''}
        <span class="hact"><button data-a="local" title="Comparar este commit com o local (o que mudou desde ele)">⇄ local</button>${VC.base && !base ? '<button data-a="cmp" title="Comparar a base marcada com este commit">⇄ base</button>' : `<button data-a="base" title="${base ? 'Desmarcar a base' : 'Marcar como base para comparar com outro commit'}">${base ? '× base' : '◎ base'}</button>`}</span></div>
      ${open ? `<div class="hfiles" data-files="${esc(c.id)}"><div class="empty"><span class="spin"></span></div></div>` : ''}
    </div>`;
  }
  const tools = `<div class="ctools hq"><input id="histQ" placeholder="${f ? 'Buscar nos commits de ' + esc(f.split('/').pop()) : 'Buscar por mensagem, autor ou hash'}…" value="${esc(H.q)}" spellcheck="false">${f ? `<button class="icon-btn" id="histProj" title="Voltar ao histórico do projeto">${I.x}</button>` : ''}</div>`
    + (f ? `<div class="cmpsub" title="${esc(f)}">${esc(f)}</div>` : '');
  const moreBtn = histMore() ? `<div class="row more" id="histMore"><span class="name">${H.q ? 'Buscar em mais commits (+500)' : 'Carregar mais antigos…'}</span></div>` : '';
  body.innerHTML = tools + (html || `<div class="empty">${H.q ? 'Nenhum commit com isso.' : 'Sem commits.'}</div>`) + moreBtn;
  const q = $('#histQ');
  q.oninput = () => { const pos = q.selectionStart; H.q = q.value; renderHistory(); const n = $('#histQ'); n.focus(); n.setSelectionRange(pos, pos); };
  q.onkeydown = (e) => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); H.q = ''; renderHistory(); } if (e.key === 'Enter') { const first = body.querySelector('.commit.hc'); if (first) first.click(); } };
  if ($('#histProj')) $('#histProj').onclick = () => { H.file = null; renderHistory(); };
  const hm = $('#histMore'); if (hm) hm.onclick = async () => { if (await histMoreLoad(H.q ? 500 : 50)) renderHistory(); else { toast('Não há commits mais antigos'); hm.remove(); } };
  const byId = (id) => all.find(c => c.id === id);
  body.querySelectorAll('.commit.hc').forEach(el => {
    const c = byId(el.dataset.id);
    el.onclick = (e) => {
      const a = e.target.closest('[data-a]');
      if (a) { e.stopPropagation(); return histAct(a.dataset.a, c); }
      if (e.target.closest('.hfiles')) return;
      // arquivo: abre direto o diff dele naquele commit (com o nome que ele tinha); projeto: os arquivos abrem aqui
      if (f) return openAtCommit(c, c.path || f);
      H.open.has(c.id) ? H.open.delete(c.id) : H.open.add(c.id); renderHistory();
    };
    el.ondblclick = (e) => { if (!e.target.closest('.hfiles,[data-a]')) openAtCommit(c).then(() => openTool('changes')); };
    el.oncontextmenu = (e) => { if (!e.target.closest('.hfiles')) commitMenu(e, c); };
  });
  body.querySelectorAll('.hfiles').forEach(async (box) => {
    const c = byId(box.dataset.files); if (!c) return;
    const ix = S.log.findIndex(l => l.id === c.id);
    let files; try { files = await vcFiles({ mode: 'last', rev: ix === 0 ? null : c.id }); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!box.isConnected) return;
    box.innerHTML = files.map(x => `<div class="row chg" data-p="${esc(x.path)}" title="${esc(x.path)}"><span class="st ${esc(x.code)}">${esc(x.code)}</span><span class="name c-${esc(x.code.replace('?', '\\?'))}">${esc(x.path.split('/').pop())}</span><span class="dir">${esc(x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : '')}</span><span class="meta">${statHtml(x)}</span></div>`).join('') || '<div class="empty">Sem arquivos nesta pasta.</div>';
    box.querySelectorAll('.row.chg').forEach(r => { r.onclick = (e) => { e.stopPropagation(); openAtCommit(c, r.dataset.p); }; r.oncontextmenu = (e) => { e.stopPropagation(); fileMenu(e, r.dataset.p, false); }; });
  });
}
function histAct(a, c) {
  if (a === 'local') return compare(c.id, null);
  if (a === 'base') { VC.base = VC.base === c.id ? null : c.id; if (VC.base) toast(`Base: ${c.hash}. Agora escolha o outro commit (⇄ base)`); return renderTool(); }
  if (a === 'cmp') { const b = VC.base; const older = S.log.findIndex(l => l.id === b) > S.log.findIndex(l => l.id === c.id); return older ? compare(b, c.id) : compare(c.id, b); }
}
function commitMenu(e, c) {
  if (!c) return;
  const f = VC.hist.file;
  showMenu(e, BS.hooks.apply('menu:commit', [
    { label: 'Ver arquivos do commit', icon: I.commit, action: () => openAtCommit(c).then(() => openTool('changes')) },
    ...(f ? [{ label: 'Diff de ' + f.split('/').pop() + ' neste commit', icon: I.diff, action: () => openAtCommit(c, c.path || f) }, { label: 'Comparar ' + f.split('/').pop() + ' deste commit com o local', icon: I.diff, action: () => compare(c.id, null, f) }] : []),
    { label: 'Comparar com o local', icon: I.diff, action: () => compare(c.id, null) },
    VC.base && VC.base !== c.id ? { label: 'Comparar com a base marcada (' + refShort(VC.base) + ')', icon: I.diff, action: () => histAct('cmp', c) } : { label: VC.base === c.id ? 'Desmarcar como base' : 'Marcar como base para comparar', icon: I.diff, action: () => histAct('base', c) },
    '-',
    { label: 'Copiar hash', icon: I.copy, action: () => copyText(c.id || c.hash) },
    { label: 'Copiar mensagem', icon: I.copy, action: () => copyText(c.subject) },
  ], c), `${c.hash} · ${c.author}`);
}

// ----- quem mudou esta linha -----
async function blameAt(t, line) {
  const k = `${t.project}|${t.path}|${t.model.getAlternativeVersionId()}|${line}`;
  if (VC.blame.cache.has(k)) return VC.blame.cache.get(k);
  const opt = t.dirty ? { method: 'POST', body: t.model.getValue(), quiet: true } : { quiet: true };
  const b = await api('blame', { project: t.project, file: t.path, line }, opt);
  vcPut(VC.blame.cache, 400, k, b);
  return b;
}
const blameTab = () => { const t = S.active; return t && t.mode === 'editor' && !t.virtual && t.model && S.project && S.project.vcs && t.project === S.project.path ? t : null; };
async function blameMenu() {
  const t = blameTab(); if (!t) return toast('Abra um arquivo de um projeto com Git ou SVN');
  const pos = editor.getPosition();
  let b; try { b = await blameAt(t, pos.lineNumber); } catch (e) { return toast(e.message); }
  if (!b.commit) return toast('Esta linha ainda não foi commitada');
  const c = b.commit, sp = editor.getScrolledVisiblePosition(pos), r = editor.getDomNode().getBoundingClientRect();
  const ev = { clientX: r.left + (sp ? sp.left : 40), clientY: r.top + (sp ? sp.top + sp.height : 40), preventDefault() {}, stopPropagation() {} };
  showMenu(ev, [
    { label: 'Ver esta mudança (diff no commit, nesta linha)', icon: I.diff, action: () => openAtCommit(c, t.path, b.line) },
    { label: 'Ver todos os arquivos do commit', icon: I.commit, action: () => openAtCommit(c).then(() => openTool('changes')) },
    { label: 'O que mudou no arquivo desde este commit', icon: I.diff, action: () => compare(c.id, null, t.path) },
    { label: 'Histórico deste arquivo', icon: I.hist, action: () => fileHistory(t.path) },
    '-',
    { label: 'Copiar hash', icon: I.copy, action: () => copyText(c.id || c.hash) },
  ], `${c.hash} · ${c.author}, ${c.when}: ${c.subject}`);
}
// no Git, o fim da linha do cursor mostra quem mexeu nela por último (desliga em "Quem mudou esta linha", botão direito)
function blameInline() {
  clearTimeout(VC.blame.t);
  const ed = editor; if (!ed) return;
  // coleção do editor (o texto injetado de model.deltaDecorations não é desenhado); trocar de aba já a limpa
  const col = VC.blame.col || (VC.blame.col = ed.createDecorationsCollection());
  const clear = () => col.clear();
  const t = blameTab();
  if (!VC.blame.on || !t || S.project.vcs !== 'git' || t.model.getLineCount() > 50000) return clear();
  const line = ed.getPosition() && ed.getPosition().lineNumber; if (!line) return clear();
  VC.blame.t = setTimeout(async () => {
    let b; try { b = await blameAt(t, line); } catch { return clear(); }
    if (S.active !== t || !ed.getPosition() || ed.getPosition().lineNumber !== line || ed.getModel() !== t.model) return;
    const c = b.commit, text = c ? `${c.author}, ${c.when} · ${c.subject}` : 'Ainda não commitado';
    const end = t.model.getLineMaxColumn(line);
    col.set([{ range: new monaco.Range(line, end, line, end), options: { showIfCollapsed: true, after: { content: '\u2003' + (text.length > 90 ? text.slice(0, 89) + '…' : text), inlineClassName: 'bs-blame' } } }]);
  }, 450);
}

// ----- comparar dois arquivos, ou um arquivo com a área de transferência -----
// o lado direito é a própria aba do arquivo (editar ali é editar o arquivo), como o diff EXTERNO (sync.js)
async function compareWith(rightPath, leftText, leftName, key) {
  ensureEditors();
  await openFile(rightPath, 'editor');
  const tab = S.tabs.find(t => t.key === tabKey(rightPath, 'editor') && t.project === S.project.path);
  if (!tab || !tab.model) return;
  const k = rightPath + '::cmp:' + key;
  const old = S.tabs.find(t => t.key === k); if (old) closeTab(old);
  const x = { key: k, path: rightPath, mode: 'diff', owner: tab, project: tab.project, lang: tab.lang, changeMode: 'cmp', cmpLabel: 'COMPARAR', editable: true, model: tab.model, original: monaco.editor.createModel(leftText, tab.lang),
    cmpNote: `Esquerda: <b>${esc(leftName)}</b> (só leitura) · direita: <b>${esc(rightPath.split('/').pop())}</b>, editável. As setas do meio trazem cada trecho da esquerda.` };
  Object.defineProperty(x, 'problems', { get: () => tab.problems });
  Object.defineProperty(x, 'dirty', { get: () => tab.dirty, set() {} });
  S.tabs.splice(S.tabs.indexOf(tab) + 1, 0, x);
  activate(x);
}
async function compareFiles(leftPath, rightPath) {
  let f; try { f = await api('file', { project: S.project.path, file: leftPath }); } catch (e) { return toast(e.message); }
  if (f.binary || f.tooBig) return toast('Não dá para comparar: ' + (f.binary ? 'arquivo binário' : 'arquivo grande demais'));
  const open = S.tabs.find(t => t.key === tabKey(leftPath, 'editor') && t.project === S.project.path && t.model); // aberto: com o que ainda não foi salvo
  compareWith(rightPath, open ? open.model.getValue() : f.content, leftPath, 'file:' + leftPath);
}
async function compareClipboard(path) {
  let text; try { text = await navigator.clipboard.readText(); } catch { return toast('Não deu para ler a área de transferência'); }
  if (!text) return toast('A área de transferência está vazia');
  compareWith(path, text, 'área de transferência', 'clip');
}
const cmpItems = (path) => {
  if (!S.project) return [];
  const m = VC.mark && VC.mark.project === S.project.path && VC.mark.path !== path ? VC.mark.path : null;
  return [{ label: 'Comparar com…', icon: I.diff, sub: [
    ...(m ? [{ label: 'Com ' + m.split('/').pop() + ' (marcado)', icon: I.diff, action: () => compareFiles(m, path) }] : []),
    { label: 'Marcar para comparar', icon: I.diff, action: () => { VC.mark = { project: S.project.path, path }; toast(path.split('/').pop() + ' marcado. Botão direito em outro arquivo: Comparar com… › ' + path.split('/').pop()); } },
    { label: 'Com a área de transferência', icon: I.copy, action: () => compareClipboard(path) },
    ...(S.project.vcs ? [
      { label: 'Com uma versão do histórico…', icon: I.hist, action: () => fileHistory(path) },
    ] : []),
  ] }];
};
BS.hooks.filter('menu:file', (items, ctx) => ctx && !ctx.isDir ? [...items, '-', ...cmpItems(ctx.rel)] : items);
BS.hooks.filter('menu:tab', (items, t) => t && !t.virtual && t.mode !== 'view' && t.project === S.project?.path ? [...items, '-', ...cmpItems(t.path), ...(S.project.vcs ? [{ label: 'Histórico do arquivo', icon: I.hist, action: () => fileHistory(t.path) }] : [])] : items);

BS.hooks.on('editor:ready', (ed) => {
  ed.addAction({ id: 'bs.blame', label: 'Quem mudou esta linha?', keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyB], contextMenuGroupId: 'navigation', contextMenuOrder: 7, run: () => blameMenu() });
  ed.addAction({ id: 'bs.filehist', label: 'Histórico deste arquivo', contextMenuGroupId: 'navigation', contextMenuOrder: 8, run: () => fileHistory() });
  ed.onDidChangeCursorPosition(() => blameInline());
  ed.onDidChangeModel(() => blameInline());
});
// o modo Comparar não fica guardado de uma sessão para outra (a base não é salva)
if (S.changeMode === 'range' && !S.base) S.changeMode = 'working';
BS.hooks.on('project:select', () => { VC.hist.file = null; VC.hist.q = ''; VC.hist.open.clear(); VC.base = null; S.base = null; S.revInfo = null; });
BS.actions.add([
  { label: 'Quem mudou esta linha? (blame)', k: 'Alt+Shift+B', run: () => blameMenu(), icon: I.hist },
  { label: 'Histórico do arquivo aberto', k: '', run: () => fileHistory(), icon: I.hist },
  { label: (VC.blame.on ? 'Desligar' : 'Ligar') + ' o autor da linha no fim da linha (Git)', k: '', run: () => { VC.blame.on = !VC.blame.on; store.set('blameInline', VC.blame.on); blameInline(); toast(VC.blame.on ? 'Autor da linha ligado' : 'Autor da linha desligado'); } },
  { label: 'Comparar com o local a partir de um commit…', k: '', run: () => openTool('history'), icon: I.diff },
]);
BS.vcs = { files: vcFiles, diff: vcDiff, goCommit, openAtCommit, compare, fileHistory, blame: blameMenu, compareFiles, compareClipboard };
