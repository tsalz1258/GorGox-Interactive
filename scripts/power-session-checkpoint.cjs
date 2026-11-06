// Preserve the active disposable preview across the power server update.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base='http://127.0.0.1:3000',mode=process.argv[2];
(async()=>{
 const marker=await(await fetch(base+'/static/phase0-session.json')).json();assert.equal(marker.purpose,'disposable-baseline');
 const root=path.resolve(marker.session_root);assert(root.startsWith(path.resolve('target/phase0-sessions')+path.sep));
 const file=path.join(root,'before-power-update.json'),socket=new WebSocket(base.replace('http','ws')+'/ws');let latest;const waits=[];
 const wait=predicate=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Session checkpoint timed out')),20000);waits.push({predicate,resolve:m=>{clearTimeout(timer);resolve(m);}});});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='SessionState')latest=m.snapshot;for(let i=waits.length-1;i>=0;i--)if(waits[i].predicate(m))waits.splice(i,1)[0].resolve(m);});
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 try{
  const connected=wait(m=>m.type==='SessionState');socket.send(JSON.stringify({type:'Connect',player_name:'Power update preservation',is_dm:true,style:'starwars'}));await connected;
  if(mode==='capture'){assert(latest.characters.length>0);fs.writeFileSync(file,JSON.stringify(latest));}
  else if(mode==='restore'){
   const expected=JSON.parse(fs.readFileSync(file,'utf8')),request_id=crypto.randomUUID();
   const restored=wait(m=>m.type==='SessionRestored'&&m.request_id===request_id);socket.send(JSON.stringify({type:'RestoreSession',snapshot:expected,request_id}));await restored;
   const captured=wait(m=>m.type==='SessionState'||m.type==='SessionUnchanged');socket.send(JSON.stringify({type:'RequestFullState'}));await captured;
   const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(sorted(latest.characters),sorted(expected.characters));assert.deepEqual(latest.tokens,expected.tokens);assert.deepEqual(latest.sessionExtras,expected.sessionExtras);assert.equal(latest.currentMap?.id,expected.currentMap?.id);
  }else throw Error('Choose capture or restore');
  console.log(JSON.stringify({mode,characters:latest.characters.length,tokens:latest.tokens.length,map:latest.currentMap?.name,preserved:true}));
 }finally{socket.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
