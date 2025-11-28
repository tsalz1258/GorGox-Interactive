@echo off
title Gorgox Interactive - D&D Server
color 0A

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   GORGOX INTERACTIVE - D&D SERVER
echo ========================================
echo.
echo Working directory: %CD%
echo.
echo [*] Starting server...
echo.

REM Ensure database schema is up to date
python ensure_enemy_schema.py >nul 2>&1

REM Try to run the already-built executable if it exists
if exist "target\release\gorgox_interactive.exe" (
    echo [+] Running existing server executable...
    echo.
    echo Server will be available at:
    echo    Local: http://localhost:3000
    echo.
    echo Press Ctrl+C to stop the server
    echo ========================================
    echo.
    target\release\gorgox_interactive.exe
    pause
    exit /b 0
)

REM If not built yet, try to build and run
echo [*] Building and running (first time: 3-5 minutes)...
echo.

cargo run --release

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================
    echo   BUILD FAILED
    echo ========================================
    echo.
    echo If you see "Access is denied":
    echo   - Your antivirus is blocking. Run: fix_antivirus.bat
    echo.
    echo If you see "cargo: command not found":
    echo   - Close this window completely
    echo   - Open a NEW PowerShell/Terminal window
    echo   - Try again
    echo.
    echo If other errors:
    echo   - Check the error message above
    echo   - See: COMPLETE_SETUP_GUIDE.md
    echo.
    pause
    exit /b 1
)

pause
