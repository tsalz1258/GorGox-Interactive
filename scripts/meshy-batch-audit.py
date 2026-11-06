"""Verify batch artifacts and preservation against pre-batch backups, read-only."""
import hashlib,json,pathlib,sqlite3,struct,sys
from contextlib import closing
ROOT=pathlib.Path(__file__).resolve().parents[1]
directory=pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to(ROOT/'target/meshy-batch'):raise ValueError('Not a project batch directory')
ledger=json.loads((directory/'batch.json').read_text(encoding='utf-8'))
checks=[]
def action_data(raw):
    try:value=json.loads(raw)
    except (ValueError,TypeError):value=None
    return value if isinstance(value,dict) else {'_gorg_actions_freeform':raw or ''}
def rows(conn,table):
    columns=[r[1] for r in conn.execute('PRAGMA table_info("'+table.replace('"','""')+'")')]
    return sorted([dict(zip(columns,r)) for r in conn.execute('SELECT * FROM "'+table.replace('"','""')+'"')],key=lambda r:json.dumps(r,sort_keys=True))
for name in ['gorgox_dnd.db','gorgox_starwars.db']:
    with closing(sqlite3.connect((ROOT/name).as_uri()+'?mode=ro',uri=True,timeout=30)) as current,closing(sqlite3.connect((directory/'backup'/name).as_uri()+'?mode=ro',uri=True)) as original:
        assert current.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        tables=[r[0] for r in original.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            if table=='enemies':continue
            assert rows(current,table)==rows(original,table),name+': unrelated table changed: '+table
        before={r['id']:r for r in rows(original,'enemies')};after={r['id']:r for r in rows(current,'enemies')}
        for id,b in before.items():
            a=after[id].copy();b=b.copy();old_actions=b.pop('actions');new_actions=a.pop('actions');assert a==b,name+': enemy stats changed'
            old=action_data(old_actions);new=action_data(new_actions)
            if old.get('_gorgox_arena_stl_url'):assert old['_gorgox_arena_stl_url']==new['_gorgox_arena_stl_url'],'Existing model overwritten'
            old.pop('_gorgox_arena_stl_url',None);new.pop('_gorgox_arena_stl_url',None);assert old==new,'Original actions changed'
        checks.append({'database':name,'integrity':'ok','original_enemy_stats_and_actions_preserved':True,'unrelated_tables_preserved':True,'new_templates':len(after)-len(before)})
        for e in ledger['jobs']:
            if e['status'] not in ['complete','reused']:continue
            for target in e['rows']:
                if target['database']==name:
                    assert action_data(after[target['id']]['actions']).get('_gorgox_arena_stl_url')==e['url'],'Saved model attachment missing: '+e['name']
            if 'catalog_index' in e:
                matches=[r for r in after.values() if r['name'].strip().lower()==e['name'].strip().lower() and r['style']=='starwars']
                assert matches and all(action_data(r['actions']).get('_gorgox_arena_stl_url') for r in matches),'Catalog model attachment missing: '+e['name']
generated=[]
for e in ledger['jobs']:
    if e['status']!='complete':continue
    file=(ROOT/e['url'].lstrip('/')).resolve();assert file.is_relative_to(ROOT/'static/arena_stl')
    data=file.read_bytes();assert hashlib.sha256(data).hexdigest()==e['sha256']
    magic,version,length=struct.unpack('<4sII',data[:12]);assert magic==b'glTF' and version==2 and length==len(data)
    chunk_length,chunk_type=struct.unpack('<II',data[12:20]);assert chunk_type==0x4e4f534a
    model=json.loads(data[20:20+chunk_length]);assert model.get('meshes')
    assert all('bufferView' in image or image.get('uri','').startswith('data:') for image in model.get('images',[])),'External texture dependency'
    generated.append({'name':e['name'],'url':e['url'],'bytes':len(data),'sha256':e['sha256']})
save_checks=[]
baseline=ROOT/'docs/source-data-verification.json'
if baseline.exists():
    for check in json.loads(baseline.read_text(encoding='utf-8'))['checks']:
        if not check['file'].endswith('.json'):continue
        file=ROOT/'saves'/check['file'];assert hashlib.sha256(file.read_bytes()).hexdigest()==check['sha256'],'Original save changed'
        save_checks.append({'file':check['file'],'unchanged':True})
report={'status':'PASS','databases':checks,'original_saves':save_checks,'completed_models_verified':len(generated),'generated':generated,'total_model_bytes':sum(e['bytes'] for e in generated)}
(directory/'audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='generated'}))
