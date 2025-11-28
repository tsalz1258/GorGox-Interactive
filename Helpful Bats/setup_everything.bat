@echo off
title Gorgox Interactive - Complete Setup
color 0B

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   GORGOX INTERACTIVE - SETUP WIZARD
echo ========================================
echo.
echo This script will:
echo   1. Check if Rust is installed
echo   2. Add antivirus exclusion (with your permission)
echo   3. Build the project
echo   4. Start the server
echo.
echo Time required: 5-10 minutes (one time only)
echo Future runs: 10-30 seconds
echo.
pause

echo.
echo ========================================
echo   STEP 1: CHECKING RUST
echo ========================================
echo.

where cargo >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] Rust is NOT installed
    echo.
    echo Please install Rust first:
    echo   1. Double-click: install_rust.bat
    echo   2. Or visit: https://rustup.rs/
    echo   3. Install, then RESTART your terminal
    echo   4. Run this script again
    echo.
    pause
    exit /b 1
)

echo [+] Rust is installed: OK
cargo --version
echo.

echo ========================================
echo   STEP 2: ANTIVIRUS EXCLUSION
echo ========================================
echo.
echo To build Rust projects on Windows, you need to add an
echo antivirus exclusion for this folder.
echo.
echo This prevents antivirus from blocking the compiler.
echo.
echo Would you like to add the exclusion now?
echo.
echo Press Y to add exclusion (recommended)
echo Press N to skip (you'll need to do it manually)
echo.
choice /C YN /M "Add Windows Defender exclusion"

if %ERRORLEVEL% EQU 1 (
    echo.
    echo [*] Adding exclusion...
    echo [*] You'll see a UAC prompt - click YES
    echo.
    powershell -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"Add-MpPreference -ExclusionPath ''%CD%''; Write-Host ''Exclusion added!''; Start-Sleep -Seconds 2\"' -Verb RunAs" 2>nul
    echo.
    echo [+] Exclusion added (if you clicked Yes on UAC)
) else (
    echo.
    echo [!] Skipped. If build fails, run: fix_antivirus.bat
)

echo.
echo ========================================
echo   STEP 3: BUILDING PROJECT
echo ========================================
echo.
echo This will take 3-5 minutes...
echo Please wait...
echo.

cargo build --release

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Build FAILED
    echo.
    echo Most likely cause: Antivirus still blocking
    echo.
    echo SOLUTIONS:
    echo   1. Run: fix_antivirus.bat
    echo   2. Manually add exclusion (see FIX_ANTIVIRUS_BLOCKING.md)
    echo   3. Temporarily disable antivirus, build, then re-enable
    echo.
    pause
    exit /b 1
)

echo.
echo [+] Build successful!
echo.

echo ========================================
echo   STEP 4: STARTING SERVER
echo ========================================
echo.
echo Server will start on: http://localhost:3000
echo.
echo Press Ctrl+C to stop the server at any time.
echo.
pause

cargo run --release

echo.
echo [*] Server stopped
pause


