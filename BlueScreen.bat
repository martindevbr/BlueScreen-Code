@echo off
rem Abre o BlueScreen (versão final em app\dist). Para gerar: cd app ^&^& powershell -File build.ps1
cd /d "%~dp0app\dist\BlueScreen" || (echo Rode antes: cd app ^&^& powershell -ExecutionPolicy Bypass -File build.ps1 & pause & exit /b 1)
start "" BlueScreen.exe %*
