use std::collections::{HashMap, HashSet};

use sqlx::{Row, SqlitePool};
use anyhow::Result;
use serde::Deserialize;
use serde_json::Value;

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
            height INTEGER NOT NULL,
            map_state TEXT
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
    
    // Migrate maps table to add map_state column
    tracing::info!("🔄 Migrating: Ensuring 'map_state' column exists in maps table...");
    match sqlx::query("ALTER TABLE maps ADD COLUMN map_state TEXT")
        .execute(&pool)
        .await
    {
        Ok(_) => {
            tracing::info!("✅ Successfully added 'map_state' column to maps table");
        }
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("duplicate column") || err_str.contains("already exists") {
                tracing::info!("✅ 'map_state' column already exists in maps table");
            } else {
                tracing::warn!("⚠️ Maps table migration warning: {}", e);
            }
        }
    }
    
    if style == "starwars" {
        tracing::info!("📋 Ensuring SW5e compendium table (Star Wars DB)...");
        ensure_sw5e_compendium_table(&pool).await?;
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

/// Allowed `category` values for SW5e compendium browsing (aligned with Node import filenames).
pub const SW5E_COMP_CATEGORY_IDS: &[&str] = &[
    "tech_powers",
    "force_powers",
    "weapons",
    "armor",
    "gear_misc",
    "feats",
    "maneuvers",
    "species",
    "species_features",
    "classes",
    "archetypes",
    "invocations",
    "backgrounds",
    "fighting_styles",
    "fighting_masteries",
    "implements",
    "kits",
    "class_features",
    "archetype_features",
    "powers_other",
    "other",
];

pub fn sw5e_compendium_allowed_category(cat: &str) -> bool {
    SW5E_COMP_CATEGORY_IDS.iter().any(|&c| c == cat)
}

/// Directory holding `*_from_packs.json` slices (after `scripts/import-sw5e-packs.mjs`).
pub fn sw5e_compendium_disk_dir() -> std::path::PathBuf {
    std::env::var("GORGOX_SW5E_COMP_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("static/data/sw5e_compendium"))
}

async fn ensure_sw5e_compendium_table(pool: &SqlitePool) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sw5e_compendium_entries (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            sort_key TEXT NOT NULL,
            json TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS ix_sw5e_comp_category ON sw5e_compendium_entries(category)"#)
        .execute(pool)
        .await?;
    sqlx::query(r#"CREATE INDEX IF NOT EXISTS ix_sw5e_comp_cat_sort ON sw5e_compendium_entries(category, sort_key)"#)
        .execute(pool)
        .await?;
    Ok(())
}

fn sw5e_row_sort_key(row: &Value) -> String {
    row.get("name")
        .and_then(|v| v.as_str())
        .or_else(|| row.get("Name").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_lowercase()
}

fn sw5e_entry_id(cat: &str, row: &Value, fallback_idx: usize) -> String {
    row.get("_stable_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}#{}", cat, fallback_idx))
}

/// Reads JSON slices from disk and replaces all rows in `sw5e_compendium_entries`.
/// Skips silently if the output directory exists but contains no slice files yet.
pub async fn hydrate_sw5e_compendium_from_disk(pool: &SqlitePool) -> Result<(usize, usize)> {
    const FILES: &[(&str, &str)] = &[
        ("tech_powers", "techpowers_from_packs.json"),
        ("force_powers", "force_powers_from_packs.json"),
        ("weapons", "weapons_from_packs.json"),
        ("armor", "armor_from_packs.json"),
        ("gear_misc", "gear_misc_from_packs.json"),
        ("feats", "feats_from_packs.json"),
        ("maneuvers", "maneuvers_from_packs.json"),
        ("species", "species_from_packs.json"),
        ("species_features", "speciesfeatures_from_packs.json"),
        ("classes", "classes_from_packs.json"),
        ("archetypes", "archetypes_from_packs.json"),
        ("invocations", "invocations_from_packs.json"),
        ("backgrounds", "backgrounds_from_packs.json"),
        ("fighting_styles", "fightingstyles_from_packs.json"),
        ("fighting_masteries", "fightingmasteries_from_packs.json"),
        ("implements", "implements_from_packs.json"),
        ("kits", "kits_from_packs.json"),
        ("class_features", "classfeatures_from_packs.json"),
        ("archetype_features", "archetypefeatures_from_packs.json"),
        ("powers_other", "powers_other_from_packs.json"),
        ("other", "other_from_packs.json"),
    ];

    let dir = sw5e_compendium_disk_dir();
    if !tokio::fs::try_exists(&dir).await.unwrap_or(false) {
        tracing::info!(
            "SW5e compendium: folder not found ({}) — run scripts/import-sw5e-packs.mjs first",
            dir.display()
        );
        return Ok((0, 0));
    }

    let mut any_file = false;
    for (_, fname) in FILES {
        let p = dir.join(fname);
        if tokio::fs::try_exists(&p).await.unwrap_or(false) {
            any_file = true;
            break;
        }
    }
    if !any_file {
        tracing::info!(
            "SW5e compendium: no *_from_packs.json under {}; database table left unchanged",
            dir.display()
        );
        return Ok((0, 0));
    }

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM sw5e_compendium_entries")
        .execute(&mut *tx)
        .await?;

    let mut slices = 0usize;
    let mut rows_total = 0usize;

    for (cat, fname) in FILES {
        let path = dir.join(fname);
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            continue;
        }
        let body = tokio::fs::read_to_string(&path).await?;
        let arr: Vec<Value> = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("failed to parse {}: {}", path.display(), e))?;
        for (i, row) in arr.iter().enumerate() {
            let id = sw5e_entry_id(cat, row, i);
            let sort_key = sw5e_row_sort_key(row);
            let json = serde_json::to_string(row).map_err(|e| anyhow::anyhow!("row {}:{}: {}", cat, i, e))?;
            sqlx::query(
                "INSERT INTO sw5e_compendium_entries (id, category, sort_key, json) VALUES (?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(cat)
            .bind(&sort_key)
            .bind(&json)
            .execute(&mut *tx)
            .await?;
            rows_total += 1;
        }
        tracing::debug!("SW5e compendium slice {}: {} rows", cat, arr.len());
        slices += 1;
    }

    tx.commit().await?;
    tracing::info!(
        "✅ SW5e compendium imported into SQLite: {} slices, {} total rows",
        slices,
        rows_total
    );
    Ok((slices, rows_total))
}

#[derive(Clone, serde::Serialize)]
pub struct Sw5eCompendiumCategoryCount {
    pub id: String,
    pub label: String,
    pub count: i64,
}

fn sw5e_category_label(cat: &str) -> String {
    match cat {
        "tech_powers" => "Tech powers".into(),
        "force_powers" => "Force powers".into(),
        "weapons" => "Weapons".into(),
        "armor" => "Armor".into(),
        "gear_misc" => "Gear & misc".into(),
        "feats" => "Feats".into(),
        "maneuvers" => "Maneuvers".into(),
        "species" => "Species".into(),
        "species_features" => "Species features".into(),
        "classes" => "Classes".into(),
        "archetypes" => "Archetypes".into(),
        "invocations" => "Invocations".into(),
        "backgrounds" => "Backgrounds".into(),
        "fighting_styles" => "Fighting styles".into(),
        "fighting_masteries" => "Fighting masteries".into(),
        "implements" => "Implements".into(),
        "kits" => "Kits".into(),
        "class_features" => "Class features".into(),
        "archetype_features" => "Archetype features".into(),
        "powers_other" => "Other powers".into(),
        "other" => "Other".into(),
        _ => cat.to_string(),
    }
}

pub async fn sw5e_compendium_category_counts(pool: &SqlitePool) -> Result<Vec<Sw5eCompendiumCategoryCount>> {
    let rows = sqlx::query(
        "SELECT category, COUNT(*) as c FROM sw5e_compendium_entries GROUP BY category",
    )
    .fetch_all(pool)
    .await?;

    let mut counts: HashMap<String, i64> = HashMap::new();
    for r in rows {
        counts.insert(r.get::<String, _>("category"), r.get::<i64, _>("c"));
    }

    Ok(SW5E_COMP_CATEGORY_IDS
        .iter()
        .map(|&id| Sw5eCompendiumCategoryCount {
            id: id.to_string(),
            label: sw5e_category_label(id),
            count: counts.get(id).copied().unwrap_or(0),
        })
        .collect())
}

#[derive(Clone, serde::Serialize)]
pub struct Sw5eCompendiumEntryOut {
    pub id: String,
    pub name: String,
    pub json: serde_json::Value,
}

pub async fn sw5e_compendium_browse(
    pool: &SqlitePool,
    category: &str,
    offset: u64,
    limit: u64,
) -> Result<(Vec<Sw5eCompendiumEntryOut>, i64)> {
    if !sw5e_compendium_allowed_category(category) {
        anyhow::bail!("invalid category");
    }
    let limit = limit.clamp(1, 150);
    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sw5e_compendium_entries WHERE category = ?")
            .bind(category)
            .fetch_one(pool)
            .await?;

    let rows = sqlx::query(
        "SELECT id, sort_key, json FROM sw5e_compendium_entries WHERE category = ? ORDER BY sort_key, id LIMIT ? OFFSET ?",
    )
    .bind(category)
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let id: String = r.get("id");
        let sk: String = r.get("sort_key");
        let js: String = r.get("json");
        let val: Value = serde_json::from_str(&js).unwrap_or(Value::String(js));
        let name = val
            .get("name")
            .and_then(|v| v.as_str())
            .or_else(|| val.get("Name").and_then(|v| v.as_str()))
            .unwrap_or(&sk)
            .to_string();
        out.push(Sw5eCompendiumEntryOut { id, name, json: val });
    }
    Ok((out, total))
}

/// Bulk export of compendium JSON rows (verbatim) for building client caches. Only lightweight categories allowed.
pub async fn sw5e_compendium_category_export(pool: &SqlitePool, category: &str) -> Result<Vec<Value>> {
    const ALLOW: &[&str] = &["tech_powers", "force_powers"];
    if !ALLOW.iter().any(|&c| c == category) {
        anyhow::bail!("category_export_not_allowed");
    }
    if !sw5e_compendium_allowed_category(category) {
        anyhow::bail!("invalid category");
    }
    let rows = sqlx::query_scalar::<_, String>(
        r#"SELECT json FROM sw5e_compendium_entries WHERE category = ? ORDER BY sort_key, id"#,
    )
    .bind(category)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|js| serde_json::from_str(&js).ok())
        .collect())
}

