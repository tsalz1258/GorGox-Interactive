//! Bounded table history and recovery, independent of browser caches.
use crate::game_state::GameState;
use serde_json::{json, Value};
use std::path::Path;

pub fn checkpoint(gs: &GameState) -> Value {
    let mut state = crate::session::snapshot(gs);
    for key in ["savedAt", "logHistory", "playerMapViewport", "players"] { state.as_object_mut().unwrap().remove(key); }
    if let Some(rows) = state["characters"].as_array_mut() { rows.sort_by_key(|c|c["id"].as_str().unwrap_or("").to_string()); }
    state
}
pub fn record(gs: &mut GameState, before: Value) {
    let after = checkpoint(gs);
    if before != after {
        gs.undo_history.push((before, after));
        while gs.undo_history.len() > 30 || gs.undo_history.iter().map(|(a,b)|a.to_string().len()+b.to_string().len()).sum::<usize>() > 32 * 1024 * 1024 { gs.undo_history.remove(0); }
    }
}
pub fn undo(gs: &mut GameState) -> Result<String, String> {
    let (before, after) = gs.undo_history.last().cloned().ok_or("Nothing to undo")?;
    if checkpoint(gs) != after { return Err("The table changed since this action. Undo is unavailable; use a recovery snapshot.".into()); }
    let previous = crate::session::validate(&before)?;
    gs.tokens = previous.tokens;
    gs.characters = previous.characters;
    gs.enemy_instances = previous.enemy_instances;
    gs.saved_enemies = previous.saved_enemies;
    gs.combat = previous.combat;
    gs.session_extras = previous.session_extras;
    gs.measurement_shapes = previous.measurement_shapes;
    gs.undo_history.pop();
    Ok("Undid the last table action".into())
}

pub async fn recovery(snapshot: &Value, reason: &str) -> Result<String, String> {
    let name = format!("auto-{}-{}.json", chrono::Utc::now().format("%Y%m%dT%H%M%S%3f"), uuid::Uuid::new_v4());
    let mut value = snapshot.clone();
    value["recoveryReason"] = json!(reason);
    crate::session::atomic_json(&Path::new("saves/recovery").join(&name), &value).await?;
    let mut files = recovery_files().await;
    files.sort();
    let excess = files.len().saturating_sub(12);
    for file in files.into_iter().take(excess) {
        tokio::fs::remove_file(Path::new("saves/recovery").join(file)).await.map_err(|e| e.to_string())?;
    }
    Ok(name)
}
pub async fn recovery_files() -> Vec<String> {
    let mut out = vec![];
    if let Ok(mut entries) = tokio::fs::read_dir("saves/recovery").await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("auto-") && crate::session::valid_filename(&name) && entry.file_type().await.map(|t|t.is_file()).unwrap_or(false) { out.push(name); }
        }
    }
    out
}

