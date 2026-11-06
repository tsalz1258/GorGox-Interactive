/* Acknowledged server commands and recovery tools. */
window.TableTools = (() => {
    const pending = new Map();
    function command(action, request_id = crypto.randomUUID(), waitForState = true) {
        return new Promise((resolve, reject) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Connect to the table first'));
            const timer = setTimeout(() => { pending.delete(request_id); reject(new Error('The table did not acknowledge this action. Sync before retrying.')); }, 45000);
            pending.set(request_id, {resolve,reject,timer,waitForState});
            sendMessage({type:'TableAction',request_id,action});
        });
    }
    function complete(result) {
        const item = pending.get(result.request_id);
        if (!item) return;
        clearTimeout(item.timer); pending.delete(result.request_id);
        if (!result.ok) item.reject(new Error(result.message));
        else if (item.waitForState) SessionSync.capture().then(()=>item.resolve(result.message),item.reject);
        else item.resolve(result.message);
    }
    function report(operation) {
        return operation.then(message => { addLogEntry(message || 'Done','info'); return message; }).catch(error => {
            addLogEntry(error.message,'info');
            const status = document.getElementById('tableToolsStatus');
            if (status) status.textContent = error.message;
        });
    }
    function mount() {
        const parent = document.getElementById('dmControls');
        if (!parent || document.getElementById('tableTools')) return;
        const section = document.createElement('section'); section.id = 'tableTools';
        section.innerHTML = '<h3>Table tools</h3><div class="table-tools-row"><button id="tableUndo">Undo last action</button><button id="tableRecovery">Recovery snapshots</button></div><p id="tableToolsStatus" role="status" aria-live="polite"></p><div id="tableRecoveryList"></div>';
        parent.append(section);
        section.querySelector('#tableUndo').onclick = () => report(command({kind:'undo'}));
        section.querySelector('#tableRecovery').onclick = async () => {
            const list = section.querySelector('#tableRecoveryList'); list.replaceChildren();
            try {
                const response = await fetch('/api/recovery'); if (!response.ok) throw new Error('Recovery list unavailable');
                const rows = (await response.json()).reverse();
                if (!rows.length) list.textContent = 'No recovery snapshots yet. Changes are backed up every 30 seconds.';
                for (const name of rows) {
                    const snapshot = name; const filename = name.filename;
                    const button = document.createElement('button'); button.className = 'recovery-entry';
                    button.textContent = `${new Date(snapshot.savedAt).toLocaleString()} · ${snapshot.currentMap?.name || 'No map'} · ${snapshot.recoveryReason}`;
                    button.onclick = () => { if(confirm('Restore this recovery snapshot? The current session will first be backed up.')) report(fetch('/api/recovery/'+encodeURIComponent(filename)).then(r => {if(!r.ok)throw new Error('Snapshot unavailable');return r.json();}).then(SessionSync.restore).then(()=> 'Recovered session')); };
                    list.append(button);
                }
            } catch(error) { list.textContent = error.message; }
        };
    }
    document.addEventListener('DOMContentLoaded',mount);
    document.addEventListener('keydown',event => {
        if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        if (isDM && (event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='z') {event.preventDefault(); report(command({kind:'undo'}));}
    });
    return {command,complete,report};
})();
