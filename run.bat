@echo off
REM Change to the directory where this batch file is located
cd /d "%~dp0"

REM Super simple version - just run the program
if exist "target\release\gorgox_interactive.exe" (
    target\release\gorgox_interactive.exe
) else (
    cargo run --release
)


