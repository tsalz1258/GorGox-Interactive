#!/usr/bin/env python3
"""
Script to populate the Gorgox Interactive database with sample data.
Run this after starting the server for the first time.
"""

import json
import sqlite3
import uuid

def populate_database():
    # Connect to database
    conn = sqlite3.connect('gorgox.db')
    cursor = conn.cursor()
    
    print("🎲 Populating Gorgox Interactive Database...")
    print()
    
    # Load and insert sample characters
    print("📖 Loading sample characters...")
    try:
        with open('examples/sample_characters.json', 'r') as f:
            characters = json.load(f)
        
        for char in characters:
            char['id'] = str(uuid.uuid4())
            char['current_hp'] = char['max_hp']
            
            cursor.execute('''
                INSERT OR REPLACE INTO characters 
                (id, name, player_name, class, level, max_hp, current_hp, armor_class,
                 initiative_bonus, strength, dexterity, constitution, intelligence,
                 wisdom, charisma, speed, proficiency_bonus)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                char['id'], char['name'], char['player_name'], char['class'],
                char['level'], char['max_hp'], char['current_hp'], char['armor_class'],
                char['initiative_bonus'], char['strength'], char['dexterity'],
                char['constitution'], char['intelligence'], char['wisdom'],
                char['charisma'], char['speed'], char['proficiency_bonus']
            ))
            print(f"  ✅ Added character: {char['name']}")
        
        conn.commit()
        print(f"  📊 Total characters: {len(characters)}")
        print()
    except Exception as e:
        print(f"  ❌ Error loading characters: {e}")
        print()
    
    # Load and insert sample enemies
    print("👹 Loading sample enemies...")
    try:
        with open('examples/sample_enemies.json', 'r') as f:
            enemies = json.load(f)
        
        for enemy in enemies:
            enemy['id'] = str(uuid.uuid4())
            
            cursor.execute('''
                INSERT OR REPLACE INTO enemies 
                (id, name, creature_type, challenge_rating, max_hp, armor_class,
                 initiative_bonus, strength, dexterity, constitution, intelligence,
                 wisdom, charisma, speed, actions, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                enemy['id'], enemy['name'], enemy['creature_type'],
                enemy['challenge_rating'], enemy['max_hp'], enemy['armor_class'],
                enemy['initiative_bonus'], enemy['strength'], enemy['dexterity'],
                enemy['constitution'], enemy['intelligence'], enemy['wisdom'],
                enemy['charisma'], enemy['speed'], enemy['actions'],
                enemy['description']
            ))
            print(f"  ✅ Added enemy: {enemy['name']} (CR {enemy['challenge_rating']})")
        
        conn.commit()
        print(f"  📊 Total enemies: {len(enemies)}")
        print()
    except Exception as e:
        print(f"  ❌ Error loading enemies: {e}")
        print()
    
    conn.close()
    
    print("✨ Database population complete!")
    print()
    print("You can now:")
    print("  1. Start the server: cargo run --release")
    print("  2. Connect at: http://localhost:3000")
    print("  3. View characters and enemies in the interface")
    print()

if __name__ == '__main__':
    try:
        populate_database()
    except sqlite3.OperationalError as e:
        print("❌ Error: Could not access database")
        print()
        print("Make sure:")
        print("  1. The server has been run at least once (to create the database)")
        print("  2. The server is NOT currently running (close it first)")
        print(f"\nError details: {e}")
    except FileNotFoundError as e:
        print(f"❌ Error: Sample data files not found")
        print(f"Details: {e}")
        print("\nMake sure you're running this from the project root directory")










