#!/usr/bin/env node
/**
 * Copy Foundry SW5e pack Icons into static/sw5e-assets/packs/Icons so URLs like:
 *   systems/sw5e/packs/Icons/Classes/engineer.webp
 * map via import script helpers to:
 *   /static/sw5e-assets/packs/Icons/Classes/engineer.webp
 *
 * Usage:
 *   node scripts/sync-sw5e-icons.mjs --packs "C:/path/to/sw5e/packs"
 *   SW5E_PACKS_DIR=... node scripts/sync-sw5e-icons.mjs
 *
 * Icons are normally at <packs>/Icons relative to JSON packs.
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
  let dry = false;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--packs" && process.argv[i + 1]) {
      packsDir = path.resolve(process.argv[++i]);
    } else if (a === "--dry-run") dry = true;
  }
  return { packsDir, dry };
}

function copyRecursive(src, dest, dry, stats) {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    if (!dry && !fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name), dry, stats);
    }
    return;
  }
  if (!dry) {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, dest);
  }
  stats.files += 1;
  stats.bytes += st.size || 0;
}

function main() {
  const { packsDir, dry } = parseArgs();
  const iconsSrc = path.join(packsDir, "Icons");
  const destRoot = path.join(repoRoot, "static", "sw5e-assets", "packs", "Icons");

  if (!fs.existsSync(packsDir)) {
    console.error(`[sync-sw5e-icons] Packs folder not found:\n  ${packsDir}`);
    process.exit(1);
  }
  if (!fs.existsSync(iconsSrc)) {
    console.error(
      `[sync-sw5e-icons] No Icons folder at:\n  ${iconsSrc}\n` +
        `Ensure your SW5e clone includes packs/Icons (webp/png/svg).`
    );
    process.exit(1);
  }

  const stats = { files: 0, bytes: 0 };
  console.log(
    `[sync-sw5e-icons] ${dry ? "(dry-run) " : ""}Copy\n  from ${iconsSrc}\n  to   ${destRoot}`
  );
  copyRecursive(iconsSrc, destRoot, dry, stats);
  console.log(`[sync-sw5e-icons] Done — ${stats.files} files (${(stats.bytes / (1024 * 1024)).toFixed(2)} MiB)`);
}

main();
