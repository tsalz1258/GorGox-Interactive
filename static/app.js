// GORGOX_APP_VERSION=combat-cycles-all-tokens (unique ids per token; server unique placeholders; patch by index)
const APP_UI_VERSION = 'v29'; // Bump this when you deploy; tab title + badge show this so you know latest assets loaded
var lastActionBarScrollBeforeClick = null; // Capture scroll on mousedown so we restore to pre-click position (avoid grid dragging down)
var actionBarScrollLockUntil = 0; // Until this timestamp, we force-restore scroll on any scroll event (stops grid drag)
(function () { try { console.log('%c[GorGox] app.js ' + APP_UI_VERSION + ' loaded', 'color: #4a9eff; font-weight: bold;'); } catch (e) {} })();
// Global state
let ws = null;
let selectedStyle = 'dnd'; // 'dnd' or 'starwars'
let sessionId = null;
let isDM = false; // THIS NEVER CHANGES AFTER CONNECTION
let myPlayerName = ''; // Store our player name
let myCharacterId = null; // Track which character this player controls
let playerActionBarVisible = true; // Toggle for bottom action bar (players only)
const PLAYER_ACTION_BAR_HEIGHT_MIN = 80;
const PLAYER_ACTION_BAR_HEIGHT_MAX = 320;
const PLAYER_ACTION_BAR_HEIGHT_DEFAULT = 100;
let playerActionBarHeight = PLAYER_ACTION_BAR_HEIGHT_DEFAULT; // Resizable; persisted in localStorage
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
    currentTurn: null,
    removedFromCombatIds: [] // token/participant ids removed by DM (X) this combat — don't re-add from sync
};

// Track where current turn started (for movement range display)
let turnStartPosition = null;

// Initiative prompt state
let initiativePromptParticipant = null;
let initiativePromptReminderTimeout = null;

// Only auto-show "Select Character" once per connection; after that only the button opens it
let hasAutoShownCharacterSelectThisSession = false;

// WebSocket reconnection for slow/unstable connections (e.g. remote players)
let reconnectAttempts = 0;
let reconnectTimeoutId = null;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_INITIAL_DELAY_MS = 2000;

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

// Ping system
let activePings = []; // Array of active pings: [{x, y, timestamp, playerName, id}]
let contextMenuVisible = false;
let contextMenuPosition = { x: 0, y: 0 };

// Character highlighting system (for Discord integration)
let highlightedTokens = new Map(); // Map of token_id -> {timestamp, duration, color, discordUsername}

// HP bar animation tracking - store previous HP values for smooth animations
let previousHpValues = new Map(); // Map of entity_id -> {hp, maxHp}

const syncedCharacterIds = new Set();
let techPowersCache = {};
let techPowersLoaded = false;
let forcePowersCache = {};
let forcePowersLoaded = false;

// Equipment and item caches
let weaponsCache = {};
let weaponsLoaded = false;
let armorCache = {};
let armorLoaded = false;
let featsCache = {};
let featsLoaded = false;
let gearCache = {};
let gearLoaded = false;
let itemsCache = {};
let itemsLoaded = false;
let maneuversCache = {};
let maneuversLoaded = false;
let conditionsCache = {};
let conditionsLoaded = false;

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
    applyPlayerActionBarHeight(); // Apply saved action bar height (sets CSS var for main content)
    var badge = document.getElementById('appVersionBadge');
    if (badge) badge.textContent = typeof APP_UI_VERSION !== 'undefined' ? APP_UI_VERSION : 'v29';
    if (typeof APP_UI_VERSION !== 'undefined') document.title = 'Gorgox Interactive (' + APP_UI_VERSION + ')';
    function actionBarScrollRevert() {
        if (typeof actionBarScrollLockUntil !== 'undefined' && Date.now() < actionBarScrollLockUntil && lastActionBarScrollBeforeClick) {
            var s = lastActionBarScrollBeforeClick;
            restoreWindowScroll(s.x, s.y, s.sidebar, s.sidebarLeft, s.docScrollTop, s.docScrollLeft);
        }
    }
    document.addEventListener('scroll', actionBarScrollRevert, true);
    window.addEventListener('scroll', actionBarScrollRevert, true);
});

// Connection - Define immediately so it's always available
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
    
    // Save connection info for auto-reconnect
    localStorage.setItem('savedPlayerName', playerName);
    localStorage.setItem('savedIsDM', isDM.toString());
    localStorage.setItem('savedStyle', selectedStyle);
    localStorage.setItem('autoReconnect', 'true');
    
    performConnection(playerName, isDM, selectedStyle);
}

function performConnection(playerName, isDmValue, style) {
    myPlayerName = playerName;
    isDM = isDmValue;
    selectedStyle = style;
    cancelReconnect();
    
    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket opened, sending Connect message...');
        sendMessage({
            type: 'Connect',
            player_name: playerName,
            is_dm: isDM,
            style: selectedStyle
        });
        console.log('📤 Connect message sent, waiting for Connected response...');
        
        // Apply theme based on style
        applyTheme(selectedStyle);
    };
    
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleServerMessage(message);
        } catch (e) {
            console.error('❌ Error parsing server message:', e);
            console.error('   Raw message:', event.data);
            alert('Error receiving message from server. Please refresh the page.');
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };
    
    ws.onclose = (event) => {
        updateConnectionStatus(false);
        if (typeof addLogEntry === 'function') {
            addLogEntry('Disconnected from server', 'info');
        }
        ws = null;
        
        // Auto-reconnect for dropped connections (e.g. slow/unstable network) so players see updates again
        const autoReconnect = localStorage.getItem('autoReconnect');
        if (autoReconnect === 'true' && !event.wasClean && myPlayerName) {
            scheduleReconnect();
        }
    };
}

function scheduleReconnect() {
    if (reconnectTimeoutId) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        reconnectAttempts = 0;
        return;
    }
    const delay = Math.min(RECONNECT_INITIAL_DELAY_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_DELAY_MS);
    reconnectAttempts++;
    console.log('🔄 Reconnecting in ' + (delay / 1000) + 's (attempt ' + reconnectAttempts + ')...');
    addLogEntry('Reconnecting in ' + (delay / 1000) + 's...', 'info');
    reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        if (ws && ws.readyState === WebSocket.OPEN) return;
        console.log('🔄 Attempting to reconnect...');
        addLogEntry('Reconnecting...', 'info');
        performConnection(myPlayerName, isDM, selectedStyle);
    }, delay);
}

function cancelReconnect() {
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
    reconnectAttempts = 0;
}

// Also assign to window for global access
window.connect = connect;

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

// Parse custom enemy actions from any supported format into [{ name, description }]
function parseCustomEnemyActions(enemy) {
    if (!enemy) return [];
    let raw = enemy.actions;
    if (raw === undefined || raw === null) return [];
    if (typeof raw !== 'string') {
        raw = JSON.stringify(raw);
    }
    raw = (raw || '').trim();
    if (!raw) return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        return [];
    }
    if (Array.isArray(parsed)) {
        return parsed.map(a => ({
            name: (a && (a.name || a.title)) || 'Action',
            description: (a && (a.description || a.desc || a.text)) != null ? String(a.description || a.desc || a.text) : ''
        }));
    }
    if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.actions)) {
            return parsed.actions.map(a => ({
                name: (a && (a.name || a.title)) || 'Action',
                description: (a && (a.description || a.desc || a.text)) != null ? String(a.description || a.desc || a.text) : ''
            }));
        }
        const obj = parsed.actions && typeof parsed.actions === 'object' ? parsed.actions : parsed;
        return Object.entries(obj).filter(([k]) => k && typeof k === 'string').map(([name, val]) => ({
            name: name,
            description: typeof val === 'string' ? val : (val && (val.description || val.desc || val.text)) != null ? String(val.description || val.desc || val.text) : ''
        }));
    }
    return [];
}

// True if name looks like a placed token instance (e.g. "Goblin 1") — never save these to the database
function isInstanceStyleName(name) {
    if (!name || typeof name !== 'string') return false;
    const t = name.trim();
    const idx = t.lastIndexOf(' ');
    return idx > 0 && /^\d+$/.test(t.slice(idx + 1));
}

function buildEnemyServerPayload(enemy) {
    if (!enemy) return null;
    const portrait = enemy.portrait_url || enemy.local_portrait || null;
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
        portrait_url: portrait,
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
    
    // Safety check
    if (!message || !message.type) {
        console.error('❌ Invalid message received:', message);
        return;
    }
    
    switch (message.type) {
        case 'Connected':
            console.log('✅ Connected message received! Session ID:', message.session_id);
            sessionId = message.session_id;
            reconnectAttempts = 0; // Reset so next drop uses initial backoff
            // DON'T overwrite isDM - it's already set correctly from connect()
            updateConnectionStatus(true);
            
            // Hide connection modal and show main interface - FORCE update
            const connectionModal = document.getElementById('connectionModal');
            const mainInterface = document.getElementById('mainInterface');
            if (connectionModal) {
                connectionModal.classList.remove('active');
                connectionModal.style.display = 'none'; // Force hide
                console.log('✅ Connection modal hidden');
            } else {
                console.error('❌ connectionModal element not found!');
            }
            if (mainInterface) {
                mainInterface.classList.remove('hidden');
                mainInterface.style.display = ''; // Ensure it's visible
                console.log('✅ Main interface shown');
            } else {
                console.error('❌ mainInterface element not found!');
            }
            
            // FIX: Initialize with myself first, then server will send others via PlayerJoined
            console.log('🔌 Connected! Adding self to players:', myPlayerName, 'isDM:', isDM);
            console.log('⏳ Waiting for server to send initial game state (map, tokens, characters)...');
            
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
                const shutdownSection = document.getElementById('dmShutdownSection');
                if (shutdownSection) shutdownSection.classList.remove('hidden');
                updatePlayerConnectionLink();
                document.getElementById('playerControls').classList.add('hidden');
                console.log('DM MODE ACTIVATED - Full controls enabled, NO character selection');
            } else {
                // Players: allow one auto-open of character select this session; then only button opens it
                hasAutoShownCharacterSelectThisSession = false;
                myCharacterId = null;
                document.getElementById('playerControls').classList.remove('hidden');
                updatePlayerActionBarVisibility();
                setTimeout(() => { updatePlayerActionBarVisibility(); updateActionBarButtonLabel(); }, 400);
                setTimeout(() => {
                    if (!isDM && !myCharacterId && !hasAutoShownCharacterSelectThisSession) {
                        hasAutoShownCharacterSelectThisSession = true;
                        console.log('🎭 Auto-opening character selection for player (on connect)');
                        showCharacterManager();
                    }
                }, 600);
            }
            
            // Show refresh button when connected
            const refreshBtn = document.getElementById('refreshButton');
            if (refreshBtn) {
                refreshBtn.classList.remove('hidden');
            }
            
            document.getElementById('playerInfo').textContent = 
                `${myPlayerName} ${message.is_dm ? '(DM)' : ''}`;
            
            addLogEntry('Connected to game! Requesting game state...', 'info');
            characters = [];
            loadInitialData();
            // Request full state so slow/high-latency players get map, tokens, combat reliably
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    console.log('🔄 Requesting full state (join sync)');
                    sendMessage({ type: 'RequestFullState' });
                }
            }, 400);
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN && tokens.length === 0 && !currentMap) {
                    console.log('🔄 Re-requesting full state (slow connection)');
                    sendMessage({ type: 'RequestFullState' });
                }
            }, 2500);
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
            if (canvas && currentMap.width && currentMap.height) {
                canvas.width = currentMap.width;
                canvas.height = currentMap.height;
            }
            console.log('🗺️ MapLoaded - image_path:', message.map.image_path);
            loadMapImage(message.map.image_path);
            renderCanvas(); // Draw immediately so tokens show even before map image loads
            addLogEntry(`Map loaded: ${message.map.name}`, 'info');
            break;
            
        case 'MapCleared':
            console.log('🗑️ MapCleared message received - clearing map and tokens (same as local clear)');
            
            // EXACT SAME CLEARING LOGIC as clearCurrentMap() function
            // This ensures DM and players clear identically
            if (currentMap) {
                currentMap.image = null;
            }
            currentMap = null;
            tokens = [];
            tokenImages = {};
            selectedToken = null;
            measurementShapes = [];
            rulerStart = null;
            rulerEnd = null;
            
            // Update UI
            const mapNameElement = document.getElementById('currentMapName');
            if (mapNameElement) {
                mapNameElement.textContent = 'No map loaded';
            }
            updateTokenInfo();
            
            // Clear canvas completely - EXACT SAME as clearCurrentMap()
            if (ctx && canvas) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                // Reset dimensions to force complete clear
                const w = canvas.width;
                const h = canvas.height;
                canvas.width = 1;
                canvas.height = 1;
                canvas.width = w;
                canvas.height = h;
                ctx.fillStyle = '#1a1a1a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            
            // Render immediately
            renderCanvas();
            
            console.log('✅ Map and tokens cleared on client - map image removed');
            addLogEntry('🗑️ Map and all tokens cleared', 'info');
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
                
                // Remove existing shapes of the same type before adding new one
                // This ensures only one ruler/cone/circle exists at a time for all players
                if (message.shape.type === 'ruler') {
                    measurementShapes = measurementShapes.filter(shape => shape.type !== 'ruler');
                } else if (message.shape.type === 'cone') {
                    measurementShapes = measurementShapes.filter(shape => shape.type !== 'cone');
                } else if (message.shape.type === 'circle') {
                    measurementShapes = measurementShapes.filter(shape => shape.type !== 'circle');
                }
                
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
            
        case 'PingLocation':
            // Add ping from another player
            if (message.x !== undefined && message.y !== undefined) {
                const pingId = 'ping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                const ping = {
                    id: pingId,
                    x: message.x,
                    y: message.y,
                    timestamp: Date.now(),
                    playerName: message.player_name || 'Unknown'
                };
                activePings.push(ping);
                renderCanvas();
                
                // Remove ping after 3 seconds
                setTimeout(() => {
                    activePings = activePings.filter(p => p.id !== pingId);
                    renderCanvas();
                }, 3000);
                
                console.log(`📍 Ping received from ${ping.playerName}`);
            }
            break;
            
        case 'HighlightCharacter':
            // Highlight a character token when Discord user speaks
            console.log('📥 Received HighlightCharacter message:', message);
            if (message.character_id) {
                console.log(`🔍 Looking for tokens with entity_id: ${message.character_id}`);
                console.log(`📊 Current tokens on map:`, tokens.map(t => ({ 
                    id: t.id, 
                    entity_id: t.entity_id, 
                    entity_type: t.entity_type,
                    x: t.x,
                    y: t.y
                })));
                
                // Also log all characters to help debug ID mismatches
                if (characters && characters.length > 0) {
                    console.log(`📋 Available characters:`, characters.map(c => ({ 
                        id: c.id, 
                        name: c.name 
                    })));
                }
                
                highlightCharacterToken(message.character_id, message.discord_username || 'Discord User', message.duration || 3000);
                console.log(`✨ Highlighting character ${message.character_id} (Discord: ${message.discord_username})`);
            } else {
                console.warn('⚠️ HighlightCharacter message missing character_id');
                console.warn('   Full message:', JSON.stringify(message, null, 2));
            }
            break;
            
        case 'AbilityCheckRolled':
            console.log('🎲 Ability check rolled:', message);
            const abilityName = message.ability.toUpperCase();
            
            // Check if this is a dice roll (starts with "D")
            const isDiceRoll = abilityName.startsWith('D');
            
            if (isDiceRoll) {
                // Flat dice roll - add once from server broadcast (we no longer add locally to avoid duplicates)
                const diceType = abilityName;
                addRollEntry(`🎲 ${message.character_name} rolled ${diceType}: ${message.roll}`, false, false);
            } else {
                const rollDisplay = `${message.roll} ${message.modifier >= 0 ? '+' : ''}${message.modifier}`;
                const isAbilityNat20 = message.roll === 20;
                const isAbilityNat1 = message.roll === 1;
                const abilityNatText = isAbilityNat20 ? ' ✨ NATURAL 20!' : (isAbilityNat1 ? ' ❌ NATURAL 1!' : '');
                addRollEntry(`🎲 ${message.character_name} rolled ${abilityName} check: ${rollDisplay} = ${message.total}${abilityNatText}`, isAbilityNat20, isAbilityNat1);
                if (isAbilityNat20) playNat20Sound();
                else if (isAbilityNat1) playNat1Sound();
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
            if (isSaveNat20) playNat20Sound();
            else if (isSaveNat1) playNat1Sound();
            break;
            
        case 'SkillRolled':
            console.log('🎯 Skill check rolled:', message);
            const skillDisplay = `${message.roll} ${message.modifier >= 0 ? '+' : ''}${message.modifier}`;
            const isSkillNat20 = message.roll === 20;
            const isSkillNat1 = message.roll === 1;
            const skillNatText = isSkillNat20 ? ' ✨ NATURAL 20!' : (isSkillNat1 ? ' ❌ NATURAL 1!' : '');
            addRollEntry(`🎯 ${message.character_name} rolled ${message.skill}: ${skillDisplay} = ${message.total}${skillNatText}`, isSkillNat20, isSkillNat1);
            if (isSkillNat20) playNat20Sound();
            else if (isSkillNat1) playNat1Sound();
            break;
            
        case 'AttackRolled':
            console.log('⚔️ Attack rolled:', message);
            const hitDisplay = `${message.to_hit_roll} ${message.to_hit_mod >= 0 ? '+' : ''}${message.to_hit_mod}`;
            const isCrit = message.to_hit_roll === 20;
            const isFail = message.to_hit_roll === 1;
            const critText = isCrit ? ' 🎉 CRITICAL HIT! ✨ NATURAL 20!' : (isFail ? ' ❌ CRITICAL MISS! NATURAL 1!' : '');
            addRollEntry(`⚔️ ${message.character_name} attacks with ${message.weapon}: To Hit ${hitDisplay} = ${message.to_hit_total} | Damage: ${message.damage} ${message.damage_type}${critText}`, isCrit, isFail);
            if (isCrit) playNat20Sound();
            else if (isFail) playNat1Sound();
            break;
            
        case 'TokenUpdate':
            console.log('📍 ========== TOKEN UPDATE ==========');
            console.log('Received tokens:', message.tokens);
            console.log('Number of tokens:', message.tokens.length);
            
            // CRITICAL: Before updating tokens, verify NPC instances still exist in enemies array
            const npcInstancesBefore = enemies.filter(e => e && e.isNPC && e.npcData);
            console.log('📋 NPC instances before token update:', npcInstancesBefore.length);
            
            // Update tokens array - this is authoritative from server
            const serverTokens = message.tokens || [];
            
            // CRITICAL: Preserve manually set sizes from local tokens array
            // Store current local token sizes before replacing the array
            const localTokenSizes = new Map();
            tokens.forEach(t => {
                if (t.size && t.size !== 1.0) {
                    // Only preserve non-default sizes (manually set)
                    localTokenSizes.set(t.id, t.size);
                }
            });
            
            // Merge server tokens with preserved sizes
            tokens = serverTokens.map(t => {
                // Check if we have a manually set size for this token
                const preservedSize = localTokenSizes.get(t.id);
                if (preservedSize) {
                    console.log(`✅ Preserving manually set size ${preservedSize} for token ${t.id} (server had: ${t.size})`);
                    return { ...t, size: preservedSize };
                }
                
                // Check if server sent a valid size
                const hasValidSize = t.size !== undefined && 
                                    t.size !== null && 
                                    !isNaN(t.size) && 
                                    typeof t.size === 'number' &&
                                    t.size > 0;
                
                if (hasValidSize) {
                    // Use server's size
                    return t;
                } else {
                    // Calculate if size is truly missing
                    const calculatedSize = getTokenSize(t.entity_id, t.entity_type);
                    console.log(`🔧 Token ${t.id} (${t.entity_id}) missing/invalid size, calculated: ${calculatedSize}`);
                    return { ...t, size: calculatedSize };
                }
            });
            
            console.log('✅ Local tokens array updated. Total tokens:', tokens.length);
            if (tokens.length > 0) {
                console.log('Token details:');
                tokens.forEach((t, i) => {
                    const enemy = enemies.find(e => e.id === t.entity_id);
                    const char = characters.find(c => c.id === t.entity_id);
                    const name = enemy ? enemy.name : (char ? char.name : 'Unknown');
                    console.log(`  ${i + 1}. ${t.entity_type} at (${t.x}, ${t.y}) - entity_id: ${t.entity_id} - name: ${name} - size: ${t.size}`);
                });
            }
            
            // Verify NPC instances still exist after token update
            const npcInstancesAfter = enemies.filter(e => e && e.isNPC && e.npcData);
            if (npcInstancesAfter.length !== npcInstancesBefore.length) {
                console.warn('⚠️ NPC instance count changed! Before:', npcInstancesBefore.length, 'After:', npcInstancesAfter.length);
            }
            
            // Update selectedToken if it still exists in the new tokens array
            // CRITICAL: Preserve the size from selectedToken if it was manually set
            if (selectedToken) {
                const updatedToken = tokens.find(t => t.id === selectedToken.id);
                if (updatedToken) {
                    // Preserve size from selectedToken if it was manually set (non-default)
                    const oldSize = selectedToken.size;
                    if (oldSize && oldSize !== 1.0 && updatedToken.size === 1.0) {
                        console.log(`🔧 Preserving manually set size ${oldSize} for token ${selectedToken.id} (server had: ${updatedToken.size})`);
                        updatedToken.size = oldSize;
                    }
                    // Update selectedToken to point to the updated token in the array
                    selectedToken = updatedToken;
                    updateTokenInfo();
                } else {
                    // Token was removed, clear selection
                    selectedToken = null;
                }
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

            // CRITICAL: Patch participant ids BEFORE sort. Server sends participants in same order as our token_ids.
            // If we sent placeholders (token-0, token-1) or server returned duplicate entity_id, set participant.id = tokens[i].id so each has a unique id and Next Turn cycles every token.
            combatState.participants.forEach((participant, i) => {
                const tokenById = tokens.find(t => t.id === participant.id);
                const tokenByIndex = tokens[i];
                if (tokenById && tokenById.id && participant.id !== tokenById.id) {
                    participant.id = tokenById.id;
                } else if (tokenByIndex && tokenByIndex.id && (!tokens.find(t => t.id === participant.id) || participant.id === 'token-' + i || participant.id === participant.entity_id || String(participant.id).endsWith('-' + i))) {
                    participant.id = tokenByIndex.id;
                    console.log('✅ Patched participant', i, 'to token id:', tokenByIndex.id);
                }
            });

            combatState.currentTurn = null; // No turn set yet
            sortParticipantsByInitiative();

            // Update participant names, HP, AC from local data
            combatState.participants.forEach(participant => {
                
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
            
            updatePlayerTurnControls(); // Show combat action panel for players
            addLogEntry('⚔️ Combat has started! Rolling for initiative...', 'info');
            
            if (isDM) {
                // Show DM controls
                const dmCtrl = document.getElementById('dmCombatControls');
                if (dmCtrl) dmCtrl.classList.remove('hidden');
                console.log('✅ DM combat controls shown');
                
                // Auto-roll for all enemies/NPCs; stagger sends so server processes each (combat v2)
                const toRoll = combatState.participants.filter(p => (p.entity_type || '').toLowerCase() !== 'player');
                console.log('🎲 [Combat v2] Auto-rolling for', toRoll.length, 'enemies/NPCs');
                toRoll.forEach((p, index) => {
                    const run = () => {
                        let bonus = typeof p.initiative_bonus === 'number' ? p.initiative_bonus : 0;
                        if (bonus === 0 || p.initiative_bonus === undefined) {
                            const enemy = enemies.find(e => e.id === p.entity_id);
                            if (enemy && enemy.initiative_bonus !== undefined) {
                                bonus = enemy.initiative_bonus;
                                p.initiative_bonus = bonus;
                            }
                        }
                        const roll = Math.floor(Math.random() * 20) + 1;
                        const total = roll + bonus;
                        p.initiative = total;
                        sendMessage({ type: 'RollInitiative', entity_id: p.entity_id, roll: total, participant_id: p.id });
                    };
                    setTimeout(run, 500 + index * 100);
                });
                setTimeout(() => {
                    updateInitiativeList();
                    updateCombatStatus();
                }, 500 + Math.max(0, toRoll.length) * 100 + 150);
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
                    
                    // Only use character player has already selected via "Select Character" - never auto-assign
                    if (myCharacterId) {
                        myParticipant = playerParticipants.find(p => p.entity_id === myCharacterId);
                        if (!myParticipant) {
                            const myChar = characters.find(c => c.id === myCharacterId);
                            if (myChar) {
                                myParticipant = playerParticipants.find(p => p.name === myChar.name);
                                if (myParticipant) myCharacterId = myParticipant.entity_id;
                            }
                        }
                    }
                    
                    if (myParticipant) {
                        console.log('🎲 PROMPTING FOR:', myParticipant.name);
                        setTimeout(() => promptMyInitiative(), 100);
                    } else if (!myCharacterId) {
                        console.log('⚠️ Player has not selected a character yet - use Select Character button first');
                    } else {
                        console.log('⚠️ No matching participant for selected character');
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
            console.log('Entity ID:', message.entity_id, 'Participant ID:', message.participant_id);
            console.log('Initiative total:', message.initiative);
            console.log('Current participants:', combatState.participants.length);
            
            // Update the participant's initiative; use participant_id when set so the correct row is updated (multiple with same entity_id)
            let participant = message.participant_id
                ? combatState.participants.find(p => p.id === message.participant_id)
                : (combatState.participants.find(p => p.entity_id === message.entity_id) || combatState.participants.find(p => p.id === message.entity_id));
            
            if (participant) {
                participant.initiative = message.initiative;
                console.log('✅ Updated initiative for', participant.name, 'to', message.initiative);
                console.log('   Initiative bonus:', participant.initiative_bonus);
                
                // FIX: Show this roll to ALL players!
                // Calculate what the d20 roll was (total - bonus)
                const bonus = participant.initiative_bonus || 0;
                const rollWithoutBonus = message.initiative - bonus;
                console.log(`   D20 roll was: ${rollWithoutBonus} + ${bonus} = ${message.initiative}`);
                
                // Only add log entry if not already logged (to avoid duplicates from auto-roll) or if not a silent/manual update
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
                } else {
                    addLogEntry(`Initiative updated: ${participant.name} → ${message.initiative}`, 'info');
                }
            } else {
                console.error('⚠️ Participant not found for entity:', message.entity_id);
                console.error('Available participants:', combatState.participants.map(p => `${p.name} (entity_id: ${p.entity_id}, id: ${p.id})`));
            }
            
            sortParticipantsByInitiative();
            console.log('📊 Sorted participants:', combatState.participants.map(p => `${p.name}:${p.initiative ?? 'not rolled'}`));
            
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
            
            // Server sends current_turn = participant.id (unique per token). Match by id so every token gets its turn.
            let turnParticipant = combatState.participants.find(p => p.id === message.current_turn);
            const turnToken = tokens.find(t => t.id === message.current_turn);
            if (!turnToken && message.current_turn) {
                console.warn('⚠️ Turn token not found for ID:', message.current_turn);
            }
            if (turnParticipant) {
                combatState.currentTurn = turnParticipant.id;
                console.log('   ✅ Turn: ', turnParticipant.name, '(id:', turnParticipant.id, ')');
            } else {
                // Fallback: entity_id (single match only) or participant_name
                const byEntity = combatState.participants.find(p => p.entity_id === message.current_turn);
                const byName = message.participant_name && combatState.participants.find(p => p.name === message.participant_name);
                turnParticipant = byEntity || byName;
                if (turnParticipant) {
                    combatState.currentTurn = turnParticipant.id;
                    console.log('   ✅ Turn (fallback):', turnParticipant.name);
                } else {
                    console.error('❌ Turn participant not found for id:', message.current_turn);
                    combatState.currentTurn = message.current_turn;
                }
            }
            console.log('   Final currentTurn:', combatState.currentTurn);
            // Token to highlight: by id, or by placeholder index (token-0 -> tokens[0]) when ids weren't patched
            let finalToken = turnToken || (combatState.currentTurn ? tokens.find(t => t.id === combatState.currentTurn) : null);
            const placeholderMatch = combatState.currentTurn && String(combatState.currentTurn).match(/^(?:token-|.+?-)(\d+)$/);
            if (!finalToken && placeholderMatch) {
                const idx = parseInt(placeholderMatch[1], 10);
                if (tokens[idx]) finalToken = tokens[idx];
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
            combatState.removedFromCombatIds = [];
            combatState.currentTurn = null;
            turnStartPosition = null; // Clear movement range
            updateInitiativeList();
            updateCombatStatus();
            addLogEntry('⚔️ Combat has ended', 'info');
            const dmCombatEl = document.getElementById('dmCombatControls');
            const playerCombatEl = document.getElementById('playerCombatControls');
            if (dmCombatEl) dmCombatEl.classList.add('hidden');
            if (playerCombatEl) playerCombatEl.classList.add('hidden');
            renderCanvas(); // Redraw to clear movement range
            break;
            
        case 'DamageDealt': {
            console.log('💥 ========== DAMAGE DEALT ==========');
            console.log('Target ID:', message.target_id);
            console.log('Damage:', message.damage);
            console.log('New HP:', message.new_hp);
            
            // CRITICAL: Store previous HP BEFORE updating (needed for animation)
            const damagedToken = tokens.find(t => t.id === message.target_id);
            let damagedParticipant = null;
            let oldHp = null;
            let maxHp = null;
            
            if (damagedToken) {
                if (damagedToken.entity_type === 'Player') {
                    const char = characters.find(c => c.id === damagedToken.entity_id);
                    if (char) {
                        // Store previous HP for animation BEFORE updating
                        // CRITICAL: Use current_hp if available, otherwise use max_hp (for first damage)
                        oldHp = char.current_hp !== undefined && char.current_hp !== null ? char.current_hp : char.max_hp;
                        maxHp = char.max_hp;
                        
                        // CRITICAL: Store in previousHpValues BEFORE updating HP (like dealDamage() does)
                        // This ensures updateTokenInfo() can read the old HP value
                        previousHpValues.set(damagedToken.entity_id, { hp: oldHp, maxHp: maxHp });
                        console.log(`💾 Stored previous HP BEFORE update: ${oldHp}/${maxHp} for entity_id ${damagedToken.entity_id}`);
                        
                        console.log('✅ Updating character data:', char.name);
                        console.log('   Old character HP:', oldHp, '(was:', char.current_hp, ')');
                        console.log('   New character HP:', message.new_hp);
                        char.current_hp = message.new_hp;
                        console.log('   ✅ Character HP updated to:', char.current_hp);
                        
                        // CRITICAL: Also update participant HP to keep them in sync
                        damagedParticipant = combatState.participants.find(p => p.id === message.target_id);
                        if (damagedParticipant) {
                            console.log('   ✅ Also updating participant HP to:', message.new_hp);
                            damagedParticipant.current_hp = message.new_hp;
                        }
                        
                        // If this is MY character, just log it (no alert - animations handle the visual feedback)
                        if (char.id === myCharacterId) {
                            console.log('🚨 THIS IS MY CHARACTER! Took damage:', message.damage, 'New HP:', message.new_hp);
                        }
                    } else {
                        console.warn('⚠️ Character not found for token entity_id:', damagedToken.entity_id);
                    }
                } else if (damagedToken.entity_type === 'Enemy') {
                    // Update enemy instance HP
                    const enemy = enemies.find(e => e.id === damagedToken.entity_id);
                    if (enemy) {
                        // Store previous HP for animation BEFORE updating
                        oldHp = enemy.current_hp !== undefined ? enemy.current_hp : (enemy.max_hp || 100);
                        maxHp = enemy.max_hp || 100;
                        // Don't store in previousHpValues here - we'll do it right before updateTokenInfo() (like healing)
                        
                        console.log('✅ Updating enemy data:', enemy.name);
                        console.log('   Old enemy HP:', oldHp);
                        console.log('   New enemy HP:', message.new_hp);
                        // Always update enemy HP (don't check if undefined - set it)
                        enemy.current_hp = message.new_hp;
                        console.log('   ✅ Enemy HP updated to:', enemy.current_hp);
                    } else {
                        console.warn('⚠️ Enemy not found for token entity_id:', damagedToken.entity_id);
                    }
                    
                    // Also update participant HP for enemies
                    damagedParticipant = combatState.participants.find(p => p.id === message.target_id);
                    if (damagedParticipant) {
                        console.log('✅ Updating enemy participant HP:', damagedParticipant.name);
                        damagedParticipant.current_hp = message.new_hp;
                    }
                }
            } else {
                console.warn('⚠️ Token not found for target_id:', message.target_id);
            }
            
            // Force UI update to reflect new HP
            // CRITICAL: Match dealDamage() EXACTLY - it works perfectly out of combat
            // dealDamage() updates HP, then calls updateTokenInfo() directly
            // previousHpValues was already stored BEFORE updating HP (above)
            const isMyCharacter = damagedToken && damagedToken.entity_type === 'Player' && 
                                 damagedToken.entity_id === myCharacterId;
            
            // ALWAYS update UI for any damage - ensure players see their HP update
            // Match dealDamage() order EXACTLY: updateInitiativeList() FIRST, then updateTokenInfo()
            // CRITICAL: For animation to work, the token must be selected so the health bar exists
            // dealDamage() works because the token is already selected when you use the damage input
            // In combat, we need to ensure the token is selected (even temporarily) for the health bar to exist
            const wasTokenSelected = selectedToken && selectedToken.id === message.target_id;
            const previousSelection = selectedToken;
            
            // CRITICAL: Always ensure previousHpValues is set before calling updateTokenInfo()
            // Verify it's set correctly
            if (damagedToken && oldHp !== null && oldHp !== undefined && maxHp !== null && maxHp !== undefined) {
                if (damagedToken.entity_type === 'Player') {
                    const stored = previousHpValues.get(damagedToken.entity_id);
                    if (!stored || stored.hp !== oldHp) {
                        previousHpValues.set(damagedToken.entity_id, { hp: oldHp, maxHp: maxHp });
                        console.log(`💾 Re-stored previous HP: ${oldHp}/${maxHp} for entity_id ${damagedToken.entity_id}`);
                    }
                } else if (damagedToken.entity_type === 'Enemy') {
                    const key = `enemy-${damagedToken.entity_id}`;
                    const stored = previousHpValues.get(key);
                    if (!stored || stored.hp !== oldHp) {
                        previousHpValues.set(key, { hp: oldHp, maxHp: maxHp });
                        console.log(`💾 Re-stored previous HP: ${oldHp}/${maxHp} for enemy ${damagedToken.entity_id}`);
                    }
                }
            }
            
            // CRITICAL: Ensure previousHpValues is set RIGHT BEFORE calling updateTokenInfo()
            // This must happen after we've updated the HP, but before updateTokenInfo() reads it
            if (damagedToken && oldHp !== null && oldHp !== undefined && maxHp !== null && maxHp !== undefined) {
                if (damagedToken.entity_type === 'Player') {
                    // Double-check it's set correctly right before updateTokenInfo()
                    previousHpValues.set(damagedToken.entity_id, { hp: oldHp, maxHp: maxHp });
                    console.log(`💾 Final check - stored previous HP: ${oldHp}/${maxHp} for entity_id ${damagedToken.entity_id}`);
                } else if (damagedToken.entity_type === 'Enemy') {
                    const key = `enemy-${damagedToken.entity_id}`;
                    previousHpValues.set(key, { hp: oldHp, maxHp: maxHp });
                    console.log(`💾 Final check - stored previous HP: ${oldHp}/${maxHp} for enemy ${damagedToken.entity_id}`);
                }
            }
            
            if (!wasTokenSelected && damagedToken) {
                // Token not selected - temporarily select it to create health bar and show animation
                console.log('🎬 Token not selected, temporarily selecting to show damage animation');
                selectedToken = damagedToken;
                updateInitiativeList();
                updateTokenInfo();
                
                // Restore previous selection after animation completes (1.5s + buffer)
                setTimeout(() => {
                    selectedToken = previousSelection;
                    updateTokenInfo();
                }, 1600);
            } else {
                // Token is already selected - just update normally (matches dealDamage() pattern)
                updateInitiativeList();
                updateTokenInfo();
            }
            
            renderCanvas();
            
            // If this is the player's character and they have the character sheet open, refresh it
            if (isMyCharacter && currentViewingCharacter && 
                currentViewingCharacter.id === damagedToken.entity_id) {
                console.log('🔄 Refreshing character sheet for damaged character');
                renderCharacterSheetContent();
            }
            
            // Get target name for log — don't show enemy HP changes to players
            if (damagedToken && damagedToken.entity_type !== 'Enemy') {
                const targetName = damagedParticipant ? damagedParticipant.name : (damagedToken ? 'Target' : 'Unknown');
                addLogEntry(`💥 ${targetName} took ${message.damage} damage! New HP: ${message.new_hp}`, 'damage');
            }
            
            // Play HP damage sound if enabled
            playHpDamageSound();
            
            break;
        }
            
        case 'HealingApplied': {
            console.log('💚 ========== HEALING APPLIED ==========');
            console.log('Target ID:', message.target_id);
            console.log('Healing:', message.healing);
            console.log('New HP:', message.new_hp);
            
            // CRITICAL: Always update character or enemy data FIRST (source of truth)
            // This ensures HP is synced across all clients
            const healedToken = tokens.find(t => t.id === message.target_id);
            let healedParticipant = null; // Declare outside if blocks so it's accessible later
            if (healedToken) {
                if (healedToken.entity_type === 'Player') {
                    const char = characters.find(c => c.id === healedToken.entity_id);
                    if (char) {
                        console.log('✅ Updating character data:', char.name);
                        console.log('   Old character HP:', char.current_hp);
                        console.log('   New character HP:', message.new_hp);
                        char.current_hp = message.new_hp;
                        console.log('   ✅ Character HP updated to:', char.current_hp);
                        
                        // CRITICAL: Also update participant HP to keep them in sync
                        healedParticipant = combatState.participants.find(p => p.id === message.target_id);
                        if (healedParticipant) {
                            console.log('   ✅ Also updating participant HP to:', message.new_hp);
                            healedParticipant.current_hp = message.new_hp;
                        }
                        
                        // If this is MY character, just log it (no alert - animations handle the visual feedback)
                        if (char.id === myCharacterId) {
                            console.log('🚨 THIS IS MY CHARACTER! Was healed:', message.healing, 'New HP:', message.new_hp);
                        }
                    } else {
                        console.warn('⚠️ Character not found for token entity_id:', healedToken.entity_id);
                    }
                } else if (healedToken.entity_type === 'Enemy') {
                    // Update enemy instance HP
                    const enemy = enemies.find(e => e.id === healedToken.entity_id);
                    if (enemy) {
                        console.log('✅ Updating enemy data:', enemy.name);
                        console.log('   Old enemy HP:', enemy.current_hp);
                        console.log('   New enemy HP:', message.new_hp);
                        // Always update enemy HP (don't check if undefined - set it)
                        enemy.current_hp = message.new_hp;
                        console.log('   ✅ Enemy HP updated to:', enemy.current_hp);
                    } else {
                        console.warn('⚠️ Enemy not found for token entity_id:', healedToken.entity_id);
                    }
                    
                    // Also update participant HP for enemies
                    healedParticipant = combatState.participants.find(p => p.id === message.target_id);
                    if (healedParticipant) {
                        console.log('✅ Updating enemy participant HP:', healedParticipant.name);
                        healedParticipant.current_hp = message.new_hp;
                    }
                }
            } else {
                console.warn('⚠️ Token not found for target_id:', message.target_id);
            }
            
            // Force UI update to reflect new HP
            // ALWAYS update UI for any healing - ensure players see their HP update
            updateTokenInfo();
            updateInitiativeList();
            renderCanvas();
            
            // Get participant for logging (healedParticipant already declared above)
            if (!healedParticipant) {
                healedParticipant = combatState.participants.find(p => p.id === message.target_id);
            }
            const isMyCharacterHeal = healedToken && healedToken.entity_type === 'Player' && 
                                     healedToken.entity_id === myCharacterId;
            
            // If this is the player's character and they have the character sheet open, refresh it
            if (isMyCharacterHeal && currentViewingCharacter && 
                currentViewingCharacter.id === healedToken.entity_id) {
                console.log('🔄 Refreshing character sheet for healed character');
                renderCharacterSheetContent();
            }
            
            // Get target name for log — don't show enemy HP changes to players
            if (healedToken && healedToken.entity_type !== 'Enemy') {
                const targetName = healedParticipant ? healedParticipant.name : (healedToken ? 'Target' : 'Unknown');
                addLogEntry(`💚 ${targetName} healed for ${message.healing} HP! New HP: ${message.new_hp}`, 'healing');
            }
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
                
                // Update HP in combat participants if in combat
                if (combatState.active && message.characters) {
                    message.characters.forEach(updatedChar => {
                        const participant = combatState.participants.find(p => p.entity_id === updatedChar.id);
                        if (participant) {
                            participant.current_hp = updatedChar.current_hp;
                            participant.max_hp = updatedChar.max_hp;
                            console.log(`✅ Updated HP for ${participant.name}: ${updatedChar.current_hp}/${updatedChar.max_hp}`);
                        }
                    });
                }
                
                characters = message.characters || [];
                renderCharacterList();
                syncCharactersWithServer();
                
                // Update character sheet if viewing one
                if (currentViewingCharacter) {
                    const updatedChar = characters.find(c => c.id === currentViewingCharacter.id);
                    if (updatedChar) {
                        currentViewingCharacter.current_hp = updatedChar.current_hp;
                        currentViewingCharacter.max_hp = updatedChar.max_hp;
                        renderCharacterSheetContent();
                    }
                }
                
                // Update initiative list if in combat
                if (combatState.active) {
                    updateInitiativeList();
                }
                
                // For players: auto-show character selection at most ONCE per session when characters first load.
                if (!isDM && characters.length > 0 && !hasAutoShownCharacterSelectThisSession) {
                    const modal = document.getElementById('characterManagerModal');
                    if (modal && !modal.classList.contains('active')) {
                        hasAutoShownCharacterSelectThisSession = true;
                        console.log('🎭 Auto-opening character selection - characters loaded (CharacterList)');
                        setTimeout(() => showCharacterManager(), 50);
                    }
                }
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
            
            // Preserve custom enemy instances (spawned from Enemy Database) - same as NPC instances
            const customEnemyInstances = enemies.filter(e => e && e.isCustomInstance === true);
            
            // Merge: server templates + ALL local NPC instances + ALL custom enemy instances
            enemies = [
                ...serverEnemies.filter(e => !npcInstanceMap.has(e.id)), // Server templates that aren't NPC instances
                ...finalNPCInstances, // ALL NPC instances preserved
                ...customEnemyInstances // ALL custom enemy instances (multiple of same type allowed)
            ];
            
            console.log('✅ Merged enemies: ', serverEnemies.length, 'server templates +', finalNPCInstances.length, 'NPC instances +', customEnemyInstances.length, 'custom instances =', enemies.length, 'total');
            console.log('📋 NPC instance IDs preserved:', finalNPCInstances.map(n => `${n.id}:${n.name}${n.npcData ? ' (has data)' : ' (no data)'}`));
            renderEnemyList();
            break;
            
        case 'SoundPlayed':
            console.log('🔊 Sound received:', message.sound_name);
            // Check if this is a critical roll sound or HP damage sound (don't log it as a regular sound)
            const isCriticalSound = message.sound_name === 'Natural 20!' || message.sound_name === 'Natural 1!';
            const isHpDamageSound = message.sound_name === 'HP Damage' || message.sound_id?.startsWith('hpdamage_');
            if (!isCriticalSound && !isHpDamageSound) {
                playSoundFromServer(message.sound_id, message.sound_name, message.sound_data, message.sound_type);
            } else if (isHpDamageSound) {
                // Play HP damage sound (only if enabled)
                // Check localStorage in case variable hasn't been loaded yet
                const enabled = hpDamageSoundEnabled !== undefined ? hpDamageSoundEnabled : (localStorage.getItem('hpDamageSoundEnabled') !== 'false');
                if (enabled) {
                    try {
                        const audio = new Audio(`data:audio/${message.sound_type};base64,${message.sound_data}`);
                        audio.volume = 0.5; // Slightly quieter than critical rolls
                        audio.play().catch(e => {
                            console.warn('⚠️ Could not play HP damage sound:', e);
                        });
                        console.log('🎵 Playing HP damage sound from server');
                    } catch (e) {
                        console.error('❌ Error playing HP damage sound:', e);
                    }
                }
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
            // Prefer server-sent CharacterList if we already have characters (avoids overwriting state from RequestFullState/Connect)
            const fromServer = characters.length > 0;
            if (!fromServer) characters = data || [];
            renderCharacterList();
            syncCharactersWithServer();
            // For players: auto-show character selection at most ONCE per session when characters first load.
            if (!isDM && characters.length > 0 && !hasAutoShownCharacterSelectThisSession) {
                const modal = document.getElementById('characterManagerModal');
                if (modal && !modal.classList.contains('active')) {
                    hasAutoShownCharacterSelectThisSession = true;
                    console.log('🎭 Auto-opening character selection - characters loaded (API)');
                    setTimeout(() => showCharacterManager(), 50);
                }
            }
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
    
    // Right-click context menu - MUST be added for all users
    canvas.addEventListener('contextmenu', onCanvasRightClick);
    console.log('✅ Context menu event listener added to canvas');
    
    // Add double-click handler for ruler tool
    canvas.addEventListener('dblclick', (e) => {
        if (rulerActive) {
            toggleRulerTool(); // Deactivate on double-click
        }
    });
    
    // Close context menu when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (contextMenuVisible && !e.target.closest('#contextMenu')) {
            closeContextMenu();
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
    // CRITICAL: Double-check currentMap is not null and has an image before drawing
    // This prevents drawing a cleared map
    if (currentMap && currentMap.image && currentMap.id) {
        try {
            ctx.drawImage(currentMap.image, 0, 0);
        } catch (e) {
            console.error('Error drawing map image:', e);
            // If image draw fails, clear the map reference
            currentMap.image = null;
        }
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
    
    // Draw active pings
    drawPings();
    
    // Update highlighted tokens (remove expired ones)
    updateHighlightedTokens();
    
    ctx.restore();
}

// Update highlighted tokens and remove expired ones
// Discord Link Functions
function openDiscordLinkModal() {
    console.log('🔗 openDiscordLinkModal called');
    const modal = document.getElementById('discordLinkModal');
    if (!modal) {
        console.error('❌ discordLinkModal not found in DOM!');
        alert('Discord link modal not found. Please refresh the page.');
        return;
    }
    
    const char = currentViewingCharacter;
    if (!char) {
        console.warn('⚠️ No character currently being viewed');
        alert('No character selected. Please open a character sheet first.');
        return;
    }
    
    console.log('✅ Opening Discord link modal for character:', char.name, char.id);
    
    // Load current Discord link from localStorage
    const linkKey = `discord_link_${char.id}`;
    const currentLink = localStorage.getItem(linkKey);
    
    const input = document.getElementById('discordUserIdInput');
    const statusDiv = document.getElementById('discordLinkStatus');
    const currentLinkDiv = document.getElementById('currentDiscordLink');
    const currentIdDisplay = document.getElementById('currentDiscordIdDisplay');
    const removeBtn = document.getElementById('removeDiscordLinkBtn');
    
    // Clear input and status
    if (input) input.value = '';
    if (statusDiv) {
        statusDiv.style.display = 'none';
        statusDiv.textContent = '';
    }
    
    // Show current link if exists
    if (currentLink) {
        if (currentLinkDiv) {
            currentLinkDiv.style.display = 'block';
            if (currentIdDisplay) currentIdDisplay.textContent = currentLink;
        }
        if (removeBtn) removeBtn.style.display = 'inline-block';
        if (input) input.value = currentLink;
    } else {
        if (currentLinkDiv) currentLinkDiv.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'none';
    }
    
    modal.classList.add('active');
}

function saveDiscordLink() {
    const char = currentViewingCharacter;
    if (!char) {
        alert('No character selected');
        return;
    }
    
    const input = document.getElementById('discordUserIdInput');
    const statusDiv = document.getElementById('discordLinkStatus');
    
    if (!input || !statusDiv) return;
    
    const discordUserId = input.value.trim();
    
    // Validate Discord User ID (should be numeric, 17-19 digits)
    if (!discordUserId) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'rgba(255, 68, 68, 0.1)';
        statusDiv.style.borderLeft = '4px solid #ff4444';
        statusDiv.style.color = '#ff4444';
        statusDiv.innerHTML = '<strong>❌ Error:</strong> Please enter your Discord User ID';
        return;
    }
    
    if (!/^\d{17,19}$/.test(discordUserId)) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'rgba(255, 68, 68, 0.1)';
        statusDiv.style.borderLeft = '4px solid #ff4444';
        statusDiv.style.color = '#ff4444';
        statusDiv.innerHTML = '<strong>❌ Invalid format:</strong> Discord User ID should be a 17-19 digit number';
        return;
    }
    
    // Save to localStorage
    const linkKey = `discord_link_${char.id}`;
    localStorage.setItem(linkKey, discordUserId);
    
    // Also save in a central map for easy lookup
    let discordLinks = {};
    try {
        const stored = localStorage.getItem('discord_links_map');
        if (stored) discordLinks = JSON.parse(stored);
    } catch (e) {
        console.error('Error loading discord links map:', e);
    }
    
    discordLinks[discordUserId] = char.id;
    localStorage.setItem('discord_links_map', JSON.stringify(discordLinks));
    
    // Send link to server so Discord bot can use it
    if (ws && ws.readyState === WebSocket.OPEN) {
        const linkMessage = {
            type: 'LinkDiscordAccount',
            character_id: char.id,
            discord_user_id: discordUserId,
            character_name: char.name
        };
        sendMessage(linkMessage);
        console.log('📤 Sent Discord link to server for bot sync:', linkMessage);
        console.log('   💡 Check game server console for confirmation that file was saved');
    } else {
        console.error('❌ WebSocket not connected! Cannot send link to server.');
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'rgba(255, 68, 68, 0.1)';
        statusDiv.style.borderLeft = '4px solid #ff4444';
        statusDiv.style.color = '#ff4444';
        statusDiv.innerHTML = '<strong>⚠️ Warning:</strong> WebSocket not connected. Link saved locally but not synced to server. Please refresh the page and try again.';
        return;
    }
    
    // Show success message
    statusDiv.style.display = 'block';
    statusDiv.style.background = 'rgba(68, 255, 68, 0.1)';
    statusDiv.style.borderLeft = '4px solid #44ff44';
    statusDiv.style.color = '#44ff44';
    statusDiv.innerHTML = '<strong>✅ Success!</strong> Discord account linked. Your token will highlight when you speak in Discord voice channels.';
    
    // Update UI
    const currentLinkDiv = document.getElementById('currentDiscordLink');
    const currentIdDisplay = document.getElementById('currentDiscordIdDisplay');
    const removeBtn = document.getElementById('removeDiscordLinkBtn');
    
    if (currentLinkDiv) {
        currentLinkDiv.style.display = 'block';
        if (currentIdDisplay) currentIdDisplay.textContent = discordUserId;
    }
    if (removeBtn) removeBtn.style.display = 'inline-block';
    
    console.log(`🔗 Linked Discord User ID ${discordUserId} to character ${char.id} (${char.name})`);
}

function removeDiscordLink() {
    const char = currentViewingCharacter;
    if (!char) {
        alert('No character selected');
        return;
    }
    
    const linkKey = `discord_link_${char.id}`;
    const discordUserId = localStorage.getItem(linkKey);
    
    if (discordUserId) {
        // Remove from character-specific storage
        localStorage.removeItem(linkKey);
        
        // Remove from central map
        try {
            const stored = localStorage.getItem('discord_links_map');
            if (stored) {
                const discordLinks = JSON.parse(stored);
                delete discordLinks[discordUserId];
                localStorage.setItem('discord_links_map', JSON.stringify(discordLinks));
            }
        } catch (e) {
            console.error('Error updating discord links map:', e);
        }
        
        console.log(`🔓 Removed Discord link for character ${char.id} (${char.name})`);
    }
    
    // Update UI
    const input = document.getElementById('discordUserIdInput');
    const statusDiv = document.getElementById('discordLinkStatus');
    const currentLinkDiv = document.getElementById('currentDiscordLink');
    const removeBtn = document.getElementById('removeDiscordLinkBtn');
    
    if (input) input.value = '';
    if (statusDiv) {
        statusDiv.style.display = 'none';
        statusDiv.textContent = '';
    }
    if (currentLinkDiv) currentLinkDiv.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'none';
}

// Get character ID from Discord User ID (helper for Discord bot integration)
function getCharacterIdFromDiscordUserId(discordUserId) {
    try {
        const stored = localStorage.getItem('discord_links_map');
        if (stored) {
            const discordLinks = JSON.parse(stored);
            return discordLinks[discordUserId] || null;
        }
    } catch (e) {
        console.error('Error loading discord links map:', e);
    }
    return null;
}

function updateHighlightedTokens() {
    const now = Date.now();
    for (const [tokenId, highlight] of highlightedTokens.entries()) {
        const age = now - highlight.timestamp;
        if (age > highlight.duration) {
            highlightedTokens.delete(tokenId);
        }
    }
}

// Highlight a character token (called when Discord user speaks)
function highlightCharacterToken(characterId, discordUsername, duration = 3000) {
    console.log(`🎯 highlightCharacterToken called: characterId=${characterId}, username=${discordUsername}, duration=${duration}`);
    console.log(`📊 Total tokens: ${tokens.length}`);
    
    // Find all tokens with this character_id
    const matchingTokens = tokens.filter(token => {
        const matches = token.entity_id === characterId;
        console.log(`  Token ${token.id}: entity_id=${token.entity_id}, matches=${matches}`);
        return matches;
    });
    
    if (matchingTokens.length === 0) {
        console.warn(`⚠️ No tokens found for character_id: ${characterId}`);
        console.warn(`   Available entity_ids:`, tokens.map(t => t.entity_id));
        console.warn(`   Make sure your character token is placed on the map!`);
        return;
    }
    
    console.log(`✅ Found ${matchingTokens.length} matching token(s)`);
    matchingTokens.forEach(token => {
        const highlightData = {
            timestamp: Date.now(),
            duration: duration,
            color: '#8a2be2', // Purple
            discordUsername: discordUsername
        };
        highlightedTokens.set(token.id, highlightData);
        console.log(`  → Added highlight to token ${token.id}:`, highlightData);
    });
    
    console.log(`📝 Total highlighted tokens now: ${highlightedTokens.size}`);
    
    // Start continuous rendering while highlight is active
    renderCanvas();
    
    // Set up animation loop for pulsing effect
    const highlightStart = Date.now();
    const animateHighlight = () => {
        const elapsed = Date.now() - highlightStart;
        if (elapsed < duration) {
            renderCanvas();
            requestAnimationFrame(animateHighlight);
        } else {
            console.log(`⏱️ Highlight animation finished after ${elapsed}ms`);
        }
    };
    requestAnimationFrame(animateHighlight);
    
    console.log(`✨ Highlighted ${matchingTokens.length} token(s) for character: ${characterId} (${discordUsername})`);
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
    // Calculate token dimensions based on size - always use circles
    // size = 1.0: Medium (1x1 square, circle radius = gridSize/2)
    // size = 2.0: Large (2x2 = 4 squares, circle radius = gridSize)
    // size = 4.0: Huge (4x4 = 16 squares, circle radius = gridSize*2)
    // size = 8.0: Gargantuan (8x8 = 64 squares, circle radius = gridSize*4)
    
    // CRITICAL: Preserve existing size - only calculate if truly missing
    // Don't recalculate if size already exists (even if it's 1.0)
    let tokenSize = token.size;
    const hasValidSize = tokenSize !== undefined && 
                        tokenSize !== null && 
                        !isNaN(tokenSize) && 
                        typeof tokenSize === 'number';
    
    if (!hasValidSize) {
        // Only calculate if size is truly missing
        tokenSize = getTokenSize(token.entity_id, token.entity_type);
        // Update the token object so it persists
        token.size = tokenSize;
        console.log(`🔧 Token ${token.entity_id} missing size in drawToken, calculated: ${tokenSize}`);
    } else {
        // Preserve existing size - ensure it's a number
        tokenSize = parseFloat(tokenSize);
        if (isNaN(tokenSize)) {
            tokenSize = 1.0;
        }
    }
    
    // Calculate circle radius based on size
    // radius = gridSize * tokenSize / 2
    // This ensures the circle covers the appropriate area:
    // - Medium (1.0): radius = gridSize/2 (covers 1x1)
    // - Large (2.0): radius = gridSize (covers 2x2)
    // - Huge (4.0): radius = gridSize*2 (covers 4x4)
    // - Gargantuan (8.0): radius = gridSize*4 (covers 8x8)
    const radius = gridSize * tokenSize / 2;
    const diameter = radius * 2;
    
    // Position token - center on the grid square they're placed on
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
        // Portrait: prefer server-provided token.image_url so players see it without needing enemy list
        const portraitSrc = token.image_url || (() => {
            const enemyByTemplate = enemies.find(e => e.id === token.entity_id);
            return enemyByTemplate && (enemyByTemplate.portrait_url || enemyByTemplate.local_portrait);
        })();
        if (portraitSrc) {
            hasPortrait = true;
            borderColor = '#ff4444'; // Red for enemies
            const cacheKey = 'enemy-' + (token.id || token.entity_id);
            if (!tokenImages[cacheKey]) {
                tokenImages[cacheKey] = new Image();
                tokenImages[cacheKey].src = portraitSrc;
                tokenImages[cacheKey].onload = () => renderCanvas();
            }
            portraitImg = tokenImages[cacheKey];
        }
    }
    
    if (hasPortrait && portraitImg && portraitImg.complete) {
        // Draw portrait image - always as circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        
        // Draw image to fill circle
        ctx.drawImage(portraitImg, x - radius, y - radius, diameter, diameter);
        
        ctx.restore();
        
        // Border based on type
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 3;
        ctx.stroke();
    } else {
        // Fallback: colored shape (no portrait available or not loaded yet) - always as circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        
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
    
    // Discord highlight (speaking indicator) - draw before selection highlight
    const highlight = highlightedTokens.get(token.id);
    if (highlight) {
        const now = Date.now();
        const age = now - highlight.timestamp;
        const fade = 1.0 - Math.min(age / highlight.duration, 1.0);
        
        if (fade > 0) {
            // Draw pulsing glow effect - always circular
            const pulseRadius = radius + 15 + (Math.sin(age / 100) * 5); // Pulsing effect
            const gradient = ctx.createRadialGradient(x, y, radius, x, y, pulseRadius);
            gradient.addColorStop(0, `rgba(138, 43, 226, ${0.8 * fade})`); // Purple glow
            gradient.addColorStop(0.5, `rgba(138, 43, 226, ${0.4 * fade})`);
            gradient.addColorStop(1, `rgba(138, 43, 226, 0)`);
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw purple border - always circular
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(138, 43, 226, ${fade})`;
            ctx.lineWidth = 4;
            ctx.stroke();
            
            // Draw "Speaking" label
            if (fade > 0.5 && highlight.discordUsername) {
                ctx.fillStyle = `rgba(0, 0, 0, ${0.8 * fade})`;
                const labelY = y - radius - 25;
                ctx.fillRect(x - 50, labelY, 100, 20);
                ctx.fillStyle = `rgba(138, 43, 226, ${fade})`;
                ctx.font = 'bold 11px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(`🔊 ${highlight.discordUsername}`, x, labelY + 15);
            }
        } else {
            // Remove expired highlight (will be cleaned up in renderCanvas)
            highlightedTokens.delete(token.id);
        }
    }
    
    // Selection highlight (yellow, above Discord highlight) - always circular
    if (selectedToken && selectedToken.id === token.id) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
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
    
    let displayName = token.display_name || 'Unknown';
    if (token.entity_type === 'Player') {
        const char = characters.find(c => c.id === token.entity_id);
        displayName = char ? char.name : 'Player';
    } else if (token.entity_type === 'Enemy') {
        // Prefer server-provided display_name so players always see names without needing enemy list
        const participantById = combatState.participants.find(p => p.id === token.id);
        const participantByEntity = combatState.participants.find(p => p.entity_id === token.entity_id);
        const enemy = enemies.find(e => e.id === token.entity_id);
        const npcInstance = enemies.find(e => e.id === token.entity_id && (e.isNPC || e.npcData));
        if (token.display_name) {
            displayName = token.display_name;
        } else if (participantById && participantById.name) {
            displayName = participantById.name;
        } else if (participantByEntity && participantByEntity.name) {
            displayName = participantByEntity.name;
        } else if (npcInstance && npcInstance.name) {
            displayName = npcInstance.name;
        } else if (enemy && enemy.name) {
            displayName = enemy.name;
        } else {
            displayName = 'Enemy';
        }
    } else {
        displayName = token.entity_type;
    }
    
    ctx.fillText(displayName, x, y + radius + 18);
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
    
    // Check if clicking on a token - always use circular bounds
    let clickedToken = null;
    for (let token of tokens) {
        const tokenSize = token.size || 1.0;
        // Calculate circle radius based on size (same as drawToken)
        const radius = gridSize * tokenSize / 2;
        
        // Token center position
        const tokenX = token.x * gridSize + gridSize / 2;
        const tokenY = token.y * gridSize + gridSize / 2;
        
        // Check if click is within circular bounds
        const dist = Math.sqrt(Math.pow(mouseX - tokenX, 2) + Math.pow(mouseY - tokenY, 2));
        const clicked = dist <= radius;
        
        if (clicked) {
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

// Right-click context menu handler
function onCanvasRightClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Don't show context menu if measurement tools are active
    if (measurementToolType) {
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - panX) / zoom;
    const mouseY = (e.clientY - rect.top - panY) / zoom;
    
    // Store the canvas coordinates for ping
    contextMenuPosition = { x: mouseX, y: mouseY };
    
    // Show context menu at mouse position
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) {
        contextMenu.style.display = 'block';
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        contextMenuVisible = true;
        console.log('📍 Context menu opened at:', mouseX, mouseY);
    } else {
        console.warn('⚠️ Context menu element not found!');
    }
}

function closeContextMenu() {
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.style.display = 'none';
    contextMenuVisible = false;
}

// Ping at the context menu location
function pingAtContextMenuLocation() {
    if (!contextMenuPosition) return;
    
    const pingId = 'ping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const ping = {
        id: pingId,
        x: contextMenuPosition.x,
        y: contextMenuPosition.y,
        timestamp: Date.now(),
        playerName: myPlayerName || 'Unknown'
    };
    
    // Add ping locally
    activePings.push(ping);
    
    // Broadcast to all players
    sendMessage({
        type: 'PingLocation',
        x: ping.x,
        y: ping.y,
        player_name: ping.playerName
    });
    
    addLogEntry(`📍 Pinged location`, 'info');
    closeContextMenu();
    renderCanvas();
    
    // Remove ping after 3 seconds
    setTimeout(() => {
        activePings = activePings.filter(p => p.id !== pingId);
        renderCanvas();
    }, 3000);
}

// Draw all active pings
function drawPings() {
    const now = Date.now();
    const pingDuration = 3000; // 3 seconds
    
    activePings.forEach(ping => {
        const age = now - ping.timestamp;
        if (age > pingDuration) return; // Skip expired pings
        
        // Calculate fade (starts at 1.0, fades to 0.0 over 3 seconds)
        const fade = 1.0 - (age / pingDuration);
        
        // Draw expanding circle animation
        const baseRadius = 20;
        const maxRadius = 60;
        const expansionProgress = Math.min(age / 1000, 1.0); // Expand over 1 second
        const currentRadius = baseRadius + (maxRadius - baseRadius) * expansionProgress;
        
        // Draw outer glow
        const gradient = ctx.createRadialGradient(ping.x, ping.y, 0, ping.x, ping.y, currentRadius);
        gradient.addColorStop(0, `rgba(74,158,255,${0.6 * fade})`);
        gradient.addColorStop(0.5, `rgba(74,158,255,${0.3 * fade})`);
        gradient.addColorStop(1, `rgba(74,158,255,0)`);
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(ping.x, ping.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw center dot
        ctx.fillStyle = `rgba(74,158,255,${fade})`;
        ctx.beginPath();
        ctx.arc(ping.x, ping.y, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw player name label
        if (fade > 0.5) {
            ctx.fillStyle = `rgba(0, 0, 0, ${0.8 * fade})`;
            ctx.fillRect(ping.x - 40, ping.y - 35, 80, 20);
            ctx.fillStyle = `rgba(74,158,255,${fade})`;
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(ping.playerName, ping.x, ping.y - 20);
        }
    });
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
    
    // PERMISSION CHECK: Players can only see full details of their own token
    // DM can see everything
    const isOwnToken = selectedToken.entity_type === 'Player' && selectedToken.entity_id === myCharacterId;
    const canViewFullDetails = isDM || isOwnToken || selectedToken.entity_type === 'Enemy';
    
    // FIX: Find character or enemy data and get current HP from combat if active
    if (selectedToken.entity_type === 'Player') {
        entityData = characters.find(c => c.id === selectedToken.entity_id);
        if (entityData) {
            // CRITICAL: Character HP is the source of truth (updated by server on damage/healing)
            // Only use participant HP as fallback if character data is missing
            // This ensures players always see the correct HP after damage/healing
            const participant = combatState.participants.find(p => p.id === selectedToken.id);
            // Prioritize character.current_hp - it's updated by server broadcasts
            const currentHp = entityData.current_hp !== undefined && entityData.current_hp !== null ? 
                             entityData.current_hp : 
                             (participant ? participant.current_hp : entityData.max_hp);
            const maxHp = entityData.max_hp !== undefined && entityData.max_hp !== null ? 
                         entityData.max_hp : 
                         (participant ? participant.max_hp : entityData.max_hp);
            
            if (canViewFullDetails) {
                // DM or own token: Show full details with editable HP (persists even outside combat)
                const escapedEntityId = escapeJs(selectedToken.entity_id);
                info += `<h4>⚔️ ${entityData.name}</h4>`;
                info += `<p style="font-size: 11px; opacity: 0.8; margin: 4px 0 12px 0;">${entityData.class} Level ${entityData.level}</p>`;
                info += `<div class="token-stat"><span>Player:</span><span>${entityData.player_name}</span></div>`;
                info += `<div class="token-stat"><span>HP:</span><input type="number" min="0" max="${maxHp}" value="${currentHp}" style="width: 50px; padding: 2px 6px; background: #2a2a2a; color: ${currentHp < maxHp * 0.3 ? '#ff4444' : '#44ff44'}; border: 1px solid #444; border-radius: 3px; font-weight: bold;" onchange="persistTokenCharacterHP('${escapedEntityId}', this.value)" onblur="persistTokenCharacterHP('${escapedEntityId}', this.value)"/> / <span>${maxHp}</span></div>`;
                const hpPercent = (currentHp / maxHp) * 100;
                const hpBarId = `hp-bar-${selectedToken.entity_id}`;
                const previousHp = previousHpValues.get(selectedToken.entity_id);
                const startPercent = previousHp ? (previousHp.hp / previousHp.maxHp) * 100 : hpPercent;
                
                // CRITICAL: If startPercent equals hpPercent, there's no animation!
                // This means previousHpValues wasn't set correctly
                if (startPercent === hpPercent && previousHp) {
                    console.warn(`⚠️ startPercent equals hpPercent! Previous HP: ${previousHp.hp}, Current HP: ${currentHp}, Max HP: ${maxHp}`);
                } else if (!previousHp) {
                    console.warn(`⚠️ No previousHp found for entity_id ${selectedToken.entity_id}! Available keys:`, Array.from(previousHpValues.keys()));
                }
                
                console.log(`🎬 Health bar: ${previousHp ? `${previousHp.hp}/${previousHp.maxHp}` : 'no previous'} -> ${currentHp}/${maxHp} (${startPercent.toFixed(1)}% -> ${hpPercent.toFixed(1)}%)`);
                
                // CRITICAL: Only animate if startPercent is different from hpPercent
                if (Math.abs(startPercent - hpPercent) > 0.1) {
                    // CRITICAL: Ensure transition is applied by setting it explicitly in the style
                    info += `<div class="hp-bar" id="${hpBarId}"><div class="hp-fill" style="width: ${startPercent}%; transition: width 1.5s ease-out !important;"></div></div>`;
                    // Animate to new value after a tiny delay to ensure DOM is ready
                    setTimeout(() => {
                        const fillElement = document.querySelector(`#${hpBarId} .hp-fill`);
                        if (fillElement) {
                            // Force reflow to ensure initial width is applied before animating
                            void fillElement.offsetHeight;
                            // Explicitly set transition again to ensure it's applied
                            fillElement.style.transition = 'width 1.5s ease-out';
                            // Now set the new width - CSS transition will animate it smoothly
                            fillElement.style.width = `${hpPercent}%`;
                            console.log(`✅ Started health bar animation from ${startPercent.toFixed(1)}% to ${hpPercent.toFixed(1)}% (1.5s transition)`);
                        } else {
                            console.warn(`⚠️ Health bar fill element not found: #${hpBarId} .hp-fill`);
                        }
                    }, 10);
                } else {
                    // No animation needed - values are the same (or very close)
                    console.log(`⚠️ Skipping animation - startPercent (${startPercent.toFixed(1)}%) equals hpPercent (${hpPercent.toFixed(1)}%)`);
                    info += `<div class="hp-bar" id="${hpBarId}"><div class="hp-fill" style="width: ${hpPercent}%;"></div></div>`;
                }
                // Store current HP for next update (delay to ensure animation uses old value)
                // CRITICAL: Delay this to AFTER the animation completes (1.5s + buffer)
                setTimeout(() => {
                    previousHpValues.set(selectedToken.entity_id, { hp: currentHp, maxHp: maxHp });
                }, 1600);
                info += `<div class="token-stat"><span>AC:</span><span>${entityData.armor_class}</span></div>`;
                info += `<div class="token-stat"><span>Initiative:</span><span>+${entityData.initiative_bonus}</span></div>`;
                info += `<div class="token-stat"><span>Speed:</span><span>${entityData.speed} ft</span></div>`;
            } else {
                // Another player's token: Show minimal info only (no HP, AC, stats)
                info += `<h4>⚔️ ${entityData.name}</h4>`;
                info += `<p style="font-size: 11px; opacity: 0.8; margin: 4px 0 12px 0;">${entityData.class} Level ${entityData.level}</p>`;
                info += `<div class="token-stat"><span>Player:</span><span>${entityData.player_name}</span></div>`;
                info += `<p style="font-size: 11px; color: #888; margin-top: 12px; font-style: italic;">(You can only view full details of your own character)</p>`;
                // Don't show ability scores or other stats for other players' tokens
            }
            
            // Only show ability scores for own token or DM
            if (canViewFullDetails) {
                info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
                info += `<div class="token-stat"><span>STR:</span><span>${entityData.strength}</span></div>`;
                info += `<div class="token-stat"><span>DEX:</span><span>${entityData.dexterity}</span></div>`;
                info += `<div class="token-stat"><span>CON:</span><span>${entityData.constitution}</span></div>`;
                info += `<div class="token-stat"><span>INT:</span><span>${entityData.intelligence}</span></div>`;
                info += `<div class="token-stat"><span>WIS:</span><span>${entityData.wisdom}</span></div>`;
                info += `<div class="token-stat"><span>CHA:</span><span>${entityData.charisma}</span></div>`;
            }
        }
    } else if (selectedToken.entity_type === 'Enemy') {
        const enemy = enemies.find(e => e.id === selectedToken.entity_id);
        const instance = combatState.participants.find(p => p.id === selectedToken.id);
        
        if (enemy || instance) {
            const displayName = instance ? instance.name : (enemy ? enemy.name : 'Unknown');
            // CRITICAL: Use enemy.current_hp as fallback, not enemy.max_hp
            // Prioritize instance HP (from combat), then enemy.current_hp, then enemy.max_hp
            const currentHp = instance ? instance.current_hp : 
                             (enemy && enemy.current_hp !== undefined && enemy.current_hp !== null ? enemy.current_hp : 
                             (enemy ? enemy.max_hp : 0));
            const maxHp = instance ? instance.max_hp : (enemy ? enemy.max_hp : 0);
            const ac = instance ? instance.armor_class : (enemy ? enemy.armor_class : 0);
            
            info += `<h4>👹 ${displayName}</h4>`;
            if (enemy) {
                info += `<p style="font-size: 11px; opacity: 0.8; margin: 4px 0 12px 0;">${enemy.creature_type} (CR ${enemy.challenge_rating})</p>`;
            }
            info += `<div class="token-stat"><span>HP:</span><span style="color: ${currentHp < maxHp * 0.3 ? '#ff4444' : '#ff8844'}; font-weight: bold;">${currentHp}/${maxHp}</span></div>`;
            const hpPercent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;
            const hpBarId = `hp-bar-enemy-${selectedToken.entity_id}`;
            const previousHp = previousHpValues.get(`enemy-${selectedToken.entity_id}`);
            const startPercent = previousHp ? (previousHp.hp / previousHp.maxHp) * 100 : hpPercent;
            
            // CRITICAL: Only animate if startPercent is different from hpPercent
            if (Math.abs(startPercent - hpPercent) > 0.1) {
                // CRITICAL: Ensure transition is applied by setting it explicitly in the style
                info += `<div class="hp-bar" id="${hpBarId}"><div class="hp-fill" style="width: ${startPercent}%; transition: width 1.5s ease-out !important;"></div></div>`;
                // Animate to new value after a tiny delay to ensure DOM is ready
                setTimeout(() => {
                    const fillElement = document.querySelector(`#${hpBarId} .hp-fill`);
                    if (fillElement) {
                        // Force reflow to ensure initial width is applied before animating
                        void fillElement.offsetHeight;
                        // Explicitly set transition again to ensure it's applied
                        fillElement.style.transition = 'width 1.5s ease-out';
                        // Now set the new width - CSS transition will animate it smoothly
                        fillElement.style.width = `${hpPercent}%`;
                        console.log(`✅ Started enemy health bar animation from ${startPercent.toFixed(1)}% to ${hpPercent.toFixed(1)}% (1.5s transition)`);
                    } else {
                        console.warn(`⚠️ Enemy health bar fill element not found: #${hpBarId} .hp-fill`);
                    }
                }, 10);
            } else {
                // No animation needed - values are the same (or very close)
                info += `<div class="hp-bar" id="${hpBarId}"><div class="hp-fill" style="width: ${hpPercent}%;"></div></div>`;
            }
            // Store current HP for next update (delay to ensure animation uses old value)
            // CRITICAL: Delay this to AFTER the animation completes (1.5s + buffer)
            setTimeout(() => {
                previousHpValues.set(`enemy-${selectedToken.entity_id}`, { hp: currentHp, maxHp: maxHp });
            }, 1600);
            info += `<div class="token-stat"><span>AC:</span><span>${ac}</span></div>`;
            
            if (enemy) {
                info += `<div class="token-stat"><span>Initiative:</span><span>+${enemy.initiative_bonus}</span></div>`;
                info += `<div class="token-stat"><span>Speed:</span><span>${enemy.speed} ft</span></div>`;
                
                // Only show detailed ability scores for DM
                // Players can see basic enemy info (HP, AC, Initiative, Speed) but not full stats
                if (isDM) {
                    info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
                    info += `<div class="token-stat"><span>STR:</span><span>${enemy.strength}</span></div>`;
                    info += `<div class="token-stat"><span>DEX:</span><span>${enemy.dexterity}</span></div>`;
                    info += `<div class="token-stat"><span>CON:</span><span>${enemy.constitution}</span></div>`;
                    info += `<div class="token-stat"><span>INT:</span><span>${enemy.intelligence}</span></div>`;
                    info += `<div class="token-stat"><span>WIS:</span><span>${enemy.wisdom}</span></div>`;
                    info += `<div class="token-stat"><span>CHA:</span><span>${enemy.charisma}</span></div>`;
                }
                
                if (enemy.description) {
                    info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
                    // Show full description for DM, truncated for players
                    if (isDM) {
                        info += `<p style="font-size: 11px; margin-top: 8px;">${enemy.description.substring(0, 200)}${enemy.description.length > 200 ? '...' : ''}</p>`;
                    } else {
                        info += `<p style="font-size: 11px; margin-top: 8px; color: #888;">${enemy.description.substring(0, 100)}${enemy.description.length > 100 ? '...' : ''}</p>`;
                    }
                }
                
                // Add button to view full character sheet (NPC or custom enemy, DM only)
                if (isDM) {
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
    
    // Add token size selector (DM only)
    if (isDM) {
        const currentSize = selectedToken.size || 1.0;
        const sizeLabel = currentSize <= 1.0 ? 'Medium (1x1)' : 
                         currentSize <= 2.0 ? 'Large (2x2)' : 
                         currentSize <= 4.0 ? 'Huge (4x4)' : 
                         'Gargantuan (8x8)';
        info += `<hr style="margin: 10px 0; border: 1px solid rgba(255,255,255,0.2);">`;
        info += `<div class="token-stat"><span>Token Size:</span><span>${sizeLabel}</span></div>`;
        info += `<div style="margin-top: 10px;">`;
        info += `<label style="display: block; font-size: 11px; margin-bottom: 5px; color: #aaa;">Change Size:</label>`;
        info += `<select id="tokenSizeSelect" onchange="changeTokenSize('${selectedToken.id}', this.value)" style="width: 100%; padding: 5px; background: #2a2a2a; color: white; border: 1px solid #444; border-radius: 3px; font-size: 12px;">`;
        info += `<option value="1.0" ${currentSize <= 1.0 ? 'selected' : ''}>Medium (1x1 square)</option>`;
        info += `<option value="2.0" ${currentSize > 1.0 && currentSize <= 2.0 ? 'selected' : ''}>Large (2x2 = 4 squares)</option>`;
        info += `<option value="4.0" ${currentSize > 2.0 && currentSize <= 4.0 ? 'selected' : ''}>Huge (4x4 = 16 squares)</option>`;
        info += `<option value="8.0" ${currentSize > 4.0 ? 'selected' : ''}>Gargantuan (8x8 = 64 squares)</option>`;
        info += `</select>`;
        info += `</div>`;
    }
    
    infoDiv.innerHTML = info;
    
    // Show damage/heal buttons for DM (any token) or players (own token only)
    const canModifyToken = isDM || (selectedToken && selectedToken.entity_type === 'Player' && selectedToken.entity_id === myCharacterId);
    if (canModifyToken && selectedToken) {
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
            console.log('Sending EndCombat (from Toggle Combat)');
            sendMessage({ type: 'EndCombat' });
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                console.warn('WebSocket not open — EndCombat may not have been sent');
            }
        }
    } else {
        const tokenList = Array.isArray(tokens) ? tokens.slice() : [];
        if (tokenList.length === 0) {
            console.warn('⚠️ No tokens detected locally when starting combat. Attempting to start anyway.');
            addLogEntry('⚠️ No tokens detected locally — requesting combat start anyway.', 'warning');
            requestTokenRefresh();
        }
        // Combat v2: one participant per token. Use unique id per token so multiple enemies get separate turns.
        // Prefer t.id (server UUID); never use entity_id for multiple tokens or we get duplicate ids and one turn.
        const tokenIds = tokenList.map((t, i) => (t && t.id) ? t.id : ('token-' + i));
        console.log('[Combat v2] Starting combat with', tokenIds.length, 'tokens. IDs:', tokenIds.slice(0, 20).join(', ') + (tokenIds.length > 20 ? '...' : ''));
        tokenList.forEach((t, i) => {
            if (t) console.log(`  Token ${i + 1}: id=${t.id} entity_id=${t.entity_id} type=${t.entity_type}`);
        });
        combatState.removedFromCombatIds = []; // new combat — allow all tokens to be in tracker
        sendMessage({ type: 'StartCombat', token_ids: tokenIds });
        console.log('🎯 Combat toggle sent (token_ids count:', tokenIds.length, '). Waiting for CombatStarted...');
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
    const resultEl = document.getElementById('initiativeRollResult');
    if (resultEl) resultEl.textContent = '';
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
    const resultEl = document.getElementById('initiativeRollResult');
    if (!inputEl) return;
    if (resultEl) resultEl.textContent = '';
    const roll = Math.floor(Math.random() * 20) + 1;
    inputEl.value = roll;
    updateInitiativeTotalPreview();
}

function rollInitiativeAdvantage() {
    const inputEl = document.getElementById('initiativeRollInput');
    const resultEl = document.getElementById('initiativeRollResult');
    if (!inputEl || !resultEl) return;
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const used = Math.max(a, b);
    inputEl.value = used;
    resultEl.textContent = `Rolled ${a} and ${b} → using ${used} (advantage)`;
    resultEl.style.color = '#44ff44';
    updateInitiativeTotalPreview();
}

function rollInitiativeDisadvantage() {
    const inputEl = document.getElementById('initiativeRollInput');
    const resultEl = document.getElementById('initiativeRollResult');
    if (!inputEl || !resultEl) return;
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const used = Math.min(a, b);
    inputEl.value = used;
    resultEl.textContent = `Rolled ${a} and ${b} → using ${used} (disadvantage)`;
    resultEl.style.color = '#ff8844';
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
        roll: total,
        participant_id: participant.id
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

    sortParticipantsByInitiative();
    const sorted = combatState.participants;

    console.log('🔧 Manual turn advance - Current turn:', combatState.currentTurn);
    console.log('🔧 Sorted participants:', sorted.map((p, i) => `${i}: ${p.name} (init: ${p.initiative}, id: ${p.id})`));

    // Find current turn index - try multiple matching strategies
    let currentIndex = -1;
    if (combatState.currentTurn) {
        currentIndex = sorted.findIndex(p => p.id === combatState.currentTurn);
        if (currentIndex === -1) {
            currentIndex = sorted.findIndex(p => p.entity_id === combatState.currentTurn);
        }
        if (currentIndex === -1) {
            const currentToken = tokens.find(t => t.id === combatState.currentTurn);
            if (currentToken) {
                currentIndex = sorted.findIndex(p => p.entity_id === currentToken.entity_id);
            }
        }
    }

    if (currentIndex === -1) {
        currentIndex = -1; // Will become 0 after increment
    }

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

/** DM only: remove a participant from combat immediately (e.g. when they die). Updates initiative order for everyone. */
function removeFromCombat(participantId) {
    if (!isDM) return;
    if (!combatState.active || !combatState.participants.length) return;
    const participant = combatState.participants.find(p => p.id === participantId);
    if (!participant) return;
    // Remove from local state immediately so the tracker row (name, HP, X button) disappears right away
    combatState.participants = combatState.participants.filter(p => p.id !== participantId);
    if (!Array.isArray(combatState.removedFromCombatIds)) combatState.removedFromCombatIds = [];
    combatState.removedFromCombatIds.push(participantId);
    if (combatState.participants.length === 0) {
        combatState.active = false;
        combatState.currentTurn = null;
    } else if (combatState.currentTurn === participantId) {
        combatState.currentTurn = null; // Server will send TurnChanged with new current
    }
    updateInitiativeList();
    updateCombatStatus();
    renderCanvas();
    sendMessage({ type: 'RemoveFromCombat', participant_id: participantId });
}

function endCombat() {
    if (confirm('End combat?')) {
        console.log('Sending EndCombat');
        sendMessage({ type: 'EndCombat' });
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not open — EndCombat may not have been sent');
        }
    }
}

/** DM only: request the server to shut down gracefully. Server will stop after handling this. */
function requestServerShutdown() {
    if (!isDM) return;
    if (!confirm('Shut down the server? All players will be disconnected.')) return;
    sendMessage({ type: 'RequestShutdown' });
    addLogEntry('Shutdown requested. Server will stop shortly.', 'info');
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
            if (controlsDiv) controlsDiv.classList.remove('hidden');
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

    // Keep player action bar in sync
    populatePlayerActionBar();
}

// Full HTML for player action bar (resize handle + tabs + panels). Used when creating or when existing bar lacks handles.
var PLAYER_ACTION_BAR_HTML = '<div class="player-action-bar-resize-handle player-action-bar-resize-height" id="playerActionBarResizeHandle" title="Drag to resize height">' +
    '<span class="player-action-bar-resize-grip" aria-hidden="true">...</span></div>' +
    '<div class="player-bar-tabs" role="tablist">' +
    '<button type="button" class="player-bar-tab-btn active" data-tab="combat" role="tab" tabindex="-1">Combat</button>' +
    '<button type="button" class="player-bar-tab-btn" data-tab="abilities" role="tab" tabindex="-1">Abilities</button>' +
    '<button type="button" class="player-bar-tab-btn" data-tab="powers" role="tab" tabindex="-1">Powers</button>' +
    '<button type="button" class="player-bar-tab-btn" data-tab="dice" role="tab" tabindex="-1">Dice</button>' +
    '</div>' +
    '<div class="player-bar-inner">' +
    '<div class="player-bar-tab-panels">' +
    '<div class="player-bar-tab-panel active" id="playerBarPanelCombat" data-tab="combat" role="tabpanel">' +
    '<div class="player-bar-section player-bar-name-hp" id="playerBarNameHp"></div>' +
    '<div class="player-bar-section player-bar-actions" id="playerBarActions"></div>' +
    '<div class="player-bar-section player-bar-attacks" id="playerBarAttacks"></div>' +
    '</div>' +
    '<div class="player-bar-tab-panel" id="playerBarPanelAbilities" data-tab="abilities" role="tabpanel">' +
    '<div class="player-bar-section player-bar-abilities" id="playerBarAbilities"></div>' +
    '<div class="player-bar-section player-bar-saves" id="playerBarSaves"></div>' +
    '<div class="player-bar-section player-bar-skills" id="playerBarSkills"></div>' +
    '</div>' +
    '<div class="player-bar-tab-panel" id="playerBarPanelPowers" data-tab="powers" role="tabpanel">' +
    '<div class="player-bar-section player-bar-tech-powers" id="playerBarTechPowers"></div>' +
    '<div class="player-bar-section player-bar-force-powers" id="playerBarForcePowers"></div>' +
    '</div>' +
    '<div class="player-bar-tab-panel" id="playerBarPanelDice" data-tab="dice" role="tabpanel">' +
    '<div class="player-bar-section player-bar-dice" id="playerBarDice"></div>' +
    '</div>' +
    '</div></div></div>';

// Create the player action bar DOM and append to body (so it always exists when we need it).
// If bar already exists from HTML but has no resize handles, inject them.
function ensurePlayerActionBarExists() {
    let bar = document.getElementById('playerActionBar');
    if (bar) {
        if (!document.getElementById('playerActionBarResizeHandle') || !bar.querySelector('.player-bar-tabs')) {
            bar.style.display = 'flex';
            bar.style.flexDirection = 'column';
            bar.innerHTML = PLAYER_ACTION_BAR_HTML;
        }
        setupPlayerActionBarResize(bar);
        return bar;
    }
    bar = document.createElement('div');
    bar.id = 'playerActionBar';
    bar.className = 'player-action-bar hidden';
    bar.setAttribute('aria-label', 'Player action bar');
    bar.style.display = 'flex';
    bar.style.flexDirection = 'column';
    bar.innerHTML = PLAYER_ACTION_BAR_HTML;
    document.body.appendChild(bar);
    setupPlayerActionBarResize(bar);
    bar.addEventListener('mousedown', function(e) {
        if (e.target.closest('button')) {
            e.preventDefault(); /* stop browser from focusing button and scrolling view to show it */
        }
        var sbR = document.querySelector('.sidebar.right');
        var sbL = document.querySelector('.sidebar.left');
        var doc = document.documentElement;
        lastActionBarScrollBeforeClick = {
            x: window.scrollX,
            y: window.scrollY,
            docScrollTop: doc ? doc.scrollTop : 0,
            docScrollLeft: doc ? doc.scrollLeft : 0,
            sidebar: sbR ? sbR.scrollTop : 0,
            sidebarLeft: sbL ? sbL.scrollTop : 0,
            t: Date.now()
        };
        actionBarScrollLockUntil = Date.now() + 600; /* for 600ms, any scroll event will be reverted */
    }, true);
    bar.addEventListener('click', function(e) {
        if (e.target.closest('button')) {
            setTimeout(function() {
                if (document.activeElement && bar.contains(document.activeElement)) document.activeElement.blur();
            }, 0);
        }
    }, true);
    return bar;
}

// Load saved action bar height and left edge; apply to bar + main content
function applyPlayerActionBarHeight() {
    try {
        const savedH = localStorage.getItem('playerActionBarHeight');
        if (savedH !== null) {
            const n = parseInt(savedH, 10);
            if (!isNaN(n) && n >= PLAYER_ACTION_BAR_HEIGHT_MIN && n <= PLAYER_ACTION_BAR_HEIGHT_MAX) {
                playerActionBarHeight = n;
            }
        }
    } catch (e) {}
    const bar = document.getElementById('playerActionBar');
    if (bar && !bar.classList.contains('hidden')) {
        bar.style.height = playerActionBarHeight + 'px';
        bar.style.left = '0';
        bar.style.width = '100%';
    }
    document.body.style.setProperty('--player-action-bar-height', playerActionBarHeight + 'px');
}

// Resize handles: height (top grip) and width (left edge grip)
function setupPlayerActionBarResize(bar) {
    const handle = document.getElementById('playerActionBarResizeHandle');
    if (handle) {
        handle.onmousedown = function(e) {
            e.preventDefault();
            const startY = e.clientY;
            const startH = playerActionBarHeight;
            function onMove(e2) {
                const dy = startY - e2.clientY;
                let h = Math.round(startH + dy);
                h = Math.max(PLAYER_ACTION_BAR_HEIGHT_MIN, Math.min(PLAYER_ACTION_BAR_HEIGHT_MAX, h));
                playerActionBarHeight = h;
                bar.style.height = h + 'px';
                document.body.style.setProperty('--player-action-bar-height', h + 'px');
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                try { localStorage.setItem('playerActionBarHeight', String(playerActionBarHeight)); } catch (e2) {}
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }
}

// Switch action bar tab (Combat, Abilities, Powers, Dice); persists to localStorage
function switchPlayerActionBarTab(tabId) {
    const bar = document.getElementById('playerActionBar');
    if (!bar) return;
    const tabBar = bar.querySelector('.player-bar-tabs');
    const panels = bar.querySelectorAll('.player-bar-tab-panel');
    if (tabBar) {
        tabBar.querySelectorAll('.player-bar-tab-btn').forEach(btn => {
            if (btn.dataset.tab === tabId) btn.classList.add('active'); else btn.classList.remove('active');
        });
    }
    if (panels.length) {
        panels.forEach(panel => {
            if (panel.dataset.tab === tabId) panel.classList.add('active'); else panel.classList.remove('active');
        });
    }
    try { localStorage.setItem('playerActionBarTab', tabId); } catch (e) {}
}

// Toggle the action bar on/off (called by the gold Action Bar button)
function togglePlayerActionBar() {
    if (isDM) return;
    playerActionBarVisible = !playerActionBarVisible;
    updatePlayerActionBarVisibility();
    updateActionBarButtonLabel();
}

// Update the Action Bar button text to show current state (On/Off)
function updateActionBarButtonLabel() {
    const btn = document.getElementById('playerActionBarToggleBtn');
    if (!btn) return;
    btn.textContent = playerActionBarVisible ? '📊 Action Bar (On)' : '📊 Action Bar (Off)';
}

// Show/hide the horizontal player action bar (players only). Bar spans full width of screen at bottom.
function updatePlayerActionBarVisibility() {
    const bar = ensurePlayerActionBarExists();
    const shouldShow = !isDM && playerActionBarVisible;
    if (shouldShow) {
        bar.classList.remove('hidden');
        applyPlayerActionBarHeight();
        bar.style.cssText = 'position:fixed!important;bottom:0!important;left:0!important;right:0!important;width:100%!important;height:' + playerActionBarHeight + 'px!important;display:flex!important;flex-direction:column!important;visibility:visible!important;z-index:99999!important;background:linear-gradient(180deg,#1a1510 0%,#0f0c08 50%,#0a0806 100%)!important;border-top:3px solid #c9a227!important;border-left:3px solid #c9a227!important;';
        document.body.classList.add('player-action-bar-visible');
        populatePlayerActionBar();
    } else {
        bar.classList.add('hidden');
        bar.style.cssText = 'display:none!important;visibility:hidden!important;';
        document.body.classList.remove('player-action-bar-visible');
    }
    updateActionBarButtonLabel();
}

// Populate the fixed bottom player action bar (stats, HP, abilities, saves, skills, actions, attacks, dice)
function populatePlayerActionBar() {
    const bar = document.getElementById('playerActionBar');
    if (!bar || bar.classList.contains('hidden') || isDM) return;

    // No character selected: show empty state and hide tab bar
    if (!myCharacterId) {
        const tabBar = bar.querySelector('.player-bar-tabs');
        if (tabBar) tabBar.style.display = 'none';
        const inner = bar.querySelector('.player-bar-inner');
        if (inner) {
            inner.innerHTML = '<div class="player-bar-empty-state">' +
                '<span class="player-bar-empty-title">Action Bar</span>' +
                '<p class="player-bar-empty-text">Select a character to see abilities, attacks, and dice.</p>' +
                '<button type="button" class="player-bar-empty-btn" onclick="showCharacterSelect()">Select Character</button>' +
                '</div>';
        }
        return;
    }

    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter) {
        const tabBar = bar.querySelector('.player-bar-tabs');
        if (tabBar) tabBar.style.display = 'none';
        const inner = bar.querySelector('.player-bar-inner');
        if (inner) {
            inner.innerHTML = '<div class="player-bar-empty-state">' +
                '<span class="player-bar-empty-title">Action Bar</span>' +
                '<p class="player-bar-empty-text">Character data loading…</p>' +
                '<button type="button" class="player-bar-empty-btn" onclick="showCharacterSelect()">Select Character</button>' +
                '</div>';
        }
        return;
    }
    const tabBar = bar.querySelector('.player-bar-tabs');
    if (tabBar) tabBar.style.display = '';

    let charData = myCharacter;
    if (myCharacter.character_data) {
        try {
            const fullData = JSON.parse(myCharacter.character_data);
            charData = fullData.character || fullData;
        } catch (e) { return; }
    }

    const charName = charData.name || myCharacter.name || 'Character';
    const formatMod = (mod) => (mod >= 0 ? '+' + mod : '' + mod);
    const calcMod = (score) => Math.floor((score - 10) / 2);

    // Build tabbed layout: tabs + panels with sections inside each panel
    const inner = bar.querySelector('.player-bar-inner');
    if (inner) {
        inner.innerHTML = '<div class="player-bar-tab-panels">' +
            '<div class="player-bar-tab-panel active" id="playerBarPanelCombat" data-tab="combat" role="tabpanel">' +
            '<div class="player-bar-section player-bar-name-hp" id="playerBarNameHp"></div>' +
            '<div class="player-bar-section player-bar-actions" id="playerBarActions"></div>' +
            '<div class="player-bar-section player-bar-attacks" id="playerBarAttacks"></div>' +
            '</div>' +
            '<div class="player-bar-tab-panel" id="playerBarPanelAbilities" data-tab="abilities" role="tabpanel">' +
            '<div class="player-bar-section player-bar-abilities" id="playerBarAbilities"></div>' +
            '<div class="player-bar-section player-bar-saves" id="playerBarSaves"></div>' +
            '<div class="player-bar-section player-bar-skills" id="playerBarSkills"></div>' +
            '</div>' +
            '<div class="player-bar-tab-panel" id="playerBarPanelPowers" data-tab="powers" role="tabpanel">' +
            '<div class="player-bar-section player-bar-tech-powers" id="playerBarTechPowers"></div>' +
            '<div class="player-bar-section player-bar-force-powers" id="playerBarForcePowers"></div>' +
            '</div>' +
            '<div class="player-bar-tab-panel" id="playerBarPanelDice" data-tab="dice" role="tabpanel">' +
            '<div class="player-bar-section player-bar-dice" id="playerBarDice"></div>' +
            '</div></div>';
    }
    // Bind tab clicks and restore saved tab (tabBar already in scope)
    if (tabBar) {
        tabBar.querySelectorAll('.player-bar-tab-btn').forEach(btn => {
            btn.onclick = function() { switchPlayerActionBarTab(this.dataset.tab); };
        });
        const savedTab = localStorage.getItem('playerActionBarTab');
        if (savedTab && ['combat', 'abilities', 'powers', 'dice'].indexOf(savedTab) >= 0) {
            switchPlayerActionBarTab(savedTab);
        }
    }

    // Ability mods (D&D or Star Wars)
    let abilityMods = {};
    if (charData.baseAbilityScores && (charData.species || (Array.isArray(charData.classes) && charData.baseAbilityScores))) {
        const abilityNames = { Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha' };
        Object.entries(charData.baseAbilityScores).forEach(([name, score]) => {
            const ab = abilityNames[name];
            if (ab) abilityMods[ab] = calcMod(score);
        });
    } else if (charData.abilities) {
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
            if (charData.abilities[ab]) abilityMods[ab] = charData.abilities[ab].mod;
        });
    } else {
        abilityMods = {
            str: calcMod(myCharacter.strength || 10),
            dex: calcMod(myCharacter.dexterity || 10),
            con: calcMod(myCharacter.constitution || 10),
            int: calcMod(myCharacter.intelligence || 10),
            wis: calcMod(myCharacter.wisdom || 10),
            cha: calcMod(myCharacter.charisma || 10)
        };
    }
    const profBonus = charData.proficiency_bonus || myCharacter.proficiency_bonus || 2;
    const saveProfs = {};
    if (charData.saving_throw_proficiencies) {
        charData.saving_throw_proficiencies.forEach(ab => { saveProfs[ab.toLowerCase()] = true; });
    } else if (charData.abilities) {
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
            if (charData.abilities[ab] && charData.abilities[ab].save_proficient) saveProfs[ab] = true;
        });
    }
    const abilityLabels = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

    const maxHP = charData.hp?.max || myCharacter.max_hp || 100;
    const currentHP = myCharacter.current_hp !== undefined && myCharacter.current_hp !== null ? myCharacter.current_hp : maxHP;
    const ac = charData.ac?.base || myCharacter.armor_class || 10;

    // Collect tech/force powers and points early (used in Combat tab and Powers tab)
    const allTechPowers = [];
    const allForcePowers = [];
    const ensureUniquePower = (list, name) => { if (name && !list.includes(name)) list.push(name); };
    (charData.classes || []).forEach(cls => {
        if (Array.isArray(cls.techPowers)) cls.techPowers.forEach(n => ensureUniquePower(allTechPowers, n));
        if (Array.isArray(cls.forcePowers)) cls.forcePowers.forEach(n => ensureUniquePower(allForcePowers, n));
        if (Array.isArray(cls.techPowerDetails)) cls.techPowerDetails.forEach(d => { if (d && d.name) ensureUniquePower(allTechPowers, d.name); });
        if (Array.isArray(cls.forcePowerDetails)) cls.forcePowerDetails.forEach(d => { if (d && d.name) ensureUniquePower(allForcePowers, d.name); });
    });
    if (Array.isArray(charData.techPowers)) charData.techPowers.forEach(n => ensureUniquePower(allTechPowers, n));
    if (Array.isArray(charData.forcePowers)) charData.forcePowers.forEach(n => ensureUniquePower(allForcePowers, n));
    if (Array.isArray(charData.techPowerDetails)) charData.techPowerDetails.forEach(d => { if (d && d.name) ensureUniquePower(allTechPowers, d.name); });
    if (Array.isArray(charData.forcePowerDetails)) charData.forcePowerDetails.forEach(d => { if (d && d.name) ensureUniquePower(allForcePowers, d.name); });
    const techPtsBar = getTechPointsFromCharData(charData, myCharacter);
    const forcePtsBar = getForcePointsFromCharData(charData);
    const showTechForceOnCombat = (techPtsBar.max > 0 || forcePtsBar.max > 0) || allTechPowers.length > 0 || allForcePowers.length > 0;

    // Name & HP (and tech/force point counters when character has them)
    const nameHpEl = document.getElementById('playerBarNameHp');
    if (nameHpEl) {
        let nameHpHtml = '<span class="section-label">Character</span>' +
            '<div style="font-weight:bold;font-size:10px;color:#4a9eff;line-height:1.2;">' + escapeHtml(charName) + '</div>' +
            '<div style="font-size:9px;color:#44ff44;">HP ' + currentHP + '/' + maxHP + ' AC ' + ac + '</div>';
        if (showTechForceOnCombat) {
            nameHpHtml += '<div style="font-size:9px;margin-top:3px;">';
            if (techPtsBar.max > 0 || allTechPowers.length > 0) {
                nameHpHtml += '<span style="color:#00d4ff;">&#9889; Tech ' + techPtsBar.current + '/' + techPtsBar.max + '</span>';
                if (forcePtsBar.max > 0 || allForcePowers.length > 0) nameHpHtml += ' ';
            }
            if (forcePtsBar.max > 0 || allForcePowers.length > 0) {
                nameHpHtml += '<span style="color:#ff00ff;">&#9733; Force ' + forcePtsBar.current + '/' + forcePtsBar.max + '</span>';
            }
            nameHpHtml += '</div>';
        }
        nameHpHtml += '<button type="button" tabindex="-1" onclick="showMyCharacterSheet()" style="margin-top:1px;padding:1px 4px;font-size:8px;background:rgba(74,158,255,0.3);border:1px solid #4a9eff;border-radius:3px;color:#fff;cursor:pointer;">Sheet</button>';
        nameHpEl.innerHTML = nameHpHtml;
    }

    // Abilities (click to roll check)
    const abilitiesEl = document.getElementById('playerBarAbilities');
    if (abilitiesEl) {
        let html = '<span class="section-label">Abilities</span><div class="bar-abilities-grid">';
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
            const mod = abilityMods[ab] != null ? abilityMods[ab] : 0;
            html += '<button type="button" tabindex="-1" class="bar-ability-btn" data-ab="' + ab + '" data-mod="' + mod + '" data-name="' + escapeHtml(charName) + '">' + abilityLabels[ab] + ' ' + formatMod(mod) + '</button>';
        });
        html += '</div>';
        abilitiesEl.innerHTML = html;
        abilitiesEl.querySelectorAll('.bar-ability-btn').forEach(btn => {
            btn.onclick = function() {
                rollAbilityCheck(this.dataset.ab, parseInt(this.dataset.mod, 10), this.dataset.name);
            };
        });
    }

    // Saves
    const savesEl = document.getElementById('playerBarSaves');
    if (savesEl) {
        let html = '<span class="section-label">Saving Throws</span><div class="bar-scroll">';
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
            const base = abilityMods[ab] != null ? abilityMods[ab] : 0;
            const saveMod = saveProfs[ab] ? base + profBonus : base;
            const label = abilityLabels[ab];
            html += '<button type="button" tabindex="-1" class="bar-save-btn" data-ab="' + ab + '" data-mod="' + saveMod + '" data-name="' + escapeHtml(charName) + '">' + label + ' ' + formatMod(saveMod) + '</button>';
        });
        html += '</div>';
        savesEl.innerHTML = html;
        savesEl.querySelectorAll('.bar-save-btn').forEach(btn => {
            btn.onclick = function() {
                rollSavingThrow(this.dataset.ab, parseInt(this.dataset.mod, 10), this.dataset.name);
            };
        });
    }

    // Skills (compact: use charData.skills if present, else a short list with ability mods)
    const skillsEl = document.getElementById('playerBarSkills');
    if (skillsEl) {
        const skillList = charData.skills || [];
        let html = '<span class="section-label">Skill Checks</span><div class="bar-scroll">';
        if (skillList.length > 0) {
            skillList.forEach(s => {
                const name = (s && (s.name || s)) || '';
                const bonus = (s && s.bonus != null) ? s.bonus : (abilityMods[(s && s.ability) || 'str'] != null ? abilityMods[s.ability] : 0);
                if (name) html += '<button type="button" tabindex="-1" class="bar-skill-btn" data-skill="' + escapeHtml(name) + '" data-mod="' + bonus + '" data-name="' + escapeHtml(charName) + '">' + escapeHtml(name) + ' ' + formatMod(bonus) + '</button>';
            });
        } else {
            const shortList = [
                { name: 'Athletics', ab: 'str' }, { name: 'Perception', ab: 'wis' }, { name: 'Stealth', ab: 'dex' },
                { name: 'Persuasion', ab: 'cha' }, { name: 'Insight', ab: 'wis' }, { name: 'Acrobatics', ab: 'dex' }
            ];
            shortList.forEach(s => {
                const mod = abilityMods[s.ab] != null ? abilityMods[s.ab] : 0;
                html += '<button type="button" tabindex="-1" class="bar-skill-btn" data-skill="' + escapeHtml(s.name) + '" data-mod="' + mod + '" data-name="' + escapeHtml(charName) + '">' + s.name + ' ' + formatMod(mod) + '</button>';
            });
        }
        html += '</div>';
        skillsEl.innerHTML = html;
        skillsEl.querySelectorAll('.bar-skill-btn').forEach(btn => {
            btn.onclick = function() {
                rollSkill(this.dataset.skill, parseInt(this.dataset.mod, 10), this.dataset.name);
            };
        });
    }

    const techPts = getTechPointsFromCharData(charData, myCharacter);
    const forcePts = getForcePointsFromCharData(charData);
    const hasTechPoints = techPts.max > 0;
    const hasForcePoints = forcePts.max > 0;
    const showTechSection = allTechPowers.length > 0 || hasTechPoints;
    const showForceSection = allForcePowers.length > 0 || hasForcePoints;

    // Tech Powers (show section if character has any tech powers OR any tech point pool)
    const techPowersEl = document.getElementById('playerBarTechPowers');
    if (techPowersEl) {
        if (!showTechSection) {
            techPowersEl.style.display = 'none';
        } else {
            techPowersEl.style.display = '';
            let html = '<span class="section-label">Tech Points</span>';
            html += '<div class="player-bar-points-row">';
            html += '<span class="points-display" style="color:#00d4ff;">&#9889; ' + techPts.current + '/' + techPts.max + '</span>';
            html += '<button type="button" class="bar-point-btn" onclick="useTechPoint(); populatePlayerActionBar();" title="Use 1">−</button>';
            html += '<button type="button" class="bar-point-btn bar-point-restore" onclick="restoreTechPoints();" title="Restore all">↺</button>';
            html += '</div>';
            if (allTechPowers.length > 0) {
                html += '<span class="section-label">Tech Powers</span><div class="bar-scroll">';
            }
            allTechPowers.forEach(powerName => {
                const safeName = (powerName || '').trim();
                if (!safeName) return;
                const attrPower = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
                html += '<button type="button" tabindex="-1" class="bar-tech-power-btn" data-power="' + escapeHtml(safeName) + '" data-char-name="' + escapeHtml(charName) + '" onmouseover="showSpellTooltip(\'' + attrPower + '\', event)" onmouseout="hideSpellTooltip()">&#9889; ' + escapeHtml(safeName) + '</button>';
            });
            if (allTechPowers.length > 0) html += '</div>';
            techPowersEl.innerHTML = html;
            techPowersEl.querySelectorAll('.bar-tech-power-btn').forEach(btn => {
                btn.onclick = function() {
                    addLogEntry((this.dataset.charName || charName) + ' uses Tech Power: ' + (this.dataset.power || ''), 'info');
                };
            });
        }
    }

    // Force Powers (show section if character has any force powers OR any force point pool)
    const forcePowersEl = document.getElementById('playerBarForcePowers');
    if (forcePowersEl) {
        if (!showForceSection) {
            forcePowersEl.style.display = 'none';
        } else {
            forcePowersEl.style.display = '';
            let html = '<span class="section-label">Force Points</span>';
            html += '<div class="player-bar-points-row">';
            html += '<span class="points-display" style="color:#ff00ff;">&#9733; ' + forcePts.current + '/' + forcePts.max + '</span>';
            html += '<button type="button" class="bar-point-btn" onclick="useForcePoint(); populatePlayerActionBar();" title="Use 1">−</button>';
            html += '<button type="button" class="bar-point-btn bar-point-restore" onclick="restoreForcePoints();" title="Restore all">↺</button>';
            html += '</div>';
            if (allForcePowers.length > 0) {
                html += '<span class="section-label">Force Powers</span><div class="bar-scroll">';
            }
            allForcePowers.forEach(powerName => {
                const safeName = (powerName || '').trim();
                if (!safeName) return;
                const attrPower = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
                html += '<button type="button" tabindex="-1" class="bar-force-power-btn" data-power="' + escapeHtml(safeName) + '" data-char-name="' + escapeHtml(charName) + '" onmouseover="showSpellTooltip(\'' + attrPower + '\', event)" onmouseout="hideSpellTooltip()">&#9733; ' + escapeHtml(safeName) + '</button>';
            });
            if (allForcePowers.length > 0) html += '</div>';
            forcePowersEl.innerHTML = html;
            forcePowersEl.querySelectorAll('.bar-force-power-btn').forEach(btn => {
                btn.onclick = function() {
                    addLogEntry((this.dataset.charName || charName) + ' uses Force Power: ' + (this.dataset.power || ''), 'info');
                };
            });
        }
    }

    // Actions: standard actions + character's bonus actions from sheet
    const actionsEl = document.getElementById('playerBarActions');
    if (actionsEl) {
        const standardActions = [
            { name: 'Attack', icon: '⚔️' }, { name: 'Cast Spell', icon: '🔮' }, { name: 'Dash', icon: '🏃' }, { name: 'Disengage', icon: '🚪' },
            { name: 'Dodge', icon: '🛡️' }, { name: 'Help', icon: '🤝' }, { name: 'Hide', icon: '👁️' }, { name: 'Ready', icon: '⏸️' }, { name: 'Search', icon: '🔍' }, { name: 'Use Item', icon: '🎒' }
        ];
        const bonusFromSheet = (charData.actions && charData.actions.bonus_actions && Array.isArray(charData.actions.bonus_actions))
            ? charData.actions.bonus_actions.map(function(a) { return { name: typeof a === 'string' ? a : (a.name || a), icon: '⭐' }; })
            : [];
        let html = '<span class="section-label">Actions</span><div class="bar-scroll">';
        standardActions.forEach(a => {
            html += '<button type="button" tabindex="-1" class="bar-action-btn" data-action="' + escapeHtml(a.name) + '" data-char-name="' + escapeHtml(charName) + '">' + a.icon + ' ' + escapeHtml(a.name) + '</button>';
        });
        bonusFromSheet.forEach(a => {
            html += '<button type="button" tabindex="-1" class="bar-action-btn bar-action-bonus" data-action="' + escapeHtml(a.name) + '" data-char-name="' + escapeHtml(charName) + '">' + (a.icon || '⭐') + ' ' + escapeHtml(a.name) + '</button>';
        });
        html += '</div>';
        actionsEl.innerHTML = html;
        actionsEl.querySelectorAll('.bar-action-btn').forEach(btn => {
            btn.onclick = function() {
                const name = this.dataset.charName || charName;
                addLogEntry(name + ' is taking the ' + this.dataset.action + ' action', 'info');
            };
        });
    }

    // Attacks: from character sheet (charData.attacks), support to_hit or toHit
    const attacksEl = document.getElementById('playerBarAttacks');
    if (attacksEl) {
        const attacks = charData.attacks || [];
        let html = '<span class="section-label">Attacks</span><div class="bar-scroll">';
        if (attacks.length === 0) {
            html += '<span style="font-size:10px;opacity:0.6;">None</span>';
        } else {
            attacks.forEach(atk => {
                const name = atk.name || atk.weapon_name || 'Attack';
                const toHit = atk.to_hit !== undefined ? atk.to_hit : (atk.toHit !== undefined ? atk.toHit : 0);
                const dmg = atk.damage || atk.damage_dice || '1d4';
                const dmgType = atk.type || atk.damage_type || 'damage';
                html += '<button type="button" tabindex="-1" class="bar-attack-btn" data-weapon="' + escapeHtml(name) + '" data-tohit="' + toHit + '" data-damage="' + escapeHtml(dmg) + '" data-type="' + escapeHtml(dmgType) + '" data-name="' + escapeHtml(charName) + '">' + escapeHtml(name) + '</button>';
            });
        }
        html += '</div>';
        attacksEl.innerHTML = html;
        attacksEl.querySelectorAll('.bar-attack-btn').forEach(btn => {
            btn.onclick = function() {
                rollAttack(this.dataset.weapon, parseInt(this.dataset.tohit, 10), this.dataset.damage, this.dataset.type, this.dataset.name);
            };
        });
    }

    // Dice
    const diceEl = document.getElementById('playerBarDice');
    if (diceEl) {
        const diceTypes = [4, 6, 8, 10, 12, 20, 100];
        let html = '<span class="section-label">Dice (D4–D100)</span><div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;">';
        diceTypes.forEach(sides => {
            html += '<button type="button" tabindex="-1" class="bar-dice-btn" data-sides="' + sides + '" data-name="' + escapeHtml(charName) + '">D' + sides + '</button>';
        });
        html += '</div>';
        diceEl.innerHTML = html;
        diceEl.querySelectorAll('.bar-dice-btn').forEach(btn => {
            btn.onclick = function() {
                rollFlatDice(parseInt(this.dataset.sides, 10), this.dataset.name);
            };
        });
    }
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
    const formatMod = (mod) => (mod >= 0 ? '+' + mod : '' + mod);
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
    
    // DM can damage any token, players can only damage their own token
    if (!isDM) {
        if (!myCharacterId || selectedToken.entity_id !== myCharacterId) {
            alert('You can only damage your own character!');
            return;
        }
    }
    
    const damage = parseInt(document.getElementById('damageAmount').value);
    if (isNaN(damage) || damage <= 0) {
        alert('Enter a valid damage amount!');
        return;
    }
    
    // Get target name for logging
    const participant = combatState.participants.find(p => p.id === selectedToken.id);
    const targetName = participant ? participant.name : (selectedToken.entity_type === 'Enemy' ? 'Enemy' : 'Target');
    
    // Store previous HP values for animation BEFORE updating
    if (selectedToken.entity_type === 'Player') {
        const char = characters.find(c => c.id === selectedToken.entity_id);
        if (char) {
            const oldHp = char.current_hp !== undefined && char.current_hp !== null ? char.current_hp : char.max_hp;
            const maxHp = char.max_hp || 100;
            previousHpValues.set(selectedToken.entity_id, { hp: oldHp, maxHp: maxHp });
        }
    } else if (selectedToken.entity_type === 'Enemy') {
        const enemy = enemies.find(e => e.id === selectedToken.entity_id);
        if (enemy) {
            const oldHp = enemy.current_hp !== undefined && enemy.current_hp !== null ? enemy.current_hp : (enemy.max_hp || 100);
            const maxHp = enemy.max_hp || 100;
            previousHpValues.set(`enemy-${selectedToken.entity_id}`, { hp: oldHp, maxHp: maxHp });
        }
    }
    
    // Update HP locally (optimistic update)
    if (participant) {
        const oldHp = participant.current_hp;
        participant.current_hp = Math.max(0, participant.current_hp - damage);
        // Don't log enemy HP changes to players
        if (selectedToken.entity_type !== 'Enemy') {
            addLogEntry(`${targetName} takes ${damage} damage! (${oldHp} → ${participant.current_hp} HP)`, 'damage');
        }
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
        if (enemy) {
            const currentHp = enemy.current_hp !== undefined && enemy.current_hp !== null ? enemy.current_hp : (enemy.max_hp || 100);
            enemy.current_hp = Math.max(0, currentHp - damage);
            // Also update participant if in combat
            if (participant) {
                participant.current_hp = enemy.current_hp;
            }
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

function changeTokenSize(tokenId, newSize) {
    const sizeValue = parseFloat(newSize);
    if (isNaN(sizeValue) || sizeValue <= 0) {
        console.error('Invalid token size:', newSize);
        return;
    }
    
    console.log(`📐 Changing token ${tokenId} size to ${sizeValue}`);
    
    // Send message to server
    sendMessage({
        type: 'UpdateTokenSize',
        token_id: tokenId,
        size: sizeValue
    });
    
    // Update local token immediately for responsive UI
    const token = tokens.find(t => t.id === tokenId);
    if (token) {
        token.size = sizeValue;
        renderCanvas();
    }
    
    // Update selected token if it's the one being changed
    if (selectedToken && selectedToken.id === tokenId) {
        selectedToken.size = sizeValue;
        updateTokenInfo();
    }
}

function healTarget() {
    if (!selectedToken) {
        alert('Select a token first!');
        return;
    }
    
    // DM can heal any token, players can only heal their own token
    if (!isDM) {
        if (!myCharacterId || selectedToken.entity_id !== myCharacterId) {
            alert('You can only heal your own character!');
            return;
        }
    }
    
    const healing = parseInt(document.getElementById('healAmount').value);
    if (isNaN(healing) || healing <= 0) {
        alert('Enter a valid healing amount!');
        return;
    }
    
    // Get target name for logging
    const participant = combatState.participants.find(p => p.id === selectedToken.id);
    const targetName = participant ? participant.name : (selectedToken.entity_type === 'Enemy' ? 'Enemy' : 'Target');
    
    // Store previous HP values for animation BEFORE updating
    if (selectedToken.entity_type === 'Player') {
        const char = characters.find(c => c.id === selectedToken.entity_id);
        if (char) {
            const oldHp = char.current_hp !== undefined && char.current_hp !== null ? char.current_hp : char.max_hp;
            const maxHp = char.max_hp || 100;
            previousHpValues.set(selectedToken.entity_id, { hp: oldHp, maxHp: maxHp });
        }
    } else if (selectedToken.entity_type === 'Enemy') {
        const enemy = enemies.find(e => e.id === selectedToken.entity_id);
        if (enemy) {
            const oldHp = enemy.current_hp !== undefined && enemy.current_hp !== null ? enemy.current_hp : (enemy.max_hp || 100);
            const maxHp = enemy.max_hp || 100;
            previousHpValues.set(`enemy-${selectedToken.entity_id}`, { hp: oldHp, maxHp: maxHp });
        }
    }
    
    // Update HP locally (optimistic update)
    if (participant) {
        const oldHp = participant.current_hp;
        participant.current_hp = Math.min(participant.max_hp, participant.current_hp + healing);
        // Don't log enemy HP changes to players
        if (selectedToken.entity_type !== 'Enemy') {
            addLogEntry(`${targetName} healed for ${healing}! (${oldHp} → ${participant.current_hp} HP)`, 'healing');
        }
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
        if (enemy) {
            const currentHp = enemy.current_hp !== undefined && enemy.current_hp !== null ? enemy.current_hp : (enemy.max_hp || 100);
            const maxHp = enemy.max_hp || 100;
            enemy.current_hp = Math.min(maxHp, currentHp + healing);
            // Also update participant if in combat
            if (participant) {
                participant.current_hp = enemy.current_hp;
            }
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

// DM only: prompt to set a participant's initiative (used when clicking initiative value in the list)
function promptSetInitiative(entityId, currentInit, participantId) {
    if (!isDM || !combatState.active) return;
    const p = participantId
        ? combatState.participants.find(x => x.id === participantId)
        : (combatState.participants.find(x => x.entity_id === entityId) || combatState.participants.find(x => x.id === entityId));
    if (!p) return;
    const name = p.name || 'Participant';
    const current = currentInit !== undefined && currentInit !== null ? Number(currentInit) : (p.initiative ?? '');
    const raw = window.prompt(`Set initiative for ${name}:`, String(current));
    if (raw === null) return;
    const num = parseInt(raw, 10);
    if (isNaN(num) || num < 0 || num > 99) {
        alert('Please enter a number between 0 and 99.');
        return;
    }
    sendMessage({ type: 'RollInitiative', entity_id: p.entity_id, roll: num, silent: true, participant_id: p.id });
    updateInitiativeList();
}

/** Sort participants by initiative (highest first), then by id for deterministic order. Must match server order. */
function sortParticipantsByInitiative() {
    if (!combatState.participants || !combatState.participants.length) return;
    combatState.participants.sort((a, b) => {
        const aInit = a.initiative ?? 0;
        const bInit = b.initiative ?? 0;
        if (bInit !== aInit) return bInit - aInit;
        return (a.id || '').localeCompare(b.id || '');
    });
}

function updateInitiativeList() {
    const list = document.getElementById('initiativeList');
    
    if (!combatState.active || combatState.participants.length === 0) {
        list.innerHTML = '<div style="padding: 10px;">No active combat</div>';
        return;
    }

    sortParticipantsByInitiative();
    
    // FIX: Only DM sees full turn order, players see limited info
    if (isDM) {
        // DM sees full initiative list with clear header; initiative values are clickable to change
        let html = '<div style="font-weight: bold; color: #4a9eff; margin-bottom: 10px; padding: 8px; background: rgba(74,158,255,0.2); border-radius: 5px;">🎯 Full Turn Order (DM Only) — click initiative to change</div>';
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
            
            const initVal = p.initiative !== undefined && p.initiative !== null ? p.initiative : '?';
            const initNum = typeof p.initiative === 'number' ? p.initiative : null;
            const escapedEntityId = escapeJs(p.entity_id);
            const escapedParticipantId = escapeJs(p.id);
            html += `
                <div class="initiative-item ${typeClass} ${isActive ? 'active' : ''}" style="position: relative;">
                    <div style="position: absolute; left: -25px; top: 50%; transform: translateY(-50%); font-size: 14px; font-weight: bold; opacity: 0.5;">${turnNumber}</div>
                    <span style="flex: 1;">${escapeHtml(p.name)}</span>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span class="initiative-roll" onclick="promptSetInitiative('${escapedEntityId}', ${initNum !== null ? initNum : 'null'}, '${escapedParticipantId}')" title="Click to set initiative" style="cursor: pointer; padding: 2px 8px; border-radius: 4px; min-width: 24px; text-align: center;" onmouseover="this.style.background='rgba(74,158,255,0.3)'" onmouseout="this.style.background='transparent'">${initVal}</span>
                        <span style="margin-left: 5px;">${hpDisplay}</span>
                        ${acDisplay ? `<span style="margin-left: 5px; color: #4a9eff; font-weight: bold;">${acDisplay}</span>` : ''}
                        <button type="button" onclick="event.stopPropagation(); removeFromCombat('${escapedParticipantId}')" title="Remove from combat" class="initiative-remove-btn" style="flex-shrink: 0; width: 22px; height: 22px; padding: 0; margin-left: 4px; border: none; border-radius: 50%; background: rgba(120,120,120,0.25); color: rgba(255,255,255,0.6); cursor: pointer; font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; transition: background 0.15s, color 0.15s; outline: none;" onmouseover="this.style.background='rgba(200,80,80,0.4)'; this.style.color='#ffcccc';" onmouseout="this.style.background='rgba(120,120,120,0.25)'; this.style.color='rgba(255,255,255,0.6)';">×</button>
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
            // CRITICAL: Get HP from character data first (source of truth from server)
            // Only use participant HP as fallback
            const myChar = characters.find(c => c.id === myCharacterId);
            const displayHp = myChar && myChar.current_hp !== undefined && myChar.current_hp !== null ? 
                             myChar.current_hp : myParticipant.current_hp;
            const displayMaxHp = myChar && myChar.max_hp !== undefined && myChar.max_hp !== null ? 
                                myChar.max_hp : myParticipant.max_hp;
            
            html += `
                <div style="padding: 10px; background: rgba(68,255,68,0.2); border-radius: 5px;">
                    <div style="font-weight: bold;">Your Character:</div>
                    <div style="margin-top: 5px;">${myParticipant.name}</div>
                    <div style="margin-top: 5px;">HP: ${displayHp}/${displayMaxHp}</div>
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
        if (controlsDiv) controlsDiv.classList.remove('hidden');
    } else {
        if (controlsDiv) controlsDiv.classList.add('hidden');
    }
}

// Animate health bar for any token (even if not selected)
function animateHealthBar(token, oldHp, newHp, maxHp) {
    if (!token || oldHp === null || maxHp === null) return;
    
    // Determine the HP bar ID based on token type
    let hpBarId;
    if (token.entity_type === 'Player') {
        hpBarId = `hp-bar-${token.entity_id}`;
    } else if (token.entity_type === 'Enemy') {
        hpBarId = `hp-bar-enemy-${token.entity_id}`;
    } else {
        return; // Don't animate for other types
    }
    
    // Find the health bar element
    const hpBar = document.getElementById(hpBarId);
    if (!hpBar) {
        // Health bar doesn't exist (token not selected), animation will happen when token is selected
        return;
    }
    
    // Get the fill element
    const fillElement = hpBar.querySelector('.hp-fill');
    if (!fillElement) return;
    
    // Calculate percentages
    const oldPercent = (oldHp / maxHp) * 100;
    const newPercent = (newHp / maxHp) * 100;
    
    // Set initial width to old HP
    fillElement.style.width = `${oldPercent}%`;
    
    // Animate to new HP after a tiny delay
    setTimeout(() => {
        fillElement.style.width = `${newPercent}%`;
    }, 10);
}

/** When HP is edited in the token info panel (outside combat), update character and persist to server. */
function persistTokenCharacterHP(characterId, value) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    const char = characters.find(c => c.id === characterId);
    if (!char) return;
    const newHp = Math.min(Math.max(0, num), char.max_hp || 999);
    char.current_hp = newHp;
    const token = tokens.find(t => t.entity_type === 'Player' && t.entity_id === characterId);
    if (token) {
        const participant = combatState.participants.find(p => p.id === token.id);
        if (participant) {
            participant.current_hp = newHp;
            updateInitiativeList();
        }
    }
    sendMessage({ type: 'UpdateCharacterHP', character_id: characterId, current_hp: newHp });
    if (selectedToken && selectedToken.entity_id === characterId) updateTokenInfo();
    renderCanvas();
}

function updateCombatParticipantHP(targetId, newHp) {
    const participant = combatState.participants.find(p => p.id === targetId);
    if (participant) {
        participant.current_hp = newHp;
        updateInitiativeList();
    }
    
    // FIX: Also update character data for players and persist to server so HP survives refresh
    const token = tokens.find(t => t.id === targetId);
    if (token && token.entity_type === 'Player') {
        const char = characters.find(c => c.id === token.entity_id);
        if (char) {
            char.current_hp = newHp;
            const payload = buildCharacterUpdatePayload(char);
            if (payload) sendMessage({ type: 'UpdateCharacter', character: payload });
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
    if (!confirm('⚠️ Are you sure you want to clear the current map?\n\nThis will remove:\n- The current map\n- All tokens on the board\n- All measurement shapes\n\nThis action cannot be undone and will affect ALL players!')) {
        return;
    }
    
    console.log('🗑️ Clearing current map...');
    
    // CRITICAL: Clear locally IMMEDIATELY (same for DM and players)
    // This ensures the UI updates instantly, then server broadcast confirms for everyone
    if (currentMap) {
        currentMap.image = null;
    }
    currentMap = null;
    tokens = [];
    tokenImages = {};
    selectedToken = null;
    measurementShapes = [];
    rulerStart = null;
    rulerEnd = null;
    
    // Update UI
    const mapNameElement = document.getElementById('currentMapName');
    if (mapNameElement) {
        mapNameElement.textContent = 'No map loaded';
    }
    updateTokenInfo();
    
    // Clear canvas completely
    if (ctx && canvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Reset dimensions to force complete clear
        const w = canvas.width;
        const h = canvas.height;
        canvas.width = 1;
        canvas.height = 1;
        canvas.width = w;
        canvas.height = h;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // Render immediately
    renderCanvas();
    
    // Send ClearMap message to server - server will broadcast to all clients
    // This ensures everyone gets synced, but local clear already happened
    sendMessage({
        type: 'ClearMap'
    });
    
    console.log('📤 ClearMap message sent to server, local clear complete');
    addLogEntry('🗑️ Map and all tokens cleared', 'info');
    closeModal('saveLoadModal');
}

function filterNPCList() {
    renderEnemyList(); // Re-render with filter
}

function showCreateEnemy() {
    document.getElementById('createEnemyModalTitle').textContent = 'Create Enemy';
    document.getElementById('enemyFormSubmitBtn').textContent = 'Create';
    document.getElementById('enemyEditId').value = '';
    document.getElementById('enemyForm').reset();
    document.getElementById('enemyPortrait').value = '';
    const preview = document.getElementById('enemyPortraitPreview');
    if (preview) preview.innerHTML = '';
    document.getElementById('createEnemyModal').classList.add('active');
}

function showEditEnemy(enemy) {
    if (!enemy || !enemy.id) return;
    document.getElementById('createEnemyModalTitle').textContent = 'Edit Enemy';
    document.getElementById('enemyFormSubmitBtn').textContent = 'Save changes';
    document.getElementById('enemyEditId').value = enemy.id;
    document.getElementById('enemyName').value = enemy.name || '';
    document.getElementById('enemyType').value = enemy.creature_type || '';
    document.getElementById('enemyCR').value = enemy.challenge_rating ?? '';
    document.getElementById('enemyHP').value = enemy.max_hp ?? '';
    document.getElementById('enemyAC').value = enemy.armor_class ?? '';
    document.getElementById('enemyInitBonus').value = enemy.initiative_bonus ?? 0;
    document.getElementById('enemyStr').value = enemy.strength ?? 10;
    document.getElementById('enemyDex').value = enemy.dexterity ?? 10;
    document.getElementById('enemyCon').value = enemy.constitution ?? 10;
    document.getElementById('enemyInt').value = enemy.intelligence ?? 10;
    document.getElementById('enemyWis').value = enemy.wisdom ?? 10;
    document.getElementById('enemyCha').value = enemy.charisma ?? 10;
    document.getElementById('enemySpeed').value = enemy.speed ?? 30;
    document.getElementById('enemyActions').value = enemy.actions || '{}';
    document.getElementById('enemyDescription').value = enemy.description || '';
    document.getElementById('enemyPortrait').value = '';
    const preview = document.getElementById('enemyPortraitPreview');
    if (preview) {
        const portraitSrc = enemy.portrait_url || enemy.local_portrait;
        if (portraitSrc) {
            preview.innerHTML = '<img src="' + portraitSrc + '" alt="Current portrait" style="max-width: 100px; max-height: 100px; border-radius: 8px; border: 2px solid #4a9eff;">';
        } else {
            preview.innerHTML = '<span style="opacity: 0.7;">No portrait</span>';
        }
    }
    document.getElementById('createEnemyModal').classList.add('active');
}

function saveEnemyForm() {
    const editId = document.getElementById('enemyEditId').value.trim();
    if (editId) {
        updateEnemy();
    } else {
        createEnemy();
    }
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
        baseEnemy.portrait_url = localPortrait;
        console.log('🖼️ Enemy portrait attached');
    }
    
    if (isInstanceStyleName(baseEnemy.name)) {
        console.warn('Refusing to create enemy with instance-style name (map token only):', baseEnemy.name);
        return;
    }
    const serverPayload = buildEnemyServerPayload(baseEnemy);
    sendMessage({ type: 'CreateEnemy', enemy: serverPayload });
    
    const localEnemy = { ...baseEnemy };
    if (localPortrait) localEnemy.local_portrait = localPortrait;
    enemies.push(localEnemy);
    renderEnemyList();
    closeModal('createEnemyModal');
    document.getElementById('enemyForm').reset();
    document.getElementById('enemyEditId').value = '';
    document.getElementById('enemyPortraitPreview').innerHTML = '';
    addLogEntry(`Created enemy: ${baseEnemy.name}`, 'info');
}

async function updateEnemy() {
    const editId = document.getElementById('enemyEditId').value.trim();
    if (!editId) return;
    const existing = enemies.find(e => e.id === editId);
    if (!existing) {
        alert('Enemy not found. It may have been deleted.');
        return;
    }
    if (existing.isCustomInstance) {
        alert('This is a placed token, not a database template. Edit the original enemy from the list (the one without a number).');
        return;
    }
    const portraitFile = document.getElementById('enemyPortrait').files[0];
    let portraitToUse = existing.portrait_url || existing.local_portrait || null;
    if (portraitFile) {
        portraitToUse = await fileToBase64(portraitFile);
    }
    const updated = {
        id: existing.id,
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
        style: existing.style || selectedStyle
    };
    updated.portrait_url = portraitToUse;
    if (portraitToUse) updated.local_portrait = portraitToUse;
    if (isInstanceStyleName(updated.name)) {
        console.warn('Refusing to save enemy with instance-style name:', updated.name);
        return;
    }
    const serverPayload = buildEnemyServerPayload(updated);
    sendMessage({ type: 'CreateEnemy', enemy: serverPayload });
    const idx = enemies.findIndex(e => e.id === editId);
    if (idx !== -1) enemies[idx] = updated;
    renderEnemyList();
    closeModal('createEnemyModal');
    document.getElementById('enemyForm').reset();
    document.getElementById('enemyEditId').value = '';
    document.getElementById('enemyPortraitPreview').innerHTML = '';
    addLogEntry(`Updated enemy: ${updated.name}`, 'info');
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
            baseEnemy.portrait_url = localPortrait;
            console.log('🖼️ Enemy portrait attached');
        }
        
        console.log('📥 Importing enemy:', baseEnemy.name);
        
        if (isInstanceStyleName(baseEnemy.name)) {
            console.warn('Refusing to import enemy with instance-style name (map token only):', baseEnemy.name);
            return;
        }
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
    
    // Filter custom enemies: only show TEMPLATES (from database), not placed instances (Goblin 1, Goblin 2, etc.)
    // Instances are for map tokens only; clicking should always use the one template to place many tokens
    const filteredEnemies = (enemies || []).filter(enemy => {
        if (!enemy) return false;
        if (enemy.isCustomInstance) return false; // Hide instances — only list the template once
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
            
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'position: absolute; top: 8px; right: 8px; display: flex; gap: 6px;';
            const editBtn = document.createElement('button');
            editBtn.textContent = '✏️ Edit';
            editBtn.style.cssText = 'background: #4a9eff; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px;';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                showEditEnemy(enemy);
            };
            btnRow.appendChild(editBtn);
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️ Delete';
            deleteBtn.style.cssText = 'background: #ff4444; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px;';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteEnemy(enemy.id, enemy.name);
            };
            btnRow.appendChild(deleteBtn);
            item.appendChild(btnRow);
            
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
    
    // Find the highest number for this NPC type
    let nextNumber = 1;
    const baseName = npc.name.replace(/\s+\d+$/, ''); // Remove trailing number if present
    
    // Check existing NPCs and tokens for this NPC type
    const existingNPCs = enemies.filter(e => {
        if (!e.name || !e.isNPC) return false;
        const npcBaseName = e.name.replace(/\s+\d+$/, '');
        return npcBaseName === baseName || e.name.startsWith(baseName);
    });
    
    // Also check tokens for NPC names
    tokens.forEach(token => {
        if (token.entity_type === 'Enemy') {
            const enemy = enemies.find(e => e.id === token.entity_id && e.isNPC);
            if (enemy && enemy.name) {
                const tokenBaseName = enemy.name.replace(/\s+\d+$/, '');
                if (tokenBaseName === baseName || enemy.name.startsWith(baseName)) {
                    existingNPCs.push(enemy);
                }
            }
        }
    });
    
    // Extract numbers from existing NPC names
    existingNPCs.forEach(e => {
        if (e.name) {
            const match = e.name.match(/\s+(\d+)$/);
            if (match) {
                const num = parseInt(match[1]);
                if (num >= nextNumber) {
                    nextNumber = num + 1;
                }
            } else if (e.name === baseName || e.name === npc.name) {
                // If there's one with no number, next should be 2
                if (nextNumber === 1) {
                    nextNumber = 2;
                }
            }
        }
    });
    
    const instanceName = `${baseName} ${nextNumber}`;
    console.log(`✅ Auto-generated NPC instance name: ${instanceName} (found ${existingNPCs.length} existing)`);
    
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
    
    // Place token with automatically calculated size
    const tokenSize = getTokenSize(instanceId, 'Enemy');
    console.log(`🎯 Placing NPC token ${instanceName} (${instanceId}) with size: ${tokenSize}`);
    sendMessage({
        type: 'PlaceToken',
        entity_id: instanceId,
        entity_type: 'Enemy',
        x: 5,
        y: 5,
        size: tokenSize,
        display_name: instanceName
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

// Extract size from character data - comprehensive search
function extractSizeFromCharacterData(charData) {
    if (!charData) return null;
    
    // 1. Direct size field
    if (charData.size) {
        const sizeStr = String(charData.size).toLowerCase().trim();
        if (['large', 'huge', 'gargantuan'].includes(sizeStr)) {
            return sizeStr;
        }
    }
    
    // 2. Species object with size
    if (charData.species) {
        if (typeof charData.species === 'object' && charData.species.size) {
            const sizeStr = String(charData.species.size).toLowerCase().trim();
            if (['large', 'huge', 'gargantuan'].includes(sizeStr)) {
                return sizeStr;
            }
        }
        // Check if species itself is an object with nested size
        if (typeof charData.species === 'object') {
            // Check all nested properties
            for (const key in charData.species) {
                if (key.toLowerCase() === 'size' && charData.species[key]) {
                    const sizeStr = String(charData.species[key]).toLowerCase().trim();
                    if (['large', 'huge', 'gargantuan'].includes(sizeStr)) {
                        return sizeStr;
                    }
                }
            }
        }
    }
    
    // 3. Race object with size
    if (charData.race) {
        if (typeof charData.race === 'object' && charData.race.size) {
            const sizeStr = String(charData.race.size).toLowerCase().trim();
            if (['large', 'huge', 'gargantuan'].includes(sizeStr)) {
                return sizeStr;
            }
        }
    }
    
    // 4. Search in traits/features text
    const searchFields = ['traits', 'features', 'race_traits', 'species_traits', 'raceFeatures', 'speciesFeatures'];
    for (const field of searchFields) {
        if (charData[field]) {
            const fieldData = charData[field];
            let searchText = '';
            
            if (Array.isArray(fieldData)) {
                searchText = fieldData.map(t => {
                    if (typeof t === 'string') return t;
                    if (typeof t === 'object') {
                        return (t.desc || t.name || t.description || JSON.stringify(t)).toLowerCase();
                    }
                    return String(t).toLowerCase();
                }).join(' ');
            } else if (typeof fieldData === 'string') {
                searchText = fieldData.toLowerCase();
            } else if (typeof fieldData === 'object') {
                searchText = JSON.stringify(fieldData).toLowerCase();
            }
            
            const sizeMatch = searchText.match(/\b(large|huge|gargantuan)\b/i);
            if (sizeMatch) {
                return sizeMatch[1].toLowerCase();
            }
        }
    }
    
    // 5. Search entire character data as string (last resort)
    try {
        const fullText = JSON.stringify(charData).toLowerCase();
        const sizeMatch = fullText.match(/["']size["']\s*:\s*["']?(large|huge|gargantuan)["']?/i);
        if (sizeMatch) {
            return sizeMatch[1].toLowerCase();
        }
    } catch (e) {
        // Ignore JSON stringify errors
    }
    
    return null;
}

// Get token size in grid squares based on creature size
// Returns: 1.0 for Tiny/Small/Medium, 2.0 for Large (4 squares = 2x2), 4.0 for Huge (16 squares = 4x4), 8.0 for Gargantuan (64 squares = 8x8)
function getTokenSize(entityId, entityType) {
    // Default to Medium (1 square)
    let sizeValue = 1.0;
    
    if (entityType === 'Enemy' || entityType === 'NPC') {
        const enemy = enemies.find(e => e.id === entityId);
        if (enemy) {
            // Check if it has npcData (NPC from database) - this is the primary source
            if (enemy.npcData && enemy.npcData.size) {
                const npcSize = enemy.npcData.size;
                const sizeStr = String(npcSize).toLowerCase().trim();
                if (sizeStr === 'large') {
                    sizeValue = 2.0; // 2x2 = 4 squares
                } else if (sizeStr === 'huge') {
                    sizeValue = 4.0; // 4x4 = 16 squares
                } else if (sizeStr === 'gargantuan') {
                    sizeValue = 8.0; // 8x8 = 64 squares
                }
                // Tiny, Small, Medium all default to 1.0
                console.log(`📏 Token size for ${enemy.name}: "${npcSize}" -> ${sizeValue} squares`);
            } else {
                // Try to find in NPC database by name (for regular enemies that might match NPC names)
                const baseName = enemy.name.replace(/\s+\d+$/, ''); // Remove trailing number
                const npcFromDB = npcs.find(n => {
                    const npcBaseName = n.name.replace(/\s+\d+$/, '');
                    return n.name === enemy.name || 
                           enemy.name.startsWith(n.name) || 
                           baseName === npcBaseName ||
                           enemy.name.includes(n.name);
                });
                if (npcFromDB && npcFromDB.size) {
                    const sizeStr = String(npcFromDB.size).toLowerCase().trim();
                    if (sizeStr === 'large') {
                        sizeValue = 2.0;
                    } else if (sizeStr === 'huge') {
                        sizeValue = 4.0;
                    } else if (sizeStr === 'gargantuan') {
                        sizeValue = 8.0;
                    }
                    console.log(`📏 Token size for ${enemy.name} (from DB lookup): "${npcFromDB.size}" -> ${sizeValue} squares`);
                } else {
                    console.log(`⚠️ No size found for enemy ${enemy.name} (id: ${entityId}) - using default 1.0`);
                }
            }
        } else {
            console.log(`⚠️ Enemy ${entityId} not found in enemies array - using default 1.0`);
        }
    } else if (entityType === 'Player') {
        const char = characters.find(c => c.id === entityId);
        if (char && char.character_data) {
            try {
                const charData = JSON.parse(char.character_data);
                
                // Use the comprehensive extraction function
                const sizeStr = extractSizeFromCharacterData(charData);
                
                if (sizeStr) {
                    if (sizeStr === 'large') {
                        sizeValue = 2.0;
                    } else if (sizeStr === 'huge') {
                        sizeValue = 4.0;
                    } else if (sizeStr === 'gargantuan') {
                        sizeValue = 8.0;
                    }
                    console.log(`📏 Token size for player ${char.name}: "${sizeStr}" -> ${sizeValue} squares`);
                } else {
                    console.log(`⚠️ No size found in character_data for ${char.name} - using default 1.0`);
                    console.log(`   Character data sample:`, {
                        keys: Object.keys(charData),
                        hasSpecies: !!charData.species,
                        hasRace: !!charData.race,
                        speciesType: typeof charData.species
                    });
                }
            } catch (e) {
                // Invalid JSON, use default
                console.log(`⚠️ Could not parse character_data for ${char.name}:`, e);
            }
        } else {
            console.log(`⚠️ Character ${entityId} not found or has no character_data - using default 1.0`);
        }
    }
    
    return sizeValue;
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
    
    const techPowersSet = new Set(); // Use Set to track unique normalized keys
    
    for (const pattern of techPatterns) {
        const match = rawBlock.match(pattern);
        if (match) {
            const powersText = match[1];
            // Extract power names with their levels (look for patterns like "1st-level: power name" or "At will: power name")
            const powerMatches = Array.from(powersText.matchAll(/(?:At will|At-will|1st-level|2nd-level|3rd-level|4th-level|5th-level|6th-level|7th-level|8th-level|9th-level)[:\s]+(.*?)(?=\d+[a-z-]*-level|At will|At-will|Actions|Traits|$)/gi));
            
            // If we found level-based matches, process them
            if (powerMatches.length > 0) {
                for (const powerMatch of powerMatches) {
                    const powers = powerMatch[1].split(',').map(p => p.trim()).filter(p => p && p.length > 2);
                    powers.forEach(power => {
                        if (power) {
                            // Normalize: lowercase, trim, remove extra spaces
                            const normalized = power.toLowerCase().trim().replace(/\s+/g, ' ');
                            // Only add if not already present
                            if (!techPowersSet.has(normalized)) {
                                techPowersSet.add(normalized);
                                result.techPowers.push(power.trim());
                            }
                        }
                    });
                }
            } else {
                // Fallback: simple comma-separated list
                const simplePowers = powersText.split(',').map(p => p.trim()).filter(p => p && p.length > 2);
                simplePowers.forEach(power => {
                    if (power) {
                        const normalized = power.toLowerCase().trim().replace(/\s+/g, ' ');
                        if (!techPowersSet.has(normalized)) {
                            techPowersSet.add(normalized);
                            result.techPowers.push(power.trim());
                        }
                    }
                });
            }
            break; // Only process first match to avoid duplicates
        }
    }
    
    // Extract force powers
    const forcePatterns = [
        /forcecasting.*?force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /forcecaster.*?force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is,
        /innate forcecasting.*?force powers[:\s]+(.*?)(?:Actions|Traits|Challenge|$)/is
    ];
    
    const forcePowersSet = new Set(); // Use Set to track unique normalized keys
    
    for (const pattern of forcePatterns) {
        const match = rawBlock.match(pattern);
        if (match) {
            const powersText = match[1];
            // Extract power names with their levels
            const powerMatches = Array.from(powersText.matchAll(/(?:At will|At-will|1st-level|2nd-level|3rd-level|4th-level|5th-level|6th-level|7th-level|8th-level|9th-level)[:\s]+(.*?)(?=\d+[a-z-]*-level|At will|At-will|Actions|Traits|$)/gi));
            
            // If we found level-based matches, process them
            if (powerMatches.length > 0) {
                for (const powerMatch of powerMatches) {
                    const powers = powerMatch[1].split(',').map(p => p.trim()).filter(p => p && p.length > 2);
                    powers.forEach(power => {
                        if (power) {
                            // Normalize: lowercase, trim, remove extra spaces
                            const normalized = power.toLowerCase().trim().replace(/\s+/g, ' ');
                            // Only add if not already present
                            if (!forcePowersSet.has(normalized)) {
                                forcePowersSet.add(normalized);
                                result.forcePowers.push(power.trim());
                            }
                        }
                    });
                }
            } else {
                // Fallback: simple comma-separated list
                const simplePowers = powersText.split(',').map(p => p.trim()).filter(p => p && p.length > 2);
                simplePowers.forEach(power => {
                    if (power) {
                        const normalized = power.toLowerCase().trim().replace(/\s+/g, ' ');
                        if (!forcePowersSet.has(normalized)) {
                            forcePowersSet.add(normalized);
                            result.forcePowers.push(power.trim());
                        }
                    }
                });
            }
            break; // Only process first match to avoid duplicates
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
    console.log('📋 showNPCCharacterSheet called with entityId:', entityId);
    // Only DM can view full NPC character sheets
    if (!isDM) {
        console.warn('Only DM can view full NPC character sheets');
        alert('Only the DM can view full NPC character sheets.');
        return;
    }
    
    // Ensure tech and force powers are loaded for NPC tooltips
    if (!techPowersLoaded) {
        loadTechPowers();
    }
    if (!forcePowersLoaded) {
        loadForcePowers();
    }
    
    const enemy = enemies.find(e => e.id === entityId);
    console.log('🔍 Found enemy:', enemy ? { id: enemy.id, name: enemy.name, isNPC: enemy.isNPC, hasNpcData: !!enemy.npcData } : 'NOT FOUND');
    if (!enemy) {
        alert('Enemy not found.');
        return;
    }
    
    // Custom enemy (from Enemy Database) - show sheet from enemy.* fields
    if (!enemy.isNPC || !enemy.npcData) {
        const participant = combatState.participants.find(p => p.id === selectedToken?.id);
        const currentHp = participant ? participant.current_hp : (enemy.current_hp ?? enemy.max_hp);
        const maxHp = participant ? participant.max_hp : enemy.max_hp;
        const escapedEnemyName = escapeJs(enemy.name);
        let html = '<div style="max-height: 70vh; overflow-y: auto; padding-right: 10px;">';
        html += `<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #4a9eff;">👹 Enemy Info</h4>
                <div class="token-stat"><span>Name:</span><span>${escapeHtml(enemy.name)}</span></div>
                <div class="token-stat"><span>Type:</span><span>${escapeHtml(enemy.creature_type || 'Unknown')}</span></div>
                <div class="token-stat"><span>Challenge:</span><span>${escapeHtml(String(enemy.challenge_rating ?? '0'))}</span></div>
            </div>
            <div class="panel" style="padding: 15px; text-align: center;">
                <h4 style="color: #ff4444;">💚 HP</h4>
                <div style="font-size: 32px; font-weight: bold; color: #44ff44;">${currentHp}</div>
                <div style="opacity: 0.7;">/ ${maxHp}</div>
                <div class="hp-bar" style="margin-top: 10px;"><div class="hp-fill" style="width: ${maxHp ? (currentHp / maxHp) * 100 : 0}%"></div></div>
            </div>
        </div>`;
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">📊 Ability Scores <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">`;
        const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
        const abilityNames = { strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA' };
        const abKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        abilities.forEach((ab, i) => {
            const score = enemy[ab] ?? enemy[abKeys[i]] ?? 10;
            const mod = Math.floor((score - 10) / 2);
            const key = abKeys[i];
            html += `<div onclick="rollAbilityCheck('${key}', ${mod}, '${escapedEnemyName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
                <div style="font-size: 24px; font-weight: bold;">${score}</div>
                <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">${abilityNames[ab]}</div>
                <div style="font-size: 12px; margin-top: 5px;">${mod >= 0 ? '+' : ''}${mod}</div>
            </div>`;
        });
        html += `</div></div>`;
        html += buildDiceRollSectionForNPC(enemy.name);
        html += `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px;">
            <div class="panel" style="padding: 15px; text-align: center;">
                <div style="font-size: 11px; opacity: 0.7;">AC</div>
                <div style="font-size: 28px; font-weight: bold; color: #4a9eff;">${enemy.armor_class ?? '—'}</div>
            </div>
            <div class="panel" style="padding: 15px; text-align: center;">
                <div style="font-size: 11px; opacity: 0.7;">INIT</div>
                <div style="font-size: 28px; font-weight: bold; color: #ffaa44;">${(enemy.initiative_bonus ?? 0) >= 0 ? '+' : ''}${enemy.initiative_bonus ?? 0}</div>
            </div>
            <div class="panel" style="padding: 15px; text-align: center;">
                <div style="font-size: 11px; opacity: 0.7;">SPEED</div>
                <div style="font-size: 28px; font-weight: bold; color: #44ff44;">${enemy.speed ?? '—'}</div>
            </div>
            <div class="panel" style="padding: 15px; text-align: center;">
                <div style="font-size: 11px; opacity: 0.7;">CR</div>
                <div style="font-size: 28px; font-weight: bold; color: #aa88ff;">${escapeHtml(String(enemy.challenge_rating ?? '0'))}</div>
            </div>
        </div>`;
        // Saving Throws (same as other enemies - click to roll)
        const parsedDataCustom = {
            str: enemy.strength ?? enemy.str ?? 10,
            dex: enemy.dexterity ?? enemy.dex ?? 10,
            con: enemy.constitution ?? enemy.con ?? 10,
            int: enemy.intelligence ?? enemy.int ?? 10,
            wis: enemy.wisdom ?? enemy.wis ?? 10,
            cha: enemy.charisma ?? enemy.cha ?? 10
        };
        html += buildSavingThrowsSectionForNPC(enemy, parsedDataCustom, escapedEnemyName);
        // Resolve actions: use this enemy, or if instance with no actions, try template with same base name
        let actionsData = parseCustomEnemyActions(enemy);
        if (actionsData.length === 0 && enemy.isCustomInstance && enemy.name) {
            const baseName = enemy.name.replace(/\s+\d+$/, '').trim();
            const template = enemies.find(e => !e.isCustomInstance && e.name && (e.name === baseName || e.name.replace(/\s+\d+$/, '').trim() === baseName));
            if (template) actionsData = parseCustomEnemyActions(template);
        }
        // Fallback: if enemy.actions is an object (e.g. from server as parsed JSON), build actionsData directly
        if (actionsData.length === 0 && enemy.actions && typeof enemy.actions === 'object' && !Array.isArray(enemy.actions)) {
            actionsData = Object.entries(enemy.actions).filter(([k]) => k && typeof k === 'string').map(([name, val]) => ({
                name: name,
                description: typeof val === 'string' ? val : (val && (val.description || val.desc || val.text)) != null ? String(val.description || val.desc || val.text) : ''
            }));
        }
        // Parse each action individually (one "Name. Description" per call) so we always get attacks when format matches
        let customAttacks = [];
        if (actionsData.length > 0) {
            actionsData.forEach(a => {
                const oneActionText = `${a.name || 'Action'}. ${a.description || ''}`;
                const parsed = parseAttacksFromActions(oneActionText);
                customAttacks = customAttacks.concat(parsed);
            });
        }
        // Show Attacks section (clickable) when we parsed any
        if (customAttacks.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;"><h4 style="color: #ff4444;">⚔️ Attacks <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>`;
            customAttacks.forEach((attack) => {
                const escapedWeapon = escapeJs(attack.name);
                const escapedDamage = escapeJs(attack.damage || '');
                const escapedType = escapeJs(attack.damageType || '');
                const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
                const escapedDescription = attack.description ? escapeJs(attack.description) : '';
                if (attack.type === 'weapon' && attack.toHit !== null) {
                    html += `<div onclick='rollAttack("${escapedWeapon}", ${attack.toHit}, "${escapedDamage}", "${escapedType}", "${escapedEnemyName}")' onmouseover="${attack.description ? `showAttackTooltip('${escapedDescription}', event)` : ''}" onmouseout="hideSpellTooltip()" style="padding: 10px; margin: 5px 0; background: rgba(255,68,68,0.1); border-left: 3px solid #ff4444; border-radius: 3px; cursor: pointer; transition: all 0.2s;" onmouseenter="this.style.background='rgba(255,68,68,0.25)'; this.style.transform='translateX(5px)'" onmouseleave="this.style.background='rgba(255,68,68,0.1)'; this.style.transform='translateX(0)'"><div style="font-weight: bold; font-size: 15px;">${escapeHtml(attack.name)}</div><div style="font-size: 13px; margin-top: 5px;"><span style="color: #44ff44;">⚔️ To Hit: ${formatMod(attack.toHit)}</span> | <span style="color: #ffaa44;">💥 Damage: ${escapeHtml(attack.damage || '')}</span> ${attack.damageType ? `<span style="opacity: 0.7;">${escapeHtml(attack.damageType)}</span>` : ''}</div></div>`;
                } else if (attack.type === 'saving_throw' && attack.saveDC) {
                    const damageRollCode = attack.damage ? `const dmgResult = rollDice("${escapedDamage}"); addLogEntry("${escapedWeapon} damage: " + dmgResult.breakdown + " ${escapedType} = " + dmgResult.total, "damage");` : '';
                    html += `<div onclick='${damageRollCode}addLogEntry("${escapedWeapon}: DC ${attack.saveDC} ${attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1)} Save - ${escapedDamage ? escapedDamage + ' ' + escapedType : 'No damage'} damage", "info")' onmouseover="${attack.description ? `showAttackTooltip('${escapedDescription}', event)` : ''}" onmouseout="hideSpellTooltip()" style="padding: 10px; margin: 5px 0; background: rgba(255,170,68,0.1); border-left: 3px solid #ffaa44; border-radius: 3px; cursor: pointer; transition: all 0.2s;" onmouseenter="this.style.background='rgba(255,170,68,0.25)'; this.style.transform='translateX(5px)'" onmouseleave="this.style.background='rgba(255,170,68,0.1)'; this.style.transform='translateX(0)'"><div style="font-weight: bold; font-size: 15px;">${escapeHtml(attack.name)}</div><div style="font-size: 13px; margin-top: 5px;"><span style="color: #ffaa44;">🛡️ DC ${attack.saveDC} ${attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1)} Save</span> ${attack.damage ? `| <span style="color: #ffaa44;">💥 Damage: ${escapeHtml(attack.damage)}</span>` : ''} ${attack.damageType ? `<span style="opacity: 0.7;">${escapeHtml(attack.damageType)}</span>` : ''}</div></div>`;
                } else {
                    html += `<div onmouseover="${attack.description ? `showAttackTooltip('${escapedDescription}', event)` : ''}" onmouseout="hideSpellTooltip()" style="padding: 10px; margin: 5px 0; background: rgba(170,136,255,0.1); border-left: 3px solid #aa88ff; border-radius: 3px; cursor: help;"><div style="font-weight: bold; font-size: 15px;">${escapeHtml(attack.name)}</div>${attack.description ? `<div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">${escapeHtml(attack.description.substring(0, 100))}${attack.description.length > 100 ? '...' : ''}</div>` : ''}</div>`;
                }
            });
            html += `</div>`;
        }
        // Always show Actions section when we have actions (list with descriptions) — clickable like attacks (tooltip + roll dice if present)
        if (actionsData.length > 0) {
            window.__customEnemyActionsSheet = actionsData;
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;"><h4 style="color: #ff4444;">⚔️ Actions <span style="font-size: 12px; opacity: 0.6;">(Click to roll dice, hover for full text)</span></h4>`;
            actionsData.forEach((a, idx) => {
                const name = escapeHtml(String(a.name || 'Action'));
                const descStr = a.description != null ? String(a.description) : '';
                const desc = escapeHtml(descStr.substring(0, 500));
                const fullLen = descStr.length;
                const escapedDescForTooltip = escapeJs(descStr);
                html += `<div onclick="rollActionFromSheet(${idx})" onmouseover="showAttackTooltip('${escapedDescForTooltip}', event)" onmouseout="hideSpellTooltip()" style="padding: 10px; margin: 5px 0; background: rgba(255,68,68,0.08); border-left: 3px solid #ff4444; border-radius: 3px; cursor: pointer; transition: all 0.2s;" onmouseenter="this.style.background='rgba(255,68,68,0.2)'; this.style.transform='translateX(5px)'" onmouseleave="this.style.background='rgba(255,68,68,0.08)'; this.style.transform='translateX(0)'"><div style="font-weight: bold;">${name}</div>${desc ? `<div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">${desc}${fullLen > 500 ? '...' : ''}</div>` : ''}</div>`;
            });
            html += `</div>`;
        } else if (enemy.actions && (typeof enemy.actions === 'string' ? enemy.actions.trim() : true)) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;"><h4 style="color: #ff4444;">⚔️ Actions</h4><div style="white-space: pre-wrap; font-size: 12px; line-height: 1.5;">${escapeHtml(typeof enemy.actions === 'string' ? enemy.actions : JSON.stringify(enemy.actions, null, 2))}</div></div>`;
        }
        if (enemy.description) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;"><h4 style="color: #4a9eff;">📄 Description</h4><div style="white-space: pre-wrap; font-size: 12px; line-height: 1.6;">${escapeHtml(enemy.description)}</div></div>`;
        }
        html += '</div>';
        const sheetTitleEl = document.getElementById('sheetCharacterName');
        const contentEl = document.getElementById('characterSheetContent');
        if (sheetTitleEl && contentEl) {
            sheetTitleEl.textContent = `${enemy.name} - Character Sheet`;
            contentEl.innerHTML = html;
            document.getElementById('characterSheetModal').classList.add('active');
            setTimeout(() => setupDiceRollButtons(contentEl), 100);
        }
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
    
    // Escape enemy name for use in onclick handlers (needed early for ability scores)
    const escapedEnemyName = escapeJs(enemy.name);
    
    // Ability Scores - Make them clickable like player sheets
    html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #4a9eff;">📊 Ability Scores <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
        <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">`;
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const abilityNames = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
    abilities.forEach(ab => {
        const score = parsedData[ab] || enemy[ab] || 10;
        const mod = Math.floor((score - 10) / 2);
        html += `<div onclick="rollAbilityCheck('${ab}', ${mod}, '${escapedEnemyName}')" style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 5px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='scale(1)'">
            <div style="font-size: 24px; font-weight: bold;">${score}</div>
            <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">${abilityNames[ab]}</div>
            <div style="font-size: 12px; margin-top: 5px;">${mod >= 0 ? '+' : ''}${mod}</div>
        </div>`;
    });
    html += `</div></div>`;
    
    // Dice Roll Section - Add like player sheets
    html += buildDiceRollSectionForNPC(enemy.name);
    
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
    
    // Saving Throws Section - Add like player sheets
    html += buildSavingThrowsSectionForNPC(enemy, parsedData, escapedEnemyName);
    
    // Skills - Make them clickable like player sheets
    if (parsedData.skills && parsedData.skills.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #4a9eff;">🎯 Skills <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
            <div style="display: flex; flex-direction: column; gap: 5px;">`;
        parsedData.skills.forEach(skill => {
            const escapedSkill = escapeJs(skill.name);
            html += `<div onclick="rollSkill('${escapedSkill}', ${skill.bonus}, '${escapedEnemyName}')" style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 3px; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center;" onmouseover="this.style.background='rgba(74,158,255,0.15)'; this.style.transform='translateX(5px)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.transform='translateX(0)'">
                <span style="font-size: 13px;">${escapeHtml(skill.name)}</span>
                <span style="font-weight: bold; color: #4a9eff;">${skill.bonus >= 0 ? '+' : ''}${skill.bonus}</span>
            </div>`;
        });
        html += `</div></div>`;
    }
    
    // Tech Powers - Use same logic as player sheets
    const allTechPowers = [];
    const allForcePowers = [];
    const ensureUnique = (list, name) => {
        if (!name) return;
        if (!list.includes(name)) {
            list.push(name);
        }
    };
    
    // Collect tech powers from parsed data (same approach as players)
    if (parsedData.techPowers && Array.isArray(parsedData.techPowers)) {
        parsedData.techPowers.forEach(name => ensureUnique(allTechPowers, name));
    }
    if (parsedData.forcePowers && Array.isArray(parsedData.forcePowers)) {
        parsedData.forcePowers.forEach(name => ensureUnique(allForcePowers, name));
    }
    
    if (allTechPowers.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #00d4ff;">⚡ Tech Powers <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
            <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
        allTechPowers.forEach(powerName => {
            if (!powerName) return;
            // Use fuzzy matching to handle spacing differences (NPC names come from parsed text)
            const lookup = findTechPowerInCacheGlobal(powerName);
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
    
    // Force Powers - Use same logic as player sheets
    if (allForcePowers.length > 0) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ff00ff;">✨ Force Powers <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
            <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
        allForcePowers.forEach(powerName => {
            if (!powerName) return;
            // Use fuzzy matching to handle spacing differences (NPC names come from parsed text)
            const lookup = findForcePowerInCacheGlobal(powerName);
            const levelDisplay = lookup && (lookup.level_label || lookup.level || lookup.level === 0)
                ? (lookup.level_label || (lookup.level === 0 ? 'At-will' : lookup.level))
                : null;
            const baseLabel = levelDisplay
                ? `${powerName} (${levelDisplay})`
                : powerName;
            const escapedPower = escapeHtml(baseLabel);
            const attrPower = powerName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
            html += `<div onmouseover="showSpellTooltip('${attrPower}', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(255,0,255,0.2); border-radius: 3px; font-size: 12px; border: 1px solid rgba(255,0,255,0.4); cursor: help; transition: all 0.2s;" onmouseenter="this.style.background='rgba(255,0,255,0.4)'; this.style.borderColor='#ff00ff'" onmouseleave="this.style.background='rgba(255,0,255,0.2)'; this.style.borderColor='rgba(255,0,255,0.4)'">${escapedPower}</div>`;
        });
        html += `</div></div>`;
    }
    
    // Actions - Parse and make clickable like player sheets
    if (npc.actions) {
        // Parse Multiattack first
        const multiattack = parseMultiattack(npc.actions);
        const attacks = parseAttacksFromActions(npc.actions);
        
        if (multiattack || attacks.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ff4444;">⚔️ Attacks <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>`;
            
            // Display Multiattack first if it exists
            if (multiattack) {
                const escapedMultiDesc = escapeJs(multiattack.description);
                html += `<div 
                    onmouseover="showAttackTooltip('${escapedMultiDesc}', event)" 
                    onmouseout="hideSpellTooltip()" 
                    style="padding: 10px; margin: 5px 0; background: rgba(255,215,0,0.15); border-left: 3px solid #ffd700; border-radius: 3px; cursor: help;">
                    <div style="font-weight: bold; font-size: 15px; color: #ffd700;">⚡ Multiattack</div>`;
                
                if (multiattack.attackNames.length > 0) {
                    html += `<div style="font-size: 12px; margin-top: 8px; padding: 8px; background: rgba(255,215,0,0.1); border-radius: 3px;">
                        <div style="font-weight: bold; margin-bottom: 5px; opacity: 0.9;">Includes:</div>`;
                    multiattack.attackNames.forEach(attackName => {
                        html += `<div style="padding: 3px 0; font-size: 11px; opacity: 0.8;">• ${escapeHtml(attackName)}</div>`;
                    });
                    html += `</div>`;
                }
                
                html += `<div style="font-size: 12px; opacity: 0.7; margin-top: 5px;">${escapeHtml(multiattack.description.substring(0, 150))}${multiattack.description.length > 150 ? '...' : ''}</div>`;
                html += `</div>`;
            }
            
            attacks.forEach((attack, attackIndex) => {
                const escapedWeapon = escapeJs(attack.name);
                const escapedDamage = escapeJs(attack.damage || '');
                const escapedType = escapeJs(attack.damageType || '');
                const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
                
                // Escape description for tooltip
                const escapedDescription = attack.description ? escapeJs(attack.description) : '';
                
                if (attack.type === 'weapon' && attack.toHit !== null) {
                    // Standard weapon attack
                    html += `<div onclick='rollAttack("${escapedWeapon}", ${attack.toHit}, "${escapedDamage}", "${escapedType}", "${escapedEnemyName}")' 
                        onmouseover="${attack.description ? `showAttackTooltip('${escapedDescription}', event)` : ''}" 
                        onmouseout="hideSpellTooltip()" 
                        style="padding: 10px; margin: 5px 0; background: rgba(255,68,68,0.1); border-left: 3px solid #ff4444; border-radius: 3px; cursor: pointer; transition: all 0.2s;" 
                        onmouseenter="this.style.background='rgba(255,68,68,0.25)'; this.style.transform='translateX(5px)'" 
                        onmouseleave="this.style.background='rgba(255,68,68,0.1)'; this.style.transform='translateX(0)'">
                        <div style="font-weight: bold; font-size: 15px;">${escapeHtml(attack.name)}</div>
                        <div style="font-size: 13px; margin-top: 5px;">
                            <span style="color: #44ff44;">⚔️ To Hit: ${formatMod(attack.toHit)}</span> | 
                            <span style="color: #ffaa44;">💥 Damage: ${escapeHtml(attack.damage || '')}</span> 
                            ${attack.damageType ? `<span style="opacity: 0.7;">${escapeHtml(attack.damageType)}</span>` : ''}
                        </div>
                    </div>`;
                } else if (attack.type === 'saving_throw' && attack.saveDC) {
                    // Saving throw attack - click should roll damage, not saving throw
                    // The saving throw is for players to make, but clicking rolls the damage
                    const damageRollCode = attack.damage ? `const dmgResult = rollDice("${escapedDamage}"); addLogEntry("${escapedWeapon} damage: " + dmgResult.breakdown + " ${escapedType} = " + dmgResult.total, "damage");` : '';
                    html += `<div onclick='${damageRollCode}addLogEntry("${escapedWeapon}: DC ${attack.saveDC} ${attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1)} Save - ${escapedDamage ? escapedDamage + ' ' + escapedType : 'No damage'} damage", "info")' 
                        onmouseover="${attack.description ? `showAttackTooltip('${escapedDescription}', event)` : ''}" 
                        onmouseout="hideSpellTooltip()" 
                        style="padding: 10px; margin: 5px 0; background: rgba(255,170,68,0.1); border-left: 3px solid #ffaa44; border-radius: 3px; cursor: pointer; transition: all 0.2s;" 
                        onmouseenter="this.style.background='rgba(255,170,68,0.25)'; this.style.transform='translateX(5px)'" 
                        onmouseleave="this.style.background='rgba(255,170,68,0.1)'; this.style.transform='translateX(0)'">
                        <div style="font-weight: bold; font-size: 15px;">${escapeHtml(attack.name)}</div>
                        <div style="font-size: 13px; margin-top: 5px;">
                            <span style="color: #ffaa44;">🛡️ DC ${attack.saveDC} ${attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1)} Save</span> | 
                            ${attack.damage ? `<span style="color: #ffaa44;">💥 Damage: ${escapeHtml(attack.damage)}</span>` : ''}
                            ${attack.damageType ? `<span style="opacity: 0.7;">${escapeHtml(attack.damageType)}</span>` : ''}
                        </div>
                    </div>`;
                } else {
                    // Special action (no direct roll, but still clickable for info)
                    html += `<div 
                        onmouseover="${attack.description ? `showAttackTooltip('${escapedDescription}', event)` : ''}" 
                        onmouseout="hideSpellTooltip()" 
                        style="padding: 10px; margin: 5px 0; background: rgba(170,136,255,0.1); border-left: 3px solid #aa88ff; border-radius: 3px; cursor: help;">
                        <div style="font-weight: bold; font-size: 15px;">${escapeHtml(attack.name)}</div>
                        ${attack.description ? `<div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">${escapeHtml(attack.description.substring(0, 100))}${attack.description.length > 100 ? '...' : ''}</div>` : ''}
                    </div>`;
                }
            });
            html += `</div>`;
        } else {
            // Fallback: show raw text if parsing fails
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ff4444;">⚔️ Actions</h4>
                <div style="white-space: pre-wrap; font-size: 12px; line-height: 1.6;">${escapeHtml(npc.actions)}</div>
            </div>`;
        }
    }
    
    // Reactions
    if (npc.reactions) {
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #ffaa44;">🔄 Reactions</h4>
            <div style="white-space: pre-wrap; font-size: 12px; line-height: 1.6;">${escapeHtml(npc.reactions)}</div>
        </div>`;
    }
    
    // Legendary Actions - Parse and make clickable with usage tracker
    if (npc.legendary_actions) {
        const legendaryData = parseLegendaryActions(npc.legendary_actions);
        
        // Get or initialize legendary action usage tracker
        const legendaryKey = `legendary_actions_${enemy.id}`;
        let legendaryUsage = JSON.parse(localStorage.getItem(legendaryKey) || '{"used": 0, "max": ' + legendaryData.maxActions + '}');
        
        // Ensure max is correct (in case NPC data changed)
        legendaryUsage.max = legendaryData.maxActions;
        if (legendaryUsage.used > legendaryUsage.max) {
            legendaryUsage.used = legendaryUsage.max;
        }
        
        const remaining = legendaryUsage.max - legendaryUsage.used;
        
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #aa88ff;">⭐ Legendary Actions <span style="font-size: 12px; opacity: 0.6;">(Click to use!)</span></h4>
            <div style="margin-bottom: 15px; padding: 10px; background: rgba(170,136,255,0.1); border-radius: 5px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-size: 14px; font-weight: bold;">Available: </span>
                    <span id="legendary-remaining-${enemy.id}" style="font-size: 18px; font-weight: bold; color: ${remaining > 0 ? '#44ff44' : '#ff4444'};">${remaining}</span>
                    <span style="font-size: 12px; opacity: 0.7;"> / ${legendaryUsage.max}</span>
                </div>
                <button onclick="resetLegendaryActions('${enemy.id}', '${legendaryKey}')" style="padding: 5px 15px; background: rgba(68,255,68,0.2); border: 1px solid #44ff44; border-radius: 3px; color: #44ff44; cursor: pointer; font-size: 12px; font-weight: bold;" onmouseover="this.style.background='rgba(68,255,68,0.4)'" onmouseout="this.style.background='rgba(68,255,68,0.2)'">🔄 Reset</button>
            </div>`;
        
        if (legendaryData.actions.length > 0) {
            console.log('📋 Parsed legendary actions:', legendaryData.actions);
            legendaryData.actions.forEach((action, index) => {
                const actionCost = action.cost || 1;
                const canUse = remaining >= actionCost;
                const escapedActionName = escapeJs(action.name);
                const escapedDescription = action.description ? escapeJs(action.description) : '';
                
                // Parse the legendary action to see if it's an attack and make it rollable
                const mainAttacks = parseAttacksFromActions(npc.actions || '');
                let matchingAttack = null;
                let attackRollCode = '';
                
                // Check if description mentions an attack
                if (action.description) {
                    // Pattern 1: "makes a stomp attack" - look for "stomp" in action name
                    // Pattern 2: "makes a single attack with its medium repeaters" - look for "medium repeaters"
                    const attackNamePatterns = [
                        /(?:makes?|with)\s+(?:a\s+)?(?:single\s+)?(?:attack\s+)?(?:with\s+)?(?:its\s+)?([A-Za-z\s]+?)(?:\s+attack|\.|$)/i,
                        /(?:attack\s+with|using)\s+(?:its\s+)?([A-Za-z\s]+?)(?:\s+attack|\.|$)/i
                    ];
                    
                    for (const pattern of attackNamePatterns) {
                        const match = action.description.match(pattern);
                        if (match && match[1]) {
                            const weaponName = match[1].trim();
                            // Try to find matching attack in main actions
                            matchingAttack = mainAttacks.find(a => {
                                const aName = a.name.toLowerCase();
                                const wName = weaponName.toLowerCase();
                                return aName.includes(wName) || wName.includes(aName);
                            });
                            if (matchingAttack) break;
                        }
                    }
                    
                    // Special case: "stomp attack" - look for any attack with "stomp" in the name
                    if (!matchingAttack && action.description.toLowerCase().includes('stomp')) {
                        matchingAttack = mainAttacks.find(a => a.name.toLowerCase().includes('stomp'));
                    }
                    
                    // Special case: "medium repeaters" or "repeaters"
                    if (!matchingAttack && (action.description.toLowerCase().includes('repeater') || action.description.toLowerCase().includes('repeaters'))) {
                        matchingAttack = mainAttacks.find(a => a.name.toLowerCase().includes('repeater'));
                    }
                }
                
                // Build the attack roll code if we found a matching attack
                if (matchingAttack) {
                    const escapedWeapon = escapeJs(matchingAttack.name);
                    const escapedDamage = escapeJs(matchingAttack.damage || '');
                    const escapedType = escapeJs(matchingAttack.damageType || '');
                    
                    if (matchingAttack.type === 'weapon' && matchingAttack.toHit !== null) {
                        // Weapon attack - roll the attack when clicked
                        attackRollCode = `rollAttack('${escapedWeapon}', ${matchingAttack.toHit}, '${escapedDamage}', '${escapedType}', '${escapedEnemyName}');`;
                    } else if (matchingAttack.type === 'saving_throw' && matchingAttack.saveDC) {
                        // Saving throw attack - roll damage when clicked
                        const damageRollCode = matchingAttack.damage ? `const dmgResult = rollDice("${escapedDamage}"); addLogEntry("${escapedWeapon} damage: " + dmgResult.breakdown + " ${escapedType} = " + dmgResult.total, "damage");` : '';
                        attackRollCode = `${damageRollCode}addLogEntry("${escapedWeapon}: DC ${matchingAttack.saveDC} ${matchingAttack.saveType.charAt(0).toUpperCase() + matchingAttack.saveType.slice(1)} Save - ${escapedDamage ? escapedDamage + ' ' + escapedType : 'No damage'} damage", "info");`;
                    }
                }
                
                // Build onclick handler - include attack roll if it's an attack
                const onclickHandler = canUse 
                    ? `useLegendaryAction('${enemy.id}', '${legendaryKey}', ${actionCost}, '${escapedActionName}', '${escapedEnemyName}'); ${attackRollCode}`
                    : 'alert(\'Not enough legendary actions remaining!\')';
                
                html += `<div onclick="${onclickHandler}" 
                    onmouseover="${action.description ? `showAttackTooltip('${escapedDescription}', event)` : ''}" 
                    onmouseout="hideSpellTooltip()" 
                    style="padding: 10px; margin: 5px 0; background: ${canUse ? 'rgba(170,136,255,0.1)' : 'rgba(170,136,255,0.05)'}; border-left: 3px solid ${canUse ? '#aa88ff' : '#666'}; border-radius: 3px; cursor: ${canUse ? 'pointer' : 'not-allowed'}; transition: all 0.2s; opacity: ${canUse ? '1' : '0.5'};" 
                    onmouseenter="${canUse ? `this.style.background='rgba(170,136,255,0.25)'; this.style.transform='translateX(5px)'` : ''}" 
                    onmouseleave="${canUse ? `this.style.background='rgba(170,136,255,0.1)'; this.style.transform='translateX(0)'` : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-weight: bold; font-size: 15px;">${escapeHtml(action.name)}</div>
                        <div style="font-size: 12px; color: #aa88ff; font-weight: bold;">Cost: ${actionCost}</div>
                    </div>`;
                
                // If it's an attack, try to parse and make it rollable
                if (action.description && (action.description.includes('attack') || action.description.includes('Attack'))) {
                    // Try to find attack details in the description or link to main attacks
                    const attackMatch = action.description.match(/(?:makes?|with)\s+(?:a\s+)?(?:single\s+)?(?:attack\s+)?(?:with\s+)?(?:its\s+)?([A-Za-z\s]+?)(?:\s+attack|\.|$)/i);
                    if (attackMatch) {
                        const weaponName = attackMatch[1].trim();
                        // Try to find this attack in the main actions
                        const mainAttacks = parseAttacksFromActions(npc.actions || '');
                        const matchingAttack = mainAttacks.find(a => a.name.toLowerCase().includes(weaponName.toLowerCase()) || weaponName.toLowerCase().includes(a.name.toLowerCase()));
                        if (matchingAttack) {
                            const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
                            if (matchingAttack.type === 'weapon' && matchingAttack.toHit !== null) {
                                html += `<div style="font-size: 13px; margin-top: 5px;">
                                    <span style="color: #44ff44;">⚔️ To Hit: ${formatMod(matchingAttack.toHit)}</span> | 
                                    <span style="color: #ffaa44;">💥 Damage: ${escapeHtml(matchingAttack.damage || '')}</span> 
                                    ${matchingAttack.damageType ? `<span style="opacity: 0.7;">${escapeHtml(matchingAttack.damageType)}</span>` : ''}
                                </div>`;
                            } else if (matchingAttack.type === 'saving_throw' && matchingAttack.saveDC) {
                                html += `<div style="font-size: 13px; margin-top: 5px;">
                                    <span style="color: #ffaa44;">🛡️ DC ${matchingAttack.saveDC} ${matchingAttack.saveType.charAt(0).toUpperCase() + matchingAttack.saveType.slice(1)} Save</span> | 
                                    ${matchingAttack.damage ? `<span style="color: #ffaa44;">💥 Damage: ${escapeHtml(matchingAttack.damage)}</span>` : ''}
                                    ${matchingAttack.damageType ? `<span style="opacity: 0.7;">${escapeHtml(matchingAttack.damageType)}</span>` : ''}
                                </div>`;
                            }
                        }
                        html += `<div style="margin-top: 5px; font-size: 12px; opacity: 0.8;">${escapeHtml(action.description)}</div>`;
                    } else {
                        html += `<div style="margin-top: 5px; font-size: 12px; opacity: 0.8;">${escapeHtml(action.description)}</div>`;
                    }
                } else {
                    html += `<div style="margin-top: 5px; font-size: 12px; opacity: 0.8;">${escapeHtml(action.description)}</div>`;
                }
                
                html += `</div>`;
            });
        } else {
            // Fallback: show raw text if parsing fails
            html += `<div style="white-space: pre-wrap; font-size: 12px; line-height: 1.6;">${escapeHtml(npc.legendary_actions)}</div>`;
        }
        
        html += `</div>`;
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
        
        // Setup dice roll buttons after rendering
        setTimeout(() => {
            setupDiceRollButtons(contentEl);
        }, 100);
    }
}

// Build dice roll section for NPCs
function buildDiceRollSectionForNPC(npcName) {
    const escapedName = escapeJs(npcName);
    
    let html = `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #aa88ff;">🎲 Dice Rolls <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
        <div class="dice-roll-container" data-character-name="${escapedName}" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">`;
    
    const diceTypes = [
        { sides: 4, label: 'D4', color: '#4a9eff' },
        { sides: 6, label: 'D6', color: '#44ff44' },
        { sides: 8, label: 'D8', color: '#ffaa44' },
        { sides: 10, label: 'D10', color: '#ff4444' },
        { sides: 12, label: 'D12', color: '#aa88ff' },
        { sides: 20, label: 'D20', color: '#ff6b6b' },
        { sides: 100, label: 'D100', color: '#00d4ff' }
    ];
    
    diceTypes.forEach(die => {
        const colorRgb = die.sides === 4 ? '74,158,255' : 
                        die.sides === 6 ? '68,255,68' : 
                        die.sides === 8 ? '255,170,68' : 
                        die.sides === 10 ? '255,68,68' : 
                        die.sides === 12 ? '170,136,255' : 
                        die.sides === 20 ? '255,107,107' : '0,212,255';
        
        html += `<div class="dice-roll-button" data-sides="${die.sides}" style="
            padding: 12px; 
            background: rgba(${colorRgb},0.15); 
            border: 2px solid ${die.color}; 
            border-radius: 5px; 
            text-align: center; 
            cursor: pointer; 
            transition: all 0.2s;
            font-weight: bold;
            font-size: 14px;
        " onmouseover="this.style.background='rgba(${colorRgb},0.3)'; this.style.transform='scale(1.05)'" onmouseleave="this.style.background='rgba(${colorRgb},0.15)'; this.style.transform='scale(1)'">
            ${die.label}
        </div>`;
    });
    
    html += `</div></div>`;
    
    return html;
}

// Build saving throws section for NPCs
function buildSavingThrowsSectionForNPC(enemy, parsedData, escapedEnemyName) {
    const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
    const calcMod = (score) => Math.floor((score - 10) / 2);
    
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const abilityLabels = {
        str: 'Strength',
        dex: 'Dexterity',
        con: 'Constitution',
        int: 'Intelligence',
        wis: 'Wisdom',
        cha: 'Charisma'
    };
    
    // Calculate ability modifiers from parsed data or enemy data
    const abilityMods = {};
    abilities.forEach(ab => {
        const score = parsedData[ab] || enemy[ab] || 10;
        abilityMods[ab] = calcMod(score);
    });
    
    let html = `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #ffaa44;">🛡️ Saving Throws <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">`;
    
    abilities.forEach(ab => {
        const saveMod = abilityMods[ab] || 0;
        const abilityName = abilityLabels[ab];
        
        html += `<div onclick="rollSavingThrow('${ab}', ${saveMod}, '${escapedEnemyName}')" style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 3px; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center;" onmouseover="this.style.background='rgba(255,170,68,0.15)'; this.style.transform='translateX(5px)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.transform='translateX(0)'">
            <span style="font-size: 13px;">${abilityName}</span>
            <span style="font-weight: bold; color: #ffaa44;">${formatMod(saveMod)}</span>
        </div>`;
    });
    
    html += `</div></div>`;
    
    return html;
}

// Parse Multiattack to extract which attacks it includes
function parseMultiattack(actionsText) {
    if (!actionsText) return null;
    
    // Find the start of Multiattack
    const multiattackStart = actionsText.search(/(?:Multiattack|Multi-Attack)\s*\./i);
    if (multiattackStart === -1) return null;
    
    // Get everything after "Multiattack."
    const afterMultiattack = actionsText.substring(multiattackStart);
    const afterPeriod = afterMultiattack.substring(afterMultiattack.indexOf('.') + 1);
    
    // Find where Multiattack ends - look for the next actual action name
    // The issue is that action names like "Frightful Presence" might be mentioned IN the Multiattack description
    // We need to find the next action that starts a new action block (typically followed by "The [creature]...")
    // Pattern: period + space + CapitalizedWord(s) + period + space + "The" or creature name
    // This helps distinguish between actions mentioned in Multiattack vs actual next actions
    
    // First, try to find pattern: ". Action Name. The" or ". Action Name. [Creature name]"
    const nextActionPattern1 = /\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s*\.)\s+(?:The|It|This|That)/;
    const match1 = afterPeriod.match(nextActionPattern1);
    
    let description;
    if (match1) {
        // Found next action that starts with "The" or similar, extract everything up to it
        const nextActionIndex = afterPeriod.indexOf(match1[0]);
        description = afterPeriod.substring(0, nextActionIndex).trim();
    } else {
        // Fallback: look for any capitalized multi-word phrase followed by period and then a capitalized word
        // that's likely the start of a new action description
        const nextActionPattern2 = /\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s*\.)\s+[A-Z]/;
        const match2 = afterPeriod.match(nextActionPattern2);
        if (match2) {
            const nextActionIndex = afterPeriod.indexOf(match2[0]);
            description = afterPeriod.substring(0, nextActionIndex).trim();
        } else {
            // Last resort: take everything after the period
            description = afterPeriod.trim();
        }
    }
    
    if (!description) return null;
    
    return parseMultiattackFromDescription(description);
}

// Helper function to parse attack names from Multiattack description
function parseMultiattackFromDescription(description) {
    
    // Extract attack names from the description
    // Common patterns: "makes three attacks: one with X and two with Y"
    // or "can use X. It then makes three attacks: one with Y and two with Z"
    const attackNames = [];
    
    // Pattern 1: "makes X attacks: one with [attack1] and Y with [attack2]"
    const pattern1 = /makes?\s+(\d+)\s+attacks?:\s*(?:one\s+with\s+its\s+)?([A-Za-z\s]+?)(?:\s+and\s+(\d+)\s+with\s+(?:its\s+)?([A-Za-z\s]+?))?/i;
    const match1 = description.match(pattern1);
    if (match1) {
        if (match1[2]) attackNames.push(match1[2].trim());
        if (match1[4]) attackNames.push(match1[4].trim());
    }
    
    // Pattern 2: "can use [ability]. It then makes X attacks: one with [attack1] and Y with [attack2]"
    const pattern2 = /can\s+use\s+(?:its\s+)?([A-Za-z\s]+?)(?:\.|,).*?makes?\s+(\d+)\s+attacks?:\s*(?:one\s+with\s+(?:its\s+)?([A-Za-z\s]+?))(?:\s+and\s+(\d+)\s+with\s+(?:its\s+)?([A-Za-z\s]+?))?/i;
    const match2 = description.match(pattern2);
    if (match2) {
        if (match2[1]) attackNames.push(match2[1].trim());
        if (match2[3]) attackNames.push(match2[3].trim());
        if (match2[5]) attackNames.push(match2[5].trim());
    }
    
    // Pattern 3: Look for attack names mentioned (e.g., "laser cannon volley", "medium repeaters")
    // This is a fallback to catch any attack names mentioned
    const attackNamePattern = /(?:with|using)\s+(?:its\s+)?([A-Z][A-Za-z\s]{3,30}?)(?:\s+attack|\s+volley|\s+repeaters|\.|,|$)/g;
    let attackMatch;
    while ((attackMatch = attackNamePattern.exec(description)) !== null) {
        const name = attackMatch[1].trim();
        if (name && !attackNames.includes(name) && name.length > 3) {
            attackNames.push(name);
        }
    }
    
    return {
        description: description,
        attackNames: attackNames.filter((name, index, self) => self.indexOf(name) === index) // Remove duplicates
    };
}

// Parse attacks from NPC actions text - improved to handle all action types
function parseAttacksFromActions(actionsText) {
    const attacks = [];
    if (!actionsText) return attacks;
    
    const foundNames = new Set();
    
    // First, split the text into individual actions by looking for patterns like "Name. Description"
    // Actions typically start with a capitalized name followed by a period
    const actionSections = [];
    const actionPattern = /([A-Z][A-Za-z\s]{2,50}?)\s*\.\s*([^]*?)(?=\s+[A-Z][A-Za-z]+\s*\.|$)/g;
    let match;
    
    while ((match = actionPattern.exec(actionsText)) !== null) {
        const name = match[1].trim();
        const description = match[2] ? match[2].trim() : '';
        
        // Skip "Multiattack" as it's a special action that references others (we'll handle it separately)
        if (name.toLowerCase() === 'multiattack' || name.toLowerCase() === 'multi-attack') {
            continue;
        }
        
        // Only process if we have a reasonable name and description
        if (name.length >= 2 && name.length <= 50 && description.length > 5) {
            actionSections.push({ name, description });
        }
    }
    
    // Process each action section
    actionSections.forEach(({ name, description }) => {
        if (foundNames.has(name.toLowerCase())) {
            return; // Skip duplicates
        }
        
        // Pattern 1: Standard weapon attacks (Melee/Ranged Weapon Attack: +3 to hit. ... Hit: 2 (1d4+2) piercing)
        const weaponMatch = description.match(/(?:Melee|Ranged)\s+Weapon\s+Attack:\s*([+-]?\d+)\s+to\s+hit.*?Hit:\s*(\d+)\s*\(([^)]+)\)\s*(\w+)?\s*damage/i);
        if (weaponMatch) {
            const toHit = parseInt(weaponMatch[1]);
            const damage = weaponMatch[3].trim();
            const damageType = (weaponMatch[4] || '').trim() || 'damage';
            
            attacks.push({
                name: name,
                toHit: toHit,
                damage: damage,
                damageType: damageType,
                type: 'weapon',
                description: description
            });
            foundNames.add(name.toLowerCase());
            return;
        }
        
        // Pattern 1b: Weapon attack with dice in Hit (no to-hit): "Hit: 1d4 bludgeoning damage"
        const weaponDiceMatch = description.match(/(?:Melee|Ranged)\s+Weapon\s+Attack:[^.]*\.\s*Hit:\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(\w+)\s*damage/i);
        if (weaponDiceMatch) {
            attacks.push({
                name: name,
                toHit: 0,
                damage: weaponDiceMatch[1].trim(),
                damageType: (weaponDiceMatch[2] || '').trim() || 'damage',
                type: 'weapon',
                description: description
            });
            foundNames.add(name.toLowerCase());
            return;
        }
        
        // Pattern 1c: Weapon attack with flat damage: "Hit: 2 piercing damage"
        const weaponFlatMatch = description.match(/Hit:\s*(\d+)\s+(\w+)\s*damage/i);
        if (weaponFlatMatch && /(?:Melee|Ranged)\s+Weapon\s+Attack/i.test(description)) {
            attacks.push({
                name: name,
                toHit: 0,
                damage: weaponFlatMatch[1],
                damageType: (weaponFlatMatch[2] || '').trim() || 'damage',
                type: 'weapon',
                description: description
            });
            foundNames.add(name.toLowerCase());
            return;
        }
        
        // Pattern 2: Actions with saving throws and damage
        const saveWithDamageMatch = description.match(/DC\s+(\d+)\s+([A-Za-z]+)\s+saving\s+throw.*?taking\s+(\d+)\s*\(([^)]+)\)\s*(\w+)?\s*damage/i);
        if (saveWithDamageMatch) {
            const saveDC = parseInt(saveWithDamageMatch[1]);
            const saveType = saveWithDamageMatch[2].trim().toLowerCase();
            const damage = saveWithDamageMatch[4].trim();
            const damageType = (saveWithDamageMatch[5] || '').trim() || 'damage';
            
            attacks.push({
                name: name,
                toHit: null,
                damage: damage,
                damageType: damageType,
                saveDC: saveDC,
                saveType: saveType,
                type: 'saving_throw',
                description: description
            });
            foundNames.add(name.toLowerCase());
            return;
        }
        
        // Pattern 3: Actions with saving throws but no damage (e.g., "Frightful Presence")
        const saveNoDamageMatch = description.match(/DC\s+(\d+)\s+([A-Za-z]+)\s+saving\s+throw/i);
        if (saveNoDamageMatch) {
            const saveDC = parseInt(saveNoDamageMatch[1]);
            const saveType = saveNoDamageMatch[2].trim().toLowerCase();
            
            attacks.push({
                name: name,
                toHit: null,
                damage: null,
                damageType: null,
                saveDC: saveDC,
                saveType: saveType,
                type: 'saving_throw',
                description: description
            });
            foundNames.add(name.toLowerCase());
            return;
        }
        
        // If none of the patterns match, it's likely a special action (like Multiattack)
        // We'll skip it unless it has clear attack indicators
    });
    
    return attacks;
}

// Parse legendary actions from NPC legendary_actions text
function parseLegendaryActions(legendaryText) {
    const result = {
        maxActions: 3, // Default
        actions: []
    };
    
    if (!legendaryText) return result;
    
    // Extract max number of legendary actions (e.g., "can take 3 legendary actions")
    const maxMatch = legendaryText.match(/can\s+take\s+(\d+)\s+legendary\s+action/i);
    if (maxMatch) {
        result.maxActions = parseInt(maxMatch[1]);
    }
    
    // Find where actions start - look for pattern like "Stomp." or "Repeating Blasters." 
    // These are action names that start with a capitalized word
    // Skip all the intro text
    let actionsText = legendaryText;
    
    // Try to find the first actual action by looking for a capitalized word followed by period
    // that's on its own line or at the start of a line after blank lines
    const firstActionPattern = /(?:^|\n\n)\s*([A-Z][A-Za-z\s]+?)\s*(?:\(Costs\s+\d+\s+Actions?\))?\s*\.\s/;
    const firstActionMatch = legendaryText.match(firstActionPattern);
    
    if (firstActionMatch) {
        // Find the index where this action starts
        const firstActionIndex = legendaryText.indexOf(firstActionMatch[0]);
        if (firstActionIndex >= 0) {
            actionsText = legendaryText.substring(firstActionIndex).trim();
        }
    }
    
    // Split by blank lines first - each action is typically separated by blank lines
    let actionBlocks = actionsText.split(/\n\s*\n/);
    
    // If that didn't split anything (no double newlines), try splitting by single newline + capitalized word pattern
    if (actionBlocks.length === 1) {
        // Try to split by pattern: newline + capitalized word(s) + period
        // This matches things like "\nStomp." or "\nRepeating Blasters."
        const splitPattern = /\n\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s*(?:\(Costs\s+\d+\s+Actions?\))?\s*\./g;
        const matches = [...actionsText.matchAll(splitPattern)];
        if (matches.length > 1) {
            // Found multiple actions, split at these points
            actionBlocks = [];
            for (let i = 0; i < matches.length; i++) {
                const start = i === 0 ? 0 : matches[i].index;
                const end = i < matches.length - 1 ? matches[i + 1].index : actionsText.length;
                const block = actionsText.substring(start, end).trim();
                if (block) actionBlocks.push(block);
            }
        }
    }
    
    const foundNames = new Set();
    
    actionBlocks.forEach(block => {
        block = block.trim();
        if (!block) return;
        
        // Skip if this looks like intro text (contains "can take" or "legendary action")
        if (block.toLowerCase().includes('can take') || block.toLowerCase().includes('legendary action')) {
            return;
        }
        
        // Each block should be one action: "Action Name. Description" or "Action Name (Costs X Actions). Description"
        // Match action name (1-3 capitalized words) followed by optional cost, then period, then description
        const actionMatch = block.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s*(?:\(Costs\s+(\d+)\s+Actions?\))?\s*\.\s*(.*)$/s);
        
        if (actionMatch) {
            const name = actionMatch[1].trim();
            const cost = actionMatch[2] ? parseInt(actionMatch[2]) : 1;
            let description = actionMatch[3] ? actionMatch[3].trim() : '';
            
            // Clean up description - normalize whitespace
            description = description.replace(/\s+/g, ' ').trim();
            
            if (name && name.length > 1 && name.length < 50 && !foundNames.has(name.toLowerCase())) {
                result.actions.push({
                    name: name,
                    cost: cost,
                    description: description
                });
                foundNames.add(name.toLowerCase());
            }
        }
    });
    
    // If splitting by blank lines didn't work, try line-by-line approach
    if (result.actions.length === 0) {
        const lines = actionsText.split(/\n/);
        let currentAction = null;
        
        lines.forEach(line => {
            line = line.trim();
            if (!line) {
                // Blank line - save current action if exists
                if (currentAction && currentAction.name) {
                    if (!foundNames.has(currentAction.name.toLowerCase())) {
                        result.actions.push(currentAction);
                        foundNames.add(currentAction.name.toLowerCase());
                    }
                    currentAction = null;
                }
                return;
            }
            
            // Check if this line starts a new action
            // Pattern: "Action Name. Description" or "Action Name (Costs X Actions). Description"
            const actionStartMatch = line.match(/^([A-Z][A-Za-z\s]+?)\s*(?:\(Costs\s+(\d+)\s+Actions?\))?\s*\.\s*(.*)$/);
            
            if (actionStartMatch) {
                // Save previous action
                if (currentAction && currentAction.name) {
                    if (!foundNames.has(currentAction.name.toLowerCase())) {
                        result.actions.push(currentAction);
                        foundNames.add(currentAction.name.toLowerCase());
                    }
                }
                
                // Start new action
                const name = actionStartMatch[1].trim();
                const cost = actionStartMatch[2] ? parseInt(actionStartMatch[2]) : 1;
                const description = actionStartMatch[3] ? actionStartMatch[3].trim() : '';
                
                currentAction = {
                    name: name,
                    cost: cost,
                    description: description
                };
            } else if (currentAction) {
                // Continuation of current action
                currentAction.description += (currentAction.description ? ' ' : '') + line;
            }
        });
        
        // Don't forget the last action
        if (currentAction && currentAction.name && !foundNames.has(currentAction.name.toLowerCase())) {
            result.actions.push(currentAction);
        }
    }
    
    return result;
}

// Use a legendary action
function useLegendaryAction(enemyId, storageKey, cost, actionName, enemyName) {
    // Get current usage
    let legendaryUsage = JSON.parse(localStorage.getItem(storageKey) || '{"used": 0, "max": 3}');
    
    // Check if enough actions available
    const remaining = legendaryUsage.max - legendaryUsage.used;
    if (remaining < cost) {
        alert(`Not enough legendary actions! Need ${cost}, but only ${remaining} remaining.`);
        return;
    }
    
    // Update usage
    legendaryUsage.used += cost;
    localStorage.setItem(storageKey, JSON.stringify(legendaryUsage));
    
    // Update display
    const remainingEl = document.getElementById(`legendary-remaining-${enemyId}`);
    if (remainingEl) {
        const newRemaining = legendaryUsage.max - legendaryUsage.used;
        remainingEl.textContent = newRemaining;
        remainingEl.style.color = newRemaining > 0 ? '#44ff44' : '#ff4444';
    }
    
    // Log the action
    addLogEntry(`${enemyName} used legendary action: ${actionName} (Cost: ${cost})`, 'info');
    
    // Refresh the sheet if it's open
    const enemy = enemies.find(e => e.id === enemyId);
    if (enemy && selectedToken && selectedToken.entity_id === enemyId) {
        setTimeout(() => {
            showNPCCharacterSheet(enemyId);
        }, 100);
    }
}

// Reset legendary actions (called at start of turn)
function resetLegendaryActions(enemyId, storageKey) {
    let legendaryUsage = JSON.parse(localStorage.getItem(storageKey) || '{"used": 0, "max": 3}');
    legendaryUsage.used = 0;
    localStorage.setItem(storageKey, JSON.stringify(legendaryUsage));
    
    // Update display
    const remainingEl = document.getElementById(`legendary-remaining-${enemyId}`);
    if (remainingEl) {
        remainingEl.textContent = legendaryUsage.max;
        remainingEl.style.color = '#44ff44';
    }
    
    // Refresh the sheet if it's open
    const enemy = enemies.find(e => e.id === enemyId);
    if (enemy && selectedToken && selectedToken.entity_id === enemyId) {
        setTimeout(() => {
            showNPCCharacterSheet(enemyId);
        }, 100);
    }
    
    addLogEntry('Legendary actions reset!', 'info');
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
    
    // Find the highest number for this enemy type
    let nextNumber = 1;
    const baseName = enemyName.replace(/\s+\d+$/, ''); // Remove trailing number if present
    
    // Check existing enemies and tokens for this enemy type
    const existingEnemies = enemies.filter(e => {
        if (!e.name) return false;
        const enemyBaseName = e.name.replace(/\s+\d+$/, '');
        return enemyBaseName === baseName || e.name.startsWith(baseName);
    });
    
    // Also check tokens for enemy names
    tokens.forEach(token => {
        if (token.entity_type === 'Enemy') {
            const enemy = enemies.find(e => e.id === token.entity_id);
            if (enemy && enemy.name) {
                const tokenBaseName = enemy.name.replace(/\s+\d+$/, '');
                if (tokenBaseName === baseName || enemy.name.startsWith(baseName)) {
                    existingEnemies.push(enemy);
                }
            }
        }
    });
    
    // Extract numbers from existing enemy names
    existingEnemies.forEach(e => {
        if (e.name) {
            const match = e.name.match(/\s+(\d+)$/);
            if (match) {
                const num = parseInt(match[1]);
                if (num >= nextNumber) {
                    nextNumber = num + 1;
                }
            } else if (e.name === baseName || e.name === enemyName) {
                // If there's one with no number, next should be 2
                if (nextNumber === 1) {
                    nextNumber = 2;
                }
            }
        }
    });
    
    const instanceName = `${baseName} ${nextNumber}`;
    console.log(`✅ Auto-generated instance name: ${instanceName} (found ${existingEnemies.length} existing)`);
    
    // Generate instance ID ONCE and use it for both spawn and token placement
    const instanceId = generateUUID();
    console.log('Generated instance ID:', instanceId);
    console.log('Instance name:', instanceName);
    
    // Resolve template: enemyId must be the DATABASE template id. Never send an instance id to the server (no DB entry).
    const template = enemies.find(e => e.id === enemyId && !e.isCustomInstance);
    const enemy = template || enemies.find(e => e.id === enemyId);
    if (enemy) {
        const templateId = enemy.isCustomInstance ? (enemy.enemy_id || enemyId) : enemyId;
        console.log('📤 Sending SpawnEnemy (template id only, no DB write):', templateId);
        sendMessage({ type: 'SpawnEnemy', enemy_id: templateId, instance_id: instanceId, name: instanceName });
        const tempEnemy = {...enemy, id: instanceId, name: instanceName, isCustomInstance: true};
        enemies.push(tempEnemy);
        console.log('✅ Added enemy instance locally:', tempEnemy);
        
        // Place token with the SAME instance ID
        console.log('📤 Sending PlaceToken message with instance ID:', instanceId);
        // Calculate size - try instance first, then fall back to base enemy
        let tokenSize = getTokenSize(instanceId, 'Enemy');
        if (tokenSize === 1.0) {
            // If size is still 1.0, try looking up by base enemy ID
            tokenSize = getTokenSize(enemyId, 'Enemy');
        }
        console.log(`🎯 Placing enemy token ${instanceName} (${instanceId}) with size: ${tokenSize} squares`);
        sendMessage({
            type: 'PlaceToken',
            entity_id: instanceId,
            entity_type: 'Enemy',
            x: 5,
            y: 5,
            size: tokenSize,
            display_name: instanceName
        });
    } else {
        console.error('❌ Base enemy not found:', enemyId);
        const tokenSize = 1.0;
        sendMessage({
            type: 'PlaceToken',
            entity_id: instanceId,
            entity_type: 'Enemy',
            x: 5,
            y: 5,
            size: tokenSize,
            display_name: instanceName || 'Enemy'
        });
    }
    
    closeModal('enemyManagerModal');
    addLogEntry(`Spawned ${instanceName}`, 'info');
}

// Character Management
// Custom Spells Management
function showCustomSpellsManager() {
    document.getElementById('customSpellsModal').classList.add('active');
    loadCustomSpells();
}

// ==================== INFO PANEL ====================

function showInfoPanel() {
    const modal = document.getElementById('infoPanelModal');
    if (!modal) {
        console.error('❌ infoPanelModal not found!');
        return;
    }
    
    modal.classList.add('active');
    
    // Load conditions data
    loadConditions();
    
    // Show conditions section by default
    showInfoSection('conditions');
}

function showInfoSection(section) {
    const content = document.getElementById('infoContent');
    if (!content) return;
    
    // Update button styles
    const buttons = document.querySelectorAll('[id^="infoBtn"]');
    buttons.forEach(btn => {
        btn.style.background = '#4a9eff';
        btn.style.opacity = '1';
    });
    
    const sectionName = section.charAt(0).toUpperCase() + section.slice(1);
    const activeBtn = document.getElementById(`infoBtn${sectionName}`);
    if (activeBtn) {
        activeBtn.style.background = '#2a7acc';
        activeBtn.style.opacity = '1';
    }
    
    // Load and display the selected section
    switch(section) {
        case 'connection':
            renderConnectionSection();
            break;
        case 'conditions':
            renderConditionsSection();
            break;
        // Future sections can be added here
        default:
            content.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.7;">Section "${section}" coming soon!</div>`;
    }
}

function getPlayerConnectionUrl() {
    return window.location.origin || (window.location.protocol + '//' + window.location.hostname + (window.location.port ? ':' + window.location.port : ''));
}

function updatePlayerConnectionLink() {
    const input = document.getElementById('playerConnectionLink');
    if (input) input.value = getPlayerConnectionUrl();
}

function copyPlayerConnectionLink() {
    const url = getPlayerConnectionUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            addLogEntry('Connection link copied to clipboard', 'info');
        }).catch(() => { fallbackCopyLink(url); });
    } else {
        fallbackCopyLink(url);
    }
}
function fallbackCopyLink(url) {
    const input = document.getElementById('playerConnectionLink');
    if (input) {
        input.value = url;
        input.select();
        input.setSelectionRange(0, 99999);
        try {
            document.execCommand('copy');
            addLogEntry('Connection link copied to clipboard', 'info');
        } catch (e) {
            addLogEntry('Copy failed; share this URL: ' + url, 'warning');
        }
    }
}

function renderConnectionSection() {
    const content = document.getElementById('infoContent');
    if (!content) return;
    const url = getPlayerConnectionUrl();
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
    content.innerHTML = `
        <div style="margin-bottom: 24px;">
            <h3 style="color: #4a9eff; margin-bottom: 12px;">🔗 How other players connect</h3>
            <p style="opacity: 0.9; margin-bottom: 12px;">Share this link with players on the same network (e.g. same Wi‑Fi). They open it in their browser and enter their name to join.</p>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
                <input type="text" id="infoConnectionUrl" readonly value="${url.replace(/"/g, '&quot;')}" style="flex: 1; padding: 10px; background: #1a1a2e; color: #eee; border: 1px solid #444; border-radius: 5px; font-size: 14px;">
                <button type="button" onclick="copyPlayerConnectionLink()" style="padding: 10px 16px; background: #4a9eff; color: white; border: none; border-radius: 5px; cursor: pointer;">Copy link</button>
            </div>
            ${isLocalhost ? '<p style="color: #ffaa44; font-size: 13px;">⚠️ You are using <strong>localhost</strong>. Other devices cannot use this link. On this PC, find your IP (e.g. <code>ipconfig</code> → IPv4), then share <strong>http://YOUR_IP:3000</strong> instead.</p>' : ''}
            <p style="opacity: 0.8; font-size: 12px; margin-top: 12px;">Server runs on port <strong>3000</strong>. If your firewall blocks it, allow the app through.</p>
        </div>
    `;
}

function renderConditionsSection() {
    const content = document.getElementById('infoContent');
    if (!content) return;
    
    // Ensure conditions are loaded
    if (!conditionsLoaded) {
        loadConditions().then(() => renderConditionsSection());
        content.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.7;">⏳ Loading conditions...</div>`;
        return;
    }
    
    const conditions = Object.values(conditionsCache);
    
    if (conditions.length === 0) {
        content.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.7;">No conditions found in database.</div>`;
        return;
    }
    
    // Sort conditions alphabetically
    conditions.sort((a, b) => {
        const nameA = (a.Name || a.name || '').toLowerCase();
        const nameB = (b.Name || b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });
    
    let html = `
        <div style="margin-bottom: 20px;">
            <h3 style="color: #4a9eff; margin-bottom: 15px;">⚡ Conditions</h3>
            <p style="opacity: 0.8; margin-bottom: 15px; font-size: 13px;">Hover over a condition to see its full description.</p>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">`;
    
    conditions.forEach(condition => {
        const name = condition.Name || condition.name || 'Unknown';
        const description = condition.Description || condition.description || 'No description available.';
        const escapedName = escapeJs(name);
        const escapedDesc = escapeHtml(description);
        
        html += `
            <div 
                onmouseover="showConditionTooltip('${escapedName}', '${escapedDesc}', event)" 
                onmouseout="hideSpellTooltip()" 
                style="
                    padding: 10px 15px; 
                    background: rgba(74,158,255,0.15); 
                    border: 2px solid rgba(74,158,255,0.3); 
                    border-radius: 5px; 
                    font-size: 13px; 
                    cursor: help; 
                    transition: all 0.2s;
                    font-weight: 500;
                " 
                onmouseenter="this.style.background='rgba(74,158,255,0.3)'; this.style.borderColor='#4a9eff'; this.style.transform='scale(1.05)'" 
                onmouseleave="this.style.background='rgba(74,158,255,0.15)'; this.style.borderColor='rgba(74,158,255,0.3)'; this.style.transform='scale(1)'"
            >
                ${escapeHtml(name)}
            </div>`;
    });
    
    html += `</div></div>`;
    
    content.innerHTML = html;
}

function showConditionTooltip(conditionName, description, event) {
    const tooltip = document.getElementById('spellTooltip');
    const tooltipContent = document.getElementById('spellTooltipContent');
    
    if (!tooltip || !tooltipContent) return;
    
    if (spellTooltipTimeout) {
        clearTimeout(spellTooltipTimeout);
        spellTooltipTimeout = null;
    }
    
    // Format condition tooltip
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #4a9eff; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #4a9eff;">⚡ ${escapeHtml(conditionName)}</div>
        </div>
        <div style="font-size: 13px; line-height: 1.6; white-space: pre-line;">${description}</div>
    `;
    
    tooltipContent.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.zIndex = '99999';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';
    
    adjustTooltipPosition(tooltip, event);
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
    const titleEl = document.getElementById('characterManagerModalTitle');
    const dmButtonsEl = document.getElementById('characterManagerModalDmButtons');
    if (titleEl) titleEl.textContent = isDM ? 'Character Manager' : 'Choose who you\'re playing as';
    if (dmButtonsEl) dmButtonsEl.style.display = isDM ? 'flex' : 'none';
    document.getElementById('characterManagerModal').classList.add('active');
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
    
    // DM: row opens character sheet. Players: row selects who you're playing as (no sheet - use "My Character Sheet" for that).
    const isCurrentCharacter = (c) => c.id === myCharacterId;
    
    characters.forEach(char => {
        const item = document.createElement('div');
        item.className = 'entity-item';
        item.style.position = 'relative';
        if (!isDM && isCurrentCharacter(char)) {
            item.style.border = '2px solid #44ff44';
            item.style.borderRadius = '6px';
        }
        
        const currentLabel = !isDM && isCurrentCharacter(char) ? ' <span style="color:#44ff44;font-weight:bold;">(Current)</span>' : '';
        const content = document.createElement('div');
        content.style.cursor = 'pointer';
        if (isDM) {
            content.onclick = () => showCharacterSheet(char, false);
        } else {
            // Select Character: clicking row = choose this character (updates top-right "Playing as"); no character sheet
            content.onclick = () => {
                if (char.id === myCharacterId) {
                    closeModal('characterManagerModal');
                    return;
                }
                selectCharacterForPlay(char.id);
                closeModal('characterManagerModal');
            };
        }
        content.innerHTML = `
            <h4>${char.name}${currentLabel}</h4>
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
        
        // Select button: for players, same as clicking the row (select who you're playing as)
        if (!isDM && !isCurrentCharacter(char)) {
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
    
    // Save to localStorage for refresh persistence
    if (!isDM) {
        localStorage.setItem('savedCharacterId', charId);
        localStorage.setItem('savedPlayerName', myPlayerName);
        console.log('💾 Saved character selection to localStorage');
    }
    
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
    addLogEntry(`Welcome! You're playing as ${char.name}.`, 'info');
    
    // Update player info so they're always greeted with who they're playing as
    document.getElementById('playerInfo').textContent = `Playing as: ${char.name}`;
    
    // Show confirmation
    alert(`✅ Character Selected!\n\nYou're playing as: ${char.name}\n${char.class} Level ${char.level}\n\nYou're ready to play!`);

    updatePlayerActionBarVisibility();
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
    var className = (classDisplay || getAttrValue('class', 'Unknown')).trim();
    var level = Math.max(1, parseIntSafe(getAttrValue('level', getAttrValue('base_level', '1')), 1));
    var classBaseName = (String(className).trim().toLowerCase().split(/\s+/)[0] || '').trim();
    if (classBaseName === 'engineer') {
        var classLevel = parseIntSafe(getAttrValue('engineer_level', getAttrValue('class_level', String(level))), level);
        if (classLevel >= 1) level = Math.max(level, classLevel);
    }
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
    
    var techTotal = Math.max(0, parseIntSafe(getAttrValue('tech_power_points_total', '0'), 0));
    var engClassBase = (String(className || '').trim().toLowerCase().split(/\s+/)[0] || '').trim();
    var engineerLevel = (engClassBase === 'engineer') ? level : 0;
    if (techTotal === 0 && engineerLevel >= 1) {
        var intScore = baseAbilityScores.Intelligence || 10;
        var intMod = Math.floor((intScore - 10) / 2);
        techTotal = Math.max(1, engineerLevel * 2 + intMod);
    }
    var techExpended = Math.max(0, parseIntSafe(getAttrValue('tech_power_points_expended', '0'), 0));
    var forceTotal = Math.max(0, parseIntSafe(getAttrValue('force_power_points_total', '0'), 0));
    if (forceTotal === 0 && level >= 1 && forcePowerNames.length > 0) {
        var chaScore = baseAbilityScores.Charisma || 10;
        var wisScore = baseAbilityScores.Wisdom || 10;
        var forceMod = Math.max(Math.floor((chaScore - 10) / 2), Math.floor((wisScore - 10) / 2));
        forceTotal = Math.max(1, level * 2 + forceMod);
    }
    var forceExpended = Math.max(0, parseIntSafe(getAttrValue('force_power_points_expended', '0'), 0));
    convertedData.techPoints = { max: techTotal, current: Math.max(0, techTotal - techExpended), _expended: techExpended };
    convertedData.forcePoints = { max: forceTotal, current: Math.max(0, forceTotal - forceExpended), _expended: forceExpended };
    
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

// Level Up / Update from JSON: read file, parse, convert (same as import), then update existing character in place
function handleUpdateCharacterJsonFile(inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) {
        if (inputEl) inputEl.value = '';
        return;
    }
    if (!myCharacterId) {
        alert('Please select a character first.');
        inputEl.value = '';
        return;
    }
    const existing = characters.find(c => c.id === myCharacterId);
    if (!existing) {
        alert('Character not found.');
        inputEl.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function() {
        try {
            const imported = JSON.parse(reader.result);
            const rawCharData = imported.character || imported;
            const isRoll20SW5E = typeof rawCharData.exportedBy === 'string' &&
                rawCharData.exportedBy.toLowerCase().includes('sw5e') &&
                Array.isArray(rawCharData.attribs);
            const isStarWarsFoundry = !isRoll20SW5E &&
                (rawCharData.species || (Array.isArray(rawCharData.classes) && rawCharData.baseAbilityScores));
            let newChar = null;
            let storedCharData = null;
            if (isRoll20SW5E) {
                const conversion = convertRoll20StarWarsCharacter(rawCharData);
                if (!conversion || !conversion.character) {
                    throw new Error('Unable to convert SW5E character data');
                }
                newChar = conversion.character;
                storedCharData = conversion.characterData;
            } else if (isStarWarsFoundry) {
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
                newChar = {
                    id: existing.id,
                    name: charData.name || existing.name,
                    player_name: existing.player_name,
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
                const charData = rawCharData;
                const rawSpeed = charData.speed?.walk || charData.speed || 30;
                const parsedSpeed = typeof rawSpeed === 'string' ? parseInt(rawSpeed, 10) || 30 : rawSpeed || 30;
                newChar = {
                    id: existing.id,
                    name: charData.name || existing.name,
                    player_name: existing.player_name,
                    class: charData.class || existing.class,
                    level: charData.level || 1,
                    max_hp: charData.hp?.max || charData.max_hp || 10,
                    current_hp: charData.hp?.current != null ? charData.hp.current : (charData.current_hp != null ? charData.current_hp : (charData.hp?.max || charData.max_hp || 10)),
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
            if (!newChar.character_data && storedCharData) {
                newChar.character_data = JSON.stringify(storedCharData);
            }
            if (rawCharData.avatar && String(rawCharData.avatar).trim() !== '') {
                newChar.portrait_url = rawCharData.avatar;
            } else if (rawCharData.image && String(rawCharData.image).trim() !== '') {
                newChar.portrait_url = rawCharData.image;
            } else {
                newChar.portrait_url = existing.portrait_url || null;
            }
            const keptId = existing.id;
            const keptPlayerName = existing.player_name;
            Object.assign(existing, newChar);
            existing.id = keptId;
            existing.player_name = keptPlayerName;
            const payload = buildCharacterUpdatePayload(existing);
            if (payload) {
                sendMessage({ type: 'UpdateCharacter', character: payload });
            }
            renderCharacterList();
            renderPlayerList();
            populateCombatActionPanel();
            populatePlayerActionBar();
            const playerInfoEl = document.getElementById('playerInfo');
            if (playerInfoEl) playerInfoEl.textContent = 'Playing as: ' + existing.name;
            if (currentViewingCharacter && currentViewingCharacter.id === existing.id) {
                currentViewingCharacterFullData = storedCharData ? (storedCharData.character ? storedCharData : { character: storedCharData }) : null;
                currentViewingCharacterData = storedCharData && storedCharData.character ? storedCharData.character : storedCharData;
                renderCharacterSheetContent();
            }
            addLogEntry('Character updated from JSON (level up): ' + existing.name, 'info');
        } catch (e) {
            console.error('Update from JSON error:', e);
            alert('Invalid or unsupported JSON: ' + (e.message || e));
        }
        inputEl.value = '';
    };
    reader.readAsText(file, 'UTF-8');
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

// Restore window, documentElement, and sidebars scroll so log updates don't move the view
function restoreWindowScroll(savedX, savedY, savedSidebarScroll, savedSidebarLeftScroll, savedDocScrollTop, savedDocScrollLeft) {
    function restore() {
        if (savedX !== undefined && savedY !== undefined) window.scrollTo(savedX, savedY);
        var doc = document.documentElement;
        if (doc && savedDocScrollTop !== undefined) doc.scrollTop = savedDocScrollTop;
        if (doc && savedDocScrollLeft !== undefined) doc.scrollLeft = savedDocScrollLeft;
        var sbR = document.querySelector('.sidebar.right');
        if (sbR && savedSidebarScroll !== undefined) sbR.scrollTop = savedSidebarScroll;
        var sbL = document.querySelector('.sidebar.left');
        if (sbL && savedSidebarLeftScroll !== undefined) sbL.scrollTop = savedSidebarLeftScroll;
    }
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 0);
    setTimeout(restore, 50);
    setTimeout(restore, 150);
    setTimeout(restore, 300);
}

function addLogEntry(message, type = 'info') {
    const log = document.getElementById('rollsLog');
    if (!log) return;
    var rightSidebar = document.querySelector('.sidebar.right');
    var leftSidebar = document.querySelector('.sidebar.left');
    var doc = document.documentElement;
    var use = (lastActionBarScrollBeforeClick && (Date.now() - lastActionBarScrollBeforeClick.t) < 500)
        ? lastActionBarScrollBeforeClick
        : { x: window.scrollX, y: window.scrollY, docScrollTop: doc ? doc.scrollTop : 0, docScrollLeft: doc ? doc.scrollLeft : 0, sidebar: rightSidebar ? rightSidebar.scrollTop : 0, sidebarLeft: leftSidebar ? leftSidebar.scrollTop : 0 };
    var savedX = use.x;
    var savedY = use.y;
    var savedSidebarScroll = use.sidebar;
    var savedSidebarLeftScroll = use.sidebarLeft !== undefined ? use.sidebarLeft : (leftSidebar ? leftSidebar.scrollTop : 0);
    var savedDocTop = use.docScrollTop !== undefined ? use.docScrollTop : (doc ? doc.scrollTop : 0);
    var savedDocLeft = use.docScrollLeft !== undefined ? use.docScrollLeft : (doc ? doc.scrollLeft : 0);
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    const baseStyle = 'padding: 10px 14px; margin: 5px 0; border-radius: 6px; font-size: 14px; line-height: 1.5;';
    let entryStyle = baseStyle + ' border-left: 4px solid #666; background: rgba(255,255,255,0.06); color: #ddd;';
    if (type === 'success') {
        entryStyle = baseStyle + ' border-left: 5px solid #44ff44; background: linear-gradient(135deg, rgba(68, 255, 68, 0.2) 0%, rgba(34, 200, 34, 0.12) 100%); color: #88ff88;';
    } else if (type === 'damage') {
        entryStyle = baseStyle + ' border-left: 5px solid #ff4444; background: linear-gradient(135deg, rgba(255, 68, 68, 0.2) 0%, rgba(200, 34, 34, 0.12) 100%); color: #ff8888;';
    } else if (type === 'healing' || type === 'heal') {
        entryStyle = baseStyle + ' border-left: 5px solid #44ff44; background: rgba(68, 255, 68, 0.15); color: #88ff88;';
    } else if (type === 'warning') {
        entryStyle = baseStyle + ' border-left: 5px solid #ffaa44; background: rgba(255, 170, 68, 0.15); color: #ffd4a0;';
    }
    entry.style.cssText = entryStyle;
    const formattedMessage = formatLogMessage(message);
    entry.innerHTML = `<span style="opacity: 0.7; font-size: 11px; margin-right: 8px;">[${timestamp}]</span> ${formattedMessage}`;
    
    const placeholder = log.querySelector('div[style*="opacity: 0.5"]');
    if (placeholder) placeholder.remove();
    log.appendChild(entry);
    restoreWindowScroll(savedX, savedY, savedSidebarScroll, savedSidebarLeftScroll, savedDocTop, savedDocLeft);
    requestAnimationFrame(function() {
        log.scrollTop = log.scrollHeight;
        restoreWindowScroll(savedX, savedY, savedSidebarScroll, savedSidebarLeftScroll, savedDocTop, savedDocLeft);
    });
}

// Add roll-specific log entry with support for nat 20/1 styling
function addRollEntry(message, isNat20 = false, isNat1 = false) {
    console.log('🎲 Adding to rolls log:', message);
    
    const log = document.getElementById('rollsLog');
    if (!log) {
        console.error('❌ Rolls log element not found!');
        return;
    }
    
    // Remove placeholder message if it exists
    const placeholder = log.querySelector('div[style*="opacity: 0.5"]');
    if (placeholder) {
        placeholder.remove();
    }
    
    const entry = document.createElement('div');
    entry.className = 'log-entry info';
    
    // Enhanced styling with animations and better visibility
    const baseStyle = 'padding: 12px 15px; margin: 6px 0; border-radius: 6px; font-size: 15px; line-height: 1.5; transition: all 0.3s ease; animation: slideIn 0.3s ease-out;';
    
    // Special styling for nat 20 (green) and nat 1 (red)
    if (isNat20) {
        entry.style.cssText = baseStyle + 'border-left: 5px solid #44ff44; background: linear-gradient(135deg, rgba(68, 255, 68, 0.35) 0%, rgba(34, 200, 34, 0.25) 100%); color: #88ff88; font-weight: bold; box-shadow: 0 0 15px rgba(68, 255, 68, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2); text-shadow: 0 0 5px rgba(68, 255, 68, 0.5);';
    } else if (isNat1) {
        entry.style.cssText = baseStyle + 'border-left: 5px solid #ff4444; background: linear-gradient(135deg, rgba(255, 68, 68, 0.35) 0%, rgba(200, 34, 34, 0.25) 100%); color: #ff8888; font-weight: bold; box-shadow: 0 0 15px rgba(255, 68, 68, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2); text-shadow: 0 0 5px rgba(255, 68, 68, 0.5);';
    } else {
        entry.style.cssText = baseStyle + 'border-left: 4px solid #ffaa44; background: linear-gradient(135deg, rgba(255, 170, 68, 0.25) 0%, rgba(255, 140, 40, 0.15) 100%); color: #ffd4a0; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);';
    }
    
    const timestamp = new Date().toLocaleTimeString();
    
    // Format the message to bold player names
    const formattedMessage = formatLogMessage(message);
    entry.innerHTML = `<span style="opacity: 0.7; font-size: 12px; font-weight: normal; margin-right: 8px;">[${timestamp}]</span> ${formattedMessage}`;
    
    var rightSidebar = document.querySelector('.sidebar.right');
    var leftSidebar = document.querySelector('.sidebar.left');
    var doc = document.documentElement;
    var use = (lastActionBarScrollBeforeClick && (Date.now() - lastActionBarScrollBeforeClick.t) < 500)
        ? lastActionBarScrollBeforeClick
        : { x: window.scrollX, y: window.scrollY, docScrollTop: doc ? doc.scrollTop : 0, docScrollLeft: doc ? doc.scrollLeft : 0, sidebar: rightSidebar ? rightSidebar.scrollTop : 0, sidebarLeft: leftSidebar ? leftSidebar.scrollTop : 0 };
    var savedX = use.x;
    var savedY = use.y;
    var savedSidebarScroll = use.sidebar;
    var savedSidebarLeftScroll = use.sidebarLeft !== undefined ? use.sidebarLeft : (leftSidebar ? leftSidebar.scrollTop : 0);
    var savedDocTop = use.docScrollTop !== undefined ? use.docScrollTop : (doc ? doc.scrollTop : 0);
    var savedDocLeft = use.docScrollLeft !== undefined ? use.docScrollLeft : (doc ? doc.scrollLeft : 0);
    log.appendChild(entry);
    restoreWindowScroll(savedX, savedY, savedSidebarScroll, savedSidebarLeftScroll, savedDocTop, savedDocLeft);
    requestAnimationFrame(function() {
        log.scrollTop = log.scrollHeight;
        restoreWindowScroll(savedX, savedY, savedSidebarScroll, savedSidebarLeftScroll, savedDocTop, savedDocLeft);
    });
    
    console.log('✅ Added to rolls log, total entries:', log.children.length);
    
    // Mirror to standalone character sheet window if open (so players see rolls there too)
    if (standaloneCharacterSheetWindow && !standaloneCharacterSheetWindow.closed) {
        try {
            standaloneCharacterSheetWindow.postMessage({
                type: 'rollLogEntry',
                text: message,
                isNat20: !!isNat20,
                isNat1: !!isNat1
            }, window.location.origin);
        } catch (e) {
            console.warn('Could not send roll to standalone window:', e);
        }
    }
    
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

// Helper function to find tech power in cache with fuzzy matching (used by both display and tooltip)
function findTechPowerInCacheGlobal(powerName) {
    if (!techPowersCache || !powerName) {
        console.log(`⚠️ findTechPowerInCacheGlobal: cache=${!!techPowersCache}, powerName=${powerName}`);
        return null;
    }
    
    // Normalize the search term (same normalization as when loading cache)
    const normalizedSearch = powerName.toLowerCase().trim().replace(/\s+/g, ' ');
    console.log(`🔍 Looking up tech power: "${powerName}" -> normalized: "${normalizedSearch}"`);
    
    // Try exact match first
    if (techPowersCache[normalizedSearch]) {
        console.log(`✅ Found exact match for "${powerName}"`);
        return techPowersCache[normalizedSearch];
    }
    
    // Try fuzzy match - search all cache keys (case-insensitive, space-normalized)
    for (const [key, value] of Object.entries(techPowersCache)) {
        const keyNormalized = key.toLowerCase().trim().replace(/\s+/g, ' ');
        // Check if keys match exactly (after normalization)
        if (keyNormalized === normalizedSearch) {
            console.log(`✅ Found normalized match for "${powerName}" (key: "${key}")`);
            return value;
        }
        // Check if one contains the other (for partial matches)
        if (keyNormalized.includes(normalizedSearch) || normalizedSearch.includes(keyNormalized)) {
            // Only return if it's a close match (not too different in length)
            const lengthDiff = Math.abs(keyNormalized.length - normalizedSearch.length);
            if (lengthDiff <= 3 || normalizedSearch.length > 5) { // Allow small differences or longer names
                console.log(`✅ Found fuzzy match for "${powerName}" -> "${value.name}" (key: "${key}")`);
                return value;
            }
        }
    }
    
    console.log(`❌ No match found for "${powerName}" in ${Object.keys(techPowersCache).length} tech powers`);
    console.log(`📋 Available keys (first 10):`, Object.keys(techPowersCache).slice(0, 10));
    return null;
}

function findForcePowerInCacheGlobal(powerName) {
    if (!forcePowersCache || !powerName) return null;
    
    // Normalize the search term
    const normalizedSearch = powerName.toLowerCase().trim().replace(/\s+/g, ' ');
    
    // Try exact match first
    if (forcePowersCache[normalizedSearch]) {
        return forcePowersCache[normalizedSearch];
    }
    
    // Try fuzzy match - search all cache keys (case-insensitive, space-normalized)
    for (const [key, value] of Object.entries(forcePowersCache)) {
        const keyNormalized = key.toLowerCase().trim().replace(/\s+/g, ' ');
        // Check if keys match exactly (after normalization)
        if (keyNormalized === normalizedSearch) {
            return value;
        }
        // Check if one contains the other (for partial matches)
        if (keyNormalized.includes(normalizedSearch) || normalizedSearch.includes(keyNormalized)) {
            // Only return if it's a close match (not too different in length)
            const lengthDiff = Math.abs(keyNormalized.length - normalizedSearch.length);
            if (lengthDiff <= 3 || normalizedSearch.length > 5) { // Allow small differences or longer names
                return value;
            }
        }
    }
    
    return null;
}

// Separate async function for fetching
async function fetchSpellDataAndDisplay(spellName, tooltip, content, event) {
    try {
        // CRITICAL: Check tech powers cache first (for both players and NPCs) with fuzzy matching
        const techPower = findTechPowerInCacheGlobal(spellName);
        if (techPower) {
            console.log(`✅ Found tech power in cache: ${spellName} -> ${techPower.name}`);
            content.innerHTML = formatTechPowerTooltip(techPower);
            adjustTooltipPosition(tooltip, event);
            return;
        }
        
        // Check imported tech powers
        const importedTechDetail = findImportedTechPowerDetail(spellName);
        if (importedTechDetail) {
            console.log(`✅ Found tech power in imported data: ${spellName}`);
            if (!techPowersCache) techPowersCache = {};
            const cacheKey = spellName.toLowerCase().trim();
            techPowersCache[cacheKey] = importedTechDetail;
            content.innerHTML = formatTechPowerTooltip(importedTechDetail);
            adjustTooltipPosition(tooltip, event);
            return;
        }
        
        // CRITICAL: Check force powers cache (for both players and NPCs) with fuzzy matching
        const forcePower = findForcePowerInCacheGlobal(spellName);
        if (forcePower) {
            console.log(`✅ Found force power in cache: ${spellName} -> ${forcePower.name}`);
            content.innerHTML = formatSpellTooltip(forcePower);
            adjustTooltipPosition(tooltip, event);
            return;
        }
        
        // Check imported force powers
        const importedForceDetail = findImportedForcePowerDetail(spellName);
        if (importedForceDetail) {
            console.log(`✅ Found force power in imported data: ${spellName}`);
            if (!forcePowersCache) forcePowersCache = {};
            const cacheKey = spellName.toLowerCase().trim();
            forcePowersCache[cacheKey] = importedForceDetail;
            content.innerHTML = formatSpellTooltip(importedForceDetail);
            adjustTooltipPosition(tooltip, event);
            return;
        }
        
        // For Star Wars style, we've already checked tech/force, so continue to spell lookup
        // For NPCs, if we get here, the power wasn't found in tech/force caches
        
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

// Show attack tooltip on hover (for NPC attacks)
function showAttackTooltip(description, event) {
    const tooltip = document.getElementById('spellTooltip');
    const content = document.getElementById('spellTooltipContent');
    
    if (!tooltip || !content) return;
    
    if (spellTooltipTimeout) {
        clearTimeout(spellTooltipTimeout);
        spellTooltipTimeout = null;
    }
    
    // Format the tooltip content
    content.innerHTML = `<div style="padding: 15px; max-width: 400px;">
        <div style="font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(description)}</div>
    </div>`;
    
    tooltip.style.display = 'block';
    tooltip.style.zIndex = '99999';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';
    
    // Adjust position if tooltip goes off screen
    adjustTooltipPosition(tooltip, event);
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

// ==================== EQUIPMENT TOOLTIPS ====================

function showItemTooltip(itemName, itemType, event) {
    const tooltip = document.getElementById('spellTooltip');
    const content = document.getElementById('spellTooltipContent');
    
    if (!tooltip || !content) return;
    
    if (spellTooltipTimeout) {
        clearTimeout(spellTooltipTimeout);
        spellTooltipTimeout = null;
    }
    
    // Show loading state
    content.innerHTML = `<div style="text-align: center; opacity: 0.7; padding: 20px;">⏳ Loading ${itemName}...</div>`;
    tooltip.style.display = 'block';
    tooltip.style.zIndex = '99999';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';
    
    // Load item data and display
    const cacheKey = itemName.toLowerCase().trim();
    let item = null;
    
    switch(itemType) {
        case 'weapon':
            if (!weaponsLoaded) loadWeapons();
            item = weaponsCache[cacheKey];
            if (item) {
                content.innerHTML = formatWeaponTooltip(item);
                adjustTooltipPosition(tooltip, event);
            } else {
                content.innerHTML = `<div style="text-align: center; color: #ffaa44; padding: 20px;">⚔️ ${itemName}<br><span style="font-size: 12px; opacity: 0.8;">Not found in database</span></div>`;
            }
            break;
        case 'armor':
            if (!armorLoaded) loadArmor();
            item = armorCache[cacheKey];
            if (item) {
                content.innerHTML = formatArmorTooltip(item);
                adjustTooltipPosition(tooltip, event);
            } else {
                content.innerHTML = `<div style="text-align: center; color: #ffaa44; padding: 20px;">🛡️ ${itemName}<br><span style="font-size: 12px; opacity: 0.8;">Not found in database</span></div>`;
            }
            break;
        case 'feat':
            if (!featsLoaded) loadFeats();
            item = featsCache[cacheKey];
            if (item) {
                content.innerHTML = formatFeatTooltip(item);
                adjustTooltipPosition(tooltip, event);
            } else {
                content.innerHTML = `<div style="text-align: center; color: #ffaa44; padding: 20px;">⭐ ${itemName}<br><span style="font-size: 12px; opacity: 0.8;">Not found in database</span></div>`;
            }
            break;
        case 'gear':
            if (!gearLoaded) loadGear();
            item = gearCache[cacheKey];
            if (item) {
                content.innerHTML = formatGearTooltip(item);
                adjustTooltipPosition(tooltip, event);
            } else {
                content.innerHTML = `<div style="text-align: center; color: #ffaa44; padding: 20px;">🎒 ${itemName}<br><span style="font-size: 12px; opacity: 0.8;">Not found in database</span></div>`;
            }
            break;
        case 'item':
            if (!itemsLoaded) loadItems();
            item = itemsCache[cacheKey];
            if (item) {
                content.innerHTML = formatItemTooltip(item);
                adjustTooltipPosition(tooltip, event);
            } else {
                content.innerHTML = `<div style="text-align: center; color: #ffaa44; padding: 20px;">📦 ${itemName}<br><span style="font-size: 12px; opacity: 0.8;">Not found in database</span></div>`;
            }
            break;
        case 'maneuver':
            if (!maneuversLoaded) loadManeuvers();
            item = maneuversCache[cacheKey];
            if (item) {
                content.innerHTML = formatManeuverTooltip(item);
                adjustTooltipPosition(tooltip, event);
            } else {
                content.innerHTML = `<div style="text-align: center; color: #ffaa44; padding: 20px;">🎯 ${itemName}<br><span style="font-size: 12px; opacity: 0.8;">Not found in database</span></div>`;
            }
            break;
    }
}

function formatWeaponTooltip(weapon) {
    const name = weapon.name || '';
    const type = weapon.type || '';
    const damage = weapon.damage || '';
    const properties = weapon.properties || '';
    const cost = weapon.cost || '';
    const weight = weapon.weight || '';
    const description = weapon.description || '';
    
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #ff4444; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #ff4444;">⚔️ ${escapeHtml(name)}</div>
            ${type ? `<div style="font-size: 12px; opacity: 0.8;">${escapeHtml(type)}</div>` : ''}
        </div>
    `;
    
    if (damage) {
        html += `<div style="padding: 8px; margin-bottom: 8px; background: rgba(255,68,68,0.15); border-left: 3px solid #ff4444; border-radius: 5px;">
            <strong>Damage:</strong> ${escapeHtml(damage)}
        </div>`;
    }
    
    const details = [];
    if (properties) details.push(`<strong>Properties:</strong> ${escapeHtml(properties)}`);
    if (cost) details.push(`<strong>Cost:</strong> ${cost} credits`);
    if (weight) details.push(`<strong>Weight:</strong> ${weight} lbs`);
    
    if (details.length > 0) {
        html += `<div style="font-size: 12px; margin-bottom: 8px; line-height: 1.4;">${details.join('<br>')}</div>`;
    }
    
    if (description) {
        html += `<div style="font-size: 12px; margin-top: 8px; line-height: 1.6; white-space: pre-line;">${escapeHtml(description)}</div>`;
    }
    
    return html;
}

function formatArmorTooltip(armor) {
    const name = armor.name || '';
    const type = armor.type || '';
    const ac = armor.ac || '';
    const properties = armor.properties || '';
    const cost = armor.cost || '';
    const weight = armor.weight || '';
    const stealth = armor.stealth || '';
    const description = armor.description || '';
    
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #4a9eff; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #4a9eff;">🛡️ ${escapeHtml(name)}</div>
            ${type ? `<div style="font-size: 12px; opacity: 0.8;">${escapeHtml(type)}</div>` : ''}
        </div>
    `;
    
    if (ac) {
        html += `<div style="padding: 8px; margin-bottom: 8px; background: rgba(74,158,255,0.15); border-left: 3px solid #4a9eff; border-radius: 5px;">
            <strong>Armor Class:</strong> ${escapeHtml(ac)}
        </div>`;
    }
    
    const details = [];
    if (properties) details.push(`<strong>Properties:</strong> ${escapeHtml(properties)}`);
    if (stealth && stealth !== '-') details.push(`<strong>Stealth:</strong> ${escapeHtml(stealth)}`);
    if (cost) details.push(`<strong>Cost:</strong> ${cost} credits`);
    if (weight) details.push(`<strong>Weight:</strong> ${weight} lbs`);
    
    if (details.length > 0) {
        html += `<div style="font-size: 12px; margin-bottom: 8px; line-height: 1.4;">${details.join('<br>')}</div>`;
    }
    
    if (description) {
        html += `<div style="font-size: 12px; margin-top: 8px; line-height: 1.6; white-space: pre-line;">${escapeHtml(description)}</div>`;
    }
    
    return html;
}

function formatFeatTooltip(feat) {
    const name = feat.Name || feat.name || '';
    const abilityIncrease = feat.AbilityScoreIncrease || feat.abilityScoreIncrease || '';
    const prerequisite = feat.Prerequisite || feat.prerequisite || '';
    const description = feat.Description || feat.description || '';
    const source = feat.Source || feat.source || '';
    
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #ffaa44; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #ffaa44;">⭐ ${escapeHtml(name)}</div>
        </div>
    `;
    
    const details = [];
    if (abilityIncrease && abilityIncrease !== '-') {
        details.push(`<strong>Ability Score Increase:</strong> ${escapeHtml(abilityIncrease)}`);
    }
    if (prerequisite) {
        details.push(`<strong>Prerequisite:</strong> ${escapeHtml(prerequisite)}`);
    }
    if (source) {
        details.push(`<strong>Source:</strong> ${escapeHtml(source)}`);
    }
    
    if (details.length > 0) {
        html += `<div style="font-size: 12px; margin-bottom: 8px; line-height: 1.4;">${details.join('<br>')}</div>`;
    }
    
    if (description) {
        html += `<div style="font-size: 12px; margin-top: 8px; line-height: 1.6; white-space: pre-line;">${escapeHtml(description)}</div>`;
    }
    
    return html;
}

function formatGearTooltip(gear) {
    const name = gear.Name || gear.name || '';
    const category = gear.Category || gear.category || '';
    const cost = gear.Cost || gear.cost || '';
    const weight = gear['Weight(lb)'] || gear.weight || '';
    const description = gear.Description || gear.description || '';
    const source = gear.Source || gear.source || '';
    
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #44ff44; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #44ff44;">🎒 ${escapeHtml(name)}</div>
            ${category ? `<div style="font-size: 12px; opacity: 0.8;">${escapeHtml(category)}</div>` : ''}
        </div>
    `;
    
    const details = [];
    if (cost) details.push(`<strong>Cost:</strong> ${cost} credits`);
    if (weight) details.push(`<strong>Weight:</strong> ${weight} lbs`);
    if (source) details.push(`<strong>Source:</strong> ${escapeHtml(source)}`);
    
    if (details.length > 0) {
        html += `<div style="font-size: 12px; margin-bottom: 8px; line-height: 1.4;">${details.join('<br>')}</div>`;
    }
    
    if (description) {
        html += `<div style="font-size: 12px; margin-top: 8px; line-height: 1.6; white-space: pre-line;">${escapeHtml(description)}</div>`;
    }
    
    return html;
}

function formatItemTooltip(item) {
    const name = item.Name || item.name || '';
    const type = item.Type || item.type || '';
    const subtype = item.Subtype || item.subtype || '';
    const rarity = item.Rarity || item.rarity || '';
    const description = item.Descrption || item.Description || item.description || '';
    const source = item.source || item.Source || '';
    
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #aa88ff; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #aa88ff;">📦 ${escapeHtml(name)}</div>
            ${type ? `<div style="font-size: 12px; opacity: 0.8;">${escapeHtml(type)}${subtype ? ` - ${escapeHtml(subtype)}` : ''}</div>` : ''}
        </div>
    `;
    
    const details = [];
    if (rarity) details.push(`<strong>Rarity:</strong> ${escapeHtml(rarity)}`);
    if (source) details.push(`<strong>Source:</strong> ${escapeHtml(source)}`);
    
    if (details.length > 0) {
        html += `<div style="font-size: 12px; margin-bottom: 8px; line-height: 1.4;">${details.join('<br>')}</div>`;
    }
    
    if (description) {
        html += `<div style="font-size: 12px; margin-top: 8px; line-height: 1.6; white-space: pre-line;">${escapeHtml(description)}</div>`;
    }
    
    return html;
}

function formatManeuverTooltip(maneuver) {
    const name = maneuver.Name || maneuver.name || '';
    const prerequisite = maneuver.Prerequisite || maneuver.prerequisite || '';
    const description = maneuver.Description || maneuver.description || '';
    const source = maneuver.Source || maneuver.source || '';
    
    let html = `
        <div style="text-align: center; margin-bottom: 10px; border-bottom: 2px solid #ff6b6b; padding-bottom: 8px;">
            <div style="font-size: 18px; font-weight: bold; color: #ff6b6b;">🎯 ${escapeHtml(name)}</div>
        </div>
    `;
    
    const details = [];
    if (prerequisite) {
        details.push(`<strong>Prerequisite:</strong> ${escapeHtml(prerequisite)}`);
    }
    if (source) {
        details.push(`<strong>Source:</strong> ${escapeHtml(source)}`);
    }
    
    if (details.length > 0) {
        html += `<div style="font-size: 12px; margin-bottom: 8px; line-height: 1.4;">${details.join('<br>')}</div>`;
    }
    
    if (description) {
        html += `<div style="font-size: 12px; margin-top: 8px; line-height: 1.6; white-space: pre-line;">${escapeHtml(description)}</div>`;
    }
    
    return html;
}

// Ability Check Rolling
function rollAbilityCheck(ability, modifier, characterName) {
    const mod = (typeof modifier === 'number' && !isNaN(modifier)) ? modifier : 0;
    console.log(`🎲 Rolling ${ability.toUpperCase()} check for ${characterName}`);
    console.log(`   Modifier: ${mod}`);
    
    // Roll 1d20
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + mod;
    
    console.log(`   Roll: ${roll} + ${mod} = ${total}`);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({
            type: 'RollAbilityCheck',
            character_name: characterName,
            ability: ability,
            roll: roll,
            modifier: mod,
            total: total
        });
    } else {
        const abilityNatText = roll === 20 ? ' ✨ NATURAL 20!' : (roll === 1 ? ' ❌ NATURAL 1!' : '');
        addRollEntry(`🎲 ${characterName} rolled ${ability.toUpperCase()} check: ${roll} ${mod >= 0 ? '+' : ''}${mod} = ${total}${abilityNatText}`, roll === 20, roll === 1);
    }
}

// Saving Throw Rolling
function rollSavingThrow(ability, modifier, characterName) {
    const mod = (typeof modifier === 'number' && !isNaN(modifier)) ? modifier : 0;
    console.log(`🛡️ Rolling ${ability.toUpperCase()} save for ${characterName}`);
    console.log(`   Save Modifier: ${mod}`);
    
    // Roll 1d20
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + mod;
    
    console.log(`   Roll: ${roll} + ${mod} = ${total}`);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({
            type: 'RollSavingThrow',
            character_name: characterName,
            ability: ability,
            roll: roll,
            modifier: mod,
            total: total
        });
    } else {
        const saveNatText = roll === 20 ? ' ✨ NATURAL 20!' : (roll === 1 ? ' ❌ NATURAL 1!' : '');
        addRollEntry(`🛡️ ${characterName} rolled ${ability.toUpperCase()} save: ${roll} ${mod >= 0 ? '+' : ''}${mod} = ${total}${saveNatText}`, roll === 20, roll === 1);
    }
}

// Setup event delegation for character sheet roll buttons (ability, skill, save, attack) so they work and show in rolls log
function setupCharacterSheetRollHandlers(container) {
    if (!container) return;
    if (container._sheetRollHandlerAttached) return;
    container._sheetRollHandlerAttached = true;
    container.addEventListener('click', function(e) {
        const el = e.target.closest('[data-sheet-roll]');
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        const kind = el.getAttribute('data-sheet-roll');
        const charName = el.getAttribute('data-char-name') || '';
        if (!charName) return;
        if (kind === 'ability') {
            const ab = el.getAttribute('data-ability');
            const mod = parseInt(el.getAttribute('data-mod'), 10);
            if (ab != null) rollAbilityCheck(ab, isNaN(mod) ? 0 : mod, charName);
        } else if (kind === 'skill') {
            const skillName = el.getAttribute('data-skill-name') || '';
            const mod = parseInt(el.getAttribute('data-mod'), 10);
            rollSkill(skillName, isNaN(mod) ? 0 : mod, charName);
        } else if (kind === 'save') {
            const ab = el.getAttribute('data-ability');
            const mod = parseInt(el.getAttribute('data-mod'), 10);
            if (ab != null) rollSavingThrow(ab, isNaN(mod) ? 0 : mod, charName);
        } else if (kind === 'attack') {
            const weapon = el.getAttribute('data-weapon') || '';
            const toHit = parseInt(el.getAttribute('data-to-hit'), 10);
            const damage = el.getAttribute('data-damage') || '';
            const dmgType = el.getAttribute('data-damage-type') || '';
            rollAttack(weapon, isNaN(toHit) ? 0 : toHit, damage, dmgType, charName);
        }
    }, true);
}

// Setup event delegation for dice roll buttons
function setupDiceRollButtons(container) {
    console.log('🔧 Setting up dice roll buttons...');
    const diceContainer = container.querySelector('.dice-roll-container');
    if (!diceContainer) {
        console.warn('⚠️ Dice roll container not found!');
        return;
    }
    
    console.log('✅ Found dice roll container:', diceContainer);
    const characterName = diceContainer.getAttribute('data-character-name');
    console.log('📝 Character name:', characterName);
    
    // Remove any existing listeners to prevent duplicates
    const newContainer = diceContainer.cloneNode(true);
    diceContainer.parentNode.replaceChild(newContainer, diceContainer);
    
    // Use event delegation - listen for clicks on dice buttons
    newContainer.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const button = e.target.closest('.dice-roll-button');
        if (!button) {
            console.log('❌ Clicked element is not a dice button');
            return;
        }
        
        const sides = parseInt(button.getAttribute('data-sides'));
        const charName = newContainer.getAttribute('data-character-name');
        
        console.log(`🎲 Dice button clicked: D${sides} for ${charName}`);
        
        if (sides && charName) {
            rollFlatDice(sides, charName);
        } else {
            console.error('❌ Missing sides or character name:', { sides, charName });
        }
    });
    
    console.log('✅ Dice roll buttons setup complete');
}

// Roll a flat dice (D4, D6, D8, D10, D12, D20, D100)
function rollFlatDice(sides, characterName) {
    console.log(`🎲 Rolling D${sides} for ${characterName}`);
    
    if (!sides || !characterName) {
        console.error('❌ Invalid parameters:', { sides, characterName });
        return;
    }
    
    // Roll the dice
    const roll = Math.floor(Math.random() * sides) + 1;
    
    console.log(`   Roll: ${roll} (D${sides})`);
    
    // Do NOT add to log here - we add once when we receive AbilityCheckRolled from server (avoids duplicate entries)
    // Broadcast to all players via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            sendMessage({
                type: 'RollAbilityCheck',
                character_name: characterName,
                ability: `D${sides}`,
                roll: roll,
                modifier: 0,
                total: roll
            });
            console.log(`✅ Dice roll sent to server: D${sides} = ${roll}`);
        } catch (e) {
            console.error('❌ Error sending dice roll to server:', e);
        }
    } else {
        // Offline: add to log only when we can't rely on server echo
        addRollEntry(`🎲 ${characterName} rolled D${sides}: ${roll}`, false, false);
    }
}

// Skill Check Rolling
function rollSkill(skillName, modifier, characterName) {
    const mod = (typeof modifier === 'number' && !isNaN(modifier)) ? modifier : 0;
    console.log(`🎯 Rolling ${skillName} for ${characterName}`);
    console.log(`   Modifier: ${mod}`);
    
    // Roll 1d20
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + mod;
    
    console.log(`   Roll: ${roll} + ${mod} = ${total}`);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({
            type: 'RollSkill',
            character_name: characterName,
            skill: skillName,
            roll: roll,
            modifier: mod,
            total: total
        });
    } else {
        const skillNatText = roll === 20 ? ' ✨ NATURAL 20!' : (roll === 1 ? ' ❌ NATURAL 1!' : '');
        addRollEntry(`🎯 ${characterName} rolled ${skillName}: ${roll} ${mod >= 0 ? '+' : ''}${mod} = ${total}${skillNatText}`, roll === 20, roll === 1);
    }
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

// Roll dice from an action (used by custom enemy Actions section). Call with index into window.__customEnemyActionsSheet.
function rollActionFromSheet(index) {
    const list = window.__customEnemyActionsSheet;
    if (!list || !list[index]) return;
    const a = list[index];
    const name = a.name || 'Action';
    const desc = a.description || '';
    const diceMatch = desc.match(/(\d+)d(\d+)([+-]\d+)?/i);
    if (diceMatch) {
        const notation = diceMatch[0];
        const result = rollDice(notation);
        addLogEntry(`${name}: ${notation} → ${result.breakdown} = ${result.total}`, 'damage');
    } else {
        addLogEntry(desc ? `${name}: ${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}` : name, 'info');
    }
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
    
    if (ws && ws.readyState === WebSocket.OPEN) {
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
    } else {
        const hitDisplay = `${toHitRoll} ${toHitMod >= 0 ? '+' : ''}${toHitMod}`;
        const isFail = toHitRoll === 1;
        const critText = isCrit ? ' 🎉 CRITICAL HIT! ✨ NATURAL 20!' : (isFail ? ' ❌ CRITICAL MISS! NATURAL 1!' : '');
        addRollEntry(`⚔️ ${characterName} attacks with ${weaponName}: To Hit ${hitDisplay} = ${toHitTotal} | Damage: ${damageDisplay} ${damageType}${critText}`, isCrit, isFail);
    }
}

// Build dice roll section for character sheet
function buildDiceRollSection(char, charData) {
    const charName = charData?.name || char.name;
    const escapedName = escapeJs(charName);
    
    let html = `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #aa88ff;">🎲 Dice Rolls <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
        <div class="dice-roll-container" data-character-name="${escapedName}" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">`;
    
    const diceTypes = [
        { sides: 4, label: 'D4', color: '#4a9eff' },
        { sides: 6, label: 'D6', color: '#44ff44' },
        { sides: 8, label: 'D8', color: '#ffaa44' },
        { sides: 10, label: 'D10', color: '#ff4444' },
        { sides: 12, label: 'D12', color: '#aa88ff' },
        { sides: 20, label: 'D20', color: '#ff6b6b' },
        { sides: 100, label: 'D100', color: '#00d4ff' }
    ];
    
    diceTypes.forEach(die => {
        const colorRgb = die.sides === 4 ? '74,158,255' : 
                        die.sides === 6 ? '68,255,68' : 
                        die.sides === 8 ? '255,170,68' : 
                        die.sides === 10 ? '255,68,68' : 
                        die.sides === 12 ? '170,136,255' : 
                        die.sides === 20 ? '255,107,107' : '0,212,255';
        
        html += `<div class="dice-roll-button" data-sides="${die.sides}" style="
            padding: 12px; 
            background: rgba(${colorRgb},0.15); 
            border: 2px solid ${die.color}; 
            border-radius: 5px; 
            text-align: center; 
            cursor: pointer; 
            transition: all 0.2s;
            font-weight: bold;
            font-size: 14px;
        " onmouseover="this.style.background='rgba(${colorRgb},0.3)'; this.style.transform='scale(1.05)'" onmouseleave="this.style.background='rgba(${colorRgb},0.15)'; this.style.transform='scale(1)'">
            ${die.label}
        </div>`;
    });
    
    html += `</div></div>`;
    
    return html;
}

// Build saving throws section for character sheet
function buildSavingThrowsSection(char, charData) {
    const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
    const calcMod = (score) => Math.floor((score - 10) / 2);
    
    // Detect if this is a Star Wars character
    const isStarWars = charData && (charData.species || (Array.isArray(charData.classes) && charData.baseAbilityScores));
    
    // Get ability modifiers and proficiency bonus
    let abilityMods = {};
    let profBonus = 0;
    
    if (isStarWars && charData.baseAbilityScores) {
        // Star Wars format
        const abilityNames = { Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha' };
        Object.entries(charData.baseAbilityScores).forEach(([name, score]) => {
            const ab = abilityNames[name];
            if (ab) {
                abilityMods[ab] = calcMod(score);
            }
        });
        profBonus = charData.proficiency_bonus || char.proficiency_bonus || 2;
    } else if (charData.abilities) {
        // D&D format
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
            if (charData.abilities[ab]) {
                abilityMods[ab] = charData.abilities[ab].mod;
            }
        });
        profBonus = charData.proficiency_bonus || char.proficiency_bonus || 2;
    } else {
        // Fallback to basic character data
        abilityMods = {
            str: calcMod(char.strength),
            dex: calcMod(char.dexterity),
            con: calcMod(char.constitution),
            int: calcMod(char.intelligence),
            wis: calcMod(char.wisdom),
            cha: calcMod(char.charisma)
        };
        profBonus = char.proficiency_bonus || 2;
    }
    
    // Get saving throw proficiencies
    const savingThrowProficiencies = {};
    if (charData.saving_throw_proficiencies) {
        // If explicitly defined
        charData.saving_throw_proficiencies.forEach(ab => {
            savingThrowProficiencies[ab.toLowerCase()] = true;
        });
    } else if (charData.abilities) {
        // D&D format - check each ability
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
            if (charData.abilities[ab] && charData.abilities[ab].save_proficient) {
                savingThrowProficiencies[ab] = true;
            }
        });
    }
    
    const abilityLabels = {
        str: 'Strength',
        dex: 'Dexterity',
        con: 'Constitution',
        int: 'Intelligence',
        wis: 'Wisdom',
        cha: 'Charisma'
    };
    
    let html = `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #ffaa44;">🛡️ Saving Throws <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">`;
    
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ab => {
        const baseMod = abilityMods[ab] || 0;
        const isProficient = savingThrowProficiencies[ab] || false;
        const saveMod = isProficient ? baseMod + profBonus : baseMod;
        
        const profSymbol = isProficient ? '●' : '○';
        const profColor = isProficient ? '#44ff44' : '#888';
        
        const charName = charData?.name || char.name;
        const escapedName = escapeJs(charName);
        const abilityName = abilityLabels[ab];
        
        html += `<div data-sheet-roll="save" data-ability="${ab}" data-mod="${saveMod}" data-char-name="${escapedName}" style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 3px; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center;" onmouseover="this.style.background='rgba(255,170,68,0.15)'; this.style.transform='translateX(5px)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.transform='translateX(0)'">
            <span style="font-size: 13px;">
                <span style="color: ${profColor}; margin-right: 5px;">${profSymbol}</span>
                ${abilityName}
            </span>
            <span style="font-weight: bold; color: #ffaa44;">${formatMod(saveMod)}</span>
        </div>`;
    });
    
    html += `</div>
        <div style="font-size: 11px; opacity: 0.6; margin-top: 10px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 3px;">
            <strong>Legend:</strong> 
            <span style="color: #44ff44;">● Proficient</span> | 
            <span style="color: #888;">○ Not Proficient</span>
        </div>
    </div>`;
    
    return html;
}

// Build skills section for character sheet
function buildSkillsSection(char, charData) {
    const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
    const calcMod = (score) => Math.floor((score - 10) / 2);
    
    // Detect if this is a Star Wars character
    const isStarWars = charData && (charData.species || (Array.isArray(charData.classes) && charData.baseAbilityScores));
    
    // Define skills based on game system
    let skillsByAbility;
    if (isStarWars) {
        // Star Wars 5e skills
        skillsByAbility = {
            str: [
                { key: 'athletics', name: 'Athletics' }
            ],
            dex: [
                { key: 'acrobatics', name: 'Acrobatics' },
                { key: 'sleight_of_hand', name: 'Sleight of Hand' },
                { key: 'stealth', name: 'Stealth' }
            ],
            int: [
                { key: 'investigation', name: 'Investigation' },
                { key: 'lore', name: 'Lore' },
                { key: 'nature', name: 'Nature' },
                { key: 'piloting', name: 'Piloting' },
                { key: 'technology', name: 'Technology' }
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
    } else {
        // D&D 5e skills
        skillsByAbility = {
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
    }
    
    let html = `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
        <h4 style="color: #ffaa44;">🎯 Skills <span style="font-size: 12px; opacity: 0.6;">(Click to roll!)</span></h4>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">`;
    
    const safeMod = (m) => (typeof m === 'number' && !isNaN(m)) ? m : 0;
    let strMod, dexMod, intMod, wisMod, chaMod;
    if (isStarWars && charData?.baseAbilityScores) {
        const ab = charData.baseAbilityScores;
        strMod = safeMod(calcMod(ab.Strength));
        dexMod = safeMod(calcMod(ab.Dexterity));
        intMod = safeMod(calcMod(ab.Intelligence));
        wisMod = safeMod(calcMod(ab.Wisdom));
        chaMod = safeMod(calcMod(ab.Charisma));
    } else {
        strMod = safeMod(charData?.abilities?.str?.mod ?? calcMod(char.strength));
        dexMod = safeMod(charData?.abilities?.dex?.mod ?? calcMod(char.dexterity));
        intMod = safeMod(charData?.abilities?.int?.mod ?? calcMod(char.intelligence));
        wisMod = safeMod(charData?.abilities?.wis?.mod ?? calcMod(char.wisdom));
        chaMod = safeMod(charData?.abilities?.cha?.mod ?? calcMod(char.charisma));
    }
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
                skillMod = safeMod(charData.skills[skill.key].mod);
                isProficient = charData.skills[skill.key].proficient || false;
                hasExpertise = charData.skills[skill.key].expertise || false;
            } else {
                skillMod = safeMod(baseMod);
            }
            
            const profSymbol = hasExpertise ? '◆' : (isProficient ? '●' : '○');
            const profColor = hasExpertise ? '#ffaa44' : (isProficient ? '#44ff44' : '#888');
            
            const charName = charData?.name || char.name;
            const escapedCharName = escapeJs(charName);
            const escapedSkillName = escapeJs(skill.name);
            html += `<div data-sheet-roll="skill" data-skill-name="${escapedSkillName}" data-mod="${skillMod}" data-char-name="${escapedCharName}" style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 3px; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center;" onmouseover="this.style.background='rgba(74,158,255,0.15)'; this.style.transform='translateX(5px)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.transform='translateX(0)'">
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
                <p style="font-size: 11px; opacity: 0.8;">${escapeHtml(char.class || '')} Level ${Math.max(1, Number(char.level) || 1)}</p>
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
    
    // CRITICAL: Get character and parse character_data BEFORE placing token
    const char = characters.find(c => c.id === charId);
    if (!char) {
        console.error(`❌ Character ${charId} not found in characters array!`);
        alert('Character not found!');
        return;
    }
    
    // Parse character_data to find size using comprehensive extraction
    let tokenSize = 1.0; // Default
    if (char.character_data) {
        try {
            const charData = JSON.parse(char.character_data);
            console.log(`🔍 Reading character data for ${charName} to find size...`);
            console.log(`🔍 Character data structure:`, {
                keys: Object.keys(charData),
                hasSize: !!charData.size,
                hasSpecies: !!charData.species,
                hasRace: !!charData.race,
                speciesType: typeof charData.species,
                speciesValue: charData.species
            });
            
            // Use the comprehensive extraction function
            const sizeStr = extractSizeFromCharacterData(charData);
            
            if (sizeStr) {
                if (sizeStr === 'large') {
                    tokenSize = 2.0;
                } else if (sizeStr === 'huge') {
                    tokenSize = 4.0;
                } else if (sizeStr === 'gargantuan') {
                    tokenSize = 8.0;
                }
                console.log(`✅ Found size in character sheet: "${sizeStr}" -> ${tokenSize} squares`);
            } else {
                console.log(`⚠️ No size found in character_data for ${charName} - using default 1.0`);
                console.log(`   Full character_data (first 500 chars):`, JSON.stringify(charData).substring(0, 500));
            }
        } catch (e) {
            console.error(`❌ Could not parse character_data for ${charName}:`, e);
            console.error(`   character_data value:`, char.character_data?.substring(0, 200));
        }
    } else {
        console.log(`⚠️ Character ${charName} has no character_data - using default size 1.0`);
    }
    
    console.log(`🎯 Placing player token ${charName} (${charId}) with FINAL size: ${tokenSize}`);
    sendMessage({
        type: 'PlaceToken',
        entity_id: charId,
        entity_type: 'Player',
        x: x,
        y: y,
        size: tokenSize
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
    // DM can always view. Players can view any character sheet so they can choose/change
    // who to play as (open list, view a character, click "Select This Character").
    if (isDM) { /* always allow */ }
    else if (char.id === myCharacterId) { /* own character, allow */ }
    else {
        // Player viewing another character: allow so they can select them to play as
        isSelectionMode = true;
    }
    
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
            // Ensure resolved level is on the data object (from Roll20 attribs, top-level, or classes) so sheet always shows correct level
            if (currentViewingCharacterData && typeof currentViewingCharacterData === 'object') {
                const resolvedLevel = getLevelFromCharacterData(currentViewingCharacterData, char);
                currentViewingCharacterData.level = Math.max(1, resolvedLevel);
            }
        } catch (e) {
            console.error('Error parsing character data:', e);
        }
    }
    
    renderCharacterSheetContent();
    
    // Show/hide the "Open in New Window" and "Level Up (Update from JSON)" buttons (only for players viewing their own sheet)
    const shouldShowOwnSheetButtons = !isSelectionMode && char && char.id === myCharacterId;
    const openBtn = document.getElementById('openSheetInNewWindowBtn');
    if (openBtn) {
        openBtn.style.display = shouldShowOwnSheetButtons ? 'block' : 'none';
    }
    const updateJsonBtn = document.getElementById('updateCharacterFromJsonBtn');
    if (updateJsonBtn) {
        updateJsonBtn.style.display = shouldShowOwnSheetButtons ? 'block' : 'none';
    }
    
    // Show/hide the "Link Discord" button (only for players viewing their own sheet)
    const linkDiscordBtn = document.getElementById('linkDiscordBtn');
    if (linkDiscordBtn) {
        // Show button for players viewing their own sheet OR for DM viewing any character
        const shouldShow = (!isSelectionMode && char && char.id === myCharacterId) || (isDM && !isSelectionMode);
        linkDiscordBtn.style.display = shouldShow ? 'block' : 'none';
        console.log('🔗 Link Discord button visibility:', shouldShow, 'isDM:', isDM, 'char.id:', char?.id, 'myCharacterId:', myCharacterId);
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
            case 'actionFromSheet':
                if (typeof params.index === 'number') rollActionFromSheet(params.index);
                break;
            case 'addLogEntry':
                if (params.text != null) addLogEntry(params.text, params.type || 'info');
                break;
            case 'resetLegendaryActions':
                if (params.enemyId != null && params.storageKey != null) resetLegendaryActions(params.enemyId, params.storageKey);
                break;
            case 'flatDice':
                if (params.sides != null && params.characterName != null) rollFlatDice(params.sides, params.characterName);
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
        // Load equipment data
        loadAllEquipment();
    }
    
    if (characterEditMode) {
        sheetTitleEl.textContent = `Editing: ${char.name}`;
        contentEl.innerHTML = buildCharacterEditForm(char, charData);
    } else {
        sheetTitleEl.textContent = getCharacterSheetTitle(char, charData);
    if (charData) {
            const html = buildDetailedCharacterSheet(char, charData);
            contentEl.innerHTML = html;
            
            setupCharacterSheetRollHandlers(contentEl);
            setTimeout(() => {
                setupDiceRollButtons(contentEl);
            }, 100);
            
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

// Resolve level from any character data shape. Prefer char.level when provided (user-editable source of truth).
function getLevelFromCharacterData(data, charFallback) {
    const charLv = charFallback && (typeof charFallback.level === 'number' ? charFallback.level : parseInt(charFallback.level, 10));
    if (!isNaN(charLv) && charLv >= 1) return Math.max(1, charLv);
    if (data && Array.isArray(data.attribs)) {
        for (let i = 0; i < data.attribs.length; i++) {
            const a = data.attribs[i];
            if (!a) continue;
            const name = String(a.name || '').trim();
            if (name === 'level') {
                const v = a.current != null && a.current !== '' ? a.current : a.max;
                const n = typeof v === 'number' ? (isNaN(v) ? 0 : v) : parseInt(String(v), 10);
                if (!isNaN(n) && n >= 0) return Math.max(1, n);
                break;
            }
        }
        for (let i = 0; i < data.attribs.length; i++) {
            const a = data.attribs[i];
            if (!a) continue;
            const name = String(a.name || '').trim();
            if (name === 'base_level') {
                const v = a.current != null && a.current !== '' ? a.current : a.max;
                const n = typeof v === 'number' ? (isNaN(v) ? 0 : v) : parseInt(String(v), 10);
                if (!isNaN(n) && n >= 0) return Math.max(1, n);
                break;
            }
        }
    }
    if (data) {
        const top = typeof data.level === 'number' ? data.level : parseInt(data.level, 10);
        if (!isNaN(top) && top > 0) return top;
        if (Array.isArray(data.classes) && data.classes.length > 0) {
            const sum = data.classes.reduce((s, cls) => s + (Number(cls.levels) || 1), 0);
            if (sum > 0) return sum;
        }
    }
    return (charLv > 0 ? charLv : null) ?? 1;
}

// SW5e: count tech powers (from classes and top-level)
function countTechPowers(charData) {
    if (!charData) return 0;
    var n = 0;
    if (Array.isArray(charData.classes)) {
        charData.classes.forEach(function(cls) {
            if (Array.isArray(cls.techPowers)) n += cls.techPowers.length;
            if (Array.isArray(cls.techPowerDetails)) n += cls.techPowerDetails.length;
        });
    }
    if (Array.isArray(charData.techPowers)) n += charData.techPowers.length;
    if (Array.isArray(charData.techPowerDetails)) n += charData.techPowerDetails.length;
    return n;
}

// SW5e: get Engineer class level. Check attribs, char.level, charData.level, classes. Infer level 2 if stored 1 but has 5+ tech powers.
function getEngineerLevelFromCharData(charData, charFallback) {
    if (!charData || !Array.isArray(charData.classes)) return 0;
    var sum = 0;
    for (let i = 0; i < charData.classes.length; i++) {
        var c = charData.classes[i];
        if (!c) continue;
        var name = String(c.name || '').trim().toLowerCase();
        var baseName = (name.split(/\s+/)[0] || name).trim();
        if (baseName !== 'engineer') continue;
        var lv = c.levels != null ? (typeof c.levels === 'number' ? c.levels : parseInt(c.levels, 10)) : (c.level != null ? (typeof c.level === 'number' ? c.level : parseInt(c.level, 10)) : 0);
        if (!isNaN(lv) && lv > 0) sum += lv;
    }
    var firstClassBase = (String(charData.classes[0].name || '').trim().toLowerCase().split(/\s+/)[0] || '').trim();
    if (charData.classes.length === 1 && firstClassBase === 'engineer') {
        var candidate = sum;
        if (Array.isArray(charData.attribs)) {
            for (let i = 0; i < charData.attribs.length; i++) {
                var a = charData.attribs[i];
                if (!a) continue;
                var n = String(a.name || '').trim().toLowerCase();
                if (n === 'engineer_level' || n === 'class_level') {
                    var v = a.current != null && a.current !== '' ? a.current : a.max;
                    var num = parseInt(v, 10);
                    if (!isNaN(num) && num >= 1 && num > candidate) candidate = num;
                }
            }
        }
        var charLv = charFallback && (typeof charFallback.level === 'number' ? charFallback.level : parseInt(charFallback.level, 10));
        if (!isNaN(charLv) && charLv >= 1 && charLv > candidate) candidate = charLv;
        var dataLv = typeof charData.level === 'number' ? charData.level : parseInt(charData.level, 10);
        if (!isNaN(dataLv) && dataLv >= 1 && dataLv > candidate) candidate = dataLv;
        if (candidate > sum) sum = candidate;
        if (sum === 1 && countTechPowers(charData) >= 5) sum = 2;
    }
    return sum;
}

// SW5e: tech points = engineer level * 2 + Intelligence modifier (Engineer lv2 INT 17 = 7). charFallback optional for correct level.
function getCalculatedTechPointsMax(charData, charFallback) {
    if (!charData) return 0;
    var engineerLevel = getEngineerLevelFromCharData(charData, charFallback);
    if (engineerLevel < 1) return 0;
    if (engineerLevel === 1 && Array.isArray(charData.classes) && charData.classes.length === 1) {
        var single = charData.classes[0];
        var singleBase = (String(single.name || '').trim().toLowerCase().split(/\s+/)[0] || '').trim();
        if (single && singleBase === 'engineer') {
            var topLevel = typeof charData.level === 'number' ? charData.level : parseInt(charData.level, 10);
            if (!isNaN(topLevel) && topLevel > 1) engineerLevel = topLevel;
            if (charFallback) {
                var cl = typeof charFallback.level === 'number' ? charFallback.level : parseInt(charFallback.level, 10);
                if (!isNaN(cl) && cl > engineerLevel) engineerLevel = cl;
            }
        }
    }
    var intScore = 10;
    if (charData.baseAbilityScores && typeof charData.baseAbilityScores.Intelligence === 'number') intScore = charData.baseAbilityScores.Intelligence;
    else if (charData.abilities && charData.abilities.int && typeof charData.abilities.int.score === 'number') intScore = charData.abilities.int.score;
    else if (Array.isArray(charData.attribs)) {
        for (let i = 0; i < charData.attribs.length; i++) {
            const a = charData.attribs[i];
            if (a && String(a.name || '').trim().toLowerCase() === 'intelligence') {
                const v = a.current != null && a.current !== '' ? a.current : a.max;
                const n = parseInt(v, 10);
                if (!isNaN(n)) intScore = n;
                break;
            }
        }
    }
    var intMod = Math.floor((intScore - 10) / 2);
    return Math.max(1, engineerLevel * 2 + intMod);
}

// Get tech points { max, current } from character data. For SW5e Engineers we use formula: engineer level*2 + Int mod. Pass char when available so char.level can fix wrong stored level.
function getTechPointsFromCharData(charData, charFallback) {
    if (!charData) return { max: 0, current: 0 };
    var engineerLevel = getEngineerLevelFromCharData(charData, charFallback);
    var calculatedMax = (engineerLevel >= 1) ? getCalculatedTechPointsMax(charData, charFallback) : 0;
    var max = 0, current = 0, expended = 0;
    if (charData.techPoints && typeof charData.techPoints.max === 'number') {
        max = Math.max(0, charData.techPoints.max);
        expended = charData.techPoints._expended || 0;
        current = charData.techPoints.current != null ? charData.techPoints.current : Math.max(0, max - expended);
    } else if (Array.isArray(charData.attribs)) {
        for (let i = 0; i < charData.attribs.length; i++) {
            const a = charData.attribs[i];
            if (!a) continue;
            const n = String(a.name || '').trim();
            if (n === 'tech_power_points_total') {
                const v = a.current != null && a.current !== '' ? a.current : a.max;
                max = Math.max(0, parseInt(v, 10) || 0);
            } else if (n === 'tech_power_points_expended') {
                const v = a.current != null && a.current !== '' ? a.current : a.max;
                expended = Math.max(0, parseInt(v, 10) || 0);
            }
        }
        current = Math.max(0, max - expended);
    }
    if (calculatedMax > 0) {
        max = calculatedMax;
        current = Math.min(current, max);
    } else if (max === 0) {
        max = 0;
        current = 0;
    }
    return { max: max, current: Math.max(0, Math.min(current, max)) };
}

// Test tech points calculation (run in console: testTechPointsCalc())
window.testTechPointsCalc = function testTechPointsCalc() {
    var charData = {
        classes: [{ name: 'Engineer 2', levels: 2, techPowers: ['a'], techPowerDetails: [{ name: 'Detonator' }, { name: 'Echo Blast' }, { name: 'Electroshock' }] }],
        baseAbilityScores: { Intelligence: 17 },
        level: 2
    };
    var char = { level: 2 };
    var pts = getTechPointsFromCharData(charData, char);
    var ok = pts.max === 7 && pts.current === 7;
    console.log('Tech points test (Engineer lv2, INT 17): expected 7/7, got', pts.current + '/' + pts.max, ok ? 'PASS' : 'FAIL');
    return ok;
};

// SW5e: true if character has any force powers (so we only show/calculate force points when they do)
function hasForcePowers(charData) {
    if (!charData) return false;
    if (Array.isArray(charData.forcePowers) && charData.forcePowers.length > 0) return true;
    if (Array.isArray(charData.forcePowerDetails) && charData.forcePowerDetails.length > 0) return true;
    if (Array.isArray(charData.classes)) {
        for (let i = 0; i < charData.classes.length; i++) {
            var c = charData.classes[i];
            if (c && Array.isArray(c.forcePowers) && c.forcePowers.length > 0) return true;
        }
    }
    return false;
}

// SW5e: force points = level * 2 + (higher of Cha/Wis modifier) when not in JSON; returns 0 if no force powers
function getCalculatedForcePointsMax(charData) {
    if (!charData || !hasForcePowers(charData)) return 0;
    var level = getLevelFromCharacterData(charData, null);
    if (!level || level < 1) return 0;
    var cha = 10, wis = 10;
    if (charData.baseAbilityScores) {
        if (typeof charData.baseAbilityScores.Charisma === 'number') cha = charData.baseAbilityScores.Charisma;
        if (typeof charData.baseAbilityScores.Wisdom === 'number') wis = charData.baseAbilityScores.Wisdom;
    } else if (charData.abilities) {
        if (charData.abilities.cha && typeof charData.abilities.cha.score === 'number') cha = charData.abilities.cha.score;
        if (charData.abilities.wis && typeof charData.abilities.wis.score === 'number') wis = charData.abilities.wis.score;
    }
    var mod = Math.max(Math.floor((cha - 10) / 2), Math.floor((wis - 10) / 2));
    return Math.max(1, level * 2 + mod);
}

// Get force points { max, current } from character data. If character has no force powers, always return 0.
function getForcePointsFromCharData(charData) {
    if (!charData) return { max: 0, current: 0 };
    if (!hasForcePowers(charData)) return { max: 0, current: 0 };
    var max = 0, current = 0, expended = 0;
    if (charData.forcePoints && typeof charData.forcePoints.max === 'number') {
        max = Math.max(0, charData.forcePoints.max);
        expended = charData.forcePoints._expended || 0;
        current = charData.forcePoints.current != null ? charData.forcePoints.current : Math.max(0, max - expended);
    } else if (Array.isArray(charData.attribs)) {
        for (let i = 0; i < charData.attribs.length; i++) {
            const a = charData.attribs[i];
            if (!a) continue;
            const n = String(a.name || '').trim();
            if (n === 'force_power_points_total') {
                const v = a.current != null && a.current !== '' ? a.current : a.max;
                max = Math.max(0, parseInt(v, 10) || 0);
            } else if (n === 'force_power_points_expended') {
                const v = a.current != null && a.current !== '' ? a.current : a.max;
                expended = Math.max(0, parseInt(v, 10) || 0);
            }
        }
        current = Math.max(0, max - expended);
    }
    if (max === 0) {
        max = getCalculatedForcePointsMax(charData);
        current = max;
    }
    return { max: max, current: Math.max(0, Math.min(current, max)) };
}

// Use one tech point (decrement current, persist, refresh UI)
function useTechPoint() {
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter || !myCharacter.character_data) return;
    try {
        const fullData = JSON.parse(myCharacter.character_data);
        const data = fullData.character || fullData;
        const pts = getTechPointsFromCharData(data, myCharacter);
        if (pts.max === 0 || pts.current <= 0) {
            addLogEntry('No tech points remaining.', 'info');
            return;
        }
        if (!data.techPoints) data.techPoints = { max: pts.max, current: pts.current, _expended: pts.max - pts.current };
        data.techPoints.current = Math.max(0, data.techPoints.current - 1);
        data.techPoints._expended = data.techPoints.max - data.techPoints.current;
        myCharacter.character_data = JSON.stringify(fullData.character ? fullData : data);
        syncCharacterToServer(myCharacter);
        populatePlayerActionBar();
        if (currentViewingCharacter && currentViewingCharacter.id === myCharacterId) renderCharacterSheetContent();
    } catch (e) { console.error('useTechPoint:', e); }
}

// Use one force point
function useForcePoint() {
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter || !myCharacter.character_data) return;
    try {
        const fullData = JSON.parse(myCharacter.character_data);
        const data = fullData.character || fullData;
        const pts = getForcePointsFromCharData(data);
        if (pts.max === 0 || pts.current <= 0) {
            addLogEntry('No force points remaining.', 'info');
            return;
        }
        if (!data.forcePoints) data.forcePoints = { max: pts.max, current: pts.current, _expended: pts.max - pts.current };
        data.forcePoints.current = Math.max(0, data.forcePoints.current - 1);
        data.forcePoints._expended = data.forcePoints.max - data.forcePoints.current;
        myCharacter.character_data = JSON.stringify(fullData.character ? fullData : data);
        syncCharacterToServer(myCharacter);
        populatePlayerActionBar();
        if (currentViewingCharacter && currentViewingCharacter.id === myCharacterId) renderCharacterSheetContent();
        addLogEntry((data.name || myCharacter.name) + ' used 1 force point (' + data.forcePoints.current + '/' + data.forcePoints.max + ' remaining)', 'info');
    } catch (e) { console.error('useForcePoint:', e); }
}

// Restore all tech points (short/long rest)
function restoreTechPoints() {
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter || !myCharacter.character_data) return;
    try {
        const fullData = JSON.parse(myCharacter.character_data);
        const data = fullData.character || fullData;
        const pts = getTechPointsFromCharData(data, myCharacter);
        if (pts.max === 0) return;
        if (!data.techPoints) data.techPoints = { max: pts.max, current: pts.max, _expended: 0 };
        data.techPoints.max = pts.max;
        data.techPoints.current = pts.max;
        data.techPoints._expended = 0;
        myCharacter.character_data = JSON.stringify(fullData.character ? fullData : data);
        syncCharacterToServer(myCharacter);
        populatePlayerActionBar();
        if (currentViewingCharacter && currentViewingCharacter.id === myCharacterId) renderCharacterSheetContent();
    } catch (e) { console.error('restoreTechPoints:', e); }
}

// Restore all force points
function restoreForcePoints() {
    const myCharacter = characters.find(c => c.id === myCharacterId);
    if (!myCharacter || !myCharacter.character_data) return;
    try {
        const fullData = JSON.parse(myCharacter.character_data);
        const data = fullData.character || fullData;
        const pts = getForcePointsFromCharData(data);
        if (pts.max === 0) return;
        if (!data.forcePoints) data.forcePoints = { max: pts.max, current: pts.max, _expended: 0 };
        data.forcePoints.current = data.forcePoints.max;
        data.forcePoints._expended = 0;
        myCharacter.character_data = JSON.stringify(fullData.character ? fullData : data);
        syncCharacterToServer(myCharacter);
        populatePlayerActionBar();
        if (currentViewingCharacter && currentViewingCharacter.id === myCharacterId) renderCharacterSheetContent();
        addLogEntry((data.name || myCharacter.name) + ' restored all force points (' + data.forcePoints.max + ')', 'info');
    } catch (e) { console.error('restoreForcePoints:', e); }
}

function syncCharacterToServer(char) {
    if (!char) return;
    const payload = buildCharacterUpdatePayload(char);
    if (payload && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'UpdateCharacter', character: payload }));
    }
}

// Always resolve level from the character's stored character_data when showing the sheet (source of truth)
function getResolvedLevelForSheet(char, charData) {
    if (!char) return 1;
    if (char.character_data && typeof char.character_data === 'string') {
        try {
            const parsed = JSON.parse(char.character_data);
            const data = parsed && parsed.character ? parsed.character : parsed;
            const level = getLevelFromCharacterData(data, char);
            if (level > 0) return Math.max(1, level);
        } catch (e) {
            // fall through to charData/char fallback
        }
    }
    return Math.max(1, getLevelFromCharacterData(charData, char));
}

// Clean character display name: strip surrounding quotes, prefer "Name / Alias" → show alias
function getCharacterDisplayName(rawName, fallback) {
    if (rawName == null || rawName === '') return (fallback != null && fallback !== '') ? String(fallback) : 'Character';
    let s = String(rawName).trim();
    if (s.startsWith('"')) s = s.slice(1);
    if (s.endsWith('"')) s = s.slice(0, -1);
    s = s.trim();
    if (s.includes(' / ')) {
        const parts = s.split(/\s*\/\s*/);
        const after = parts[parts.length - 1].trim();
        if (after) return after;
    }
    return s || (fallback != null && fallback !== '') ? String(fallback) : 'Character';
}

function getCharacterSheetTitle(char, charData) {
    if (!char) return 'Character Sheet';

    const data = charData || null;
    const isStarWars = data && (data.species || (Array.isArray(data.classes) && data.baseAbilityScores));
    const level = getResolvedLevelForSheet(char, data);

    if (isStarWars && data) {
        const displayName = getCharacterDisplayName(data.name || char.name, char.name);
        const classDisplay = (data.class || char.class || '').trim();
        if (classDisplay) {
            return `${displayName} — ${classDisplay} • Level ${level}`;
        }
        return `${displayName} — Level ${level}`;
    }

    if (data && (data.class || data.level != null || (data.attribs && data.attribs.length > 0))) {
        const subclassText = data.subclass ? ` (${data.subclass})` : '';
        const name = getCharacterDisplayName(data.name || char.name, char.name);
        return `${name} — ${data.class || char.class} Level ${level}${subclassText}`;
    }

    const name = getCharacterDisplayName(char.name, 'Character');
    return `${name} — ${char.class || ''} Level ${level}`;
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
    
    // Check for inspiration in character_data if it exists
    let hasInspiration = false;
    if (char.character_data) {
        try {
            const charData = JSON.parse(char.character_data);
            const data = charData.character || charData;
            hasInspiration = data.inspiration === true;
        } catch (e) {
            // Ignore parse errors
        }
    }
    const escapedCharId = escapeJs(char.id);
    
    let html = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">
            <div class="panel" style="padding: 15px;">
                <h4 style="color: #4a9eff; margin-bottom: 10px;">Basic Info</h4>
                <div class="token-stat"><span>Player:</span><span>${char.player_name}</span></div>
                <div class="token-stat"><span>Class:</span><span>${char.class}</span></div>
                <div class="token-stat"><span>Level:</span><span>${getResolvedLevelForSheet(char, null)}</span></div>
                <div class="token-stat"><span>Proficiency:</span><span>+${char.proficiency_bonus}</span></div>
                <div class="token-stat" style="margin-top: 10px;">
                    <span>Inspiration:</span>
                    <button id="inspirationToggle-${char.id.replace(/[^a-zA-Z0-9]/g, '_')}" 
                            data-character-id="${escapedCharId}"
                            onclick="toggleInspiration(this.dataset.characterId)" 
                            style="padding: 5px 15px; border: 2px solid ${hasInspiration ? '#44ff44' : '#888'}; border-radius: 5px; background: ${hasInspiration ? 'rgba(68, 255, 68, 0.2)' : 'rgba(136, 136, 136, 0.2)'}; color: ${hasInspiration ? '#44ff44' : '#888'}; cursor: pointer; font-weight: bold; transition: all 0.2s;"
                            onmouseover="this.style.transform='scale(1.05)'" 
                            onmouseout="this.style.transform='scale(1)'">
                        ${hasInspiration ? '✨ Has Inspiration' : '○ No Inspiration'}
                    </button>
                </div>
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
    
    // Basic Info & HP — level always from char.character_data (source of truth) then charData/char
    let className, level, maxHP;
    level = getResolvedLevelForSheet(char, charData);
    if (isStarWars) {
        const classDisplay = (charData.class || char.class || '').trim();
        const multiClass = charData.classes && charData.classes.length > 1;
        className = multiClass && charData.classes
            ? charData.classes.map(c => `${(c.name || '').trim()} ${c.levels || 1}`).join(' / ')
            : (classDisplay || (charData.classes && charData.classes[0] ? (charData.classes[0].name || '').trim() : ''));
        maxHP = charData.tweaks?.hitPoints?.maximum?.override ||
               (charData.classes && charData.classes[0]?.hitPoints?.length > 0 ?
                charData.classes[0].hitPoints.reduce((sum, hp) => sum + hp, 0) : null) || char.max_hp;
    } else {
        className = charData.class + (charData.subclass ? ` (${charData.subclass})` : '');
        maxHP = charData.hp?.max || char.max_hp;
    }
    
    // Get inspiration value (default to false if not set)
    const hasInspiration = charData.inspiration === true;
    const escapedCharId = escapeJs(char.id);
    
    html += `<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px;">
        <div class="panel" style="padding: 15px;">
            <h4 style="color: #4a9eff;">🎭 Character Info</h4>
            <div class="token-stat"><span>Name:</span><span>${escapeHtml(getCharacterDisplayName(charData.name, char.name))}</span></div>
            <div class="token-stat"><span>Player:</span><span>${charData.player_name || char.player_name}</span></div>
            <div class="token-stat"><span>Class:</span><span>${className}</span></div>
            <div class="token-stat"><span>Level:</span><span>${level}</span></div>
            ${charData.species ? `<div class="token-stat"><span>Species:</span><span>${charData.species.name || charData.species}</span></div>` : ''}
            ${charData.background ? `<div class="token-stat"><span>Background:</span><span>${charData.background.name || charData.background}</span></div>` : ''}
            <div class="token-stat" style="margin-top: 10px;">
                <span>Inspiration:</span>
                <button id="inspirationToggle-${char.id.replace(/[^a-zA-Z0-9]/g, '_')}" 
                        data-character-id="${escapedCharId}"
                        onclick="toggleInspiration(this.dataset.characterId)" 
                        style="padding: 5px 15px; border: 2px solid ${hasInspiration ? '#44ff44' : '#888'}; border-radius: 5px; background: ${hasInspiration ? 'rgba(68, 255, 68, 0.2)' : 'rgba(136, 136, 136, 0.2)'}; color: ${hasInspiration ? '#44ff44' : '#888'}; cursor: pointer; font-weight: bold; transition: all 0.2s;"
                        onmouseover="this.style.transform='scale(1.05)'" 
                        onmouseout="this.style.transform='scale(1)'">
                    ${hasInspiration ? '✨ Has Inspiration' : '○ No Inspiration'}
                </button>
            </div>
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
                    <div data-sheet-roll="ability" data-ability="${ab}" data-mod="${mod}" data-char-name="${escapedName}" style="cursor: pointer; transition: all 0.2s;" onmouseover="this.style.color='#4a9eff'; this.style.transform='scale(1.1)'" onmouseout="this.style.color=''; this.style.transform='scale(1)'">
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
                    <div data-sheet-roll="ability" data-ability="${ab}" data-mod="${ability.mod}" data-char-name="${escapedName}" style="cursor: pointer; transition: all 0.2s;" onmouseover="this.style.color='#4a9eff'; this.style.transform='scale(1.1)'" onmouseout="this.style.color=''; this.style.transform='scale(1)'">
                        <div style="font-size: 24px; font-weight: bold;">${ability.score}</div>
                        <div style="font-size: 11px; opacity: 0.7; text-transform: uppercase;">${ab}</div>
                        <div style="font-size: 12px; margin-top: 5px;">${formatMod(ability.mod)}</div>
                    </div>
                    <div data-sheet-roll="save" data-ability="${ab}" data-mod="${ability.save}" data-char-name="${escapedName}" style="font-size: 11px; color: ${ability.save_proficient ? '#44ff44' : '#888'}; margin-top: 5px; cursor: pointer; padding: 3px; border-radius: 3px; transition: all 0.2s;" onmouseover="this.style.background='rgba(74,158,255,0.2)'; this.style.transform='scale(1.05)'" onmouseout="this.style.background=''; this.style.transform='scale(1)'">
                        ${ability.save_proficient ? '●' : '○'} Save: ${formatMod(ability.save)}
                    </div>
                </div>`;
            }
        });
        html += `</div></div>`;
    }
    
    // Dice Roll Section
    html += buildDiceRollSection(char, charData);
    
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
    
    // Saving Throws Section
    html += buildSavingThrowsSection(char, charData);
    
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
                
                html += `<div data-sheet-roll="attack" data-weapon="${escapedWeapon}" data-to-hit="${atk.to_hit}" data-damage="${escapedDamage}" data-damage-type="${escapedType}" data-char-name="${escapedName}" style="padding: 10px; margin: 5px 0; background: rgba(255,68,68,0.1); border-left: 3px solid #ff4444; border-radius: 3px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,68,68,0.25)'; this.style.transform='translateX(5px)'" onmouseout="this.style.background='rgba(255,68,68,0.1)'; this.style.transform='translateX(0)'">
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
    
    // Star Wars: Power Points tracker (tech / force) — always show so counters are visible
    if (isStarWars) {
        const techPts = getTechPointsFromCharData(charData, char);
        const forcePts = getForcePointsFromCharData(charData);
        html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
            <h4 style="color: #aa88ff;">📊 Power Points</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 15px; align-items: center;">`;
        html += `<div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: #00d4ff; font-weight: bold;">⚡ Tech:</span>
            <span style="font-size: 16px;">${techPts.current} / ${techPts.max}</span>
            ${char.id === myCharacterId ? `<button type="button" onclick="useTechPoint(); renderCharacterSheetContent();" style="padding: 4px 10px; font-size: 11px; background: rgba(0,212,255,0.3); border: 1px solid #00d4ff; border-radius: 4px; color: #fff; cursor: pointer;">Use 1</button>
            <button type="button" onclick="restoreTechPoints();" style="padding: 4px 10px; font-size: 11px; background: rgba(68,255,68,0.2); border: 1px solid #44ff44; border-radius: 4px; color: #fff; cursor: pointer;">Restore All</button>` : ''}
        </div>`;
        html += `<div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: #ff00ff; font-weight: bold;">✨ Force:</span>
            <span style="font-size: 16px;">${forcePts.current} / ${forcePts.max}</span>
            ${char.id === myCharacterId ? `<button type="button" onclick="useForcePoint(); renderCharacterSheetContent();" style="padding: 4px 10px; font-size: 11px; background: rgba(255,0,255,0.3); border: 1px solid #ff00ff; border-radius: 4px; color: #fff; cursor: pointer;">Use 1</button>
            <button type="button" onclick="restoreForcePoints();" style="padding: 4px 10px; font-size: 11px; background: rgba(68,255,68,0.2); border: 1px solid #44ff44; border-radius: 4px; color: #fff; cursor: pointer;">Restore All</button>` : ''}
        </div>`;
        html += `</div></div>`;
    }
    
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
        
        // Equipment with tooltips
        if (charData.equipment && charData.equipment.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ffaa44;">🎒 Equipment <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            charData.equipment.forEach(item => {
                const itemName = item.name || item;
                const escapedName = escapeJs(itemName);
                const equipped = item.equipped ? ' ⭐' : '';
                const quantity = item.quantity > 1 ? ` x${item.quantity}` : '';
                
                // Try to determine item type for tooltip
                let itemType = 'gear'; // default
                const nameLower = itemName.toLowerCase();
                if (weaponsCache[nameLower]) itemType = 'weapon';
                else if (armorCache[nameLower]) itemType = 'armor';
                else if (gearCache[nameLower]) itemType = 'gear';
                else if (itemsCache[nameLower]) itemType = 'item';
                
                html += `<div onmouseover="showItemTooltip('${escapedName}', '${itemType}', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(255,170,68,0.1); border-radius: 3px; font-size: 12px; border-left: 3px solid ${item.equipped ? '#ffaa44' : 'transparent'}; cursor: help; transition: all 0.2s;" onmouseenter="this.style.background='rgba(255,170,68,0.25)'; this.style.borderColor='#ffaa44'" onmouseleave="this.style.background='rgba(255,170,68,0.1)'; this.style.borderColor='${item.equipped ? '#ffaa44' : 'transparent'}'">
                    ${escapeHtml(itemName)}${quantity}${equipped}
                </div>`;
            });
            html += `</div></div>`;
        }
        
        // Feats with tooltips
        if (charData.feats && Array.isArray(charData.feats) && charData.feats.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ffaa44;">⭐ Feats <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            charData.feats.forEach(feat => {
                const featName = typeof feat === 'string' ? feat : (feat.name || feat.Name || '');
                if (!featName) return;
                const escapedName = escapeJs(featName);
                html += `<div onmouseover="showItemTooltip('${escapedName}', 'feat', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(255,170,68,0.2); border-radius: 3px; font-size: 12px; cursor: help; transition: all 0.2s; border: 1px solid transparent;" onmouseenter="this.style.background='rgba(255,170,68,0.4)'; this.style.borderColor='#ffaa44'" onmouseleave="this.style.background='rgba(255,170,68,0.2)'; this.style.borderColor='transparent'">${escapeHtml(featName)}</div>`;
            });
            html += `</div></div>`;
        }
        
        // Maneuvers with tooltips
        if (charData.maneuvers && Array.isArray(charData.maneuvers) && charData.maneuvers.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ff6b6b;">🎯 Maneuvers <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            charData.maneuvers.forEach(maneuver => {
                const maneuverName = typeof maneuver === 'string' ? maneuver : (maneuver.name || maneuver.Name || '');
                if (!maneuverName) return;
                const escapedName = escapeJs(maneuverName);
                html += `<div onmouseover="showItemTooltip('${escapedName}', 'maneuver', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(255,107,107,0.2); border-radius: 3px; font-size: 12px; cursor: help; transition: all 0.2s; border: 1px solid transparent;" onmouseenter="this.style.background='rgba(255,107,107,0.4)'; this.style.borderColor='#ff6b6b'" onmouseleave="this.style.background='rgba(255,107,107,0.2)'; this.style.borderColor='transparent'">${escapeHtml(maneuverName)}</div>`;
            });
            html += `</div></div>`;
        }
        
        // Weapons (if listed separately)
        if (charData.weapons && Array.isArray(charData.weapons) && charData.weapons.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #ff4444;">⚔️ Weapons <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            charData.weapons.forEach(weapon => {
                const weaponName = typeof weapon === 'string' ? weapon : (weapon.name || '');
                if (!weaponName) return;
                const escapedName = escapeJs(weaponName);
                html += `<div onmouseover="showItemTooltip('${escapedName}', 'weapon', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(255,68,68,0.2); border-radius: 3px; font-size: 12px; cursor: help; transition: all 0.2s; border: 1px solid transparent;" onmouseenter="this.style.background='rgba(255,68,68,0.4)'; this.style.borderColor='#ff4444'" onmouseleave="this.style.background='rgba(255,68,68,0.2)'; this.style.borderColor='transparent'">${escapeHtml(weaponName)}</div>`;
            });
            html += `</div></div>`;
        }
        
        // Armor (if listed separately)
        if (charData.armor && Array.isArray(charData.armor) && charData.armor.length > 0) {
            html += `<div class="panel" style="padding: 15px; margin-bottom: 15px;">
                <h4 style="color: #4a9eff;">🛡️ Armor <span style="font-size: 10px; opacity: 0.6;">(Hover for details)</span></h4>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">`;
            charData.armor.forEach(armor => {
                const armorName = typeof armor === 'string' ? armor : (armor.name || '');
                if (!armorName) return;
                const escapedName = escapeJs(armorName);
                html += `<div onmouseover="showItemTooltip('${escapedName}', 'armor', event)" onmouseout="hideSpellTooltip()" style="padding: 5px 10px; background: rgba(74,158,255,0.2); border-radius: 3px; font-size: 12px; cursor: help; transition: all 0.2s; border: 1px solid transparent;" onmouseenter="this.style.background='rgba(74,158,255,0.4)'; this.style.borderColor='#4a9eff'" onmouseleave="this.style.background='rgba(74,158,255,0.2)'; this.style.borderColor='transparent'">${escapeHtml(armorName)}</div>`;
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
        
        // Update header (use APP_UI_VERSION so version stays current)
        var v = (typeof APP_UI_VERSION !== 'undefined') ? APP_UI_VERSION : 'v29';
        document.querySelector('h1').innerHTML = '⭐ Gorgox Interactive <span id="appVersionBadge" style="background: #4a9eff; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px;">STAR WARS ' + v + '</span>';
    } else {
        // D&D theme - traditional fantasy green/gold
        root.style.setProperty('--primary-color', '#4CAF50');
        root.style.setProperty('--secondary-color', '#ff8800');
        root.style.setProperty('--accent-color', '#aa88ff');
        root.style.setProperty('--bg-color', '#1a1a1a');
        root.style.setProperty('--panel-bg', 'linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%)');
        
        var v = (typeof APP_UI_VERSION !== 'undefined') ? APP_UI_VERSION : 'v29';
        document.querySelector('h1').innerHTML = '🎲 Gorgox Interactive <span id="appVersionBadge" style="background: #ffaa00; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px;">' + v + '</span>';
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
    const resultEl = document.getElementById('initiativeRollResult');
    if (resultEl) resultEl.textContent = '';
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
    const resultEl = document.getElementById('initiativeRollResult');
    if (!inputEl) return;
    if (resultEl) resultEl.textContent = '';
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

    // Enhance existing participants with token data when available. Match by id only so multiple enemies (same entity_id) are not collapsed.
    combatState.participants.forEach(part => {
        const token = tokens.find(t => t && t.id === part.id);
        if (!token) return;
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

    // Ensure every non-player token appears as a combat participant (unless DM removed them with X)
    const removedSet = new Set(combatState.removedFromCombatIds || []);
    tokens.forEach(token => {
        if (!token) return;
        if (removedSet.has(token.id)) return; // DM removed this one — don't re-add
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
                    // Fallback: try NPC instance then generic name (same for DM and players so players see names)
                    const npcInstance = enemies.find(e => e.id === token.entity_id && (e.isNPC || e.npcData));
                    participantName = npcInstance ? npcInstance.name : 'Enemy';
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
                // Normalize key: lowercase, trim, normalize spaces (same as lookup)
                const key = raw.name.toLowerCase().trim().replace(/\s+/g, ' ');
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
            console.log(`📋 Sample tech power keys:`, Object.keys(techPowersCache).slice(0, 5));
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
                // Normalize key: lowercase, trim, normalize spaces (same as lookup)
                const key = raw.name.toLowerCase().trim().replace(/\s+/g, ' ');
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

// ==================== EQUIPMENT & ITEMS LOADING ====================

async function loadWeapons(force = false) {
    if (weaponsLoaded && !force) return;
    
    try {
        const url = '/static/data/weapons.json';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load weapons: ${response.status}`);
        }
        
        const data = await response.json();
        weaponsCache = {};
        
        if (Array.isArray(data)) {
            data.forEach(weapon => {
                if (weapon && weapon.name) {
                    const key = weapon.name.toLowerCase().trim();
                    weaponsCache[key] = weapon;
                }
            });
        }
        
        weaponsLoaded = true;
        console.log(`✅ Loaded ${Object.keys(weaponsCache).length} weapons`);
    } catch (e) {
        console.error('❌ Error loading weapons:', e);
    }
}

async function loadArmor(force = false) {
    if (armorLoaded && !force) return;
    
    try {
        const url = '/static/data/Armor.json';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load armor: ${response.status}`);
        }
        
        const data = await response.json();
        armorCache = {};
        
        if (Array.isArray(data)) {
            data.forEach(armor => {
                if (armor && armor.name) {
                    const key = armor.name.toLowerCase().trim();
                    armorCache[key] = armor;
                }
            });
        }
        
        armorLoaded = true;
        console.log(`✅ Loaded ${Object.keys(armorCache).length} armor items`);
    } catch (e) {
        console.error('❌ Error loading armor:', e);
    }
}

async function loadFeats(force = false) {
    if (featsLoaded && !force) return;
    
    try {
        const url = '/static/data/feats.json';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load feats: ${response.status}`);
        }
        
        const data = await response.json();
        featsCache = {};
        
        if (Array.isArray(data)) {
            data.forEach(feat => {
                if (feat && (feat.Name || feat.name)) {
                    const name = feat.Name || feat.name;
                    const key = name.toLowerCase().trim();
                    featsCache[key] = feat;
                }
            });
        }
        
        featsLoaded = true;
        console.log(`✅ Loaded ${Object.keys(featsCache).length} feats`);
    } catch (e) {
        console.error('❌ Error loading feats:', e);
    }
}

async function loadGear(force = false) {
    if (gearLoaded && !force) return;
    
    try {
        const url = '/static/data/gear.json';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load gear: ${response.status}`);
        }
        
        const data = await response.json();
        gearCache = {};
        
        if (Array.isArray(data)) {
            data.forEach(gear => {
                if (gear && (gear.Name || gear.name)) {
                    const name = gear.Name || gear.name;
                    const key = name.toLowerCase().trim();
                    gearCache[key] = gear;
                }
            });
        }
        
        gearLoaded = true;
        console.log(`✅ Loaded ${Object.keys(gearCache).length} gear items`);
    } catch (e) {
        console.error('❌ Error loading gear:', e);
    }
}

async function loadItems(force = false) {
    if (itemsLoaded && !force) return;
    
    try {
        const url = '/static/data/items.json';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load items: ${response.status}`);
        }
        
        const data = await response.json();
        itemsCache = {};
        
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item && (item.Name || item.name)) {
                    const name = item.Name || item.name;
                    const key = name.toLowerCase().trim();
                    itemsCache[key] = item;
                }
            });
        }
        
        itemsLoaded = true;
        console.log(`✅ Loaded ${Object.keys(itemsCache).length} items`);
    } catch (e) {
        console.error('❌ Error loading items:', e);
    }
}

async function loadManeuvers(force = false) {
    if (maneuversLoaded && !force) return;
    
    try {
        const url = '/static/data/maneuvers.json';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load maneuvers: ${response.status}`);
        }
        
        const data = await response.json();
        maneuversCache = {};
        
        if (Array.isArray(data)) {
            data.forEach(maneuver => {
                if (maneuver && (maneuver.Name || maneuver.name)) {
                    const name = maneuver.Name || maneuver.name;
                    const key = name.toLowerCase().trim();
                    maneuversCache[key] = maneuver;
                }
            });
        }
        
        maneuversLoaded = true;
        console.log(`✅ Loaded ${Object.keys(maneuversCache).length} maneuvers`);
    } catch (e) {
        console.error('❌ Error loading maneuvers:', e);
    }
}

async function loadConditions(force = false) {
    if (conditionsLoaded && !force) return;
    
    try {
        const url = '/static/data/conditions.json';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load conditions: ${response.status}`);
        }
        
        const data = await response.json();
        conditionsCache = {};
        
        if (Array.isArray(data)) {
            data.forEach(condition => {
                if (condition && (condition.Name || condition.name)) {
                    const name = condition.Name || condition.name;
                    const key = name.toLowerCase().trim();
                    conditionsCache[key] = condition;
                }
            });
        }
        
        conditionsLoaded = true;
        console.log(`✅ Loaded ${Object.keys(conditionsCache).length} conditions`);
    } catch (e) {
        console.error('❌ Error loading conditions:', e);
    }
}

// Load all equipment data
async function loadAllEquipment() {
    await Promise.all([
        loadWeapons(),
        loadArmor(),
        loadFeats(),
        loadGear(),
        loadItems(),
        loadManeuvers()
    ]);
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
                // Always calculate size - don't trust saved size, recalculate from entity data
                const tokenSize = getTokenSize(token.entity_id, token.entity_type);
                console.log(`📐 Restoring token ${token.entity_id} with calculated size: ${tokenSize}`);
                const displayName = token.display_name || (token.entity_type === 'Enemy' || token.entity_type === 'NPC' ? (enemies.find(e => e.id === token.entity_id)?.name) : undefined);
                sendMessage({
                    type: 'PlaceToken',
                    entity_id: token.entity_id,
                    entity_type: token.entity_type,
                    x: token.x,
                    y: token.y,
                    size: tokenSize,
                    display_name: displayName || undefined
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
let hpDamageSoundFile = null; // Store the HP damage sound filename
let hpDamageSoundEnabled = true; // Enable/disable HP damage sound

// Load saved sound preferences from localStorage
function loadCriticalRollSounds() {
    nat20SoundFile = localStorage.getItem('nat20SoundFile') || null;
    nat1SoundFile = localStorage.getItem('nat1SoundFile') || null;
    hpDamageSoundFile = localStorage.getItem('hpDamageSoundFile') || null;
    hpDamageSoundEnabled = localStorage.getItem('hpDamageSoundEnabled') !== 'false'; // Default to true
    
    console.log('🔊 Loaded critical roll sounds - Nat 20:', nat20SoundFile, 'Nat 1:', nat1SoundFile);
    console.log('💥 Loaded HP damage sound - File:', hpDamageSoundFile, 'Enabled:', hpDamageSoundEnabled);
    
    // Update display if settings modal is open
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.classList.contains('active')) {
        if (nat20SoundFile) {
            updateNat20SoundDisplay(nat20SoundFile);
        }
        if (nat1SoundFile) {
            updateNat1SoundDisplay(nat1SoundFile);
        }
        if (hpDamageSoundFile) {
            updateHpDamageSoundDisplay(hpDamageSoundFile);
        }
        // Update checkbox state
        const checkbox = document.getElementById('hpDamageSoundEnabled');
        if (checkbox) {
            checkbox.checked = hpDamageSoundEnabled;
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
    
    // Update HP damage sound checkbox
    const checkbox = document.getElementById('hpDamageSoundEnabled');
    if (checkbox) {
        checkbox.checked = hpDamageSoundEnabled;
    }
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

// ==================== HP DAMAGE SOUND ====================

function updateHpDamageSoundDisplay(filename) {
    const infoDiv = document.getElementById('hpDamageSoundInfo');
    const previewAudio = document.getElementById('hpDamageSoundPreview');
    
    if (infoDiv && filename) {
        infoDiv.textContent = `Current: ${filename}`;
        infoDiv.style.opacity = '1';
        infoDiv.style.color = '#ff6b6b';
        
        if (previewAudio) {
            previewAudio.src = `/static/sounds/${encodeURIComponent(filename)}`;
            previewAudio.style.display = 'block';
        }
    }
}

function toggleHpDamageSound() {
    const checkbox = document.getElementById('hpDamageSoundEnabled');
    if (checkbox) {
        hpDamageSoundEnabled = checkbox.checked;
        localStorage.setItem('hpDamageSoundEnabled', hpDamageSoundEnabled.toString());
        console.log('💥 HP damage sound', hpDamageSoundEnabled ? 'enabled' : 'disabled');
    }
}

async function uploadHpDamageSound() {
    if (!isDM) {
        alert('Only the DM can upload sounds!');
        return;
    }
    
    const fileInput = document.getElementById('hpDamageSoundFile');
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
        hpDamageSoundFile = filename;
        localStorage.setItem('hpDamageSoundFile', filename);
        
        console.log('✅ HP damage sound uploaded:', filename);
        updateHpDamageSoundDisplay(filename);
        
        // Clear file input
        fileInput.value = '';
        
        alert(`✅ HP damage sound uploaded successfully!\n\n${filename}\n\nNote: This sound will play when any character or enemy takes damage!`);
    } catch (e) {
        console.error('❌ Error uploading HP damage sound:', e);
        alert('Error uploading sound: ' + e.message);
    }
}

// Play HP damage sound - broadcasts to all clients if DM, or plays locally if player
async function playHpDamageSound() {
    console.log('💥 playHpDamageSound() called');
    
    // Ensure settings are loaded from localStorage (in case loadCriticalRollSounds hasn't run yet)
    if (hpDamageSoundFile === null || hpDamageSoundFile === undefined) {
        hpDamageSoundFile = localStorage.getItem('hpDamageSoundFile') || null;
    }
    if (hpDamageSoundEnabled === undefined) {
        const stored = localStorage.getItem('hpDamageSoundEnabled');
        hpDamageSoundEnabled = stored === null ? true : (stored !== 'false');
    }
    
    // Check if enabled
    if (!hpDamageSoundEnabled) {
        console.log('💥 HP damage sound is disabled, skipping');
        return;
    }
    
    // Check if sound file is configured
    if (!hpDamageSoundFile) {
        console.log('💥 No HP damage sound file configured, skipping');
        return;
    }
    
    console.log('💥 Playing HP damage sound:', hpDamageSoundFile, 'Enabled:', hpDamageSoundEnabled);
    
    // If DM, broadcast to all clients via WebSocket
    if (isDM && ws && ws.readyState === WebSocket.OPEN) {
        try {
            console.log('📤 DM broadcasting HP damage sound to all clients:', hpDamageSoundFile);
            
            // Load sound file and convert to base64
            const response = await fetch(`/static/sounds/${encodeURIComponent(hpDamageSoundFile)}`);
            if (!response.ok) {
                throw new Error(`Failed to load sound: ${response.status}`);
            }
            
            const blob = await response.blob();
            const reader = new FileReader();
            
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                const soundType = hpDamageSoundFile.split('.').pop() || 'mp3';
                
                // Broadcast to all clients via WebSocket
                sendMessage({
                    type: 'PlaySound',
                    sound_id: `hpdamage_${Date.now()}`,
                    sound_name: 'HP Damage',
                    sound_data: base64,
                    sound_type: soundType
                });
                
                console.log('✅ HP damage sound broadcast sent');
            };
            
            reader.readAsDataURL(blob);
        } catch (e) {
            console.error('❌ Error broadcasting HP damage sound:', e);
            // Fallback to local playback
            playHpDamageSoundLocally();
        }
    } else {
        // Not DM or WebSocket not open - play locally
        playHpDamageSoundLocally();
    }
}

function playHpDamageSoundLocally() {
    // Load from localStorage if not set
    const soundFile = hpDamageSoundFile || localStorage.getItem('hpDamageSoundFile');
    if (!soundFile) {
        console.log('💥 No HP damage sound file available for local playback');
        console.log('   💡 Tip: Go to Settings → HP Damage Sound and upload a sound file');
        return;
    }
    
    // Check if enabled
    const enabled = hpDamageSoundEnabled !== undefined ? hpDamageSoundEnabled : (localStorage.getItem('hpDamageSoundEnabled') !== 'false');
    if (!enabled) {
        console.log('💥 HP damage sound is disabled, skipping local playback');
        console.log('   💡 Tip: Go to Settings → HP Damage Sound and enable the checkbox');
        return;
    }
    
    const soundPath = `/static/sounds/${encodeURIComponent(soundFile)}`;
    console.log('💥 Attempting to play HP damage sound:', soundFile);
    console.log('   Full path:', soundPath);
    
    try {
        const audio = new Audio(soundPath);
        audio.volume = 0.5; // Slightly quieter than critical rolls
        
        // Add error handlers for better debugging
        audio.onerror = (e) => {
            console.error('❌ Audio element error:', e);
            console.error('   Sound file may not exist or path is incorrect');
            console.error('   Attempted path:', soundPath);
        };
        
        audio.onloadstart = () => {
            console.log('✅ Audio element started loading:', soundFile);
        };
        
        audio.oncanplay = () => {
            console.log('✅ Audio can play:', soundFile);
        };
        
        console.log('🎵 Playing HP damage sound locally:', soundFile);
        audio.play().then(() => {
            console.log('✅ HP damage sound started playing successfully');
        }).catch(e => {
            console.error('❌ Error playing HP damage sound:', e);
            console.error('   Error name:', e.name);
            console.error('   Error message:', e.message);
            console.error('   Sound file path:', soundPath);
            console.error('   💡 Tip: Check browser console for CORS or file not found errors');
        });
    } catch (e) {
        console.error('❌ Error creating HP damage sound audio:', e);
        console.error('   Sound file:', soundFile);
        console.error('   Sound path:', soundPath);
    }
}

function refreshApplication() {
    console.log('🔄 Refreshing game state (full sync from server)...');
    addLogEntry('🔄 Syncing with server (map, tokens, combat)...', 'info');
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        addLogEntry('⚠️ Not connected. Reconnect to sync.', 'warning');
        return;
    }
    
    // Single request that pushes full state – reliable for slow/high-latency connections
    sendMessage({ type: 'RequestFullState' });
    
    // Fallback requests in case server doesn't support RequestFullState
    if (currentMap && currentMap.id) {
        sendMessage({ type: 'LoadMap', map_id: currentMap.id, clear_tokens: false });
    }
    sendMessage({ type: 'ListCharacters' });
    
    // Also fetch from API for immediate update
    fetch(`/api/characters?style=${selectedStyle}`)
        .then(res => {
            if (res.ok) {
                return res.json();
            }
            throw new Error(`HTTP ${res.status}`);
        })
        .then(data => {
            console.log('✅ Received updated characters:', data.length);
            characters = data || [];
            renderCharacterList();
            
            // Update character HP in UI if viewing character sheet
            if (currentViewingCharacter) {
                const updatedChar = characters.find(c => c.id === currentViewingCharacter.id);
                if (updatedChar) {
                    currentViewingCharacter.current_hp = updatedChar.current_hp;
                    currentViewingCharacter.max_hp = updatedChar.max_hp;
                    renderCharacterSheetContent();
                }
            }
            
            // Update initiative list if in combat
            if (combatState.active) {
                updateInitiativeList();
            }
        })
        .catch(err => {
            console.error('❌ Error refreshing characters:', err);
        });
    
    // Request updated enemies (to get current HP)
    console.log('🔄 Requesting updated enemies...');
    sendMessage({ type: 'ListEnemies', style: selectedStyle });
    
    // Update token info if a token is selected
    if (selectedToken) {
        setTimeout(() => updateTokenInfo(), 800);
    }
    
    // Re-render after delay so slow connections have time to receive MapLoaded/TokenUpdate/CombatStarted
    setTimeout(() => {
        renderCanvas();
        updateInitiativeList();
        updateCombatStatus();
        addLogEntry('✅ Synced', 'success');
        console.log('✅ Game state refresh complete');
    }, 1500);
}

function autoConnect() {
    // Don't auto-connect if already connected
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('ℹ️ Already connected, skipping auto-connect');
        return false;
    }
    
    const savedPlayerName = localStorage.getItem('savedPlayerName');
    const savedIsDM = localStorage.getItem('savedIsDM');
    const savedStyle = localStorage.getItem('savedStyle');
    const autoReconnect = localStorage.getItem('autoReconnect');
    
    if (autoReconnect === 'true' && savedPlayerName && savedIsDM !== null) {
        console.log('🔄 Auto-reconnecting with saved credentials...');
        console.log('   Player:', savedPlayerName);
        console.log('   Is DM:', savedIsDM === 'true');
        console.log('   Style:', savedStyle || 'dnd');
        
        // Set form values (if elements exist)
        const playerNameInput = document.getElementById('playerName');
        const isDMCheckbox = document.getElementById('isDM');
        const styleSelector = document.getElementById('styleSelector');
        
        if (playerNameInput) playerNameInput.value = savedPlayerName;
        if (isDMCheckbox) isDMCheckbox.checked = savedIsDM === 'true';
        if (styleSelector && savedStyle) styleSelector.value = savedStyle;
        
        // Hide connection modal immediately (will be shown again if connection fails)
        const connectionModal = document.getElementById('connectionModal');
        if (connectionModal) {
            connectionModal.classList.remove('active');
            connectionModal.style.display = 'none';
        }
        
        // Perform connection
        performConnection(savedPlayerName, savedIsDM === 'true', savedStyle || 'dnd');
        
        return true;
    }
    
    return false;
}

function toggleInspiration(characterId) {
    const char = characters.find(c => c.id === characterId);
    if (!char) {
        console.error('Character not found:', characterId);
        return;
    }
    
    // Parse character_data
    let charData = null;
    let fullData = null;
    try {
        if (char.character_data) {
            fullData = JSON.parse(char.character_data);
            charData = fullData.character || fullData;
        }
    } catch (e) {
        console.error('Error parsing character_data:', e);
        return;
    }
    
    if (!charData) {
        // If no character_data exists, create a basic structure
        charData = {
            name: char.name,
            player_name: char.player_name
        };
        fullData = charData;
    }
    
    // Toggle inspiration
    const newInspirationValue = !(charData.inspiration === true);
    charData.inspiration = newInspirationValue;
    
    // Update fullData structure
    if (fullData.character) {
        fullData.character = charData;
    } else {
        fullData = charData;
    }
    
    // Update character object
    char.character_data = JSON.stringify(fullData);
    
    // Update the global characters array
    const index = characters.findIndex(c => c.id === characterId);
    if (index !== -1) {
        characters[index] = char;
    }
    
    // Update current viewing character if it's the same
    if (currentViewingCharacter && currentViewingCharacter.id === characterId) {
        currentViewingCharacter = char;
        currentViewingCharacterFullData = fullData;
        currentViewingCharacterData = charData;
    }
    
    // Send update to server
    const characterUpdate = buildCharacterUpdatePayload(char);
    if (characterUpdate && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "UpdateCharacter",
            character: characterUpdate
        }));
        console.log(`✅ Inspiration ${newInspirationValue ? 'granted' : 'removed'} for ${char.name}`);
    } else {
        console.warn('⚠️ WebSocket not available, inspiration change not synced to server');
    }
    
    // Update the button appearance
    const buttonId = `inspirationToggle-${characterId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const button = document.getElementById(buttonId);
    if (button) {
        button.textContent = newInspirationValue ? '✨ Has Inspiration' : '○ No Inspiration';
        button.style.borderColor = newInspirationValue ? '#44ff44' : '#888';
        button.style.background = newInspirationValue ? 'rgba(68, 255, 68, 0.2)' : 'rgba(136, 136, 136, 0.2)';
        button.style.color = newInspirationValue ? '#44ff44' : '#888';
    }
    
    // Refresh character sheet if it's currently open
    if (currentViewingCharacter && currentViewingCharacter.id === characterId) {
        renderCharacterSheetContent();
    }
}

