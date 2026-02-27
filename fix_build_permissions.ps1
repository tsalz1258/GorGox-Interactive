# Fix Build Permissions - Exclude Build Directory from Windows Defender
# This script helps resolve "Access is denied" errors during Rust builds

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Fix Rust Build Permissions" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$buildDir = "$env:LOCALAPPDATA\RustBuilds\gorgox-interactive"
$projectDir = Get-Location

Write-Host "This script will:" -ForegroundColor Yellow
Write-Host "1. Add build directory to Windows Defender exclusions"
Write-Host "2. Add project directory to Windows Defender exclusions"
Write-Host "3. Clean any locked build files"
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  WARNING: Not running as Administrator" -ForegroundColor Yellow
    Write-Host "   You may need to run this script as Administrator" -ForegroundColor Yellow
    Write-Host "   Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? (Y/N)"
    if ($continue -ne "Y" -and $continue -ne "y") {
        exit
    }
}

Write-Host "Step 1: Adding build directory exclusion..." -ForegroundColor Green
try {
    Add-MpPreference -ExclusionPath $buildDir -ErrorAction Stop
    Write-Host "✅ Added build directory: $buildDir" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -match "already exists") {
        Write-Host "ℹ️  Build directory already excluded" -ForegroundColor Cyan
    } else {
        Write-Host "⚠️  Could not add build directory exclusion: $_" -ForegroundColor Yellow
        Write-Host "   You may need to add it manually in Windows Security" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Step 2: Adding project directory exclusion..." -ForegroundColor Green
try {
    Add-MpPreference -ExclusionPath $projectDir -ErrorAction Stop
    Write-Host "✅ Added project directory: $projectDir" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -match "already exists") {
        Write-Host "ℹ️  Project directory already excluded" -ForegroundColor Cyan
    } else {
        Write-Host "⚠️  Could not add project directory exclusion: $_" -ForegroundColor Yellow
        Write-Host "   You may need to add it manually in Windows Security" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Step 3: Cleaning build directory..." -ForegroundColor Green
if (Test-Path $buildDir) {
    try {
        Remove-Item -Path $buildDir -Recurse -Force -ErrorAction Stop
        Write-Host "✅ Cleaned build directory" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Could not clean build directory: $_" -ForegroundColor Yellow
        Write-Host "   Some files may be locked. Try closing any running Rust processes." -ForegroundColor Yellow
    }
} else {
    Write-Host "ℹ️  Build directory does not exist yet" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Done!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Wait a few seconds for Windows Defender to update"
Write-Host "2. Run: cargo build --release"
Write-Host ""
Write-Host "If issues persist:" -ForegroundColor Yellow
Write-Host "- Open Windows Security → Virus & threat protection"
Write-Host "- Click 'Manage settings' → 'Exclusions'"
Write-Host "- Manually add: $buildDir" -ForegroundColor Cyan
Write-Host "- Manually add: $projectDir" -ForegroundColor Cyan
Write-Host ""


