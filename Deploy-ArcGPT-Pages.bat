@echo off
setlocal enabledelayedexpansion
title ArcGPT Deploy to GitHub Pages

rem ============================================================================
rem  Publishes the frontend to https://munawwar-ahd.github.io/Arc_GPT/.
rem
rem  This is separate from start-arcgpt.bat on purpose. Local startup is needed
rem  every time; deploying is not, and a build that rewrote the bundle's backend
rem  URL on every launch is how a working site became a blank page once already.
rem
rem  Why a tunnel is involved: ArcGPT-Backend, PostgreSQL, Ollama and LM Studio
rem  are all local and stay local. The public site is only the static frontend
rem  bundle on GitHub Pages. To let that bundle reach the API, the bundle has to
rem  name a public address for port 3000, which is the Cloudflare quick tunnel.
rem
rem  Shared tunnel - the rule this script exists to enforce
rem  -----------------------------------------------------
rem  There is ONE authoritative ArcGPT Quick Tunnel per running session, and
rem  start-arcgpt.bat owns it. This script REUSES it. It never opens a second
rem  one while a healthy tunnel exists.
rem
rem  This is not a nicety. This script used to open a tunnel of its own and bake
rem  that URL into the bundle, so the hosted site pointed at the deploy tunnel
rem  while the launcher kept a different tunnel alive. Closing the deploy
rem  window then killed the published address and the site went dead while the
rem  launcher still showed a working URL. Both scripts now resolve the same
rem  tunnel through ArcGPT-Tunnel.ps1, so the published URL is always the URL
rem  that is actually running.
rem
rem  The URL is discovered, never hard-coded. Resolution order is the runtime
rem  state file, then the tunnel logs, then - only as a last resort - a new
rem  tunnel opened here, which is left running after this script exits.
rem
rem  Nothing else is exposed: PostgreSQL (5432), Ollama (11434) and LM Studio
rem  (1234) are never tunneled, and no credential is ever written into the
rem  bundle.
rem ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "FRONTEND=%ROOT%\frontend"
set "DIST=%FRONTEND%\dist"
set "TUNNEL_HELPER=%ROOT%\ArcGPT-Tunnel.ps1"
set "API_PORT=3000"
set "API_URL=http://localhost:%API_PORT%"
set "EXPECTED_DB=arcgpt_new"
set "PAGES_URL=https://munawwar-ahd.github.io/Arc_GPT/"

set "RESOLVE_REPORT=%TEMP%\arcgpt-deploy-resolve.txt"
set "KNOWN_URLS=%TEMP%\arcgpt-deploy-known.txt"
set "BE_RESULT=%TEMP%\arcgpt-deploy-build.txt"
set "LV_RESULT=%TEMP%\arcgpt-deploy-live.txt"

rem A fresh log per run. cloudflared holds its log file open for the life of the
rem tunnel, so reusing one path would append this run's output onto a previous
rem run's and the URL scan would find the older, dead tunnel first.
set "TUNNEL_LOG=%TEMP%\arcgpt-tunnel-%RANDOM%%RANDOM%.log"

if not exist "%FRONTEND%\package.json" goto nofrontend
if not exist "%TUNNEL_HELPER%" goto nohelper

echo.
echo ========================================
echo     ARC GPT - DEPLOY GITHUB PAGES
echo ========================================
echo.

rem ============================================================================
echo [1/8] Backend must be healthy
rem ============================================================================
rem The bundle's API address is baked in at build time, so the backend has to be
rem up before the build, not after it. The check is /api/health rather than a
rem bare port probe, and the database has to be the expected one: publishing a
rem bundle that names the wrong database would be worse than not publishing.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$h = $null; try { $h = Invoke-RestMethod -Uri '%API_URL%/api/health' -TimeoutSec 15 } catch { }; if (-not $h) { Write-Output 'DOWN'; exit 0 }; if ($h.server -ne 'ok') { Write-Output ('BADSERVER:' + $h.server); exit 0 }; if ($h.database -ne '%EXPECTED_DB%') { Write-Output ('BADDB:' + $h.database); exit 0 }; Write-Output ('OK:' + $h.database)" > "%TEMP%\arcgpt-deploy-be.txt"
set "BACKEND_VERDICT="
set /p BACKEND_VERDICT=<"%TEMP%\arcgpt-deploy-be.txt"
del /q "%TEMP%\arcgpt-deploy-be.txt" 2>nul

