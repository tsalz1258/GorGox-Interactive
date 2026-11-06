// Refresh only power descriptions and casting metadata from the bundled source packs.
import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),packs=path.join(root,'starwars5edata/sw5e/packs');
const text=s=>String(s||'').replace(/\[\[\/r\s+([^\]]+)\]\]/gi,(_,f)=>f.split('#')[0].trim()).replace(/<\/p>\s*<p>/gi,'\n\n').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/\[\[#[^\]]+\]\]/g,'').trim();
const results=[];
for(const filename of ['techpowers_from_packs.json','force_powers_from_packs.json']){
 const file=path.join(root,'static/data/sw5e_compendium',filename),rows=JSON.parse(fs.readFileSync(file,'utf8'));let updated=0;
 for(const row of rows){
  const source=path.resolve(packs,row._imported_from||'');if(!source.startsWith(packs+path.sep)||!fs.existsSync(source))continue;
  const sys=JSON.parse(fs.readFileSync(source,'utf8')).system||{};
  row.description=text(sys.description?.value||sys.description||'');
  row.casting={damage_parts:sys.damage?.parts||[],scaling:sys.scaling||{},action_type:sys.actionType||'',target:sys.target||{},range:sys.range||{},duration:sys.duration||{}};
  if(row.casting.scaling.mode==='atwill')row.casting.scaling.mode='cantrip';
  if(sys.components?.concentration||sys.properties?.concentration)row.concentration='Concentration';
  updated++;
 }
 fs.writeFileSync(file,JSON.stringify(rows,null,2));results.push({file:filename,updated,total:rows.length});
}
console.log(JSON.stringify(results));
