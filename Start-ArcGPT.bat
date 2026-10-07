@echo off
setlocal enabledelayedexpansion
title ArcGPT Local Startup

rem ============================================================================
rem  ArcGPT local startup.
rem
rem  Paths are derived from this script's own location, so the repository can
rem  be moved or renamed without editing anything here. Keep this file in the
rem  repository root, next to the frontend\ and backend\ folders.
rem
rem  What it does, in order:
rem    [1] PostgreSQL   required. Nothing works without it.
rem    [2] Ollama       required for the default model (Qwen2.5-Coder 7B).
rem    [3] LM Studio    optional. Qwen3-Coder 30B when running, otherwise the
rem                      selector reports it unavailable and Ollama is used.
rem    [4] Backend      the ArcGPT API on port 3000.
rem    [5] Frontend     the Vite dev server on port 5173, proxying /api to 3000.
rem
rem  It never kills processes it did not start, and it never stops the ones it
rem  did: each server keeps its own window so its console log stays readable.
rem ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"

set "PG_PORT=5432"
set "OLLAMA_URL=http://127.0.0.1:11434"
set "LMSTUDIO_URL=http://127.0.0.1:1234/v1"
set "API_PORT=3000"
set "WEB_PORT=5173"

echo.
echo ========================================
echo        ARC GPT LOCAL STARTUP
echo ========================================
echo.
echo Project root: %ROOT%
echo.

rem --- 0. Sanity: the folders this script needs actually exist ----------------
if not exist "%BACKEND%\package.json" (
    echo [FATAL] backend\package.json not found under "%BACKEND%".
    echo         This script must stay in the repository root.
    exit /b 1
)
if not exist "%FRONTEND%\package.json" (
    echo [FATAL] frontend\package.json not found under "%FRONTEND%".
    echo         This script must stay in the repository root.
    exit /b 1
)
if not exist "%BACKEND%\.env" (
    echo [FATAL] backend\.env is missing. Copy backend\.env.example to
    echo         backend\.env and set DB_PASSWORD, SESSION_SECRET and
    echo         LOCAL_ADMIN_PASSWORD before starting ArcGPT.
    exit /b 1
)

echo ========================================
echo STATUS
echo ========================================
echo.

rem --- 1. PostgreSQL ---------------------------------------------------------
echo [1] PostgreSQL
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $svc) { Write-Output '        service    : NOT FOUND'; exit 2 }; Write-Output ('        service    : ' + $svc.Name + ' -> ' + $svc.Status); if ($svc.Status -ne 'Running') { exit 3 }"
if errorlevel 3 (
    echo        action     : start it, then re-run this script.
    echo                    Start-Service postgresql-x64-16
    echo.
    echo [FATAL] PostgreSQL is not running. Database questions cannot work.
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %PG_PORT%); Write-Output ('        port %PG_PORT%  : OPEN'); exit 0 } catch { Write-Output ('        port %PG_PORT%  : CLOSED'); exit 1 } finally { $c.Close() }"
if errorlevel 1 (
    echo        action     : the service is running but nothing is listening.
    echo                    Check postgresql.conf ^(listen_addresses, port^).
    echo.
    echo [FATAL] PostgreSQL is not accepting connections on %PG_PORT%.
    exit /b 1
)
echo.

rem --- 2. Ollama -------------------------------------------------------------
echo [2] Ollama  (default engine, Qwen2.5-Coder 7B)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri '%OLLAMA_URL%/api/tags' -TimeoutSec 5; $names = @($r.models | ForEach-Object { $_.name }); if ($names.Count -eq 0) { Write-Output '        status    : RUNNING, but no model is pulled'; exit 2 }; Write-Output ('        status    : RUNNING'); $names | ForEach-Object { Write-Output ('        model     : ' + $_) }; exit 0 } catch { Write-Output '        status    : NOT RUNNING'; exit 1 }"
if errorlevel 2 (
    echo        action     : ollama pull qwen2.5-coder:7b
    echo.
    echo [FATAL] Ollama is running but has no model, so no question can be
    echo         answered. ArcGPT deliberately generates no fallback SQL.
    exit /b 1
)
if errorlevel 1 (
    echo        action     : ollama serve
    echo.
    echo [FATAL] Ollama is not running. It is the default LLM provider.
    exit /b 1
)
echo.

