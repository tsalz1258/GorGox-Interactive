"""Prepare/run a disposable GorGox session; never launch from the campaign root.

Uses only Python's standard library. Database copies use SQLite's backup API.
Every run creates a new directory under target/phase0-sessions; no reset/delete.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare(include_3d=False):
    session = ROOT / "target" / "phase0-sessions" / (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    )
    session.mkdir(parents=True)
    manifest = {"created_utc": datetime.now(timezone.utc).isoformat(),
                "source_root": str(ROOT), "session_root": str(session),
                "include_3d": include_3d, "databases": {}, "saves": {}}
    try:
        manifest["source_commit"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        manifest["source_commit"] = "unavailable"
    for name in ("gorgox_dnd.db", "gorgox_starwars.db"):
        source = ROOT / name
        if not source.is_file():
            raise RuntimeError(f"Required source database missing: {source}")
        # mode=ro prevents creating or changing the source database.
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as original:
            with sqlite3.connect(session / name) as copied:
                original.backup(copied)
                integrity = copied.execute("PRAGMA integrity_check").fetchone()[0]
                if integrity != "ok":
                    raise RuntimeError(f"Database integrity failure: {name}: {integrity}")
                tables = [row[0] for row in copied.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
                )]
                counts = {table: copied.execute(
                    'SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"'
                ).fetchone()[0] for table in tables}
        manifest["databases"][name] = {"integrity": integrity, "rows": counts,
                                        "source_sha256": sha256(source),
                                        "copy_sha256": sha256(session / name)}
    ignore = None if include_3d else shutil.ignore_patterns("arena_stl")
    shutil.copytree(ROOT / "static", session / "static", ignore=ignore)
    # The current server's Discord link path uses CARGO_MANIFEST_DIR (source root).
    # Disable that UI message in the copied client only; do not change production code.
    client_file = session / "static" / "app.js"
    with client_file.open("a", encoding="utf-8") as copied_client:
        copied_client.write("\n;const phase0SendMessage = sendMessage;\n"
                            "sendMessage = function(message) {\n"
                            "  if (message.type === 'LinkDiscordAccount') {\n"
                            "    throw new Error('Discord linking is disabled in Phase 0 copies');\n"
                            "  }\n"
                            "  return phase0SendMessage(message);\n"
                            "};\n")
    (session / "static" / "arena_stl").mkdir(exist_ok=True)
    (session / "static" / "phase0-session.json").write_text(json.dumps({
        "session_root": str(session), "purpose": "disposable-baseline"
    }), encoding="utf-8")
    (session / "saves").mkdir()
    for name in ("Stone Cavern for S7.json", "test.json"):
        source = ROOT / "saves" / name
        if source.is_file():
            destination = session / "saves" / name
            shutil.copy2(source, destination)
            manifest["saves"][name] = {"source_sha256": sha256(source),
                                       "copy_sha256": sha256(destination)}
    for directory in ("campaign_notes", "sounds"):
        if (ROOT / directory).is_dir():
            shutil.copytree(ROOT / directory, session / directory)
    # No .env, Discord credentials, or linked bot process is copied/launched.
    (session / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return session


def launch(session):
    session = session.resolve()
    if not session.is_relative_to((ROOT / "target" / "phase0-sessions").resolve()):
        raise RuntimeError("Launch directory must be under target/phase0-sessions.")
    marker = json.loads((session / "static" / "phase0-session.json").read_text(encoding="utf-8-sig"))
    if Path(marker["session_root"]).resolve() != session:
        raise RuntimeError("Disposable-session marker does not match launch directory.")
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 3000)) == 0:
            raise RuntimeError("Port 3000 is occupied. Stop the existing server yourself before testing.")
    executable = ROOT / "target" / "debug" / "gorgox_interactive.exe"
    if not executable.is_file():
        raise RuntimeError("Run cargo build --offline --locked first (debug executable missing).")
    environment = os.environ.copy()
    # A nonempty sentinel prevents main.rs from loading the source-root Meshy key.
    environment["MESHY_API_KEY"] = "phase0-disabled"
    environment["GORGOX_NO_BROWSER"] = "1"
    environment["RUST_LOG"] = "warn"
    environment["GORGOX_DISCORD_LINKS_PATH"] = str(session / "discord_links.json")
    environment["GORGOX_SW5E_COMP_PATH"] = str(session / "static" / "data" / "sw5e_compendium")
    with (session / "server.log").open("wb") as log:
        process = subprocess.Popen([str(executable)], cwd=session, env=environment,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    (session / "server-process.json").write_text(json.dumps({
        "pid": process.pid, "executable": str(executable),
        "executable_sha256": sha256(executable), "cwd": str(session)
    }, indent=2), encoding="utf-8")
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Test server exited ({process.returncode}); see {session / 'server.log'}")
        try:
            with urllib.request.urlopen("http://127.0.0.1:3000/api/test", timeout=2) as response:
                if json.load(response).get("status") == "ok":
                    return process.pid
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    process.terminate()
    raise RuntimeError("Test server readiness timed out; see server.log.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Launch the debug binary from the copy.")
    parser.add_argument("--include-3d", action="store_true", help="Also copy the large 3D model library.")
    parser.add_argument("--reuse", type=Path, help="Refresh code and launch an existing marked disposable copy.")
    args = parser.parse_args()
    if args.reuse:
        session = args.reuse.resolve()
        if not session.is_relative_to((ROOT / "target" / "phase0-sessions").resolve()):
            raise RuntimeError("Reuse must target a disposable campaign copy")
        marker = json.loads((session / "static" / "phase0-session.json").read_text(encoding="utf-8-sig"))
        if Path(marker["session_root"]).resolve() != session or marker.get("purpose") != "disposable-baseline":
            raise RuntimeError("Invalid disposable-session marker")
        for source in (ROOT / "static").rglob("*"):
            if source.is_file() and source.suffix in (".js", ".mjs", ".html", ".css"):
                destination = session / source.relative_to(ROOT)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        with (session / "static" / "app.js").open("a", encoding="utf-8") as file:
            file.write("\n{const originalSend=sendMessage;sendMessage=function(message){if(message?.type==='LinkDiscordAccount')return;return originalSend(message);};}\n")
    else:
        session = prepare(args.include_3d)
    result = {"session_root": str(session), "manifest": str(session / "manifest.json")}
    if args.run:
        result["pid"] = launch(session)
        result["dm_url"] = "http://127.0.0.1:3000"
        result["player_url"] = "http://localhost:3000"
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
