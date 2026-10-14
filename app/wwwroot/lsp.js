/* BlueScreen: análise semântica e refatoração para qualquer linguagem, pelo Language Server Protocol.
   Para cada linguagem o BlueScreen usa o servidor oficial instalado no PC (rust-analyzer, gopls, pyright, clangd,
   jdtls, typescript-language-server...), aberto pelo núcleo e ligado por WebSocket (/api/rpc/ws). O servidor sobe
   na primeira vez que um arquivo daquela linguagem é aberto, um por projeto.
   No editor, com os atalhos do IntelliJ:
     Shift+F6 renomear (em todos os arquivos)     Alt+Enter ações rápidas e refatorações     Ctrl+B / Ctrl+clique definição
     Alt+F7 usos                                  Ctrl+Alt+B implementações                   Ctrl+Shift+B tipo
     Ctrl+F12 estrutura do arquivo                Ctrl+Q documentação                         Ctrl+Alt+O organizar imports
     Shift+Alt+F formatar
   Também: erros e avisos do servidor no código, completar, assinatura dos parâmetros e destaque dos usos.
   O item "LSP" da status bar mostra o servidor do arquivo aberto; sem servidor, ele oferece instalar pelo terminal.
   Expõe bs.lsp: tools(), clientFor(tab), restart(). */
(function (bs) {

const LS = { tools: null, clients: new Map(), docs: new Map(), registered: new Set(), progress: new Map(), seq: 0 };
const LSP_ID = { shell: 'shellscript' }; // ids do Monaco que o LSP chama diferente
const ext = (lang) => LSP_ID[lang] || lang;

// ----- caminhos e URIs -----
// o Monaco usa bs:/<aba> para os modelos das abas; o servidor fala em file:///C:/...; aqui se converte entre os dois
function pathToUri(abs) { const p = abs.replace(/\\/g, '/'); return 'file:///' + p.split('/').map((s, i) => i === 0 && /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)).join('/'); }
function uriToPath(u) { let p = decodeURIComponent(String(u).replace(/^file:\/\/\/?/, '')); if (/^[A-Za-z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1); return p.replace(/\//g, '\\'); }
const keyOf = (abs) => abs.replace(/\//g, '\\').toLowerCase();
const absOf = (tab) => tab.project.replace(/[\\/]+$/, '') + '\\' + tab.path.replace(/\//g, '\\');
function relOf(abs, root) { const r = root.replace(/[\\/]+$/, '') + '\\'; return keyOf(abs).startsWith(keyOf(r)) ? abs.slice(r.length).replace(/\\/g, '/') : null; }
const editorTabFor = (abs) => S.tabs.find(t => t.mode === 'editor' && keyOf(absOf(t)) === keyOf(abs));

// ----- ferramentas instaladas -----
async function lsTools(fresh) {
  if (LS.tools && !fresh) return LS.tools;
  try { LS.tools = (await api('rpc/tools', { fresh: fresh ? '1' : null })).tools || []; } catch { LS.tools = []; }
  for (const t of LS.tools) if (t.kind === 'lsp' && t.installed) t.langs.forEach(registerProviders);
  return LS.tools;
}
const serverFor = (lang) => (LS.tools || []).find(t => t.kind === 'lsp' && t.installed && t.langs.includes(lang));
const knownFor = (lang) => (LS.tools || []).filter(t => t.kind === 'lsp' && t.langs.includes(lang));

// ----- cliente JSON-RPC (o mesmo transporte serve ao depurador) -----
class RpcClient {
  constructor(tool, root) { this.tool = tool; this.root = root; this.id = 0; this.pending = new Map(); this.handlers = {}; this.alive = false; }
  connect() {
    return new Promise((ok, fail) => {
      const u = new URL('/api/rpc/ws', location.origin); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.searchParams.set('tool', this.tool.id); u.searchParams.set('root', this.root);
      const ws = this.ws = new WebSocket(u); let opened = false;
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.bs) { if (m.bs === 'ready') { opened = true; this.alive = true; ok(m); } else if (m.bs === 'error') { fail(new Error(m.message)); } else if (m.bs === 'exit') { this.alive = false; this.onexit && this.onexit(m.code); } return; }
        this.receive(m);
      };
      ws.onclose = () => { this.alive = false; for (const p of this.pending.values()) p.fail(new Error('conexão fechada')); this.pending.clear(); if (!opened) fail(new Error('não foi possível iniciar ' + this.tool.name)); this.onclose && this.onclose(); };
    });
  }
  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close() { try { this.ws.close(); } catch {} }
}
class LspClient extends RpcClient {
  request(method, params, ms = 30000) {
    const id = ++this.id; this.send({ jsonrpc: '2.0', id, method, params });
    return new Promise((ok, fail) => { const t = setTimeout(() => { this.pending.delete(id); fail(new Error(method + ': sem resposta')); }, ms); this.pending.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, fail: (e) => { clearTimeout(t); fail(e); } }); });
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  receive(m) {
    if (m.id != null && !m.method) { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result); return; }
    if (m.id != null && m.method) { Promise.resolve().then(() => this.serverRequest(m.method, m.params)).then((result) => this.send({ jsonrpc: '2.0', id: m.id, result: result ?? null }), (e) => this.send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: e.message } })); return; }
    this.serverNotify(m.method, m.params);
  }
  async serverRequest(method, p) {
    switch (method) {
      case 'workspace/configuration': return (p.items || []).map(() => ({}));
      case 'workspace/workspaceFolders': return [{ uri: pathToUri(this.root), name: this.root.split(/[\\/]/).pop() }];
      case 'workspace/applyEdit': { const n = await applyWorkspaceEdit(p.edit, this); return { applied: n >= 0 }; }
      case 'window/showMessageRequest': toast(p.message); return null;
      case 'window/showDocument': if (p.uri) goTo(p.uri, p.selection); return { success: true };
      case 'client/registerCapability': case 'client/unregisterCapability': case 'window/workDoneProgress/create': return null;
      default: throw new Error('não suportado: ' + method);
    }
  }
  serverNotify(method, p) {
    if (method === 'textDocument/publishDiagnostics') return diagnostics(this, p);
    if (method === 'window/showMessage' && p.type <= 2) return toast(this.tool.name + ': ' + p.message, p.type === 1 ? 'err' : undefined);
    if (method === '$/progress' && p.value) {
      if (p.value.kind === 'end') LS.progress.delete(this.tool.id + p.token); else LS.progress.set(this.tool.id + p.token, p.value.title || p.value.message || '');
      lsStatus();
    }
  }
}

