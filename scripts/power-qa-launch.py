"""Prepare a separate copied-data server on port 3001 for casting checks."""
import importlib.util,json,os,pathlib,subprocess,time,urllib.request,hashlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('phase0',ROOT/'scripts/phase0-session.py');phase0=importlib.util.module_from_spec(spec);spec.loader.exec_module(phase0)
preview=phase0.prepare(False);exe=ROOT/('target/release/gorgox_interactive.exe' if '--release' in sys.argv else 'target/debug/gorgox_interactive.exe')
environment=os.environ.copy();environment.update(GORGOX_PORT='3001',MESHY_API_KEY='phase0-disabled',GORGOX_NO_BROWSER='1',RUST_LOG='warn',GORGOX_DISCORD_LINKS_PATH=str(preview/'discord_links.json'),GORGOX_SW5E_COMP_PATH=str(preview/'static/data/sw5e_compendium'))
with (preview/'server.log').open('wb') as log:process=subprocess.Popen([str(exe)],cwd=preview,env=environment,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
record=dict(pid=process.pid,executable=str(exe),executable_sha256=hashlib.sha256(exe.read_bytes()).hexdigest(),cwd=str(preview),port=3001)
(preview/'server-process.json').write_text(json.dumps(record,indent=2),encoding='utf-8');(ROOT/'target/power-qa-server.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
for _ in range(40):
    if process.poll() is not None:raise RuntimeError('QA server exited')
    try:
        with urllib.request.urlopen('http://127.0.0.1:3001/api/test',timeout=2) as r:
            if json.load(r).get('status')=='ok':print(json.dumps(record));break
    except OSError:pass
    time.sleep(.5)
else:raise RuntimeError('QA readiness timed out')
