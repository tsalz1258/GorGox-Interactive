@echo off
title Quick Fix and Restart
color 0B

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   APPLYING FIXES AND RESTARTING
echo ========================================
echo.
echo [*] Rebuilding with UI fixes...
echo.

cargo build --release

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [+] Build successful!
    echo [*] Starting server...
    echo.
    echo ========================================
    echo   SERVER STARTING
    echo ========================================
    echo.
    echo Server available at: http://localhost:3000
    echo.
    echo After server starts:
    echo   1. Refresh your browser (Ctrl+F5)
    echo   2. Characters and enemies should now appear!
    echo   3. Try creating a new character - it will show up!
    echo.
    echo Press Ctrl+C to stop the server
    echo ========================================
    echo.
    
    cargo run --release
) else (
    echo.
    echo [!] Build failed - see error above
    pause
)

