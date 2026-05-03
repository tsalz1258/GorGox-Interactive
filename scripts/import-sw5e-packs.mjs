#!/usr/bin/env node
/**
 * Import Star Wars 5e Foundry VTT pack JSON (from a cloned repo, e.g. sw5e-foundry/sw5e `packs/`)
 * into GorGox-friendly JSON under static/data/sw5e_compendium/.
 *
 * Usage:
 *   node scripts/import-sw5e-packs.mjs --packs "C:/path/to/sw5e/packs"
 *   SW5E_PACKS_DIR=C:/path/to/sw5e/packs node scripts/import-sw5e-packs.mjs
 *
 * Options:
 *   --packs <dir>   Root `packs` folder (contains techpowers/, forcepowers/, weapons/, classes/, …)
 *   --out <dir>     Output directory (default: <repo>/static/data/sw5e_compendium)
 *
 * Icons: run `node scripts/sync-sw5e-icons.mjs` against the same `packs` root so `_icon_url_app` resolves.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** Prefer local clone layout (`starwars5edata/sw5e/static/packs`), then alternate (`starwars52data/sw5e/packs`). */
function defaultSw5ePacksDir() {
  const cands = [
    path.join(repoRoot, "starwars5edata", "sw5e", "static", "packs"),
    path.join(repoRoot, "starwars52data", "sw5e", "packs"),
  ];
  for (const p of cands) {
    if (fs.existsSync(p)) return p;
  }
  return cands[0];
}

function parseArgs() {
  let packsDir = process.env.SW5E_PACKS_DIR
    ? path.resolve(process.env.SW5E_PACKS_DIR)
    : defaultSw5ePacksDir();
  let outDir = path.join(repoRoot, "static", "data", "sw5e_compendium");
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--packs" && process.argv[i + 1]) {
      packsDir = path.resolve(process.argv[++i]);
    } else if (a === "--out" && process.argv[i + 1]) {
      outDir = path.resolve(process.argv[++i]);
    }
  }
  return { packsDir, outDir };
}

