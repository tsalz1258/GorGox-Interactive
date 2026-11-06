"""Normalize fractional CR only on this batch's newly created catalog templates."""
import importlib.util,json,pathlib,sqlite3,sys
from contextlib import closing
ROOT=pathlib.Path(__file__).resolve().parents[1];directory=pathlib.Path(sys.argv[1]).resolve()
if not directory.is_relative_to(ROOT/'target/meshy-batch'):raise ValueError('Invalid batch')
spec=importlib.util.spec_from_file_location('batch',ROOT/'scripts/meshy-enemy-batch.py');batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
ledger=json.loads((directory/'batch.json').read_text(encoding='utf-8'));catalog=json.loads((ROOT/'static/data/npc.json').read_text(encoding='utf-8-sig'));changed=0
for filename in batch.DATABASES:
    with closing(sqlite3.connect((directory/'backup'/filename).as_uri()+'?mode=ro',uri=True)) as backup:original_ids={r[0] for r in backup.execute('SELECT id FROM enemies')}
    with closing(sqlite3.connect(ROOT/filename,timeout=30)) as conn,conn:
        for e in ledger['jobs']:
            if e['status'] not in ['complete','reused'] or 'catalog_index' not in e:continue
            expected=batch.catalog_row(catalog[e['catalog_index']],e['catalog_index'],e['url']);id=expected['id']
            if id in original_ids:continue
            row=conn.execute('SELECT challenge_rating,actions FROM enemies WHERE id=?',(id,)).fetchone()
            if row and row[0]==0 and expected['challenge_rating']!=0 and batch.actions(row[1]).get(batch.MODEL_KEY)==e['url']:
                conn.execute('UPDATE enemies SET challenge_rating=? WHERE id=?',(expected['challenge_rating'],id));changed+=1
print(json.dumps({'new_catalog_fractional_cr_corrected':changed,'original_enemies_untouched':True}))
