/* DM-controlled, map-local sight. No character, lighting or attack rules are inferred. */
window.VisionTools=(()=>{
 const defaults=()=>({version:1,enabled:false,mode:'party',rangeFeet:120,walls:[],reveals:[],tokenOverrides:{}});
 const stored=()=>SessionSync.last?.sessionExtras?.visionMaps?.[currentMap?.id]||null;
 const settings=()=>structuredClone(stored()||defaults());
 const player=()=>typeof serverIsDm==='boolean'?!serverIsDm:!isDM;
 let cacheKey='',cached=null,builds=0,mask=null,editor=null,start=null,pending=false,consumedClick=false,editorMap=null,settingsRef=null,settingsKey='';
 function model(){
  const s=stored()||defaults(),width=(currentMap?.width||canvas?.width||1200)/gridSize,height=(currentMap?.height||canvas?.height||800)/gridSize;
  // The tabletop anchors all token sizes at the center of their placement cell.
  const sources=tokens.filter(t=>t.entity_type==='Player'&&!t.hidden_from_players&&(s.mode==='party'||t.entity_id===myCharacterId)).map(t=>({x:t.x+.5,y:t.y+.5})).filter(p=>p.x>0&&p.y>0&&p.x<width&&p.y<height);
  if(s!==settingsRef){settingsRef=s;settingsKey=JSON.stringify([s.enabled,s.mode,s.rangeFeet,s.walls,s.reveals]);}
  const key=JSON.stringify([currentMap?.id,width,height,gridSize,settingsKey,sources]);
  if(key!==cacheKey){cacheKey=key;builds++;cached={s,sources,width,height,polygons:s.enabled?sources.map(p=>VisionGeometry.polygon(p,s.walls,width,height,s.rangeFeet/5)):[]};mask=null;}
  return cached;
 }
 function pointVisible(p){const m=model();return !m.s.enabled||(p.x>=0&&p.y>=0&&p.x<=m.width&&p.y<=m.height&&(m.s.reveals.some(r=>VisionGeometry.inRect(p,r))||m.sources.some(source=>VisionGeometry.canSee(source,p,m.s.walls,m.s.rangeFeet/5))));}
 function tokenVisible(t){
  if(!player())return true;if(t.hidden_from_players)return false;
  const s=stored()||defaults();if(!s.enabled)return true;
  // Manual hiding takes priority over overrides; reveal applies to map art separately.
  if(s.tokenOverrides[t.id]===false)return false;if(s.tokenOverrides[t.id]===true)return true;
  return pointVisible({x:t.x+.5,y:t.y+.5});
 }
 function fogCanvas(){
  const m=model();if(mask)return mask;
  mask=document.createElement('canvas');mask.width=Math.ceil(m.width*gridSize);mask.height=Math.ceil(m.height*gridSize);const c=mask.getContext('2d');c.fillStyle='#050508';c.fillRect(0,0,mask.width,mask.height);c.globalCompositeOperation='destination-out';
  for(const polygon of m.polygons){c.beginPath();polygon.forEach((p,i)=>i?c.lineTo(p.x*gridSize,p.y*gridSize):c.moveTo(p.x*gridSize,p.y*gridSize));c.closePath();c.fill();}
  for(const r of m.s.reveals)c.fillRect(r.x*gridSize,r.y*gridSize,r.width*gridSize,r.height*gridSize);
  return mask;
 }
 function draw(ctx){
  const s=settings();if(player()&&s.enabled){ctx.drawImage(fogCanvas(),0,0);for(const t of tokens)if(s.tokenOverrides[t.id]===true&&tokenVisible(t))drawToken(t);}
  if(!player()){
   ctx.save();ctx.lineWidth=3/zoom;for(const w of s.walls){ctx.strokeStyle=w.kind==='door'?(w.open?'#50dc91':'#ffbc52'):'#68bdff';ctx.setLineDash(w.open?[6/zoom,6/zoom]:[]);ctx.beginPath();ctx.moveTo(w.x1*gridSize,w.y1*gridSize);ctx.lineTo(w.x2*gridSize,w.y2*gridSize);ctx.stroke();}
   ctx.setLineDash([6/zoom,4/zoom]);ctx.strokeStyle='#50dc91';for(const r of s.reveals)ctx.strokeRect(r.x*gridSize,r.y*gridSize,r.width*gridSize,r.height*gridSize);
   if(start){ctx.fillStyle='#ffbc52';ctx.beginPath();ctx.arc(start.x*gridSize,start.y*gridSize,5/zoom,0,Math.PI*2);ctx.fill();}ctx.restore();
  }
 }
 async function change(mutator){
  if(!isDM||pending)return;const map_id=currentMap?.id;if(!map_id)return status('Load a map first.');
  const expected=structuredClone(stored()),s=settings();mutator(s);pending=true;
  try{await TableTools.command({kind:'vision',map_id,settings:s,expected});status('Vision settings saved.');}catch(e){status(e.message);}finally{pending=false;refresh();}
 }
 function status(text){const el=document.getElementById('visionStatus');if(el)el.textContent=text;}
 function cancel(){editor=null;start=null;editorMap=null;status('Wall placement canceled.');renderCanvas();}
 function begin(kind){if(!isDM||!currentMap)return status('Load a map first.');editor=kind;editorMap=currentMap.id;start=null;status('Click two endpoints on the map. Escape cancels.');}
 function mapClick(e){
  if(!isDM||!editor||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();consumedClick=true;
  if(currentMap?.id!==editorMap){cancel();return;}
  const p=clientToWorld(e.clientX,e.clientY),point={x:Math.round(p.mouseX/gridSize*2)/2,y:Math.round(p.mouseY/gridSize*2)/2};
  if(!start){start=point;status('Click the second endpoint.');renderCanvas();return;}
  if(start.x===point.x&&start.y===point.y){status('Choose a different second endpoint.');return;}
  const first=start,kind=editor;editor=null;start=null;change(s=>s.walls.push({id:crypto.randomUUID(),kind,open:false,x1:first.x,y1:first.y,x2:point.x,y2:point.y}));
 }
 function refresh(){
  const panel=document.getElementById('visionTools');if(!panel)return;panel.hidden=!isDM;
  const s=settings();for(const [id,value] of [['visionEnabled',s.enabled],['visionMode',s.mode],['visionRange',s.rangeFeet]]){const el=document.getElementById(id);if(document.activeElement!==el){if(el.type==='checkbox')el.checked=value;else el.value=value;}}
  const list=document.getElementById('visionWallList');list.replaceChildren();
  s.walls.forEach((w,i)=>{const row=document.createElement('div');row.className='table-tools-row';const label=document.createElement('span');label.textContent=`${w.kind==='door'?'Door':'Wall'} ${i+1}: (${w.x1}, ${w.y1}) → (${w.x2}, ${w.y2})`;row.append(label);if(w.kind==='door'){const b=document.createElement('button');b.textContent=w.open?'Close door':'Open door';b.onclick=()=>change(s=>{const door=s.walls.find(x=>x.id===w.id);if(door)door.open=!door.open;});row.append(b);}const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>change(s=>s.walls=s.walls.filter(x=>x.id!==w.id));row.append(remove);list.append(row);});
  const safe=!(player()&&s.enabled);document.querySelectorAll('[onclick*="toggle3DArena"]').forEach(b=>{b.disabled=!safe;b.title=safe?'':'Automatic sight uses the 2D map; ask the DM to disable it for 3D.';});
  if(!safe){const arena=document.getElementById('arena3D');if(arena&&!arena.classList.contains('hidden'))window.toggle3DArena?.();}
 }
 function mount(){
  const parent=document.getElementById('battlefieldTools');if(!parent)return;const panel=document.createElement('details');panel.id='visionTools';panel.innerHTML=`<summary>Walls &amp; line of sight</summary><label><input type="checkbox" id="visionEnabled"> Automatic line of sight</label><label>Player vision <select id="visionMode"><option value="party">Shared party vision</option><option value="character">Selected character only</option></select></label><label>Sight range (ft) <input type="number" id="visionRange" min="5" max="1000" step="5" value="120"></label><p>Walls block sight. Open doors allow sight. Movement, attacks and lighting remain DM-controlled.</p><div class="table-tools-row"><button id="visionDrawWall">Draw wall</button><button id="visionDrawDoor">Draw door</button><button id="visionCancel">Cancel placement</button></div><input id="visionCoordinates" aria-label="Wall endpoints" placeholder="x1,y1,x2,y2 (grid units)"><button id="visionAddCoordinates">Add wall by coordinates</button><div id="visionWallList"></div><p>Manual reveal rectangle (grid units)</p><input id="visionRevealRect" aria-label="Sight reveal rectangle" placeholder="x,y,width,height"><button id="visionReveal">Reveal rectangle</button><button id="visionClearReveals">Clear reveals</button><p>Selected tokens</p><div class="table-tools-row"><button id="visionForceReveal">Always reveal</button><button id="visionAutomatic">Use automatic sight</button></div><p id="visionStatus" role="status">Automatic sight starts off. Settings are saved per map; DM undo applies.</p><p>Player automatic sight is available in 2D. Disable it to use the player 3D view.</p>`;parent.append(panel);
  panel.querySelector('#visionEnabled').onchange=e=>change(s=>s.enabled=e.target.checked);
  panel.querySelector('#visionMode').onchange=e=>change(s=>s.mode=e.target.value);
  panel.querySelector('#visionRange').onchange=e=>change(s=>s.rangeFeet=Number(e.target.value));
  panel.querySelector('#visionDrawWall').onclick=()=>begin('wall');panel.querySelector('#visionDrawDoor').onclick=()=>begin('door');panel.querySelector('#visionCancel').onclick=cancel;
  const numbers=id=>{const raw=document.getElementById(id).value.split(',').map(x=>x.trim());return raw.length===4&&raw.every(x=>x!==''&&Number.isFinite(Number(x)))?raw.map(Number):null;};
  panel.querySelector('#visionAddCoordinates').onclick=()=>{const a=numbers('visionCoordinates');if(!a)return status('Enter four finite coordinates.');const [x1,y1,x2,y2]=a;change(s=>s.walls.push({id:crypto.randomUUID(),kind:'wall',open:false,x1,y1,x2,y2}));};
  panel.querySelector('#visionReveal').onclick=()=>{const a=numbers('visionRevealRect');if(!a)return status('Enter x,y,width,height.');const [x,y,width,height]=a;change(s=>s.reveals.push({x,y,width,height}));};panel.querySelector('#visionClearReveals').onclick=()=>change(s=>s.reveals=[]);
  panel.querySelector('#visionForceReveal').onclick=()=>change(s=>{for(const id of EncounterTools.ids())s.tokenOverrides[id]=true;});panel.querySelector('#visionAutomatic').onclick=()=>change(s=>{for(const id of EncounterTools.ids())delete s.tokenOverrides[id];});
  const map=document.getElementById('mapCanvas');map?.addEventListener('mousedown',mapClick,true);map?.addEventListener('mouseup',e=>{if(consumedClick){e.preventDefault();e.stopImmediatePropagation();}},true);map?.addEventListener('click',e=>{if(consumedClick){consumedClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&editor){cancel();e.preventDefault();}});refresh();
 }
 document.addEventListener('DOMContentLoaded',mount);document.addEventListener('gorgox:session',()=>{if(editor&&currentMap?.id!==editorMap)cancel();refresh();});
 return {settings,tokenVisible,pointVisible,draw,change,begin,cancel,player3dAllowed:()=>!(player()&&settings().enabled),get cacheBuilds(){return builds;}};
})();
