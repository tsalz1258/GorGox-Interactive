//! Versioned session snapshots. Validate completely before replacing live state.
use crate::{combat::CombatState, game_state::GameState, models::*};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::Path};

fn array(value: &Value, key: &str) -> Result<Vec<Value>, String> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(vec![]),
        Some(Value::Array(rows)) => Ok(rows.clone()),
        Some(Value::Object(rows)) => Ok(rows.values().cloned().collect()),
        _ => Err(format!("{key} must be an array or object")),
    }
}

pub fn validate(value: &Value) -> Result<GameState, String> {
    if !value.is_object() || (!value.get("tokens").is_some() && !value.get("characters").is_some()) {
        return Err("Not a GorGox session snapshot".into());
    }
    if let Some(version) = value.get("version").and_then(Value::as_str) {
        if !["1.0", "2.0"].contains(&version) { return Err(format!("Unsupported save version: {version}")); }
    }
    let mut state = GameState::new();
    state.campaign_style = value.get("selectedStyle").and_then(Value::as_str).unwrap_or("dnd").into();
    state.current_map = value.get("currentMap").filter(|v| !v.is_null())
        .map(|v| serde_json::from_value::<Map>(v.clone()).map_err(|e| format!("Invalid map: {e}"))).transpose()?;
    if let Some(map) = &state.current_map {
        if map.width <= 0 || map.height <= 0 || map.grid_size <= 0 { return Err("Invalid map dimensions".into()); }
    }
    for row in array(value, "characters")? {
        let character: Character = serde_json::from_value(row).map_err(|e| format!("Invalid character: {e}"))?;
        if character.id.is_empty() || character.max_hp < 0 || state.characters.contains_key(&character.id) {
            return Err("Invalid or duplicate character ID/HP".into());
        }
        state.characters.insert(character.id.clone(), character);
    }
    state.saved_enemies = array(value, "enemies")?;
    for row in array(value, "enemyInstances")? {
        let instance: EnemyInstance = serde_json::from_value(row).map_err(|e| format!("Invalid enemy instance: {e}"))?;
        state.enemy_instances.insert(instance.id.clone(), instance);
    }
    let mut token_ids = HashSet::new();
    for mut row in array(value, "tokens")? {
        let kind = row.get("entity_type").and_then(Value::as_str).unwrap_or("Object").to_lowercase();
        row["entity_type"] = json!(match kind.as_str() {"player"=>"Player", "enemy"=>"Enemy", "npc"=>"NPC", _=>"Object"});
        if row.get("map_id").is_none() { row["map_id"] = json!(state.current_map.as_ref().map(|m| m.id.clone()).unwrap_or_default()); }
        if row.get("image_url").is_none() { row["image_url"] = Value::Null; }
        let token: Token = serde_json::from_value(row.clone()).map_err(|e| format!("Invalid token: {e}"))?;
        if token.id.is_empty() || !token_ids.insert(token.id.clone()) || !token.x.is_finite() || !token.y.is_finite() || !token.size.is_finite() || token.size <= 0.0 {
            return Err("Invalid or duplicate token".into());
        }
        if token.entity_type == TokenType::Player && !state.characters.contains_key(&token.entity_id) {
            return Err(format!("Token references missing character {}", token.entity_id));
        }
        if matches!(token.entity_type, TokenType::Enemy | TokenType::NPC) && !state.enemy_instances.contains_key(&token.entity_id) {
            let enemy = state.saved_enemies.iter().find(|e| e.get("id").and_then(Value::as_str) == Some(&token.entity_id));
            let number = |key: &str, default: i32| row.get(key).and_then(Value::as_i64)
                .or_else(|| enemy.and_then(|e| e.get(key)).and_then(Value::as_i64)).unwrap_or(default as i64) as i32;
            let max_hp = number("max_hp", 1);
            state.enemy_instances.insert(token.entity_id.clone(), EnemyInstance {
                id: token.entity_id.clone(),
                enemy_id: enemy.and_then(|e| e.get("enemy_id").or(e.get("template_id"))).and_then(Value::as_str).unwrap_or(&token.entity_id).into(),
                name: token.display_name.clone().or_else(|| enemy.and_then(|e| e.get("name")).and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| "Enemy".into()),
                current_hp: number("current_hp", max_hp), max_hp,
                armor_class: number("armor_class", 10), initiative_bonus: number("initiative_bonus", 0),
            });
        }
        state.tokens.push(token);
    }
    if let Some(vp) = value.get("playerMapViewport") {
        state.player_map_viewport = serde_json::from_value(vp.clone()).map_err(|e| format!("Invalid viewport: {e}"))?;
    }
    if let Some(combat) = value.get("combatState").or(value.get("combat")) {
        let active = combat.get("active").and_then(Value::as_bool).unwrap_or(false);
        let participants: Vec<CombatParticipant> = serde_json::from_value(combat.get("participants").cloned().unwrap_or(json!([])))
            .map_err(|e| format!("Invalid combat: {e}"))?;
        if active && participants.is_empty() { return Err("Active combat has no participants".into()); }
        let mut ids = HashSet::new();
        if participants.iter().any(|p| !token_ids.contains(&p.id) || !ids.insert(&p.id)) { return Err("Combat references missing/duplicate token".into()); }
        let index = if let Some(id) = combat.get("currentTurn").and_then(Value::as_str) {
            participants.iter().position(|p| p.id == id).ok_or("Current turn references a missing participant")?
        } else { combat.get("current_turn_index").and_then(Value::as_u64).unwrap_or(0) as usize };
        if active && index >= participants.len() { return Err("Invalid combat turn index".into()); }
        state.combat = CombatState {active, participants, current_turn_index:index, round:combat.get("round").and_then(Value::as_i64).unwrap_or(1).max(1) as i32};
    }
    state.log_history = serde_json::from_value(value.get("logHistory").cloned().unwrap_or(json!([]))).map_err(|e| format!("Invalid log history: {e}"))?;
    state.measurement_shapes = array(value, "measurementShapes")?;
    state.session_extras = value.get("sessionExtras").cloned().unwrap_or(json!({}));
    if !state.session_extras.is_object() { return Err("Invalid session extras".into()); }
    if let Some(maps) = state.session_extras.get("visionMaps") { crate::vision::validate_maps(maps)?; }
    if let Some(notes) = value.get("campaignNotes") {
        let notes = notes.as_object().ok_or("Invalid campaign notes")?;
        if notes.iter().any(|(id, note)| !valid_note_id(id) || !note.is_object()) { return Err("Invalid campaign notes entry".into()); }
    }
    Ok(state)
}

