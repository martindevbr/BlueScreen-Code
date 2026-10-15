'use strict';
// ===== Leitor e editor de arquivos grandes (logs, dumps, CSVs de GB) =====
// O arquivo nunca vem inteiro: o núcleo monta um índice esparso de linhas (bigfile.rs) e entrega janelas de 512
// linhas. Aqui só existem no DOM as linhas visíveis (rolagem virtual); as páginas lidas ficam num cache pequeno
// (as menos usadas saem) e as vizinhas são buscadas antes de você chegar nelas.
// - Rolagem: até ~400 mil linhas a barra é 1:1; acima disso ela vira proporcional (o navegador não aceita uma área de
//   rolagem infinita), e mesmo assim vai a qualquer linha de um arquivo de bilhões de linhas.
// - Buscar (Ctrl+F): no arquivo INTEIRO, no núcleo, com literal, maiúsculas e regex; lista os achados, Enter/F3
//   vai ao próximo, Shift+Enter ao anterior. Ir para linha: Ctrl+G.
// - Acompanhar o fim (como tail -f): se o arquivo crescer, o índice continua de onde parou e a tela desce junto.
// - Editar (duplo clique, Enter, F2 ou começar a digitar): abre o Monaco num trecho de ~10 mil linhas em volta do
//   ponto, com os números de linha reais. Chegando perto da borda do trecho, ele entrega o que mudou ao núcleo e se
//   desloca (você continua rolando e digitando normalmente). O núcleo guarda as edições como remendos sobre o
//   original: ler e buscar já veem o arquivo editado, e o disco só muda ao salvar (Ctrl+S). Ctrl+Z desfaz dentro do
//   trecho e, quando acaba, desfaz os trechos já entregues.
const BV = { LH: 20, PAGE: 512, MAXH: 8e6, CACHE: 80 };
// trecho em edição: linhas antes e depois do ponto, e a distância da borda que faz o trecho se deslocar
const BV_SEG = { before: 3000, after: 7000, edge: 400 };
const bvApi = (t, route, params, opt) => api('big/' + route, { project: t.project, file: t.path, ...params }, opt);
const bvN = (n) => n.toLocaleString('pt-BR');

