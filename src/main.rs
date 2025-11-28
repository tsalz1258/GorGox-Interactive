mod db;
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
    // Initialize logging
    tracing_subscriber::fmt::init();

    tracing::info!("Starting Gorgox Interactive D&D Server...");

    // Initialize databases for both styles
    let dnd_db = db::init_db_with_style("dnd").await?;
    let starwars_db = db::init_db_with_style("starwars").await?;
    tracing::info!("Databases initialized");

    // Initialize game state
    let initial_game_state = game_state::GameState::new();
    
    let game_state = Arc::new(RwLock::new(initial_game_state));
    
    // Start the server
    server::start_server(dnd_db, starwars_db, game_state).await?;

    Ok(())
}


