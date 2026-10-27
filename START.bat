@echo off
setlocal EnableExtensions
title Kenya Airways. platform
cd /d "%~dp0"

if not exist node_modules (
  echo Nothing installed yet - double-click INSTALL.bat first.
  pause
  exit /b 1
)

rem Self-heal: @kenyaairways/shared's dist/ is git-ignored, so a fresh
rem download ships source only. If missing (or stale) the three apps crash
rem on type resolution - build it before starting.
if not exist packages\shared\dist\index.d.ts (
  echo Building @kenyaairways/shared (first run)...
  call pnpm --filter @kenyaairways/shared build >nul 2>&1
  if errorlevel 1 (
    echo [!] Could not build @kenyaairways/shared - double-click INSTALL.bat first.
    pause
    exit /b 1
  )
)

rem Databases: prefer Docker, otherwise assume they are already running.
docker >nul 2>&1
if not errorlevel 1 docker compose up -d db redis >nul 2>&1

rem Bundle-aware front door: releases ship either the traveller bundle
rem (apps\web) or the admin bundle (apps\admin) - open whichever is here
rem (the full repo has both; user app wins).
set "FRONT=3000"
if not exist apps\web if exist apps\admin set "FRONT=3001"

echo Starting the platform: front door :%FRONT%, api :4100
echo Close this window to stop everything.
start "Kenya Airways. platform (close to stop)" cmd /k pnpm dev

echo Waiting for the apps to come up...
set /a _tries=0
:wait
set /a _tries+=1
curl -s -o nul http://localhost:%FRONT% 2>nul
if not errorlevel 1 goto :ready
if %_tries% GEQ 90 goto :slow
timeout /t 2 /nobreak >nul
goto :wait

:ready
start "" http://localhost:%FRONT%
echo Ready - opened in your browser. This window can be closed.
pause
exit /b 0

:slow
echo The apps are still starting - open http://localhost:%FRONT% in a browser in a moment.
pause
exit /b 0
