@echo off
chcp 65001 >nul
title 小米智能存储 - 米家 Web 控制台
echo =======================================================
echo   小米智能存储 · 米家 Web 控制台 正在启动...
echo =======================================================
echo.

cd /d "%~dp0server"

REM 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+ 
    pause
    exit /b 1
)

echo [√] Node.js 已就绪
echo [√] 正在启动本地中继网关与 Web 托管 (端口 8090)...
echo.
echo   请在浏览器访问: http://127.0.0.1:8090
echo.

node gateway.js

pause