if "%BACKEND_VERDICT%"=="" goto backenddown
if /i "%BACKEND_VERDICT%"=="DOWN" goto backenddown
echo %BACKEND_VERDICT% | find "BADSERVER:" >nul && goto backendbadserver
echo %BACKEND_VERDICT% | find "BADDB:" >nul && goto backendbaddb
echo         backend    : OK on %API_PORT% database=%EXPECTED_DB%
echo.

rem ============================================================================
echo [2/8] Resolve the ONE ArcGPT tunnel
rem ============================================================================
rem This is the shared tunnel. ArcGPT-Tunnel.ps1 returns the URL of a healthy
rem tunnel - server=ok, database=arcgpt_new, ollama=ok - from the state file
rem start-arcgpt.bat wrote, or from any tunnel log. Nothing is hard-coded.
powershell -NoProfile -ExecutionPolicy Bypass -File "%TUNNEL_HELPER%" -Action Resolve -ExpectedDb "%EXPECTED_DB%" -Report "%RESOLVE_REPORT%" > "%TEMP%\arcgpt-deploy-url.txt"
set "TUNNEL_URL="
set /p TUNNEL_URL=<"%TEMP%\arcgpt-deploy-url.txt"
del /q "%TEMP%\arcgpt-deploy-url.txt" 2>nul

call :showreport "%RESOLVE_REPORT%"

if not "%TUNNEL_URL%"=="" goto tunnelreuse

rem --- no usable tunnel: open exactly one, and keep it running ----------------
echo         No healthy ArcGPT tunnel exists. Opening one.
set "TUNNEL_CREATED=0"
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
echo         Opening a tunnel to %API_URL% ...
rem The tunnel runs in its own cmd /k window, which gives cloudflared the console
rem it requires. Redirecting stdin here instead makes it print "Input redirection
rem is not supported" into this launcher. The window is deliberately left open:
rem it IS the tunnel the published bundle will point at.
start "ArcGPT Tunnel" cmd /k ""%CLOUDFLARED%" tunnel --url %API_URL% --logfile "%TUNNEL_LOG%""

echo         Waiting for the tunnel to publish a URL ...
set "TUNNEL_URL="
for /l %%I in (1,1,20) do call :pollurl
if not defined TUNNEL_URL goto notunnel
set "TUNNEL_CREATED=1"

:tunnelreuse
echo.
echo         tunnel URL : %TUNNEL_URL%
echo         source     : reused, this script opened no tunnel
echo.

rem Record ONLY when this script is the one that opened the tunnel, so that
rem start-arcgpt.bat on its next run reuses it.
rem
rem It must not record on the reuse path. The launcher has already written the
rem authoritative state, including the pids and the real log path; re-recording
rem here would blank those pids and point LOG at this script's own unused log
rem path, which was never created when no tunnel was started.
if "%TUNNEL_CREATED%"=="1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TUNNEL_HELPER%" -Action Record -Url "%TUNNEL_URL%" -Owned 1 -Log "%TUNNEL_LOG%" >nul 2>&1
)

