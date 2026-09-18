@echo off
title OpenList Server for Xiaomi Smart Storage
cd /d "%~dp0"
if not exist "openlist.exe" (
    echo [!] openlist.exe not found in this directory.
    echo Please download openlist_windows_amd64.zip from:
    echo https://github.com/OpenListTeam/OpenList/releases
    echo and place openlist.exe here.
    pause
    exit /b 1
)
echo Starting OpenList server on http://127.0.0.1:5244 ...
openlist.exe server
pause
