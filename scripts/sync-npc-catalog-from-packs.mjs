#!/usr/bin/env node
/**
 * Overwrites npc.json entries that exist under starwars5edata/sw5e/packs/monsters (recursive .json)
 * with stats, traits, actions, senses, lore (from pack actor data).
 *
 * Run: node scripts/sync-npc-catalog-from-packs.mjs
 * Then: node scripts/apply-npc-sw5e-icons.mjs  (keeps Avatar token URLs in sync)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const npcPath = path.join(repoRoot, "static", "data", "npc.json");
const monstersRoot = path.join(repoRoot, "starwars5edata", "sw5e", "packs", "monsters");
const iconRoot = path.join(repoRoot, "static", "sw5e-assets", "packs", "Icons");

function fvttPackPathToAppUrl(p) {
  if (!p || typeof p !== "string") return "";
  const s = p.trim();
  if (s.startsWith("systems/sw5e/")) return "/static/sw5e-assets/" + s.slice("systems/sw5e/".length);
  return "";
}

function fullMonsterArtAppUrl(fvttImg) {
  const base = fvttPackPathToAppUrl(fvttImg);
  if (!base) return "";
  if (/Avatar\.webp$/i.test(base)) return base;
  if (/Token\.webp$/i.test(base)) {
    const avatarUrl = base.replace(/Token\.webp$/i, "Avatar.webp");
    const rel = avatarUrl.replace(/^\/static\/sw5e-assets\//, "");
    const abs = path.join(repoRoot, "static", "sw5e-assets", rel);
    if (fs.existsSync(abs)) return avatarUrl;
    return base;
  }
  return base;
}

function normalizeIconName(s) {
  return String(s || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[''']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function isMonsterPortraitIcon(appUrl) {
  return /\/packs\/Icons\/monsters\/[^/]+\/(?:Avatar|Token)\.webp$/i.test(String(appUrl || ""));
}

let iconIndex = null;
function buildIconIndex() {
  if (iconIndex) return iconIndex;
  iconIndex = { byName: new Map(), byNameAndDir: new Map() };
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile() || !/\.(webp|png|jpe?g)$/i.test(ent.name)) continue;
      const rel = path.relative(iconRoot, full).replace(/\\/g, "/");
      const dirRel = path.dirname(rel).replace(/\\/g, "/");
      const base = path.basename(ent.name, path.extname(ent.name));
      const key = normalizeIconName(base);
      if (!key) continue;
      const appUrl = "/static/sw5e-assets/packs/Icons/" + rel;
      if (!iconIndex.byName.has(key)) iconIndex.byName.set(key, appUrl);
      iconIndex.byNameAndDir.set(dirRel + "|" + key, appUrl);
    }
  }
  walk(iconRoot);
  return iconIndex;
}

function namedIconAppUrl(name, preferredDirs = []) {
  const key = normalizeIconName(name);
  if (!key) return "";
  const idx = buildIconIndex();
  for (const dir of preferredDirs) {
    const hit = idx.byNameAndDir.get(dir + "|" + key);
    if (hit) return hit;
  }
  return idx.byName.get(key) || "";
}

function itemImgAppUrl(fvttImg, itemName, preferredDirs = []) {
  const direct = fvttPackPathToAppUrl(fvttImg);
  const named = namedIconAppUrl(itemName, preferredDirs);
  if (named && (!direct || isMonsterPortraitIcon(direct))) return named;
  return direct || named || "";
}

function nameSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[''']/g, "")
    .replace(/,/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function walkJsonFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsonFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function stripHtml(h) {
  if (!h || typeof h !== "string") return "";
  return h
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseCond(s) {
  const t = String(s || "").replace(/_/g, " ");
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function dmgLabel(code) {
  const m = {
    acid: "Acid",
    cold: "Cold",
    fire: "Fire",
    force: "Force",
    ion: "Ion",
    kinetic: "Kinetic",
    lightning: "Lightning",
    necrotic: "Necrotic",
    poison: "Poison",
    psychic: "Psychic",
    radiant: "Radiant",
    sonic: "Sonic",
    energy: "Energy",
    thunder: "Thunder",
    bludgeoning: "Bludgeoning",
    piercing: "Piercing",
    slashing: "Slashing",
  };
  return m[String(code).toLowerCase()] || titleCaseCond(code);
}

function formatCr(cr) {
  if (cr === null || cr === undefined) return "0";
  if (typeof cr === "string") return cr;
  const n = Number(cr);
  if (Number.isNaN(n)) return String(cr);
  if (Math.abs(n - 0.125) < 1e-6) return "1/8";
  if (Math.abs(n - 0.25) < 1e-6) return "1/4";
  if (Math.abs(n - 0.5) < 1e-6) return "1/2";
  if (Number.isInteger(n)) return String(n);
  return String(cr);
}

function formatHpFormula(f) {
  if (!f || typeof f !== "string") return "";
  return f.replace(/(\d+d\d+)([+-]\d+)/gi, "$1 $2").trim();
}

function formatMovement(mov) {
  if (!mov || typeof mov !== "object") return "30 ft.";
  const u = mov.units || "ft";
  const parts = [];
  if (mov.walk) parts.push(`${mov.walk} ${u}.`);
  if (mov.burrow) parts.push(`burrow ${mov.burrow} ${u}.`);
  if (mov.climb) parts.push(`climb ${mov.climb} ${u}.`);
  if (mov.swim) parts.push(`swim ${mov.swim} ${u}.`);
  if (mov.fly) parts.push(`fly ${mov.fly} ${u}.`);
  if (mov.roll) parts.push(`roll ${mov.roll} ${u}.`);
  if (parts.length) return parts.join(" ");
  return `30 ${u}.`;
}

const SKILL_LABELS = {
  acr: "Acrobatics",
  ani: "Animal Handling",
  arc: "Arcana",
  ath: "Athletics",
  dec: "Deception",
  hist: "History",
  ins: "Insight",
  itm: "Intimidation",
  inv: "Investigation",
  lor: "Lore",
  med: "Medicine",
  nat: "Nature",
  prc: "Perception",
  prf: "Performance",
  prs: "Persuasion",
  rel: "Religion",
  slt: "Sleight of Hand",
  ste: "Stealth",
  sur: "Survival",
  tec: "Technology",
  pilot: "Piloting",
};

function skillsCsv(skills) {
  if (!skills || typeof skills !== "object") return "";
  const rows = [];
  for (const [key, sk] of Object.entries(skills)) {
    if (!sk || typeof sk !== "object") continue;
    const prof = sk.prof != null ? Number(sk.prof) : 0;
    const val = sk.value != null ? Number(sk.value) : 0;
    if (prof <= 0 && val <= 0) continue;
    const label = SKILL_LABELS[key] || key.toUpperCase();
    const total = sk.total != null ? sk.total : sk.mod;
    if (total === undefined || total === null) continue;
    rows.push(`${label} ${total >= 0 ? "+" : ""}${total}`);
  }
  return rows.join(", ");
}

function formatSenses(attr, skills) {
  const s = attr?.senses || {};
  const u = s.units || "ft";
  const parts = [];
  if (s.darkvision) parts.push(`darkvision ${s.darkvision} ${u}`);
  if (s.blindsight) parts.push(`blindsight ${s.blindsight} ${u}`);
  if (s.tremorsense) parts.push(`tremorsense ${s.tremorsense} ${u}`);
  if (s.truesight) parts.push(`truesight ${s.truesight} ${u}`);
  if (s.special && String(s.special).trim()) parts.push(String(s.special).trim());
  const prc = skills?.prc;
  if (prc && prc.passive != null) parts.push(`passive Perception ${prc.passive}`);
  return parts.length ? parts.join(", ") : "-";
}

function formatLanguages(lang) {
  if (!lang) return "-";
  if (lang.custom && String(lang.custom).trim()) return String(lang.custom).trim();
  const v = lang.value;
  if (Array.isArray(v) && v.length) return v.map((x) => titleCaseCond(x)).join(", ");
  return "-";
}

function formatDamageList(tr, key) {
  const o = tr?.[key];
  if (!o) return "";
  const arr = o.value;
  const custom = o.custom && String(o.custom).trim();
  const bits = [];
  if (Array.isArray(arr) && arr.length) bits.push(arr.map(dmgLabel).join(", "));
  if (custom) bits.push(custom);
  return bits.join("; ");
}

function formatConditionList(tr) {
  const o = tr?.ci;
  if (!o) return "";
  const arr = o.value;
  const custom = o.custom && String(o.custom).trim();
  const bits = [];
  if (Array.isArray(arr) && arr.length) bits.push(arr.map((x) => titleCaseCond(x)).join(", "));
  if (custom) bits.push(custom);
  return bits.join("; ");
}

function normalizeWeaponDescription(html, actionType) {
  let t = stripHtml(html).replace(/\s+/g, " ").trim();
  if (!t) return "";
  const isRanged = /^\s*ranged/i.test(t) || actionType === "rwak";
  if (!/^Melee\s+Weapon\s+Attack/i.test(t) && !/^Ranged\s+Weapon\s+Attack/i.test(t)) {
    if (isRanged) t = "Ranged Weapon Attack " + t;
    else t = "Melee Weapon Attack " + t;
  }
  t = t.replace(/^Melee\s+Weapon\s+Attack\s*:?\s*/i, "Melee Weapon Attack: ");
  t = t.replace(/^Ranged\s+Weapon\s+Attack\s*:?\s*/i, "Ranged Weapon Attack: ");
  t = t.replace(/Melee\s+Weapon\s+Attack\s+/i, "Melee Weapon Attack: ");
  t = t.replace(/Ranged\s+Weapon\s+Attack\s+/i, "Ranged Weapon Attack: ");
  if (!/\bto hit\b/i.test(t)) {
    t = t.replace(/:\s*\+?(\d+)\s*,\s*Reach/i, ": +$1 to hit, reach");
    t = t.replace(/:\s*\+?(\d+)\s*,\s*range/i, ": +$1 to hit, range");
  }
  t = t.replace(/Hit\s*:\s*/gi, "Hit: ");
  return t;
}