// um servidor por (ferramenta, projeto); sobe no primeiro arquivo
async function clientFor(tool, root) {
  const key = tool.id + '|' + keyOf(root);
  let c = LS.clients.get(key);
  if (c) return c.ready;
  c = new LspClient(tool, root); LS.clients.set(key, c);
  c.ready = (async () => {
    lsStatus();
    await c.connect();
    const init = await c.request('initialize', {
      processId: null, clientInfo: { name: 'BlueScreen', version: BS.version || '' }, locale: 'pt-br',
      rootUri: pathToUri(root), rootPath: root, workspaceFolders: [{ uri: pathToUri(root), name: root.split(/[\\/]/).pop() }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        window: { workDoneProgress: true, showMessage: {}, showDocument: { support: true } },
        workspace: { applyEdit: true, configuration: true, workspaceFolders: true, workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] }, didChangeWatchedFiles: { dynamicRegistration: false }, didChangeConfiguration: { dynamicRegistration: false }, executeCommand: {}, symbol: {} },
        textDocument: {
          synchronization: { didSave: true, willSave: false, dynamicRegistration: false },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          completion: { contextSupport: true, completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], deprecatedSupport: true, resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }, labelDetailsSupport: true } },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
          definition: { linkSupport: true }, declaration: { linkSupport: true }, typeDefinition: { linkSupport: true }, implementation: { linkSupport: true },
          references: {}, documentHighlight: {}, documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          codeAction: { isPreferredSupport: true, dataSupport: true, resolveSupport: { properties: ['edit'] }, codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports', 'source.fixAll'] } } },
          formatting: {}, rangeFormatting: {}, rename: { prepareSupport: true },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        },
      },
    }, 120000);
    c.caps = init.capabilities || {};
    c.notify('initialized', {});
    // vários servidores (pyright, por exemplo) só terminam de iniciar depois de receber a configuração
    c.notify('workspace/didChangeConfiguration', { settings: {} });
    builtinOff(tool);
    lsStatus();
    return c;
  })();
  c.onclose = () => { LS.clients.delete(key); for (const [id, d] of LS.docs) if (d.client === c) LS.docs.delete(id); lsStatus(); };
  c.ready.catch((e) => { LS.clients.delete(key); toast(tool.name + ': ' + e.message, 'err'); lsStatus(); });
  return c.ready;
}

