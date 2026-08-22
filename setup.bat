@echo off
:: Thin shim so the bootstrap lives in exactly one place (setup.ps1).
:: Double-click this on a machine with no Python and no Node/npm.
title DataForge Setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  pause
  exit /b %ERR%
)
echo.
echo Press any key to close this window...
pause >nul
exit /b 0
