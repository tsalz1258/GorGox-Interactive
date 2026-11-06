//! Map-local, opt-in sight settings. Walls affect sight only, not movement or rolls.
use serde_json::Value;
use std::collections::HashSet;

pub fn validate(settings: &Value) -> Result<(), String> {
    if !settings.is_object() || settings["version"].as_u64() != Some(1) {
        return Err("Unsupported vision settings version".into());
    }
    if settings["enabled"].as_bool().is_none()
        || !matches!(settings["mode"].as_str(), Some("party" | "character"))
        || !settings["rangeFeet"].as_f64().map(|n| n.is_finite() && (5.0..=1000.0).contains(&n)).unwrap_or(false) {
        return Err("Choose vision mode and range (5–1000 ft)".into());
    }
    let walls = settings["walls"].as_array().filter(|a| a.len() <= 250).ok_or("Keep at most 250 walls/doors")?;
    let mut ids = HashSet::new();
    for wall in walls {
        let id = wall["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 100).ok_or("Invalid wall ID")?;
        if !ids.insert(id) { return Err("Duplicate wall ID".into()); }
        for key in ["x1", "y1", "x2", "y2"] { coordinate(&wall[key])?; }
        if wall["x1"].as_f64() == wall["x2"].as_f64() && wall["y1"].as_f64() == wall["y2"].as_f64() { return Err("Wall endpoints must differ".into()); }
        if !matches!(wall["kind"].as_str(), Some("wall" | "door")) || wall["open"].as_bool().is_none() { return Err("Invalid wall/door type".into()); }
        if wall["kind"] == "wall" && wall["open"] == true { return Err("Only doors can open".into()); }
    }
    let reveals = settings["reveals"].as_array().filter(|a| a.len() <= 100).ok_or("Keep at most 100 reveal rectangles")?;
    for rect in reveals {
        for key in ["x", "y", "width", "height"] { coordinate(&rect[key])?; }
        if rect["width"].as_f64().unwrap() <= 0.0 || rect["height"].as_f64().unwrap() <= 0.0 { return Err("Reveal dimensions must be positive".into()); }
    }
    let overrides = settings["tokenOverrides"].as_object().filter(|a| a.len() <= 500).ok_or("Invalid token vision overrides")?;
    if overrides.iter().any(|(id,v)| id.is_empty() || id.len() > 100 || v.as_bool().is_none()) { return Err("Invalid token vision override".into()); }
    Ok(())
}
fn coordinate(v: &Value) -> Result<(), String> {
    if v.as_f64().map(|n| n.is_finite() && n.abs() < 100000.0).unwrap_or(false) { Ok(()) } else { Err("Invalid vision coordinates".into()) }
}
pub fn validate_maps(maps: &Value) -> Result<(), String> {
    let maps = maps.as_object().filter(|m| m.len() <= 100).ok_or("Invalid map vision collection")?;
    for (id,settings) in maps {
        if id.is_empty() || id.len() > 100 { return Err("Invalid vision map ID".into()); }
        validate(settings)?;
    }
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    use serde_json::json;
    fn settings() -> Value { json!({"version":1,"enabled":true,"mode":"party","rangeFeet":120,"walls":[{"id":"w","kind":"door","open":false,"x1":3,"y1":0,"x2":3,"y2":8}],"reveals":[],"tokenOverrides":{}}) }
    #[test] fn rejects_invalid_and_duplicate_geometry() {
        let mut v = settings(); validate(&v).unwrap();
        v["walls"][0]["x2"] = json!(3); v["walls"][0]["y2"] = json!(0); assert!(validate(&v).is_err());
        let mut v = settings(); let duplicate = v["walls"][0].clone(); v["walls"].as_array_mut().unwrap().push(duplicate); assert!(validate(&v).is_err());
        let mut v = settings(); v["rangeFeet"] = json!(-1); assert!(validate(&v).is_err());
        let mut v = settings(); v["reveals"] = json!([{"x":0,"y":0,"width":-3,"height":1}]); assert!(validate(&v).is_err());
    }
    #[test] fn edits_are_dm_only_map_local_and_undoable() {
        use crate::{game_state::GameState,models::Map,table};
        let mut gs = GameState::new(); gs.current_map = Some(Map{id:"a".into(),name:"A".into(),image_path:"".into(),grid_size:50,width:500,height:500,map_state:None});
        let action = json!({"kind":"vision","map_id":"a","settings":settings()});
        assert!(table::apply(&mut gs,&action,false,None).is_err());
        table::apply(&mut gs,&action,true,None).unwrap();
        assert_eq!(gs.session_extras["visionMaps"]["a"]["enabled"],true);
        table::undo(&mut gs).unwrap(); assert!(gs.session_extras["visionMaps"].is_null());
        let mut stale = action; stale["map_id"] = json!("b"); assert!(table::apply(&mut gs,&stale,true,None).is_err());
        assert!(gs.session_extras["visionMaps"].is_null());
    }
}
