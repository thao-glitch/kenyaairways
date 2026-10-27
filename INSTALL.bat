@echo off
setlocal EnableExtensions
title Kenya Airways. platform - installer
cd /d "%~dp0"

echo ==============================================
echo   Kenya Airways. platform - install / upgrade
echo   (run this again later to upgrade in place)
echo ==============================================

rem --- Node.js (installed silently via winget when missing) ---
where node >nul 2>&1
if not errorlevel 1 goto :node_ok
where winget >nul 2>&1
if errorlevel 1 goto :no_node
echo - Installing Node.js LTS via winget (a few minutes)...
winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo [!] Node.js was installed but is not on PATH yet.
  echo     Close this window, open a NEW one and run INSTALL.bat again.
  pause
  exit /b 1
)
:node_ok
echo - node %node% detected

rem --- pnpm ---
where pnpm >nul 2>&1
if not errorlevel 1 goto :pnpm_ok
echo - Installing pnpm via corepack...
corepack enable >nul 2>&1
corepack prepare pnpm@latest --activate >nul 2>&1
where pnpm >nul 2>&1
if not errorlevel 1 goto :pnpm_ok
echo - Installing pnpm globally with npm...
npm install -g pnpm --silent
where pnpm >nul 2>&1
if errorlevel 1 (
  echo [!] pnpm could not be installed. Close this window, open a NEW one and run INSTALL.bat again.
  pause
  exit /b 1
)
:pnpm_ok

echo - Installing workspace dependencies (pnpm install)...
call pnpm install
if errorlevel 1 (
  echo [!] pnpm install failed - check the messages above.
  pause
  exit /b 1
)

rem --- @kenyaairways/shared: dist/ is git-ignored, so a fresh download ships
rem --- source only. Without this build the apps crash with dozens of TS
rem --- errors on first run - it is mandatory (and a cheap no-op on upgrade).
echo - Building @kenyaairways/shared (required for first run)...
call pnpm --filter @kenyaairways/shared build
if errorlevel 1 (
  echo [!] Could not build @kenyaairways/shared - the apps cannot start without it.
  echo     Check the messages above, then run INSTALL.bat again.
  pause
  exit /b 1
)

echo - Generating secrets into .env (never overwritten)...
call node scripts\bootstrap.mjs
if errorlevel 1 (
  echo [!] Could not create .env.
  pause
  exit /b 1
)

rem --- PostgreSQL + Redis ---
set "DB_READY="
docker >nul 2>&1
if errorlevel 1 goto :no_docker
echo - Starting PostgreSQL + Redis with Docker...
docker compose up -d db redis
if errorlevel 1 goto :no_docker
set "DB_READY=1"
goto :db_done

:no_docker
powershell -Command "if ((Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue)) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo - Existing PostgreSQL found on localhost:5432 - using it.
  set "DB_READY=1"
  goto :db_done
)
where winget >nul 2>&1
if errorlevel 1 goto :no_db
echo - Installing PostgreSQL 17 via winget (a few minutes)...
winget install PostgreSQL.PostgreSQL.17 --silent --accept-source-agreements --accept-package-agreements --override "/SUPERPASSWORD=kenyaairways_dev /ENABLE_PGAUDIT=0"
set "PATH=%ProgramFiles%\PostgreSQL\17\bin;%PATH%"
echo - Waiting for PostgreSQL to accept connections...
set /a _tries=0
:pg_wait
set /a _tries+=1
psql -U postgres -h localhost -c "select 1" >nul 2>&1
if not errorlevel 1 goto :pg_up
if %_tries% GEQ 30 goto :no_db
timeout /t 2 /nobreak >nul
goto :pg_wait
:pg_up
set PGPASSWORD=kenyaairways_dev
psql -U postgres -h localhost -c "CREATE ROLE kenyaairways LOGIN PASSWORD 'kenyaairways_dev' CREATEDB;" >nul 2>&1
psql -U postgres -h localhost -c "CREATE DATABASE kenyaairways OWNER kenyaairways;" >nul 2>&1
set "DB_READY=1"
echo - Installing Memurai (Redis-compatible, for background jobs)...
winget install Memurai.MemuraiDeveloper --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
:db_done

echo - Applying database schema...
call pnpm --filter @kenyaairways/api exec prisma db push --skip-generate
if errorlevel 1 (
  echo [!] Schema push failed - check DATABASE_URL inside .env, fix it, run INSTALL.bat again.
  pause
  exit /b 1
)

echo - Seeding the 114-airport worldwide network (first run can take ~10 minutes)...
call pnpm --filter @kenyaairways/api db:seed
if errorlevel 1 (
  echo [!] Seeding failed - check the messages above, then run INSTALL.bat again.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo   Install complete.
echo.
echo   Start everything:  double-click START.bat
if exist apps\web   echo   User app  -  http://localhost:3000
if exist apps\admin echo   Admin     -  http://localhost:3001   (admin@kenyaairways.example / Password123!)
echo   API       -  http://localhost:4100/api/v1
echo.
echo   Open this folder in your code editor any time;
echo   run INSTALL.bat again after a new download to upgrade in place.
echo ==============================================
pause
exit /b 0

:no_node
echo [!] Node.js is required and winget is not available on this PC.
echo     Install Node 20+ from https://nodejs.org  then double-click INSTALL.bat again.
pause
exit /b 1

:no_db
echo [!] No PostgreSQL could be installed automatically.
echo     Easiest fix: install Docker Desktop (https://www.docker.com/products/docker-desktop/)
echo     then double-click INSTALL.bat again - it will use Docker for the databases.
echo     Alternative: install PostgreSQL 17 manually, create a login "kenyaairways"
echo     with password "kenyaairways_dev" and a database "kenyaairways", then rerun.
pause
exit /b 1
