// Runs against a marked disposable session only. Uses separate browser contexts.
// Usage: node scripts/phase0-smoke.cjs SESSION_DIR PLAYWRIGHT_PACKAGE_DIR
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const session = path.resolve(process.argv[2] || '');
const { chromium } = require(process.argv[3] || 'playwright');
const base = 'http://127.0.0.1:3000';
const results = [];
const errors = [];

async function check(name, operation) {
  try { const detail = await operation(); results.push({name, status:'PASS', detail}); }
  catch (error) { results.push({name, status:'FAIL', detail: error.message}); }
  console.log(JSON.stringify(results.at(-1)));
}

async function send(page, message) {
  await page.evaluate(message => sendMessage(message), message);
}

async function connect(page, name, dm) {
  page.on('dialog', dialog => dialog.dismiss());
  page.on('pageerror', error => errors.push({client:name, message:error.message, stack:error.stack}));
  await page.goto(base, {waitUntil:'domcontentloaded'});
  await page.locator('#playerName').fill(name);
  await page.locator('#styleSelector').selectOption('starwars');
  await page.locator('#isDM').setChecked(dm);
  await page.locator('#connectionModal button').click();
  await page.waitForFunction(() => ws && ws.readyState === 1 && sessionId && characters.length > 0);
}

async function main() {
  const expectedRoot = path.resolve(__dirname, '..', 'target', 'phase0-sessions');
  assert.ok(session.startsWith(expectedRoot + path.sep), 'Session must be under target/phase0-sessions');
  const markerResponse = await fetch(base + '/static/phase0-session.json');
  const marker = JSON.parse((await markerResponse.text()).replace(/^\uFEFF/, ''));
  assert.equal(path.resolve(marker.session_root), session, 'Server must use the specified test copy');
  assert.equal(marker.purpose, 'disposable-baseline');
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const dmContext = await browser.newContext({viewport:{width:1440,height:1000}});
    const playerContext = await browser.newContext({viewport:{width:1440,height:1000}});
    const dm = await dmContext.newPage();
    let player = await playerContext.newPage();
    let savedMapState;
    await check('DM and player connect with separate browser storage', async () => {
      await connect(dm, 'Phase0 DM', true);
      await connect(player, 'Phase0 Player', false);
      assert.equal(await dm.evaluate(() => isDM), true);
      assert.equal(await player.evaluate(() => isDM), false);
      return {characters:await dm.evaluate(() => characters.length)};
    });
    const mapsPayload = await (await fetch(base + '/api/maps')).json();
    const maps = Array.isArray(mapsPayload) ? mapsPayload : mapsPayload.maps;
    const map = maps.find(m => /stone cavern/i.test(m.name)) || maps[0];
    const characterId = await dm.evaluate(() => characters[0].id);
    await check('Load copied campaign map and select player character', async () => {
      await send(dm, {type:'LoadMap',map_id:map.id,clear_tokens:true});
      await dm.waitForFunction(id => currentMap && currentMap.id === id, map.id);
      await player.waitForFunction(id => currentMap && currentMap.id === id, map.id);
      await send(dm, {type:'EndCombat'});
      await send(dm, {type:'ClearTokens'});
      await dm.waitForFunction(() => tokens.length === 0);
      await player.evaluate(id => selectCharacterForPlay(id), characterId);
      assert.equal(await player.evaluate(() => myCharacterId), characterId);
      await send(dm,{type:'SetPlayerMapViewport',enabled:false,hidden:false,x:0,y:0,width:640,height:480});
      return {map:map.name, characterId};
    });
    await check('Place player and spawn independent enemy instance', async () => {
      await send(dm,{type:'PlaceToken',entity_id:characterId,entity_type:'Player',x:2,y:2,size:1});
      await send(dm,{type:'ListEnemies'});
      await dm.waitForFunction(() => enemies.some(e => !e.isNPC && e.max_hp > 0));
      const enemyId = await dm.evaluate(() => enemies.find(e => !e.isNPC && e.max_hp > 0).id);
      await send(dm,{type:'SpawnEnemy',enemy_id:enemyId,instance_id:'phase0-enemy',name:'Phase0 Enemy 1'});
      await send(dm,{type:'PlaceToken',entity_id:'phase0-enemy',entity_type:'Enemy',x:5,y:2,size:1});
      await dm.waitForFunction(() => tokens.length === 2);
      await player.waitForFunction(() => tokens.length === 2);
      return {enemyTemplate:enemyId, tokens:2};
    });
    await check('Movement reaches the other client', async () => {
      const tokenId = await dm.evaluate(id => tokens.find(t => t.entity_id === id).id, characterId);
      await send(player,{type:'MoveToken',token_id:tokenId,x:3,y:3});
      await dm.waitForFunction(id => tokens.some(t => t.id === id && t.x === 3 && t.y === 3), tokenId);
      return {x:3,y:3};
    });
    await check('Combat starts, initiative advances, damage and healing agree', async () => {
      const tokenIds = await dm.evaluate(() => tokens.map(t => t.id));
      await send(dm,{type:'StartCombat',token_ids:tokenIds});
      await dm.waitForFunction(() => combatState.active && combatState.participants.length === 2);
      await player.waitForFunction(() => combatState.active && combatState.participants.length === 2);
      // Stop initiative prompts; test uses explicit rolls instead.
      await dm.evaluate(() => { cancelInitiativePrompt(); closeModal('initiativePromptModal'); });
      await player.evaluate(() => { cancelInitiativePrompt(); closeModal('initiativePromptModal'); });
      for(let index=0;index<tokenIds.length;index++) {
        await send(dm,{type:'RollInitiative',entity_id:tokenIds[index],participant_id:tokenIds[index],roll:20-index*10,silent:true});
      }
      const target = await dm.evaluate(() => combatState.participants.find(p => p.entity_id === 'phase0-enemy'));
      await send(dm,{type:'DealDamage',target_id:target.id,damage:2});
      await dm.waitForFunction(({id,hp}) => combatState.participants.some(p => p.id===id && p.current_hp===hp),{id:target.id,hp:Math.max(0,target.current_hp-2)});
      await send(dm,{type:'HealTarget',target_id:target.id,healing:1});
      const hp = Math.min(target.max_hp,Math.max(0,target.current_hp-2)+1);
      await player.waitForFunction(({id,hp}) => combatState.participants.some(p => p.id===id && p.current_hp===hp),{id:target.id,hp});
      await send(dm,{type:'NextTurn'});
      await player.waitForFunction(() => combatState.currentTurn !== null);
      return {targetHp:hp,currentTurn:await dm.evaluate(() => combatState.currentTurn)};
    });
    await check('Map-state save completes', async () => {
      await send(dm,{type:'SaveMap',map_id:map.id});
      await dm.waitForFunction(id => SessionSync.lastMapSaved === id, map.id);
      const database = new DatabaseSync(path.join(session,'gorgox_dnd.db'),{readOnly:true});
      try {
        savedMapState = JSON.parse(database.prepare('SELECT map_state FROM maps WHERE id=?').get(map.id).map_state);
      } finally { database.close(); }
      assert.equal(savedMapState.tokens.length,2);
      assert.equal(savedMapState.combat.active,true);
      return {mapId:map.id,tokens:savedMapState.tokens.length,currentTurn:savedMapState.combat.participants[savedMapState.combat.current_turn_index].id};
    });
    await check('Full-session JSON saves through the UI and round-trips through REST', async () => {
      await dm.evaluate(async () => {
        document.getElementById('saveFileName').value='Phase0 baseline';
        await saveGameState();
      });
      const response=await fetch(base+'/api/saves/Phase0%20baseline.json');
      assert.equal(response.status,200);
      const snapshot=await response.json();
      assert.equal(snapshot.tokens.length,2);
      assert.equal(snapshot.combatState.active,true);
      return {version:snapshot.version,tokens:snapshot.tokens.length};
    });
    await check('Player reconnect preserves the server current turn', async () => {
      const expectedTurn = await dm.evaluate(() => combatState.currentTurn);
      await player.close();
      player = await playerContext.newPage();
      await connect(player, 'Phase0 Player', false);
      await player.waitForFunction(() => ws && ws.readyState===1 && combatState.active && combatState.participants.length===2);
      await player.waitForTimeout(1500);
      const actualTurn = await player.evaluate(() => combatState.currentTurn);
      assert.equal(actualTurn,expectedTurn);
      return {expectedTurn,actualTurn};
    });
    await check('Map-state reload restores saved participants and turn', async () => {
      const before = {tokens:savedMapState.tokens.length,turn:savedMapState.combat.participants[savedMapState.combat.current_turn_index].id,ids:savedMapState.combat.participants.map(p=>p.id)};
      await send(dm,{type:'EndCombat'});
      await send(dm,{type:'ClearTokens'});
      await send(dm,{type:'LoadMap',map_id:map.id,clear_tokens:false});
      await dm.waitForFunction(() => tokens.length===2 && combatState.active);
      await dm.waitForTimeout(700);
      assert.equal(await dm.evaluate(() => combatState.currentTurn),before.turn);
      assert.deepEqual(await dm.evaluate(() => combatState.participants.map(p=>p.id).sort()),before.ids.sort());
      return before;
    });
    await check('Full-session load restores shared combat', async () => {
      await send(dm,{type:'EndCombat'});
      await send(dm,{type:'ClearTokens'});
      await dm.waitForFunction(() => !combatState.active && tokens.length===0);
      const snapshot = await (await fetch(base+'/api/saves/Phase0%20baseline.json')).json();
      await dm.evaluate(async data => { await loadGameStateFromData(data,'Phase0 baseline'); },snapshot);
      await dm.waitForTimeout(2000);
      const states = await Promise.all([dm,player].map(page=>page.evaluate(()=>({active:combatState.active,participants:combatState.participants.length,tokens:tokens.length,currentTurn:combatState.currentTurn}))));
      assert.equal(states[1].active,true,'Player combat must be restored: '+JSON.stringify(states));
      assert.equal(states[1].participants,2);
      assert.deepEqual(states[0],states[1]);
      return {dm:states[0],player:states[1]};
    });
    await dm.screenshot({path:path.join(session,'dm-baseline.png'),fullPage:true});
    await player.screenshot({path:path.join(session,'player-baseline.png'),fullPage:true});
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(session,'smoke-results.json'),JSON.stringify({results,pageErrors:errors},null,2));
  }
  process.exitCode=results.some(result=>result.status==='FAIL') ? 1 : 0;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