// o Monaco já tem TypeScript, HTML, CSS e JSON por conta própria: com o servidor de verdade ligado, os dele saem
function builtinOff(tool) {
  const off = { completionItems: false, hovers: false, documentSymbols: false, definitions: false, references: false, documentHighlights: false, rename: false, diagnostics: false, documentRangeFormattingEdits: false, documentFormattingEdits: false, signatureHelp: false, onTypeFormattingEdits: false, codeActions: false, inlayHints: false, colors: false, foldingRanges: true, selectionRanges: true, links: false, tokens: true };
  try {
    const L = monaco.languages;
    if (tool.id === 'tsserver') { L.typescript.typescriptDefaults.setModeConfiguration(off); L.typescript.javascriptDefaults.setModeConfiguration(off); }
    if (tool.id === 'html') L.html.htmlDefaults.setModeConfiguration(off);
    if (tool.id === 'css') { L.css.cssDefaults.setModeConfiguration(off); L.css.scssDefaults.setModeConfiguration(off); L.css.lessDefaults.setModeConfiguration(off); }
    if (tool.id === 'json') L.json.jsonDefaults.setModeConfiguration(off);
  } catch {}
}

// ----- documentos abertos -----
async function openDoc(tab) {
  if (!tab || tab.mode !== 'editor' || !tab.model || LS.docs.has(tab.model.id)) return;
  await lsTools();
  const tool = serverFor(tab.lang); if (!tool) { lsStatus(); return; }
  let c; try { c = await clientFor(tool, tab.project); } catch { return; }
  if (tab.model.isDisposed() || LS.docs.has(tab.model.id)) return;
  const uri = pathToUri(absOf(tab));
  const d = { client: c, uri, version: 1, tab, timer: null };
  LS.docs.set(tab.model.id, d);
  c.notify('textDocument/didOpen', { textDocument: { uri, languageId: ext(tab.lang), version: 1, text: tab.model.getValue() } });
  d.sub = tab.model.onDidChangeContent(() => { clearTimeout(d.timer); d.timer = setTimeout(() => flush(d), 200); });
  lsStatus();
}
function flush(d) {
  if (!d.timer) return; clearTimeout(d.timer); d.timer = null;
  if (d.tab.model.isDisposed()) return;
  d.client.notify('textDocument/didChange', { textDocument: { uri: d.uri, version: ++d.version }, contentChanges: [{ text: d.tab.model.getValue() }] });
}
function closeDoc(tab) {
  const d = tab.model && LS.docs.get(tab.model.id); if (!d) return;
  flush(d); d.sub && d.sub.dispose(); LS.docs.delete(tab.model.id);
  if (d.client.alive) d.client.notify('textDocument/didClose', { textDocument: { uri: d.uri } });
}
// documento do modelo, com as últimas edições já enviadas (antes de qualquer pergunta ao servidor)
function docOf(model) { const d = LS.docs.get(model.id); if (d) { flush(d); return d; } return null; }

// ----- conversões -----
const P = (pos) => ({ line: pos.lineNumber - 1, character: pos.column - 1 });
const R = (r) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const RL = (r) => ({ start: { line: r.startLineNumber - 1, character: r.startColumn - 1 }, end: { line: r.endLineNumber - 1, character: r.endColumn - 1 } });
const md = (c) => {
  if (!c) return [];
  if (Array.isArray(c)) return c.flatMap(md);
  if (typeof c === 'string') return [{ value: c }];
  if (c.kind) return [{ value: c.kind === 'markdown' ? c.value : '```\n' + c.value + '\n```' }];
  if (c.language) return [{ value: '```' + c.language + '\n' + c.value + '\n```' }];
  return [];
};
const docText = (d) => d == null ? undefined : typeof d === 'string' ? d : { value: d.value, isTrusted: false };
// modelo do Monaco para uma URI do servidor: a aba aberta, ou um modelo só para a espiada (referências, definição)
async function modelFor(uri) {
  const abs = uriToPath(uri); const tab = editorTabFor(abs);
  if (tab) return tab.model;
  const mu = monaco.Uri.parse(pathToUri(abs));
  let m = monaco.editor.getModel(mu);
  if (!m && S.project) {
    const rel = relOf(abs, S.project.path);
    try { const f = rel != null ? await api('file', { project: S.project.path, file: rel }) : null; if (f && !f.binary && !f.tooBig) m = monaco.editor.createModel(f.content, langOf(abs), mu); } catch {}
  }
  return m;
}
async function locations(res) {
  if (!res) return [];
  const list = Array.isArray(res) ? res : [res];
  const out = [];
  for (const l of list.slice(0, 200)) {
    const uri = l.targetUri || l.uri; const range = l.targetSelectionRange || l.range; if (!uri || !range) continue;
    const m = await modelFor(uri); if (m) out.push({ uri: m.uri, range: R(range) });
  }
  return out;
}

