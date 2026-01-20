@echo off
setlocal
cd /d "%~dp0"
echo Running tests (ng/)...
npm.cmd --prefix ng test
