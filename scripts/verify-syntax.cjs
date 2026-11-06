const fs=require('node:fs'),cp=require('node:child_process');
const paths=[...new Set([...cp.execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).split(/\r?\n/),...cp.execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).split(/\r?\n/)])].filter(p=>/\.(js|mjs|cjs)$/.test(p)&&fs.existsSync(p));
for(const file of paths)cp.execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
console.log(`PASS: syntax checked ${paths.length} changed/new JavaScript files`);
