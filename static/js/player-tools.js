/* Favorites and connection feedback stay outside panels rebuilt by live updates. */
window.PlayerTools=(()=>{
 let status,panel,signature='';
 function render(){
  if(!panel)return;const c=characters.find(c=>c.id===myCharacterId)||(isDM&&selectedToken?.entity_type==='Player'?characters.find(c=>c.id===selectedToken.entity_id):null);
  if(!c){panel.hidden=true;return;}panel.hidden=false;
  let d;try{const full=JSON.parse(c.character_data||'{}');d=full.character||full;}catch{d={};}
  const attacks=recomputeEquipmentBonuses(d,c).attacks;
  const powers=[...[...(d.techPowers||[]),...(d.classes||[]).flatMap(c=>c.techPowers||[])].map(p=>({name:typeof p==='string'?p:p.name,pool:'tech'})),...[...(d.forcePowers||[]),...(d.classes||[]).flatMap(c=>c.forcePowers||[])].map(p=>({name:typeof p==='string'?p:p.name,pool:'force'}))];
  const favorites=d.gorgox?.favorites||[];const next=JSON.stringify([c.id,favorites,attacks,powers]);if(signature===next)return;signature=next;
  panel.replaceChildren();const title=document.createElement('strong');title.textContent='Quick actions · '+c.name;panel.append(title);
  for(const name of favorites){const a=attacks.find(a=>a.name===name),p=powers.find(p=>p.name===name);if(!a&&!p)continue;const b=document.createElement('button');b.textContent='★ '+name;b.title=a?.explanation||'Choose a target, then preview the cast';b.onclick=()=>a?requestAttackTarget(a.name,a.to_hit,a.damage,a.type,c.name,attackRangeForRequest(a.range)):requestPowerTarget(p.pool,p.name,c.name);panel.append(b);}
  const picker=document.createElement('select');picker.setAttribute('aria-label','Favorite action');const empty=document.createElement('option');empty.value='';empty.textContent='Add / remove favorite…';picker.append(empty);
  for(const name of [...new Set([...attacks.map(a=>a.name),...powers.map(p=>p.name)])]){const o=document.createElement('option');o.value=name;o.textContent=(favorites.includes(name)?'★ ':'')+name;picker.append(o);}
  picker.onchange=()=>{if(picker.value)TableTools.report(TableTools.command({kind:'favorite',character_id:c.id,name:picker.value}));};panel.append(picker);
 }
 function mount(){status=document.createElement('div');status.id='tableConnection';status.setAttribute('role','status');document.body.append(status);panel=document.createElement('section');panel.id='playerQuickActions';document.body.append(panel);render();setInterval(()=>{const open=typeof ws!=='undefined'&&ws?.readyState===WebSocket.OPEN;status.textContent=open?'● Connected · '+(isDM?'DM':myPlayerName||'Player'):'○ Reconnecting — changes need an acknowledged connection';status.classList.toggle('offline',!open);},1000);}
 document.addEventListener('DOMContentLoaded',mount);document.addEventListener('gorgox:session',render);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancelTargeting();cancelPowerTargeting();document.querySelector('.power-dialog')?.close();}});
 return {render};
})();
