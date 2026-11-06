"""Build loadable showcase sessions from enemies with existing local models."""
import importlib.util,json,math,pathlib,sqlite3,sys,uuid
from contextlib import closing
from datetime import datetime,timezone
from PIL import Image,ImageDraw,ImageFont

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('batch',ROOT/'scripts/meshy-enemy-batch.py')
batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
def party(directory):
    with closing(sqlite3.connect((directory/batch.DATABASES[0]).as_uri()+'?mode=ro',uri=True)) as conn:
        conn.row_factory=sqlite3.Row
        return [dict(r) for r in conn.execute('SELECT * FROM characters ORDER BY name')]
characters=party(ROOT)
rows={}
for filename in batch.DATABASES:
    for row in batch.db_read(filename):
        if not batch.actions(row['actions']).get(batch.MODEL_KEY):continue
        key=row['name'].strip().casefold()
        if key not in rows or (row.get('style')=='starwars' and rows[key].get('style')!='starwars'):rows[key]=row
enemies=sorted(rows.values(),key=lambda e:e['name'].casefold())
assert enemies
assets=ROOT/'static/meshy-gallery';assets.mkdir(parents=True,exist_ok=True)
saves=ROOT/'saves';saves.mkdir(exist_ok=True)
font_path='C:/Windows/Fonts/segoeui.ttf'
title_font=ImageFont.truetype(font_path,30);label_font=ImageFont.truetype(font_path,18);small_font=ImageFont.truetype(font_path,16)
manifest=[]

def build(label,subset,columns,filename,asset_name):
    tile=300;header=130;width=columns*tile;height=header+math.ceil(len(subset)/columns)*tile
    image=Image.new('RGB',(width,height),'#141c29');draw=ImageDraw.Draw(image)
    draw.text((24,20),label,font=title_font,fill='#e8f1ff')
    draw.text((24,66),f'{len(subset)} enemies | Open 3D Arena to inspect models | Alphabetical order',font=small_font,fill='#9fc2dc')
    draw.text((24,92),'Use the numbered group saves for closer viewing.',font=small_font,fill='#9fc2dc')
    map_id='meshy-gallery-'+asset_name;tokens=[];instances={};saved=[]
    for index,row in enumerate(subset):
        col=index%columns;line=index//columns;left=col*tile;top=header+line*tile
        draw.rounded_rectangle((left+8,top+8,left+tile-8,top+tile-8),radius=12,fill='#202e42',outline='#425873')
        for offset in range(50,tile,50):
            draw.line((left+offset,top+20,left+offset,top+190),fill='#293b52')
        for offset in range(30,200,50):draw.line((left+20,top+offset,left+tile-20,top+offset),fill='#293b52')
        name=row['name'];words=name.split();lines=['']
        for word in words:
            candidate=(lines[-1]+' '+word).strip()
            if draw.textlength(candidate,font=label_font)>tile-30 and lines[-1]:lines.append(word)
            else:lines[-1]=candidate
        for j,text in enumerate(lines):draw.text((left+15,top+215+j*24),text,font=label_font,fill='#e8f1ff')
        entity_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'gorgox:gallery:'+name.casefold()))
        enemy=dict(row,id=entity_id,enemy_id=row['id'],current_hp=row['max_hp'])
        saved.append(enemy)
        instances[entity_id]={k:enemy[k] for k in ['id','enemy_id','name','current_hp','max_hp','armor_class','initiative_bonus']}
        tokens.append(dict(id='gallery-token-'+entity_id,map_id=map_id,entity_id=entity_id,entity_type='Enemy',
            x=(left+100)/50,y=(top+60)/50,size=2,image_url=row.get('portrait_url'),display_name=name,hidden_from_players=False,show_name=True))
    image.save(assets/(asset_name+'.png'))
    snapshot=dict(version='2.0',savedAt=datetime.now(timezone.utc).isoformat(),selectedStyle='starwars',
        currentMap=dict(id=map_id,name=label,image_path='/static/meshy-gallery/'+asset_name+'.png',grid_size=50,width=width,height=height,map_state=None),
        canvasState=dict(gridSize=50,panX=0,panY=0,zoom=min(1,1200/width)),characters=characters,enemies=saved,enemyInstances=instances,tokens=tokens,
        combatState=dict(active=False,participants=[],currentTurn=None,current_turn_index=0,round=1),
        playerMapViewport=dict(enabled=False,hidden=False,x=0,y=0,width=width,height=height),
        measurementShapes=[],logHistory=[],sessionExtras={},campaignNotes={})
    file=saves/filename;file.write_text(json.dumps(snapshot,indent=2),encoding='utf-8')
    manifest.append(dict(file=filename,count=len(subset),names=[e['name'] for e in subset],map=snapshot['currentMap']['image_path']))

build('Meshy Gallery - All '+str(len(enemies))+' Enemies',enemies,12,'Meshy Gallery - ALL Enemies.json','all-enemies')
groups=math.ceil(len(enemies)/8)
for i in range(groups):
    subset=enemies[i*8:(i+1)*8]
    build(f'Meshy Gallery - Group {i+1:02d} of {groups}',subset,4,f'Meshy Gallery - Group {i+1:02d}.json',f'group-{i+1:02d}')
(assets/'manifest.json').write_text(json.dumps(dict(unique_enemies=len(enemies),saves=manifest),indent=2),encoding='utf-8')
if len(sys.argv)>1:
    preview=pathlib.Path(sys.argv[1]).resolve()
    if not preview.is_relative_to(ROOT/'target/phase0-sessions'):raise ValueError('Invalid preview path')
    marker=json.loads((preview/'static/phase0-session.json').read_text(encoding='utf-8-sig'))
    if marker['purpose']!='disposable-baseline' or pathlib.Path(marker['session_root']).resolve()!=preview:raise ValueError('Invalid preview marker')
    import shutil
    shutil.copytree(assets,preview/'static/meshy-gallery',dirs_exist_ok=True)
    preview_party=party(preview)
    for e in manifest:
        snapshot=json.loads((saves/e['file']).read_text(encoding='utf-8'))
        snapshot['characters']=preview_party
        (preview/'saves'/e['file']).write_text(json.dumps(snapshot,indent=2),encoding='utf-8')
print(json.dumps(dict(unique_enemies=len(enemies),gallery_saves=len(manifest),viewing_groups=groups,source_databases_unchanged=True)))
