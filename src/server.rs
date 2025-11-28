use crate::models::{ClientMessage, ServerMessage};
use crate::game_state::GameState;
use crate::db::Database;
use base64::{Engine as _, engine::general_purpose};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info, warn};
use uuid::Uuid;
use sqlx::Row;

type Clients = Arc<RwLock<HashMap<String, broadcast::Sender<String>>>>;

async fn load_characters_from_db(db: &Database, game_state: &Arc<RwLock<GameState>>, db_name: &str) {
    use crate::models::Character;
    
    // First, try to ensure the style column exists
    let _ = sqlx::query("ALTER TABLE characters ADD COLUMN style TEXT NOT NULL DEFAULT 'dnd'")
        .execute(db)
        .await;
    
    // Try loading with style column first
    let query_result = sqlx::query(
        "SELECT id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style FROM characters"
    )
    .fetch_all(db)
    .await;
    
    match query_result {
        Ok(rows) => {
            let mut gs = game_state.write().await;
            let mut count = 0;
            for row in rows {
                let char = Character {
                    id: row.get::<String, _>(0),
                    name: row.get::<String, _>(1),
                    player_name: row.get::<String, _>(2),
                    class: row.get::<String, _>(3),
                    level: row.get::<i32, _>(4),
                    max_hp: row.get::<i32, _>(5),
                    current_hp: row.get::<i32, _>(6),
                    armor_class: row.get::<i32, _>(7),
                    initiative_bonus: row.get::<i32, _>(8),
                    strength: row.get::<i32, _>(9),
                    dexterity: row.get::<i32, _>(10),
                    constitution: row.get::<i32, _>(11),
                    intelligence: row.get::<i32, _>(12),
                    wisdom: row.get::<i32, _>(13),
                    charisma: row.get::<i32, _>(14),
                    speed: row.get::<i32, _>(15),
                    proficiency_bonus: row.get::<i32, _>(16),
                    character_data: row.get::<Option<String>, _>(17),
                    portrait_url: row.get::<Option<String>, _>(18),
                };
                gs.characters.insert(char.id.clone(), char);
                count += 1;
            }
            info!("✅ Loaded {} characters from {} database", count, db_name);
        }
        Err(e) => {
            // If query failed due to missing style column, try without it
            let err_str = e.to_string();
            if err_str.contains("no such column: style") {
                warn!("⚠️ Style column missing, trying to load without it and migrate...");
                // Try to add the column again
                if let Err(migrate_err) = sqlx::query("ALTER TABLE characters ADD COLUMN style TEXT NOT NULL DEFAULT 'dnd'")
                    .execute(db)
                    .await
                {
                    let migrate_err_str = migrate_err.to_string();
                    if !migrate_err_str.contains("duplicate") && !migrate_err_str.contains("already exists") {
                        error!("❌ Failed to add style column: {}", migrate_err);
                    }
                }
                // Retry the query
                if let Ok(rows) = sqlx::query(
                    "SELECT id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style FROM characters"
                )
                .fetch_all(db)
                .await
                {
                    let mut gs = game_state.write().await;
                    let mut count = 0;
                    for row in rows {
                        let char = Character {
                            id: row.get::<String, _>(0),
                            name: row.get::<String, _>(1),
                            player_name: row.get::<String, _>(2),
                            class: row.get::<String, _>(3),
                            level: row.get::<i32, _>(4),
                            max_hp: row.get::<i32, _>(5),
                            current_hp: row.get::<i32, _>(6),
                            armor_class: row.get::<i32, _>(7),
                            initiative_bonus: row.get::<i32, _>(8),
                            strength: row.get::<i32, _>(9),
                            dexterity: row.get::<i32, _>(10),
                            constitution: row.get::<i32, _>(11),
                            intelligence: row.get::<i32, _>(12),
                            wisdom: row.get::<i32, _>(13),
                            charisma: row.get::<i32, _>(14),
                            speed: row.get::<i32, _>(15),
                            proficiency_bonus: row.get::<i32, _>(16),
                            character_data: row.get::<Option<String>, _>(17),
                            portrait_url: row.get::<Option<String>, _>(18),
                        };
                        gs.characters.insert(char.id.clone(), char);
                        count += 1;
                    }
                    info!("✅ Loaded {} characters from {} database (after migration)", count, db_name);
                } else {
                    error!("❌ Failed to load characters from {} database even after migration attempt", db_name);
                }
            } else {
                error!("❌ Failed to load characters from {} database: {}", db_name, e);
            }
        }
    }
}

