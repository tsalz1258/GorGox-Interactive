@echo off
title Gorgox Interactive with ngrok
color 0B

echo.
echo ========================================
echo   GORGOX INTERACTIVE + NGROK
echo ========================================
echo.
echo This script will:
echo 1. Start the Gorgox server
echo 2. Start ngrok tunnel
echo 3. Give you a public URL for players
echo.

REM Change to the directory where this batch file is located
cd /d "%~dp0"

REM Check if ngrok is installed
where ngrok >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] ngrok is not installed or not in PATH
    echo.
    echo Please:
    echo 1. Download from: https://ngrok.com/download
    echo 2. Extract ngrok.exe to this folder
    echo 3. Or add ngrok to your PATH
    echo 4. Sign up and get authtoken: https://dashboard.ngrok.com/
    echo 5. Run: ngrok config add-authtoken YOUR_TOKEN
    echo.
    pause
    exit /b 1
)

echo [+] ngrok detected
echo.
echo Starting Gorgox server...
echo.

REM Start the Gorgox server in a new window
start "Gorgox Server" cmd /k "cd /d %~dp0 && cargo run --release"

echo [*] Waiting for server to start...
timeout /t 10 /nobreak >nul

echo.
echo Starting ngrok tunnel...
echo.
echo ========================================
echo   PUBLIC URL WILL APPEAR BELOW
echo ========================================
echo.
echo Give this URL to your players!
echo They can connect from anywhere!
echo.
echo Keep both windows open while playing.
echo.

REM Start ngrok
ngrok http 3000

REM If ngrok exits, this runs
echo.
echo [*] ngrok stopped
pause