pub fn snapshot(state: &GameState) -> Value {
    let mut enemies = state.saved_enemies.clone();
    for instance in state.enemy_instances.values() {
        if let Some(row) = enemies.iter_mut().find(|e| e.get("id").and_then(Value::as_str) == Some(&instance.id)) {
            row["current_hp"] = json!(instance.current_hp);
            row["max_hp"] = json!(instance.max_hp);
        } else { enemies.push(serde_json::to_value(instance).unwrap()); }
    }
    json!({"version":"2.0", "savedAt":chrono::Utc::now().to_rfc3339(), "selectedStyle":state.campaign_style,
        "currentMap":state.current_map.as_ref().map(Map::for_client_wire), "tokens":state.tokens,
        "characters":state.characters.values().collect::<Vec<_>>(), "enemies":enemies,
        "enemyInstances":state.enemy_instances, "playerMapViewport":state.player_map_viewport,
        "combatState":{"active":state.combat.active,"participants":state.combat.participants,
            "currentTurn":state.combat.get_current_participant().map(|p| &p.id),
            "current_turn_index":state.combat.current_turn_index,"round":state.combat.round},
        "players":state.players.values().collect::<Vec<_>>(), "logHistory":state.log_history,"measurementShapes":state.measurement_shapes,"sessionExtras":state.session_extras})
}

pub fn valid_filename(name: &str) -> bool {
    !name.is_empty() && name.len() < 220 && !name.contains("..") && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) && name.ends_with(".json")
}