pub fn apply(gs: &mut GameState, action: &Value, is_dm: bool, character_id: Option<&str>) -> Result<String, String> {
    let kind = action.get("kind").and_then(Value::as_str).ok_or("Missing action kind")?;
    if kind == "undo" { if !is_dm { return Err("Only the DM can undo".into()); } return undo(gs); }
    if kind == "level_up" || kind == "favorite" {
        let id=if kind=="level_up" { action["character"]["id"].as_str() } else {action["character_id"].as_str()}.ok_or("Choose a character")?;
        if !is_dm && character_id!=Some(id) {return Err("Select your own character first".into());}
        let existing=gs.characters.get(id).ok_or("Character no longer exists")?;
        let mut character=existing.clone();
        if kind=="level_up" {
            let expected=action["expected_level"].as_i64().ok_or("Missing original level")?;
            if expected!=existing.level as i64 || expected>=20 {return Err("Character level changed; reopen the level-up preview".into());}
            character=serde_json::from_value(action["character"].clone()).map_err(|_|"Invalid character")?;
            if character.level!=existing.level+1 || character.max_hp<existing.max_hp || character.current_hp<0 || character.current_hp>character.max_hp {return Err("Invalid level-up totals".into());}
            if existing.current_hp==0 {character.current_hp=0;}
        } else {
            let mut full:Value=serde_json::from_str(character.character_data.as_deref().unwrap_or("{}")).map_err(|_|"Invalid character data")?;
            let data=if full["character"].is_object(){&mut full["character"]}else{&mut full};
            if !data["gorgox"].is_object(){data["gorgox"]=json!({});}
            if !data["gorgox"]["favorites"].is_array(){data["gorgox"]["favorites"]=json!([]);}
            let name=action["name"].as_str().filter(|n|!n.is_empty()&&n.len()<150).ok_or("Choose an action")?;
            let rows=data["gorgox"]["favorites"].as_array_mut().unwrap();
            if rows.iter().any(|r|r.as_str()==Some(name)){rows.retain(|r|r.as_str()!=Some(name));}else{if rows.len()>=30{return Err("Keep at most 30 favorites".into());}rows.push(json!(name));}
            character.character_data=Some(full.to_string());
        }
        let before=checkpoint(gs);gs.update_character(character);record(gs,before);return Ok(format!("Applied {kind}"));
    }
    if ["cast","request_cast","cancel_cast","resource","rest"].contains(&kind) {
        let before=checkpoint(gs);let mut next=gs.clone();
        let result=match kind {
            "cast"=>crate::rules::cast_now(&mut next,action,is_dm,character_id),
            "request_cast"=>crate::rules::request_cast(&mut next,action,is_dm,character_id),
            "cancel_cast"=>crate::rules::cancel_cast(&mut next,action,is_dm,character_id),
            "rest"=>crate::rules::rest(&mut next,action,is_dm,character_id),
            _=>crate::rules::resource(&mut next,action,is_dm,character_id),
        }?;
        *gs=next;
        if kind=="cast"||kind=="resource"||kind=="rest"{record(gs,before);}
        return Ok(result);
    }
    if !is_dm { return Err("Only the DM can perform this table action".into()); }
    let _ = character_id;
    let before = checkpoint(gs);
    // Mutate a copy so failed batch validation cannot partially affect the session.
    let mut next = gs.clone();
    match kind {
        "vision" => {
            let map_id = action["map_id"].as_str().ok_or("Load a map first")?;
            if next.current_map.as_ref().map(|m| m.id.as_str()) != Some(map_id) { return Err("Map changed; reopen vision tools".into()); }
            crate::vision::validate(&action["settings"])?;
            if !next.session_extras["visionMaps"].is_object() { next.session_extras["visionMaps"] = json!({}); }
            if next.session_extras["visionMaps"].get(map_id).is_none() && next.session_extras["visionMaps"].as_object().unwrap().len() >= 100 { return Err("Keep vision settings for at most 100 maps".into()); }
            // Prevent one client's stale editor from overwriting another DM's wall changes.
            if let Some(expected) = action.get("expected") {
                if next.session_extras["visionMaps"].get(map_id).unwrap_or(&Value::Null) != expected { return Err("Vision changed; retry with the latest settings".into()); }
            }
            next.session_extras["visionMaps"][map_id] = action["settings"].clone();
        }
        "battlefield" => {
            let settings=&action["settings"];
            if !settings.is_object() || settings.to_string().len()>500000 {return Err("Invalid battlefield settings".into());}
            let rule=settings["diagonal"].as_str().unwrap_or("alternating");
            if !["alternating","five","euclidean"].contains(&rule){return Err("Invalid diagonal rule".into());}
            let drawings=settings["drawings"].as_array().ok_or("Invalid drawings")?;
            if drawings.len()>200 {return Err("Keep at most 200 drawings".into());}
            for d in drawings {for key in ["x","y","width","height"]{if !d[key].as_f64().map(|n|n.is_finite()&&n.abs()<100000.).unwrap_or(false){return Err("Invalid drawing coordinates".into());}}}
            next.session_extras["battlefield"]=settings.clone();
        }
        "arena" => {
            let scene=&action["scene"];
            let objects=scene["objects"].as_array().ok_or("Invalid scenery")?;
            if objects.len()>100 || scene.to_string().len()>12*1024*1024{return Err("Scenery exceeds save limit (12 MiB / 100 objects)".into());}
            for o in objects {
                if !o["asset"].as_str().map(|s|s.starts_with("data:application/octet-stream;base64,")&&s.len()<12*1024*1024).unwrap_or(false){return Err("Invalid scenery asset".into());}
                for key in ["position","rotation","scale"]{let values=o[key].as_array().ok_or("Invalid scenery transform")?;if values.len()!=3||values.iter().any(|v|!v.as_f64().map(|n|n.is_finite()&&n.abs()<100000.).unwrap_or(false)){return Err("Invalid scenery transform".into());}}
            }
            next.session_extras["arena"]=scene.clone();
        }
        "visibility" => {
            for id in action["ids"].as_array().ok_or("Choose tokens")? {
                let token=next.tokens.iter_mut().find(|t|Some(t.id.as_str())==id.as_str()).ok_or("Token no longer exists")?;
                token.hidden_from_players=action["hidden"].as_bool().ok_or("Choose visibility")?;
            }
        }
        "copy" => {
            let ids=action["ids"].as_array().filter(|a|!a.is_empty()&&a.len()<=50).ok_or("Choose 1–50 tokens")?;
            let dx=action["dx"].as_f64().filter(|n|n.is_finite()&&n.abs()<10000.).unwrap_or(2.) as f32;
            let dy=action["dy"].as_f64().filter(|n|n.is_finite()&&n.abs()<10000.).unwrap_or(2.) as f32;
            let mut seen=std::collections::HashSet::new();
            for id in ids {let id=id.as_str().ok_or("Invalid token")?;if !seen.insert(id){continue;}
                let mut token=next.tokens.iter().find(|t|t.id==id).ok_or("Token no longer exists")?.clone();
                if token.entity_type==crate::models::TokenType::Player {return Err("Player characters cannot be duplicated; select enemies or objects".into());}
                token.id=uuid::Uuid::new_v4().to_string();token.x+=dx;token.y+=dy;
                if let Some(mut enemy)=next.enemy_instances.get(&token.entity_id).cloned(){let old=enemy.id.clone();enemy.id=uuid::Uuid::new_v4().to_string();enemy.name=format!("{} copy",enemy.name);token.entity_id=enemy.id.clone();token.display_name=Some(enemy.name.clone());if let Some(mut row)=next.saved_enemies.iter().find(|e|e["id"]==old).cloned(){row["id"]=json!(enemy.id);row["name"]=json!(enemy.name);next.saved_enemies.push(row);}next.enemy_instances.insert(enemy.id.clone(),enemy);}
                next.tokens.push(token);
            }
        }
        "hp" => {
            let ids = action["ids"].as_array().ok_or("Choose targets")?;
            if ids.is_empty() || ids.len() > 100 { return Err("Choose 1–100 targets".into()); }
            let delta = action["delta"].as_i64().filter(|n| n.unsigned_abs() <= 100000).ok_or("Invalid HP amount")? as i32;
            let mut unique = std::collections::HashSet::new();
            for id in ids { let id = id.as_str().ok_or("Invalid target")?; if unique.insert(id) { next.change_hp(id, delta)?; } }
        }
        "move" => {
            let moves = action["moves"].as_array().ok_or("Choose tokens")?;
            if moves.len() > 100 { return Err("Too many tokens".into()); }
            for item in moves {
                let id = item["id"].as_str().ok_or("Invalid token")?;
                let x = item["x"].as_f64().filter(|n| n.is_finite() && n.abs() < 100000.).ok_or("Invalid position")? as f32;
                let y = item["y"].as_f64().filter(|n| n.is_finite() && n.abs() < 100000.).ok_or("Invalid position")? as f32;
                if !next.move_token(id,x,y) { return Err("Token no longer exists".into()); }
            }
        }
        "resolve_cast" => { crate::rules::resolve_cast(&mut next,action)?; }
        "concentration" => {
            let id=action["character_id"].as_str().ok_or("Choose a caster")?;
            if !action["keep"].as_bool().unwrap_or(false) {
                if let Some(rows)=next.session_extras["concentration"].as_object_mut(){rows.remove(id);}
            }
            if let Some(rows)=next.session_extras["concentrationChecks"].as_array_mut(){rows.retain(|c|c["character_id"]!=id);}
        }
        "condition" => {
            let ids = action["ids"].as_array().ok_or("Choose targets")?;
            if ids.len() > 100 { return Err("Too many targets".into()); }
            let label = action["label"].as_str().filter(|s|!s.trim().is_empty() && s.len() <= 80).ok_or("Enter a condition")?.trim();
            let remove = action["remove"].as_bool().unwrap_or(false);
            let rounds = action["rounds"].as_i64().unwrap_or(0);
            if !(0..=1000).contains(&rounds) { return Err("Invalid duration".into()); }
            if !next.session_extras["conditions"].is_object() { next.session_extras["conditions"] = json!({}); }
            for id in ids {
                let id = id.as_str().ok_or("Invalid target")?;
                if !next.tokens.iter().any(|t|t.id==id) { return Err("Token no longer exists".into()); }
                if !next.session_extras["conditions"][id].is_array() { next.session_extras["conditions"][id]=json!([]); }
                let rows = next.session_extras["conditions"][id].as_array_mut().unwrap();
                rows.retain(|c|c["label"].as_str()!=Some(label));
                if !remove { rows.push(json!({"label":label,"expiresRound":if rounds>0 {Some(next.combat.round as i64+rounds)} else {None}})); }
            }
        }
        "initiative" => {
            let ids = action["ids"].as_array().ok_or("Choose participants")?;
            let total = action["total"].as_i64().filter(|n|n.unsigned_abs()<1000).ok_or("Invalid initiative")? as i32;
            for id in ids {
                let id = id.as_str().ok_or("Invalid participant")?;
                let p = next.combat.participants.iter_mut().find(|p|p.id==id).ok_or("Start combat with these tokens first")?;
                p.initiative=total;
            }
            next.combat.sort_by_initiative();
        }
        "start_combat" => {
            let ids = action["ids"].as_array().ok_or("Choose participants")?;
            let mut participants = vec![];
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                let id = id.as_str().ok_or("Invalid token")?;
                if !seen.insert(id) { continue; }
                participants.push(participant(&next,id)?);
            }
            if participants.is_empty() { return Err("Choose at least one creature".into()); }
            next.combat.start_combat(participants);
        }
        "next_turn" => { next.combat.next_turn().ok_or("No active combat")?; expire_conditions(&mut next); }
        "end_combat" => { next.combat.end_combat(); }
        "spawn" => {
            let map = next.current_map.clone().ok_or("Load a map first")?;
            let groups = action["groups"].as_array().filter(|g|!g.is_empty()&&g.len()<=20).ok_or("Choose enemy groups")?;
            let x = action["x"].as_f64().filter(|n|n.is_finite()&&n.abs()<100000.).unwrap_or(2.) as f32;
            let y = action["y"].as_f64().filter(|n|n.is_finite()&&n.abs()<100000.).unwrap_or(2.) as f32;
            let mut index=0;
            for group in groups {
                let template = &group["template"];
                let template_id=template["id"].as_str().ok_or("Enemy template no longer exists")?;
                let count=group["count"].as_u64().filter(|n|*n>=1&&*n<=50).ok_or("Choose 1–50 enemies per group")?;
                if index+count>100 { return Err("Choose at most 100 enemies".into()); }
                let base_name=template["name"].as_str().unwrap_or("Enemy");
                let offset=next.enemy_instances.values().filter(|e|e.enemy_id==template_id).count();
                let max_hp=template["max_hp"].as_i64().filter(|n|*n>0&&*n<=100000).ok_or("Invalid template HP")? as i32;
                for number in 0..count {
                    let id=uuid::Uuid::new_v4().to_string();
                    let name=format!("{} {}",base_name,offset+number as usize+1);
                    let instance=crate::models::EnemyInstance{id:id.clone(),enemy_id:template_id.into(),name:name.clone(),current_hp:max_hp,max_hp,armor_class:template["armor_class"].as_i64().unwrap_or(10) as i32,initiative_bonus:template["initiative_bonus"].as_i64().unwrap_or(0) as i32};
                    let mut row=template.clone();row["id"]=json!(id);row["enemy_id"]=json!(template_id);row["name"]=json!(name);row["current_hp"]=json!(max_hp);
                    next.saved_enemies.push(row);
                    next.enemy_instances.insert(id.clone(),instance);
                    let token_id=uuid::Uuid::new_v4().to_string();
                    next.tokens.push(crate::models::Token{id:token_id.clone(),map_id:map.id.clone(),entity_id:id,entity_type:crate::models::TokenType::Enemy,x:x+(index%5) as f32*2.,y:y+(index/5) as f32*2.,size:1.,image_url:template["portrait_url"].as_str().map(str::to_string),display_name:Some(name),hidden_from_players:false,show_name:true});
                    if let Some(total)=group["initiative"].as_i64() {
                        if !next.session_extras["initialInitiative"].is_object() {next.session_extras["initialInitiative"]=json!({});}
                        next.session_extras["initialInitiative"][&token_id]=json!(total);
                    }
                    if next.combat.active {
                        let mut p=participant(&next,&token_id)?;
                        p.initiative=group["initiative"].as_i64().unwrap_or(0) as i32;
                        next.combat.participants.push(p);
                    }
                    index+=1;
                }
            }
            if next.combat.active { next.combat.sort_by_initiative(); }
        }
        _ => return Err("Unsupported table action".into()),
    }
    *gs = next;
    record(gs, before);
    Ok(format!("Applied {kind}"))
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn movement_undo_and_stale_guard() {
        let mut gs = GameState::new();
        gs.tokens.push(crate::models::Token {id:"token".into(),map_id:"".into(),entity_id:"object".into(),entity_type:crate::models::TokenType::Object,x:1.,y:2.,size:1.,image_url:None,display_name:None,hidden_from_players:false,show_name:true});
        apply(&mut gs, &json!({"kind":"move","moves":[{"id":"token","x":5,"y":6}]}),true,None).unwrap();
        assert_eq!(gs.tokens[0].x,5.);
        undo(&mut gs).unwrap();
        assert_eq!(gs.tokens[0].x,1.);
        apply(&mut gs, &json!({"kind":"move","moves":[{"id":"token","x":5,"y":6}]}),true,None).unwrap();
        gs.tokens.clear();
        assert!(undo(&mut gs).is_err());
    }
    #[test] fn failed_batch_is_atomic_and_player_cannot_undo() {
        let mut gs = GameState::new();
        assert!(apply(&mut gs,&json!({"kind":"hp","ids":["missing"],"delta":-5}),true,None).is_err());
        assert!(gs.undo_history.is_empty());
        assert!(apply(&mut gs,&json!({"kind":"undo"}),false,None).is_err());
    }
}

