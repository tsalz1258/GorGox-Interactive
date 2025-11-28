@echo off
echo ========================================
echo   Create Fresh Examples
echo ========================================
echo.
echo This will:
echo   1. Stop the server
echo   2. Backup your database
echo   3. Delete the database
echo   4. Start the server (auto-creates examples)
echo.
echo You will get:
echo   - 3 Example Characters
echo   - 4 Example Enemies
echo.
pause

echo.
echo Stopping server...
taskkill /F /IM gorgox_interactive.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Backing up database...
if exist ..\gorgox.db (
    copy ..\gorgox.db ..\gorgox.db.backup >nul
    echo   [32m✓[0m Backup created: gorgox.db.backup
) else (
    echo   Database doesn't exist yet - no backup needed
)

echo Deleting database...
del ..\gorgox.db* 2>nul
echo   [32m✓[0m Database deleted

echo.
echo ========================================
echo Starting server with fresh examples...
echo ========================================
echo.
echo Watch for these messages:
echo   [33m📝 Populating example characters and enemies...[0m
echo   [32m✓ Example data populated![0m
echo.
timeout /t 2 /nobreak >nul

cd ..
start.bat









