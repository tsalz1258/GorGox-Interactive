use sqlx::SqlitePool;
use anyhow::Result;

pub type Database = SqlitePool;

/// Check if a column exists in a table
async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> bool {
    // Try multiple methods to check if column exists
    // Method 1: Use pragma_table_info
    if let Ok(rows) = sqlx::query("SELECT name FROM pragma_table_info(?) WHERE name = ?")
        .bind(table)
        .bind(column)
        .fetch_all(pool)
        .await
    {
        return !rows.is_empty();
    }
    
    // Method 2: Try to query the column directly (will fail if it doesn't exist)
    if let Ok(_) = sqlx::query(&format!("SELECT {} FROM {} LIMIT 1", column, table))
        .execute(pool)
        .await
    {
        return true;
    }
    
    false
}

/// Add style column to characters table if it doesn't exist
async fn migrate_characters_table(pool: &SqlitePool) -> Result<()> {
    // Always try to add the column - SQLite will error if it exists, which we'll ignore
    tracing::info!("🔄 Migrating: Ensuring 'style' column exists in characters table...");
    match sqlx::query("ALTER TABLE characters ADD COLUMN style TEXT NOT NULL DEFAULT 'dnd'")
        .execute(pool)
        .await
    {
        Ok(_) => {
            tracing::info!("✅ Successfully added 'style' column to characters table");
        }
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("duplicate column") || err_str.contains("already exists") {
                tracing::info!("✅ 'style' column already exists in characters table");
            } else {
                // Try to verify it exists anyway
                if column_exists(pool, "characters", "style").await {
                    tracing::info!("✅ 'style' column exists in characters table (verified)");
                } else {
                    return Err(anyhow::anyhow!("Failed to add style column: {}", e));
                }
            }
        }
    }
    Ok(())
}

/// Add style column to enemies table if it doesn't exist
async fn migrate_enemies_table(pool: &SqlitePool) -> Result<()> {
    // Always try to add the column - SQLite will error if it exists, which we'll ignore
    tracing::info!("🔄 Migrating: Ensuring 'style' column exists in enemies table...");
    match sqlx::query("ALTER TABLE enemies ADD COLUMN style TEXT NOT NULL DEFAULT 'dnd'")
        .execute(pool)
        .await
    {
        Ok(_) => {
            tracing::info!("✅ Successfully added 'style' column to enemies table");
        }
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("duplicate column") || err_str.contains("already exists") {
                tracing::info!("✅ 'style' column already exists in enemies table");
            } else {
                // Try to verify it exists anyway
                if column_exists(pool, "enemies", "style").await {
                    tracing::info!("✅ 'style' column exists in enemies table (verified)");
                } else {
                    return Err(anyhow::anyhow!("Failed to add style column: {}", e));
                }
            }
        }
    }
    Ok(())
}

pub async fn init_db_with_style(style: &str) -> Result<Database> {
    let db_name = match style {
        "dnd" => "gorgox_dnd.db",
        "starwars" => "gorgox_starwars.db",
        _ => "gorgox.db",
    };
    
    let db_path = format!("sqlite:{}", db_name);
    tracing::info!("📂 Connecting to database: {} at path: {}", db_name, db_path);
    let pool = SqlitePool::connect(&db_path).await?;
    
    // Initialize tables FIRST (creates them if they don't exist)
    tracing::info!("📋 Initializing database schema...");
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            player_name TEXT NOT NULL,
            class TEXT NOT NULL,
            level INTEGER NOT NULL,
            max_hp INTEGER NOT NULL,
            current_hp INTEGER NOT NULL,
            armor_class INTEGER NOT NULL,
            initiative_bonus INTEGER NOT NULL,
            strength INTEGER NOT NULL,
            dexterity INTEGER NOT NULL,
            constitution INTEGER NOT NULL,
            intelligence INTEGER NOT NULL,
            wisdom INTEGER NOT NULL,
            charisma INTEGER NOT NULL,
            speed INTEGER NOT NULL,
            proficiency_bonus INTEGER NOT NULL,
            character_data TEXT,
            portrait_url TEXT,
            style TEXT NOT NULL DEFAULT 'dnd'
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS enemies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            creature_type TEXT NOT NULL,
            challenge_rating REAL NOT NULL,
            max_hp INTEGER NOT NULL,
            armor_class INTEGER NOT NULL,
            initiative_bonus INTEGER NOT NULL,
            strength INTEGER NOT NULL,
            dexterity INTEGER NOT NULL,
            constitution INTEGER NOT NULL,
            intelligence INTEGER NOT NULL,
            wisdom INTEGER NOT NULL,
            charisma INTEGER NOT NULL,
            speed INTEGER NOT NULL,
            actions TEXT NOT NULL,
            description TEXT NOT NULL,
            portrait_url TEXT,
            style TEXT NOT NULL DEFAULT 'dnd'
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS maps (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            image_path TEXT NOT NULL,
            grid_size INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL
        )
        "#,
    )
    .execute(&pool)
    .await?;
    
    // NOW run migrations for existing tables (adds style column if missing)
    // CRITICAL: This MUST succeed or characters won't load
    tracing::info!("🔄 Running database migrations...");
    match migrate_characters_table(&pool).await {
        Ok(_) => {
            tracing::info!("✅ Characters table migration completed");
        }
        Err(e) => {
            tracing::error!("❌ CRITICAL: Characters table migration failed: {}", e);
            tracing::error!("   Attempting fallback migration...");
            // Fallback: Just try to add it directly
            if let Err(e2) = sqlx::query("ALTER TABLE characters ADD COLUMN style TEXT NOT NULL DEFAULT 'dnd'")
                .execute(&pool)
                .await
            {
                let err_str = e2.to_string();
                if !err_str.contains("duplicate column") && !err_str.contains("already exists") {
                    tracing::error!("❌ Fallback migration also failed: {}", e2);
                } else {
                    tracing::info!("✅ Fallback migration: column already exists");
                }
            } else {
                tracing::info!("✅ Fallback migration succeeded");
            }
        }
    }
    
    match migrate_enemies_table(&pool).await {
        Ok(_) => {
            tracing::info!("✅ Enemies table migration completed");
        }
        Err(e) => {
            tracing::warn!("⚠️ Enemies table migration warning: {}", e);
        }
    }
    
    // Verify database connection and check if characters table has data
    match sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM characters")
        .fetch_one(&pool)
        .await
    {
        Ok(count) => {
            tracing::info!("✅ Database '{}' contains {} existing characters", db_name, count);
        }
        Err(e) => {
            tracing::warn!("⚠️ Could not count characters in '{}' (table may not exist yet): {}", db_name, e);
        }
    }
    
    tracing::info!("✅ Database '{}' initialized successfully", db_name);
    Ok(pool)
}
