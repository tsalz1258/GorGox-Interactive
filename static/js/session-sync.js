/* Shared session application and acknowledged restore. No client-side turn inference. */
window.SessionSync = (() => {
    const pending = new Map();
    const captures = [];
    let last = null;
    let signature = '';

    function apply(snapshot) {
        last = snapshot;
        const nextSignature = JSON.stringify({ ...snapshot, savedAt: null });
        if (signature !== nextSignature) {
            signature = nextSignature;
            const mapChanged = currentMap?.id !== snapshot.currentMap?.id || currentMap?.image_path !== snapshot.currentMap?.image_path;
            const image = !mapChanged ? currentMap?.image : null;
            currentMap = snapshot.currentMap ? { ...snapshot.currentMap, image } : null;
            if (currentMap) {
                gridSize = currentMap.grid_size;
                canvas.width = currentMap.width;
                canvas.height = currentMap.height;
                if (mapChanged) loadMapImage(currentMap.image_path);
            }
            tokens = snapshot.tokens || [];
            characters = snapshot.characters || [];
            (snapshot.logHistory || []).forEach(entry => applySharedLogEntryFromServer(entry, true));
            connectedPlayers=(snapshot.players||[]).map(p=>({...p,name:p.player_name,character_name:characters.find(c=>c.id===p.character_id)?.name||'No character'}));
            renderPlayerList();

            if (currentViewingCharacter) {
                const updated=characters.find(c=>c.id===currentViewingCharacter.id);
                if(updated){
                    const changed=currentViewingCharacter.current_hp!==updated.current_hp||currentViewingCharacter.max_hp!==updated.max_hp||currentViewingCharacter.character_data!==updated.character_data;
                    currentViewingCharacter=updated;
                    try{const full=JSON.parse(updated.character_data||'{}');currentViewingCharacterFullData=full;currentViewingCharacterData=full.character||full;}catch{}
                    if(changed) scheduleDebouncedCharacterSheetRefresh();
                }
            }
            Object.entries(snapshot.campaignNotes || {}).forEach(([id, notes]) => {
                if(window.campaignNotesDirty?.has(id))return;
                campaignNotesMem[id] = normalizeCampaignNotesRaw(notes);
                campaignNotesHydratedFids[id] = true;
            });
            const instanceIds = new Set(tokens.filter(t => t.entity_type !== 'Player').map(t => t.entity_id));
            const templates = enemies.filter(e => !e.isNPC && !instanceIds.has(e.id) && !e.enemy_id);
            const merged = new Map(templates.map(e => [e.id, e]));
            (snapshot.enemies || []).forEach(e => merged.set(e.id, { ...e, isCustomInstance: !!e.enemy_id && !e.isNPC }));
            enemies = [...merged.values()];
            combatState = { ...snapshot.combatState, removedFromCombatIds: [] };
            measurementShapes = snapshot.measurementShapes || [];
            if (snapshot.playerMapViewport) applyPlayerMapViewportFromServer(snapshot.playerMapViewport);
            if (!selectedToken || !tokens.some(t => t.id === selectedToken.id)) selectedToken = null;
            else selectedToken = tokens.find(t => t.id === selectedToken.id);
            if (!isDM && !myCharacterId) {
                const saved = localStorage.getItem('savedCharacterId');
                if (characters.some(c => c.id === saved)) {
                    myCharacterId = saved;
                    sendMessage({ type: 'SelectCharacter', character_id: saved });
                }
            }
            if (myCharacterId && !characters.some(c => c.id === myCharacterId)) myCharacterId = null;
            updateCampaignTitle();
            updateInitiativeList();
            updateCombatStatus();
            updatePlayerTurnControls();
            updateCurrentTurnDisplay(combatState.participants?.find(p => p.id === combatState.currentTurn)?.name || '-');
            updatePlayerActionBarVisibility();
            populatePlayerActionBar();
            renderCanvas();
            document.dispatchEvent(new CustomEvent('gorgox:session', { detail: snapshot }));
        }
        captures.splice(0).forEach(resolve => resolve(structuredClone(snapshot)));
    }

    function capture() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const index = captures.indexOf(done);
                if (index >= 0) captures.splice(index, 1);
                reject(new Error('The server did not acknowledge the session snapshot'));
            }, 45000);
            const done = snapshot => { clearTimeout(timer); resolve(snapshot); };
            captures.push(done);
            sendMessage({ type: 'RequestFullState' });
        });
    }

    function restore(snapshot) {
        if (!isDM) return Promise.reject(new Error('Only the DM can restore sessions'));
        return new Promise((resolve, reject) => {
            const request_id = crypto.randomUUID();
            const timer = setTimeout(() => { pending.delete(request_id); reject(new Error('Session restore was not acknowledged')); }, 20000);
            pending.set(request_id, { resolve, reject, timer });
            sendMessage({ type: 'RestoreSession', snapshot, request_id });
        });
    }

    function complete(id) {
        const request = pending.get(id);
        if (request) { clearTimeout(request.timer); pending.delete(id); request.resolve(); }
    }
    function rejectError(message) {
        for (const [id, request] of pending) {
            if (message.includes(id)) { clearTimeout(request.timer); pending.delete(id); request.reject(new Error(message)); }
        }
    }
    function unchanged(savedAt) { if(last){last.savedAt=savedAt;captures.splice(0).forEach(resolve=>resolve(structuredClone(last)));} }
    return { apply, capture, restore, complete, rejectError, unchanged, get last() { return last; } };
})();
