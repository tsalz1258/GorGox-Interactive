const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
const base='http://127.0.0.1:3000',out=path.resolve('target/meshy-batch/20261003T173407Z');
(async()=>{
 const marker=await(await fetch(base+'/static/phase0-session.json')).json();assert.equal(marker.purpose,'disposable-baseline');
 const manifest=await(await fetch(base+'/static/meshy-gallery/manifest.json')).json();
 const available=await(await fetch(base+'/api/saves')).json();
 for(const e of manifest.saves)assert(available.saves.some(s=>s.filename===e.file),'Save not listed: '+e.file);
 const all=await(await fetch(base+'/api/saves/'+encodeURIComponent(manifest.saves[0].file))).json();
 const group=await(await fetch(base+'/api/saves/'+encodeURIComponent(manifest.saves[1].file))).json();
 const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[];let original,page;
 try{
  page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('dialog',d=>d.dismiss());page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.text().includes('Token model load failed'))errors.push(m.text());});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#playerName').fill('Gallery verification');await page.locator('#isDM').check();await page.locator('#styleSelector').selectOption('starwars');await page.locator('#connectionModal button').click();await page.waitForFunction(()=>ws?.readyState===1&&SessionSync.last);
  original=await page.evaluate(()=>SessionSync.capture());
  await page.evaluate(save=>loadGameStateFromData(save,'Gallery verification'),all);
  const summary=await page.evaluate(()=>({tokens:tokens.length,models:getBattlefieldSnapshotForArena3d().tokens.length}));assert.equal(summary.tokens,manifest.unique_enemies);assert.equal(summary.models,manifest.unique_enemies);
  await page.evaluate(save=>loadGameStateFromData(save,'Gallery group verification'),group);
  const urls=await page.evaluate(()=>getBattlefieldSnapshotForArena3d().tokens.map(t=>t.stlUrl));assert.equal(urls.length,8);
  const fetched=urls.map(url=>page.waitForResponse(r=>r.url().split('?')[0]===new URL(url,base).href&&r.status()===200,{timeout:120000}));
  await page.evaluate(()=>{closeModal('characterManagerModal');toggle3DArena();});
  const responses=await Promise.all(fetched);await Promise.all(responses.map(r=>r.finished()));await page.waitForTimeout(10000);
  await page.screenshot({path:path.join(out,'gallery-group-render.png')});assert.equal(errors.length,0,JSON.stringify(errors));
  fs.writeFileSync(path.join(out,'gallery-smoke-results.json'),JSON.stringify({status:'PASS',allEnemies:summary.tokens,allModelLinksResolved:summary.models,savesListed:manifest.saves.length,groupModelsFetched:responses.length,pageErrors:errors},null,2));
  console.log(JSON.stringify({status:'PASS',allEnemies:summary.tokens,groupModelsFetched:responses.length,savesListed:manifest.saves.length}));
 }finally{
  if(page&&original)await page.evaluate(async save=>{if(document.querySelector('#arena3dModal')?.classList.contains('active'))toggle3DArena();await SessionSync.restore(save);},original);
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
