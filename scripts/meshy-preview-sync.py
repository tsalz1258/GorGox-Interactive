"""Add completed model templates/assets to a verified disposable preview only."""
import importlib.util,json,os,pathlib,shutil,sqlite3,sys,urllib.parse
from contextlib import closing
ROOT=pathlib.Path(__file__).resolve().parents[1]
preview=pathlib.Path(sys.argv[1]).resolve()
if not preview.is_relative_to(ROOT/'target/phase0-sessions'):raise ValueError('Not a disposable preview')
marker=json.loads((preview/'static/phase0-session.json').read_text(encoding='utf-8-sig'))
if marker['purpose']!='disposable-baseline' or pathlib.Path(marker['session_root']).resolve()!=preview:raise ValueError('Invalid marker')
spec=importlib.util.spec_from_file_location('batch',ROOT/'scripts/meshy-enemy-batch.py');batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
templates=files=0
batch_catalog_ids=set()
if len(sys.argv)>2:
    directory=pathlib.Path(sys.argv[2]).resolve()
    if not directory.is_relative_to(ROOT/'target/meshy-batch'):raise ValueError('Invalid batch directory')
    ledger=json.loads((directory/'batch.json').read_text(encoding='utf-8'))
    catalog=json.loads((ROOT/'static/data/npc.json').read_text(encoding='utf-8-sig'))
    batch_catalog_ids={batch.catalog_row(catalog[e['catalog_index']],e['catalog_index'],e['url'])['id'] for e in ledger['jobs'] if e['status'] in ['complete','reused'] and 'catalog_index' in e}
for db in batch.DATABASES:
    source=batch.db_read(db)
    original_ids=set()
    if batch_catalog_ids:
        with closing(sqlite3.connect((directory/'backup'/db).as_uri()+'?mode=ro',uri=True)) as backup:original_ids={r[0] for r in backup.execute('SELECT id FROM enemies')}
    with closing(sqlite3.connect(preview/db,timeout=30)) as conn,conn:
        for row in source:
            model=batch.actions(row['actions']).get(batch.MODEL_KEY)
            if not model:continue
            if model.startswith('/static/arena_stl/'):
                relative=urllib.parse.unquote(model.split('?',1)[0].lstrip('/'));file=(ROOT/relative).resolve();target=(preview/relative).resolve()
                if not file.is_relative_to(ROOT/'static/arena_stl') or not target.is_relative_to(preview/'static/arena_stl'):raise ValueError('Invalid model path')
                if not file.exists():continue
                if not target.exists():
                    target.parent.mkdir(parents=True,exist_ok=True)
                    try:os.link(file,target)
                    except OSError:shutil.copy2(file,target)
                    files+=1
            existing=conn.execute('SELECT actions FROM enemies WHERE id=?',(row['id'],)).fetchone()
            if existing:
                data=batch.actions(existing[0])
                if not data.get(batch.MODEL_KEY):data[batch.MODEL_KEY]=model;conn.execute('UPDATE enemies SET actions=? WHERE id=?',(json.dumps(data),row['id']));templates+=1
                if row['id'] in batch_catalog_ids and row['id'] not in original_ids and data.get(batch.MODEL_KEY)==model and row['challenge_rating']!=0:
                    conn.execute('UPDATE enemies SET challenge_rating=? WHERE id=? AND challenge_rating=0',(row['challenge_rating'],row['id']))
            else:
                columns=list(row);conn.execute('INSERT INTO enemies ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',[row[k] for k in columns]);templates+=1
print(json.dumps({'preview':str(preview),'model_templates_added_or_linked':templates,'model_files_added':files,'unrelated_preview_state_preserved':True}))
