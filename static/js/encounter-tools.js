/* Encounter controls use token IDs, never template IDs, for live effects. */
window.EncounterTools = (() => {
    const selected = new Set(); let groups=[]; let presets=[];
    const el=id=>document.getElementById(id);
    function ids(){return [...selected].filter(id=>tokens.some(t=>t.id===id));}
    function run(action){return TableTools.report(TableTools.command(action));}
    function label(id){const t=tokens.find(t=>t.id===id);return t?getTokenDisplayName(t):'Removed token';}
    function refresh(){
        if(!el('encounterRows')||!isDM)return;
        const snapshot=SessionSync.last;
        const rows=el('encounterRows'),scroll=rows.scrollTop;rows.replaceChildren();
        for(const t of tokens.filter(t=>t.entity_type!=='Object')){
            const row=document.createElement('div');row.className='encounter-row';
            const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(t.id);check.setAttribute('aria-label','Select '+getTokenDisplayName(t));
            check.onchange=()=>{if(check.checked)selected.add(t.id);else selected.delete(t.id);status();};
            const info=document.createElement('button');info.className='encounter-creature';
            const p=combatState.participants?.find(p=>p.id===t.id);const c=t.entity_type==='Player'?characters.find(c=>c.id===t.entity_id):enemies.find(c=>c.id===t.entity_id);
            const conditions=snapshot?.sessionExtras?.conditions?.[t.id]||[];
            info.textContent=`${p?.id===combatState.currentTurn?'▶ ':''}${getTokenDisplayName(t)} · HP ${c?.current_hp??p?.current_hp??'?'}/${c?.max_hp??p?.max_hp??'?'}${p?' · Init '+p.initiative:''}${conditions.length?' · '+conditions.map(c=>c.label+(c.expiresRound?' → R'+c.expiresRound:'')).join(', '):''}`;
            info.onclick=()=>{selectedToken=t;updateTokenInfo();updatePlayerActionBarVisibility();populatePlayerActionBar();renderCanvas();if(t.entity_type!=='Player')showNPCCharacterSheet(t.entity_id);};
            row.append(check,info);rows.append(row);
        }
        rows.scrollTop=scroll;
        const picker=el('encounterTemplate'),value=picker.value;picker.replaceChildren();
        for(const e of enemies.filter(e=>!e.enemy_id&&!e.isNPC).sort((a,b)=>a.name.localeCompare(b.name))){const o=document.createElement('option');o.value=e.id;o.textContent=e.name;picker.append(o);}
        picker.value=value||picker.options[0]?.value||'';
        status();
    }
    function status(){if(el('encounterSelection'))el('encounterSelection').textContent=ids().length+' selected';}
    function renderGroups(){const list=el('encounterGroups');list.replaceChildren();groups.forEach((g,i)=>{const row=document.createElement('div');row.textContent=`${g.count} × ${g.name}${g.initiative!=null?' · initiative '+g.initiative:''} `;const b=document.createElement('button');b.textContent='Remove';b.onclick=()=>{groups.splice(i,1);renderGroups();};row.append(b);list.append(row);});}
    async function loadPresets(){try{const r=await fetch('/api/encounters');if(!r.ok)throw new Error('Presets unavailable');presets=await r.json();const p=el('encounterPreset');p.replaceChildren();for(const row of presets){const o=document.createElement('option');o.value=row.id;o.textContent=row.name;p.append(o);}}catch(e){el('tableToolsStatus').textContent=e.message;}}
    function mount(){const parent=el('tableTools');if(!parent)return;const panel=document.createElement('details');panel.id='encounterTools';panel.innerHTML=`<summary>Encounter panel</summary>
        <div class="table-tools-row"><button id="encounterRefresh">Refresh templates</button><button id="encounterAll">Select all</button><button id="encounterNone">Clear selection</button><span id="encounterSelection"></span></div>
        <div id="encounterRows" class="encounter-rows"></div>
        <div class="table-tools-row"><label>HP amount <input id="encounterHp" type="number" min="0" max="100000" value="5"></label><button id="encounterDamage">Damage selected</button><button id="encounterHeal">Heal selected</button></div>
        <div class="table-tools-row"><label>Condition <input id="encounterCondition" maxlength="80" placeholder="e.g. Prone"></label><label>Rounds (0 = manual) <input id="encounterRounds" type="number" min="0" max="1000" value="0"></label><button id="encounterAddCondition">Add condition</button><button id="encounterRemoveCondition">Remove condition</button></div>
        <div class="table-tools-row"><button id="encounterStart">Start selected encounter</button><label>Initiative total <input id="encounterInitiative" type="number" value="10"></label><button id="encounterSetInitiative">Set selected initiative</button><button id="encounterNext">Next turn</button><button id="encounterEnd">End combat</button></div>
        <h4>Enemy groups</h4><label>Template <select id="encounterTemplate"></select></label><div class="table-tools-row"><label>Count <input id="encounterCount" type="number" value="3" min="1" max="50"></label><label>Group initiative <input id="encounterGroupInit" type="number" placeholder="Optional"></label><button id="encounterAddGroup">Add group</button></div><div id="encounterGroups"></div>
        <div class="table-tools-row"><label>Grid X <input id="encounterX" type="number" value="2"></label><label>Grid Y <input id="encounterY" type="number" value="2"></label><button id="encounterSpawn">Spawn groups</button></div>
        <label>Preset name <input id="encounterPresetName" maxlength="100"></label><button id="encounterSavePreset">Save groups as preset</button><label>Saved encounters <select id="encounterPreset"></select></label><button id="encounterLoadPreset">Load preset groups</button>`;
        parent.append(panel);
        panel.addEventListener('toggle',()=>{if(panel.open){sendMessage({type:'ListEnemies'});refresh();loadPresets();}});
        el('encounterRefresh').onclick=()=>{sendMessage({type:'ListEnemies'});refresh();loadPresets();};
        el('encounterAll').onclick=()=>{tokens.filter(t=>t.entity_type!=='Object').forEach(t=>selected.add(t.id));refresh();};el('encounterNone').onclick=()=>{selected.clear();refresh();};
        const hp=sign=>{const amount=Number(el('encounterHp').value),targets=ids();if(!targets.length||!Number.isInteger(amount)||amount<0)return;const names=targets.map(label).join(', ');if(confirm(`${sign<0?'Damage':'Heal'} ${targets.length} selected: ${names}\nAmount per creature: ${amount}`))run({kind:'hp',ids:targets,delta:sign*amount});};
        el('encounterDamage').onclick=()=>hp(-1);el('encounterHeal').onclick=()=>hp(1);
        for(const [id,remove] of [['encounterAddCondition',false],['encounterRemoveCondition',true]])el(id).onclick=()=>run({kind:'condition',ids:ids(),label:el('encounterCondition').value,rounds:Number(el('encounterRounds').value),remove});
        el('encounterStart').onclick=()=>run({kind:'start_combat',ids:ids()});el('encounterSetInitiative').onclick=()=>run({kind:'initiative',ids:ids(),total:Number(el('encounterInitiative').value)});el('encounterNext').onclick=()=>run({kind:'next_turn'});el('encounterEnd').onclick=()=>run({kind:'end_combat'});
        el('encounterAddGroup').onclick=()=>{const e=enemies.find(e=>e.id===el('encounterTemplate').value);if(!e)return;const g={template_id:e.id,name:e.name,count:Number(el('encounterCount').value)};if(el('encounterGroupInit').value!=='')g.initiative=Number(el('encounterGroupInit').value);groups.push(g);renderGroups();};
        el('encounterSpawn').onclick=()=>run({kind:'spawn',groups,x:Number(el('encounterX').value),y:Number(el('encounterY').value)});
        el('encounterSavePreset').onclick=()=>TableTools.report(TableTools.command({kind:'save_preset',name:el('encounterPresetName').value,groups}).then(message=>{loadPresets();return message;}));
        el('encounterLoadPreset').onclick=()=>{const p=presets.find(p=>p.id===el('encounterPreset').value);if(p){groups=structuredClone(p.groups);renderGroups();}};
        document.getElementById('mapCanvas')?.addEventListener('mousedown',event=>{if(!isDM||!event.shiftKey||event.button!==0||pendingTargetPower||pendingTargetAttack)return;const {mouseX,mouseY}=clientToWorld(event.clientX,event.clientY);const t=[...tokens].reverse().find(t=>mouseX>=t.x*gridSize&&mouseX<(t.x+t.size)*gridSize&&mouseY>=t.y*gridSize&&mouseY<(t.y+t.size)*gridSize);if(t){event.preventDefault();event.stopImmediatePropagation();if(selected.has(t.id))selected.delete(t.id);else selected.add(t.id);refresh();}},true);
    }
    document.addEventListener('DOMContentLoaded',mount);
    document.addEventListener('gorgox:session',refresh);
    document.addEventListener('gorgox:catalog',refresh);
    return {refresh,ids,selected};
})();
