@echo off
REM Simple build script - Run this as Administrator to avoid Windows Defender issues

echo ========================================
echo   Building Release Version
echo ========================================
echo.

REM Check for admin - if not admin, warn user
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Running as Administrator
    echo.
    
    REM Add target directory to Windows Defender exclusions
    echo Adding build directory to Windows Defender exclusions...
    powershell -Command "Add-MpPreference -ExclusionPath '%CD%\target' -ErrorAction SilentlyContinue" >nul 2>&1
    echo [OK] Exclusion added
    echo.
) else (
    echo [WARNING] Not running as Administrator
    echo Windows Defender may block the build!
    echo.
    echo To fix: Right-click this file and select "Run as Administrator"
    echo.
    pause
)

echo Cleaning previous build...
cargo clean
echo.

echo Waiting for file locks to clear...
timeout /t 2 /nobreak >nul
echo.

echo Starting build...
cargo build --release --jobs 1

if %errorLevel% == 0 (
    echo.
    echo ========================================
    echo   Build Successful!
    echo ========================================
    echo.
    echo Executable: target\release\gorgox_interactive.exe
    echo.
) else (
    echo.
    echo ========================================
    echo   Build Failed
    echo ========================================
    echo.
    echo If you see LNK1104 errors:
    echo   1. Run this file as Administrator
    echo   2. Or manually add target folder to Windows Defender exclusions
    echo.
)

pause
