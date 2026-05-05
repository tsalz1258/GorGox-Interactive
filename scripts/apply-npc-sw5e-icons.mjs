#!/usr/bin/env node
/**
 * Match static/data/npc.json entries to SW5e pack JSON under starwars5edata/sw5e/packs/monsters (recursive).
 * By actor name (case-insensitive) or slug == file basename (e.g. bantha-adult.json).
 * Adds sw5e_token_url + sw5e_portrait_url under /static/sw5e-assets/ (after sync-sw5e-icons).
 *
 * Usage: node scripts/apply-npc-sw5e-icons.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const npcPath = path.join(repoRoot, "static", "data", "npc.json");
const monstersRoot = path.join(repoRoot, "starwars5edata", "sw5e", "packs", "monsters");

function fvttPackPathToAppUrl(p) {
  if (!p || typeof p !== "string") return "";
  const s = p.trim();
  if (s.startsWith("systems/sw5e/")) return "/static/sw5e-assets/" + s.slice("systems/sw5e/".length);
  return "";
}

/**
 * Prefer Avatar.webp in the same Icons folder (full art). If only Token.webp exists on disk after sync, keep Token.
 */
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

function readMonsterMeta(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const img = typeof data.img === "string" ? data.img.trim() : "";
  if (!name || !img) return null;
  return { name, img, filePath };
}

function main() {
  if (!fs.existsSync(npcPath)) {
    console.error("Missing", npcPath);
    process.exit(1);
  }
  if (!fs.existsSync(monstersRoot)) {
    console.error("Missing monsters pack dir:", monstersRoot);
    process.exit(1);
  }

  const files = walkJsonFiles(monstersRoot);
  const byNameLower = new Map();
  const bySlug = new Map();

  for (const fp of files) {
    const meta = readMonsterMeta(fp);
    if (!meta) continue;
    const base = path.basename(fp, ".json");
    const slugFromFile = nameSlug(base.replace(/-/g, " ")) || base;

    const portraitApp = fullMonsterArtAppUrl(meta.img);
    if (!portraitApp) continue;

    // Map tokens use full Avatar art (not Token.webp ring)
    const tokenApp = portraitApp;

    const row = { portraitApp, tokenApp, packName: meta.name, file: path.relative(repoRoot, fp) };

    byNameLower.set(meta.name.toLowerCase(), row);

    const s1 = nameSlug(meta.name);
    if (s1 && !bySlug.has(s1)) bySlug.set(s1, row);
    const s2 = nameSlug(base.replace(/-/g, " "));
    if (s2 && s2 !== s1 && !bySlug.has(s2)) bySlug.set(s2, row);
    if (slugFromFile && !bySlug.has(slugFromFile)) bySlug.set(slugFromFile, row);
  }

  const npcs = JSON.parse(fs.readFileSync(npcPath, "utf8"));
  if (!Array.isArray(npcs)) {
    console.error("npc.json is not an array");
    process.exit(1);
  }

  let byExact = 0;
  let bySlugM = 0;
  let noMatch = 0;
  let removed = 0;

  for (const npc of npcs) {
    if (!npc || typeof npc.name !== "string") continue;
    const n = npc.name.trim();
    const lower = n.toLowerCase();
    let row = byNameLower.get(lower);
    if (!row) {
      const sg = nameSlug(n);
      row = bySlug.get(sg);
      if (row) bySlugM++;
    } else byExact++;

    if (row) {
      npc.sw5e_portrait_url = row.portraitApp;
      npc.sw5e_token_url = row.tokenApp;
    } else {
      if ("sw5e_portrait_url" in npc) {
        delete npc.sw5e_portrait_url;
        removed++;
      }
      if ("sw5e_token_url" in npc) {
        delete npc.sw5e_token_url;
        removed++;
      }
      noMatch++;
    }
  }

  const pretty = JSON.stringify(npcs, null, 2) + "\n";
  fs.writeFileSync(npcPath, pretty, "utf8");

  const matched = npcs.length - noMatch;
  console.log(
    `[apply-npc-sw5e-icons] total NPCs=${npcs.length} matched=${matched} (exactNameHits=${byExact}, slugFallbackHits=${bySlugM}) noMatch=${noMatch} removedStaleSw5eFields=${removed}`
  );
}

main();
