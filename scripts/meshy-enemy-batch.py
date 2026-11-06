"""Resumable Meshy batch. Dry-run by default; --run spends prepaid API credits.

Uses source campaign databases intentionally. Backs them up before attachments,
preserves existing models/stats, and journals task IDs before polling/downloading.
Never retries an uncertain paid POST. Resume the same ledger to recover tasks.
"""
import argparse, base64, concurrent.futures, hashlib, io, json, os, pathlib, re
import sqlite3, struct, threading, time, urllib.error, urllib.parse, urllib.request, uuid
from datetime import datetime, timezone
from contextlib import closing
from fractions import Fraction
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATABASES = ["gorgox_dnd.db", "gorgox_starwars.db"]
API = "https://api.meshy.ai/openapi/v1"
MODEL_KEY = "_gorgox_arena_stl_url"
COST = 30
LOCK = threading.RLock()
CREATE_LOCK = threading.Lock()

def now(): return datetime.now(timezone.utc).isoformat()
def normalize(name): return name.strip().casefold()
def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("wb") as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    # OneDrive/antivirus can briefly hold a destination without delete sharing.
    for attempt in range(20):
        try: os.replace(temp, path); break
        except PermissionError:
            if attempt == 19: raise
            time.sleep(.1 * (attempt + 1))
def json_write(path, value): atomic(path, json.dumps(value, indent=2, ensure_ascii=False).encode())
def actions(raw):
    try: value = json.loads(raw)
    except (ValueError, TypeError): value = None
    return value if isinstance(value, dict) else {"_gorg_actions_freeform": raw or ""}
