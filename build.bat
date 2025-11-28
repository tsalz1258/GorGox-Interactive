@echo off
title Building Gorgox Interactive
color 0B

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   BUILDING PROJECT
echo ========================================
echo.
echo Working directory: %CD%
echo.
echo This will take 3-5 minutes on first run...
echo.

cargo build --release

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo [+] BUILD SUCCESSFUL!
    echo ========================================
    echo.
    echo To start the server, run: start.bat
    echo Or just double-click: run.bat
    echo.
) else (
    echo.
    echo ========================================
    echo [!] BUILD FAILED
    echo ========================================
    echo.
    echo Common fixes:
    echo   - If "Access is denied": Run fix_antivirus.bat
    echo   - If "cargo not found": Close terminal, open new one
    echo   - See error message above for details
    echo.
)

pause