// ----- provedores do Monaco (um registro por linguagem, valem para todo servidor daquela linguagem) -----
const CIK = () => { const K = monaco.languages.CompletionItemKind; return [K.Text, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit, K.Value, K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter]; };
const SK = () => { const K = monaco.languages.SymbolKind; return [K.File, K.File, K.Module, K.Namespace, K.Package, K.Class, K.Method, K.Property, K.Field, K.Constructor, K.Enum, K.Interface, K.Function, K.Variable, K.Constant, K.String, K.Number, K.Boolean, K.Array, K.Object, K.Key, K.Null, K.EnumMember, K.Struct, K.Event, K.Operator, K.TypeParameter]; };
function registerProviders(lang) {
  if (LS.registered.has(lang) || !window.monaco) return; LS.registered.add(lang);
  const L = monaco.languages;
  const ask = async (model, method, params, cap) => { const d = docOf(model); if (!d || (cap && !d.client.caps[cap])) return undefined; try { return await d.client.request(method, { textDocument: { uri: d.uri }, ...params }); } catch { return undefined; } };
  L.registerHoverProvider(lang, { provideHover: async (model, pos) => { const r = await ask(model, 'textDocument/hover', { position: P(pos) }, 'hoverProvider'); return r && r.contents ? { contents: md(r.contents), range: r.range ? R(r.range) : undefined } : null; } });
  for (const [prov, method, cap] of [['registerDefinitionProvider', 'textDocument/definition', 'definitionProvider'], ['registerDeclarationProvider', 'textDocument/declaration', 'declarationProvider'], ['registerTypeDefinitionProvider', 'textDocument/typeDefinition', 'typeDefinitionProvider'], ['registerImplementationProvider', 'textDocument/implementation', 'implementationProvider']]) {
    L[prov](lang, { [prov.replace('register', 'provide').replace('Provider', '')]: async (model, pos) => locations(await ask(model, method, { position: P(pos) }, cap)) });
  }
  L.registerReferenceProvider(lang, { provideReferences: async (model, pos, ctx) => locations(await ask(model, 'textDocument/references', { position: P(pos), context: { includeDeclaration: ctx.includeDeclaration } }, 'referencesProvider')) });
  L.registerDocumentHighlightProvider(lang, { provideDocumentHighlights: async (model, pos) => ((await ask(model, 'textDocument/documentHighlight', { position: P(pos) }, 'documentHighlightProvider')) || []).map(h => ({ range: R(h.range), kind: (h.kind || 1) - 1 })) });
  L.registerDocumentSymbolProvider(lang, { provideDocumentSymbols: async (model) => {
    const r = await ask(model, 'textDocument/documentSymbol', {}, 'documentSymbolProvider'); if (!r) return [];
    const sk = SK(); const conv = (s) => s.location ? { name: s.name, detail: '', kind: sk[s.kind] ?? sk[13], tags: [], range: R(s.location.range), selectionRange: R(s.location.range) } : { name: s.name, detail: s.detail || '', kind: sk[s.kind] ?? sk[13], tags: [], range: R(s.range), selectionRange: R(s.selectionRange), children: (s.children || []).map(conv) };
    return r.map(conv);
  } });
  L.registerCompletionItemProvider(lang, {
    triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '>', '#', '$', '-'],
    provideCompletionItems: async (model, pos, ctx) => {
      const r = await ask(model, 'textDocument/completion', { position: P(pos), context: ctx.triggerCharacter ? { triggerKind: 2, triggerCharacter: ctx.triggerCharacter } : { triggerKind: 1 } }, 'completionProvider');
      if (!r) return { suggestions: [] };
      const items = Array.isArray(r) ? r : r.items || []; const w = model.getWordUntilPosition(pos);
      const def = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn); const k = CIK();
      return { incomplete: !!r.isIncomplete, suggestions: items.slice(0, 1000).map(it => {
        const te = it.textEdit; const range = te ? (te.range ? R(te.range) : { insert: R(te.insert), replace: R(te.replace) }) : def;
        return { label: it.labelDetails ? { label: it.label, detail: it.labelDetails.detail, description: it.labelDetails.description } : it.label, kind: k[it.kind] ?? k[1], detail: it.detail, documentation: docText(it.documentation), sortText: it.sortText, filterText: it.filterText, preselect: it.preselect,
          insertText: te ? te.newText : (it.insertText || it.label), insertTextRules: it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined, range,
          additionalTextEdits: (it.additionalTextEdits || []).map(e => ({ range: R(e.range), text: e.newText })), tags: it.deprecated ? [1] : undefined, _lsp: it };
      }) };
    },
    resolveCompletionItem: async (item) => {
      const d = [...LS.docs.values()].find(x => x.client.caps.completionProvider && x.client.caps.completionProvider.resolveProvider); if (!d || !item._lsp) return item;
      try { const r = await d.client.request('completionItem/resolve', item._lsp, 4000); if (r) { item.documentation = docText(r.documentation) || item.documentation; item.detail = r.detail || item.detail; if (r.additionalTextEdits) item.additionalTextEdits = r.additionalTextEdits.map(e => ({ range: R(e.range), text: e.newText })); } } catch {}
      return item;
    },
  });
  L.registerSignatureHelpProvider(lang, {
    signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [')'],
    provideSignatureHelp: async (model, pos) => {
      const r = await ask(model, 'textDocument/signatureHelp', { position: P(pos) }, 'signatureHelpProvider'); if (!r || !r.signatures || !r.signatures.length) return null;
      return { value: { activeSignature: r.activeSignature || 0, activeParameter: r.activeParameter || 0, signatures: r.signatures.map(s => ({ label: s.label, documentation: docText(s.documentation), parameters: (s.parameters || []).map(p => ({ label: p.label, documentation: docText(p.documentation) })), activeParameter: s.activeParameter })) }, dispose() {} };
    },
  });
  L.registerDocumentFormattingEditProvider(lang, { provideDocumentFormattingEdits: async (model, opt) => ((await ask(model, 'textDocument/formatting', { options: { tabSize: opt.tabSize, insertSpaces: opt.insertSpaces } }, 'documentFormattingProvider')) || []).map(e => ({ range: R(e.range), text: e.newText })) });
  L.registerDocumentRangeFormattingEditProvider(lang, { provideDocumentRangeFormattingEdits: async (model, range, opt) => ((await ask(model, 'textDocument/rangeFormatting', { range: RL(range), options: { tabSize: opt.tabSize, insertSpaces: opt.insertSpaces } }, 'documentRangeFormattingProvider')) || []).map(e => ({ range: R(e.range), text: e.newText })) });
  L.registerRenameProvider(lang, {
    resolveRenameLocation: async (model, pos) => {
      const d = docOf(model); if (!d) return { range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1), text: '', rejectReason: 'Sem servidor de linguagem para renomear aqui' };
      const pr = d.client.caps.renameProvider;
      if (pr && pr.prepareProvider) {
        try { const r = await d.client.request('textDocument/prepareRename', { textDocument: { uri: d.uri }, position: P(pos) }); if (!r) return { range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: '', rejectReason: 'Isto não pode ser renomeado' }; if (r.range) return { range: R(r.range), text: r.placeholder || model.getValueInRange(R(r.range)) }; if (r.start) return { range: R(r), text: model.getValueInRange(R(r)) }; } catch (e) { return { range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: '', rejectReason: e.message }; }
      }
      const w = model.getWordAtPosition(pos); if (!w) return { range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: '', rejectReason: 'Nada para renomear aqui' };
      return { range: new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), text: w.word };
    },
    // o Monaco só sabe editar o arquivo aberto; os outros arquivos o BlueScreen altera e salva sozinho
    provideRenameEdits: async (model, pos, newName) => {
      const d = docOf(model); if (!d) return { edits: [], rejectReason: 'Sem servidor de linguagem' };
      let we; try { we = await d.client.request('textDocument/rename', { textDocument: { uri: d.uri }, position: P(pos), newName }); } catch (e) { return { edits: [], rejectReason: e.message }; }
      if (!we) return { edits: [], rejectReason: 'O servidor não encontrou o que renomear' };
      const n = await applyWorkspaceEdit(we, d.client, model);
      const own = editsFor(we).find(x => keyOf(uriToPath(x.uri)) === keyOf(absOf(d.tab)));
      if (n > 0) toast(`Renomeado para ${newName} em ${n + (own ? 1 : 0)} arquivos`, 'ok');
      return { edits: (own ? own.edits : []).map(e => ({ resource: model.uri, versionId: undefined, textEdit: { range: R(e.range), text: e.newText } })) };
    },
  });
  L.registerCodeActionProvider(lang, {
    provideCodeActions: async (model, range, ctx) => {
      const d = docOf(model); if (!d || !d.client.caps.codeActionProvider) return { actions: [], dispose() {} };
      const diags = (d.diags || []).filter(x => ctx.markers.some(m => m.startLineNumber === x.range.start.line + 1 && m.message === x.message));
      let r; try { r = await d.client.request('textDocument/codeAction', { textDocument: { uri: d.uri }, range: RL(range), context: { diagnostics: diags, only: ctx.only ? [ctx.only] : undefined, triggerKind: ctx.trigger === 1 ? 1 : 2 } }); } catch { r = null; }
      const actions = (r || []).map(a => ({ title: a.title, kind: a.kind || (a.command && !a.edit ? 'quickfix' : 'refactor'), isPreferred: a.isPreferred, diagnostics: a.diagnostics ? ctx.markers.filter(m => a.diagnostics.some(x => x.message === m.message)) : undefined, disabled: a.disabled && a.disabled.reason, command: { id: 'bs.lsp.codeAction', title: a.title, arguments: [d, a] } }));
      return { actions, dispose() {} };
    },
  }, { providedCodeActionKinds: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] });
}
// ação escolhida: resolve (se o servidor pedir), aplica a edição e roda o comando
async function runCodeAction(d, a) {
  try {
    if (a.command && typeof a.command === 'string') return void await d.client.request('workspace/executeCommand', { command: a.command, arguments: a.arguments });
    if (!a.edit && !a.command && d.client.caps.codeActionProvider && d.client.caps.codeActionProvider.resolveProvider) a = await d.client.request('codeAction/resolve', a);
    if (a.edit) await applyWorkspaceEdit(a.edit, d.client);
    if (a.command) await d.client.request('workspace/executeCommand', { command: a.command.command, arguments: a.command.arguments });
  } catch (e) { toast(a.title + ': ' + e.message, 'err'); }
}