pub async fn start_server(
    dnd_db: Database,
    starwars_db: Database,
    game_state: Arc<RwLock<GameState>>,
) -> anyhow::Result<()> {
    let clients: Clients = Arc::new(RwLock::new(HashMap::new()));

    // CRITICAL: Load all characters from database on startup
    info!("🔄 Loading characters from databases on startup...");
    load_characters_from_db(&dnd_db, &game_state, "D&D").await;
    load_characters_from_db(&starwars_db, &game_state, "Star Wars").await;
    let char_count = game_state.read().await.characters.len();
    if char_count > 0 {
        info!("✅ Successfully loaded {} total characters into game state on startup", char_count);
    } else {
        warn!("⚠️ No characters found in databases on startup");
    }

    let app = Router::new()
        .route("/ws", get(websocket_handler))
        .route("/", get(|| async {
            match tokio::fs::read_to_string("static/index.html").await {
                Ok(content) => axum::response::Html(content),
                Err(_) => axum::response::Html(include_str!("../static/index.html").to_string()),
            }
        }))
        .nest_service("/static", tower_http::services::ServeDir::new("static"))
        .with_state((dnd_db, starwars_db, game_state, clients.clone()));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    info!("Server listening on http://0.0.0.0:3000");

    axum::serve(listener, app).await?;
    Ok(())
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State((dnd_db, starwars_db, game_state, clients)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
    )>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, dnd_db, starwars_db, game_state, clients))
}

async fn handle_socket(
    socket: WebSocket,
    dnd_db: Database,
    starwars_db: Database,
    game_state: Arc<RwLock<GameState>>,
    clients: Clients,
) {
    let (mut sender, mut receiver) = socket.split();
    let session_id = Uuid::new_v4().to_string();
    
    let (tx, mut rx) = broadcast::channel(100);
    clients.write().await.insert(session_id.clone(), tx.clone());

    // Send initial connection message
    let connected_msg = ServerMessage::Connected {
        session_id: session_id.clone(),
        is_dm: false, // Will be updated from Connect message
    };
    if let Ok(json) = serde_json::to_string(&connected_msg) {
        let _ = sender.send(Message::Text(json)).await;
    }

    // Clone values needed after the task
    let clients_clone = clients.clone();
    let session_id_clone = session_id.clone();
    let _game_state_clone = game_state.clone();
    
    // Spawn task to send messages to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages
    let dnd_db_clone = dnd_db.clone();
    let starwars_db_clone = starwars_db.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = receiver.next().await {
            if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                handle_client_message(
                    client_msg,
                    &session_id,
                    &game_state,
                    &clients,
                    &dnd_db_clone,
                    &starwars_db_clone,
                ).await;
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => {
            recv_task.abort();
        }
        _ = (&mut recv_task) => {
            send_task.abort();
        }
    }

    clients_clone.write().await.remove(&session_id_clone);
    info!("Client {} disconnected", session_id_clone);
}

