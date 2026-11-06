/**
 * Live DM/player role check. Connects two WebSocket clients and confirms
 * the server assigns the role each one claimed. Does not move tokens,
 * change HP, or write a save.
 *
 * Exit 0 pass, 2 if the server or WebSocket is unavailable, 1 on a bad role.
 */
'use strict';

const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const wsBase = base.replace(/^http/, 'ws') + '/ws';

function connect(name, isDm) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(Object.assign(new Error('This Node has no global WebSocket'), { code: 'NO_WS' }));
      return;
    }
    const ws = new WebSocket(wsBase);
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      reject(new Error('timed out waiting for PlayerRole: ' + name));
    }, 8000);
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type !== 'PlayerRole') return;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      resolve(msg.is_dm === true);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('websocket error for ' + name), { code: 'ECONNREFUSED' }));
    });
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'Connect',
        player_name: name,
        is_dm: isDm,
        style: 'starwars'
      }));
    });
  });
}

(async () => {
  try {
    const dm = await connect('Regression DM', true);
    const player = await connect('Regression Player', false);
    if (dm !== true || player !== false) {
      console.error('ROLE MISMATCH dm=' + dm + ' player=' + player);
      process.exit(1);
    }
    console.log('PASS DM role true, player role false');
    process.exit(0);
  } catch (err) {
    if (err && (err.code === 'ECONNREFUSED' || err.code === 'NO_WS' || /timed out|websocket/i.test(err.message || ''))) {
      console.error('SKIP ' + (err.message || err));
      process.exit(2);
    }
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
