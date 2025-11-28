use crate::models::CombatParticipant;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatState {
    pub active: bool,
    pub participants: Vec<CombatParticipant>,
    pub current_turn_index: usize,
    pub round: i32,
}

impl CombatState {
    pub fn new() -> Self {
        Self {
            active: false,
            participants: Vec::new(),
            current_turn_index: 0,
            round: 1,
        }
    }

    pub fn start_combat(&mut self, participants: Vec<CombatParticipant>) {
        self.participants = participants;
        self.sort_by_initiative();
        self.active = true;
        self.current_turn_index = 0;
        self.round = 1;
    }

    pub fn add_participant(&mut self, participant: CombatParticipant) {
        self.participants.push(participant);
        if self.active {
            self.sort_by_initiative();
        }
    }

    pub fn update_initiative(&mut self, entity_id: &str, initiative: i32) {
        if let Some(participant) = self.participants.iter_mut().find(|p| p.entity_id == entity_id) {
            participant.initiative = initiative;
        }
        if self.active {
            self.sort_by_initiative();
        }
    }

    pub fn sort_by_initiative(&mut self) {
        self.participants.sort_by(|a, b| b.initiative.cmp(&a.initiative));
    }

    pub fn next_turn(&mut self) -> Option<&CombatParticipant> {
        if !self.active || self.participants.is_empty() {
            return None;
        }

        self.current_turn_index += 1;
        if self.current_turn_index >= self.participants.len() {
            self.current_turn_index = 0;
            self.round += 1;
        }

        self.get_current_participant()
    }

    pub fn get_current_participant(&self) -> Option<&CombatParticipant> {
        if self.active && !self.participants.is_empty() {
            Some(&self.participants[self.current_turn_index])
        } else {
            None
        }
    }

    pub fn deal_damage(&mut self, target_id: &str, damage: i32) -> Option<(i32, i32)> {
        if let Some(participant) = self.participants.iter_mut().find(|p| p.id == target_id) {
            participant.current_hp = (participant.current_hp - damage).max(0);
            Some((damage, participant.current_hp))
        } else {
            None
        }
    }

    pub fn heal_target(&mut self, target_id: &str, healing: i32) -> Option<(i32, i32)> {
        if let Some(participant) = self.participants.iter_mut().find(|p| p.id == target_id) {
            participant.current_hp = (participant.current_hp + healing).min(participant.max_hp);
            Some((healing, participant.current_hp))
        } else {
            None
        }
    }

    pub fn remove_participant(&mut self, entity_id: &str) {
        self.participants.retain(|p| p.entity_id != entity_id);
        if self.current_turn_index >= self.participants.len() && !self.participants.is_empty() {
            self.current_turn_index = 0;
        }
    }

    pub fn end_combat(&mut self) {
        self.active = false;
        self.participants.clear();
        self.current_turn_index = 0;
        self.round = 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TokenType;

    #[test]
    fn test_combat_initiative_ordering() {
        let mut combat = CombatState::new();
        
        let participants = vec![
            CombatParticipant {
                id: "1".to_string(),
                entity_id: "char1".to_string(),
                name: "Fighter".to_string(),
                initiative: 15,
                entity_type: TokenType::Player,
                current_hp: 20,
                max_hp: 20,
                armor_class: 16,
            },
            CombatParticipant {
                id: "2".to_string(),
                entity_id: "enemy1".to_string(),
                name: "Goblin".to_string(),
                initiative: 20,
                entity_type: TokenType::Enemy,
                current_hp: 10,
                max_hp: 10,
                armor_class: 13,
            },
        ];

        combat.start_combat(participants);
        
        assert_eq!(combat.participants[0].initiative, 20);
        assert_eq!(combat.participants[1].initiative, 15);
    }
}

