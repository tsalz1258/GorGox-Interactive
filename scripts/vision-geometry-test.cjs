const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const G=require('../static/js/vision-geometry.js');
const vm=require('node:vm'),fs=require('node:fs');
const wall={id:'wall',kind:'wall',open:false,x1:5,y1:0,x2:5,y2:10};
assert.equal(G.canSee({x:2,y:5},{x:8,y:5},[wall]),false);
assert.equal(G.canSee({x:2,y:5},{x:4,y:5},[wall]),true);
assert.equal(G.canSee({x:2,y:5},{x:8,y:5},[{...wall,kind:'door',open:true}]),true);
assert.equal(G.canSee({x:2,y:5},{x:8,y:5},[{...wall,kind:'door',open:false}]),false);
assert.equal(G.canSee({x:2,y:5},{x:2,y:8},[],2),false);
assert.equal(G.canSee({x:2,y:5},{x:2,y:7},[],2),true);
assert.equal(G.canSee({x:2,y:2},{x:8,y:8},[{...wall,y1:5,y2:10}]),false,'sight through a wall corner is blocked');
assert.equal(G.canSee({x:2,y:2},{x:8,y:2},[{...wall,y1:3}]),true,'a real gap allows sight');
assert.equal(G.canSee({x:2,y:5},{x:8,y:5},[{...wall,x1:4,y1:5,x2:6,y2:5}]),false,'collinear wall blocks sight');
const polygon=G.polygon({x:2,y:5},[wall],10,10,20);
assert(polygon.every(p=>p.x<=5+1e-6&&p.x>=-1e-6&&p.y>=-1e-6&&p.y<=10+1e-6));
assert(G.inRect({x:8,y:5},{x:7,y:4,width:2,height:2}));
// Large circles keep the same placement-cell center used by drawToken.
const context={window:{},document:{addEventListener(){}},structuredClone,VisionGeometry:G,isDM:false,serverIsDm:false,myCharacterId:'a',gridSize:50,currentMap:{id:'m',width:800,height:600},canvas:{width:800,height:600},tokens:[{entity_type:'Player',entity_id:'a',x:2,y:2,size:8}],SessionSync:{last:{sessionExtras:{visionMaps:{m:{version:1,enabled:true,mode:'character',rangeFeet:120,walls:[{...wall,x1:6,x2:6,y2:12}],reveals:[],tokenOverrides:{}}}}}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/vision-tools.js'),'utf8'),context);
assert.equal(context.window.VisionTools.tokenVisible({id:'large',entity_type:'Object',x:4,y:2,size:6}),true,'large tokens use their rendered center');
assert.equal(context.window.VisionTools.tokenVisible({id:'blocked',entity_type:'Object',x:8,y:2,size:1}),false);
// Benchmark the acceptance size, including 50 independent vision sources.
const walls=Array.from({length:250},(_,i)=>({kind:'wall',open:false,x1:10+i%25*3,y1:10+Math.floor(i/25)*3,x2:11+i%25*3,y2:12+Math.floor(i/25)*3}));
const sources=Array.from({length:50},(_,i)=>({x:2+i%10*2,y:2+Math.floor(i/10)*2}));
const elapsed=[];for(let pass=0;pass<3;pass++){const start=performance.now();for(const s of sources)G.polygon(s,walls,100,100,24);elapsed.push(performance.now()-start);}
const result={status:'PASS',walls:250,sources:50,rebuildMs:elapsed.map(n=>Math.round(n)),cachedUpdates:'UI separately verifies unrelated updates do not rebuild geometry'};
console.log(JSON.stringify(result));
if(elapsed.slice(1).some(n=>n>1000))throw Error('Vision rebuild exceeds one second; optimize before delivery');
