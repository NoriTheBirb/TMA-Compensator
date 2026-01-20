@echo off
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=4300"

echo Starting dev server on http://127.0.0.1:%PORT%/ ...
echo (Uses npm.cmd to bypass PowerShell execution policy restrictions.)

npm.cmd --prefix ng start -- --host 127.0.0.1 --port %PORT% --no-open

