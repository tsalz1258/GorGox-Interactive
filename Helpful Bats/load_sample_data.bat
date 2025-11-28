@echo off
title Load Sample Data
color 0B

REM Change to the directory where this batch file is located
cd /d "%~dp0"

echo.
echo ========================================
echo   LOAD SAMPLE DATA
echo ========================================
echo.
echo This will add sample characters and enemies to your database.
echo.
echo What will be added:
echo   - 4 Sample Characters (Fighter, Wizard, Barbarian, Cleric)
echo   - 6 Sample Enemies (Goblin, Orc, Skeleton, Ogre, Troll, Dragon)
echo.
pause

echo.
echo [*] Loading sample data...
echo.

REM Check if Python is available
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python populate_sample_data.py
    if %ERRORLEVEL% EQU 0 (
        echo.
        echo [+] Sample data loaded successfully!
        echo.
        echo Now refresh your browser to see the characters and enemies!
        echo.
    ) else (
        echo.
        echo [!] Python script failed. Using direct SQLite method...
        goto :sql_method
    )
) else (
    echo [!] Python not found. Using direct SQLite method...
    goto :sql_method
)

goto :end

:sql_method
echo.
echo [*] Inserting sample data directly...
echo.

REM Create a SQL file with sample data
(
echo INSERT OR IGNORE INTO enemies VALUES('goblin-001','Goblin','Humanoid (Goblinoid)',0.25,7,15,2,8,14,10,10,8,8,30,'{"scimitar": {"attack_bonus": 4, "damage": "1d6+2 slashing"}}','Small green-skinned humanoid.');
echo INSERT OR IGNORE INTO enemies VALUES('orc-001','Orc','Humanoid (Orc)',0.5,15,13,1,16,12,16,7,11,10,30,'{"greataxe": {"attack_bonus": 5, "damage": "1d12+3 slashing"}}','Savage raider.');
echo INSERT OR IGNORE INTO enemies VALUES('skeleton-001','Skeleton','Undead',0.25,13,13,2,10,14,15,6,8,5,30,'{"shortsword": {"attack_bonus": 4, "damage": "1d6+2 piercing"}}','Undead warrior.');
echo.
echo INSERT OR IGNORE INTO characters VALUES('char-001','Thorin Ironshield','Player 1','Fighter',5,52,52,18,1,18,12,16,10,13,8,30,3);
echo INSERT OR IGNORE INTO characters VALUES('char-002','Elara Moonwhisper','Player 2','Wizard',5,28,28,13,3,8,16,12,18,14,10,30,3);
) > temp_data.sql

REM Run SQLite to import
sqlite3 gorgox.db < temp_data.sql 2>nul

if %ERRORLEVEL% EQU 0 (
    del temp_data.sql
    echo [+] Sample data loaded!
    echo.
    echo Refresh your browser to see the data!
    echo.
) else (
    del temp_data.sql
    echo [!] SQLite not available. 
    echo.
    echo MANUAL METHOD:
    echo 1. In the web interface, manually create characters/enemies
    echo 2. Or install Python and run: python populate_sample_data.py
    echo.
)

:end
pause

