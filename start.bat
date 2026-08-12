@echo off
:: Production launcher - builds the UI, then serves everything from one process.
:: For hot reload while developing, use dev.bat.
:: Thin shim so the launcher lives in exactly one place (start.ps1).
:: Any flags are passed through, e.g. start.bat -Rebuild
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
