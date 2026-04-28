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

REM Best-effort: ensure DB schema if Python script exists
if exist "ensure_enemy_schema.py" (
    start /B python ensure_enemy_schema.py >nul 2>&1
)

echo Server will be available at:
echo    Local: http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

REM Prefer already-built release exe if present; otherwise run via cargo
if exist "target\release\gorgox_interactive.exe" (
    target\release\gorgox_interactive.exe
) else (
    cargo run --release
)

pause
