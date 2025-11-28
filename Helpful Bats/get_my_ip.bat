@echo off
title Get My IP Address for Players
color 0A

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   YOUR IP ADDRESS FOR PLAYERS
echo ========================================
echo.
echo Finding your local network IP address...
echo.

REM Get IPv4 address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    echo Your IP Address: %%a
    echo.
    echo Give this URL to your players:
    echo http:%%a:3000
    echo.
)

echo ========================================
echo   FULL NETWORK INFO
echo ========================================
echo.

ipconfig | findstr /c:"IPv4" /c:"Wireless" /c:"Ethernet" /c:"Default Gateway"

echo.
echo ========================================
echo   INSTRUCTIONS FOR PLAYERS
echo ========================================
echo.
echo 1. Make sure they are on the SAME WiFi/network as you
echo 2. Give them the URL shown above
echo 3. They open it in their web browser
echo 4. They enter their name and click "Connect"
echo 5. They should NOT check "I am the Dungeon Master"
echo.
echo ========================================
echo   FIREWALL CHECK
echo ========================================
echo.
echo If players can't connect, you may need to allow
echo the server through Windows Firewall.
echo.
echo Run this command as Administrator:
echo.
echo New-NetFirewallRule -DisplayName "Gorgox DND Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
echo.
echo Or manually add a firewall rule for port 3000.
echo.
echo See: CONNECT_PLAYERS_GUIDE.md for detailed help
echo.

pause

