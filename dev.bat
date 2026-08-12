@echo off
:: Development launcher - hot reload, two servers. For production, use start.bat.
:: Thin shim so the launcher lives in exactly one place (dev.ps1).
:: Any flags are passed through, e.g. dev.bat -NoReload
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
if errorlevel 1 pause