// ----- edições em vários arquivos (renomear, refatorar, organizar imports) -----
function editsFor(we) {
  const out = [];
  if (we.documentChanges) for (const c of we.documentChanges) { if (c.textDocument) out.push({ uri: c.textDocument.uri, edits: c.edits }); else if (c.kind) out.push({ op: c }); }
  else if (we.changes) for (const [uri, edits] of Object.entries(we.changes)) out.push({ uri, edits });
  return out;
}
// aplica a edição: abas abertas mudam no editor (ficam por salvar); os outros arquivos são alterados e salvos.
// skipModel: o arquivo que o próprio Monaco vai editar (renomear). Devolve quantos arquivos fora dele mudaram.
async function applyWorkspaceEdit(we, client, skipModel) {
  let n = 0; const disk = [];
  for (const x of editsFor(we)) {
    if (x.op) { toast('Operação de arquivo do servidor ignorada: ' + x.op.kind); continue; }
    const abs = uriToPath(x.uri); const tab = editorTabFor(abs);
    const edits = x.edits.map(e => ({ range: R(e.range), text: e.newText, forceMoveMarkers: true }));
    if (tab) { if (skipModel && tab.model === skipModel) continue; tab.model.pushEditOperations([], edits, () => null); n++; continue; }
    const rel = S.project && relOf(abs, S.project.path); if (rel == null) continue;
    try {
      const f = await api('file', { project: S.project.path, file: rel }); if (f.binary || f.tooBig) continue;
      const tmp = monaco.editor.createModel(f.content); tmp.applyEdits(edits); const text = tmp.getValue(); tmp.dispose();
      await api('file', { project: S.project.path, file: rel }, { method: 'PUT', body: text });
      const peek = monaco.editor.getModel(monaco.Uri.parse(pathToUri(abs))); if (peek) peek.setValue(text);
      disk.push({ uri: x.uri, type: 2 }); n++;
    } catch (e) { toast('Não foi possível alterar ' + rel + ': ' + e.message, 'err'); }
  }
  if (disk.length) { client && client.notify('workspace/didChangeWatchedFiles', { changes: disk }); refreshProject(); }
  return n;
}