pub fn participant(gs:&GameState,id:&str)->Result<crate::models::CombatParticipant,String> {
    let t=gs.tokens.iter().find(|t|t.id==id).ok_or("Token no longer exists")?;
    let (name,hp,max_hp,ac,bonus)=if t.entity_type==crate::models::TokenType::Player {
        let c=gs.characters.get(&t.entity_id).ok_or("Character no longer exists")?;
        (c.name.clone(),c.current_hp,c.max_hp,c.armor_class,c.initiative_bonus)
    } else {
        let c=gs.enemy_instances.get(&t.entity_id).ok_or("This token is not a creature")?;
        (c.name.clone(),c.current_hp,c.max_hp,c.armor_class,c.initiative_bonus)
    };
    Ok(crate::models::CombatParticipant{id:t.id.clone(),entity_id:t.entity_id.clone(),name:t.display_name.clone().unwrap_or(name),initiative:gs.session_extras["initialInitiative"][id].as_i64().unwrap_or(0) as i32,initiative_bonus:bonus,entity_type:t.entity_type.clone(),current_hp:hp,max_hp,armor_class:ac})
}
pub fn expire_conditions(gs:&mut GameState) {
    if let Some(rows)=gs.session_extras["concentration"].as_object_mut(){rows.retain(|_,c|c["expiresRound"].as_i64().map(|r|r>gs.combat.round as i64).unwrap_or(true));}
    let turn=gs.combat.get_current_participant().map(|p|p.id.clone());
    if let Some(conditions)=gs.session_extras["conditions"].as_object_mut() {
        for rows in conditions.values_mut().filter_map(Value::as_array_mut) {
            rows.retain(|c|c["expiresRound"].as_i64().map(|r|r>gs.combat.round as i64).unwrap_or(true) && !(c["expiresTurn"].as_str()==turn.as_deref() && turn.is_some()));
        }
    }
}

