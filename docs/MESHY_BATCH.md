# Enemy model batch

Authorized October 3, 2026: include the full 271-entry creature catalog and continue until the available Meshy API credits cannot fund another model.

The initial balance was 3,834 credits. Textured Meshy 6 Image-to-3D with 4K textures costs 30 credits per task. The batch limits spending to the initial prepaid balance, preserves existing models, and never buys credits or changes subscription settings. Confirmed refunds from failed tasks can fund another catalog entry. Nine tasks ran concurrently, below the documented Pro queue limit of ten.

Completed (October run `20261003T173407Z`): 127 new textured models, with nine catalog entries reusing existing models. All originally saved enemies now have model attachments. The catalog had models for 133 of its 271 entries; 138 remained without models (137 not submitted and one rejected by Meshy). Imperial Guard Sentinel was rejected with `provider_content_refused`; its 30 credits were refunded and used for Knobby White Spiderling. There were 128 submissions and 3,810 net credits spent. The API balance dropped to 24 credits.

## Continuation — November 6, 2026

Credits were refreshed (API balance **1,444** ≈ **48** textured models at 30 credits each). A new ledger was started at `target/meshy-batch/20261106T174125Z` because the October ledger still caps spending to the old prepaid budget.

- Saved campaign enemies (both DBs): all already have model attachments
- Catalog: 138 still without models; this run queues those and reuses 133 existing attachments
- This continuation can finish ~48 of the remaining 138 before credits run out again
- Resume / monitor:

```powershell
python -B scripts/meshy-enemy-batch.py --resume target/meshy-batch/20261106T174125Z --status
python -B scripts/meshy-enemy-batch.py --resume target/meshy-batch/20261106T174125Z --run --workers 9
```

---

### October run notes (archived)

All four interrupted downloads were recovered using their existing paid task IDs. No paid tasks remain pending. The 127 downloaded GLBs total 5,492,271,976 bytes. The final read-only audit passed file hashes, GLB structure, embedded texture checks, both database integrity checks and model attachment checks. Original enemy stats/actions, existing model links, unrelated database tables and original save files were preserved. Fractional challenge ratings were normalized only for newly created catalog templates. The disposable preview was synced with the finished assets and attachments; refresh the browser to load them.

Saved database enemies are processed first, followed by the catalog in its existing order. The batch has 265 generation candidates plus nine catalog entries that can reuse existing models. The saved protocol droid can reuse an existing model from the other database. Distinct saved creature names retain separate models.

`scripts/meshy-enemy-batch.py` creates a persistent ledger under `target/meshy-batch/`. The current run is `20261003T173407Z`; its `batch.json` records task IDs, statuses, local model paths, sizes and hashes. Each model is downloaded to `static/arena_stl/`, checked for a valid GLB header, then attached to enemy templates. Catalog entries get SW5E templates with their catalog stats; existing rows retain their stats, custom actions and model attachments. Both campaign databases are backed up in the run's `backup/` directory before modifications. Original save files are not edited.

Model attachments are committed across both databases in one SQLite transaction. Persistence tests in `scripts/meshy-batch-test.py` check metadata-only edits, preservation of existing models, idempotent catalog insertion and rollback on failure. The first generated GLB was also loaded and rendered in the application's copied-data 3D arena.

Progress can be inspected without spending credits:

```powershell
python -B scripts/meshy-enemy-batch.py --resume target/meshy-batch/20261003T173407Z --status
```

Resume an interrupted batch with the same ledger rather than starting a new run. To recover paid tasks without submitting more generations:

```powershell
python -B scripts/meshy-enemy-batch.py --resume target/meshy-batch/20261003T173407Z --run --recover-only --workers 9
```

A paid POST with an uncertain response is not automatically resubmitted. Such a record needs reconciliation with the Meshy task list. Polling uses read-only requests; rejected rate-limit responses can safely retry. Successful results remain attached even if another task fails or the credits run out. Generated models appear when the normal application reloads its enemy list; the disposable preview uses its own copied databases.

Pricing: https://docs.meshy.ai/en/api/pricing

Queue limits: https://docs.meshy.ai/en/api/rate-limits
