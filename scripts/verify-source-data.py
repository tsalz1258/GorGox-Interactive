"""Confirm disposable testing did not modify the original campaign databases/saves."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
checks = []
for group, prefix in (("databases", root), ("saves", root / "saves")):
    for name, original in manifest[group].items():
        digest = hashlib.sha256((prefix / name).read_bytes()).hexdigest()
        checks.append({"file": name, "unchanged": digest == original["source_sha256"], "sha256": digest})
result = {"source_campaign_unchanged": all(c["unchanged"] for c in checks), "checks": checks}
(root / "docs" / "source-data-verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
if not result["source_campaign_unchanged"]:
    raise SystemExit(1)
