@echo off
setlocal
cd /d "%~dp0"
echo Installing dependencies (ng/)...
npm.cmd --prefix ng install
if errorlevel 1 (
  echo.
  echo Install failed.
  exit /b 1
)
echo.
echo Done.
