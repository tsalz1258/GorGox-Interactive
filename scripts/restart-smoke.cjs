// Two stages, with the guarded disposable-server restart performed between them.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),mode=process.argv[3],base='http://127.0.0.1:3000';
(async()=>{const marker=await(await fetch(base+'/static/phase0-session.json')).json();assert.equal(marker.purpose,'disposable-baseline');assert.equal(path.resolve(marker.session_root),root);
 const socket=new WebSocket(base.replace('http','ws')+'/ws');let latest=null;const waiters=[];
 function wait(predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Restart check response timed out')),60000);waiters.push({predicate,resolve:m=>{clearTimeout(timer);resolve(m);}});});}
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='SessionState')latest=m.snapshot;for(let i=waiters.length-1;i>=0;i--)if(waiters[i].predicate(m)){const item=waiters.splice(i,1)[0];item.resolve(m);}});
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let ready=wait(m=>m.type==='SessionState');socket.send(JSON.stringify({type:'Connect',player_name:'Restart verification',is_dm:true,style:'starwars'}));await ready;
 const filename=path.join(root,'restart-expected.json');
 try{if(mode==='prepare'){
   assert(latest.currentMap);const saved=wait(m=>m.type==='MapSaved');socket.send(JSON.stringify({type:'SaveMap',map_id:latest.currentMap.id}));await saved;
   const capture=wait(m=>m.type==='SessionState'||m.type==='SessionUnchanged');socket.send(JSON.stringify({type:'RequestFullState'}));await capture;fs.writeFileSync(filename,JSON.stringify(latest));console.log('Prepared saved session and restart comparison');
 }else{
   const expected=JSON.parse(fs.readFileSync(filename,'utf8'));
   for(const c of expected.characters){const actual=latest.characters.find(a=>a.id===c.id);assert(actual);assert.equal(actual.current_hp,c.current_hp);assert.equal(actual.max_hp,c.max_hp);assert.equal(actual.character_data,c.character_data);}
   const loaded=wait(m=>m.type==='SessionState'&&m.snapshot.currentMap?.id===expected.currentMap.id);socket.send(JSON.stringify({type:'LoadMap',map_id:expected.currentMap.id,clear_tokens:false}));await loaded;
   const capture=wait(m=>m.type==='SessionState'||m.type==='SessionUnchanged');socket.send(JSON.stringify({type:'RequestFullState'}));await capture;
   for(const key of ['tokens','combatState','sessionExtras','measurementShapes','campaignNotes'])assert.deepEqual(latest[key],expected[key]);
   const result={status:'PASS',characterHpAndResourcesSurviveRestart:true,savedSessionRestoresCombatTokensAndExtras:true,savedMapLoadedAfterRestart:true,characters:expected.characters.length,tokens:expected.tokens.length};fs.writeFileSync(path.join(root,'restart-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }}finally{socket.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