function bvBuild(t, el) {
  t.bv = { total: 0, done: false, pages: new Map(), loading: new Map(), q: '', hits: [], cur: -1, follow: false, re: null, size: 0, rev: 0, sel: -1, seg: null, chain: Promise.resolve() };
  el.innerHTML = BS.fileViewer.bar(t,
    `<span class="bv-edbar" data-edbar hidden><span class="bv-edn" data-edn></span><button class="icon-btn" data-a="undo" title="Desfazer (Ctrl+Z)">↶</button><button class="icon-btn" data-a="redo" title="Refazer (Ctrl+Y)">↷</button><button class="chip" data-a="discard" title="Descartar as edições não salvas (dá para desfazer)">Descartar</button></span>`
    + `<button class="chip" data-a="edit" title="Editar a partir da linha selecionada (duplo clique, Enter, F2 ou começar a digitar)">Editar</button>`
    + `<div class="bv-find"><input data-q placeholder="Buscar no arquivo todo (Ctrl+F)" spellcheck="false"><button class="bv-opt" data-o="case" title="Diferenciar maiúsculas">Aa</button><button class="bv-opt" data-o="regex" title="Expressão regular">.*</button><span class="bv-count" data-count></span><button class="icon-btn" data-a="prev" title="Anterior (Shift+Enter)">↑</button><button class="icon-btn" data-a="next" title="Próximo (Enter / F3)">↓</button></div>`
    + `<input class="bv-go" data-go placeholder="Linha…" title="Ir para a linha (Ctrl+G)" inputmode="numeric">`
    + `<label class="bv-follow" title="Acompanhar o fim do arquivo enquanto ele cresce (tail -f)"><input type="checkbox" data-follow> Acompanhar fim</label>`)
    + `<div class="bv-stale" data-stale hidden>O arquivo foi alterado fora da IDE depois das suas edições, e elas não se encaixam mais nele.<span class="spacer"></span><button class="chip" data-a="discard">Descartar edições</button></div>`
    + `<div class="bv-scroll" data-scroll tabindex="0"><div class="bv-rows" data-rows></div><div class="bv-sizer" data-sizer></div></div>`
    + `<div class="bv-edit" data-edit hidden><div class="bv-edhead"><span data-edrange></span><span class="spacer"></span><span class="bv-edtip">o trecho acompanha a rolagem · <kbd>Esc</kbd> volta ao leitor</span><button class="chip" data-a="done">Concluir</button></div><div class="bv-edhost" data-edhost></div></div>`
    + `<div class="bv-hits" data-hits hidden><div class="bv-hits-head"><span data-hitsum></span><span class="spacer"></span><button class="icon-btn" data-a="closehits" title="Fechar resultados">×</button></div><div class="bv-hits-list" data-hitlist></div></div>`;
  const $$ = (s) => el.querySelector(s);
  t.bv.ui = { scroll: $$('[data-scroll]'), sizer: $$('[data-sizer]'), rows: $$('[data-rows]'), q: $$('[data-q]'), go: $$('[data-go]'), count: $$('[data-count]'), hits: $$('[data-hits]'), hitlist: $$('[data-hitlist]'), hitsum: $$('[data-hitsum]'), follow: $$('[data-follow]'), edbar: $$('[data-edbar]'), edn: $$('[data-edn]'), stale: $$('[data-stale]'), edit: $$('[data-edit]'), edhost: $$('[data-edhost]'), edrange: $$('[data-edrange]') };
  const u = t.bv.ui;
  t.bv.opt = { case: store.get('bvCase', false), regex: store.get('bvRegex', false) };
  el.querySelectorAll('[data-o]').forEach(b => { b.classList.toggle('on', t.bv.opt[b.dataset.o]); b.onclick = () => { t.bv.opt[b.dataset.o] = !t.bv.opt[b.dataset.o]; store.set(b.dataset.o === 'case' ? 'bvCase' : 'bvRegex', t.bv.opt[b.dataset.o]); b.classList.toggle('on'); bvSearch(t, true); }; });
  const acts = {
    prev: () => bvStep(t, -1), next: () => bvStep(t, 1), closehits: () => { u.hits.hidden = true; },
    reveal: () => BS.fileViewer.act(t, 'reveal'), edit: () => bvEdit(t, bvSelLine(t)), done: () => bvDone(t),
    undo: () => bvHistory(t, 'undo'), redo: () => bvHistory(t, 'redo'), discard: () => bvHistory(t, 'discard'),
  };
  el.querySelectorAll('[data-a]').forEach(b => { if (acts[b.dataset.a]) b.onclick = acts[b.dataset.a]; });
  let qt = null;
  u.q.oninput = () => { clearTimeout(qt); qt = setTimeout(() => bvSearch(t), 450); };
  u.q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (u.q.value !== t.bv.q) bvSearch(t); else bvStep(t, e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { u.q.blur(); bvFocus(t); } };
  u.go.onkeydown = (e) => { if (e.key === 'Enter') { const n = parseInt(u.go.value.replace(/\D/g, ''), 10); u.go.value = ''; if (n) bvGoto(t, n); else bvFocus(t); } if (e.key === 'Escape') { u.go.value = ''; bvFocus(t); } };
  u.follow.onchange = () => { t.bv.follow = u.follow.checked; if (t.bv.follow) { if (t.bv.seg) bvDone(t); bvGoto(t, t.bv.total, true); } };
  u.scroll.addEventListener('scroll', () => { bvRender(t); if (t.bv.follow && !bvAtEnd(t)) { t.bv.follow = false; u.follow.checked = false; } }, { passive: true });
  // linhas: clique seleciona, duplo clique edita ali (com o cursor na coluna clicada)
  u.rows.addEventListener('mousedown', (e) => { const r = e.target.closest('.bv-row'); if (r && e.detail === 1) { t.bv.sel = +r.dataset.l; bvRender(t); } });
  u.rows.addEventListener('dblclick', (e) => { const r = e.target.closest('.bv-row'); if (r) { e.preventDefault(); bvEdit(t, +r.dataset.l, { col: bvColAt(r, e) }); } });
  u.scroll.addEventListener('keydown', (e) => {
    const b = t.bv, k = keyCombo(e);
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); bvSelect(t, (b.sel < 0 ? bvFirst(t) : b.sel + (k === 'ArrowDown' ? 1 : -1))); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); bvEdit(t, bvSelLine(t)); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); bvEdit(t, bvSelLine(t), { type: e.key }); }
  });
  el.addEventListener('keydown', (e) => {
    const k = keyCombo(e), field = e.target.closest('input') && !e.target.closest('.bv-edhost');
    if (k === 'Ctrl+F') { e.preventDefault(); e.stopPropagation(); u.q.focus(); u.q.select(); }
    else if (k === 'Ctrl+G') { e.preventDefault(); e.stopPropagation(); u.go.focus(); }
    else if (k === 'F3' || k === 'Shift+F3') { e.preventDefault(); bvStep(t, e.shiftKey ? -1 : 1); }
    else if (t.bv.seg || field) return;
    else if (k === 'Ctrl+Z') { e.preventDefault(); bvHistory(t, 'undo'); }
    else if (k === 'Ctrl+Y' || k === 'Ctrl+Shift+Z') { e.preventDefault(); bvHistory(t, 'redo'); }
    else if (k === 'Ctrl+End' && e.target === u.scroll) { e.preventDefault(); bvGoto(t, t.bv.total, true); }
    else if (k === 'Ctrl+Home' && e.target === u.scroll) { e.preventDefault(); u.scroll.scrollTop = 0; }
  });
  bvInfo(t);
}
const bvFocus = (t) => { if (t.bv.seg) t.bv.ed.focus(); else t.bv.ui.scroll.focus(); };