rem ============================================================================
echo [3/8] Validate the tunnel before writing anything
rem ============================================================================
rem This URL is about to be baked into a published, world-readable bundle, so
rem this is a hard gate: server=ok, database=arcgpt_new and ollama=ok all have
rem to hold. Publishing an address that cannot answer takes a working site down.
rem The helper prints a HEALTH line and then a VALID line, and `set /p` only
rem reads the first of them. So the verdict is taken from the file, not from a
rem single captured line.
powershell -NoProfile -ExecutionPolicy Bypass -File "%TUNNEL_HELPER%" -Action Validate -Url "%TUNNEL_URL%" -ExpectedDb "%EXPECTED_DB%" > "%TEMP%\arcgpt-deploy-v.txt"
find "ARCGPT_TUNNEL_VALID=0" "%TEMP%\arcgpt-deploy-v.txt" >nul 2>&1 && goto tunnelinvalid
find "ARCGPT_TUNNEL_VALID=1" "%TEMP%\arcgpt-deploy-v.txt" >nul 2>&1 || goto tunnelinvalid
echo         Health    : server=ok database=%EXPECTED_DB% ollama=ok
del /q "%TEMP%\arcgpt-deploy-v.txt" 2>nul
echo.

rem ============================================================================
echo [4/8] Write the tunnel URL into frontend\.env.production
rem ============================================================================
rem VITE_BACKEND_URL is inlined into the public bundle at build time. It holds a
rem tunnel address and nothing else: no database credential, no session secret,
rem no model setting ever goes in here.
rem
rem Every other line in the file is preserved, and .env.production is already
rem gitignored, so a tunnel URL never reaches a commit.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Join-Path '%FRONTEND%' '.env.production'; $u = '%TUNNEL_URL%'; $kept = @(); if (Test-Path -LiteralPath $p) { $kept = @(Get-Content -LiteralPath $p | Where-Object { $_ -notmatch '^\s*VITE_BACKEND_URL=' }) }; @($kept + ('VITE_BACKEND_URL=' + $u)) | Set-Content -LiteralPath $p -Encoding utf8"
if errorlevel 1 goto enverror
echo         .env.production written.
echo.

rem ============================================================================
echo [5/8] Build ^(base /Arc_GPT/^)
rem ============================================================================
rem build:pages is the step that matters. It pins Vite's base to /Arc_GPT/ so the
rem emitted asset URLs are /Arc_GPT/assets/... The site is served from that
rem sub-path, and a bundle built with the default base of '/' asks for
rem /assets/... at the domain root, which 404s: the HTML loads, the JavaScript
rem does not, and the page renders blank.
call npm --prefix "%FRONTEND%" run build:pages
if errorlevel 1 goto builderror
echo.

rem ============================================================================
echo [6/8] Verify the bundle that was just built
rem ============================================================================
rem Do not trust the build. A stale URL survives into dist if the env file was
rem not picked up, and shipping it silently breaks the live site. Every other
rem tunnel URL this machine has ever used is checked too, so a dead hostname
rem cannot be left behind in the published JavaScript.
powershell -NoProfile -ExecutionPolicy Bypass -File "%TUNNEL_HELPER%" -Action KnownUrls > "%KNOWN_URLS%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dist = '%DIST%'; $url = '%TUNNEL_URL%'; $fail = @(); if (-not (Test-Path -LiteralPath $dist)) { Write-Output 'RESULT=FAIL'; Write-Output 'DETAIL=the dist folder was not produced'; exit 0 }; $js = @(Get-ChildItem -LiteralPath $dist -Recurse -File -Include '*.js'); if ($js.Count -eq 0) { Write-Output 'RESULT=FAIL'; Write-Output 'DETAIL=dist contains no JavaScript'; exit 0 }; $blob = ($js | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join ''; if (-not $blob.Contains($url)) { $fail += ('the current tunnel URL is missing from the bundle: ' + $url) }; $prefix = 'ARCGPT_KNOWN_URL='; $dead = @(Get-Content -LiteralPath '%KNOWN_URLS%' -ErrorAction SilentlyContinue | ForEach-Object { $_.Trim() } | Where-Object { $_.StartsWith($prefix) } | ForEach-Object { $_.Substring($prefix.Length) } | Where-Object { $_ -and $_ -ne $url }); foreach ($d in $dead) { if ($blob.Contains($d)) { $fail += ('a dead tunnel URL is still in the bundle: ' + $d) } }; if (-not $blob.Contains('Dev - Munawwar')) { $fail += 'expected text missing from the bundle: Dev - Munawwar' }; if (-not $blob.Contains('Public Access')) { $fail += 'expected text missing from the bundle: Public Access' }; if ($fail.Count -gt 0) { Write-Output 'RESULT=FAIL'; foreach ($f in $fail) { Write-Output ('DETAIL=' + $f) }; exit 0 }; Write-Output 'RESULT=OK'; Write-Output ('DETAIL=javascript files: ' + $js.Count); Write-Output ('DETAIL=current tunnel URL present: ' + $url); Write-Output ('DETAIL=dead tunnel URLs checked: ' + $dead.Count + ', none present'); Write-Output 'DETAIL=both required strings present: Dev - Munawwar, Public Access'" > "%BE_RESULT%"

