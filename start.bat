@echo off
title Xiaomi Smart Storage - Mijia Web Console
echo =======================================================
echo   Xiaomi Smart Storage - Mijia Web Console starting...
echo =======================================================
echo.

cd /d "%~dp0server"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ first.
    pause
    exit /b 1
)

echo [OK] Node.js ready
echo [OK] Starting local relay gateway and web host on port 8090...
echo.
echo   Open in browser: http://127.0.0.1:8090
echo.

node gateway.js

pause
