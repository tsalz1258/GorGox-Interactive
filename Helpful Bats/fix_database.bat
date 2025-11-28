@echo off
title Fix Database Permissions
color 0E

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   FIX DATABASE PERMISSIONS
echo ========================================
echo.
echo This will fix the database permissions issue.
echo.

REM Delete old database if it exists and is locked
if exist "gorgox.db" (
    echo [*] Removing corrupted database files...
    del /F /Q gorgox.db 2>nul
    del /F /Q gorgox.db-shm 2>nul
    del /F /Q gorgox.db-wal 2>nul
    echo [+] Old database removed!
) else (
    echo [*] No existing database found (this is fine)
)

echo.
echo [+] Database cleanup complete!
echo [*] The server will create a fresh database on next run.
echo.
echo Now rebuild and run:
echo   1. Run: build.bat
echo   2. Run: start.bat
echo.

pause

