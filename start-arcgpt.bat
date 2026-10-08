@echo off
setlocal enabledelayedexpansion
title ArcGPT Local

rem ============================================================================
rem  ArcGPT local launcher.
rem
rem  Keep this file in the repository root, next to frontend\ and backend\.
rem  Every path is derived from %~dp0, so the folder can be moved or renamed
rem  without editing anything here. An absolute path is only ever used for the
rem  services this script does not own.
rem
rem  What it starts, in order:
rem    PostgreSQL   required. Checked, never started, never modified.
rem    Ollama       qwen2.5-coder:7b. Checked, never started.
rem    LM Studio    qwen3-coder-30b-a3b-instruct. OPTIONAL. Absent is fine and
rem                   ArcGPT answers with Ollama instead.
rem    Backend      ArcGPT-Backend on http://localhost:3000. Serves the
rem                   frontend itself through Vite middleware, so this is the
rem                   whole application. No second web server is started.
rem    Cloudflare   Quick Tunnel to port 3000, for demo sharing only.
rem
rem Shared tunnel
rem --------------
rem There is exactly ONE authoritative ArcGPT Quick Tunnel per running session,
rem and this launcher owns it. The tunnel URL is ephemeral, so it is always
rem discovered, never hard-coded: a healthy one is reused, and exactly one is
rem opened when none exists.
rem
rem The resolved URL is recorded in %TEMP%\arcgpt-tunnel-state.txt, and
rem Deploy-ArcGPT-Pages.bat reads it from there. That file is the whole point:
rem the hosted GitHub Pages bundle must name the tunnel that is actually
rem running, not a second one the deploy script happened to open. Both scripts
rem go through ArcGPT-Tunnel.ps1 so neither can drift.
rem
rem The state file is temporary and is never committed. It holds a hostname
rem and two pids, and no credential.
rem
rem It changes no database, no environment file and no application source. It
rem installs nothing and downloads no model. It never kills a process it did
rem not start.
rem ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"

set "API_URL=http://localhost:3000"
set "API_PORT=3000"
set "PG_PORT=5432"
set "OLLAMA_TAGS=http://127.0.0.1:11434/api/tags"
set "LMSTUDIO_MODELS=http://127.0.0.1:1234/v1/models"
set "EXPECTED_DB=arcgpt_new"

set "PG_STATE=UNKNOWN"
set "OLLAMA_STATE=UNAVAILABLE"
set "OLLAMA_NAME=qwen2.5-coder:7b"
set "LM_STATE=UNAVAILABLE"
set "TUNNEL_URL="
set "TUNNEL_MODE=NONE"

rem PIDs of the windows THIS launcher opened. Only these may ever be stopped:
rem a backend or tunnel that was already running belongs to an earlier session
rem and is none of this launcher's business.
set "STARTED_BACKEND_PID="
set "STARTED_TUNNEL_PID="
set "BACKEND_REUSED=0"

rem A fresh log per run. cloudflared holds its log file open for the life of the
rem tunnel, so a reused path would append this run onto the previous run's and
rem the URL scan would find the older, dead tunnel first.
set "TUNNEL_LOG=%TEMP%\arcgpt-tunnel-%RANDOM%%RANDOM%.log"

title ArcGPT Local

echo.
echo ========================================
echo            ARC GPT LOCAL
echo ========================================
echo.
echo Project: %ROOT%
echo.

if not exist "%BACKEND%\package.json" goto nobackend
if not exist "%BACKEND%\.env" goto noenv

rem ============================================================================
echo [1/6] PostgreSQL
rem ============================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %PG_PORT%); exit 0 } catch { exit 1 } finally { $c.Close() }"
if errorlevel 1 goto pgdown

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Running' } | Select-Object -First 1; if ($s) { Write-Output $s.Name } else { Write-Output 'service not reporting Running (port is open)' }" > "%TEMP%\arcgpt-pg-svc.txt"
set /p PG_SVC=<"%TEMP%\arcgpt-pg-svc.txt"
del /q "%TEMP%\arcgpt-pg-svc.txt" 2>nul
echo   Status  : AVAILABLE on port %PG_PORT%
echo   Service : %PG_SVC%
set "PG_STATE=AVAILABLE"
echo.

