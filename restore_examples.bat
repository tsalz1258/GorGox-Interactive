@echo off
echo ========================================
echo Restoring Example Characters & Enemies
echo ========================================
echo.

REM Check if server is running
curl -s http://localhost:3000 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Server is not running!
    echo Please run start.bat first, then run this script.
    echo.
    pause
    exit /b 1
)

echo Server is running. Stopping it to add examples...
echo.

REM Stop the server
taskkill /F /IM gorgox_interactive.exe >nul 2>&1

REM Wait a moment
timeout /t 2 /nobreak >nul

REM Check if sqlite3 is available
where sqlite3 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Using sqlite3 to populate database...
    sqlite3 gorgox.db < populate_examples.sql
    echo.
    echo ✅ Examples added successfully!
) else (
    echo sqlite3 not found. Adding examples manually...
    echo.
    
    REM Start server in background
    start /B target\release\gorgox_interactive.exe
    
    REM Wait for server to start
    timeout /t 3 /nobreak >nul
    
    REM Add characters
    echo Adding Thorin Ironshield...
    curl -s -X POST http://localhost:3000/ws -H "Content-Type: application/json" -d "{\"type\":\"CreateCharacter\",\"character\":{\"id\":\"char-thorin\",\"name\":\"Thorin Ironshield\",\"player_name\":\"Example\",\"class\":\"Fighter\",\"level\":5,\"max_hp\":45,\"current_hp\":45,\"armor_class\":18,\"initiative_bonus\":2,\"strength\":16,\"dexterity\":14,\"constitution\":15,\"intelligence\":10,\"wisdom\":12,\"charisma\":8,\"speed\":30,\"proficiency_bonus\":3}}" >nul
    
    echo Adding Elara Moonwhisper...
    curl -s -X POST http://localhost:3000/ws -H "Content-Type: application/json" -d "{\"type\":\"CreateCharacter\",\"character\":{\"id\":\"char-elara\",\"name\":\"Elara Moonwhisper\",\"player_name\":\"Example\",\"class\":\"Wizard\",\"level\":5,\"max_hp\":28,\"current_hp\":28,\"armor_class\":13,\"initiative_bonus\":3,\"strength\":8,\"dexterity\":16,\"constitution\":12,\"intelligence\":18,\"wisdom\":14,\"charisma\":10,\"speed\":30,\"proficiency_bonus\":3}}" >nul
    
    echo Adding Goblin...
    curl -s -X POST http://localhost:3000/ws -H "Content-Type: application/json" -d "{\"type\":\"CreateEnemy\",\"enemy\":{\"id\":\"enemy-goblin\",\"name\":\"Goblin\",\"creature_type\":\"Humanoid\",\"challenge_rating\":0.25,\"max_hp\":7,\"armor_class\":15,\"initiative_bonus\":2,\"strength\":8,\"dexterity\":14,\"constitution\":10,\"intelligence\":10,\"wisdom\":8,\"charisma\":8,\"speed\":30,\"actions\":\"{}\",\"description\":\"Small goblin warrior\"}}" >nul
    
    echo Adding Orc...
    curl -s -X POST http://localhost:3000/ws -H "Content-Type: application/json" -d "{\"type\":\"CreateEnemy\",\"enemy\":{\"id\":\"enemy-orc\",\"name\":\"Orc\",\"creature_type\":\"Humanoid\",\"challenge_rating\":0.5,\"max_hp\":15,\"armor_class\":13,\"initiative_bonus\":1,\"strength\":16,\"dexterity\":12,\"constitution\":16,\"intelligence\":7,\"wisdom\":11,\"charisma\":10,\"speed\":30,\"actions\":\"{}\",\"description\":\"Savage orc warrior\"}}" >nul
    
    echo.
    echo ✅ Examples added!
    
    REM Stop the background server
    taskkill /F /IM gorgox_interactive.exe >nul 2>&1
)

echo.
echo ========================================
echo Now run start.bat to see the examples!
echo ========================================
pause









