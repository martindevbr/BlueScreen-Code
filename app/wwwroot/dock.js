// ===== Dock: os painéis de baixo (Terminal, Depurar, Build, Problemas e os de plugins) dividem um só espaço =====
// Cada painel continua dono do seu `hidden` (aberto/fechado); o dock só decide qual aparece e desenha as abas.
// Painel aberto vira aba; o que acabou de abrir fica na frente; fechar a da frente passa para a vizinha.
// Clicar na aba da frente recolhe o dock até a barra; arrastar a borda de cima ajusta a altura.
(() => {
  const { $, esc, store, I } = BS;
  const dock = $('#dock'), bar = $('#dockBar'), tabsEl = $('#dockTabs'), ink = $('#dockInk'), body = $('#dockBody');
  const GEAR = '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>';

  // como cada painel conhecido aparece na aba; um painel sem entrada usa o .ttl dele e um ícone genérico
  const META = {
    termCon: { tool: 'terminal', title: 'Terminal', hideTtl: true, close: '#tmHide',
      watch: ['#tmTabs'], status: () => { const n = $('#tmTabs').children.length; return { count: n > 1 ? n : 0 }; } },
    dbgCon: { tool: 'debug', title: 'Depurar', hideTtl: true, close: '#dbHide',
      watch: ['#dbState'], status: () => { const c = $('#dbState').className; return { dot: /pause/.test(c) ? 'warn' : /run/.test(c) ? 'ok' : /busy/.test(c) ? 'busy' : '' }; } },
    buildCon: { tool: 'build', title: 'Build', close: '#bcClose',
      watch: ['#bcState'], status: () => { const s = $('#bcState .bst'); const c = s ? s.className : ''; return { dot: /running/.test(c) ? 'busy' : /failed/.test(c) ? 'err' : /\bok\b/.test(c) ? 'ok' : '' }; } },
    problems: { tool: 'problems', title: 'Problemas', hideTtl: true, close: '#btnProbClose',
      watch: ['#probList'], status: () => { const all = $('#probList').querySelectorAll('.prob'); return { count: all.length, err: !!$('#probList .sev.error') }; } },
  };
  const metaOf = (p) => META[p.id] || { title: (p.querySelector('.head .ttl') || {}).textContent || p.id };
  const iconOf = (m) => (m.tool && BS.tools.get(m.tool) || {}).icon || GEAR;

  const D = { active: null, min: false, order: [] };
  const panels = () => [...body.children].filter(p => p.id);
  const isOpen = (p) => !p.hidden;

  // ----- abas -----
  function render() {
    const open = panels().filter(isOpen);
    if (!open.length) { D.active = null; dock.hidden = true; return; }
    if (!open.some(p => p.id === D.active)) D.active = open[open.length - 1].id;
    const known = new Set([...tabsEl.children].map(t => t.dataset.p));
    tabsEl.innerHTML = open.map((p, i) => {
      const m = metaOf(p);
      return `<button class="dk-tab${p.id === D.active ? ' on' : ''}${known.has(p.id) ? '' : ' new'}" role="tab" aria-selected="${p.id === D.active}" data-p="${esc(p.id)}" style="--i:${i}" title="${esc(m.title)}">${iconOf(m)}<span class="nm">${esc(m.title)}</span><span class="ct" hidden></span><span class="dot" hidden></span><span class="x" title="Fechar">${I.x}</span></button>`;
    }).join('');
    open.forEach(p => { p.classList.toggle('dock-on', p.id === D.active); p.classList.toggle('dock-ttl', !!metaOf(p).hideTtl); });
    panels().filter(p => !isOpen(p)).forEach(p => p.classList.remove('dock-on'));
    if (dock.hidden) { dock.hidden = false; dock.classList.remove('rise'); void dock.offsetWidth; dock.classList.add('rise'); }
    dock.classList.toggle('min', D.min);
    open.forEach(updStatus);
    requestAnimationFrame(moveInk);
  }
  function moveInk() {
    const t = tabsEl.querySelector('.dk-tab.on'); if (!t) return;
    ink.style.transform = `translateX(${t.offsetLeft}px)`; ink.style.width = t.offsetWidth + 'px';
    dock.style.setProperty('--tabs-w', bar.offsetWidth + 'px');
  }
  function updStatus(p) {
    const m = META[p.id], t = tabsEl.querySelector(`[data-p="${CSS.escape(p.id)}"]`); if (!m || !m.status || !t) return;
    let s; try { s = m.status(); } catch { return; }
    const ct = t.querySelector('.ct'), dot = t.querySelector('.dot');
    const n = s.count || 0, was = ct.textContent;
    ct.hidden = !n; ct.textContent = n || ''; ct.classList.toggle('err', !!s.err);
    if (n && String(n) !== was && was !== '') { ct.classList.remove('bump'); void ct.offsetWidth; ct.classList.add('bump'); }
    dot.hidden = !s.dot; dot.className = 'dot ' + (s.dot || '');
    requestAnimationFrame(moveInk);
  }

  function activate(id) {
    const prev = D.active; D.active = id; D.min = false;
    const open = panels().filter(isOpen), a = open.findIndex(p => p.id === prev), b = open.findIndex(p => p.id === id);
    render();
    const p = $('#' + CSS.escape(id));
    if (p && prev !== id) { p.style.setProperty('--dir', b < a ? -1 : 1); p.classList.remove('dock-in'); void p.offsetWidth; p.classList.add('dock-in'); }
  }
  function close(id) {
    const p = $('#' + CSS.escape(id)); if (!p) return;
    const m = metaOf(p), btn = m.close && $(m.close);
    if (D.active === id) { const open = panels().filter(isOpen), i = open.indexOf(p); const n = open[i + 1] || open[i - 1]; D.active = n ? n.id : null; }
    if (btn) btn.click(); else p.hidden = true;
  }

  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.dk-tab'); if (!t) return;
    if (e.target.closest('.x')) { close(t.dataset.p); return; }
    if (t.dataset.p === D.active) { D.min = !D.min; render(); return; }
    activate(t.dataset.p);
  });
  tabsEl.addEventListener('auxclick', (e) => { const t = e.target.closest('.dk-tab'); if (t && e.button === 1) close(t.dataset.p); });
  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const all = [...tabsEl.children], i = all.indexOf(document.activeElement); if (i < 0) return;
    const n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]; activate(n.dataset.p); tabsEl.querySelector(`[data-p="${CSS.escape(n.dataset.p)}"]`).focus();
  });

  // ----- quem abre/fecha: os próprios painéis, mudando `hidden` -----
  const watched = new WeakSet();
  const onHidden = new MutationObserver((recs) => {
    for (const r of recs) {
      const p = r.target, was = r.oldValue !== null;
      if (was && isOpen(p)) { activate(p.id); return; }   // acabou de abrir: vem para a frente
    }
    render();
  });
  const onInner = new MutationObserver((recs) => { const seen = new Set(); recs.forEach(r => { const p = r.target.closest && r.target.closest('#dockBody > *') || r.target.parentElement?.closest('#dockBody > *'); if (p && !seen.has(p)) { seen.add(p); updStatus(p); } }); });
  function adopt() {
    panels().forEach(p => {
      if (watched.has(p)) return; watched.add(p);
      onHidden.observe(p, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
      (META[p.id]?.watch || []).forEach(sel => { const el = $(sel); if (el) onInner.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] }); });
    });
    render();
  }
  new MutationObserver(adopt).observe(body, { childList: true });
  new ResizeObserver(() => requestAnimationFrame(moveInk)).observe(tabsEl);

  // ----- altura: arrastar a borda (bem baixo recolhe), duplo clique volta ao padrão -----
  const setH = (h) => dock.style.setProperty('--dh', h + 'px');
  setH(store.get('dockH', 280));
  $('#dockResize').addEventListener('mousedown', (e) => {
    e.preventDefault(); const y0 = e.clientY, h0 = D.min ? 0 : body.offsetHeight + bar.offsetHeight; document.body.classList.add('resizing-v', 'dock-drag');
    const move = (ev) => { const h = h0 + (y0 - ev.clientY); if (h < 90) { if (!D.min) { D.min = true; render(); } return; } if (D.min) { D.min = false; render(); } setH(Math.min(innerHeight - 180, h)); };
    const up = () => { document.body.classList.remove('resizing-v', 'dock-drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); if (!D.min) store.set('dockH', parseInt(dock.style.getPropertyValue('--dh'))); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  $('#dockResize').addEventListener('dblclick', () => { D.min = false; setH(280); store.set('dockH', 280); render(); });

  // botão da barra da esquerda: painel aberto atrás de outro (ou dock recolhido) vem para a frente em vez de fechar
  BS.dock = {
    claim(toolId) {
      const id = Object.keys(META).find(k => META[k].tool === toolId); const p = id && $('#' + id);
      if (!p || !isOpen(p) || (D.active === id && !D.min)) return false;
      activate(id); return true;
    },
    activate, close, get active() { return D.active; },
  };
  adopt();
})();