rem ============================================================================
echo [2/6] Ollama
rem ============================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%OLLAMA_TAGS%' -TimeoutSec 6; $n = @($r.models | ForEach-Object { $_.name }); if ($n.Count -eq 0) { exit 2 }; $m = $n | Where-Object { $_ -like 'qwen2.5-coder*' } | Select-Object -First 1; if ($m) { Write-Output $m } else { $n[0] }; exit 0 } catch { exit 1 }" > "%TEMP%\arcgpt-ollama.txt"
set "OLLAMA_EXIT=%ERRORLEVEL%"
set /p OLLAMA_FOUND=<"%TEMP%\arcgpt-ollama.txt"
del /q "%TEMP%\arcgpt-ollama.txt" 2>nul

if "%OLLAMA_EXIT%"=="1" goto ollamadown
if "%OLLAMA_EXIT%"=="2" goto ollanonomodels

set "OLLAMA_STATE=AVAILABLE"
set "OLLAMA_NAME=%OLLAMA_FOUND%"
echo   Status  : AVAILABLE
echo   Model   : %OLLAMA_NAME%
goto ollamadone

:ollamanomodels
echo [WARNING] Ollama is running but has no model pulled.
echo           ArcGPT cannot answer anything until one exists.
echo           Pull it with:  ollama pull qwen2.5-coder:7b
set "OLLAMA_STATE=NO MODEL"
goto ollamadone

:ollamadown
echo [WARNING] Ollama is unavailable.
echo           Start it with:  ollama serve
set "OLLAMA_STATE=UNAVAILABLE"

:ollamadone
echo.

rem ============================================================================
echo [3/6] LM Studio  (optional)
rem ============================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%LMSTUDIO_MODELS%' -TimeoutSec 6; $n = @($r.data | ForEach-Object { $_.id }); if ($n.Count -eq 0) { Write-Output 'NOMODELS'; exit 0 }; $q = $n | Where-Object { $_ -like 'qwen3*' } | Select-Object -First 1; if ($q) { Write-Output ('QWEN3|' + $q) } else { Write-Output ('NOQWEN3|' + ($n -join ', ')) }; exit 0 } catch { Write-Output 'DOWN'; exit 1 }" > "%TEMP%\arcgpt-lm.txt"
set /p LM_RAW=<"%TEMP%\arcgpt-lm.txt"
del /q "%TEMP%\arcgpt-lm.txt" 2>nul

if "%LM_RAW%"=="DOWN" goto lmdown
if "%LM_RAW%"=="NOMODELS" goto lmnomodels
if not "%LM_RAW:~0,7%"=="QWEN3|" goto lmnoqwen

rem Qwen3 is loaded, so ArcGPT can use it. Everything after "QWEN3|" is its id.
set "LM_STATE=%LM_RAW:~7%"
echo   Status  : AVAILABLE
echo   Model   : %LM_STATE%
goto lmdone

:lmnoqwen
echo [WARNING] LM Studio unavailable - Qwen3 will not be available.
echo           Its server is up, but Qwen3-Coder 30B is not the model loaded.
echo           Loaded instead: %LM_RAW:~8%
set "LM_STATE=UNAVAILABLE"
goto lmdone

:lmnomodels
echo [WARNING] LM Studio unavailable - Qwen3 will not be available.
echo           The server is up but has no model loaded.
set "LM_STATE=UNAVAILABLE"
goto lmdone

:lmdown
echo [WARNING] LM Studio unavailable - Qwen3 will not be available.
echo           Start its local server on 127.0.0.1:1234 to enable it.
echo           ArcGPT continues on Ollama.
set "LM_STATE=UNAVAILABLE"

:lmdone
echo.

rem ============================================================================
echo [4/6] Backend
rem ============================================================================
rem The port is checked first so an already-running ArcGPT is never duplicated.
rem Readiness is decided by GET /api/health below, not by the port: the port
rem opens while PostgreSQL is still connecting and the model providers are
rem still being probed.
rem
rem An open port on its own says nothing. Something else could hold 3000, and
rem so could a perfectly healthy ArcGPT started minutes ago. So the port is
rem asked who is there, and /api/health is asked whether that someone is us.
rem
rem Each answer is read straight into one variable with `set /p`. There is
rem deliberately no `for /f` here: a parenthesised for loop left cmd unable to
rem find the labels that follow it, so every goto after it failed with
rem "cannot find the batch label". Two small probes cost one extra PowerShell
rem start and remove that whole class of failure.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = New-Object Net.Sockets.TcpClient; $open = $false; try { $c.Connect('127.0.0.1', %API_PORT%); $open = $true } catch { } finally { $c.Close() }; if (-not $open) { Write-Output 'FREE'; exit 0 }; try { $h = Invoke-RestMethod -Uri '%API_URL%/api/health' -TimeoutSec 8; if ($h.server -eq 'ok') { Write-Output 'ARCGPT'; exit 0 } } catch { }; Write-Output 'FOREIGN'" > "%TEMP%\arcgpt-verdict.txt"
set "PORT_VERDICT=UNKNOWN"
set /p PORT_VERDICT=<"%TEMP%\arcgpt-verdict.txt"
del /q "%TEMP%\arcgpt-verdict.txt" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-NetTCPConnection -State Listen -LocalPort %API_PORT% -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" > "%TEMP%\arcgpt-ownerpid.txt"
set "PORT_PID="
set /p PORT_PID=<"%TEMP%\arcgpt-ownerpid.txt"
del /q "%TEMP%\arcgpt-ownerpid.txt" 2>nul

