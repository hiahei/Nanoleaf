@echo off
cd /d "%~dp0"
start "" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch-nanoleaf.ps1"
exit /b