// ----- índice: tamanho e linhas (enquanto o núcleo indexa, a contagem cresce) -----
async function bvInfo(t) {
  if (!t.el || !t.bv) return;
  let r; try { r = await bvApi(t, 'info'); } catch (e) { t.bv.ui.rows.innerHTML = `<div class="vw-msg">Não deu para ler: ${esc(e.message)}</div>`; return; }
  if (!t.bv) return;
  const b = t.bv, grewFrom = b.total;
  if (r.size < b.size) bvForget(t); // encolheu ou foi reescrito: esquece tudo
  else if (r.lines !== b.total) b.pages.delete(Math.floor(Math.max(0, grewFrom - 1) / BV.PAGE)); // a última página cresceu
  bvState(t, r);
  if (t.goLine && b.total >= t.goLine) { const l = t.goLine; t.goLine = null; bvGoto(t, l); }
  else if (b.follow) bvGoto(t, b.total, true);
  if (!r.done) { clearTimeout(b.infoT); b.infoT = setTimeout(() => bvInfo(t), 300); }
}
// páginas lidas não valem mais (o arquivo editado mudou)
function bvForget(t) { const b = t.bv; b.pages.clear(); b.rev++; }
// estado vindo do núcleo (info, edição, desfazer, salvar)
function bvState(t, r) {
  const b = t.bv; if (!b) return;
  b.total = r.lines; b.size = r.size; b.done = r.done; b.stale = r.stale; b.undo = r.undo; b.redo = r.redo; b.edits = r.edits; b.dirtyCore = r.dirty;
  t.size = r.size;
  t.dims = r.done ? `${bvN(r.lines)} linhas` : `indexando ${Math.round(r.progress * 100)}% · ${bvN(r.lines)} linhas até agora`;
  if (b.savedMsg) t.dims += ' · ' + b.savedMsg;
  const u = b.ui;
  u.edbar.hidden = !(r.dirty || r.undo || r.redo);
  u.edn.textContent = r.stale ? 'edições perdidas' : r.edits ? `${bvN(r.edits)} ${r.edits === 1 ? 'trecho editado' : 'trechos editados'} · não salvo` : '';
  u.edbar.querySelector('[data-a="undo"]').disabled = !r.undo; u.edbar.querySelector('[data-a="redo"]').disabled = !r.redo;
  u.edbar.querySelector('[data-a="discard"]').hidden = !r.dirty;
  u.stale.hidden = !r.stale;
  bvDirty(t);
  vwMeta(t); bvLayout(t);
}
// a aba fica "não salva" com edições no núcleo ou no trecho aberto
function bvDirty(t) {
  const b = t.bv, d = !!(b.dirtyCore || (b.seg && b.seg.model.getAlternativeVersionId() !== b.seg.ver0));
  if (d !== !!t.dirty) { t.dirty = d; renderTabs(); syncUnsaved(); }
}

