// BlueScreen: apoio para servidores de plugin em Node.js (18 ou mais novo), sem dependências.
// O BlueScreen grava este arquivo em ~/.bluescreen/sdk e passa a pasta em BLUESCREEN_SDK:
//
//   const { Plugin } = require(process.env.BLUESCREEN_SDK + '/bluescreen.js');
//   const p = new Plugin();
//   p.route('meu/ola', async (req) => ({ ola: req.query.nome || 'mundo' }));
//   p.run();
//
// Cada rota recebe { method, query, headers, body (Buffer), text(), json(), remote, internal } e devolve um objeto
// (vira JSON), um Plugin.reply(status, corpo, cabeçalhos) ou lança Plugin.error('mensagem', status).
// p.core fala com o núcleo e com outros plugins; p.data, p.secrets, p.settings e p.files usam a pasta de dados;
// p.vault usa o cofre da IDE (p.fetch com {{vault:nome}}, ou p.vault.reveal(nome) se você deixou o plugin ver o valor).
'use strict';
const http = require('http');
const path = require('path');

const H_TOKEN = 'x-bluescreen-token';
const H_PLUGIN_TOKEN = 'x-bluescreen-plugin-token';
const env = process.env;

class PluginError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
class Reply { constructor(status, body, headers) { this.status = status; this.body = body; this.headers = headers || {}; } }

// cliente do núcleo: GET/POST em /api/<rota> com o token (chamada interna)
class Core {
  constructor(url = env.BLUESCREEN_URL || 'http://127.0.0.1:4747', token = env.BLUESCREEN_TOKEN || '') { this.url = url.replace(/\/+$/, ''); this.token = token; }
  async request(method, route, query, body, raw) {
    const u = new URL(this.url + '/api/' + route.replace(/^\/+/, ''));
    for (const [k, v] of Object.entries(query || {})) if (v != null) u.searchParams.set(k, String(v));
    // o token próprio do processo identifica o plugin (o cofre só entrega valores assim)
    const headers = { [H_TOKEN]: this.token };
    if (env.BLUESCREEN_PLUGIN_TOKEN) headers[H_PLUGIN_TOKEN] = env.BLUESCREEN_PLUGIN_TOKEN;
    let data;
    if (body !== undefined) {
      if (Buffer.isBuffer(body) || typeof body === 'string') data = body;
      else { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    }
    const r = await fetch(u, { method, headers, body: data });
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch {} throw new PluginError(m, r.status); }
    return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
  }
  get(route, query) { return this.request('GET', route, query); }
  post(route, query, body) { return this.request('POST', route, query, body === undefined ? {} : body); }
  bytes(route, query) { return this.request('GET', route, query, undefined, true); }
}

class Plugin {
  constructor(id = env.BLUESCREEN_PLUGIN) {
    if (!id) throw new Error('BLUESCREEN_PLUGIN não definido: o servidor deve ser iniciado pelo BlueScreen');
    this.id = id; this.dir = env.BLUESCREEN_PLUGIN_DIR || process.cwd(); this.dataDir = env.BLUESCREEN_PLUGIN_DATA || '';
    this.filesDir = this.dataDir ? path.join(this.dataDir, 'files') : '';
    this.routes = new Map();
    const core = this.core = new Core();
    const q = (extra) => ({ plugin: id, ...extra });
    // atributos (store.json), segredos (cifrados), configurações (plugin.json › settings) e arquivos (files/)
    this.data = {
      get: async (key) => (await core.get('plugin/data', q({ key }))).value,
      all: async () => (await core.get('plugin/data', q())).values,
      set: (key, value) => core.post('plugin/data', q(), { key, value }),
      merge: (values) => core.post('plugin/data', q(), { values }),
      remove: (key) => core.post('plugin/data', q(), { key, value: null }),
    };
    this.secrets = {
      get: async (key) => (await core.get('plugin/secrets', q({ key }))).value,
      set: (key, value) => core.post('plugin/secrets', q(), { key, value }),
      keys: async () => (await core.get('plugin/secrets', q())).keys,
    };
    this.settings = async () => (await core.get('plugin/settings', q())).values;
    this.files = {
      read: (p) => core.bytes('plugin/files', q({ path: p })),
      write: (p, content) => core.request('POST', 'plugin/files', q({ path: p }), Buffer.isBuffer(content) ? content : String(content)),
      list: async (p = '') => (await core.get('plugin/files', q({ path: p, list: 1 }))).entries,
      remove: (p) => core.post('plugin/files', q({ path: p, delete: 1 })),
    };
    // cofre da IDE: status() lista os segredos pedidos/liberados (sem valores); reveal(nome) só com "pode ver o valor"
    this.vault = {
      status: async () => (await core.get('vault/status', q())).items,
      reveal: async (key) => (await core.get('vault/reveal', q({ key }))).value,
    };
    // HTTP pelo núcleo: {{vault:nome}} e {{secret:nome}} em url, headers e corpo, sem o valor passar por aqui
    this.fetch = async (url, opt = {}) => { const r = await core.post('plugin/fetch', q(), { url, ...opt }); r.json = () => JSON.parse(r.body || 'null'); return r; };
    this.exec = (program, args = [], opt = {}) => core.post('plugin/exec', q(), { program, args, ...opt });
  }
  // name: 'meu/rota' (sem /api/); fn(req) => objeto | Plugin.reply(...)
  route(name, fn) { this.routes.set(name.replace(/^\/+/, '').replace(/^api\//, ''), fn); return this; }
  // abre a porta, avisa o núcleo e atende até ser encerrado
  run() {
    const token = env.BLUESCREEN_TOKEN || '';
    const server = http.createServer(async (rq, rs) => {
      const send = (status, body, headers = {}) => {
        let data = body;
        if (!Buffer.isBuffer(body) && typeof body !== 'string') { data = JSON.stringify(body === undefined ? null : body); headers = { 'content-type': 'application/json; charset=utf-8', ...headers }; }
        rs.writeHead(status, { 'cache-control': 'no-store', ...headers }); rs.end(data);
      };
      if (token && rq.headers[H_TOKEN] !== token) return send(403, { error: 'acesso negado' });
      const u = new URL(rq.url, 'http://127.0.0.1');
      const fn = this.routes.get(u.pathname.replace(/^\/api\//, ''));
      if (!fn) return send(404, { error: 'rota desconhecida' });
      const parts = []; for await (const c of rq) parts.push(c);
      const body = Buffer.concat(parts);
      const req = {
        method: rq.method, headers: rq.headers, body, query: Object.fromEntries(u.searchParams),
        remote: rq.headers['x-bluescreen-remote'] === '1', internal: rq.headers['x-bluescreen-internal'] === '1',
        text: () => body.toString('utf8'), json: () => { const t = body.toString('utf8').trim(); return t ? JSON.parse(t) : {}; },
      };
      try {
        const out = await fn(req);
        if (out instanceof Reply) send(out.status, out.body, out.headers); else send(200, out);
      } catch (e) {
        if (!(e instanceof PluginError)) console.error(e);
        send(e.status || 500, { error: e.message || String(e) });
      }
    });
    server.listen(0, '127.0.0.1', () => {
      process.stdout.write('BLUESCREEN-READY ' + JSON.stringify({ port: server.address().port, routes: [...this.routes.keys()].sort() }) + '\n');
    });
    return server;
  }
  static reply(status, body, headers) { return new Reply(status, body, headers); }
  static error(msg, status = 400) { return new PluginError(msg, status); }
}

module.exports = { Plugin, Core, PluginError, Reply };
