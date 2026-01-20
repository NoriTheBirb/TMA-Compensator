@echo off
setlocal
cd /d "%~dp0"
echo Building (ng/)...
npm.cmd --prefix ng run build
