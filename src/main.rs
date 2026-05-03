mod db;
mod meshy;
mod models;
mod server;
mod combat;
mod game_state;

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<()> {
    // Load `.env` from cwd if present — variables become visible to `std::env::var` (e.g. MESHY_API_KEY)
    // dotenvy::dotenv / from_path only set a key if it is *missing* (`env::var` errors). An empty
    // `MESHY_API_KEY=` in the OS/IDE environment counts as present, so `.env` would be ignored —
    // we fix that with `from_path_override` below when the key is still empty.
    dotenvy::dotenv().ok();

    let manifest_env = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");
    if std::env::var("MESHY_API_KEY")
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        let _ = dotenvy::from_path(&manifest_env);
    }
    if std::env::var("MESHY_API_KEY")
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        let _ = dotenvy::from_path_override(&manifest_env);
    }

    let meshy_line_value_len: Option<usize> = std::fs::read_to_string(&manifest_env)
        .ok()
        .and_then(|s| {
            s.lines().find_map(|line| {
                let t = line.trim_start();
                t.strip_prefix("MESHY_API_KEY=")
                    .map(|v| v.trim_end_matches('\r').len())
            })
        });
    let key_len_final = std::env::var("MESHY_API_KEY")
        .map(|s| s.len())
        .unwrap_or(0);

    // Initialize logging
    tracing_subscriber::fmt::init();

    if key_len_final == 0 && meshy_line_value_len == Some(0) {
        tracing::warn!(
            "MESHY_API_KEY in {} has an empty value (nothing after `=` on that line). Save `.env` after editing, or keep the key on the same line.",
            manifest_env.display()
        );
    }

    tracing::info!("Starting Gorgox Interactive D&D Server...");
    if std::env::var("MESHY_API_KEY")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
    {
        tracing::info!("Meshy: MESHY_API_KEY loaded — portrait → 3D arena GLB is enabled");
    }

    // Initialize databases for both styles
    let dnd_db = db::init_db_with_style("dnd").await?;
    let starwars_db = db::init_db_with_style("starwars").await?;
    tracing::info!("Databases initialized");

    if let Err(e) = db::hydrate_sw5e_compendium_from_disk(&starwars_db).await {
        tracing::warn!("⚠️ SW5e compendium import from static JSON failed (non-fatal): {}", e);
    }

    // Initialize game state
    let initial_game_state = game_state::GameState::new();

    let game_state = Arc::new(RwLock::new(initial_game_state));

    // Start the server
    server::start_server(dnd_db, starwars_db, game_state).await?;

    Ok(())
}
