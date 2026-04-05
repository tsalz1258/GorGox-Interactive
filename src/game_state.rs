use crate::combat::CombatState;
use crate::models::{Character, EnemyInstance, Map, PlayerConnection, PlayerMapViewport, Token};
use std::collections::HashMap;

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
}