#[cfg(test)] mod encounter_tests {
    use super::*;
    #[test] fn groups_have_independent_hp_and_conditions_expire() {
        let mut gs=GameState::new();
        gs.current_map=Some(crate::models::Map{id:"map".into(),name:"Map".into(),image_path:"".into(),grid_size:50,width:500,height:500,map_state:None});
        apply(&mut gs,&json!({"kind":"spawn","groups":[{"count":3,"template":{"id":"template","name":"Trooper","max_hp":20,"armor_class":12}}]}),true,None).unwrap();
        assert_eq!(gs.enemy_instances.len(),3);
        assert_eq!(gs.tokens.len(),3);
        let a=gs.tokens[0].id.clone();let b=gs.tokens[1].id.clone();
        apply(&mut gs,&json!({"kind":"hp","ids":[a],"delta":-4}),true,None).unwrap();
        assert_eq!(participant(&gs,&a).unwrap().current_hp,16);
        assert_eq!(participant(&gs,&b).unwrap().current_hp,20);
        let ids:Vec<_>=gs.tokens.iter().map(|t|t.id.clone()).collect();
        apply(&mut gs,&json!({"kind":"start_combat","ids":ids}),true,None).unwrap();
        apply(&mut gs,&json!({"kind":"condition","ids":[a],"label":"Prone","rounds":1}),true,None).unwrap();
        assert_eq!(gs.session_extras["conditions"][&a].as_array().unwrap().len(),1);
        for _ in 0..3 {apply(&mut gs,&json!({"kind":"next_turn"}),true,None).unwrap();}
        assert_eq!(gs.combat.round,2);
        assert!(gs.session_extras["conditions"][&a].as_array().unwrap().is_empty());
    }
}
