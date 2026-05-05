//! Meshy [Image to 3D](https://docs.meshy.ai/api/image-to-3d) — server-side only; API key from `MESHY_API_KEY`.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

const MESHY_API_BASE: &str = "https://api.meshy.ai";

fn sniff_image_mime(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xd8 {
        return "image/jpeg";
    }
    if bytes.len() >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e && bytes[3] == 0x47 {
        return "image/png";
    }
    "image/png"
}

/// Loads portrait bytes and sends Meshy a data URI (works for localhost / LAN URLs Meshy cannot reach).
pub async fn portrait_to_meshy_image_url(
    client: &reqwest::Client,
    portrait: &str,
) -> Result<String, String> {
    let p = portrait.trim();
    if p.is_empty() {
        return Err("No portrait image".to_string());
    }
    if p.starts_with("data:image/") {
        return Ok(p.to_string());
    }

    let bytes: Vec<u8> = if p.starts_with("http://") || p.starts_with("https://") {
        let r = client
            .get(p)
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| format!("download portrait: {}", e))?;
        if !r.status().is_success() {
            return Err(format!("Portrait URL returned HTTP {}", r.status()));
        }
        r.bytes()
            .await
            .map_err(|e| format!("read portrait body: {}", e))?
            .to_vec()
    } else if p.starts_with('/') {
        let rel = p.trim_start_matches('/');
        let path = std::path::Path::new(".").join(rel);
        tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Could not read portrait file {}: {}", path.display(), e))?
    } else {
        return Err(
            "Portrait must be a data:image URI, http(s) URL, or a site path like /static/…"
                .to_string(),
        );
    };

    if bytes.is_empty() {
        return Err("Portrait image is empty".to_string());
    }
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("Portrait image too large (max 15 MB)".to_string());
    }

    let mime = sniff_image_mime(&bytes);
    let enc = B64.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, enc))
}

fn meshy_progress_to_u8(v: &Value) -> Option<u8> {
    if let Some(u) = v.as_u64() {
        return Some((u.min(100)) as u8);
    }
    if let Some(i) = v.as_i64() {
        return Some(i.clamp(0, 100) as u8);
    }
    v.as_f64()
        .map(|f| f.round().clamp(0.0, 100.0) as u8)
}

/// POST image-to-3d, poll until `SUCCEEDED`, download GLB bytes.
/// Optional `progress_tx` receives Meshy-reported completion percent (0–100) during polling.
pub async fn image_to_3d_download_glb(
    api_key: &str,
    image_url: String,
    progress_tx: Option<UnboundedSender<u8>>,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "image_url": image_url,
        "target_formats": ["glb"],
        "ai_model": "latest",
        "model_type": "lowpoly",
        "should_texture": true,
    });

    let create = client
        .post(format!("{}/openapi/v1/image-to-3d", MESHY_API_BASE))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Meshy create request: {}", e))?;

    let status = create.status();
    if !status.is_success() {
        let text = create.text().await.unwrap_or_default();
        return Err(format!("Meshy create failed ({}): {}", status, text));
    }

    let v: Value = create.json().await.map_err(|e| format!("Meshy create JSON: {}", e))?;
    let task_id = v.get("result").and_then(|x| x.as_str()).ok_or_else(|| {
        format!(
            "Meshy response missing result id: {}",
            serde_json::to_string(&v).unwrap_or_default()
        )
    })?;

    if let Some(tx) = &progress_tx {
        let _ = tx.send(0);
    }

    let poll_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_sent_progress: Option<u8> = None;

    for attempt in 0..120 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
        let url = format!("{}/openapi/v1/image-to-3d/{}", MESHY_API_BASE, task_id);
        let gr = poll_client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("Meshy poll: {}", e))?;
        let gtext = gr.text().await.map_err(|e| e.to_string())?;
        let gv: Value = serde_json::from_str(&gtext).map_err(|e| format!("Meshy poll JSON: {}", e))?;
        let st = gv
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("UNKNOWN");

        if let Some(pr) = gv.get("progress").and_then(meshy_progress_to_u8) {
            if last_sent_progress != Some(pr) {
                last_sent_progress = Some(pr);
                if let Some(tx) = &progress_tx {
                    let _ = tx.send(pr);
                }
            }
        }

        match st {
            "SUCCEEDED" => {
                if let Some(tx) = &progress_tx {
                    let _ = tx.send(100);
                }
                let glb_url = gv
                    .get("model_urls")
                    .and_then(|m| m.get("glb"))
                    .and_then(|u| u.as_str())
                    .ok_or_else(|| "Meshy: missing model_urls.glb".to_string())?;
                let bin = poll_client
                    .get(glb_url)
                    .send()
                    .await
                    .map_err(|e| format!("download GLB: {}", e))?
                    .bytes()
                    .await
                    .map_err(|e| format!("read GLB: {}", e))?;
                return Ok(bin.to_vec());
            }
            "FAILED" | "CANCELED" => {
                let msg = gv
                    .pointer("/task_error/message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("unknown");
                return Err(format!("Meshy task {}: {}", st, msg));
            }
            "PENDING" | "IN_PROGRESS" => {
                if let Some(pr) = gv.get("progress").and_then(meshy_progress_to_u8) {
                    tracing::info!("Meshy task {} progress {}%", task_id, pr);
                }
                continue;
            }
            _ => continue,
        }
    }

    Err("Meshy task timed out (waited up to ~10 minutes)".to_string())
}

pub fn arena_stl_from_character_data_json(s: &str) -> Option<String> {
    let v: Value = serde_json::from_str(s).ok()?;
    if let Some(u) = v
        .pointer("/character/_gorgox_arena_stl_url")
        .and_then(|x| x.as_str())
    {
        if !u.trim().is_empty() {
            return Some(u.to_string());
        }
    }
    if let Some(u) = v.get("_gorgox_arena_stl_url").and_then(|x| x.as_str()) {
        if !u.trim().is_empty() {
            return Some(u.to_string());
        }
    }
    None
}

pub fn arena_stl_from_enemy_actions_json(s: &str) -> Option<String> {
    let v: Value = serde_json::from_str(s).ok()?;
    v.get("_gorgox_arena_stl_url")
        .and_then(|x| x.as_str())
        .map(|u| u.to_string())
        .filter(|u| !u.trim().is_empty())
}