find "RESULT=OK" "%BE_RESULT%" >nul || goto buildverifyfail
echo         Bundle verified before publishing:
findstr /b /c:"DETAIL=" "%BE_RESULT%"
del /q "%BE_RESULT%" 2>nul
echo.

rem ============================================================================
echo [7/8] Publish dist\ to the gh-pages branch
rem ============================================================================
rem The existing mechanism: npm run publish:pages, which is `gh-pages -d dist`.
rem The Pages source stays gh-pages. No GitHub Actions is involved.
call :remotehead "%TEMP%\arcgpt-deploy-pre.txt"
set "REMOTE_BEFORE="
set /p REMOTE_BEFORE=<"%TEMP%\arcgpt-deploy-pre.txt"
del /q "%TEMP%\arcgpt-deploy-pre.txt" 2>nul
echo         gh-pages before : %REMOTE_BEFORE%
echo.

call npm --prefix "%FRONTEND%" run publish:pages
if errorlevel 1 goto publisherror

call :remotehead "%TEMP%\arcgpt-deploy-post.txt"
set "REMOTE_AFTER="
set /p REMOTE_AFTER=<"%TEMP%\arcgpt-deploy-post.txt"
del /q "%TEMP%\arcgpt-deploy-post.txt" 2>nul
echo         gh-pages after  : %REMOTE_AFTER%
echo.

if not defined REMOTE_AFTER goto nopush
if not "%REMOTE_AFTER%"=="%REMOTE_BEFORE%" goto verifylive

rem The rebuild came out byte-identical to what is already published, so gh-pages
rem correctly had no new commit to make. That is not a failure: the live check
rem below is still the authority on whether the published site is right.
:samebundle
echo.
echo         gh-pages did not move: this rebuild was byte-identical to what is
echo         already published, so there was nothing new to push.
echo.
echo         The live check below still decides whether the site is correct.
echo.

:verifylive
echo.
echo ============================================================================
echo [8/8] Verify the LIVE GitHub Pages bundle
echo ============================================================================
rem A correct local build proves nothing about the live site. The asset GitHub
rem Pages actually serves, its contents, and the tunnel that asset names are all
rem re-read here. Pages can take a moment to serve a new commit, so this is
rem retried rather than trusted on the first attempt.
for /l %%I in (1,1,10) do call :livecheck %%I
if not defined LIVE_OK goto livefail

:deployok
del /q "%KNOWN_URLS%" 2>nul
del /q "%LV_RESULT%" 2>nul

echo.
echo ========================================
echo          DEPLOY COMPLETE
echo ========================================
echo.
echo Site    : %PAGES_URL%
echo API     : %TUNNEL_URL%
echo Commit  : %REMOTE_AFTER%
echo Live    : %LIVE_NOTE%
echo Database: %EXPECTED_DB% ^(local, never exposed^)
echo.
echo The published site now points at the tunnel that is running right now.
echo Close that tunnel and the site will stop answering; run start-arcgpt.bat
echo for a fresh URL and this script again to republish with it.
echo.
exit /b 0

