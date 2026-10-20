# Servidor de plugins (`bluescreen-plugin-server`)

Hospeda plugins do BlueScreen com versões. As IDEs que apontam para ele instalam os plugins e são avisadas sempre que sai uma versão nova.

```
app\build.ps1 -PluginServer
dist\PluginServer\bluescreen-plugin-server.exe --port 4900 --dir D:\plugins --token SEGREDO --name "Plugins da equipe"
```

As mesmas opções valem por variável de ambiente: `PLUGIN_SERVER_PORT`, `PLUGIN_SERVER_DIR`, `PLUGIN_SERVER_TOKEN` e `PLUGIN_SERVER_NAME`. Sem token, o servidor gera um e o guarda em `<dir>/.token`. O servidor escuta em todas as interfaces, então outras máquinas da rede podem apontar para ele.

| Como publicar | |
|---|---|
| Pela IDE | botão direito no plugin (aba Plugins) › **Publicar no servidor**, com o token cadastrado no servidor |
| Pasta solta | copie a pasta do plugin (com `plugin.json`) para dentro de `<dir>/`; em segundos ela vira `<dir>/<id>/<versão>/` |
| API | `POST /api/publish` com `Authorization: Bearer <token>` e o pacote `{ sha256?, files: [{ path, data (base64) }] }` |

Para que as IDEs recebam o aviso de atualização, aumente o `version` do `plugin.json`. O servidor recusa publicar de novo a mesma versão; para substituir, use `?force=1`. Versão já arquivada por pasta solta vai para `<dir>/_recusados/`.

Detalhes do lado da IDE: [docs/PLUGINS.md](../../docs/PLUGINS.md#servidor-de-plugins).
