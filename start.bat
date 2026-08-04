@echo off
:: Thin shim so the launcher lives in exactly one place (start.ps1).
:: Any flags are passed through, e.g. start.bat -NoReload
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
