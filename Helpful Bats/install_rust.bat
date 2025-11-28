@echo off
title Install Rust for Gorgox Interactive
color 0E

echo.
echo ========================================
echo   RUST INSTALLATION HELPER
echo ========================================
echo.
echo This script will help you install Rust.
echo.
echo Press any key to open the Rust installer page...
pause >nul

start https://rustup.rs/

echo.
echo Instructions:
echo.
echo 1. Download and run rustup-init.exe
echo 2. Choose option 1 (default installation)
echo 3. Wait for installation to complete
echo 4. RESTART this PowerShell window
echo 5. Run start.bat to launch the server
echo.

pause


