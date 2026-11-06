//! Verified SW5E effects, immediate casting and shared roll records.
use crate::{game_state::GameState, models::Character};
use serde_json::{json,Value};

pub fn point_cost(level:i32)->Result<i32,String>{if !(0..=9).contains(&level){Err("Choose a casting level from 0 to 9".into())}else{Ok(if level==0{0}else{level+1})}}
fn full(c:&Character)->Result<Value,String>{serde_json::from_str(c.character_data.as_deref().unwrap_or("{}")).map_err(|_|"Character data is invalid".into())}
fn data(v:&Value)->&Value{v.get("character").unwrap_or(v)}
fn data_mut(v:&mut Value)->&mut Value{if v.get("character").is_some(){&mut v["character"]}else{v}}
fn mod_score(score:i32)->i32{(score-10).div_euclid(2)}
fn engineer_level(c:&Character,d:&Value)->i32{
    d["classes"].as_array().map(|cs|cs.iter().filter(|cl|cl["name"].as_str().unwrap_or("").to_lowercase().starts_with("engineer")).map(|cl|cl["levels"].as_i64().or(cl["level"].as_i64()).unwrap_or(c.level as i64) as i32).sum()).unwrap_or(if c.class.to_lowercase().contains("engineer"){c.level}else{0})
}
fn attribute(d:&Value,name:&str)->Option<i32>{d["attribs"].as_array()?.iter().find(|a|a["name"].as_str()==Some(name))?["current"].as_i64().map(|n|n as i32).or_else(||d["attribs"].as_array()?.iter().find(|a|a["name"].as_str()==Some(name))?["current"].as_str()?.parse().ok())}
pub fn points(c:&Character,pool:&str)->Result<(i32,i32),String>{
    let v=full(c)?;let d=data(&v);let key=format!("{pool}Points");
    let max=d[&key]["max"].as_i64().map(|n|n as i32).or_else(||attribute(d,&format!("{pool}_power_points_total"))).unwrap_or_else(||if pool=="tech"&&engineer_level(c,d)>0{engineer_level(c,d)*2+mod_score(c.intelligence)}else{0}).max(0);
    let spent=d[&key]["_expended"].as_i64().map(|n|n as i32).or_else(||attribute(d,&format!("{pool}_power_points_expended"))).unwrap_or(0);
    let current=d[&key]["current"].as_i64().map(|n|n as i32).unwrap_or(max-spent).clamp(0,max);
    Ok((max,current))
}
fn set_points(c:&mut Character,pool:&str,current:i32)->Result<(),String>{
    let (max,_)=points(c,pool)?;let mut v=full(c)?;let d=data_mut(&mut v);
    if !d.is_object(){return Err("Character sheet is invalid".into());}
    d[format!("{pool}Points")]=json!({"max":max,"current":current.clamp(0,max),"_expended":max-current.clamp(0,max)});
    if let Some(attrs)=d["attribs"].as_array_mut(){for a in attrs{if a["name"]==format!("{pool}_power_points_expended"){a["current"]=json!(max-current.clamp(0,max));}}}
    c.character_data=Some(v.to_string());Ok(())
}
fn has_power(d:&Value,name:&str,pool:&str)->bool{
    let list=format!("{pool}Powers");let details=format!("{pool}PowerDetails");
    let find=|d:&Value|[&list,&details].iter().any(|key|d[*key].as_array().map(|rows|rows.iter().any(|p|p.as_str().or(p["name"].as_str()).or(p["Name"].as_str()).map(|n|n.eq_ignore_ascii_case(name)).unwrap_or(false))).unwrap_or(false));
    find(d)||d["classes"].as_array().map(|cs|cs.iter().any(find)).unwrap_or(false)
}
fn die(sides:i32)->i32{
    loop{let bytes=*uuid::Uuid::new_v4().as_bytes();let n=u32::from_le_bytes([bytes[0],bytes[1],bytes[2],bytes[3]]);let limit=u32::MAX-u32::MAX%(sides as u32);if n<limit{return (n%(sides as u32)) as i32+1;}}
}
fn dice(count:i32,sides:i32)->i32{(0..count).map(|_|die(sides)).sum()}
fn power_level(v:&Value)->Option<i32>{let raw=v["level"].as_str().unwrap_or("");if raw.eq_ignore_ascii_case("at-will"){Some(0)}else{raw.parse().ok().or(v["level"].as_i64().map(|n|n as i32))}}
fn target_stats(gs:&GameState,id:&str)->Result<(i32,i32,i32),String>{
    let p=crate::table::participant(gs,id)?;let t=gs.tokens.iter().find(|t|t.id==id).unwrap();
    let dex=if let Some(c)=gs.characters.get(&t.entity_id){
        let value=full(c)?;let d=data(&value);
        let proficient=d["saving_throw_proficiencies"].as_array().map(|xs|xs.iter().any(|a|a.as_str().map(|s|["dex","dexterity"].contains(&s.to_lowercase().as_str())).unwrap_or(false))).unwrap_or(false);
        mod_score(c.dexterity)+if proficient{c.proficiency_bonus}else{0}
    }else{gs.saved_enemies.iter().find(|e|e["id"]==t.entity_id).and_then(|e|e["dexterity"].as_i64()).map(|n|mod_score(n as i32)).unwrap_or(0)};
    Ok((p.current_hp,p.armor_class,dex))
}
pub fn request_cast(gs:&mut GameState,a:&Value,is_dm:bool,owned:Option<&str>)->Result<String,String>{
    let cid=a["character_id"].as_str().ok_or("Choose a caster")?;
    if !is_dm&&owned!=Some(cid){return Err("You can cast only with your selected character".into());}
    let c=gs.characters.get(cid).ok_or("Caster no longer exists")?.clone();let v=full(&c)?;let d=data(&v);
    let pool=a["pool"].as_str().filter(|s|["tech","force"].contains(s)).ok_or("Choose tech or force")?;
    let power=&a["power"];let name=power["name"].as_str().ok_or("This power is not in the bundled compendium. Resolve it manually on the sheet.")?;
    if !is_dm&&!has_power(d,name,pool){return Err("This character does not know that power".into());}
    let base=power_level(power).ok_or("Power level is unavailable; use manual resource controls")?;
    let level=i32::try_from(a["level"].as_i64().unwrap_or(base as i64)).map_err(|_|"Invalid casting level")?;
    if level<base||(base==0&&level!=0){return Err("Invalid casting level".into());}
    let maximum=if pool=="tech"&&engineer_level(&c,d)>0{((engineer_level(&c,d)+1)/2).min(9)}else{d["gorgox"]["powerLimits"][pool].as_i64().unwrap_or(base as i64) as i32};
    if level>maximum&&!is_dm{return Err(format!("Maximum casting level for this character is {maximum}"));}
    let cost=point_cost(level)?;let (_,current)=points(&c,pool)?;
    if current<cost{return Err(format!("Not enough {pool} points: need {cost}, have {current}"));}
    let high_key=format!("{pool}:{level}");
    if level>=6&&d["gorgox"]["casting"]["highLevelUsed"].as_array().map(|r|r.contains(&json!(high_key))).unwrap_or(false){return Err("This casting level has already been used; take a long rest first".into());}
    let caster=gs.tokens.iter().find(|t|t.entity_id==cid&&t.entity_type==crate::models::TokenType::Player).ok_or("Place your caster on the map first")?.clone();
    let supported=pool=="tech"&&["Electroshock","Explosion","Kolto Pack"].contains(&name);
    let mut target_ids=vec![];
    if name=="Explosion"&&supported{
        let center=&a["center"];let x=center["x"].as_f64().filter(|n|n.is_finite()).ok_or("Choose the area center")?;let y=center["y"].as_f64().filter(|n|n.is_finite()).ok_or("Choose the area center")?;
        if ((caster.x as f64-x).powi(2)+(caster.y as f64-y).powi(2)).sqrt()*5.>150.{return Err("Area center is beyond 150 feet".into());}
        target_ids=gs.tokens.iter().filter(|t|t.entity_type!=crate::models::TokenType::Object&&((t.x as f64-x).powi(2)+(t.y as f64-y).powi(2)).sqrt()*5.<=20.).map(|t|t.id.clone()).collect();
    }else{
        for id in a["ids"].as_array().ok_or("Choose targets")?{let id=id.as_str().ok_or("Invalid target")?;if !target_ids.contains(&id.to_string()){target_ids.push(id.to_string());}}
        if supported&&target_ids.len()!=1{return Err("Choose exactly one creature".into());}
    }
    if target_ids.is_empty()||target_ids.len()>100{return Err("Choose 1–100 creatures".into());}
    let ability=if pool=="tech"{mod_score(c.intelligence)}else{mod_score(c.wisdom).max(mod_score(c.charisma))};
    let dc=8+c.proficiency_bonus+ability;let attack_bonus=c.proficiency_bonus+ability;
    let damage=if name=="Explosion"&&supported{dice(8+(level-3),6)}else if name=="Kolto Pack"&&supported{(dice(level,4)+ability).max(0)}else{0};
    let mut targets=vec![];
    for id in target_ids {
        let t=gs.tokens.iter().find(|t|t.id==id).ok_or("Target no longer exists")?;
        if t.hidden_from_players&&!is_dm&&name!="Explosion"{return Err("This target is not visible".into());}
        let (hp,ac,dex)=target_stats(gs,&id)?;
        let mut roll=0;let mut total=0;let mut delta=0;let mut outcome="Special effects recorded for manual tracking".to_string();
        if supported{
            let range=if name=="Electroshock"{5.}else if name=="Kolto Pack"{60.}else{f64::INFINITY};
            if (caster.x-t.x).abs().max((caster.y-t.y).abs()) as f64*5.>range{return Err("Target is out of range".into());}
            if name=="Electroshock"{
                roll=die(20);if a["advantage"].as_bool().unwrap_or(false){roll=roll.max(die(20));}total=roll+attack_bonus;
                let hit=attack_hits(roll,total,ac);let count=1+if c.level>=17{3}else if c.level>=11{2}else if c.level>=5{1}else{0};
                if hit{delta=-dice(if roll==20{count*2}else{count},8);}
                outcome=format!("Attack {roll} + {attack_bonus} = {total} vs AC {ac}: {}{}",if hit{"hit"}else{"miss"},if roll==20{" (critical)"}else{""});
            }else if name=="Explosion"{
                roll=die(20);total=roll+dex;delta=-save_damage(damage,total>=dc);
                outcome=format!("DEX save {roll} + {dex} = {total} vs DC {dc}: {}. Review save proficiency and resistances.",if total>=dc{"success, half damage"}else{"failed"});
            }else{
                let kind=gs.saved_enemies.iter().find(|e|e["id"]==t.entity_id).and_then(|e|e["creature_type"].as_str()).unwrap_or("").to_lowercase();
                let species=gs.characters.get(&t.entity_id).and_then(|c|full(c).ok()).map(|v|data(&v)["species"].to_string().to_lowercase()).unwrap_or_default();
                if kind.contains("droid")||kind.contains("construct")||species.contains("droid"){return Err("Kolto Pack does not affect droids or constructs".into());}
                delta=damage;outcome=format!("Healing {level}d4 + {ability} = {damage}");
            }
        }
        let p=crate::table::participant(gs,&id)?;
        targets.push(json!({"id":id,"name":p.name,"hp":hp,"x":t.x,"y":t.y,"roll":roll,"total":total,"delta":delta,"outcome":outcome,"hidden":t.hidden_from_players,"shocked":supported&&name=="Electroshock"&&delta<0}));
    }
    let cast_id=uuid::Uuid::new_v4().to_string();
    let preview=json!({"id":cast_id,"character_id":cid,"caster":c.name,"casterX":caster.x,"casterY":caster.y,"name":name,"pool":pool,"level":level,"cost":cost,"supported":supported,"targets":targets,"power":power,"dc":dc,"createdAt":chrono::Utc::now().to_rfc3339()});
    if !gs.session_extras["pendingCasts"].is_array(){gs.session_extras["pendingCasts"]=json!([]);}
    let rows=gs.session_extras["pendingCasts"].as_array_mut().unwrap();
    if rows.len()>=20&&a["kind"]!="cast"{return Err("Resolve or cancel existing power previews first".into());}rows.push(preview);
    Ok("Power preview sent to the DM; no points or HP changed".into())
}
pub fn attack_hits(natural:i32,total:i32,ac:i32)->bool{natural==20||(natural!=1&&total>=ac)}
fn effect_roll(power:&Value,level:i32,c:&Character,pool:&str)->Option<String>{
    let part=power["casting"]["damage_parts"].as_array()?.first()?;
    let ability=if pool=="tech"{mod_score(c.intelligence)}else{mod_score(c.wisdom).max(mod_score(c.charisma))};
    let raw=part[0].as_str()?.replace("@mod",&ability.to_string()).replace(' ',"").replace("+-","-");
    let pos=raw.find('d')?;let count:i32=raw[..pos].parse().ok()?;
    let end=raw[pos+1..].find(|ch:char|!ch.is_ascii_digit()).map(|n|pos+1+n).unwrap_or(raw.len());
    let sides:i32=raw[pos+1..end].parse().ok()?;
    let bonus=if end==raw.len(){0}else{raw[end..].parse::<i32>().ok()?};
    let scaling=&power["casting"]["scaling"];
    let mut count=count;
    if scaling["mode"]=="cantrip"{count*=1+if c.level>=17{3}else if c.level>=11{2}else if c.level>=5{1}else{0};}
    else if scaling["mode"]=="level"&&level>power_level(power)?{
        let extra=scaling["formula"].as_str()?.split_once('d')?;
        if extra.1.parse::<i32>().ok()?!=sides{return None;}
        count+=(level-power_level(power)?)*extra.0.parse::<i32>().ok()?;
    }
    if !(1..=100).contains(&count)||!(2..=1000).contains(&sides){return None;}
    Some(format!("Effect roll (manual application): {count}d{sides}{bonus:+} {} = {}",part[1].as_str().unwrap_or(""),dice(count,sides)+bonus))
}
pub fn cast_now(gs:&mut GameState,a:&Value,is_dm:bool,owned:Option<&str>)->Result<String,String>{
    request_cast(gs,a,is_dm,owned)?;
    let preview=gs.session_extras["pendingCasts"].as_array().unwrap().last().unwrap().clone();
    let supported=preview["supported"].as_bool().unwrap_or(false);
    let effects:Vec<Value>=if supported{preview["targets"].as_array().unwrap().iter().map(|t|json!({"id":t["id"],"delta":t["delta"],"applyCondition":t["shocked"]})).collect()}else{vec![]};
    resolve_cast(gs,&json!({"cast_id":preview["id"],"effects":effects}))?;
    let mut lines=vec![format!("{} casts {} at level {} — {} {} points",preview["caster"].as_str().unwrap(),preview["name"].as_str().unwrap(),preview["level"],preview["cost"],preview["pool"].as_str().unwrap())];
    for t in preview["targets"].as_array().unwrap().iter().filter(|t|!t["hidden"].as_bool().unwrap_or(false)){
        lines.push(format!("{}: {}{}",t["name"].as_str().unwrap_or("Target"),t["outcome"].as_str().unwrap_or(""),if supported{format!("; {:+} HP",t["delta"].as_i64().unwrap_or(0))}else{String::new()}));
    }
    if !supported {
        if let Some(roll)=effect_roll(&preview["power"],preview["level"].as_i64().unwrap() as i32,&gs.characters[preview["character_id"].as_str().unwrap()],preview["pool"].as_str().unwrap()) {lines.push(roll);}
    }
    let text=lines.join("\n");
    gs.push_log_entry(crate::models::LogHistoryEntry{id:format!("cast-{}",preview["id"].as_str().unwrap()),pane:"rolls".into(),message:text.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('\n',"<br>"),entry_type:Some("power".into()),is_nat20:false,is_nat1:false});
    Ok(format!("Cast {} — spent {} {} points",preview["name"].as_str().unwrap(),preview["cost"],preview["pool"].as_str().unwrap()))
}
pub fn save_damage(damage:i32,succeeded:bool)->i32{if succeeded{damage/2}else{damage}}
pub fn resolve_cast(gs:&mut GameState,a:&Value)->Result<String,String>{
    let cast_id=a["cast_id"].as_str().ok_or("Choose a power preview")?;
    let preview=gs.session_extras["pendingCasts"].as_array().and_then(|rows|rows.iter().find(|c|c["id"]==cast_id)).cloned().ok_or("This preview was already resolved or canceled")?;
    let cid=preview["character_id"].as_str().unwrap();let pool=preview["pool"].as_str().unwrap().to_string();let cost=preview["cost"].as_i64().unwrap() as i32;let level=preview["level"].as_i64().unwrap() as i32;
    let c=gs.characters.get(cid).ok_or("Caster no longer exists")?;let (_,current)=points(c,&pool)?;if current<cost{return Err("Not enough points; this cast has not been applied".into());}
    let caster=gs.tokens.iter().find(|t|t.entity_id==cid).ok_or("Caster no longer exists")?;
    if json!(caster.x)!=preview["casterX"]||json!(caster.y)!=preview["casterY"]{return Err("Caster moved after preview. Cancel and preview again.".into());}
    let high_key=format!("{pool}:{level}");let v=full(c)?;
    if level>=6&&data(&v)["gorgox"]["casting"]["highLevelUsed"].as_array().map(|r|r.contains(&json!(high_key))).unwrap_or(false){return Err("This casting level has already been used".into());}
    let effects=a["effects"].as_array().ok_or("Review target effects")?;let mut seen=std::collections::HashSet::new();
    for effect in effects{
        let id=effect["id"].as_str().ok_or("Invalid target")?;
        if !seen.insert(id){return Err("Duplicate target effect".into());}
        let original=preview["targets"].as_array().unwrap().iter().find(|t|t["id"]==id).ok_or("Target was not in the preview")?;
        let t=gs.tokens.iter().find(|t|t.id==id).ok_or("Target no longer exists")?;let (hp,_,_)=target_stats(gs,id)?;
        if json!(t.x)!=original["x"]||json!(t.y)!=original["y"]||json!(hp)!=original["hp"]{return Err("A target changed after preview. Cancel and preview again.".into());}
        effect["delta"].as_i64().filter(|n|n.unsigned_abs()<=100000).ok_or("Invalid effect amount")?;
    }
    let c=gs.characters.get_mut(cid).unwrap();set_points(c,&pool,current-cost)?;
    if level>=6{let mut v=full(c)?;let d=data_mut(&mut v);if !d["gorgox"].is_object(){d["gorgox"]=json!({});}if !d["gorgox"]["casting"].is_object(){d["gorgox"]["casting"]=json!({});}if !d["gorgox"]["casting"]["highLevelUsed"].is_array(){d["gorgox"]["casting"]["highLevelUsed"]=json!([]);}d["gorgox"]["casting"]["highLevelUsed"].as_array_mut().unwrap().push(json!(high_key));c.character_data=Some(v.to_string());}
    for effect in effects{
        let id=effect["id"].as_str().unwrap();let delta=effect["delta"].as_i64().unwrap() as i32;gs.change_hp(id,delta)?;
        let original=preview["targets"].as_array().unwrap().iter().find(|t|t["id"]==id).unwrap();
        if original["shocked"].as_bool().unwrap_or(false)&&delta<0&&effect["applyCondition"].as_bool().unwrap_or(true){
            if !gs.session_extras["conditions"].is_object(){gs.session_extras["conditions"]=json!({});}
            if !gs.session_extras["conditions"][id].is_array(){gs.session_extras["conditions"][id]=json!([]);}
            let rows=gs.session_extras["conditions"][id].as_array_mut().unwrap();rows.retain(|c|c["label"]!="Shocked");rows.push(json!({"label":"Shocked","expiresTurn":id,"source":cast_id}));
        }
    }
    let requires_concentration=preview["power"]["concentration"].as_bool().unwrap_or(false)||preview["power"]["concentration"].as_str().map(|s|s.to_lowercase().contains("concentration")).unwrap_or(false);
    if requires_concentration {
        if !gs.session_extras["concentration"].is_object(){gs.session_extras["concentration"]=json!({});}
        let rounds=a["concentrationRounds"].as_i64().unwrap_or(0).clamp(0,10000);
        gs.session_extras["concentration"][cid]=json!({"name":preview["name"],"source":cast_id,"expiresRound":if rounds>0{Some(gs.combat.round as i64+rounds)}else{None}});
    }
    gs.session_extras["pendingCasts"].as_array_mut().unwrap().retain(|c|c["id"]!=cast_id);
    if !gs.session_extras["recentCasts"].is_array(){gs.session_extras["recentCasts"]=json!([]);}
    let mut result=preview;result["effects"]=json!(effects);let rows=gs.session_extras["recentCasts"].as_array_mut().unwrap();rows.push(result);if rows.len()>20{rows.remove(0);}
    Ok(format!("Resolved power: spent {cost} {pool} points, applied {} reviewed effects",effects.len()))
}
pub fn cancel_cast(gs:&mut GameState,a:&Value,is_dm:bool,owned:Option<&str>)->Result<String,String>{let id=a["cast_id"].as_str().ok_or("Choose a preview")?;let rows=gs.session_extras["pendingCasts"].as_array_mut().ok_or("No pending casts")?;let row=rows.iter().find(|c|c["id"]==id).ok_or("Preview already resolved or canceled")?;if !is_dm&&row["character_id"].as_str()!=owned{return Err("You can cancel only your own preview".into());}rows.retain(|c|c["id"]!=id);Ok("Canceled power preview; no points or HP changed".into())}
pub fn resource(gs:&mut GameState,a:&Value,is_dm:bool,owned:Option<&str>)->Result<String,String>{let id=a["character_id"].as_str().ok_or("Choose a character")?;if !is_dm&&owned!=Some(id){return Err("You can change only your own resources".into());}let pool=a["pool"].as_str().filter(|s|["tech","force"].contains(s)).ok_or("Choose tech or force points")?;let c=gs.characters.get_mut(id).ok_or("Character no longer exists")?;let (max,current)=points(c,pool)?;let delta=a["delta"].as_i64().filter(|n|n.unsigned_abs()<=1000).ok_or("Invalid point change")? as i32;set_points(c,pool,(current+delta).clamp(0,max))?;Ok(format!("{pool} points: {}/{}",(current+delta).clamp(0,max),max))}