function stripHtml(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[\/r\s+[^\]]+\]\]/gi, "")
    .replace(/\[\[#[^\]]+\]\]/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function walkJsonFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsonFiles(p, acc);
    else if (ent.name.toLowerCase().endsWith(".json")) acc.push(p);
  }
  return acc;
}

function relFromPacks(absFile, packsRoot) {
  return path.relative(packsRoot, absFile).replace(/\\/g, "/");
}

/** level folder: at-will → 0; level-3 → 3 */
function levelHintFromPath(relPath) {
  const parts = relPath.split("/");
  for (const p of parts) {
    if (/^at-will$/i.test(p)) return 0;
    const m = /^level-(\d+)$/i.exec(p);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function activationToCastingPeriod(act) {
  if (!act || !act.type) return "";
  const t = String(act.type).toLowerCase();
  const c = act.cost != null ? Number(act.cost) : 1;
  const cond = act.condition ? String(act.condition).trim() : "";
  const base = (() => {
    switch (t) {
      case "action":
        return c === 1 ? "1 action" : `${c} actions`;
      case "bonus":
        return "1 bonus action";
      case "reaction":
        return "1 reaction";
      case "minute":
        return c === 1 ? "1 minute" : `${c} minutes`;
      case "hour":
        return c === 1 ? "1 hour" : `${c} hours`;
      case "none":
        return "";
      default:
        return c && t ? `${c} ${t}` : t;
    }
  })();
  if (cond) return `${base}, ${cond}`.replace(/^,\s*/, "");
  return base;
}

function durationToString(d) {
  if (!d) return "";
  const u = String(d.units || "").toLowerCase();
  if (u === "inst") return "Instantaneous";
  if (d.value != null && d.units) return `${d.value} ${d.units}`;
  if (d.units) return String(d.units);
  return "";
}

function rangeToString(r) {
  if (!r) return "";
  const v = r.value;
  const u = r.units || "";
  if (v != null && v !== "" && u) return `${v} ${u}`;
  if (v != null && v !== "") return String(v);
  return "";
}

function damagePartsToString(parts) {
  if (!Array.isArray(parts) || !parts.length) return "";
  return parts
    .map((pair) => {
      if (!Array.isArray(pair) || !pair.length) return "";
      const dice = pair[0] || "";
      const dtype = pair[1] ? ` ${pair[1]}` : "";
      return `${dice}${dtype}`.trim();
    })
    .filter(Boolean)
    .join(" + ");
}

function saveAbilityToString(save) {
  if (!save || !save.ability) return "";
  return String(save.ability).toUpperCase();
}

function levelToTechJsonField(level, hint) {
  const L = level != null ? level : hint;
  if (L === 0 || L === "0") return "At-will";
  if (L == null) return "";
  return String(L);
}

function powerSchoolLabel(sys) {
  if (!sys || !sys.school) return "";
  const s = sys.school;
  if (typeof s === "string") return s;
  return s.label || s.name || s.value || "";
}

function powerPropertyTags(sys) {
  const p = sys?.properties;
  if (!p || typeof p !== "object") return "";
  const tags = [];
  if (p.concentration === true || p.concentration === "Yes") tags.push("Concentration");
  const prep = sys?.materials ?? p.materials ?? p.material;
  if (prep && String(prep).trim()) tags.push(`Materials (${String(prep).slice(0, 120)}${String(prep).length > 120 ? "…" : ""})`);
  return tags.join("; ");
}

function powerDocToGorogox(doc, relPath) {
  const sys = doc.system || {};
  const hint = levelHintFromPath(relPath);
  const lvl =
    sys.level !== undefined && sys.level !== null ? Number(sys.level) : hint !== null ? hint : null;

  const desc = stripHtml(sys.description?.value || sys.description || "");
  const conc =
    sys.properties?.concentration === true ||
    sys.concentration === true ||
    /concentration/i.test(JSON.stringify(sys.properties || {}))
      ? "Yes"
      : "";

  const relNorm = relPath.replace(/\\/g, "/");
  const forceRow = /^forcepowers\//i.test(relNorm);
  const cid = `${forceRow ? "fp" : "tp"}:${baseNameJson(relNorm)}`;

  const period = activationToCastingPeriod(sys.activation);

  const row = {
    _stable_id: cid,
    _fvtt_id: fvttUuid(doc),
    name: doc.name || "Unknown",
    level: levelToTechJsonField(lvl, hint),
    casting_period: period,
    casting_time: period,
    range: rangeToString(sys.range),
    duration: durationToString(sys.duration),
    concentration: conc,
    components: "",
    damage: damagePartsToString(sys.damage?.parts),
    saving_throw: saveAbilityToString(sys.save),
    source: typeof sys.source === "string" ? sys.source : sys.source?.value || "",
    description: desc,
    school: powerSchoolLabel(sys),
    power_properties: powerPropertyTags(sys),
    prerequisite: stripHtml(sys.prerequisite ?? "") || "",
    force_alignment:
      typeof sys.alignment === "string"
        ? sys.alignment
        : sys.details?.alignment || sys.forceAlign || "",
    _imported_from: relNorm,
  };
  augmentIconUrls(doc, row);
  return row;
}

/** Heuristic GorGox-like row for loot / equipment — best-effort across FVTT item types */
function fvttItemToCatalogRow(doc, relPath) {
  const sys = doc.system || {};
  const desc = stripHtml(sys.description?.value || sys.description || "");
  const nm = doc.name || "Unknown";
  const price =
    sys.price?.value ??
    sys.cost ??
    sys.quantity?.value ??
    null;
  const weight = sys.weight?.value ?? sys.weight ?? null;

  let subtype = "";
  if (doc.type === "weapon") subtype = sys.weaponType || sys.type || "";
  else if (doc.type === "equipment") subtype = sys.armor?.type || sys.type || "";

  return {
    Name: nm,
    Type: doc.type || "misc",
    Subtype: subtype,
    Source: typeof sys.source === "string" ? sys.source : sys.source?.custom || "",
    Description: desc,
    CostCredits: price,
    Weight: weight,
    _fvtt_type: doc.type,
    _imported_from: relPath,
  };
}

function shouldIncludePowerPath(relNorm) {
  return (
    relNorm.startsWith("techpowers/") ||
    relNorm.startsWith("forcepowers/")
  );
}

function classifyPowerBucket(relNorm) {
  if (relNorm.startsWith("forcepowers/")) return "force";
  if (relNorm.startsWith("techpowers/")) return "tech";
  return null;
}

/** Normalize pack-relative paths for robust folder checks (case, separators). */
function relLc(relNorm) {
  return relNorm.replace(/\\/g, "/").toLowerCase();
}

/** classes/fighter.json → fighter */
function classSlugFromClassesPath(relNorm) {
  const m = /^classes\/([^/]+)\.json$/i.exec(relNorm.replace(/\\/g, "/"));
  return m ? m[1].toLowerCase() : "";
}

/** archetypes/fighter/foo.json → { classSlug, fileBase } */
function archetypePathParts(relNorm) {
  const n = relNorm.replace(/\\/g, "/");
  const m = /^archetypes\/([^/]+)\/([^/]+)\.json$/i.exec(n);
  if (!m) return { classSlug: "", fileBase: "" };
  return { classSlug: m[1].toLowerCase(), fileBase: m[2].toLowerCase() };
}

/** classfeatures/scholar/foo.json → scholar */
function classSlugFromNestedPath(relNorm, segment) {
  const re = new RegExp("^" + segment + "/([^/]+)/", "i");
  const m = re.exec(relNorm.replace(/\\/g, "/"));
  return m ? m[1].toLowerCase() : "";
}

/** First folder under segment, e.g. archetypefeatures/scholar/foo → scholar */
function firstFolderAfterSegment(relNorm, segment) {
  const re = new RegExp("^" + segment + "/([^/]+)/", "i");
  const m = re.exec(relNorm.replace(/\\/g, "/"));
  return m ? m[1].toLowerCase() : "";
}

/** Safe basename without .json for stable ids */
function baseNameJson(relNorm) {
  let b = path.basename(relNorm.replace(/\\/g, "/"), ".json");
  b = String(b || "x").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return b || "x";
}

function fvttUuid(doc) {
  return doc._id || doc.uuid || "";
}

/** First <img src> in Foundry HTML description. */
function firstImgSrcInHtml(html) {
  if (!html || typeof html !== "string") return "";
  const m = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  return m ? m[1].trim() : "";
}

/** Map Foundry `systems/sw5e/…` paths to URLs under static/sw5e-assets (mirror sync-sw5e-icons output). */
function fvttPackPathToAppUrl(p) {
  if (!p || typeof p !== "string") return "";
  const s = p.trim().replace(/^\/+/, "");
  if (!s || s.startsWith("@")) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("systems/sw5e/"))
    return "/static/sw5e-assets/" + s.slice("systems/sw5e/".length);
  return "";
}

function augmentIconUrls(doc, row) {
  const sys = doc.system || {};
  const raw =
    (typeof doc.img === "string" && doc.img) ||
    (typeof sys.img === "string" && sys.img) ||
    "";
  let app = fvttPackPathToAppUrl(raw);
  if (!app) app = fvttPackPathToAppUrl(firstImgSrcInHtml(sys.description?.value || ""));
  if (!app) app = fvttPackPathToAppUrl(firstImgSrcInHtml(String(doc.description || "")));
  if (app) row._icon_url_app = app;
}

function main() {
  const { packsDir, outDir } = parseArgs();

  if (!fs.existsSync(packsDir)) {
    console.error(
      `[import-sw5e-packs] Packs folder not found:\n  ${packsDir}\n` +
        `Clone the SW5e system repo (e.g. github.com/sw5e-foundry/sw5e) and pass:\n` +
        `  node scripts/import-sw5e-packs.mjs --packs "<path-to>/packs"`
    );
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const packsRootNorm = packsDir.replace(/\\/g, "/");
  const allFiles = walkJsonFiles(packsDir);
  const relFiles = allFiles.map((abs) => relFromPacks(abs, packsDir));

  /** @type {Record<string, any[]>} */
  const buckets = {
    techpowers: [],
    forcepowers: [],
    weapons: [],
    armor: [],
    gear_misc: [],
    feats: [],
    maneuvers: [],
    species: [],
    classes: [],
    archetypes: [],
    archetypefeatures: [],
    classfeatures: [],
    speciesfeatures: [],
    invocations: [],
    backgrounds: [],
    fightingstyles: [],
    fightingmasteries: [],
    implements: [],
    kits: [],
    powers_other: [],
    other: [],
  };

  /** Generic catalog (everything keyed by pack top-level folder) */
  const byPackFolder = {};

  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const abs = allFiles[i];
    const rel = relFiles[i];
    const relNorm = rel.replace(/\\/g, "/");
    const top = relNorm.split("/")[0] || "root";

    if (!byPackFolder[top]) byPackFolder[top] = [];

    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (_) {
      errors++;
      continue;
    }

    if (!doc || typeof doc !== "object") {
      skipped++;
      continue;
    }

    const type = doc.type;

    try {
      if (relNorm.startsWith("weapons/")) {
        buckets.weapons.push(fvttItemToCatalogRow(doc, relNorm));
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (relNorm.startsWith("armor/")) {
        const sysA = doc.system || {};
        buckets.armor.push({
          name: doc.name,
          ...(sysA.armor ? { armorType: sysA.armor.type || "" } : {}),
          source: typeof sysA.source === "string" ? sysA.source : "",
          description: stripHtml(sysA.description?.value || ""),
          _imported_from: relNorm,
          _raw_system_subset: {
            armor: sysA.armor,
            price: sysA.price,
            weight: sysA.weight,
          },
        });
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }

      const rlc = relLc(relNorm);

      // Progression items: route by path BEFORE generic maneuver/feat/other types swallow them.
      if (rlc.startsWith("classfeatures/") || type === "classfeature") {
        const sys = doc.system || {};
        const slugFromPath = classSlugFromNestedPath(relNorm, "classfeatures");
        const classSlug =
          (typeof sys.classIdentifier === "string" && sys.classIdentifier.toLowerCase()) ||
          slugFromPath ||
          "";
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `cf:${classSlug || "unknown"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _class_slug: classSlug,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.classfeatures.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (rlc.startsWith("archetypefeatures/") || type === "archetypefeature") {
        const sys = doc.system || {};
        const seg = firstFolderAfterSegment(relNorm, "archetypefeatures");
        const classSlug =
          (typeof sys.classIdentifier === "string" && sys.classIdentifier.toLowerCase()) || seg || "";
        const archRef = String(
          sys.archetype || sys.archetypeIdentifier || sys.details?.identifier || ""
        ).toLowerCase();
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `af:${classSlug || "unknown"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _class_slug: classSlug,
          _archetype_ref: archRef,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.archetypefeatures.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }

      if (rlc.startsWith("speciesfeatures/") || type === "speciesfeature") {
        const sys = doc.system || {};
        const slugFromPath = classSlugFromNestedPath(relNorm, "speciesfeatures");
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `sf:${slugFromPath || "unknown"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _species_slug: slugFromPath,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.speciesfeatures.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (rlc.startsWith("invocations/")) {
        const sys = doc.system || {};
        const grp = firstFolderAfterSegment(relNorm, "invocations");
        const cid =
          (typeof sys.classIdentifier === "string" && sys.classIdentifier.toLowerCase()) || grp || "";
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `inv:${cid || grp || "x"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _class_slug: cid || grp || "",
          _invocation_group: grp,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.invocations.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (rlc.startsWith("backgrounds/") || type === "background") {
        const sys = doc.system || {};
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `bg:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.backgrounds.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (rlc.startsWith("fightingstyles/") || type === "fightingstyle") {
        const sys = doc.system || {};
        const grp = firstFolderAfterSegment(relNorm, "fightingstyles");
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `fst:${grp || "gen"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _fightingstyles_group: grp,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.fightingstyles.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (rlc.startsWith("fightingmasteries/") || type === "fightingmastery") {
        const sys = doc.system || {};
        const grp = firstFolderAfterSegment(relNorm, "fightingmasteries");
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `fm:${grp || "gen"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _fightingmasteries_group: grp,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.fightingmasteries.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (rlc.startsWith("implements/")) {
        const sys = doc.system || {};
        const grp = firstFolderAfterSegment(relNorm, "implements");
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `imp:${grp || "misc"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _implements_group: grp,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.implements.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }
      if (rlc.startsWith("kits/")) {
        const sys = doc.system || {};
        const grp = firstFolderAfterSegment(relNorm, "kits");
        const base = baseNameJson(relNorm);
        const row = {
          _stable_id: `kit:${grp || "misc"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _kits_group: grp,
          _imported_from: relNorm,
          description: stripHtml(sys.description?.value || ""),
          system: sys,
        };
        augmentIconUrls(doc, row);
        buckets.kits.push(row);
        byPackFolder[top].push({
          name: doc.name,
          fvtt_type: type,
          _imported_from: relNorm,
        });
        continue;
      }

      if (type === "power" && shouldIncludePowerPath(relNorm)) {
        const gor = powerDocToGorogox(doc, relNorm);
        const b = classifyPowerBucket(relNorm);
        if (b === "tech") buckets.techpowers.push(gor);
        else if (b === "force") buckets.forcepowers.push(gor);
        else buckets.powers_other.push({ ...gor, rel: relNorm });
      } else if (type === "weapon") {
        buckets.weapons.push(fvttItemToCatalogRow(doc, relNorm));
      } else if (type === "equipment") {
        const sys = doc.system || {};
        const armorHint = sys.armor?.type || relNorm.includes("/armor/");
        if (
          armorHint ||
          sys.armor ||
          doc.name?.toLowerCase().includes("armor") ||
          relNorm.startsWith("armor/")
        ) {
          buckets.armor.push({
            name: doc.name,
            ...(sys.armor ? { armorType: sys.armor.type || "" } : {}),
            source: typeof sys.source === "string" ? sys.source : "",
            description: stripHtml(sys.description?.value || ""),
            _imported_from: relNorm,
            _raw_system_subset: {
              armor: sys.armor,
              price: sys.price,
              weight: sys.weight,
            },
          });
        } else {
          buckets.gear_misc.push(fvttItemToCatalogRow(doc, relNorm));
        }
      } else if (relNorm.startsWith("adventuringgear/") || relNorm.startsWith("ammo/") || doc.type === "consumable") {
        buckets.gear_misc.push(fvttItemToCatalogRow(doc, relNorm));
      } else if (type === "feat" || rlc.startsWith("feats/")) {
        buckets.feats.push({
          Name: doc.name,
          source: typeof (doc.system?.source) === "string" ? doc.system.source : "",
          Descrption: stripHtml(doc.system?.description?.value || ""),
          _imported_from: relNorm,
        });
      } else if (rlc.startsWith("maneuvers/") || type === "maneuver") {
        buckets.maneuvers.push({
          name: doc.name,
          degree: doc.system?.degreeGrade ?? doc.system?.degree ?? "",
          source: typeof doc.system?.source === "string" ? doc.system.source : "",
          description: stripHtml(doc.system?.description?.value || ""),
          _imported_from: relNorm,
        });
      } else if (rlc.startsWith("species/") || type === "species") {
        const nf = /^species\/([^/]+)\.json$/i.exec(relNorm.replace(/\\/g, "/"));
        const sprow = {
          name: doc.name,
          source: typeof doc.system?.source === "string" ? doc.system.source : "",
          description: stripHtml(doc.system?.description?.value || ""),
          _species_slug: nf ? nf[1].toLowerCase() : "",
          _imported_from: relNorm,
        };
        augmentIconUrls(doc, sprow);
        buckets.species.push(sprow);
      } else if (rlc.startsWith("classes/") || type === "class") {
        const sys = doc.system || {};
        const slugFromFile = classSlugFromClassesPath(relNorm);
        const classSlug =
          (typeof sys.identifier === "string" && sys.identifier.toLowerCase()) || slugFromFile || "";
        const clsRow = {
          _stable_id: `class:${classSlug || slugFromFile || "unknown"}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          type: doc.type,
          _class_slug: classSlug || slugFromFile,
          source: typeof sys.source === "string" ? sys.source : "",
          description: stripHtml(sys.description?.value || ""),
          system: sys,
          _imported_from: relNorm,
        };
        augmentIconUrls(doc, clsRow);
        buckets.classes.push(clsRow);
      } else if (rlc.startsWith("archetypes/") || type === "archetype") {
        const sys = doc.system || {};
        const ap = archetypePathParts(relNorm);
        const clsId =
          (typeof sys.classIdentifier === "string" && sys.classIdentifier.toLowerCase()) ||
          ap.classSlug ||
          "";
        const base = baseNameJson(relNorm);
        const archRow = {
          _stable_id: `arch:${clsId || "unknown"}:${base}`,
          _fvtt_id: fvttUuid(doc),
          name: doc.name,
          class: clsId,
          _class_slug: clsId,
          source: typeof sys.source === "string" ? sys.source : "",
          description: stripHtml(sys.description?.value || ""),
          system: sys,
          _imported_from: relNorm,
        };
        augmentIconUrls(doc, archRow);
        buckets.archetypes.push(archRow);
      } else {
        buckets.other.push({
          name: doc.name,
          type: doc.type,
          description: stripHtml(doc.system?.description?.value || ""),
          _imported_from: relNorm,
        });
      }

      byPackFolder[top].push({
        name: doc.name,
        fvtt_type: type,
        _imported_from: relNorm,
      });
    } catch (_) {
      errors++;
    }
  }

  function writeJson(name, arr) {
    const p = path.join(outDir, name);
    fs.writeFileSync(p, JSON.stringify(arr, null, 2), "utf8");
    return arr.length;
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    packs_dir: packsDir,
    totals: {
      json_files_read: allFiles.length,
      parse_errors: errors,
      skipped_empty: skipped,
      tech_powers: writeJson("techpowers_from_packs.json", buckets.techpowers),
      force_powers: writeJson("force_powers_from_packs.json", buckets.forcepowers),
      weapons_rows: writeJson("weapons_from_packs.json", buckets.weapons),
      armor_rows: writeJson("armor_from_packs.json", buckets.armor),
      gear_and_misc_rows: writeJson("gear_misc_from_packs.json", buckets.gear_misc),
      feats_rows: writeJson("feats_from_packs.json", buckets.feats),
      maneuvers_rows: writeJson("maneuvers_from_packs.json", buckets.maneuvers),
      species_rows: writeJson("species_from_packs.json", buckets.species),
      classes_rows: writeJson("classes_from_packs.json", buckets.classes),
      archetypes_rows: writeJson("archetypes_from_packs.json", buckets.archetypes),
      class_features_rows: writeJson("classfeatures_from_packs.json", buckets.classfeatures),
      archetype_features_rows: writeJson(
        "archetypefeatures_from_packs.json",
        buckets.archetypefeatures
      ),
      speciesfeatures_rows: writeJson("speciesfeatures_from_packs.json", buckets.speciesfeatures),
      invocations_rows: writeJson("invocations_from_packs.json", buckets.invocations),
      backgrounds_rows: writeJson("backgrounds_from_packs.json", buckets.backgrounds),
      fighting_styles_rows: writeJson("fightingstyles_from_packs.json", buckets.fightingstyles),
      fighting_masteries_rows: writeJson(
        "fightingmasteries_from_packs.json",
        buckets.fightingmasteries
      ),
      implements_rows: writeJson("implements_from_packs.json", buckets.implements),
      kits_rows: writeJson("kits_from_packs.json", buckets.kits),
      powers_unrouted: writeJson("powers_other_from_packs.json", buckets.powers_other),
      other_compact: writeJson("other_from_packs.json", buckets.other),
    },
    pack_folder_file_counts: Object.fromEntries(
      Object.entries(byPackFolder).map(([k, v]) => [k, v.length])
    ),
  };

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log(`[import-sw5e-packs] Wrote JSON under:\n  ${outDir}`);
  console.log(JSON.stringify(manifest.totals, null, 2));
}

main();
