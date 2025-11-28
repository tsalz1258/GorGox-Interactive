========================================
  HOW TO GET EXAMPLE DATA
========================================

METHOD 1: Use the Create Fresh Examples Script (EASIEST!)
----------------------------------------------------------
1. Run: create_fresh_examples.bat
2. Wait for server to start
3. Examples are automatically created!

METHOD 2: Manual Reset
----------------------------------------------------------
1. Stop the server (close the window or Ctrl+C)
2. Delete gorgox.db (the main database file)
3. Run: start.bat
4. Examples auto-populate!

METHOD 3: Through the Web Interface
----------------------------------------------------------
1. Run: start.bat
2. Open browser: http://localhost:3000
3. Connect as DM
4. Use "Create Character" and "Create Enemy" buttons
5. Manually create your own characters/enemies


========================================
  WHAT EXAMPLES YOU GET
========================================

CHARACTERS (3):
- Thorin Ironshield (Fighter 5)
- Elara Moonwhisper (Wizard 5)
- Grimgor the Bold (Barbarian 4)

ENEMIES (4):
- Goblin (CR 0.25)
- Orc (CR 0.5)
- Ogre (CR 2)
- Red Dragon Wyrmling (CR 4)


========================================
  HELPFUL SCRIPTS IN THIS FOLDER
========================================

create_fresh_examples.bat
  → Resets database and creates fresh examples

show_examples_list.bat
  → Shows what examples are included

quick_reset_db.bat
  → Simple database reset with backup


========================================
  IMPORTING YOUR OWN CHARACTERS
========================================

For detailed characters like "LeeRok NasGin":

1. Run: start.bat
2. Connect as DM
3. Click "👤 Characters"
4. Click "Import from JSON"
5. Paste your character JSON
6. Click Import

The system will:
- Extract combat stats automatically
- Store full character data
- Display comprehensive character sheet


========================================
  TROUBLESHOOTING
========================================

Q: Examples don't appear?
A: Make sure you deleted gorgox.db before starting

Q: Database is locked?
A: Stop the server completely, then delete gorgox.db

Q: Want to keep existing data?
A: Backup gorgox.db before running reset scripts

Q: Lost examples accidentally?
A: Just run create_fresh_examples.bat again!


========================================
  For more help, see the main README.md
========================================