if "%PORT_VERDICT%"=="FREE" goto startbackend
if "%PORT_VERDICT%"=="ARCGPT" goto reusebackend
if "%PORT_VERDICT%"=="FOREIGN" goto foreignport
goto portunknown

rem --- the probe itself did not produce a verdict: say so, guess nothing -------
:portunknown
echo.
echo [ERROR] Could not determine what is using port %API_PORT%.
echo         The port probe returned: "%PORT_VERDICT%"
echo.
echo         This launcher will not guess. Check the port yourself with:
echo             netstat -ano ^| findstr :%API_PORT%
echo.
pause
exit /b 1

rem --- an ArcGPT backend is already up: reuse it, do not start a second one ---

:reusebackend
echo   An ArcGPT backend is ALREADY RUNNING on port %API_PORT%.
echo   Reusing it. No second backend was started.
if defined PORT_PID echo   Backend pid : %PORT_PID%
echo.
echo   Its console window is still open and still showing the backend log.
echo   No new window was created, so use Alt+Tab or the taskbar to find it -
echo   it is most likely behind this one.
set "BACKEND_REUSED=1"
goto backenddecided

rem --- something that is not ArcGPT owns the port: refuse, do not fight it ----
:foreignport
echo.
echo [ERROR] Port %API_PORT% is owned by another program, not ArcGPT.
echo         Owning process id : %PORT_PID%
echo         Find it with:  netstat -ano ^| findstr :%API_PORT%
echo.
echo         ArcGPT was not started, because it could not bind the port.
echo         Close that program, then run this launcher again.
echo.
pause
exit /b 1

rem --- port is free: start the backend and remember what we opened ------------
:startbackend
echo   Port %API_PORT% is free. Starting ArcGPT-Backend...
echo   Command : npm run dev     ^(tsx server.ts, in %BACKEND%^)
rem Start-Process is used instead of `start` so the window's pid comes back.
rem It becomes the handle used to stop exactly this backend later. The title is
rem set from inside so the window can be recognised on screen, and the working
rem directory is a property of the process, so no path quoting is needed.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/k title ArcGPT Backend && npm run dev' -WorkingDirectory '%BACKEND%' -PassThru; Write-Output $p.Id" > "%TEMP%\arcgpt-backendpid.txt"
set "STARTED_BACKEND_PID="
set /p STARTED_BACKEND_PID=<"%TEMP%\arcgpt-backendpid.txt"
del /q "%TEMP%\arcgpt-backendpid.txt" 2>nul
if not defined STARTED_BACKEND_PID (
    echo   Could not start the backend. Read the error above.
    echo.
    pause
    exit /b 1
)
echo   Backend window pid : %STARTED_BACKEND_PID%
set "BACKEND_REUSED=0"

:backenddecided
echo.

rem ============================================================================
echo [5/6] Waiting for the backend to become ready
rem ============================================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(120); while ((Get-Date) -lt $deadline) { try { $h = Invoke-RestMethod -Uri '%API_URL%/api/health' -TimeoutSec 5; if ($h.server -eq 'ok') { Write-Output ('READY|' + $h.database); exit 0 } } catch { }; Start-Sleep -Seconds 2 }; exit 1" > "%TEMP%\arcgpt-health.txt"
set "HEALTH_EXIT=%ERRORLEVEL%"
set /p HEALTH_RAW=<"%TEMP%\arcgpt-health.txt"
del /q "%TEMP%\arcgpt-health.txt" 2>nul

if not "%HEALTH_EXIT%"=="0" goto backendfail

