# Automated build script that handles Windows Defender exclusions
# Run this instead of `cargo build --release`

$ErrorActionPreference = "Continue"
$buildDir = Join-Path $PWD "target"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Automated Release Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    Write-Host "Running as Administrator" -ForegroundColor Green
    Write-Host "Adding build directory to Windows Defender exclusions..." -ForegroundColor Yellow
    
    try {
        Remove-MpPreference -ExclusionPath $buildDir -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionPath $buildDir -ErrorAction Stop
        Write-Host "Added exclusion for build directory" -ForegroundColor Green
    } catch {
        Write-Host "Could not add exclusion automatically, continuing anyway..." -ForegroundColor Yellow
    }
} else {
    Write-Host "Not running as Administrator" -ForegroundColor Yellow
    Write-Host "To avoid file locking issues, run this script as Administrator" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Cleaning previous build..." -ForegroundColor Yellow
cargo clean | Out-Null

Write-Host "Waiting for file locks to release..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Starting build..." -ForegroundColor Yellow
Write-Host ""

$env:CARGO_BUILD_JOBS = "1"
$env:CARGO_INCREMENTAL = "0"

cargo build --release --jobs 1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Build Successful!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Executable: target\release\gorgox_interactive.exe" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  Build Failed" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "If error is about file locking (LNK1104):" -ForegroundColor Yellow
    Write-Host "  1. Run this script as Administrator" -ForegroundColor Yellow
    Write-Host "  2. Manually add exclusion in Windows Security" -ForegroundColor Yellow
    Write-Host "  3. Close any running instances" -ForegroundColor Yellow
    Write-Host ""
    exit $LASTEXITCODE
}
