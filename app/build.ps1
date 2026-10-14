# BlueScreen: monta a versão final em dist\BlueScreen (núcleo + interface + plugins).
#   .\build.ps1            compila em release e monta dist\BlueScreen
#   .\build.ps1 -Plugin <id> monta só dist\plugins\<id> (para copiar em ~\.bluescreen\plugins de outra máquina)
param([string]$Plugin = '', [string]$Out = "$PSScriptRoot\dist")
$ErrorActionPreference = 'Continue' # o cargo escreve o progresso no stderr; o que vale é o código de saída
Set-Location $PSScriptRoot

function Copy-Plugin([string]$id, [string]$dest) {
  $src = Join-Path $PSScriptRoot "plugins\$id"
  New-Item -ItemType Directory -Force $dest | Out-Null
  foreach ($f in 'plugin.json', 'ui.js', 'style.css') { if (Test-Path "$src\$f") { Copy-Item "$src\$f" $dest } }
  # plugin com servidor próprio: o programa vira server.exe na pasta do plugin
  $exe = Join-Path $PSScriptRoot "target\release\bluescreen-$id.exe"
  if (Test-Path "$src\Cargo.toml") { Copy-Item $exe (Join-Path $dest 'server.exe') }
  Write-Host "plugin  $id  -> $dest"
}

if ($Plugin) {
  if (Test-Path "plugins\$Plugin\Cargo.toml") { cargo build --release -p "bluescreen-$Plugin"; if ($LASTEXITCODE) { exit 1 } }
  Copy-Plugin $Plugin (Join-Path $Out "plugins\$Plugin")
  exit 0
}

cargo build --release --workspace
if ($LASTEXITCODE) { exit 1 }
$dist = Join-Path $Out 'BlueScreen'
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item 'target\release\bluescreen.exe' (Join-Path $dist 'BlueScreen.exe')
Copy-Item -Recurse 'wwwroot' (Join-Path $dist 'wwwroot')
Get-ChildItem 'plugins' -Directory | ForEach-Object { Copy-Plugin $_.Name (Join-Path $dist "plugins\$($_.Name)") }
$size = (Get-ChildItem $dist -Recurse | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("`nVersão final em {0} ({1:N1} MB). Rode BlueScreen.exe lá dentro." -f $dist, $size)

