; BlueScreen: instalador clássico (BlueScreen-Setup-X.Y.Z.exe), gerado pelo GitHub Actions a cada versão.
; Assistente em português: pasta de instalação, atalhos, "Abrir o BlueScreen" ao concluir e desinstalador em
; Configurações > Apps. Instala só para o usuário (sem administrador), como o Instalar BlueScreen.cmd: assim a
; atualização automática da IDE consegue trocar os arquivos da pasta sem pedir permissão.
;
; Compilar (depois do build.ps1, que monta app\dist\BlueScreen):
;   iscc /DAppVersion=2.1.0 app\installer\BlueScreen.iss      -> app\dist\BlueScreen-Setup-2.1.0.exe

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define Dist "..\dist\BlueScreen"

[Setup]
; não mude o AppId: é por ele que o Windows sabe que uma versão nova substitui a anterior
AppId={{6B3F2D1A-9C4E-4E8B-A7D2-B1E5C0F3A9D4}
AppName=BlueScreen
AppVersion={#AppVersion}
AppVerName=BlueScreen {#AppVersion}
AppPublisher=BlueScreen
AppPublisherURL=https://github.com/martindevbr/BlueScreen-IDE
AppSupportURL=https://github.com/martindevbr/BlueScreen-IDE/issues
AppUpdatesURL=https://github.com/martindevbr/BlueScreen-IDE/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductName=BlueScreen
VersionInfoDescription=Instalador do BlueScreen
; por usuário: %LOCALAPPDATA%\Programs\BlueScreen, sem UAC
PrivilegesRequired=lowest
DefaultDirName={autopf}\BlueScreen
DefaultGroupName=BlueScreen
DisableProgramGroupPage=yes
; a escolha da pasta aparece sempre (mesmo numa atualização, para quem quiser mudar)
DisableDirPage=no
UsePreviousAppDir=yes
UninstallDisplayName=BlueScreen
UninstallDisplayIcon={app}\BlueScreen.exe
SetupIconFile=..\..\assets\bluescreen.ico
LicenseFile=..\..\LICENSE
OutputDir=..\dist
OutputBaseFilename=BlueScreen-Setup-{#AppVersion}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
; o BlueScreen aberto (inclusive escondido, com a rede local ligada) é fechado antes de trocar os arquivos
CloseApplications=force
RestartApplications=no
ShowLanguageDialog=auto

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
pt.WebView2Missing=O BlueScreen precisa do Microsoft Edge WebView2 Runtime, que não foi encontrado neste computador (o Windows 11 já traz).%n%nAbrir a página de download agora? A instalação continua; o BlueScreen abre depois que o WebView2 estiver instalado.
en.WebView2Missing=BlueScreen needs the Microsoft Edge WebView2 Runtime, which was not found on this computer (Windows 11 ships with it).%n%nOpen the download page now? Setup will continue; BlueScreen opens once WebView2 is installed.
pt.LaunchApp=Abrir o BlueScreen
en.LaunchApp=Open BlueScreen

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#Dist}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; interface de uma versão anterior: sai inteira para não sobrar arquivo que não existe mais
Type: filesandordirs; Name: "{app}\wwwroot"

[Icons]
Name: "{autoprograms}\BlueScreen"; Filename: "{app}\BlueScreen.exe"; WorkingDir: "{app}"; Comment: "BlueScreen IDE"
Name: "{autodesktop}\BlueScreen"; Filename: "{app}\BlueScreen.exe"; WorkingDir: "{app}"; Comment: "BlueScreen IDE"; Tasks: desktopicon

[Run]
Filename: "{app}\BlueScreen.exe"; WorkingDir: "{app}"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; tira o BlueScreen do "Abrir com" do Windows (a IDE se registra sozinha ao abrir; veja app/src/assoc.rs)
Filename: "{app}\BlueScreen.exe"; Parameters: "--unregister"; Flags: runhidden waituntilterminated; RunOnceId: "AbrirCom"

[UninstallDelete]
; o que a IDE cria na pasta do programa: interface atualizada e exes antigos renomeados por uma atualização
Type: filesandordirs; Name: "{app}\wwwroot"
Type: files; Name: "{app}\*.old-*.exe"
Type: files; Name: "{app}\*.old-*.dll"
Type: filesandordirs; Name: "{app}\plugins"

[Code]
// WebView2 Runtime: a chave "pv" do EdgeUpdate (por máquina ou por usuário), diferente de vazio e de 0.0.0.0
function HasWebView2(): Boolean;
var
  V: String;
  K: String;
begin
  K := 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\' + K, 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE\' + K, 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\' + K, 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
begin
  if (CurStep = ssPostInstall) and not WizardSilent() and not HasWebView2() then
    if MsgBox(CustomMessage('WebView2Missing'), mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, Code);
end;
