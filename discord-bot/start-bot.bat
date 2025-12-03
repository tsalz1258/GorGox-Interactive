@echo off
echo ====================================
echo  Starting Discord Bot...
echo ====================================
echo.

REM Change to the discord-bot directory
cd /d "%~dp0"

REM Check if node_modules exists
if not exist "node_modules\" (
    echo ERROR: node_modules not found!
    echo Please run: npm install
    pause
    exit /b 1
)

REM Check if .env file exists
if not exist ".env" (
    echo ERROR: .env file not found!
    echo Please create a .env file with your Discord bot token.
    pause
    exit /b 1
)

echo Starting bot...
echo.

REM Use cmd to run node (bypasses PowerShell execution policy)
cmd /c node index.js

if errorlevel 1 (
    echo.
    echo ====================================
    echo  Bot stopped with an error
    echo ====================================
    pause
)
