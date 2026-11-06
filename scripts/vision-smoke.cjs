// Only runs against a marked disposable campaign copy.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[3]||'playwright');
const root=path.resolve(process.argv[2]||''),base='http://127.0.0.1:3000',results=[],errors=[];
async function check(name,fn){try{results.push({name,status:'PASS',detail:await fn()});}catch(e){results.push({name,status:'FAIL',detail:e.stack});}console.log(JSON.stringify(results.at(-1)));}
async function connect(page,name,dm){page.on('dialog',d=>d.dismiss());page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#playerName').fill(name);await page.locator('#styleSelector').selectOption('starwars');await page.locator('#isDM').setChecked(dm);await page.locator('#connectionModal button').click();await page.waitForFunction(()=>ws?.readyState===1&&sessionId&&characters.length);}
async function main(){
 const marker=JSON.parse((await(await fetch(base+'/static/phase0-session.json')).text()).replace(/^\uFEFF/,''));assert.equal(marker.purpose,'disposable-baseline');assert.equal(path.resolve(marker.session_root),root);assert(root.startsWith(path.resolve(__dirname,'../target/phase0-sessions')+path.sep));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const dm=await(await browser.newContext()).newPage(),player=await(await browser.newContext()).newPage();await connect(dm,'Vision DM',true);await connect(player,'Vision Player',false);
 const maps=await(await fetch(base+'/api/maps')).json(),map=(Array.isArray(maps)?maps:maps.maps)[0];assert(map);
 await dm.evaluate(id=>sendMessage({type:'LoadMap',map_id:id,clear_tokens:true}),map.id);await dm.waitForFunction(id=>currentMap?.id===id,map.id,{timeout:60000});
 const ids=await dm.evaluate(()=>characters.slice(0,2).map(c=>c.id));assert.equal(ids.length,2);await player.evaluate(id=>selectCharacterForPlay(id),ids[0]);
 await dm.evaluate(({ids,map})=>{const s=structuredClone(SessionSync.last);s.currentMap={...s.currentMap,width:800,height:600,grid_size:50};s.combatState={active:false,participants:[],currentTurn:null,round:1};s.tokens=[{id:'vision-pc-a',map_id:map,entity_id:ids[0],entity_type:'Player',x:2,y:2,size:1,image_url:null,display_name:'Vision source',hidden_from_players:false,show_name:true},{id:'vision-target',map_id:map,entity_id:'vision-object',entity_type:'Object',x:8,y:2,size:1,image_url:null,display_name:'Behind wall',hidden_from_players:false,show_name:true}];s.sessionExtras.visionMaps={};s.sessionExtras.arena={version:1,objects:[]};s.measurementShapes=[];s.playerMapViewport={enabled:false,hidden:false,x:0,y:0,width:800,height:600};return SessionSync.restore(s);},{ids,map:map.id});
 await player.waitForFunction(()=>tokens.some(t=>t.id==='vision-target')&&currentMap.width===800);await dm.locator('#battlefieldTools summary').first().click();await dm.locator('#visionTools summary').click();
 await check('DM can toggle sight; closed wall hides map pixels and target on player',async()=>{
  await dm.locator('#visionCoordinates').fill('6,0,6,12');await dm.locator('#visionAddCoordinates').click();await dm.waitForFunction(()=>VisionTools.settings().walls.length===1);await dm.waitForFunction(()=>document.getElementById('visionStatus').textContent==='Vision settings saved.');
  await dm.locator('#visionEnabled').check();await player.waitForFunction(()=>VisionTools.settings().enabled&& !isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  assert.equal(await dm.evaluate(()=>isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target'))),true);
  const pixel=await player.evaluate(()=>{renderCanvas();const x=Math.round(8.5*gridSize*zoom+panX),y=Math.round(2.5*gridSize*zoom+panY);return [...ctx.getImageData(x,y,1,1).data];});assert.deepEqual(pixel,[5,5,8,255]);return {targetHidden:true,fogPixel:pixel};
 });
 await check('Opening a door reveals sight; closing and undo synchronize',async()=>{
  await dm.evaluate(()=>VisionTools.change(s=>s.walls[0].kind='door'));await dm.locator('#visionWallList button').first().click();await player.waitForFunction(()=>VisionTools.settings().walls[0].open&&isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  await dm.waitForFunction(()=>document.getElementById('visionStatus').textContent==='Vision settings saved.');await dm.locator('#visionWallList button').first().click();await player.waitForFunction(()=>!VisionTools.settings().walls[0].open&&!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  await dm.evaluate(()=>TableTools.command({kind:'undo'}));await player.waitForFunction(()=>VisionTools.settings().walls[0].open&&isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));await dm.evaluate(()=>VisionTools.change(s=>s.walls[0].open=false));return 'Door open/close and undo agree';
 });
 await check('DM chooses shared party or selected-character vision',async()=>{
  await dm.evaluate(({id,map})=>{const s=structuredClone(SessionSync.last);s.tokens.push({id:'vision-pc-b',map_id:map,entity_id:id,entity_type:'Player',x:10,y:2,size:1,image_url:null,display_name:'Other party member',hidden_from_players:false,show_name:true});return SessionSync.restore(s);},{id:ids[1],map:map.id});await player.waitForFunction(()=>tokens.length===3&&isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  await dm.locator('#visionMode').selectOption('character');await player.waitForFunction(()=>VisionTools.settings().mode==='character'&&!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  await player.evaluate(id=>selectCharacterForPlay(id),ids[1]);await player.waitForFunction(()=>isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));await player.evaluate(id=>selectCharacterForPlay(id),ids[0]);await player.waitForFunction(()=>!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));return 'Both modes and character switching work';
 });
 await check('Manual reveals work; explicit token hiding keeps precedence',async()=>{
  await dm.locator('#visionRevealRect').fill('8,2,1,1');await dm.locator('#visionReveal').click();await player.waitForFunction(()=>VisionTools.settings().reveals.length===1&&isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  await dm.evaluate(()=>TableTools.command({kind:'visibility',ids:['vision-target'],hidden:true}));await player.waitForFunction(()=>tokens.find(t=>t.id==='vision-target').hidden_from_players&&!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  await dm.evaluate(()=>TableTools.command({kind:'visibility',ids:['vision-target'],hidden:false}));await dm.locator('#visionClearReveals').click();await player.waitForFunction(()=>VisionTools.settings().reveals.length===0&&!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));
  await dm.evaluate(()=>VisionTools.change(s=>s.tokenOverrides['vision-target']=true));await player.waitForFunction(()=>isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));await dm.evaluate(()=>VisionTools.change(s=>delete s.tokenOverrides['vision-target']));await player.waitForFunction(()=>!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));return 'Map reveal, token override and explicit hide priorities pass';
 });
 await check('Invalid, stale and player edits reject without changing sight',async()=>{
  const original=await dm.evaluate(()=>VisionTools.settings());
  assert.equal(await player.evaluate(s=>TableTools.command({kind:'vision',map_id:currentMap.id,settings:s}).then(()=>false,()=>true),original),true);
  assert.equal(await dm.evaluate(s=>TableTools.command({kind:'vision',map_id:currentMap.id,settings:{...s,rangeFeet:0}}).then(()=>false,()=>true),original),true);
  assert.equal(await dm.evaluate(s=>TableTools.command({kind:'vision',map_id:'wrong-map',settings:s}).then(()=>false,()=>true),original),true);
  assert.equal(await dm.evaluate(s=>TableTools.command({kind:'vision',map_id:currentMap.id,settings:s,expected:null}).then(()=>false,()=>true),original),true);
  assert.deepEqual(await dm.evaluate(()=>VisionTools.settings()),original);
  const invalid=await dm.evaluate(()=>{const s=structuredClone(SessionSync.last);s.sessionExtras.visionMaps[currentMap.id].walls.push({...s.sessionExtras.visionMaps[currentMap.id].walls[0]});return s;});assert.equal(await dm.evaluate(s=>SessionSync.restore(s).then(()=>false,()=>true),invalid),true);assert.deepEqual(await player.evaluate(()=>VisionTools.settings()),original);return 'Player, stale, invalid geometry and invalid restore rejected';
 });
 await check('Unrelated HP changes reuse geometry; moving a source updates sight',async()=>{
  const before=await player.evaluate(()=>{renderCanvas();return VisionTools.cacheBuilds;});await dm.evaluate(()=>TableTools.command({kind:'hp',ids:['vision-pc-a'],delta:-1}));await player.evaluate(()=>SessionSync.capture());assert.equal(await player.evaluate(()=>{renderCanvas();return VisionTools.cacheBuilds;}),before);
  await dm.evaluate(()=>TableTools.command({kind:'move',moves:[{id:'vision-pc-a',x:7,y:2}]}));await player.waitForFunction(()=>tokens.find(t=>t.id==='vision-pc-a').x===7&&isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));assert(await player.evaluate(()=>VisionTools.cacheBuilds)>before);await dm.evaluate(()=>TableTools.command({kind:'move',moves:[{id:'vision-pc-a',x:2,y:2}]}));await player.waitForFunction(()=>!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));return 'HP uses cached polygons; movement rebuilds';
 });
 await check('Wall placement consumes map clicks and Escape cancels',async()=>{
  const count=await dm.evaluate(()=>VisionTools.settings().walls.length);await dm.locator('#visionDrawWall').click();const coords=await dm.evaluate(()=>({x:panX+3*gridSize*zoom,y:panY+5*gridSize*zoom}));const box=await dm.locator('#mapCanvas').boundingBox();await dm.mouse.click(box.x+coords.x,box.y+coords.y);await dm.keyboard.press('Escape');assert.equal(await dm.evaluate(()=>VisionTools.settings().walls.length),count);
  await dm.locator('#visionDrawDoor').click();await dm.mouse.click(box.x+coords.x,box.y+coords.y);await dm.mouse.click(box.x+coords.x+gridOffset(),box.y+coords.y);await dm.waitForFunction(n=>VisionTools.settings().walls.length===n+1,count);assert.equal(await dm.evaluate(()=>VisionTools.settings().walls.at(-1).kind),'door');return 'Two endpoint clicks save a door; canceled wall is absent';
 });
 await check('Save/restore, refresh and map-local defaults preserve visibility',async()=>{
  const saved=await dm.evaluate(()=>SessionSync.capture());await dm.evaluate(()=>VisionTools.change(s=>s.enabled=false));await player.waitForFunction(()=>!VisionTools.settings().enabled&&isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));assert.equal(await player.evaluate(()=>VisionTools.player3dAllowed()),true);
  await dm.evaluate(s=>SessionSync.restore(s),saved);await player.waitForFunction(()=>VisionTools.settings().enabled&&!isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target')));assert.equal(await player.evaluate(()=>VisionTools.player3dAllowed()),false);
  await player.reload({waitUntil:'domcontentloaded'});await player.locator('#playerName').fill('Vision Player');await player.locator('#styleSelector').selectOption('starwars');await player.locator('#isDM').uncheck();await player.locator('#connectionModal button').click();await player.waitForFunction(()=>SessionSync.last&&myCharacterId&&tokens.some(t=>t.id==='vision-target'));assert.equal(await player.evaluate(()=>isTokenVisibleToViewer(tokens.find(t=>t.id==='vision-target'))),false);
  await dm.evaluate(()=>{const s=structuredClone(SessionSync.last);s.currentMap.id='vision-other-map';s.tokens.forEach(t=>t.map_id='vision-other-map');return SessionSync.restore(s);});await player.waitForFunction(()=>currentMap.id==='vision-other-map'&&!VisionTools.settings().enabled);
  await dm.evaluate(s=>SessionSync.restore(s),saved);await player.waitForFunction(()=>VisionTools.settings().enabled);await dm.screenshot({path:path.join(root,'vision-dm.png')});await player.screenshot({path:path.join(root,'vision-player.png')});return 'Restore, reconnect and per-map settings pass';
 });
 function gridOffset(){return 50;}
 }finally{await browser.close();fs.writeFileSync(path.join(root,'vision-results.json'),JSON.stringify({results,pageErrors:errors},null,2));}
 assert.equal(errors.length,0,'Page errors');assert.equal(results.filter(r=>r.status==='FAIL').length,0,'Sight checks failed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
