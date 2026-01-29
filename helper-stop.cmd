@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=3177"
set "PID="

for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:%PORT%" ^| findstr "LISTENING"') do (
  set "PID=%%p"
)

if "!PID!"=="" (
  echo Citrix helper is not running on port %PORT%.
  exit /b 0
)

echo Stopping Citrix helper (PID !PID!)...
taskkill /PID !PID! /F >nul 2>nul

echo Done.