rem ============================================================================
rem  livecheck - one attempt at proving the live site is correct
rem
rem  Reads the real published artifact: the live index.html, the JavaScript that
rem  HTML points at, and then the tunnel that JavaScript names.
rem
rem  Note on the asset regex: it deliberately matches the PATH and nothing
rem  around it. An earlier version wrapped the match in \" quotes, which breaks
rem  cmd's tokenizer for this whole command - the argument ends early and the
rem  PowerShell pipes are then read as cmd pipes. A cmd double-quoted argument
rem  must not contain an escaped double quote; that is the same reason the
rem  launcher above builds its quotes from [char]34.
rem ============================================================================
:livecheck
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url = '%TUNNEL_URL%'; $prefix = 'ARCGPT_KNOWN_URL='; $dead = @(Get-Content -LiteralPath '%KNOWN_URLS%' -ErrorAction SilentlyContinue | ForEach-Object { $_.Trim() } | Where-Object { $_.StartsWith($prefix) } | ForEach-Object { $_.Substring($prefix.Length) } | Where-Object { $_ -and $_ -ne $url }); $ok = $false; $note = ''; try { $html = (Invoke-WebRequest -Uri '%PAGES_URL%' -UseBasicParsing -TimeoutSec 20).Content; $m = [regex]::Match($html, '/Arc_GPT/assets/[A-Za-z0-9_.-]+\.js'); if (-not $m.Success) { $note = 'the live HTML references no /Arc_GPT/assets JavaScript file' } else { $asset = $m.Value; $js = (Invoke-WebRequest -Uri ('https://munawwar-ahd.github.io' + $asset) -UseBasicParsing -TimeoutSec 30).Content; if (-not $js.Contains($url)) { $note = ('the live bundle does not contain ' + $url + ' yet; it is serving ' + $asset) } else { $stale = ''; foreach ($d in $dead) { if ($js.Contains($d)) { $stale = $d; break } }; if ($stale) { $note = ('the live bundle still contains the dead URL ' + $stale) } else { $h = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 20; if ($h.server -eq 'ok' -and $h.database -eq '%EXPECTED_DB%' -and $h.ollama -eq 'ok') { $ok = $true; $note = ('the live asset ' + $asset + ' serves ' + $url + ' and that tunnel answers server=ok database=' + $h.database + ' ollama=ok') } else { $note = 'the live bundle is current but the tunnel health is not ok' } } } } } catch { $note = $_.Exception.Message }; if ($ok) { Write-Output 'LIVE=1' } else { Write-Output 'LIVE=0' }; Write-Output ('NOTE=' + $note)" > "%LV_RESULT%"

set "LIVE_FLAG="
set "LIVE_NOTE="
set "LIVE_OK="
set /p LIVE_FLAG=<"%LV_RESULT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-Content -LiteralPath '%LV_RESULT%' -ErrorAction SilentlyContinue | Where-Object { $_.StartsWith('NOTE=') } | ForEach-Object { $_.Substring(5) }" > "%TEMP%\arcgpt-deploy-ln.txt"
set /p LIVE_NOTE=<"%TEMP%\arcgpt-deploy-ln.txt"
del /q "%TEMP%\arcgpt-deploy-ln.txt" 2>nul

find "LIVE=1" "%LV_RESULT%" >nul && set "LIVE_OK=1"
if defined LIVE_OK exit /b 0

echo         attempt %~1 of 10 : %LIVE_NOTE%
timeout /t 10 /nobreak >nul
exit /b 0

rem ============================================================================
rem  remotehead - read the remote gh-pages head into a file
rem ============================================================================
:remotehead
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r = git -C '%ROOT%' ls-remote origin refs/heads/gh-pages 2>$null; if (-not $r) { Write-Output '' } else { Write-Output (($r -split '\s+')[0]) }" > "%~1"
exit /b 0