pub fn rest(gs:&mut GameState,a:&Value,is_dm:bool,owned:Option<&str>)->Result<String,String>{
    let id=a["character_id"].as_str().ok_or("Choose a character")?;
    if !is_dm&&owned!=Some(id){return Err("You can rest only your selected character".into());}
    let long=a["long"].as_bool().unwrap_or(false);
    let c=gs.characters.get_mut(id).ok_or("Character no longer exists")?;
    let (max,_)=points(c,"tech")?;set_points(c,"tech",max)?;
    if long {
        let (max,_)=points(c,"force")?;set_points(c,"force",max)?;
        let mut v=full(c)?;let d=data_mut(&mut v);
        if d["gorgox"]["casting"].is_object(){d["gorgox"]["casting"]["highLevelUsed"]=json!([]);}
        c.character_data=Some(v.to_string());
    }
    Ok(if long{"Long rest: restored power points and high-level casts"}else{"Short rest: restored tech points"}.into())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn casting_costs_critical_and_half_damage(){
        assert_eq!(point_cost(0).unwrap(),0);assert_eq!(point_cost(1).unwrap(),2);assert_eq!(point_cost(3).unwrap(),4);assert!(point_cost(10).is_err());
        assert!(attack_hits(20,20,99));assert!(!attack_hits(1,99,10));assert!(attack_hits(12,18,18));assert_eq!(save_damage(9,true),4);assert_eq!(save_damage(9,false),9);
    }
}

