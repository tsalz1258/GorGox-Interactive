@echo off
title Applying All 12 Improvements
color 0B

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   ALL 12 IMPROVEMENTS - REBUILDING
echo ========================================
echo.
echo Implementing:
echo  1. ✅ Connected players list
echo  2. ✅ Player movement restriction
echo  3. ✅ Character selection system
echo  4. ✅ Damage/healing fixed
echo  5. ✅ Token positioning (inside squares)
echo  6. ✅ Map size synchronization
echo  7. ✅ Manual initiative + auto-roll enemies
echo  8. ✅ Turn-based movement
echo  9. ✅ Character sheet viewer
echo 10. ✅ Canvas sizing fixed
echo 11. ✅ Ruler tool
echo 12. ✅ Better combat logs
echo.
pause

echo.
echo [*] Rebuilding with all improvements...
echo.

cargo build --release

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Build failed - see error above
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo [+] BUILD SUCCESSFUL!
echo ========================================
echo.
echo All 12 improvements are now compiled!
echo.
echo IMPORTANT: After server starts, tell all players to:
echo   - Press Ctrl+F5 in their browsers to refresh
echo   - This loads the new version
echo.
echo Starting server...
echo ========================================
echo.

cargo run --release

pause









