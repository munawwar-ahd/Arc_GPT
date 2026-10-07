@echo off
setlocal enabledelayedexpansion
title ArcGPT Deploy to GitHub Pages

rem ============================================================================
rem  Publishes the frontend to https://munawwar-ahd.github.io/Arc_GPT/.
rem
rem  This is separate from Start-ArcGPT.bat on purpose. Local startup is needed
rem  every time; deploying is not, and a build that rewrote the bundle's backend
rem  URL on every launch is how a working site became a blank page once already.
rem
rem  Why a tunnel is involved: ArcGPT-Backend, PostgreSQL, Ollama and LM Studio
rem  are all local and stay local. The public site is only the static frontend
rem  bundle on GitHub Pages. To let that bundle reach the API, this script opens
rem  a Cloudflare quick tunnel to port 3000 and bakes the resulting temporary
rem  URL into the bundle as VITE_BACKEND_URL.
rem
rem  That URL is ephemeral. It changes every run and dies when this script's
rem  tunnel stops. Run this script again to republish with a fresh one. Nothing
rem  else is exposed: PostgreSQL (5432), Ollama (11434) and LM Studio (1234) are
rem  never tunneled, and no credential is ever written into the bundle.
rem ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "API_PORT=3000"
set "PAGES_URL=https://munawwar-ahd.github.io/Arc_GPT/"

rem A fresh log per run. cloudflared holds its log file open for the life of the
rem tunnel, so reusing one path would append this run's output onto a previous
rem run's and the URL scan would find the older, dead tunnel first.
set "TUNNEL_LOG=%TEMP%\arcgpt-tunnel-%RANDOM%%RANDOM%.log"

if not exist "%FRONTEND%\package.json" goto nofrontend

echo.
echo ========================================
echo     ARC GPT - DEPLOY GITHUB PAGES
echo ========================================
echo.

rem --- cloudflared -----------------------------------------------------------
set "CLOUDFLARED="
for %%P in (
    "%ProgramFiles%\cloudflared\cloudflared.exe"
    "%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
    "%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe"
    "%USERPROFILE%\Downloads\cloudflared-windows-amd64.exe"
    "%USERPROFILE%\Downloads\cloudflared.exe"
) do if not defined CLOUDFLARED if exist %%P set "CLOUDFLARED=%%~P"

if not defined CLOUDFLARED goto nocf
echo         cloudflared : %CLOUDFLARED%

rem --- backend ---------------------------------------------------------------
rem The bundle's API address is baked in at build time, so the backend has to be
rem up before the build, not after it.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %API_PORT%); Write-Output '        backend    : already running on %API_PORT%'; exit 0 } catch { exit 1 } finally { $c.Close() }"
if errorlevel 1 (
    echo.
    echo [FATAL] Nothing is listening on port %API_PORT%.
    echo         Start ArcGPT with Start-ArcGPT.bat first.
    exit /b 1
)
echo.

rem --- tunnel ----------------------------------------------------------------
echo Starting Cloudflare quick tunnel to http://localhost:%API_PORT% ...
rem The tunnel runs in its own cmd /k window, which gives cloudflared the console
rem it requires. Redirecting stdin here instead makes it print "Input
rem redirection is not supported" into this launcher.
start "ArcGPT Tunnel" cmd /k ""%CLOUDFLARED%" tunnel --url http://localhost:%API_PORT% --logfile "%TUNNEL_LOG%""

echo Waiting for the tunnel to publish a URL ...
set "TUNNEL_URL="
for /l %%I in (1,1,20) do call :pollurl
if not defined TUNNEL_URL goto notunnel
goto tunnelok

rem --- .env.production -------------------------------------------------------
rem VITE_BACKEND_URL is inlined into the public bundle at build time. It holds a
rem tunnel address and nothing else: no database credential, no session secret,
rem no model setting ever goes in here.
:tunnelok
echo         tunnel URL : %TUNNEL_URL%
echo.
echo Writing the tunnel URL into frontend\.env.production ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Join-Path '%FRONTEND%' '.env.production'; $u = '%TUNNEL_URL%'; $kept = @(); if (Test-Path -LiteralPath $p) { $kept = @(Get-Content -LiteralPath $p | Where-Object { $_ -notmatch '^\s*VITE_BACKEND_URL=' }) }; @($kept + ('VITE_BACKEND_URL=' + $u)) | Set-Content -LiteralPath $p -Encoding utf8"
if errorlevel 1 goto enverror
echo.

rem --- build and publish -----------------------------------------------------
rem build:pages is the step that matters. It pins Vite's base to /Arc_GPT/ so the
rem emitted asset URLs are /Arc_GPT/assets/... The site is served from that
rem sub-path, and a bundle built with the default base of '/' asks for
rem /assets/... at the domain root, which 404s: the HTML loads, the JavaScript
rem does not, and the page renders blank.
echo Building ^(base /Arc_GPT/^)...
call npm --prefix "%FRONTEND%" run build:pages
if errorlevel 1 goto builderror
echo.

echo Publishing dist\ to the gh-pages branch ...
call npm --prefix "%FRONTEND%" run publish:pages
if errorlevel 1 goto publisherror

echo.
echo ========================================
echo           DEPLOY COMPLETE
echo ========================================
echo.
echo Site    : %PAGES_URL%
echo API     : %TUNNEL_URL%  ^(temporary^)%
echo Database: arcgpt_new ^(local, never exposed^)
echo.
echo The tunnel URL above stops working when the "ArcGPT Tunnel" window is
echo closed. Re-run this script to publish a fresh one.
echo.
exit /b 0

rem --- tunnel poll -----------------------------------------------------------
:pollurl
if defined TUNNEL_URL exit /b 0
if not exist "%TUNNEL_LOG%" (
    timeout /t 2 /nobreak >nul
    exit /b 0
)
for /f "delims=" %%A in ('powershell -NoProfile -Command "$t = Get-Content -Raw -LiteralPath '%TUNNEL_LOG%' -ErrorAction SilentlyContinue; if ($t) { $m = [regex]::Match($t, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $m.Value } }"') do set "TUNNEL_URL=%%A"
if not defined TUNNEL_URL timeout /t 2 /nobreak >nul
exit /b 0

rem --- failures --------------------------------------------------------------
:notunnel
echo.
echo [FATAL] No tunnel URL appeared in:
echo         %TUNNEL_LOG%
echo         Read the "ArcGPT Tunnel" window for the real error.
exit /b 1

:nofrontend
echo [FATAL] frontend\package.json not found under "%FRONTEND%".
echo         This script must stay in the repository root.
exit /b 1

:nocf
echo [FATAL] cloudflared.exe was not found. Looked in:
echo         %%ProgramFiles%%\cloudflared\
echo         %%ProgramFiles(x86)%%\cloudflared\
echo         %%LOCALAPPDATA%%\Microsoft\WinGet\Links\
echo         %%USERPROFILE%%\Downloads\
echo.
echo         Install it, or set CLOUDFLARED near the top of this script.
exit /b 1

:enverror
echo.
echo [FATAL] Could not update frontend\.env.production. Nothing was published.
exit /b 1

:builderror
echo.
echo [FATAL] Production build failed. Nothing was published.
exit /b 1

:publisherror
echo.
echo [FATAL] gh-pages could not publish. The live site is unchanged.
exit /b 1