rem ============================================================================
rem  showreport - print a helper report file, indented, if it exists
rem ============================================================================
:showreport
if not exist "%~1" exit /b 0
for /f "usebackq tokens=*" %%L in ("%~1") do echo         %%L
del /q "%~1" 2>nul
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
for /f "delims=" %%A in ('powershell -NoProfile -Command "$t = Get-Content -Raw -LiteralPath '%TUNNEL_LOG%' -ErrorAction SilentlyContinue; if ($t) { $m = [regex]::Match($t, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $m.Value } }"') do set "TUNNEL_URL=%%A"
if not defined TUNNEL_URL timeout /t 2 /nobreak >nul
exit /b 0

rem ============================================================================
rem  failures - every one keeps the window open so the reason stays readable
rem ============================================================================
:notunnel
echo.
echo [FATAL] No tunnel URL appeared in:
echo         %TUNNEL_LOG%
echo         Read the "ArcGPT Tunnel" window for the real error.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:nofrontend
echo [FATAL] frontend\package.json not found under "%FRONTEND%".
echo         This script must stay in the repository root.
exit /b 1

:nohelper
echo [FATAL] ArcGPT-Tunnel.ps1 was not found under "%ROOT%".
echo         This script resolves the shared ArcGPT tunnel and must run from the
echo         repository root, next to start-arcgpt.bat.
exit /b 1

:backenddown
echo.
echo [FATAL] Nothing healthy is answering on %API_URL%.
echo         Start ArcGPT with start-arcgpt.bat first.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:backendbadserver
echo.
echo [FATAL] %API_URL% is answering, but not with server=ok.
echo         Read the "ArcGPT Backend" window for the error.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:backendbaddb
echo.
echo [FATAL] The backend on %API_PORT% is connected to a database other than
echo         %EXPECTED_DB%.
echo         Check DB_NAME in backend\.env. Nothing was published.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:tunnelinvalid
echo.
echo [FATAL] The tunnel did not validate, so nothing was built and nothing was
echo         published. Baking an address that cannot answer into the live
echo         bundle would take a working site offline.
echo.
echo         URL : %TUNNEL_URL%
echo         Run start-arcgpt.bat and try again.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:nocf
echo.
echo [FATAL] cloudflared.exe was not found, and no running ArcGPT tunnel could
echo         be reused. Looked in:
echo         %%ProgramFiles%%\cloudflared\
echo         %%ProgramFiles(x86)%%\cloudflared\
echo         %%LOCALAPPDATA%%\Microsoft\WinGet\Links\
echo         %%USERPROFILE%%\Downloads\
echo.
echo         Install it, or run start-arcgpt.bat, which creates the shared
echo         tunnel for you.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:enverror
echo.
echo [FATAL] Could not update frontend\.env.production. Nothing was published.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:builderror
echo.
echo [FATAL] Production build failed. Nothing was published.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:buildverifyfail
echo.
echo [FATAL] The built bundle did not verify, so nothing was published.
echo         The bundle in frontend\dist is wrong and shipping it would break
echo         the live site. Reasons:
findstr /b /c:"DETAIL=" "%BE_RESULT%"
del /q "%BE_RESULT%" 2>nul
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:publisherror
echo.
echo [FATAL] gh-pages could not publish. The live site is unchanged.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:nopush
echo.
echo [FATAL] gh-pages did not move. It is still %REMOTE_AFTER%
echo         The live site is unchanged and nothing was verified.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1

:livefail
echo.
echo [FATAL] The bundle was published, but the LIVE site could not be verified.
echo         Do not treat this deploy as working.
echo.
echo         Last result: %LIVE_NOTE%
echo.
echo         GitHub Pages may still be serving the previous commit. Re-check
echo         %PAGES_URL% in a moment. If that is not the cause, re-run this
echo         script.
del /q "%KNOWN_URLS%" 2>nul
exit /b 1
