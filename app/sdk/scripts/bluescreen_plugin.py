"""BlueScreen: apoio para servidores de plugin em Python 3.8+, sem dependências.

O BlueScreen grava este arquivo em ~/.bluescreen/sdk e passa a pasta em BLUESCREEN_SDK:

    import os, sys; sys.path.insert(0, os.environ["BLUESCREEN_SDK"])
    from bluescreen_plugin import Plugin

    p = Plugin()

    @p.route("meu/ola")
    def ola(req):
        return {"ola": req.query.get("nome", "mundo")}

    p.run()

Cada rota recebe um Request (method, query, headers, body em bytes, text(), json(), remote, internal) e devolve um
dict/lista (vira JSON), um Reply(status, corpo, cabeçalhos) ou lança PluginError("mensagem", status).
p.core fala com o núcleo e com outros plugins; p.data, p.secrets, p.settings() e p.files usam a pasta de dados;
p.vault usa o cofre da IDE (p.fetch com {{vault:nome}}, ou p.vault.reveal(nome) se você deixou o plugin ver o valor).
"""
import json
import os
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

H_TOKEN = "x-bluescreen-token"
H_PLUGIN_TOKEN = "x-bluescreen-plugin-token"


class PluginError(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


class Reply:
    def __init__(self, status, body, headers=None):
        self.status, self.body, self.headers = status, body, headers or {}


class Request:
    def __init__(self, method, query, headers, body):
        self.method, self.query, self.headers, self.body = method, query, headers, body
        self.remote = headers.get("x-bluescreen-remote") == "1"
        self.internal = headers.get("x-bluescreen-internal") == "1"

    def text(self):
        return self.body.decode("utf-8", "replace")

    def json(self):
        t = self.text().strip()
        return json.loads(t) if t else {}


class Core:
    """Cliente do núcleo: GET/POST em /api/<rota> com o token (chamada interna)."""

    def __init__(self, url=None, token=None):
        self.url = (url or os.environ.get("BLUESCREEN_URL") or "http://127.0.0.1:4747").rstrip("/")
        self.token = token if token is not None else os.environ.get("BLUESCREEN_TOKEN", "")

    def request(self, method, route, query=None, body=None, raw=False):
        q = urllib.parse.urlencode({k: v for k, v in (query or {}).items() if v is not None})
        u = f"{self.url}/api/{route.lstrip('/')}" + (f"?{q}" if q else "")
        headers = {H_TOKEN: self.token}
        # o token próprio do processo identifica o plugin (o cofre só entrega valores assim)
        if os.environ.get("BLUESCREEN_PLUGIN_TOKEN"):
            headers[H_PLUGIN_TOKEN] = os.environ["BLUESCREEN_PLUGIN_TOKEN"]
        data = None
        if body is not None:
            if isinstance(body, (bytes, bytearray)):
                data = bytes(body)
            elif isinstance(body, str):
                data = body.encode("utf-8")
            else:
                data = json.dumps(body).encode("utf-8")
                headers["content-type"] = "application/json"
        rq = urllib.request.Request(u, data=data, method=method, headers=headers)
        # sem proxy: o núcleo está em 127.0.0.1
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(rq) as r:
                out = r.read()
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get("error") or e.reason
            except Exception:
                msg = e.reason
            raise PluginError(msg, e.code)
        return out if raw else json.loads(out or b"null")

    def get(self, route, query=None):
        return self.request("GET", route, query)

    def post(self, route, query=None, body=None):
        return self.request("POST", route, query, {} if body is None else body)

    def bytes(self, route, query=None):
        return self.request("GET", route, query, raw=True)


class _Ns:
    pass


class Plugin:
    def __init__(self, id=None):
        self.id = id or os.environ.get("BLUESCREEN_PLUGIN")
        if not self.id:
            raise RuntimeError("BLUESCREEN_PLUGIN não definido: o servidor deve ser iniciado pelo BlueScreen")
        self.dir = os.environ.get("BLUESCREEN_PLUGIN_DIR", os.getcwd())
        self.data_dir = os.environ.get("BLUESCREEN_PLUGIN_DATA", "")
        self.files_dir = os.path.join(self.data_dir, "files") if self.data_dir else ""
        self.routes = {}
        core = self.core = Core()
        q = lambda **kw: {"plugin": self.id, **kw}

        # atributos (store.json)
        self.data = _Ns()
        self.data.get = lambda key: core.get("plugin/data", q(key=key))["value"]
        self.data.all = lambda: core.get("plugin/data", q())["values"]
        self.data.set = lambda key, value: core.post("plugin/data", q(), {"key": key, "value": value})
        self.data.merge = lambda values: core.post("plugin/data", q(), {"values": values})
        self.data.remove = lambda key: core.post("plugin/data", q(), {"key": key, "value": None})
        # segredos (cifrados com o DPAPI do Windows)
        self.secrets = _Ns()
        self.secrets.get = lambda key: core.get("plugin/secrets", q(key=key))["value"]
        self.secrets.set = lambda key, value: core.post("plugin/secrets", q(), {"key": key, "value": value})
        self.secrets.keys = lambda: core.get("plugin/secrets", q())["keys"]
        # arquivos (files/)
        self.files = _Ns()
        self.files.read = lambda path: core.bytes("plugin/files", q(path=path))
        self.files.write = lambda path, content: core.request("POST", "plugin/files", q(path=path), content if isinstance(content, (bytes, bytearray)) else str(content))
        self.files.list = lambda path="": core.get("plugin/files", q(path=path, list=1))["entries"]
        self.files.remove = lambda path: core.post("plugin/files", q(path=path, delete=1))
        # cofre da IDE: status() lista os segredos pedidos/liberados (sem valores); reveal(nome) só com "pode ver o valor"
        self.vault = _Ns()
        self.vault.status = lambda: core.get("vault/status", q())["items"]
        self.vault.reveal = lambda key: core.get("vault/reveal", q(key=key))["value"]

    def fetch(self, url, **opt):
        """HTTP pelo núcleo: {{vault:nome}} e {{secret:nome}} em url, headers e corpo, sem o valor passar por aqui."""
        r = self.core.post("plugin/fetch", {"plugin": self.id}, {"url": url, **opt})
        r["json"] = (lambda body=r.get("body"): json.loads(body or "null"))
        return r

    def exec(self, program, args=(), **opt):
        return self.core.post("plugin/exec", {"plugin": self.id}, {"program": program, "args": list(args), **opt})

    def settings(self):
        """Valores das configurações declaradas no plugin.json (os segredos ficam em p.secrets)."""
        return self.core.get("plugin/settings", {"plugin": self.id})["values"]

    def route(self, name, fn=None):
        """p.route("meu/rota", fn) ou @p.route("meu/rota")."""
        key = name.lstrip("/")
        key = key[4:] if key.startswith("api/") else key
        if fn is None:
            def deco(f):
                self.routes[key] = f
                return f
            return deco
        self.routes[key] = fn
        return fn

    def run(self):
        """Abre a porta, avisa o núcleo e atende até ser encerrado."""
        token = os.environ.get("BLUESCREEN_TOKEN", "")
        routes = self.routes

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # a saída vai para o log do BlueScreen; sem uma linha por pedido
                pass

            def send(self, status, body, headers=None):
                headers = dict(headers or {})
                if isinstance(body, str):
                    data = body.encode("utf-8")
                elif isinstance(body, (bytes, bytearray)):
                    data = bytes(body)
                else:
                    data = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
                    headers.setdefault("content-type", "application/json; charset=utf-8")
                self.send_response(status)
                self.send_header("cache-control", "no-store")
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def handle_any(self):
                if token and self.headers.get(H_TOKEN) != token:
                    return self.send(403, {"error": "acesso negado"})
                u = urllib.parse.urlsplit(self.path)
                fn = routes.get(u.path[5:] if u.path.startswith("/api/") else u.path.lstrip("/"))
                if not fn:
                    return self.send(404, {"error": "rota desconhecida"})
                n = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(n) if n else b""
                query = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
                req = Request(self.command, query, {k.lower(): v for k, v in self.headers.items()}, body)
                try:
                    out = fn(req)
                    if isinstance(out, Reply):
                        self.send(out.status, out.body, out.headers)
                    else:
                        self.send(200, out)
                except PluginError as e:
                    self.send(e.status, {"error": str(e)})
                except Exception as e:
                    traceback.print_exc()
                    self.send(500, {"error": str(e)})

            do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = handle_any

        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        print("BLUESCREEN-READY " + json.dumps({"port": srv.server_address[1], "routes": sorted(routes)}), flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


__all__ = ["Plugin", "Core", "PluginError", "Reply", "Request"]

if __name__ == "__main__":
    sys.exit("Este arquivo é uma biblioteca: importe-o no server.py do plugin.")
