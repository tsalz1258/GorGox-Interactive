// Restore database characters into the live gallery session, retaining its map/tokens.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const base='http://127.0.0.1:3000';
(async()=>{
 const marker=await(await fetch(base+'/static/phase0-session.json')).json();assert.equal(marker.purpose,'disposable-baseline');
 const root=path.resolve(marker.session_root);assert(root.startsWith(path.resolve('target/phase0-sessions')+path.sep));
 const db=new DatabaseSync(path.join(root,'gorgox_dnd.db'),{readOnly:true});
 const party=db.prepare('SELECT * FROM characters ORDER BY name').all();db.close();assert.equal(party.length,9);
 const socket=new WebSocket(base.replace('http','ws')+'/ws');let latest;const waiters=[];
 function wait(predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Restore response timed out')),20000);waiters.push({predicate,resolve:m=>{clearTimeout(timer);resolve(m);}});});}
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.type==='SessionState')latest=m.snapshot;for(let i=waiters.length-1;i>=0;i--)if(waiters[i].predicate(m)){const item=waiters.splice(i,1)[0];item.resolve(m);}});
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 try{
  const connected=wait(m=>m.type==='SessionState');socket.send(JSON.stringify({type:'Connect',player_name:'Character restoration',is_dm:true,style:'starwars'}));await connected;
  const before=structuredClone(latest);fs.writeFileSync(path.join(root,'before-character-restoration.json'),JSON.stringify(before));
  const existing=new Map((before.characters||[]).map(c=>[c.id,c]));for(const c of party)if(!existing.has(c.id))existing.set(c.id,c);
  const snapshot={...before,characters:[...existing.values()]};const request_id=crypto.randomUUID();
  const restored=wait(m=>m.type==='SessionRestored'&&m.request_id===request_id);
  socket.send(JSON.stringify({type:'RestoreSession',snapshot,request_id}));await restored;
  const captured=wait(m=>m.type==='SessionState'||m.type==='SessionUnchanged');socket.send(JSON.stringify({type:'RequestFullState'}));await captured;
  for(const c of party){const actual=latest.characters.find(a=>a.id===c.id);assert(actual,c.name);assert.equal(actual.character_data,existing.get(c.id).character_data);}
  assert.deepEqual(latest.tokens,before.tokens);assert.equal(latest.currentMap?.id,before.currentMap?.id);
  console.log(JSON.stringify({restoredCharacters:latest.characters.map(c=>c.name),mapAndTokensPreserved:true}));
 }finally{socket.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
