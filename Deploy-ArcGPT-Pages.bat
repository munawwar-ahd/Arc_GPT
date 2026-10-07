@echo off
setlocal enabledelayedexpansion
title ArcGPT Deploy to GitHub Pages

rem ============================================================================
rem  Publishes the frontend to https://munawwar-ahd.github.io/Arc_GPT/.
rem
rem  This is separate from Start-ArcGPT.bat on purpose. Local startup is needed
rem  every time; deploying is not, and a build that overwrote .env.production on
rem  every launch is how a working site turned into a white page once already.
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
set "CLOUDFLARED=%ProgramFiles%\cloudflared\cloudflared.exe"
set "TUNNEL_LOG=%TEMP%\arcgpt-tunnel.log"
set "API_PORT=3000"
set "PAGES_URL=https://munawwar-ahd.github.io/Arc_GPT/"

if not exist "%FRONTEND%\package.json" (
    echo [FATAL] frontend\package.json not found under "%FRONTEND%".
    echo         This script must stay in the repository root.
    exit /b 1
)

echo.
echo ========================================
echo     ARC GPT - DEPLOY GITHUB PAGES
echo ========================================
echo.

rem --- cloudflared -----------------------------------------------------------
if not exist "%CLOUDFLARED%" (
    echo [FATAL] cloudflared was not found at:
    echo         %CLOUDFLARED%
    echo.
    echo         Install it, or edit CLOUDFLARED near the top of this script to
    echo         point at the copy you already have.
    exit /b 1
)

rem --- backend ---------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %API_PORT%); Write-Output '        backend    : already running on %API_PORT%'; exit 0 } catch { exit 1 } finally { $c.Close() }"
if errorlevel 1 (
    echo [FATAL] Nothing is listening on port %API_PORT%.
    echo         Start ArcGPT with Start-ArcGPT.bat first.
    exit /b 1
)
echo.

rem --- tunnel ----------------------------------------------------------------
echo Starting Cloudflare quick tunnel to http://localhost:%API_PORT% ...
if exist "%TUNNEL_LOG%" del "%TUNNEL_LOG%"
start "ArcGPT Tunnel" cmd /k ""%CLOUDFLARED%" tunnel --url http://localhost:%API_PORT% --logfile "%TUNNEL_LOG%""

echo Waiting for the tunnel to publish a URL ...
set "TUNNEL_URL="
for /l %%I in (1,1,20) do (
    if not defined TUNNEL_URL (
        timeout /t 2 /nobreak >nul
        for /f "delims=" %%A in ('powershell -NoProfile -Command "$m = [regex]::Match((Get-Content -Raw -LiteralPath '%TUNNEL_LOG%' -ErrorAction SilentlyContinue), 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $m.Value }"') do set "TUNNEL_URL=%%A"
    )
)

if not defined TUNNEL_URL (
    echo.
    echo [FATAL] No tunnel URL appeared in %TUNNEL_LOG% within 40 seconds.
    echo         Read the "ArcGPT Tunnel" window for the real error.
    exit /b 1
)

echo         tunnel URL : %TUNNEL_URL%
echo.

rem --- .env.production -------------------------------------------------------
rem VITE_BACKEND_URL is inlined into the public bundle at build time. It holds a
rem tunnel address and nothing else. No database credential, session secret or
rem model setting ever goes in here.
echo Writing the tunnel URL into frontend\.env.production ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = '%FRONTEND%\.env.production'; $u = '%TUNNEL_URL%'; if (Test-Path -LiteralPath $p) { Set-Content -LiteralPath $p -Value (Get-Content -LiteralPath $p) -Encoding utf8 }; $all = @(); if (Test-Path -LiteralPath $p) { $all = @(Get-Content -LiteralPath $p) }; $kept = @($all | Where-Object { $_ -notmatch '^VITE_BACKEND_URL=' }); @($kept + ('VITE_BACKEND_URL=' + $u)) | Set-Content -LiteralPath $p -Encoding utf8"
if errorlevel 1 (
    echo [FATAL] Could not update frontend\.env.production.
    exit /b 1
)
echo.

rem --- build and publish -----------------------------------------------------
rem build:pages is the script that matters here. It pins Vite's base to
rem /Arc_GPT/ so the emitted asset URLs are /Arc_GPT/assets/... The site is
rem served from that sub-path, and a bundle built with the default base of '/'
rem asks for /assets/... at the domain root, which 404s: the HTML loads, the
rem JavaScript does not, and the page is blank.
echo Building for GitHub Pages ^(base /Arc_GPT/^)...
call npm --prefix "%FRONTEND%" run build:pages
if errorlevel 1 (
    echo.
    echo [FATAL] Production build failed. Nothing was published.
    exit /b 1
)
echo.

echo Publishing dist\ to the gh-pages branch ...
call npm --prefix "%FRONTEND%" exec -- gh-pages -d dist
if errorlevel 1 (
    echo.
    echo [FATAL] gh-pages could not publish. The site is unchanged.
    exit /b 1
)

echo.
echo ========================================
echo           DEPLOY COMPLETE
echo ========================================
echo.
echo Site    : %PAGES_URL%
echo API     : %TUNNEL_URL%  ^(temporary^)%
echo Database: arcgpt_new ^(local, not exposed^)
echo.
echo The tunnel URL above stops working when the "ArcGPT Tunnel" window is
echo closed. Re-run this script to publish a fresh one.
echo.
exit /b 0