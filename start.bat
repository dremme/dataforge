@echo off
setlocal EnableExtensions EnableDelayedExpansion
title DataForge Launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo ================================================
echo   Starting DataForge Dev Servers
echo   Backend  : http://127.0.0.1:8080
echo   Frontend : http://127.0.0.1:8081
echo ================================================
echo.

set "VENV_PY=%ROOT%\backend\.venv\Scripts\python.exe"
if not exist "%VENV_PY%" (
    echo [ERROR] Python venv not found at backend\.venv
    echo Run setup.bat from the project root first.
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%\frontend\node_modules\" (
    echo [ERROR] Frontend dependencies not installed.
    echo Run setup.bat from the project root first.
    echo.
    pause
    exit /b 1
)

if exist "%ROOT%\.node\npm.cmd" (
    set "NPM=%ROOT%\.node\npm.cmd"
) else (
    set "NPM=npm.cmd"
)

echo [1/2] Starting backend on port 8080 with hot reload...
start "DataForge - Backend" cmd /k title DataForge - Backend ^&^& cd /d "%ROOT%" ^&^& echo DataForge Backend - http://127.0.0.1:8080 ^&^& echo Hot reload: uvicorn --reload ^&^& echo. ^&^& "%VENV_PY%" scripts\dev_server.py

timeout /t 2 /nobreak >nul

echo [2/2] Starting frontend on port 8081 with Vite HMR...
start "DataForge - Frontend" cmd /k title DataForge - Frontend ^&^& cd /d "%ROOT%\frontend" ^&^& echo DataForge Frontend - http://127.0.0.1:8081 ^&^& echo Hot reload: Vite HMR ^&^& echo. ^&^& call "%NPM%" run dev

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8081"

echo.
echo Both servers are running in separate windows.
echo.
echo Hot reload:
echo   Frontend - Vite HMR on save
echo   Backend  - uvicorn reloader on .py changes ^(tests excluded^)
echo.
echo To stop: close each server window or press Ctrl+C inside it.
echo.
@REM For now, auto-close this console window
@REM pause