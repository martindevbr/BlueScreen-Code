/* BlueScreen: HTML e JSP sem instalar nada. O Monaco já completa tags e atributos de HTML; aqui entram:
     - Ctrl+clique / Ctrl+B em href, src, action, page, file, url...: abre o arquivo do projeto
       ("/x" procura a partir da raiz web, a pasta com WEB-INF; "#id" vai ao id="..." do próprio arquivo)
     - completar caminhos de arquivo dentro desses atributos
     - em .jsp/.jspf/.tag: diretivas, scriptlets, ações jsp:* e as tags mais usadas da JSTL (c:, fmt:)
   Os erros vêm do lint ao vivo do núcleo (lint.rs, regras html/jsp), ligado em app.js. Com o servidor de linguagem
   de HTML instalado, os dois somam. */
(function (bs) {
const { S } = bs;
const PATH_ATTR = /\b(href|src|action|page|file|url|data-src|poster|background|template|tagdir|formaction)\s*=\s*(["'])([^"']*)\2?/gi; // sem a aspa final: ainda digitando
const DYNAMIC = /^(?:[a-z][\w+.-]*:|\/\/|#?$)|[$#]\{|<%/i; // http:, mailto:, javascript:, //cdn, ${EL}, <%= %>
const isJsp = (p) => /\.(jspf?|tag)$/i.test(p);

// ----- arquivos do projeto (o índice da busca geral) -----
let files = null, filesOf = null, webRoots = new Set();
async function fileSet() {
  const idx = typeof seIndex === 'function' ? await seIndex() : [];
  if (idx !== filesOf) {
    filesOf = idx; files = new Set((idx || []).map(f => f.p)); webRoots = new Set();
    for (const p of files) { const k = p.indexOf('WEB-INF/'); if (k === 0 || (k > 0 && p[k - 1] === '/')) webRoots.add(p.slice(0, Math.max(0, k - 1))); }
  }
  return files;
}
const tabOf = (model) => model._tab || (S.active && S.active.model === model ? S.active : null);
function norm(p) {
  const out = [];
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return out.join('/');
}
const dirOf = (rel) => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
// pastas candidatas para um caminho absoluto ("/css/a.css"): a raiz web (pasta com WEB-INF) e cada pasta acima do arquivo
function roots(rel) {
  const out = []; let d = dirOf(rel);
  for (;;) { if (webRoots.has(d)) out.unshift(d); out.push(d); if (!d) break; d = dirOf(d); }
  return [...new Set(out)];
}
// caminho escrito no atributo -> arquivo do projeto (ou null)
function resolve(rel, value, set) {
  const v = value.split(/[?#]/)[0].trim(); if (!v || DYNAMIC.test(value.trim())) return null;
  const tries = v.startsWith('/')
    ? roots(rel).flatMap(r => [norm(r + v), norm(r + v.replace(/^\/[^/]+/, ''))]) // com e sem o contexto da aplicação (/app/x)
    : [norm(dirOf(rel) + '/' + v)];
  for (const t of tries) if (set.has(t)) return t;
  // último recurso: um único arquivo do projeto que termina com esse caminho
  const tail = '/' + norm(v.replace(/^(\.\.\/)+/, ''));
  const hits = [...set].filter(p => ('/' + p).endsWith(tail));
  return hits.length === 1 ? hits[0] : null;
}
// o atributo de caminho sob o cursor: { value, start, end } em colunas do Monaco (1-based), ou null
function attrAt(model, pos) {
  const line = model.getLineContent(pos.lineNumber); PATH_ATTR.lastIndex = 0;
  for (let m; (m = PATH_ATTR.exec(line));) {
    const start = m.index + m[0].indexOf(m[2]) + 1; // índice do 1º caractere do valor (logo depois da aspa)
    if (pos.column - 1 >= start && pos.column - 1 <= start + m[3].length) return { value: m[3], start: start + 1, end: start + 1 + m[3].length, before: m[3].slice(0, pos.column - 1 - start) };
  }
  return null;
}

// modelo do arquivo destino: a aba aberta ou um file:/// (o "opener" de lsp.js transforma em aba ao navegar)
async function modelOf(tab, rel) {
  const open = S.tabs.find(t => t.mode === 'editor' && t.model && t.project === tab.project && t.path === rel); if (open) return open.model;
  const uri = monaco.Uri.parse(bs.lsp.pathToUri(tab.project.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\')));
  let m = monaco.editor.getModel(uri);
  if (!m) { try { const f = await bs.api('file', { project: tab.project, file: rel }); if (!f.binary && !f.tooBig) m = monaco.editor.createModel(f.content, langOf(rel), uri); } catch {} }
  return m;
}
function register() {
  const L = monaco.languages;
  // JSP tem gramática própria (app.js); tags, atributos e o resto do HTML vêm do mesmo serviço de linguagem do HTML
  try { L.html.registerHTMLLanguageService('jsp', { format: L.html.htmlDefaults.options.format, suggest: { html5: true } }, { completionItems: true, hovers: true, documentHighlights: true, links: true, documentSymbols: true, foldingRanges: true, selectionRanges: true, linkedEditing: true }); } catch (e) { console.warn('jsp: serviço de HTML', e); }
  L.registerDefinitionProvider(['html', 'jsp'], { provideDefinition: async (model, pos) => {
    const a = attrAt(model, pos); const tab = tabOf(model); if (!a || !tab) return null;
    if (a.value.startsWith('#') && a.value.length > 1) {
      const id = a.value.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hit = model.findMatches(`\\b(id|name)\\s*=\\s*["']${id}["']`, false, true, true, null, false)[0];
      return hit ? { uri: model.uri, range: hit.range } : null;
    }
    const target = resolve(tab.path, a.value, await fileSet()); if (!target) return null;
    const m = await modelOf(tab, target); return m ? { uri: m.uri, range: new monaco.Range(1, 1, 1, 1) } : null;
  } });
  // caminhos de arquivo: completa a pasta digitada até agora com o que existe no projeto
  L.registerCompletionItemProvider(['html', 'jsp'], { triggerCharacters: ['"', "'", '/'], provideCompletionItems: async (model, pos) => {
    const a = attrAt(model, pos); const tab = tabOf(model);
    if (!a || !tab || (a.before && DYNAMIC.test(a.before))) return { suggestions: [] };
    const set = await fileSet(); const typed = a.before; const dirTyped = typed.slice(0, typed.lastIndexOf('/') + 1);
    const bases = dirTyped.startsWith('/') ? roots(tab.path).flatMap(r => [norm(r + dirTyped), ...(dirTyped.lastIndexOf('/') > 0 ? [norm(r + dirTyped.replace(/^\/[^/]+/, ''))] : [])]) : [norm(dirOf(tab.path) + '/' + dirTyped)];
    const seen = new Map(); const K = L.CompletionItemKind;
    for (const b of bases) {
      const pre = b ? b + '/' : '';
      for (const p of set) {
        if (!p.startsWith(pre) || p === tab.path) continue;
        const rest = p.slice(pre.length); const k = rest.indexOf('/');
        const name = k < 0 ? rest : rest.slice(0, k);
        if (!seen.has(name)) seen.set(name, k >= 0);
      }
      if (seen.size) break;
    }
    const range = new monaco.Range(pos.lineNumber, a.start + dirTyped.length, pos.lineNumber, a.end);
    return { suggestions: [...seen].slice(0, 500).map(([name, dir]) => ({ label: name + (dir ? '/' : ''), kind: dir ? K.Folder : K.File, insertText: name + (dir ? '/' : ''), range, sortText: (dir ? '0' : '1') + name, command: dir ? { id: 'editor.action.triggerSuggest' } : undefined })) };
  } });
  // JSP: diretivas, scriptlets, ações jsp:* e JSTL
  const S_ = L.CompletionItemInsertTextRule.InsertAsSnippet;
  const JSP = [
    ['<%@ page %>', '<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8"$0 %>', 'diretiva page'],
    ['<%@ page import %>', '<%@ page import="$1" %>$0', 'importa classes Java'],
    ['<%@ include %>', '<%@ include file="$1" %>$0', 'inclui outro arquivo na compilação'],
    ['<%@ taglib %>', '<%@ taglib prefix="${1:c}" uri="${2:jakarta.tags.core}" %>$0', 'declara uma biblioteca de tags'],
    ['<% %>', '<% $0 %>', 'scriptlet'], ['<%= %>', '<%= $0 %>', 'expressão'], ['<%-- --%>', '<%-- $0 --%>', 'comentário JSP'], ['<%! %>', '<%! $0 %>', 'declaração'],
    ['jsp:include', '<jsp:include page="$1" />$0'], ['jsp:forward', '<jsp:forward page="$1" />$0'], ['jsp:param', '<jsp:param name="$1" value="$2" />$0'],
    ['jsp:useBean', '<jsp:useBean id="$1" class="$2" scope="${3:request}" />$0'], ['jsp:getProperty', '<jsp:getProperty name="$1" property="$2" />$0'], ['jsp:setProperty', '<jsp:setProperty name="$1" property="$2" value="$3" />$0'],
    ['c:if', '<c:if test="\\${$1}">\n\t$0\n</c:if>'], ['c:forEach', '<c:forEach items="\\${$1}" var="${2:item}">\n\t$0\n</c:forEach>'],
    ['c:choose', '<c:choose>\n\t<c:when test="\\${$1}">$2</c:when>\n\t<c:otherwise>$0</c:otherwise>\n</c:choose>'], ['c:when', '<c:when test="\\${$1}">$0</c:when>'], ['c:otherwise', '<c:otherwise>$0</c:otherwise>'],
    ['c:out', '<c:out value="\\${$1}" />$0'], ['c:set', '<c:set var="$1" value="\\${$2}" scope="${3:page}" />$0'], ['c:remove', '<c:remove var="$1" />$0'],
    ['c:import', '<c:import url="$1" />$0'], ['c:url', '<c:url value="$1" />$0'], ['c:redirect', '<c:redirect url="$1" />$0'], ['c:catch', '<c:catch var="${1:erro}">\n\t$0\n</c:catch>'],
    ['fmt:message', '<fmt:message key="$1" />$0'], ['fmt:formatDate', '<fmt:formatDate value="\\${$1}" pattern="${2:dd/MM/yyyy}" />$0'], ['fmt:formatNumber', '<fmt:formatNumber value="\\${$1}" type="${2:number}" />$0'], ['fmt:setBundle', '<fmt:setBundle basename="$1" />$0'],
  ];
  L.registerCompletionItemProvider(['html', 'jsp'], { triggerCharacters: ['<', '%', ':'], provideCompletionItems: (model, pos) => {
    const tab = tabOf(model); if (!tab || !isJsp(tab.path)) return { suggestions: [] };
    const line = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
    const m = line.match(/<[%@!=\w:-]*$/); if (!m) return { suggestions: [] };
    const range = new monaco.Range(pos.lineNumber, pos.column - m[0].length, pos.lineNumber, pos.column);
    const K = L.CompletionItemKind;
    return { suggestions: JSP.map(([label, snip, doc]) => ({ label, kind: label.startsWith('<%') ? K.Keyword : K.Snippet, detail: doc || 'JSP', insertText: snip.startsWith('<') ? snip : '<' + snip, insertTextRules: S_, range, filterText: label.startsWith('<') ? label : '<' + label, sortText: '0' + label })) };
  } });
}
const boot = setInterval(() => { if (!window.monaco || !monaco.languages || !bs.lsp) return; clearInterval(boot); register(); }, 100);
})(window.BS);