// ----- erros e avisos do servidor -----
function diagnostics(c, p) {
  const abs = uriToPath(p.uri); const tab = editorTabFor(abs);
  const d = tab && LS.docs.get(tab.model.id); if (d) d.diags = p.diagnostics;
  const model = tab ? tab.model : monaco.editor.getModel(monaco.Uri.parse(pathToUri(abs))); if (!model) return;
  const sev = monaco.MarkerSeverity; const SV = [sev.Error, sev.Error, sev.Warning, sev.Info, sev.Hint];
  monaco.editor.setModelMarkers(model, 'lsp:' + c.tool.id, p.diagnostics.map(x => ({ ...R(x.range), message: x.message, severity: SV[x.severity || 1], source: x.source || c.tool.name, code: x.code != null ? String(typeof x.code === 'object' ? x.code.value : x.code) : undefined, tags: x.tags })));
  lsStatus();
}

// ----- ir para um arquivo (definição em outro arquivo, "abrir" das espiadas) -----
async function goTo(uri, range) {
  const abs = uriToPath(uri); const line = range ? (range.startLineNumber || (range.start && range.start.line + 1) || 1) : 1;
  const rel = S.project && relOf(abs, S.project.path);
  if (rel != null) await openFile(rel, 'editor', line);
  else { const root = abs.replace(/[\\/][^\\/]*$/, ''); openOutside(root, abs.slice(root.length + 1), line); }
}

