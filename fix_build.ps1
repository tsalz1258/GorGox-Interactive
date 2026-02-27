# Fix Build Issue - Add Windows Defender Exclusion
# Run this script as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FIXING BUILD ISSUE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$exclusionPath = (Get-Location).Path
Write-Host "Project path: $exclusionPath" -ForegroundColor Yellow
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host ""
    Write-Host "To fix:" -ForegroundColor Yellow
    Write-Host "1. Right-click PowerShell" -ForegroundColor White
    Write-Host "2. Select 'Run as Administrator'" -ForegroundColor White
    Write-Host "3. Navigate to this folder" -ForegroundColor White
    Write-Host "4. Run: .\fix_build.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "OR run this command:" -ForegroundColor Yellow
    Write-Host "Add-MpPreference -ExclusionPath '$exclusionPath'" -ForegroundColor Cyan
    Write-Host ""
    pause
    exit 1
}

Write-Host "✅ Running as Administrator" -ForegroundColor Green
Write-Host ""

# Add exclusion
try {
    Write-Host "Adding Windows Defender exclusion..." -ForegroundColor Yellow
    Add-MpPreference -ExclusionPath $exclusionPath -ErrorAction Stop
    Write-Host "✅ Successfully added exclusion!" -ForegroundColor Green
    Write-Host ""
    
    # Clean and rebuild
    Write-Host "Cleaning build cache..." -ForegroundColor Yellow
    cargo clean
    Write-Host ""
    
    Write-Host "✅ Ready to build!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Now run: cargo build" -ForegroundColor Cyan
    Write-Host "Or: cargo run" -ForegroundColor Cyan
    Write-Host ""
    
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try manually:" -ForegroundColor Yellow
    Write-Host "1. Open Windows Security" -ForegroundColor White
    Write-Host "2. Virus & threat protection" -ForegroundColor White
    Write-Host "3. Manage settings" -ForegroundColor White
    Write-Host "4. Add exclusion for: $exclusionPath" -ForegroundColor White
    Write-Host ""
}

pause


