const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
const base='http://127.0.0.1:3000',results=[];
(async()=>{
 const marker=await(await fetch(base+'/static/phase0-session.json')).json();assert.equal(marker.purpose,'disposable-baseline');
 const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  async function join(){await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#playerName').fill('Action bar verification');await page.locator('#isDM').uncheck();await page.locator('#styleSelector').selectOption('starwars');await page.locator('#connectionModal button').click();await page.waitForFunction(()=>sessionId&&characters.length);await page.evaluate(()=>{selectCharacterForPlay(characters.find(c=>c.name==='Zasto').id);closeModal('characterManagerModal');});await page.locator('#playerActionBar').waitFor({state:'visible'});}
  await join();assert.equal(await page.evaluate(()=>isDM),false);
  const height=()=>page.locator('#playerActionBar').evaluate(e=>e.getBoundingClientRect().height);
  async function resize(selector,dy,refresh=false){const box=await page.locator(selector).boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+dy,{steps:8});if(refresh)await page.evaluate(()=>{populatePlayerActionBar();applyPlayerActionBarHeight();});await page.mouse.up();await page.waitForTimeout(100);}
  await page.locator('#actionDockResetBtn').click();const h0=await height();await resize('#actionDockResizeGrip',-100,true);assert.equal(Math.round(await height()-h0),100);results.push('Docked resize grip enlarges during action-bar refresh');
  await resize('#actionDockResizeGrip',60);assert.equal(Math.round(await height()-h0),40);results.push('Docked resize grip shrinks');
  await resize('#actionDockResizeEdge',-40);assert.equal(Math.round(await height()-h0),80);const saved=await height();results.push('Top edge enlarges');
  await join();assert.equal(Math.round(await height()),Math.round(saved));results.push('Height survives reload');
  let before=await page.locator('#playerActionBar').boundingBox();let grip=await page.locator('#actionDockDragHandle').boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2-90,{steps:8});await page.mouse.up();await page.waitForTimeout(100);let after=await page.locator('#playerActionBar').boundingBox();assert.equal(Math.round(before.y-after.y),90);assert.equal(Math.round(before.height),Math.round(after.height));results.push('Docked header detaches and moves vertically');
  before=after;await resize('#actionDockResizeEdge',-40);after=await page.locator('#playerActionBar').boundingBox();assert.equal(Math.round(after.height-before.height),40);assert.equal(Math.round(before.y-after.y),40);results.push('Floating top edge resizes while holding bottom edge');
  await page.setViewportSize({width:800,height:800});await page.waitForTimeout(100);before=await page.locator('#playerActionBar').boundingBox();await resize('#actionDockResizeGrip',-40);after=await page.locator('#playerActionBar').boundingBox();assert.equal(Math.round(after.height-before.height),40);results.push('Narrow-screen grip resizes');
  await page.evaluate(()=>{document.querySelector('#actionDockResizeGrip').outerHTML=document.querySelector('#actionDockResizeGrip').outerHTML;ActionDock.init();});await resize('#actionDockResizeGrip',40);assert.equal(Math.round(await height()),Math.round(before.height));results.push('Rebuilt controls rebind');
  await page.locator('#actionDockResetBtn').click();before=await page.locator('#playerActionBar').boundingBox();await resize('#actionDockDragHandle',-70);after=await page.locator('#playerActionBar').boundingBox();assert.equal(Math.round(before.y-after.y),70);assert.equal(Math.round(before.height),Math.round(after.height));assert.equal(await page.evaluate(()=>ActionDock.getState().mode),'floating');results.push('Narrow-screen dock detaches and moves');
  const movedY=after.y;await join();after=await page.locator('#playerActionBar').boundingBox();assert.equal(Math.round(after.y),Math.round(movedY));results.push('Moved position survives reload');
  assert.equal(errors.length,0,JSON.stringify(errors));await page.screenshot({path:path.join(marker.session_root,'action-dock-player.png')});console.log(JSON.stringify({status:'PASS',checks:results,pageErrors:errors}));
  fs.writeFileSync(path.join(marker.session_root,'action-dock-results.json'),JSON.stringify({status:'PASS',checks:results,pageErrors:errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
