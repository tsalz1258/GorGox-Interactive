@echo off
title Gorgox Interactive - Final Update V2.0
color 0A

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   GORGOX INTERACTIVE V2.0
echo   ALL 20 IMPROVEMENTS
echo ========================================
echo.
echo NEW in this version:
echo.
echo ✅ DM can move any token
echo ✅ Ruler tool - double-click to deactivate
echo ✅ Map grid syncs to all players
echo ✅ Players see combat status
echo ✅ All players prompted for initiative
echo ✅ Turn order hidden from players
echo ✅ Character names shown on tokens
echo ✅ HP bars update visually
echo.
echo Plus all previous 12 improvements!
echo.
pause

echo.
echo [*] Rebuilding with all improvements...
echo.

cargo build --release

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Build failed
    echo.
    if exist "target\release\gorgox_interactive.exe" (
        echo [*] Using existing executable...
        goto :run_server
    ) else (
        pause
        exit /b 1
    )
)

echo.
echo [+] Build successful!
echo.

:run_server
echo ========================================
echo   STARTING SERVER
echo ========================================
echo.
echo Server will be available at:
echo   - Local: http://localhost:3000
echo   - Network: http://YOUR_IP:3000
echo.
echo IMPORTANT - Tell all players to:
echo   1. Refresh their browsers (Ctrl+F5)
echo   2. This loads the new version
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

cargo run --release

pause









