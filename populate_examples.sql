-- Example Characters
INSERT INTO characters (id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data)
VALUES 
('char-thorin', 'Thorin Ironshield', 'Example', 'Fighter', 5, 45, 45, 18, 2, 16, 14, 15, 10, 12, 8, 30, 3, NULL),
('char-elara', 'Elara Moonwhisper', 'Example', 'Wizard', 5, 28, 28, 13, 3, 8, 16, 12, 18, 14, 10, 30, 3, NULL),
('char-grimgor', 'Grimgor the Bold', 'Example', 'Barbarian', 4, 42, 42, 14, 1, 18, 12, 16, 8, 10, 9, 40, 2, NULL);

-- Example Enemies
INSERT INTO enemies (id, name, creature_type, challenge_rating, max_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, actions, description)
VALUES
('enemy-goblin', 'Goblin', 'Humanoid', 0.25, 7, 15, 2, 8, 14, 10, 10, 8, 8, 30, '{}', 'Small goblin warrior with a scimitar'),
('enemy-orc', 'Orc', 'Humanoid', 0.5, 15, 13, 1, 16, 12, 16, 7, 11, 10, 30, '{}', 'Savage orc warrior with a greataxe'),
('enemy-ogre', 'Ogre', 'Giant', 2, 59, 11, -1, 19, 8, 16, 5, 7, 7, 40, '{}', 'Large brutish ogre'),
('enemy-dragon-wyrmling', 'Red Dragon Wyrmling', 'Dragon', 4, 75, 17, 2, 19, 10, 17, 12, 11, 15, 60, '{}', 'Young red dragon');