function actionLineFromItem(it) {
  const nm = String(it.name || "Action").replace(/\.$/, "").trim();
  const sys = it.system || {};
  if (it.type === "weapon") {
    const body = normalizeWeaponDescription(sys.description?.value || "", sys.actionType);
    return body ? `${nm} . ${body}` : "";
  }
  const desc = stripHtml(sys.description?.value || "");
  return desc ? `${nm} . ${desc}` : "";
}

function categorizeItems(items) {
  const weapons = [];
  const actionFeats = [];
  const bonusFeats = [];
  const traitFeats = [];
  const reactions = [];
  const legendary = [];
  const sorted = [...(items || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  for (const it of sorted) {
    const act = String(it.system?.activation?.type || "").toLowerCase();
    if (it.type === "weapon") {
      weapons.push(it);
      continue;
    }
    if (it.type !== "feat") continue;
    if (act === "legendary") {
      legendary.push(it);
      continue;
    }
    if (act === "reaction") {
      reactions.push(it);
      continue;
    }
    if (act === "bonus") {
      bonusFeats.push(it);
      continue;
    }
    if (act === "action") {
      actionFeats.push(it);
      continue;
    }
    traitFeats.push(it);
  }
  return { weapons, actionFeats, bonusFeats, traitFeats, reactions, legendary };
}

function buildActionsText(cat) {
  const multi = cat.actionFeats.filter((f) => /multiattack/i.test(f.name));
  const otherActs = cat.actionFeats.filter((f) => !/multiattack/i.test(f.name));
  const order = [...multi, ...cat.weapons, ...otherActs];
  const lines = order.map(actionLineFromItem).filter(Boolean);
  return lines.join(" ");
}

function buildTraitBlurbs(cat) {
  return cat.traitFeats
    .map((f) => {
      const n = String(f.name || "").replace(/\.$/, "").trim();
      const t = stripHtml(f.system?.description?.value || "");
      return n && t ? `${n} ${t}` : t || n;
    })
    .filter(Boolean);
}

function buildReactionText(cat) {
  return cat.reactions
    .map((f) => {
      const n = String(f.name || "").replace(/\.$/, "").trim();
      const t = stripHtml(f.system?.description?.value || "");
      return n && t ? `${n} . ${t}` : t || n;
    })
    .filter(Boolean)
    .join(" ");
}

function buildBonusActionsText(cat) {
  return cat.bonusFeats
    .map((f) => {
      const n = String(f.name || "").replace(/\.$/, "").trim();
      const t = stripHtml(f.system?.description?.value || "");
      return n && t ? `${n} . ${t}` : t || n;
    })
    .filter(Boolean)
    .join(" ");
}

function mapWeaponOrFeatToActionStruct(it) {
  const nm = String(it?.name || "Action").replace(/\.$/, "").trim();
  let description = "";
  if (it.type === "weapon") {
    description = stripHtml(
      normalizeWeaponDescription(it.system?.description?.value || "", it.system?.actionType)
    );
  } else {
    description = stripHtml(it?.system?.description?.value || "");
  }
  const img = itemImgAppUrl(it?.img || "", nm, [
    "Monster Traits",
    "Martial Blasters",
    "Simple Blasters",
    "Martial Vibroweapons",
    "Simple Vibroweapons",
  ]);
  return { name: nm, description, img };
}

/** Monster pack Actions column in sheet order — each row carries the item portrait for the DM bar */
function buildSw5eActionItems(cat) {
  const multi = cat.actionFeats.filter((f) => /multiattack/i.test(f.name));
  const otherActs = cat.actionFeats.filter((f) => !/multiattack/i.test(f.name));
  const order = [...multi, ...cat.weapons, ...otherActs];
  return order.map(mapWeaponOrFeatToActionStruct).filter((x) => x.name || x.description);
}

function mapLegendaryItemStructs(cat) {
  return (cat.legendary || [])
    .map((f) => {
      const nm = String(f.name || "").replace(/\.$/, "").trim();
      const t = stripHtml(f.system?.description?.value || "");
      const costRaw = f.system?.activation?.cost;
      const cost =
        costRaw != null && Number.isFinite(Number(costRaw)) ? Math.max(1, Number(costRaw)) : 1;
      return {
        name: nm,
        description: t,
        img: itemImgAppUrl(f.img || "", nm, ["Monster Traits"]),
        cost,
      };
    })
    .filter((x) => x.name || x.description);
}

/** Structured trait/reaction rows for the app (named chips + monster item icons). */
function mapFeatLikeItemsToStructured(items) {
  return (items || [])
    .map((it) => ({
      name: String(it?.name || "")
        .replace(/\.$/, "")
        .trim(),
      description: stripHtml(it?.system?.description?.value || ""),
      img: itemImgAppUrl(it?.img || "", it?.name || "", ["Monster Traits"]),
    }))
    .filter((x) => x.name || x.description);
}

function buildLegendaryText(actor) {
  const cat = categorizeItems(actor.items || []);
  const lines = cat.legendary.map((f) => {
    const n = String(f.name || "").replace(/\.$/, "").trim();
    const t = stripHtml(f.system?.description?.value || "");
    const cost = f.system?.activation?.cost != null ? ` (${f.system.activation.cost} action)` : "";
    return `${n}${cost}. ${t}`;
  });
  if (!lines.length) return "";
  const name = actor.name || "Creature";
  const header = `${name} can take 3 legendary actions, choosing from the options below. Only one legendary action can be used at a time and only at the end of another creature's turn. ${name} regains spent legendary actions at the start of their turn.`;
  return `${header} ${lines.join(" ")}`;
}

function lorePlain(actor, maxLen) {
  const html = actor.system?.details?.biography?.value || "";
  let t = stripHtml(html);
  if (!t) return "";
  t = t.replace(/\n{3,}/g, "\n\n");
  if (t.length > maxLen) t = t.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  return t;
}

function sizeDisplay(sz) {
  if (!sz) return "Medium";
  const s = String(sz).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeDisplay(details) {
  const v = details?.type?.value || details?.type || "";
  if (!v) return "Unknown";
  const s = String(v).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function abilityChunk(ab) {
  const sys = ab?.system || {};
  const abilities = sys.abilities || {};
  const order = ["str", "dex", "con", "int", "wis", "cha"];
  const parts = [];
  for (const k of order) {
    const a = abilities[k];
    if (!a || a.value == null) continue;
    const mod = a.mod != null ? a.mod : Math.floor((Number(a.value) - 10) / 2);
    const sign = mod >= 0 ? "+" : "";
    parts.push(`${k.toUpperCase()} ${a.value} (${sign}${mod})`);
  }
  return parts.join(" ");
}

function buildRawBlock(actor) {
  const name = actor.name || "Creature";
  const sys = actor.system || {};
  const det = sys.details || {};
  const tr = sys.traits || {};
  const attr = sys.attributes || {};
  const skills = sys.skills || {};
  const sz = sizeDisplay(tr.size);
  const typ = typeDisplay(det);
  const align = det.alignment || "Unaligned";
  const ac = attr.ac || {};
  const acStr = ac.flat != null ? `${ac.flat}${ac.formula ? ` (${ac.formula})` : ""}` : "10";
  const hp = attr.hp || {};
  const hpStr =
    hp.max != null
      ? `${hp.max}${hp.formula ? ` (${formatHpFormula(hp.formula)})` : ""}`
      : "1";
  const spd = formatMovement(attr.movement || {});
  const abLine = abilityChunk(actor);
  const skillStr = skillsCsv(skills);
  const dv = formatDamageList(tr, "dv");
  const dr = formatDamageList(tr, "dr");
  const di = formatDamageList(tr, "di");
  const ci = formatConditionList(tr);
  const senses = formatSenses(attr, skills);
  const langs = formatLanguages(tr.languages);
  const cr = formatCr(det.cr);
  const xp = det.xp?.value != null ? det.xp.value : "";
  const cat = categorizeItems(actor.items || []);
  const traitBlurbs = buildTraitBlurbs(cat);
  const actionsStr = buildActionsText(cat);
  const init = attr.init?.total != null ? attr.init.total : null;
  const dexMod = sys.abilities?.dex?.mod != null ? sys.abilities.dex.mod : 0;
  const initSeg =
    init != null && init !== dexMod ? ` Initiative ${init >= 0 ? "+" : ""}${init}` : "";

  let defenseSeg = "";
  if (dv) defenseSeg += ` Damage Vulnerabilities ${dv}`;
  if (dr) defenseSeg += ` Damage Resistances ${dr}`;
  if (di) defenseSeg += ` Damage Immunities ${di}`;
  if (ci) defenseSeg += ` Condition Immunities ${ci}`;

  const traitsSeg = traitBlurbs.length ? ` Traits ${traitBlurbs.join(" ")}` : "";
  const challengeSeg = xp !== "" ? ` Challenge ${cr} (${xp} XP)` : ` Challenge ${cr}`;

  return `${name} Export to Roll20 ${sz} ${typ.toLowerCase()}, ${align} Armor Class ${acStr} Hit Points ${hpStr} Speed ${spd}${initSeg} ${abLine}${
    skillStr ? ` Skills ${skillStr}` : ""
  }${defenseSeg} Senses ${senses} Languages ${langs}${challengeSeg}${traitsSeg} Actions ${actionsStr}`;
}

function npcFromActor(actor) {
  const sys = actor.system || {};
  const det = sys.details || {};
  const tr = sys.traits || {};
  const attr = sys.attributes || {};
  const hp = attr.hp || {};
  const ac = attr.ac || {};
  const cat = categorizeItems(actor.items || []);

  const npc = {
    name: actor.name,
    size: sizeDisplay(tr.size),
    type: typeDisplay(det),
    challenge: formatCr(det.cr),
    alignment: det.alignment || "Unaligned",
    armor_class: ac.flat != null ? `${ac.flat}${ac.formula ? ` (${ac.formula})` : ""}` : "10",
    hit_points: hp.max != null ? `${hp.max}${hp.formula ? ` (${formatHpFormula(hp.formula)})` : ""}` : "1",
    speed: formatMovement(attr.movement || {}),
    senses: formatSenses(attr, sys.skills || {}),
    languages: formatLanguages(tr.languages),
    actions: buildActionsText(cat),
    raw_block: buildRawBlock(actor),
  };

  const dv = formatDamageList(tr, "dv");
  const dr = formatDamageList(tr, "dr");
  const di = formatDamageList(tr, "di");
  const ci = formatConditionList(tr);
  if (dv) npc.damage_vulnerabilities = dv;
  if (dr) npc.damage_resistances = dr;
  if (di) npc.damage_immunities = di;
  if (ci) npc.condition_immunities = ci;

  const rx = buildReactionText(cat);
  if (rx) npc.reactions = rx;

  const bx = buildBonusActionsText(cat);
  if (bx) npc.bonus_actions = bx;

  const leg = buildLegendaryText(actor);
  if (leg) npc.legendary_actions = leg;

  const lore = lorePlain(actor, 12000);
  if (lore) npc.lore = lore;

  const traitStruct = mapFeatLikeItemsToStructured(cat.traitFeats);
  if (traitStruct.length) npc.sw5e_trait_items = traitStruct;

  const reactionStruct = mapFeatLikeItemsToStructured(cat.reactions);
  if (reactionStruct.length) npc.sw5e_reaction_items = reactionStruct;

  const actionStructs = buildSw5eActionItems(cat);
  if (actionStructs.length) npc.sw5e_action_items = actionStructs;

  const bonusStructs = mapFeatLikeItemsToStructured(cat.bonusFeats);
  if (bonusStructs.length) npc.sw5e_bonus_action_items = bonusStructs;

  const legendaryStructs = mapLegendaryItemStructs(cat);
  if (legendaryStructs.length) npc.sw5e_legendary_items = legendaryStructs;

  const icon = fullMonsterArtAppUrl(actor.img || "");
  if (icon) {
    npc.sw5e_portrait_url = icon;
    npc.sw5e_token_url = icon;
  }

  return npc;
}

function loadActorJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const npcs = JSON.parse(fs.readFileSync(npcPath, "utf8"));
  if (!Array.isArray(npcs)) {
    console.error("npc.json must be an array");
    process.exit(1);
  }

  const files = walkJsonFiles(monstersRoot);
  const byName = new Map();
  const bySlug = new Map();

  for (const fp of files) {
    const actor = loadActorJson(fp);
    if (!actor || !actor.name) continue;
    const row = { actor, fp };
    byName.set(actor.name.toLowerCase(), row);
    const base = path.basename(fp, ".json");
    const s1 = nameSlug(actor.name);
    const s2 = nameSlug(base.replace(/-/g, " "));
    if (s1 && !bySlug.has(s1)) bySlug.set(s1, row);
    if (s2 && s2 !== s1 && !bySlug.has(s2)) bySlug.set(s2, row);
  }

  let updated = 0;
  let skipped = 0;

  const out = npcs.map((npc) => {
    if (!npc || typeof npc.name !== "string") return npc;
    const key = npc.name.trim().toLowerCase();
    let row = byName.get(key);
    if (!row) row = bySlug.get(nameSlug(npc.name.trim()));
    if (!row) {
      skipped++;
      return npc;
    }
    updated++;
    const merged = npcFromActor(row.actor);
    return merged;
  });

  fs.writeFileSync(npcPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[sync-npc-catalog-from-packs] updated=${updated} unchangedNoPackMatch=${skipped} total=${out.length}`
  );
}

main();
