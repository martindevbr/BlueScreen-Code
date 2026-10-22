// IAMaker: cria e altera plugins conversando com uma IA de linha de comando (Claude Code, Gemini CLI ou Codex CLI).
// Uma janela do balão flutuante (Alt+0). Cada pedido roda a IA escolhida na pasta do plugin (~/.bluescreen/plugins/<id>),
// com as instruções do GUIA.md e o pedido pela entrada padrão; a saída (JSON por linha) vira a conversa na tela.
// Quando a IA termina, o IAMaker confere o plugin.json e a sintaxe do ui.js e carrega o plugin na página aberta
// (bs.plugins.reload), sem recarregar a IDE. Plugin com erro: pede a correção sozinho (até 2 vezes). Sem servidor próprio.
const { S, api, $, esc, toast, store, I } = bs;

const ICO = {
  spark: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
  send: '<svg class="i" viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5 20 4"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  code: '<svg class="i" viewBox="0 0 24 24"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></svg>',
  tool: '<svg class="i" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  warn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
};

// as IAs: programa, onde ficam os argumentos e o modelo nas configurações, e como instalar
const AIS = {
  claude: { name: 'Claude Code', prog: 'claude', args: 'argsClaude', model: 'modelClaude', resume: true,
    effort: (e) => ['--effort', e],
    install: 'npm install -g @anthropic-ai/claude-code', login: 'claude' },
  gemini: { name: 'Gemini CLI', prog: 'gemini', args: 'argsGemini', model: 'modelGemini',
    effort: (e, cfg) => e === 'low' && !cfg.modelGemini ? ['--model', 'gemini-2.5-flash'] : [],
    install: 'npm install -g @google/gemini-cli', login: 'gemini' },
  codex: { name: 'Codex CLI', prog: 'codex', args: 'argsCodex', model: 'modelCodex', stdinDash: true,
    effort: (e) => ['-c', 'model_reasoning_effort=' + e],
    install: 'npm install -g @openai/codex', login: 'codex login' },
};
// quanto a IA pensa antes de escrever: rápido é o padrão; troca no topo do IAMaker a qualquer momento
const EFFORTS = { low: 'Rápido', medium: 'Equilibrado', high: 'Caprichado' };
// arquivos que mudam o que a IDE carrega: mudou algum, carrega o plugin de novo
const WATCH = ['plugin.json', 'ui.js', 'style.css', 'icon.svg', 'icon.png', 'server.js', 'server.py'];
const MAX_MSGS = 300, MAX_FIXES = 2;
// onde o componente vai aparecer: a IA avisa na primeira mensagem (IAMAKER-LUGAR: status), o IAMaker mostra um
// carregamento ali e, quando o plugin carrega, revela o que o plugin criou nesse lugar
const PLACES = { balao: 'balão flutuante', status: 'barra de status', esquerda: 'barra da esquerda', baixo: 'painel embaixo do editor', resumo: 'resumo do projeto', menu: 'menu de contexto', editor: 'editor', outro: 'IDE' };
const IN = { balao: 'no balão flutuante', status: 'na barra de status', esquerda: 'na barra da esquerda', baixo: 'no painel embaixo do editor', resumo: 'no resumo do projeto', menu: 'no menu de contexto', editor: 'no editor' };
const PLACE_RE = /^[ \t>*_`-]*IAMAKER-LUGAR:\s*([a-zçã]+)[`*_ \t]*\r?\n?/im;
const EXAMPLES = [
  'No balão flutuante, uma calculadora com histórico das contas',
  'Um painel embaixo do editor com um cronômetro Pomodoro de 25 minutos',
  'Um item na barra de status com a hora e quantas abas estão abertas',
  'No menu da árvore, "Contar linhas" mostra quantas linhas tem o arquivo',
  'Um painel na barra da esquerda com anotações por projeto, salvas sozinhas',
];

const M = {
  cfg: null, ai: null, id: store.get('iamPlugin', null), conv: null, run: null, guide: null,
  made: [], fixes: 0, pending: false,
};

// ----- a ferramenta no balão flutuante (bubble.js do núcleo) -----
if (!bs.bubble) { console.warn('IAMaker: esta versão do BlueScreen não tem o balão flutuante'); return; }
const con = document.createElement('div');
con.id = 'iam-con';
con.innerHTML = `
  <div class="iam-bar">
    <select class="iam-sel" id="iam-plug" title="Plugin que a IA está construindo"></select>
    <select class="iam-sel" id="iam-ai" title="Qual IA usar"></select>
    <select class="iam-sel iam-eff" id="iam-effort" title="Esforço: Rápido pensa menos e termina antes; Caprichado pensa mais"></select>
    <span class="iam-state" id="iam-state"></span>
    <span class="spacer"></span>
    <button class="icon-btn" id="iam-apply" title="Aplicar: carregar o plugin agora" hidden>${I.refresh}</button>
    <button class="icon-btn" id="iam-code" title="Ver o código do plugin (abre a pasta como projeto)">${ICO.code}</button>
    <button class="icon-btn" id="iam-dir" title="Mostrar a pasta do plugin">${I.explorer}</button>
    <button class="icon-btn" id="iam-clear" title="Nova conversa (o plugin continua)">${ICO.plus}</button>
    <button class="icon-btn" id="iam-cfg" title="Configurações do IAMaker">${I.gear}</button></div>
  <div class="iam-log" id="iam-log"></div>
  <form class="iam-in" id="iam-form">
    <textarea id="iam-q" rows="2" spellcheck="false" placeholder="Descreva o plugin ou a mudança. Enter envia, Shift+Enter quebra a linha."></textarea>
    <button type="submit" class="chip primary" id="iam-send" title="Enviar (Enter)">${ICO.send}<span>Enviar</span></button>
    <button type="button" class="chip" id="iam-stop" title="Parar a IA" hidden>${ICO.stop}<span>Parar</span></button>
  </form>`;
bs.bubble.register({
  id: 'iamaker', title: 'IAMaker', icon: ICO.spark, order: 10, width: 460, height: 600,
  render(el) { el.appendChild(con); },
  show() { if (!M.run) bs.bubble.badge('iamaker', null); render(); setTimeout(() => q.focus(), 60); },
});
const log = $('#iam-log'), q = $('#iam-q');

