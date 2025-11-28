@echo off
echo Populating Example Characters and Enemies...
echo.

curl -X POST http://localhost:3000/api/characters -H "Content-Type: application/json" -d "{\"id\":\"char-thorin\",\"name\":\"Thorin Ironshield\",\"player_name\":\"Example\",\"class\":\"Fighter\",\"level\":5,\"max_hp\":45,\"current_hp\":45,\"armor_class\":18,\"initiative_bonus\":2,\"strength\":16,\"dexterity\":14,\"constitution\":15,\"intelligence\":10,\"wisdom\":12,\"charisma\":8,\"speed\":30,\"proficiency_bonus\":3}"

curl -X POST http://localhost:3000/api/characters -H "Content-Type: application/json" -d "{\"id\":\"char-elara\",\"name\":\"Elara Moonwhisper\",\"player_name\":\"Example\",\"class\":\"Wizard\",\"level\":5,\"max_hp\":28,\"current_hp\":28,\"armor_class\":13,\"initiative_bonus\":3,\"strength\":8,\"dexterity\":16,\"constitution\":12,\"intelligence\":18,\"wisdom\":14,\"charisma\":10,\"speed\":30,\"proficiency_bonus\":3}"

curl -X POST http://localhost:3000/api/enemies -H "Content-Type: application/json" -d "{\"id\":\"enemy-goblin\",\"name\":\"Goblin\",\"creature_type\":\"Humanoid\",\"challenge_rating\":0.25,\"max_hp\":7,\"armor_class\":15,\"initiative_bonus\":2,\"strength\":8,\"dexterity\":14,\"constitution\":10,\"intelligence\":10,\"wisdom\":8,\"charisma\":8,\"speed\":30,\"actions\":\"{}\",\"description\":\"Small goblin warrior\"}"

curl -X POST http://localhost:3000/api/enemies -H "Content-Type: application/json" -d "{\"id\":\"enemy-orc\",\"name\":\"Orc\",\"creature_type\":\"Humanoid\",\"challenge_rating\":0.5,\"max_hp\":15,\"armor_class\":13,\"initiative_bonus\":1,\"strength\":16,\"dexterity\":12,\"constitution\":16,\"intelligence\":7,\"wisdom\":11,\"charisma\":10,\"speed\":30,\"actions\":\"{}\",\"description\":\"Savage orc warrior\"}"

echo.
echo Example data populated!
pause

