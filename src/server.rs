use crate::models::{ClientMessage, ServerMessage};
use crate::game_state::GameState;
use crate::db::Database;
use base64::{Engine as _, engine::general_purpose};
use serde::Deserialize;
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit,
        Json, State, Path, Multipart, Query,
    },
    response::{Response, IntoResponse},
    routing::{get, post, delete},
    http::{StatusCode, header},
    Router,
};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info, warn};
use uuid::Uuid;
use sqlx::Row;

type Clients = Arc<RwLock<HashMap<String, broadcast::Sender<String>>>>;

/// Same path the Node `discord-bot` reads (`__dirname`/discord_links.json), independent of server process cwd.
fn discord_links_json_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("discord-bot")
        .join("discord_links.json")
}

async fn load_characters_from_db(db: &Database, game_state: &Arc<RwLock<GameState>>, db_name: &str) {
    use crate::models::Character;
    
    // Style column should already exist from database initialization
    // Try loading with style column first (most common case)
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
            // If query failed due to missing style column (shouldn't happen, but handle gracefully)
            let err_str = e.to_string();
            if err_str.contains("no such column: style") {
                warn!("⚠️ Style column missing in {} database, trying fallback query...", db_name);
                // Try loading without style column (legacy support)
                if let Ok(rows) = sqlx::query(
                    "SELECT id, name, player_name, class, level, max_hp, current_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, proficiency_bonus, character_data, portrait_url FROM characters"
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
                    info!("✅ Loaded {} characters from {} database (legacy format)", count, db_name);
                } else {
                    error!("❌ Failed to load characters from {} database even with fallback", db_name);
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
    let (shutdown_tx, shutdown_rx) = broadcast::channel(1);

    // CRITICAL: Load all characters from database on startup
    // Do this in parallel to speed up startup
    info!("🔄 Loading characters from databases on startup...");
    let dnd_future = load_characters_from_db(&dnd_db, &game_state, "D&D");
    let sw_future = load_characters_from_db(&starwars_db, &game_state, "Star Wars");
    
    // Run both in parallel
    tokio::join!(dnd_future, sw_future);
    
    let char_count = game_state.read().await.characters.len();
    if char_count > 0 {
        info!("✅ Successfully loaded {} total characters into game state on startup", char_count);
    } else {
        warn!("⚠️ No characters found in databases on startup");
    }

    // Ensure saves directory exists
    if let Err(e) = tokio::fs::create_dir_all("saves").await {
        warn!("⚠️ Could not create saves directory: {}", e);
    }
    if let Err(e) = tokio::fs::create_dir_all("campaign_notes").await {
        warn!("⚠️ Could not create campaign_notes directory: {}", e);
    }

    let app = Router::new()
        .route("/ws", get(websocket_handler))
        .route("/", get(|| async {
            let no_cache = [(header::CACHE_CONTROL.as_str(), "no-store, no-cache, must-revalidate")];
            match tokio::fs::read_to_string("static/index.html").await {
                Ok(content) => (no_cache, axum::response::Html(content)).into_response(),
                Err(_) => (no_cache, axum::response::Html(include_str!("../static/index.html").to_string())).into_response(),
            }
        }))
        .route("/api/test", get(|| async { 
            axum::response::Json(serde_json::json!({"status": "ok", "message": "API is working"}))
        }))
        .route("/api/compendium/sw5e/categories", get(sw5e_compendium_categories_http))
        .route("/api/compendium/sw5e/browse", get(sw5e_compendium_browse_http))
        .route("/api/compendium/sw5e/category-export", get(sw5e_compendium_category_export_http))
        .route("/api/compendium/sw5e/player-kit", post(sw5e_player_kit_http))
        .route("/api/maps", get(list_maps_http))
        .route("/api/saves", get(list_saved_states))
        .route("/api/saves/:filename", get(get_saved_state))
        .route("/api/saves/:filename", post(save_game_state_handler))
        .route("/api/saves/:filename", delete(delete_saved_state))
        .route(
            "/api/campaign-notes/:id",
            get(get_campaign_notes).put(put_campaign_notes),
        )
        .route("/api/sounds", get(list_sounds))
        .route("/api/sounds", post(upload_sound))
        .route("/api/sounds/:filename", delete(delete_sound))
        .route("/static/sounds/:filename", get(get_sound_file))
        .route("/api/arena-stl", post(upload_arena_stl))
        .route("/api/meshy-generate-arena-stl", post(meshy_generate_arena_stl))
        .nest_service("/static", tower_http::services::ServeDir::new("static"))
        // Axum's default body limit is 2MB; Multipart ignores tower's RequestBodyLimitLayer until
        // DefaultBodyLimit is raised — without this, large STL uploads can abort (browser: "Failed to fetch").
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .with_state((dnd_db, starwars_db, game_state, clients.clone(), shutdown_tx.clone()));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    let addr = listener.local_addr()?;
    info!("Server listening on http://0.0.0.0:3000");
    info!("✅ Save/Load API endpoints available:");
    info!("   GET  /api/test - Test endpoint");
    info!("   GET  /api/maps - List maps (compact JSON for UI)");
    info!("   GET  /api/saves - List saved states");
    info!("   GET  /api/saves/:filename - Get saved state");
    info!("   POST /api/saves/:filename - Save game state");
    info!("   DELETE /api/saves/:filename - Delete saved state");
    info!("   POST /api/arena-stl - Upload .stl / .glb for 3D token minis (static/arena_stl)");
    info!("   POST /api/meshy-generate-arena-stl - Meshy image→3D, NDJSON progress stream → static/arena_stl/<name>_<uuid>.glb");
    info!("   GET  /api/compendium/sw5e/categories - SW5e compendium row counts by category");
    info!("   GET  /api/compendium/sw5e/browse?category=tech_powers&offset=&limit=");
    info!("   GET  /api/compendium/sw5e/category-export?category=tech_powers|force_powers - full slice for client caches");
    info!("   POST /api/compendium/sw5e/player-kit - SW5e class + specialization + features for player UI");

    // Open browser automatically
    let url = format!("http://localhost:{}", addr.port());
    info!("🌐 Opening browser at {}", url);
    if let Err(e) = open::that(&url) {
        warn!("⚠️ Could not open browser automatically: {}. Please navigate to {}", e, url);
    } else {
        info!("✅ Browser opened successfully!");
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(shutdown_rx))
        .await?;
    info!("Server shut down.");
    Ok(())
}

/// Waits for Ctrl+C, Unix SIGTERM, or DM shutdown request. Does not panic so normal
/// client actions cannot stop the server.
async fn shutdown_signal(mut shutdown_rx: broadcast::Receiver<()>) {
    let ctrl_c = async {
        if let Err(e) = signal::ctrl_c().await {
            warn!("Ctrl+C handler not available: {}. Use DM Shutdown button to stop server.", e);
            std::future::pending::<()>().await
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => { sig.recv().await; }
            Err(e) => {
                warn!("SIGTERM handler not available: {}", e);
                std::future::pending::<()>().await
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => { info!("Shutdown: Ctrl+C"); }
        _ = terminate => { info!("Shutdown: SIGTERM"); }
        _ = shutdown_rx.recv() => { info!("Shutdown: DM requested"); }
    }
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State((dnd_db, starwars_db, game_state, clients, shutdown_tx)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
        broadcast::Sender<()>,
    )>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, dnd_db, starwars_db, game_state, clients, shutdown_tx))
}

async fn handle_socket(
    socket: WebSocket,
    dnd_db: Database,
    starwars_db: Database,
    game_state: Arc<RwLock<GameState>>,
    clients: Clients,
    shutdown_tx: broadcast::Sender<()>,
) {
    let (mut sender, mut receiver) = socket.split();
    let session_id = Uuid::new_v4().to_string();
    
    // Large buffer while the send task drains onto TCP — slow/long-distance clients can otherwise lag and miss
    // early MapLoaded / TokenUpdate / EnemyInstance bursts during Connect.
    let (tx, mut rx) = broadcast::channel(4096);
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
    let game_state_for_disconnect = game_state.clone();
    
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
    let shutdown_tx_clone = shutdown_tx.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = receiver.next().await {
            match serde_json::from_str::<ClientMessage>(&text) {
                Ok(client_msg) => {
                    handle_client_message(
                        client_msg,
                        &session_id,
                        &game_state,
                        &clients,
                        &dnd_db_clone,
                        &starwars_db_clone,
                        &shutdown_tx_clone,
                    ).await;
                }
                Err(e) => {
                    error!("❌ Failed to deserialize client message: {}", e);
                    error!("   Message text: {}", text);
                    // Try to log what type of message it was supposed to be
                    if let Ok(partial) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(msg_type) = partial.get("type") {
                            error!("   Message type: {}", msg_type);
                        }
                    }
                }
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
    {
        let mut gs = game_state_for_disconnect.write().await;
        gs.remove_player(&session_id_clone);
    }
    info!("Client {} disconnected", session_id_clone);
}

async fn enemy_template_portrait_url(
    dnd_db: &Database,
    starwars_db: &Database,
    template_id: &str,
) -> Option<String> {
    for pool in [dnd_db, starwars_db] {
        let Ok(Some(row)) = sqlx::query("SELECT portrait_url FROM enemies WHERE id = ?")
            .bind(template_id)
            .fetch_optional(pool)
            .await
        else {
            continue;
        };
        if let Some(u) = row
            .try_get::<Option<String>, _>("portrait_url")
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty())
        {
            return Some(u);
        }
    }
    None
}

async fn enemy_template_actions_json(
    dnd_db: &Database,
    starwars_db: &Database,
    template_id: &str,
) -> Option<String> {
    for pool in [dnd_db, starwars_db] {
        let Ok(Some(row)) = sqlx::query("SELECT actions FROM enemies WHERE id = ?")
            .bind(template_id)
            .fetch_optional(pool)
            .await
        else {
            continue;
        };
        if let Ok(a) = row.try_get::<String, _>("actions") {
            return Some(a);
        }
    }
    None
}

/// Fill in token.display_name and token.image_url (portrait) from enemy_instances or DB so players see names and pictures.
async fn enrich_tokens_with_display_names(
    mut tokens: Vec<crate::models::Token>,
    game_state: &Arc<RwLock<GameState>>,
    dnd_db: &Database,
    starwars_db: &Database,
) -> Vec<crate::models::Token> {
    use crate::models::TokenType;
    let gs = game_state.read().await;
    let mut need_portrait: Vec<(usize, String)> = Vec::new();
    for (i, t) in tokens.iter_mut().enumerate() {
        if !matches!(t.entity_type, TokenType::Enemy | TokenType::NPC) {
            continue;
        }
        if let Some(ref u) = t.image_url {
            if u.trim().is_empty() {
                t.image_url = None;
            }
        }
        if t.display_name.is_none() {
            if let Some(name) = gs.get_enemy_instance(&t.entity_id).map(|e| e.name.clone()) {
                t.display_name = Some(name);
            }
        }
        if t.image_url.is_none() {
            let template_id = gs
                .get_enemy_instance(&t.entity_id)
                .map(|e| e.enemy_id.clone())
                .unwrap_or_else(|| t.entity_id.clone());
            need_portrait.push((i, template_id));
        }
    }
    drop(gs);
    for (i, template_id) in need_portrait {
        if let Some(url) =
            enemy_template_portrait_url(dnd_db, starwars_db, &template_id).await
        {
            tokens[i].image_url = Some(url);
        }
    }
    for t in tokens.iter_mut() {
        if t.display_name.is_some() {
            continue;
        }
        if matches!(t.entity_type, TokenType::Enemy | TokenType::NPC) {
            let mut filled = false;
            for pool in [dnd_db, starwars_db] {
                if let Ok(Some(row)) =
                    sqlx::query("SELECT name, portrait_url FROM enemies WHERE id = ?")
                        .bind(&t.entity_id)
                        .fetch_optional(pool)
                        .await
                {
                    filled = true;
                    if let Ok(n) = row.try_get::<String, _>("name") {
                        t.display_name = Some(n);
                    }
                    if t.image_url.is_none() {
                        if let Ok(Some(url)) = row.try_get::<Option<String>, _>("portrait_url") {
                            if !url.trim().is_empty() {
                                t.image_url = Some(url);
                            }
                        }
                    }
                    break;
                }
            }
            if !filled {
                continue;
            }
        }
    }
    tokens
}

/// Enemy templates are stored in `dnd_db` or `starwars_db` depending on `style`. Merge for full lists.
async fn fetch_enemies_merged(dnd_db: &Database, starwars_db: &Database) -> Vec<crate::models::Enemy> {
    use crate::models::Enemy;
    use sqlx::Row;
    use std::collections::HashSet;

    let sql = "SELECT id, name, creature_type, challenge_rating, max_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, actions, description, portrait_url, style FROM enemies";
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for pool in [dnd_db, starwars_db] {
        let Ok(rows) = sqlx::query(sql).fetch_all(pool).await else {
            continue;
        };
        for row in rows {
            let Ok(id) = row.try_get::<String, _>("id") else {
                continue;
            };
            if !seen.insert(id.clone()) {
                continue;
            }
            let style: String = row
                .try_get::<String, _>("style")
                .unwrap_or_else(|_| "dnd".to_string());
            let Some(enemy) = (|| {
                Some(Enemy {
                    id,
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
                    style,
                })
            })() else {
                continue;
            };
            out.push(enemy);
        }
    }
    out
}

/// Compact rows for `MapList` / GET /api/maps — never ship full `map_state` (breaks WebSocket JSON size).
///
/// NOTE: Historically, maps have existed in both `gorgox_dnd.db` and `gorgox_starwars.db`.
/// We treat maps as shared assets and list/resolve them from either DB, without deleting anything.
async fn fetch_maps_for_list(dnd_db: &Database, starwars_db: &Database) -> Vec<crate::models::Map> {
    use crate::models::Map;
    use std::collections::HashMap;

    async fn fetch_one(pool: &Database) -> Vec<Map> {
        // Backward compatible: older DBs may not have the `map_state` column yet.
        // In that case, list maps anyway (state indicator will be absent).
        let with_state = sqlx::query(
            "SELECT id, name, image_path, grid_size, width, height, map_state FROM maps ORDER BY name",
        )
        .fetch_all(pool)
        .await;

        match with_state {
            Ok(rows) => {
                return rows
                    .into_iter()
                    .map(|row| {
                        let full = row.get::<Option<String>, _>(6);
                        Map {
                            id: row.get::<String, _>(0),
                            name: row.get::<String, _>(1),
                            image_path: row.get::<String, _>(2),
                            grid_size: row.get::<i32, _>(3),
                            width: row.get::<i32, _>(4),
                            height: row.get::<i32, _>(5),
                            // Placeholder only: "has state" indicator for UI
                            map_state: full
                                .filter(|s| !s.trim().is_empty())
                                .map(|_| "1".to_string()),
                        }
                    })
                    .collect();
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.to_lowercase().contains("map_state") && msg.to_lowercase().contains("no such column") {
                    // fallback below
                } else {
                    error!("fetch_maps_for_list (pool): {}", e);
                    return Vec::new();
                }
            }
        }

        match sqlx::query("SELECT id, name, image_path, grid_size, width, height FROM maps ORDER BY name")
            .fetch_all(pool)
            .await
        {
            Ok(rows) => rows
                .into_iter()
                .map(|row| Map {
                    id: row.get::<String, _>(0),
                    name: row.get::<String, _>(1),
                    image_path: row.get::<String, _>(2),
                    grid_size: row.get::<i32, _>(3),
                    width: row.get::<i32, _>(4),
                    height: row.get::<i32, _>(5),
                    map_state: None,
                })
                .collect(),
            Err(e) => {
                error!("fetch_maps_for_list (fallback, pool): {}", e);
                Vec::new()
            }
        }
    }

    let mut merged: HashMap<String, Map> = HashMap::new();
    for m in fetch_one(dnd_db).await {
        merged.insert(m.id.clone(), m);
    }
    for m in fetch_one(starwars_db).await {
        merged
            .entry(m.id.clone())
            .and_modify(|existing| {
                // Prefer showing "has saved state" if either DB has it
                if existing.map_state.is_none() && m.map_state.is_some() {
                    existing.map_state = m.map_state.clone();
                }
            })
            .or_insert(m);
    }

    let mut maps: Vec<Map> = merged.into_values().collect();
    maps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    maps
}

#[derive(Deserialize)]
struct Sw5eBrowseQuery {
    category: String,
    #[serde(default)]
    offset: u64,
    #[serde(default = "sw5e_browse_default_limit")]
    limit: u64,
}

#[derive(Debug, serde::Deserialize)]
struct Sw5eCategoryExportQuery {
    category: String,
}

fn sw5e_browse_default_limit() -> u64 {
    50
}

async fn sw5e_compendium_categories_http(
    State((_dnd, starwars, _, _, _)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
        broadcast::Sender<()>,
    )>,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    match crate::db::sw5e_compendium_category_counts(&starwars).await {
        Ok(categories) => {
            let total_rows: i64 = categories.iter().map(|c| c.count).sum();
            Ok(axum::Json(serde_json::json!({
                "categories": categories,
                "total_rows": total_rows,
            })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

async fn sw5e_compendium_category_export_http(
    State((_dnd, starwars, _, _, _)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
        broadcast::Sender<()>,
    )>,
    Query(q): Query<Sw5eCategoryExportQuery>,
) -> impl IntoResponse {
    let cat = q.category.trim();
    if !matches!(cat, "tech_powers" | "force_powers") {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "allowed categories: tech_powers, force_powers",
            })),
        )
            .into_response();
    }
    match crate::db::sw5e_compendium_category_export(&starwars, cat).await {
        Ok(rows) => axum::Json(serde_json::json!({
            "category": cat,
            "count": rows.len(),
            "rows": rows,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn sw5e_compendium_browse_http(
    State((_dnd, starwars, _, _, _)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
        broadcast::Sender<()>,
    )>,
    Query(q): Query<Sw5eBrowseQuery>,
) -> impl IntoResponse {
    let cat_trim = q.category.trim();
    if cat_trim.is_empty() || !crate::db::sw5e_compendium_allowed_category(cat_trim) {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid or missing category"})),
        )
            .into_response();
    }
    match crate::db::sw5e_compendium_browse(&starwars, cat_trim, q.offset, q.limit).await {
        Ok((items, total)) => axum::Json(serde_json::json!({
            "category": cat_trim,
            "offset": q.offset,
            "limit": q.limit,
            "total": total,
            "items": items,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn sw5e_player_kit_http(
    State((_dnd, starwars, _, _, _)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
        broadcast::Sender<()>,
    )>,
    Json(body): Json<crate::db::Sw5ePlayerKitRequest>,
) -> impl IntoResponse {
    match crate::db::sw5e_player_kit(&starwars, &body).await {
        Ok(v) => axum::Json(v).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_maps_http(
    State((dnd_db, starwars_db, _, _, _)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
        broadcast::Sender<()>,
    )>,
) -> axum::response::Json<serde_json::Value> {
    let maps = fetch_maps_for_list(&dnd_db, &starwars_db).await;
    axum::response::Json(serde_json::json!({ "maps": maps }))
}

async fn handle_client_message(
    msg: ClientMessage,
    session_id: &str,
    game_state: &Arc<RwLock<GameState>>,
    clients: &Clients,
    dnd_db: &Database,
    starwars_db: &Database,
    shutdown_tx: &broadcast::Sender<()>,
) {
    use crate::models::{CombatParticipant, Character, Map};
    use uuid::Uuid;
    match msg {
        ClientMessage::Connect { player_name, is_dm, style: _ } => {
            let player_name_clone = player_name.clone();
            info!("Player {} connected as {}", player_name_clone, if is_dm { "DM" } else { "Player" });
            game_state.write().await.add_player(session_id.to_string(), player_name, is_dm);
            
            let role_msg = ServerMessage::PlayerRole { is_dm };
            send_to_client(clients, session_id, &role_msg).await;
            
            // IMPORTANT: Send current game state immediately to new player
            // This ensures they see the map, tokens, and characters right away
            let gs = game_state.read().await;
            
            // Send current map if loaded
            if let Some(ref map) = gs.current_map {
                let map_loaded = ServerMessage::MapLoaded {
                    map: map.for_client_wire(),
                    player_map_viewport: gs.player_map_viewport.clone(),
                };
                send_to_client(clients, session_id, &map_loaded).await;
                info!("📤 Sent current map to new player: {}", map.name);
            }

            // Player map viewport (anti-metagame window) — must be sent on join or players who
            // connect after the DM enabled it never receive enabled:true and see the full map.
            let vp = gs.player_map_viewport.clone();
            let vp_msg = ServerMessage::PlayerMapViewportUpdated {
                enabled: vp.enabled,
                x: vp.x,
                y: vp.y,
                width: vp.width,
                height: vp.height,
            };
            send_to_client(clients, session_id, &vp_msg).await;
            
            let tokens_to_send = if gs.tokens.is_empty() { None } else { Some(gs.tokens.clone()) };
            let enemy_instances_join: Vec<crate::models::EnemyInstance> =
                gs.enemy_instances.values().cloned().collect();
            
            // Send current characters list
            let characters: Vec<Character> = gs.characters.values().cloned().collect();
            if !characters.is_empty() {
                let character_list = ServerMessage::CharacterList { 
                    characters: characters.clone(), 
                    style: None 
                };
                send_to_client(clients, session_id, &character_list).await;
                info!("📤 Sent {} characters to new player", characters.len());
            }
            
            // Send combat state if active (use server's participant list so order and membership match)
            if gs.combat.active {
                let participants = gs.combat.participants.clone();
                let combat_started = ServerMessage::CombatStarted { participants };
                send_to_client(clients, session_id, &combat_started).await;
                info!("📤 Sent combat state to new player");
            }
            
            drop(gs);
            
            if let Some(tokens) = tokens_to_send {
                let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
                let token_update = ServerMessage::TokenUpdate { tokens: tokens.clone() };
                send_to_client(clients, session_id, &token_update).await;
                info!("📤 Sent {} tokens to new player", tokens.len());
            }
            
            for inst in enemy_instances_join {
                let portrait_url =
                    enemy_template_portrait_url(dnd_db, starwars_db, &inst.enemy_id).await;
                let actions = enemy_template_actions_json(dnd_db, starwars_db, &inst.enemy_id).await;
                let msg = ServerMessage::EnemyInstanceSpawned {
                    instance_id: inst.id.clone(),
                    enemy_id: inst.enemy_id.clone(),
                    name: inst.name.clone(),
                    portrait_url,
                    actions,
                };
                send_to_client(clients, session_id, &msg).await;
            }
            
            // Broadcast player joined to all other clients
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
        ClientMessage::PlaceToken {
            entity_id,
            entity_type,
            x,
            y,
            size,
            display_name,
            image_url,
            hidden_from_players,
        } => {
            use crate::models::Token;
            
            let map_id = {
                let gs = game_state.read().await;
                gs.current_map.as_ref().map(|m| m.id.clone()).unwrap_or_default()
            };
            
            let image_url = image_url.filter(|s| !s.trim().is_empty());
            let display_name = display_name
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let hidden_from_players =
                matches!(&entity_type, crate::models::TokenType::Object) && hidden_from_players;
            
            let token = Token {
                id: uuid::Uuid::new_v4().to_string(),
                map_id: map_id.clone(),
                entity_id: entity_id.clone(),
                entity_type: entity_type.clone(),
                x,
                y,
                size: size.unwrap_or(1.0),
                image_url,
                display_name: display_name.clone(),
                hidden_from_players,
            };
            
            info!("📍 Placing token: entity_id={}, type={:?}, pos=({}, {}), map_id='{}', display_name={:?}", 
                entity_id, entity_type, x, y, map_id, display_name);
            
            let mut gs = game_state.write().await;
            gs.add_token(token.clone());
            let token_count = gs.tokens.len();
            drop(gs);
            
            info!("✅ Token placed. Total tokens in game state: {}", token_count);
            
            // Broadcast token update to all clients
            let tokens = game_state.read().await.tokens.clone();
            let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
            let token_update = ServerMessage::TokenUpdate { tokens };
            broadcast_message(clients, &token_update).await;
        }
        
        ClientMessage::MoveToken { token_id, x, y } => {
            let moved = {
                let mut gs = game_state.write().await;
                gs.move_token(&token_id, x as f32, y as f32)
            };
            
            if moved {
                info!("📍 Token {} moved to ({}, {})", token_id, x, y);
                let tokens = game_state.read().await.tokens.clone();
                let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
                let token_update = ServerMessage::TokenUpdate { tokens };
                broadcast_message(clients, &token_update).await;
            } else {
                warn!("⚠️ Failed to move token {} - token not found", token_id);
            }
        }
        
        ClientMessage::RemoveToken { token_id } => {
            if game_state.write().await.remove_token(&token_id) {
                let tokens = game_state.read().await.tokens.clone();
                let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
                let token_update = ServerMessage::TokenUpdate { tokens };
                broadcast_message(clients, &token_update).await;
            }
        }
        
        ClientMessage::UpdateTokenSize { token_id, size } => {
            // Only DM can update token size - check from game state
            let gs = game_state.read().await;
            let is_dm = gs.players.get(session_id)
                .map(|p| p.is_dm)
                .unwrap_or(false);
            drop(gs);
            
            if !is_dm {
                return;
            }
            
            // Find and update the token
            let mut gs = game_state.write().await;
            if let Some(token) = gs.tokens.iter_mut().find(|t| t.id == token_id) {
                token.size = size;
                drop(gs); // Release the lock
                
                // Broadcast updated tokens to all clients
                let tokens = game_state.read().await.tokens.clone();
                let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
                let token_update = ServerMessage::TokenUpdate { tokens };
                broadcast_message(clients, &token_update).await;
            }
        }

        ClientMessage::UpdateTokenHiddenFromPlayers {
            token_id,
            hidden_from_players,
        } => {
            let gs = game_state.read().await;
            let is_dm = gs
                .players
                .get(session_id)
                .map(|p| p.is_dm)
                .unwrap_or(false);
            drop(gs);

            if !is_dm {
                return;
            }

            let mut gs = game_state.write().await;
            if let Some(token) = gs.tokens.iter_mut().find(|t| t.id == token_id) {
                if token.entity_type != crate::models::TokenType::Object {
                    return;
                }
                token.hidden_from_players = hidden_from_players;
                drop(gs);

                let tokens = game_state.read().await.tokens.clone();
                let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
                let token_update = ServerMessage::TokenUpdate { tokens };
                broadcast_message(clients, &token_update).await;
            }
        }
        
        // Ruler tool - just broadcast
        ClientMessage::RulerUpdate { start_x, start_y, end_x, end_y } => {
            let ruler_update = ServerMessage::RulerUpdate { start_x, start_y, end_x, end_y };
            broadcast_message(clients, &ruler_update).await;
        }
        
        // Measurement shapes - broadcast to all clients
        ClientMessage::MeasurementShapeAdded { shape } => {
            let shape_added = ServerMessage::MeasurementShapeAdded { shape };
            broadcast_message(clients, &shape_added).await;
        }
        
        ClientMessage::ClearMeasurements => {
            let clear_measurements = ServerMessage::ClearMeasurements;
            broadcast_message(clients, &clear_measurements).await;
        }
        
        // Ping location - broadcast to all clients
        ClientMessage::PingLocation { x, y, player_name } => {
            let ping = ServerMessage::PingLocation { x, y, player_name };
            broadcast_message(clients, &ping).await;
        }
        
        // Discord integration - highlight character
        ClientMessage::HighlightCharacter { character_id, discord_user_id, discord_username, duration } => {
            info!("📥 Received HighlightCharacter from Discord bot: character_id={}, discord_user={} ({})", 
                character_id, discord_username, discord_user_id);
            let highlight = ServerMessage::HighlightCharacter {
                character_id,
                discord_user_id,
                discord_username,
                duration
            };
            info!("📤 Broadcasting HighlightCharacter to all clients");
            broadcast_message(clients, &highlight).await;
        }
        
        // Discord account linking - save to file for bot
        ClientMessage::LinkDiscordAccount { character_id, discord_user_id, character_name } => {
            // Save link to discord_links.json (crate-root discord-bot/ — matches Node bot resolve path)
            use tokio::fs;
            
            let links_file = discord_links_json_path();
            
            info!("📥 Received LinkDiscordAccount request: discord_user_id={}, character_id={}, character_name={}", 
                discord_user_id, character_id, character_name);
            info!("📁 Saving to: {}", links_file.display());
            
            // Ensure discord-bot directory exists
            if let Some(parent) = links_file.parent() {
                if let Err(e) = fs::create_dir_all(parent).await {
                    warn!("⚠️ Failed to create discord-bot directory: {}", e);
                }
            }
            
            // Load existing links
            let mut links: std::collections::HashMap<String, String> = if links_file.exists() {
                match fs::read_to_string(&links_file).await {
                    Ok(content) => {
                        match serde_json::from_str::<std::collections::HashMap<String, String>>(&content) {
                            Ok(parsed) => {
                                info!("✅ Loaded {} existing Discord link(s) from file", parsed.len());
                                parsed
                            }
                            Err(e) => {
                                warn!("⚠️ Failed to parse existing discord_links.json: {}. Starting fresh.", e);
                                std::collections::HashMap::new()
                            }
                        }
                    }
                    Err(e) => {
                        warn!("⚠️ Failed to read existing discord_links.json: {}. Starting fresh.", e);
                        std::collections::HashMap::new()
                    }
                }
            } else {
                info!("ℹ️ discord_links.json does not exist yet, creating new file");
                std::collections::HashMap::new()
            };
            
            // Update with new link
            let old_character_id = links.insert(discord_user_id.clone(), character_id.clone());
            if let Some(old_id) = old_character_id {
                info!("🔄 Updated existing link: {} was linked to {}, now linked to {}", 
                    discord_user_id, old_id, character_id);
            } else {
                info!("➕ Added new link: {} -> {}", discord_user_id, character_id);
            }
            
            // Save back to file
            match serde_json::to_string_pretty(&links) {
                Ok(json) => {
                    match fs::write(&links_file, json).await {
                        Ok(_) => {
                            info!("✅ Successfully saved Discord link to {}: {} -> {} ({})", 
                                links_file.display(), discord_user_id, character_id, character_name);
                            info!("📊 Total links in file: {}", links.len());
                            
                            // Verify file was written by reading it back
                            if let Ok(verify_content) = fs::read_to_string(&links_file).await {
                                if let Ok(verify_links) = serde_json::from_str::<std::collections::HashMap<String, String>>(&verify_content) {
                                    if verify_links.get(&discord_user_id) == Some(&character_id) {
                                        info!("✅ Verified: Link successfully saved and verified in file");
                                    } else {
                                        warn!("⚠️ Verification failed: Link not found in saved file!");
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            error!("❌ Failed to save Discord link to file: {}", e);
                            error!("   File path: {}", links_file.display());
                            error!("   Error details: {:?}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("❌ Failed to serialize Discord links to JSON: {}", e);
                }
            }
        }
        
        // Combat handlers
        ClientMessage::StartCombat { token_ids } => {
            let mut gs = game_state.write().await;
            let participants: Vec<CombatParticipant> = if let Some(ref ids) = token_ids {
                info!("⚔️ StartCombat: client sent token_ids count = {}", ids.len());
                if ids.is_empty() {
                    gs.tokens.iter().filter_map(|token| {
                        if token.entity_type == crate::models::TokenType::Object {
                            return None;
                        }
                        Some(if let Some(character) = gs.characters.get(&token.entity_id) {
                            CombatParticipant {
                                id: token.id.clone(),
                                entity_id: token.entity_id.clone(),
                                name: character.name.clone(),
                                initiative: 0,
                                initiative_bonus: character.initiative_bonus,
                                entity_type: crate::models::TokenType::Player,
                                current_hp: character.current_hp,
                                max_hp: character.max_hp,
                                armor_class: character.armor_class,
                            }
                        } else if let Some(enemy) = gs.get_enemy_instance(&token.entity_id) {
                            CombatParticipant {
                                id: token.id.clone(),
                                entity_id: token.entity_id.clone(),
                                name: enemy.name.clone(),
                                initiative: 0,
                                initiative_bonus: enemy.initiative_bonus,
                                entity_type: crate::models::TokenType::Enemy,
                                current_hp: enemy.current_hp,
                                max_hp: enemy.max_hp,
                                armor_class: enemy.armor_class,
                            }
                        } else {
                            CombatParticipant {
                                id: token.id.clone(),
                                entity_id: token.entity_id.clone(),
                                name: token.entity_id.clone(),
                                initiative: 0,
                                initiative_bonus: 0,
                                entity_type: token.entity_type.clone(),
                                current_hp: 1,
                                max_hp: 1,
                                armor_class: 10,
                            }
                        })
                    }).collect()
                } else {
                // Client sent token list: one participant per id. Use server token data when present, else placeholder.
                let mut list = Vec::with_capacity(ids.len());
                for id in ids {
                    if let Some(token) = gs.tokens.iter().find(|t| t.id == *id) {
                        let p = if let Some(character) = gs.characters.get(&token.entity_id) {
                            CombatParticipant {
                                id: token.id.clone(),
                                entity_id: token.entity_id.clone(),
                                name: character.name.clone(),
                                initiative: 0,
                                initiative_bonus: character.initiative_bonus,
                                entity_type: crate::models::TokenType::Player,
                                current_hp: character.current_hp,
                                max_hp: character.max_hp,
                                armor_class: character.armor_class,
                            }
                        } else if let Some(enemy) = gs.get_enemy_instance(&token.entity_id) {
                            CombatParticipant {
                                id: token.id.clone(),
                                entity_id: token.entity_id.clone(),
                                name: enemy.name.clone(),
                                initiative: 0,
                                initiative_bonus: enemy.initiative_bonus,
                                entity_type: crate::models::TokenType::Enemy,
                                current_hp: enemy.current_hp,
                                max_hp: enemy.max_hp,
                                armor_class: enemy.armor_class,
                            }
                        } else {
                            CombatParticipant {
                                id: token.id.clone(),
                                entity_id: token.entity_id.clone(),
                                name: token.entity_id.clone(),
                                initiative: 0,
                                initiative_bonus: 0,
                                entity_type: token.entity_type.clone(),
                                current_hp: 1,
                                max_hp: 1,
                                armor_class: 10,
                            }
                        };
                        list.push(p);
                    } else {
                        // Unique placeholder id so multiple enemies get separate turns (e.g. goblin -> goblin-0, goblin-1)
                        let placeholder_id = format!("{}-{}", id, list.len());
                        list.push(CombatParticipant {
                            id: placeholder_id,
                            entity_id: id.clone(),
                            name: id.clone(),
                            initiative: 0,
                            initiative_bonus: 0,
                            entity_type: crate::models::TokenType::Enemy,
                            current_hp: 1,
                            max_hp: 1,
                            armor_class: 10,
                        });
                    }
                }
                info!("⚔️ StartCombat: built {} participants from client token_ids", list.len());
                list
                }
            } else {
                info!("⚔️ StartCombat: no token_ids, using server tokens (count = {})", gs.tokens.len());
                gs.tokens.iter().filter_map(|token| {
                    if token.entity_type == crate::models::TokenType::Object {
                        return None;
                    }
                    Some(if let Some(character) = gs.characters.get(&token.entity_id) {
                        CombatParticipant {
                            id: token.id.clone(),
                            entity_id: token.entity_id.clone(),
                            name: character.name.clone(),
                            initiative: 0,
                            initiative_bonus: character.initiative_bonus,
                            entity_type: crate::models::TokenType::Player,
                            current_hp: character.current_hp,
                            max_hp: character.max_hp,
                            armor_class: character.armor_class,
                        }
                    } else if let Some(enemy) = gs.get_enemy_instance(&token.entity_id) {
                        CombatParticipant {
                            id: token.id.clone(),
                            entity_id: token.entity_id.clone(),
                            name: enemy.name.clone(),
                            initiative: 0,
                            initiative_bonus: enemy.initiative_bonus,
                            entity_type: crate::models::TokenType::Enemy,
                            current_hp: enemy.current_hp,
                            max_hp: enemy.max_hp,
                            armor_class: enemy.armor_class,
                        }
                    } else {
                        CombatParticipant {
                            id: token.id.clone(),
                            entity_id: token.entity_id.clone(),
                            name: token.entity_id.clone(),
                            initiative: 0,
                            initiative_bonus: 0,
                            entity_type: token.entity_type.clone(),
                            current_hp: 1,
                            max_hp: 1,
                            armor_class: 10,
                        }
                    })
                }).collect()
            };

            info!("⚔️ StartCombat: starting combat with {} participants", participants.len());
            gs.combat.start_combat(participants.clone());
            let combat_started = ServerMessage::CombatStarted { participants };
            broadcast_message(clients, &combat_started).await;
        }
        
        ClientMessage::RollInitiative { entity_id, roll, silent, participant_id } => {
            let mut gs = game_state.write().await;
            gs.combat.update_initiative(&entity_id, roll, participant_id.as_deref());
            let initiative_rolled = ServerMessage::InitiativeRolled {
                entity_id: entity_id.clone(),
                initiative: roll,
                silent,
                participant_id: participant_id.clone(),
            };
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
            info!("⚔️ EndCombat received from session {}", session_id);
            game_state.write().await.combat.end_combat();
            let combat_ended = ServerMessage::CombatEnded;
            broadcast_message(clients, &combat_ended).await;
        }

        ClientMessage::RemoveFromCombat { participant_id } => {
            let is_dm = game_state.read().await.players.get(session_id).map(|p| p.is_dm).unwrap_or(false);
            if !is_dm {
                warn!("Non-DM session {} tried to remove from combat; ignored.", session_id);
                return;
            }
            let mut gs = game_state.write().await;
            if !gs.combat.active {
                return;
            }
            gs.combat.remove_participant(&participant_id);
            if gs.combat.participants.is_empty() {
                gs.combat.end_combat();
                let combat_ended = ServerMessage::CombatEnded;
                drop(gs);
                broadcast_message(clients, &combat_ended).await;
            } else {
                let participants = gs.combat.participants.clone();
                let current = gs.combat.get_current_participant().map(|p| (p.id.clone(), p.name.clone()));
                drop(gs);
                let combat_started = ServerMessage::CombatStarted { participants };
                broadcast_message(clients, &combat_started).await;
                if let Some((current_turn, participant_name)) = current {
                    let turn_changed = ServerMessage::TurnChanged { current_turn, participant_name };
                    broadcast_message(clients, &turn_changed).await;
                }
            }
        }

        ClientMessage::RequestShutdown => {
            let is_dm = game_state.read().await.players.get(session_id).map(|p| p.is_dm).unwrap_or(false);
            if is_dm {
                info!("Shutdown requested by DM (session {}). Stopping server.", session_id);
                let _ = shutdown_tx.send(());
            } else {
                warn!("Non-DM session {} tried to request shutdown; ignored.", session_id);
            }
        }

        ClientMessage::RequestFullState => {
            // Send full game state to this client (for slow connections / Refresh button)
            let gs = game_state.read().await;
            if let Some(ref map) = gs.current_map {
                let map_loaded = ServerMessage::MapLoaded {
                    map: map.for_client_wire(),
                    player_map_viewport: gs.player_map_viewport.clone(),
                };
                send_to_client(clients, session_id, &map_loaded).await;
            }
            let vp = gs.player_map_viewport.clone();
            let vp_msg = ServerMessage::PlayerMapViewportUpdated {
                enabled: vp.enabled,
                x: vp.x,
                y: vp.y,
                width: vp.width,
                height: vp.height,
            };
            send_to_client(clients, session_id, &vp_msg).await;
            let tokens_to_send = if gs.tokens.is_empty() { None } else { Some(gs.tokens.clone()) };
            let characters: Vec<crate::models::Character> = gs.characters.values().cloned().collect();
            if !characters.is_empty() {
                let character_list = ServerMessage::CharacterList { characters, style: None };
                send_to_client(clients, session_id, &character_list).await;
            }
            if gs.combat.active {
                // Send current combat participants (server is source of truth; includes everyone in combat)
                let participants = gs.combat.participants.clone();
                let combat_started = ServerMessage::CombatStarted { participants };
                send_to_client(clients, session_id, &combat_started).await;
            }
            info!("📤 Full state sent to session {} (map: {}, tokens: {}, combat: {})",
                session_id,
                gs.current_map.is_some(),
                gs.tokens.len(),
                gs.combat.active);
            drop(gs);
            if let Some(tokens) = tokens_to_send {
                let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
                let token_update = ServerMessage::TokenUpdate { tokens };
                send_to_client(clients, session_id, &token_update).await;
            }
        }
        
        ClientMessage::DealDamage { target_id, damage } => {
            let mut gs = game_state.write().await;
            if let Some((dmg, new_hp)) = gs.combat.deal_damage(&target_id, damage) {
                // CRITICAL: Also update the underlying character or enemy data
                // Extract entity_id and entity_type first to avoid borrow conflicts
                let (entity_id, entity_type) = if let Some(token) = gs.tokens.iter().find(|t| t.id == target_id) {
                    (Some(token.entity_id.clone()), Some(token.entity_type.clone()))
                } else {
                    (None, None)
                };
                
                // Now update character or enemy with mutable borrow
                if let (Some(eid), Some(etype)) = (entity_id, entity_type) {
                    if etype == crate::models::TokenType::Player {
                        // Update character HP
                        if let Some(character) = gs.characters.get_mut(&eid) {
                            character.current_hp = new_hp;
                            info!("Updated character {} HP to {}", character.name, new_hp);
                        }
                    } else if etype == crate::models::TokenType::Enemy {
                        let enemy_name = gs.get_enemy_instance(&eid).map(|e| e.name.clone());
                        gs.update_enemy_instance_hp(&eid, new_hp);
                        if let Some(name) = enemy_name {
                            info!("Updated enemy {} HP to {}", name, new_hp);
                        }
                    }
                }
                
                let damage_dealt = ServerMessage::DamageDealt { target_id, damage: dmg, new_hp };
                broadcast_message(clients, &damage_dealt).await;
            }
        }
        
        ClientMessage::HealTarget { target_id, healing } => {
            let mut gs = game_state.write().await;
            if let Some((heal, new_hp)) = gs.combat.heal_target(&target_id, healing) {
                // CRITICAL: Also update the underlying character or enemy data
                // Extract entity_id and entity_type first to avoid borrow conflicts
                let (entity_id, entity_type) = if let Some(token) = gs.tokens.iter().find(|t| t.id == target_id) {
                    (Some(token.entity_id.clone()), Some(token.entity_type.clone()))
                } else {
                    (None, None)
                };
                
                // Now update character or enemy with mutable borrow
                if let (Some(eid), Some(etype)) = (entity_id, entity_type) {
                    if etype == crate::models::TokenType::Player {
                        // Update character HP
                        if let Some(character) = gs.characters.get_mut(&eid) {
                            character.current_hp = new_hp;
                            info!("Updated character {} HP to {}", character.name, new_hp);
                        }
                    } else if etype == crate::models::TokenType::Enemy {
                        let enemy_name = gs.get_enemy_instance(&eid).map(|e| e.name.clone());
                        gs.update_enemy_instance_hp(&eid, new_hp);
                        if let Some(name) = enemy_name {
                            info!("Updated enemy {} HP to {}", name, new_hp);
                        }
                    }
                }
                
                let healing_applied = ServerMessage::HealingApplied { target_id, healing: heal, new_hp };
                broadcast_message(clients, &healing_applied).await;
            }
        }
        
        // Map handlers
        ClientMessage::CreateMap { name, image_data, width, height } => {
            use std::fs;
            use std::path::Path;
            use crate::models::Token;
            
            let map_id = Uuid::new_v4().to_string();
            let image_path = format!("static/maps/{}.png", map_id);
            
            // Decode and save image FIRST. Never insert a map row if the file isn't on disk —
            // that produced MapLoaded + 404 image forever (looked like "maps don't load").
            let raw_b64: &str = image_data
                .find(";base64,")
                .map(|i| &image_data[i + ";base64,".len()..])
                .unwrap_or(image_data.as_str())
                .trim();
            let image_data_clean: String = raw_b64.chars().filter(|c| !c.is_whitespace()).collect();
            let decoded = match general_purpose::STANDARD.decode(image_data_clean.as_bytes()) {
                Ok(bytes) if !bytes.is_empty() => bytes,
                Ok(_) => {
                    let err = ServerMessage::Error {
                        message: "CreateMap failed: decoded image was empty.".to_string(),
                    };
                    send_to_client(clients, session_id, &err).await;
                    return;
                }
                Err(e) => {
                    error!("Failed to decode base64 image data: {}", e);
                    let err = ServerMessage::Error {
                        message: format!(
                            "CreateMap failed: could not decode image ({}). Try re-exporting as PNG/JPEG.",
                            e
                        ),
                    };
                    send_to_client(clients, session_id, &err).await;
                    return;
                }
            };
            if let Some(parent) = Path::new(&image_path).parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    error!("Failed to create maps directory: {}", e);
                    let err = ServerMessage::Error {
                        message: format!("CreateMap failed: could not create maps folder: {}", e),
                    };
                    send_to_client(clients, session_id, &err).await;
                    return;
                }
            }
            if let Err(e) = fs::write(&image_path, decoded) {
                error!("Failed to save map image to {}: {}", image_path, e);
                let err = ServerMessage::Error {
                    message: format!("CreateMap failed: could not write map image: {}", e),
                };
                send_to_client(clients, session_id, &err).await;
                return;
            }
            info!("Map image saved successfully: {}", image_path);
            
            // Save current state if there are tokens on current map
            let gs = game_state.read().await;
            let map_state_json = if let Some(ref current_map) = gs.current_map {
                // Collect all tokens, HP values, and enemy instances for this map
                let tokens_for_map: Vec<&Token> = gs.tokens.iter()
                    .filter(|t| t.map_id == current_map.id)
                    .collect();
                
                if !tokens_for_map.is_empty() {
                    let mut state_data = serde_json::Map::new();
                    
                    // Save tokens with their positions
                    let tokens_data: Vec<serde_json::Value> = tokens_for_map.iter().map(|token| {
                        let mut token_data = serde_json::Map::new();
                        token_data.insert("id".to_string(), serde_json::Value::String(token.id.clone()));
                        token_data.insert("entity_id".to_string(), serde_json::Value::String(token.entity_id.clone()));
                        token_data.insert("entity_type".to_string(), serde_json::Value::String(format!("{:?}", token.entity_type)));
                        token_data.insert("x".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(token.x as f64).unwrap()));
                        token_data.insert("y".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(token.y as f64).unwrap()));
                        token_data.insert("size".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(token.size as f64).unwrap()));
                        if let Some(img) = &token.image_url {
                            token_data.insert("image_url".to_string(), serde_json::Value::String(img.clone()));
                        }
                        token_data.insert(
                            "hidden_from_players".to_string(),
                            serde_json::Value::Bool(token.hidden_from_players),
                        );
                        
                        // Add HP values from characters or enemy instances
                        if token.entity_type == crate::models::TokenType::Player {
                            if let Some(char) = gs.characters.get(&token.entity_id) {
                                token_data.insert("current_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(char.current_hp)));
                                token_data.insert("max_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(char.max_hp)));
                            }
                        } else if token.entity_type == crate::models::TokenType::Enemy {
                            if let Some(enemy) = gs.get_enemy_instance(&token.entity_id) {
                                token_data.insert("current_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(enemy.current_hp)));
                                token_data.insert("max_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(enemy.max_hp)));
                            }
                        }
                        
                        serde_json::Value::Object(token_data)
                    }).collect();
                    state_data.insert("tokens".to_string(), serde_json::Value::Array(tokens_data));
                    
                    // Save combat state if active
                    if gs.combat.active {
                        let combat_data = serde_json::json!({
                            "active": true,
                            "round": gs.combat.round,
                            "current_turn_index": gs.combat.current_turn_index,
                            "participants": gs.combat.participants
                        });
                        state_data.insert("combat".to_string(), combat_data);
                    }
                    
                    Some(serde_json::to_string(&serde_json::Value::Object(state_data)).unwrap_or_default())
                } else {
                    None
                }
            } else {
                None
            };
            drop(gs);
            
            let map = Map {
                id: map_id.clone(),
                name: name.clone(),
                image_path: format!("/{}", image_path),
                grid_size: 50,
                width,
                height,
                map_state: map_state_json.clone(),
            };
            
            // Save to both style DBs so list/load stays consistent regardless of campaign DB.
            if let Err(e) = sqlx::query(
                "INSERT OR REPLACE INTO maps (id, name, image_path, grid_size, width, height, map_state) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&map_id)
            .bind(&name)
            .bind(&map.image_path)
            .bind(50)
            .bind(width)
            .bind(height)
            .bind(&map_state_json)
            .execute(dnd_db)
            .await
            {
                error!("Failed to save map to D&D database: {}", e);
                let err = ServerMessage::Error {
                    message: format!("CreateMap failed: could not save map metadata: {}", e),
                };
                send_to_client(clients, session_id, &err).await;
                let _ = fs::remove_file(&image_path);
                return;
            }
            if let Err(e) = sqlx::query(
                "INSERT OR REPLACE INTO maps (id, name, image_path, grid_size, width, height, map_state) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&map_id)
            .bind(&name)
            .bind(&map.image_path)
            .bind(50)
            .bind(width)
            .bind(height)
            .bind(&map_state_json)
            .execute(starwars_db)
            .await
            {
                warn!("Failed to mirror map to Star Wars database (map still saved in D&D DB): {}", e);
            }
            
            let mut gs = game_state.write().await;
            gs.load_map(map.clone(), true);
            gs.player_map_viewport = crate::models::PlayerMapViewport::default();
            drop(gs);
            let vp = game_state.read().await.player_map_viewport.clone();
            let map_loaded = ServerMessage::MapLoaded {
                map: map.for_client_wire(),
                player_map_viewport: vp.clone(),
            };
            broadcast_message(clients, &map_loaded).await;
            let vp_msg = ServerMessage::PlayerMapViewportUpdated {
                enabled: vp.enabled,
                x: vp.x,
                y: vp.y,
                width: vp.width,
                height: vp.height,
            };
            broadcast_message(clients, &vp_msg).await;
        }
        
        ClientMessage::SaveMap { map_id } => {
            use crate::models::Token;
            
            info!("💾 Saving map state for map: {}", map_id);
            
            // Collect all data while holding the lock
            let (tokens_count, map_state_json, actual_map_id) = {
                let gs = game_state.read().await;
                
                // Verify this is the current map and get the actual map ID
                let actual_map_id = if let Some(ref current_map) = gs.current_map {
                    if current_map.id != map_id {
                        let error = ServerMessage::Error { 
                            message: format!("Map {} is not currently loaded. Load it first before saving.", map_id) 
                        };
                        drop(gs);
                        broadcast_message(clients, &error).await;
                        return;
                    }
                    current_map.id.clone()
                } else {
                    let error = ServerMessage::Error { 
                        message: "No map is currently loaded.".to_string() 
                    };
                    drop(gs);
                    broadcast_message(clients, &error).await;
                    return;
                };
                
                info!("💾 Current map ID: {}, Requested map ID: {}", actual_map_id, map_id);
                info!("💾 Total tokens in game state: {}", gs.tokens.len());
                
                // IMPORTANT: Save ALL tokens currently in game state when a map is loaded
                // This is because tokens visible on the current map are all in the game state
                // The map_id field might be wrong/empty, but if they're in game state with a map loaded,
                // they belong to that map
                let tokens_for_map: Vec<&Token> = gs.tokens.iter().collect();
                
                let token_count = tokens_for_map.len();
                info!("💾 Saving all {} tokens from game state (they belong to current map)", token_count);
                
                // Log all tokens for debugging
                if token_count > 0 {
                    info!("💾 Tokens to save:");
                    for (i, token) in tokens_for_map.iter().enumerate() {
                        info!("💾   {}. Token {}: map_id='{}', entity_id='{}', type={:?}, pos=({}, {})", 
                            i + 1, token.id, token.map_id, token.entity_id, token.entity_type, token.x, token.y);
                    }
                } else {
                    warn!("⚠️ WARNING: No tokens found in game state! This might mean:");
                    warn!("   1. Tokens were never placed on the server");
                    warn!("   2. Tokens were cleared when map was loaded");
                    warn!("   3. There's a synchronization issue between client and server");
                }
                
                info!("💾 Found {} tokens to save for map {}", token_count, actual_map_id);
                
                let mut state_data = serde_json::Map::new();
                
                // Save tokens with their positions and HP
                let tokens_data: Vec<serde_json::Value> = tokens_for_map.iter().map(|token| {
                    let mut token_data = serde_json::Map::new();
                    token_data.insert("id".to_string(), serde_json::Value::String(token.id.clone()));
                    token_data.insert("entity_id".to_string(), serde_json::Value::String(token.entity_id.clone()));
                    token_data.insert("entity_type".to_string(), serde_json::Value::String(format!("{:?}", token.entity_type)));
                    token_data.insert("x".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(token.x as f64).unwrap()));
                    token_data.insert("y".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(token.y as f64).unwrap()));
                    token_data.insert("size".to_string(), serde_json::Value::Number(serde_json::Number::from_f64(token.size as f64).unwrap()));
                    if let Some(ref img) = token.image_url {
                        token_data.insert("image_url".to_string(), serde_json::Value::String(img.clone()));
                    }
                    token_data.insert(
                        "hidden_from_players".to_string(),
                        serde_json::Value::Bool(token.hidden_from_players),
                    );
                    
                    // Add HP values from characters or enemy instances
                    if token.entity_type == crate::models::TokenType::Player {
                        if let Some(char) = gs.characters.get(&token.entity_id) {
                            token_data.insert("current_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(char.current_hp)));
                            token_data.insert("max_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(char.max_hp)));
                            info!("💾 Saved token {} (Player) with HP: {}/{}", token.id, char.current_hp, char.max_hp);
                        }
                    } else if token.entity_type == crate::models::TokenType::Enemy {
                        if let Some(enemy) = gs.get_enemy_instance(&token.entity_id) {
                            token_data.insert("current_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(enemy.current_hp)));
                            token_data.insert("max_hp".to_string(), serde_json::Value::Number(serde_json::Number::from(enemy.max_hp)));
                            info!("💾 Saved token {} (Enemy) with HP: {}/{}", token.id, enemy.current_hp, enemy.max_hp);
                        }
                    }
                    
                    serde_json::Value::Object(token_data)
                }).collect();
                state_data.insert("tokens".to_string(), serde_json::Value::Array(tokens_data));
                
                // Save combat state if active
                if gs.combat.active {
                    let combat_data = serde_json::json!({
                        "active": true,
                        "round": gs.combat.round,
                        "current_turn_index": gs.combat.current_turn_index,
                        "participants": gs.combat.participants
                    });
                    state_data.insert("combat".to_string(), combat_data);
                    info!("💾 Saved combat state: Round {}, Turn {}", gs.combat.round, gs.combat.current_turn_index);
                }
                
                let map_state_json = serde_json::to_string(&serde_json::Value::Object(state_data)).unwrap_or_default();
                (token_count, map_state_json, actual_map_id)
            }; // Lock is dropped here
            
            info!("💾 Map state JSON length: {} bytes", map_state_json.len());
            info!("💾 Saving to map ID: {}", actual_map_id);
            
            // Update map in database with state (use actual_map_id, not the passed map_id)
            if let Err(e) = sqlx::query(
                "UPDATE maps SET map_state = ? WHERE id = ?"
            )
            .bind(&map_state_json)
            .bind(&actual_map_id)
            .execute(dnd_db)
            .await
            {
                error!("❌ Failed to save map state to database: {}", e);
                let error = ServerMessage::Error { 
                    message: format!("Failed to save map state: {}", e) 
                };
                broadcast_message(clients, &error).await;
            } else {
                info!("✅ Map state saved successfully for map: {} ({} tokens)", actual_map_id, tokens_count);
                // Mirror to Star Wars DB when present (maps are shared assets across style DBs).
                if let Err(e) = sqlx::query("UPDATE maps SET map_state = ? WHERE id = ?")
                    .bind(&map_state_json)
                    .bind(&actual_map_id)
                    .execute(starwars_db)
                    .await
                {
                    tracing::debug!("Star Wars DB map_state mirror skipped/failed (non-fatal): {}", e);
                }
                // Broadcast success message
                let success = ServerMessage::Error { 
                    message: format!("✅ Map state saved successfully! ({} tokens, {} bytes)", tokens_count, map_state_json.len()) 
                };
                broadcast_message(clients, &success).await;
            }
        }
        
        ClientMessage::ListMaps => {
            let maps = fetch_maps_for_list(dnd_db, starwars_db).await;
            let map_list = ServerMessage::MapList { maps };
            broadcast_message(clients, &map_list).await;
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
                    
                    // Remove from game state if it's the current map (release lock before DB work)
                    {
                        let mut gs = game_state.write().await;
                        if let Some(ref current) = gs.current_map {
                            if current.id == map_id {
                                gs.current_map = None;
                                info!("✅ Removed deleted map from current map");
                            }
                        }
                    }
                    
                    let maps = fetch_maps_for_list(dnd_db, starwars_db).await;
                    let map_list = ServerMessage::MapList { maps };
                    broadcast_message(clients, &map_list).await;
                }
            } else {
                warn!("Map {} not found in database", map_id);
            }
        }
        
        ClientMessage::LoadMap { map_id, clear_tokens } => {
            use crate::models::Token;
            
            // Load map from database
            let clear = clear_tokens.unwrap_or(true); // Default to true for backward compatibility
            info!("Loading map: {} (clear_tokens: {})", map_id, clear);
            // Maps may exist in either DB (D&D or Star Wars). Try D&D first, then fall back.
            let mut map_row = sqlx::query_as::<_, (String, String, String, i32, i32, i32, Option<String>)>(
                "SELECT id, name, image_path, grid_size, width, height, map_state FROM maps WHERE id = ?",
            )
            .bind(&map_id)
            .fetch_optional(dnd_db)
            .await
            .ok()
            .flatten();

            if map_row.is_none() {
                map_row = sqlx::query_as::<_, (String, String, String, i32, i32, i32, Option<String>)>(
                    "SELECT id, name, image_path, grid_size, width, height, map_state FROM maps WHERE id = ?",
                )
                .bind(&map_id)
                .fetch_optional(starwars_db)
                .await
                .ok()
                .flatten();
            }

            if let Some(map_row) = map_row {
                let map = Map {
                    id: map_row.0.clone(),
                    name: map_row.1.clone(),
                    image_path: map_row.2.clone(),
                    grid_size: map_row.3,
                    width: map_row.4,
                    height: map_row.5,
                    map_state: map_row.6.clone(),
                };
                info!("Map loaded from DB: {} - image_path: {}", map.name, map_row.2);
                
                let mut gs = game_state.write().await;
                gs.load_map(map.clone(), clear);
                
                // Restore state if map_state exists and we're not clearing tokens
                if let Some(ref state_json) = map_row.6 {
                    if !clear {
                        info!("🔄 Restoring map state for: {}", map.name);
                        
                        if let Ok(state_data) = serde_json::from_str::<serde_json::Value>(state_json) {
                            // Restore tokens
                            if let Some(tokens_array) = state_data.get("tokens").and_then(|v| v.as_array()) {
                                for token_data in tokens_array {
                                    if let (Some(id), Some(entity_id), Some(entity_type_str), Some(x), Some(y)) = (
                                        token_data.get("id").and_then(|v| v.as_str()),
                                        token_data.get("entity_id").and_then(|v| v.as_str()),
                                        token_data.get("entity_type").and_then(|v| v.as_str()),
                                        token_data.get("x").and_then(|v| v.as_f64()),
                                        token_data.get("y").and_then(|v| v.as_f64()),
                                    ) {
                                        // Parse entity type
                                        let entity_type = if entity_type_str == "Player" {
                                            crate::models::TokenType::Player
                                        } else if entity_type_str == "Enemy" {
                                            crate::models::TokenType::Enemy
                                        } else if entity_type_str == "NPC" {
                                            crate::models::TokenType::NPC
                                        } else {
                                            crate::models::TokenType::Object
                                        };
                                        
                                        let size = token_data.get("size").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
                                        let image_url = token_data
                                            .get("image_url")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string())
                                            .filter(|s| !s.trim().is_empty());
                                        let display_name = token_data
                                            .get("display_name")
                                            .and_then(|v| v.as_str())
                                            .map(|s| s.to_string())
                                            .filter(|s| !s.trim().is_empty());
                                        let raw_hidden = token_data
                                            .get("hidden_from_players")
                                            .and_then(|v| v.as_bool())
                                            .unwrap_or(false);
                                        let hidden_from_players = entity_type
                                            == crate::models::TokenType::Object
                                            && raw_hidden;

                                        let token = Token {
                                            id: id.to_string(),
                                            map_id: map_id.clone(),
                                            entity_id: entity_id.to_string(),
                                            entity_type: entity_type.clone(),
                                            x: x as f32,
                                            y: y as f32,
                                            size,
                                            image_url,
                                            display_name,
                                            hidden_from_players,
                                        };
                                        
                                        // Add token if it doesn't exist
                                        if !gs.tokens.iter().any(|t| t.id == token.id) {
                                            gs.tokens.push(token.clone());
                                            
                                            // Restore HP values
                                            if let (Some(current_hp), Some(max_hp)) = (
                                                token_data.get("current_hp").and_then(|v| v.as_i64()),
                                                token_data.get("max_hp").and_then(|v| v.as_i64()),
                                            ) {
                                                if entity_type == crate::models::TokenType::Player {
                                                    if let Some(char) = gs.characters.get_mut(entity_id) {
                                                        char.current_hp = current_hp as i32;
                                                        char.max_hp = max_hp as i32;
                                                    }
                                                } else if entity_type == crate::models::TokenType::Enemy {
                                                    if let Some(enemy) = gs.enemy_instances.get_mut(entity_id) {
                                                        enemy.current_hp = current_hp as i32;
                                                        enemy.max_hp = max_hp as i32;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                info!("✅ Restored {} tokens", tokens_array.len());
                            }
                            
                            // Restore combat state if it was saved
                            if let Some(combat_data) = state_data.get("combat") {
                                if let Some(active) = combat_data.get("active").and_then(|v| v.as_bool()) {
                                    if active {
                                        if let Some(participants) = combat_data.get("participants") {
                                            if let Ok(participants_vec) = serde_json::from_value::<Vec<CombatParticipant>>(participants.clone()) {
                                                let round = combat_data.get("round").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
                                                let current_turn_index = combat_data.get("current_turn_index").and_then(|v| v.as_i64()).unwrap_or(0) as usize;
                                                
                                                gs.combat.participants = participants_vec;
                                                gs.combat.active = true;
                                                gs.combat.round = round;
                                                gs.combat.current_turn_index = current_turn_index;
                                                
                                                info!("✅ Restored combat state: Round {}, Turn {}", round, current_turn_index);
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            warn!("⚠️ Failed to parse map state JSON");
                        }
                    }
                }
                
                // Clone while write lock held; do not call read() here — would deadlock with `gs`.
                let characters: Vec<Character> = gs.characters.values().cloned().collect();
                let player_map_viewport = gs.player_map_viewport.clone();
                drop(gs);
                
                let character_list = ServerMessage::CharacterList { characters, style: None };
                broadcast_message(clients, &character_list).await;
                
                // Clients need MapLoaded (canvas size + image) BEFORE TokenUpdate applies tokens.
                let map_loaded = ServerMessage::MapLoaded {
                    map: map.for_client_wire(),
                    player_map_viewport: player_map_viewport.clone(),
                };
                broadcast_message(clients, &map_loaded).await;
                let vp_msg = ServerMessage::PlayerMapViewportUpdated {
                    enabled: player_map_viewport.enabled,
                    x: player_map_viewport.x,
                    y: player_map_viewport.y,
                    width: player_map_viewport.width,
                    height: player_map_viewport.height,
                };
                broadcast_message(clients, &vp_msg).await;
                
                let tokens = game_state.read().await.tokens.clone();
                let tokens = enrich_tokens_with_display_names(tokens, game_state, dnd_db, starwars_db).await;
                let token_update = ServerMessage::TokenUpdate { tokens };
                broadcast_message(clients, &token_update).await;
                
                // Broadcast combat state if restored
                if let Some(ref state_json) = map_row.6 {
                    if !clear {
                        if let Ok(state_data) = serde_json::from_str::<serde_json::Value>(state_json) {
                            if let Some(combat_data) = state_data.get("combat") {
                                if let Some(active) = combat_data.get("active").and_then(|v| v.as_bool()) {
                                    if active {
                                        let gs = game_state.read().await;
                                        let participants = gs.combat.participants.clone();
                                        drop(gs);
                                        let combat_started = ServerMessage::CombatStarted { participants };
                                        broadcast_message(clients, &combat_started).await;
                                        
                                        // Broadcast current turn
                                        let gs = game_state.read().await;
                                        if let Some(current) = gs.combat.get_current_participant() {
                                            let turn_changed = ServerMessage::TurnChanged {
                                                current_turn: current.id.clone(),
                                                participant_name: current.name.clone(),
                                            };
                                            drop(gs);
                                            broadcast_message(clients, &turn_changed).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                warn!("Map not found in database: {}", map_id);
                let error = ServerMessage::Error {
                    message: format!("Map not found: {}", map_id),
                };
                broadcast_message(clients, &error).await;
            }
        }
        
        ClientMessage::ClearMap => {
            info!("🗑️ Clearing map and all tokens");
            let mut gs = game_state.write().await;
            
            // Clear map
            gs.current_map = None;
            
            // Clear all tokens
            gs.tokens.clear();
            gs.player_map_viewport = crate::models::PlayerMapViewport::default();
            
            // Clear token update (empty tokens array)
            let token_update = ServerMessage::TokenUpdate { tokens: Vec::new() };
            let vp = gs.player_map_viewport.clone();
            drop(gs); // Release write lock before broadcasting
            
            // Broadcast map cleared and empty token update to all clients
            let map_cleared = ServerMessage::MapCleared;
            broadcast_message(clients, &map_cleared).await;
            broadcast_message(clients, &token_update).await;
            let vp_msg = ServerMessage::PlayerMapViewportUpdated {
                enabled: vp.enabled,
                x: vp.x,
                y: vp.y,
                width: vp.width,
                height: vp.height,
            };
            broadcast_message(clients, &vp_msg).await;
            
            info!("✅ Map and tokens cleared, broadcast to all clients");
        }
        
        ClientMessage::MapSettingsChanged {
            grid_size,
            width,
            height,
        } => {
            let is_dm = game_state
                .read()
                .await
                .players
                .get(session_id)
                .map(|p| p.is_dm)
                .unwrap_or(false);
            if !is_dm {
                warn!(
                    "Non-DM session {} tried to change map settings; ignored.",
                    session_id
                );
                return;
            }
            let grid_size = grid_size.clamp(5, 500);
            let width = width.clamp(64, 32000);
            let height = height.clamp(64, 32000);

            let map_id_opt = {
                let mut gs = game_state.write().await;
                if let Some(ref mut m) = gs.current_map {
                    m.grid_size = grid_size;
                    m.width = width;
                    m.height = height;
                    Some(m.id.clone())
                } else {
                    None
                }
            };

            if let Some(ref map_id) = map_id_opt {
                if let Err(e) = sqlx::query(
                    "UPDATE maps SET grid_size = ?, width = ?, height = ? WHERE id = ?",
                )
                .bind(grid_size)
                .bind(width)
                .bind(height)
                .bind(map_id)
                .execute(dnd_db)
                .await
                {
                    warn!("Failed to persist map settings to D&D DB: {}", e);
                }
                if let Err(e) = sqlx::query(
                    "UPDATE maps SET grid_size = ?, width = ?, height = ? WHERE id = ?",
                )
                .bind(grid_size)
                .bind(width)
                .bind(height)
                .bind(map_id)
                .execute(starwars_db)
                .await
                {
                    tracing::debug!(
                        "Star Wars DB map settings mirror skipped/failed (non-fatal): {}",
                        e
                    );
                }
                info!(
                    "🗺️ Map settings persisted: id={} grid={} {}x{}",
                    map_id, grid_size, width, height
                );
            }

            let settings = ServerMessage::MapSettingsChanged {
                grid_size,
                width,
                height,
            };
            broadcast_message(clients, &settings).await;
        }
        
        ClientMessage::SetPlayerMapViewport {
            enabled,
            x,
            y,
            width,
            height,
        } => {
            let is_dm = game_state
                .read()
                .await
                .players
                .get(session_id)
                .map(|p| p.is_dm)
                .unwrap_or(false);
            if !is_dm {
                return;
            }
            let mut w = width.max(32.0);
            let mut h = height.max(32.0);
            let mut vx = x;
            let mut vy = y;
            {
                let gs = game_state.read().await;
                if let Some(ref m) = gs.current_map {
                    let mw = m.width as f32;
                    let mh = m.height as f32;
                    w = w.min(mw);
                    h = h.min(mh);
                    vx = vx.clamp(0.0, (mw - w).max(0.0));
                    vy = vy.clamp(0.0, (mh - h).max(0.0));
                }
            }
            let mut gs = game_state.write().await;
            gs.player_map_viewport.enabled = enabled;
            gs.player_map_viewport.x = vx;
            gs.player_map_viewport.y = vy;
            gs.player_map_viewport.width = w;
            gs.player_map_viewport.height = h;
            let vp = gs.player_map_viewport.clone();
            drop(gs);
            let msg = ServerMessage::PlayerMapViewportUpdated {
                enabled: vp.enabled,
                x: vp.x,
                y: vp.y,
                width: vp.width,
                height: vp.height,
            };
            broadcast_message(clients, &msg).await;
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
            // Never add "instance" names to the database (e.g. "Goblin 1", "Goblin 2") — those are map tokens only
            let name_trim = enemy.name.trim();
            let looks_like_instance = name_trim.rsplit_once(' ')
                .map(|(_, suffix)| suffix.parse::<u32>().is_ok())
                .unwrap_or(false);
            if looks_like_instance {
                info!("Ignoring CreateEnemy for instance-style name (not adding to DB): {:?}", name_trim);
                return;
            }
            let style_norm = match enemy.style.trim() {
                "starwars" => "starwars",
                _ => "dnd",
            };
            let db = if style_norm == "starwars" {
                starwars_db
            } else {
                dnd_db
            };
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
            .bind(style_norm)
            .execute(db)
            .await
            {
                error!("Failed to create enemy: {}", e);
            } else {
                let enemies = fetch_enemies_merged(dnd_db, starwars_db).await;
                let enemy_list = ServerMessage::EnemyList { enemies };
                broadcast_message(clients, &enemy_list).await;
            }
        }
        
        ClientMessage::SpawnEnemy { enemy_id, instance_id, name } => {
            use crate::models::EnemyInstance;
            let sql = "SELECT id, name, creature_type, challenge_rating, max_hp, armor_class, initiative_bonus, strength, dexterity, constitution, intelligence, wisdom, charisma, speed, actions, description, portrait_url FROM enemies WHERE id = ?";
            let mut row_opt = sqlx::query(sql)
                .bind(&enemy_id)
                .fetch_optional(dnd_db)
                .await
                .ok()
                .flatten();
            if row_opt.is_none() {
                row_opt = sqlx::query(sql)
                    .bind(&enemy_id)
                    .fetch_optional(starwars_db)
                    .await
                    .ok()
                    .flatten();
            }
            if let Some(row) = row_opt {
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
                let portrait_url = row
                    .try_get::<Option<String>, _>("portrait_url")
                    .ok()
                    .flatten()
                    .filter(|s| !s.trim().is_empty());
                let actions = row.try_get::<String, _>("actions").ok();
                game_state.write().await.add_enemy_instance(instance.clone());
                let spawned = ServerMessage::EnemyInstanceSpawned {
                    instance_id: instance.id.clone(),
                    enemy_id: instance.enemy_id.clone(),
                    name: instance.name.clone(),
                    portrait_url,
                    actions,
                };
                broadcast_message(clients, &spawned).await;
            }
        }
        
        ClientMessage::ListEnemies => {
            let enemies = fetch_enemies_merged(dnd_db, starwars_db).await;
            let enemy_list = ServerMessage::EnemyList { enemies };
            broadcast_message(clients, &enemy_list).await;
        }
        
        ClientMessage::DeleteEnemy { enemy_id } => {
            for pool in [dnd_db, starwars_db] {
                if let Err(e) = sqlx::query("DELETE FROM enemies WHERE id = ?")
                    .bind(&enemy_id)
                    .execute(pool)
                    .await
                {
                    error!("Failed to delete enemy from a database: {}", e);
                }
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

async fn send_to_client(clients: &Clients, session_id: &str, message: &ServerMessage) {
    let json = match serde_json::to_string(message) {
        Ok(json) => json,
        Err(e) => {
            error!("Failed to serialize message: {}", e);
            return;
        }
    };

    let clients_read = clients.read().await;
    if let Some(sender) = clients_read.get(session_id) {
        if sender.send(json).is_err() {
            warn!("Failed to send message to client {}", session_id);
        }
    } else {
        warn!("Client {} not found in clients list", session_id);
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

// Save game state endpoints
async fn list_saved_states() -> Result<axum::Json<serde_json::Value>, StatusCode> {
    use std::path::Path;
    
    let saves_dir = Path::new("saves");
    if !saves_dir.exists() {
        if let Err(e) = tokio::fs::create_dir_all(saves_dir).await {
            error!("❌ Failed to create saves directory: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    
    let mut saves = Vec::new();
    let mut entries = match tokio::fs::read_dir(saves_dir).await {
        Ok(entries) => entries,
        Err(e) => {
            error!("❌ Failed to read saves directory: {}", e);
            return Ok(axum::Json(serde_json::json!({ "saves": [] })));
        }
    };
    
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(metadata) = entry.metadata().await {
                if let Ok(modified) = metadata.modified() {
                    let file_name = path.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    
                    // Try to read metadata from file
                    if let Ok(content) = tokio::fs::read_to_string(&path).await {
                        if let Ok(game_state) = serde_json::from_str::<serde_json::Value>(&content) {
                            saves.push(serde_json::json!({
                            "filename": format!("{}.json", file_name),
                            "name": file_name,
                            "savedAt": game_state.get("savedAt")
                                .and_then(|v| v.as_str())
                                .unwrap_or(""),
                            "mapName": game_state.get("currentMap")
                                .and_then(|m| m.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("None"),
                            "tokenCount": game_state.get("tokens")
                                .and_then(|v| v.as_array())
                                .map(|a| a.len())
                                .unwrap_or(0),
                            "combatActive": game_state.get("combatState")
                                .and_then(|c| c.get("active"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false),
                                "modified": modified.duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_secs()
                            }));
                        }
                    }
                }
            }
        }
    }
    
    // Sort by modified time (newest first)
    saves.sort_by(|a, b| {
        let a_time = a.get("modified").and_then(|v| v.as_u64()).unwrap_or(0);
        let b_time = b.get("modified").and_then(|v| v.as_u64()).unwrap_or(0);
        b_time.cmp(&a_time)
    });
    
    Ok(axum::Json(serde_json::json!({ "saves": saves })))
}

async fn get_saved_state(Path(filename): Path<String>) -> Result<axum::response::Json<serde_json::Value>, StatusCode> {
    use std::path::Path;
    
    let file_path = Path::new("saves").join(&filename);
    if !file_path.exists() {
        warn!("❌ Save file not found: {}", filename);
        return Err(StatusCode::NOT_FOUND);
    }
    
    match tokio::fs::read_to_string(&file_path).await {
        Ok(content) => {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(game_state) => {
                    info!("📂 Loaded game state: {}", filename);
                    Ok(axum::response::Json(game_state))
                },
                Err(e) => {
                    error!("❌ Failed to parse save file {}: {}", filename, e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
        Err(e) => {
            error!("❌ Failed to read save file {}: {}", filename, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn save_game_state_handler(
    Path(filename): Path<String>,
    body: axum::body::Body,
) -> Result<axum::response::Json<serde_json::Value>, StatusCode> {
    save_game_state_internal(filename, body).await
}

async fn save_game_state_internal(
    filename: String,
    body: axum::body::Body,
) -> Result<axum::response::Json<serde_json::Value>, StatusCode> {
    info!("📥 Save request received for: {}", filename);
    
    // Read body manually to avoid Json extractor issues
    let body_bytes = match axum::body::to_bytes(body, 50_000_000).await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("❌ Failed to read request body: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    
    info!("📋 Received body: {} bytes", body_bytes.len());
    
    // Parse JSON
    let game_state: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(json) => json,
        Err(e) => {
            error!("❌ Failed to parse JSON: {}", e);
            return Err(StatusCode::BAD_REQUEST);
        }
    };
    
    info!("✅ Parsed JSON successfully");
    
    // Get absolute path to saves directory (relative to server executable)
    let current_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let saves_dir = current_dir.join("saves");
    
    info!("📁 Current directory: {}", current_dir.display());
    info!("📁 Saves directory: {}", saves_dir.display());
    
    // Ensure saves directory exists
    if !saves_dir.exists() {
        info!("📁 Creating saves directory at: {}", saves_dir.display());
        if let Err(e) = tokio::fs::create_dir_all(&saves_dir).await {
            error!("❌ Failed to create saves directory at {}: {}", saves_dir.display(), e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
        info!("✅ Created saves directory at: {}", saves_dir.display());
    }
    
    let file_path = saves_dir.join(&filename);
    info!("💾 Full file path: {}", file_path.display());
    
    // Serialize to JSON (already have it, but re-serialize to ensure format)
    let json_string = match serde_json::to_string_pretty(&game_state) {
        Ok(s) => s,
        Err(e) => {
            error!("❌ Failed to serialize game state: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    
    let json_len = json_string.len();
    info!("💾 Writing {} bytes to {}", json_len, file_path.display());
    
    // Write file
    if let Err(e) = tokio::fs::write(&file_path, json_string).await {
        error!("❌ Failed to write save file {}: {}", file_path.display(), e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    
    // Verify file was written
    if !file_path.exists() {
        error!("❌ File was not created after write!");
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    
    info!("✅ Successfully saved game state to: {} ({} bytes)", file_path.display(), json_len);
    
    Ok(axum::response::Json(serde_json::json!({
        "status": "success",
        "filename": filename,
        "size": json_len,
        "path": file_path.display().to_string(),
        "message": "Game state saved successfully"
    })))
}

/// Campaign notes files live in `campaign_notes/<id>.json`. `id` must be a single path segment (no slashes, no `..`).
fn sanitize_campaign_notes_file_id(id: &str) -> Option<String> {
    if id.is_empty() || id.len() > 220 {
        return None;
    }
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return None;
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(id.to_string())
}

async fn get_campaign_notes(Path(id): Path<String>) -> Result<axum::response::Json<serde_json::Value>, StatusCode> {
    let id = sanitize_campaign_notes_file_id(&id).ok_or(StatusCode::BAD_REQUEST)?;
    let dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("campaign_notes");
    let path = dir.join(format!("{id}.json"));
    if !path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| {
            error!("campaign_notes read {}: {}", path.display(), e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        error!("campaign_notes parse {}: {}", path.display(), e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    Ok(axum::response::Json(v))
}

async fn put_campaign_notes(Path(id): Path<String>, body: axum::body::Body) -> Result<StatusCode, StatusCode> {
    let id = sanitize_campaign_notes_file_id(&id).ok_or(StatusCode::BAD_REQUEST)?;
    let body_bytes = axum::body::to_bytes(body, 8_000_000).await.map_err(|e| {
        warn!("campaign_notes body read: {}", e);
        StatusCode::BAD_REQUEST
    })?;
    let v: serde_json::Value = serde_json::from_slice(&body_bytes).map_err(|e| {
        warn!("campaign_notes JSON: {}", e);
        StatusCode::BAD_REQUEST
    })?;
    if !v.is_object() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("campaign_notes");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        error!("campaign_notes mkdir: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let path = dir.join(format!("{id}.json"));
    let json_string = serde_json::to_string_pretty(&v).map_err(|e| {
        error!("campaign_notes serialize: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    tokio::fs::write(&path, json_string).await.map_err(|e| {
        error!("campaign_notes write {}: {}", path.display(), e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    info!("💾 Campaign notes saved: {}", path.display());
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_saved_state(Path(filename): Path<String>) -> Result<StatusCode, StatusCode> {
    use std::path::Path;
    
    let file_path = Path::new("saves").join(&filename);
    if !file_path.exists() {
        warn!("❌ Save file not found for deletion: {}", filename);
        return Err(StatusCode::NOT_FOUND);
    }
    
    if let Err(e) = tokio::fs::remove_file(&file_path).await {
        error!("❌ Failed to delete save file {}: {}", filename, e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    
    info!("🗑️ Deleted game state: {}", filename);
    Ok(StatusCode::OK)
}

// Sound board endpoints
async fn list_sounds() -> Result<axum::Json<serde_json::Value>, StatusCode> {
    use std::path::Path;
    
    let sounds_dir = Path::new("sounds");
    if !sounds_dir.exists() {
        if let Err(e) = tokio::fs::create_dir_all(sounds_dir).await {
            error!("❌ Failed to create sounds directory: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    
    let mut sounds = Vec::new();
    let mut entries = match tokio::fs::read_dir(sounds_dir).await {
        Ok(entries) => entries,
        Err(e) => {
            error!("❌ Failed to read sounds directory: {}", e);
            return Ok(axum::Json(serde_json::json!({ "sounds": [] })));
        }
    };
    
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if ext_str == "mp3" || ext_str == "wav" || ext_str == "ogg" || ext_str == "m4a" {
                if let Ok(metadata) = entry.metadata().await {
                    if let Ok(modified) = metadata.modified() {
                        let file_name = path.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        
                        let filename = path.file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        
                        sounds.push(serde_json::json!({
                            "filename": filename,
                            "name": file_name,
                            "type": ext_str,
                            "size": metadata.len(),
                            "modified": modified.duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs()
                        }));
                    }
                }
            }
        }
    }
    
    // Sort by modified time (newest first)
    sounds.sort_by(|a, b| {
        let a_time = a.get("modified").and_then(|v| v.as_u64()).unwrap_or(0);
        let b_time = b.get("modified").and_then(|v| v.as_u64()).unwrap_or(0);
        b_time.cmp(&a_time)
    });
    
    Ok(axum::Json(serde_json::json!({ "sounds": sounds })))
}

async fn upload_sound(
    mut multipart: Multipart,
) -> Result<axum::response::Json<serde_json::Value>, StatusCode> {
    use std::path::Path;
    
    let sounds_dir = Path::new("sounds");
    if !sounds_dir.exists() {
        if let Err(e) = tokio::fs::create_dir_all(sounds_dir).await {
            error!("❌ Failed to create sounds directory: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    
    let mut filename = String::new();
    let mut file_data = Vec::new();
    
    while let Some(mut field) = multipart.next_field().await.map_err(|e| {
        error!("❌ Failed to read multipart field: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        let field_name = field.name().unwrap_or("");
        if field_name == "file" {
            if let Some(name) = field.file_name() {
                filename = name.to_string();
            }
            
            let mut field_data = Vec::new();
            while let Some(chunk) = field.chunk().await.map_err(|e| {
                error!("❌ Failed to read file chunk: {}", e);
                StatusCode::BAD_REQUEST
            })? {
                field_data.extend_from_slice(&chunk);
            }
            file_data = field_data;
        }
    }
    
    if filename.is_empty() || file_data.is_empty() {
        error!("❌ No file data received (filename: '{}', data_len: {})", filename, file_data.len());
        return Err(StatusCode::BAD_REQUEST);
    }
    
    // Sanitize filename
    let safe_filename = filename.replace("/", "_").replace("\\", "_").replace("..", "_");
    let file_path = sounds_dir.join(&safe_filename);
    
    info!("📤 Uploading sound: {} ({} bytes)", safe_filename, file_data.len());
    
    if let Err(e) = tokio::fs::write(&file_path, file_data).await {
        error!("❌ Failed to write sound file {}: {}", file_path.display(), e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    
    info!("✅ Sound uploaded: {}", file_path.display());
    
    Ok(axum::response::Json(serde_json::json!({
        "status": "success",
        "filename": safe_filename,
        "size": file_path.metadata().map(|m| m.len()).unwrap_or(0),
        "message": "Sound uploaded successfully"
    })))
}

#[derive(Deserialize)]
struct MeshyGenBody {
    kind: String,
    id: String,
}

async fn query_character_by_id(
    dnd: &Database,
    sw: &Database,
    id: &str,
) -> Option<(String, Option<String>, Option<String>)> {
    let q = "SELECT name, portrait_url, character_data FROM characters WHERE id = ?";
    for pool in [dnd, sw] {
        if let Ok(Some(row)) = sqlx::query(q).bind(id).fetch_optional(pool).await {
            let name: String = row.get(0);
            let portrait: Option<String> = row.get(1);
            let cd: Option<String> = row.get(2);
            return Some((name, portrait, cd));
        }
    }
    None
}

async fn query_enemy_by_id(
    dnd: &Database,
    sw: &Database,
    id: &str,
) -> Option<(String, Option<String>, String)> {
    let q = "SELECT name, portrait_url, actions FROM enemies WHERE id = ?";
    for pool in [dnd, sw] {
        if let Ok(Some(row)) = sqlx::query(q).bind(id).fetch_optional(pool).await {
            let name: String = row.get(0);
            let portrait: Option<String> = row.get(1);
            let actions: String = row.get(2);
            return Some((name, portrait, actions));
        }
    }
    None
}

async fn query_enemy_has_arena_stl_by_name(
    dnd: &Database,
    sw: &Database,
    name: &str,
) -> bool {
    let q = "SELECT actions FROM enemies WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1";
    for pool in [dnd, sw] {
        if let Ok(Some(row)) = sqlx::query(q).bind(name).fetch_optional(pool).await {
            let actions: String = row.get(0);
            if crate::meshy::arena_stl_from_enemy_actions_json(&actions).is_some() {
                return true;
            }
        }
    }
    false
}

async fn meshy_npc_catalog_entry(
    idx: usize,
) -> Result<(String, String), (StatusCode, axum::Json<serde_json::Value>)> {
    use std::path::Path;
    let path = Path::new("static").join("data").join("npc.json");
    let raw = tokio::fs::read_to_string(&path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("Could not read npc.json: {}", e) })),
        )
    })?;
    let arr: Vec<serde_json::Value> = serde_json::from_str(&raw).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("npc.json parse: {}", e) })),
        )
    })?;
    let npc = arr.get(idx).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({ "error": "NPC catalog index out of range" })),
        )
    })?;
    let name = npc
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": "NPC entry has no name" })),
        ));
    }
    let rel = format!("static/enemy_portraits/{}.png", idx);
    let portrait_path = Path::new(".").join(&rel);
    if tokio::fs::metadata(&portrait_path).await.is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": format!(
                    "Portrait file missing for NPC #{} ({}). Add static/enemy_portraits/{}.png (same index as npc.json).",
                    idx,
                    name,
                    idx,
                ),
            })),
        ));
    }
    let portrait_web = format!("/static/enemy_portraits/{}.png", idx);
    Ok((name, portrait_web))
}

/// Safe fragment for `static/arena_stl/<name>_<uuid>.glb` (Windows + web paths).
fn sanitize_token_name_for_arena_file(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    let trimmed = s.trim().trim_matches('.');
    let mut out: String = trimmed.chars().take(120).collect();
    out = out.trim().to_string();
    if out.is_empty() {
        "token".to_string()
    } else {
        out
    }
}

fn unique_arena_glb_filename_for_token(entry_name: &str) -> String {
    let base = sanitize_token_name_for_arena_file(entry_name);
    format!("{}_{}.glb", base, Uuid::new_v4())
}

/// Portrait → Meshy → GLB saved under `static/arena_stl`. Requires env `MESHY_API_KEY` (see [Meshy docs](https://docs.meshy.ai/api/image-to-3d)).
/// Streams newline-delimited JSON: `{"progress":N}` lines, then `{"url":"...","name":"...","filename":"..."}` or `{"error":"..."}`.
async fn meshy_generate_arena_stl(
    State((dnd_db, starwars_db, _gs, _c, _sh)): State<(
        Database,
        Database,
        Arc<RwLock<GameState>>,
        Clients,
        broadcast::Sender<()>,
    )>,
    Json(body): Json<MeshyGenBody>,
) -> Result<Response, (StatusCode, axum::Json<serde_json::Value>)> {
    let key = std::env::var("MESHY_API_KEY").unwrap_or_default();
    if key.is_empty() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "error": "Server is not configured: set the MESHY_API_KEY environment variable (never commit API keys to the repo)."
            })),
        ));
    }

    let kind = body.kind.to_lowercase();
    let id = body.id.trim().to_string();
    if id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": "missing id" })),
        ));
    }

    let (entry_name, portrait_opt, has_stl) = match kind.as_str() {
        "character" | "player" => {
            let Some((name, portrait, cd)) =
                query_character_by_id(&dnd_db, &starwars_db, &id).await
            else {
                return Err((
                    StatusCode::NOT_FOUND,
                    axum::Json(serde_json::json!({ "error": "Character not found" })),
                ));
            };
            let has = cd
                .as_deref()
                .and_then(crate::meshy::arena_stl_from_character_data_json)
                .is_some();
            (name, portrait, has)
        }
        "enemy" => {
            let Some((name, portrait, actions)) =
                query_enemy_by_id(&dnd_db, &starwars_db, &id).await
            else {
                return Err((
                    StatusCode::NOT_FOUND,
                    axum::Json(serde_json::json!({ "error": "Creature not found" })),
                ));
            };
            let has = crate::meshy::arena_stl_from_enemy_actions_json(&actions).is_some();
            (name, portrait, has)
        }
        "npc_catalog" => {
            let idx = id.parse::<usize>().map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({
                        "error": "npc_catalog id must be the numeric index into static/data/npc.json (e.g. \"0\", \"42\").",
                    })),
                )
            })?;
            let (name, portrait) = meshy_npc_catalog_entry(idx).await?;
            let has = query_enemy_has_arena_stl_by_name(&dnd_db, &starwars_db, &name).await;
            (name, Some(portrait), has)
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({
                    "error": "kind must be \"character\", \"enemy\", or \"npc_catalog\"",
                })),
            ));
        }
    };

    if has_stl {
        return Err((
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({
                "error": "This entry already has a 3D arena model attached. Remove it in the sheet first if you want to replace it."
            })),
        ));
    }

    let portrait = match portrait_opt {
        Some(p) if !p.trim().is_empty() => p,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({
                    "error": "No portrait image — add a portrait to this character or creature first."
                })),
            ));
        }
    };

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;

    let image_for_meshy = crate::meshy::portrait_to_meshy_image_url(&http, &portrait)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": e })),
            )
        })?;

    use std::path::Path;

    let entry_for_file = entry_name.clone();
    let key_meshy = key.clone();
    let image_meshy = image_for_meshy;
    let kind_log = kind.clone();
    let id_log = id.clone();

    let (tx_body, rx_body) = mpsc::channel::<Bytes>(32);

    tokio::spawn(async move {
        let (prog_tx, mut prog_rx) = mpsc::unbounded_channel::<u8>();
        let meshy_handle = tokio::spawn(async move {
            crate::meshy::image_to_3d_download_glb(&key_meshy, image_meshy, Some(prog_tx)).await
        });

        while let Some(p) = prog_rx.recv().await {
            let line = format!("{{\"progress\":{}}}\n", p);
            if tx_body.send(Bytes::from(line)).await.is_err() {
                return;
            }
        }

        let glb = match meshy_handle.await {
            Ok(Ok(b)) => b,
            Ok(Err(e)) => {
                let line = serde_json::json!({ "error": e }).to_string() + "\n";
                let _ = tx_body.send(Bytes::from(line)).await;
                return;
            }
            Err(e) => {
                let line = serde_json::json!({ "error": format!("Meshy task ended: {}", e) }).to_string() + "\n";
                let _ = tx_body.send(Bytes::from(line)).await;
                return;
            }
        };

        let dir = Path::new("static").join("arena_stl");
        if let Err(e) = tokio::fs::create_dir_all(&dir).await {
            error!("meshy arena_stl mkdir: {}", e);
            let line = serde_json::json!({ "error": format!("Could not create arena_stl: {}", e) }).to_string() + "\n";
            let _ = tx_body.send(Bytes::from(line)).await;
            return;
        }

        let unique = unique_arena_glb_filename_for_token(&entry_for_file);
        let file_path = dir.join(&unique);
        if let Err(e) = tokio::fs::write(&file_path, &glb).await {
            let line = serde_json::json!({ "error": e.to_string() }).to_string() + "\n";
            let _ = tx_body.send(Bytes::from(line)).await;
            return;
        }

        let url = format!("/static/arena_stl/{}", unique);
        info!(
            "Meshy image→3D OK: kind={} id={} name={} → {}",
            kind_log, id_log, entry_for_file, url
        );
        let payload = serde_json::json!({
            "url": url,
            "name": entry_for_file,
            "filename": unique,
        });
        let _ = tx_body.send(Bytes::from(payload.to_string() + "\n")).await;
    });

    let stream = ReceiverStream::new(rx_body).map(|chunk| Ok::<_, std::convert::Infallible>(chunk));

    Response::builder()
        .header(
            header::CONTENT_TYPE,
            "application/x-ndjson; charset=utf-8",
        )
        .body(Body::from_stream(stream))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": e.to_string() })),
            )
        })
}

/// STL / GLB uploads for 3D arena token minis — served via `/static/arena_stl/...`.
async fn upload_arena_stl(
    mut multipart: Multipart,
) -> Result<axum::response::Json<serde_json::Value>, StatusCode> {
    use std::path::Path;

    let dir = Path::new("static").join("arena_stl");
    if !dir.exists() {
        if let Err(e) = tokio::fs::create_dir_all(&dir).await {
            error!("❌ Failed to create arena_stl directory: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    let mut filename = String::new();
    let mut file_data = Vec::new();

    while let Some(mut field) = multipart.next_field().await.map_err(|e| {
        error!("❌ arena-stl multipart read: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        if field.name().unwrap_or("") == "file" {
            if let Some(name) = field.file_name() {
                filename = name.to_string();
            }
            let mut field_data = Vec::new();
            while let Some(chunk) = field.chunk().await.map_err(|e| {
                error!("❌ arena-stl chunk: {}", e);
                StatusCode::BAD_REQUEST
            })? {
                field_data.extend_from_slice(&chunk);
            }
            file_data = field_data;
        }
    }

    if filename.is_empty() || file_data.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let lower = filename.to_lowercase();
    if !lower.ends_with(".stl") && !lower.ends_with(".glb") {
        error!("❌ arena model rejected (need .stl or .glb): {}", filename);
        return Err(StatusCode::BAD_REQUEST);
    }

    let safe_base = filename
        .replace('/', "_")
        .replace('\\', "_")
        .replace("..", "_");
    let unique = format!("{}_{}", Uuid::new_v4(), safe_base);
    let file_path = dir.join(&unique);

    info!("📤 Uploading arena 3D model: {} ({} bytes)", unique, file_data.len());

    if let Err(e) = tokio::fs::write(&file_path, file_data).await {
        error!("❌ Failed to write arena model {}: {}", file_path.display(), e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let url = format!("/static/arena_stl/{}", unique);
    info!("✅ Arena model saved: {}", url);

    Ok(axum::response::Json(serde_json::json!({
        "status": "success",
        "url": url,
        "filename": unique,
        "size": file_path.metadata().map(|m| m.len()).unwrap_or(0)
    })))
}

async fn delete_sound(Path(filename): Path<String>) -> Result<StatusCode, StatusCode> {
    use std::path::Path;
    
    let file_path = Path::new("sounds").join(&filename);
    if !file_path.exists() {
        warn!("❌ Sound file not found for deletion: {}", filename);
        return Err(StatusCode::NOT_FOUND);
    }
    
    if let Err(e) = tokio::fs::remove_file(&file_path).await {
        error!("❌ Failed to delete sound file {}: {}", filename, e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    
    info!("🗑️ Deleted sound: {}", filename);
    Ok(StatusCode::OK)
}

async fn get_sound_file(Path(filename): Path<String>) -> Result<impl axum::response::IntoResponse, StatusCode> {
    use std::path::Path;
    
    let file_path = Path::new("sounds").join(&filename);
    if !file_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }
    
    match tokio::fs::read(&file_path).await {
        Ok(data) => {
            let content_type = if filename.ends_with(".mp3") {
                "audio/mpeg"
            } else if filename.ends_with(".wav") {
                "audio/wav"
            } else if filename.ends_with(".ogg") {
                "audio/ogg"
            } else if filename.ends_with(".m4a") {
                "audio/mp4"
            } else {
                "audio/mpeg"
            };
            
            match axum::response::Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", content_type)
                .body(axum::body::Body::from(data))
            {
                Ok(resp) => Ok(resp),
                Err(e) => {
                    error!("Failed to build sound response: {}", e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
        Err(e) => {
            error!("❌ Failed to read sound file {}: {}", filename, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