rem --- 3. LM Studio (optional) ----------------------------------------------
echo [3] LM Studio  (optional, Qwen3-Coder 30B)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri '%LMSTUDIO_URL%/models' -TimeoutSec 5; $ids = @($r.data | ForEach-Object { $_.id }); if ($ids.Count -eq 0) { Write-Output '        status    : RUNNING, but no model is loaded'; exit 2 }; Write-Output '        status    : RUNNING'; $ids | ForEach-Object { Write-Output ('        model     : ' + $_) }; exit 0 } catch { Write-Output '        status    : NOT RUNNING (optional - continuing)'; exit 1 }"
if errorlevel 2 set "LM_NOTE=start the local server and load a model in the Developer tab."
if not errorlevel 2 if errorlevel 1 set "LM_NOTE=the model selector will list LM Studio as unavailable."
if defined LM_NOTE echo        note      : %LM_NOTE%
echo.

rem --- 4. Backend ------------------------------------------------------------
echo [4] Backend  (ArcGPT API)
if not exist "%BACKEND%\node_modules" (
    echo        installing backend dependencies ^(npm ci^)...
    call npm --prefix "%BACKEND%" ci
    if errorlevel 1 (
        echo [FATAL] Backend dependency install failed.
        exit /b 1
    )
)

rem The frontend runs as its own Vite server on %WEB_PORT%, so the backend is
rem started API-only. See frontend\vite.config.ts: the browser only ever talks
rem to one origin, which is what keeps the sameSite:strict session cookie
rem first-party.
set "SERVE_FRONTEND=false"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %API_PORT%); Write-Output '        port %API_PORT%  : already in use'; exit 0 } catch { exit 1 } finally { $c.Close() }"
if errorlevel 1 (
    echo        port %API_PORT%  : free - starting
    start "ArcGPT Backend" cmd /k "cd /d ""%BACKEND%"" && set SERVE_FRONTEND=false && npm run dev"
) else (
    echo        port %API_PORT%  : IN USE - not starting a second backend.
    echo                      Close the existing one first if you meant to restart it.
)
echo.

rem --- 5. Frontend -----------------------------------------------------------
echo [5] Frontend  (Vite dev server)
if not exist "%FRONTEND%\node_modules" (
    echo        installing frontend dependencies ^(npm ci^)...
    call npm --prefix "%FRONTEND%" ci
    if errorlevel 1 (
        echo [FATAL] Frontend dependency install failed.
        exit /b 1
    )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %WEB_PORT%); Write-Output '        port %WEB_PORT%  : already in use'; exit 0 } catch { exit 1 } finally { $c.Close() }"
if errorlevel 1 (
    echo        port %WEB_PORT%  : free - starting
    start "ArcGPT Frontend" cmd /k "cd /d ""%FRONTEND%"" && npm run dev"
) else (
    echo        port %WEB_PORT%  : IN USE - not starting a second frontend.
    echo                      Close the existing one first if you meant to restart it.
)
echo.

rem --- Give the backend a moment, then report whether it actually came up -----
echo Waiting for the backend to answer /api/health...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok = $false; for ($i = 0; $i -lt 30; $i++) { try { $h = Invoke-RestMethod -Uri 'http://127.0.0.1:%API_PORT%/api/health' -TimeoutSec 3; Write-Output ('        postgres  : ' + $h.postgres); Write-Output ('        ollama    : ' + $h.ollama + '  ' + $h.ollama_model); if ($h.models) { @($h.models) | ForEach-Object { Write-Output ('        model     : ' + $_.name + ' [' + $_.provider + '] ' + $(if ($_.available) {'available'} else {'unavailable'})) } }; $ok = $true; break } catch { Start-Sleep -Seconds 1 } }; if (-not $ok) { Write-Output '        health    : no response from http://127.0.0.1:%API_PORT%/api/health'; exit 1 }"
if errorlevel 1 (
    echo.
    echo [WARN] The backend did not answer. Read the "ArcGPT Backend" window
    echo        for the real error; ArcGPT will not load without it.
) else (
    echo.
    echo ========================================
    echo          ARCGPT IS READY
    echo ========================================
    echo.
    echo UI      : http://localhost:%WEB_PORT%
    echo API     : http://localhost:%API_PORT%
    echo Database: arcgpt_new
    echo Models  : Ollama and LM Studio, switchable in the chat's model selector.
    echo.
    echo Each server stays open in its own window. Close those windows to stop.
    echo.
)
exit /b 0