async fn handle_client_message(
    msg: ClientMessage,
    session_id: &str,
    game_state: &Arc<RwLock<GameState>>,
    clients: &Clients,
    dnd_db: &Database,
    starwars_db: &Database,
) {
    use crate::models::{CombatParticipant, Character, Enemy, Map};
    use uuid::Uuid;
    match msg {
        ClientMessage::Connect { player_name, is_dm, style: _ } => {
            let player_name_clone = player_name.clone();
            info!("Player {} connected as {}", player_name_clone, if is_dm { "DM" } else { "Player" });
            game_state.write().await.add_player(session_id.to_string(), player_name, is_dm);
            
            // Broadcast player joined
            let player_joined = ServerMessage::PlayerJoined {
                player_name: player_name_clone,
                is_dm,
            };
            broadcast_message(clients, &player_joined).await;
        }
        
        ClientMessage::PlaySound { sound_id, sound_name, sound_data, sound_type } => {
            info!("Sound '{}' requested by {}", sound_name, session_id);
            
            // Broadcast to all clients
            let sound_played = ServerMessage::SoundPlayed {
                sound_id: sound_id.clone(),
                sound_name: sound_name.clone(),
                sound_data: sound_data.clone(),
                sound_type: sound_type.clone(),
            };
            
            broadcast_message(clients, &sound_played).await;
            info!("Sound '{}' broadcast to all clients", sound_name);
        }
        
        // Essential token management handlers
        ClientMessage::PlaceToken { entity_id, entity_type, x, y } => {
            use crate::models::Token;
            
            let token = Token {
                id: uuid::Uuid::new_v4().to_string(),
                map_id: game_state.read().await.current_map.as_ref().map(|m| m.id.clone()).unwrap_or_default(),
                entity_id,
                entity_type,
                x,
                y,
                size: 1.0,
                image_url: None,
            };
            
            game_state.write().await.add_token(token.clone());
            
            // Broadcast token update to all clients
            let tokens = game_state.read().await.tokens.clone();
            let token_update = ServerMessage::TokenUpdate { tokens };
            broadcast_message(clients, &token_update).await;
        }
        
        ClientMessage::MoveToken { token_id, x, y } => {
            if game_state.write().await.move_token(&token_id, x, y) {
                let tokens = game_state.read().await.tokens.clone();
                let token_update = ServerMessage::TokenUpdate { tokens };
                broadcast_message(clients, &token_update).await;
            }
        }
        
        ClientMessage::RemoveToken { token_id } => {
            if game_state.write().await.remove_token(&token_id) {
                let tokens = game_state.read().await.tokens.clone();
                let token_update = ServerMessage::TokenUpdate { tokens };
                broadcast_message(clients, &token_update).await;
            }
        }
        
        // Ruler tool - just broadcast
        ClientMessage::RulerUpdate { start_x, start_y, end_x, end_y } => {
            let ruler_update = ServerMessage::RulerUpdate { start_x, start_y, end_x, end_y };
            broadcast_message(clients, &ruler_update).await;
        }
        
        // Combat handlers
        ClientMessage::StartCombat => {
            let mut gs = game_state.write().await;
            let participants: Vec<CombatParticipant> = gs.tokens.iter()
                .filter_map(|token| {
                    // Try to find character or enemy for this token
                    if let Some(character) = gs.characters.get(&token.entity_id) {
                        Some(CombatParticipant {
                            id: token.id.clone(),
                            entity_id: token.entity_id.clone(),
                            name: character.name.clone(),
                            initiative: 0,
                            initiative_bonus: character.initiative_bonus,
                            entity_type: crate::models::TokenType::Player,
                            current_hp: character.current_hp,
                            max_hp: character.max_hp,
                            armor_class: character.armor_class,
                        })
                    } else if let Some(enemy) = gs.enemy_instances.get(&token.entity_id) {
                        Some(CombatParticipant {
                            id: token.id.clone(),
                            entity_id: token.entity_id.clone(),
                            name: enemy.name.clone(),
                            initiative: 0,
                            initiative_bonus: enemy.initiative_bonus,
                            entity_type: crate::models::TokenType::Enemy,
                            current_hp: enemy.current_hp,
                            max_hp: enemy.max_hp,
                            armor_class: enemy.armor_class,
                        })
                    } else {
                        None
                    }
                })
                .collect();
            
            gs.combat.start_combat(participants.clone());
            let combat_started = ServerMessage::CombatStarted { participants };
            broadcast_message(clients, &combat_started).await;
        }
        
        ClientMessage::RollInitiative { entity_id, roll } => {
            let mut gs = game_state.write().await;
            gs.combat.update_initiative(&entity_id, roll);
            let initiative_rolled = ServerMessage::InitiativeRolled { entity_id, initiative: roll };
            broadcast_message(clients, &initiative_rolled).await;
            
            // If all have rolled, send turn update
            if let Some(current) = gs.combat.get_current_participant() {
                let turn_changed = ServerMessage::TurnChanged {
                    current_turn: current.id.clone(),
                    participant_name: current.name.clone(),
                };
                broadcast_message(clients, &turn_changed).await;
            }
        }
        
        ClientMessage::NextTurn => {
            let mut gs = game_state.write().await;
            if let Some(participant) = gs.combat.next_turn() {
                let turn_changed = ServerMessage::TurnChanged {
                    current_turn: participant.id.clone(),
                    participant_name: participant.name.clone(),
                };
                broadcast_message(clients, &turn_changed).await;
            }
        }
        
        ClientMessage::EndCombat => {
            game_state.write().await.combat.end_combat();
            let combat_ended = ServerMessage::CombatEnded;
            broadcast_message(clients, &combat_ended).await;
        }
        
        ClientMessage::DealDamage { target_id, damage } => {
            let mut gs = game_state.write().await;
            if let Some((dmg, new_hp)) = gs.combat.deal_damage(&target_id, damage) {
                let damage_dealt = ServerMessage::DamageDealt { target_id, damage: dmg, new_hp };
                broadcast_message(clients, &damage_dealt).await;
            }
        }
        
        ClientMessage::HealTarget { target_id, healing } => {
            let mut gs = game_state.write().await;
            if let Some((heal, new_hp)) = gs.combat.heal_target(&target_id, healing) {
                let healing_applied = ServerMessage::HealingApplied { target_id, healing: heal, new_hp };
                broadcast_message(clients, &healing_applied).await;
            }
        }
        
        // Map handlers
        ClientMessage::CreateMap { name, image_data, width, height } => {
            use std::fs;
            use std::path::Path;
            
            let map_id = Uuid::new_v4().to_string();
            let image_path = format!("static/maps/{}.png", map_id);
            
            // Decode and save image
            let image_data_clean = image_data.strip_prefix("data:image/png;base64,").unwrap_or(&image_data);
            if let Ok(decoded) = general_purpose::STANDARD.decode(image_data_clean) {
                if let Some(parent) = Path::new(&image_path).parent() {
                    if let Err(e) = fs::create_dir_all(parent) {
                        error!("Failed to create maps directory: {}", e);
                    }
                }
                match fs::write(&image_path, decoded) {
                    Ok(_) => {
                        info!("Map image saved successfully: {}", image_path);
                    }
                    Err(e) => {
                        error!("Failed to save map image to {}: {}", image_path, e);
                    }
                }
            } else {
                error!("Failed to decode base64 image data");
            }
            
            let map = Map {
                id: map_id.clone(),
                name: name.clone(),
                image_path: format!("/{}", image_path),
                grid_size: 50,
                width,
                height,
            };
            
            // Save to database
            if let Err(e) = sqlx::query(
                "INSERT OR REPLACE INTO maps (id, name, image_path, grid_size, width, height) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(&map_id)
            .bind(&name)
            .bind(&map.image_path)
            .bind(50)
            .bind(width)
            .bind(height)
            .execute(dnd_db)
            .await
            {
                error!("Failed to save map to database: {}", e);
            }
            
            game_state.write().await.load_map(map.clone(), true);
            let map_loaded = ServerMessage::MapLoaded { map };
            broadcast_message(clients, &map_loaded).await;
        }
        
        ClientMessage::ListMaps => {
            if let Ok(rows) = sqlx::query(
                "SELECT id, name, image_path, grid_size, width, height FROM maps ORDER BY name"
            )
            .fetch_all(dnd_db)
            .await
            {
                let maps: Vec<Map> = rows.into_iter().map(|row| {
                    Map {
                        id: row.get::<String, _>(0),
                        name: row.get::<String, _>(1),
                        image_path: row.get::<String, _>(2),
                        grid_size: row.get::<i32, _>(3),
                        width: row.get::<i32, _>(4),
                        height: row.get::<i32, _>(5),
                    }
                }).collect();
                let map_list = ServerMessage::MapList { maps };
                broadcast_message(clients, &map_list).await;
            }
        }
        
        ClientMessage::DeleteMap { map_id } => {
            use std::fs;
            use std::path::Path;
            
            info!("🗑️ Deleting map: {}", map_id);
            
            // Get map info before deleting
            if let Ok(Some(map_row)) = sqlx::query_as::<_, (String, String)>(
                "SELECT id, image_path FROM maps WHERE id = ?"
            )
            .bind(&map_id)
            .fetch_optional(dnd_db)
            .await
            {
                let image_path = map_row.1;
                
                // Delete from database
                if let Err(e) = sqlx::query("DELETE FROM maps WHERE id = ?")
                    .bind(&map_id)
                    .execute(dnd_db)
                    .await
                {
                    error!("Failed to delete map from database: {}", e);
                } else {
                    info!("✅ Map deleted from database");
                    
                    // Delete image file
                    let file_path = image_path.strip_prefix('/').unwrap_or(&image_path);
                    if Path::new(file_path).exists() {
                        if let Err(e) = fs::remove_file(file_path) {
                            warn!("Failed to delete map image file {}: {}", file_path, e);
                        } else {
                            info!("✅ Map image file deleted: {}", file_path);
                        }
                    }
                    
                    // Remove from game state if it's the current map
                    let mut gs = game_state.write().await;
                    if let Some(ref current) = gs.current_map {
                        if current.id == map_id {
                            gs.current_map = None;
                            info!("✅ Removed deleted map from current map");
                        }
                    }
                    
                    // Broadcast updated map list
                    if let Ok(rows) = sqlx::query(
                        "SELECT id, name, image_path, grid_size, width, height FROM maps ORDER BY name"
                    )
                    .fetch_all(dnd_db)
                    .await
                    {
                        let maps: Vec<Map> = rows.into_iter().map(|row| {
                            Map {
                                id: row.get::<String, _>(0),
                                name: row.get::<String, _>(1),
                                image_path: row.get::<String, _>(2),
                                grid_size: row.get::<i32, _>(3),
                                width: row.get::<i32, _>(4),
                                height: row.get::<i32, _>(5),
                            }
                        }).collect();
                        let map_list = ServerMessage::MapList { maps };
                        broadcast_message(clients, &map_list).await;
                    }
                }
            } else {
                warn!("Map {} not found in database", map_id);
            }
        }
        
        ClientMessage::LoadMap { map_id, clear_tokens } => {
            // Load map from database
            let clear = clear_tokens.unwrap_or(true); // Default to true for backward compatibility
            info!("Loading map: {} (clear_tokens: {})", map_id, clear);
            if let Ok(Some(map_row)) = sqlx::query_as::<_, (String, String, String, i32, i32, i32)>(
                "SELECT id, name, image_path, grid_size, width, height FROM maps WHERE id = ?"
            )
            .bind(&map_id)
            .fetch_optional(dnd_db)
            .await
            {
                let map = Map {
                    id: map_row.0,
                    name: map_row.1,
                    image_path: map_row.2.clone(),
                    grid_size: map_row.3,
                    width: map_row.4,
                    height: map_row.5,
                };
                info!("Map loaded from DB: {} - image_path: {}", map.name, map_row.2);
                game_state.write().await.load_map(map.clone(), clear);
                let map_loaded = ServerMessage::MapLoaded { map };
                broadcast_message(clients, &map_loaded).await;
            } else {
                warn!("Map not found in database: {}", map_id);
                let error = ServerMessage::Error { message: format!("Map not found: {}", map_id) };
                broadcast_message(clients, &error).await;
            }
        }
        
        ClientMessage::MapSettingsChanged { grid_size, width, height } => {
            let settings = ServerMessage::MapSettingsChanged { grid_size, width, height };
            broadcast_message(clients, &settings).await;
        }
        
        // Character handlers
        ClientMessage::ListCharacters => {
            // Load characters from both databases and populate game state
            // DO NOT clear existing characters - merge with database
            let mut gs = game_state.write().await;
            let mut loaded_count = 0;
            
            // Load from D&D database
            match sqlx::query(
                "SELECT id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style FROM characters"
            )
            .fetch_all(dnd_db)
            .await
            {
                Ok(rows) => {
                    for row in rows {
                        let char = Character {
                            id: row.get::<String, _>(0),
                            name: row.get::<String, _>(1),
                            player_name: row.get::<String, _>(2),
                            class: row.get::<String, _>(3),
                            level: row.get::<i32, _>(4),
                            max_hp: row.get::<i32, _>(5),
                            current_hp: row.get::<i32, _>(6),
                            armor_class: row.get::<i32, _>(7),
                            initiative_bonus: row.get::<i32, _>(8),
                            strength: row.get::<i32, _>(9),
                            dexterity: row.get::<i32, _>(10),
                            constitution: row.get::<i32, _>(11),
                            intelligence: row.get::<i32, _>(12),
                            wisdom: row.get::<i32, _>(13),
                            charisma: row.get::<i32, _>(14),
                            speed: row.get::<i32, _>(15),
                            proficiency_bonus: row.get::<i32, _>(16),
                            character_data: row.get::<Option<String>, _>(17),
                            portrait_url: row.get::<Option<String>, _>(18),
                        };
                        gs.characters.insert(char.id.clone(), char);
                        loaded_count += 1;
                    }
                    info!("Loaded {} characters from D&D database", loaded_count);
                }
                Err(e) => {
                    error!("Failed to load characters from D&D database: {}", e);
                }
            }
            
            // Load from Star Wars database (merge, don't overwrite)
            match sqlx::query(
                "SELECT id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style FROM characters"
            )
            .fetch_all(starwars_db)
            .await
            {
                Ok(rows) => {
                    let mut sw_count = 0;
                    for row in rows {
                        let char = Character {
                            id: row.get::<String, _>(0),
                            name: row.get::<String, _>(1),
                            player_name: row.get::<String, _>(2),
                            class: row.get::<String, _>(3),
                            level: row.get::<i32, _>(4),
                            max_hp: row.get::<i32, _>(5),
                            current_hp: row.get::<i32, _>(6),
                            armor_class: row.get::<i32, _>(7),
                            initiative_bonus: row.get::<i32, _>(8),
                            strength: row.get::<i32, _>(9),
                            dexterity: row.get::<i32, _>(10),
                            constitution: row.get::<i32, _>(11),
                            intelligence: row.get::<i32, _>(12),
                            wisdom: row.get::<i32, _>(13),
                            charisma: row.get::<i32, _>(14),
                            speed: row.get::<i32, _>(15),
                            proficiency_bonus: row.get::<i32, _>(16),
                            character_data: row.get::<Option<String>, _>(17),
                            portrait_url: row.get::<Option<String>, _>(18),
                        };
                        // Only insert if not already present (D&D takes precedence)
                        if !gs.characters.contains_key(&char.id) {
                            gs.characters.insert(char.id.clone(), char);
                            sw_count += 1;
                        }
                    }
                    if sw_count > 0 {
                        info!("Loaded {} additional characters from Star Wars database", sw_count);
                    }
                }
                Err(e) => {
                    warn!("Failed to load characters from Star Wars database: {}", e);
                }
            }
            
            let characters: Vec<Character> = gs.characters.values().cloned().collect();
            info!("Total characters in game state: {}", characters.len());
            let character_list = ServerMessage::CharacterList { characters, style: None };
            broadcast_message(clients, &character_list).await;
        }
        
        ClientMessage::CreateCharacter { character } => {
            info!("💾 Creating character: {} (ID: {})", character.name, character.id);
            info!("   Character data present: {}", character.character_data.is_some());
            if let Some(ref cd) = character.character_data {
                info!("   Character data length: {} bytes", cd.len());
            }
            let style = "dnd"; // Default style
            
            // CRITICAL: Ensure style column exists before saving
            let _ = sqlx::query("ALTER TABLE characters ADD COLUMN style TEXT NOT NULL DEFAULT 'dnd'")
                .execute(dnd_db)
                .await;
            
            // CRITICAL: Save to D&D database FIRST - this is the primary storage
            let save_result = sqlx::query(
                "INSERT OR REPLACE INTO characters (id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&character.id)
            .bind(&character.name)
            .bind(&character.player_name)
            .bind(&character.class)
            .bind(character.level)
            .bind(character.max_hp)
            .bind(character.current_hp)
            .bind(character.armor_class)
            .bind(character.initiative_bonus)
            .bind(character.strength)
            .bind(character.dexterity)
            .bind(character.constitution)
            .bind(character.intelligence)
            .bind(character.wisdom)
            .bind(character.charisma)
            .bind(character.speed)
            .bind(character.proficiency_bonus)
            .bind(character.character_data.as_ref().map(|s| s.as_str()).unwrap_or(""))
            .bind(character.portrait_url.as_ref().map(|s| s.as_str()))
            .bind(style)
            .execute(dnd_db)
            .await;
            
            match save_result {
                Ok(result) => {
                    info!("✅ Character '{}' saved to D&D database (rows affected: {})", character.name, result.rows_affected());
                    
                    // Verify it was saved and check character_data
                    match sqlx::query("SELECT id, character_data FROM characters WHERE id = ?")
                        .bind(&character.id)
                        .fetch_one(dnd_db)
                        .await
                    {
                        Ok(row) => {
                            let saved_id: String = row.get(0);
                            let saved_data: Option<String> = row.get(1);
                            info!("✅ Verified: Character '{}' (ID: {}) exists in database", character.name, saved_id);
                            if let Some(ref data) = saved_data {
                                info!("   Character data saved: {} bytes", data.len());
                            } else {
                                warn!("⚠️ WARNING: Character data is NULL in database for '{}'", character.name);
                            }
                        }
                        Err(e) => {
                            error!("❌ VERIFICATION FAILED: Could not verify character '{}' in database: {}", character.name, e);
                        }
                    }
                }
                Err(e) => {
                    error!("❌ CRITICAL: Failed to save character '{}' to D&D database: {}", character.name, e);
                    error!("   Character ID: {}", character.id);
                    error!("   Character data present: {}", character.character_data.is_some());
                    error!("   Error details: {:?}", e);
                    error!("   This character will be LOST on server restart!");
                }
            }
            
            // Also save to Star Wars database (backup)
            if let Err(e) = sqlx::query(
                "INSERT OR REPLACE INTO characters (id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&character.id)
            .bind(&character.name)
            .bind(&character.player_name)
            .bind(&character.class)
            .bind(character.level)
            .bind(character.max_hp)
            .bind(character.current_hp)
            .bind(character.armor_class)
            .bind(character.initiative_bonus)
            .bind(character.strength)
            .bind(character.dexterity)
            .bind(character.constitution)
            .bind(character.intelligence)
            .bind(character.wisdom)
            .bind(character.charisma)
            .bind(character.speed)
            .bind(character.proficiency_bonus)
            .bind(character.character_data.as_ref().map(|s| s.as_str()).unwrap_or(""))
            .bind(character.portrait_url.as_ref().map(|s| s.as_str()))
            .bind(style)
            .execute(starwars_db)
            .await
            {
                warn!("⚠️ Failed to save character to Star Wars database (non-critical): {}", e);
            }
            
            // Also update in-memory state
            let mut gs = game_state.write().await;
            gs.add_character(character.clone());
            info!("✅ Character '{}' added to in-memory game state", character.name);
            
            // Broadcast character list update
            let characters: Vec<Character> = gs.characters.values().cloned().collect();
            let character_list = ServerMessage::CharacterList { characters, style: None };
            broadcast_message(clients, &character_list).await;
        }
        
        ClientMessage::UpdateCharacter { character } => {
            // Save to both databases to ensure persistence
            let style = "dnd"; // Default style
            
            // Update in D&D database
            if let Err(e) = sqlx::query(
                "INSERT OR REPLACE INTO characters (id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&character.id)
            .bind(&character.name)
            .bind(&character.player_name)
            .bind(&character.class)
            .bind(character.level)
            .bind(character.max_hp)
            .bind(character.current_hp)
            .bind(character.armor_class)
            .bind(character.initiative_bonus)
            .bind(character.strength)
            .bind(character.dexterity)
            .bind(character.constitution)
            .bind(character.intelligence)
            .bind(character.wisdom)
            .bind(character.charisma)
            .bind(character.speed)
            .bind(character.proficiency_bonus)
            .bind(character.character_data.as_ref().map(|s| s.as_str()).unwrap_or(""))
            .bind(character.portrait_url.as_ref().map(|s| s.as_str()))
            .bind(style)
            .execute(dnd_db)
            .await
            {
                error!("Failed to update character in D&D database: {}", e);
            } else {
                info!("✅ Character updated in D&D database: {}", character.name);
            }
            
            // Also update in Star Wars database
            if let Err(e) = sqlx::query(
                "INSERT OR REPLACE INTO characters (id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url, style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&character.id)
            .bind(&character.name)
            .bind(&character.player_name)
            .bind(&character.class)
            .bind(character.level)
            .bind(character.max_hp)
            .bind(character.current_hp)
            .bind(character.armor_class)
            .bind(character.initiative_bonus)
            .bind(character.strength)
            .bind(character.dexterity)
            .bind(character.constitution)
            .bind(character.intelligence)
            .bind(character.wisdom)
            .bind(character.charisma)
            .bind(character.speed)
            .bind(character.proficiency_bonus)
            .bind(character.character_data.as_ref().map(|s| s.as_str()).unwrap_or(""))
            .bind(character.portrait_url.as_ref().map(|s| s.as_str()))
            .bind(style)
            .execute(starwars_db)
            .await
            {
                warn!("Failed to update character in Star Wars database: {}", e);
            }
            
            // Also update in-memory state
            let mut gs = game_state.write().await;
            gs.update_character(character.clone());
            
            let characters: Vec<Character> = gs.characters.values().cloned().collect();
            let character_list = ServerMessage::CharacterList { characters, style: None };
            broadcast_message(clients, &character_list).await;
        }
        
        ClientMessage::DeleteCharacter { character_id } => {
            // Delete from both databases
            if let Err(e) = sqlx::query("DELETE FROM characters WHERE id = ?")
                .bind(&character_id)
                .execute(dnd_db)
                .await
            {
                error!("Failed to delete character from D&D database: {}", e);
            } else {
                info!("✅ Character deleted from D&D database: {}", character_id);
            }
            
            if let Err(e) = sqlx::query("DELETE FROM characters WHERE id = ?")
                .bind(&character_id)
                .execute(starwars_db)
                .await
            {
                warn!("Failed to delete character from Star Wars database: {}", e);
            }
            
            // Also remove from in-memory state
            let mut gs = game_state.write().await;
            gs.characters.remove(&character_id);
            
            let characters: Vec<Character> = gs.characters.values().cloned().collect();
            let character_list = ServerMessage::CharacterList { characters, style: None };
            broadcast_message(clients, &character_list).await;
        }
        
        ClientMessage::SelectCharacter { character_id } => {
            game_state.write().await.set_player_character(session_id, character_id);
        }
        
        // Enemy handlers
        ClientMessage::CreateEnemy { enemy } => {
            let db = dnd_db; // Use appropriate DB based on style
            if let Err(e) = sqlx::query(
                "INSERT OR REPLACE INTO enemies (id, name, creature_type, challenge_rating, max_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, actions, description, portrait_url, style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&enemy.id)
            .bind(&enemy.name)
            .bind(&enemy.creature_type)
            .bind(enemy.challenge_rating)
            .bind(enemy.max_hp)
            .bind(enemy.armor_class)
            .bind(enemy.initiative_bonus)
            .bind(enemy.strength)
            .bind(enemy.dexterity)
            .bind(enemy.constitution)
            .bind(enemy.intelligence)
            .bind(enemy.wisdom)
            .bind(enemy.charisma)
            .bind(enemy.speed)
            .bind(&enemy.actions)
            .bind(&enemy.description)
            .bind(enemy.portrait_url.as_ref())
            .bind("dnd") // Default style
            .execute(db)
            .await
            {
                error!("Failed to create enemy: {}", e);
            }
        }
        
        ClientMessage::SpawnEnemy { enemy_id, instance_id, name } => {
            use crate::models::EnemyInstance;
            // Load enemy template from database - query row by row since tuple is too large
            if let Ok(Some(row)) = sqlx::query(
                "SELECT id, name, creature_type, challenge_rating, max_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, actions, description, portrait_url FROM enemies WHERE id = ?"
            )
            .bind(&enemy_id)
            .fetch_optional(dnd_db)
            .await
            {
                let enemy_name: String = row.try_get("name").unwrap_or_default();
                let max_hp: i32 = row.try_get("max_hp").unwrap_or(0);
                let armor_class: i32 = row.try_get("armor_class").unwrap_or(10);
                let initiative_bonus: i32 = row.try_get("initiative_bonus").unwrap_or(0);
                
                let instance = EnemyInstance {
                    id: instance_id.clone(),
                    enemy_id: enemy_id.clone(),
                    name: if name.is_empty() { enemy_name } else { name },
                    current_hp: max_hp,
                    max_hp,
                    armor_class,
                    initiative_bonus,
                };
                game_state.write().await.add_enemy_instance(instance);
            }
        }
        
        ClientMessage::ListEnemies => {
            if let Ok(rows) = sqlx::query(
                "SELECT id, name, creature_type, challenge_rating, max_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, actions, description, portrait_url FROM enemies"
            )
            .fetch_all(dnd_db)
            .await
            {
                let enemies: Vec<Enemy> = rows.into_iter().filter_map(|row| {
                    Some(Enemy {
                        id: row.try_get("id").ok()?,
                        name: row.try_get("name").ok()?,
                        creature_type: row.try_get("creature_type").ok()?,
                        challenge_rating: row.try_get("challenge_rating").ok()?,
                        max_hp: row.try_get("max_hp").ok()?,
                        armor_class: row.try_get("armor_class").ok()?,
                        initiative_bonus: row.try_get("initiative_bonus").ok()?,
                        strength: row.try_get("strength").ok()?,
                        dexterity: row.try_get("dexterity").ok()?,
                        constitution: row.try_get("constitution").ok()?,
                        intelligence: row.try_get("intelligence").ok()?,
                        wisdom: row.try_get("wisdom").ok()?,
                        charisma: row.try_get("charisma").ok()?,
                        speed: row.try_get("speed").ok()?,
                        actions: row.try_get("actions").ok()?,
                        description: row.try_get("description").ok()?,
                        portrait_url: row.try_get("portrait_url").ok()?,
                    })
                }).collect();
                let enemy_list = ServerMessage::EnemyList { enemies };
                broadcast_message(clients, &enemy_list).await;
            }
        }
        
        ClientMessage::DeleteEnemy { enemy_id } => {
            if let Err(e) = sqlx::query("DELETE FROM enemies WHERE id = ?")
                .bind(&enemy_id)
                .execute(dnd_db)
                .await
            {
                error!("Failed to delete enemy: {}", e);
            }
        }
        
        // Ability check handlers - just broadcast
        ClientMessage::RollAbilityCheck { character_name, ability, roll, modifier, total } => {
            let ability_check = ServerMessage::AbilityCheckRolled { character_name, ability, roll, modifier, total };
            broadcast_message(clients, &ability_check).await;
        }
        
        ClientMessage::RollSavingThrow { character_name, ability, roll, modifier, total } => {
            let saving_throw = ServerMessage::SavingThrowRolled { character_name, ability, roll, modifier, total };
            broadcast_message(clients, &saving_throw).await;
        }
        
        ClientMessage::RollSkill { character_name, skill, roll, modifier, total } => {
            let skill_roll = ServerMessage::SkillRolled { character_name, skill, roll, modifier, total };
            broadcast_message(clients, &skill_roll).await;
        }
        
        ClientMessage::RollAttack { character_name, weapon, to_hit_roll, to_hit_mod, to_hit_total, damage, damage_type } => {
            let attack_roll = ServerMessage::AttackRolled { character_name, weapon, to_hit_roll, to_hit_mod, to_hit_total, damage, damage_type };
            broadcast_message(clients, &attack_roll).await;
        }
        
        // Custom spell handlers - would need database
        ClientMessage::SaveCustomSpell { .. } => {
            warn!("SaveCustomSpell needs database implementation");
        }
        
        ClientMessage::GetCustomSpell { .. } => {
            warn!("GetCustomSpell needs database implementation");
        }
        
        ClientMessage::GetAllCustomSpells => {
            warn!("GetAllCustomSpells needs database implementation");
        }
        
        ClientMessage::DeleteCustomSpell { .. } => {
            warn!("DeleteCustomSpell needs database implementation");
        }
    }
}

async fn broadcast_message(clients: &Clients, message: &ServerMessage) {
    let json = match serde_json::to_string(message) {
        Ok(json) => json,
        Err(e) => {
            error!("Failed to serialize message: {}", e);
            return;
        }
    };

    let clients_read = clients.read().await;
    let mut failed_sends = Vec::new();
    
    for (session_id, sender) in clients_read.iter() {
        if sender.send(json.clone()).is_err() {
            failed_sends.push(session_id.clone());
        }
    }
    
    drop(clients_read);
    
    // Remove failed clients
    if !failed_sends.is_empty() {
        let mut clients_write = clients.write().await;
        for session_id in failed_sends {
            clients_write.remove(&session_id);
        }
    }
}
