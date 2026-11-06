/* Shared sheet/action calculations; explicit imported overrides take precedence. */
(function(root){
 'use strict';
 const mod=n=>Math.floor((Number(n??10)-10)/2);
 function score(d,c,key,name){return d.baseAbilityScores?.[name]??d.abilities?.[key]?.score??c[key==='str'?'strength':key==='dex'?'dexterity':key==='int'?'intelligence':key]??10;}
 function points(d,c,pool){
  const stored=d[pool+'Points'];let max,current,spent=0;
  if(stored?.max!=null){max=Number(stored.max);current=stored.current;spent=Number(stored._expended)||0;}
  else{for(const a of d.attribs||[]){if(a.name===pool+'_power_points_total')max=Number(a.current||a.max);if(a.name===pool+'_power_points_expended')spent=Number(a.current||a.max)||0;}}
  if(max==null){const level=Array.isArray(d.classes)?d.classes.filter(x=>/^engineer/i.test(x.name||'')).reduce((n,x)=>n+Number(x.levels??x.level??c.level??0),0):/engineer/i.test(c.class||'')?Number(c.level||0):0;max=pool==='tech'&&level?Math.max(0,2*level+mod(score(d,c,'int','Intelligence'))):0;}
  max=Math.max(0,Number(max)||0);return {max,current:Math.max(0,Math.min(max,Number(current??max-spent)||0))};
 }
 function equipment(d,c,weapons,armor,arm){
  const dex=mod(score(d,c,'dex','Dexterity')),str=mod(score(d,c,'str','Strength')),pb=Number(d.proficiency_bonus??c.proficiency_bonus??2);
  const attacks=(d.attacks||[]).filter(a=>a&&!a.from_equipment).map(a=>({...a}));const used=new Set(attacks.map(a=>a.name?.toLowerCase()));
  let body=null,shield=0;const notes=[];
  for(const item of d.equipment||[]){if(!item?.equipped)continue;const key=String(item.name||'').toLowerCase(),w=item.rules||weapons[key],a=item.armorRules||armor[key];
   if(w&&!used.has(key)){
    used.add(key);const props=String(w.properties||'').toLowerCase(),type=String(w.type||'').toLowerCase();
    const ability=props.includes('finesse')?Math.max(str,dex):type.includes('blaster')||type.includes('disruptor')||props.includes('dexterity')?dex:str;
    const ids=arm?.equippedIds||[],lv=(d.classes||[]).filter(x=>/engineer/i.test(x.name||'')).reduce((n,x)=>n+Number(x.levels||0),0);
    const matching=arm?.weaponType&&(type.includes(arm.weaponType))&&!!arm.weaponName&&arm.weaponName.toLowerCase()===key;
    const bonus=lv>=13?3:lv>=9?2:lv>=5?1:0;
    const hitMod=matching&&ids.includes(type.includes('blaster')?'accuracy-focus':'contoured-grip')?bonus:0;
    const dmgMod=matching&&ids.includes(type.includes('blaster')?'amplifying-barrel':'neutronium-edge')?bonus:0;
    const damage=String(w.damage||'').match(/(\d+d\d+)(?:\s*([+-])\s*(\d+))?/i);const add=ability+dmgMod+(damage?.[3]?Number(damage[3])*(damage[2]==='-'?-1:1):0);
    attacks.push({name:item.name,to_hit:item.toHitOverride??(ability+(item.proficient===false?0:pb)+hitMod),damage:item.damageOverride??((damage?.[1]||'0')+(add?`${add>0?'+':''}${add}`:'')),type:String(w.damage||'').replace(damage?.[0]||'','').trim(),range:item.rangeOverride??(props.match(/range\s+(\d+\/\d+)/)?.[1]||''),from_equipment:true,explanation:`Ability ${ability}; proficiency ${item.proficient===false?0:pb}; modification ${hitMod}. Damage ability ${ability}, modification ${dmgMod}.`});
   }
   if(a){const ac=String(a.ac||''),type=String(a.type||'').toLowerCase();if(type.includes('shield'))shield=Math.max(shield,Number(ac.match(/\+(\d+)/)?.[1]||0));else{const base=Number(ac.match(/\d+/)?.[0]);if(base){const cap=ac.match(/max\s*(\d+)/i);const value=base+(/dex/i.test(ac)?Math.min(dex,cap?Number(cap[1]):dex):0);body=body===null?value:Math.max(body,value);}}}
  }
  const ac=Number(d.tweaks?.armorClass?.override??((body??10+dex)+shield));notes.push(`AC: ${body===null?'10 + Dexterity '+dex:'armor '+body} + shield ${shield}${d.tweaks?.armorClass?.override!=null?' (manual override)':''}. Shields do not stack.`);
  return {attacks,ac,explanation:notes.join(' ')};
 }
 const api={points,equipment,mod};root.CharacterRules=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
