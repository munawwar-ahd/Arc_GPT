<#
.SYNOPSIS
    Builds the ArcGPT college ERP database in `arcgpt_new`.

.DESCRIPTION
    Applies every migration in order and verifies the result. Refuses to run
    if the connection would not be targeting `arcgpt_new`.

    Every SQL file also carries its own `current_database()` guard, so running a
    file by hand in pgAdmin 4 is equally safe.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File database\run_all.ps1
    powershell -ExecutionPolicy Bypass -File database\run_all.ps1 -Reset
#>
[CmdletBinding()]
param(
    [string]$DbHost   = 'localhost',
    [string]$DbPort   = '5432',
    [string]$DbName   = 'arcgpt_new',
    [string]$DbUser   = 'postgres',
    [string]$DbPass   = $env:PGPASSWORD,
    [string]$PsqlPath = 'C:\Program Files\PostgreSQL\16\bin\psql.exe',
    [switch]$Reset
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- Safety: the whole point of this script ---------------------------------
if ($DbName -ne 'arcgpt_new') {
    throw "SAFETY ABORT: this build targets 'arcgpt_new' only. Refusing to run against '$DbName'."
}
if (-not (Test-Path $PsqlPath)) {
    throw "psql not found at $PsqlPath. Override with -PsqlPath."
}

$files = @(
    '01_control_tables.sql',
    '02_institution_tables.sql',
    '03_indexes.sql',
    '04_views.sql',
    '05_seed_reference.sql',
    '06_seed_subjects.sql',
    '07_seed_structure_students.sql',
    '08_seed_delivery.sql',
    '09_seed_academic_records.sql',
    '10_seed_finance_hostel.sql',
    '11_permissions.sql',
    '12_verify.sql'
)

$env:PGPASSWORD = $DbPass
$conn = @('-h', $DbHost, '-p', $DbPort, '-U', $DbUser, '-v', 'ON_ERROR_STOP=1', '-q')

try {
    Write-Host ""
    Write-Host "ArcGPT database build" -ForegroundColor Cyan
    Write-Host "  target : $DbUser@$DbHost`:$DbPort/$DbName" -ForegroundColor Cyan
    Write-Host "  server : $(& $PsqlPath @conn -d postgres -At -c 'SHOW server_version;')" -ForegroundColor DarkGray
    Write-Host ""

    if ($Reset) {
        Write-Host "  RESET: dropping and recreating the public schema" -ForegroundColor Yellow
        & $PsqlPath @conn -d $DbName -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO pg_database_owner;'
    }

    foreach ($f in $files) {
        $path = Join-Path $here $f
        if (-not (Test-Path $path)) { Write-Host "  SKIP  $f (not present yet)" -ForegroundColor DarkYellow; continue }
        # psql writes NOTICE/WARNING to stderr, which PowerShell would otherwise
        # surface as a terminating error. Only the exit code decides success.
        $ErrorActionPreference = 'Continue'
        $out = & $PsqlPath @conn -d $DbName -f $path 2>&1
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        if ($code -ne 0) {
            Write-Host "  FAIL  $f" -ForegroundColor Red
            $out | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
            throw "Migration failed: $f"
        }
        Write-Host "  OK    $f" -ForegroundColor Green
    }
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