pub fn valid_note_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 220 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub async fn campaign_notes() -> Value {
    let mut notes = serde_json::Map::new();
    if let Ok(mut directory) = tokio::fs::read_dir("campaign_notes").await {
        while let Ok(Some(file)) = directory.next_entry().await {
            let path = file.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).filter(|s| valid_note_id(s)) else { continue; };
            if let Ok(text) = tokio::fs::read_to_string(&path).await {
                if let Ok(note) = serde_json::from_str::<Value>(&text) { notes.insert(id.into(), note); }
            }
        }
    }
    Value::Object(notes)
}

pub async fn atomic_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing parent directory")?;
    tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let data = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&temporary).await.map_err(|e| e.to_string())?;
    file.write_all(&data).await.map_err(|e| e.to_string())?;
    file.sync_all().await.map_err(|e| e.to_string())?;
    drop(file);
    if let Err(error) = tokio::fs::rename(&temporary, path).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error.to_string());
    }
    Ok(())
}

pub async fn persist_characters(db: &crate::db::Database, characters: &HashMap<String, Character>) -> Result<(), String> {
    let mut tx = db.begin().await.map_err(|e| e.to_string())?;
    for c in characters.values() {
        sqlx::query("INSERT INTO characters (id,name,player_name,class,level,max_hp,current_hp,armor_class,initiative_bonus,strength,dexterity,constitution,intelligence,wisdom,charisma,speed,proficiency_bonus,character_data,portrait_url,style) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,player_name=excluded.player_name,class=excluded.class,level=excluded.level,max_hp=excluded.max_hp,current_hp=excluded.current_hp,armor_class=excluded.armor_class,initiative_bonus=excluded.initiative_bonus,strength=excluded.strength,dexterity=excluded.dexterity,constitution=excluded.constitution,intelligence=excluded.intelligence,wisdom=excluded.wisdom,charisma=excluded.charisma,speed=excluded.speed,proficiency_bonus=excluded.proficiency_bonus,character_data=excluded.character_data,portrait_url=excluded.portrait_url,style=excluded.style WHERE characters.name IS NOT excluded.name OR characters.player_name IS NOT excluded.player_name OR characters.class IS NOT excluded.class OR characters.level IS NOT excluded.level OR characters.max_hp IS NOT excluded.max_hp OR characters.current_hp IS NOT excluded.current_hp OR characters.armor_class IS NOT excluded.armor_class OR characters.initiative_bonus IS NOT excluded.initiative_bonus OR characters.strength IS NOT excluded.strength OR characters.dexterity IS NOT excluded.dexterity OR characters.constitution IS NOT excluded.constitution OR characters.intelligence IS NOT excluded.intelligence OR characters.wisdom IS NOT excluded.wisdom OR characters.charisma IS NOT excluded.charisma OR characters.speed IS NOT excluded.speed OR characters.proficiency_bonus IS NOT excluded.proficiency_bonus OR characters.character_data IS NOT excluded.character_data OR characters.portrait_url IS NOT excluded.portrait_url OR characters.style IS NOT excluded.style")
            .bind(&c.id).bind(&c.name).bind(&c.player_name).bind(&c.class).bind(c.level).bind(c.max_hp).bind(c.current_hp).bind(c.armor_class).bind(c.initiative_bonus)
            .bind(c.strength).bind(c.dexterity).bind(c.constitution).bind(c.intelligence).bind(c.wisdom).bind(c.charisma).bind(c.speed).bind(c.proficiency_bonus)
            .bind(&c.character_data).bind(&c.portrait_url).bind("dnd").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_invalid_sessions_without_partial_state() {
        assert!(validate(&json!({"version":"future","tokens":[]})).is_err());
        assert!(validate(&json!({"version":"2.0","tokens":[],"combatState":{"active":true,"participants":[]}})).is_err());
        assert!(!valid_filename("../campaign.json"));
    }
    #[test] fn empty_snapshot_round_trips() {
        let original = GameState::new();
        let restored = validate(&snapshot(&original)).unwrap();
        assert!(restored.tokens.is_empty());
        assert!(!restored.combat.active);
    }
    #[test] fn legacy_campaign_saves_validate() {
        for name in ["Stone Cavern for S7.json", "test.json"] {
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("saves").join(name);
            if path.is_file() {
                let data: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
                assert!(validate(&data).is_ok(), "{name}: {:?}", validate(&data).err());
            }
        }
    }
}
