"""Launch the rebuilt release server in the verified existing preview."""
import json,os,pathlib,socket,subprocess,time,urllib.request,hashlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
preview=ROOT/'target/phase0-sessions/20261003T023740Z-f49e15bc'
marker=json.loads((preview/'static/phase0-session.json').read_text(encoding='utf-8-sig'))
assert marker['purpose']=='disposable-baseline' and pathlib.Path(marker['session_root']).resolve()==preview
with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',3000))!=0,'Port occupied'
exe=ROOT/('target/debug/gorgox_interactive.exe' if '--debug' in sys.argv else 'target/release/gorgox_interactive.exe');assert exe.is_file()
for name in ['static/app.js','static/index.html','static/js/power-tools.js','static/js/session-sync.js','static/data/sw5e_compendium/techpowers_from_packs.json','static/data/sw5e_compendium/force_powers_from_packs.json']:
    import shutil
    shutil.copy2(ROOT/name,preview/name)
environment=os.environ.copy();environment.update(GORGOX_PORT='3000',MESHY_API_KEY='phase0-disabled',GORGOX_NO_BROWSER='1',RUST_LOG='warn',GORGOX_DISCORD_LINKS_PATH=str(preview/'discord_links.json'),GORGOX_SW5E_COMP_PATH=str(preview/'static/data/sw5e_compendium'))
with (preview/'power-server.log').open('ab') as log:
    process=subprocess.Popen([str(exe)],cwd=preview,env=environment,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
(preview/'server-process.json').write_text(json.dumps(dict(pid=process.pid,executable=str(exe),executable_sha256=hashlib.sha256(exe.read_bytes()).hexdigest(),cwd=str(preview)),indent=2),encoding='utf-8')
for _ in range(40):
    if process.poll() is not None:raise RuntimeError('Server exited; see power-server.log')
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000/api/test',timeout=2) as r:
            if json.load(r).get('status')=='ok':print(json.dumps(dict(pid=process.pid,ready=True)));break
    except OSError:pass
    time.sleep(.5)
else:raise RuntimeError('Server readiness timed out')
