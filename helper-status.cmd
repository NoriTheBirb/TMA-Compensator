@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=3177"
set "PID="

for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:%PORT%" ^| findstr "LISTENING"') do (
  set "PID=%%p"
)

if not "!PID!"=="" (
  echo Citrix helper is RUNNING on 127.0.0.1:%PORT% (PID !PID!).
  echo Health: http://127.0.0.1:%PORT%/health
  exit /b 0
)

echo Citrix helper is NOT running on port %PORT%.
exit /b 1