set "DB_NAME=%HEALTH_RAW:~6%"
echo   %API_URL%/api/health  ->  server=ok
if /i not "%DB_NAME%"=="%EXPECTED_DB%" (
    echo.
    echo [ERROR] The backend is connected to database "%DB_NAME%".
    echo         ArcGPT must use "%EXPECTED_DB%". Check DB_NAME in backend\.env.
    echo.
    pause
    exit /b 1
)
echo   Database           : %DB_NAME%
echo.

rem ============================================================================
echo [6/6] Cloudflare Quick Tunnel
rem ============================================================================
rem This is the ONE authoritative ArcGPT tunnel for the session. Both this
rem launcher and Deploy-ArcGPT-Pages.bat resolve it through ArcGPT-Tunnel.ps1,
rem so the hosted GitHub Pages bundle can never end up pointing at a different
rem tunnel than the one actually running.
rem
rem A tunnel is reused whenever a healthy one is found, and exactly one is
rem opened when none exists. See "Shared tunnel" in the header above.
set "TUNNEL_HELPER=%ROOT%\ArcGPT-Tunnel.ps1"
set "RESOLVE_REPORT=%TEMP%\arcgpt-tunnel-resolve.txt"

set "CLOUDFLARED="
for %%P in (
    "%ProgramFiles%\cloudflared\cloudflared.exe"
    "%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
    "%LOCALAPPDATA%\Microsoft\WinGet\Links\cloudflared.exe"
    "%USERPROFILE%\Downloads\cloudflared-windows-amd64.exe"
    "%USERPROFILE%\Downloads\cloudflared.exe"
) do if not defined CLOUDFLARED if exist %%P set "CLOUDFLARED=%%~P"

if not defined CLOUDFLARED goto nocf

if not exist "%TUNNEL_HELPER%" (
    echo.
    echo [ERROR] %TUNNEL_HELPER% was not found.
    echo         This file resolves the shared ArcGPT tunnel. Keep it next to
    echo         this launcher.
    echo.
    pause
    exit /b 1
)

rem Reuse a tunnel that is already alive rather than opening a second one.
rem ArcGPT-Tunnel.ps1 asks the state file and then every tunnel log, newest
rem first, and returns the first URL whose /api/health answers server=ok,
rem database=arcgpt_new and ollama=ok. It prints the bare URL, or an empty
rem line, so it is read with a plain `set /p` and no for /f.
powershell -NoProfile -ExecutionPolicy Bypass -File "%TUNNEL_HELPER%" -Action Resolve -ExpectedDb "%EXPECTED_DB%" -Report "%RESOLVE_REPORT%" > "%TEMP%\arcgpt-tunnel-find.txt"
set "FOUND_URL="
set /p FOUND_URL=<"%TEMP%\arcgpt-tunnel-find.txt"
del /q "%TEMP%\arcgpt-tunnel-find.txt" 2>nul

call :showresolve
if not "%FOUND_URL%"=="" goto tunnelreuse

echo   cloudflared : %CLOUDFLARED%
echo   Command     : cloudflared tunnel --url %API_URL%
rem The tunnel runs in its own cmd /k window. That window gives cloudflared a
rem real console, which it requires: with stdin redirected it prints "Input
rem redirection is not supported" and writes the error into this launcher.
rem Start-Process is used so the window's pid comes back and this launcher can
rem later stop exactly the tunnel it opened, and nothing else. The quotes
rem around the two paths are built from [char]34 so that no literal double
rem quote has to survive cmd's own parsing of this line.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q = [char]34; $arg = '/k title ArcGPT Tunnel && ' + $q + '%CLOUDFLARED%' + $q + ' tunnel --url %API_URL% --logfile ' + $q + '%TUNNEL_LOG%' + $q; $p = Start-Process -FilePath 'cmd.exe' -ArgumentList $arg -WorkingDirectory '%FRONTEND%' -PassThru; Write-Output $p.Id" > "%TEMP%\arcgpt-tunnelpid.txt"
set "STARTED_TUNNEL_PID="
set /p STARTED_TUNNEL_PID=<"%TEMP%\arcgpt-tunnelpid.txt"
del /q "%TEMP%\arcgpt-tunnelpid.txt" 2>nul
if not defined STARTED_TUNNEL_PID (
    echo   Could not start cloudflared. Nothing was published.
    echo.
    pause
    exit /b 1
)
echo   Tunnel window pid  : %STARTED_TUNNEL_PID%

echo   Waiting for the public URL ...
for /l %%I in (1,1,30) do call :pollurl
if not defined TUNNEL_URL goto tunnelfail
set "TUNNEL_MODE=NEW"
goto tunneldone

