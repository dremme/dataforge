@echo off
:: Frees the DataForge dev ports when a dev server outlived its console window.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
if errorlevel 1 pause
