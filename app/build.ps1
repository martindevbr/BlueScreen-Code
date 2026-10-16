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

# plugins com servidor próprio (plugins\<id>\Cargo.toml) entram no workspace só durante o cargo build: o Cargo.toml
# fica sem "plugins/*" (vazio, o curinga faz o cargo recusar o manifesto). Cargo.toml e Cargo.lock voltam como estavam.
function Invoke-Cargo([string[]]$CargoArgs) {
  $hasPlugins = [bool](Get-ChildItem 'plugins' -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'Cargo.toml') })
  $toml = Join-Path $PSScriptRoot 'Cargo.toml'; $lock = Join-Path $PSScriptRoot 'Cargo.lock'
  $tomlText = [IO.File]::ReadAllText($toml); $lockText = [IO.File]::ReadAllText($lock)
  if ($hasPlugins) { [IO.File]::WriteAllText($toml, ($tomlText -replace 'members = \[\s*"\.",\s*"sdk"\s*\]', 'members = [".", "sdk", "plugins/*"]')) }
  try { cargo @CargoArgs | Out-Host; return $LASTEXITCODE }
  finally { if ($hasPlugins) { [IO.File]::WriteAllText($toml, $tomlText); [IO.File]::WriteAllText($lock, $lockText) } }
}

if ($Plugin) {
  if (Test-Path "plugins\$Plugin\Cargo.toml") { if (Invoke-Cargo @('build', '--release', '-p', "bluescreen-$Plugin")) { exit 1 } }
  Copy-Plugin $Plugin (Join-Path $Out "plugins\$Plugin")
  exit 0
}

if (Invoke-Cargo @('build', '--release', '--workspace')) { exit 1 }
$dist = Join-Path $Out 'BlueScreen'
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item 'target\release\bluescreen.exe' (Join-Path $dist 'BlueScreen.exe')
Copy-Item -Recurse 'wwwroot' (Join-Path $dist 'wwwroot')
Get-ChildItem 'plugins' -Directory | ForEach-Object { Copy-Plugin $_.Name (Join-Path $dist "plugins\$($_.Name)") }
$size = (Get-ChildItem $dist -Recurse | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("`nVersão final em {0} ({1:N1} MB). Rode BlueScreen.exe lá dentro." -f $dist, $size)