// ----- rolagem virtual -----
const bvViewRows = (t) => Math.ceil(t.bv.ui.scroll.clientHeight / BV.LH) + 1;
const bvScaled = (t) => t.bv.total * BV.LH > BV.MAXH;
// as linhas ficam numa camada fixa (sticky) do tamanho da janela; o "sizer" logo abaixo dá a altura da rolagem
// (com margem negativa da mesma altura, a camada não aumenta a área rolável)
function bvLayout(t) {
  const u = t.bv.ui, h = u.scroll.clientHeight;
  u.rows.style.height = h + 'px'; u.sizer.style.marginTop = -h + 'px';
  u.sizer.style.height = Math.max(h, Math.min(t.bv.total * BV.LH + 8, BV.MAXH)) + 'px';
  u.rows.style.setProperty('--gw', String(Math.max(3, String(t.bv.total).length)) + 'ch');
  bvRender(t);
}
function bvFirst(t) {
  const s = t.bv.ui.scroll;
  if (!bvScaled(t)) return Math.floor(s.scrollTop / BV.LH);
  const room = Math.max(1, s.scrollHeight - s.clientHeight);
  return Math.round(s.scrollTop / room * Math.max(0, t.bv.total - bvViewRows(t) + 1));
}
const bvAtEnd = (t) => { const s = t.bv.ui.scroll; return s.scrollTop + s.clientHeight >= s.scrollHeight - 4; };
// rola até a linha n (base 1); end: encosta no fim. Com um trecho em edição, vai até lá no editor
function bvGoto(t, n, end, col, len) {
  const b = t.bv, s = b.ui.scroll; n = Math.max(1, Math.min(n, b.total || 1));
  if (b.seg) return bvSegGoto(t, n - 1, col, len);
  if (end) { s.scrollTop = s.scrollHeight; return; }
  const view = bvViewRows(t), target = Math.max(0, n - 1 - Math.floor(view / 2));
  s.scrollTop = bvScaled(t) ? target / Math.max(1, b.total - view + 1) * (s.scrollHeight - s.clientHeight) : target * BV.LH;
  b.flash = n; setTimeout(() => { if (b.flash === n) { b.flash = null; bvRender(t); } }, 1400);
  bvRender(t);
}
function bvRender(t) {
  const b = t.bv; if (!b || !t.el || b.seg) return;
  const u = b.ui, first = bvFirst(t), view = bvViewRows(t), last = Math.min(b.total, first + view);
  const need = new Set(); let html = '';
  for (let i = first; i < last; i++) {
    const p = Math.floor(i / BV.PAGE), page = b.pages.get(p);
    if (!page) { need.add(p); html += `<div class="bv-row ghost" data-l="${i}"><span class="ln">${i + 1}</span><span class="tx">…</span></div>`; continue; }
    page.used = performance.now();
    const k = i - p * BV.PAGE, text = page.lines[k] ?? '', cut = page.cut.get(k);
    const hitHere = b.hits.length && b.cur >= 0 && b.hits[b.cur].line === i;
    html += `<div class="bv-row${b.flash === i + 1 ? ' flash' : ''}${hitHere ? ' cur' : ''}${page.edited.has(k) ? ' ed' : ''}${b.sel === i ? ' sel' : ''}" data-l="${i}"><span class="ln">${i + 1}</span><span class="tx">${bvMark(t, text, hitHere ? b.hits[b.cur] : null)}${cut ? `<span class="bv-cut">… +${bvN(cut)} caracteres</span>` : ''}</span></div>`;
  }
  // rolagem 1:1: desloca a camada pela fração de linha já rolada (rolagem suave)
  const off = bvScaled(t) ? 0 : u.scroll.scrollTop - first * BV.LH;
  u.rows.innerHTML = `<div style="transform:translateY(${-off}px)">${html}</div>`;
  // páginas visíveis e as vizinhas (rolagem para os dois lados)
  const fp = Math.floor(first / BV.PAGE), lp = Math.floor(Math.max(first, last - 1) / BV.PAGE);
  need.forEach(p => bvLoad(t, p));
  [fp - 1, lp + 1].forEach(p => { if (p >= 0 && p * BV.PAGE < b.total && !b.pages.has(p)) bvLoad(t, p); });
  if (S.active === t) $('#stPos').textContent = b.total ? `${bvN(first + 1)}–${bvN(last)} de ${bvN(b.total)}` : '';
}
async function bvLoad(t, p) {
  const b = t.bv; if (b.loading.has(p)) return;
  const rev = b.rev, pr = bvApi(t, 'lines', { from: p * BV.PAGE, count: BV.PAGE });
  b.loading.set(p, pr);
  try {
    const r = await pr;
    if (t.bv !== b || rev !== b.rev) return; // o arquivo editado mudou enquanto lia: a página já não vale
    const edited = new Set(); (r.edited || []).forEach(([a, n]) => { for (let i = a; i < a + n; i++) edited.add(i); });
    b.pages.set(p, { lines: r.lines, cut: new Map(r.cut), edited, used: performance.now() });
    // cache pequeno: descarta as páginas usadas há mais tempo
    if (b.pages.size > BV.CACHE) [...b.pages.entries()].sort((x, y) => x[1].used - y[1].used).slice(0, b.pages.size - BV.CACHE).forEach(([k]) => b.pages.delete(k));
    if (S.active === t) bvRender(t);
  } catch (e) { console.warn('big/lines', e); }
  finally { if (b.loading.get(p) === pr) b.loading.delete(p); }
}
// destaca os achados da busca nas linhas visíveis
function bvMark(t, text, cur) {
  const re = t.bv.re; if (!re || !text) return esc(text);
  let out = '', at = 0; re.lastIndex = 0;
  for (let m; (m = re.exec(text));) {
    if (!m[0].length) { re.lastIndex++; continue; }
    const on = cur && m.index === cur.col;
    out += esc(text.slice(at, m.index)) + `<mark${on ? ' class="cur"' : ''}>${esc(m[0])}</mark>`; at = m.index + m[0].length;
    if (out.length > 200000) break;
  }
  return out + esc(text.slice(at));
}
// linha selecionada (ou a do meio da tela) e seleção pelo teclado
const bvSelLine = (t) => { const b = t.bv, f = bvFirst(t), v = bvViewRows(t); return b.sel >= f && b.sel < f + v ? b.sel : Math.min(Math.max(0, b.total - 1), f + Math.floor(v / 3)); };
function bvSelect(t, i) {
  const b = t.bv; b.sel = Math.max(0, Math.min(b.total - 1, i));
  const f = bvFirst(t), v = bvViewRows(t) - 2;
  if (b.sel < f || b.sel >= f + v) bvGoto(t, b.sel + 1); else bvRender(t);
}
// coluna (base 1) do ponto clicado numa linha
function bvColAt(row, e) {
  const tx = row.querySelector('.tx'), r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!tx || !r || !tx.contains(r.startContainer)) return 1;
  const pre = document.createRange(); pre.setStart(tx, 0); pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length + 1;
}

