@echo off
echo ========================================
echo   Quick Database Reset
echo ========================================
echo.
echo This will delete the database and let the server recreate it
echo with fresh example characters and enemies.
echo.
echo Current database will be backed up to gorgox.db.backup
echo.
pause

REM Stop server if running
echo Stopping server...
taskkill /F /IM gorgox_interactive.exe >nul 2>&1

REM Backup existing database
if exist gorgox.db (
    echo Backing up database...
    copy gorgox.db gorgox.db.backup >nul
    echo ✅ Backup created: gorgox.db.backup
)

REM Delete database files
echo Deleting database...
del gorgox.db* 2>nul

echo.
echo ========================================
echo ✅ Database deleted!
echo ========================================
echo.
echo Now run start.bat and the server will automatically create
echo a fresh database with example characters and enemies!
echo.
pause