// Alt+0 abre a janela do IAMaker (ou minimiza, se ela já está na frente)
function show(on) {
  if (on === false) return bs.bubble.minimize('iamaker');
  if (on === undefined) return bs.bubble.toggle('iamaker');
  bs.bubble.open('iamaker');
}
bs.keys.add('Alt+0', () => show());
bs.actions.add([{ label: 'IAMaker: criar um plugin com IA', k: 'Alt+0', icon: ICO.spark, run: () => { show(true); pick(null); } }]);
// "Editar com o IAMaker" no cartão e no botão direito de cada plugin, na aba Plugins
const editWith = (id) => { show(true); pick(id); };
bs.hooks.filter('plugin:buttons', (items, p) => p.id === plugin.id ? items : [...items, { label: 'Editar com o IAMaker', icon: ICO.spark, action: () => editWith(p.id) }]);

// ----- pastas e plugins -----
const userDir = () => (bs.plugins.dirs || [])[1] || '';
const sep = () => userDir().includes('\\') ? '\\' : '/';
const pdir = (id) => userDir() + sep() + id;
const entry = (id) => bs.plugins.list.find(p => p.id === id) || null;
// plugins que dá para editar: todos menos o próprio IAMaker, mais o recém-criado que ainda não está na lista.
// Os que vêm com o BlueScreen (app: true) são editados numa cópia na pasta do usuário, que passa a valer no lugar
function editable() {
  const out = bs.plugins.list.filter(p => p.id !== plugin.id).map(p => ({ id: p.id, name: p.name || p.id, app: !p.user }));
  if (M.id && M.made.includes(M.id) && !out.some(p => p.id === M.id)) out.push({ id: M.id, name: M.id, app: false });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// plugin do app: copia a pasta inteira para a pasta do usuário antes da IA mexer (robocopy: até 7 é sucesso)
async function adopt(id) {
  const p = entry(id);
  if (!p || p.user) return false;
  // já copiado (a lista só muda depois de recarregar): não copia de novo por cima do que a IA fez
  try { await api('file', { project: pdir(id), file: 'plugin.json' }); return false; } catch {}
  const r = await plugin.exec('robocopy', [p.path, pdir(id), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { timeout: 60000 });
  if (r.code == null || r.code >= 8) throw new Error('não deu para copiar o plugin: ' + (r.err || r.out || 'robocopy ' + r.code).trim());
  push({ role: 'sys', text: `${p.name} vem com o BlueScreen: a IA vai editar uma cópia sua, que passa a valer no lugar. Para voltar à original, remova o plugin na aba Plugins.` });
  return true;
}
// livre: um id que pode continuar sendo usado (o do próprio plugin, ao renomear)
function slug(name, free) {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plugin';
  const taken = new Set([...bs.plugins.list.map(p => p.id), ...M.made]); taken.delete(free);
  let id = s, n = 2; while (taken.has(id)) id = `${s}-${n++}`;
  return id;
}
// sem nome: id provisório (novo-plugin), e a IA escolhe o nome (veja christen)
const UNNAMED = 'Novo plugin';
async function createPlugin(name) {
  name = name || UNNAMED;
  const id = slug(name);
  const manifest = { id, name, description: 'Criado com o IAMaker.', version: '0.1.0', author: 'IAMaker', order: 100 };
  await api('file/new', { project: userDir() }, { method: 'POST', body: JSON.stringify({ path: `${id}/plugin.json`, content: JSON.stringify(manifest, null, 2) + '\n' }) });
  M.made = [...new Set([...M.made, id])];
  await plugin.data.set('made', M.made);
  return id;
}

// ----- conversa (uma por plugin, na pasta de dados do IAMaker) -----
async function loadConv(id) {
  M.conv = id ? await plugin.data.get('conv:' + id, null) : null;
  if (!M.conv) M.conv = { msgs: [], sessions: {} };
  M.place = M.conv.place || null;
}
// sem o `el` (o balão na tela) de cada mensagem
const saveConv = () => M.id ? plugin.data.set('conv:' + M.id, { ...M.conv, msgs: M.conv.msgs.slice(-MAX_MSGS).filter(m => m.role !== 'ai' || m.text.trim()).map(({ el, ...m }) => m) }) : null;
function push(m) { m.at = Date.now(); M.conv.msgs.push(m); paint(m); return m; }

async function pick(id) {
  if (M.run) return toast('Espere a IA terminar ou clique em Parar');
  M.id = id || null; store.set('iamPlugin', M.id); M.fixes = 0; M.place = null;
  await loadConv(M.id);
  render();
}

// ----- desenho -----
function md(text) {
  const inline = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  return String(text || '').split(/```[^\n]*\n?/).map((s, i) => i % 2 ? `<pre class="iam-pre">${esc(s.replace(/\n$/, ''))}</pre>` : inline(s)).join('');
}
function msgHtml(m) {
  if (m.role === 'user') return `<div class="iam-m iam-user"><div class="iam-b">${md(m.text)}</div></div>`;
  if (m.role === 'ai') return `<div class="iam-m iam-ai"><div class="iam-b">${md(m.text)}</div></div>`;
  if (m.role === 'tool') return `<div class="iam-m iam-tool">${ICO.tool}<span>${esc(m.text)}</span></div>`;
  if (m.role === 'ok') return `<div class="iam-m iam-ok">${ICO.ok}<span>${esc(m.text)}</span></div>`;
  if (m.role === 'err') return `<div class="iam-m iam-err">${ICO.warn}<div><div>${md(m.text)}</div>${m.act ? `<div class="iam-acts">${m.act.map((a, i) => `<button type="button" class="chip" data-act="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div></div>`;
  return `<div class="iam-m iam-sys">${esc(m.text)}</div>`;
}
function bindMsg(el, m) {
  if (m.act) el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => ACTS[m.act[+b.dataset.act].do]?.(m));
}
function paint(m) {
  if (log.querySelector('.iam-wel')) return render();
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.insertAdjacentHTML('beforeend', msgHtml(m));
  bindMsg(log.lastElementChild, m); m.el = log.lastElementChild;
  if (near) log.scrollTop = log.scrollHeight;
}
// texto da IA chegando em pedaços (Gemini): atualiza o último balão
function repaint(m) { if (!m.el || !m.el.isConnected) return paint(m); m.el.querySelector('.iam-b').innerHTML = md(m.text); log.scrollTop = log.scrollHeight; }

function render() {
  const list = editable(), ai = AIS[M.ai] ? M.ai : 'claude';
  const opt = (p) => `<option value="${esc(p.id)}" ${p.id === M.id ? 'selected' : ''}>${esc(p.name)}</option>`;
  const mine = list.filter(p => !p.app), app = list.filter(p => p.app);
  $('#iam-plug').innerHTML = `<option value="">＋ Novo plugin…</option>` + (mine.length ? `<optgroup label="Seus plugins">${mine.map(opt).join('')}</optgroup>` : '')
    + (app.length ? `<optgroup label="Do BlueScreen (edita uma cópia sua)">${app.map(opt).join('')}</optgroup>` : '');
  $('#iam-effort').innerHTML = Object.entries(EFFORTS).map(([k, v]) => `<option value="${k}" ${k === M.effort ? 'selected' : ''}>${esc(v)}</option>`).join('');
  $('#iam-ai').innerHTML = Object.entries(AIS).map(([k, v]) => `<option value="${k}" ${k === ai ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  ['#iam-code', '#iam-dir', '#iam-clear'].forEach(s => $(s).disabled = !M.id);
  busy(!!M.run);
  if (!M.id || !M.conv.msgs.length) { welcome(); return; }
  log.innerHTML = M.conv.msgs.map(msgHtml).join('');
  [...log.children].forEach((el, i) => { const m = M.conv.msgs[i]; m.el = el; bindMsg(el, m); });
  log.scrollTop = log.scrollHeight;
}
function welcome() {
  const p = M.id && entry(M.id);
  log.innerHTML = `<div class="iam-wel">
    <div class="iam-wel-hd">${ICO.spark}<div><b>${M.id ? esc(p ? p.name : M.id) : 'Crie um plugin conversando'}</b>
      <p>${M.id ? 'Diga o que mudar neste plugin. A IA altera os arquivos e o resultado aparece na hora.' : `Descreva o que você quer. O ${esc(AIS[M.ai].name)} escreve o plugin na sua pasta de plugins e ele aparece funcionando na IDE, sem compilar nem recarregar nada.`}</p></div></div>
    ${M.id ? '' : `<label class="iam-name"><span>Nome do plugin <i>(opcional)</i></span><input id="iam-name" spellcheck="false" autocomplete="off" placeholder="Em branco, a IA escolhe um nome curto"></label>`}
    <div class="iam-ex">${EXAMPLES.map(e => `<button type="button" class="iam-chip">${esc(e)}</button>`).join('')}</div>
  </div>`;
  log.querySelectorAll('.iam-chip').forEach(b => b.onclick = () => { q.value = b.textContent; q.focus(); });
}
function busy(on) {
  $('#iam-send').hidden = on; $('#iam-stop').hidden = !on;
  $('#iam-plug').disabled = on; $('#iam-ai').disabled = on; $('#iam-effort').disabled = on;
  con.classList.toggle('iam-busy', on);
  if (!on) $('#iam-state').textContent = '';
}
setInterval(() => {
  reghost(); fitAura();
  if (G.aura && M.run) { const s = Math.round((Date.now() - M.run.at) / 1000); G.aura.querySelector('.iam-aura-t').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  if (!M.run) return;
  const s = Math.round((Date.now() - M.run.at) / 1000);
  const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('#iam-state').innerHTML = `<span class="iam-dot"></span><span class="iam-state-tx">${esc(AIS[M.run.ai].name)} trabalhando · </span><span>${t}</span>`;
  $('#iam-state').title = `${AIS[M.run.ai].name} trabalhando há ${t}`;
}, 1000);

// ----- o lugar: carregamento enquanto a IA trabalha, revelação quando o plugin carrega -----
const G = { els: [], place: null };
function ghost(place) {
  // a moldura da IDE continua a mesma (recriar reiniciaria a animação); o resto é refeito
  const keep = G.aura && G.aura.isConnected && G.place === place ? G.aura : null;
  unghost(keep); G.place = place;
  const add = (el) => { G.els.push(el); return el; };
  const mk = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return add(e); };
  if (place === 'status' && $('#stDirty')) $('#stDirty').before(mk('span', 's iam-ghost iam-ghost-st', `${ICO.spark}<span>criando…</span>`));
  const grow = document.querySelector('#strip .grow');
  if ((place === 'esquerda' || place === 'baixo') && grow) {
    const g = mk('div', 'iam-ghost iam-ghost-tool', ICO.spark); g.title = 'O IAMaker está criando este painel';
    if (place === 'esquerda') grow.before(g); else grow.after(g);
  }
  // no balão: um item "criando…" na lista de janelas, e o balão com o anel girando
  if (place === 'balao') add(bs.bubble.placeholder('Janela nova'));
  // a IDE inteira (ou o editor): moldura de luz, a planta sendo revelada e as peças chegando
  if (place === 'outro' || place === 'editor') { if (keep) { G.aura = keep; add(keep); } else add(aura(place)); }
  const card = document.querySelector('[data-card]');
  if (place === 'resumo' && card) card.parentElement.appendChild(mk('div', 'iam-ghost iam-ghost-card', '<i></i><i></i><i></i>'));
  // na conversa, sempre: "Montando na barra de status…"
  log.insertAdjacentElement('beforeend', mk('div', 'iam-m iam-build', `${ICO.spark}<span>Montando ${esc(IN[place] || 'na IDE')}…</span>`)); log.scrollTop = log.scrollHeight;
}
function unghost(keep) { G.els.forEach(e => { if (e !== keep) e.remove(); }); G.els = []; G.place = null; G.aura = null; }

// ----- a IDE em construção (lugar "outro" ou "editor"). Nada bloqueia o clique: é só luz por cima -----
// uma moldura que percorre a borda, uma linha que desce revelando uma grade de planta, dois brilhos que flutuam e,
// embaixo, o andamento ("Montando na IDE · Escreveu ui.js · 0:52"); cada arquivo escrito vira uma peça que entra nele
function aura(place) {
  const el = document.createElement('div');
  el.className = 'iam-aura' + (place === 'editor' ? ' iam-aura-ed' : '');
  el.setAttribute('aria-hidden', 'true');
  const whole = place !== 'editor';
  el.innerHTML = `${whole ? '<canvas class="iam-rain"></canvas><div class="iam-wires"></div>' : ''}<div class="iam-aura-frame"></div><div class="iam-aura-glow g1"></div><div class="iam-aura-glow g2"></div>
    <div class="iam-aura-scan"></div><div class="iam-aura-grid"></div>
    <div class="iam-aura-tick"><span class="iam-aura-ic">${ICO.spark}</span><span class="iam-aura-tx">Montando ${esc(IN[place] || 'na IDE')}</span><span class="iam-aura-step"></span>
      <span class="iam-aura-bar"><i></i></span><span class="iam-aura-n"></span><span class="iam-aura-t"></span></div>`;
  document.body.appendChild(el);
  G.aura = el; G.steps = 0; fitAura();
  if (whole) { wires(el.querySelector('.iam-wires')); rain(el.querySelector('.iam-rain')); }
  return el;
}
// as áreas da IDE que ganham contorno de obra (e que "travam" no fim)
const AREAS = ['#top', '#strip', '#tool', '#editor', '#dock', '.dk-region', '#status'];
function areas() {
  return AREAS.flatMap(sel => [...document.querySelectorAll(sel)]).filter(e => !e.hidden && e.offsetParent !== null)
    .map(e => e.getBoundingClientRect()).filter(r => r.width > 24 && r.height > 16);
}
// um contorno tracejado que anda e quatro cantoneiras por área; lock = o encaixe do fim, um depois do outro
function wires(box, lock) {
  if (!box) return;
  box.innerHTML = areas().map((r, i) => `<div class="iam-wire${lock ? ' lock' : ''}" style="left:${r.left + 2}px;top:${r.top + 2}px;width:${r.width - 4}px;height:${r.height - 4}px;--i:${i}"><b></b><b></b><b></b><b></b></div>`).join('');
}
// chuva de código bem fraca, só pelas bordas (o meio fica limpo: a máscara do CSS)
function rain(cv) {
  if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const TOK = '{}()<>=;:.,[]+-*/&|!?$#%@'.split('').concat(['const', 'let', '=>', 'bs', 'plugin', 'await', 'async', 'ui.js', 'css', 'fn', '0', '1', '✦']);
  const ctx = cv.getContext('2d'), F = 14;
  let cols = [], last = 0, color = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#6CA2FF';
  const size = () => {
    const d = devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.font = `${F}px "JetBrains Mono", Consolas, monospace`;
    cols = Array.from({ length: Math.ceil(innerWidth / 22) }, () => ({ y: -Math.random() * innerHeight, v: 40 + Math.random() * 90, t: TOK[(Math.random() * TOK.length) | 0] }));
  };
  size(); addEventListener('resize', size);
  const tick = (now) => {
    if (!cv.isConnected) { removeEventListener('resize', size); return; }
    requestAnimationFrame(tick);
    if (now - last < 33) return; // ~30 quadros por segundo bastam
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = color;
    cols.forEach((c, i) => {
      c.y += c.v * dt;
      if (c.y > innerHeight + 20) { c.y = -20 - Math.random() * 200; c.v = 40 + Math.random() * 90; }
      if (Math.random() < 0.08) c.t = TOK[(Math.random() * TOK.length) | 0];
      ctx.globalAlpha = 0.55; ctx.fillText(c.t, i * 22 + 4, c.y);
    });
    ctx.globalAlpha = 1;
  };
  requestAnimationFrame(tick);
}
// a versão do editor acompanha o tamanho dele
function fitAura() {
  const el = G.aura; if (!el) return;
  if (!el.classList.contains('iam-aura-ed')) { const w = el.querySelector('.iam-wires'); if (w && w.children.length !== areas().length) wires(w); return; }
  const r = $('#editor').getBoundingClientRect();
  Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}
// um passo da IA: o texto do andamento muda e uma peça com o nome do arquivo voa até ele
function auraStep(text) {
  const el = G.aura; if (!el || !text) return;
  const step = el.querySelector('.iam-aura-step'), tick = el.querySelector('.iam-aura-tick');
  step.textContent = text; step.classList.remove('in'); void step.offsetWidth; step.classList.add('in');
  G.steps = (G.steps || 0) + 1;
  const n = el.querySelector('.iam-aura-n'); if (n) n.textContent = G.steps + (G.steps === 1 ? ' passo' : ' passos');
  const bar = el.querySelector('.iam-aura-bar i'); if (bar) bar.style.width = Math.round(92 * (1 - Math.exp(-G.steps / 3))) + '%';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const tr = tick.getBoundingClientRect(), box = el.getBoundingClientRect();
  const piece = document.createElement('div'); piece.className = 'iam-aura-piece';
  piece.innerHTML = `${ICO.tool}<span>${esc(text)}</span>`;
  // nasce num ponto acima do andamento, de um lado ou do outro, e voa até ele
  const sx = (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * Math.min(320, box.width / 3)), sy = -(70 + Math.random() * Math.min(220, box.height / 3));
  piece.style.left = (tr.left + tr.width / 2 - box.left) + 'px'; piece.style.top = (tr.top - box.top) + 'px';
  piece.style.setProperty('--sx', sx.toFixed(0) + 'px'); piece.style.setProperty('--sy', sy.toFixed(0) + 'px');
  el.appendChild(piece);
  setTimeout(() => { tick.classList.remove('gulp'); void tick.offsetWidth; tick.classList.add('gulp'); }, 1050);
  setTimeout(() => piece.remove(), 1400);
}
// o fim: uma onda de luz sai do centro e atravessa a IDE (ou o editor), com uma explosão de faíscas
function wave(target) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = (target || document.documentElement).getBoundingClientRect();
  const w = document.createElement('div'); w.className = 'iam-wave';
  Object.assign(w.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  const big = Math.hypot(r.width, r.height);
  w.style.setProperty('--r', big + 'px');
  let html = '<b class="iam-wave-ring"></b><b class="iam-wave-ring r2"></b><b class="iam-wave-flash"></b><div class="iam-wave-fx">';
  for (let i = 0, n = 34; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, d = 80 + Math.random() * Math.min(420, big / 4);
    html += `<i style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;--d:${(Math.random() * 0.25).toFixed(2)}s;--s:${(0.7 + Math.random() * 1.2).toFixed(2)}"></i>`;
  }
  w.innerHTML = html + '</div>';
  document.body.appendChild(w);
  setTimeout(() => w.remove(), 1800);
}
// a barra da esquerda e a conversa são redesenhadas às vezes: o carregamento volta para o lugar
const reghost = () => { if (M.run && G.place && G.els.some(e => !e.isConnected)) ghost(G.place); };

// brilho e faíscas em volta de um elemento que acabou de aparecer
function magic(el) {
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
  el.classList.remove('iam-magic'); void el.offsetWidth; el.classList.add('iam-magic');
  setTimeout(() => el.classList.remove('iam-magic'), 1500);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fx = document.createElement('div'); fx.className = 'iam-fx';
  fx.style.left = (r.left + r.width / 2) + 'px'; fx.style.top = (r.top + r.height / 2) + 'px';
  fx.style.setProperty('--w', Math.max(r.width, 26) + 'px'); fx.style.setProperty('--h', Math.max(r.height, 26) + 'px');
  const big = Math.min(Math.max(r.width, r.height), 400) / 3;
  let html = '<b class="iam-ring"></b>';
  for (let i = 0, n = 18; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, d = 24 + Math.random() * 40 + big;
    html += `<i style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--d:${(Math.random() * 0.18).toFixed(2)}s;--s:${(0.6 + Math.random() * 0.9).toFixed(2)}"></i>`;
  }
  fx.innerHTML = html; document.body.appendChild(fx);
  setTimeout(() => fx.remove(), 1700);
}

// depois de carregar: o núcleo sabe o que o plugin registrou (bs.plugins.owned): itens de status, painéis, ferramentas
// da barra, do balão e cards. Abre o painel novo, se for o lugar dele, e faz cada um aparecer com brilho
async function reveal(id, place) {
  const o = (bs.plugins.owned || {})[id] || {};
  const tools = o.tools || [], bubbles = o.bubbles || [];
  if (place === 'esquerda' || place === 'baixo') tools.forEach(t => { try { bs.openTool(t); } catch {} });
  // janela nova no balão: abre (saindo do balão) e fica na frente
  if (bubbles.length && (place === 'balao' || !tools.length)) bubbles.forEach(b => bs.bubble.open(b));
  await new Promise(r => setTimeout(r, 200));
  const els = [...(o.els || [])];
  tools.forEach(t => { const b = document.querySelector(`#strip [data-tool="${CSS.escape(t)}"]`); if (b) els.push(b); });
  bubbles.forEach(b => { const w = bs.bubble.windowOf(b); if (w && bs.bubble.isOpen(b)) els.push(w); });
  (o.cards || []).forEach(c => { const e = document.querySelector(`[data-card="${CSS.escape(c.id)}"]`); if (e) els.push(e); });
  // ferramenta nova no balão fechado: quem brilha é o próprio balão
  if (bubbles.length && !bubbles.some(b => bs.bubble.isOpen(b))) els.push(bs.bubble.button);
  const seen = [...new Set(els)].filter(e => e && e.isConnected && !e.hidden && e.getClientRects().length);
  // a IDE inteira (ou nada para apontar): a onda de luz; senão, o brilho em cada coisa nova
  if (place === 'outro' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const box = document.createElement('div'); box.className = 'iam-wires iam-lockin'; document.body.appendChild(box);
    wires(box, true); setTimeout(() => box.remove(), 1600);
    await new Promise(r => setTimeout(r, 520));
  }
  if (place === 'outro' || place === 'editor' || !seen.length) wave(place === 'editor' ? $('#editor') : null);
  seen.forEach((e, i) => setTimeout(() => magic(e), 250 + i * 170));
  return seen.length;
}

// ----- leitura da saída de cada IA (uma linha JSON por evento) -----
const base = (f) => String(f || '').split(/[\\/]/).pop();
function toolLabel(name, inp) {
  inp = inp || {};
  const target = inp.file_path || inp.path || inp.absolute_path || inp.pattern || inp.command || inp.query || '';
  const NAMES = { Write: 'Escreveu', Edit: 'Editou', MultiEdit: 'Editou', Read: 'Leu', Glob: 'Procurou', Grep: 'Procurou', write_file: 'Escreveu', replace: 'Editou', read_file: 'Leu', list_directory: 'Listou', glob: 'Procurou', search_file_content: 'Procurou', run_shell_command: 'Rodou' };
  return `${NAMES[name] || name} ${/[\\/]/.test(target) ? base(target) : target}`.trim();
}
function parser(ai) {
  let buf = '', delta = null;
  const P = { session: null, said: false, errors: [], place: null, onPlace: null };
  // tira a linha IAMAKER-LUGAR do texto e avisa o lugar (uma vez por pedido)
  const place = (m) => {
    const r = m.text.match(PLACE_RE); if (!r) return;
    m.text = m.text.replace(PLACE_RE, '').replace(/^\s+/, '');
    const k = r[1].toLowerCase();
    if (!P.place && PLACES[k]) { P.place = k; try { P.onPlace && P.onPlace(k); } catch (e) { console.error('IAMaker', e); } }
  };
  const text = (t, isDelta) => {
    if (!t) return;
    P.said = true;
    if (isDelta && delta) { delta.text += t; place(delta); repaint(delta); return; }
    const m = { role: 'ai', text: t }; place(m);
    if (!m.text.trim() && !isDelta) return;
    push(m); delta = isDelta ? m : null;
  };
  const tool = (t) => { delta = null; push({ role: 'tool', text: t }); auraStep(t); };
  const error = (t) => { if (t) P.errors.push(String(t)); };
  function claude(o) {
    if (o.session_id) P.session = o.session_id;
    if (o.type === 'assistant') for (const c of (o.message && o.message.content) || []) {
      if (c.type === 'text') text(c.text); else if (c.type === 'tool_use') tool(toolLabel(c.name, c.input));
    }
    if (o.type === 'result' && o.is_error) error(o.result || o.subtype);
  }
  function codex(o) {
    const it = o.item;
    if (o.type === 'thread.started') P.session = o.thread_id;
    else if (it && o.type === 'item.completed' && it.type === 'agent_message') text(it.text);
    else if (it && o.type === 'item.started' && it.type === 'command_execution') tool('Rodou ' + it.command);
    else if (it && o.type === 'item.completed' && it.type === 'file_change') tool('Alterou ' + (it.changes || []).map(c => base(c.path)).join(', '));
    else if (o.type === 'error' || o.type === 'turn.failed') error(o.message || (o.error && o.error.message));
    // formato antigo do codex exec --json: { msg: { type, ... } }
    const m = o.msg;
    if (m && m.type === 'agent_message') text(m.message);
    else if (m && m.type === 'exec_command_begin') tool('Rodou ' + [].concat(m.command || []).join(' '));
    else if (m && m.type === 'patch_apply_begin') tool('Alterou ' + Object.keys(m.changes || {}).map(base).join(', '));
    else if (m && m.type === 'error') error(m.message);
  }
  function gemini(o) {
    if (o.session_id) P.session = o.session_id;
    if (o.type === 'message' && o.role === 'assistant') text(o.content, !!o.delta);
    else if (o.type === 'tool_use') tool(toolLabel(o.tool_name, o.parameters));
    else if (o.type === 'error') error(o.message);
    else if (o.type === 'result' && o.status === 'error') error(o.error && (o.error.message || o.error));
  }
  const H = { claude, codex, gemini }[ai];
  function line(l) {
    l = l.trim(); if (!l) return;
    let o = null;
    if (l[0] === '{') { try { o = JSON.parse(l); } catch {} }
    if (o) { try { H(o); } catch (e) { console.error('IAMaker', e); } return; }
    // saída em texto puro (Gemini sem --output-format): vira a resposta
    if (ai === 'gemini') text(l + '\n', true);
  }
  P.feed = (chunk) => { buf += chunk; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(line); };
  P.end = () => { if (buf) line(buf); buf = ''; };
  return P;
}

// ----- pedido -----
async function guide() {
  if (M.guide) return M.guide;
  try { M.guide = (await api('file', { project: plugin.path, file: 'GUIA.md' })).content; } catch { M.guide = ''; }
  return M.guide;
}
function argList(text) { return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
async function stamp(dir) {
  const out = {};
  await Promise.all(WATCH.map(async f => { try { const r = await api('file', { project: dir, file: f }); out[f] = r.mtime + ':' + r.size; } catch { out[f] = null; } }));
  return out;
}
const changed = (a, b) => WATCH.some(f => (a || {})[f] !== (b || {})[f]);

// o núcleo recusa {{secret:..}} e {{vault:..}} na entrada de um processo (segredos só vão no env): no pedido, viram ⟪..⟫
const unmark = (s) => String(s).replace(/\{\{(\s*(?:secret|vault):[^}]*)\}\}/g, '⟪$1⟫').replace(/\{\{(\s*(?:secret|vault):)/g, '⟪$1');
async function prompt(text, ai, resumed, files) {
  return unmark(await rawPrompt(text, ai, resumed, files));
}
// os arquivos do plugin como estão agora (até 60 KB juntos), para a IA não precisar ler
const SOURCES = ['plugin.json', 'ui.js', 'style.css', 'server.js', 'server.py'];
async function sources(dir, files) {
  let left = 60000; const out = [];
  for (const f of SOURCES) {
    if (!files[f]) continue;
    let c; try { c = (await api('file', { project: dir, file: f })).content; } catch { continue; }
    if (c == null || c.length > left) { out.push(`## ${f}\n(grande demais para vir aqui: leia o arquivo)`); continue; }
    left -= c.length;
    out.push(`## ${f}\n\`\`\`${f.endsWith('.json') ? 'json' : f.endsWith('.css') ? 'css' : f.endsWith('.py') ? 'python' : 'js'}\n${c}\n\`\`\``);
  }
  return out.length ? `\n# Arquivos do plugin agora (já estão aqui: não precisa ler de novo)\n${out.join('\n\n')}\n` : '';
}
async function rawPrompt(text, ai, resumed, files) {
  const id = M.id, dir = pdir(id), p = entry(id);
  const src = await sources(dir, files);
  const ctx = [
    `- Pasta do plugin (diretório atual): ${dir}`,
    `- id do plugin: ${id} (não mude)`,
    M.conv.unnamed ? `- Este plugin ainda não tem nome. Escolha um nome curto (1 a 3 palavras, em português) que diga o que ele faz e grave em "name" no plugin.json. Use esse nome para o prefixo de ids e classes CSS. Não mude o "id" nem a pasta: o IAMaker renomeia a pasta para o nome que você escolher.` : '',
    `- Arquivos que já existem: ${Object.keys(files).filter(f => files[f]).join(', ') || 'nenhum'}`,
    p && p.error ? `- O plugin está com erro na IDE agora: ${p.error}` : '',
    M.conv.adopted ? '- Este plugin veio com o BlueScreen: você está editando uma cópia na pasta do usuário, que substitui a original. Mude só o que o usuário pediu e mantenha o resto funcionando como antes.' : '',
    p && p.server ? '- Este plugin tem um servidor próprio (server.exe ou script). Não dá para mudar a parte compilada: mexa no ui.js, no style.css e no plugin.json, e use as rotas que o servidor já atende.' : '',
  ].filter(Boolean).join('\n');
  if (resumed) return `# Contexto\n${ctx}\n${src}\n# Pedido do usuário\n${text}\n\n(Siga as instruções do IAMaker do início desta conversa, inclusive as de rapidez. Só a pasta atual.)\n`;
  const hist = M.conv.msgs.filter(m => m.role === 'user' || m.role === 'ai').slice(-13, -1)
    .map(m => `${m.role === 'user' ? 'Usuário' : 'IA'}: ${m.text.length > 700 ? m.text.slice(0, 700) + '…' : m.text}`).join('\n\n');
  return `${await guide()}\n\n---\n\n# Contexto\n${ctx}\n${src}${hist ? `\n# Conversa até aqui\n${hist}\n` : ''}\n# Pedido do usuário\n${text}\n`;
}

async function send(text, opt = {}) {
  text = String(text || '').trim();
  if (!text || M.run) return;
  if (!userDir()) return toast('IAMaker: não achei a pasta dos seus plugins');
  if (!M.id) {
    const name = ($('#iam-name') || {}).value?.trim();
    try { M.id = await createPlugin(name); } catch (e) { return toast('IAMaker: ' + e.message); }
    store.set('iamPlugin', M.id); await loadConv(M.id);
    if (!name) M.conv.unnamed = true;
    render();
  }
  if (!opt.auto) M.fixes = 0;
  const ai = M.ai, A = AIS[ai], cfg = M.cfg || {}, dir = pdir(M.id);
  if (!opt.retry) { push({ role: opt.auto ? 'sys' : 'user', text: opt.auto ? 'Pedindo a correção para a IA…' : text }); await saveConv(); }
  try { if (await adopt(M.id)) { M.conv.adopted = true; await saveConv(); } } catch (e) { push({ role: 'err', text: e.message }); return saveConv(); }
  const sid = A.resume && M.conv.sessions && M.conv.sessions[ai];
  const before = await stamp(dir);
  const args = argList(cfg[A.args]);
  if (cfg[A.model]) args.push(ai === 'codex' ? '-m' : '--model', cfg[A.model]);
  if (A.effort) args.push(...A.effort(EFFORTS[M.effort] ? M.effort : 'low', cfg));
  if (sid) args.push('--resume', sid);
  if (A.stdinDash) args.push('-');
  const P = parser(ai);
  const run = M.run = { ai, at: Date.now(), P, err: '', before, text, sid, id: M.id };
  P.onPlace = (k) => placed(k);
  busy(true); bs.bubble.badge('iamaker', 'busy');
  let h;
  try {
    h = await plugin.spawn(A.prog, args, {
      cwd: dir, label: 'IAMaker · ' + A.name,
      onData: (t, s) => { if (s === 'err') run.err = (run.err + t).slice(-4000); else P.feed(t); },
      onExit: (code) => finish(run, code),
    });
  } catch (e) {
    M.run = null; busy(false); bs.bubble.badge('iamaker', null);
    const missing = /não encontrado|not found/i.test(e.message);
    push({ role: 'err', text: missing ? `O **${A.name}** não está instalado (ou não está no PATH).\n\nInstale com \`${A.install}\` e faça o login rodando \`${A.login}\` uma vez no terminal.` : `${A.name}: ${e.message}`,
      act: missing ? [{ label: 'Instalar no terminal', do: 'install' }] : null, ai });
    return saveConv();
  }
  run.h = h;
  store.set('iamRun', { pid: h.id, id: M.id, ai, before, text });
  try { await h.write(await prompt(text, ai, !!sid, before)); await h.close(); }
  catch (e) { P.errors.push('não deu para mandar o pedido: ' + e.message); h.kill().catch(() => {}); }
}

function placed(k) {
  M.place = M.conv.place = k;
  push({ role: 'sys', text: `Lugar: ${PLACES[k]}` });
  ghost(k);
}

async function finish(run, code) {
  if (M.run !== run) return;
  run.P.end();
  M.run = null; store.set('iamRun', null); busy(false); unghost();
  bs.bubble.badge('iamaker', bs.bubble.isOpen('iamaker') ? null : 'dot');
  const A = AIS[run.ai];
  if (run.P.session && A.resume) { M.conv.sessions = { ...(M.conv.sessions || {}), [run.ai]: run.P.session }; }
  // sessão do Claude Code que não existe mais: esquece e manda de novo, com as instruções e o histórico
  if (code && run.sid && /no conversation|session/i.test(run.err)) {
    delete M.conv.sessions[run.ai]; await saveConv();
    return send(run.text, { retry: true });
  }
  if (run.killed) push({ role: 'sys', text: 'Parado.' });
  else if (code || run.P.errors.length) {
    const tail = run.err.trim().split(/\r?\n/).slice(-6).join('\n');
    const why = run.P.errors.join('\n') || tail || `saiu com o código ${code}`;
    push({ role: 'err', text: `${A.name} não terminou: ${why}${/login|auth|api key|credential|unauthori/i.test(why) ? `\n\nFaça o login rodando \`${A.login}\` no terminal.` : ''}`,
      act: /login|auth|api key|credential|unauthori/i.test(why) ? [{ label: 'Fazer login no terminal', do: 'login' }] : null, ai: run.ai });
  } else if (!run.P.said) push({ role: 'sys', text: `${A.name} terminou sem resposta.` });
  await saveConv();
  if (run.killed || run.id !== M.id) return;
  const after = await stamp(pdir(run.id));
  if (!changed(run.before, after)) { if (!code) push({ role: 'sys', text: 'Nenhum arquivo do plugin mudou.' }); return saveConv(); }
  const problems = await verify(run.id);
  if (problems.length) return broken(problems);
  await christen(run.id);
  ready();
}

// plugin criado sem nome: a IA gravou um em "name"; a pasta e o id passam a seguir esse nome (novo-plugin -> pomodoro)
async function christen(id) {
  if (!M.conv.unnamed || M.id !== id) return;
  let m; try { m = JSON.parse((await api('file', { project: pdir(id), file: 'plugin.json' })).content); } catch { return; }
  const name = String(m.name || '').trim();
  if (!name || name === UNNAMED) return;
  M.conv.unnamed = false;
  const to = slug(name, id);
  if (to === id) { await saveConv(); return; }
  try {
    await api('file/move', { project: userDir() }, { method: 'POST', body: JSON.stringify({ from: id, to }) });
    m.id = to;
    await api('file', { project: pdir(to), file: 'plugin.json' }, { method: 'PUT', body: JSON.stringify(m, null, 2) + '\n' });
  } catch (e) { push({ role: 'sys', text: `A IA chamou o plugin de "${name}", mas a pasta continua ${id}: ${e.message}` }); return saveConv(); }
  // a conversa e a lista de criados acompanham o id novo
  await plugin.data.set('conv:' + to, { ...M.conv, msgs: M.conv.msgs.slice(-MAX_MSGS).map(({ el, ...x }) => x) });
  await plugin.data.remove('conv:' + id);
  M.made = [...new Set(M.made.map(x => x === id ? to : x))]; await plugin.data.set('made', M.made);
  M.id = to; store.set('iamPlugin', to);
  push({ role: 'sys', text: `A IA chamou o plugin de "${name}" (pasta ${to}).` });
  await saveConv();
  render();
}

// confere o que a IDE vai carregar, sem rodar: plugin.json válido e com o id certo, ui.js sem erro de sintaxe
async function verify(id) {
  const dir = pdir(id), out = [];
  try {
    const m = JSON.parse((await api('file', { project: dir, file: 'plugin.json' })).content);
    if (m.id && m.id !== id) out.push(`plugin.json: o "id" é "${m.id}", mas tem que ser "${id}" (o nome da pasta)`);
    if (!m.name) out.push('plugin.json: falta o "name"');
  } catch (e) { out.push('plugin.json: ' + (e instanceof SyntaxError ? 'JSON inválido: ' + e.message : e.message)); }
  let ui = null; try { ui = (await api('file', { project: dir, file: 'ui.js' })).content; } catch {}
  if (ui != null) { try { new Function('bs', 'plugin', "'use strict';\n" + ui); } catch (e) { out.push('ui.js: erro de sintaxe: ' + e.message); } }
  return out;
}
function broken(problems) {
  const text = 'O plugin tem erro:\n' + problems.map(p => '- ' + p).join('\n');
  if ((M.cfg || {}).autoFix !== false && M.fixes < MAX_FIXES) {
    M.fixes++; push({ role: 'err', text }); saveConv();
    return send(`Corrija este erro do plugin, sem mudar o resto:\n${problems.join('\n')}`, { auto: true });
  }
  push({ role: 'err', text, act: [{ label: 'Pedir a correção', do: 'fix' }], problems });
  saveConv();
}
function ready() {
  if ((M.cfg || {}).autoApply !== false) return apply();
  M.pending = true; $('#iam-apply').hidden = false;
  push({ role: 'ok', text: 'Pronto. Clique em Aplicar para carregar o plugin.' });
  saveConv();
}
// carrega o plugin na página aberta, sem recarregar a IDE (bs.plugins.reload desfaz a versão anterior dele)
async function apply() {
  if (!M.id || M.applying) return;
  M.applying = true; M.pending = false; $('#iam-apply').hidden = true;
  const id = M.id, was = entry(id), fresh = !was || !was.loaded;
  // erro que o plugin novo lançar logo depois de carregar (num setTimeout, num evento) também conta
  const late = [];
  const onErr = (e) => { if (e.filename && e.filename.includes('/plugins/' + encodeURIComponent(id) + '.js')) late.push(e.message); };
  addEventListener('error', onErr);
  let p;
  try {
    await saveConv();
    p = await bs.plugins.reload(id);
    // o IAMaker sempre deixa ligado o que construiu (um id que estava na lista de desligados voltaria desligado)
    if (p && !p.enabled) { await api('plugins', {}, { method: 'POST', body: JSON.stringify({ id, enabled: true }) }); p = await bs.plugins.reload(id); M.turnedOn = true; }
  } catch (e) { removeEventListener('error', onErr); M.applying = false; push({ role: 'err', text: 'Não deu para carregar o plugin: ' + e.message }); return saveConv(); }
  M.applying = false;
  if (!p) { removeEventListener('error', onErr); push({ role: 'err', text: 'O plugin não apareceu na lista da IDE. Confira o plugin.json.' }); return saveConv(); }
  if (p.error) { removeEventListener('error', onErr); return broken([`a IDE não carregou o plugin: ${p.error}`]); }
  if (!p.ui) { removeEventListener('error', onErr); push({ role: 'sys', text: 'O plugin ainda não tem interface (ui.js).' }); return saveConv(); }
  const n = await reveal(id, M.place);
  const where = M.place && IN[M.place] ? ' ' + IN[M.place] : '';
  push({ role: 'ok', text: `${p.name} v${p.version} ${fresh ? 'criado' : 'atualizado'}${where}${M.turnedOn ? ' e ligado' : ''}.${n || M.place === 'outro' ? '' : ' Procure o que mudou na IDE.'}` });
  M.turnedOn = false;
  saveConv();
  setTimeout(() => { removeEventListener('error', onErr); if (late.length && M.id === id && !M.run) broken(late.map(m => 'erro depois de carregar: ' + m)); else M.fixes = 0; }, 3000);
}

// botões das mensagens
const ACTS = {
  install: (m) => bs.terminal.run(AIS[m.ai || M.ai].install),
  login: (m) => bs.terminal.run(AIS[m.ai || M.ai].login),
  fix: (m) => { M.fixes = 0; send(`Corrija este erro do plugin, sem mudar o resto:\n${(m.problems || [m.text]).join('\n')}`, { auto: true }); },
};

// ----- eventos -----
$('#iam-form').onsubmit = (e) => { e.preventDefault(); const t = q.value; if (!t.trim()) return; q.value = ''; send(t); };
q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#iam-form').requestSubmit(); } });
$('#iam-stop').onclick = () => { if (!M.run) return; M.run.killed = true; M.run.h ? M.run.h.kill().catch(() => {}) : null; };
$('#iam-cfg').onclick = () => plugin.settings.open();
$('#iam-apply').onclick = () => apply();
$('#iam-dir').onclick = () => M.id && bs.reveal(pdir(M.id));
$('#iam-code').onclick = () => M.id && bs.openOutside(pdir(M.id), 'ui.js');
$('#iam-clear').onclick = async () => { if (M.run) return; M.conv = { msgs: [], sessions: {} }; await saveConv(); render(); };
$('#iam-plug').onchange = (e) => pick(e.target.value);
$('#iam-effort').onchange = async (e) => { M.effort = e.target.value; try { M.cfg = await plugin.settings.set({ effort: M.effort }); } catch {} };
$('#iam-ai').onchange = async (e) => { M.ai = e.target.value; render(); try { M.cfg = await plugin.settings.set({ provider: M.ai }); } catch {} };
plugin.settings.onChange((v) => { M.cfg = v; if (v && EFFORTS[v.effort]) M.effort = v.effort; if (v && AIS[v.provider] && !M.run) { M.ai = v.provider; render(); } });

// ----- início: configurações, conversa e processo da IA que ainda roda -----
(async () => {
  try { M.cfg = await plugin.settings.get(); } catch { M.cfg = {}; }
  M.ai = AIS[M.cfg.provider] ? M.cfg.provider : 'claude';
  M.effort = EFFORTS[M.cfg.effort] ? M.cfg.effort : 'low';
  try { M.made = (await plugin.data.get('made', [])).filter(Boolean); } catch {}
  if (M.id && !editable().some(p => p.id === M.id)) M.id = null;
  await loadConv(M.id);

  store.set('iamReopen', null); // de versões que recarregavam a página

  // a página recarregou com a IA rodando: continua acompanhando
  const was = store.get('iamRun', null);
  if (was && was.id === M.id && AIS[was.ai]) {
    let alive = null; try { alive = (await plugin.procs.list()).find(x => x.id === was.pid && !x.done); } catch {}
    if (alive) {
      const P = parser(was.ai);
      const run = M.run = { ai: was.ai, at: Date.now(), P, err: '', before: was.before, text: was.text, id: was.id };
      P.onPlace = (k) => placed(k); bs.bubble.badge('iamaker', 'busy');
      run.h = plugin.procs.attach(was.pid, { onData: (t, s) => { if (s === 'err') run.err = (run.err + t).slice(-4000); else P.feed(t); }, onExit: (code) => finish(run, code) });
      show(true);
    } else store.set('iamRun', null);
  }
  render();
})();
