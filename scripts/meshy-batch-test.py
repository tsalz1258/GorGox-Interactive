"""Meaningful persistence checks using temporary databases, with no paid API calls."""
import importlib.util, json, pathlib, sqlite3, tempfile, unittest
from contextlib import closing

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("batch", ROOT / "scripts/meshy-enemy-batch.py")
batch = importlib.util.module_from_spec(spec); spec.loader.exec_module(batch)

class Persistence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / "target")
        self.original = batch.ROOT; batch.ROOT = pathlib.Path(self.temp.name)
        self.npc = {"name":"Fixture Droid","type":"Droid","challenge":"2","hit_points":"27 (5d8 +5)","armor_class":"11 (armor)","speed":"25 ft.","raw_block":"STR 10 (+0) DEX 14 (+2) CON 12 (+1) INT 14 (+2) WIS 12 (+1) CHA 14 (+2)","actions":"Fixture attack"}
        self.row = batch.catalog_row(self.npc, 0, "/static/arena_stl/old.glb")
        self.row.update(id="original", name="Saved fixture",style="dnd",actions=json.dumps({"attacks":[{"name":"Custom attack"}],"custom":42}))
        for db in batch.DATABASES:
            with closing(sqlite3.connect(batch.ROOT/db)) as conn, conn:
                conn.execute('CREATE TABLE enemies ('+','.join(k+(' TEXT PRIMARY KEY' if k=='id' else ' TEXT' if isinstance(v,str) else ' REAL') for k,v in self.row.items())+')')
                conn.execute('INSERT INTO enemies VALUES ('+','.join('?' for _ in self.row)+')',list(self.row.values()))
    def tearDown(self): batch.ROOT=self.original;self.temp.cleanup()
    def rows(self, db):
        with closing(sqlite3.connect(batch.ROOT/db)) as conn:
            conn.row_factory=sqlite3.Row;return [dict(r) for r in conn.execute('SELECT * FROM enemies')]
    def entry(self): return {"name":"Saved fixture","url":"/static/arena_stl/new.glb","rows":[{"database":db,"id":"original"} for db in batch.DATABASES]}
    def test_only_model_metadata_changes_on_saved_enemies(self):
        before={db:self.rows(db)[0] for db in batch.DATABASES};batch.attach(self.entry(),[])
        for db in batch.DATABASES:
            after=self.rows(db)[0];data=json.loads(after.pop('actions'));old=json.loads(before[db].pop('actions'))
            self.assertEqual(after,before[db]);self.assertEqual(data.pop(batch.MODEL_KEY),'/static/arena_stl/new.glb');self.assertEqual(data,old)
    def test_existing_models_survive_concurrent_attach(self):
        with closing(sqlite3.connect(batch.ROOT/batch.DATABASES[0])) as conn, conn:conn.execute('UPDATE enemies SET actions=?',(json.dumps({batch.MODEL_KEY:'/static/arena_stl/manual.glb'}),))
        batch.attach(self.entry(),[])
        self.assertEqual(json.loads(self.rows(batch.DATABASES[0])[0]['actions'])[batch.MODEL_KEY],'/static/arena_stl/manual.glb')
        self.assertEqual(json.loads(self.rows(batch.DATABASES[1])[0]['actions'])[batch.MODEL_KEY],'/static/arena_stl/new.glb')
    def test_catalog_templates_are_idempotent_and_keep_stats(self):
        entry={"name":self.npc['name'],"url":"/static/arena_stl/new.glb","rows":[],"catalog_index":0}
        batch.attach(entry,[self.npc]);batch.attach(entry,[self.npc])
        for db in batch.DATABASES:
            rows=self.rows(db);self.assertEqual(len(rows),2);row=next(r for r in rows if r['name']==self.npc['name'])
            self.assertEqual(row['max_hp'],27);self.assertEqual(row['dexterity'],14);self.assertEqual(row['initiative_bonus'],2);self.assertEqual(row['style'],'starwars')
    def test_failure_rolls_back_both_databases(self):
        with closing(sqlite3.connect(batch.ROOT/batch.DATABASES[1])) as conn, conn:conn.execute("CREATE TRIGGER reject_update BEFORE UPDATE ON enemies BEGIN SELECT RAISE(ABORT,'fixture'); END")
        with self.assertRaises(sqlite3.IntegrityError):batch.attach(self.entry(),[])
        for db in batch.DATABASES:self.assertNotIn(batch.MODEL_KEY,json.loads(self.rows(db)[0]['actions']))
    def test_fractional_catalog_challenge_ratings(self):
        npc={**self.npc,'challenge':'1/4'};self.assertEqual(batch.catalog_row(npc,0,'url')['challenge_rating'],.25)

if __name__=='__main__':unittest.main()