:tunnelreuse
set "TUNNEL_URL=%FOUND_URL%"
set "TUNNEL_MODE=EXISTING"
echo   A healthy ArcGPT tunnel is already running. Reusing it.
echo   No second tunnel was opened.
goto tunneldone

:tunneldone
rem ---------------------------------------------------------------------------
rem Record the session's tunnel where the deploy script can find it. The file
rem lives in %TEMP% and is never committed: it holds a hostname and two pids,
rem no credential of any kind.
rem
rem OWNED is informational. Shutdown safety does NOT read it: only
rem STARTED_TUNNEL_PID, which is set above and only when THIS launcher opened
rem the tunnel, decides what may be stopped. A tunnel found by the resolve step
rem therefore stays recorded as OWNED=0 and is left alone at shutdown.
rem ---------------------------------------------------------------------------
set "TUNNEL_OWNED=0"
set "RECORDED_TUNNEL_PID="
if "%TUNNEL_MODE%"=="NEW" (
    set "TUNNEL_OWNED=1"
    set "RECORDED_TUNNEL_PID=%STARTED_TUNNEL_PID%"
)

rem PORT_PID is only set when the port was already owned when this launcher
rem started. When this launcher opened the backend, STARTED_BACKEND_PID is the
rem real one, so record whichever applies.
set "RECORDED_BACKEND_PID=%PORT_PID%"
if not defined RECORDED_BACKEND_PID set "RECORDED_BACKEND_PID=%STARTED_BACKEND_PID%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%TUNNEL_HELPER%" -Action Record -Url "%TUNNEL_URL%" -TunnelPid "%RECORDED_TUNNEL_PID%" -BackendPid "%RECORDED_BACKEND_PID%" -Owned "%TUNNEL_OWNED%" -Log "%TUNNEL_LOG%" > "%TEMP%\arcgpt-tunnel-record.txt" 2>nul
del /q "%TEMP%\arcgpt-tunnel-record.txt" 2>nul
echo   Recorded in : %TEMP%\arcgpt-tunnel-state.txt
echo   Deploy-ArcGPT-Pages.bat will reuse this same tunnel.
echo.
echo ========================================
echo            ARC GPT READY
echo ========================================
echo.
echo Database:
echo     %DB_NAME%
echo.
echo Backend:
echo     %API_URL%
echo     RUNNING
echo.
echo Ollama:
echo     %OLLAMA_NAME%
echo     %OLLAMA_STATE%
echo.
echo LM Studio:
if "%LM_STATE%"=="UNAVAILABLE" (
    echo     qwen3-coder-30b-a3b-instruct
    echo     UNAVAILABLE
) else (
    echo     %LM_STATE%
    echo     AVAILABLE
)
echo.
echo Public Tunnel:
echo     %TUNNEL_URL%
echo     mode : %TUNNEL_MODE%
echo.
if "%BACKEND_REUSED%"=="1" (
    echo Windows:
    if defined PORT_PID echo     backend window already open ^(pid %PORT_PID%^) - Alt+Tab to it
    if defined STARTED_TUNNEL_PID echo     tunnel window started here ^(pid %STARTED_TUNNEL_PID%^) - close it to stop sharing
) else (
    echo Windows:
    if defined STARTED_BACKEND_PID echo     backend window started here ^(pid %STARTED_BACKEND_PID%^) - close it to stop ArcGPT
    if defined STARTED_TUNNEL_PID echo     tunnel window started here ^(pid %STARTED_TUNNEL_PID%^) - close it to stop sharing
)
echo.
echo This is the one tunnel for this session. Deploy-ArcGPT-Pages.bat reuses
echo it, so a GitHub Pages deploy will publish exactly this URL.
echo.
echo The tunnel URL changes every time the Quick Tunnel restarts. If it does,
echo run Deploy-ArcGPT-Pages.bat again to republish with the new one.
echo.
call :offershutdown
echo.
echo This launcher is finished. Close it when you no longer need it.
echo.
pause
exit /b 0

