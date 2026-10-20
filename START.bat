@echo off
setlocal EnableExtensions
title Kenya Airways platform
cd /d "%~dp0"

if not exist node_modules (
  echo Nothing installed yet - double-click INSTALL.bat first.
  pause
  exit /b 1
)

rem Databases: prefer Docker, otherwise assume they are already running.
docker >nul 2>&1
if not errorlevel 1 docker compose up -d db redis >nul 2>&1

echo Starting the platform: user :3000, admin :3001, api :4100
echo Close this window to stop everything.
start "Kenya Airways platform (close to stop)" cmd /k pnpm dev

echo Waiting for the apps to come up...
set /a _tries=0
:wait
set /a _tries+=1
curl -s -o nul http://localhost:3000 2>nul
if not errorlevel 1 goto :ready
if %_tries% GEQ 90 goto :slow
timeout /t 2 /nobreak >nul
goto :wait

:ready
start "" http://localhost:3000
echo Ready - opened in your browser. This window can be closed.
pause
exit /b 0

:slow
echo The apps are still starting - open http://localhost:3000 in a browser in a moment.
pause
exit /b 0
