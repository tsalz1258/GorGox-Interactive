@echo off
title Allow Firewall for Gorgox Server
color 0C

echo.
echo ========================================
echo   WINDOWS FIREWALL CONFIGURATION
echo ========================================
echo.
echo This will add a firewall rule to allow players to connect.
echo.
echo You'll see a UAC prompt - click YES to continue.
echo.
pause

echo.
echo [*] Adding firewall rule for port 3000...
echo.

REM Try to add firewall rule (requires admin)
powershell -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"New-NetFirewallRule -DisplayName ''Gorgox DND Server'' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -ErrorAction Stop; Write-Host ''Firewall rule added successfully!''; Start-Sleep -Seconds 3\"' -Verb RunAs"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo [+] SUCCESS!
    echo ========================================
    echo.
    echo Firewall rule has been added.
    echo Players on your network should now be able to connect!
    echo.
    echo Next steps:
    echo 1. Run: get_my_ip.bat (to find your IP)
    echo 2. Share the URL with your players
    echo 3. Make sure server is running (start.bat)
    echo.
) else (
    echo.
    echo ========================================
    echo [!] FAILED
    echo ========================================
    echo.
    echo The firewall rule could not be added automatically.
    echo.
    echo Manual method:
    echo 1. Open Windows Defender Firewall
    echo 2. Advanced Settings
    echo 3. Inbound Rules -^> New Rule
    echo 4. Port -^> TCP -^> 3000
    echo 5. Allow the connection
    echo 6. Name it "Gorgox Interactive"
    echo.
    echo See CONNECT_PLAYERS_GUIDE.md for detailed instructions.
    echo.
)

pause