def db_read(filename):
    conn = sqlite3.connect((ROOT / filename).as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    with conn: rows = [dict(r) for r in conn.execute("SELECT * FROM enemies")]
    conn.close(); return rows
def api_key():
    key = os.environ.get("MESHY_API_KEY", "").strip()
    if not key and (ROOT / ".env").exists():
        for line in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
            if line.strip().startswith("MESHY_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key: raise RuntimeError("Meshy API key is not configured")
    return key
def request_json(key, endpoint, body=None):
    request = urllib.request.Request(API + endpoint, data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=120) as response: return json.load(response)
        except urllib.error.HTTPError as error:
            # A 429 rejects the request; it is safe to retry without another charge.
            if attempt < 5 and (error.code == 429 or (body is None and error.code >= 500)):
                time.sleep(min(10 * (attempt + 1), 60)); continue
            detail = error.read(1500).decode(errors="replace").replace(key, "[redacted]")
            raise RuntimeError(f"Meshy HTTP {error.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError):
            if body is not None or attempt == 5: raise
            time.sleep(min(10 * (attempt + 1), 60))
def balance(key): return int(request_json(key, "/balance")["balance"])
def portrait(npc, index):
    return npc.get("sw5e_token_url") or npc.get("sw5e_portrait_url") or f"/static/enemy_portraits/{index}.png"
def image_uri(value):
    if value.startswith("data:image/"): raw = base64.b64decode(value.split(",", 1)[1])
    elif value.startswith(("https://", "http://")):
        with urllib.request.urlopen(value, timeout=60) as response: raw = response.read(20 * 1024 * 1024 + 1)
    elif value.startswith("/"):
        path = (ROOT / urllib.parse.unquote(value.split("?", 1)[0].lstrip("/"))).resolve()
        if not path.is_relative_to(ROOT / "static"): raise ValueError("Portrait is outside static assets")
        raw = path.read_bytes()
    else: raise ValueError("No usable portrait")
    if not raw or len(raw) > 20 * 1024 * 1024: raise ValueError("Invalid portrait size")
    # Catalog artwork includes WebP, while the Meshy input contract uses PNG/JPEG.
    with Image.open(io.BytesIO(raw)) as image:
        image = image.convert("RGBA"); image.thumbnail((2048, 2048))
        output = io.BytesIO(); image.save(output, format="PNG"); raw = output.getvalue()
    return "data:image/png;base64," + base64.b64encode(raw).decode()

def plan():
    catalog = json.loads((ROOT / "static/data/npc.json").read_text(encoding="utf-8-sig"))
    saved = [(db, row) for db in DATABASES for row in db_read(db)]
    existing = {normalize(row["name"]): actions(row["actions"])[MODEL_KEY]
                for _, row in saved if actions(row["actions"]).get(MODEL_KEY)}
    entries = {}
    # Saved campaign enemies first, then the catalog in its existing order.
    for db, row in saved:
        if actions(row["actions"]).get(MODEL_KEY): continue
        name = normalize(row["name"])
        entry = entries.setdefault(name, {"name": row["name"], "portrait": row.get("portrait_url"), "rows": [], "status": "queued"})
        entry["rows"].append({"database": db, "id": row["id"]})
        if name in existing: entry.update(status="reuse", url=existing[name])
    for index, npc in enumerate(catalog):
        name = normalize(npc["name"])
        entry = entries.setdefault(name, {"name": npc["name"], "portrait": portrait(npc, index), "rows": [], "status": "queued"})
        entry["catalog_index"] = index
        if not entry.get("portrait"): entry["portrait"] = portrait(npc, index)
        if name in existing: entry.update(status="reuse", url=existing[name])
    return {"version": 1, "created": now(), "catalog_entries": len(catalog), "estimated_credits_per_task": COST,
            "jobs": list(entries.values()), "initial_balance": None, "submitted": 0, "stop_reason": None}

def backup(directory):
    for filename in DATABASES:
        destination = directory / "backup" / filename
        if destination.exists(): continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect((ROOT / filename).as_uri() + "?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(destination)) as copy, copy: source.backup(copy)

def first_number(value, default):
    found = re.search(r"\d+", str(value or "")); return int(found[0]) if found else default
def catalog_row(npc, index, url):
    raw = npc.get("raw_block", "")
    scores = {}
    for short, full in [("STR","strength"),("DEX","dexterity"),("CON","constitution"),("INT","intelligence"),("WIS","wisdom"),("CHA","charisma")]:
        match = re.search(r"\b" + short + r"\s+(\d+)", raw, re.I); scores[full] = int(match[1]) if match else 10
    try: cr = float(Fraction(str(npc.get("challenge", 0))))
    except (ValueError, TypeError, ZeroDivisionError): cr = 0
    return dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL, "gorgox:npc-model:" + normalize(npc["name"]))), name=npc["name"],
        creature_type=npc.get("type", "Unknown"), challenge_rating=cr, max_hp=first_number(npc.get("hit_points"),1),
        armor_class=first_number(npc.get("armor_class"),10), initiative_bonus=(scores["dexterity"]-10)//2, **scores,
        speed=first_number(npc.get("speed"),30), actions=json.dumps({"_gorg_actions_freeform":npc.get("actions", ""),MODEL_KEY:url}),
        description=raw, portrait_url=portrait(npc,index), style="starwars")

def attach(entry, catalog):
    """Only touch model metadata on existing rows; atomically attach in both DBs."""
    with closing(sqlite3.connect(ROOT / DATABASES[0], timeout=30)) as conn, conn:
        conn.execute("ATTACH DATABASE ? AS sw", (str(ROOT / DATABASES[1]),))
        conn.execute("BEGIN IMMEDIATE")
        for target in entry["rows"]:
            schema = "main" if target["database"] == DATABASES[0] else "sw"
            row = conn.execute(f"SELECT actions FROM {schema}.enemies WHERE id=?", (target["id"],)).fetchone()
            if not row: continue
            data = actions(row[0])
            if not data.get(MODEL_KEY):
                data[MODEL_KEY] = entry["url"]
                conn.execute(f"UPDATE {schema}.enemies SET actions=? WHERE id=?", (json.dumps(data), target["id"]))
        if "catalog_index" in entry:
            index = entry["catalog_index"]; npc = catalog[index]
            row = catalog_row(npc, index, entry["url"])
            for schema in ["main", "sw"]:
                # Add a SW5E template only if a SW5E row with this name isn't present.
                existing = conn.execute(f"SELECT id,actions FROM {schema}.enemies WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND style='starwars'", (entry["name"],)).fetchall()
                if existing:
                    for id, value in existing:
                        data = actions(value)
                        if not data.get(MODEL_KEY):
                            data[MODEL_KEY] = entry["url"]
                            conn.execute(f"UPDATE {schema}.enemies SET actions=? WHERE id=?", (json.dumps(data), id))
                else:
                    columns = list(row)
                    conn.execute(f"INSERT INTO {schema}.enemies ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", [row[k] for k in columns])

def download_glb(url, path):
    with urllib.request.urlopen(url, timeout=180) as response: data = response.read(150 * 1024 * 1024 + 1)
    if len(data) < 20 or len(data) > 150 * 1024 * 1024: raise ValueError("Invalid model size")
    magic, version, length = struct.unpack("<4sII", data[:12])
    if magic != b"glTF" or version != 2 or length != len(data): raise ValueError("Invalid GLB header")
    atomic(path, data)
    return len(data)

def run(directory, ledger, workers, max_new=None, recover_only=False):
    key = api_key(); backup(directory)
    catalog = json.loads((ROOT / "static/data/npc.json").read_text(encoding="utf-8-sig"))
    ledger_path = directory / "batch.json"
    def save():
        with LOCK:
            ledger["updated"] = now(); json_write(ledger_path, ledger)
    if ledger["initial_balance"] is None: ledger["initial_balance"] = balance(key); save()
    # A failed task may refund credits. Reuse only the observed refund allowance,
    # while retaining the initial prepaid spending cap and checking live balance.
    current_balance = balance(key)
    failed_cost = sum(e['status'] == 'failed' for e in ledger['jobs']) * COST
    baseline_remaining = ledger['initial_balance'] - ledger['submitted'] * COST
    refunded = max(0, min(failed_cost, current_balance - baseline_remaining))
    ledger['confirmed_refunded_credits'] = refunded
    limit = (ledger["initial_balance"] + refunded) // COST
    started_submitted = ledger["submitted"]
    ledger["stop_reason"] = None
    for entry in ledger["jobs"]:
        if entry["status"] == "reuse":
            attach(entry, catalog); entry["status"] = "reused"; entry.pop("portrait", None); save()
    def generate(entry):
        try:
            if not entry.get("task_id"):
                uri = image_uri(entry["portrait"])
                with CREATE_LOCK:
                    if max_new is not None and ledger["submitted"] - started_submitted >= max_new:
                        ledger["stop_reason"] = "Pilot submission cap reached"; save(); return
                    if ledger["submitted"] >= limit:
                        ledger["stop_reason"] = "Initial prepaid credit budget reached"; save(); return
                    credits = balance(key)
                    if credits < COST:
                        ledger["stop_reason"] = "Insufficient credits for another textured model"; ledger["balance"] = credits; save(); return
                    entry["status"] = "submitting"; entry["submitted_at"] = now(); ledger["submitted"] += 1; save()
                    # POST is never automatically retried: an interrupted response may still be billed.
                    result = request_json(key, "/image-to-3d", {"image_url":uri,"ai_model":"meshy-6","model_type":"standard",
                        "should_texture":True,"texture_resolution":"4k","enable_pbr":True,"should_remesh":True,
                        "target_polycount":100000,"pose_mode":"a-pose","target_formats":["glb"],
                        "texture_prompt":f"{entry['name']}. Match the reference character, equipment, colors and materials. Detailed tabletop miniature."[:800]})
                    entry["task_id"] = result["result"]; entry["status"] = "processing"; entry.pop("portrait", None); save()
                    print(json.dumps({"submitted":ledger["submitted"],"name":entry["name"],"credits_before":credits}), flush=True)
            while True:
                task = request_json(key, "/image-to-3d/" + urllib.parse.quote(entry["task_id"]))
                state = task.get("status"); entry["progress"] = task.get("progress", 0); save()
                if state == "SUCCEEDED":
                    task_suffix = re.sub(r"[^a-zA-Z0-9_-]+", "_", entry["task_id"])[:100]
                    file = re.sub(r"[^a-zA-Z0-9_-]+", "_", entry["name"]).strip("_")[:70] + "_" + task_suffix + ".glb"
                    path = ROOT / "static/arena_stl" / file
                    entry["bytes"] = download_glb(task["model_urls"]["glb"], path)
                    entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
                    entry["url"] = "/static/arena_stl/" + file; entry["status"] = "downloaded"; save()
                    with LOCK: attach(entry, catalog); entry["status"] = "complete"; entry["completed_at"] = now(); save()
                    print(json.dumps({"complete":entry["name"],"bytes":entry["bytes"]}), flush=True); return
                if state in ["FAILED", "CANCELED"]:
                    entry["status"] = "failed"; entry["error"] = str(task.get("task_error",{}))[:1500]; save(); return
                time.sleep(10)
        except Exception as error:
            entry["error"] = str(error).replace(key,"[redacted]")[:2000]
            entry["status"] = "needs_recovery" if entry.get("task_id") or entry["status"] == "submitting" else "blocked"
            save(); print(json.dumps({"name":entry["name"],"status":entry["status"],"error":entry["error"]}), flush=True)
    # Keep at most workers tasks in flight; avoid submitting the entire paid queue at once.
    candidates = [e for e in ledger["jobs"] if e["status"] in ["queued","processing","downloaded","needs_recovery"] and (e["status"] != "needs_recovery" or e.get("task_id"))]
    if recover_only: candidates = [e for e in candidates if e.get("task_id")]
    candidates.sort(key=lambda e: not bool(e.get("task_id")))
    queue = iter(candidates)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        active = {}
        def fill():
            while len(active) < workers and not ledger["stop_reason"]:
                entry = next(queue, None)
                if entry is None: break
                active[pool.submit(generate, entry)] = entry
        fill()
        while active:
            done, _ = concurrent.futures.wait(active, timeout=30, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done: future.result(); del active[future]
            fill()
            counts = {state:sum(e["status"]==state for e in ledger["jobs"]) for state in ["complete","reused","processing","queued","failed","blocked","needs_recovery"]}
            print(json.dumps({"summary":counts,"submitted":ledger["submitted"],"stop_reason":ledger["stop_reason"]}), flush=True)
    ledger["balance"] = balance(key); save()
    print(json.dumps({"finished":True,"balance":ledger["balance"],"stop_reason":ledger["stop_reason"],"ledger":str(ledger_path)}), flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--resume", type=pathlib.Path)
    parser.add_argument("--workers", type=int, default=3, choices=range(1,10))
    parser.add_argument("--max-new", type=int, help="Limit new paid tasks for a pilot run; resume without this to continue.")
    parser.add_argument("--recover-only", action="store_true", help="Download/attach already paid tasks without submitting new generations.")
    parser.add_argument("--status", action="store_true", help="Print compact ledger progress without contacting Meshy.")
    args = parser.parse_args()
    if args.resume:
        directory = args.resume.resolve()
        if not directory.is_relative_to(ROOT / "target/meshy-batch"): raise ValueError("Resume must target this project's batch ledger")
        ledger = json.loads((directory / "batch.json").read_text(encoding="utf-8"))
    else:
        directory = ROOT / "target/meshy-batch" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        ledger = plan(); json_write(directory / "batch.json", ledger)
    if args.status:
        counts = {state:sum(e["status"]==state for e in ledger["jobs"]) for state in ["complete","reused","processing","queued","failed","blocked","needs_recovery"]}
        print(json.dumps({"counts":counts,"submitted":ledger["submitted"],"initial_balance":ledger["initial_balance"],"remaining_reserved_estimate":None if ledger["initial_balance"] is None else ledger["initial_balance"]+ledger.get('confirmed_refunded_credits',0)-ledger["submitted"]*COST,"active":[{"name":e['name'],"progress":e.get('progress',0)} for e in ledger['jobs'] if e['status']=='processing'],"stop_reason":ledger['stop_reason']})); return
    print(json.dumps({"directory":str(directory),"jobs":len(ledger["jobs"]),"existing_reusable":sum(e["status"]=='reuse' for e in ledger["jobs"]),"generation_candidates":sum(e["status"]=='queued' for e in ledger["jobs"])}), flush=True)
    if args.run: run(directory, ledger, args.workers, args.max_new, args.recover_only)

if __name__ == "__main__": main()
