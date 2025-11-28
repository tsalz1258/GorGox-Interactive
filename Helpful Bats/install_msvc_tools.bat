@echo off
title Install Visual Studio Build Tools
color 0E

echo.
echo ========================================
echo   VISUAL STUDIO BUILD TOOLS INSTALLER
echo ========================================
echo.
echo Rust on Windows needs the MSVC linker to compile code.
echo This will open the Visual Studio Build Tools installer.
echo.
echo IMPORTANT STEPS:
echo.
echo 1. Download will start in your browser
echo 2. Run the installer (vs_BuildTools.exe)
echo 3. When the installer opens, CHECK THIS BOX:
echo    [X] Desktop development with C++
echo 4. Click "Install" (requires ~6 GB)
echo 5. Wait for installation to complete (~10-15 minutes)
echo 6. Restart your computer (important!)
echo 7. Then run start.bat again
echo.
echo Press any key to open the download page...
pause >nul

start https://visualstudio.microsoft.com/visual-cpp-build-tools/

echo.
echo The download page has opened in your browser.
echo.
echo Download and install "Build Tools for Visual Studio 2022"
echo.
echo Remember to select: Desktop development with C++
echo.

pause