// ----- busca no arquivo inteiro (no núcleo) -----
async function bvSearch(t, force) {
  const b = t.bv, u = b.ui, q = u.q.value;
  if (q === b.q && !force) return;
  b.q = q; b.hits = []; b.cur = -1;
  try { b.re = q ? new RegExp(b.opt.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g' + (b.opt.case ? '' : 'i')) : null; } catch { b.re = null; }
  if (!q) { u.count.textContent = ''; u.hits.hidden = true; bvRender(t); return; }
  u.count.textContent = 'buscando…';
  // o trecho em edição entra antes: a busca enxerga o que você acabou de digitar
  if (b.seg) await bvCommit(t);
  const seq = b.seq = (b.seq || 0) + 1, t0 = performance.now();
  let r;
  try { r = await bvApi(t, 'search', { q, case: b.opt.case ? '1' : null, regex: b.opt.regex ? '1' : null }); }
  catch (e) { if (seq === b.seq) { u.count.textContent = ''; toast(e.message, 'err'); } return; }
  if (seq !== b.seq || r.cancelled || t.bv !== b) return;
  b.hits = r.hits;
  const ms = Math.round(performance.now() - t0);
  u.count.textContent = r.total ? `${bvN(r.total)}` : 'nada';
  u.hitsum.textContent = r.total ? `${bvN(r.total)} ${r.total === 1 ? 'resultado' : 'resultados'}${r.more ? ` (mostrando os primeiros ${bvN(r.hits.length)})` : ''} · ${ms} ms` : `Nada encontrado · ${ms} ms`;
  bvHitList(t); u.hits.hidden = false;
  if (b.hits.length) { const first = b.seg ? bvSegTop(t) : bvFirst(t); b.cur = Math.max(0, b.hits.findIndex(h => h.line >= first)); bvShowHit(t); } else bvRender(t);
}
// lista de resultados, também virtual (até 5000 achados)
function bvHitList(t) {
  const b = t.bv, list = b.ui.hitlist, H = 22;
  list.innerHTML = `<div style="height:${b.hits.length * H}px;position:relative" data-hs></div>`;
  const hs = list.firstChild;
  const paint = () => {
    const a = Math.max(0, Math.floor(list.scrollTop / H) - 5), z = Math.min(b.hits.length, a + Math.ceil(list.clientHeight / H) + 10);
    let html = '';
    for (let i = a; i < z; i++) {
      const h = b.hits[i], pre = h.text.slice(0, h.tcol), hit = h.text.slice(h.tcol, h.tcol + h.len), post = h.text.slice(h.tcol + h.len);
      html += `<div class="bv-hit${i === b.cur ? ' on' : ''}" data-i="${i}" style="top:${i * H}px"><span class="ln">${bvN(h.line + 1)}</span><span class="tx">${esc(pre)}<mark>${esc(hit)}</mark>${esc(post)}</span></div>`;
    }
    hs.innerHTML = html;
    hs.querySelectorAll('.bv-hit').forEach(r => r.onclick = () => { b.cur = +r.dataset.i; bvShowHit(t); });
  };
  list.onscroll = paint; b.paintHits = paint; paint();
}
function bvShowHit(t) {
  const b = t.bv, h = b.hits[b.cur]; if (!h) return;
  bvGoto(t, h.line + 1, false, h.col + 1, h.len);
  const list = b.ui.hitlist, y = b.cur * 22;
  if (y < list.scrollTop || y > list.scrollTop + list.clientHeight - 22) list.scrollTop = y - list.clientHeight / 2;
  b.paintHits && b.paintHits();
  b.ui.count.textContent = `${bvN(b.cur + 1)} / ${bvN(b.hits.length)}`;
}
function bvStep(t, d) {
  const b = t.bv; if (!b.hits.length) { if (b.ui.q.value) bvSearch(t, true); return; }
  b.cur = (b.cur + d + b.hits.length) % b.hits.length; bvShowHit(t);
}

// ----- edição: um trecho no Monaco por vez -----
// seg = { v0, v1, model, ver0, base }: o modelo mostra as linhas [v0, v1) do arquivo editado; ver0 = versão do modelo
// que o núcleo já tem (mudou desde então = há o que entregar) e base = as linhas dessa versão
async function bvEdit(t, line, o = {}) {
  const b = t.bv;
  if (!b.done) return toast('Espere terminar de indexar o arquivo para editar', 'err');
  if (b.stale) return toast('O arquivo mudou fora da IDE; descarte as edições antigas para editar', 'err');
  if (b.opening) return; b.opening = true;
  try {
    if (b.seg) await bvCommit(t);
    if (b.follow) { b.follow = false; b.ui.follow.checked = false; }
    line = Math.max(0, Math.min(line, Math.max(0, b.total - 1)));
    const top = o.top ?? Math.max(0, line - 5);
    let v0 = Math.max(0, line - BV_SEG.before), r;
    try { r = await bvApi(t, 'lines', { from: v0, count: Math.min(b.total, line + BV_SEG.after) - v0, full: '1' }); }
    catch (e) {
      // linhas enormes: tenta um trecho bem menor
      v0 = Math.max(0, line - 50);
      try { r = await bvApi(t, 'lines', { from: v0, count: 100, full: '1' }); } catch (e2) { return toast(e2.message, 'err'); }
    }
    if (t.bv !== b) return;
    const old = b.seg && b.seg.model;
    const model = monaco.editor.createModel(r.lines.join('\n'), langOf(t.path));
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    b.seg = { v0, v1: v0 + r.lines.length, model, ver0: model.getAlternativeVersionId(), base: r.lines };
    const ed = bvEditor(t);
    ed.setModel(model); old && old.dispose();
    b.ui.scroll.hidden = true; b.ui.edit.hidden = false;
    bvSegHead(t);
    ed.layout();
    ed.setScrollTop(ed.getTopForLineNumber(Math.max(1, top - v0 + 1)));
    const pos = { lineNumber: Math.min(model.getLineCount(), line - v0 + 1), column: o.col || 1 };
    if (o.sel) ed.setSelection(o.sel); else ed.setPosition(pos);
    if (o.reveal) ed.revealPositionInCenterIfOutsideViewport(pos);
    ed.focus();
    if (o.type) ed.trigger('keyboard', 'type', { text: o.type });
  } finally { b.opening = false; }
}
function bvEditor(t) {
  const b = t.bv;
  if (b.ed) return b.ed;
  const ed = b.ed = monaco.editor.create(b.ui.edhost, { ...editorOpts(), lineNumbers: (n) => b.seg ? bvN(b.seg.v0 + n) : String(n), lineNumbersMinChars: Math.max(5, String(b.total).length + 2), stickyScroll: { enabled: false } });
  const K = monaco.KeyMod, C = monaco.KeyCode;
  ed.addCommand(K.CtrlCmd | C.KeyS, () => save());
  ed.addCommand(C.Escape, () => bvDone(t), '!findWidgetVisible && !suggestWidgetVisible && !inSnippetMode && !parameterHintsVisible && !editorHasMultipleSelections && !renameInputVisible');
  ed.addCommand(K.CtrlCmd | C.KeyF, () => { b.ui.q.focus(); b.ui.q.select(); });
  ed.addCommand(K.CtrlCmd | C.KeyG, () => b.ui.go.focus());
  // desfazer: primeiro dentro do trecho; acabou, desfaz os trechos já entregues ao núcleo
  ed.addCommand(K.CtrlCmd | C.KeyZ, () => { const m = b.seg && b.seg.model; if (m && (m.canUndo ? m.canUndo() : true)) ed.trigger('bs', 'undo'); else bvHistory(t, 'undo'); });
  ed.onDidChangeModelContent(() => bvDirty(t));
  ed.onDidChangeCursorPosition((e) => { if (b.seg && S.active === t) $('#stPos').textContent = `${bvN(b.seg.v0 + e.position.lineNumber)}:${e.position.column}`; });
  // perto da borda do trecho: entrega o que mudou e desloca o trecho para continuar dali
  ed.onDidScrollChange(() => { clearTimeout(b.edgeT); b.edgeT = setTimeout(() => bvEdge(t), 60); });
  return ed;
}
function bvSegHead(t) {
  const b = t.bv, s = b.seg; if (!s) return;
  const n = s.model.getLineCount();
  b.ui.edrange.innerHTML = `Editando as linhas <b>${bvN(s.v0 + 1)}–${bvN(s.v0 + n)}</b> de ${bvN(b.total - (s.v1 - s.v0) + n)}`;
}
const bvSegTop = (t) => { const b = t.bv, r = b.ed.getVisibleRanges()[0]; return b.seg.v0 + (r ? r.startLineNumber - 1 : 0); };
function bvEdge(t) {
  const b = t.bv, s = b && b.seg; if (!s || b.opening || S.active !== t) return;
  const r = b.ed.getVisibleRanges()[0]; if (!r) return;
  const n = s.model.getLineCount(), totalNow = b.total - (s.v1 - s.v0) + n;
  if (!((r.startLineNumber < BV_SEG.edge && s.v0 > 0) || (r.endLineNumber > n - BV_SEG.edge && s.v0 + n < totalNow))) return;
  // reabre o trecho em volta do que está na tela, com a mesma rolagem, cursor e seleção
  const top = s.v0 + r.startLineNumber - 1, mid = top + Math.floor((r.endLineNumber - r.startLineNumber) / 2);
  // a seleção é guardada em linhas reais e devolvida em linhas do trecho novo
  const sel = b.ed.getSelection(), selV = sel && [s.v0 + sel.startLineNumber - 1, sel.startColumn, s.v0 + sel.endLineNumber - 1, sel.endColumn];
  bvEdit(t, mid, { top }).then(() => {
    if (!b.seg || !selV) return;
    const v0 = b.seg.v0, n = b.seg.model.getLineCount(), inSeg = (v) => v >= v0 && v < v0 + n;
    // o cursor ficou para trás do trecho novo: vai para a primeira linha visível (como quem rola e clica ali)
    if (inSeg(selV[0]) && inSeg(selV[2])) b.ed.setSelection(new monaco.Selection(selV[0] - v0 + 1, selV[1], selV[2] - v0 + 1, selV[3]));
    else b.ed.setPosition({ lineNumber: top - v0 + 1, column: 1 });
  });
}
// entrega o trecho ao núcleo (se mudou); os pedidos vão em fila, na ordem
function bvCommit(t) {
  const b = t.bv, s = b && b.seg; if (!s) return Promise.resolve(true);
  const ver = s.model.getAlternativeVersionId();
  if (ver === s.ver0) return b.chain;
  // o texto é pego já (o modelo pode sumir: aba fechando); o trecho passa a valer como entregue.
  // Só vai o miolo que mudou: as linhas iguais no começo e no fim do trecho ficam de fora
  const cur = s.model.getLinesContent(), old = s.base;
  let a = 0, z = 0;
  while (a < cur.length && a < old.length && cur[a] === old[a]) a++;
  while (z < cur.length - a && z < old.length - a && cur[cur.length - 1 - z] === old[old.length - 1 - z]) z++;
  const mid = cur.slice(a, cur.length - z), from = s.v0 + a, to = s.v0 + old.length - z;
  const prev = { v1: s.v1, ver0: s.ver0, base: s.base };
  s.v1 = s.v0 + cur.length; s.ver0 = ver; s.base = cur;
  if (from === to && !mid.length) return b.chain; // voltou ao que era
  const run = b.chain.then(async () => {
    try {
      const r = await bvApi(t, 'edit', { from, to, del: mid.length ? null : '1' }, { method: 'POST', body: mid.join('\n') });
      if (t.bv === b) { bvForget(t); bvState(t, r); }
      return true;
    } catch (e) {
      // não entrou: o trecho continua com o que falta entregar
      if (b.seg === s) Object.assign(s, prev);
      toast('Não deu para aplicar a edição: ' + e.message, 'err'); return false;
    }
  });
  b.chain = run.catch(() => false);
  return run;
}
// volta ao leitor, na linha do cursor
async function bvDone(t) {
  const b = t.bv, s = b.seg; if (!s) return;
  const pos = b.ed.getPosition(), line = s.v0 + (pos ? pos.lineNumber - 1 : 0);
  if (!(await bvCommit(t))) return;
  if (b.seg !== s) return;
  b.seg = null; b.ed.setModel(null); s.model.dispose();
  b.ui.edit.hidden = true; b.ui.scroll.hidden = false;
  b.sel = line; bvLayout(t); bvGoto(t, line + 1); b.ui.scroll.focus();
  bvDirty(t);
}
// ir para a linha com o trecho aberto: dentro dele, só move o cursor; fora, desloca o trecho até lá
function bvSegGoto(t, line, col, len) {
  const b = t.bv, s = b.seg, n = s.model.getLineCount();
  if (line >= s.v0 && line < s.v0 + n) {
    const ln = line - s.v0 + 1, c = col || 1;
    b.ed.setSelection(new monaco.Selection(ln, c, ln, c + (len || 0)));
    b.ed.revealLineInCenter(ln); b.ed.focus();
    return;
  }
  bvEdit(t, line, { top: Math.max(0, line - 15), col, sel: null }).then(() => { if (len && b.seg) { const ln = line - b.seg.v0 + 1; b.ed.setSelection(new monaco.Selection(ln, col || 1, ln, (col || 1) + len)); } });
}
// desfazer / refazer / descartar no núcleo
async function bvHistory(t, a) {
  const b = t.bv;
  const s = b.seg, pos = s && b.ed.getPosition(), line = s ? s.v0 + (pos ? pos.lineNumber - 1 : 0) : null, top = s && bvSegTop(t);
  if (s && !(await bvCommit(t))) return;
  let r; try { r = await bvApi(t, 'history', { a }, { method: 'POST' }); } catch (e) { return toast(e.message, 'err'); }
  bvForget(t); bvState(t, r);
  // o trecho aberto já não confere com o núcleo: reabre no mesmo lugar
  if (b.seg) await bvEdit(t, Math.min(line, Math.max(0, b.total - 1)), { top, col: pos && pos.column });
  else bvRender(t);
}
// salvar: entrega o trecho aberto e manda o núcleo gravar (ver bigfile.rs: patch, tail ou rewrite)
async function bvSave(t, auto) {
  const b = t.bv; if (!b || b.saving) return;
  if (auto === true && (b.stale || !t.dirty)) return;
  if (b.seg && !(await bvCommit(t))) return;
  await b.chain;
  if (!b.dirtyCore) return;
  b.saving = true;
  try {
    const r = await bvApi(t, 'save', {}, { method: 'POST' });
    if (r.saved) b.savedMsg = `salvo em ${r.ms < 1000 ? r.ms + ' ms' : (r.ms / 1000).toFixed(1).replace('.', ',') + ' s'}`;
    clearTimeout(b.savedT); b.savedT = setTimeout(() => { b.savedMsg = ''; if (t.bv === b) bvInfo(t); }, 6000);
    refreshProject();
  } catch (e) { toast('Erro ao salvar ' + t.path.split('/').pop() + ': ' + e.message, 'err'); }
  finally { b.saving = false; }
  if (t.bv === b) { bvForget(t); await bvInfo(t); }
}

BS.fileViewer.custom.big = {
  build: bvBuild,
  show: (t) => { if (t.bv) requestAnimationFrame(() => { if (t.bv.seg) { t.bv.ed.layout(); bvSegHead(t); } else bvLayout(t); }); },
  // o arquivo mudou (log crescendo, ou o próprio salvar): o índice continua de onde parou
  reload: (t) => { if (t.bv && !t.bv.saving) bvInfo(t); },
  // fechar a aba: o trecho aberto é entregue (as edições continuam no núcleo até salvar ou descartar)
  close: (t) => { const b = t.bv; if (!b) return; clearTimeout(b.infoT); if (b.seg) { bvCommit(t); b.seg.model.dispose(); } b.ed && b.ed.dispose(); t.bv = null; },
  goto: (t, line) => { if (t.bv && t.bv.total >= line) bvGoto(t, line); else t.goLine = line; },
  save: bvSave,
};
window.addEventListener('resize', () => { const t = S.active; if (t && t.kind === 'big' && t.bv && !t.bv.seg) bvLayout(t); });
