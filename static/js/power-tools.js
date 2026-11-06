/* Casting previews and immediate, acknowledged server casts. */
window.PowerTools = (() => {
    const cache={}; const el=id=>document.getElementById(id);
    async function power(pool,name){if(!cache[pool]){const file=pool==='tech'?'techpowers_from_packs.json':'force_powers_from_packs.json';const r=await fetch('/static/data/sw5e_compendium/'+file);if(!r.ok)throw new Error('Power reference unavailable; use manual resource controls');cache[pool]=await r.json();}return cache[pool].find(p=>p.name.toLowerCase()===name.toLowerCase());}
    function level(row){const raw=String(row?.level??'').trim();return /at.will/i.test(raw)?0:raw===''?NaN:Number(raw);}
    function cost(lv){return lv===0?0:lv+1;}
    function effectPreview(row,lv,caster,pool){
        const base=level(row),ability=pool==='tech'?Math.floor(((caster?.intelligence||10)-10)/2):Math.max(Math.floor(((caster?.wisdom||10)-10)/2),Math.floor(((caster?.charisma||10)-10)/2));
        const scaling=row.casting?.scaling||{},steps=scaling.mode==='cantrip'?((caster?.level||1)>=17?3:(caster?.level||1)>=11?2:(caster?.level||1)>=5?1:0):Math.max(0,lv-base);
        const parts=row.casting?.damage_parts||[];
        const formulas=parts.map(([raw,type])=>{
            let f=String(raw).replace(/@mod\b/g,String(ability));
            const first=f.match(/^(\d+)d(\d+)/i),extra=String(scaling.formula||'').match(/^(\d+)d(\d+)$/i);
            if(steps&&scaling.mode==='cantrip'&&first)f=f.replace(first[0],`${Number(first[1])*(steps+1)}d${first[2]}`);
            else if(steps&&scaling.mode==='level'&&extra){if(first&&first[2]===extra[2])f=f.replace(first[0],`${Number(first[1])+steps*Number(extra[1])}d${first[2]}`);else f+=` + ${steps} × (${scaling.formula})`;}
            return `${f} ${type||''}`.trim();
        });
        const rules=String(row.description||'').match(/(?:Overcharge Tech|Force Potency)[\s\S]*/i)?.[0]||'';
        const dc=8+(caster?.proficiency_bonus||2)+ability;
        return {effect:formulas.length?formulas.join('; '):'Effect: '+String(row.description||'No numeric effect listed.'),
            scaling:base===0?`At-will scaling uses character level ${caster?.level||1}; casting level stays 0.`:lv>base?`Upcast by ${lv-base} level${lv-base===1?'':'s'}.${rules?' '+rules:scaling.mode==='level'?'':' No additional upcast effect is listed in the power reference.'}`:rules||'Base-level effect.',
            roll:row.name==='Explosion'?`DEX save DC ${dc}; successful saves take half damage. 20-foot radius.`:row.name==='Electroshock'?`Melee tech attack +${(caster?.proficiency_bonus||2)+ability}; a hit applies Shocked.`:row.saving_throw?`${row.saving_throw} save DC ${dc}.`:''};
    }
    function dialog(title,content){const d=document.createElement('dialog');d.className='power-dialog';const h=document.createElement('h3');h.textContent=title;d.append(h,content);document.body.append(d);d.showModal();return d;}
    async function preview(p,targets,center){
        try{
            const row=await power(p.powerType,p.powerName);if(!row)throw new Error('This power is missing from the compendium. Use manual point and HP controls.');
            const base=level(row);if(!Number.isInteger(base))throw new Error('Power level is missing; use manual point controls');
            const form=document.createElement('form');form.innerHTML='<label>Casting level <input name="level" type="number" min="0" max="9" required></label><p class="power-cost"></p><p class="power-effect" aria-live="polite"></p><p class="power-roll"></p><p class="power-upcast"></p><p class="power-targets"></p><label class="power-metal" hidden><input name="advantage" type="checkbox"> Electroshock advantage: target is metal or wears metal armor</label><p class="power-mode"></p><details><summary>Power description</summary><p class="power-reference"></p></details><div class="table-tools-row"><button type="submit">Cast now</button><button type="button" class="power-cancel">Cancel</button></div><p role="status" class="power-error"></p>';
            const input=form.elements.level;input.value=base;input.min=base;input.max=9;
            if(base===0){input.type='hidden';input.closest('label').firstChild.textContent='At-will power — level 0. No casting level to choose; scaling uses your character level.';}
            const caster=characters.find(c=>c.id===(p.characterId||myCharacterId));
            const update=()=>{const lv=Number(input.value),effect=effectPreview(row,lv,caster,p.powerType);form.querySelector('.power-cost').textContent=`Cost: ${cost(lv)} ${p.powerType} points. Spent when you cast.`;form.querySelector('.power-effect').textContent=effect.effect;form.querySelector('.power-roll').textContent=effect.roll;form.querySelector('.power-upcast').textContent=effect.scaling;};input.oninput=update;update();
            form.querySelector('.power-reference').textContent=row.description||'';
            form.querySelector('.power-targets').textContent='Targets: '+targets.filter(isTokenVisibleToViewer).map(getTokenDisplayName).join(', ');
            form.querySelector('.power-metal').hidden=p.powerName!=='Electroshock';
            const supported=p.powerType==='tech'&&['Electroshock','Explosion','Kolto Pack'].includes(p.powerName);
            form.querySelector('.power-mode').textContent=supported?'Casting rolls and applies the supported attack, save, or healing effect immediately. Results appear in Rolls.':'Casting spends points and records the power in Rolls immediately. Special effects and HP changes for this power are tracked manually.';
            const d=dialog(p.powerName,form);
            const close=()=>{d.close();d.remove();};form.querySelector('.power-cancel').onclick=close;d.addEventListener('cancel',()=>d.remove());
            form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;try{await TableTools.command({kind:'cast',character_id:p.characterId||myCharacterId,pool:p.powerType,name:p.powerName,level:Number(input.value),ids:targets.map(t=>t.id),center,advantage:form.elements.advantage.checked});close();}catch(error){form.querySelector('.power-error').textContent=error.message;button.disabled=false;}};
        }catch(error){addLogEntry(error.message,'info');}
    }
    function refresh(){
        const parent=el('powerRequests');if(!parent)return;
        const extras=SessionSync.last?.sessionExtras||{};const pending=extras.pendingCasts||[];
        const focused=document.activeElement?.closest('[data-cast-id]');
        if(focused&&pending.some(c=>c.id===focused.dataset.castId))return;
        parent.replaceChildren();
        const visible=pending.filter(c=>isDM||c.character_id===myCharacterId);
        for(const cast of visible){
            const panel=document.createElement('details');panel.dataset.castId=cast.id;panel.open=true;
            const title=document.createElement('summary');title.textContent=`${cast.caster}: ${cast.name} · level ${cast.level} · ${cast.cost} ${cast.pool} points`;panel.append(title);
            if(!cast.supported){const hint=document.createElement('p');hint.textContent='Manual resolution required. Read the power and enter each effect.';panel.append(hint);const text=document.createElement('p');text.textContent=cast.power.description||'';panel.append(text);}
            const effects=[];
            for(const target of cast.targets.filter(t=>isDM||!t.hidden)){
                const row=document.createElement('div');row.className='power-review-row';const name=document.createElement('p');name.textContent=`${target.name} · ${target.outcome}`;row.append(name);
                if(isDM){const label=document.createElement('label');label.textContent='HP change (+ heal / − damage) ';const input=document.createElement('input');input.type='number';input.value=target.delta;input.min=-100000;input.max=100000;label.append(input);row.append(label);let condition=null;if(target.shocked){const lab=document.createElement('label');condition=document.createElement('input');condition.type='checkbox';condition.checked=true;lab.append(condition,document.createTextNode(' Apply Shocked until target’s next turn'));row.append(lab);}effects.push({id:target.id,input,condition});}
                panel.append(row);
            }
            let rounds=null;
            if(isDM&&(String(cast.power.concentration).toLowerCase().includes('concentration')||cast.power.concentration===true)){const label=document.createElement('label');label.textContent='Concentration duration in rounds (0 = manual) ';rounds=document.createElement('input');rounds.type='number';rounds.min=0;rounds.max=10000;rounds.value=0;label.append(rounds);panel.append(label);}
            const buttons=document.createElement('div');buttons.className='table-tools-row';
            if(isDM){const apply=document.createElement('button');apply.textContent='Commit reviewed cast';apply.onclick=()=>{apply.disabled=true;TableTools.command({kind:'resolve_cast',cast_id:cast.id,effects:effects.map(e=>({id:e.id,delta:Number(e.input.value),applyCondition:e.condition?.checked??false})),concentrationRounds:Number(rounds?.value||0)}).then(message=>addLogEntry(message,'info')).catch(error=>{status.textContent=error.message;apply.disabled=false;});};buttons.append(apply);}
            const cancel=document.createElement('button');cancel.textContent='Cancel request';cancel.onclick=()=>TableTools.report(TableTools.command({kind:'cancel_cast',cast_id:cast.id}));buttons.append(cancel);panel.append(buttons);
            const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);parent.append(panel);
        }
        if(!visible.length)parent.textContent='No power requests awaiting resolution.';
        for(const [id,active] of Object.entries(extras.concentration||{})){if(!isDM&&id!==myCharacterId)continue;const row=document.createElement('p');row.textContent=`Concentration: ${characters.find(c=>c.id===id)?.name||'Caster'} · ${active.name}${active.expiresRound?' until round '+active.expiresRound:''}`;if(isDM){const b=document.createElement('button');b.textContent='End concentration';b.onclick=()=>TableTools.report(TableTools.command({kind:'concentration',character_id:id,keep:false}));row.append(b);}parent.append(row);}
        const checks=extras.concentrationChecks||[];
        if(isDM)for(const check of checks){const row=document.createElement('div');row.textContent=`Concentration: ${check.name} · CON save DC ${check.dc} `;for(const [label,keep] of [['Maintained',true],['Broken',false]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>TableTools.report(TableTools.command({kind:'concentration',character_id:check.character_id,keep}));row.append(b);}parent.append(row);}
        const results=el('powerResults');results.replaceChildren();
        for(const cast of (extras.recentCasts||[]).slice(-5).reverse()){const line=document.createElement('p');line.textContent=`${cast.caster} · ${cast.name} · ${cast.cost} ${cast.pool} points · `+cast.effects.filter(e=>isDM||!cast.targets.find(t=>t.id===e.id)?.hidden).map(e=>`${cast.targets.find(t=>t.id===e.id)?.name}: ${e.delta>=0?'+':''}${e.delta} HP`).join(', ');results.append(line);}
    }
    function resource(pool,delta){return TableTools.report(TableTools.command({kind:'resource',character_id:myCharacterId,pool,delta}));}
    function rest(long){return TableTools.report(TableTools.command({kind:'rest',character_id:myCharacterId,long}));}
    function mount(){const parent=el('combatPanel');if(!parent)return;const details=document.createElement('details');details.id='powerResolution';details.innerHTML='<summary>Power requests and results</summary><div id="powerRequests"></div><div id="powerResults" aria-live="polite"></div>';parent.append(details);details.addEventListener('toggle',refresh);}
    document.addEventListener('DOMContentLoaded',mount);document.addEventListener('gorgox:session',refresh);
    return {preview,refresh,resource,rest,cost,level,effectPreview};
})();