rem ============================================================================
rem  Shutdown offer.
rem
rem  Only the windows this launcher opened are ever offered. A backend or
rem  tunnel that was already running when this launcher started belongs to an
rem  earlier session and is deliberately left alone, however tempting it looks:
rem  stopping someone else's server is not this script's decision to make.
rem
rem  This is an offer, never automatic. Closing this launcher window must not
rem  kill the backend - that is exactly the surprise this replaces.
rem ============================================================================
:offershutdown
if not defined STARTED_BACKEND_PID if not defined STARTED_TUNNEL_PID exit /b 0
echo ========================================
echo          SHUTDOWN
echo ========================================
echo.
echo Started by THIS launcher:
if defined STARTED_BACKEND_PID echo     backend : window pid %STARTED_BACKEND_PID%
if defined STARTED_TUNNEL_PID echo     tunnel  : window pid %STARTED_TUNNEL_PID%
if "%BACKEND_REUSED%"=="1" echo     backend : NOT started here, left untouched
echo.
echo Closing this window does NOT stop them.
choice /c YN /n /m "Stop the above now? [Y/N] "
if errorlevel 2 exit /b 0
if defined STARTED_BACKEND_PID call :stoptree "%STARTED_BACKEND_PID%"
if defined STARTED_TUNNEL_PID call :stoptree "%STARTED_TUNNEL_PID%"
echo.
echo Stopped.
exit /b 0

rem --- taskkill /T ends a window and everything it spawned, which for these two
rem --- is exactly the server and its children, and nothing else.
:stoptree
taskkill /PID %~1 /T /F
exit /b 0

rem ============================================================================
rem  showresolve - print the tunnel candidates the helper rejected, if any.
rem
rem  Kept in its own label rather than inline. This launcher has a documented
rem  history of cmd losing the labels after a parenthesised block, and a
rem  for /f inside parentheses is exactly what did it.
rem ============================================================================
:showresolve
if not exist "%RESOLVE_REPORT%" exit /b 0
echo   Candidates checked:
for /f "tokens=*" %%L in ('type "%RESOLVE_REPORT%"') do echo     %%L
del /q "%RESOLVE_REPORT%" 2>nul
echo.
exit /b 0

rem ============================================================================
rem  tunnel poll - one attempt; the URL appears in the log within a few seconds
rem ============================================================================
:pollurl
if defined TUNNEL_URL exit /b 0
if not exist "%TUNNEL_LOG%" (
    timeout /t 2 /nobreak >nul
    exit /b 0
)
for /f "delims=" %%A in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -Raw -LiteralPath '%TUNNEL_LOG%' -ErrorAction SilentlyContinue; if ($t) { $m = [regex]::Match($t, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $m.Value } }"') do set "TUNNEL_URL=%%A"
if not defined TUNNEL_URL timeout /t 2 /nobreak >nul
exit /b 0

rem ============================================================================
rem  failures - every one keeps the window open so the reason stays readable
rem ============================================================================
:nobackend
echo [ERROR] backend\package.json not found under "%BACKEND%".
echo         This file must sit in the ArcGPT repository root.
echo.
pause
exit /b 1

:noenv
echo [ERROR] backend\.env not found under "%BACKEND%".
echo         Copy backend\.env.example to backend\.env and set DB_PASSWORD,
echo         SESSION_SECRET and LOCAL_ADMIN_PASSWORD. This script does not
echo         create or modify it.
echo.
pause
exit /b 1

:pgdown
echo [ERROR] PostgreSQL is not reachable.
echo         Nothing is listening on port %PG_PORT%. ArcGPT cannot answer any
echo         database question without it. Start the PostgreSQL service, then
echo         run this launcher again.
echo.
pause
exit /b 1

:backendfail
echo [ERROR] The ArcGPT backend did not become ready.
echo         %API_URL%/api/health did not report server=ok within 120 seconds.
echo         Read the "ArcGPT Backend" window for the actual error. Common
echo         causes: backend\.env missing or wrong, or node_modules not
echo         installed.
if defined STARTED_BACKEND_PID echo         This launcher started it, window pid %STARTED_BACKEND_PID%.
if "%BACKEND_REUSED%"=="1" echo         It was already running (pid %PORT_PID%), so the launcher did not start it.
echo.
call :offershutdown
echo.
pause
exit /b 1

:nocf
echo [WARNING] cloudflared.exe was not found, so no public tunnel was opened.
echo           ArcGPT is running normally at %API_URL%.
echo.
call :offershutdown
echo.
pause
exit /b 0

:tunnelfail
echo [ERROR] cloudflared did not publish a URL.
echo         The tunnel log is: %TUNNEL_LOG%
echo         Read the "ArcGPT Tunnel" window for the actual error. ArcGPT is
echo         still running at %API_URL%; only the public URL is missing.
if defined STARTED_TUNNEL_PID echo         This launcher started it, window pid %STARTED_TUNNEL_PID%.
echo.
call :offershutdown
echo.
pause
exit /b 1
