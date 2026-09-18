@echo off
title Xiaomi Smart Storage - Mijia Web Console
echo =======================================================
echo   Xiaomi Smart Storage - Mijia Web Console starting...
echo =======================================================
echo.

REM Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ first.
    pause
    exit /b 1
)
echo [OK] Node.js ready

REM Install frontend deps if needed
if not exist "%~dp0web\node_modules" (
    echo [*] First run: installing frontend dependencies...
    cd /d "%~dp0web"
    call npm install --no-audit --no-fund --loglevel=error
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

REM Build frontend if dist is missing
if not exist "%~dp0web\dist\index.html" (
    echo [*] Building frontend bundle...
    cd /d "%~dp0web"
    call npm run build
    if %errorlevel% neq 0 (
        echo [ERROR] Frontend build failed
        pause
        exit /b 1
    )
)

cd /d "%~dp0server"
echo [OK] Starting local relay gateway and web host on port 8090...
echo.
echo   Open in browser: http://127.0.0.1:8090
echo.

node gateway.js

pause
