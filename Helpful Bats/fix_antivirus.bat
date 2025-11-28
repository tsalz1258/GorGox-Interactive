@echo off
title Fix Antivirus Blocking Issue
color 0C

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   ANTIVIRUS EXCLUSION FIX
echo ========================================
echo.
echo This will add an exclusion to Windows Defender for this project.
echo.
echo What this does:
echo   - Tells Windows Defender to ignore this folder
echo   - Allows Rust to create .exe files without being blocked
echo   - Makes building the project possible
echo.
echo Is this safe?
echo   YES! You can see all the source code in the src/ folder.
echo   This is standard for Rust developers on Windows.
echo.
echo Requirements:
echo   - Administrator privileges (you'll see a UAC prompt)
echo   - Windows Defender as your antivirus
echo.
echo If you use different antivirus software (Norton, McAfee, etc.),
echo see: FIX_ANTIVIRUS_BLOCKING.md for instructions.
echo.
pause

echo.
echo [*] Adding exclusion for: %CD%
echo [*] You should see a UAC prompt - click YES
echo.

powershell -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"Add-MpPreference -ExclusionPath ''%CD%''; Write-Host ''Exclusion added successfully!''; pause\"' -Verb RunAs"

echo.
echo ========================================
echo   NEXT STEPS
echo ========================================
echo.
echo 1. Check the PowerShell window above for success message
echo 2. If successful, close that window
echo 3. Run these commands:
echo.
echo    cargo clean
echo    cargo build --release
echo.
echo 4. Then run: start.bat
echo.
echo If it still doesn't work:
echo   - Open Windows Security manually
echo   - Check that exclusion was added
echo   - See: FIX_ANTIVIRUS_BLOCKING.md
echo.
pause


