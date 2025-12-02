// Global state
let ws = null;
let selectedStyle = 'dnd'; // 'dnd' or 'starwars'
let sessionId = null;
let isDM = false; // THIS NEVER CHANGES AFTER CONNECTION
let myPlayerName = ''; // Store our player name
let myCharacterId = null; // Track which character this player controls
let currentMap = null;
let tokens = [];
let characters = [];
let enemies = [];
let npcs = []; // NPCs loaded from npc.json
let selectedToken = null;
let connectedPlayers = []; // Track all connected players
let combatState = {
    active: false,
    participants: [],
    currentTurn: null
};

// Track where current turn started (for movement range display)
let turnStartPosition = null;

// Initiative prompt state
let initiativePromptParticipant = null;
let initiativePromptReminderTimeout = null;

// Spell data cache
let spellCache = {};
let spellTooltipTimeout = null;

// Canvas state
let canvas = null;
let ctx = null;
let zoom = 1.0;
let panX = 0;
let panY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let gridSize = 50;
let rulerStart = null; // For ruler tool
let rulerEnd = null;
let tokenImages = {}; // Cache for character portrait images
let rulerActive = false;

// Measurement tools system
let measurementToolType = null; // 'ruler', 'cone', 'circle'
let measurementShapes = []; // Array of placed measurement shapes
let coneAngle = 60; // Default cone angle in degrees
let coneDistance = 15; // Default cone distance in feet (optional, defaults to 15ft if not set)
let circleRadius = 25; // Default circle radius in feet
let currentPlacementShape = null; // Shape being placed (cone or circle)
let conePlacementState = null; // Track cone placement: {startX, startY} or null

const syncedCharacterIds = new Set();
let techPowersCache = {};
let techPowersLoaded = false;
let forcePowersCache = {};
let forcePowersLoaded = false;

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('mapCanvas');
    if (!canvas) {
        console.error('❌ [INIT] Canvas element not found!');
        return;
    }
    ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('❌ [INIT] Could not get canvas context!');
        return;
    }
    setupCanvas();
    loadNPCs(); // Load NPCs from npc.json
});

// Connection
function connect() {
    const playerName = document.getElementById('playerName').value.trim();
    if (!playerName) {
        alert('Please enter your name');
        return;
    }
    
    // Get selected style
    selectedStyle = document.getElementById('styleSelector').value;
    console.log('🎨 Selected style:', selectedStyle);
    
    // Store style preference
    localStorage.setItem('campaignStyle', selectedStyle);
    
    myPlayerName = playerName;
    isDM = document.getElementById('isDM').checked; // Set once and NEVER change
    
    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        sendMessage({
            type: 'Connect',
            player_name: playerName,
            is_dm: isDM,
            style: selectedStyle
        });
        
        // Apply theme based on style
        applyTheme(selectedStyle);
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };
    
    ws.onclose = () => {
        updateConnectionStatus(false);
        addLogEntry('Disconnected from server', 'info');
    };
}

function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function buildCharacterUpdatePayload(character) {
    if (!character) return null;
    
    return {
        id: character.id,
        name: character.name,
        player_name: character.player_name || 'Unknown',
        class: character.class || 'Unknown',
        level: character.level || 1,
        max_hp: character.max_hp || 10,
        current_hp: character.current_hp || character.max_hp || 10,
        armor_class: character.armor_class || 10,
        initiative_bonus: character.initiative_bonus || 0,
        proficiency_bonus: character.proficiency_bonus || 2,
        strength: character.strength || 10,
        dexterity: character.dexterity || 10,
        constitution: character.constitution || 10,
        intelligence: character.intelligence || 10,
        wisdom: character.wisdom || 10,
        charisma: character.charisma || 10,
        speed: character.speed || 30,
        character_data: character.character_data || null,
        portrait_url: character.portrait_url || null
    };
}

function buildEnemyServerPayload(enemy) {
    if (!enemy) return null;
    return {
        id: enemy.id,
        name: enemy.name,
        creature_type: enemy.creature_type,
        challenge_rating: enemy.challenge_rating,
        max_hp: enemy.max_hp,
        armor_class: enemy.armor_class,
        initiative_bonus: enemy.initiative_bonus,
        strength: enemy.strength,
        dexterity: enemy.dexterity,
        constitution: enemy.constitution,
        intelligence: enemy.intelligence,
        wisdom: enemy.wisdom,
        charisma: enemy.charisma,
        speed: enemy.speed,
        actions: typeof enemy.actions === 'string' ? enemy.actions : JSON.stringify(enemy.actions || {}),
        description: enemy.description || '',
        style: enemy.style
    };
}

function normalizePowerLevel(rawLevel, category) {
    let label = '';
    let value = 0;
    if (rawLevel === null || rawLevel === undefined || rawLevel === '') {
        if (category) {
            const lowered = String(category).toLowerCase();
            if (lowered === 'cantrip' || lowered === 'atwill') {
                label = 'At-will';
                value = 0;
            } else if (/^\d+$/.test(lowered)) {
                value = parseInt(lowered, 10);
                label = String(value);
            }
        }
    } else if (typeof rawLevel === 'number') {
        value = rawLevel;
        label = String(rawLevel);
    } else {
        const levelString = String(rawLevel).trim();
        if (/^\d+$/.test(levelString)) {
            value = parseInt(levelString, 10);
            label = levelString;
        } else if (levelString === '0' || levelString.toLowerCase() === 'at-will' || levelString.toLowerCase() === 'at will') {
            value = 0;
            label = 'At-will';
        } else {
            label = levelString;
            const numericMatch = levelString.match(/\d+/);
            if (numericMatch) {
                value = parseInt(numericMatch[0], 10);
            } else {
                value = 0;
            }
        }
    }
    if (!label && value === 0) {
        label = 'At-will';
    }
    return { value, label };
}

function handleServerMessage(message) {
    console.log('Received:', message);
    
    switch (message.type) {
        case 'Connected':
            sessionId = message.session_id;
            // DON'T overwrite isDM - it's already set correctly from connect()
            updateConnectionStatus(true);
            document.getElementById('connectionModal').classList.remove('active');
            document.getElementById('mainInterface').classList.remove('hidden');
            
            // FIX: Initialize with myself first, then server will send others via PlayerJoined
            console.log('🔌 Connected! Adding self to players:', myPlayerName, 'isDM:', isDM);
            
            // Start with just me
            connectedPlayers = [{
                name: myPlayerName,
                character_name: isDM ? 'Dungeon Master' : 'No character',
                is_dm: isDM
            }];
            
            console.log('📋 Initial player list (just me):', connectedPlayers);
            renderPlayerList();
            
            if (isDM) {
                // Ensure DM controls are ALWAYS visible and NEVER show character selection
                document.getElementById('dmControls').classList.remove('hidden');
                document.getElementById('playerControls').classList.add('hidden');
                console.log('DM MODE ACTIVATED - Full controls enabled, NO character selection');
            } else {
                // Show character selection for players (not DM)
                document.getElementById('playerControls').classList.remove('hidden');
                setTimeout(() => {
                    if (!myCharacterId) { // Only show if not already selected
                        showCharacterSelect();
                    }
                }, 500);
            }
            
            document.getElementById('playerInfo').textContent = 
                `${myPlayerName} ${message.is_dm ? '(DM)' : ''}`;
            
            addLogEntry('Connected to game!', 'info');
            // Clear characters on connect to ensure fresh start
            characters = [];
            // Load data with current selected style
            loadInitialData();
            break;
            
        case 'PlayerJoined':
            // FIX: PlayerJoined is broadcast to EVERYONE (including the joiner)
            // So we receive this for OTHER players joining
            console.log('🔔 Player joined:', message.player_name, 'isDM:', message.is_dm);
            console.log('🔔 My name is:', myPlayerName);
            
            // Don't add myself again (I'm already in the list)
            if (message.player_name === myPlayerName) {
                console.log('⚠️ This is me, already in list');
                return; // Don't process my own join message
            }
            
            // Check if player already exists
            const existing = connectedPlayers.find(p => p && p.name === message.player_name);
            if (!existing) {
                const newPlayer = {
                    name: message.player_name, 
                    character_name: message.is_dm ? 'Dungeon Master' : 'No character',
                    is_dm: message.is_dm || false
                };
                connectedPlayers.push(newPlayer);
                console.log('➕ Added player:', newPlayer);
                console.log('📋 Total players now:', connectedPlayers.length);
                console.log('📋 Full list:', JSON.stringify(connectedPlayers));
            } else {
                console.log('⚠️ Player already in list:', message.player_name);
            }
            
            // ALWAYS render
            renderPlayerList();
            addLogEntry(`${message.player_name} joined the game`, 'info');
            break;
            
        case 'PlayerLeft':
            connectedPlayers = connectedPlayers.filter(p => p.name !== message.player_name);
            renderPlayerList();
            addLogEntry(`${message.player_name} left the game`, 'info');
            break;
            
        case 'PlayerList':
            console.log('📋 Received PlayerList from server:', message.players);
            // FIX: Don't overwrite local player list with server's simplified version
            // The server sends simplified data, we have more complete local data
            // So we'll skip this for now
            console.log('⚠️ Ignoring server PlayerList, using local data');
            break;
            
        case 'MapLoaded':
            currentMap = message.map;
            if (currentMap.width && currentMap.height) {
                canvas.width = currentMap.width;
                canvas.height = currentMap.height;
            }
            // Log the path we receive
            console.log('🗺️ MapLoaded - image_path:', message.map.image_path);
            loadMapImage(message.map.image_path);
            addLogEntry(`Map loaded: ${message.map.name}`, 'info');
            break;
            
        case 'MapList':
            renderSavedMapsList(message.maps || []);
            break;
            
        case 'MapSettingsChanged':
            // FIX: Apply map settings from DM
            gridSize = message.grid_size;
            canvas.width = message.width;
            canvas.height = message.height;
            if (!currentMap) {
                currentMap = { width: message.width, height: message.height, grid_size: gridSize };
            } else {
                currentMap.width = message.width;
                currentMap.height = message.height;
                currentMap.grid_size = gridSize;
            }
            // Don't reset zoom for players, just re-render
            renderCanvas();
            addLogEntry(`🗺️ Map settings updated: Grid ${gridSize}px, Size ${message.width}x${message.height}`, 'info');
            break;
            
        case 'RulerUpdate':
            // Display other players' rulers - ALWAYS show to everyone
            console.log('📏 Ruler update received:', message);
            
            if (message.start_x !== null && message.start_x !== undefined) {
                rulerStart = { x: message.start_x, y: message.start_y };
                console.log('  Ruler start set:', rulerStart);
            }
            
            if (message.end_x !== null && message.end_x !== undefined) {
                rulerEnd = { x: message.end_x, y: message.end_y };
                console.log('  Ruler end set:', rulerEnd);
                
                // Calculate and show distance for everyone
                const dx = message.end_x - message.start_x;
                const dy = message.end_y - message.start_y;
                const pixels = Math.sqrt(dx * dx + dy * dy);
                const squares = Math.round(pixels / gridSize);
                const feet = squares * 5;
                console.log(`  Distance: ${feet} feet (${squares} squares)`);
            }
            
            // If both points are null, clear the ruler
            if ((message.start_x === null || message.start_x === undefined) && 
                (message.end_x === null || message.end_x === undefined)) {
                rulerStart = null;
                rulerEnd = null;
                console.log('  Ruler cleared');
            }
            
            renderCanvas();
            break;
            
        case 'MeasurementShapeAdded':
            // Add measurement shape from another player
            if (message.shape) {
                console.log('📏 Measurement shape received:', message.shape);
                measurementShapes.push(message.shape);
                renderCanvas();
                console.log('📏 Measurement shape added. Total shapes:', measurementShapes.length);
            }
            break;
            
        case 'ClearMeasurements':
            // Clear all measurement shapes
            measurementShapes = [];
            rulerStart = null;
            rulerEnd = null;
            renderCanvas();
            console.log('🗑️ All measurements cleared');
            break;
            
        case 'AbilityCheckRolled':
            console.log('🎲 Ability check rolled:', message);
            const abilityName = message.ability.toUpperCase();
            const rollDisplay = `${message.roll} ${message.modifier >= 0 ? '+' : ''}${message.modifier}`;
            const isAbilityNat20 = message.roll === 20;
            const isAbilityNat1 = message.roll === 1;
            const abilityNatText = isAbilityNat20 ? ' ✨ NATURAL 20!' : (isAbilityNat1 ? ' ❌ NATURAL 1!' : '');
            addRollEntry(`🎲 ${message.character_name} rolled ${abilityName} check: ${rollDisplay} = ${message.total}${abilityNatText}`, isAbilityNat20, isAbilityNat1);
            
            // Play sounds for nat 20/1
            if (isAbilityNat20) {
                playNat20Sound();
            } else if (isAbilityNat1) {
                playNat1Sound();
            }
            break;
            
        case 'SavingThrowRolled':
            console.log('🛡️ Saving throw rolled:', message);
            const saveName = message.ability.toUpperCase();
            const saveDisplay = `${message.roll} ${message.modifier >= 0 ? '+' : ''}${message.modifier}`;
            const isSaveNat20 = message.roll === 20;
            const isSaveNat1 = message.roll === 1;
            const saveNatText = isSaveNat20 ? ' ✨ NATURAL 20!' : (isSaveNat1 ? ' ❌ NATURAL 1!' : '');
            addRollEntry(`🛡️ ${message.character_name} rolled ${saveName} save: ${saveDisplay} = ${message.total}${saveNatText}`, isSaveNat20, isSaveNat1);
            
            // Play sounds for nat 20/1
            if (isSaveNat20) {
                playNat20Sound();
            } else if (isSaveNat1) {
                playNat1Sound();
            }
            break;
            
        case 'SkillRolled':
            console.log('🎯 Skill check rolled:', message);
            const skillDisplay = `${message.roll} ${message.modifier >= 0 ? '+' : ''}${message.modifier}`;
            const isSkillNat20 = message.roll === 20;
            const isSkillNat1 = message.roll === 1;
            const skillNatText = isSkillNat20 ? ' ✨ NATURAL 20!' : (isSkillNat1 ? ' ❌ NATURAL 1!' : '');
            addRollEntry(`🎯 ${message.character_name} rolled ${message.skill}: ${skillDisplay} = ${message.total}${skillNatText}`, isSkillNat20, isSkillNat1);
            
            // Play sounds for nat 20/1
            if (isSkillNat20) {
                playNat20Sound();
            } else if (isSkillNat1) {
                playNat1Sound();
            }
            break;
            
        case 'AttackRolled':
            console.log('⚔️ Attack rolled:', message);
            const hitDisplay = `${message.to_hit_roll} ${message.to_hit_mod >= 0 ? '+' : ''}${message.to_hit_mod}`;
            const isCrit = message.to_hit_roll === 20;
            const isFail = message.to_hit_roll === 1;
            const critText = isCrit ? ' 🎉 CRITICAL HIT! ✨ NATURAL 20!' : (isFail ? ' ❌ CRITICAL MISS! NATURAL 1!' : '');
            addRollEntry(`⚔️ ${message.character_name} attacks with ${message.weapon}: To Hit ${hitDisplay} = ${message.to_hit_total} | Damage: ${message.damage} ${message.damage_type}${critText}`, isCrit, isFail);
            
            // Play sounds for nat 20/1
            if (isCrit) {
                playNat20Sound();
            } else if (isFail) {
                playNat1Sound();
            }
            break;
            
        case 'TokenUpdate':
            console.log('📍 ========== TOKEN UPDATE ==========');
            console.log('Received tokens:', message.tokens);
            console.log('Number of tokens:', message.tokens.length);
            
            // CRITICAL: Before updating tokens, verify NPC instances still exist in enemies array
            const npcInstancesBefore = enemies.filter(e => e && e.isNPC && e.npcData);
            console.log('📋 NPC instances before token update:', npcInstancesBefore.length);
            
            // Update tokens array - this is authoritative from server
            tokens = message.tokens || [];
            console.log('✅ Local tokens array updated. Total tokens:', tokens.length);
            if (tokens.length > 0) {
                console.log('Token details:');
                tokens.forEach((t, i) => {
                    const enemy = enemies.find(e => e.id === t.entity_id);
                    const char = characters.find(c => c.id === t.entity_id);
                    const name = enemy ? enemy.name : (char ? char.name : 'Unknown');
                    console.log(`  ${i + 1}. ${t.entity_type} at (${t.x}, ${t.y}) - entity_id: ${t.entity_id} - name: ${name}`);
                });
            }
            
            // Verify NPC instances still exist after token update
            const npcInstancesAfter = enemies.filter(e => e && e.isNPC && e.npcData);
            if (npcInstancesAfter.length !== npcInstancesBefore.length) {
                console.warn('⚠️ NPC instance count changed! Before:', npcInstancesBefore.length, 'After:', npcInstancesAfter.length);
            }
            
            // Always render canvas when tokens update - this ensures all clients see the tokens
            renderCanvas();
            
            if (combatState.active) {
                syncParticipantsWithTokens();
                updateInitiativeList();
            }
            break;
            
        case 'TokenList':
            console.log('📋 Received TokenList from server:', message.tokens);
            if (Array.isArray(message.tokens)) {
                tokens = message.tokens;
                if (combatState.active) {
                    syncParticipantsWithTokens();
                    updateInitiativeList();
                }
                renderCanvas();
            }
            break;
            
        case 'CombatStarted':
            console.log('⚔️ ========== COMBAT STARTED ==========');
            console.log('📋 Participants received:', message.participants);
            console.log('📊 Number of participants:', message.participants.length);
            
            if (!message.participants || message.participants.length === 0) {
                console.error('❌ NO PARTICIPANTS IN COMBAT!');
                alert('Error: No tokens found to start combat!');
                return;
            }
            
            combatState.active = true;
            combatState.participants = message.participants || [];
            combatState.currentTurn = null; // No turn set yet
            
            // CRITICAL: Update participant names, HP, AC, and ensure IDs match tokens
            // This ensures NPC data is preserved for DM when combat starts
            combatState.participants.forEach(participant => {
                // First, ensure participant.id matches token.id (critical for turn logic)
                const token = tokens.find(t => t.entity_id === participant.entity_id || t.id === participant.id);
                if (token && token.id && participant.id !== token.id) {
                    console.log('🔧 Fixing participant ID mismatch:', participant.id, '->', token.id);
                    participant.id = token.id; // Use token.id as the authoritative ID
                }
                
                // Update names, HP, AC from local enemies/characters arrays
                if (participant.entity_type === 'Enemy' || participant.entity_type === 'NPC') {
                    const enemy = enemies.find(e => e.id === participant.entity_id);
                    if (enemy) {
                        // Preserve NPC names - especially important for DM
                        if (enemy.name) {
                            participant.name = enemy.name;
                            console.log('✅ Updated participant name from enemy:', participant.entity_id, '->', enemy.name);
                        }
                        
                        // CRITICAL: Update HP from enemy data
                        if (enemy.max_hp !== undefined) {
                            participant.max_hp = enemy.max_hp;
                            console.log('✅ Updated participant max_hp from enemy:', participant.entity_id, '->', enemy.max_hp);
                        }
                        if (enemy.current_hp !== undefined) {
                            participant.current_hp = enemy.current_hp;
                            console.log('✅ Updated participant current_hp from enemy:', participant.entity_id, '->', enemy.current_hp);
                        } else if (enemy.max_hp !== undefined) {
                            // If current_hp not set, default to max_hp
                            participant.current_hp = enemy.max_hp;
                            console.log('✅ Set participant current_hp to max_hp:', participant.entity_id, '->', enemy.max_hp);
                        }
                        
                        // CRITICAL: Update AC from enemy data
                        if (enemy.armor_class !== undefined) {
                            participant.armor_class = enemy.armor_class;
                            console.log('✅ Updated participant armor_class from enemy:', participant.entity_id, '->', enemy.armor_class);
                        }
                        
                        // Also update initiative bonus if available
                        if (enemy.initiative_bonus !== undefined) {
                            participant.initiative_bonus = enemy.initiative_bonus;
                        }
                    } else if (isDM) {
                        // For DM, try harder to find NPC that might have lost reference
                        const npcInstance = enemies.find(e => e.id === participant.entity_id && (e.isNPC || e.npcData));
                        if (npcInstance) {
                            if (npcInstance.name) {
                                participant.name = npcInstance.name;
                                console.log('✅ Found NPC instance for participant:', participant.entity_id, '->', npcInstance.name);
                            }
                            
                            // Update HP and AC from NPC instance
                            if (npcInstance.max_hp !== undefined) {
                                participant.max_hp = npcInstance.max_hp;
                                if (npcInstance.current_hp !== undefined) {
                                    participant.current_hp = npcInstance.current_hp;
                                } else {
                                    participant.current_hp = npcInstance.max_hp;
                                }
                                console.log('✅ Updated participant HP from NPC instance:', participant.entity_id, 'HP:', participant.current_hp, '/', participant.max_hp);
                            }
                            
                            if (npcInstance.armor_class !== undefined) {
                                participant.armor_class = npcInstance.armor_class;
                                console.log('✅ Updated participant AC from NPC instance:', participant.entity_id, 'AC:', npcInstance.armor_class);
                            }
                            
                            if (npcInstance.initiative_bonus !== undefined) {
                                participant.initiative_bonus = npcInstance.initiative_bonus;
                            }
                        }
                    }
                } else if (participant.entity_type === 'Player') {
                    const char = characters.find(c => c.id === participant.entity_id);
                    if (char) {
                        if (char.name) {
                            participant.name = char.name;
                            console.log('✅ Updated participant name from character:', participant.entity_id, '->', char.name);
                        }
                        
                        // Update HP and AC from character data
                        if (char.max_hp !== undefined) {
                            participant.max_hp = char.max_hp;
                        }
                        if (char.current_hp !== undefined) {
                            participant.current_hp = char.current_hp;
                        } else if (char.max_hp !== undefined) {
                            participant.current_hp = char.max_hp;
                        }
                        
                        if (char.armor_class !== undefined) {
                            participant.armor_class = char.armor_class;
                        }
                    }
                }
            });
            
            console.log('✅ Combat state updated:', combatState);
            console.log('📋 Participants stored:', combatState.participants.length);
            syncParticipantsWithTokens();
            
            updateInitiativeList();
            updateCombatStatus();
            
            // Alert test - REMOVE THIS LATER
            if (!isDM) {
                alert('🎯 COMBAT STARTED! Combat Action Panel should appear below. If you see this alert but no panel, there is a JavaScript error.');
            }
            
            updatePlayerTurnControls(); // Show combat action panel for players
            addLogEntry('⚔️ Combat has started! Rolling for initiative...', 'info');
            
            if (isDM) {
                // Show DM controls
                document.getElementById('dmCombatControls').classList.remove('hidden');
                console.log('✅ DM combat controls shown');
                
                // Auto-roll for all enemies/NPCs automatically
                setTimeout(() => {
                    console.log('🎲 ========== DM AUTO-ROLLING FOR ENEMIES/NPCs ==========');
                    console.log('Participants to check:', combatState.participants.length);
                    
                    combatState.participants.forEach((p, index) => {
                        console.log(`Participant ${index + 1}:`, p.name, 'Type:', p.entity_type);
                        
                        const type = (p.entity_type || '').toLowerCase();
                        if (type === 'player') {
                            return; // Skip players - they roll manually
                        }
                        
                        // Get initiative bonus from participant, or look it up from enemies array
                        let bonus = typeof p.initiative_bonus === 'number' ? p.initiative_bonus : 0;
                        if (bonus === 0 || p.initiative_bonus === undefined) {
                            // Try to get from enemies array
                            const enemy = enemies.find(e => e.id === p.entity_id);
                            if (enemy && enemy.initiative_bonus !== undefined) {
                                bonus = enemy.initiative_bonus;
                                p.initiative_bonus = bonus; // Update participant
                                console.log(`   Found initiative bonus from enemy data: ${bonus}`);
                            }
                        }
                        
                        // Roll d20 + bonus
                        const roll = Math.floor(Math.random() * 20) + 1;
                        const total = roll + bonus;
                            
                        console.log(`🎲 ${p.name} auto-rolls ${roll} + ${bonus} = ${total}`);
                        console.log(`   Sending RollInitiative for entity_id: ${p.entity_id}`);

                        // Update local state immediately so tracker reflects the roll
                        p.initiative = total;
                            
                        // Send to server (server will broadcast InitiativeRolled to all clients)
                        sendMessage({
                            type: 'RollInitiative',
                            entity_id: p.entity_id,
                            roll: total
                        });
                        
                        // Note: Log entry will be added by InitiativeRolled handler to avoid duplicates
                    });

                    // Re-render list with newly rolled enemies
                    setTimeout(() => {
                        updateInitiativeList();
                        updateCombatStatus();
                    }, 100);
                }, 500);
            } else {
                // NON-DM PLAYER: Prompt for initiative
                console.log('👤 ========== PLAYER INITIATIVE PROMPT ==========');
                console.log('👤 Player name:', myPlayerName);
                console.log('👤 isDM:', isDM);
                console.log('👤 myCharacterId:', myCharacterId);
                console.log('👤 ALL PARTICIPANTS:', JSON.stringify(combatState.participants, null, 2));
                
                // Get all player participants
                const playerParticipants = combatState.participants.filter(p => p.entity_type === 'Player');
                console.log('👤 Player participants found:', playerParticipants.length);
                playerParticipants.forEach((p, i) => {
                    console.log(`   Player ${i + 1}: ${p.name} (entity_id: ${p.entity_id})`);
                });
                
                // SIMPLIFIED APPROACH: Just prompt for ANY player participant
                // The player will select which character they control
                if (playerParticipants.length > 0) {
                    console.log('✅ Found player participant(s), will prompt for initiative');
                    
                    // If player has selected a character, try to match it
                    let myParticipant = null;
                    
                    if (myCharacterId) {
                        // Try direct match
                        myParticipant = playerParticipants.find(p => p.entity_id === myCharacterId);
                        if (myParticipant) {
                            console.log('✅ Matched by entity_id');
                        } else {
                            // Try name match
                            const myChar = characters.find(c => c.id === myCharacterId);
                            if (myChar) {
                                myParticipant = playerParticipants.find(p => p.name === myChar.name);
                                if (myParticipant) {
                                    console.log('✅ Matched by character name:', myChar.name);
                                    myCharacterId = myParticipant.entity_id; // Update ID
                                }
                            }
                        }
                    }
                    
                    // If still no match and only 1 player, use that
                    if (!myParticipant && playerParticipants.length === 1) {
                        myParticipant = playerParticipants[0];
                        myCharacterId = myParticipant.entity_id; // Update ID
                        console.log('✅ Using single player participant:', myParticipant.name);
                    }
                    
                    // If we have a match, prompt immediately
                    if (myParticipant) {
                        console.log('🎲 PROMPTING FOR:', myParticipant.name, '(entity_id:', myParticipant.entity_id, ')');
                        setTimeout(() => promptMyInitiative(), 100);
                    } else {
                        // Multiple players and no match - let user choose
                        console.log('⚠️ Multiple players, need to choose');
                        setTimeout(() => {
                            const names = playerParticipants.map(p => p.name).join(', ');
                            const choice = prompt(`Which character are you playing?\n\nPlayers in combat: ${names}\n\nEnter character name:`);
                            if (choice) {
                                const chosen = playerParticipants.find(p => p.name.toLowerCase().includes(choice.toLowerCase()));
                                if (chosen) {
                                    myCharacterId = chosen.entity_id;
                                    console.log('✅ User chose:', chosen.name);
                                    promptMyInitiative();
                                } else {
                                    alert('Character not found. Ask DM to restart combat.');
                                }
                            }
                        }, 500);
                    }
                } else {
                    console.error('❌ NO PLAYER PARTICIPANTS IN COMBAT!');
                    console.error('   All participants:', combatState.participants);
                    alert('⚠️ No player characters in combat!\n\nAsk the DM to place your character token before starting combat.');
                }
            }
            break;
            
        case 'InitiativeRolled':
            console.log('🎲 ========== INITIATIVE ROLLED ==========');
            console.log('Entity ID:', message.entity_id);
            console.log('Initiative total:', message.initiative);
            console.log('Current participants:', combatState.participants.length);
            
            // Update the participant's initiative in our local state
            // Try to find by entity_id first, then by id
            let participant = combatState.participants.find(p => p.entity_id === message.entity_id);
            if (!participant) {
                // Try finding by id (token id)
                participant = combatState.participants.find(p => p.id === message.entity_id);
            }
            
            if (participant) {
                participant.initiative = message.initiative;
                console.log('✅ Updated initiative for', participant.name, 'to', message.initiative);
                console.log('   Initiative bonus:', participant.initiative_bonus);
                
                // FIX: Show this roll to ALL players!
                // Calculate what the d20 roll was (total - bonus)
                const bonus = participant.initiative_bonus || 0;
                const rollWithoutBonus = message.initiative - bonus;
                console.log(`   D20 roll was: ${rollWithoutBonus} + ${bonus} = ${message.initiative}`);
                
                // Only add log entry if not already logged (to avoid duplicates from auto-roll)
                // The auto-roll already logs it, so we skip here to avoid double logging
                if (!message.silent) {
                    const isInitiativeNat20 = rollWithoutBonus === 20;
                    const isInitiativeNat1 = rollWithoutBonus === 1;
                    const initiativeNatText = isInitiativeNat20 ? ' ✨ NATURAL 20!' : (isInitiativeNat1 ? ' ❌ NATURAL 1!' : '');
                    addRollEntry(`🎲 ${participant.name} rolled ${rollWithoutBonus} + ${bonus} = ${message.initiative} for initiative${initiativeNatText}`, isInitiativeNat20, isInitiativeNat1);
                    
                    // Play sounds for nat 20/1
                    if (isInitiativeNat20) {
                        playNat20Sound();
                    } else if (isInitiativeNat1) {
                        playNat1Sound();
                    }
                }
            } else {
                console.error('⚠️ Participant not found for entity:', message.entity_id);
                console.error('Available participants:', combatState.participants.map(p => `${p.name} (entity_id: ${p.entity_id}, id: ${p.id})`));
            }
            
            // Sort by initiative (highest first)
            combatState.participants.sort((a, b) => {
                const aInit = a.initiative || 0;
                const bInit = b.initiative || 0;
                return bInit - aInit;
            });
            console.log('📊 Sorted participants:', combatState.participants.map(p => `${p.name}:${p.initiative || 'not rolled'}`));
            
            updateInitiativeList();
            updateCombatStatus();
            break;
            
        case 'TurnChanged':
            // Clear any pending manual advance timeout
            if (window.turnAdvanceTimeout) {
                clearTimeout(window.turnAdvanceTimeout);
                window.turnAdvanceTimeout = null;
            }
            
            console.log('🔄 ========== TURN CHANGED ==========');
            console.log('   New turn ID:', message.current_turn);
            console.log('   Participant name:', message.participant_name);
            console.log('   All participants:', combatState.participants.map(p => `${p.name} (id: ${p.id}, entity_id: ${p.entity_id})`));
            
            // CRITICAL: The server sends current_turn which is the token ID
            // We need to find the participant that matches this token
            const previousTurn = combatState.currentTurn;
            console.log('   Previous turn:', previousTurn, '-> Server turn ID:', message.current_turn);
            
            // CRITICAL: Check if server is sending the same turn (this shouldn't happen)
            if (previousTurn && message.current_turn === previousTurn) {
                console.error('❌ ERROR: Server sent TurnChanged with the SAME turn ID!');
                console.error('   This means the server did not advance the turn.');
                console.error('   Manually advancing to next participant...');
                // Manually advance since server didn't
                setTimeout(() => manuallyAdvanceTurn(), 100);
                return; // Don't process this TurnChanged message
            }
            
            // First, find the token
            const turnToken = tokens.find(t => t.id === message.current_turn);
            if (!turnToken) {
                console.warn('⚠️ Turn token not found for ID:', message.current_turn);
            }
            
            // Find the participant - server sends token ID, we need to match by token.entity_id
            let turnParticipant = null;
            if (turnToken) {
                // Find participant by entity_id (the actual character/enemy ID)
                turnParticipant = combatState.participants.find(p => p.entity_id === turnToken.entity_id);
                if (turnParticipant) {
                    // Ensure participant.id matches token.id for consistency
                    turnParticipant.id = turnToken.id;
                    combatState.currentTurn = turnToken.id; // Use token ID
                    console.log('   ✅ Found participant by token:', turnParticipant.name, 'token ID:', turnToken.id);
                }
            }
            
            // Fallback: try direct ID match
            if (!turnParticipant) {
                turnParticipant = combatState.participants.find(p => p.id === message.current_turn);
                if (turnParticipant) {
                    combatState.currentTurn = turnParticipant.id;
                    console.log('   ✅ Found participant by direct ID match:', turnParticipant.name);
                }
            }
            
            // Fallback: try entity_id match
            if (!turnParticipant) {
                turnParticipant = combatState.participants.find(p => p.entity_id === message.current_turn);
                if (turnParticipant) {
                    // Find the token for this entity
                    const entityToken = tokens.find(t => t.entity_id === turnParticipant.entity_id);
                    if (entityToken) {
                        turnParticipant.id = entityToken.id;
                        combatState.currentTurn = entityToken.id;
                    } else {
                        combatState.currentTurn = turnParticipant.id || turnParticipant.entity_id;
                    }
                    console.log('   ✅ Found participant by entity_id:', turnParticipant.name);
                }
            }
            
            // Last resort: find by name
            if (!turnParticipant && message.participant_name) {
                turnParticipant = combatState.participants.find(p => p.name === message.participant_name);
                if (turnParticipant) {
                    // Find token for this participant
                    const entityToken = tokens.find(t => t.entity_id === turnParticipant.entity_id);
                    if (entityToken) {
                        turnParticipant.id = entityToken.id;
                        combatState.currentTurn = entityToken.id;
                    } else {
                        combatState.currentTurn = turnParticipant.id || turnParticipant.entity_id;
                    }
                    console.log('   ✅ Found participant by name:', turnParticipant.name);
                }
            }
            
            if (!turnParticipant) {
                console.error('❌ Turn participant not found!');
                console.error('   Server turn ID:', message.current_turn);
                console.error('   Participant name:', message.participant_name);
                console.error('   Available participants:', combatState.participants.map(p => `${p.name} (id: ${p.id}, entity_id: ${p.entity_id})`));
                console.error('   Available tokens:', tokens.map(t => `${t.entity_type} (id: ${t.id}, entity_id: ${t.entity_id})`));
                // Still set currentTurn even if participant not found
                combatState.currentTurn = message.current_turn;
            }
            
            console.log('   Final currentTurn:', combatState.currentTurn);
            
            // Save the starting position for movement range display
            let finalToken = turnToken;
            if (!finalToken && turnParticipant) {
                // Try to find token by participant's entity_id
                finalToken = tokens.find(t => t.entity_id === turnParticipant.entity_id);
            }
            if (!finalToken) {
                // Last resort: find token by currentTurn ID
                finalToken = tokens.find(t => t.id === combatState.currentTurn);
            }
            
            if (finalToken) {
                turnStartPosition = { x: finalToken.x, y: finalToken.y };
                console.log('📍 Saved turn start position:', turnStartPosition);
            } else {
                console.warn('⚠️ Could not find token for turn, movement range may not display');
            }
            
            updateInitiativeList();
            updatePlayerTurnControls();
            updateCurrentTurnDisplay(message.participant_name || (turnParticipant ? turnParticipant.name : 'Unknown'));
            addLogEntry(`⚔️ ${message.participant_name || (turnParticipant ? turnParticipant.name : 'Unknown')}'s turn`, 'info');
            renderCanvas(); // Redraw to show movement range
            break;
            
        case 'CombatEnded':
            combatState.active = false;
            combatState.participants = [];
            combatState.currentTurn = null;
            turnStartPosition = null; // Clear movement range
            updateInitiativeList();
            updateCombatStatus();
            addLogEntry('⚔️ Combat has ended', 'info');
            document.getElementById('dmCombatControls').classList.add('hidden');
            document.getElementById('playerCombatControls').classList.add('hidden');
            renderCanvas(); // Redraw to clear movement range
            break;
            
        case 'DamageDealt': {
            console.log('💥 ========== DAMAGE DEALT ==========');
            console.log('Target ID:', message.target_id);
            console.log('Damage:', message.damage);
            console.log('New HP:', message.new_hp);
            
            // Update HP in combat participants
            const damagedParticipant = combatState.participants.find(p => p.id === message.target_id);
            if (damagedParticipant) {
                console.log('✅ Found participant:', damagedParticipant.name);
                console.log('   Old HP:', damagedParticipant.current_hp);
                console.log('   New HP:', message.new_hp);
                damagedParticipant.current_hp = message.new_hp;
            }
            
            // Update character or enemy based on token type
            const damagedToken = tokens.find(t => t.id === message.target_id);
            if (damagedToken) {
                if (damagedToken.entity_type === 'Player') {
                    const char = characters.find(c => c.id === damagedToken.entity_id);
                    if (char) {
                        console.log('✅ Updating character data:', char.name);
                        char.current_hp = message.new_hp;
                        
                        // If this is MY character, show alert to player
                        if (char.id === myCharacterId) {
                            console.log('🚨 THIS IS MY CHARACTER! Showing damage alert!');
                            alert(`💥 You took ${message.damage} damage!\n\nNew HP: ${message.new_hp}/${char.max_hp}`);
                        }
                    }
                } else if (damagedToken.entity_type === 'Enemy') {
                    // Update enemy instance HP
                    const enemy = enemies.find(e => e.id === damagedToken.entity_id);
                    if (enemy) {
                        console.log('✅ Updating enemy data:', enemy.name);
                        // Update the enemy's current HP (for NPC instances, this is stored in the enemy object)
                        if (enemy.current_hp !== undefined) {
                            enemy.current_hp = message.new_hp;
                        }
                    }
                }
            }
            
            updateTokenInfo();
            updateInitiativeList();
            renderCanvas();
            
            // Get target name for log
            const targetName = damagedParticipant ? damagedParticipant.name : (damagedToken ? 'Target' : 'Unknown');
            addLogEntry(`💥 ${targetName} took ${message.damage} damage! New HP: ${message.new_hp}`, 'damage');
            break;
        }
            
        case 'HealingApplied': {
            console.log('💚 ========== HEALING APPLIED ==========');
            console.log('Target ID:', message.target_id);
            console.log('Healing:', message.healing);
            console.log('New HP:', message.new_hp);
            
            // Update HP in combat participants
            const healedParticipant = combatState.participants.find(p => p.id === message.target_id);
            if (healedParticipant) {
                console.log('✅ Found participant:', healedParticipant.name);
                console.log('   Old HP:', healedParticipant.current_hp);
                console.log('   New HP:', message.new_hp);
                healedParticipant.current_hp = message.new_hp;
            }
            
            // Update character or enemy based on token type
            const healedToken = tokens.find(t => t.id === message.target_id);
            if (healedToken) {
                if (healedToken.entity_type === 'Player') {
                    const char = characters.find(c => c.id === healedToken.entity_id);
                    if (char) {
                        console.log('✅ Updating character data:', char.name);
                        char.current_hp = message.new_hp;
                        
                        // If this is MY character, show alert to player
                        if (char.id === myCharacterId) {
                            console.log('🚨 THIS IS MY CHARACTER! Showing healing alert!');
                            alert(`💚 You were healed ${message.healing} HP!\n\nNew HP: ${message.new_hp}/${char.max_hp}`);
                        }
                    }
                } else if (healedToken.entity_type === 'Enemy') {
                    // Update enemy instance HP
                    const enemy = enemies.find(e => e.id === healedToken.entity_id);
                    if (enemy) {
                        console.log('✅ Updating enemy data:', enemy.name);
                        // Update the enemy's current HP (for NPC instances, this is stored in the enemy object)
                        if (enemy.current_hp !== undefined) {
                            enemy.current_hp = message.new_hp;
                        }
                    }
                }
            }
            
            updateTokenInfo();
            updateInitiativeList();
            renderCanvas();
            
            // Get target name for log
            const targetName = healedParticipant ? healedParticipant.name : (healedToken ? 'Target' : 'Unknown');
            addLogEntry(`💚 ${targetName} healed for ${message.healing} HP! New HP: ${message.new_hp}`, 'healing');
            break;
        }
            
        case 'CharacterList':
            // Update characters - filter by style
            const messageStyle = message.style;
            const charCount = message.characters ? message.characters.length : 0;
            console.log('📋 Received CharacterList:', charCount, 'characters, style:', messageStyle, 'my style:', selectedStyle);
            
            // STRICT FILTERING: Only accept if style matches or is not set (for backwards compat)
            if (messageStyle !== null && messageStyle !== undefined && messageStyle !== selectedStyle) {
                console.log('⚠️ IGNORING CharacterList - style mismatch:', messageStyle, '!==', selectedStyle);
                // Don't update characters at all - just break
            } else {
                // Accept the characters (style matches or not set)
                console.log('✅ Accepting CharacterList');
                characters = message.characters || [];
                renderCharacterList();
                syncCharactersWithServer();
            }
            break;
            
        case 'EnemyList':
            if (message.style && message.style !== selectedStyle) {
                console.log('⚠️ Ignoring EnemyList for style', message.style, 'while current style is', selectedStyle);
                break;
            }
            // CRITICAL: Preserve ALL NPC instances (spawned enemies with isNPC flag) when updating from server
            // NPC instances are NEVER removed or overwritten - they persist across all server updates
            const serverEnemies = (message.enemies || []).filter(enemy => enemy && (!enemy.style || enemy.style === selectedStyle));
            const npcInstances = enemies.filter(e => e && e.isNPC && e.npcData); // Keep ALL NPC instances with npcData
            
            // Create a map of existing NPC instances by ID for quick lookup and deduplication
            const npcInstanceMap = new Map();
            npcInstances.forEach(npc => {
                npcInstanceMap.set(npc.id, npc);
            });
            
            // Also check for any NPCs that might have lost their flag (defensive)
            const allPossibleNPCs = enemies.filter(e => {
                if (!e) return false;
                // If it has npcData, it's definitely an NPC
                if (e.npcData) return true;
                // If it's marked as NPC, keep it
                if (e.isNPC) return true;
                return false;
            });
            
            // Merge all NPCs (from both sources)
            allPossibleNPCs.forEach(npc => {
                if (!npcInstanceMap.has(npc.id)) {
                    // Restore NPC flag if missing
                    if (!npc.isNPC) npc.isNPC = true;
                    npcInstanceMap.set(npc.id, npc);
                }
            });
            
            const finalNPCInstances = Array.from(npcInstanceMap.values());
            
            // Merge: server templates + ALL local NPC instances
            // NPC instances are NEVER overwritten by server templates (they have unique IDs)
            enemies = [
                ...serverEnemies.filter(e => !npcInstanceMap.has(e.id)), // Server templates that aren't NPC instances
                ...finalNPCInstances // ALL NPC instances preserved
            ];
            
            console.log('✅ Merged enemies: ', serverEnemies.length, 'server templates +', finalNPCInstances.length, 'NPC instances =', enemies.length, 'total');
            console.log('📋 NPC instance IDs preserved:', finalNPCInstances.map(n => `${n.id}:${n.name}${n.npcData ? ' (has data)' : ' (no data)'}`));
            renderEnemyList();
            break;
            
        case 'SoundPlayed':
            console.log('🔊 Sound received:', message.sound_name);
            // Check if this is a critical roll sound (don't log it as a regular sound)
            const isCriticalSound = message.sound_name === 'Natural 20!' || message.sound_name === 'Natural 1!';
            if (!isCriticalSound) {
                playSoundFromServer(message.sound_id, message.sound_name, message.sound_data, message.sound_type);
            } else {
                // Play critical roll sound silently (no log entry, just play)
                try {
                    const audio = new Audio(`data:audio/${message.sound_type};base64,${message.sound_data}`);
                    audio.volume = 0.8;
                    audio.play().catch(e => {
                        console.warn('⚠️ Could not play critical roll sound:', e);
                    });
                    console.log('🎵 Playing critical roll sound:', message.sound_name);
                } catch (e) {
                    console.error('❌ Error playing critical roll sound:', e);
                }
            }
            break;
            
        case 'Error':
            alert('Error: ' + message.message);
            addLogEntry('Error: ' + message.message, 'damage');
            break;
            
        case 'AllCustomSpells':
            handleCustomSpellsList(message);
            break;
            
        case 'CustomSpellSaved':
            addLogEntry(`Custom spell/power saved`, 'success');
            // Clear spell cache for this spell name so it will be re-fetched
            const savedSpellName = message.name || message.id;
            if (savedSpellName) {
                const cacheKey = savedSpellName.toLowerCase().trim();
                delete spellCache[cacheKey];
                console.log('🗑️ Cleared cache for:', cacheKey);
            }
            // Clear all cache entries to ensure fresh lookups
            spellCache = {};
            console.log('🗑️ Cleared all spell cache');
            setTimeout(() => loadCustomSpells(), 500);
            break;
            
        case 'CustomSpellDeleted':
            addLogEntry(`Custom spell/power deleted`, 'info');
            setTimeout(() => loadCustomSpells(), 500);
            break;
            
        case 'CustomSpellData':
            // Handle custom spell lookup response
            console.log('📥 Received CustomSpellData:', message);
            
            if (message.spell && window.pendingSpellLookups) {
                const spellName = message.spell.name.toLowerCase().trim();
                let foundKey = null;
                
                console.log('🔍 Looking for pending lookup. Spell name:', spellName);
                console.log('📋 Pending lookups:', Array.from(window.pendingSpellLookups.keys()));
                
                // Check all pending lookups - try exact match first
                for (const [key, resolve] of window.pendingSpellLookups.entries()) {
                    const normalizedKey = key.toLowerCase().trim();
                    const normalizedSpellName = spellName.toLowerCase().trim();
                    
                    // Exact match (most common case)
                    if (normalizedKey === normalizedSpellName) {
                        foundKey = key;
                        console.log('✅ Exact match found:', key, '->', message.spell.name);
                        resolve(message.spell);
                        window.pendingSpellLookups.delete(key);
                        break;
                    }
                    
                    // Partial match - check if search term is in spell name or vice versa
                    if (normalizedSpellName.includes(normalizedKey) || normalizedKey.includes(normalizedSpellName)) {
                        foundKey = key;
                        console.log('✅ Partial match found:', key, '->', message.spell.name);
                        resolve(message.spell);
                        window.pendingSpellLookups.delete(key);
                        break;
                    }
                }
                
                // If no match found, resolve the first pending lookup (fallback)
                if (!foundKey && window.pendingSpellLookups.size > 0) {
                    const firstKey = window.pendingSpellLookups.keys().next().value;
                    console.log('⚠️ No match found, resolving first pending lookup as fallback:', firstKey);
                    window.pendingSpellLookups.get(firstKey)(message.spell);
                    window.pendingSpellLookups.delete(firstKey);
                }
            } else if (!message.spell) {
                // No spell found - need to resolve pending lookups
                console.log('⚠️ CustomSpellData received but no spell found');
                if (window.pendingSpellLookups && window.pendingSpellLookups.size > 0) {
                    // Try to match by the search name if provided
                    if (message.search_name) {
                        const searchKey = message.search_name.toLowerCase().trim();
                        if (window.pendingSpellLookups.has(searchKey)) {
                            console.log('✅ Resolving lookup for search_name:', searchKey);
                            window.pendingSpellLookups.get(searchKey)(null);
                            window.pendingSpellLookups.delete(searchKey);
                        } else {
                            // Resolve first pending
                            const firstKey = window.pendingSpellLookups.keys().next().value;
                            window.pendingSpellLookups.get(firstKey)(null);
                            window.pendingSpellLookups.delete(firstKey);
                        }
                    } else {
                        // Resolve all pending lookups with null
                        for (const [key, resolve] of window.pendingSpellLookups.entries()) {
                            resolve(null);
                        }
                        window.pendingSpellLookups.clear();
                    }
                }
            }
            break;
    }
}

function updateConnectionStatus(connected) {
    const status = document.getElementById('connectionStatus');
    if (connected) {
        status.textContent = 'Connected';
        status.classList.add('connected');
    } else {
        status.textContent = 'Disconnected';
        status.classList.remove('connected');
    }
}

// Load NPCs from npc.json
async function loadNPCs() {
    try {
        const response = await fetch('/static/data/npc.json');
        if (!response.ok) {
            console.warn('⚠️ Could not load npc.json:', response.status);
            return;
        }
        const data = await response.json();
        npcs = Array.isArray(data) ? data : [];
        console.log('✅ Loaded', npcs.length, 'NPCs from npc.json');
    } catch (error) {
        console.error('❌ Error loading NPCs:', error);
        npcs = [];
    }
}

function loadInitialData() {
    console.log('🔄 loadInitialData called, selectedStyle:', selectedStyle);
    // Request both enemies and characters from server using the selected style
    sendMessage({ type: 'ListEnemies', style: selectedStyle });
    
            // CRITICAL: Preserve ALL NPC instances when clearing - they'll be merged back in EnemyList handler
            const npcInstances = enemies.filter(e => e && e.isNPC && e.npcData);
            // Clear local caches so UI refreshes with correct style data
            enemies = [...npcInstances]; // Keep ALL NPC instances
            console.log('🔄 loadInitialData: Preserved', npcInstances.length, 'NPC instances');
    characters = [];
    
    if (selectedStyle === 'starwars') {
        loadTechPowers();
        loadForcePowers();
    }
    
    // Request characters from server via WebSocket (loads from database)
    sendMessage({ type: 'ListCharacters' });
    
    // Also try API as fallback (if it exists)
    fetch(`/api/characters?style=${selectedStyle}`)
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            console.log('📥 API returned', data ? data.length : 0, 'characters for style:', selectedStyle);
            // Force update with API data - this is the authoritative source
            characters = data || [];
            renderCharacterList();
            syncCharactersWithServer();
        })
        .catch(err => {
            console.error('❌ Error loading characters from API:', err);
        });
    
    // Also try WebSocket (if server supports it) - but it will be filtered by style
    // API takes precedence, so WebSocket updates are only accepted if style matches
    try {
        sendMessage({ type: 'ListCharacters' });
    } catch (e) {
        console.log('ListCharacters not supported, using API only');
    }
}

// Canvas Setup and Rendering
function setupCanvas() {
    if (!canvas) {
        console.error('❌ [SETUP CANVAS] Canvas is null!');
        return;
    }
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mouseup', onCanvasMouseUp);
    canvas.addEventListener('wheel', onCanvasWheel);
    
    // Add double-click handler for ruler tool
    canvas.addEventListener('dblclick', (e) => {
        if (rulerActive) {
            toggleRulerTool(); // Deactivate on double-click
        }
    });
    
    renderCanvas();
}

function renderCanvas() {
    if (!canvas || !ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    
    // Draw map image if loaded
    if (currentMap && currentMap.image) {
        ctx.drawImage(currentMap.image, 0, 0);
    }
    
    // Draw grid
    drawGrid();
    
    // Draw movement range (before tokens so tokens appear on top)
    drawMovementRange();
    
    // Draw tokens
    tokens.forEach(token => {
        drawToken(token);
    });
    
    // Draw all measurement shapes
    if (measurementShapes.length > 0) {
        console.log('Drawing', measurementShapes.length, 'measurement shapes');
    }
    measurementShapes.forEach((shape, index) => {
        if (shape.type === 'ruler') {
            drawRulerShape(shape);
        } else if (shape.type === 'cone') {
            drawCone(shape);
        } else if (shape.type === 'circle') {
            drawCircle(shape);
        } else {
            console.warn('Unknown shape type:', shape.type, shape);
        }
    });
    
    // Draw current ruler if active
    if (rulerActive && rulerStart) {
        drawRuler();
    }
    
    // Draw preview of cone being placed (with rotation preview)
    if (conePlacementState && measurementToolType === 'cone') {
        // Show preview cone with direction towards mouse
        if (lastMouseX !== 0 || lastMouseY !== 0) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = (lastMouseX - rect.left - panX) / zoom;
            const mouseY = (lastMouseY - rect.top - panY) / zoom;
            
            const dx = mouseX - conePlacementState.startX;
            const dy = mouseY - conePlacementState.startY;
            const direction = Math.atan2(dy, dx) * (180 / Math.PI);
            
            const previewCone = {
                type: 'cone',
                x: conePlacementState.startX,
                y: conePlacementState.startY,
                angle: coneAngle,
                direction: direction,
                distance: coneDistance > 0 ? coneDistance : 15 // Use set distance or default
            };
            drawCone(previewCone, true);
        }
    }
    
    // Draw preview of circle being placed
    if (currentPlacementShape) {
        if (currentPlacementShape.type === 'circle') {
            drawCircle(currentPlacementShape, true);
        }
    }
    
    ctx.restore();
}

function drawRuler() {
    if (!rulerStart) return;
    
    // Draw ruler line
    ctx.strokeStyle = '#ffaa44';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(rulerStart.x, rulerStart.y);
    if (rulerEnd) {
        ctx.lineTo(rulerEnd.x, rulerEnd.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw endpoints
    ctx.fillStyle = '#ffaa44';
    ctx.beginPath();
    ctx.arc(rulerStart.x, rulerStart.y, 5, 0, Math.PI * 2);
    ctx.fill();
    
    if (rulerEnd) {
        ctx.beginPath();
        ctx.arc(rulerEnd.x, rulerEnd.y, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw distance label
        const midX = (rulerStart.x + rulerEnd.x) / 2;
        const midY = (rulerStart.y + rulerEnd.y) / 2;
        const distance = calculateRulerDistance();
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(midX - 40, midY - 15, 80, 30);
        ctx.fillStyle = '#ffaa44';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${distance.feet} ft`, midX, midY + 5);
    }
}

function drawRulerShape(shape) {
    if (!shape.start || !shape.end) return;
    
    ctx.strokeStyle = '#ffaa44';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.end.x, shape.end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw endpoints
    ctx.fillStyle = '#ffaa44';
    ctx.beginPath();
    ctx.arc(shape.start.x, shape.start.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(shape.end.x, shape.end.y, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw distance label
    const midX = (shape.start.x + shape.end.x) / 2;
    const midY = (shape.start.y + shape.end.y) / 2;
    const dx = shape.end.x - shape.start.x;
    const dy = shape.end.y - shape.start.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    const squares = pixelDistance / gridSize;
    const feet = Math.round(squares * 5);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(midX - 40, midY - 15, 80, 30);
    ctx.fillStyle = '#ffaa44';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${feet} ft`, midX, midY + 5);
}

function drawCone(shape, isPreview = false) {
    if (shape.x === undefined || shape.x === null || shape.y === undefined || shape.y === null) {
        console.warn('drawCone: Invalid shape coordinates', shape);
        return;
    }
    
    const x = shape.x;
    const y = shape.y;
    const angle = shape.angle || 60;
    const direction = shape.direction || 0;
    const distanceFeet = shape.distance || 15; // Distance in feet, default to 15ft
    
    // Convert angle from degrees to radians
    const halfAngle = (angle * Math.PI) / 180 / 2;
    const directionRad = (direction * Math.PI) / 180;
    
    // Calculate cone length (convert feet to squares, then to pixels)
    // Each square is 5 feet, so divide by 5 to get squares
    const lengthInSquares = distanceFeet / 5;
    const length = lengthInSquares * gridSize;
    
    // Calculate cone tip and edges
    const tipX = x;
    const tipY = y;
    
    // Calculate direction vector
    const dirX = Math.cos(directionRad);
    const dirY = Math.sin(directionRad);
    
    // Calculate base points
    const baseX = tipX + dirX * length;
    const baseY = tipY + dirY * length;
    
    // Calculate perpendicular vector for base width
    const perpX = -dirY;
    const perpY = dirX;
    const baseWidth = Math.tan(halfAngle) * length;
    
    const baseLeftX = baseX + perpX * baseWidth;
    const baseLeftY = baseY + perpY * baseWidth;
    const baseRightX = baseX - perpX * baseWidth;
    const baseRightY = baseY - perpY * baseWidth;
    
    // Draw cone shape
    ctx.fillStyle = isPreview ? 'rgba(68,255,68,0.2)' : 'rgba(68,255,68,0.15)';
    ctx.strokeStyle = isPreview ? '#44ff44' : '#66ff66';
    ctx.lineWidth = isPreview ? 2 : 2;
    
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseLeftX, baseLeftY);
    ctx.lineTo(baseRightX, baseRightY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Draw tip point
    ctx.fillStyle = '#44ff44';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw label
    if (!isPreview) {
        const labelText = distanceFeet ? `${angle}° ${distanceFeet}ft Cone` : `${angle}° Cone`;
        const labelWidth = labelText.length * 7; // Approximate width
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(baseX - labelWidth / 2, baseY - 15, labelWidth, 30);
        ctx.fillStyle = '#44ff44';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(labelText, baseX, baseY + 5);
    }
}

function drawCircle(shape, isPreview = false) {
    if (shape.x === undefined || shape.x === null || shape.y === undefined || shape.y === null) {
        console.warn('drawCircle: Invalid shape coordinates', shape);
        return;
    }
    
    const x = shape.x;
    const y = shape.y;
    const radius = shape.radius || (circleRadius * gridSize);
    
    // Draw circle
    ctx.fillStyle = isPreview ? 'rgba(68,170,255,0.2)' : 'rgba(68,170,255,0.15)';
    ctx.strokeStyle = isPreview ? '#4a9eff' : '#66aaff';
    ctx.lineWidth = isPreview ? 2 : 2;
    
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Draw center point
    ctx.fillStyle = '#4a9eff';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw label
    if (!isPreview) {
        // Use stored radiusFeet if available, otherwise calculate from pixels
        const radiusFeet = shape.radiusFeet || Math.round((radius / gridSize) * 5);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - 50, y - 15, 100, 30);
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${radiusFeet}ft radius`, x, y + 5);
    }
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    
    const width = currentMap ? currentMap.width : canvas.width;
    const height = currentMap ? currentMap.height : canvas.height;
    
    // Vertical lines
    for (let x = 0; x <= width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = 0; y <= height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

// Draw movement range for current turn
function drawMovementRange() {
    if (!combatState.active) return;
    if (!combatState.currentTurn) return;
    if (!turnStartPosition) return; // No saved position
    
    // Find the current participant
    const currentParticipant = combatState.participants.find(p => p.id === combatState.currentTurn);
    if (!currentParticipant) {
        console.warn('⚠️ drawMovementRange: Participant not found for currentTurn:', combatState.currentTurn);
        return;
    }
    
    // For non-DM players, only show if it's THEIR character's turn
    if (!isDM) {
        if (currentParticipant.entity_type !== 'Player' || currentParticipant.entity_id !== myCharacterId) {
            return;
        }
    }
    // For DM: show for both Players and NPCs/Enemies
    
    let movementSpeed = 30; // Default 30 feet
    
    // Get movement speed from character or enemy
    if (currentParticipant.entity_type === 'Player') {
        const character = characters.find(c => c.id === currentParticipant.entity_id);
        if (character) {
            movementSpeed = character.speed || 30;
        }
    } else if (currentParticipant.entity_type === 'Enemy' || currentParticipant.entity_type === 'NPC') {
        // For NPCs/Enemies, get speed from enemies array
        const enemy = enemies.find(e => e.id === currentParticipant.entity_id);
        if (enemy) {
            movementSpeed = enemy.speed || 30;
        }
    }
    
    const movementSquares = Math.floor(movementSpeed / 5); // Each square = 5 feet
    
    // Use the SAVED starting position, not current token position
    const startX = Math.floor(turnStartPosition.x);
    const startY = Math.floor(turnStartPosition.y);
    
    // Calculate reachable squares from starting position
    const reachable = calculateReachableSquares(startX, startY, movementSquares);
    
    // Draw green highlights
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    reachable.forEach(({x, y}) => {
        ctx.fillRect(x * gridSize, y * gridSize, gridSize, gridSize);
    });
}

// Calculate which squares are reachable within movement range
// Uses D&D 5e rules: every other diagonal costs 10 feet (2 squares)
function calculateReachableSquares(startX, startY, maxSquares) {
    const reachable = [];
    const visited = new Set();
    const queue = [{x: startX, y: startY, cost: 0, diagCount: 0}];
    
    visited.add(`${startX},${startY}`);
    
    while (queue.length > 0) {
        const current = queue.shift();
        reachable.push({x: current.x, y: current.y});
        
        // Check all 8 directions (4 cardinal + 4 diagonal)
        const directions = [
            {dx: 0, dy: -1, isDiag: false},  // North
            {dx: 1, dy: 0, isDiag: false},   // East
            {dx: 0, dy: 1, isDiag: false},   // South
            {dx: -1, dy: 0, isDiag: false},  // West
            {dx: 1, dy: -1, isDiag: true},   // NE
            {dx: 1, dy: 1, isDiag: true},    // SE
            {dx: -1, dy: 1, isDiag: true},   // SW
            {dx: -1, dy: -1, isDiag: true},  // NW
        ];
        
        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;
            const key = `${newX},${newY}`;
            
            // Check bounds
            const maxGridX = Math.floor(canvas.width / gridSize);
            const maxGridY = Math.floor(canvas.height / gridSize);
            if (newX < 0 || newY < 0 || newX >= maxGridX || newY >= maxGridY) continue;
            
            // Check if already visited
            if (visited.has(key)) continue;
            
            // Calculate movement cost using D&D 5e diagonal rules
            // Every other diagonal costs 2 squares (10 feet) instead of 1 (5 feet)
            let moveCost = 1;
            let newDiagCount = current.diagCount;
            
            if (dir.isDiag) {
                newDiagCount++;
                // Every other diagonal costs 2 squares
                if (newDiagCount % 2 === 0) {
                    moveCost = 2;
                }
            } else {
                // Reset diagonal count when moving cardinally
                newDiagCount = 0;
            }
            
            const newCost = current.cost + moveCost;
            
            // Check if within movement range
            if (newCost <= maxSquares) {
                visited.add(key);
                queue.push({x: newX, y: newY, cost: newCost, diagCount: newDiagCount});
            }
        }
    }
    
    return reachable;
}

function drawToken(token) {
    const size = gridSize * token.size;
    // FIX: Position tokens inside grid squares, not on gridlines
    const x = token.x * gridSize + gridSize / 2;
    const y = token.y * gridSize + gridSize / 2;
    
    // Check if token has a portrait (player or enemy)
    let hasPortrait = false;
    let portraitImg = null;
    let borderColor = '#fff';
    
    if (token.entity_type === 'Player') {
        const char = characters.find(c => c.id === token.entity_id);
        if (char && char.portrait_url) {
            hasPortrait = true;
            borderColor = '#44ff44'; // Green for players
            if (!tokenImages[char.id]) {
                tokenImages[char.id] = new Image();
                tokenImages[char.id].src = char.portrait_url;
            }
            portraitImg = tokenImages[char.id];
        }
    } else if (token.entity_type === 'Enemy') {
        // Check enemies list for portrait
        const enemy = enemies.find(e => e.id === token.entity_id);
        if (enemy && enemy.local_portrait) {
            hasPortrait = true;
            borderColor = '#ff4444'; // Red for enemies
            if (!tokenImages[enemy.id]) {
                tokenImages[enemy.id] = new Image();
                tokenImages[enemy.id].src = enemy.local_portrait;
                tokenImages[enemy.id].onload = () => renderCanvas();
            }
            portraitImg = tokenImages[enemy.id];
        }
    }
    
    if (hasPortrait && portraitImg && portraitImg.complete) {
        // Draw portrait image as circular token
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        
        // Draw image centered in circle
        ctx.drawImage(portraitImg, x - size / 2, y - size / 2, size, size);
        
        ctx.restore();
        
        // Border based on type
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 3;
        ctx.stroke();
    } else {
        // Fallback: colored circle (no portrait available or not loaded yet)
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        
        // Color based on type
        switch (token.entity_type) {
            case 'Player':
                ctx.fillStyle = 'rgba(68, 255, 68, 0.7)';
                break;
            case 'Enemy':
                ctx.fillStyle = 'rgba(255, 68, 68, 0.7)';
                break;
            case 'NPC':
                ctx.fillStyle = 'rgba(255, 170, 68, 0.7)';
                break;
            case 'Object':
                ctx.fillStyle = 'rgba(170, 170, 170, 0.7)';
                break;
        }
        
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Selection highlight
    if (selectedToken && selectedToken.id === token.id) {
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 4;
        ctx.stroke();
    }
    
    // FIX: Draw character/enemy name instead of ID
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    
    let displayName = 'Unknown';
    if (token.entity_type === 'Player') {
        const char = characters.find(c => c.id === token.entity_id);
        displayName = char ? char.name : 'Player';
    } else if (token.entity_type === 'Enemy') {
        // FIX: Look up enemy name - prioritize NPC instances, then combat participants, then enemies list
        // For NPCs, always use the stored name from the enemies array
        let enemy = enemies.find(e => e.id === token.entity_id);
        
        // If found and it's an NPC, use its name directly
        if (enemy && enemy.isNPC && enemy.npcData) {
            displayName = enemy.name; // NPC instance name (e.g., "Stormtrooper 1")
        } else {
            // Check combat participants (for enemies in combat)
            const participant = combatState.participants.find(p => p.entity_id === token.entity_id);
            if (participant) {
                displayName = participant.name; // Use combat participant name
            } else if (enemy) {
                // Regular enemy from enemies list
                displayName = enemy.name;
            } else {
                // Fallback: try to find by checking if it's an NPC that might have lost its reference
                // This is a defensive check for DM
                if (isDM) {
                    // For DM, try harder to find the name - check all NPCs
                    const npcInstance = enemies.find(e => e.id === token.entity_id && (e.isNPC || e.npcData));
                    if (npcInstance) {
                        displayName = npcInstance.name;
                    } else {
                        displayName = 'Enemy'; // Last resort fallback
                    }
                } else {
                    displayName = 'Enemy';
                }
            }
        }
    } else {
        displayName = token.entity_type;
    }
    
    ctx.fillText(displayName, x, y + size / 2 + 18);
    ctx.shadowBlur = 0;
}

function loadMapImage(imagePath) {
    if (!imagePath) {
        console.error('❌ No image path provided');
        return;
    }
    
    const img = new Image();
    img.onload = () => {
        currentMap.image = img;
        renderCanvas();
    };
    img.onerror = () => {
        console.error('❌ Failed to load map image:', imagePath);
    };
    
    // FIX: Use window.location.origin to create absolute URL
    // This prevents the browser from treating 'static' as a hostname
    let path = String(imagePath).trim();
    
    // Remove any existing protocol/hostname
    if (path.startsWith('http://') || path.startsWith('https://')) {
        try {
            const url = new URL(path);
            path = url.pathname;
        } catch (e) {
            path = path.replace(/^https?:\/\/[^\/]+/, '');
        }
    } else if (path.startsWith('//')) {
        path = path.replace(/^\/\/[^\/]+/, '');
    }
    
    // Ensure it starts with /
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    
    // Use current origin + path to create absolute URL
    // This ensures it's always relative to the current server
    img.src = window.location.origin + path;
}

// Canvas Interaction
function onCanvasMouseDown(e) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - panX) / zoom;
    const mouseY = (e.clientY - rect.top - panY) / zoom;
    
    // Measurement tools take priority - prevent ALL token interactions
    if (measurementToolType) {
        // Always prevent default for clicks when using measurement tools
        // But allow normal scrolling when not clicking
        e.preventDefault();
        e.stopPropagation();
        
        // Ensure we're not dragging tokens when using measurement tools
        isDragging = false;
        selectedToken = null;
        
        if (measurementToolType === 'ruler') {
            if (!rulerStart) {
                // Remove any existing ruler shapes before placing a new one
                measurementShapes = measurementShapes.filter(shape => shape.type !== 'ruler');
                
                rulerStart = { x: mouseX, y: mouseY };
                sendMessage({
                    type: 'RulerUpdate',
                    start_x: mouseX,
                    start_y: mouseY,
                    end_x: null,
                    end_y: null
                });
                addLogEntry('Ruler: First point set. Click second point.', 'info');
                renderCanvas();
            } else {
                rulerEnd = { x: mouseX, y: mouseY };
                // Save ruler as a shape (old rulers already removed above)
                const rulerShape = {
                    type: 'ruler',
                    start: { x: rulerStart.x, y: rulerStart.y },
                    end: { x: mouseX, y: mouseY }
                };
                measurementShapes.push(rulerShape);
                
                sendMessage({
                    type: 'MeasurementShapeAdded',
                    shape: rulerShape
                });
                
                const distance = calculateRulerDistance();
                addLogEntry(`📏 Distance: ${distance.feet} feet (${distance.squares} squares)`, 'info');
                rulerStart = null;
                rulerEnd = null;
                renderCanvas();
            }
        } else if (measurementToolType === 'cone') {
            // First click: place cone tip, second click: set direction
            if (!conePlacementState) {
                // Remove any existing cone shapes before placing a new one
                measurementShapes = measurementShapes.filter(shape => shape.type !== 'cone');
                
                // First click - place the cone tip
                conePlacementState = { startX: mouseX, startY: mouseY };
                addLogEntry('🔺 Cone tip placed. Click again to set direction, or move mouse to preview rotation.', 'info');
                renderCanvas();
            } else {
                // Second click - set direction based on angle from tip to click position
                const dx = mouseX - conePlacementState.startX;
                const dy = mouseY - conePlacementState.startY;
                const direction = Math.atan2(dy, dx) * (180 / Math.PI); // Convert to degrees
                
                const coneShape = {
                    type: 'cone',
                    x: conePlacementState.startX,
                    y: conePlacementState.startY,
                    angle: coneAngle,
                    direction: direction,
                    distance: coneDistance > 0 ? coneDistance : 15 // Store distance in feet, default to 15
                };
                measurementShapes.push(coneShape);
                
                sendMessage({
                    type: 'MeasurementShapeAdded',
                    shape: coneShape
                });
                
                const distanceText = coneDistance > 0 ? `${coneDistance}ft` : '15ft (default)';
                addLogEntry(`🔺 Cone placed (${coneAngle}° at ${Math.round(direction)}°, ${distanceText})`, 'info');
                conePlacementState = null;
                renderCanvas();
            }
        } else if (measurementToolType === 'circle') {
            // Remove any existing circle shapes before placing a new one
            measurementShapes = measurementShapes.filter(shape => shape.type !== 'circle');
            
            // Place circle at click location
            // Convert feet to pixels: circleRadius is in feet, each square is 5 feet
            const radiusInSquares = circleRadius / 5;
            const radiusInPixels = radiusInSquares * gridSize;
            
            const circleShape = {
                type: 'circle',
                x: mouseX,
                y: mouseY,
                radius: radiusInPixels,
                radiusFeet: circleRadius // Store feet for display
            };
            measurementShapes.push(circleShape);
            
            sendMessage({
                type: 'MeasurementShapeAdded',
                shape: JSON.parse(JSON.stringify(circleShape)) // Ensure it's a plain object
            });
            
            addLogEntry(`⭕ Circle placed (${circleRadius}ft radius)`, 'info');
            renderCanvas();
        }
        return; // Stop here - don't process token clicks
    }
    
    // Check if clicking on a token
    let clickedToken = null;
    for (let token of tokens) {
        const tokenX = token.x * gridSize + gridSize / 2;
        const tokenY = token.y * gridSize + gridSize / 2;
        const size = gridSize * token.size / 2;
        
        const dist = Math.sqrt(Math.pow(mouseX - tokenX, 2) + Math.pow(mouseY - tokenY, 2));
        if (dist <= size) {
            clickedToken = token;
            break;
        }
    }
    
    if (clickedToken) {
        selectedToken = clickedToken;
        updateTokenInfo();
        renderCanvas();
    } else {
        isDragging = true;
        dragStartX = e.clientX - panX;
        dragStartY = e.clientY - panY;
    }
}

function calculateRulerDistance() {
    if (!rulerStart || !rulerEnd) return { feet: 0, squares: 0 };
    
    const dx = rulerEnd.x - rulerStart.x;
    const dy = rulerEnd.y - rulerStart.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    const squares = pixelDistance / gridSize;
    const feet = Math.round(squares * 5); // Each square is 5 feet
    
    return { feet, squares: Math.round(squares * 10) / 10 };
}

function onCanvasMouseMove(e) {
    // Always track mouse position for cone preview
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    
    // If any measurement tool is active, prevent token dragging
    if (measurementToolType) {
        // Redraw if placing a cone to show rotation preview
        if (conePlacementState && measurementToolType === 'cone') {
            renderCanvas();
        }
        // Prevent token dragging when measurement tools are active
        isDragging = false;
        return;
    }
    
    // Normal token/pan dragging when no measurement tool is active
    if (isDragging) {
        panX = e.clientX - dragStartX;
        panY = e.clientY - dragStartY;
        renderCanvas();
    } else if (selectedToken) {
        // Show cursor for moving tokens
        canvas.style.cursor = 'move';
    }
}

function onCanvasMouseUp(e) {
    // If any measurement tool is active, don't process token movement
    if (measurementToolType) {
        isDragging = false;
        return;
    }
    
    if (isDragging) {
        isDragging = false;
    } else if (selectedToken && e.button === 0) {
        // FIX: DM can move any token, players restricted
        if (!isDM) {
            // Players can only move their own character token
            if (!myCharacterId || selectedToken.entity_id !== myCharacterId) {
                alert("You can only move your own character!");
                addLogEntry("You can only move your own character", "damage");
                return;
            }
            
            // Check if it's their turn in combat
            if (combatState.active && combatState.currentTurn !== selectedToken.id) {
                alert("It's not your turn!");
                addLogEntry("Wait for your turn to move", "info");
                return;
            }
        }
        // DM has no restrictions - can move any token anytime
        
        // Move selected token
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - panX) / zoom;
        const mouseY = (e.clientY - rect.top - panY) / zoom;
        
        const gridX = Math.floor(mouseX / gridSize);
        const gridY = Math.floor(mouseY / gridSize);
        
        sendMessage({
            type: 'MoveToken',
            token_id: selectedToken.id,
            x: gridX,
            y: gridY
        });
        
        addLogEntry(`Moved to (${gridX}, ${gridY})`, 'info');
    }
}

function onCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoom *= delta;
    zoom = Math.max(0.5, Math.min(3, zoom));
    renderCanvas();
}

function zoomIn() {
    zoom = Math.min(3, zoom * 1.2);
    renderCanvas();
}

function zoomOut() {
    zoom = Math.max(0.5, zoom * 0.8);
    renderCanvas();
}

function resetZoom() {
    zoom = 1.0;
    panX = 0;
    panY = 0;
    renderCanvas();
}

// Token Info
function updateTokenInfo() {
    const infoDiv = document.getElementById('tokenInfo');
    const actionsDiv = document.getElementById('tokenActions');
    
    if (!selectedToken) {
        infoDiv.innerHTML = 'No token selected';
        actionsDiv.classList.add('hidden');
        return;
    }
    
    let info = '';
    let entityData = null;
    
    // FIX: Find character or enemy data and get current HP from combat if active
    if (selectedToken.entity_type === 'Player') {
        entityData = characters.find(c => c.id === selectedToken.entity_id);
        if (entityData) {
            // Get HP from combat participant if in combat (more up-to-date)
            const participant = combatState.participants.find(p => p.id === selectedToken.id);
            const currentHp = participant ? participant.current_hp : entityData.current_hp;
            const maxHp = participant ? participant.max_hp : entityData.max_hp;
            
            info += `<h4>⚔️ ${entityData.name}</h4>`;
            info += `<p style="font-size: 11px; opacity: 0.8; margin: 4px 0 12px 0;">${entityData.class} Level ${entityData.level}</p>`;
            info += `<div class="token-stat"><span>Player:</span><span>${entityData.player_name}</span></div>`;
            info += `<div class="token-stat"><span>HP:</span><span style="color: ${currentHp < maxHp * 0.3 ? '#ff4444' : '#44ff44'}; font-weight: bold;">${currentHp}/${maxHp}</span></div>`;
            const hpPercent = (currentHp / maxHp) * 100;
            info += `<div class="hp-bar"><div class="hp-fill" style="width: ${hpPercent}%"></div></div>`;
            info += `<div class="token-stat"><span>AC:</span><span>${entityData.armor_class}</span></div>`;
            info += `<div class="token-stat"><span>Initiative:</span><span>+${entityData.initiative_bonus}</span></div>`;
            info += `<div class="token-stat"><span>Speed:</span><span>${entityData.speed} ft</span></div>`;
            info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
            info += `<div class="token-stat"><span>STR:</span><span>${entityData.strength}</span></div>`;
            info += `<div class="token-stat"><span>DEX:</span><span>${entityData.dexterity}</span></div>`;
            info += `<div class="token-stat"><span>CON:</span><span>${entityData.constitution}</span></div>`;
            info += `<div class="token-stat"><span>INT:</span><span>${entityData.intelligence}</span></div>`;
            info += `<div class="token-stat"><span>WIS:</span><span>${entityData.wisdom}</span></div>`;
            info += `<div class="token-stat"><span>CHA:</span><span>${entityData.charisma}</span></div>`;
        }
    } else if (selectedToken.entity_type === 'Enemy') {
        const enemy = enemies.find(e => e.id === selectedToken.entity_id);
        const instance = combatState.participants.find(p => p.id === selectedToken.id);
        
        if (enemy || instance) {
            const displayName = instance ? instance.name : (enemy ? enemy.name : 'Unknown');
            const currentHp = instance ? instance.current_hp : (enemy ? enemy.max_hp : 0);
            const maxHp = instance ? instance.max_hp : (enemy ? enemy.max_hp : 0);
            const ac = instance ? instance.armor_class : (enemy ? enemy.armor_class : 0);
            
            info += `<h4>👹 ${displayName}</h4>`;
            if (enemy) {
                info += `<p style="font-size: 11px; opacity: 0.8; margin: 4px 0 12px 0;">${enemy.creature_type} (CR ${enemy.challenge_rating})</p>`;
            }
            info += `<div class="token-stat"><span>HP:</span><span style="color: ${currentHp < maxHp * 0.3 ? '#ff4444' : '#ff8844'}; font-weight: bold;">${currentHp}/${maxHp}</span></div>`;
            const hpPercent = (currentHp / maxHp) * 100;
            info += `<div class="hp-bar"><div class="hp-fill" style="width: ${hpPercent}%"></div></div>`;
            info += `<div class="token-stat"><span>AC:</span><span>${ac}</span></div>`;
            
            if (enemy) {
                info += `<div class="token-stat"><span>Initiative:</span><span>+${enemy.initiative_bonus}</span></div>`;
                info += `<div class="token-stat"><span>Speed:</span><span>${enemy.speed} ft</span></div>`;
                info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
                info += `<div class="token-stat"><span>STR:</span><span>${enemy.strength}</span></div>`;
                info += `<div class="token-stat"><span>DEX:</span><span>${enemy.dexterity}</span></div>`;
                info += `<div class="token-stat"><span>CON:</span><span>${enemy.constitution}</span></div>`;
                info += `<div class="token-stat"><span>INT:</span><span>${enemy.intelligence}</span></div>`;
                info += `<div class="token-stat"><span>WIS:</span><span>${enemy.wisdom}</span></div>`;
                info += `<div class="token-stat"><span>CHA:</span><span>${enemy.charisma}</span></div>`;
                if (enemy.description) {
                    info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
                    info += `<p style="font-size: 11px; margin-top: 8px;">${enemy.description.substring(0, 200)}${enemy.description.length > 200 ? '...' : ''}</p>`;
                }
                // Add button to view full character sheet if this is an NPC
                if (enemy.isNPC && enemy.npcData) {
                    info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
                    info += `<button onclick="showNPCCharacterSheet('${selectedToken.entity_id}')" style="width: 100%; padding: 8px; background: #4a9eff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; margin-top: 10px;">📋 View Full Character Sheet</button>`;
                }
            }
        }
    } else {
        info += `<h4>${selectedToken.entity_type}</h4>`;
        info += `<div class="token-stat"><span>Type:</span><span>${selectedToken.entity_type}</span></div>`;
        info += `<div class="token-stat"><span>Position:</span><span>(${selectedToken.x}, ${selectedToken.y})</span></div>`;
    }
    
    // Add combat info if in combat
    const participant = combatState.participants.find(p => p.id === selectedToken.id);
    if (participant && combatState.active) {
        info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
        info += `<p style="font-size: 12px; font-weight: bold; color: #4a9eff; margin-bottom: 8px;">⚔️ Combat Status</p>`;
        info += `<div class="token-stat"><span>Initiative Roll:</span><span>${participant.initiative}</span></div>`;
        if (combatState.currentTurn === selectedToken.id) {
            info += `<p style="color: #ffaa44; font-weight: bold; margin-top: 8px;">🎯 CURRENT TURN!</p>`;
        }
    }
    
    infoDiv.innerHTML = info;
    
    // FIX: Always show damage/heal buttons for DM when token selected
    if (isDM && selectedToken) {
        actionsDiv.classList.remove('hidden');
    } else {
        actionsDiv.classList.add('hidden');
    }
}

// Combat
function toggleCombat() {
    console.log('========== TOGGLE COMBAT CLICKED ==========');
    console.log('Combat currently active:', combatState.active);
    console.log('Tokens array:', tokens);
    console.log('Tokens length:', tokens.length);
    
    if (combatState.active) {
        if (confirm('End combat?')) {
            sendMessage({ type: 'EndCombat' });
        }
    } else {
        if (!tokens || tokens.length === 0) {
            console.warn('⚠️ No tokens detected locally when starting combat. Attempting to start anyway.');
            addLogEntry('⚠️ No tokens detected locally — requesting combat start anyway.', 'warning');
            requestTokenRefresh();
        }
        console.log('✅ Found', tokens.length, 'tokens, starting combat...');
        tokens.forEach((t, i) => {
            console.log(`  Token ${i + 1}: ${t.entity_type} (${t.entity_id})`);
        });
        
        sendMessage({ type: 'StartCombat' });
        
        // Enemy auto-rolling and player prompting happens in CombatStarted handler
        console.log('🎯 Combat toggle sent to server, waiting for CombatStarted response...');
    }
}

// FIX: Prompt this player for their character's initiative
function promptMyInitiative() {
    console.log('========== PROMPT MY INITIATIVE ==========');
    console.log('isDM:', isDM);
    console.log('myCharacterId:', myCharacterId);
    console.log('Combat active:', combatState.active);
    console.log('Participants:', combatState.participants.length);
    console.log('All participants:', combatState.participants);
    
    // Skip if DM or no character assigned
    if (isDM) {
        console.log('✅ Skipping initiative prompt - user is DM');
        return;
    }
    
    if (!myCharacterId) {
        console.error('❌ No character selected!');
        alert('You need to select a character first!');
        return;
    }
    
    // Find my participant in combat
    const myParticipant = combatState.participants.find(p => p.entity_id === myCharacterId);
    if (!myParticipant) {
        console.error('❌ My character is not in combat!');
        console.error('My character ID:', myCharacterId);
        console.error('Available participants:', combatState.participants.map(p => `${p.name} (entity_id: ${p.entity_id})`));
        alert(`Your character is not in combat! Make sure your token is placed on the map before combat starts.`);
        return;
    }
    
    console.log('✅ Found my participant:', myParticipant);
    console.log('   Name:', myParticipant.name);
    console.log('   Initiative bonus:', myParticipant.initiative_bonus);
    
    // IMMEDIATE prompt (no setTimeout delay)
    console.log('🎲 SHOWING INITIATIVE PROMPT NOW...');
    
    showInitiativePrompt(myParticipant);
}

function showInitiativePrompt(participant) {
    const modal = document.getElementById('initiativePromptModal');
    const textEl = document.getElementById('initiativePromptText');
    const inputEl = document.getElementById('initiativeRollInput');
    const previewEl = document.getElementById('initiativeTotalPreview');
    if (!modal || !textEl || !inputEl || !previewEl) {
        console.error('❌ Initiative prompt elements missing');
        return;
    }

    clearTimeout(initiativePromptReminderTimeout);
    initiativePromptParticipant = participant;

    textEl.innerHTML = `<strong>${participant.name}</strong><br>Initiative bonus: <strong>+${participant.initiative_bonus}</strong>`;
    inputEl.value = '';
    previewEl.textContent = `Total: +${participant.initiative_bonus}`;

    modal.classList.add('active');
    setTimeout(() => inputEl.focus(), 50);
}

function updateInitiativeTotalPreview() {
    const participant = initiativePromptParticipant;
    if (!participant) return;
    const inputEl = document.getElementById('initiativeRollInput');
    const previewEl = document.getElementById('initiativeTotalPreview');
    if (!inputEl || !previewEl) return;

    const roll = parseInt(inputEl.value, 10);
    if (isNaN(roll)) {
        previewEl.textContent = `Total: +${participant.initiative_bonus}`;
    } else {
        const total = roll + participant.initiative_bonus;
        previewEl.textContent = `Total: ${roll} + ${participant.initiative_bonus} = ${total}`;
    }
}

function rollInitiativeInPrompt() {
    const inputEl = document.getElementById('initiativeRollInput');
    if (!inputEl) return;
    const roll = Math.floor(Math.random() * 20) + 1;
    inputEl.value = roll;
    updateInitiativeTotalPreview();
}

function submitInitiativePrompt() {
    const participant = initiativePromptParticipant;
    if (!participant) {
        console.warn('⚠️ No participant for initiative submission');
        return;
    }

    const inputEl = document.getElementById('initiativeRollInput');
    if (!inputEl) return;

    const roll = parseInt(inputEl.value, 10);
    if (isNaN(roll) || roll < 1 || roll > 20) {
        alert('Please enter a number between 1 and 20, or use the Roll button.');
        inputEl.focus();
        return;
    }

    const total = roll + participant.initiative_bonus;
    closeModal('initiativePromptModal');
    initiativePromptParticipant = null;
    clearTimeout(initiativePromptReminderTimeout);

    console.log(`📤 Sending initiative: ${roll} + ${participant.initiative_bonus} = ${total}`);
            sendMessage({
                type: 'RollInitiative',
        entity_id: participant.entity_id,
                roll: total
            });
}

function cancelInitiativePrompt() {
    closeModal('initiativePromptModal');
    if (!initiativePromptParticipant) return;

    addLogEntry('⚠️ You still need to roll for initiative!', 'damage');
    clearTimeout(initiativePromptReminderTimeout);
    initiativePromptReminderTimeout = setTimeout(() => {
        if (initiativePromptParticipant && confirm('You haven\'t rolled for initiative yet. Roll now?')) {
            showInitiativePrompt(initiativePromptParticipant);
            }
        }, 2000);
}

function nextTurn() {
    console.log('========== NEXT TURN CLICKED ==========');
    console.log('Combat active:', combatState.active);
    console.log('Participants:', combatState.participants);
    console.log('Participants length:', combatState.participants.length);
    console.log('Current turn:', combatState.currentTurn);
    
    if (!combatState.active) {
        console.error('❌ Combat not active!');
        alert('Combat is not active! Start combat first.');
        return;
    }
    
    if (!combatState.participants || combatState.participants.length === 0) {
        console.error('❌ NO PARTICIPANTS!');
        console.error('Full combat state:', JSON.stringify(combatState));
        alert('No participants in combat! Make sure tokens are placed and everyone has rolled initiative.');
        return;
    }
    
    // Check if everyone has rolled (initiative > 0)
    const unrolled = combatState.participants.filter(p => !p.initiative || p.initiative === 0);
    console.log('Checking who has rolled...');
    combatState.participants.forEach(p => {
        console.log(`  ${p.name}: ${p.initiative} (rolled: ${p.initiative > 0 ? 'YES' : 'NO'})`);
    });
    
    if (unrolled.length > 0) {
        console.warn('⚠️ Some participants haven\'t rolled:', unrolled.map(p => p.name));
        alert(`Waiting for initiative rolls from: ${unrolled.map(p => p.name).join(', ')}`);
        return;
    }
    
    console.log('✅ All participants have rolled!');
    
    // CRITICAL: Don't set turn locally - let the server handle it
    // The server will send TurnChanged message which will update combatState.currentTurn
    
    // Sort participants by initiative before sending (highest first)
    const sortedParticipants = [...combatState.participants].sort((a, b) => {
        const aInit = a.initiative || 0;
        const bInit = b.initiative || 0;
        return bInit - aInit;
    });
    
    console.log('📤 Sending NextTurn to server');
    console.log('   Current turn before send:', combatState.currentTurn);
    console.log('   Sorted participants by initiative:', sortedParticipants.map(p => `${p.name}: ${p.initiative} (id: ${p.id})`));
    
    // Send to server - server will calculate next turn and send TurnChanged
    sendMessage({ type: 'NextTurn' });
    
    // Set a timeout to manually advance if server doesn't respond
    // This is a fallback in case the server doesn't send TurnChanged
    // Reduced timeout to 500ms for faster response
    const turnAdvanceTimeout = setTimeout(() => {
        console.warn('⚠️ Server did not respond with TurnChanged within 500ms, manually advancing turn...');
        manuallyAdvanceTurn();
    }, 500);
    
    // Store timeout so we can clear it if TurnChanged arrives
    window.turnAdvanceTimeout = turnAdvanceTimeout;
    
    console.log('⏳ Waiting for server TurnChanged response...');
}

// Fallback: Manually advance turn if server doesn't respond
function manuallyAdvanceTurn() {
    if (!combatState.active || !combatState.participants || combatState.participants.length === 0) {
        console.error('❌ Cannot manually advance: combat not active or no participants');
        return;
    }
    
    // Sort participants by initiative (highest first) - MUST match server's order
    const sorted = [...combatState.participants].sort((a, b) => {
        const aInit = a.initiative || 0;
        const bInit = b.initiative || 0;
        if (bInit !== aInit) {
            return bInit - aInit; // Higher initiative first
        }
        // If same initiative, maintain original order (or use name as tiebreaker)
        return 0;
    });
    
    if (sorted.length === 0) {
        console.error('❌ No sorted participants!');
        return;
    }
    
    console.log('🔧 Manual turn advance - Current turn:', combatState.currentTurn);
    console.log('🔧 Sorted participants:', sorted.map((p, i) => `${i}: ${p.name} (init: ${p.initiative}, id: ${p.id})`));
    
    // Find current turn index - try multiple matching strategies
    let currentIndex = -1;
    if (combatState.currentTurn) {
        // Try to find by participant ID
        currentIndex = sorted.findIndex(p => p.id === combatState.currentTurn);
        
        // If not found, try entity_id
        if (currentIndex === -1) {
            currentIndex = sorted.findIndex(p => p.entity_id === combatState.currentTurn);
        }
        
        // If still not found, try token matching
        if (currentIndex === -1) {
            const currentToken = tokens.find(t => t.id === combatState.currentTurn);
            if (currentToken) {
                currentIndex = sorted.findIndex(p => p.entity_id === currentToken.entity_id);
            }
        }
    }
    
    console.log('🔧 Current turn index found:', currentIndex);
    
    // If not found or no current turn, start with first participant (index 0)
    if (currentIndex === -1) {
        console.log('🔧 No current turn found, starting with first participant');
        currentIndex = -1; // Will become 0 after increment
    }
    
    // Move to next participant (or first if no current turn)
    const nextIndex = (currentIndex + 1) % sorted.length;
    const nextParticipant = sorted[nextIndex];
    
    if (!nextParticipant) {
        console.error('❌ No next participant found at index:', nextIndex);
        console.error('   Sorted array length:', sorted.length);
        return;
    }
    
    // CRITICAL: Check if we're trying to advance to the same participant
    const currentParticipant = currentIndex >= 0 ? sorted[currentIndex] : null;
    if (currentParticipant && nextParticipant.id === currentParticipant.id && nextParticipant.entity_id === currentParticipant.entity_id) {
        console.error('❌ ERROR: Trying to advance to the same participant!');
        console.error('   Current:', currentParticipant.name, 'ID:', currentParticipant.id);
        console.error('   Next:', nextParticipant.name, 'ID:', nextParticipant.id);
        console.error('   This should not happen - advancing to next in list anyway');
        // Force advance to the participant after next
        const forcedNextIndex = (nextIndex + 1) % sorted.length;
        const forcedNext = sorted[forcedNextIndex];
        if (forcedNext && forcedNext.id !== currentParticipant.id) {
            console.log('🔧 Forcing advance to:', forcedNext.name);
            // Use forcedNext instead
            const forcedToken = tokens.find(t => t.entity_id === forcedNext.entity_id);
            const forcedTurnId = forcedToken ? forcedToken.id : (forcedNext.id || forcedNext.entity_id);
            combatState.currentTurn = forcedTurnId;
            if (forcedToken) {
                turnStartPosition = { x: forcedToken.x, y: forcedToken.y };
            }
            updateInitiativeList();
            updatePlayerTurnControls();
            updateCurrentTurnDisplay(forcedNext.name);
            addLogEntry(`⚔️ ${forcedNext.name}'s turn`, 'info');
            renderCanvas();
            return;
        }
    }
    
    console.log('🔧 Manually advancing turn:');
    console.log('   From index:', currentIndex, '-> To index:', nextIndex);
    console.log('   From:', currentIndex >= 0 ? sorted[currentIndex]?.name : 'none');
    console.log('   To:', nextParticipant.name, 'ID:', nextParticipant.id);
    
    // Find the token for this participant to get the correct ID
    const nextToken = tokens.find(t => t.entity_id === nextParticipant.entity_id);
    const turnId = nextToken ? nextToken.id : (nextParticipant.id || nextParticipant.entity_id);
    
    // Update turn
    combatState.currentTurn = turnId;
    console.log('🔧 Updated combatState.currentTurn to:', turnId);
    
    // Also update participant ID to match token if found
    if (nextToken && nextParticipant.id !== nextToken.id) {
        nextParticipant.id = nextToken.id;
        combatState.currentTurn = nextToken.id;
        console.log('🔧 Updated participant.id to match token:', nextToken.id);
    }
    
    // Save starting position
    if (nextToken) {
        turnStartPosition = { x: nextToken.x, y: nextToken.y };
        console.log('📍 Saved turn start position:', turnStartPosition);
    } else {
        console.warn('⚠️ No token found for next participant');
    }
    
    updateInitiativeList();
    updatePlayerTurnControls();
    updateCurrentTurnDisplay(nextParticipant.name);
    addLogEntry(`⚔️ ${nextParticipant.name}'s turn`, 'info');
    renderCanvas();
}

function endCombat() {
    if (confirm('End combat?')) {
        sendMessage({ type: 'EndCombat' });
    }
}

// Player ends their turn
function endMyTurn() {
    addLogEntry('You ended your turn', 'info');
    sendMessage({ type: 'NextTurn' });
}

// Update player turn controls and action panel
function updatePlayerTurnControls() {
    if (isDM) return; // DM doesn't need this
    
    const myParticipant = combatState.participants.find(p => p.entity_id === myCharacterId);
    if (!myParticipant) {
        console.warn('⚠️ My participant not found for character ID:', myCharacterId);
        return;
    }
    
    // Check if it's my turn - try both id and entity_id matching
    const isMyTurn = combatState.currentTurn === myParticipant.id || 
                     combatState.currentTurn === myParticipant.entity_id ||
                     (myParticipant.id && tokens.some(t => t.id === combatState.currentTurn && t.entity_id === myCharacterId));
    
    console.log('🎯 Turn check - currentTurn:', combatState.currentTurn, 'myParticipant.id:', myParticipant.id, 'myParticipant.entity_id:', myParticipant.entity_id, 'isMyTurn:', isMyTurn);
    const controlsDiv = document.getElementById('playerCombatControls');
    const actionPanelDiv = document.getElementById('combatActionPanel');
    
    console.log('🎯 Combat active:', combatState.active, '| Is my turn:', isMyTurn);
    
    // Show action panel ANY TIME combat is active (not just on your turn)
    if (combatState.active) {
        console.log('⚔️ COMBAT IS ACTIVE! Showing action panel');
        console.log('Panel element:', actionPanelDiv);
        
        if (!actionPanelDiv) {
            console.error('❌ COMBAT ACTION PANEL ELEMENT NOT FOUND IN HTML!');
            alert('ERROR: Combat action panel element missing from HTML!');
            return;
        }
        
        actionPanelDiv.classList.remove('hidden');
        console.log('✅ Panel should be visible now. Classes:', actionPanelDiv.className);
        populateCombatActionPanel();
        
        // Only show "End Turn" button on your turn
        if (isMyTurn) {
            console.log('🎯 IT\'S MY TURN! Showing end turn button');
            controlsDiv.classList.remove('hidden');
        } else {
            controlsDiv.classList.add('hidden');
        }
    } else {
        console.log('⏸️ Combat not active, hiding panel');
        controlsDiv.classList.add('hidden');
        actionPanelDiv.classList.add('hidden');
    }
}

// Populate combat action panel with character abilities
function populateCombatActionPanel() {
    console.log('🎯 POPULATING COMBAT ACTION PANEL');
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter) {
        console.log('❌ No character found for:', myCharacterId);
        // Show error in panel
        document.getElementById('movementInfo').innerHTML = '❌ No character selected!';
        return;
    }
    
    console.log('✅ Found character:', myCharacter.name);
    
    // Parse character data - IMPORTANT: This must get the latest data with spell_slot_usage
    let charData = myCharacter;
    if (myCharacter.character_data) {
        try {
            const fullData = JSON.parse(myCharacter.character_data);
            charData = fullData.character || fullData;
            console.log('✅ Parsed character data:', charData.name, charData.class, charData.level);
            
            // Ensure spell_slot_usage is preserved from the updated character data
            if (!charData.spell_slot_usage) {
                charData.spell_slot_usage = {};
            }
            console.log('📊 Current spell slot usage:', charData.spell_slot_usage);
        } catch (e) {
            console.error('Error parsing character data:', e);
        }
    }
    
    console.log('📊 Character stats:', {
        name: charData.name,
        class: charData.class,
        level: charData.level,
        hasSpells: !!charData.spells,
        hasSpellcasting: !!charData.spellcasting,
        hasAttacks: !!charData.attacks,
        attacksCount: charData.attacks ? charData.attacks.length : 0
    });
    
    // DEBUG: Show full character data structure
    console.log('🔍 FULL CHARACTER DATA:', charData);
    console.log('🔍 CHARACTER_DATA FIELD:', myCharacter.character_data);
    
    // Populate spell slots
    populateSpellSlots(charData);
    
    // Populate quick actions
    populateQuickActions();
    
    // Populate attacks
    populateAttacks(charData);
    
    // Populate bonus actions
    populateBonusActions(charData);
    
    // Update movement info
    const movementInfo = document.getElementById('movementInfo');
    const speed = charData.speed?.walk || charData.speed || myCharacter.speed || 30;
    movementInfo.innerHTML = `🏃 <strong>Movement:</strong> ${speed} ft<br><small>Green squares show reachable area</small>`;
}

// Populate spell slots section
function populateSpellSlots(charData) {
    console.log('🔮 POPULATING SPELL SLOTS for:', charData.name);
    const slotsSection = document.getElementById('spellSlotsSection');
    const slotsList = document.getElementById('spellSlotsList');
    
    // Check if character has spells
    const spellData = charData.spells || charData.spellcasting;
    console.log('📚 Spell data found:', spellData);
    if (!spellData || (!spellData.spell_slots && !spellData.pact_magic)) {
        console.log('❌ No spell slots found for:', charData.name);
        slotsSection.classList.add('hidden');
        return;
    }
    
    slotsSection.classList.remove('hidden');
    slotsList.innerHTML = '';
    
    // Initialize spell slot usage if not exists
    if (!charData.spell_slot_usage) {
        charData.spell_slot_usage = {};
    }
    
    // Handle pact magic (Warlock)
    if (spellData.pact_magic) {
        const slotLevel = spellData.pact_magic.slot_level || 1;
        const maxSlots = spellData.pact_magic.slots || 1;
        const usedSlots = charData.spell_slot_usage[`pact_${slotLevel}`] || 0;
        
        const slotDiv = document.createElement('div');
        slotDiv.style.cssText = `
            background: linear-gradient(135deg, #8a2be2, #6a1b9a);
            color: white;
            padding: 8px;
            border-radius: 6px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
            border: 2px solid ${usedSlots >= maxSlots ? '#ff4444' : '#aa88ff'};
        `;
        slotDiv.innerHTML = `
            <div style="font-weight: bold; font-size: 12px;">PACT MAGIC</div>
            <div style="font-size: 16px; font-weight: bold;">${maxSlots - usedSlots}/${maxSlots}</div>
            <div style="font-size: 10px; opacity: 0.8;">Level ${slotLevel}</div>
        `;
        slotDiv.onclick = () => useSpellSlot(charData, `pact_${slotLevel}`, maxSlots, slotLevel);
        slotDiv.onmouseover = () => {
            slotDiv.style.transform = 'scale(1.05)';
            slotDiv.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        };
        slotDiv.onmouseout = () => {
            slotDiv.style.transform = 'scale(1)';
            slotDiv.style.boxShadow = 'none';
        };
        slotsList.appendChild(slotDiv);
        return;
    }
    
    // Handle regular spell slots (Cleric/Wizard)
    if (spellData.spell_slots) {
        for (let level = 1; level <= 9; level++) {
            // Generate correct ordinal suffix
            let levelKey;
            if (level === 1) levelKey = '1st';
            else if (level === 2) levelKey = '2nd';
            else if (level === 3) levelKey = '3rd';
            else levelKey = `${level}th`;
            
            if (spellData.spell_slots[levelKey]) {
                const maxSlots = spellData.spell_slots[levelKey];
                const usedSlots = charData.spell_slot_usage[levelKey] || 0;
                
                if (maxSlots > 0) {
                    const slotDiv = document.createElement('div');
                    slotDiv.style.cssText = `
                        background: linear-gradient(135deg, #4a9eff, #2a5aa0);
                        color: white;
                        padding: 8px;
                        border-radius: 6px;
                        text-align: center;
                        cursor: pointer;
                        transition: all 0.2s;
                        border: 2px solid ${usedSlots >= maxSlots ? '#ff4444' : '#4a9eff'};
                    `;
                    slotDiv.innerHTML = `
                        <div style="font-weight: bold; font-size: 12px;">LEVEL ${level}</div>
                        <div style="font-size: 16px; font-weight: bold;">${maxSlots - usedSlots}/${maxSlots}</div>
                        <div style="font-size: 10px; opacity: 0.8;">Spell Slots</div>
                    `;
                    slotDiv.onclick = () => useSpellSlot(charData, levelKey, maxSlots, level);
                    slotDiv.onmouseover = () => {
                        slotDiv.style.transform = 'scale(1.05)';
                        slotDiv.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
                    };
                    slotDiv.onmouseout = () => {
                        slotDiv.style.transform = 'scale(1)';
                        slotDiv.style.boxShadow = 'none';
                    };
                    slotsList.appendChild(slotDiv);
                }
            }
        }
    }
}

// Use a spell slot
function useSpellSlot(charData, slotKey, maxSlots, level) {
    console.log('🎯 useSpellSlot called:', {charData: charData.name, slotKey, maxSlots, level});
    
    // Get the actual character object from the global array
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter) {
        console.error('❌ Character not found!');
        return;
    }
    
    // Parse the current character data
    let fullData;
    if (myCharacter.character_data) {
        try {
            fullData = JSON.parse(myCharacter.character_data);
        } catch (e) {
            console.error('Error parsing character data:', e);
            return;
        }
    } else {
        fullData = { character: myCharacter };
    }
    
    let actualCharData = fullData.character || fullData;
    
    // Initialize spell slot usage if not exists
    if (!actualCharData.spell_slot_usage) {
        actualCharData.spell_slot_usage = {};
    }
    
    const usedSlots = actualCharData.spell_slot_usage[slotKey] || 0;
    console.log('📊 BEFORE - Current usage:', JSON.stringify(actualCharData.spell_slot_usage));
    
    if (usedSlots >= maxSlots) {
        alert(`❌ No more Level ${level} spell slots available!`);
        return;
    }
    
    // Increment usage
    actualCharData.spell_slot_usage[slotKey] = usedSlots + 1;
    console.log('📊 AFTER - Updated usage:', JSON.stringify(actualCharData.spell_slot_usage));
    
    // Update the full data object
    if (fullData.character) {
        fullData.character = actualCharData;
    } else {
        fullData = actualCharData;
    }
    
    // CRITICAL: Update the global characters array IMMEDIATELY
    myCharacter.character_data = JSON.stringify(fullData);
    console.log('✅ Updated global character data');
    
    // Log the spell slot usage
    addRollEntry(`${actualCharData.name} used a Level ${level} spell slot (${maxSlots - usedSlots - 1}/${maxSlots} remaining)`);
    
    // Send to server - send the FULL character object
    if (ws && ws.readyState === WebSocket.OPEN) {
        const characterUpdate = buildCharacterUpdatePayload(myCharacter);
        if (characterUpdate) {
        ws.send(JSON.stringify({
            type: "UpdateCharacter",
            character: characterUpdate
        }));
        console.log('✅ Sent full character update to server');
        } else {
            console.warn('⚠️ Character update payload could not be built');
        }
    } else {
        console.warn('⚠️ WebSocket not available, data not synced to server');
    }
    
    // Refresh the combat action panel to show updated counts
    console.log('🔄 Refreshing combat action panel...');
    setTimeout(() => {
        populateCombatActionPanel();
        console.log('✅ Combat action panel refreshed');
    }, 100);
    
    console.log(`✨ ${actualCharData.name} used a Level ${level} spell slot! New count: ${maxSlots - usedSlots - 1}/${maxSlots}`);
}

// Restore all spell slots (Long Rest)
function restoreAllSpellSlots() {
    console.log('🌙 Long Rest initiated');
    
    // Get the actual character object from the global array
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter) {
        console.error('❌ Character not found!');
        return;
    }
    
    // Parse character data
    let charData = myCharacter;
    if (myCharacter.character_data) {
        try {
            const fullData = JSON.parse(myCharacter.character_data);
            charData = fullData.character || fullData;
        } catch (e) {
            console.error('Error parsing character data:', e);
            return;
        }
    }
    
    console.log('🔄 Clearing spell slot usage for:', charData.name);
    charData.spell_slot_usage = {};
    
    // Save to database and update local state
    saveCharacterSpellSlotUsage(charData);
    
    // Refresh the display
    populateCombatActionPanel();
    
    addRollEntry(`${charData.name} completed a Long Rest - all spell slots restored!`);
    console.log(`✅ ${charData.name} completed a Long Rest - all spell slots restored!`);
}

// Save spell slot usage to database
function saveCharacterSpellSlotUsage(charData) {
    console.log('💾 Saving spell slot usage:', charData.spell_slot_usage);
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (myCharacter) {
        // Update the character data with spell slot usage
        let updatedData = myCharacter;
        if (myCharacter.character_data) {
            try {
                const fullData = JSON.parse(myCharacter.character_data);
                updatedData = fullData.character || fullData;
            } catch (e) {
                console.error('Error parsing character data:', e);
                return;
            }
        }
        
        // Update spell slot usage
        updatedData.spell_slot_usage = charData.spell_slot_usage;
        
        // CRITICAL: Update the character_data string in the global characters array
        // This ensures the next call to populateCombatActionPanel gets the updated data
        myCharacter.character_data = JSON.stringify(updatedData);
        console.log('✅ Updated local character data');
        
        // Send to server - send the FULL character object
        if (ws && ws.readyState === WebSocket.OPEN) {
            const characterUpdate = buildCharacterUpdatePayload(myCharacter);
            if (characterUpdate) {
            ws.send(JSON.stringify({
                type: "UpdateCharacter",
                character: characterUpdate
            }));
            console.log('✅ Sent full character update to server');
            } else {
                console.warn('⚠️ Character update payload could not be built');
            }
        } else {
            console.warn('⚠️ WebSocket not available, data not synced to server');
        }
    }
}

// Populate quick actions
function populateQuickActions() {
    const actionsList = document.getElementById('quickActionsList');
    actionsList.innerHTML = '';
    
    const actions = [
        { name: 'Attack', icon: '⚔️', desc: 'Make a weapon attack' },
        { name: 'Cast Spell', icon: '🔮', desc: 'Cast a spell' },
        { name: 'Dash', icon: '🏃', desc: 'Double movement' },
        { name: 'Disengage', icon: '🚪', desc: 'Move without opportunity attacks' },
        { name: 'Dodge', icon: '🛡️', desc: 'Attacks against you have disadvantage' },
        { name: 'Help', icon: '🤝', desc: 'Grant advantage to an ally' },
        { name: 'Hide', icon: '👁️', desc: 'Make a Stealth check' },
        { name: 'Ready', icon: '⏸️', desc: 'Prepare an action' },
        { name: 'Search', icon: '🔍', desc: 'Look for something' },
        { name: 'Use Item', icon: '🎒', desc: 'Use an object or item' }
    ];
    
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding: 8px; background: rgba(68,255,68,0.2); border: 1px solid #44ff44; border-radius: 5px; color: #fff; cursor: pointer; font-size: 11px; text-align: left; transition: all 0.2s;';
        btn.innerHTML = `<div style="font-weight: bold;">${action.icon} ${action.name}</div><div style="font-size: 9px; opacity: 0.7;">${action.desc}</div>`;
        btn.onmouseenter = function() {
            this.style.background = 'rgba(68,255,68,0.4)';
            this.style.transform = 'translateX(3px)';
        };
        btn.onmouseleave = function() {
            this.style.background = 'rgba(68,255,68,0.2)';
            this.style.transform = 'translateX(0)';
        };
        btn.onclick = function() {
            addLogEntry(`${myPlayerName} is taking the ${action.name} action`, 'info');
        };
        actionsList.appendChild(btn);
    });
}

// Populate attacks from character sheet
function populateAttacks(charData) {
    console.log('⚔️ POPULATING ATTACKS for:', charData.name);
    const attacksSection = document.getElementById('attacksSection');
    const attacksList = document.getElementById('attacksList');
    
    const attacks = charData.attacks || [];
    console.log('🗡️ Found attacks:', attacks.length, attacks);
    if (attacks.length === 0) {
        console.log('❌ No attacks found for:', charData.name);
        attacksSection.classList.add('hidden');
        return;
    }
    
    attacksSection.classList.remove('hidden');
    attacksList.innerHTML = '';
    
    attacks.forEach(attack => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding: 10px; background: linear-gradient(135deg, rgba(255,68,68,0.2) 0%, rgba(200,50,50,0.2) 100%); border: 1px solid #ff4444; border-radius: 5px; color: #fff; cursor: pointer; font-size: 12px; text-align: left; transition: all 0.2s;';
        
        const toHit = attack.to_hit !== undefined ? formatMod(attack.to_hit) : '+0';
        const damage = attack.damage || '1d4';
        const damageType = attack.type || 'bludgeoning';
        
        btn.innerHTML = `
            <div style="font-weight: bold; font-size: 14px;">${attack.name}</div>
            <div style="display: flex; justify-content: space-between; margin-top: 5px; font-size: 11px; opacity: 0.9;">
                <span>To Hit: ${toHit}</span>
                <span>Damage: ${damage} ${damageType}</span>
            </div>
        `;
        
        btn.onmouseenter = function() {
            this.style.background = 'linear-gradient(135deg, rgba(255,68,68,0.4) 0%, rgba(200,50,50,0.4) 100%)';
            this.style.transform = 'translateX(3px)';
        };
        btn.onmouseleave = function() {
            this.style.background = 'linear-gradient(135deg, rgba(255,68,68,0.2) 0%, rgba(200,50,50,0.2) 100%)';
            this.style.transform = 'translateX(0)';
        };
        
        btn.onclick = function() {
            const toHitMod = attack.to_hit || 0;
            rollAttack(attack.name, toHitMod, damage, damageType, myPlayerName);
        };
        
        attacksList.appendChild(btn);
    });
}

// Populate bonus actions from character abilities
function populateBonusActions(charData) {
    console.log('⭐ POPULATING BONUS ACTIONS for:', charData.name);
    const bonusSection = document.getElementById('bonusActionsSection');
    const bonusList = document.getElementById('bonusActionsList');
    
    const bonusActions = [];
    
    // Check for bonus actions in character data
    if (charData.actions && charData.actions.bonus_actions) {
        charData.actions.bonus_actions.forEach(action => {
            bonusActions.push({ name: action, desc: 'Class/Race feature' });
        });
    }
    
    // Add common bonus actions
    if (charData.class && charData.class.toLowerCase().includes('rogue')) {
        bonusActions.push({ name: 'Cunning Action', desc: 'Dash, Disengage, or Hide' });
    }
    
    // Two-weapon fighting
    bonusActions.push({ name: 'Offhand Attack', desc: 'Attack with second weapon' });
    
    if (bonusActions.length === 0) {
        bonusSection.classList.add('hidden');
        return;
    }
    
    bonusSection.classList.remove('hidden');
    bonusList.innerHTML = '';
    
    bonusActions.forEach(action => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding: 8px; background: rgba(255,170,68,0.2); border: 1px solid #ffaa44; border-radius: 5px; color: #fff; cursor: pointer; font-size: 11px; text-align: left; transition: all 0.2s;';
        btn.innerHTML = `<div style="font-weight: bold;">${action.name}</div><div style="font-size: 9px; opacity: 0.7;">${action.desc}</div>`;
        btn.onmouseenter = function() {
            this.style.background = 'rgba(255,170,68,0.4)';
            this.style.transform = 'translateX(3px)';
        };
        btn.onmouseleave = function() {
            this.style.background = 'rgba(255,170,68,0.2)';
            this.style.transform = 'translateX(0)';
        };
        btn.onclick = function() {
            addLogEntry(`${myPlayerName} is using ${action.name}`, 'info');
        };
        bonusList.appendChild(btn);
    });
}

function dealDamage() {
    if (!selectedToken) {
        alert('Select a token first!');
        return;
    }
    
    if (!isDM) {
        alert('Only the DM can deal damage!');
        return;
    }
    
    const damage = parseInt(document.getElementById('damageAmount').value);
    if (isNaN(damage) || damage <= 0) {
        alert('Enter a valid damage amount!');
        return;
    }
    
    // Get target name for logging
    const participant = combatState.participants.find(p => p.id === selectedToken.id);
    const targetName = participant ? participant.name : (selectedToken.entity_type === 'Enemy' ? 'Enemy' : 'Target');
    
    // Update HP locally (optimistic update)
    if (participant) {
        const oldHp = participant.current_hp;
        participant.current_hp = Math.max(0, participant.current_hp - damage);
        addLogEntry(`${targetName} takes ${damage} damage! (${oldHp} → ${participant.current_hp} HP)`, 'damage');
    }
    
    // Update character if it's a player
    if (selectedToken.entity_type === 'Player') {
        const char = characters.find(c => c.id === selectedToken.entity_id);
        if (char) {
            char.current_hp = Math.max(0, char.current_hp - damage);
        }
    } else if (selectedToken.entity_type === 'Enemy') {
        // Update enemy instance HP
        const enemy = enemies.find(e => e.id === selectedToken.entity_id);
        if (enemy && enemy.current_hp !== undefined) {
            enemy.current_hp = Math.max(0, enemy.current_hp - damage);
        }
    }
    
    // Send to server (server will broadcast back with correct HP)
    sendMessage({
        type: 'DealDamage',
        target_id: selectedToken.id,
        damage: damage
    });
    
    // Update UI immediately
    updateInitiativeList();
    updateTokenInfo();
    renderCanvas();
    
    document.getElementById('damageAmount').value = '';
}

function healTarget() {
    if (!selectedToken) {
        alert('Select a token first!');
        return;
    }
    
    if (!isDM) {
        alert('Only the DM can heal!');
        return;
    }
    
    const healing = parseInt(document.getElementById('healAmount').value);
    if (isNaN(healing) || healing <= 0) {
        alert('Enter a valid healing amount!');
        return;
    }
    
    // Get target name for logging
    const participant = combatState.participants.find(p => p.id === selectedToken.id);
    const targetName = participant ? participant.name : (selectedToken.entity_type === 'Enemy' ? 'Enemy' : 'Target');
    
    // Update HP locally (optimistic update)
    if (participant) {
        const oldHp = participant.current_hp;
        participant.current_hp = Math.min(participant.max_hp, participant.current_hp + healing);
        addLogEntry(`${targetName} healed for ${healing}! (${oldHp} → ${participant.current_hp} HP)`, 'healing');
    }
    
    // Update character if it's a player
    if (selectedToken.entity_type === 'Player') {
        const char = characters.find(c => c.id === selectedToken.entity_id);
        if (char) {
            char.current_hp = Math.min(char.max_hp, char.current_hp + healing);
        }
    } else if (selectedToken.entity_type === 'Enemy') {
        // Update enemy instance HP
        const enemy = enemies.find(e => e.id === selectedToken.entity_id);
        if (enemy && enemy.current_hp !== undefined) {
            const maxHp = enemy.max_hp || 100; // Fallback if max_hp not set
            enemy.current_hp = Math.min(maxHp, enemy.current_hp + healing);
        }
    }
    
    // Send to server (server will broadcast back with correct HP)
    sendMessage({
        type: 'HealTarget',
        target_id: selectedToken.id,
        healing: healing
    });
    
    // Update UI immediately
    updateInitiativeList();
    updateTokenInfo();
    renderCanvas();
    
    document.getElementById('healAmount').value = '';
}

function updateInitiativeList() {
    const list = document.getElementById('initiativeList');
    
    if (!combatState.active || combatState.participants.length === 0) {
        list.innerHTML = '<div style="padding: 10px;">No active combat</div>';
        return;
    }
    
    // FIX: Only DM sees full turn order, players see limited info
    if (isDM) {
        // DM sees full initiative list with clear header
        let html = '<div style="font-weight: bold; color: #4a9eff; margin-bottom: 10px; padding: 8px; background: rgba(74,158,255,0.2); border-radius: 5px;">🎯 Full Turn Order (DM Only)</div>';
        combatState.participants.forEach((p, index) => {
            const isActive = p.id === combatState.currentTurn;
            const typeClass = p.entity_type === 'Player' ? 'player' : 'enemy';
            const turnNumber = index + 1;
            
            // CRITICAL: Get HP and AC from enemy/character data if not in participant
            let displayCurrentHp = p.current_hp;
            let displayMaxHp = p.max_hp;
            let displayAC = p.armor_class;
            
            if (p.entity_type === 'Enemy' || p.entity_type === 'NPC') {
                const enemy = enemies.find(e => e.id === p.entity_id);
                if (enemy) {
                    if (displayMaxHp === undefined && enemy.max_hp !== undefined) {
                        displayMaxHp = enemy.max_hp;
                    }
                    if (displayCurrentHp === undefined && enemy.current_hp !== undefined) {
                        displayCurrentHp = enemy.current_hp;
                    } else if (displayCurrentHp === undefined && displayMaxHp !== undefined) {
                        displayCurrentHp = displayMaxHp;
                    }
                    if (displayAC === undefined && enemy.armor_class !== undefined) {
                        displayAC = enemy.armor_class;
                    }
                }
            } else if (p.entity_type === 'Player') {
                const char = characters.find(c => c.id === p.entity_id);
                if (char) {
                    if (displayMaxHp === undefined && char.max_hp !== undefined) {
                        displayMaxHp = char.max_hp;
                    }
                    if (displayCurrentHp === undefined && char.current_hp !== undefined) {
                        displayCurrentHp = char.current_hp;
                    } else if (displayCurrentHp === undefined && displayMaxHp !== undefined) {
                        displayCurrentHp = displayMaxHp;
                    }
                    if (displayAC === undefined && char.armor_class !== undefined) {
                        displayAC = char.armor_class;
                    }
                }
            }
            
            // Format HP display
            const hpDisplay = (displayCurrentHp !== undefined && displayMaxHp !== undefined) 
                ? `${displayCurrentHp}/${displayMaxHp} HP` 
                : (displayMaxHp !== undefined ? `${displayMaxHp} HP` : 'HP: ?');
            
            // Format AC display
            const acDisplay = displayAC !== undefined ? `AC: ${displayAC}` : '';
            
            html += `
                <div class="initiative-item ${typeClass} ${isActive ? 'active' : ''}" style="position: relative;">
                    <div style="position: absolute; left: -25px; top: 50%; transform: translateY(-50%); font-size: 14px; font-weight: bold; opacity: 0.5;">${turnNumber}</div>
                    <span style="flex: 1;">${p.name}</span>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span class="initiative-roll">${p.initiative || '?'}</span>
                        <span style="margin-left: 5px;">${hpDisplay}</span>
                        ${acDisplay ? `<span style="margin-left: 5px; color: #4a9eff; font-weight: bold;">${acDisplay}</span>` : ''}
                    </div>
                </div>
            `;
        });
        list.innerHTML = html;
    } else {
        // Players see limited info - just current turn and their character
        const currentParticipant = combatState.participants.find(p => p.id === combatState.currentTurn);
        const myParticipant = combatState.participants.find(p => p.entity_id === myCharacterId);
        
        let html = '<div style="font-size: 11px; opacity: 0.7; margin-bottom: 8px;">Combat Status</div>';
        
        if (currentParticipant) {
            const isMyTurn = currentParticipant.id === (myParticipant ? myParticipant.id : null);
            html += `
                <div style="padding: 10px; background: rgba(255,170,68,0.3); border-radius: 5px; margin-bottom: 10px;">
                    <div style="font-weight: bold; color: #ffaa44;">Current Turn:</div>
                    <div style="font-size: 18px; margin-top: 5px;">${currentParticipant.name}</div>
                    ${isMyTurn ? '<div style="color: #44ff44; font-weight: bold; margin-top: 5px;">🎯 IT\'S YOUR TURN!</div>' : ''}
                </div>
            `;
        }
        
        if (myParticipant) {
            html += `
                <div style="padding: 10px; background: rgba(68,255,68,0.2); border-radius: 5px;">
                    <div style="font-weight: bold;">Your Character:</div>
                    <div style="margin-top: 5px;">${myParticipant.name}</div>
                    <div style="margin-top: 5px;">HP: ${myParticipant.current_hp}/${myParticipant.max_hp}</div>
                    <div style="margin-top: 5px;">Initiative: ${myParticipant.initiative}</div>
                </div>
            `;
        }
        
        list.innerHTML = html;
    }
}

// Update combat status display
function updateCombatStatus() {
    const status = document.getElementById('combatStatus');
    const turnDisplay = document.getElementById('currentTurnDisplay');
    
    if (combatState.active) {
        status.innerHTML = '<span style="color: #ff4444; font-weight: bold;">⚔️ COMBAT ACTIVE</span>';
        if (turnDisplay) {
            turnDisplay.style.display = 'block';
        }
    } else {
        status.innerHTML = 'No active combat';
        if (turnDisplay) {
            turnDisplay.style.display = 'none';
        }
    }
}

// Update current turn display at top
function updateCurrentTurnDisplay(participantName) {
    console.log('🎯 Updating turn display to:', participantName);
    const turnNameEl = document.getElementById('currentTurnName');
    if (turnNameEl) {
        turnNameEl.textContent = participantName || '-';
        console.log('✅ Turn name element updated');
    } else {
        console.error('❌ Turn name element not found!');
    }
    
    const turnDisplay = document.getElementById('currentTurnDisplay');
    if (turnDisplay && combatState.active) {
        turnDisplay.style.display = 'block';
        console.log('✅ Turn display shown');
    } else if (turnDisplay) {
        console.log('⚠️ Combat not active, hiding turn display');
    } else {
        console.error('❌ Turn display element not found!');
    }
}

// Update player turn controls (show End Turn button when it's their turn)
function updatePlayerTurnControls() {
    if (isDM) return;
    
    const myParticipant = combatState.participants.find(p => p.entity_id === myCharacterId);
    if (!myParticipant) return;
    
    const isMyTurn = combatState.currentTurn === myParticipant.id;
    const controlsDiv = document.getElementById('playerCombatControls');
    
    if (combatState.active && isMyTurn) {
        controlsDiv.classList.remove('hidden');
    } else {
        controlsDiv.classList.add('hidden');
    }
}

function updateCombatParticipantHP(targetId, newHp) {
    const participant = combatState.participants.find(p => p.id === targetId);
    if (participant) {
        participant.current_hp = newHp;
        updateInitiativeList();
    }
    
    // FIX: Also update character data for players
    const token = tokens.find(t => t.id === targetId);
    if (token && token.entity_type === 'Player') {
        const char = characters.find(c => c.id === token.entity_id);
        if (char) {
            char.current_hp = newHp;
        }
    }
    
    // Update token info if this token is selected
    if (selectedToken && selectedToken.id === targetId) {
        updateTokenInfo();
    }
}

// Map Management
function showMapUpload() {
    document.getElementById('mapUploadModal').classList.add('active');
    // Request list of saved maps
    sendMessage({ type: 'ListMaps' });
}

function uploadMap() {
    const name = document.getElementById('mapName').value.trim();
    const file = document.getElementById('mapFile').files[0];
    
    if (!name || !file) {
        alert('Please provide a map name and select an image!');
        return;
    }
    
    console.log('📤 [UPLOAD MAP] Starting upload');
    console.log('   Name:', name);
    console.log('   File:', file.name, file.type, file.size, 'bytes');
    
    const reader = new FileReader();
    reader.onload = (e) => {
        console.log('📤 [UPLOAD MAP] File read, creating image to get dimensions...');
        const img = new Image();
        img.onload = () => {
            console.log('📤 [UPLOAD MAP] Image loaded, dimensions:', img.width, 'x', img.height);
            console.log('📤 [UPLOAD MAP] Sending CreateMap message...');
            
            sendMessage({
                type: 'CreateMap',
                name: name,
                image_data: e.target.result,
                width: img.width,
                height: img.height
            });
            
            console.log('📤 [UPLOAD MAP] Message sent, waiting for MapLoaded response...');
            
            closeModal('mapUploadModal');
            document.getElementById('mapName').value = '';
            document.getElementById('mapFile').value = '';
        };
        img.onerror = (err) => {
            console.error('❌ [UPLOAD MAP] Failed to load image:', err);
            alert('Failed to load image. Please try a different image file.');
        };
        img.src = e.target.result;
    };
    reader.onerror = (err) => {
        console.error('❌ [UPLOAD MAP] Failed to read file:', err);
        alert('Failed to read file. Please try again.');
    };
    reader.readAsDataURL(file);
}

// Render saved maps list
function renderSavedMapsList(maps) {
    const container = document.getElementById('savedMapsList');
    if (!container) return;
    
    if (maps.length === 0) {
        container.innerHTML = '<div style="padding: 10px; color: #888; text-align: center;">No saved maps</div>';
        return;
    }
    
    let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
    maps.forEach(map => {
        const isCurrentMap = currentMap && currentMap.id === map.id;
        html += `
            <div style="position: relative; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; border: 1px solid rgba(255,255,255,0.1);">
                ${isDM ? `<button onclick="deleteMap('${map.id}', '${escapeHtml(map.name)}')" 
                        style="position: absolute; top: 5px; right: 5px; background: #ff4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: bold; line-height: 1; z-index: 10;" 
                        title="Delete Map">✕</button>` : ''}
                <div style="font-weight: bold; margin-bottom: 8px; color: ${isCurrentMap ? '#4a9eff' : '#fff'}; ${isDM ? 'padding-right: 30px;' : ''}">
                    ${escapeHtml(map.name)} ${isCurrentMap ? '(Current)' : ''}
                </div>
                <div style="font-size: 11px; color: #888; margin-bottom: 8px;">
                    ${map.width} × ${map.height}px
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="loadMap('${map.id}', false)" 
                            style="flex: 1; padding: 6px; background: #4a9eff; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
                        📍 Load
                    </button>
                    <button onclick="loadMap('${map.id}', true)" 
                            style="flex: 1; padding: 6px; background: #44ff44; color: #000; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;">
                        🖼️ Load in Background
                    </button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

function deleteMap(mapId, mapName) {
    if (!isDM) {
        alert('Only DM can delete maps!');
        return;
    }
    
    if (!confirm(`⚠️ Delete map "${mapName}"?\n\nThis will:\n- Remove the map from the database\n- Delete the map image file\n- Cannot be undone!\n\nAre you sure?`)) {
        return;
    }
    
    console.log('🗑️ Deleting map:', mapName, 'ID:', mapId);
    
    sendMessage({
        type: 'DeleteMap',
        map_id: mapId
    });
    
    addLogEntry(`🗑️ Deleted map: ${mapName}`, 'info');
    
    // Refresh the map list after a short delay
    setTimeout(() => {
        sendMessage({ type: 'ListMaps' });
    }, 500);
}

// Load map (with optional background loading)
function loadMap(mapId, inBackground = false) {
    sendMessage({
        type: 'LoadMap',
        map_id: mapId,
        clear_tokens: !inBackground
    });
    
    if (inBackground) {
        addLogEntry('Loading map in background (tokens preserved)', 'info');
    }
    
    closeModal('mapUploadModal');
}

// Enemy Management
function showEnemyManager() {
    document.getElementById('enemyManagerModal').classList.add('active');
    sendMessage({ type: 'ListEnemies', style: selectedStyle });
    renderEnemyList(); // Render immediately with NPCs
}

function showSaveLoadModal() {
    console.log('🔍 showSaveLoadModal function called');
    
    const modal = document.getElementById('saveLoadModal');
    if (!modal) {
        console.error('❌ saveLoadModal element not found!');
        alert('Error: Save/Load modal not found. Please refresh the page.');
        return;
    }
    
    console.log('✅ Modal element found, adding active class');
    modal.classList.add('active');
    
    // Clear file input
    const fileInput = document.getElementById('loadGameFile');
    if (fileInput) {
        fileInput.value = '';
        console.log('✅ Cleared file input');
    } else {
        console.warn('⚠️ loadGameFile input not found');
    }
    
    // Set default save name with timestamp
    const nameInput = document.getElementById('saveFileName');
    if (nameInput) {
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
        nameInput.value = `Game Session ${timestamp}`;
        console.log('✅ Set default save name:', nameInput.value);
    } else {
        console.warn('⚠️ saveFileName input not found');
    }
    
    console.log('✅ Modal should now be visible. Modal classes:', modal.className);
}

async function showLoadGameModal() {
    const modal = document.getElementById('loadGameModal');
    if (!modal) {
        console.error('❌ loadGameModal element not found!');
        alert('Error: Load Game modal not found. Please refresh the page.');
        return;
    }
    
    modal.classList.add('active');
    await renderLoadGameStatesList();
}

async function renderLoadGameStatesList() {
    const container = document.getElementById('loadGameStatesList');
    if (!container) {
        console.error('❌ loadGameStatesList container not found!');
        return;
    }
    
    console.log('📋 Rendering load game states list...');
    
    // Show loading state
    container.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">Loading saved states...</div>';
    
    let savedStates = [];
    
    // Fetch from server first
    try {
        console.log('📤 Fetching saved states from server...');
        const response = await fetch('/api/saves');
        if (response.ok) {
            const data = await response.json();
            savedStates = data.saves || [];
            console.log('✅ Found', savedStates.length, 'saved states on server');
        } else {
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error('❌ Server returned error:', response.status, errorText);
            console.warn('⚠️ Using localStorage fallback');
        }
    } catch (e) {
        console.error('❌ Could not fetch from server:', e);
        console.warn('⚠️ Using localStorage fallback');
    }
    
    // Merge with localStorage as fallback
    try {
        const localStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
        const serverFilenames = new Set(savedStates.map(s => s.filename || s.name + '.json'));
        
        localStates.forEach(state => {
            // Only add if not already in server list
            const localFilename = (state.name || '') + '.json';
            if (!serverFilenames.has(localFilename)) {
                savedStates.push({
                    filename: localFilename,
                    name: state.name,
                    savedAt: state.savedAt,
                    mapName: state.mapName || 'None',
                    tokenCount: state.tokenCount || 0,
                    combatActive: state.combatActive || false,
                    isLocalStorage: true
                });
            }
        });
        console.log('📋 Total saved states after merge:', savedStates.length);
    } catch (e) {
        console.warn('⚠️ Could not read localStorage:', e);
    }
    
    if (savedStates.length === 0) {
        container.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">No saved game states yet.<br><br>Save a game first using the Save/Load Game button!</div>';
        console.log('ℹ️ No saved states to display');
        return;
    }
    
    try {
        // Sort by date (newest first) or modified time
        savedStates.sort((a, b) => {
            if (a.modified && b.modified) {
                return (b.modified || 0) - (a.modified || 0);
            }
            const aDate = new Date(a.savedAt || 0);
            const bDate = new Date(b.savedAt || 0);
            return bDate - aDate;
        });
        
        // Helper function to format relative time
        function getRelativeTime(date) {
            if (!date) return 'Unknown';
            const now = new Date();
            const saved = new Date(date);
            const diffMs = now - saved;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins} min ago`;
            if (diffHours < 24) return `${diffHours} hr ago`;
            if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            return saved.toLocaleDateString();
        }
        
        let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';
        savedStates.forEach((state, index) => {
            const savedDate = new Date(state.savedAt || Date.now());
            const dateStr = savedDate.toLocaleString();
            const relativeTime = getRelativeTime(state.savedAt);
            const isCombatActive = state.combatActive || false;
            
            html += `
                <div onclick="${state.isLocalStorage && state.id ? 
                    `loadSavedState('${state.id}')` : 
                    `loadSavedStateFromServer('${escapeHtml(state.filename || state.name + '.json')}')`
                }; closeModal('loadGameModal');" 
                     style="cursor: pointer; padding: 15px; background: linear-gradient(135deg, rgba(74,158,255,0.1) 0%, rgba(74,158,255,0.05) 100%); border-radius: 8px; border: 2px solid ${isCombatActive ? 'rgba(255,68,68,0.5)' : 'rgba(74,158,255,0.3)'}; transition: all 0.2s; position: relative;"
                     onmouseover="this.style.borderColor='rgba(74,158,255,0.8)'; this.style.background='linear-gradient(135deg, rgba(74,158,255,0.2) 0%, rgba(74,158,255,0.1) 100%)';"
                     onmouseout="this.style.borderColor='${isCombatActive ? 'rgba(255,68,68,0.5)' : 'rgba(74,158,255,0.3)'}'; this.style.background='linear-gradient(135deg, rgba(74,158,255,0.1) 0%, rgba(74,158,255,0.05) 100%)';">
                    ${isDM && !state.isLocalStorage ? `<button onclick="event.stopPropagation(); deleteSavedStateFromServer('${escapeHtml(state.filename || state.name + '.json')}'); renderLoadGameStatesList();" 
                            style="position: absolute; top: 5px; right: 5px; background: #ff4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: bold; line-height: 1; z-index: 10;" 
                            title="Delete Save">✕</button>` : ''}
                    
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <div style="font-size: 32px;">💾</div>
                        <div style="flex: 1; ${isDM && !state.isLocalStorage ? 'padding-right: 35px;' : ''}">
                            <div style="font-weight: bold; font-size: 16px; color: #fff; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                                ${escapeHtml(state.name)}
                                ${state.isLocalStorage ? '<span style="font-size: 10px; background: rgba(255,170,68,0.3); color: #ffaa44; padding: 3px 6px; border-radius: 3px; font-weight: 500;">LOCAL</span>' : ''}
                                ${isCombatActive ? '<span style="font-size: 11px; color: #ff4444; font-weight: bold;">⚔️ Combat</span>' : ''}
                            </div>
                            <div style="font-size: 12px; color: #aaa;">
                                ${relativeTime} • ${dateStr}
                            </div>
                        </div>
                    </div>
                    
                    <div style="font-size: 12px; color: #bbb; margin-top: 8px; display: flex; gap: 15px; flex-wrap: wrap;">
                        <span>📍 ${escapeHtml(state.mapName || 'No Map')}</span>
                        <span>🎭 ${state.tokenCount || 0} token${(state.tokenCount || 0) !== 1 ? 's' : ''}</span>
                    </div>
                    
                    <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #888; text-align: center;">
                        Click to load this save
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
        console.log('✅ Load game states list rendered with', savedStates.length, 'items');
    } catch (e) {
        console.error('❌ Error rendering load game states:', e);
        container.innerHTML = '<div style="padding: 10px; color: #ff4444; text-align: center;">Error loading saved states: ' + e.message + '</div>';
    }
}

async function renderSavedStatesList() {
    const container = document.getElementById('savedStatesList');
    if (!container) {
        // Container might not exist if using the new load modal - that's okay
        console.log('ℹ️ savedStatesList container not found (using new load modal instead)');
        return;
    }
    
    console.log('📋 Rendering saved states list...');
    
    // Show loading state
    container.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">Loading saved states...</div>';
    
    let savedStates = [];
    
    // Fetch from server first
    try {
        console.log('📤 Fetching saved states from server...');
        const response = await fetch('/api/saves');
        if (response.ok) {
            const data = await response.json();
            savedStates = data.saves || [];
            console.log('✅ Found', savedStates.length, 'saved states on server');
        } else {
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error('❌ Server returned error:', response.status, errorText);
            console.warn('⚠️ Using localStorage fallback');
        }
    } catch (e) {
        console.error('❌ Could not fetch from server:', e);
        console.warn('⚠️ Using localStorage fallback');
    }
    
    // Merge with localStorage as fallback
    try {
        const localStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
        const serverFilenames = new Set(savedStates.map(s => s.filename || s.name + '.json'));
        
        localStates.forEach(state => {
            // Only add if not already in server list
            const localFilename = (state.name || '') + '.json';
            if (!serverFilenames.has(localFilename)) {
                savedStates.push({
                    filename: localFilename,
                    name: state.name,
                    savedAt: state.savedAt,
                    mapName: state.mapName || 'None',
                    tokenCount: state.tokenCount || 0,
                    combatActive: state.combatActive || false,
                    isLocalStorage: true
                });
            }
        });
        console.log('📋 Total saved states after merge:', savedStates.length);
    } catch (e) {
        console.warn('⚠️ Could not read localStorage:', e);
    }
    
    if (savedStates.length === 0) {
        container.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">No saved game states yet</div>';
        console.log('ℹ️ No saved states to display');
        return;
    }
    
    try {
        // Sort by date (newest first) or modified time
        savedStates.sort((a, b) => {
            if (a.modified && b.modified) {
                return (b.modified || 0) - (a.modified || 0);
            }
            const aDate = new Date(a.savedAt || 0);
            const bDate = new Date(b.savedAt || 0);
            return bDate - aDate;
        });
        
        // Helper function to format relative time
        function getRelativeTime(date) {
            const now = new Date();
            const saved = new Date(date);
            const diffMs = now - saved;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins} min ago`;
            if (diffHours < 24) return `${diffHours} hr ago`;
            if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            return saved.toLocaleDateString();
        }
        
        let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
        savedStates.forEach((state, index) => {
            const savedDate = new Date(state.savedAt);
            const dateStr = savedDate.toLocaleString();
            const relativeTime = getRelativeTime(state.savedAt);
            const isCombatActive = state.combatActive || false;
            
            html += `
                <div style="position: relative; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 5px; border: 1px solid ${isCombatActive ? 'rgba(255,68,68,0.3)' : 'rgba(255,255,255,0.1)'};">
                    
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <div style="font-size: 24px;">💾</div>
                        <div style="flex: 1; ${isDM ? 'padding-right: 30px;' : ''}">
                            <div style="font-weight: bold; font-size: 14px; color: #fff; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                                ${escapeHtml(state.name)}
                                ${state.isLocalStorage ? '<span style="font-size: 9px; background: rgba(255,170,68,0.3); color: #ffaa44; padding: 2px 5px; border-radius: 3px; font-weight: 500;">LOCAL</span>' : ''}
                                ${isCombatActive ? '<span style="font-size: 10px; color: #ff4444; font-weight: bold;">⚔️ Combat</span>' : ''}
                            </div>
                            <div style="font-size: 11px; color: #888;">
                                ${relativeTime} • ${dateStr}
                            </div>
                        </div>
                    </div>
                    
                    <div style="font-size: 11px; color: #aaa; margin-bottom: 8px; display: flex; gap: 12px; flex-wrap: wrap;">
                        <span>📍 ${escapeHtml(state.mapName || 'No Map')}</span>
                        <span>🎭 ${state.tokenCount || 0} token${(state.tokenCount || 0) !== 1 ? 's' : ''}</span>
                    </div>
                    
                    <div style="display: flex; gap: 8px;">
                        <button onclick="loadSavedStateFromServer('${escapeHtml(state.filename || state.name + '.json')}')" 
                                style="flex: 1; padding: 8px; background: #4a9eff; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;">
                            📂 Load
                        </button>
                        ${isDM && !state.isLocalStorage ? `<button onclick="deleteSavedStateFromServer('${escapeHtml(state.filename)}')" 
                                style="padding: 8px; background: #ff4444; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;" title="Delete from server">
                            🗑️
                        </button>` : ''}
                        ${state.isLocalStorage && state.id ? `<button onclick="deleteSavedState('${state.id}')" 
                                style="padding: 8px; background: #ff4444; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;" title="Delete from localStorage">
                            🗑️
                        </button>` : ''}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
        console.log('✅ Saved states list rendered with', savedStates.length, 'items');
    } catch (e) {
        console.error('❌ Error rendering saved states:', e);
        container.innerHTML = '<div style="padding: 10px; color: #ff4444; text-align: center;">Error loading saved states: ' + e.message + '</div>';
    }
}

function deleteSavedState(stateId) {
    if (!isDM) {
        alert('Only DM can delete saved states!');
        return;
    }
    
    try {
        const savedStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
        const state = savedStates.find(s => s.id === stateId);
        
    if (!state) {
        alert('Save state not found!');
        return;
    }
    
    if (!confirm(`⚠️ Delete saved state "${state.name}"?\n\nSaved: ${new Date(state.savedAt).toLocaleString()}\n\nThis cannot be undone!`)) {
        return;
    }
    
        const filtered = savedStates.filter(s => s.id !== stateId);
        localStorage.setItem('savedGameStates', JSON.stringify(filtered));
        
        // Also remove the actual data
        localStorage.removeItem(`savedGameState_${stateId}`);
        
        console.log('🗑️ Deleted saved state:', state.name);
        addLogEntry(`🗑️ Deleted saved state: ${state.name}`, 'info');
        
        // Refresh the list
        renderSavedStatesList();
    } catch (e) {
        console.error('Error deleting saved state:', e);
        alert('Error deleting saved state: ' + e.message);
    }
}

async function loadSavedState(stateId) {
    try {
        const savedStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
        const state = savedStates.find(s => s.id === stateId);
        
        if (!state) {
            alert('Save state not found!');
            return;
        }
        
        if (!confirm(`⚠️ Load saved state "${state.name}"?\n\nThis will replace the current game state. Are you sure?`)) {
            return;
        }
        
        // Get the actual game state data from localStorage
        const gameStateData = localStorage.getItem(`savedGameState_${stateId}`);
        if (!gameStateData) {
            // Fallback: try state.data if it exists
            if (state.data) {
                const gameState = JSON.parse(state.data);
                await loadGameStateFromData(gameState, state.name);
            } else {
                alert('Save state data not found! It may have been corrupted.');
                return;
            }
        } else {
            // Parse the game state data
            const gameState = JSON.parse(gameStateData);
            
            // Use the existing loadGameStateFromData function
            await loadGameStateFromData(gameState, state.name);
        }
        
        // Refresh the list
        renderSavedStatesList();
        
        // Refresh load modal if open
        const loadModal = document.getElementById('loadGameModal');
        if (loadModal && loadModal.classList.contains('active')) {
            await renderLoadGameStatesList();
        }
        
    } catch (e) {
        console.error('Error loading saved state:', e);
        alert('Error loading saved state: ' + e.message);
    }
}

async function loadSavedStateFromServer(filename) {
    try {
        if (!confirm(`⚠️ Load saved state "${filename}"?\n\nThis will replace the current game state. Are you sure?`)) {
            return;
        }
        
        console.log('📂 Loading game state from server:', filename);
        
        const response = await fetch(`/api/saves/${encodeURIComponent(filename)}`);
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const gameState = await response.json();
        console.log('📋 Loaded game state from server:', gameState);
        
        await loadGameStateFromData(gameState, filename);
        
        // Refresh the lists if modals are open
        const loadModal = document.getElementById('loadGameModal');
        if (loadModal && loadModal.classList.contains('active')) {
            await renderLoadGameStatesList();
        }
        
    } catch (e) {
        console.error('❌ Error loading saved state from server:', e);
        alert('❌ Error loading saved state: ' + e.message);
    }
}

async function deleteSavedStateFromServer(filename) {
    if (!isDM) {
        alert('Only DM can delete saved states!');
        return;
    }
    
    try {
        if (!confirm(`⚠️ Delete saved state "${filename}"?\n\nThis cannot be undone!`)) {
            return;
        }
        
        const response = await fetch(`/api/saves/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            console.log('🗑️ Deleted saved state from server:', filename);
            addLogEntry(`🗑️ Deleted saved state: ${filename}`, 'info');
            
            // Refresh the lists if modals are open
            const loadModal = document.getElementById('loadGameModal');
            if (loadModal && loadModal.classList.contains('active')) {
                await renderLoadGameStatesList();
            }
            renderSavedStatesList();
        } else {
            throw new Error(`Server returned ${response.status}`);
        }
        
    } catch (e) {
        console.error('Error deleting saved state:', e);
        alert('Error deleting saved state: ' + e.message);
    }
}

// Clear current map and all tokens
function clearCurrentMap() {
    if (!confirm('⚠️ Are you sure you want to clear the current map?\n\nThis will remove:\n- The current map\n- All tokens on the board\n\nThis action cannot be undone.')) {
        return;
    }
    
    console.log('🗑️ Clearing current map...');
    
    // Notify server to remove all tokens before clearing locally
    const tokensToRemove = [...tokens]; // Copy array before clearing
    tokensToRemove.forEach(token => {
        sendMessage({
            type: 'RemoveToken',
            token_id: token.id
        });
    });
    
    // Clear map
    currentMap = null;
    
    // Clear all tokens
    tokens = [];
    
    // Clear token images cache
    tokenImages = {};
    
    // Clear selected token
    selectedToken = null;
    
    // Clear canvas
    renderCanvas();
    
    console.log('✅ Map and tokens cleared');
    addLogEntry('🗑️ Map and all tokens cleared', 'info');
    closeModal('saveLoadModal');
    
    alert('✅ Map and all tokens have been cleared.');
}

function filterNPCList() {
    renderEnemyList(); // Re-render with filter
}

function showCreateEnemy() {
    document.getElementById('createEnemyModal').classList.add('active');
}

function showImportEnemy() {
    document.getElementById('importEnemyModal').classList.add('active');
}

async function createEnemy() {
    const baseEnemy = {
        id: generateUUID(),
        name: document.getElementById('enemyName').value,
        creature_type: document.getElementById('enemyType').value,
        challenge_rating: parseFloat(document.getElementById('enemyCR').value),
        max_hp: parseInt(document.getElementById('enemyHP').value),
        armor_class: parseInt(document.getElementById('enemyAC').value),
        initiative_bonus: parseInt(document.getElementById('enemyInitBonus').value),
        strength: parseInt(document.getElementById('enemyStr').value),
        dexterity: parseInt(document.getElementById('enemyDex').value),
        constitution: parseInt(document.getElementById('enemyCon').value),
        intelligence: parseInt(document.getElementById('enemyInt').value),
        wisdom: parseInt(document.getElementById('enemyWis').value),
        charisma: parseInt(document.getElementById('enemyCha').value),
        speed: parseInt(document.getElementById('enemySpeed').value),
        actions: document.getElementById('enemyActions').value || '{}',
        description: document.getElementById('enemyDescription').value || '',
        style: selectedStyle
    };
    
    const portraitFile = document.getElementById('enemyPortrait').files[0];
    let localPortrait = null;
    if (portraitFile) {
        localPortrait = await fileToBase64(portraitFile);
        console.log('🖼️ Enemy portrait attached (local only)');
    }
    
    const serverPayload = buildEnemyServerPayload(baseEnemy);
    console.log('🔼 Sending CreateEnemy payload:', serverPayload);
    sendMessage({
        type: 'CreateEnemy',
        enemy: serverPayload
    });
    
    // Keep local copy with portrait for UI rendering
    const localEnemy = { ...baseEnemy };
    if (localPortrait) {
        localEnemy.local_portrait = localPortrait;
    }
    enemies.push(localEnemy);
    renderEnemyList();
    
    closeModal('createEnemyModal');
    document.getElementById('enemyForm').reset();
    addLogEntry(`Created enemy: ${baseEnemy.name}`, 'info');
}

async function importEnemy() {
    try {
        const jsonText = document.getElementById('enemyJson').value;
        const enemyData = JSON.parse(jsonText);
        
        // Build enemy object with defaults
        const baseEnemy = {
            id: generateUUID(),
            name: enemyData.name || 'Unknown Enemy',
            creature_type: enemyData.creature_type || enemyData.type || 'Unknown',
            challenge_rating: enemyData.challenge_rating || enemyData.cr || 0,
            max_hp: enemyData.max_hp || enemyData.hp || 10,
            armor_class: enemyData.armor_class || enemyData.ac || 10,
            initiative_bonus: enemyData.initiative_bonus || enemyData.initiative || 0,
            strength: enemyData.strength || enemyData.str || 10,
            dexterity: enemyData.dexterity || enemyData.dex || 10,
            constitution: enemyData.constitution || enemyData.con || 10,
            intelligence: enemyData.intelligence || enemyData.int || 10,
            wisdom: enemyData.wisdom || enemyData.wis || 10,
            charisma: enemyData.charisma || enemyData.cha || 10,
            speed: enemyData.speed || 30,
            actions: enemyData.actions ? JSON.stringify(enemyData.actions) : '{}',
            description: enemyData.description || '',
            style: selectedStyle
        };
        
        const portraitFile = document.getElementById('importEnemyPortrait').files[0];
        let localPortrait = null;
        if (portraitFile) {
            localPortrait = await fileToBase64(portraitFile);
            console.log('🖼️ Enemy portrait attached (local only)');
        }
        
        console.log('📥 Importing enemy:', baseEnemy.name);
        
        const serverPayload = buildEnemyServerPayload(baseEnemy);
        console.log('🔼 Sending CreateEnemy payload (import):', serverPayload);
        sendMessage({
            type: 'CreateEnemy',
            enemy: serverPayload
        });
        
        const localEnemy = { ...baseEnemy };
        if (localPortrait) {
            localEnemy.local_portrait = localPortrait;
        }
        enemies.push(localEnemy);
        renderEnemyList();
        
        closeModal('importEnemyModal');
        document.getElementById('enemyJson').value = '';
        document.getElementById('importEnemyPortrait').value = '';
        addLogEntry(`Imported enemy: ${baseEnemy.name}`, 'info');
    } catch (e) {
        console.error('Import error:', e);
        alert('Invalid JSON format: ' + e.message);
    }
}

function renderEnemyList() {
    const list = document.getElementById('enemyList');
    if (!list) return;
    
    // Get search filter
    const searchInput = document.getElementById('npcSearchInput');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    // Filter custom enemies
    const filteredEnemies = (enemies || []).filter(enemy => {
        if (!enemy) return false;
        if (enemy.style && enemy.style !== selectedStyle) return false;
        if (searchTerm && !enemy.name.toLowerCase().includes(searchTerm)) return false;
        return true;
    });
    
    // Filter NPCs from npc.json
    const filteredNPCs = (npcs || []).filter(npc => {
        if (!npc || !npc.name) return false;
        if (searchTerm && !npc.name.toLowerCase().includes(searchTerm) && 
            !(npc.type && npc.type.toLowerCase().includes(searchTerm))) return false;
        return true;
    });
    
    const totalCount = filteredEnemies.length + filteredNPCs.length;
    
    if (totalCount === 0) {
        list.innerHTML = '<p style="opacity: 0.7;">No enemies or NPCs found. Create one or check your search!</p>';
        return;
    }
    
    list.innerHTML = '';
    
    // Show NPCs from npc.json first
    if (filteredNPCs.length > 0) {
        const npcSection = document.createElement('div');
        npcSection.style.marginBottom = '20px';
        npcSection.innerHTML = `<h3 style="color: #4a9eff; margin-bottom: 10px;">📚 NPC Database (${filteredNPCs.length})</h3>`;
        list.appendChild(npcSection);
        
        filteredNPCs.forEach(npc => {
            const item = document.createElement('div');
            item.className = 'entity-item';
            item.style.position = 'relative';
            item.style.cursor = 'pointer';
            item.onclick = () => spawnNPC(npc);
            
            // Parse HP from hit_points string (e.g., "27 (5d8 + 5)" -> 27)
            const hpMatch = npc.hit_points ? npc.hit_points.match(/(\d+)/) : null;
            const maxHp = hpMatch ? parseInt(hpMatch[1]) : 0;
            
            // Parse AC from armor_class string (e.g., "11 (armor plating)" -> 11)
            const acMatch = npc.armor_class ? npc.armor_class.match(/(\d+)/) : null;
            const ac = acMatch ? parseInt(acMatch[1]) : 0;
            
            item.innerHTML = `
                <h4>${npc.name}</h4>
                <div class="entity-stats">
                    <div class="entity-stat">CR ${npc.challenge || '0'}</div>
                    <div class="entity-stat">HP ${maxHp}</div>
                    <div class="entity-stat">AC ${ac}</div>
                </div>
                <p style="font-size: 11px; margin-top: 6px; opacity: 0.8;">${npc.type || 'Unknown'} - ${npc.size || 'Medium'}</p>
            `;
            
            list.appendChild(item);
        });
    }
    
    // Show custom enemies
    if (filteredEnemies.length > 0) {
        const enemySection = document.createElement('div');
        enemySection.style.marginTop = '20px';
        enemySection.innerHTML = `<h3 style="color: #ff4444; margin-bottom: 10px;">👹 Custom Enemies (${filteredEnemies.length})</h3>`;
        list.appendChild(enemySection);
        
        filteredEnemies.forEach(enemy => {
            if (!enemy) return;
            const item = document.createElement('div');
            item.className = 'entity-item';
            item.style.position = 'relative';
            item.onclick = () => spawnEnemy(enemy.id, enemy.name);
            const content = document.createElement('div');
            content.className = 'entity-item';
            content.style.position = 'relative';
            content.onclick = () => spawnEnemy(enemy.id, enemy.name);
            content.innerHTML = `
                <h4>${enemy.name}</h4>
                <div class="entity-stats">
                    <div class="entity-stat">CR ${enemy.challenge_rating}</div>
                    <div class="entity-stat">HP ${enemy.max_hp}</div>
                    <div class="entity-stat">AC ${enemy.armor_class}</div>
                </div>
                <p style="font-size: 12px; margin-top: 8px;">${enemy.description || ''}</p>
            `;
            
            item.appendChild(content);
            
            // Delete button (DM only)
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️ Delete';
            deleteBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: #ff4444; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px;';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteEnemy(enemy.id, enemy.name);
            };
            item.appendChild(deleteBtn);
            
            list.appendChild(item);
        });
    }
}

function deleteEnemy(enemyId, enemyName) {
    if (!isDM) {
        alert('Only DM can delete enemies!');
        return;
    }
    
    if (confirm(`Delete ${enemyName}?\n\nThis will:\n- Remove from database\n- Spawned instances on map will remain\n- Cannot be undone!\n\nAre you sure?`)) {
        console.log('🗑️ Deleting enemy template:', enemyName, 'ID:', enemyId);
        
        sendMessage({
            type: 'DeleteEnemy',
            enemy_id: enemyId
        });
        
        // Remove from local array (only the template, not instances)
        const index = enemies.findIndex(e => e.id === enemyId);
        if (index !== -1) {
            enemies.splice(index, 1);
            console.log('✅ Removed from local array. Remaining:', enemies.length);
            renderEnemyList();
        }
        
        addLogEntry(`Deleted enemy template: ${enemyName}`, 'info');
    }
}

function spawnNPC(npc) {
    console.log('========== SPAWNING NPC ==========');
    console.log('NPC:', npc.name);
    
    const instanceName = prompt(`Name for this ${npc.name}:`, `${npc.name} 1`);
    if (!instanceName) return;
    
    // Generate instance ID
    const instanceId = generateUUID();
    
    // Parse HP from hit_points string
    const hpMatch = npc.hit_points ? npc.hit_points.match(/(\d+)/) : null;
    const maxHp = hpMatch ? parseInt(hpMatch[1]) : 0;
    
    // Parse AC from armor_class string
    const acMatch = npc.armor_class ? npc.armor_class.match(/(\d+)/) : null;
    const ac = acMatch ? parseInt(acMatch[1]) : 0;
    
    // Parse ability scores from raw_block
    const parsedData = parseNPCRawBlock(npc.raw_block || '');
    
    // Create enemy-like object for local storage - CRITICAL: mark as NPC with full data
    const npcEnemy = {
        id: instanceId,
        name: instanceName,
        creature_type: npc.type || 'Unknown',
        challenge_rating: parseFloat(npc.challenge) || 0,
        max_hp: maxHp,
        current_hp: maxHp,
        armor_class: ac,
        initiative_bonus: parsedData.initiative_bonus || 0,
        strength: parsedData.str || 10,
        dexterity: parsedData.dex || 10,
        constitution: parsedData.con || 10,
        intelligence: parsedData.int || 10,
        wisdom: parsedData.wis || 10,
        charisma: parsedData.cha || 10,
        speed: parseSpeed(npc.speed) || 30,
        actions: npc.actions || '',
        description: npc.raw_block || '',
        isNPC: true, // CRITICAL FLAG: identifies this as an NPC instance
        npcData: npc // CRITICAL: Store full NPC data for character sheet
    };
    
    // Check if this ID already exists (shouldn't happen, but safety check)
    const existing = enemies.find(e => e.id === instanceId);
    if (existing) {
        console.warn('⚠️ NPC instance ID already exists, updating instead of adding');
        const index = enemies.findIndex(e => e.id === instanceId);
        enemies[index] = npcEnemy; // Update existing
    } else {
        // Add to local enemies list - NPC instances are NEVER removed by server updates
        enemies.push(npcEnemy);
    }
    
    console.log('✅ Added NPC instance:', instanceId, instanceName, 'Total NPCs:', enemies.filter(e => e.isNPC).length);
    
    // Place token
    sendMessage({
        type: 'PlaceToken',
        entity_id: instanceId,
        entity_type: 'Enemy',
        x: 5,
        y: 5
    });
    
    closeModal('enemyManagerModal');
    addLogEntry(`Spawned ${instanceName}`, 'info');
}

function parseSpeed(speedStr) {
    if (!speedStr) return 30;
    // Try to extract first number (e.g., "25 ft." -> 25, "0 ft., fly 50 ft." -> 0)
    const match = speedStr.match(/(\d+)\s*ft/);
    return match ? parseInt(match[1]) : 30;
}

// Parse NPC raw_block to extract ability scores, tech powers, and force powers
function parseNPCRawBlock(rawBlock) {
    const result = {
        str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
        initiative_bonus: 0,
        techPowers: [],
        forcePowers: [],
        skills: [],
        traits: []
    };
    
    if (!rawBlock) return result;
    
    // Extract ability scores (e.g., "STR 10 (+0)" or "STR 10")
    const abilityPatterns = {
        str: /STR\s+(\d+)/i,
        dex: /DEX\s+(\d+)/i,
        con: /CON\s+(\d+)/i,
        int: /INT\s+(\d+)/i,
        wis: /WIS\s+(\d+)/i,
        cha: /CHA\s+(\d+)/i
    };
    
    Object.keys(abilityPatterns).forEach(ability => {
        const match = rawBlock.match(abilityPatterns[ability]);
        if (match) {
            result[ability] = parseInt(match[1]);
        }
    });
    
    // Extract initiative bonus if mentioned
    const initMatch = rawBlock.match(/initiative.*?([+-]?\d+)/i);
    if (initMatch) {
        result.initiative_bonus = parseInt(initMatch[1]);
    } else {
        // Calculate from DEX if not specified
        result.initiative_bonus = Math.floor((result.dex - 10) / 2);
    }
    
    // Extract tech powers
    const techPatterns = [
        /techcasting.*?tech powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /tech powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /techcaster.*?tech powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is
    ];
    
    for (const pattern of techPatterns) {
        const match = rawBlock.match(pattern);
        if (match) {
            const powersText = match[1];
            // Extract power names (look for patterns like "power name" or "power name,")
            const powerMatches = powersText.matchAll(/(?:At will|1st-level|2nd-level|3rd-level|4th-level|5th-level|6th-level|7th-level|8th-level|9th-level)[:\s]+(.*?)(?:\d+[a-z-]*-level|Actions|Traits|$)/gi);
            for (const powerMatch of powerMatches) {
                const powers = powerMatch[1].split(',').map(p => p.trim()).filter(p => p);
                result.techPowers.push(...powers);
            }
            // Also try simple comma-separated list
            if (result.techPowers.length === 0) {
                const simplePowers = powersText.split(',').map(p => p.trim()).filter(p => p && p.length > 2);
                result.techPowers.push(...simplePowers);
            }
        }
    }
    
    // Extract force powers
    const forcePatterns = [
        /forcecasting.*?force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /forcecaster.*?force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /innate forcecasting.*?force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is
    ];
    
    for (const pattern of forcePatterns) {
        const match = rawBlock.match(pattern);
        if (match) {
            const powersText = match[1];
            // Extract power names
            const powerMatches = powersText.matchAll(/(?:At will|1st-level|2nd-level|3rd-level|4th-level|5th-level|6th-level|7th-level|8th-level|9th-level)[:\s]+(.*?)(?:\d+[a-z-]*-level|Actions|Traits|$)/gi);
            for (const powerMatch of powerMatches) {
                const powers = powerMatch[1].split(',').map(p => p.trim()).filter(p => p);
                result.forcePowers.push(...powers);
            }
            // Also try simple comma-separated list
            if (result.forcePowers.length === 0) {
                const simplePowers = powersText.split(',').map(p => p.trim()).filter(p => p && p.length > 2);
                result.forcePowers.push(...simplePowers);
            }
        }
    }
    
    // Extract skills
    const skillsMatch = rawBlock.match(/Skills\s+(.*?)(?:Damage|Senses|Languages|Challenge|Actions|Traits|$)/i);
    if (skillsMatch) {
        const skillsText = skillsMatch[1];
        const skillMatches = skillsText.matchAll(/(\w+)\s*([+-]?\d+)/g);
        for (const skillMatch of skillMatches) {
            result.skills.push({ name: skillMatch[1], bonus: parseInt(skillMatch[2]) });
        }
    }
    
    // Extract traits (look for "Traits" section)
    const traitsMatch = rawBlock.match(/Traits\s+(.*?)(?:Actions|Challenge|$)/is);
    if (traitsMatch) {
        const traitsText = traitsMatch[1];
        // Split by common patterns
        const traitMatches = traitsText.split(/(?=[A-Z][a-z]+)/).filter(t => t.trim().length > 10);
        result.traits = traitMatches.map(t => t.trim());
    }
    
    return result;
}

// Show NPC character sheet
function showNPCCharacterSheet(entityId) {
    const enemy = enemies.find(e => e.id === entityId);
    if (!enemy || !enemy.isNPC || !enemy.npcData) {
        console.error('NPC not found or invalid');
        return;
    }
    
    const npc = enemy.npcData;
    const parsedData = parseNPCRawBlock(npc.raw_block || '');
    
    // Get current HP from combat if available
    const participant = combatState.participants.find(p => p.id === selectedToken?.id);
    const currentHp = participant ? participant.current_hp : enemy.current_hp;
    const maxHp = participant ? participant.max_hp : enemy.max_hp;
    
    // Parse HP and AC
    const hpMatch = npc.hit_points ? npc.hit_points.match(/(\d+)/) : null;
    const displayMaxHp = hpMatch ? parseInt(hpMatch[1]) : maxHp;
    const acMatch = npc.armor_class ? npc.armor_class.match(/(\d+)/) : null;
    const ac = acMatch ? parseInt(acMatch[1]) : enemy.armor_class;
    
    // Build character sheet HTML
    let html = '<div style="max-height: 70vh; overflow-y: auto; padding-right: 10px;">';
    
    // Header
    html += `<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px;">
        <div class="panel" style="padding: 15px;">
            <h4 style="color: #4a9eff;">👹 NPC Info</h4>
            <div class="token-stat"><span>Name:</span><span>${enemy.name}</span></div>
            <div class="token-stat"><span>Type:</span><span>${npc.type || 'Unknown'}</span></div>
            <div class="token-stat"><span>Size:</span><span>${npc.size || 'Medium'}</span></div>
            <div class="token-stat"><span>Challenge:</span><span>${npc.challenge || '0'}</span></div>
            <div class="token-stat"><span>Alignment:</span><span>${npc.alignment || 'Unaligned'}</span></div>
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <h4 style="color: #ff4444;">💚 HP</h4>
            <div style="font-size: 32px; font-weight: bold; color: #44ff44;">${currentHp}</div>
            <div style="opacity: 0.7;">/ ${displayMaxHp}</div>
            <div class="hp-bar" style="margin-top: 10px;"><div class="hp-fill" style="width: ${(currentHp / displayMaxHp) * 100}%"></div></div>
        </div>
    </div>`;
    
    // Ability Scores
    html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #4a9eff;">📊 Ability Scores</h4>
        <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">`;
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const abilityNames = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
    abilities.forEach(ab => {
        const score = parsedData[ab] || enemy[ab] || 10;
        const mod = Math.floor((score - 10) / 2);
        html += `<div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px;">
            <div style="font-size: 24px; font-weight: bold;">${score}</div>
            <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">${abilityNames[ab]}</div>
            <div style="font-size: 12px; margin-top: 5px;">${mod >= 0 ? '+' : ''}${mod}</div>
        </div>`;
    });
    html += `</div></div>`;
    
    // Combat Stats
    html += `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px;">
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">AC</div>
            <div style="font-size: 28px; font-weight: bold; color: #4a9eff;">${ac}</div>
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">INIT</div>
            <div style="font-size: 28px; font-weight: bold; color: #ffaa44;">${parsedData.initiative_bonus >= 0 ? '+' : ''}${parsedData.initiative_bonus}</div>
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">SPEED</div>
            <div style="font-size: 28px; font-weight: bold; color: #44ff44;">${enemy.speed}</div>
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">CR</div>
            <div style="font-size: 28px; font-weight: bold; color: #aa88ff;">${npc.challenge || '0'}</div>
        </div>
    </div>`;
    
    // Damage/Resistances/Immunities
    if (npc.damage_vulnerabilities || npc.damage_resistances || npc.damage_immunities || npc.condition_immunities) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ffaa44;">🛡️ Defenses</h4>`;
        if (npc.damage_vulnerabilities) {
            html += `<div style="margin-bottom: 8px;"><strong style="color: #ff4444;">Vulnerabilities:</strong> ${npc.damage_vulnerabilities}</div>`;
        }
        if (npc.damage_resistances) {
            html += `<div style="margin-bottom: 8px;"><strong style="color: #ffaa44;">Resistances:</strong> ${npc.damage_resistances}</div>`;
        }
        if (npc.damage_immunities) {
            html += `<div style="margin-bottom: 8px;"><strong style="color: #44ff44;">Immunities:</strong> ${npc.damage_immunities}</div>`;
        }
        if (npc.condition_immunities) {
            html += `<div style="margin-bottom: 8px;"><strong style="color: #4a9eff;">Condition Immunities:</strong> ${npc.condition_immunities}</div>`;
        }
        html += `</div>`;
    }
    
    // Skills
    if (parsedData.skills && parsedData.skills.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">🎯 Skills</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">`;
        parsedData.skills.forEach(skill => {
            html += `<div style="padding: 5px 10px; background: rgba(74,158,255,0.1); border-radius: 3px; font-size: 12px;">
                ${skill.name} ${skill.bonus >= 0 ? '+' : ''}${skill.bonus}
            </div>`;
        });
        html += `</div></div>`;
    }
    
    // Tech Powers
    if (parsedData.techPowers && parsedData.techPowers.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #00d4ff;">⚡ Tech Powers <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
            <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
        parsedData.techPowers.forEach(powerName => {
            if (!powerName) return;
            const escapedPower = escapeHtml(powerName);
            const attrPower = powerName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            html += `<div onmouseover="showSpellTooltip('${attrPower}', event)" onmouseout="hideSpellTooltip()" style="padding: 6px 12px; background: rgba(0,212,255,0.12); border-radius: 4px; font-size: 12px; border: 1px solid rgba(0,212,255,0.35); cursor: help; transition: all 0.2s;" onmouseenter="this.style.background='rgba(0,212,255,0.25)'; this.style.borderColor='#00d4ff'" onmouseleave="this.style.background='rgba(0,212,255,0.12)'; this.style.borderColor='rgba(0,212,255,0.35)'">${escapedPower}</div>`;
        });
        html += `</div></div>`;
    }
    
    // Force Powers
    if (parsedData.forcePowers && parsedData.forcePowers.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ff00ff;">✨ Force Powers <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
            <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
        parsedData.forcePowers.forEach(powerName => {
            if (!powerName) return;
            const escapedPower = escapeHtml(powerName);
            const attrPower = powerName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            html += `<div onmouseover="showSpellTooltip('${attrPower}', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(255,0,255,0.2); border-radius: 3px; font-size: 12px; border: 1px solid rgba(255,0,255,0.4); cursor: help; transition: all 0.2s;" onmouseenter="this.style.background='rgba(255,0,255,0.4)'; this.style.borderColor='#ff00ff'" onmouseleave="this.style.background='rgba(255,0,255,0.2)'; this.style.borderColor='rgba(255,0,255,0.4)'">${escapedPower}</div>`;
        });
        html += `</div></div>`;
    }
    
    // Actions
    if (npc.actions) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ff4444;">⚔️ Actions</h4>
            <div style="white-space: pre-wrap; font-size: 12px; line-height: 1.6;">${escapeHtml(npc.actions)}</div>
        </div>`;
    }
    
    // Reactions
    if (npc.reactions) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ffaa44;">🔄 Reactions</h4>
            <div style="white-space: pre-wrap; font-size: 12px; line-height: 1.6;">${escapeHtml(npc.reactions)}</div>
        </div>`;
    }
    
    // Legendary Actions
    if (npc.legendary_actions) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #aa88ff;">⭐ Legendary Actions</h4>
            <div style="white-space: pre-wrap; font-size: 12px; line-height: 1.6;">${escapeHtml(npc.legendary_actions)}</div>
        </div>`;
    }
    
    // Traits
    if (parsedData.traits && parsedData.traits.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">🌟 Traits</h4>`;
        parsedData.traits.forEach(trait => {
            html += `<div style="margin-bottom: 10px; padding: 8px; background: rgba(74,158,255,0.1); border-radius: 3px; font-size: 12px; line-height: 1.5;">${escapeHtml(trait)}</div>`;
        });
        html += `</div>`;
    }
    
    // Senses and Languages
    if (npc.senses || npc.languages) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">👁️ Senses & Languages</h4>`;
        if (npc.senses) {
            html += `<div style="margin-bottom: 8px;"><strong>Senses:</strong> ${escapeHtml(npc.senses)}</div>`;
        }
        if (npc.languages) {
            html += `<div><strong>Languages:</strong> ${escapeHtml(npc.languages)}</div>`;
        }
        html += `</div>`;
    }
    
    // Full raw block (collapsible)
    if (npc.raw_block) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #888; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">📄 Full Stat Block (Click to expand)</h4>
            <div style="display: none; white-space: pre-wrap; font-size: 11px; line-height: 1.5; opacity: 0.8; max-height: 300px; overflow-y: auto;">${escapeHtml(npc.raw_block)}</div>
        </div>`;
    }
    
    html += '</div>';
    
    // Display in character sheet modal
    const sheetTitleEl = document.getElementById('sheetCharacterName');
    const contentEl = document.getElementById('characterSheetContent');
    if (sheetTitleEl && contentEl) {
        sheetTitleEl.textContent = `${enemy.name} - NPC Character Sheet`;
        contentEl.innerHTML = html;
        document.getElementById('characterSheetModal').classList.add('active');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function spawnEnemy(enemyId, enemyName) {
    console.log('========== SPAWNING ENEMY ==========');
    console.log('Base enemy ID:', enemyId);
    console.log('Base enemy name:', enemyName);
    
    const instanceName = prompt(`Name for this ${enemyName}:`, `${enemyName} 1`);
    if (!instanceName) return;
    
    // Generate instance ID ONCE and use it for both spawn and token placement
    const instanceId = generateUUID();
    console.log('Generated instance ID:', instanceId);
    console.log('Instance name:', instanceName);
    
    // Create enemy instance with the instance ID
    console.log('📤 Sending SpawnEnemy message...');
    sendMessage({
        type: 'SpawnEnemy',
        enemy_id: enemyId,
        instance_id: instanceId, // Send the ID to server
        name: instanceName
    });
    
    // Add to local enemies list with the instance ID
    const enemy = enemies.find(e => e.id === enemyId);
    if (enemy) {
        const tempEnemy = {...enemy, id: instanceId, name: instanceName};
        enemies.push(tempEnemy);
        console.log('✅ Added enemy instance locally:', tempEnemy);
    }
    
    // Place token with the SAME instance ID
    console.log('📤 Sending PlaceToken message with instance ID:', instanceId);
    sendMessage({
        type: 'PlaceToken',
        entity_id: instanceId, // Same ID!
        entity_type: 'Enemy',
        x: 5,
        y: 5
    });
    
    closeModal('enemyManagerModal');
    addLogEntry(`Spawned ${instanceName}`, 'info');
}

// Character Management
// Custom Spells Management
function showCustomSpellsManager() {
    document.getElementById('customSpellsModal').classList.add('active');
    loadCustomSpells();
}

function showCreateCustomSpell() {
    // Update title based on selected style
    const title = document.getElementById('createSpellTitle');
    const powerTypeContainer = document.getElementById('powerTypeContainer');
    
    if (selectedStyle === 'starwars') {
        title.textContent = '✨ Create Custom Tech/Force Power';
        powerTypeContainer.style.display = 'block';
    } else {
        title.textContent = '✨ Create Custom Spell';
        powerTypeContainer.style.display = 'none';
    }
    
    // Reset form
    document.getElementById('customSpellForm').reset();
    document.getElementById('spellLevel').value = 0;
    document.getElementById('spellPowerType').value = '';
    
    document.getElementById('createCustomSpellModal').classList.add('active');
}

function saveCustomSpell() {
    const name = document.getElementById('spellName').value.trim();
    const level = parseInt(document.getElementById('spellLevel').value) || 0;
    const school = document.getElementById('spellSchool').value.trim() || null;
    const castingTime = document.getElementById('spellCastingTime').value.trim() || null;
    const range = document.getElementById('spellRange').value.trim() || null;
    const components = document.getElementById('spellComponents').value.trim() || null;
    const duration = document.getElementById('spellDuration').value.trim() || null;
    const description = document.getElementById('spellDescription').value.trim();
    const higherLevel = document.getElementById('spellHigherLevel').value.trim() || null;
    const saveType = document.getElementById('spellSaveType').value.trim() || null;
    const damage = document.getElementById('spellDamage').value.trim() || null;
    const damageType = document.getElementById('spellDamageType').value.trim() || null;
    const ritual = document.getElementById('spellRitual').checked;
    const concentration = document.getElementById('spellConcentration').checked;
    const powerType = selectedStyle === 'starwars' ? (document.getElementById('spellPowerType').value || null) : null;
    
    if (!name || !description) {
        alert('Name and Description are required!');
        return;
    }
    
    const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    sendMessage({
        type: 'SaveCustomSpell',
        id: id,
        name: name,
        level: level,
        school: school,
        casting_time: castingTime,
        range: range,
        components: components,
        duration: duration,
        description: description,
        higher_level: higherLevel,
        save_type: saveType,
        damage: damage,
        damage_type: damageType,
        ritual: ritual,
        concentration: concentration,
        power_type: powerType
    });
    
    addLogEntry(`Created custom ${powerType || 'spell'}: ${name}`, 'info');
    closeModal('createCustomSpellModal');
    setTimeout(() => loadCustomSpells(), 500);
}

function loadCustomSpells() {
    sendMessage({ type: 'GetAllCustomSpells' });
}

function renderCustomSpellsList(spells) {
    const list = document.getElementById('customSpellsList');
    if (!spells || spells.length === 0) {
        list.innerHTML = '<p style="opacity: 0.6; padding: 20px; text-align: center;">No custom spells or powers yet. Create one to get started!</p>';
        return;
    }
    
    let html = '<div style="display: grid; gap: 10px;">';
    spells.forEach(spell => {
        const level = spell.level === 0 || spell.level === '0' ? 'Cantrip' : `Level ${spell.level}`;
        const powerType = spell.power_type ? ` (${spell.power_type})` : '';
        const school = spell.school || '';
        
        html += `
            <div style="padding: 12px; background: rgba(170,136,255,0.1); border-left: 3px solid #aa88ff; border-radius: 5px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 5px;">
                    <div style="flex: 1;">
                        <div style="font-weight: bold; font-size: 16px; color: #aa88ff;">${spell.name}</div>
                        <div style="font-size: 12px; opacity: 0.7; margin-top: 3px;">${level}${powerType}${school ? ' • ' + school : ''}</div>
                    </div>
                    <button onclick="deleteCustomSpell('${spell.id}')" style="background: #ff4444; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;">🗑️ Delete</button>
                </div>
                <div style="font-size: 12px; opacity: 0.8; margin-top: 5px; line-height: 1.4;">
                    ${spell.description || spell.desc || 'No description'}
                </div>
            </div>
        `;
    });
    html += '</div>';
    list.innerHTML = html;
}

function deleteCustomSpell(id) {
    if (confirm('Are you sure you want to delete this custom spell/power?')) {
        sendMessage({ type: 'DeleteCustomSpell', id: id });
        setTimeout(() => loadCustomSpells(), 500);
        addLogEntry('Deleted custom spell/power', 'info');
    }
}

// Handle custom spells list response
function handleCustomSpellsList(message) {
    if (message.type === 'AllCustomSpells') {
        renderCustomSpellsList(message.spells);
    }
}

function showCharacterManager() {
    document.getElementById('characterManagerModal').classList.add('active');
    // Request fresh character list to ensure we have the correct style
    sendMessage({ type: 'ListCharacters' });
    renderCharacterList();
}

function renderCharacterList() {
    const list = document.getElementById('characterList');
    if (!list) return;
    
    list.innerHTML = ''; // Clear first
    
    if (characters.length === 0) {
        list.innerHTML = '<p>No characters created yet. Click "Create Character" to add one!</p>';
        return;
    }
    
    // Check if this is player character selection (not DM viewing)
    const isSelectionMode = !isDM && !myCharacterId;
    
    characters.forEach(char => {
        const item = document.createElement('div');
        item.className = 'entity-item';
        item.style.position = 'relative';
        
        // Main clickable area
        const content = document.createElement('div');
        content.style.cursor = 'pointer';
        content.onclick = () => showCharacterSheet(char, isSelectionMode); // Pass selection mode flag
        content.innerHTML = `
            <h4>${char.name}</h4>
            <p style="font-size: 11px; opacity: 0.8; margin: 4px 0;">${char.class} Level ${char.level} - ${char.player_name}</p>
            <div class="entity-stats">
                <div class="entity-stat">HP ${char.max_hp}</div>
                <div class="entity-stat">AC ${char.armor_class}</div>
                <div class="entity-stat">Init +${char.initiative_bonus}</div>
            </div>
        `;
        
        item.appendChild(content);
        
        // Delete button (DM only)
        if (isDM) {
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️ Delete';
            deleteBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: #ff4444; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px;';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteCharacter(char.id, char.name);
            };
            item.appendChild(deleteBtn);
        }
        
        // Select button (Player selection mode only)
        if (isSelectionMode) {
            const selectBtn = document.createElement('button');
            selectBtn.textContent = '✅ Select';
            selectBtn.style.cssText = 'position: absolute; bottom: 10px; right: 10px; background: #44ff44; color: #000; font-weight: bold; border: none; padding: 5px 15px; border-radius: 3px; cursor: pointer; font-size: 12px;';
            selectBtn.onclick = (e) => {
                e.stopPropagation();
                selectCharacterForPlay(char.id);
                closeModal('characterManagerModal');
            };
            item.appendChild(selectBtn);
        }
        
        list.appendChild(item);
    });
}

function deleteCharacter(charId, charName) {
    if (!isDM) {
        alert('Only DM can delete characters!');
        return;
    }
    
    if (confirm(`Delete ${charName}?\n\nThis will:\n- Remove from database\n- Cannot be undone!\n\nAre you sure?`)) {
        console.log('🗑️ Deleting character:', charName, 'ID:', charId);
        
        sendMessage({
            type: 'DeleteCharacter',
            character_id: charId
        });
        
        // Remove from local array
        const index = characters.findIndex(c => c.id === charId);
        if (index !== -1) {
            characters.splice(index, 1);
            console.log('✅ Removed from local array. Remaining:', characters.length);
            renderCharacterList();
        }
        
        addLogEntry(`Deleted character: ${charName}`, 'info');
    }
}

function selectCharacterForPlay(charId) {
    console.log('🎭 ========== SELECT CHARACTER FOR PLAY ==========');
    console.log('Character ID:', charId);
    console.log('Player name:', myPlayerName);
    console.log('Is DM:', isDM);
    
    const char = characters.find(c => c.id === charId);
    if (!char) {
        console.error('❌ Character not found!', charId);
        alert('Character not found!');
        return;
    }
    
    console.log('✅ Character found:', char.name);
    console.log('   Setting myCharacterId to:', charId);
    
    myCharacterId = charId;
    
    console.log('✅✅✅ CHARACTER SELECTION COMPLETE! ✅✅✅');
    console.log('   myCharacterId is now:', myCharacterId);
    console.log('   Character name:', char.name);
    console.log('   This ID will be used for initiative matching!');
    
    sendMessage({
        type: 'SelectCharacter',
        character_id: charId
    });
    
    // FIX: Update local player list to show their character (bulletproof version)
    const myPlayer = connectedPlayers.find(p => p && p.name === myPlayerName);
    console.log('🎭 Found my player object:', myPlayer);
    
    if (myPlayer) {
        myPlayer.character_name = char.name;
        console.log('✅ Updated character for', myPlayerName, 'to', char.name);
    } else {
        console.error('❌ Could not find my player in list!');
        console.log('Looking for:', myPlayerName);
        console.log('In array:', connectedPlayers.map(p => p ? p.name : 'null'));
    }
    
    console.log('🎭 connectedPlayers after:', JSON.stringify(connectedPlayers));
    
    // Always render
    renderPlayerList();
    
    closeModal('characterManagerModal');
    addLogEntry(`Now controlling: ${char.name}`, 'info');
    
    // Update player info
    document.getElementById('playerInfo').textContent = `Playing as: ${char.name}`;
    
    // Show confirmation
    alert(`✅ Character Selected!\n\n${char.name}\n${char.class} Level ${char.level}\n\nYou're ready to play!`);
}

function showCharacterSelect() {
    showCharacterManager();
}

function showCreateCharacter() {
    document.getElementById('createCharacterModal').classList.add('active');
}

function showImportCharacter() {
    document.getElementById('importCharacterModal').classList.add('active');
}

function convertRoll20StarWarsCharacter(rawData) {
    if (!rawData || !Array.isArray(rawData.attribs)) {
        console.warn('convertRoll20StarWarsCharacter called with invalid data');
        return null;
    }
    
    var attrMap = {};
    for (var i = 0; i < rawData.attribs.length; i++) {
        var attr = rawData.attribs[i];
        if (!attr || !attr.name) {
            continue;
        }
        attrMap[attr.name] = attr;
    }
    
    function getAttrEntry(name) {
        return attrMap[name] || null;
    }
    
    function getAttrValue(name, fallback) {
        if (fallback === undefined) fallback = '';
        var entry = getAttrEntry(name);
        if (!entry) return fallback;
        if (entry.current !== undefined && entry.current !== null && entry.current !== '') {
            return entry.current;
        }
        if (entry.max !== undefined && entry.max !== null && entry.max !== '') {
            return entry.max;
        }
        return fallback;
    }
    
    function getNumeric(name, fallback) {
        if (fallback === undefined) fallback = 0;
        var value = getAttrValue(name, null);
        if (value === null || value === undefined || value === '') return fallback;
        if (typeof value === 'string') {
            value = value.replace(/[^0-9.\-]/g, '');
        }
        var num = parseFloat(value);
        return isNaN(num) ? fallback : num;
    }
    
    function getBoolean(name) {
        var value = getAttrValue(name, '');
        if (typeof value === 'string') {
            var trimmed = value.trim().toLowerCase();
            if (trimmed === 'on' || trimmed === 'true' || trimmed === 'yes') return true;
            if (trimmed.indexOf('@{pb}') !== -1) return true;
        }
        var num = parseFloat(value);
        return !isNaN(num) && num > 0;
    }
    
    function parseIntSafe(value, fallback) {
        if (fallback === undefined) fallback = 0;
        if (value === null || value === undefined || value === '') return fallback;
        var num = parseInt(value, 10);
        return isNaN(num) ? fallback : num;
    }
    
    function getEntryValue(entry, field, fallback) {
        if (fallback === undefined) fallback = null;
        if (!entry) return fallback;
        var value = entry[field];
        return value !== undefined && value !== null && value !== '' ? value : fallback;
    }
    
    var charName = rawData.name || getAttrValue('character_name', 'Unknown');
    var classDisplay = getAttrValue('class_display', '').trim();
    var className = classDisplay || getAttrValue('class', 'Unknown');
    var level = Math.max(1, parseIntSafe(getAttrValue('level', getAttrValue('base_level', '1')), 1));
    var pb = Math.max(1, getNumeric('pb', 2));
    
    var hpAttr = getAttrEntry('hp') || {};
    var maxHP = Math.max(1, parseIntSafe(hpAttr.max || hpAttr.current || 10, 10));
    var currentHP = Math.min(maxHP, Math.max(0, parseIntSafe(hpAttr.current || maxHP || 10, maxHP)));
    var ac = Math.max(0, getNumeric('ac', 10));
    var initiativeBonus = getNumeric('initiative_bonus', 0);
    var speedValue = getAttrValue('speed', '30');
    var speedMatch = String(speedValue).match(/\d+/);
    var speed = Math.max(0, parseIntSafe(speedMatch ? speedMatch[0] : 30, 30));
    var playerName = rawData.player_name || (rawData.controlledby && rawData.controlledby.trim() !== '' ? rawData.controlledby : 'Unknown');
    var background = getAttrValue('background', '');
    var alignment = getAttrValue('alignment', '');
    
    var abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var abilityLabels = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
    var abilityAttrs = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    var abilitySaveBonusAttrs = ['strength_save_bonus', 'dexterity_save_bonus', 'constitution_save_bonus', 'intelligence_save_bonus', 'wisdom_save_bonus', 'charisma_save_bonus'];
    var abilitySaveProfAttrs = ['strength_save_prof', 'dexterity_save_prof', 'constitution_save_prof', 'intelligence_save_prof', 'wisdom_save_prof', 'charisma_save_prof'];
    
    var baseAbilityScores = {};
    var abilities = {};
    for (var a = 0; a < abilityKeys.length; a++) {
        var score = getNumeric(abilityAttrs[a], 10);
        var mod = Math.floor((score - 10) / 2);
        var save = getNumeric(abilitySaveBonusAttrs[a], mod);
        var proficient = getBoolean(abilitySaveProfAttrs[a]);
        abilities[abilityKeys[a]] = {
            score: score,
            mod: mod,
            save: save,
            save_proficient: proficient
        };
        baseAbilityScores[abilityLabels[a]] = score;
    }
    
    var skills = {};
    var skillList = ['athletics', 'acrobatics', 'sleight_of_hand', 'stealth',
        'investigation', 'nature', 'insight', 'medicine', 'perception', 'survival',
        'deception', 'intimidation', 'performance', 'persuasion'];
    for (var s = 0; s < skillList.length; s++) {
        var skill = skillList[s];
        var bonusVal = getAttrValue(skill + '_bonus', null);
        if (bonusVal === null || bonusVal === undefined || bonusVal === '') continue;
        var bonus = parseFloat(bonusVal);
        var typeValue = parseIntSafe(getAttrValue(skill + '_type', '0'), 0);
        var proficientSkill = getBoolean(skill + '_prof') || typeValue > 0;
        var expertise = typeValue >= 2;
        skills[skill] = {
            mod: isNaN(bonus) ? 0 : bonus,
            proficient: proficientSkill,
            expertise: expertise
        };
    }
    
    var attackGroups = {};
    for (var key in attrMap) {
        if (!Object.prototype.hasOwnProperty.call(attrMap, key)) continue;
        if (key.indexOf('repeating_attack_') !== 0) continue;
        var rest = key.substring('repeating_attack_'.length);
        var underscoreIndex = rest.indexOf('_');
        if (underscoreIndex === -1) continue;
        var groupId = rest.substring(0, underscoreIndex);
        var field = rest.substring(underscoreIndex + 1);
        if (!attackGroups[groupId]) {
            attackGroups[groupId] = {};
        }
        attackGroups[groupId][field] = attrMap[key];
    }
    
    var attacks = [];
    for (var groupId in attackGroups) {
        if (!Object.prototype.hasOwnProperty.call(attackGroups, groupId)) continue;
        var group = attackGroups[groupId];
        if (!group) continue;
        var nameValue = getEntryValue(group.atkname, 'current', getEntryValue(group.atkname, 'max', ''));
        var atkName = String(nameValue || '').trim();
        if (!atkName) atkName = 'Attack';
        var toHitVal = getEntryValue(group.atkbonus, 'current', getEntryValue(group.atkbonus, 'max', 0));
        var toHit = parseIntSafe(toHitVal, 0);
        var damageTypeStringVal = getEntryValue(group.atkdmgtype, 'current', getEntryValue(group.atkdmgtype, 'max', ''));
        var damageTypeString = damageTypeStringVal ? String(damageTypeStringVal).trim() : '';
        var damageTypeVal = getEntryValue(group.dmgtype, 'current', getEntryValue(group.dmgtype, 'max', ''));
        var damageType = damageTypeVal ? String(damageTypeVal).trim() : '';
        var damage = '';
        if (damageTypeString) {
            var suffix = damageType ? ' ' + damageType : '';
            if (suffix && damageTypeString.length >= suffix.length &&
                damageTypeString.lastIndexOf(suffix) === damageTypeString.length - suffix.length) {
                damage = damageTypeString.substring(0, damageTypeString.length - suffix.length);
            } else {
                damage = damageTypeString;
            }
        } else {
            var dmgBaseVal = getEntryValue(group.dmgbase, 'current', getEntryValue(group.dmgbase, 'max', ''));
            damage = dmgBaseVal ? String(dmgBaseVal).trim() : '';
        }
        if (!damage) damage = '—';
        var descVal = getEntryValue(group.atk_desc, 'current', getEntryValue(group.atk_desc, 'max', ''));
        var desc = descVal ? String(descVal).trim() : '';
        var properties = [];
        if (desc) {
            var parts = desc.split(',');
            for (var p = 0; p < parts.length; p++) {
                var prop = parts[p].trim();
                if (prop) properties.push(prop);
            }
        }
        attacks.push({
            name: atkName,
            to_hit: toHit,
            damage: damage,
            type: damageType,
            mastery: null,
            properties: properties,
            description: desc
        });
    }
    
    function pushUnique(list, value) {
        if (!value) return;
        if (list.indexOf(value) === -1) {
            list.push(value);
        }
    }
    
    var powerGroups = {};
    for (var powerKey in attrMap) {
        if (!Object.prototype.hasOwnProperty.call(attrMap, powerKey)) continue;
        if (powerKey.indexOf('repeating_power-') !== 0) continue;
        var powerRest = powerKey.substring('repeating_power-'.length);
        var firstUnderscore = powerRest.indexOf('_');
        if (firstUnderscore === -1) continue;
        var category = powerRest.substring(0, firstUnderscore);
        var remainder = powerRest.substring(firstUnderscore + 1);
        var secondUnderscore = remainder.indexOf('_');
        if (secondUnderscore === -1) continue;
        var rowId = remainder.substring(0, secondUnderscore);
        var fieldName = remainder.substring(secondUnderscore + 1);
        var groupId = category + '_' + rowId;
        if (!powerGroups[groupId]) {
            powerGroups[groupId] = {
                category: category,
                fields: {}
            };
        }
        powerGroups[groupId].fields[fieldName] = attrMap[powerKey];
    }
    
    var techPowerNames = [];
    var forcePowerNames = [];
    var techPowerDetails = [];
    var forcePowerDetails = [];
    
    function normalizeLevel(rawLevel, category) {
        return normalizePowerLevel(rawLevel, category);
    }
    
    for (var powerId in powerGroups) {
        if (!Object.prototype.hasOwnProperty.call(powerGroups, powerId)) continue;
        var pg = powerGroups[powerId];
        var fields = pg.fields || {};
        var nameEntry = fields.powername;
        var powerName = getEntryValue(nameEntry, 'current', getEntryValue(nameEntry, 'max', '')).trim();
        if (!powerName) continue;
        var schoolEntry = fields.powerschool;
        var schoolRaw = getEntryValue(schoolEntry, 'current', getEntryValue(schoolEntry, 'max', '')).trim().toLowerCase();
        if (!schoolRaw && pg.category) {
            schoolRaw = String(pg.category).toLowerCase();
        }
        var levelEntry = fields.powerlevel;
        var levelInfo = normalizeLevel(getEntryValue(levelEntry, 'current', getEntryValue(levelEntry, 'max', '')), pg.category);
        var level = levelInfo.value;
        var castingEntry = fields.powercastingtime;
        var rangeEntry = fields.powerrange;
        var durationEntry = fields.powerduration;
        var concentrationEntry = fields.powerconcentration;
        var descriptionEntry = fields.powerdescription;
        var higherLevelsEntry = fields.powerathigherlevels;
        var componentsEntry = fields.powercomponents || fields.components;
        var sourceEntry = fields.powersource || fields.source;
        
        var castingTime = getEntryValue(castingEntry, 'current', getEntryValue(castingEntry, 'max', ''));
        var rangeValue = getEntryValue(rangeEntry, 'current', getEntryValue(rangeEntry, 'max', ''));
        var durationValue = getEntryValue(durationEntry, 'current', getEntryValue(durationEntry, 'max', ''));
        var concentrationRaw = getEntryValue(concentrationEntry, 'current', getEntryValue(concentrationEntry, 'max', ''));
        var concentrationValue = '';
        if (concentrationRaw !== null && concentrationRaw !== undefined && concentrationRaw !== '') {
            var concText = String(concentrationRaw).trim().toLowerCase();
            if (concText === '0' || concText === 'no' || concText === 'false' || concText === 'off') {
                concentrationValue = '';
            } else if (concText === '1' || concText === 'yes' || concText === 'on') {
                concentrationValue = 'Concentration';
            } else {
                concentrationValue = concentrationRaw;
            }
        }
        var descriptionText = getEntryValue(descriptionEntry, 'current', getEntryValue(descriptionEntry, 'max', ''));
        var higherLevels = getEntryValue(higherLevelsEntry, 'current', getEntryValue(higherLevelsEntry, 'max', ''));
        var componentsValue = getEntryValue(componentsEntry, 'current', getEntryValue(componentsEntry, 'max', ''));
        var sourceValue = getEntryValue(sourceEntry, 'current', getEntryValue(sourceEntry, 'max', ''));
        var damageEntry = fields.powerdamage || fields.damage || fields.powereffect;
        var damageValue = getEntryValue(damageEntry, 'current', getEntryValue(damageEntry, 'max', ''));
        var saveEntry = fields.powersave || fields.saving_throw || fields.save;
        var saveValue = getEntryValue(saveEntry, 'current', getEntryValue(saveEntry, 'max', ''));
        
        var detail = {
            name: powerName,
            level: level,
            casting_time: castingTime,
            range: rangeValue,
            duration: durationValue,
            concentration: concentrationValue,
            description: descriptionText,
            desc: descriptionText ? descriptionText.replace(/\n/g, '<br>') : '',
            components: componentsValue || '',
            source: sourceValue || 'Imported Sheet',
            damage: damageValue || '',
            saving_throw: saveValue || '',
            higher_levels: higherLevels || '',
            school: schoolRaw || pg.category,
            power_type: schoolRaw || pg.category,
            source_url: ''
        };
        if (levelInfo.label) {
            detail.level_label = levelInfo.label;
        }
        
        var targetNames;
        var targetDetails;
        if (schoolRaw === 'force' || schoolRaw === 'force power' || schoolRaw === 'force-power' || schoolRaw === 'powers-know-force' || schoolRaw === 'powers-force' || pg.category === 'force') {
            targetNames = forcePowerNames;
            targetDetails = forcePowerDetails;
        } else {
            targetNames = techPowerNames;
            targetDetails = techPowerDetails;
        }
        pushUnique(targetNames, powerName);
        targetDetails.push(detail);
    }
    
    var inventoryGroups = {};
    for (var invKey in attrMap) {
        if (!Object.prototype.hasOwnProperty.call(attrMap, invKey)) continue;
        if (invKey.indexOf('repeating_inventory_') !== 0) continue;
        var invRest = invKey.substring('repeating_inventory_'.length);
        var invUnderscore = invRest.indexOf('_');
        if (invUnderscore === -1) continue;
        var invId = invRest.substring(0, invUnderscore);
        var invField = invRest.substring(invUnderscore + 1);
        if (!inventoryGroups[invId]) {
            inventoryGroups[invId] = {};
        }
        inventoryGroups[invId][invField] = attrMap[invKey];
    }
    
    function interpretEquipped(entry) {
        if (!entry) return false;
        var raw = getEntryValue(entry, 'current', getEntryValue(entry, 'max', ''));
        if (raw === undefined || raw === null || raw === '') return false;
        if (typeof raw === 'number') return raw > 1;
        var text = String(raw).trim().toLowerCase();
        if (text === '') return false;
        if (text === 'on' || text === 'true' || text === 'yes' || text === 'equipped') return true;
        var num = parseFloat(text);
        if (!isNaN(num)) {
            return num > 1;
        }
        return false;
    }
    
    var equipment = [];
    for (var itemId in inventoryGroups) {
        if (!Object.prototype.hasOwnProperty.call(inventoryGroups, itemId)) continue;
        var itemGroup = inventoryGroups[itemId];
        if (!itemGroup) continue;
        var itemNameEntry = itemGroup.itemname;
        var itemName = getEntryValue(itemNameEntry, 'current', getEntryValue(itemNameEntry, 'max', '')).trim();
        if (!itemName) continue;
        var itemQtyEntry = itemGroup.itemcount;
        var qtyRaw = getEntryValue(itemQtyEntry, 'current', getEntryValue(itemQtyEntry, 'max', '1'));
        var quantity = parseIntSafe(qtyRaw, 1);
        if (quantity < 1) quantity = 1;
        var weightEntry = itemGroup.itemweight;
        var weightRaw = getEntryValue(weightEntry, 'current', getEntryValue(weightEntry, 'max', ''));
        var weight = 0;
        if (weightRaw !== null && weightRaw !== undefined && weightRaw !== '') {
            var weightParsed = parseFloat(String(weightRaw).replace(/[^0-9.\-]/g, ''));
            weight = isNaN(weightParsed) ? 0 : weightParsed;
        }
        var carriedEntry = itemGroup.itemcarried || itemGroup.carried;
        var carriedValue = getEntryValue(carriedEntry, 'current', getEntryValue(carriedEntry, 'max', ''));
        var carriedState = '';
        if (carriedValue !== null && carriedValue !== undefined && carriedValue !== '') {
            carriedState = String(carriedValue).trim().toLowerCase();
        }
        var equipped = false;
        if (carriedState === 'equipped' || carriedState === '2') {
            equipped = true;
        } else {
            var equipFields = [
                itemGroup.equipped,
                itemGroup.itemequipped,
                itemGroup.item_equipped,
                itemGroup['equipped-flag'],
                itemGroup['equipped_flag'],
                itemGroup['options-flag']
            ];
            for (var ef = 0; ef < equipFields.length; ef++) {
                if (interpretEquipped(equipFields[ef])) {
                    equipped = true;
                    break;
                }
            }
        }
        var notesEntry = itemGroup.itemcontent || itemGroup.itemdesc || itemGroup.description;
        var notes = getEntryValue(notesEntry, 'current', getEntryValue(notesEntry, 'max', ''));
        equipment.push({
            name: itemName,
            quantity: quantity,
            weight: weight,
            carried_state: carriedState,
            equipped: equipped,
            notes: notes || ''
        });
    }
    
    equipment.sort(function(a, b) {
        if (a.equipped === b.equipped) return a.name.localeCompare(b.name);
        return a.equipped ? -1 : 1;
    });
    
    var convertedData = {
        _source: 'roll20-sw5e',
        name: charName,
        player_name: playerName,
        class: className,
        level: level,
        species: getAttrValue('race_display', getAttrValue('race', '')),
        background: background ? { name: background } : null,
        alignment: alignment,
        bio: rawData.bio || '',
        gmnotes: rawData.gmnotes || '',
        baseAbilityScores: baseAbilityScores,
        abilities: abilities,
        skills: skills,
        classes: [{
            name: className,
            levels: level,
            hitPoints: [maxHP],
            techPowers: techPowerNames.slice(),
            forcePowers: forcePowerNames.slice()
        }],
        tweaks: {
            hitPoints: {
                maximum: {
                    override: maxHP
                }
            }
        },
        currentStats: {
            hitPointsLost: Math.max(0, maxHP - currentHP)
        },
        hp: {
            max: maxHP,
            current: currentHP
        },
        ac: {
            base: ac
        },
        initiative: {
            mod: initiativeBonus
        },
        speed: {
            walk: speed + ' ft'
        },
        proficiency_bonus: pb,
        attacks: attacks,
        personality_traits: getAttrValue('personality_traits', ''),
        ideals: getAttrValue('ideals', ''),
        bonds: getAttrValue('bonds', ''),
        flaws: getAttrValue('flaws', ''),
        appearance: {
            height: getAttrValue('height', ''),
            eyes: getAttrValue('eyes', ''),
            skin: getAttrValue('skin', ''),
            description: getAttrValue('character_appearance', '')
        },
        backstory: getAttrValue('character_backstory', ''),
        equipment: equipment
    };
    
    if (techPowerDetails.length > 0) {
        convertedData.techPowerDetails = techPowerDetails;
        if (convertedData.classes && convertedData.classes.length > 0) {
            convertedData.classes[0].techPowerDetails = techPowerDetails;
        }
    }
    if (forcePowerDetails.length > 0) {
        convertedData.forcePowerDetails = forcePowerDetails;
        if (convertedData.classes && convertedData.classes.length > 0) {
            convertedData.classes[0].forcePowerDetails = forcePowerDetails;
        }
    }
    
    var character = {
        id: rawData.id || generateUUID(),
        name: charName,
        player_name: playerName || 'Unknown',
        class: className,
        level: level,
        max_hp: maxHP,
        current_hp: currentHP,
        armor_class: ac,
        initiative_bonus: initiativeBonus,
        strength: baseAbilityScores.Strength || 10,
        dexterity: baseAbilityScores.Dexterity || 10,
        constitution: baseAbilityScores.Constitution || 10,
        intelligence: baseAbilityScores.Intelligence || 10,
        wisdom: baseAbilityScores.Wisdom || 10,
        charisma: baseAbilityScores.Charisma || 10,
        speed: speed,
        proficiency_bonus: pb,
        character_data: JSON.stringify(convertedData)
    };
    
    if (rawData.avatar && String(rawData.avatar).trim() !== '') {
        character.portrait_url = rawData.avatar;
    }
    
    return {
        character: character,
        characterData: convertedData
    };
}

async function createCharacter() {
    const character = {
        id: generateUUID(),
        name: document.getElementById('charName').value,
        player_name: document.getElementById('charPlayer').value,
        class: document.getElementById('charClass').value,
        level: parseInt(document.getElementById('charLevel').value),
        max_hp: parseInt(document.getElementById('charMaxHP').value),
        current_hp: parseInt(document.getElementById('charMaxHP').value),
        armor_class: parseInt(document.getElementById('charAC').value),
        initiative_bonus: parseInt(document.getElementById('charInitBonus').value),
        strength: parseInt(document.getElementById('charStr').value),
        dexterity: parseInt(document.getElementById('charDex').value),
        constitution: parseInt(document.getElementById('charCon').value),
        intelligence: parseInt(document.getElementById('charInt').value),
        wisdom: parseInt(document.getElementById('charWis').value),
        charisma: parseInt(document.getElementById('charCha').value),
        speed: parseInt(document.getElementById('charSpeed').value),
        proficiency_bonus: parseInt(document.getElementById('charProfBonus').value)
    };
    
    // Handle portrait image if uploaded
    const portraitFile = document.getElementById('charPortrait').files[0];
    if (portraitFile) {
        character.portrait_url = await fileToBase64(portraitFile);
    }
    
    sendMessage({
        type: 'CreateCharacter',
        character: character
    });
    
    // Add to local array immediately
    characters.push(character);
    renderCharacterList();
    
    closeModal('createCharacterModal');
    document.getElementById('characterForm').reset();
    addLogEntry(`Created character: ${character.name}`, 'info');
}

async function importCharacter() {
    try {
        const jsonText = document.getElementById('characterJson').value;
        const imported = JSON.parse(jsonText);
        
        // Handle nested structure (character.character) or flat structure
        const rawCharData = imported.character || imported;
        
        const isRoll20SW5E = typeof rawCharData.exportedBy === 'string' &&
                             rawCharData.exportedBy.toLowerCase().includes('sw5e') &&
                             Array.isArray(rawCharData.attribs);
        const isStarWarsFoundry = !isRoll20SW5E &&
                                  (rawCharData.species || (Array.isArray(rawCharData.classes) && rawCharData.baseAbilityScores));
        
        let character = null;
        let storedCharData = null;
        
        if (isRoll20SW5E) {
            console.log('🌌 Detected Roll20 SW5E character format');
            const conversion = convertRoll20StarWarsCharacter(rawCharData);
            if (!conversion || !conversion.character) {
                throw new Error('Unable to convert SW5E character data');
            }
            character = conversion.character;
            storedCharData = conversion.characterData;
        } else if (isStarWarsFoundry) {
            console.log('🌌 Detected Star Wars character format');
            const charData = rawCharData;
            
            const maxHP = charData.tweaks?.hitPoints?.maximum?.override || 
                         (charData.classes && charData.classes[0]?.hitPoints?.length > 0 ? 
                          charData.classes[0].hitPoints.reduce((sum, hp) => sum + hp, 0) : 7) || 7;
            const hitPointsLost = charData.currentStats?.hitPointsLost || 0;
            const currentHP = Math.max(1, maxHP - hitPointsLost);
            
            const level = charData.classes && charData.classes.length > 0 ? 
                         charData.classes.reduce((sum, cls) => sum + (cls.levels || 1), 0) : 1;
            
            const className = charData.classes && charData.classes.length > 0 ?
                            charData.classes.map(c => `${c.name} ${c.levels || 1}`).join(' / ') : 'Unknown';
            
            const baseScores = charData.baseAbilityScores || {};
            
            let ac = 10;
            if (charData.equipment) {
                const armor = charData.equipment.find(eq => eq.equipped && eq.category === 'Equipment');
                if (armor) {
                    if (armor.name.includes('Fiber')) ac = 11;
                    else if (armor.name.includes('Lightweight')) ac = 12;
                    else if (armor.name.includes('Medium')) ac = 13;
                    else if (armor.name.includes('Heavy')) ac = 15;
                }
            }
            
            const dexMod = Math.floor(((baseScores.Dexterity || 10) - 10) / 2);
            const speed = charData.speed?.walk ? parseInt(String(charData.speed.walk).replace(/\D+/g, '') || '30', 10) : 30;
            const profBonus = level <= 4 ? 2 : level <= 8 ? 3 : level <= 12 ? 4 : level <= 16 ? 5 : 6;
            
            character = {
                id: charData.id || generateUUID(),
                name: charData.name || 'Unknown',
                player_name: charData.player_name || 'Unknown',
                class: className,
                level: level,
                max_hp: maxHP,
                current_hp: currentHP,
                armor_class: ac,
                initiative_bonus: dexMod,
                strength: baseScores.Strength || 10,
                dexterity: baseScores.Dexterity || 10,
                constitution: baseScores.Constitution || 10,
                intelligence: baseScores.Intelligence || 10,
                wisdom: baseScores.Wisdom || 10,
                charisma: baseScores.Charisma || 10,
                speed: speed,
                proficiency_bonus: profBonus,
                character_data: JSON.stringify(charData)
            };
            storedCharData = charData;
        } else {
            console.log('🎲 Detected D&D character format');
            const charData = rawCharData;
            const rawSpeed = charData.speed?.walk || charData.speed || 30;
            const parsedSpeed = typeof rawSpeed === 'string' ? parseInt(rawSpeed, 10) || 30 : rawSpeed || 30;
            
            character = {
                id: generateUUID(),
                name: charData.name,
                player_name: charData.player_name || 'Unknown',
                class: charData.class,
                level: charData.level || 1,
                max_hp: charData.hp?.max || charData.max_hp || 10,
                current_hp: charData.hp?.current || charData.current_hp || charData.hp?.max || charData.max_hp || 10,
                armor_class: charData.ac?.base || charData.armor_class || 10,
                initiative_bonus: charData.initiative?.mod || charData.initiative_bonus || 0,
                strength: charData.abilities?.str?.score || charData.strength || 10,
                dexterity: charData.abilities?.dex?.score || charData.dexterity || 10,
                constitution: charData.abilities?.con?.score || charData.constitution || 10,
                intelligence: charData.abilities?.int?.score || charData.intelligence || 10,
                wisdom: charData.abilities?.wis?.score || charData.wisdom || 10,
                charisma: charData.abilities?.cha?.score || charData.charisma || 10,
                speed: parsedSpeed,
                proficiency_bonus: charData.proficiency_bonus || 2,
                character_data: JSON.stringify(charData)
            };
            storedCharData = charData;
        }
        
        if (!character.player_name || character.player_name === 'Unknown') {
            if (rawCharData.player_name && rawCharData.player_name.trim() !== '') {
                character.player_name = rawCharData.player_name;
            } else if (isDM && myPlayerName) {
                character.player_name = myPlayerName;
            }
        }
        
        // CRITICAL: Ensure character_data is ALWAYS set
        if (!character.character_data) {
            if (storedCharData) {
                character.character_data = JSON.stringify(storedCharData);
            } else if (rawCharData) {
                character.character_data = JSON.stringify(rawCharData);
            } else {
                // Fallback: create minimal character data
                character.character_data = JSON.stringify({
                    name: character.name,
                    class: character.class,
                    level: character.level,
                    hp: { max: character.max_hp, current: character.current_hp }
                });
            }
        }
        
        // Handle portrait image if uploaded or embedded
        const portraitFile = document.getElementById('characterPortrait').files[0];
        if (portraitFile) {
            character.portrait_url = await fileToBase64(portraitFile);
        } else if (!character.portrait_url && rawCharData.avatar && String(rawCharData.avatar).trim() !== '') {
            character.portrait_url = rawCharData.avatar;
        } else if (!character.portrait_url && rawCharData.image && String(rawCharData.image).trim() !== '') {
            character.portrait_url = rawCharData.image;
        }
        
        // CRITICAL: Ensure portrait_url is set (even if null/undefined, send as null string)
        if (!character.portrait_url) {
            character.portrait_url = null;
        }
        
        console.log('📥 Importing character:', character.name);
        console.log('📋 Character data length:', character.character_data ? character.character_data.length : 0);
        console.log('📋 Character data preview:', character.character_data ? character.character_data.substring(0, 100) + '...' : 'MISSING!');
        if (character.portrait_url) {
            console.log('🖼️ Portrait image attached');
        }
        
        // Verify character has all required fields before sending
        if (!character.character_data) {
            console.error('❌ CRITICAL: character_data is missing! Cannot save character.');
            alert('Error: Character data is missing. Cannot import character.');
            return;
        }
        
        console.log('📤 Sending CreateCharacter message to server...');
        sendMessage({
            type: 'CreateCharacter',
            character: character
        });
        console.log('✅ CreateCharacter message sent');
        
        // Add to local array immediately
        characters.push(character);
        renderCharacterList();
        
        closeModal('importCharacterModal');
        document.getElementById('characterJson').value = '';
        document.getElementById('characterPortrait').value = '';
        addLogEntry(`Imported character: ${character.name}`, 'info');
    } catch (e) {
        console.error('Import error:', e);
        alert('Invalid JSON format: ' + e.message);
    }
}

// Convert file to base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Utility
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Helper function to check if a name belongs to a player character
function isPlayerCharacter(name) {
    if (!name) return false;
    // Check if this name matches any character in the characters array
    return characters.some(char => char.name === name);
}

// Helper function to format message text - bold player names
function formatLogMessage(message) {
    if (!message || !characters || characters.length === 0) return message;
    
    let formatted = message;
    
    // Sort characters by name length (longest first) to avoid partial matches
    const sortedChars = [...characters].sort((a, b) => b.name.length - a.name.length);
    
    // Find all potential player names in the message and bold them
    sortedChars.forEach(char => {
        const name = char.name;
        if (!name || name.trim() === '') return;
        
        // Escape special regex characters in the name
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Use word boundaries to avoid partial matches, but also handle cases where
        // the name appears at the start or end of the message or after/before punctuation
        // Match the name only if it's not already inside HTML tags
        const regex = new RegExp(`(^|[^>])(${escapedName})(?![^<]*>)`, 'g');
        
        formatted = formatted.replace(regex, (match, before, nameMatch) => {
            // Check if we've already formatted this name (avoid double formatting)
            if (before.includes('<strong')) return match;
            
            return before + `<strong style="color: #4a9eff; font-weight: bold;">${nameMatch}</strong>`;
        });
    });
    
    return formatted;
}

function addLogEntry(message, type = 'info') {
    const log = document.getElementById('combatLog');
    if (!log) {
        console.error('❌ Combat log element not found!');
        return;
    }
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    
    // Special styling for success type (nat 20) - green
    let extraStyle = '';
    if (type === 'success') {
        extraStyle = 'background: linear-gradient(135deg, rgba(68, 255, 68, 0.25) 0%, rgba(34, 200, 34, 0.15) 100%); border-left: 4px solid #44ff44; color: #88ff88; font-weight: bold; box-shadow: 0 0 10px rgba(68, 255, 68, 0.3);';
    }
    
    // Format the message to bold player names
    const formattedMessage = formatLogMessage(message);
    entry.innerHTML = `<span style="opacity: 0.6; font-size: 10px;">[${timestamp}]</span> ${formattedMessage}`;
    
    if (extraStyle) {
        entry.style.cssText = (entry.style.cssText || '') + extraStyle;
    }
    
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// Add roll-specific log entry with support for nat 20/1 styling
function addRollEntry(message, isNat20 = false, isNat1 = false) {
    console.log('🎲 Adding to rolls log:', message);
    
    const log = document.getElementById('rollsLog');
    if (!log) {
        console.error('❌ Rolls log element not found!');
        return;
    }
    
    const entry = document.createElement('div');
    entry.className = 'log-entry info';
    
    // Special styling for nat 20 (green) and nat 1 (red)
    if (isNat20) {
        entry.style.cssText = 'padding: 8px; margin: 4px 0; border-left: 4px solid #44ff44; background: linear-gradient(135deg, rgba(68, 255, 68, 0.25) 0%, rgba(34, 200, 34, 0.15) 100%); border-radius: 3px; color: #88ff88; font-weight: bold; box-shadow: 0 0 10px rgba(68, 255, 68, 0.3);';
    } else if (isNat1) {
        entry.style.cssText = 'padding: 8px; margin: 4px 0; border-left: 4px solid #ff4444; background: linear-gradient(135deg, rgba(255, 68, 68, 0.25) 0%, rgba(200, 34, 34, 0.15) 100%); border-radius: 3px; color: #ff8888; font-weight: bold; box-shadow: 0 0 10px rgba(255, 68, 68, 0.3);';
    } else {
        entry.style.cssText = 'padding: 8px; margin: 4px 0; border-left: 3px solid #ffaa44; background: rgba(255, 170, 68, 0.15); border-radius: 3px;';
    }
    
    const timestamp = new Date().toLocaleTimeString();
    
    // Format the message to bold player names
    const formattedMessage = formatLogMessage(message);
    entry.innerHTML = `<span style="opacity: 0.6; font-size: 10px;">[${timestamp}]</span> ${formattedMessage}`;
    
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    
    console.log('✅ Added to rolls log, total entries:', log.children.length);
    
    // Also add to main combat log (will be formatted there too)
    addLogEntry(message, isNat20 ? 'success' : (isNat1 ? 'damage' : 'info'));
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ========== SPELL TOOLTIP SYSTEM ==========

// Common spell saving throws (for quick reference in character sheets)
const SPELL_SAVES = {
    // Cantrips
    'acid splash': 'DEX', 'chill touch': 'none', 'fire bolt': 'attack', 'poison spray': 'CON',
    'ray of frost': 'attack', 'sacred flame': 'DEX', 'shocking grasp': 'attack',
    'thorn whip': 'STR', 'toll the dead': 'WIS', 'vicious mockery': 'WIS',
    'mind sliver': 'INT', 'frostbite': 'CON', 'infestation': 'CON',
    
    // 1st Level
    'bane': 'CHA', 'bless': 'none', 'charm person': 'WIS', 'command': 'WIS',
    'compelled duel': 'WIS', 'cure wounds': 'none', 'entangle': 'STR',
    'faerie fire': 'none', 'grease': 'DEX', 'guiding bolt': 'attack',
    'healing word': 'none', 'hellish rebuke': 'DEX', 'hex': 'none',
    'inflict wounds': 'attack', 'protection from evil and good': 'none',
    'sanctuary': 'WIS', 'shield of faith': 'none', 'sleep': 'none',
    'thunderwave': 'CON', 'witch bolt': 'attack',
    
    // 2nd Level
    'aid': 'none', 'blindness/deafness': 'CON', 'calm emotions': 'CHA',
    'crown of madness': 'WIS', 'darkness': 'none', 'hold person': 'WIS',
    'lesser restoration': 'none', 'levitate': 'none', 'misty step': 'none',
    'moonbeam': 'CON', 'prayer of healing': 'none', 'scorching ray': 'attack',
    'shatter': 'CON', 'silence': 'none', 'spiritual weapon': 'attack',
    'suggestion': 'WIS', 'warding bond': 'none',
    
    // 3rd Level
    'animate dead': 'none', 'beacon of hope': 'none', 'bestow curse': 'WIS',
    'blink': 'none', 'call lightning': 'DEX', 'counterspell': 'none',
    'daylight': 'none', 'dispel magic': 'none', 'fear': 'WIS',
    'fireball': 'DEX', 'fly': 'none', 'haste': 'none',
    'hunger of hadar': 'DEX', 'hypnotic pattern': 'WIS', 'lightning bolt': 'DEX',
    'major image': 'INT', 'mass healing word': 'none', 'revivify': 'none',
    'sending': 'none', 'slow': 'WIS', 'spirit guardians': 'WIS',
    'stinking cloud': 'CON', 'summon celestial': 'none', 'tongues': 'none',
    'vampiric touch': 'attack',
    
    // 4th Level
    'arcane eye': 'none', 'banishment': 'CHA', 'blight': 'CON',
    'confusion': 'WIS', 'death ward': 'none', 'dimension door': 'none',
    'dominate beast': 'WIS', 'freedom of movement': 'none', 'greater invisibility': 'none',
    'guardian of faith': 'DEX', 'ice storm': 'DEX', 'polymorph': 'WIS',
    'stone shape': 'none', 'wall of fire': 'DEX',
    
    // 5th Level
    'animate objects': 'none', 'cloudkill': 'CON', 'cone of cold': 'CON',
    'contagion': 'CON', 'dispel evil and good': 'none', 'dominate person': 'WIS',
    'far step': 'none', 'flame strike': 'DEX', 'greater restoration': 'none',
    'hold monster': 'WIS', 'insect plague': 'CON', 'mass cure wounds': 'none',
    'mislead': 'none', 'modify memory': 'WIS', 'planar binding': 'CHA',
    'raise dead': 'none', 'scrying': 'WIS', 'synaptic static': 'INT',
    'telekinesis': 'STR', 'teleportation circle': 'none', 'wall of force': 'none',
    
    // 6th Level
    'blade barrier': 'DEX', 'chain lightning': 'DEX', 'circle of death': 'CON',
    'disintegrate': 'DEX', 'eyebite': 'WIS', 'flesh to stone': 'CON',
    'forbiddance': 'none', 'harm': 'CON', 'heal': 'none',
    'heroes feast': 'none', 'mass suggestion': 'WIS', 'mental prison': 'INT',
    'sunbeam': 'CON', 'true seeing': 'none', 'wall of ice': 'DEX',
    
    // 7th Level
    'delayed blast fireball': 'DEX', 'divine word': 'CHA', 'etherealness': 'none',
    'finger of death': 'CON', 'fire storm': 'DEX', 'plane shift': 'CHA',
    'power word pain': 'none', 'prismatic spray': 'DEX', 'regenerate': 'none',
    'resurrection': 'none', 'reverse gravity': 'DEX', 'symbol': 'varies',
    'teleport': 'none',
    
    // 8th Level
    'antimagic field': 'none', 'befuddlement': 'INT', 'control weather': 'none',
    'dominate monster': 'WIS', 'earthquake': 'DEX', 'feeblemind': 'INT',
    'glibness': 'none', 'holy aura': 'none', 'incendiary cloud': 'DEX',
    'maze': 'none', 'power word stun': 'none', 'sunburst': 'CON',
    
    // 9th Level
    'astral projection': 'none', 'foresight': 'none', 'gate': 'none',
    'mass heal': 'none', 'meteor swarm': 'DEX', 'power word kill': 'none',
    'prismatic wall': 'DEX', 'storm of vengeance': 'DEX', 'time stop': 'none',
    'true polymorph': 'WIS', 'true resurrection': 'none', 'weird': 'WIS',
    'wish': 'none'
};

// Helper function to get save info for a spell
function getSpellSaveInfo(spellName, saveDC = null) {
    const lookup = spellName.toLowerCase().trim();
    const save = SPELL_SAVES[lookup];
    if (!save) return '';
    if (save === 'none') return '';
    if (save === 'attack') return ' [ATK]';
    if (saveDC) {
        return ` [${save} DC ${saveDC}]`;
    }
    return ` [${save}]`;
}

// Global temporary storage for pending custom spell lookups
window.pendingSpellLookups = new Map();

// Fetch spell/power data from custom database first, then Open5e API (D&D only)
async function fetchSpellData(spellName) {
    // Normalize spell name for API search
    const searchName = spellName.toLowerCase().trim();
    
    // Check cache first
    if (spellCache[searchName]) {
        console.log('📚 Spell/power data from cache:', searchName);
        return spellCache[searchName];
    }
    
    console.log('🔍 Checking custom spell/power database:', searchName);
    
    // First check custom spells/powers database (works for both D&D and Star Wars)
    try {
        // Create a promise that will be resolved when we get the CustomSpellData message
        const lookupPromise = new Promise((resolve) => {
            window.pendingSpellLookups.set(searchName, resolve);
            
            // Timeout after 2 seconds
            setTimeout(() => {
                if (window.pendingSpellLookups.has(searchName)) {
                    console.log('⏱️ Custom spell lookup timed out for:', searchName);
                    window.pendingSpellLookups.delete(searchName);
                    resolve(null);
                }
            }, 2000);
        });
        
        // Send the request
        sendMessage({ type: 'GetCustomSpell', name: searchName });
        
        // Wait for response
        const customSpell = await lookupPromise;
        
        if (customSpell) {
            console.log('✅ Found in custom database:', customSpell.name);
            spellCache[searchName] = customSpell;
            return customSpell;
        }
    } catch (error) {
        console.log('Custom spell check failed:', error);
    }
    
    // Only use Open5e API for D&D characters (not Star Wars)
    if (selectedStyle === 'starwars') {
        console.warn('⚠️ Tech/Force power not found in custom database:', spellName);
        console.log('💡 Tip: Add custom tech/force powers using the "Custom Spells" feature');
        return null;
    }
    
    console.log('🌐 Fetching spell data from Open5e (D&D only):', searchName);
    
    try {
        // First try exact name match
        const exactResponse = await fetch(`https://api.open5e.com/spells/?name=${encodeURIComponent(searchName)}`);
        const exactData = await exactResponse.json();
        
        if (exactData.results && exactData.results.length > 0) {
            const spell = exactData.results[0];
            spellCache[searchName] = spell;
            console.log('✅ Spell data fetched (exact match):', spell.name);
            return spell;
        }
        
        // Fallback to search if exact match failed
        const searchResponse = await fetch(`https://api.open5e.com/spells/?search=${encodeURIComponent(searchName)}`);
        const searchData = await searchResponse.json();
        
        if (searchData.results && searchData.results.length > 0) {
            // Try to find closest name match
            let bestMatch = searchData.results[0];
            for (let spell of searchData.results) {
                if (spell.name.toLowerCase() === searchName) {
                    bestMatch = spell;
                    break;
                }
            }
            spellCache[searchName] = bestMatch;
            console.log('✅ Spell data fetched (search match):', bestMatch.name);
            return bestMatch;
        }
        
        console.warn('⚠️ Spell not found:', spellName);
        return null;
    } catch (error) {
        console.error('❌ Error fetching spell:', error);
        return null;
    }
}

// Show spell tooltip on hover
function showSpellTooltip(spellName, event) {
    console.log('🔮 ========== SPELL TOOLTIP TRIGGERED ==========');
    console.log('Spell name:', spellName);
    console.log('Event:', event);
    
    try {
        const tooltip = document.getElementById('spellTooltip');
        const content = document.getElementById('spellTooltipContent');
        
        console.log('Tooltip element:', tooltip);
        console.log('Content element:', content);
        
        if (!tooltip || !content) {
            console.warn('⚠️ TOOLTIP ELEMENTS NOT FOUND - Tooltip will not display');
            // Don't show alert - just fail silently (tooltip is optional)
            return;
        }
        
        console.log('✅ Tooltip elements found');
        
        // Clear any pending hide timeout
        if (spellTooltipTimeout) {
            clearTimeout(spellTooltipTimeout);
            spellTooltipTimeout = null;
        }
        
        // Show loading state IMMEDIATELY
        content.innerHTML = `<div style="text-align: center; opacity: 0.7; padding: 20px;">⏳ Loading ${spellName}...</div>`;
        tooltip.style.display = 'block';
        tooltip.style.zIndex = '99999';
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY + 15) + 'px';
        
        console.log('✅ Tooltip should be visible now!');
        console.log('Position:', tooltip.style.left, tooltip.style.top);
        console.log('Display:', tooltip.style.display);
        
        // Clear cache for this specific spell to ensure fresh lookup
        const cacheKey = spellName.toLowerCase().trim();
        delete spellCache[cacheKey];
        console.log('🗑️ Cleared cache for:', cacheKey, 'to ensure fresh lookup');
        
        // Fetch spell data (async)
        fetchSpellDataAndDisplay(spellName, tooltip, content, event);
        
    } catch (error) {
        console.error('❌ ERROR IN showSpellTooltip:', error);
        // Don't show alert - just log the error (tooltip is optional)
    }
}

// Separate async function for fetching
async function fetchSpellDataAndDisplay(spellName, tooltip, content, event) {
    try {
        const cacheKey = spellName.toLowerCase().trim();
        if (selectedStyle === 'starwars' && techPowersCache && techPowersCache[cacheKey]) {
            content.innerHTML = formatTechPowerTooltip(techPowersCache[cacheKey]);
            adjustTooltipPosition(tooltip, event);
            return;
        }
        if (selectedStyle === 'starwars') {
            const importedDetail = findImportedTechPowerDetail(spellName);
            if (importedDetail) {
                if (!techPowersCache) techPowersCache = {};
                techPowersCache[cacheKey] = importedDetail;
                content.innerHTML = formatTechPowerTooltip(importedDetail);
                adjustTooltipPosition(tooltip, event);
                return;
            }
            if (forcePowersCache && forcePowersCache[cacheKey]) {
                content.innerHTML = formatSpellTooltip(forcePowersCache[cacheKey]);
                adjustTooltipPosition(tooltip, event);
                return;
            }
            const importedForceDetail = findImportedForcePowerDetail(spellName);
            if (importedForceDetail) {
                if (!forcePowersCache) forcePowersCache = {};
                forcePowersCache[cacheKey] = importedForceDetail;
                content.innerHTML = formatSpellTooltip(importedForceDetail);
                adjustTooltipPosition(tooltip, event);
                return;
            }
        }
        
        console.log('🌐 Fetching spell data...');
        const spell = await fetchSpellData(spellName);
        
        if (spell) {
            console.log('✅ Spell data received:', spell.name);
            content.innerHTML = formatSpellTooltip(spell);
            adjustTooltipPosition(tooltip, event);
            console.log('✅ Tooltip content updated');
        } else {
            console.warn('⚠️ Spell/Power not found:', spellName);
            const isStarWars = selectedStyle === 'starwars';
            const powerType = isStarWars ? 'Tech/Force Power' : 'Spell';
            const icon = isStarWars ? '⚡' : '📚';
            const message = isStarWars 
                ? 'Not found in custom database. Add it using the "Custom Spells" feature!'
                : 'Not found in Open5e database. This might be from a non-SRD source or homebrew.';
            
            content.innerHTML = `<div style="text-align: center; color: #ffaa44; padding: 20px;">
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px;">${icon} ${spellName}</div>
                <div style="font-size: 12px; opacity: 0.8;">${message}</div>
                ${isStarWars ? `
                <div style="font-size: 11px; opacity: 0.6; margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 3px; line-height: 1.5;">
                    To add this ${powerType.toLowerCase()}:
                    <br>• Click the button below to open Custom Spells
                    <br>• Set power_type to "tech" or "force"
                    <br>• Fill in the details (range, casting time, description, etc.)
                </div>
                <button onclick="closeModal('characterSheetModal'); showCustomSpellsManager(); document.getElementById('spellName').value = '${spellName.replace(/'/g, "\\'")}'; setTimeout(() => showCreateCustomSpell(), 100);" style="margin-top: 10px; padding: 8px 15px; background: #aa88ff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">✨ Create Custom ${powerType}</button>
                ` : `
                <div style="font-size: 11px; opacity: 0.6; margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 3px; line-height: 1.5;">
                    This spell might be:
                    <br>• From a non-SRD source
                    <br>• Homebrew content
                    <br>• Spelled differently in the database
                    <br><br>You can add it as a custom spell!
                </div>
                <button onclick="closeModal('characterSheetModal'); showCustomSpellsManager(); document.getElementById('spellName').value = '${spellName.replace(/'/g, "\\'")}'; setTimeout(() => showCreateCustomSpell(), 100);" style="margin-top: 10px; padding: 8px 15px; background: #aa88ff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">✨ Create Custom Spell</button>
                `}
            </div>`;
        }
    } catch (error) {
        console.error('❌ ERROR fetching spell:', error);
        content.innerHTML = `<div style="text-align: center; color: #ff4444; padding: 20px;">
            ❌ Error loading spell<br>
            <span style="font-size: 11px;">${error.message}</span>
        </div>`;
    }
}

// Hide spell tooltip
function hideSpellTooltip() {
    // Delay hiding to allow moving mouse to tooltip
    spellTooltipTimeout = setTimeout(() => {
        const tooltip = document.getElementById('spellTooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }, 300);
}

// Keep tooltip visible when hovering over it
function keepSpellTooltip() {
    if (spellTooltipTimeout) {
        clearTimeout(spellTooltipTimeout);
        spellTooltipTimeout = null;
    }
}

// Format spell/power data for tooltip display
function formatSpellTooltip(spell) {
    // Detect if this is a Star Wars power
    const isStarWars = spell.power_type === 'tech' || spell.power_type === 'force';
    const powerType = spell.power_type === 'tech' ? 'Tech Power' : spell.power_type === 'force' ? 'Force Power' : 'Spell';
    const levelText = (() => {
        const label = spell.level_label || spell.level;
        if (label === undefined || label === null || label === '') return '—';
        const lower = String(label).toLowerCase();
        if (lower === 'at-will' || lower === 'at will') return 'At-will';
        if (typeof label === 'string' && !/^\d+$/.test(label)) return label;
        const numeric = typeof label === 'number' ? label : parseInt(label, 10);
        if (!isNaN(numeric)) {
            if (numeric === 0) return 'Cantrip';
            return `${numeric}${getOrdinalSuffix(numeric)}-level`;
        }
        return String(label);
    })();
    const school = spell.school || '';
    const color = spell.power_type === 'tech' ? '#00d4ff' : spell.power_type === 'force' ? '#ff00ff' : '#aa88ff';
    const icon = spell.power_type === 'tech' ? '⚡' : spell.power_type === 'force' ? '✨' : '✨';
    
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid ${color}; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: ${color};">${icon} ${spell.name}</div>
            <div style="font-size: 12px; opacity: 0.8;">${levelText} ${isStarWars ? powerType : school}</div>
        </div>
    `;
    
    // Damage and Save info (prominent display)
    if (spell.damage || spell.dc) {
        html += `<div style="padding: 10px; margin-bottom: 10px; background: rgba(255,68,68,0.15); border-left: 3px solid #ff4444; border-radius: 5px;">`;
        
        if (spell.damage) {
            const damageType = spell.damage_type ? ` ${spell.damage_type}` : '';
            html += `<div style="font-weight: bold; color: #ff4444; margin-bottom: 5px;">💥 Damage: ${spell.damage}${damageType}</div>`;
        }
        
        if (spell.dc) {
            const dcType = spell.dc.dc_type ? spell.dc.dc_type.name : 'Special';
            const dcSuccess = spell.dc.dc_success || 'half';
            html += `<div style="font-weight: bold; color: #ffaa44;">🛡️ Save: ${dcType.toUpperCase()} (${dcSuccess})</div>`;
        }
        
        html += `</div>`;
    }
    
    // Casting details
    const meta = [];
    const castingTime = spell.casting_time || spell.cast_time || spell.casting_period;
    if (castingTime) meta.push(`<strong>Casting Time:</strong> ${escapeHtml(castingTime)}`);
    if (spell.range) meta.push(`<strong>Range:</strong> ${escapeHtml(spell.range)}`);
    if (spell.duration) meta.push(`<strong>Duration:</strong> ${escapeHtml(spell.duration)}`);
    if (spell.components) meta.push(`<strong>Components:</strong> ${escapeHtml(spell.components)}`);
    if (spell.material) meta.push(`<strong>Materials:</strong> ${escapeHtml(spell.material)}`);
    if (spell.ritual) meta.push(`<strong>Ritual:</strong> ${escapeHtml(String(spell.ritual))}`);
    if (spell.concentration) {
        const concText = typeof spell.concentration === 'string'
            ? spell.concentration
            : (spell.concentration === true ? 'Yes' : 'No');
        meta.push(`<strong>Concentration:</strong> ${escapeHtml(concText)}`);
    }
    if (spell.power_type === 'force' && spell.force_alignment) meta.push(`<strong>Alignment:</strong> ${escapeHtml(spell.force_alignment)}`);
    if (spell.prerequisite) meta.push(`<strong>Prerequisite:</strong> ${escapeHtml(spell.prerequisite)}`);
    if (spell.source) meta.push(`<strong>Source:</strong> ${escapeHtml(spell.source)}`);
    
    if (meta.length > 0) {
        html += `<div style="font-size: 12px; margin-bottom: 10px; line-height: 1.5;">${meta.join('<br>')}</div>`;
    }
    
    // Description (scrollable if long)
    const descriptionBlock = spell.desc || (spell.description ? escapeHtml(spell.description).replace(/\n/g, '<br>') : '');
    if (descriptionBlock) {
        const isLong = descriptionBlock.length > 400;
        const maxHeight = isLong ? 'max-height: 200px; overflow-y: auto;' : '';
        html += `<div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; font-size: 12px; line-height: 1.5; ${maxHeight}">
            ${descriptionBlock}
            ${isLong ? '<div style="text-align: center; font-size: 10px; opacity: 0.5; margin-top: 5px;">↕ Scroll for more</div>' : ''}
        </div>`;
    }
    
    // Higher levels
    const higherLevelsBlock = spell.higher_level || spell.higher_levels;
    if (higherLevelsBlock) {
        html += `<div style="margin-top: 8px; padding: 8px; background: rgba(74,158,255,0.1); border-left: 3px solid #4a9eff; border-radius: 3px; font-size: 11px;">
            <strong style="color: #4a9eff;">At Higher Levels:</strong> ${higherLevelsBlock}
        </div>`;
    }
    
    // Ritual tag
    if (spell.ritual && spell.ritual.toLowerCase() === 'yes') {
        html += `<div style="margin-top: 8px; padding: 5px; text-align: center; background: rgba(170,136,255,0.2); border-radius: 3px; font-size: 11px; color: #aa88ff;">
            ✨ Ritual
        </div>`;
    }
    
    return html;
}

// Get ordinal suffix (1st, 2nd, 3rd, etc.)
function getOrdinalSuffix(num) {
    const n = parseInt(num);
    if (n === 1) return 'st';
    if (n === 2) return 'nd';
    if (n === 3) return 'rd';
    return 'th';
}

// Ability Check Rolling
function rollAbilityCheck(ability, modifier, characterName) {
    console.log(`🎲 Rolling ${ability.toUpperCase()} check for ${characterName}`);
    console.log(`   Modifier: ${modifier}`);
    
    // Roll 1d20
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + modifier;
    
    console.log(`   Roll: ${roll} + ${modifier} = ${total}`);
    
    // Send to server to broadcast to all players
    sendMessage({
        type: 'RollAbilityCheck',
        character_name: characterName,
        ability: ability,
        roll: roll,
        modifier: modifier,
        total: total
    });
    
    // Visual feedback
    addLogEntry(`Rolling ${ability.toUpperCase()} check...`, 'info');
}

// Saving Throw Rolling
function rollSavingThrow(ability, modifier, characterName) {
    console.log(`🛡️ Rolling ${ability.toUpperCase()} save for ${characterName}`);
    console.log(`   Save Modifier: ${modifier}`);
    
    // Roll 1d20
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + modifier;
    
    console.log(`   Roll: ${roll} + ${modifier} = ${total}`);
    
    // Send to server to broadcast to all players
    sendMessage({
        type: 'RollSavingThrow',
        character_name: characterName,
        ability: ability,
        roll: roll,
        modifier: modifier,
        total: total
    });
    
    // Visual feedback
    addLogEntry(`Rolling ${ability.toUpperCase()} save...`, 'info');
}

// Skill Check Rolling
function rollSkill(skillName, modifier, characterName) {
    console.log(`🎯 Rolling ${skillName} for ${characterName}`);
    console.log(`   Modifier: ${modifier}`);
    
    // Roll 1d20
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + modifier;
    
    console.log(`   Roll: ${roll} + ${modifier} = ${total}`);
    
    // Send to server to broadcast to all players
    sendMessage({
        type: 'RollSkill',
        character_name: characterName,
        skill: skillName,
        roll: roll,
        modifier: modifier,
        total: total
    });
    
    // Visual feedback
    addLogEntry(`Rolling ${skillName}...`, 'info');
}

// Calculate skill modifier
function calculateSkillMod(abilityMod, profBonus, isProficient, hasExpertise) {
    let mod = abilityMod;
    if (hasExpertise) {
        mod += profBonus * 2; // Expertise = double proficiency
    } else if (isProficient) {
        mod += profBonus;
    }
    return mod;
}

// Roll dice notation (e.g., "1d12+4", "2d6+5", "1d8")
function rollDice(notation) {
    // Parse notation like "1d12+4" or "2d6-1" or just "5" (flat damage)
    const flatMatch = notation.match(/^(\d+)$/);
    if (flatMatch) {
        return { total: parseInt(flatMatch[1]), rolls: [], breakdown: notation };
    }
    
    const match = notation.match(/(\d+)d(\d+)([+-]\d+)?/i);
    if (!match) {
        console.error('Invalid dice notation:', notation);
        return { total: 0, rolls: [], breakdown: notation };
    }
    
    const numDice = parseInt(match[1]);
    const diceSize = parseInt(match[2]);
    const modifier = match[3] ? parseInt(match[3]) : 0;
    
    let rolls = [];
    let total = modifier;
    
    for (let i = 0; i < numDice; i++) {
        const roll = Math.floor(Math.random() * diceSize) + 1;
        rolls.push(roll);
        total += roll;
    }
    
    const breakdown = `(${rolls.join('+')})${modifier !== 0 ? (modifier >= 0 ? '+' + modifier : modifier) : ''} = ${total}`;
    
    return { total, rolls, breakdown };
}

// Roll attack with weapon
function rollAttack(weaponName, toHitMod, damageNotation, damageType, characterName) {
    console.log(`⚔️ Rolling attack with ${weaponName} for ${characterName}`);
    console.log(`   To Hit: +${toHitMod}`);
    console.log(`   Damage: ${damageNotation} ${damageType}`);
    
    // Roll to-hit (1d20)
    const toHitRoll = Math.floor(Math.random() * 20) + 1;
    const toHitTotal = toHitRoll + toHitMod;
    
    // Check for critical hit
    const isCrit = toHitRoll === 20;
    
    // Roll damage - on crit, roll all dice twice but modifier only once (D&D 5e rules)
    let damageDisplay;
    
    if (isCrit) {
        // Parse the damage notation to separate dice from modifier
        const flatMatch = damageNotation.match(/^(\d+)$/);
        
        if (flatMatch) {
            // Flat damage (no dice) - just double it
            const flatDamage = parseInt(flatMatch[1]);
            damageDisplay = `${flatDamage} + ${flatDamage} = ${flatDamage * 2} CRIT!`;
        } else {
            const match = damageNotation.match(/(\d+)d(\d+)([+-]\d+)?/i);
            if (!match) {
                console.error('Invalid dice notation for crit:', damageNotation);
                const damageResult = rollDice(damageNotation);
                damageDisplay = damageResult.breakdown;
            } else {
                const numDice = parseInt(match[1]);
                const diceSize = parseInt(match[2]);
                const modifier = match[3] ? parseInt(match[3]) : 0;
                
                // Roll the dice twice (double the number of dice)
                const firstRolls = [];
                const secondRolls = [];
                let diceTotal = 0;
                
                // First set of dice
                for (let i = 0; i < numDice; i++) {
                    const roll = Math.floor(Math.random() * diceSize) + 1;
                    firstRolls.push(roll);
                    diceTotal += roll;
                }
                
                // Second set of dice (doubled)
                for (let i = 0; i < numDice; i++) {
                    const roll = Math.floor(Math.random() * diceSize) + 1;
                    secondRolls.push(roll);
                    diceTotal += roll;
                }
                
                // Add modifier only once
                const totalCritDamage = diceTotal + modifier;
                
                // Format breakdown: (1+2+3) + (4+5+6) + 1 = 22 CRIT!
                const firstSet = firstRolls.join('+');
                const secondSet = secondRolls.join('+');
                const modifierText = modifier !== 0 ? (modifier >= 0 ? ` + ${modifier}` : ` ${modifier}`) : '';
                damageDisplay = `(${firstSet}) + (${secondSet})${modifierText} = ${totalCritDamage} CRIT!`;
            }
        }
    } else {
        // Normal hit - roll damage normally
        const damageResult = rollDice(damageNotation);
        damageDisplay = damageResult.breakdown;
    }
    
    console.log(`   To Hit Roll: ${toHitRoll} + ${toHitMod} = ${toHitTotal}`);
    console.log(`   Damage: ${damageDisplay}`);
    
    // Send to server to broadcast to all players
    sendMessage({
        type: 'RollAttack',
        character_name: characterName,
        weapon: weaponName,
        to_hit_roll: toHitRoll,
        to_hit_mod: toHitMod,
        to_hit_total: toHitTotal,
        damage: damageDisplay,
        damage_type: damageType
    });
    
    // Visual feedback
    addLogEntry(`Attacking with ${weaponName}...`, 'info');
}

// Build skills section for character sheet
function buildSkillsSection(char, charData) {
    const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
    const calcMod = (score) => Math.floor((score - 10) / 2);
    
    // Define all 18 D&D skills with their associated abilities
    const skillsByAbility = {
        str: [
            { key: 'athletics', name: 'Athletics' }
        ],
        dex: [
            { key: 'acrobatics', name: 'Acrobatics' },
            { key: 'sleight_of_hand', name: 'Sleight of Hand' },
            { key: 'stealth', name: 'Stealth' }
        ],
        int: [
            { key: 'arcana', name: 'Arcana' },
            { key: 'history', name: 'History' },
            { key: 'investigation', name: 'Investigation' },
            { key: 'nature', name: 'Nature' },
            { key: 'religion', name: 'Religion' }
        ],
        wis: [
            { key: 'animal_handling', name: 'Animal Handling' },
            { key: 'insight', name: 'Insight' },
            { key: 'medicine', name: 'Medicine' },
            { key: 'perception', name: 'Perception' },
            { key: 'survival', name: 'Survival' }
        ],
        cha: [
            { key: 'deception', name: 'Deception' },
            { key: 'intimidation', name: 'Intimidation' },
            { key: 'performance', name: 'Performance' },
            { key: 'persuasion', name: 'Persuasion' }
        ]
    };
    
    let html = `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #ffaa44;">🎯 Skills <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">`;
    
    // Get ability modifiers
    const strMod = charData?.abilities?.str?.mod || calcMod(char.strength);
    const dexMod = charData?.abilities?.dex?.mod || calcMod(char.dexterity);
    const intMod = charData?.abilities?.int?.mod || calcMod(char.intelligence);
    const wisMod = charData?.abilities?.wis?.mod || calcMod(char.wisdom);
    const chaMod = charData?.abilities?.cha?.mod || calcMod(char.charisma);
    
    const abilityMods = { str: strMod, dex: dexMod, int: intMod, wis: wisMod, cha: chaMod };
    const profBonus = charData?.proficiency_bonus || char.proficiency_bonus;
    
    // Build skills list
    Object.keys(skillsByAbility).forEach(abilityKey => {
        const abilitySkills = skillsByAbility[abilityKey];
        const baseMod = abilityMods[abilityKey];
        
        abilitySkills.forEach(skill => {
            // Check if character has this skill (from detailed data)
            let isProficient = false;
            let hasExpertise = false;
            let skillMod = baseMod;
            
            if (charData?.skills && charData.skills[skill.key]) {
                skillMod = charData.skills[skill.key].mod;
                isProficient = charData.skills[skill.key].proficient || false;
                hasExpertise = charData.skills[skill.key].expertise || false;
            } else {
                // Default: just use ability modifier (not proficient)
                skillMod = baseMod;
            }
            
            const profSymbol = hasExpertise ? '◆' : (isProficient ? '●' : '○');
            const profColor = hasExpertise ? '#ffaa44' : (isProficient ? '#44ff44' : '#888');
            
            const charName = charData?.name || char.name;
            const escapedCharName = escapeJs(charName);
            html += `<div onclick="rollSkill('${skill.name}', ${skillMod}, '${escapedCharName}')" style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 3px; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center;" onmouseover="this.style.background='rgba(74,158,255,0.15)'; this.style.transform='translateX(5px)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.transform='translateX(0)'">
                <span style="font-size: 13px;">
                    <span style="color: ${profColor}; margin-right: 5px;">${profSymbol}</span>
                    ${skill.name}
                    <span style="font-size: 10px; opacity: 0.5; margin-left: 3px;">(${abilityKey.toUpperCase()})</span>
                </span>
                <span style="font-weight: bold; color: #4a9eff;">${formatMod(skillMod)}</span>
            </div>`;
        });
    });
    
    html += `</div>
        <div style="font-size: 11px; opacity: 0.6; margin-top: 10px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 3px;">
            <strong>Legend:</strong> 
            <span style="color: #ffaa44;">◆ Expertise</span> | 
            <span style="color: #44ff44;">● Proficient</span> | 
            <span style="color: #888;">○ Not Proficient</span>
        </div>
    </div>`;
    
    return html;
}

// Render connected players list - BULLETPROOF VERSION
function renderPlayerList() {
    const list = document.getElementById('playerList');
    if (!list) {
        console.error('❌ Player list element not found!');
        return;
    }
    
    console.log('📋 Rendering player list. Count:', connectedPlayers.length);
    console.log('📋 Players array:', JSON.stringify(connectedPlayers));
    
    // Build HTML
    let html = '';
    
    if (!connectedPlayers || connectedPlayers.length === 0) {
        html = '<p style="opacity: 0.6; padding: 10px;">No players connected</p>';
        console.log('⚠️ No players to display');
    } else {
        let validCount = 0;
        connectedPlayers.forEach((player, index) => {
            // Validate player object
            if (!player) {
                console.error('❌ Null player at index', index);
                return;
            }
            if (!player.name) {
                console.error('❌ Player missing name at index', index, player);
                return;
            }
            
            validCount++;
            const charName = player.character_name || 'No character';
            const dmLabel = player.is_dm ? ' 👑' : '';
            
            html += `
                <div class="player-item ${player.is_dm ? 'dm' : ''}" style="margin: 5px 0;">
                    <div class="player-status"></div>
                    <div style="flex: 1;">
                        <div style="font-weight: bold;">${player.name}${dmLabel}</div>
                        <div style="font-size: 10px; opacity: 0.7;">${charName}</div>
                    </div>
                </div>
            `;
        });
        console.log('✅ Rendered', validCount, 'valid players');
    }
    
    // Update DOM
    list.innerHTML = html;
    console.log('✅ Player list HTML updated');
    
    // Force display (ensure it's not hidden)
    list.style.display = 'block';
}

// Map Settings
function showMapSettings() {
    document.getElementById('gridSizeInput').value = gridSize;
    if (currentMap) {
        document.getElementById('mapWidthInput').value = currentMap.width;
        document.getElementById('mapHeightInput').value = currentMap.height;
    }
    document.getElementById('mapSettingsModal').classList.add('active');
}

function applyMapSettings() {
    const newGridSize = parseInt(document.getElementById('gridSizeInput').value) || 50;
    const newWidth = parseInt(document.getElementById('mapWidthInput').value) || 1200;
    const newHeight = parseInt(document.getElementById('mapHeightInput').value) || 800;
    
    gridSize = newGridSize;
    
    if (currentMap) {
        currentMap.width = newWidth;
        currentMap.height = newHeight;
    }
    
    // FIX: Update canvas size for everyone
    canvas.width = newWidth;
    canvas.height = newHeight;
    
    // Broadcast to all players if DM
    if (isDM) {
        sendMessage({
            type: 'MapSettingsChanged',
            grid_size: gridSize,
            width: newWidth,
            height: newHeight
        });
    }
    
    renderCanvas();
    closeModal('mapSettingsModal');
    addLogEntry(`Map settings updated: Grid ${gridSize}px, Size ${newWidth}x${newHeight}`, 'info');
}

// Place Character
function showPlaceCharacter() {
    const list = document.getElementById('placeCharacterList');
    let html = '';
    
    if (characters.length === 0) {
        html = '<p>No characters available. Create some first!</p>';
    } else {
        list.innerHTML = '<p>No characters available. Create some first!</p>';
        characters.forEach(char => {
            const item = document.createElement('div');
            item.className = 'entity-item';
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => placeCharacterToken(char.id, char.name));
            item.innerHTML = `
                <h4>${escapeHtml(char.name)}</h4>
                <p style="font-size: 11px; opacity: 0.8;">${escapeHtml(char.class || '')} Level ${char.level || 0}</p>
                    <div class="entity-stats">
                    <div class="entity-stat">HP ${char.max_hp || 0}</div>
                    <div class="entity-stat">AC ${char.armor_class || 0}</div>
                    <div class="entity-stat">Init +${char.initiative_bonus || 0}</div>
                </div>
            `;
            list.appendChild(item);
        });
    }
    
    document.getElementById('placeCharacterModal').classList.add('active');
}

function placeCharacterToken(charId, charName) {
    console.log('========== PLACING CHARACTER TOKEN ==========');
    console.log('Character ID:', charId);
    console.log('Character Name:', charName);
    
    // Place at center of map
    const x = 5;
    const y = 5;
    
    console.log('Sending PlaceToken message...');
    sendMessage({
        type: 'PlaceToken',
        entity_id: charId,
        entity_type: 'Player',
        x: x,
        y: y
    });
    
    console.log('✅ PlaceToken message sent, waiting for TokenUpdate...');
    
    closeModal('placeCharacterModal');
    addLogEntry(`Placed ${charName} on the map`, 'info');
}

// Character Sheet Viewer
function showMyCharacterSheet() {
    if (!myCharacterId) {
        alert('Please select a character first!');
        return;
    }
    
    const char = characters.find(c => c.id === myCharacterId);
    if (!char) {
        alert('Character not found!');
        return;
    }
    
    showCharacterSheet(char);
}

let currentViewingCharacter = null; // Track which character is being viewed
let currentViewingCharacterFullData = null; // Raw parsed character_data (may include wrapper)
let currentViewingCharacterData = null; // Normalized character data object
let currentSheetSelectionMode = false;
let characterEditMode = false;

function showCharacterSheet(char, isSelectionMode = false) {
    currentViewingCharacter = char;
    currentSheetSelectionMode = isSelectionMode;
    characterEditMode = false;
    currentViewingCharacterFullData = null;
    currentViewingCharacterData = null;
    
    if (char && char.character_data) {
        try {
            const parsed = JSON.parse(char.character_data);
            currentViewingCharacterFullData = parsed;
            currentViewingCharacterData = parsed && parsed.character ? parsed.character : parsed;
        } catch (e) {
            console.error('Error parsing character data:', e);
        }
    }
    
    renderCharacterSheetContent();
    
    // Show/hide the "Open in New Window" button (only for players viewing their own sheet)
    const openBtn = document.getElementById('openSheetInNewWindowBtn');
    if (openBtn) {
        // Show button if this is the player's own character sheet (not selection mode)
        openBtn.style.display = (!isSelectionMode && char && char.id === myCharacterId) ? 'block' : 'none';
    }
    
    document.getElementById('characterSheetModal').classList.add('active');
}

// Reference to the standalone character sheet window
let standaloneCharacterSheetWindow = null;

// Listen for messages from standalone character sheet window
window.addEventListener('message', (event) => {
    // Only accept messages from same origin
    if (event.origin !== window.location.origin) return;
    
    if (event.data && event.data.type === 'characterSheetRoll') {
        // Handle roll requests from standalone window
        const { rollType, ...params } = event.data;
        
        console.log('📨 Received roll request from standalone window:', rollType, params);
        
        switch (rollType) {
            case 'abilityCheck':
                rollAbilityCheck(params.ability, params.modifier, params.characterName);
                break;
            case 'savingThrow':
                rollSavingThrow(params.ability, params.modifier, params.characterName);
                break;
            case 'skill':
                rollSkill(params.skillName, params.modifier, params.characterName);
                break;
            case 'attack':
                rollAttack(params.weaponName, params.toHitMod, params.damageNotation, params.damageType, params.characterName);
                break;
        }
    }
});

// Open character sheet in a new window for dual monitor setup
function openCharacterSheetInNewWindow() {
    if (!currentViewingCharacter) {
        alert('No character sheet to open!');
        return;
    }
    
    // Render the HTML first
    const char = currentViewingCharacter;
    const charData = currentViewingCharacterData;
    let html;
    
    if (charData) {
        html = buildDetailedCharacterSheet(char, charData);
    } else {
        html = buildSimpleCharacterSheet(char);
    }
    
    // Store character data and HTML in sessionStorage (accessible across windows)
    const characterData = {
        character: char,
        characterData: charData,
        fullData: currentViewingCharacterFullData,
        html: html,
        timestamp: Date.now()
    };
    
    sessionStorage.setItem('characterSheetData', JSON.stringify(characterData));
    
    // Open new window with character sheet page
    const newWindow = window.open('/static/character-sheet.html', 'CharacterSheet', 'width=1200,height=800,resizable=yes,scrollbars=yes');
    
    if (!newWindow) {
        alert('⚠️ Pop-up blocked! Please allow pop-ups for this site to open the character sheet in a new window.');
        return;
    }
    
    // Store reference to the new window
    standaloneCharacterSheetWindow = newWindow;
    
    console.log('✅ Opened character sheet in new window');
}

function renderCharacterSheetContent() {
    const char = currentViewingCharacter;
    if (!char) {
        console.warn('renderCharacterSheetContent called without active character');
        return;
    }
    
    const charData = currentViewingCharacterData;
    const sheetTitleEl = document.getElementById('sheetCharacterName');
    const contentEl = document.getElementById('characterSheetContent');
    const selectBtn = document.getElementById('selectCharacterBtn');
    const editBtn = document.getElementById('editCharacterBtn');
    const cancelBtn = document.getElementById('cancelEditCharacterBtn');
    
    if (selectBtn) {
        if (currentSheetSelectionMode && !isDM && !characterEditMode) {
            selectBtn.classList.remove('hidden');
    } else {
            selectBtn.classList.add('hidden');
        }
    }
    
    if (editBtn) {
        if (isDM) {
            editBtn.classList.remove('hidden');
            editBtn.textContent = characterEditMode ? '💾 Save Changes' : '✏️ Edit';
        } else {
            editBtn.classList.add('hidden');
        }
    }
    
    if (cancelBtn) {
        if (isDM && characterEditMode) {
            cancelBtn.classList.remove('hidden');
        } else {
            cancelBtn.classList.add('hidden');
        }
    }
    
    if (!contentEl || !sheetTitleEl) {
        console.error('Character sheet elements missing');
        return;
    }
    
    if (!characterEditMode && charData) {
        const data = charData;
        const looksStarWars = data && (data.species || (Array.isArray(data.classes) && data.baseAbilityScores));
        if (looksStarWars && (!techPowersLoaded || !techPowersCache || Object.keys(techPowersCache).length === 0)) {
            loadTechPowers();
        }
        if (looksStarWars && (!forcePowersLoaded || !forcePowersCache || Object.keys(forcePowersCache).length === 0)) {
            loadForcePowers();
        }
    }
    
    if (characterEditMode) {
        sheetTitleEl.textContent = `Editing: ${char.name}`;
        contentEl.innerHTML = buildCharacterEditForm(char, charData);
    } else {
        sheetTitleEl.textContent = getCharacterSheetTitle(char, charData);
    if (charData) {
            const html = buildDetailedCharacterSheet(char, charData);
            contentEl.innerHTML = html;
            
            // Update sessionStorage for standalone window (if it exists)
            updateStandaloneCharacterSheet(char, charData, html);
    } else {
            const html = buildSimpleCharacterSheet(char);
            contentEl.innerHTML = html;
            
            // Update sessionStorage for standalone window (if it exists)
            updateStandaloneCharacterSheet(char, null, html);
        }
    }
}

// Update standalone character sheet window if it exists
function updateStandaloneCharacterSheet(char, charData, html) {
    try {
        const characterData = {
            character: char,
            characterData: charData,
            fullData: currentViewingCharacterFullData,
            html: html,
            timestamp: Date.now()
        };
        sessionStorage.setItem('characterSheetData', JSON.stringify(characterData));
        
        // Also try to update the standalone window directly via postMessage if it's open
        if (standaloneCharacterSheetWindow && !standaloneCharacterSheetWindow.closed) {
            try {
                standaloneCharacterSheetWindow.postMessage({
                    type: 'characterSheetUpdate',
                    characterData: characterData
                }, window.location.origin);
            } catch (e) {
                console.warn('Could not send update to standalone window:', e);
            }
        }
    } catch (e) {
        console.warn('Could not update standalone character sheet:', e);
    }
}

function getCharacterSheetTitle(char, charData) {
    if (!char) return 'Character Sheet';
    
    const data = charData || null;
    const isStarWars = data && (data.species || (Array.isArray(data.classes) && data.baseAbilityScores));
    
    if (isStarWars && data) {
        const className = data.classes && data.classes.length > 0 ?
                          data.classes.map(c => `${c.name} ${c.levels || 1}`).join(' / ') : (char.class || 'Unknown');
        const level = data.classes && data.classes.length > 0 ?
                      data.classes.reduce((sum, cls) => sum + (cls.levels || 1), 0) : (char.level || 1);
        return `${data.name || char.name} - ${className} Level ${level}`;
    }
    
    if (data && (data.class || data.level)) {
        const subclassText = data.subclass ? ` (${data.subclass})` : '';
        return `${data.name || char.name} - ${data.class || char.class} ${data.level || char.level}${subclassText}`;
    }
    
    return `${char.name} - ${char.class} Level ${char.level}`;
}

function handleEditCharacterBtnClick() {
    if (!isDM) {
        alert('Only the DM can edit characters.');
        return;
    }
    
    if (!currentViewingCharacter) {
        console.warn('No character selected for editing');
        return;
    }
    
    if (characterEditMode) {
        saveCharacterEdits();
    } else {
        characterEditMode = true;
        renderCharacterSheetContent();
    }
}

function cancelCharacterEditMode() {
    if (!isDM) return;
    characterEditMode = false;
    renderCharacterSheetContent();
}

function saveCharacterEdits() {
    if (!isDM || !currentViewingCharacter) return;
    
    const form = document.getElementById('characterEditForm');
    if (!form) {
        console.error('Character edit form not found');
        return;
    }
    
    const getText = (name, fallback = '') => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input) return fallback;
        return input.value.trim();
    };
    
    const getNumber = (name, fallback = 0) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input) return fallback;
        const value = parseInt(input.value, 10);
        return isNaN(value) ? fallback : value;
    };
    
    const updated = {
        name: getText('name', currentViewingCharacter.name),
        player_name: getText('player_name', currentViewingCharacter.player_name || ''),
        class: getText('class', currentViewingCharacter.class || ''),
        level: Math.max(1, getNumber('level', currentViewingCharacter.level || 1)),
        max_hp: Math.max(1, getNumber('max_hp', currentViewingCharacter.max_hp || 1)),
        current_hp: Math.max(0, getNumber('current_hp', currentViewingCharacter.current_hp || 0)),
        armor_class: Math.max(0, getNumber('armor_class', currentViewingCharacter.armor_class || 0)),
        initiative_bonus: getNumber('initiative_bonus', currentViewingCharacter.initiative_bonus || 0),
        speed: Math.max(0, getNumber('speed', currentViewingCharacter.speed || 0)),
        proficiency_bonus: getNumber('proficiency_bonus', currentViewingCharacter.proficiency_bonus || 2),
        abilities: {
            str: getNumber('str', currentViewingCharacter.strength || 10),
            dex: getNumber('dex', currentViewingCharacter.dexterity || 10),
            con: getNumber('con', currentViewingCharacter.constitution || 10),
            int: getNumber('int', currentViewingCharacter.intelligence || 10),
            wis: getNumber('wis', currentViewingCharacter.wisdom || 10),
            cha: getNumber('cha', currentViewingCharacter.charisma || 10)
        },
        bio: getText('bio', currentViewingCharacterData?.bio || currentViewingCharacterData?.backstory || '')
    };
    
    if (updated.current_hp > updated.max_hp) {
        updated.current_hp = updated.max_hp;
    }
    
    const char = currentViewingCharacter;
    const previousName = char.name;
    
    char.name = updated.name;
    char.player_name = updated.player_name || 'Unknown';
    char.class = updated.class || char.class;
    char.level = updated.level;
    char.max_hp = updated.max_hp;
    char.current_hp = updated.current_hp;
    char.armor_class = updated.armor_class;
    char.initiative_bonus = updated.initiative_bonus;
    char.speed = updated.speed;
    char.proficiency_bonus = updated.proficiency_bonus;
    char.strength = updated.abilities.str;
    char.dexterity = updated.abilities.dex;
    char.constitution = updated.abilities.con;
    char.intelligence = updated.abilities.int;
    char.wisdom = updated.abilities.wis;
    char.charisma = updated.abilities.cha;
    
    if (currentViewingCharacterData) {
        const data = currentViewingCharacterData;
        const abilityLabelMap = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
        
        data.name = updated.name;
        data.player_name = updated.player_name;
        
        if (data.class !== undefined) data.class = updated.class;
        if (data.level !== undefined) data.level = updated.level;
        
        if (data.classes && Array.isArray(data.classes) && data.classes.length > 0) {
            const primaryClass = data.classes[0];
            if (primaryClass) {
                primaryClass.name = updated.class;
                primaryClass.levels = updated.level;
                if (Array.isArray(primaryClass.hitPoints) && primaryClass.hitPoints.length > 0) {
                    primaryClass.hitPoints[0] = updated.max_hp;
                }
            }
        }
        
        if (data.hp) {
            data.hp.max = updated.max_hp;
            data.hp.current = updated.current_hp;
        }
        
        if (data.tweaks?.hitPoints?.maximum) {
            data.tweaks.hitPoints.maximum.override = updated.max_hp;
        }
        
        if (data.currentStats) {
            data.currentStats.hitPointsLost = Math.max(0, updated.max_hp - updated.current_hp);
        }
        
        if (data.ac && typeof data.ac === 'object') {
            data.ac.base = updated.armor_class;
        }
        
        if (data.initiative && typeof data.initiative === 'object') {
            data.initiative.mod = updated.initiative_bonus;
        }
        
        if (data.speed) {
            if (typeof data.speed === 'object') {
                data.speed.walk = `${updated.speed} ft`;
            } else {
                data.speed = `${updated.speed} ft`;
            }
        }
        
        if (data.proficiency_bonus !== undefined) {
            data.proficiency_bonus = updated.proficiency_bonus;
        }
        
        if (data.baseAbilityScores) {
            Object.keys(updated.abilities).forEach(key => {
                const label = abilityLabelMap[key];
                if (label && data.baseAbilityScores[label] !== undefined) {
                    data.baseAbilityScores[label] = updated.abilities[key];
                }
            });
        }
        
        if (data.abilities) {
            Object.keys(updated.abilities).forEach(key => {
                const score = updated.abilities[key];
                const mod = Math.floor((score - 10) / 2);
                if (data.abilities[key]) {
                    data.abilities[key].score = score;
                    data.abilities[key].mod = mod;
                    if (typeof data.abilities[key].save === 'number') {
                        const proficient = data.abilities[key].save_proficient;
                        data.abilities[key].save = mod + (proficient ? updated.proficiency_bonus : 0);
                    }
                }
            });
        }
        
        if (data.bio !== undefined) {
            data.bio = updated.bio;
        }
        if (data.backstory !== undefined) {
            data.backstory = updated.bio;
        }
    }
    
    if (currentViewingCharacterFullData && currentViewingCharacterFullData.character) {
        currentViewingCharacterFullData.character = currentViewingCharacterData;
    }
    
    const serialized = serializeCurrentCharacterData();
    if (serialized) {
        currentViewingCharacter.character_data = serialized;
    }
    
    if (previousName !== char.name) {
        connectedPlayers.forEach(player => {
            if (player && player.character_name === previousName) {
                player.character_name = char.name;
            }
        });
    }
    
    const updatePayload = buildCharacterUpdatePayload(char);
    if (updatePayload) {
        sendMessage({
            type: 'UpdateCharacter',
            character: updatePayload
        });
    }
    
    renderCharacterList();
    renderPlayerList();
    
    if (myCharacterId === char.id) {
        populateCombatActionPanel();
        const playerInfoEl = document.getElementById('playerInfo');
        if (playerInfoEl) {
            playerInfoEl.textContent = `Playing as: ${char.name}`;
        }
    }
    
    addLogEntry(`Updated character: ${char.name}`, 'info');
    
    characterEditMode = false;
    renderCharacterSheetContent();
}

function buildCharacterEditForm(char, charData) {
    const abilityScores = {
        str: getAbilityScoreValue(char, charData, 'str'),
        dex: getAbilityScoreValue(char, charData, 'dex'),
        con: getAbilityScoreValue(char, charData, 'con'),
        int: getAbilityScoreValue(char, charData, 'int'),
        wis: getAbilityScoreValue(char, charData, 'wis'),
        cha: getAbilityScoreValue(char, charData, 'cha')
    };
    
    const bioValue = charData?.bio || charData?.backstory || '';
    const inputStyle = 'padding: 8px; border-radius: 5px; background: #2a2a2a; color: white; border: 1px solid #444;';
    
    return `
        <form id="characterEditForm" onsubmit="return false;" style="display: flex; flex-direction: column; gap: 15px; margin-top: 10px;">
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #4a9eff;">Core Details</h4>
                <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px;">
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Name</span>
                        <input type="text" name="name" value="${escapeHtml(char.name || '')}" required style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Player</span>
                        <input type="text" name="player_name" value="${escapeHtml(char.player_name || '')}" style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Class</span>
                        <input type="text" name="class" value="${escapeHtml(char.class || charData?.class || '')}" style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Level</span>
                        <input type="number" name="level" value="${char.level || charData?.level || 1}" min="1" style="${inputStyle}">
                    </label>
                </div>
            </div>
            
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #ff4444;">Combat Stats</h4>
                <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 10px;">
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Max HP</span>
                        <input type="number" name="max_hp" value="${char.max_hp}" min="1" style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Current HP</span>
                        <input type="number" name="current_hp" value="${char.current_hp}" min="0" style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Armor Class</span>
                        <input type="number" name="armor_class" value="${char.armor_class}" min="0" style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Initiative</span>
                        <input type="number" name="initiative_bonus" value="${char.initiative_bonus}" style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Speed (ft)</span>
                        <input type="number" name="speed" value="${char.speed}" min="0" style="${inputStyle}">
                    </label>
                    <label style="display: flex; flex-direction: column; font-size: 12px;">
                        <span style="opacity: 0.7; margin-bottom: 4px;">Proficiency Bonus</span>
                        <input type="number" name="proficiency_bonus" value="${char.proficiency_bonus}" style="${inputStyle}">
                    </label>
                </div>
            </div>
            
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #4a9eff;">Ability Scores</h4>
                <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-top: 10px;">
                    ${['str','dex','con','int','wis','cha'].map(key => `
                        <label style="display: flex; flex-direction: column; font-size: 12px; text-transform: uppercase;">
                            <span style="opacity: 0.7; margin-bottom: 4px;">${key}</span>
                            <input type="number" name="${key}" value="${abilityScores[key]}" style="${inputStyle}">
                        </label>
                    `).join('')}
                </div>
            </div>
            
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #ffaa44;">Bio / Notes</h4>
                <textarea name="bio" rows="4" style="${inputStyle}; resize: vertical;">${escapeHtml(bioValue)}</textarea>
                <p style="font-size: 11px; opacity: 0.6; margin-top: 8px;">💾 Changes are saved for everyone when you click "Save Changes".</p>
            </div>
        </form>
    `;
}

function getAbilityScoreValue(char, charData, abilityKey) {
    const abilityLabelMap = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
    const charPropMap = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };
    
    if (charData?.abilities && charData.abilities[abilityKey]?.score !== undefined) {
        return charData.abilities[abilityKey].score;
    }
    
    if (charData?.baseAbilityScores) {
        const label = abilityLabelMap[abilityKey];
        if (label && charData.baseAbilityScores[label] !== undefined) {
            return charData.baseAbilityScores[label];
        }
    }
    
    const charProp = charPropMap[abilityKey];
    if (charProp && char && typeof char[charProp] === 'number') {
        return char[charProp];
    }
    
    return 10;
}

function serializeCurrentCharacterData() {
    if (!currentViewingCharacterData) return null;
    
    try {
        if (currentViewingCharacterFullData) {
            if (currentViewingCharacterFullData.character) {
                currentViewingCharacterFullData.character = currentViewingCharacterData;
            }
            return JSON.stringify(currentViewingCharacterFullData);
        }
        
        return JSON.stringify(currentViewingCharacterData);
    } catch (e) {
        console.error('Unable to serialize character data:', e);
        return null;
    }
}

function selectFromSheet() {
    if (currentViewingCharacter) {
        selectCharacterForPlay(currentViewingCharacter.id);
        closeModal('characterSheetModal');
        closeModal('characterManagerModal'); // Also close the character list
    }
}

function buildSimpleCharacterSheet(char) {
    const formatMod = (score) => {
        const mod = Math.floor((score - 10) / 2);
        return mod >= 0 ? `+${mod}` : `${mod}`;
    };
    
    const escapedName = escapeJs(char.name);
    
    let html = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #4a9eff; margin-bottom: 10px;">Basic Info</h4>
                <div class="token-stat"><span>Player:</span><span>${char.player_name}</span></div>
                <div class="token-stat"><span>Class:</span><span>${char.class}</span></div>
                <div class="token-stat"><span>Level:</span><span>${char.level}</span></div>
                <div class="token-stat"><span>Proficiency:</span><span>+${char.proficiency_bonus}</span></div>
            </div>
            
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #ff4444; margin-bottom: 10px;">Combat Stats</h4>
                <div class="token-stat"><span>Hit Points:</span><span>${char.current_hp} / ${char.max_hp}</span></div>
                <div class="hp-bar"><div class="hp-fill" style="width: ${(char.current_hp / char.max_hp) * 100}%"></div></div>
                <div class="token-stat"><span>Armor Class:</span><span>${char.armor_class}</span></div>
                <div class="token-stat"><span>Initiative:</span><span>+${char.initiative_bonus}</span></div>
                <div class="token-stat"><span>Speed:</span><span>${char.speed} ft</span></div>
            </div>
        </div>
        
        <div class="panel" style="padding: 15px; margin-top: 15px;">
            <h4 style="color: #4a9eff; margin-bottom: 10px;">Ability Scores <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                <div onclick="rollAbilityCheck('str', ${Math.floor((char.strength - 10) / 2)}, '${escapedName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
                    <div style="font-size: 20px; font-weight: bold;">${char.strength}</div>
                    <div style="font-size: 11px; opacity: 0.7;">STR</div>
                    <div style="font-size: 12px; margin-top: 5px;">${formatMod(char.strength)}</div>
                </div>
                <div onclick="rollAbilityCheck('dex', ${Math.floor((char.dexterity - 10) / 2)}, '${escapedName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
                    <div style="font-size: 20px; font-weight: bold;">${char.dexterity}</div>
                    <div style="font-size: 11px; opacity: 0.7;">DEX</div>
                    <div style="font-size: 12px; margin-top: 5px;">${formatMod(char.dexterity)}</div>
                </div>
                <div onclick="rollAbilityCheck('con', ${Math.floor((char.constitution - 10) / 2)}, '${escapedName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
                    <div style="font-size: 20px; font-weight: bold;">${char.constitution}</div>
                    <div style="font-size: 11px; opacity: 0.7;">CON</div>
                    <div style="font-size: 12px; margin-top: 5px;">${formatMod(char.constitution)}</div>
                </div>
                <div onclick="rollAbilityCheck('int', ${Math.floor((char.intelligence - 10) / 2)}, '${escapedName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
                    <div style="font-size: 20px; font-weight: bold;">${char.intelligence}</div>
                    <div style="font-size: 11px; opacity: 0.7;">INT</div>
                    <div style="font-size: 12px; margin-top: 5px;">${formatMod(char.intelligence)}</div>
                </div>
                <div onclick="rollAbilityCheck('wis', ${Math.floor((char.wisdom - 10) / 2)}, '${escapedName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
                    <div style="font-size: 20px; font-weight: bold;">${char.wisdom}</div>
                    <div style="font-size: 11px; opacity: 0.7;">WIS</div>
                    <div style="font-size: 12px; margin-top: 5px;">${formatMod(char.wisdom)}</div>
                </div>
                <div onclick="rollAbilityCheck('cha', ${Math.floor((char.charisma - 10) / 2)}, '${escapedName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
                    <div style="font-size: 20px; font-weight: bold;">${char.charisma}</div>
                    <div style="font-size: 11px; opacity: 0.7;">CHA</div>
                    <div style="font-size: 12px; margin-top: 5px;">${formatMod(char.charisma)}</div>
                </div>
            </div>
        </div>
    `;
    
    // Add skills section for simple characters too
    html += buildSkillsSection(char, null);
    
    return html;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Helper function to escape strings for JavaScript onclick handlers (global)
function escapeJs(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
}

function buildDetailedCharacterSheet(char, charData) {
    const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
    
    // Detect if this is a Star Wars character
    const isStarWars = charData.species || (Array.isArray(charData.classes) && charData.baseAbilityScores);
    
    let html = '<div style="max-height: 70vh; overflow-y: auto; padding-right: 10px;">';
    
    // Basic Info & HP
    let className, level, maxHP;
    if (isStarWars) {
        className = charData.classes && charData.classes.length > 0 ?
                   charData.classes.map(c => `${c.name} ${c.levels || 1}`).join(' / ') : char.class;
        level = charData.classes && charData.classes.length > 0 ? 
               charData.classes.reduce((sum, cls) => sum + (cls.levels || 1), 0) : char.level;
        maxHP = charData.tweaks?.hitPoints?.maximum?.override || 
               (charData.classes && charData.classes[0]?.hitPoints?.length > 0 ? 
                charData.classes[0].hitPoints.reduce((sum, hp) => sum + hp, 0) : 7) || char.max_hp;
    } else {
        className = charData.class + (charData.subclass ? ` (${charData.subclass})` : '');
        level = charData.level;
        maxHP = charData.hp?.max || char.max_hp;
    }
    
    html += `<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px;">
        <div class="panel" style="padding: 15px;">
            <h4 style="color: #4a9eff;">🎭 Character Info</h4>
            <div class="token-stat"><span>Name:</span><span>${charData.name}</span></div>
            <div class="token-stat"><span>Player:</span><span>${charData.player_name || char.player_name}</span></div>
            <div class="token-stat"><span>Class:</span><span>${className}</span></div>
            <div class="token-stat"><span>Level:</span><span>${level}</span></div>
            ${charData.species ? `<div class="token-stat"><span>Species:</span><span>${charData.species.name || charData.species}</span></div>` : ''}
            ${charData.background ? `<div class="token-stat"><span>Background:</span><span>${charData.background.name || charData.background}</span></div>` : ''}
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <h4 style="color: #ff4444;">💚 HP</h4>
            <div style="font-size: 32px; font-weight: bold; color: #44ff44;">${char.current_hp}</div>
            <div style="opacity: 0.7;">/ ${maxHP}</div>
            <div class="hp-bar" style="margin-top: 10px;"><div class="hp-fill" style="width: ${(char.current_hp / maxHP) * 100}%"></div></div>
        </div>
    </div>`;
    
    // Abilities - handle both D&D and Star Wars formats
    if (charData.baseAbilityScores && isStarWars) {
        // Star Wars format - use baseAbilityScores
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">📊 Ability Scores <span style="font-size: 12px; opacity: 0.6;">(Click score for check!)</span></h4>
            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">`;
        const abilityNames = { Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha' };
        Object.entries(charData.baseAbilityScores).forEach(([name, score]) => {
            const ab = abilityNames[name];
            const mod = Math.floor((score - 10) / 2);
            if (ab) {
                const escapedName = escapeJs(charData.name);
                html += `<div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px;">
                    <div onclick="rollAbilityCheck('${ab}', ${mod}, '${escapedName}')" style="cursor: pointer; transition: all 0.2s;" onmouseover="this.style.color='#4a9eff'; this.style.transform='scale(1.1)'" onmouseout="this.style.color=''; this.style.transform='scale(1)'">
                        <div style="font-size: 24px; font-weight: bold;">${score}</div>
                        <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">${ab}</div>
                        <div style="font-size: 12px; margin-top: 5px;">${formatMod(mod)}</div>
                    </div>
                </div>`;
            }
        });
        html += `</div></div>`;
    } else if (charData.abilities) {
        // D&D format
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">📊 Ability Scores & Saves <span style="font-size: 12px; opacity: 0.6;">(Click score for check, save for save!)</span></h4>
            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">`;
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
            const ability = charData.abilities[ab];
            if (ability) {
                const escapedName = escapeJs(charData.name);
                html += `<div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px;">
                    <div onclick="rollAbilityCheck('${ab}', ${ability.mod}, '${escapedName}')" style="cursor: pointer; transition: all 0.2s;" onmouseover="this.style.color='#4a9eff'; this.style.transform='scale(1.1)'" onmouseout="this.style.color=''; this.style.transform='scale(1)'">
                        <div style="font-size: 24px; font-weight: bold;">${ability.score}</div>
                        <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">${ab}</div>
                        <div style="font-size: 12px; margin-top: 5px;">${formatMod(ability.mod)}</div>
                    </div>
                    <div onclick="rollSavingThrow('${ab}', ${ability.save}, '${escapedName}')" style="font-size: 11px; color: ${ability.save_proficient ? '#44ff44' : '#888'}; margin-top: 5px; cursor: pointer; padding: 3px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background=''; this.style.transform='scale(1)'">
                        ${ability.save_proficient ? '●' : '○'} Save: ${formatMod(ability.save)}
                    </div>
                </div>`;
            }
        });
        html += `</div></div>`;
    }
    
    // Combat Stats
    html += `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px;">
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">AC</div>
            <div style="font-size: 28px; font-weight: bold; color: #4a9eff;">${charData.ac?.base || char.armor_class}</div>
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">INIT</div>
            <div style="font-size: 28px; font-weight: bold; color: #ffaa44;">${formatMod(charData.initiative?.mod || char.initiative_bonus)}</div>
            ${charData.initiative?.advantage ? `<div style="font-size: 10px; color: #44ff44;">Adv!</div>` : ''}
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">SPEED</div>
            <div style="font-size: 28px; font-weight: bold; color: #44ff44;">${charData.speed?.walk || char.speed}</div>
        </div>
        <div class="panel" style="padding: 15px; text-align: center;">
            <div style="font-size: 11px; opacity: 0.7;">PROF</div>
            <div style="font-size: 28px; font-weight: bold; color: #aa88ff;">${formatMod(charData.proficiency_bonus)}</div>
        </div>
    </div>`;
    
    // Skills Section
    html += buildSkillsSection(char, charData);
    
    // Attacks
    if (charData.attacks && charData.attacks.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ff4444;">⚔️ Attacks <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>`;
        charData.attacks.forEach((atk, atkIndex) => {
            if (atk.name && atk.to_hit !== null && atk.damage) {
                const weaponName = `${atk.name}${atk.magic_bonus ? ' +' + atk.magic_bonus : ''}`;
                const escapedWeapon = escapeJs(weaponName);
                const escapedName = escapeJs(charData.name);
                const escapedDamage = escapeJs(atk.damage);
                const escapedType = escapeJs(atk.type || 'damage');
                
                html += `<div onclick='rollAttack("${escapedWeapon}", ${atk.to_hit}, "${escapedDamage}", "${escapedType}", "${escapedName}")' style="padding: 10px; margin: 5px 0; background: rgba(255,68,68,0.1); border-left: 3px solid #ff4444; border-radius: 3px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,68,68,0.25)'; this.style.transform='translateX(5px)'" onmouseout="this.style.background='rgba(255,68,68,0.1)'; this.style.transform='translateX(0)'">
                    <div style="font-weight: bold; font-size: 15px;">${weaponName}</div>
                    <div style="font-size: 13px; margin-top: 5px;">
                        <span style="color: #44ff44;">⚔️ To Hit: ${formatMod(atk.to_hit)}</span> | 
                        <span style="color: #ffaa44;">💥 Damage: ${atk.damage}</span> 
                        <span style="opacity: 0.7;">${atk.type || ''}</span>
                    </div>
                    ${atk.mastery ? `<div style="font-size: 11px; color: #4a9eff; margin-top: 3px;">Mastery: ${atk.mastery}</div>` : ''}
                    ${atk.properties ? `<div style="font-size: 11px; opacity: 0.6; margin-top: 3px;">${atk.properties.join(', ')}</div>` : ''}
                </div>`;
            }
        });
        html += `</div>`;
    }
    
    // Star Wars Tech Powers (make them hoverable like spells)
    if (isStarWars && charData.classes && charData.classes.length > 0) {
        const allTechPowers = [];
        const allForcePowers = [];
        const ensureUnique = (list, name) => {
            if (!name) return;
            if (!list.includes(name)) {
                list.push(name);
            }
        };
        
        charData.classes.forEach(cls => {
            if (cls.techPowers && Array.isArray(cls.techPowers)) {
                cls.techPowers.forEach(name => ensureUnique(allTechPowers, name));
            }
            if (cls.forcePowers && Array.isArray(cls.forcePowers)) {
                cls.forcePowers.forEach(name => ensureUnique(allForcePowers, name));
            }
            if (Array.isArray(cls.techPowerDetails)) {
                cls.techPowerDetails.forEach(detail => {
                    if (detail && detail.name) ensureUnique(allTechPowers, detail.name);
                });
            }
            if (Array.isArray(cls.forcePowerDetails)) {
                cls.forcePowerDetails.forEach(detail => {
                    if (detail && detail.name) ensureUnique(allForcePowers, detail.name);
                });
            }
        });
        
        if (Array.isArray(charData.techPowers)) {
            charData.techPowers.forEach(name => ensureUnique(allTechPowers, name));
        }
        if (Array.isArray(charData.forcePowers)) {
            charData.forcePowers.forEach(name => ensureUnique(allForcePowers, name));
        }
        if (Array.isArray(charData.techPowerDetails)) {
            charData.techPowerDetails.forEach(detail => {
                if (detail && detail.name) ensureUnique(allTechPowers, detail.name);
            });
        }
        if (Array.isArray(charData.forcePowerDetails)) {
            charData.forcePowerDetails.forEach(detail => {
                if (detail && detail.name) ensureUnique(allForcePowers, detail.name);
            });
        }
        
        if (allTechPowers.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #00d4ff;">⚡ Tech Powers <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            allTechPowers.forEach(powerName => {
                if (!powerName) return;
                const lookup = (techPowersCache && powerName) ? techPowersCache[powerName.toLowerCase()] : null;
                const levelDisplay = lookup && (lookup.level_label || lookup.level || lookup.level === 0)
                    ? (lookup.level_label || (lookup.level === 0 ? 'At-will' : lookup.level))
                    : null;
                const baseLabel = levelDisplay
                    ? `${powerName} (${levelDisplay})`
                    : powerName;
                const escapedPower = escapeHtml(baseLabel);
                const attrPower = powerName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
                html += `<div onmouseover="showSpellTooltip('${attrPower}', event)" onmouseout="hideSpellTooltip()" style="padding: 6px 12px; background: rgba(0,212,255,0.12); border-radius: 4px; font-size: 12px; border: 1px solid rgba(0,212,255,0.35); cursor: help; transition: all 0.2s;" onmouseenter="this.style.background='rgba(0,212,255,0.25)'; this.style.borderColor='#00d4ff'" onmouseleave="this.style.background='rgba(0,212,255,0.12)'; this.style.borderColor='rgba(0,212,255,0.35)'">${escapedPower}</div>`;
            });
            html += `</div></div>`;
        }
        
        if (allForcePowers.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ff00ff;">✨ Force Powers</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            allForcePowers.forEach(powerName => {
                if (!powerName) return;
                const lookup = (forcePowersCache && powerName) ? forcePowersCache[powerName.toLowerCase()] : null;
                const levelDisplay = lookup && (lookup.level_label || lookup.level || lookup.level === 0)
                    ? (lookup.level_label || (lookup.level === 0 ? 'At-will' : lookup.level))
                    : null;
                const baseLabel = levelDisplay
                    ? `${powerName} (${levelDisplay})`
                    : powerName;
                const escapedPower = baseLabel.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                const attrPower = powerName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
                html += `<div onmouseover="showSpellTooltip('${attrPower}', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(255,0,255,0.2); border-radius: 3px; font-size: 12px; border: 1px solid rgba(255,0,255,0.4); cursor: help; transition: all 0.2s;" onmouseenter="this.style.background='rgba(255,0,255,0.4)'; this.style.borderColor='#ff00ff'" onmouseleave="this.style.background='rgba(255,0,255,0.2)'; this.style.borderColor='rgba(255,0,255,0.4)'">${escapedPower}</div>`;
            });
            html += `</div></div>`;
        }
        
        // Equipment
        if (charData.equipment && charData.equipment.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ffaa44;">🎒 Equipment</h4>
                <div style="display: flex; flex-direction: column; gap: 5px;">`;
            charData.equipment.forEach(item => {
                const equipped = item.equipped ? ' ⭐' : '';
                html += `<div style="padding: 5px 10px; background: rgba(255,170,68,0.1); border-radius: 3px; font-size: 12px; border-left: 3px solid ${item.equipped ? '#ffaa44' : 'transparent'};">
                    ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}${equipped}
                </div>`;
            });
            html += `</div></div>`;
        }
    }
    
    // Spells (handles both Cleric "spells" and Warlock "spellcasting" formats) - D&D only
    const spellData = charData.spells || charData.spellcasting;
    if (spellData && !isStarWars) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #aa88ff;">✨ Spellcasting</h4>`;
        
        // Spell stats
        const ability = spellData.spellcasting_ability || spellData.ability;
        const saveDC = spellData.save_dc;
        const attackBonus = spellData.attack_bonus;
        
        if (ability || saveDC || attackBonus) {
            html += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 15px; padding: 10px; background: rgba(170,136,255,0.1); border-radius: 5px;">`;
            if (ability) {
                html += `<div style="text-align: center;">
                    <div style="font-size: 11px; opacity: 0.7;">Ability</div>
                    <div style="font-size: 16px; font-weight: bold;">${ability}</div>
                </div>`;
            }
            if (saveDC) {
                html += `<div style="text-align: center;">
                    <div style="font-size: 11px; opacity: 0.7;">Spell Save DC</div>
                    <div style="font-size: 16px; font-weight: bold;">${saveDC}</div>
                </div>`;
            }
            if (attackBonus !== undefined) {
                html += `<div style="text-align: center;">
                    <div style="font-size: 11px; opacity: 0.7;">Spell Attack</div>
                    <div style="font-size: 16px; font-weight: bold;">${formatMod(attackBonus)}</div>
                </div>`;
            }
            html += `</div>`;
        }
        
        // Cantrips
        const cantrips = spellData.cantrips;
        if (cantrips && cantrips.length > 0) {
            html += `<div style="margin-bottom: 12px;">
                <div style="font-weight: bold; color: #aa88ff; margin-bottom: 5px;">Cantrips (At Will) <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span>:</div>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            cantrips.forEach(cantrip => {
                const escapedSpell = cantrip.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                const saveInfo = getSpellSaveInfo(cantrip, saveDC);
                const displayName = cantrip + (saveInfo ? `<span style="color: #ffaa44; font-weight: bold;">${saveInfo}</span>` : '');
                html += `<div onmouseover="showSpellTooltip('${escapedSpell}', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(170,136,255,0.2); border-radius: 3px; font-size: 12px; cursor: help; transition: all 0.2s; border: 1px solid transparent;" onmouseenter="this.style.background='rgba(170,136,255,0.4)'; this.style.borderColor='#aa88ff'" onmouseleave="this.style.background='rgba(170,136,255,0.2)'; this.style.borderColor='transparent'">${displayName}</div>`;
            });
            html += `</div></div>`;
        }
        
        // Pact Magic (Warlock-specific)
        if (spellData.pact_magic) {
            html += `<div style="margin-bottom: 12px; padding: 10px; background: rgba(138,43,226,0.2); border-left: 3px solid #aa88ff; border-radius: 3px;">
                <div style="font-weight: bold; color: #aa88ff; margin-bottom: 5px;">🔮 Pact Magic</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: center;">
                    <div>
                        <div style="font-size: 11px; opacity: 0.7;">Pact Slots</div>
                        <div style="font-size: 20px; font-weight: bold;">${spellData.pact_magic.slots}</div>
                    </div>
                    <div>
                        <div style="font-size: 11px; opacity: 0.7;">Slot Level</div>
                        <div style="font-size: 20px; font-weight: bold;">${spellData.pact_magic.slot_level}th</div>
                    </div>
                </div>
            </div>`;
        }
        
        // Regular spell slots (Cleric/Wizard)
        if (spellData.spell_slots) {
            html += `<div style="margin-bottom: 12px;">
                <div style="font-weight: bold; color: #4a9eff; margin-bottom: 8px;">Spell Slots:</div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px;">`;
            Object.keys(spellData.spell_slots).forEach(level => {
                const slots = spellData.spell_slots[level];
                html += `<div style="padding: 5px; background: rgba(74,158,255,0.15); border-radius: 3px; text-align: center; font-size: 12px;">
                    <span style="font-weight: bold;">${level}:</span> ${slots}
                </div>`;
            });
            html += `</div></div>`;
        }
        
        // Mystic Arcanum (Warlock 6th-9th level)
        if (spellData.mystic_arcanum) {
            html += `<div style="margin-bottom: 12px; padding: 10px; background: rgba(138,43,226,0.15); border-left: 3px solid #aa88ff; border-radius: 3px;">
                <div style="font-weight: bold; color: #aa88ff; margin-bottom: 8px;">📜 Mystic Arcanum (1/LR Each) <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span>:</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">`;
            Object.keys(spellData.mystic_arcanum).sort().forEach(level => {
                const spell = spellData.mystic_arcanum[level];
                const escapedSpell = spell.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                const saveInfo = getSpellSaveInfo(spell, saveDC);
                const displayName = spell + (saveInfo ? `<span style="color: #ffaa44; font-weight: bold;">${saveInfo}</span>` : '');
                html += `<div onmouseover="showSpellTooltip('${escapedSpell}', event)" onmouseout="hideSpellTooltip()" style="padding: 8px; background: rgba(170,136,255,0.2); border-radius: 3px; cursor: help; transition: all 0.2s; border: 1px solid transparent;" onmouseenter="this.style.background='rgba(170,136,255,0.4)'; this.style.borderColor='#aa88ff'; this.style.transform='scale(1.02)'" onmouseleave="this.style.background='rgba(170,136,255,0.2)'; this.style.borderColor='transparent'; this.style.transform='scale(1)'">
                    <div style="font-size: 11px; opacity: 0.7;">${level} Level</div>
                    <div style="font-size: 13px; font-weight: bold;">${displayName}</div>
                </div>`;
            });
            html += `</div></div>`;
        }
        
        // Spell lists
        const spellLists = spellData.notable_spells || spellData.leveled_spells_known_examples;
        if (spellLists) {
            const listTitle = spellData.pact_magic ? 'Spells Known' : 'Prepared Spells';
            html += `<div style="margin-top: 15px;">
                <div style="font-weight: bold; color: #ffaa44; margin-bottom: 8px;">${listTitle} <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span>:</div>`;
            Object.keys(spellLists).sort().forEach(level => {
                const spells = spellLists[level];
                if (spells && spells.length > 0) {
                    html += `<div style="margin-bottom: 10px;">
                        <div style="font-size: 12px; font-weight: bold; color: #4a9eff; margin-bottom: 5px;">${level} Level:</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">`;
                    spells.forEach(spell => {
                        const escapedSpell = spell.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                        const saveInfo = getSpellSaveInfo(spell, saveDC);
                        const displayName = spell + (saveInfo ? `<span style="color: #ffaa44; font-weight: bold;">${saveInfo}</span>` : '');
                        html += `<div onmouseover="showSpellTooltip('${escapedSpell}', event)" onmouseout="hideSpellTooltip()" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border-radius: 3px; font-size: 11px; cursor: help; transition: all 0.2s; border: 1px solid transparent;" onmouseenter="this.style.background='rgba(170,136,255,0.3)'; this.style.borderColor='#aa88ff'" onmouseleave="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='transparent'">${displayName}</div>`;
                    });
                    html += `</div></div>`;
                }
            });
            html += `</div>`;
        }
        
        // Pact info (Warlock)
        if (charData.pact) {
            html += `<div style="margin-top: 12px; padding: 8px; background: rgba(138,43,226,0.1); border-radius: 3px; font-size: 12px;">
                <strong style="color: #aa88ff;">Pact:</strong> ${charData.pact}
            </div>`;
        }
        
        html += `</div>`;
    }
    
    // Features
    if (charData.features) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #aa88ff;">✨ Features</h4>`;
        if (charData.features.class_features) {
            html += `<div style="margin-bottom: 8px;"><strong style="color: #4a9eff;">Class:</strong> ${charData.features.class_features.join(', ')}</div>`;
        }
        if (charData.features.species_traits) {
            html += `<div style="margin-bottom: 8px;"><strong style="color: #44ff44;">Species:</strong> ${charData.features.species_traits.join(', ')}</div>`;
        }
        if (charData.features.feats) {
            html += `<div><strong style="color: #ffaa44;">Feats:</strong> ${charData.features.feats.join(', ')}</div>`;
        }
        html += `</div>`;
    }
    
    // Actions
    if (charData.actions) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ffaa44;">🎬 Actions</h4>`;
        if (charData.actions.bonus_actions) {
            html += `<div><strong style="color: #44ff44;">Bonus Actions:</strong><br>${charData.actions.bonus_actions.join(', ')}</div>`;
        }
        if (charData.actions.reactions) {
            html += `<div style="margin-top: 5px;"><strong style="color: #ff4444;">Reactions:</strong><br>${charData.actions.reactions.join(', ')}</div>`;
        }
        html += `</div>`;
    }
    
    // Equipment
    if (charData.equipment) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ffaa44;">🎒 Equipment</h4>`;
        if (charData.equipment.coins) {
            const c = charData.equipment.coins;
            html += `<div style="padding: 8px; background: rgba(255,170,68,0.1); border-radius: 5px; margin-bottom: 10px;">
                <strong>Coins:</strong> ${c.pp || 0}pp, ${c.gp || 0}gp, ${c.ep || 0}ep, ${c.sp || 0}sp, ${c.cp || 0}cp
            </div>`;
        }
        if (charData.equipment.items) {
            html += `<div style="max-height: 150px; overflow-y: auto; font-size: 12px;">`;
            charData.equipment.items.forEach(item => {
                html += `<div style="padding: 3px; margin: 2px 0;">${item.name}${item.qty > 1 ? ' x' + item.qty : ''}${item.attuned ? ' ●' : ''}</div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
    }
    
    // Proficiencies
    if (charData.proficiencies) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">📜 Proficiencies</h4>
            ${charData.proficiencies.armor ? `<div><strong>Armor:</strong> ${charData.proficiencies.armor.join(', ')}</div>` : ''}
            ${charData.proficiencies.weapons ? `<div><strong>Weapons:</strong> ${charData.proficiencies.weapons.join(', ')}</div>` : ''}
            ${charData.proficiencies.languages ? `<div><strong>Languages:</strong> ${charData.proficiencies.languages.join(', ')}</div>` : ''}
        </div>`;
    }
    
    html += '</div>';
    return html;
}

// Measurement Tool Panel Functions
function toggleRulerTool() {
    const panel = document.getElementById('measurementToolPanel');
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'block';
        addLogEntry('📏 Measurement tools panel opened', 'info');
    } else {
        panel.style.display = 'none';
        closeMeasurementTool();
    }
}

function closeMeasurementToolPanel() {
    document.getElementById('measurementToolPanel').style.display = 'none';
    closeMeasurementTool();
}

function closeMeasurementTool() {
    measurementToolType = null;
    rulerActive = false;
    rulerStart = null;
    rulerEnd = null;
    currentPlacementShape = null;
    conePlacementState = null; // Reset cone placement state
    canvas.style.cursor = 'default';
    
    // Reset button styles
    document.getElementById('measurementToolRuler').style.background = 'rgba(255,170,68,0.2)';
    document.getElementById('measurementToolCone').style.background = 'rgba(68,255,68,0.2)';
    document.getElementById('measurementToolCircle').style.background = 'rgba(68,170,255,0.2)';
    
    // Hide settings
    document.getElementById('coneSettings').style.display = 'none';
    document.getElementById('circleSettings').style.display = 'none';
    
    renderCanvas(); // Redraw to clear preview
}

function selectMeasurementTool(toolType) {
    closeMeasurementTool();
    measurementToolType = toolType;
    
    // Reset all button styles
    document.getElementById('measurementToolRuler').style.background = 'rgba(255,170,68,0.2)';
    document.getElementById('measurementToolCone').style.background = 'rgba(68,255,68,0.2)';
    document.getElementById('measurementToolCircle').style.background = 'rgba(68,170,255,0.2)';
    
    // Highlight selected tool
    if (toolType === 'ruler') {
        rulerActive = true;
        document.getElementById('measurementToolRuler').style.background = 'rgba(255,170,68,0.5)';
        document.getElementById('coneSettings').style.display = 'none';
        document.getElementById('circleSettings').style.display = 'none';
        addLogEntry('📏 Ruler tool active - Click two points to measure', 'info');
        canvas.style.cursor = 'crosshair';
    } else if (toolType === 'cone') {
        document.getElementById('measurementToolCone').style.background = 'rgba(68,255,68,0.5)';
        document.getElementById('coneSettings').style.display = 'block';
        document.getElementById('circleSettings').style.display = 'none';
        addLogEntry('🔺 Cone tool active - Click to place cone', 'info');
        canvas.style.cursor = 'crosshair';
    } else if (toolType === 'circle') {
        document.getElementById('measurementToolCircle').style.background = 'rgba(68,170,255,0.5)';
        document.getElementById('circleSettings').style.display = 'block';
        document.getElementById('coneSettings').style.display = 'none';
        addLogEntry('⭕ Circle tool active - Click to place circle', 'info');
        canvas.style.cursor = 'crosshair';
    }
}

function updateConeAngle() {
    const input = document.getElementById('coneAngleInput');
    coneAngle = parseInt(input.value) || 60;
    if (coneAngle < 15) coneAngle = 15;
    if (coneAngle > 180) coneAngle = 180;
    input.value = coneAngle;
    addLogEntry(`🔺 Cone angle set to ${coneAngle}°`, 'info');
}

function updateConeDistance() {
    const input = document.getElementById('coneDistanceInput');
    const value = parseInt(input.value) || 0;
    coneDistance = value > 0 ? value : 0; // 0 means use default
    if (coneDistance > 120) coneDistance = 120;
    if (coneDistance > 0) {
        input.value = coneDistance;
        addLogEntry(`🔺 Cone distance set to ${coneDistance} feet`, 'info');
    } else {
        input.value = '';
        addLogEntry(`🔺 Cone distance set to default (15 feet)`, 'info');
    }
}

function updateCircleRadius() {
    const input = document.getElementById('circleRadiusInput');
    circleRadius = parseInt(input.value) || 25;
    if (circleRadius < 5) circleRadius = 5;
    if (circleRadius > 500) circleRadius = 500;
    input.value = circleRadius;
    addLogEntry(`⭕ Circle radius set to ${circleRadius} feet`, 'info');
}

function clearAllMeasurements() {
    measurementShapes = [];
    rulerStart = null;
    rulerEnd = null;
    sendMessage({
        type: 'ClearMeasurements'
    });
    renderCanvas();
    addLogEntry('🗑️ All measurements cleared', 'info');
}

// Add double-click handler for ruler tool (moved to setupCanvas to ensure canvas exists)
// This is now handled in setupCanvas() after canvas is initialized

// Remove selected token
function removeSelectedToken() {
    if (!selectedToken) {
        alert('Please select a token first!');
        return;
    }
    
    if (!isDM) {
        alert('Only DM can remove tokens!');
        return;
    }
    
    const tokenName = selectedToken.entity_type === 'Player' 
        ? (characters.find(c => c.id === selectedToken.entity_id)?.name || 'Token')
        : (enemies.find(e => e.id === selectedToken.entity_id)?.name || 'Token');
    
    if (confirm(`Remove ${tokenName} from the map?`)) {
        sendMessage({
            type: 'RemoveToken',
            token_id: selectedToken.id
        });
        addLogEntry(`Removed ${tokenName} from map`, 'info');
        selectedToken = null;
        updateTokenInfo();
    }
}

// Get current character data for utility functions
function getCurrentCharacterData() {
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter) return null;
    
    let charData = myCharacter;
    if (myCharacter.character_data) {
        try {
            const fullData = JSON.parse(myCharacter.character_data);
            charData = fullData.character || fullData;
        } catch (e) {
            console.error('Error parsing character data:', e);
        }
    }
    return charData;
}

// Apply theme based on campaign style
function applyTheme(style) {
    console.log('🎨 Applying theme:', style);
    const root = document.documentElement;
    
    if (style === 'starwars') {
        // Star Wars theme - sci-fi blue/white
        root.style.setProperty('--primary-color', '#4a9eff');
        root.style.setProperty('--secondary-color', '#ff6b35');
        root.style.setProperty('--accent-color', '#00d4ff');
        root.style.setProperty('--bg-color', '#0a0a1a');
        root.style.setProperty('--panel-bg', 'linear-gradient(135deg, #1a1a3a 0%, #0a0a2a 100%)');
        
        // Update header
        document.querySelector('h1').innerHTML = '⭐ Gorgox Interactive <span style="background: #4a9eff; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px;">STAR WARS v13.1</span>';
    } else {
        // D&D theme - traditional fantasy green/gold
        root.style.setProperty('--primary-color', '#4CAF50');
        root.style.setProperty('--secondary-color', '#ff8800');
        root.style.setProperty('--accent-color', '#aa88ff');
        root.style.setProperty('--bg-color', '#1a1a1a');
        root.style.setProperty('--panel-bg', 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)');
        
        // Keep D&D header
        document.querySelector('h1').innerHTML = '🎲 Gorgox Interactive <span style="background: #ffaa00; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px;">v13.1 COMPLETE</span>';
    }
}

// Restore style preference on page load
window.addEventListener('DOMContentLoaded', () => {
    const savedStyle = localStorage.getItem('campaignStyle');
    if (savedStyle) {
        const styleSelector = document.getElementById('styleSelector');
        if (styleSelector) {
            styleSelector.value = savedStyle;
            selectedStyle = savedStyle;
        }
    }
});

// Initiative prompt helpers
function showInitiativePrompt(participant) {
    const modal = document.getElementById('initiativePromptModal');
    const textEl = document.getElementById('initiativePromptText');
    const inputEl = document.getElementById('initiativeRollInput');
    const previewEl = document.getElementById('initiativeTotalPreview');
    if (!modal || !textEl || !inputEl || !previewEl) {
        console.error('❌ Initiative prompt elements missing');
        return;
    }

    clearTimeout(initiativePromptReminderTimeout);
    initiativePromptParticipant = participant;

    textEl.innerHTML = `<strong>${participant.name}</strong><br>Initiative bonus: <strong>+${participant.initiative_bonus}</strong>`;
    inputEl.value = '';
    previewEl.textContent = `Total: +${participant.initiative_bonus}`;

    modal.classList.add('active');
    setTimeout(() => inputEl.focus(), 50);
}

function updateInitiativeTotalPreview() {
    const participant = initiativePromptParticipant;
    if (!participant) return;
    const inputEl = document.getElementById('initiativeRollInput');
    const previewEl = document.getElementById('initiativeTotalPreview');
    if (!inputEl || !previewEl) return;

    const roll = parseInt(inputEl.value, 10);
    if (isNaN(roll)) {
        previewEl.textContent = `Total: +${participant.initiative_bonus}`;
    } else {
        const total = roll + participant.initiative_bonus;
        previewEl.textContent = `Total: ${roll} + ${participant.initiative_bonus} = ${total}`;
    }
}

function rollInitiativeInPrompt() {
    const inputEl = document.getElementById('initiativeRollInput');
    if (!inputEl) return;
    const roll = Math.floor(Math.random() * 20) + 1;
    inputEl.value = roll;
    updateInitiativeTotalPreview();
}

function submitInitiativePrompt() {
    const participant = initiativePromptParticipant;
    if (!participant) {
        console.warn('⚠️ No participant for initiative submission');
        return;
    }

    const inputEl = document.getElementById('initiativeRollInput');
    if (!inputEl) return;

    const roll = parseInt(inputEl.value, 10);
    if (isNaN(roll) || roll < 1 || roll > 20) {
        alert('Please enter a number between 1 and 20, or use the Roll button.');
        inputEl.focus();
        return;
    }

    const total = roll + participant.initiative_bonus;
    closeModal('initiativePromptModal');
    initiativePromptParticipant = null;
    clearTimeout(initiativePromptReminderTimeout);

    console.log(`📤 Sending initiative: ${roll} + ${participant.initiative_bonus} = ${total}`);
    sendMessage({
        type: 'RollInitiative',
        entity_id: participant.entity_id,
        roll: total
    });
}

function cancelInitiativePrompt() {
    closeModal('initiativePromptModal');
    if (!initiativePromptParticipant) return;

    addLogEntry('⚠️ You still need to roll for initiative!', 'damage');
    clearTimeout(initiativePromptReminderTimeout);
    initiativePromptReminderTimeout = setTimeout(() => {
        if (initiativePromptParticipant && confirm('You haven\'t rolled for initiative yet. Roll now?')) {
            showInitiativePrompt(initiativePromptParticipant);
        }
    }, 2000);
}

function syncParticipantsWithTokens() {
    if (!combatState.participants || combatState.participants.length === 0) return;
    if (!Array.isArray(tokens) || tokens.length === 0) return;

    const lowercase = (value) => (value || '').toString().toLowerCase();

    // Enhance existing participants with token data when available
    combatState.participants.forEach(part => {
        const token = tokens.find(t => t && (t.entity_id === part.entity_id || t.id === part.id));
        if (!token) return;

        // CRITICAL: Ensure participant.id matches token.id (needed for turn logic)
        if (token.id) {
            part.id = token.id; // Always use token.id as authoritative
        }
        if (!part.entity_id && token.entity_id) part.entity_id = token.entity_id;
        if (!part.entity_type && token.entity_type) part.entity_type = token.entity_type;
        if (part.initiative_bonus === undefined && token.initiative_bonus !== undefined) {
            part.initiative_bonus = token.initiative_bonus;
        }
        
        // CRITICAL: Update HP and AC from enemies/characters arrays (not just tokens)
        // Tokens might not have this data, so we need to look it up
        if (part.entity_type === 'Enemy' || part.entity_type === 'NPC') {
            const enemy = enemies.find(e => e.id === part.entity_id);
            if (enemy) {
                // Update HP from enemy data (enemy data is authoritative)
                if (enemy.max_hp !== undefined) {
                    part.max_hp = enemy.max_hp;
                }
                if (enemy.current_hp !== undefined) {
                    part.current_hp = enemy.current_hp;
                } else if (enemy.max_hp !== undefined && part.current_hp === undefined) {
                    part.current_hp = enemy.max_hp;
                }
                
                // Update AC from enemy data
                if (enemy.armor_class !== undefined) {
                    part.armor_class = enemy.armor_class;
                }
            }
        } else if (part.entity_type === 'Player') {
            const char = characters.find(c => c.id === part.entity_id);
            if (char) {
                if (char.max_hp !== undefined) {
                    part.max_hp = char.max_hp;
                }
                if (char.current_hp !== undefined) {
                    part.current_hp = char.current_hp;
                } else if (char.max_hp !== undefined && part.current_hp === undefined) {
                    part.current_hp = char.max_hp;
                }
                if (char.armor_class !== undefined) {
                    part.armor_class = char.armor_class;
                }
            }
        }
        
        // Fallback to token data if not found in enemies/characters
        if (part.max_hp === undefined && token.max_hp !== undefined) part.max_hp = token.max_hp;
        if (part.current_hp === undefined && token.current_hp !== undefined) part.current_hp = token.current_hp;
        if (part.armor_class === undefined && token.armor_class !== undefined) part.armor_class = token.armor_class;
        
        // Don't overwrite names we set from enemies/characters arrays
        if (!part.name && token.name) part.name = token.name;
    });

    // Ensure every non-player token appears as a combat participant
    tokens.forEach(token => {
        if (!token) return;
        const type = lowercase(token.entity_type);
        if (!type) return;

        const alreadyPresent = combatState.participants.some(part => {
            if (!part) return false;
            return (part.entity_id && token.entity_id && part.entity_id === token.entity_id) ||
                   (part.id && token.id && part.id === token.id);
        });
        if (alreadyPresent) return;

        const initiativeBonus = typeof token.initiative_bonus === 'number' ? token.initiative_bonus : 0;
        
        // CRITICAL: Look up name from enemies/characters arrays instead of token
        // Tokens don't have names - we need to get them from the actual entity data
        let participantName = token.name || token.display_name;
        if (!participantName) {
            if (type === 'player') {
                const char = characters.find(c => c.id === token.entity_id);
                participantName = char ? char.name : 'Player';
            } else {
                // For enemies/NPCs, look up from enemies array
                const enemy = enemies.find(e => e.id === token.entity_id);
                if (enemy) {
                    participantName = enemy.name; // Use the actual NPC/enemy name
                } else {
                    // Fallback: for DM, try harder to find NPC
                    if (isDM) {
                        const npcInstance = enemies.find(e => e.id === token.entity_id && (e.isNPC || e.npcData));
                        participantName = npcInstance ? npcInstance.name : 'Enemy';
                    } else {
                        participantName = 'Enemy'; // Players see generic "Enemy"
                    }
                }
            }
        }
        
        // CRITICAL: Get HP and AC from enemies/characters arrays, not just tokens
        let participantMaxHp = token.max_hp !== undefined ? token.max_hp : token.hp || 0;
        let participantCurrentHp = token.current_hp !== undefined ? token.current_hp : token.hp || token.max_hp || 0;
        let participantAC = token.armor_class;
        
        if (type === 'player') {
            const char = characters.find(c => c.id === token.entity_id);
            if (char) {
                if (char.max_hp !== undefined) participantMaxHp = char.max_hp;
                if (char.current_hp !== undefined) {
                    participantCurrentHp = char.current_hp;
                } else if (char.max_hp !== undefined) {
                    participantCurrentHp = char.max_hp;
                }
                if (char.armor_class !== undefined) participantAC = char.armor_class;
            }
        } else {
            // For enemies/NPCs, look up from enemies array
            const enemy = enemies.find(e => e.id === token.entity_id);
            if (enemy) {
                if (enemy.max_hp !== undefined) participantMaxHp = enemy.max_hp;
                if (enemy.current_hp !== undefined) {
                    participantCurrentHp = enemy.current_hp;
                } else if (enemy.max_hp !== undefined) {
                    participantCurrentHp = enemy.max_hp;
                }
                if (enemy.armor_class !== undefined) participantAC = enemy.armor_class;
            }
        }
        
        // CRITICAL: Use token.id as the participant.id (needed for turn logic)
        // The participant.id must match token.id for currentTurn matching to work
        const participant = {
            id: token.id || token.entity_id, // token.id is authoritative
            entity_id: token.entity_id || token.id,
            name: participantName,
            entity_type: token.entity_type || (type === 'player' ? 'Player' : 'Enemy'),
            initiative_bonus: initiativeBonus,
            initiative: 0,
            current_hp: participantCurrentHp,
            max_hp: participantMaxHp,
            armor_class: participantAC
        };

        combatState.participants.push(participant);
        console.log('➕ Added missing participant from token:', participant.id, participant.name, 'entity_id:', participant.entity_id);
    });
}

function requestTokenRefresh() {
    console.log('🔄 Requesting latest tokens from server');
    // Note: Server automatically sends TokenUpdate when tokens change
    // We can't request tokens directly, but we can trigger a refresh by requesting the map
    // The server will send TokenUpdate when we load the map
    if (currentMap && currentMap.id) {
        sendMessage({ type: 'LoadMap', map_id: currentMap.id, clear_tokens: false });
    }
}

// Refresh map and tokens - for late joiners or when map isn't displaying
function refreshMap() {
    console.log('🔄 Refreshing map and tokens...');
    addLogEntry('🔄 Refreshing map...', 'info');
    
    // Request current map - server should send MapLoaded if a map is active
    if (currentMap && currentMap.id) {
        console.log('🔄 Requesting map reload:', currentMap.id);
        sendMessage({ type: 'LoadMap', map_id: currentMap.id, clear_tokens: false });
    } else {
        // If no map loaded locally, request it from server
        console.log('🔄 No local map, requesting from server');
        // The server should send the current map state if one is loaded
    }
    
    // Request tokens
    requestTokenRefresh();
    
    // Request current combat state if active
    if (combatState.active) {
        console.log('🔄 Combat is active, combat state will be preserved');
    }
    
    // Re-render canvas after a short delay to allow server responses
    setTimeout(() => {
        // Force reload map image if it exists
        if (currentMap && currentMap.image_path) {
            console.log('🔄 Reloading map image:', currentMap.image_path);
            // Reload the image (cache busting handled by browser or we can add timestamp)
            const img = new Image();
            img.onload = () => {
                currentMap.image = img;
                renderCanvas();
                addLogEntry('✅ Map refreshed', 'success');
            };
            img.onerror = () => {
                console.error('❌ Failed to reload map image');
                renderCanvas(); // Render anyway with existing image
                addLogEntry('⚠️ Map refresh completed (image may be cached)', 'warning');
            };
            // Add cache busting query parameter
            const separator = currentMap.image_path.includes('?') ? '&' : '?';
            img.src = '/' + currentMap.image_path + separator + 'refresh=' + Date.now();
        } else {
            // Just re-render what we have
            renderCanvas();
            addLogEntry('✅ Map refreshed', 'success');
        }
    }, 500);
}

function syncCharactersWithServer() {
    if (!characters || characters.length === 0) return;
    characters.forEach(char => {
        if (!char || !char.id || syncedCharacterIds.has(char.id)) {
            return;
        }
        const payload = buildCharacterUpdatePayload(char);
        if (payload) {
            console.log('🛠️ Syncing character with server:', payload.name, payload.id);
            sendMessage({
                type: 'CreateCharacter',
                character: payload
            });
            syncedCharacterIds.add(char.id);
        }
    });
}

async function loadTechPowers(force = false) {
    if (techPowersLoaded && !force) return;
    const candidates = [
        '/data/techpowers.json',
        '/data/tech_powers.json',
    ];
    let lastError = null;
    for (const url of candidates) {
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const powers = await response.json();
            techPowersCache = {};
            powers.forEach(raw => {
                if (!raw || !raw.name) return;
                const key = raw.name.toLowerCase();
                const levelInfo = normalizePowerLevel(raw.level, raw.category || raw.power_type || raw.type);
                const castingTime = raw.casting_time || raw.casting_period || raw.castingPeriod || raw.castingTime || '';
                const description = raw.description || raw.effect || '';
                const normalized = {
                    name: raw.name,
                    level: levelInfo.value,
                    level_label: levelInfo.label,
                    casting_time: castingTime,
                    range: raw.range || '',
                    duration: raw.duration || '',
                    concentration: raw.concentration || '',
                    components: raw.components || '',
                    damage: raw.damage || '',
                    saving_throw: raw.saving_throw || '',
                    source: raw.source || '',
                    description,
                    desc: description ? description.replace(/\n/g, '<br>') : '',
                    higher_levels: raw.higher_levels || '',
                    power_type: raw.power_type || raw.type || raw.classification || 'tech',
                    source_url: raw.source_url || raw.url || '',
                };
                techPowersCache[key] = normalized;
            });
            techPowersLoaded = true;
            console.log(`✅ Loaded ${Object.keys(techPowersCache).length} tech powers from ${url}`);
            if (currentViewingCharacter && selectedStyle === 'starwars') {
                renderCharacterSheetContent();
            }
            return;
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Failed to load tech powers from ${url}:`, err.message || err);
        }
    }
    techPowersLoaded = false;
    if (lastError) {
        console.warn('⚠️ No tech power sources succeeded:', lastError.message || lastError);
    }
}

async function loadForcePowers(force = false) {
    if (forcePowersLoaded && !force) return;
    const candidates = [
        '/data/force_powers.json',
    ];
    let lastError = null;
    for (const url of candidates) {
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const powers = await response.json();
            forcePowersCache = {};
            powers.forEach(raw => {
                if (!raw || !raw.name) return;
                const key = raw.name.toLowerCase();
                const levelInfo = normalizePowerLevel(raw.level, raw.category || raw.power_type || raw.type);
                const castingTime = raw.casting_time || raw.casting_period || raw.castingPeriod || raw.castingTime || '';
                const description = raw.description || raw.effect || '';
                const normalized = {
                    name: raw.name,
                    level: levelInfo.value,
                    level_label: levelInfo.label,
                    casting_time: castingTime,
                    range: raw.range || '',
                    duration: raw.duration || '',
                    concentration: raw.concentration || '',
                    components: raw.components || '',
                    prerequisite: raw.prerequisite || '',
                    source: raw.source || '',
                    force_alignment: raw.force_alignment || raw.alignment || '',
                    description,
                    desc: description ? description.replace(/\n/g, '<br>') : '',
                    higher_levels: raw.higher_levels || '',
                    damage: raw.damage || '',
                    saving_throw: raw.saving_throw || '',
                    power_type: 'force',
                    source_url: raw.source_url || raw.url || '',
                };
                forcePowersCache[key] = normalized;
            });
            forcePowersLoaded = true;
            console.log(`✅ Loaded ${Object.keys(forcePowersCache).length} force powers from ${url}`);
            if (currentViewingCharacter && selectedStyle === 'starwars') {
                renderCharacterSheetContent();
            }
            return;
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Failed to load force powers from ${url}:`, err.message || err);
        }
    }
    forcePowersLoaded = false;
    if (lastError) {
        console.warn('⚠️ No force power sources succeeded:', lastError.message || lastError);
    }
}
function adjustTooltipPosition(tooltip, event) {
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        tooltip.style.left = (event.clientX - rect.width - 15) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        tooltip.style.top = (event.clientY - rect.height - 15) + 'px';
    }
}

function formatTechPowerTooltip(power) {
    const lines = [];
    lines.push(`<div style="font-size: 16px; font-weight: bold; color: #00d4ff;">⚡ ${escapeHtml(power.name)}</div>`);
    const rawLevelLabel = power.level_label || power.level;
    if (rawLevelLabel !== undefined && rawLevelLabel !== null && rawLevelLabel !== '') {
        let finalLabel = '';
        const lower = String(rawLevelLabel).toLowerCase();
        if (lower === 'at-will' || lower === 'at will') {
            finalLabel = 'At-will';
        } else if (typeof rawLevelLabel === 'number') {
            finalLabel = rawLevelLabel === 0 ? 'Level 0' : `Level ${rawLevelLabel}`;
        } else if (/^\d+$/.test(String(rawLevelLabel))) {
            finalLabel = String(rawLevelLabel) === '0' ? 'Level 0' : `Level ${rawLevelLabel}`;
        } else {
            finalLabel = String(rawLevelLabel);
        }
        lines.push(`<div style="font-size: 12px; opacity: 0.7; margin-top: 3px;">${escapeHtml(finalLabel)}</div>`);
    }
    const meta = [];
    if (power.casting_time) meta.push(`<strong>Casting Time:</strong> ${escapeHtml(power.casting_time)}`);
    if (power.range) meta.push(`<strong>Range:</strong> ${escapeHtml(power.range)}`);
    if (power.duration) meta.push(`<strong>Duration:</strong> ${escapeHtml(power.duration)}`);
    if (power.concentration) meta.push(`<strong>Concentration:</strong> ${escapeHtml(power.concentration)}`);
    if (power.components) meta.push(`<strong>Components:</strong> ${escapeHtml(power.components)}`);
    if (power.saving_throw) meta.push(`<strong>Save:</strong> ${escapeHtml(power.saving_throw)}`);
    if (power.damage) meta.push(`<strong>Damage:</strong> ${escapeHtml(power.damage)}`);
    if (meta.length > 0) {
        lines.push(`<div style="font-size: 12px; margin-top: 6px; line-height: 1.4;">${meta.join('<br>')}</div>`);
    }
    if (power.description) {
        lines.push(`<div style="font-size: 12px; margin-top: 8px; line-height: 1.6; white-space: pre-line;">${escapeHtml(power.description)}</div>`);
    }
    if (power.source) {
        lines.push(`<div style="font-size: 11px; opacity: 0.7; margin-top: 6px;">Source: ${escapeHtml(power.source)}</div>`);
    }
    if (power.higher_levels) {
        lines.push(`<div style="font-size: 11px; opacity: 0.8; margin-top: 6px; white-space: pre-line;">At Higher Levels: ${escapeHtml(power.higher_levels)}</div>`);
    }
    if (power.source_url) {
        lines.push(`<div style="margin-top: 8px;"><a href="${power.source_url}" target="_blank" rel="noopener" style="font-size: 11px; color: #00d4ff;">View on SW5e</a></div>`);
    }
    return lines.join('');
}

function findImportedTechPowerDetail(powerName) {
    if (!powerName || !currentViewingCharacterData) return null;
    const normalized = powerName.trim().toLowerCase();
    const sources = [];
    if (Array.isArray(currentViewingCharacterData.techPowerDetails)) {
        sources.push(currentViewingCharacterData.techPowerDetails);
    }
    if (Array.isArray(currentViewingCharacterData.classes)) {
        currentViewingCharacterData.classes.forEach(cls => {
            if (cls && Array.isArray(cls.techPowerDetails)) {
                sources.push(cls.techPowerDetails);
            }
        });
    }
    for (let s = 0; s < sources.length; s++) {
        const list = sources[s];
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
            const detail = list[i];
            if (!detail || !detail.name) continue;
            if (detail.name.trim().toLowerCase() === normalized) {
                const enriched = Object.assign({}, detail);
                enriched.power_type = 'tech';
                if (!enriched.description && detail.powerdescription) {
                    enriched.description = detail.powerdescription;
                }
                if (!enriched.desc && enriched.description) {
                    enriched.desc = enriched.description.replace(/\n/g, '<br>');
                }
                if (!enriched.casting_time && detail.powercastingtime) {
                    enriched.casting_time = detail.powercastingtime;
                }
                if (!enriched.range && detail.powerrange) {
                    enriched.range = detail.powerrange;
                }
                if (!enriched.duration && detail.powerduration) {
                    enriched.duration = detail.powerduration;
                }
                if (!enriched.concentration && detail.powerconcentration) {
                    enriched.concentration = detail.powerconcentration;
                }
                if (!enriched.components && detail.powercomponents) {
                    enriched.components = detail.powercomponents;
                }
                if (!enriched.saving_throw && (detail.powersave || detail.saving_throw)) {
                    enriched.saving_throw = detail.powersave || detail.saving_throw;
                }
                if (!enriched.damage && detail.powerdamage) {
                    enriched.damage = detail.powerdamage;
                }
                if (!enriched.source && detail.source) {
                    enriched.source = detail.source;
                }
                if (!enriched.higher_levels && detail.higher_levels) {
                    enriched.higher_levels = detail.higher_levels;
                }
                return enriched;
            }
        }
    }
    return null;
}

function findImportedForcePowerDetail(powerName) {
    if (!powerName || !currentViewingCharacterData) return null;
    const normalized = powerName.trim().toLowerCase();
    const sources = [];
    if (Array.isArray(currentViewingCharacterData.forcePowerDetails)) {
        sources.push(currentViewingCharacterData.forcePowerDetails);
    }
    if (Array.isArray(currentViewingCharacterData.classes)) {
        currentViewingCharacterData.classes.forEach(cls => {
            if (cls && Array.isArray(cls.forcePowerDetails)) {
                sources.push(cls.forcePowerDetails);
            }
        });
    }
    for (let s = 0; s < sources.length; s++) {
        const list = sources[s];
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
            const detail = list[i];
            if (!detail || !detail.name) continue;
            if (detail.name.trim().toLowerCase() === normalized) {
                const enriched = Object.assign({}, detail);
                enriched.power_type = 'force';
                if (!enriched.description && detail.powerdescription) {
                    enriched.description = detail.powerdescription;
                }
                if (!enriched.desc && enriched.description) {
                    enriched.desc = enriched.description.replace(/\n/g, '<br>');
                }
                if (!enriched.casting_time && detail.powercastingtime) {
                    enriched.casting_time = detail.powercastingtime;
                }
                if (!enriched.range && detail.powerrange) {
                    enriched.range = detail.powerrange;
                }
                if (!enriched.duration && detail.powerduration) {
                    enriched.duration = detail.powerduration;
                }
                if (!enriched.concentration && detail.powerconcentration) {
                    enriched.concentration = detail.powerconcentration;
                }
                if (!enriched.components && detail.powercomponents) {
                    enriched.components = detail.powercomponents;
                }
                if (!enriched.saving_throw && (detail.powersave || detail.saving_throw)) {
                    enriched.saving_throw = detail.powersave || detail.saving_throw;
                }
                if (!enriched.damage && detail.powerdamage) {
                    enriched.damage = detail.powerdamage;
                }
                if (!enriched.force_alignment && detail.force_alignment) {
                    enriched.force_alignment = detail.force_alignment;
                }
                if (!enriched.prerequisite && detail.prerequisite) {
                    enriched.prerequisite = detail.prerequisite;
                }
                if (!enriched.source && detail.source) {
                    enriched.source = detail.source;
                }
                if (!enriched.higher_levels && detail.higher_levels) {
                    enriched.higher_levels = detail.higher_levels;
                }
                return enriched;
            }
        }
    }
    return null;
}

// ==================== SAVE/LOAD GAME STATE ====================

// Save game state to file
async function saveGameState() {
    const fileName = document.getElementById('saveFileName').value.trim() || 'Game Session';
    
    console.log('💾 Saving game state...');
    
    // Collect all game state data
    const gameState = {
        version: '1.0',
        savedAt: new Date().toISOString(),
        selectedStyle: selectedStyle,
        
        // Map data
        currentMap: currentMap ? {
            id: currentMap.id,
            name: currentMap.name,
            image_path: currentMap.image_path,
            grid_size: currentMap.grid_size,
            width: currentMap.width,
            height: currentMap.height
        } : null,
        
        // Canvas state
        canvasState: {
            zoom: zoom,
            panX: panX,
            panY: panY,
            gridSize: gridSize
        },
        
        // Tokens with HP values from their entities
        tokens: tokens.map(token => {
            const tokenData = {
                id: token.id,
                map_id: token.map_id,
                entity_id: token.entity_id,
                entity_type: token.entity_type,
                x: token.x,
                y: token.y,
                size: token.size,
                image_url: token.image_url
            };
            
            // Include HP values from the entity (character or enemy)
            if (token.entity_type === 'Player') {
                const char = characters.find(c => c.id === token.entity_id);
                if (char) {
                    tokenData.current_hp = char.current_hp;
                    tokenData.max_hp = char.max_hp;
                }
            } else if (token.entity_type === 'Enemy') {
                const enemy = enemies.find(e => e.id === token.entity_id);
                if (enemy) {
                    tokenData.current_hp = enemy.current_hp;
                    tokenData.max_hp = enemy.max_hp;
                }
            }
            
            return tokenData;
        }),
        
        // Characters
        characters: characters.map(char => ({
            id: char.id,
            name: char.name,
            player_name: char.player_name,
            class: char.class,
            level: char.level,
            max_hp: char.max_hp,
            current_hp: char.current_hp,
            armor_class: char.armor_class,
            initiative_bonus: char.initiative_bonus,
            strength: char.strength,
            dexterity: char.dexterity,
            constitution: char.constitution,
            intelligence: char.intelligence,
            wisdom: char.wisdom,
            charisma: char.charisma,
            speed: char.speed,
            proficiency_bonus: char.proficiency_bonus,
            character_data: char.character_data,
            portrait_url: char.portrait_url
        })),
        
        // Enemies (including NPC instances)
        enemies: enemies.map(enemy => {
            const enemyData = {
                id: enemy.id,
                name: enemy.name,
                creature_type: enemy.creature_type,
                challenge_rating: enemy.challenge_rating,
                max_hp: enemy.max_hp,
                current_hp: enemy.current_hp,
                armor_class: enemy.armor_class,
                initiative_bonus: enemy.initiative_bonus,
                strength: enemy.strength,
                dexterity: enemy.dexterity,
                constitution: enemy.constitution,
                intelligence: enemy.intelligence,
                wisdom: enemy.wisdom,
                charisma: enemy.charisma,
                speed: enemy.speed,
                actions: enemy.actions,
                description: enemy.description,
                style: enemy.style,
                portrait_url: enemy.portrait_url,
                local_portrait: enemy.local_portrait
            };
            
            // Include NPC data if it's an NPC instance
            if (enemy.isNPC) {
                enemyData.isNPC = true;
                enemyData.npcData = enemy.npcData;
            }
            
            return enemyData;
        }),
        
        // Combat state
        combatState: {
            active: combatState.active,
            participants: combatState.participants.map(p => ({
                id: p.id,
                entity_id: p.entity_id,
                name: p.name,
                entity_type: p.entity_type,
                initiative: p.initiative,
                initiative_bonus: p.initiative_bonus,
                current_hp: p.current_hp,
                max_hp: p.max_hp,
                armor_class: p.armor_class
            })),
            currentTurn: combatState.currentTurn
        },
        
        // Turn start position for movement range
        turnStartPosition: turnStartPosition
    };
    
    // Convert to JSON
    const jsonData = JSON.stringify(gameState, null, 2);
    
    // Sanitize filename (remove invalid characters)
    const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
    const filename = `${safeFileName}.json`;
    
    // Save to server first
    try {
        console.log('📤 Attempting to save to server:', filename);
        console.log('📤 JSON data size:', jsonData.length, 'bytes');
        
        const url = `/api/saves/${encodeURIComponent(filename)}`;
        console.log('📤 Making POST request to:', url);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: jsonData,
            signal: controller.signal
        }).finally(() => clearTimeout(timeoutId));
        
        console.log('📥 Server response status:', response.status, response.statusText);
        
        if (response.ok) {
            const result = await response.json().catch(() => ({}));
            console.log('✅ Game state saved to server:', filename, result);
            addLogEntry(`💾 Game state saved to server: ${fileName}`, 'info');
            
            // Refresh the load modal list if it's open
            const loadModal = document.getElementById('loadGameModal');
            if (loadModal && loadModal.classList.contains('active')) {
                await renderLoadGameStatesList();
            }
            
            alert(`✅ Game saved successfully!\n\nSaved to: saves/${filename}`);
        } else {
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error('❌ Failed to save to server:', response.status, errorText);
            alert(`⚠️ Failed to save to server (${response.status}). Check console for details.`);
            console.warn('⚠️ Falling back to localStorage');
            // Fallback to localStorage
            try {
                const savedStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
                const stateId = generateUUID();
                const stateEntry = {
                    id: stateId,
                    name: fileName,
                    savedAt: gameState.savedAt,
                    mapName: currentMap ? currentMap.name : 'None',
                    tokenCount: tokens.length,
                    combatActive: combatState.active,
                    data: jsonData
                };
                localStorage.setItem(`savedGameState_${stateId}`, jsonData);
                savedStates.push(stateEntry);
                localStorage.setItem('savedGameStates', JSON.stringify(savedStates));
            } catch (e) {
                console.warn('⚠️ Could not save to localStorage:', e);
            }
        }
    } catch (e) {
        console.error('❌ Could not save to server:', e);
        alert(`❌ Error saving to server: ${e.message}\n\nFalling back to localStorage.`);
        console.warn('⚠️ Falling back to localStorage');
        // Fallback to localStorage
        try {
            const savedStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
            const stateId = generateUUID();
            const stateEntry = {
                id: stateId,
                name: fileName,
                savedAt: gameState.savedAt,
                mapName: currentMap ? currentMap.name : 'None',
                tokenCount: tokens.length,
                combatActive: combatState.active,
                data: jsonData
            };
            localStorage.setItem(`savedGameState_${stateId}`, jsonData);
            savedStates.push(stateEntry);
            localStorage.setItem('savedGameStates', JSON.stringify(savedStates));
        } catch (e2) {
            console.warn('⚠️ Could not save to localStorage:', e2);
        }
    }
    
    // Also create blob and download for backup
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('✅ Game state saved successfully!');
    
    closeModal('saveLoadModal');
}

// Handle file selection - preview and add to saved states list
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        const fileText = await file.text();
        const gameState = JSON.parse(fileText);
        
        // Validate it's a game state file
        if (!gameState || typeof gameState !== 'object') {
            console.warn('⚠️ Selected file is not a valid game state file');
            return;
        }
        
        // Add to localStorage if not already there (or update if it exists)
        try {
            const savedStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
            const fileName = file.name.replace(/\.json$/i, '');
            const existingIndex = savedStates.findIndex(s => s.name === fileName);
            
            const stateId = existingIndex >= 0 ? savedStates[existingIndex].id : generateUUID();
            const stateEntry = {
                id: stateId,
                name: fileName,
                savedAt: gameState.savedAt || new Date().toISOString(),
                mapName: gameState.currentMap ? gameState.currentMap.name : 'None',
                tokenCount: gameState.tokens ? gameState.tokens.length : 0,
                combatActive: gameState.combatState ? gameState.combatState.active : false,
                data: fileText, // Store reference for fallback
                isFromFile: true // Mark as from file
            };
            
            // Store full data separately
            localStorage.setItem(`savedGameState_${stateId}`, fileText);
            
            if (existingIndex >= 0) {
                // Update existing
                savedStates[existingIndex] = stateEntry;
                console.log('✅ Updated existing saved state from file:', fileName);
            } else {
                // Add new
                savedStates.push(stateEntry);
                console.log('✅ Added file to saved states list:', fileName);
            }
            
            localStorage.setItem('savedGameStates', JSON.stringify(savedStates));
            
            // Refresh the saved states list to show the file
            renderSavedStatesList();
            
            // Show a brief notification
            addLogEntry(`📁 File "${fileName}" added to saved states`, 'info');
            
        } catch (e) {
            console.warn('⚠️ Could not save file to localStorage:', e);
        }
        
    } catch (error) {
        console.error('❌ Error reading file:', error);
        alert('❌ Error reading file: ' + error.message + '\n\nPlease make sure it\'s a valid game state JSON file.');
    }
}

// Load game state from file
async function loadGameState() {
    const fileInput = document.getElementById('loadGameFile');
    const file = fileInput.files[0];
    
    if (!file) {
        alert('Please select a save file to load.');
        return;
    }
    
    if (!confirm('⚠️ Loading a game state will replace the current game state. Are you sure you want to continue?')) {
        return;
    }
    
    console.log('📂 Loading game state from file:', file.name);
    
    try {
        const fileText = await file.text();
        const gameState = JSON.parse(fileText);
        
        console.log('📋 Loaded game state:', gameState);
        
        // Also save to localStorage if not already there
        try {
            const savedStates = JSON.parse(localStorage.getItem('savedGameStates') || '[]');
            const fileName = file.name.replace(/\.json$/i, '');
            const existingIndex = savedStates.findIndex(s => s.name === fileName);
            
            if (existingIndex < 0) {
                const stateId = generateUUID();
                const stateEntry = {
                    id: stateId,
                    name: fileName,
                    savedAt: gameState.savedAt || new Date().toISOString(),
                    mapName: gameState.currentMap ? gameState.currentMap.name : 'None',
                    tokenCount: gameState.tokens ? gameState.tokens.length : 0,
                    combatActive: gameState.combatState ? gameState.combatState.active : false,
                    data: fileText,
                    isFromFile: true
                };
                localStorage.setItem(`savedGameState_${stateId}`, fileText);
                savedStates.push(stateEntry);
                localStorage.setItem('savedGameStates', JSON.stringify(savedStates));
            }
        } catch (e) {
            console.warn('⚠️ Could not save to localStorage:', e);
        }
        
        // Clear the file input after loading
        fileInput.value = '';
        
        await loadGameStateFromData(gameState, file.name);
        
    } catch (error) {
        console.error('❌ Error loading game state:', error);
        alert('❌ Error loading game state: ' + error.message);
        addLogEntry('❌ Error loading game state: ' + error.message, 'damage');
    }
}

// Load game state from data object (used by both file and localStorage loading)
async function loadGameStateFromData(gameState, sourceName) {
    // Validate version
    if (!gameState.version) {
        console.warn('⚠️ Save file has no version, proceeding anyway...');
    }
    
    // Restore selected style
    if (gameState.selectedStyle) {
        selectedStyle = gameState.selectedStyle;
        console.log('✅ Restored style:', selectedStyle);
    }
        
        // Restore map first (before tokens)
        if (gameState.currentMap) {
            currentMap = gameState.currentMap;
            console.log('✅ Restored map:', currentMap.name);
            
            // Send map to server - clear tokens first, we'll restore them from save
            sendMessage({
                type: 'LoadMap',
                map_id: currentMap.id,
                clear_tokens: true
            });
            
            // Send map settings to server
            if (currentMap.grid_size && currentMap.width && currentMap.height) {
                sendMessage({
                    type: 'MapSettingsChanged',
                    grid_size: currentMap.grid_size,
                    width: currentMap.width,
                    height: currentMap.height
                });
            }
            
            // Load map image locally
            if (currentMap.image_path) {
                // Wait for map image to load
                await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                        currentMap.image = img;
                        renderCanvas();
                        resolve();
                    };
                    img.onerror = (err) => {
                        console.error('❌ Error loading map image:', err);
                        // Don't reject - continue loading even if image fails
                        resolve();
                    };
                    // Add cache busting and ensure proper path
                    const imagePath = currentMap.image_path.startsWith('/') 
                        ? currentMap.image_path 
                        : '/' + currentMap.image_path;
                    img.src = imagePath + '?t=' + Date.now();
                });
                console.log('✅ Map image loaded');
            }
        }
        
        // Restore canvas state
        if (gameState.canvasState) {
            zoom = gameState.canvasState.zoom || 1.0;
            panX = gameState.canvasState.panX || 0;
            panY = gameState.canvasState.panY || 0;
            gridSize = gameState.canvasState.gridSize || 50;
            console.log('✅ Restored canvas state: zoom=', zoom, 'pan=', panX, panY, 'grid=', gridSize);
        }
        
        // Restore characters
        if (gameState.characters && Array.isArray(gameState.characters)) {
            characters = gameState.characters;
            console.log('✅ Restored', characters.length, 'characters');
        }
        
        // Restore enemies (including NPC instances)
        if (gameState.enemies && Array.isArray(gameState.enemies)) {
            enemies = gameState.enemies;
            console.log('✅ Restored', enemies.length, 'enemies');
            
            // Save NPC instances to localStorage if they exist (if function exists)
            const npcInstances = enemies.filter(e => e.isNPC && e.npcData);
            if (npcInstances.length > 0) {
                if (typeof saveNPCInstancesToStorage === 'function') {
                    saveNPCInstancesToStorage();
                    console.log('✅ Saved', npcInstances.length, 'NPC instances to localStorage');
                } else {
                    console.log('ℹ️ NPC instances restored (', npcInstances.length, 'instances)');
                }
            }
        }
        
        // Restore tokens after map is loaded
        if (gameState.tokens && Array.isArray(gameState.tokens) && gameState.tokens.length > 0) {
            // Wait for map to be fully loaded and processed by server
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Store saved tokens for HP restoration and placement
            const savedTokens = gameState.tokens;
            console.log('📋 Restoring', savedTokens.length, 'tokens...');
            
            // First, restore HP values from tokens to their entities
            savedTokens.forEach(token => {
                if (token.current_hp !== undefined && token.max_hp !== undefined) {
                    if (token.entity_type === 'Player') {
                        const char = characters.find(c => c.id === token.entity_id);
                        if (char) {
                            char.current_hp = token.current_hp;
                            char.max_hp = token.max_hp;
                            console.log(`✅ Restored HP for character ${char.name}: ${char.current_hp}/${char.max_hp}`);
                        }
                    } else if (token.entity_type === 'Enemy') {
                        const enemy = enemies.find(e => e.id === token.entity_id);
                        if (enemy) {
                            enemy.current_hp = token.current_hp;
                            enemy.max_hp = token.max_hp;
                            console.log(`✅ Restored HP for enemy ${enemy.name}: ${enemy.current_hp}/${enemy.max_hp}`);
                        }
                    }
                }
            });
            
            // Clear local tokens first - server will send updated tokens via TokenUpdate
            tokens = [];
            renderCanvas(); // Clear canvas
            
            // Send tokens to server to sync with all clients
            // Place tokens sequentially with delays to avoid overwhelming the server
            console.log('📤 Sending', savedTokens.length, 'tokens to server...');
            for (let i = 0; i < savedTokens.length; i++) {
                const token = savedTokens[i];
                sendMessage({
                    type: 'PlaceToken',
                    entity_id: token.entity_id,
                    entity_type: token.entity_type,
                    x: token.x,
                    y: token.y
                });
                
                // Small delay between tokens to avoid race conditions
                if (i < savedTokens.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            // Wait for all tokens to be placed and server to respond with TokenUpdate
            // Server sends TokenUpdate after each PlaceToken, so wait for all to complete
            console.log('⏳ Waiting for server to process all tokens...');
            await new Promise(resolve => setTimeout(resolve, savedTokens.length * 150 + 500));
            
            // Server should have sent TokenUpdate which updated our tokens array
            // Force a final render to ensure everything is displayed
            console.log('✅ Tokens synced. Current token count:', tokens.length);
            renderCanvas();
            console.log('✅ Canvas rendered with tokens');
            
            // Update token info display
            if (selectedToken) {
                updateTokenInfo();
            }
        } else {
            // Even if no tokens, render canvas to show map
            console.log('ℹ️ No tokens to restore');
            renderCanvas();
        }
        
        // Restore combat state
        if (gameState.combatState) {
            combatState.active = gameState.combatState.active || false;
            combatState.participants = gameState.combatState.participants || [];
            combatState.currentTurn = gameState.combatState.currentTurn || null;
            console.log('✅ Restored combat state:', combatState.active ? 'Active' : 'Inactive');
            
            if (combatState.active) {
                // Update combat UI
                updateInitiativeList();
                updateCombatStatus();
            }
        }
        
        // Restore turn start position
        if (gameState.turnStartPosition) {
            turnStartPosition = gameState.turnStartPosition;
        }
        
        // Update UI
        updateInitiativeList();
        updateCombatStatus();
        
        // Final render to ensure map and tokens are visible for all clients
        renderCanvas();
        
        // Force one more render after a short delay to catch any late token updates
        setTimeout(() => {
            renderCanvas();
            console.log('✅ Final canvas render completed');
        }, 500);
        
        console.log('✅ Game state loaded successfully!');
        addLogEntry(`📂 Game state loaded: ${sourceName}`, 'info');
        closeModal('saveLoadModal');
        
        // Refresh saved states list
        renderSavedStatesList();
        
        // Show success message
        setTimeout(() => {
            alert('✅ Game state loaded successfully!\n\n' +
                  `- Map: ${currentMap ? currentMap.name : 'None'}\n` +
                  `- Tokens: ${tokens.length}\n` +
                  `- Characters: ${characters.length}\n` +
                  `- Enemies: ${enemies.length}\n` +
                  `- Combat: ${combatState.active ? 'Active' : 'Inactive'}`);
        }, 1000);
}

// ==================== SOUND BOARD ====================

let sounds = [];
let currentlyPlayingSounds = new Map(); // Track playing sounds

async function showSoundBoard() {
    if (!isDM) {
        alert('Only the DM can use the sound board!');
        return;
    }
    
    const modal = document.getElementById('soundBoardModal');
    if (!modal) {
        console.error('❌ soundBoardModal not found!');
        return;
    }
    
    modal.classList.add('active');
    await renderSoundsList();
}

async function renderSoundsList() {
    const container = document.getElementById('soundsList');
    if (!container) {
        console.error('❌ soundsList container not found!');
        return;
    }
    
    container.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">Loading sounds...</div>';
    
    try {
        const response = await fetch('/api/sounds');
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        
        const data = await response.json();
        sounds = data.sounds || [];
        
        if (sounds.length === 0) {
            container.innerHTML = '<div style="padding: 20px; color: #888; text-align: center;">No sounds uploaded yet.<br><br>Upload a sound file to get started!</div>';
            return;
        }
        
        let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">';
        
        sounds.forEach(sound => {
            const sizeMB = (sound.size / (1024 * 1024)).toFixed(2);
            html += `
                <div style="padding: 15px; background: linear-gradient(135deg, rgba(170,68,255,0.1) 0%, rgba(170,68,255,0.05) 100%); border-radius: 8px; border: 2px solid rgba(170,68,255,0.3); cursor: pointer; transition: all 0.2s; position: relative;"
                     onclick="playSound('${escapeHtml(sound.filename)}', '${escapeHtml(sound.name)}')"
                     onmouseover="this.style.borderColor='rgba(170,68,255,0.8)'; this.style.background='linear-gradient(135deg, rgba(170,68,255,0.2) 0%, rgba(170,68,255,0.1) 100%)';"
                     onmouseout="this.style.borderColor='rgba(170,68,255,0.3)'; this.style.background='linear-gradient(135deg, rgba(170,68,255,0.1) 0%, rgba(170,68,255,0.05) 100%)';">
                    ${isDM ? `<button onclick="event.stopPropagation(); deleteSound('${escapeHtml(sound.filename)}');" 
                            style="position: absolute; top: 5px; right: 5px; background: #ff4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 14px; font-weight: bold; line-height: 1; z-index: 10;" 
                            title="Delete Sound">✕</button>` : ''}
                    <div style="font-size: 32px; text-align: center; margin-bottom: 8px;">🔊</div>
                    <div style="font-weight: bold; font-size: 14px; color: #fff; margin-bottom: 4px; text-align: center; ${isDM ? 'padding-right: 30px;' : ''}">
                        ${escapeHtml(sound.name)}
                    </div>
                    <div style="font-size: 11px; color: #aaa; text-align: center;">
                        ${sound.type.toUpperCase()} • ${sizeMB} MB
                    </div>
                    <div style="font-size: 10px; color: #888; text-align: center; margin-top: 8px;">
                        Click to play
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
        console.log('✅ Sounds list rendered with', sounds.length, 'sounds');
    } catch (e) {
        console.error('❌ Error loading sounds:', e);
        container.innerHTML = '<div style="padding: 10px; color: #ff4444; text-align: center;">Error loading sounds: ' + e.message + '</div>';
    }
}

async function uploadSound() {
    if (!isDM) {
        alert('Only the DM can upload sounds!');
        return;
    }
    
    const fileInput = document.getElementById('soundUploadFile');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Please select a sound file to upload!');
        return;
    }
    
    const file = fileInput.files[0];
    const maxSize = 10 * 1024 * 1024; // 10MB limit
    
    if (file.size > maxSize) {
        alert(`File is too large! Maximum size is 10MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.`);
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        console.log('📤 Uploading sound:', file.name);
        const response = await fetch('/api/sounds', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Server returned ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        console.log('✅ Sound uploaded:', result);
        addLogEntry(`🔊 Sound uploaded: ${file.name}`, 'info');
        
        // Clear file input
        fileInput.value = '';
        
        // Refresh sounds list
        await renderSoundsList();
        
        alert(`✅ Sound uploaded successfully!\n\n${file.name}`);
    } catch (e) {
        console.error('❌ Error uploading sound:', e);
        alert('Error uploading sound: ' + e.message);
    }
}

async function playSound(filename, name) {
    if (!isDM) {
        alert('Only the DM can play sounds!');
        return;
    }
    
    try {
        console.log('🔊 DM playing sound:', name);
        
        // Load sound file and convert to base64
        const response = await fetch(`/static/sounds/${encodeURIComponent(filename)}`);
        if (!response.ok) {
            throw new Error(`Failed to load sound: ${response.status}`);
        }
        
        const blob = await response.blob();
        const reader = new FileReader();
        
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1]; // Remove data:audio/...;base64, prefix
            const soundType = filename.split('.').pop() || 'mp3';
            
            // Send to server to broadcast to all clients (including DM)
            // Don't play locally here - let the server broadcast handle it for everyone
            sendMessage({
                type: 'PlaySound',
                sound_id: filename,
                sound_name: name,
                sound_data: base64,
                sound_type: soundType
            });
            
            console.log('📤 Sent PlaySound message to server for broadcast');
        };
        
        reader.readAsDataURL(blob);
    } catch (e) {
        console.error('❌ Error playing sound:', e);
        alert('Error playing sound: ' + e.message);
    }
}

function playSoundFromServer(soundId, soundName, soundData, soundType) {
    try {
        // Stop any currently playing sound with the same ID
        if (currentlyPlayingSounds.has(soundId)) {
            const oldAudio = currentlyPlayingSounds.get(soundId);
            try {
                oldAudio.pause();
                oldAudio.currentTime = 0;
            } catch (e) {
                // Ignore errors when pausing/stopping old audio
            }
            currentlyPlayingSounds.delete(soundId);
        }
        
        // Create audio element
        const audio = new Audio(`data:audio/${soundType};base64,${soundData}`);
        audio.volume = 1.0;
        
        // Track this sound
        currentlyPlayingSounds.set(soundId, audio);
        
        // Play sound with error handling
        const playPromise = audio.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('🔊 Playing sound:', soundName);
                    addLogEntry(`🔊 Playing: ${soundName}`, 'info');
                })
                .catch(e => {
                    // Some browsers require user interaction before playing audio
                    if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') {
                        console.warn('⚠️ Audio autoplay blocked by browser. User may need to interact with page first.');
                        addLogEntry(`⚠️ Could not play sound: ${e.name}`, 'error');
                    } else {
                        console.error('❌ Error playing audio:', e);
                        addLogEntry(`❌ Error playing sound: ${e.message}`, 'error');
                    }
                    currentlyPlayingSounds.delete(soundId);
                });
        }
        
        // Clean up when done
        audio.onended = () => {
            console.log('🔇 Sound finished:', soundName);
            currentlyPlayingSounds.delete(soundId);
        };
        
        audio.onerror = (e) => {
            console.error('❌ Audio playback error:', e);
            currentlyPlayingSounds.delete(soundId);
        };
    } catch (e) {
        console.error('❌ Error creating audio:', e);
    }
}

async function deleteSound(filename) {
    if (!isDM) {
        alert('Only the DM can delete sounds!');
        return;
    }
    
    if (!confirm(`⚠️ Delete sound "${filename}"?\n\nThis cannot be undone!`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/sounds/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        
        console.log('🗑️ Deleted sound:', filename);
        addLogEntry(`🗑️ Deleted sound: ${filename}`, 'info');
        
        // Refresh sounds list
        await renderSoundsList();
    } catch (e) {
        console.error('❌ Error deleting sound:', e);
        alert('Error deleting sound: ' + e.message);
    }
}

// ==================== SETTINGS & CRITICAL ROLL SOUNDS ====================

let nat20SoundFile = null; // Store the sound filename
let nat1SoundFile = null;

// Load saved sound preferences from localStorage
function loadCriticalRollSounds() {
    nat20SoundFile = localStorage.getItem('nat20SoundFile') || null;
    nat1SoundFile = localStorage.getItem('nat1SoundFile') || null;
    
    console.log('🔊 Loaded critical roll sounds - Nat 20:', nat20SoundFile, 'Nat 1:', nat1SoundFile);
    
    // Update display if settings modal is open
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.classList.contains('active')) {
        if (nat20SoundFile) {
            updateNat20SoundDisplay(nat20SoundFile);
        }
        if (nat1SoundFile) {
            updateNat1SoundDisplay(nat1SoundFile);
        }
    }
}

// Initialize on page load (after DOM is ready)
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(loadCriticalRollSounds, 1000);
        });
    } else {
        // DOM already loaded
        setTimeout(loadCriticalRollSounds, 1000);
    }
}

function showSettings() {
    if (!isDM) {
        alert('Only the DM can access settings!');
        return;
    }
    
    const modal = document.getElementById('settingsModal');
    if (!modal) {
        console.error('❌ settingsModal not found!');
        return;
    }
    
    modal.classList.add('active');
    loadCriticalRollSounds(); // Refresh display
}

function updateNat20SoundDisplay(filename) {
    const infoDiv = document.getElementById('nat20SoundInfo');
    const previewAudio = document.getElementById('nat20SoundPreview');
    
    if (infoDiv && filename) {
        infoDiv.textContent = `Current: ${filename}`;
        infoDiv.style.opacity = '1';
        infoDiv.style.color = '#44ff44';
        
        if (previewAudio) {
            previewAudio.src = `/static/sounds/${encodeURIComponent(filename)}`;
            previewAudio.style.display = 'block';
        }
    }
}

function updateNat1SoundDisplay(filename) {
    const infoDiv = document.getElementById('nat1SoundInfo');
    const previewAudio = document.getElementById('nat1SoundPreview');
    
    if (infoDiv && filename) {
        infoDiv.textContent = `Current: ${filename}`;
        infoDiv.style.opacity = '1';
        infoDiv.style.color = '#ff4444';
        
        if (previewAudio) {
            previewAudio.src = `/static/sounds/${encodeURIComponent(filename)}`;
            previewAudio.style.display = 'block';
        }
    }
}

async function uploadNat20Sound() {
    if (!isDM) {
        alert('Only the DM can upload sounds!');
        return;
    }
    
    const fileInput = document.getElementById('nat20SoundFile');
    const file = fileInput?.files[0];
    
    if (!file) {
        alert('Please select a sound file first!');
        return;
    }
    
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        alert('File too large! Maximum size is 5MB.');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/sounds', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        const filename = result.filename || file.name;
        
        // Save to localStorage (for this client)
        nat20SoundFile = filename;
        localStorage.setItem('nat20SoundFile', filename);
        
        console.log('✅ Nat 20 sound uploaded:', filename);
        updateNat20SoundDisplay(filename);
        
        // Clear file input
        fileInput.value = '';
        
        alert(`✅ Natural 20 sound uploaded successfully!\n\n${filename}\n\nNote: This sound will play for all players when anyone rolls a natural 20!`);
    } catch (e) {
        console.error('❌ Error uploading nat 20 sound:', e);
        alert('Error uploading sound: ' + e.message);
    }
}

async function uploadNat1Sound() {
    if (!isDM) {
        alert('Only the DM can upload sounds!');
        return;
    }
    
    const fileInput = document.getElementById('nat1SoundFile');
    const file = fileInput?.files[0];
    
    if (!file) {
        alert('Please select a sound file first!');
        return;
    }
    
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        alert('File too large! Maximum size is 5MB.');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/sounds', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        const filename = result.filename || file.name;
        
        // Save to localStorage (for this client)
        nat1SoundFile = filename;
        localStorage.setItem('nat1SoundFile', filename);
        
        console.log('✅ Nat 1 sound uploaded:', filename);
        updateNat1SoundDisplay(filename);
        
        // Clear file input
        fileInput.value = '';
        
        alert(`✅ Natural 1 sound uploaded successfully!\n\n${filename}\n\nNote: This sound will play for all players when anyone rolls a natural 1!`);
    } catch (e) {
        console.error('❌ Error uploading nat 1 sound:', e);
        alert('Error uploading sound: ' + e.message);
    }
}

// Play critical roll sounds - broadcasts to all clients if DM, or plays locally if player
async function playNat20Sound() {
    if (!nat20SoundFile) {
        // Try to load from localStorage (in case it was set by another tab)
        nat20SoundFile = localStorage.getItem('nat20SoundFile') || null;
        if (!nat20SoundFile) return;
    }
    
    // If DM, broadcast to all clients via WebSocket
    if (isDM && ws && ws.readyState === WebSocket.OPEN) {
        try {
            console.log('📤 DM broadcasting nat 20 sound to all clients:', nat20SoundFile);
            
            // Load sound file and convert to base64
            const response = await fetch(`/static/sounds/${encodeURIComponent(nat20SoundFile)}`);
            if (!response.ok) {
                throw new Error(`Failed to load sound: ${response.status}`);
            }
            
            const blob = await response.blob();
            const reader = new FileReader();
            
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                const soundType = nat20SoundFile.split('.').pop() || 'mp3';
                
                // Broadcast to all clients via WebSocket
                sendMessage({
                    type: 'PlaySound',
                    sound_id: `nat20_${Date.now()}`,
                    sound_name: 'Natural 20!',
                    sound_data: base64,
                    sound_type: soundType
                });
                
                console.log('✅ Nat 20 sound broadcast sent');
            };
            
            reader.readAsDataURL(blob);
        } catch (e) {
            console.error('❌ Error broadcasting nat 20 sound:', e);
            // Fallback to local playback
            playNat20SoundLocal();
        }
    } else {
        // Player: play locally (if they have the filename)
        playNat20SoundLocal();
    }
}

// Local playback (for players or fallback)
function playNat20SoundLocal() {
    if (!nat20SoundFile) return;
    
    try {
        const audio = new Audio(`/static/sounds/${encodeURIComponent(nat20SoundFile)}`);
        audio.volume = 0.8;
        audio.play().catch(e => {
            console.warn('⚠️ Could not play nat 20 sound:', e);
        });
        console.log('🎵 Playing nat 20 sound locally:', nat20SoundFile);
    } catch (e) {
        console.error('❌ Error playing nat 20 sound:', e);
    }
}

async function playNat1Sound() {
    if (!nat1SoundFile) {
        // Try to load from localStorage (in case it was set by another tab)
        nat1SoundFile = localStorage.getItem('nat1SoundFile') || null;
        if (!nat1SoundFile) return;
    }
    
    // If DM, broadcast to all clients via WebSocket
    if (isDM && ws && ws.readyState === WebSocket.OPEN) {
        try {
            console.log('📤 DM broadcasting nat 1 sound to all clients:', nat1SoundFile);
            
            // Load sound file and convert to base64
            const response = await fetch(`/static/sounds/${encodeURIComponent(nat1SoundFile)}`);
            if (!response.ok) {
                throw new Error(`Failed to load sound: ${response.status}`);
            }
            
            const blob = await response.blob();
            const reader = new FileReader();
            
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                const soundType = nat1SoundFile.split('.').pop() || 'mp3';
                
                // Broadcast to all clients via WebSocket
                sendMessage({
                    type: 'PlaySound',
                    sound_id: `nat1_${Date.now()}`,
                    sound_name: 'Natural 1!',
                    sound_data: base64,
                    sound_type: soundType
                });
                
                console.log('✅ Nat 1 sound broadcast sent');
            };
            
            reader.readAsDataURL(blob);
        } catch (e) {
            console.error('❌ Error broadcasting nat 1 sound:', e);
            // Fallback to local playback
            playNat1SoundLocal();
        }
    } else {
        // Player: play locally (if they have the filename)
        playNat1SoundLocal();
    }
}

// Local playback (for players or fallback)
function playNat1SoundLocal() {
    if (!nat1SoundFile) return;
    
    try {
        const audio = new Audio(`/static/sounds/${encodeURIComponent(nat1SoundFile)}`);
        audio.volume = 0.8;
        audio.play().catch(e => {
            console.warn('⚠️ Could not play nat 1 sound:', e);
        });
        console.log('🎵 Playing nat 1 sound locally:', nat1SoundFile);
    } catch (e) {
        console.error('❌ Error playing nat 1 sound:', e);
    }
}

