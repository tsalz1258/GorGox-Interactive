# Enemy model batch

Authorized October 3, 2026: include the full 271-entry creature catalog and continue until the available Meshy API credits cannot fund another model.

The initial balance was 3,834 credits. Textured Meshy 6 Image-to-3D with 4K textures costs 30 credits per task. The batch limits spending to the initial prepaid balance, preserves existing models, and never buys credits or changes subscription settings. Confirmed refunds from failed tasks can fund another catalog entry. Nine tasks ran concurrently, below the documented Pro queue limit of ten.

Completed (October run `20261003T173407Z`): 127 new textured models, with nine catalog entries reusing existing models. All originally saved enemies now have model attachments. The catalog had models for 133 of its 271 entries; 138 remained without models (137 not submitted and one rejected by Meshy). Imperial Guard Sentinel was rejected with `provider_content_refused`; its 30 credits were refunded and used for Knobby White Spiderling. There were 128 submissions and 3,810 net credits spent. The API balance dropped to 24 credits.

## Paused — November 6, 2026

Credits were refreshed to **1,444** and a new ledger was required, because each ledger spends only its own `initial_balance` plus confirmed refunds. The October ledger `20261003T173407Z` stays closed.

Finished ledger: `target/meshy-batch/20261106T174125Z` (updated 2026-11-06T18:09:18Z). This folder is gitignored under `/target`. Do not delete it, `static/arena_stl/`, or the campaign databases. Those files are the only local copy of the models and task history.

| Result | Count |
| --- | --- |
| Catalog jobs | 271 |
| Reused existing models | 133 |
| New models this run | 47 |
| Still queued, not submitted | 90 |
| Failed safety check | 1 |
| Submissions | 48 |
| Ending API balance | 34 |
| Stop reason | Initial prepaid credit budget reached |

**180** catalog names have a model (133 reused + 47 new). **91** do not: the 90 queued names below, plus **Manifestation of Abeloth** (`catalog_index` 146, task `01a1b1f9-1823-73d4-83a4-c2cb830efa7f`). Meshy returned `provider_content_refused` / “This content was declined by a safety check.” Retrying that portrait unchanged can fail again. Saved enemies in both campaign databases already had models before this run. Characters with no portrait were not generated.

Do not `--run` this November ledger after buying more credits. `scripts/meshy-enemy-batch.py` now refuses that run when the live balance is more than one model above the ledger's prepaid remainder and known refunds, and it submits nothing. `submitted` is already 48, and the cap is 1,444 credits (48 tasks, plus at most the 30-credit Abeloth refund). A resume would stop immediately, or spend one refunded task, and would leave the rest queued. Do not resume the October ledger either. Do not buy credits from the script, and do not retry an uncertain paid POST.

When credits are back, about **2,700** credits cover the 90 queued creatures (30 each). Abeloth is a 31st submission if she is tried again. Dry-run first. It writes a new ledger and spends nothing. Continue only if `generation_candidates` is about **91**. A much higher number means existing attachments were not seen; stop before `--run`.

```powershell
python -B scripts/meshy-enemy-batch.py
python -B scripts/meshy-enemy-batch.py --resume target/meshy-batch/<NEW_STAMP> --run --workers 9
```

Check progress without spending:

```powershell
python -B scripts/meshy-enemy-batch.py --resume target/meshy-batch/20261106T174125Z --status
```

Queued catalog names still waiting:

R2 Series Astromech Droid; Rakghoul; Rakghoul, Hulking; Rancor, Adolescent; Rancor, Adult; Rancor, Ancient; Rancor, Juvenile; Rathtar; Rathtar, Dwarf; Reek, Adolescent; Reek, Adult; Riot; Rock Wart; Ronto; SD-K4 Assassin Droid; Sando Aqua Monster; Sarlacc, Adult; Scrange; Scurrier; Shaak; Shrub; Shyrack; Shyrack Swarm; Sibian Hound; Sith Probe Droid; Sketto; Spotlight Sloth; Starweird; Steelpecker; Steep; Stintaril; Stintaril Swarm; Super Tactical Droid; Swamp Slug; Swamp Wampa; T-Series Tactical Droid; T3-Series Utility Droid; TX-225 Occupier Tank; Tauntaun; Terentatek; Trandoshan Elite Warrior; Trandoshan Hunter; Trandoshan Huntmaster; Trandoshan T'doshok; Trandoshan Warrior; Tree; Trooper; Trooper, Captain; Trooper, Demolitions; Trooper, Flame; Trooper, Headhunter; Trooper, Heavy; Trooper, Jump; Trooper, Mounted; Trooper, Scout; Trooper, Shore; Trooper, Sniper; Trooper, Squad; Tuk'ata; Tusk Cat; Tusken Brute; Tusken Chieftain; Tusken Raider; Twirrl; Uprising; Varactyl, Adolescent; Varactyl, Adult; Veermok; Vessel of Abeloth; Vesuvague Tree; Vines; Viper Probe Droid; Vornskr; Voxyn; Vulptex; Vulture-Class Droid; War Wyrm; Weaponized Gonk Droid; Whisper Bird; Woodoo; Wookiee Berserker; Wookiee Engineer; Wookiee Hunter; Worrt; Wraid; Wyyyschokk; Ysalamir; Ysalamiri Swarm; Z-58 Series Security Droid; Zalaaca.

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
