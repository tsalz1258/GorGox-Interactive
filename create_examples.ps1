# Create Example Characters & Enemies
# This script populates the database with example data

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Example Characters & Enemies Creator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if database exists
if (Test-Path "gorgox.db") {
    Write-Host "✅ Database found: gorgox.db" -ForegroundColor Green
} else {
    Write-Host "⚠️  Database not found. It will be created on first run." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "This script will add example characters and enemies to your database." -ForegroundColor White
Write-Host ""

# Example Characters
Write-Host "📝 Creating Example Characters..." -ForegroundColor Yellow
Write-Host ""

$characters = @(
    @{
        id = "char-thorin"
        name = "Thorin Ironshield"
        player_name = "Example"
        class = "Fighter"
        level = 5
        max_hp = 45
        current_hp = 45
        armor_class = 18
        initiative_bonus = 2
        strength = 16
        dexterity = 14
        constitution = 15
        intelligence = 10
        wisdom = 12
        charisma = 8
        speed = 30
        proficiency_bonus = 3
    },
    @{
        id = "char-elara"
        name = "Elara Moonwhisper"
        player_name = "Example"
        class = "Wizard"
        level = 5
        max_hp = 28
        current_hp = 28
        armor_class = 13
        initiative_bonus = 3
        strength = 8
        dexterity = 16
        constitution = 12
        intelligence = 18
        wisdom = 14
        charisma = 10
        speed = 30
        proficiency_bonus = 3
    },
    @{
        id = "char-grimgor"
        name = "Grimgor the Bold"
        player_name = "Example"
        class = "Barbarian"
        level = 4
        max_hp = 42
        current_hp = 42
        armor_class = 14
        initiative_bonus = 1
        strength = 18
        dexterity = 12
        constitution = 16
        intelligence = 8
        wisdom = 10
        charisma = 9
        speed = 40
        proficiency_bonus = 2
    },
    @{
        id = "char-lyra"
        name = "Lyra Starweaver"
        player_name = "Example"
        class = "Cleric"
        level = 6
        max_hp = 38
        current_hp = 38
        armor_class = 16
        initiative_bonus = 1
        strength = 12
        dexterity = 10
        constitution = 14
        intelligence = 13
        wisdom = 18
        charisma = 14
        speed = 30
        proficiency_bonus = 3
    },
    @{
        id = "char-drake"
        name = "Drake Shadowblade"
        player_name = "Example"
        class = "Rogue"
        level = 5
        max_hp = 32
        current_hp = 32
        armor_class = 15
        initiative_bonus = 4
        strength = 10
        dexterity = 18
        constitution = 12
        intelligence = 14
        wisdom = 13
        charisma = 12
        speed = 30
        proficiency_bonus = 3
    }
)

# Example Enemies
$enemies = @(
    @{
        id = "enemy-goblin"
        name = "Goblin"
        creature_type = "Humanoid"
        challenge_rating = 0.25
        max_hp = 7
        armor_class = 15
        initiative_bonus = 2
        strength = 8
        dexterity = 14
        constitution = 10
        intelligence = 10
        wisdom = 8
        charisma = 8
        speed = 30
        actions = "{}"
        description = "Small goblin warrior with a scimitar"
    },
    @{
        id = "enemy-orc"
        name = "Orc"
        creature_type = "Humanoid"
        challenge_rating = 0.5
        max_hp = 15
        armor_class = 13
        initiative_bonus = 1
        strength = 16
        dexterity = 12
        constitution = 16
        intelligence = 7
        wisdom = 11
        charisma = 10
        speed = 30
        actions = "{}"
        description = "Savage orc warrior with a greataxe"
    },
    @{
        id = "enemy-ogre"
        name = "Ogre"
        creature_type = "Giant"
        challenge_rating = 2.0
        max_hp = 59
        armor_class = 11
        initiative_bonus = -1
        strength = 19
        dexterity = 8
        constitution = 16
        intelligence = 5
        wisdom = 7
        charisma = 7
        speed = 40
        actions = "{}"
        description = "Large brutish ogre with a greatclub"
    },
    @{
        id = "enemy-dragon"
        name = "Red Dragon Wyrmling"
        creature_type = "Dragon"
        challenge_rating = 4.0
        max_hp = 75
        armor_class = 17
        initiative_bonus = 2
        strength = 19
        dexterity = 10
        constitution = 17
        intelligence = 12
        wisdom = 11
        charisma = 15
        speed = 60
        actions = "{}"
        description = "Young red dragon with fire breath"
    },
    @{
        id = "enemy-skeleton"
        name = "Skeleton"
        creature_type = "Undead"
        challenge_rating = 0.25
        max_hp = 13
        armor_class = 13
        initiative_bonus = 2
        strength = 10
        dexterity = 14
        constitution = 15
        intelligence = 6
        wisdom = 8
        charisma = 5
        speed = 30
        actions = "{}"
        description = "Animated skeleton warrior"
    },
    @{
        id = "enemy-zombie"
        name = "Zombie"
        creature_type = "Undead"
        challenge_rating = 0.25
        max_hp = 22
        armor_class = 8
        initiative_bonus = -2
        strength = 13
        dexterity = 6
        constitution = 16
        intelligence = 3
        wisdom = 6
        charisma = 5
        speed = 20
        actions = "{}"
        description = "Shambling undead corpse"
    }
)

# Direct database insertion using SQL
Write-Host "📝 Preparing SQL statements..." -ForegroundColor Yellow

$sql = ""

# Add characters
foreach ($char in $characters) {
    $sql += "INSERT OR REPLACE INTO characters (id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data) VALUES ('$($char.id)', '$($char.name)', '$($char.player_name)', '$($char.class)', $($char.level), $($char.max_hp), $($char.current_hp), $($char.armor_class), $($char.initiative_bonus), $($char.strength), $($char.dexterity), $($char.constitution), $($char.intelligence), $($char.wisdom), $($char.charisma), $($char.speed), $($char.proficiency_bonus), NULL);`n"
    Write-Host "  ✅ $($char.name) - $($char.class) Level $($char.level)" -ForegroundColor Green
}

Write-Host ""
Write-Host "👹 Creating Example Enemies..." -ForegroundColor Yellow
Write-Host ""

# Add enemies
foreach ($enemy in $enemies) {
    $sql += "INSERT OR REPLACE INTO enemies (id, name, creature_type, challenge_rating, max_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, actions, description) VALUES ('$($enemy.id)', '$($enemy.name)', '$($enemy.creature_type)', $($enemy.challenge_rating), $($enemy.max_hp), $($enemy.armor_class), $($enemy.initiative_bonus), $($enemy.strength), $($enemy.dexterity), $($enemy.constitution), $($enemy.intelligence), $($enemy.wisdom), $($enemy.charisma), $($enemy.speed), '$($enemy.actions)', '$($enemy.description)');`n"
    Write-Host "  ✅ $($enemy.name) - CR $($enemy.challenge_rating)" -ForegroundColor Green
}

# Save to temp file
$sql | Out-File -FilePath "temp_populate.sql" -Encoding ASCII

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Ready to populate database!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Try to use Python's sqlite3 module (most Windows systems have Python)
$pythonCommand = @"
import sqlite3
conn = sqlite3.connect('gorgox.db')
with open('temp_populate.sql', 'r') as f:
    conn.executescript(f.read())
conn.commit()
conn.close()
print('✅ Database populated successfully!')
"@

$pythonCommand | Out-File -FilePath "temp_populate.py" -Encoding ASCII

Write-Host "Attempting to populate database..." -ForegroundColor Yellow

# Try Python
try {
    python temp_populate.py 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Examples added successfully using Python!" -ForegroundColor Green
        Remove-Item "temp_populate.sql", "temp_populate.py" -ErrorAction SilentlyContinue
        Write-Host ""
        Write-Host "Run start.bat to see your examples!" -ForegroundColor Cyan
        Write-Host ""
        pause
        exit
    }
} catch {}

# If Python failed, show manual instructions
Write-Host ""
Write-Host "⚠️  Automatic population requires Python or sqlite3." -ForegroundColor Yellow
Write-Host ""
Write-Host "OPTION 1: Install Python and run this script again" -ForegroundColor White
Write-Host "  Download from: https://www.python.org/downloads/" -ForegroundColor Gray
Write-Host ""
Write-Host "OPTION 2: The server auto-populates examples on first run!" -ForegroundColor White
Write-Host "  Just delete gorgox.db and run start.bat" -ForegroundColor Gray
Write-Host ""
Write-Host "OPTION 3: Import characters through the web interface" -ForegroundColor White
Write-Host "  1. Run start.bat" -ForegroundColor Gray
Write-Host "  2. Connect as DM" -ForegroundColor Gray
Write-Host "  3. Use 'Create Character' and 'Create Enemy' buttons" -ForegroundColor Gray
Write-Host ""
Write-Host "SQL file created: temp_populate.sql" -ForegroundColor Yellow
Write-Host "You can manually import it if you have sqlite3 installed." -ForegroundColor Gray
Write-Host ""

pause

# Cleanup temp files
Remove-Item "temp_populate.py" -ErrorAction SilentlyContinue