// --- SW5e player-facing class / specialization kit ---------------------------------

#[derive(Debug, Deserialize, serde::Serialize, Clone)]
pub struct Sw5eClassCharEntry {
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub specialization: Option<String>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
pub struct Sw5ePlayerKitRequest {
    #[serde(default)]
    pub class_entries: Vec<Sw5eClassCharEntry>,
    /// Legacy / simple shape: paired by index with `specialization_names`
    #[serde(default)]
    pub class_slugs: Vec<String>,
    #[serde(default)]
    pub specialization_names: Vec<String>,
    /// Foundry-ish species slug (e.g. `human`) for matching `speciesfeatures/…`.
    #[serde(default)]
    pub species_slug: Option<String>,
    #[serde(default)]
    pub character_level: Option<i32>,
}

fn norm_slug_sw5e(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

fn arche_name_matches(row: &Value, want: &str) -> bool {
    let want = want.trim().to_ascii_lowercase();
    if want.is_empty() {
        return false;
    }
    let nm = row
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if nm == want {
        return true;
    }
    if want.len() >= 4 && nm.contains(want.as_str()) {
        return true;
    }
    if nm.len() >= 4 && want.contains(nm.as_str()) {
        return true;
    }
    if want.len() >= 4 {
        let id_lc = arche_identifier_lc(row).unwrap_or_default();
        if !id_lc.is_empty() && (id_lc.contains(want.as_str()) || want.contains(id_lc.as_str())) {
            return true;
        }
    }
    false
}

fn arche_identifier_lc(row: &Value) -> Option<String> {
    row.get("system")
        .and_then(|s| s.get("identifier"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
}

fn compact_class_kit(row: Value) -> Value {
    let Some(mut o) = row.as_object().cloned() else {
        return row;
    };
    if let Some(sys) = o.get("system").cloned() {
        let kept = serde_json::json!({
            "advancement": sys.get("advancement"),
            "identifier": sys.get("identifier"),
            "startingEquipment": sys.get("startingEquipment"),
            "proficiencies": sys.get("proficiencies"),
            "skills": sys.get("skills"),
            "startingHitDice": sys.get("startingHitDice"),
            "hitDice": sys.get("hitDice"),
            "saves": sys.get("saves"),
            "powers": sys.get("powers"),
            "weaponProf": sys.get("weaponProf"),
            "armorProf": sys.get("armorProf"),
            "description": sys.get("description"),
        });
        o.insert("system".to_string(), kept);
    }
    Value::Object(o)
}

fn stable_row_key(v: &Value) -> String {
    if let Some(s) = v.get("_stable_id").and_then(|x| x.as_str()) {
        if !s.is_empty() {
            return s.to_string();
        }
    }
    if let Some(s) = v.get("_imported_from").and_then(|x| x.as_str()) {
        if !s.is_empty() {
            return s.to_string();
        }
    }
    serde_json::to_string(v).unwrap_or_else(|_| String::from("{}"))
}

fn dedupe_json_values(rows: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::<String>::new();
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let k = stable_row_key(&r);
        if seen.insert(k) {
            out.push(r);
        }
    }
    out
}

fn kit_entries_from_req(req: &Sw5ePlayerKitRequest) -> Vec<(String, Option<String>)> {
    if !req.class_entries.is_empty() {
        let mut out = Vec::new();
        for e in &req.class_entries {
            let slug_o = e
                .slug
                .as_ref()
                .map(|s| norm_slug_sw5e(s))
                .filter(|s| !s.is_empty());
            if let Some(slug) = slug_o {
                out.push((slug, e.specialization.clone()));
            }
        }
        return out;
    }
    let maxn = req.class_slugs.len().max(req.specialization_names.len());
    let mut out = Vec::new();
    for i in 0..maxn {
        let slug = req
            .class_slugs
            .get(i)
            .map(|s| norm_slug_sw5e(s))
            .filter(|s| !s.is_empty());
        if let Some(sl) = slug {
            let spec = req.specialization_names.get(i).cloned();
            out.push((sl, spec));
        }
    }
    out
}

async fn json_row_by_exact_id(pool: &SqlitePool, id: &str) -> Result<Option<Value>> {
    let s: Option<String> = sqlx::query_scalar(
        "SELECT json FROM sw5e_compendium_entries WHERE id = ? LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(s.and_then(|js| serde_json::from_str(&js).ok()))
}

pub async fn sw5e_fetch_class_document(pool: &SqlitePool, class_slug: &str) -> Result<Option<Value>> {
    let slug = norm_slug_sw5e(class_slug);
    if slug.is_empty() {
        return Ok(None);
    }
    if let Some(doc) = json_row_by_exact_id(pool, &format!("class:{slug}")).await? {
        return Ok(Some(doc));
    }
    let path_exact = format!("classes/{slug}.json");
    let like_nested = format!("%classes/{slug}%");
    let slug_no_hyphen = slug.replace('-', "");

    let s: Option<String> = sqlx::query_scalar::<_, String>(
        r#"SELECT json FROM sw5e_compendium_entries WHERE category = 'classes'
            AND (
              lower(trim(coalesce(json_extract(json, '$._class_slug'), ''))) = ?
              OR lower(trim(coalesce(json_extract(json, '$.system.identifier'), ''))) = ?
              OR replace(lower(trim(coalesce(json_extract(json, '$.name'), ''))), '-', '')
                 = replace(?, '-', '')
              OR lower(trim(coalesce(json_extract(json, '$._imported_from'), ''))) = lower(?)
              OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE ?
            )
            ORDER BY length(json) DESC LIMIT 1"#,
    )
    .bind(&slug)
    .bind(&slug)
    .bind(slug_no_hyphen)
    .bind(path_exact.clone())
    .bind(like_nested)
    .fetch_optional(pool)
    .await?;

    Ok(s.and_then(|js| serde_json::from_str(&js).ok()))
}

/// Client sometimes sends specialization/sub-class tokens (e.g. `armstech`) instead of base class (`engineer`).
/// Match archetype rows whose name, identifier, or import path contains the hint and return `_class_slug`/`class`.
async fn sw5e_resolve_base_class_via_archetype_hint(
    pool: &SqlitePool,
    hint: &str,
) -> Result<Option<String>> {
    let h = norm_slug_sw5e(hint);
    if h.len() < 3 {
        return Ok(None);
    }
    let needle = format!("%{h}%");
    let rows = sqlx::query_scalar::<_, String>(
        r#"SELECT json FROM sw5e_compendium_entries WHERE category = 'archetypes'
            AND (
              lower(coalesce(json_extract(json, '$.name'), '')) LIKE lower(?)
              OR lower(coalesce(json_extract(json, '$.system.identifier'), '')) LIKE lower(?)
              OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
            )
            LIMIT 24"#,
    )
    .bind(&needle)
    .bind(&needle)
    .bind(&needle)
    .fetch_all(pool)
    .await?;

    for js in rows {
        let Ok(val) = serde_json::from_str::<Value>(&js) else {
            continue;
        };
        let parent = val
            .get("_class_slug")
            .and_then(|x| x.as_str())
            .or_else(|| val.get("class").and_then(|x| x.as_str()));
        let Some(p) = parent else { continue };
        let base = norm_slug_sw5e(p);
        if base.is_empty() || base == h {
            continue;
        }
        if sw5e_fetch_class_document(pool, &base).await?.is_some() {
            return Ok(Some(base));
        }
    }
    Ok(None)
}

async fn sw5e_fetch_by_category_for_class_slug(
    pool: &SqlitePool,
    category: &str,
    class_slug: &str,
) -> Result<Vec<Value>> {
    let slug = norm_slug_sw5e(class_slug);
    if slug.is_empty() {
        return Ok(Vec::new());
    }
    let cf_like = format!("classfeatures/{slug}/%");
    let cf_like_nested = format!("%classfeatures/{slug}/%");
    let af_like = format!("archetypefeatures/{slug}/%");
    let af_like_nested = format!("%archetypefeatures/{slug}/%");

    let rows = if category == "class_features" {
        sqlx::query_scalar::<_, String>(
            r#"SELECT json FROM sw5e_compendium_entries WHERE category = 'class_features'
              AND (
                lower(trim(coalesce(json_extract(json, '$._class_slug'), ''))) = ?
                OR lower(trim(coalesce(json_extract(json, '$.system.classIdentifier'), ''))) = ?
                OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
                OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
              )
              ORDER BY sort_key"#,
        )
        .bind(&slug)
        .bind(&slug)
        .bind(cf_like)
        .bind(cf_like_nested)
        .fetch_all(pool)
        .await?
    } else if category == "archetype_features" {
        sqlx::query_scalar::<_, String>(
            r#"SELECT json FROM sw5e_compendium_entries WHERE category = 'archetype_features'
              AND (
                lower(trim(coalesce(json_extract(json, '$._class_slug'), ''))) = ?
                OR lower(trim(coalesce(json_extract(json, '$.system.classIdentifier'), ''))) = ?
                OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
                OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
              )
              ORDER BY sort_key"#,
        )
        .bind(&slug)
        .bind(&slug)
        .bind(af_like)
        .bind(af_like_nested)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_scalar::<_, String>(
            r#"SELECT json FROM sw5e_compendium_entries WHERE category = ?
              AND lower(trim(coalesce(json_extract(json, '$._class_slug'), ''))) = ?
              ORDER BY sort_key"#,
        )
        .bind(category)
        .bind(&slug)
        .fetch_all(pool)
        .await?
    };

    Ok(dedupe_json_values(
        rows.into_iter()
            .filter_map(|js| serde_json::from_str(&js).ok())
            .collect(),
    ))
}

async fn sw5e_fetch_archetypes_for_class(
    pool: &SqlitePool,
    class_slug: &str,
) -> Result<Vec<Value>> {
    let slug = norm_slug_sw5e(class_slug);
    if slug.is_empty() {
        return Ok(Vec::new());
    }
    let arche_like = format!("archetypes/{slug}/%");
    let arche_like_nested = format!("%archetypes/{slug}/%");

    let rows = sqlx::query_scalar::<_, String>(
        r#"SELECT json FROM sw5e_compendium_entries WHERE category = 'archetypes'
            AND (
              lower(trim(coalesce(json_extract(json, '$._class_slug'), ''))) = ?
              OR lower(trim(coalesce(json_extract(json, '$.class'), ''))) = ?
              OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
              OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
            )
            ORDER BY sort_key"#,
    )
    .bind(&slug)
    .bind(&slug)
    .bind(arche_like)
    .bind(arche_like_nested)
    .fetch_all(pool)
    .await?;
    Ok(dedupe_json_values(
        rows.into_iter()
            .filter_map(|js| serde_json::from_str(&js).ok())
            .collect(),
    ))
}

async fn sw5e_fetch_species_features_for_slug(
    pool: &SqlitePool,
    species_slug: &str,
) -> Result<Vec<Value>> {
    let s = norm_slug_sw5e(species_slug);
    if s.is_empty() {
        return Ok(Vec::new());
    }
    let path_like = format!("%speciesfeatures/{}/%", s.trim());
    let rows = sqlx::query_scalar::<_, String>(
        r#"SELECT json FROM sw5e_compendium_entries WHERE category = 'species_features'
            AND (
              lower(trim(coalesce(json_extract(json, '$._species_slug'), ''))) = ?
              OR lower(coalesce(json_extract(json, '$._imported_from'), '')) LIKE lower(?)
            )
            ORDER BY sort_key"#,
    )
    .bind(&s)
    .bind(&path_like)
    .fetch_all(pool)
    .await?;
    Ok(dedupe_json_values(
        rows.into_iter()
            .filter_map(|js| serde_json::from_str(&js).ok())
            .collect(),
    ))
}

async fn sw5e_fetch_invocations_for_kit_row(
    pool: &SqlitePool,
    class_lookup_slug: &str,
    spec_note: Option<&str>,
) -> Result<Vec<Value>> {
    let c = norm_slug_sw5e(class_lookup_slug);
    if c.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query_scalar::<_, String>(
        r#"SELECT json FROM sw5e_compendium_entries WHERE category = 'invocations'
            AND (
              lower(trim(coalesce(json_extract(json, '$._class_slug'), ''))) = ?
              OR lower(trim(coalesce(json_extract(json, '$._invocation_group'), ''))) = ?
            )
            ORDER BY sort_key"#,
    )
    .bind(&c)
    .bind(&c)
    .fetch_all(pool)
    .await?;
    let full: Vec<Value> = dedupe_json_values(
        rows.into_iter()
            .filter_map(|js| serde_json::from_str(&js).ok())
            .collect(),
    );
    let note = spec_note.map(str::trim).filter(|x| x.len() >= 3);
    let Some(sn) = note else {
        return Ok(full);
    };
    let needle = sn.to_ascii_lowercase();
    let filtered: Vec<Value> = full
        .iter()
        .filter(|v| {
            v.get("_imported_from")
                .and_then(|x| x.as_str())
                .map(|p| p.to_ascii_lowercase().contains(needle.as_str()))
                .unwrap_or(false)
                || v.get("name")
                    .and_then(|x| x.as_str())
                    .map(|n| n.to_ascii_lowercase().contains(needle.as_str()))
                    .unwrap_or(false)
        })
        .cloned()
        .collect();
    Ok(if filtered.is_empty() && !full.is_empty() {
        full
    } else {
        filtered
    })
}

/// Rows for archetype-linked features scoped to specialization when identifiers match pack data.
pub async fn sw5e_player_kit(pool: &SqlitePool, req: &Sw5ePlayerKitRequest) -> Result<Value> {
    const MAX_CF: usize = 160;
    const MAX_AF: usize = 120;
    const MAX_SF: usize = 100;
    const MAX_INV_ROW: usize = 72;

    let entries = kit_entries_from_req(req);
    if entries.is_empty() {
        return Ok(serde_json::json!({
            "error": "no_class_slugs",
            "hint": "Send class_entries: [{ slug, specialization }] or class_slugs + specialization_names",
        }));
    }

    let mut classes: Vec<Value> = Vec::new();
    let mut specializations_you: Vec<Value> = Vec::new();
    let mut specialization_catalog: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut class_features: Vec<Value> = Vec::new();
    let mut archetype_features: Vec<Value> = Vec::new();
    let mut invocation_rows: Vec<Value> = Vec::new();
    let mut diagnostics: Vec<String> = Vec::new();

    let species_slug_norm = req
        .species_slug
        .as_ref()
        .map(|s| norm_slug_sw5e(s.as_str()))
        .filter(|s| !s.is_empty());
    let mut species_features_raw = Vec::new();
    if let Some(ref sh) = species_slug_norm {
        species_features_raw = sw5e_fetch_species_features_for_slug(pool, sh.as_str()).await?;
        species_features_raw.truncate(MAX_SF);
        if species_features_raw.is_empty() {
            diagnostics.push(format!(
                "No species-features found for `{sh}` — run import including speciesfeatures/ and hydrate."
            ));
        }
    }

    for (slug, spec_opt) in &entries {
        let requested_slug = slug.as_str();
        let mut lookup_slug = slug.clone();
        let mut doc_opt = sw5e_fetch_class_document(pool, &lookup_slug).await?;
        if doc_opt.is_none() {
            if let Ok(Some(base)) =
                sw5e_resolve_base_class_via_archetype_hint(pool, &lookup_slug).await
            {
                lookup_slug.clone_from(&base);
                doc_opt = sw5e_fetch_class_document(pool, &lookup_slug).await?;
                diagnostics.push(format!(
                    "Resolved base class `{lookup_slug}` from archetype catalog (requested `{requested_slug}` was not a class document)."
                ));
            }
        }

        let mut class_found = false;
        if let Some(doc) = doc_opt {
            class_found = true;
            classes.push(compact_class_kit(doc));
        } else {
            diagnostics.push(format!(
                "No class document found for slug `{requested_slug}` in SQLite (try re-importing packs + restarting the server)."
            ));
            classes.push(serde_json::json!({
                "_missing": true,
                "_class_slug": requested_slug,
                "hint": "Re-run import-sw5e-packs.mjs and restart the server with fresh compendium JSON",
            }));
        }

        let arch_list = sw5e_fetch_archetypes_for_class(pool, &lookup_slug)
            .await
            .unwrap_or_default();
        if class_found && arch_list.is_empty() {
            diagnostics.push(format!(
                "No archetypes (specializations) tied to `{lookup_slug}` were loaded from SQLite — ensure archetypes slice imported and hydrate ran."
            ));
        }
        specialization_catalog.insert(
            slug.clone(), // keep worksheet key even when lookup_slug resolved to engineer
            serde_json::Value::Array(
                arch_list
                    .iter()
                    .map(|a| {
                        serde_json::json!({
                            "name": a.get("name"),
                            "source": a.get("source"),
                            "identifier": arche_identifier_lc(a),
                        })
                    })
                    .collect(),
            ),
        );

        let mut local_arc_identifiers: Vec<String> = Vec::new();

        if let Some(spec) = spec_opt {
            let sp = spec.trim();
            if !sp.is_empty() {
                let chosen: Vec<Value> = arch_list
                    .iter()
                    .filter(|row| arche_name_matches(row, sp))
                    .cloned()
                    .collect();

                local_arc_identifiers = chosen
                    .iter()
                    .filter_map(|row| arche_identifier_lc(row))
                    .collect();

                let mut row_out = serde_json::json!({
                    "class_slug": slug,
                    "resolved_lookup_slug": serde_json::Value::String(lookup_slug.clone()),
                    "specialization_name_requested": spec,
                    "hits": serde_json::Value::Array(chosen.clone()),
                });
                if let Some(first) = local_arc_identifiers.first() {
                    row_out.as_object_mut().unwrap().insert(
                        "identifiers".into(),
                        serde_json::json!(&local_arc_identifiers),
                    );
                    row_out
                        .as_object_mut()
                        .unwrap()
                        .insert("primary_identifier".into(), serde_json::json!(first));
                }
                specializations_you.push(row_out);
            }
        }

        let mut cf_all =
            sw5e_fetch_by_category_for_class_slug(pool, "class_features", &lookup_slug).await?;
        if class_found && cf_all.is_empty() {
            diagnostics.push(format!(
                "No class-features loaded for `{lookup_slug}` — regenerate packs (classfeatures_from_packs.json) then restart."
            ));
        }
        cf_all.truncate(MAX_CF);
        class_features.extend(cf_all);

        let af_all =
            sw5e_fetch_by_category_for_class_slug(pool, "archetype_features", &lookup_slug).await?;
        if class_found && af_all.is_empty() {
            diagnostics.push(format!(
                "No archetype-features tied to `{lookup_slug}` in SQLite yet (bulk import assigns these from archetypefeatures/)."
            ));
        }
        let idset: std::collections::HashSet<String> =
            local_arc_identifiers.iter().cloned().collect();

        let mut filtered: Vec<Value> = if idset.is_empty() {
            af_all.clone()
        } else {
            af_all
                .iter()
                .filter(|row| {
                    row.get("_archetype_ref")
                        .and_then(|v| v.as_str())
                        .map(|r| idset.contains(&r.trim().to_ascii_lowercase()))
                        .unwrap_or(false)
                })
                .cloned()
                .collect::<Vec<_>>()
        };

        if filtered.is_empty()
            && !af_all.is_empty()
            && spec_opt.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false)
        {
            filtered = af_all.clone();
        }

        filtered.truncate(MAX_AF);
        archetype_features.extend(filtered);

        let mut inv_pick = sw5e_fetch_invocations_for_kit_row(
            pool,
            &lookup_slug,
            spec_opt.as_ref().map(|s| s.as_str()),
        )
        .await
        .unwrap_or_default();
        inv_pick.truncate(MAX_INV_ROW);
        invocation_rows.extend(inv_pick);
    }

    invocation_rows = dedupe_json_values(invocation_rows);
    invocation_rows.truncate(MAX_INV_ROW * 3);

    Ok(serde_json::json!({
        "character_level": req.character_level,
        "species_slug": species_slug_norm,
        "species_features_count": species_features_raw.len(),
        "species_features": species_features_raw,
        "invocations_count": invocation_rows.len(),
        "invocations": invocation_rows,
        "class_features_count": class_features.len(),
        "archetype_features_count": archetype_features.len(),
        "classes": classes,
        "specializations_you": specializations_you,
        "specializations_available": specialization_catalog,
        "class_features": class_features,
        "archetype_features": archetype_features,
        "diagnostics": diagnostics,
    }))
}
