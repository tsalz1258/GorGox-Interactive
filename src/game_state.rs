use crate::combat::CombatState;
use crate::models::{
    Character, EnemyInstance, LogHistoryEntry, Map, PlayerConnection, PlayerMapViewport, Token,
};
use std::collections::HashMap;

const LOG_HISTORY_CAP: usize = 200;

#[derive(Debug, Clone)]
pub struct GameState {
    pub players: HashMap<String, PlayerConnection>,
    pub current_map: Option<Map>,
    pub tokens: Vec<Token>,
    pub characters: HashMap<String, Character>,
    pub enemy_instances: HashMap<String, EnemyInstance>,
    pub combat: CombatState,
    /// Region of the map (pixel coords) visible to non-DM clients when enabled
    pub player_map_viewport: PlayerMapViewport,
    /// Recent rolls/chat lines for late join / refresh
    pub log_history: Vec<LogHistoryEntry>,
    pub saved_enemies: Vec<serde_json::Value>,
    pub campaign_style: String,
    pub measurement_shapes: Vec<serde_json::Value>,
    pub session_extras: serde_json::Value,
    pub undo_history: Vec<(serde_json::Value, serde_json::Value)>,
    pub action_results: Vec<(String, Result<String, String>)>,
    pub snapshot_signatures: HashMap<String,u64>,
}

impl GameState {
    pub fn new() -> Self {
        Self {
            players: HashMap::new(),
            current_map: None,
            tokens: Vec::new(),
            characters: HashMap::new(),
            enemy_instances: HashMap::new(),
            combat: CombatState::new(),
            player_map_viewport: PlayerMapViewport::default(),
            log_history: Vec::new(),
            saved_enemies: Vec::new(),
            campaign_style: "dnd".into(),
            measurement_shapes: Vec::new(),
            session_extras: serde_json::json!({}),
            undo_history: Vec::new(),
            action_results: Vec::new(),
            snapshot_signatures: HashMap::new(),
        }
    }

    pub fn push_log_entry(&mut self, entry: LogHistoryEntry) {
        self.log_history.push(entry);
        if self.log_history.len() > LOG_HISTORY_CAP {
            let excess = self.log_history.len() - LOG_HISTORY_CAP;
            self.log_history.drain(0..excess);
        }
    }

    pub fn add_player(&mut self, session_id: String, player_name: String, is_dm: bool) {
        let connection = PlayerConnection {
            session_id: session_id.clone(),
            player_name,
            character_id: None,
            is_dm,
        };
        self.players.insert(session_id, connection);
    }

    pub fn remove_player(&mut self, session_id: &str) -> Option<PlayerConnection> {
        self.snapshot_signatures.remove(session_id);
        self.players.remove(session_id)
    }

    pub fn set_player_character(&mut self, session_id: &str, character_id: String) {
        if let Some(player) = self.players.get_mut(session_id) {
            player.character_id = Some(character_id);
        }
    }

    pub fn load_map(&mut self, map: Map, clear_tokens: bool) {
        self.current_map = Some(map.clone());
        // Clear tokens when loading a new map (unless loading in background)
        if clear_tokens {
            self.tokens.clear();
        } else {
            // Update map_id for all existing tokens to match the loaded map
            // This fixes tokens that might have empty or wrong map_id
            for token in &mut self.tokens {
                token.map_id = map.id.clone();
            }
        }
    }

    pub fn add_token(&mut self, token: Token) {
        self.tokens.push(token);
    }

    pub fn move_token(&mut self, token_id: &str, x: f32, y: f32) -> bool {
        if let Some(token) = self.tokens.iter_mut().find(|t| t.id == token_id) {
            token.x = x;
            token.y = y;
            true
        } else {
            false
        }
    }

    pub fn remove_token(&mut self, token_id: &str) -> bool {
        let original_len = self.tokens.len();
        self.tokens.retain(|t| t.id != token_id);
        self.tokens.len() != original_len
    }

    pub fn add_character(&mut self, character: Character) {
        self.characters.insert(character.id.clone(), character);
    }

    pub fn update_character(&mut self, character: Character) {
        for participant in self.combat.participants.iter_mut().filter(|p|p.entity_id==character.id) {
            participant.current_hp=character.current_hp;participant.max_hp=character.max_hp;
            participant.armor_class=character.armor_class;participant.initiative_bonus=character.initiative_bonus;
        }
        self.characters.insert(character.id.clone(), character);
    }

    pub fn add_enemy_instance(&mut self, instance: EnemyInstance) {
        self.enemy_instances.insert(instance.id.clone(), instance);
    }

    pub fn get_enemy_instance(&self, id: &str) -> Option<&EnemyInstance> {
        self.enemy_instances.get(id)
    }

    pub fn update_enemy_instance_hp(&mut self, id: &str, new_hp: i32) {
        if let Some(instance) = self.enemy_instances.get_mut(id) {
            instance.current_hp = new_hp;
        }
    }

    pub fn change_hp(&mut self, token_id: &str, delta: i32) -> Result<i32, String> {
        let token = self.tokens.iter().find(|t| t.id == token_id).cloned().ok_or("Token no longer exists")?;
        let new_hp = if let Some(character) = self.characters.get_mut(&token.entity_id) {
            character.current_hp = character.current_hp.saturating_add(delta).clamp(0, character.max_hp.max(0));
            if let Some(raw) = &character.character_data {
                if let Ok(mut full) = serde_json::from_str::<serde_json::Value>(raw) {
                    let data = if full.get("character").is_some() { &mut full["character"] } else { &mut full };
                    if data.is_object() {
                        if !data.get("currentStats").map(|v| v.is_object()).unwrap_or(false) { data["currentStats"] = serde_json::json!({}); }
                        data["currentStats"]["hitPointsLost"] = serde_json::json!(character.max_hp - character.current_hp);
                        character.character_data = Some(full.to_string());
                    }
                }
            }
            character.current_hp
        } else if let Some(enemy) = self.enemy_instances.get_mut(&token.entity_id) {
            enemy.current_hp = enemy.current_hp.saturating_add(delta).clamp(0, enemy.max_hp.max(0));
            enemy.current_hp
        } else { return Err("Token has no HP-bearing entity".into()); };
        for participant in self.combat.participants.iter_mut().filter(|p|p.entity_id==token.entity_id) {participant.current_hp=new_hp;}
        if delta<0 && self.session_extras["concentration"][&token.entity_id].is_object() {
            if new_hp==0 {
                if let Some(rows)=self.session_extras["concentration"].as_object_mut(){rows.remove(&token.entity_id);}
            } else {
                if !self.session_extras["concentrationChecks"].is_array(){self.session_extras["concentrationChecks"]=serde_json::json!([]);}
                self.session_extras["concentrationChecks"].as_array_mut().unwrap().push(serde_json::json!({"character_id":token.entity_id,"name":self.characters.get(&token.entity_id).map(|c|c.name.clone()).unwrap_or_default(),"dc":10.max(delta.saturating_neg()/2)}));
            }
        }
        Ok(new_hp)
    }
}

