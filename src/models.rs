use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub player_name: String,
    pub class: String,
    pub level: i32,
    pub max_hp: i32,
    pub current_hp: i32,
    pub armor_class: i32,
    pub initiative_bonus: i32,
    pub strength: i32,
    pub dexterity: i32,
    pub constitution: i32,
    pub intelligence: i32,
    pub wisdom: i32,
    pub charisma: i32,
    pub speed: i32,
    pub proficiency_bonus: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character_data: Option<String>, // Full character JSON for detailed sheet
    #[serde(skip_serializing_if = "Option::is_none")]
    pub portrait_url: Option<String>, // Character portrait image (base64 or URL)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Enemy {
    pub id: String,
    pub name: String,
    pub creature_type: String,
    pub challenge_rating: f32,
    pub max_hp: i32,
    pub armor_class: i32,
    pub initiative_bonus: i32,
    pub strength: i32,
    pub dexterity: i32,
    pub constitution: i32,
    pub intelligence: i32,
    pub wisdom: i32,
    pub charisma: i32,
    pub speed: i32,
    pub actions: String, // JSON string of actions
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub portrait_url: Option<String>, // Enemy portrait image (base64 or URL)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnemyInstance {
    pub id: String,
    pub enemy_id: String,
    pub name: String, // e.g., "Goblin 1", "Goblin 2"
    pub current_hp: i32,
    pub max_hp: i32,
    pub armor_class: i32,
    pub initiative_bonus: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Map {
    pub id: String,
    pub name: String,
    pub image_path: String,
    pub grid_size: i32,
    pub width: i32,
    pub height: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_state: Option<String>, // JSON string containing tokens, HP values, etc.
}

