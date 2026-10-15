'use strict';
// ===== Visualizador de arquivos que não são texto =====
// Imagens, PDF, áudio, vídeo e fontes abrem numa aba própria, leve: o arquivo vem de /api/raw (com Range, então um
// vídeo grande não é lido inteiro) e quem desenha é o próprio WebView2 (decodificadores e leitor de PDF nativos).
// Outros binários (exe, dll, zip, class...) abrem num visualizador hexadecimal, 64 KB por vez.
// Texto grande demais para o editor (logs) abre só leitura com os primeiros 4 MB.
// A aba do visualizador tem mode 'view' e não tem modelo do Monaco; o elemento de cada aba fica guardado, então
// trocar de aba não recarrega a imagem nem perde o ponto do vídeo. Se o arquivo mudar no disco, recarrega sozinho.
const VW = { el: null, forceText: new Set() };
const VW_KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'],
  pdf: ['pdf'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac'],
  video: ['mp4', 'm4v', 'webm', 'ogv', 'mov'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
  // binários conhecidos: nem tenta ler como texto
  hex: ['exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'class', 'jar', 'war', 'zip', '7z', 'rar', 'gz', 'tgz', 'xz', 'bz2', 'pdb', 'obj', 'o', 'a', 'lib', 'pyc', 'wasm', 'sqlite', 'db', 'iso', 'msi', 'docx', 'xlsx', 'pptx', 'psd', 'tif', 'tiff', 'heic'],
};
const VW_LABEL = { image: 'imagem', pdf: 'PDF', audio: 'áudio', video: 'vídeo', font: 'fonte', hex: 'binário' };
const VW_BIG = 4 << 20;
const vwExt = (p) => (p.split('/').pop().split('.').pop() || '').toLowerCase();
const vwKind = (path) => { if (VW.forceText.has(path)) return null; const e = vwExt(path); for (const [k, list] of Object.entries(VW_KINDS)) if (list.includes(e)) return k; return null; };
const vwUrl = (t, extra = '') => `/api/raw?project=${encodeURIComponent(t.project)}&file=${encodeURIComponent(t.path)}&v=${t.ver || 0}${extra}`;
const vwSize = (n) => n == null ? '' : n < 1024 ? n + ' B' : n < 1 << 20 ? (n / 1024).toFixed(1) + ' KB' : n < 1 << 30 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';

function vwOpen(path, kind, line) {
  ensureEditors();
  const key = path + '::view';
  let tab = S.tabs.find(t => t.key === key && t.project === S.project.path);
  if (!tab) {
    tab = { key, path, mode: 'view', kind, project: S.project.path, lang: VW_LABEL[kind] + ' · ' + vwExt(path).toUpperCase(), editable: false, ver: Date.now(), view: { fit: true, zoom: 1 } };
    S.tabs.push(tab); BS.hooks.run('tab:open', tab);
  }
  activate(tab); seRemember(path);
}
// texto grande: só leitura, com o começo do arquivo
async function vwOpenBig(path, size, line) {
  const key = path + '::editor';
  let tab = S.tabs.find(t => t.key === key && t.project === S.project.path);
  if (!tab) {
    let text;
    try {
      const r = await fetch(`/api/raw?project=${encodeURIComponent(S.project.path)}&file=${encodeURIComponent(path)}&offset=0&len=${VW_BIG}`);
      text = new TextDecoder('utf-8').decode(await r.arrayBuffer());
    } catch (e) { toast('Não deu para abrir: ' + e.message); return; }
    const cut = text.lastIndexOf('\n'); if (cut > 0) text = text.slice(0, cut + 1);
    tab = { key, path, mode: 'editor', project: S.project.path, lang: langOf(path), editable: false, big: true };
    tab.model = monaco.editor.createModel(text, tab.lang, monaco.Uri.parse('bs:/' + encodeURIComponent(key)));
    tab.saved = text; tab.model._tab = tab;
    S.tabs.push(tab); BS.hooks.run('tab:open', tab);
    toast(`Arquivo grande (${vwSize(size)}): mostrando os primeiros ${vwSize(VW_BIG)}, só leitura`, null, 'big');
  }
  activate(tab); seRemember(path);
  if (line) revealAt(editor, line);
}

// ----- desenho de cada tipo -----
function vwBar(t, extra) {
  return `<div class="vw-bar"><span class="vw-name">${esc(t.path.split('/').pop())}</span><span class="vw-meta" data-meta></span><span class="spacer"></span>${extra || ''}`
    + `<button class="icon-btn" data-a="reveal" title="Mostrar no Explorer">${I.explorer}</button></div>`;
}
function vwBuild(t) {
  const el = document.createElement('div'); el.className = 'vw-pane vw-' + t.kind; t.el = el;
  const k = t.kind;
  if (k === 'image') {
    const svg = vwExt(t.path) === 'svg';
    el.innerHTML = vwBar(t, `<button class="chip" data-a="fit" title="Ajustar à janela / tamanho real (0)">Ajustar</button><button class="icon-btn" data-a="out" title="Diminuir (-)">−</button><span class="vw-zoom" data-zoom></span><button class="icon-btn" data-a="in" title="Aumentar (+)">+</button><button class="icon-btn" data-a="bg" title="Fundo: xadrez / claro / escuro">◩</button>${svg ? '<button class="chip" data-a="text" title="Abrir o SVG no editor">Editar como texto</button>' : ''}`)
      + `<div class="vw-stage bg-${store.get('vwBg', 'chk')}" data-stage><img data-img alt="" draggable="false"></div>`;
    const img = el.querySelector('[data-img]'), stage = el.querySelector('[data-stage]');
    img.onload = () => { t.dims = img.naturalWidth + ' × ' + img.naturalHeight; vwZoom(t); vwMeta(t); };
    img.onerror = () => { stage.innerHTML = '<div class="vw-msg">O WebView2 não conseguiu desenhar esta imagem.</div>'; };
    img.src = vwUrl(t);
    // Ctrl + roda do mouse: zoom (o resto rola a imagem)
    stage.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); vwSetZoom(t, (t.view.fit ? vwFitScale(t) : t.view.zoom) * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    stage.ondblclick = () => { t.view.fit = !t.view.fit; t.view.zoom = 1; vwZoom(t); };
  } else if (k === 'pdf') {
    el.innerHTML = vwBar(t) + `<iframe class="vw-frame" data-frame src="${vwUrl(t)}" title="PDF"></iframe>`;
  } else if (k === 'audio' || k === 'video') {
    el.innerHTML = vwBar(t) + `<div class="vw-stage vw-media">${k === 'audio' ? `<div class="vw-audio">${TI.file || ''}<audio data-media controls preload="metadata" src="${vwUrl(t)}"></audio></div>` : `<video data-media controls preload="metadata" src="${vwUrl(t)}"></video>`}</div>`;
    const m = el.querySelector('[data-media]');
    m.onloadedmetadata = () => { const d = m.duration; t.dims = (k === 'video' ? m.videoWidth + ' × ' + m.videoHeight + ' · ' : '') + (isFinite(d) ? new Date(d * 1000).toISOString().slice(d >= 3600 ? 11 : 14, 19) : ''); vwMeta(t); };
    m.onerror = () => { el.querySelector('.vw-stage').innerHTML = '<div class="vw-msg">Formato que o WebView2 não toca (o codec deste arquivo não é suportado).</div>'; };
  } else if (k === 'font') {
    el.innerHTML = vwBar(t) + '<div class="vw-font" data-font><div class="vw-msg">Carregando a fonte…</div></div>';
    vwFont(t);
  } else {
    el.innerHTML = vwBar(t) + '<div class="vw-hex" data-hex><pre data-pre></pre><button class="chip" data-a="more" hidden>Carregar mais 64 KB</button></div>';
    t.hexAt = 0; vwHex(t);
  }
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => vwAct(t, b.dataset.a));
  return el;
}
function vwMeta(t) { const m = t.el && t.el.querySelector('[data-meta]'); if (m) m.textContent = [t.dims, vwSize(t.size)].filter(Boolean).join(' · '); }
function vwAct(t, a) {
  if (a === 'reveal') return reveal(t.project + '\\' + t.path.replace(/\//g, '\\'));
  if (a === 'fit') { t.view.fit = !t.view.fit; t.view.zoom = 1; return vwZoom(t); }
  if (a === 'in' || a === 'out') return vwSetZoom(t, (t.view.fit ? vwFitScale(t) : t.view.zoom) * (a === 'in' ? 1.25 : 0.8));
  if (a === 'bg') { const order = ['chk', 'light', 'dark']; const n = order[(order.indexOf(store.get('vwBg', 'chk')) + 1) % 3]; store.set('vwBg', n); S.tabs.filter(x => x.kind === 'image' && x.el).forEach(x => { const s = x.el.querySelector('[data-stage]'); s.className = 'vw-stage bg-' + n; }); return; }
  if (a === 'text') { VW.forceText.add(t.path); const p = t.path; closeTab(t); return openFile(p, 'editor'); }
  if (a === 'more') return vwHex(t);
}
// ----- zoom da imagem -----
function vwFitScale(t) {
  const img = t.el.querySelector('[data-img]'), st = t.el.querySelector('[data-stage]');
  if (!img.naturalWidth) return 1;
  return Math.min(1, (st.clientWidth - 32) / img.naturalWidth, (st.clientHeight - 32) / img.naturalHeight);
}
function vwSetZoom(t, z) { t.view.fit = false; t.view.zoom = Math.max(0.05, Math.min(32, z)); vwZoom(t); }
function vwZoom(t) {
  const img = t.el && t.el.querySelector('[data-img]'); if (!img || !img.naturalWidth) return;
  const z = t.view.fit ? vwFitScale(t) : t.view.zoom;
  img.style.width = Math.round(img.naturalWidth * z) + 'px'; img.style.height = Math.round(img.naturalHeight * z) + 'px';
  img.classList.toggle('pixel', z > 2); // ampliado: pixels nítidos, como num editor de imagem
  t.el.querySelector('[data-zoom]').textContent = Math.round(z * 100) + '%';
  t.el.querySelector('[data-a="fit"]').textContent = t.view.fit ? 'Tamanho real' : 'Ajustar';
}
// ----- fonte: amostras em vários tamanhos -----
async function vwFont(t) {
  const box = t.el.querySelector('[data-font]');
  try {
    const fam = 'bsfont' + (t.fid = (t.fid || 0) + 1) + '_' + Math.random().toString(36).slice(2, 7);
    const face = new FontFace(fam, await (await fetch(vwUrl(t))).arrayBuffer());
    await face.load(); document.fonts.add(face);
    if (t.face) document.fonts.delete(t.face); t.face = face;
    const sample = 'A rápida raposa marrom pula sobre o cão preguiçoso.';
    box.innerHTML = `<div class="vw-glyphs" style="font-family:${fam}">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 ÀÉÎÕÇ àéîõç !?@#$%&amp;*()[]{}=&gt;&lt;/</div>`
      + [12, 16, 24, 36, 56].map(n => `<div class="vw-sample"><span class="sz">${n}</span><span style="font-family:${fam};font-size:${n}px">${sample}</span></div>`).join('')
      + `<div class="vw-sample edit"><span class="sz">teste</span><span contenteditable="true" spellcheck="false" style="font-family:${fam};font-size:28px">Digite aqui para testar</span></div>`;
    t.dims = [face.family && face.weight !== 'normal' ? 'peso ' + face.weight : '', face.style !== 'normal' ? face.style : ''].filter(Boolean).join(' · ');
  } catch (e) { box.innerHTML = `<div class="vw-msg">Não deu para carregar a fonte: ${esc(e.message)}</div>`; }
  vwMeta(t);
}
// ----- hexadecimal: 64 KB por vez -----
async function vwHex(t) {
  const CH = 65536, pre = t.el.querySelector('[data-pre]'), more = t.el.querySelector('[data-a="more"]');
  try {
    const r = await fetch(vwUrl(t, `&offset=${t.hexAt}&len=${CH}`));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    t.size = +r.headers.get('x-file-size');
    const b = new Uint8Array(await r.arrayBuffer()); const hex = (n, w) => n.toString(16).padStart(w, '0');
    let out = '';
    for (let i = 0; i < b.length; i += 16) {
      const row = b.subarray(i, i + 16); let h = '', a = '';
      for (let j = 0; j < 16; j++) { h += (j < row.length ? hex(row[j], 2) : '  ') + (j === 7 ? '  ' : ' '); a += j < row.length ? (row[j] >= 32 && row[j] < 127 ? String.fromCharCode(row[j]) : '·') : ''; }
      out += `${hex(t.hexAt + i, 8)}  ${h} ${a}\n`;
    }
    pre.textContent += out; t.hexAt += b.length;
    more.hidden = t.hexAt >= t.size; more.textContent = `Carregar mais 64 KB (${vwSize(t.hexAt)} de ${vwSize(t.size)})`;
  } catch (e) { pre.textContent = 'Não deu para ler o arquivo: ' + e.message; }
  vwMeta(t);
}

// mostra a aba no painel (o elemento de cada aba é reaproveitado)
function vwShow(t) {
  if (!t.el) vwBuild(t);
  [...VW.el.children].forEach(c => { if (c !== t.el) c.querySelectorAll('[data-media]').forEach(m => m.pause()); });
  if (VW.el.firstChild !== t.el) VW.el.replaceChildren(t.el);
  if (t.size == null && t.kind !== 'hex') fetch(vwUrl(t, '&offset=0&len=0')).then(r => { t.size = +r.headers.get('x-file-size'); vwMeta(t); }).catch(() => {});
  requestAnimationFrame(() => vwZoom(t));
  $('#stPos').textContent = '';
}
// o arquivo mudou no disco: recarrega sem perder o lugar
function vwReload(t) {
  t.ver = Date.now(); t.size = null; if (!t.el) return;
  const img = t.el.querySelector('[data-img]'); if (img) { img.src = vwUrl(t); }
  const fr = t.el.querySelector('[data-frame]'); if (fr) fr.src = vwUrl(t);
  const m = t.el.querySelector('[data-media]'); if (m) { const at = m.currentTime, playing = !m.paused; m.src = vwUrl(t); m.currentTime = at; if (playing) m.play().catch(() => {}); }
  if (t.kind === 'font') vwFont(t);
  if (t.kind === 'hex') { t.el.querySelector('[data-pre]').textContent = ''; t.hexAt = 0; vwHex(t); }
  if (S.active === t) vwShow(t);
}

(function vwInit() {
  VW.el = document.createElement('div'); VW.el.id = 'vw'; VW.el.style.display = 'none';
  $('#mon').appendChild(VW.el);
  BS.fileViewer = { kind: vwKind, open: vwOpen, openBig: vwOpenBig, show: vwShow, reload: vwReload, kinds: VW_KINDS };
  BS.hooks.on('tab:close', (t) => {
    if (t.mode !== 'view' || !t.el) return;
    t.el.querySelectorAll('[data-media]').forEach(m => { m.pause(); m.removeAttribute('src'); m.load(); });
    if (t.face) document.fonts.delete(t.face);
    t.el.remove(); t.el = null;
  });
  BS.hooks.on('files:changed', (proj, r) => {
    const touched = new Set((r.files || []).map(f => f.p));
    S.tabs.filter(t => t.mode === 'view' && t.project === proj && (r.all || touched.has(t.path))).forEach(vwReload);
  });
  // atalhos da imagem (só quando a aba de imagem está na frente e o foco não está num campo)
  document.addEventListener('keydown', (e) => {
    const t = S.active; if (!t || t.mode !== 'view' || t.kind !== 'image' || e.ctrlKey || e.altKey || e.target.closest('input, textarea, [contenteditable]')) return;
    if (e.key === '+' || e.key === '=') vwAct(t, 'in'); else if (e.key === '-') vwAct(t, 'out'); else if (e.key === '0') vwAct(t, 'fit'); else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => { const t = S.active; if (t && t.mode === 'view' && t.view.fit) vwZoom(t); });
})();