#[cfg(test)] mod resolution_tests {
    use super::*;
    fn fixture()->GameState{
        let mut gs=GameState::new();
        let c=Character{id:"caster".into(),name:"Engineer".into(),player_name:"Player".into(),class:"Engineer".into(),level:5,max_hp:30,current_hp:30,armor_class:14,initiative_bonus:2,strength:10,dexterity:14,constitution:12,intelligence:16,wisdom:10,charisma:10,speed:30,proficiency_bonus:3,character_data:Some(json!({"classes":[{"name":"Engineer","levels":5}],"techPowers":["Electroshock","Kolto Pack","Explosion"],"techPoints":{"max":13,"current":13,"_expended":0}}).to_string()),portrait_url:None};
        gs.characters.insert(c.id.clone(),c);
        gs.tokens.push(crate::models::Token{id:"source".into(),entity_id:"caster".into(),map_id:"".into(),entity_type:crate::models::TokenType::Player,x:2.,y:2.,size:1.,image_url:None,display_name:None,hidden_from_players:false,show_name:true});
        gs.enemy_instances.insert("enemy".into(),crate::models::EnemyInstance{id:"enemy".into(),enemy_id:"template".into(),name:"Trooper".into(),current_hp:10,max_hp:20,armor_class:14,initiative_bonus:1});
        gs.tokens.push(crate::models::Token{id:"target".into(),entity_id:"enemy".into(),map_id:"".into(),entity_type:crate::models::TokenType::Enemy,x:3.,y:2.,size:1.,image_url:None,display_name:None,hidden_from_players:false,show_name:true});gs
    }
    #[test] fn immediate_cast_spends_applies_logs_and_undoes_as_one_action(){
        let mut gs=fixture();
        let action=json!({"kind":"cast","character_id":"caster","pool":"tech","level":3,"ids":["target"],"power":{"name":"Kolto Pack","level":"1"}});
        crate::table::apply(&mut gs,&action,false,Some("caster")).unwrap();
        assert_eq!(points(&gs.characters["caster"],"tech").unwrap().1,9);
        assert!(gs.enemy_instances["enemy"].current_hp>10);
        assert!(gs.session_extras["pendingCasts"].as_array().unwrap().is_empty());
        assert_eq!(gs.session_extras["recentCasts"].as_array().unwrap().len(),1);
        assert_eq!(gs.log_history.last().unwrap().pane,"rolls");
        assert!(gs.log_history.last().unwrap().message.contains("Healing 3d4"));
        crate::table::undo(&mut gs).unwrap();assert_eq!(points(&gs.characters["caster"],"tech").unwrap().1,13);assert_eq!(gs.enemy_instances["enemy"].current_hp,10);
    }
    #[test] fn immediate_cast_failure_is_atomic_and_special_effects_need_no_approval(){
        let mut gs=fixture();let action=json!({"kind":"cast","character_id":"caster","pool":"tech","level":1,"ids":["target"],"power":{"name":"Kolto Pack","level":"1"}});
        let before=crate::table::checkpoint(&gs);assert!(crate::table::apply(&mut gs,&action,false,Some("other")).is_err());assert_eq!(crate::table::checkpoint(&gs),before);
        set_points(gs.characters.get_mut("caster").unwrap(),"tech",0).unwrap();let before=crate::table::checkpoint(&gs);assert!(crate::table::apply(&mut gs,&action,false,Some("caster")).is_err());assert_eq!(crate::table::checkpoint(&gs),before);assert!(gs.log_history.is_empty());
        set_points(gs.characters.get_mut("caster").unwrap(),"tech",13).unwrap();
        crate::table::apply(&mut gs,&json!({"kind":"cast","character_id":"caster","pool":"tech","level":2,"ids":["target"],"power":{"name":"Special power","level":"1","description":"A special effect happens.","concentration":"Concentration","casting":{"damage_parts":[["1d6 + @mod","fire"]],"scaling":{"mode":"level","formula":"1d6"}}}}),true,None).unwrap();
        assert_eq!(points(&gs.characters["caster"],"tech").unwrap().1,10);assert_eq!(gs.enemy_instances["enemy"].current_hp,10);
        assert!(gs.session_extras["pendingCasts"].as_array().unwrap().is_empty());assert!(gs.session_extras["concentration"]["caster"].is_object());
        assert!(gs.log_history.last().unwrap().message.contains("2d6+3"));
        assert!(!gs.log_history.last().unwrap().message.contains("A special effect happens."));
    }
    #[test] fn paid_cast_cancel_commit_insufficient_and_undo(){
        let mut gs=fixture();let action=json!({"kind":"request_cast","character_id":"caster","pool":"tech","level":1,"ids":["target"],"power":{"name":"Kolto Pack","level":"1"}});
        crate::table::apply(&mut gs,&action,false,Some("caster")).unwrap();
        assert_eq!(points(&gs.characters["caster"],"tech").unwrap().1,13);assert_eq!(gs.enemy_instances["enemy"].current_hp,10);
        let id=gs.session_extras["pendingCasts"][0]["id"].clone();
        crate::table::apply(&mut gs,&json!({"kind":"cancel_cast","cast_id":id}),false,Some("caster")).unwrap();assert_eq!(points(&gs.characters["caster"],"tech").unwrap().1,13);
        crate::table::apply(&mut gs,&action,false,Some("caster")).unwrap();let id=gs.session_extras["pendingCasts"][0]["id"].clone();
        let resolve=json!({"kind":"resolve_cast","cast_id":id,"effects":[{"id":"target","delta":5}]});
        assert!(crate::table::apply(&mut gs,&resolve,false,Some("caster")).is_err());
        crate::table::apply(&mut gs,&resolve,true,None).unwrap();assert_eq!(points(&gs.characters["caster"],"tech").unwrap().1,11);assert_eq!(gs.enemy_instances["enemy"].current_hp,15);
        assert!(crate::table::apply(&mut gs,&resolve,true,None).is_err());
        crate::table::undo(&mut gs).unwrap();assert_eq!(points(&gs.characters["caster"],"tech").unwrap().1,13);assert_eq!(gs.enemy_instances["enemy"].current_hp,10);
        set_points(gs.characters.get_mut("caster").unwrap(),"tech",0).unwrap();assert!(crate::table::apply(&mut gs,&action,false,Some("caster")).is_err());
    }
    #[test] fn free_cast_range_ownership_and_stale_preview(){
        let mut gs=fixture();set_points(gs.characters.get_mut("caster").unwrap(),"tech",0).unwrap();
        let action=json!({"kind":"request_cast","character_id":"caster","pool":"tech","level":0,"ids":["target"],"power":{"name":"Electroshock","level":"At-will"}});
        assert!(crate::table::apply(&mut gs,&action,false,Some("other")).is_err());crate::table::apply(&mut gs,&action,false,Some("caster")).unwrap();assert_eq!(gs.session_extras["pendingCasts"][0]["cost"],0);
        let id=gs.session_extras["pendingCasts"][0]["id"].clone();gs.tokens[1].x=20.;let before=crate::table::checkpoint(&gs);
        assert!(crate::table::apply(&mut gs,&json!({"kind":"resolve_cast","cast_id":id,"effects":[{"id":"target","delta":-5}]}),true,None).is_err());assert_eq!(crate::table::checkpoint(&gs),before);
    }
    #[test] fn high_level_slots_need_long_rest_and_concentration_requires_review(){
        let mut gs=fixture();
        let c=gs.characters.get_mut("caster").unwrap();c.level=17;let mut value=full(c).unwrap();data_mut(&mut value)["classes"][0]["levels"]=json!(17);c.character_data=Some(value.to_string());
        let request=json!({"kind":"request_cast","character_id":"caster","pool":"tech","level":6,"ids":["target"],"power":{"name":"Manual Shield","level":"6","concentration":"Concentration"}});
        crate::table::apply(&mut gs,&request,true,None).unwrap();let id=gs.session_extras["pendingCasts"][0]["id"].clone();
        crate::table::apply(&mut gs,&json!({"kind":"resolve_cast","cast_id":id,"effects":[],"concentrationRounds":2}),true,None).unwrap();
        assert!(gs.session_extras["concentration"]["caster"].is_object());
        gs.change_hp("source",-22).unwrap();assert_eq!(gs.session_extras["concentrationChecks"][0]["dc"],11);
        crate::table::apply(&mut gs,&json!({"kind":"rest","character_id":"caster","long":false}),false,Some("caster")).unwrap();
        assert!(crate::table::apply(&mut gs,&request,true,None).unwrap_err().contains("already been used"));
        crate::table::apply(&mut gs,&json!({"kind":"rest","character_id":"caster","long":true}),false,Some("caster")).unwrap();
        assert!(crate::table::apply(&mut gs,&request,true,None).is_ok());
        gs.change_hp("source",-99).unwrap();assert!(gs.session_extras["concentration"]["caster"].is_null());
    }

}
