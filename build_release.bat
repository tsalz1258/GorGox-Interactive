@echo off
REM Simple batch file wrapper for PowerShell build script
powershell.exe -ExecutionPolicy Bypass -File "%~dp0build_release.ps1"
if errorlevel 1 exit /b 1


