@echo off
title Clean Rebuild
color 0B

cd /d "%~dp0"

echo.
echo ========================================
echo   CLEAN REBUILD WITH DEBUG LOGGING
echo ========================================
echo.
echo This will:
echo 1. Clean old build files
echo 2. Rebuild with latest fixes
echo 3. Start server with debug output
echo.
pause

echo.
echo [*] Cleaning old build...
cargo clean

echo.
echo [*] Rebuilding...
cargo build --release

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Build failed!
    pause
    exit /b 1
)

echo.
echo [+] Build successful!
echo.
echo ========================================
echo   IMPORTANT DEBUGGING INFO
echo ========================================
echo.
echo After server starts:
echo.
echo 1. Open browser to http://localhost:3000
echo 2. Press F12 to open Developer Tools
echo 3. Go to Console tab
echo 4. You'll see debug messages
echo.
echo Look for:
echo   - "Adding self to players"
echo   - "Player joined"
echo   - "Rendering player list"
echo   - "Received:" messages
echo.
echo This will help us find any issues!
echo.
pause

echo.
echo Starting server...
echo.

cargo run --release

pause