// ----- status bar: servidor do arquivo aberto -----
let stEl = null;
function lsStatus() {
  if (!stEl) return;
  const t = S.active; const lang = t && t.mode === 'editor' ? t.lang : null;
  const known = lang ? knownFor(lang) : [];
  if (!lang || !known.length) { stEl.hidden = true; return; }
  stEl.hidden = false;
  const tool = serverFor(lang);
  if (!tool) { stEl.innerHTML = '<span class="lsp-dot off"></span>sem análise'; stEl.title = `Nenhum servidor de linguagem para ${lang}. Clique para instalar.`; return; }
  const c = LS.clients.get(tool.id + '|' + keyOf(t.project));
  const busy = [...LS.progress.keys()].some(k => k.startsWith(tool.id));
  const errs = t.model ? monaco.editor.getModelMarkers({ resource: t.model.uri }).filter(m => m.owner.startsWith('lsp:') && m.severity === monaco.MarkerSeverity.Error).length : 0;
  const state = !c ? 'parado' : !c.alive ? 'iniciando' : busy ? 'analisando' : 'pronto';
  stEl.innerHTML = `<span class="lsp-dot ${state === 'pronto' ? (errs ? 'err' : 'ok') : 'busy'}"></span>${esc(tool.name.replace(/ \(.*\)$/, ''))}`;
  stEl.title = `${tool.name}: ${state}${busy ? ' (' + [...LS.progress.values()].filter(Boolean).join(', ') + ')' : ''}${errs ? `\n${errs} erro(s) neste arquivo` : ''}\nClique para opções`;
}
function lsMenu(e) {
  const t = S.active; if (!t) return; const lang = t.lang; const tool = serverFor(lang);
  const items = [];
  if (tool) {
    items.push({ label: 'Reiniciar ' + tool.name, icon: I.refresh, action: () => restart(tool, t.project) });
    items.push({ label: 'Renomear símbolo', k: 'Shift+F6', icon: I.edit, action: () => editor.trigger('bs', 'editor.action.rename') });
    items.push({ label: 'Ações rápidas e refatorações', k: 'Alt+Enter', icon: I.edit, action: () => editor.trigger('bs', 'editor.action.quickFix') });
    items.push({ label: 'Formatar arquivo', k: 'Shift+Alt+F', icon: I.edit, action: () => editor.trigger('bs', 'editor.action.formatDocument') });
  }
  const missing = knownFor(lang).filter(x => !x.installed);
  if (missing.length) { if (items.length) items.push('-'); missing.forEach(x => items.push({ label: 'Instalar ' + x.name, icon: I.pkg || I.edit, action: () => install(x) })); }
  items.push('-', { label: 'Procurar servidores de novo', icon: I.refresh, action: async () => { await lsTools(true); const n = LS.tools.filter(x => x.installed).length; toast(`${n} ferramentas encontradas`); S.tabs.filter(x => x.mode === 'editor').forEach(openDoc); lsStatus(); } });
  showMenu(e, items, 'Análise de ' + lang);
}
function install(tool) {
  if (!bs.terminal) { copyText(tool.install); return; }
  const cmd = tool.install.split('  (')[0];
  if (/^(npm|pip|go|rustup|dotnet|gem|winget|scoop) /.test(cmd)) { bs.terminal.run(cmd); toast('Depois de instalar, use "Procurar servidores de novo"'); }
  else { copyText(tool.install); toast(tool.install); }
}
async function restart(tool, root) {
  const key = tool.id + '|' + keyOf(root); const c = LS.clients.get(key);
  if (c) { try { await c.request('shutdown', null, 3000); c.notify('exit', null); } catch {} c.close(); LS.clients.delete(key); }
  for (const [id, d] of [...LS.docs]) if (d.client === c) { d.sub && d.sub.dispose(); LS.docs.delete(id); }
  S.tabs.filter(x => x.mode === 'editor' && x.project === root).forEach(openDoc);
}