impl Map {
    /// Strip `map_state` for WebSocket payloads (can be megabytes). Clients render from image + tokens.
    pub fn for_client_wire(&self) -> Self {
        Self {
            id: self.id.clone(),
            name: self.name.clone(),
            image_path: self.image_path.clone(),
            grid_size: self.grid_size,
            width: self.width,
            height: self.height,
            map_state: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub id: String,
    pub map_id: String,
    pub entity_id: String, // Character or Enemy instance ID
    pub entity_type: TokenType,
    pub x: f32,
    pub y: f32,
    pub size: f32, // Size in grid squares (1.0 = medium, 2.0 = large, etc.)
    pub image_url: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "displayName",
        alias = "name"
    )]
    pub display_name: Option<String>, // Name to show on the map (e.g. "Goblin 1")
    /// When true, non-DM clients should not draw this token (DM-only secrets; typically used for Object tokens).
    #[serde(default)]
    pub hidden_from_players: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum TokenType {
    Player,
    Enemy,
    NPC,
    Object,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatParticipant {
    pub id: String,
    pub entity_id: String,
    pub name: String,
    pub initiative: i32,
    pub initiative_bonus: i32,
    pub entity_type: TokenType,
    pub current_hp: i32,
    pub max_hp: i32,
    pub armor_class: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerConnection {
    pub session_id: String,
    pub player_name: String,
    pub character_id: Option<String>,
    pub is_dm: bool,
}

/// Region of the map (pixel coords) visible to non-DM clients when enabled
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerMapViewport {
    pub enabled: bool,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Default for PlayerMapViewport {
    fn default() -> Self {
        Self {
            enabled: false,
            x: 0.0,
            y: 0.0,
            width: 640.0,
            height: 480.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    // Connection
    Connect { player_name: String, is_dm: bool, style: String },
    SelectCharacter { character_id: String },
    
    // Map management (DM only)
    CreateMap { name: String, image_data: String, width: i32, height: i32 },
    SaveMap { map_id: String }, // Save current tokens, HP, and state to map
    ListMaps,
    LoadMap { map_id: String, clear_tokens: Option<bool> },
    DeleteMap { map_id: String },
    ClearMap, // Clear current map and all tokens
    
    // Token management
    PlaceToken {
        entity_id: String,
        entity_type: TokenType,
        x: f32,
        y: f32,
        size: Option<f32>,
        #[serde(default, alias = "displayName", alias = "name")]
        display_name: Option<String>,
        #[serde(default)]
        image_url: Option<String>,
        #[serde(default)]
        hidden_from_players: bool,
    },
    MoveToken { token_id: String, x: f32, y: f32 },
    RemoveToken { token_id: String },
    UpdateTokenSize { token_id: String, size: f32 },
    /// DM only: toggle object visibility for players (token must be Object).
    UpdateTokenHiddenFromPlayers {
        token_id: String,
        hidden_from_players: bool,
    },
    
    // Combat
    StartCombat { #[serde(default)] token_ids: Option<Vec<String>> },
    RollInitiative { entity_id: String, roll: i32, #[serde(default)] silent: bool, #[serde(default)] participant_id: Option<String> },
    NextTurn,
    EndCombat,
    RemoveFromCombat { participant_id: String },
    RequestShutdown, // DM only: request server to shut down gracefully
    RequestFullState, // Client wants full sync (map, tokens, characters, combat) without reconnecting
    DealDamage { target_id: String, damage: i32 },
    HealTarget { target_id: String, healing: i32 },
    
    // Character management
    ListCharacters,
    CreateCharacter { character: Character },
    UpdateCharacter { character: Character },
    DeleteCharacter { character_id: String },
    
    // Enemy management (DM only)
    CreateEnemy { enemy: Enemy },
    SpawnEnemy { enemy_id: String, instance_id: String, name: String },
    ListEnemies,
    DeleteEnemy { enemy_id: String },
    
    // Player map viewport (DM): fog-of-war style window for non-DM clients
    SetPlayerMapViewport {
        enabled: bool,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    },

    // Map settings
    MapSettingsChanged { grid_size: i32, width: i32, height: i32 },
    
    // Ruler tool
    RulerUpdate { start_x: Option<f32>, start_y: Option<f32>, end_x: Option<f32>, end_y: Option<f32> },
    
    // Measurement shapes (cone, circle, etc.)
    MeasurementShapeAdded { shape: serde_json::Value },
    ClearMeasurements,
    
    // Ping location
    PingLocation { x: f32, y: f32, player_name: String },
    
    // Discord integration - highlight character when Discord user speaks
    HighlightCharacter { character_id: String, discord_user_id: String, discord_username: String, duration: u32 },
    
    // Discord account linking - sync link from game to bot
    LinkDiscordAccount { character_id: String, discord_user_id: String, character_name: String },
    
    // Ability checks
    RollAbilityCheck { character_name: String, ability: String, roll: i32, modifier: i32, total: i32 },
    RollSavingThrow { character_name: String, ability: String, roll: i32, modifier: i32, total: i32 },
    RollSkill { character_name: String, skill: String, roll: i32, modifier: i32, total: i32 },
    RollAttack { character_name: String, weapon: String, to_hit_roll: i32, to_hit_mod: i32, to_hit_total: i32, damage: String, damage_type: String },
    
    // Custom spells (also used for Star Wars tech/force powers)
    SaveCustomSpell {
        id: String,
        name: String,
        level: i32,
        school: Option<String>,
        casting_time: Option<String>,
        range: Option<String>,
        components: Option<String>,
        duration: Option<String>,
        description: String,
        higher_level: Option<String>,
        save_type: Option<String>,
        damage: Option<String>,
        damage_type: Option<String>,
        ritual: bool,
        concentration: bool,
        power_type: Option<String>, // For Star Wars: 'tech' or 'force', for D&D: None
    },
    GetCustomSpell { name: String },
    GetAllCustomSpells,
    DeleteCustomSpell { id: String },
    
    // Sound effects
    PlaySound {
        sound_id: String,
        sound_name: String,
        sound_data: String, // Base64 encoded audio data
        sound_type: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    // Connection responses
    Connected { session_id: String, is_dm: bool },
    PlayerRole { is_dm: bool },
    PlayerJoined { player_name: String, is_dm: bool },
    PlayerLeft { player_name: String },
    
    // State updates
    GameStateUpdate { state: String },
    MapLoaded {
        map: Map,
        player_map_viewport: PlayerMapViewport,
    },
    PlayerMapViewportUpdated {
        enabled: bool,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    },
    MapCleared, // Map and tokens cleared
    TokenUpdate { tokens: Vec<Token> },
    
    // Combat updates
    CombatStarted { participants: Vec<CombatParticipant> },
    InitiativeRolled { entity_id: String, initiative: i32, #[serde(default)] silent: bool, #[serde(default)] participant_id: Option<String> },
    TurnChanged { current_turn: String, participant_name: String },
    CombatEnded,
    DamageDealt { target_id: String, damage: i32, new_hp: i32 },
    HealingApplied { target_id: String, healing: i32, new_hp: i32 },
    
    // Data responses
    CharacterList { characters: Vec<Character>, style: Option<String> },
    EnemyList { enemies: Vec<Enemy> },
    /// Lets all clients (especially players) map instance token entity_id → template portrait
    EnemyInstanceSpawned {
        instance_id: String,
        enemy_id: String,
        name: String,
        #[serde(default)]
        portrait_url: Option<String>,
        /// Full template `actions` JSON from DB (includes sheet_attacks) so tokens match DB even if client template cache is stale.
        #[serde(default)]
        actions: Option<String>,
    },
    MapList { maps: Vec<Map> },
    PlayerList { players: Vec<String> },
    
    // Map settings
    MapSettingsChanged { grid_size: i32, width: i32, height: i32 },
    
    // Ruler tool
    RulerUpdate { start_x: Option<f32>, start_y: Option<f32>, end_x: Option<f32>, end_y: Option<f32> },
    
    // Measurement shapes (cone, circle, etc.)
    MeasurementShapeAdded { shape: serde_json::Value },
    ClearMeasurements,
    
    // Ping location
    PingLocation { x: f32, y: f32, player_name: String },
    
    // Discord integration - highlight character when Discord user speaks
    HighlightCharacter { character_id: String, discord_user_id: String, discord_username: String, duration: u32 },
    
    // Ability checks
    AbilityCheckRolled { character_name: String, ability: String, roll: i32, modifier: i32, total: i32 },
    SavingThrowRolled { character_name: String, ability: String, roll: i32, modifier: i32, total: i32 },
    SkillRolled { character_name: String, skill: String, roll: i32, modifier: i32, total: i32 },
    AttackRolled { character_name: String, weapon: String, to_hit_roll: i32, to_hit_mod: i32, to_hit_total: i32, damage: String, damage_type: String },
    
    // Custom spells responses
    CustomSpellData { spell: Option<serde_json::Value> },
    AllCustomSpells { spells: Vec<serde_json::Value> },
    CustomSpellSaved { id: String },
    CustomSpellDeleted { id: String },
    
    // Sound effects
    SoundPlayed {
        sound_id: String,
        sound_name: String,
        sound_data: String, // Base64 encoded audio data
        sound_type: String,
    },
    
    // Errors
    Error { message: String },
}