// ----- ligações com o núcleo -----
bs.hooks.on('editor:ready', (ed) => {
  // atalhos do IntelliJ para navegação e refatoração
  const K = monaco.KeyMod, C = monaco.KeyCode; const run = (id) => () => ed.trigger('bs', id, null);
  ed.addCommand(K.Shift | C.F6, run('editor.action.rename'));
  ed.addCommand(K.Alt | C.Enter, run('editor.action.quickFix'));
  ed.addCommand(K.Alt | C.F7, run('editor.action.goToReferences'));
  ed.addCommand(K.CtrlCmd | C.KeyB, run('editor.action.revealDefinition'));
  ed.addCommand(K.CtrlCmd | K.Alt | C.KeyB, run('editor.action.goToImplementation'));
  ed.addCommand(K.CtrlCmd | K.Shift | C.KeyB, run('editor.action.goToTypeDefinition'));
  ed.addCommand(K.CtrlCmd | C.F12, run('editor.action.quickOutline'));
  ed.addCommand(K.CtrlCmd | C.KeyQ, run('editor.action.showHover'));
  ed.addCommand(K.CtrlCmd | K.Alt | C.KeyO, run('editor.action.organizeImports'));
  ed.addAction({ id: 'bs.lsp.rename', label: 'Renomear…', keybindings: [], contextMenuGroupId: '1_modification', contextMenuOrder: 0, run: run('editor.action.rename') });
  lsTools();
});
bs.hooks.on('tab:open', (t) => openDoc(t));
bs.hooks.on('tab:activate', (t) => { openDoc(t); lsStatus(); });
bs.hooks.on('tab:close', (t) => closeDoc(t));
bs.hooks.on('tab:save', (t) => { const d = t.model && LS.docs.get(t.model.id); if (d) { flush(d); d.client.notify('textDocument/didSave', { textDocument: { uri: d.uri }, text: t.model.getValue() }); } });
bs.hooks.on('project:select', () => lsStatus());
const boot = setInterval(() => {
  if (!window.monaco) return; clearInterval(boot);
  monaco.editor.registerCommand('bs.lsp.codeAction', (_, d, a) => runCodeAction(d, a));
  // Monaco abrindo outro arquivo (definição, referência, espiada): vira uma aba do BlueScreen
  monaco.editor.registerEditorOpener({ openCodeEditor(src, resource, sel) {
    if (resource.scheme === 'file') { goTo(resource.toString(), sel); return true; }
    const m = monaco.editor.getModel(resource); const tab = m && m._tab;
    if (tab) { activate(tab); if (sel) revealAt(editor, sel.startLineNumber || sel.lineNumber || 1, sel.startColumn || sel.column || 1); return true; }
    return false;
  } });
  stEl = bs.status.add({ id: 'stLsp', title: 'Análise da linguagem', onclick: (e) => lsMenu(e) });
  lsTools().then(lsStatus);
}, 100);
setInterval(lsStatus, 2000);
bs.actions.add([
  { label: 'Renomear símbolo', k: 'Shift+F6', run: () => editor && editor.trigger('bs', 'editor.action.rename') },
  { label: 'Ações rápidas e refatorações', k: 'Alt+Enter', run: () => editor && editor.trigger('bs', 'editor.action.quickFix') },
  { label: 'Ir para a definição', k: 'Ctrl+B', run: () => editor && editor.trigger('bs', 'editor.action.revealDefinition') },
  { label: 'Encontrar usos', k: 'Alt+F7', run: () => editor && editor.trigger('bs', 'editor.action.goToReferences') },
  { label: 'Estrutura do arquivo', k: 'Ctrl+F12', run: () => editor && editor.trigger('bs', 'editor.action.quickOutline') },
  { label: 'Formatar arquivo', k: 'Shift+Alt+F', run: () => editor && editor.trigger('bs', 'editor.action.formatDocument') },
  { label: 'Organizar imports', k: 'Ctrl+Alt+O', run: () => editor && editor.trigger('bs', 'editor.action.organizeImports') },
  { label: 'Servidores de linguagem: procurar de novo', run: async () => { await lsTools(true); toast(LS.tools.filter(x => x.kind === 'lsp' && x.installed).length + ' servidores de linguagem'); } },
]);
window.addEventListener('beforeunload', () => LS.clients.forEach(c => c.close()));
bs.lsp = { tools: lsTools, clientFor: (tab) => { const t = serverFor(tab.lang); return t ? clientFor(t, tab.project) : null; }, restart, pathToUri, uriToPath, RpcClient };
})(window.BS);
