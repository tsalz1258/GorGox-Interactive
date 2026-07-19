import {
    loadSw5eRegistry,
    resolveArchetypeGrant,
    resolveGrantedFeatureName,
    getInvocationFvttToNameMap,
    getArchetypeFeatureFvttToNameMap
} from './registry.js';
import { proficiencyBonusFromCharacterLevel, abilityMod } from './calculations.js';
import {
    getAdvancementsAtLevel,
    getAbilityScoreImprovementLevels,
    getSubclassChoiceAtLevel,
    getClassItemGrantsAtLevel,
    getOtherItemChoicesAtLevel,
    getArchetypeItemGrantsAtLevel,
    extractTechPowersKnownCount,
    extractForcePowersKnownCount,
    getTechPowersLearnedAtLevel,
    getMaxTechPowerLevelForClassLevel
} from './progression.js';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function plainSnippet(text, max) {
    const t = String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!max || t.length <= max) return t;
    return t.slice(0, max) + '…';
}

function rowDescription(row) {
    return (
        row?.description ||
        row?.Description ||
        row?.Descrption ||
        (row?.system && row.system.description && row.system.description.value) ||
        ''
    );
}

function renderChoicePreview(title, metaBits, description, emptyText) {
    const cleanTitle = String(title || '').trim();
    const cleanDesc = plainSnippet(description, 1200);
    if (!cleanTitle && !cleanDesc) {
        return `<p class="sw5e-wiz-hint">${esc(emptyText || 'Choose an option to preview details.')}</p>`;
    }
    const meta = (metaBits || []).filter(Boolean);
    return `<div class="sw5e-lu-preview-title">${esc(cleanTitle || 'Details')}</div>
      ${meta.length ? `<div class="sw5e-lu-preview-meta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      <p>${esc(cleanDesc || 'No description available in the bundled compendium.')}</p>`;
}

const ABILITIES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
const COMPENDIUM_BASE = '/static/data/sw5e_compendium';
let techPowerRowsPromise = null;

async function getTechPowerRows() {
    if (!techPowerRowsPromise) {
        techPowerRowsPromise = fetch(`${COMPENDIUM_BASE}/techpowers_from_packs.json`, { cache: 'no-cache' })
            .then((r) => {
                if (!r.ok) throw new Error(`Failed to load tech powers: ${r.status}`);
                return r.json();
            })
            .catch(() => []);
    }
    return techPowerRowsPromise;
}

function normalizePowerName(s) {
    return String(s || '')
        .trim()
        .toLowerCase();
}

function powerLevelNumber(raw) {
    const s = String(raw ?? '')
        .trim()
        .toLowerCase();
    if (!s || s === 'at-will' || s === 'at will' || s === '0') return 0;
    const m = s.match(/\d+/);
    return m ? parseInt(m[0], 10) : 99;
}

function collectKnownPowerNames(charData, kind) {
    const out = new Set();
    const listKey = kind === 'force' ? 'forcePowers' : 'techPowers';
    const detailKey = kind === 'force' ? 'forcePowerDetails' : 'techPowerDetails';
    function add(v) {
        const name = typeof v === 'string' ? v : v && (v.name || v.Name);
        if (name) out.add(normalizePowerName(name));
    }
    if (Array.isArray(charData[listKey])) charData[listKey].forEach(add);
    if (Array.isArray(charData[detailKey])) charData[detailKey].forEach(add);
    (charData.classes || []).forEach((cls) => {
        if (Array.isArray(cls[listKey])) cls[listKey].forEach(add);
        if (Array.isArray(cls[detailKey])) cls[detailKey].forEach(add);
    });
    return out;
}

function addKnownTechPower(charData, powerRow) {
    if (!powerRow || !powerRow.name) return;
    const name = powerRow.name;
    if (!Array.isArray(charData.techPowers)) charData.techPowers = [];
    if (!Array.isArray(charData.techPowerDetails)) charData.techPowerDetails = [];
    if (!charData.classes) charData.classes = [{}];
    if (!charData.classes[0]) charData.classes[0] = {};
    if (!Array.isArray(charData.classes[0].techPowers)) charData.classes[0].techPowers = [];
    if (!Array.isArray(charData.classes[0].techPowerDetails)) charData.classes[0].techPowerDetails = [];

    const known = collectKnownPowerNames(charData, 'tech');
    if (known.has(normalizePowerName(name))) return;
    const detail = {
        name,
        level: powerRow.level ?? '',
        source: powerRow.source || '',
        _stable_id: powerRow._stable_id || '',
        _fvtt_id: powerRow._fvtt_id || ''
    };
    charData.techPowers.push(name);
    charData.techPowerDetails.push(detail);
    charData.classes[0].techPowers.push(name);
    charData.classes[0].techPowerDetails.push(detail);
}

function addLevelUpFeat(charData, featName, level) {
    if (!featName) return;
    if (!Array.isArray(charData.feats)) charData.feats = [];
    const key = normalizePowerName(featName);
    const exists = charData.feats.some((feat) => normalizePowerName(typeof feat === 'string' ? feat : feat && (feat.name || feat.Name)) === key);
    if (!exists) charData.feats.push({ name: featName, source: 'level-up', level });
}

function deriveClassStemFromSheet(charData, charRow) {
    const raw =
        charData.classes && charData.classes[0] ? charData.classes[0].name : charData.class || charRow?.class || '';
    return String(raw)
        .trim()
        .replace(/\s+\d+$/, '')
        .replace(/\s*\/.*$/, '')
        .trim();
}

function findClassDoc(charData, registry, charRow) {
    const stem = deriveClassStemFromSheet(charData, charRow);
    const slugFromChar =
        charData.classes &&
        charData.classes[0] &&
        (charData.classes[0].classSlug || charData.classes[0]._class_slug || charData.classes[0]._classSlug);
    const first = stem.split(/\s+/)[0]?.toLowerCase() || '';
    const slugGuess = first.replace(/[^a-z0-9]/g, '');
    const stemTokens = stem
        .toLowerCase()
        .split(/\s+/)
        .map((x) => x.replace(/[^a-z0-9]/g, ''))
        .filter(Boolean);
    if (slugFromChar) {
        const doc = registry.classesBySlug.get(String(slugFromChar).toLowerCase());
        if (doc) return doc;
    }
    for (let i = 0; i < registry.classes.length; i++) {
        const c = registry.classes[i];
        if (String(c.name).toLowerCase() === first || String(c._class_slug).toLowerCase() === first) return c;
    }
    const tokenMatches = (registry.classes || [])
        .map((c) => {
            const nameKey = String(c.name || '')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
            const slugKey = String(c._class_slug || '')
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
            const nameIdx = nameKey ? stemTokens.lastIndexOf(nameKey) : -1;
            const slugIdx = slugKey ? stemTokens.lastIndexOf(slugKey) : -1;
            return { doc: c, idx: Math.max(nameIdx, slugIdx) };
        })
        .filter((x) => x.idx >= 0)
        .sort((a, b) => b.idx - a.idx);
    const finalMatch =
        registry.classesBySlug.get(slugGuess) ||
        registry.classesBySlug.get(first.replace(/\s+/g, '')) ||
        (tokenMatches[0] ? tokenMatches[0].doc : null);
    return finalMatch;
}

function getTotalLevel(charData, charRow) {
    if (!charData) return 1;
    if (Array.isArray(charData.classes) && charData.classes.length) {
        const classTotal = charData.classes.reduce((s, c) => {
            const lv = Number(c.levels ?? c.level ?? c.lvl);
            return s + (Number.isFinite(lv) ? lv : 0);
        }, 0);
        if (classTotal > 0) return classTotal;
    }
    const topLevel = Number(charData.level ?? charRow?.level);
    return Number.isFinite(topLevel) && topLevel > 0 ? topLevel : 1;
}

function setTotalLevelSingleClass(charData, newLevel, classDoc) {
    if (!charData.classes) charData.classes = [{}];
    if (!charData.classes[0]) charData.classes[0] = { name: 'Adventurer', levels: 1 };
    charData.classes[0].levels = newLevel;
    charData.classes[0].level = newLevel;
    const matchedName = classDoc && classDoc.name ? String(classDoc.name) : '';
    const nm = matchedName || charData.classes[0].name || 'Class';
    const baseName = matchedName || String(nm).replace(/\s+\d+$/, '').split(/\s+/)[0] || nm;
    charData.classes[0].name = baseName;
    if (classDoc && classDoc._class_slug) charData.classes[0]._class_slug = String(classDoc._class_slug).toLowerCase();
    charData.level = newLevel;
    charData.class = `${baseName} ${newLevel}`;
}

function ensureHitPointsArray(charData, charRow, currentLevel, hd) {
    if (!charData.classes[0]) charData.classes[0] = {};
    let arr = charData.classes[0].hitPoints;
    if (!Array.isArray(arr)) arr = [];
    const prevMax = Number(charRow.max_hp);
    const targetLevels = currentLevel;
    if (arr.length < targetLevels) {
        const sum = arr.reduce((a, b) => a + (Number(b) || 0), 0);
        const rest =
            !isNaN(prevMax) && prevMax > 0
                ? Math.max(0, prevMax - sum)
                : hd * arr.length;
        const missing = targetLevels - arr.length;
        const per = missing > 0 ? Math.max(1, Math.round(rest / missing)) : hd;
        while (arr.length < targetLevels) arr.push(per);
    }
    charData.classes[0].hitPoints = arr;
}

function applyAsi(charData, k1, k2) {
    if (!charData.baseAbilityScores) charData.baseAbilityScores = {};
    ABILITIES.forEach((a) => {
        if (charData.baseAbilityScores[a] == null) charData.baseAbilityScores[a] = 10;
    });
    if (k1 && k2 && k1 === k2) {
        charData.baseAbilityScores[k1] += 2;
        return;
    }
    if (k1) charData.baseAbilityScores[k1] += 1;
    if (k2) charData.baseAbilityScores[k2] += 1;
}

function featuresFromCompendiumForLevel(registry, classSlug, level) {
    const slug = String(classSlug || '').toLowerCase();
    const list = registry.classFeaturesByClassSlug.get(slug) || [];
    return list.filter((x) => x.level === level).map((x) => x.row);
}

function poolOptionLabels(pool, fvttNameMap) {
    const labels = [];
    (pool || []).forEach((ref) => {
        const fvtt = String(ref).split('.').pop().toLowerCase();
        const name = fvttNameMap ? fvttNameMap.get(fvtt) : null;
        labels.push(name || fvtt.slice(0, 8) + '…');
    });
    return labels;
}

export async function mountSw5eLevelUpWizard(characterId) {
    const modal = document.getElementById('sw5eLevelUpModal');
    const body = document.getElementById('sw5eLevelUpBody');
    if (!modal || !body) {
        alert('Level-up modal is missing from the page. Refresh or report a bug.');
        return;
    }

    modal.classList.add('active');
    body.innerHTML = '<p class="sw5e-wiz-hint">Loading compendium and your class progression…</p>';

    try {
        const chars = typeof window.characters !== 'undefined' ? window.characters : null;
        if (!Array.isArray(chars)) {
            body.innerHTML = '<p style="color:#f88;">Character list is not available.</p>';
            return;
        }

        const cid = characterId;
        const charRow = chars.find((c) => c && String(c.id) === String(cid));
        if (!charRow || !charRow.character_data) {
            body.innerHTML =
                '<p style="color:#f88;">This character has no structured sheet data (<code>character_data</code>). Import SW5e/Foundry-style JSON or use the SW5E creator wizard.</p>';
            return;
        }

        let charData;
        try {
            charData = JSON.parse(charRow.character_data);
            if (charData.character) charData = charData.character;
        } catch (e) {
            body.innerHTML = '<p style="color:#f88;">Could not parse character JSON.</p>';
            return;
        }

        const [registry, invMap, archetypeFeatNames, techPowerRows] = await Promise.all([
            loadSw5eRegistry(),
            getInvocationFvttToNameMap(),
            getArchetypeFeatureFvttToNameMap(),
            getTechPowerRows()
        ]);

        const classDoc = findClassDoc(charData, registry, charRow);
        if (!classDoc) {
            const stem = deriveClassStemFromSheet(charData, charRow);
            body.innerHTML = `<p style="color:#f88;">Could not match "${esc(stem)}" to a SW5e class in the bundled compendium. Check spelling (e.g. &quot;Fighter&quot;) or use Wizard export.</p>`;
            return;
        }

        const currentLevel = getTotalLevel(charData, charRow);
        if (currentLevel >= 20) {
            body.innerHTML = '<p>Already level 20.</p>';
            return;
        }

        const nextLevel = currentLevel + 1;
        const classSlug = classDoc._class_slug ? String(classDoc._class_slug).toLowerCase() : '';

        const hd = parseInt(String((classDoc.system && classDoc.system.hitDice) || 'd8').replace(/\D/g, ''), 10) || 8;
        const con = charData.baseAbilityScores?.Constitution ?? charRow.constitution ?? 10;
        const conMod = abilityMod(con);
        const defaultHpGain = Math.max(1, hd + conMod);

        const asiLevels = getAbilityScoreImprovementLevels(classDoc);
        const isAsi = asiLevels.includes(nextLevel);
        const subChoice = getSubclassChoiceAtLevel(classDoc, nextLevel);

        const existingArchetypeId = charData.classes[0] && charData.classes[0].archetypeSlug;
        const archetypeDoc = existingArchetypeId
            ? registry.archetypesByStable.get(String(existingArchetypeId).toLowerCase())
            : null;

        const gains = getAdvancementsAtLevel(classDoc, nextLevel);
        const classGrantsTable = getClassItemGrantsAtLevel(classDoc, nextLevel);
        const otherChoices = getOtherItemChoicesAtLevel(classDoc, nextLevel);
        const cfRowsLvl = featuresFromCompendiumForLevel(registry, classSlug, nextLevel);
        const techPowersToLearn = getTechPowersLearnedAtLevel(classSlug, currentLevel, nextLevel);
        const maxTechPowerLevel = getMaxTechPowerLevelForClassLevel(classSlug, nextLevel);
        const knownTechPowerNames = collectKnownPowerNames(charData, 'tech');
        const eligibleTechPowers = (techPowerRows || [])
            .filter((p) => p && p.name && powerLevelNumber(p.level) <= (maxTechPowerLevel ?? 9))
            .filter((p) => !knownTechPowerNames.has(normalizePowerName(p.name)))
            .sort((a, b) => powerLevelNumber(a.level) - powerLevelNumber(b.level) || String(a.name).localeCompare(String(b.name)));
        const featOptions = (registry.feats || [])
            .filter((f) => f && (f.name || f.Name))
            .map((f) => ({ name: f.name || f.Name, source: f.source || f.Source || '' }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const featByName = new Map();
        (registry.feats || []).forEach((f) => {
            const name = f && (f.name || f.Name);
            if (name && !featByName.has(name)) featByName.set(name, f);
        });
        const techPowerByChoiceId = new Map();
        eligibleTechPowers.forEach((p) => techPowerByChoiceId.set(String(p._stable_id || p.name), p));

        let archetypeGrantNames = [];
        if (archetypeDoc && !subChoice) {
            const arGrants = getArchetypeItemGrantsAtLevel(archetypeDoc, nextLevel);
            arGrants.forEach((g) => {
                const items = (g.configuration && g.configuration.items) || [];
                items.forEach((path) => {
                    const lbl = resolveGrantedFeatureName(path, registry, archetypeFeatNames);
                    if (lbl) archetypeGrantNames.push(lbl);
                });
            });
        }

        const grantNamesFromAdv = [];
        classGrantsTable.forEach((g) => {
            const items = (g.configuration && g.configuration.items) || [];
            items.forEach((path) => {
                const lbl = resolveGrantedFeatureName(path, registry, archetypeFeatNames);
                grantNamesFromAdv.push(lbl || 'Class feature');
            });
        });

        const pc = (classDoc.system && classDoc.system.powercasting) || {};
        const techHints = cfRowsLvl.length ? extractTechPowersKnownCount(cfRowsLvl) : null;
        const forceHints = cfRowsLvl.length ? extractForcePowersKnownCount(cfRowsLvl) : null;
        const techLine =
            pc.tech && pc.tech !== 'none' && techPowersToLearn > 0
                ? `You learn <strong>${techPowersToLearn}</strong> new tech power(s) known. Choose ${techPowersToLearn === 1 ? 'it' : 'them'} below.`
                : pc.tech && pc.tech !== 'none' && techHints != null
                  ? `Tech powers known are governed by the ${esc(classDoc.name)} table.`
                  : '';
        const forceLine =
            pc.force && pc.force !== 'none' && forceHints != null
                ? `You may gain <strong>${forceHints}</strong> new force power(s) known. Update on sheet after applying.`
                : '';

        const pbPrev = proficiencyBonusFromCharacterLevel(currentLevel);
        const pbNext = proficiencyBonusFromCharacterLevel(nextLevel);
        const pbLine =
            pbNext > pbPrev
                ? `<p class="sw5e-wiz-hint sw5e-lu-highlight">Proficiency bonus increases to <strong>+${pbNext}</strong> at this level.</p>`
                : `<p class="sw5e-wiz-hint">Proficiency bonus stays <strong>+${pbNext}</strong>.</p>`;

        const bulletLines = [];
        bulletLines.push(
            `<strong>${esc(classDoc.name)}</strong> advancing from level ${currentLevel} → <strong>${nextLevel}</strong> (Hit die: d${hd}).`
        );

        gains.forEach((g) => {
            if (g.type === 'HitPoints')
                bulletLines.push(
                    `<strong>Hit points:</strong> roll <strong>d${hd} + ${conMod}</strong> (CON), or take the average from the class table — then enter the amount below. Draft default assumes maximum die roll (${hd}+${conMod}).`
                );
            if (g.type === 'AbilityScoreImprovement')
                bulletLines.push('<strong>Ability Score Improvement:</strong> choose either +2 to one score, +1/+1 split, or one feat.');
        });

        if (grantNamesFromAdv.length) {
            bulletLines.push(
                `<strong>Advancement grants (class table):</strong> ${grantNamesFromAdv.map((x) => esc(x)).join(', ')}.`
            );
        }

        if (cfRowsLvl.length) {
            const featsList = cfRowsLvl
                .map((cf) => {
                    const dn = cf.name || 'Feature';
                    const snip = plainSnippet(
                        cf.description ||
                            (cf.system && cf.system.description && cf.system.description.value) ||
                            '',
                        220
                    );
                    return snip ? `<li><strong>${esc(dn)}</strong> — ${esc(snip)}</li>` : `<li><strong>${esc(dn)}</strong></li>`;
                })
                .join('');
            bulletLines.push(`<strong>Compiled class features (${classDoc.name} ${nextLevel}):</strong><ul>${featsList}</ul>`);
        }

        archetypeGrantNames.forEach((n) => {
            bulletLines.push(`<strong>Your specialty (${esc(archetypeDoc.name)}):</strong> gains <em>${esc(n)}</em>.`);
        });

        otherChoices.forEach((ch) => {
            const labs = poolOptionLabels(ch.pool, invMap);
            const preview = labs.slice(0, 12).map((x) => esc(x)).join('; ');
            const more = labs.length > 12 ? ` … (${labs.length} options)` : '';
            bulletLines.push(
                `<strong>${esc(ch.title)} (${ch.count} choice):</strong> ${preview}${more}<br/><span class="sw5e-wiz-hint">${esc(
                    plainSnippet(ch.hint, 400)
                )}</span><br/><em>Pick on your sheet — options are tied to ${esc(classDoc.name)} (${esc(ch.subtype || ch.title)}).</em>`
            );
        });

        if (subChoice && archetypeGrantNames.length === 0) {
            bulletLines.push(
                `<strong>New specialty (${esc(classDoc.name)} archetype)</strong> — choose below. Specialty features unlock after you confirm.`
            );
        }

        if (techLine) bulletLines.push(techLine);
        if (forceLine) bulletLines.push(forceLine);

        const summaryHtml = `<div class="sw5e-lu-header"><div class="sw5e-lu-title">${esc(
            charData.name || charRow.name || 'Character'
        )}</div><div class="sw5e-lu-sub">${esc(classDoc.name)} · level ${nextLevel}</div>${pbLine}</div>
      <section class="sw5e-lu-section"><h4>What applies at ${esc(classDoc.name)} ${nextLevel}</h4><div class="sw5e-lu-bullets">${bulletLines
            .map((x) => `<div class="sw5e-lu-block">${x}</div>`)
            .join('')}</div></section>`;

        const fieldsHp = `
      <section class="sw5e-lu-section sw5e-lu-action">
        <h4>Set hit points gained</h4>
        <label>HP this level 
          <input type="number" id="sw5eLuHp" min="1" max="999" value="${defaultHpGain}" class="sw5e-wiz-input" /></label>
        <p class="sw5e-wiz-hint">Default = d${hd} max (${hd}) + CON (${conMod}) = <strong>${defaultHpGain}</strong>. Average die would be closer to ~${Math.floor(
            hd / 2 + 1
        )}+${conMod}.</p>
      </section>`;

        const fieldsAsi = isAsi
            ? `<section class="sw5e-lu-section sw5e-lu-action"><h4>Ability Score Improvement or Feat</h4>
           <p class="sw5e-wiz-hint">Choose ability increases <strong>or</strong> one feat. If you select a feat, leave both ability adjustments empty.</p>
           <div class="sw5e-lu-choice-grid">
           <label>First ability adjustment <select id="sw5eLuAsi1" class="sw5e-wiz-select"><option value="">— none —</option>
             <option>Strength</option><option>Dexterity</option><option>Constitution</option>
             <option>Intelligence</option><option>Wisdom</option><option>Charisma</option></select></label>
           <label>Second ability adjustment <select id="sw5eLuAsi2" class="sw5e-wiz-select"><option value="">— none —</option>
             <option>Strength</option><option>Dexterity</option><option>Constitution</option>
             <option>Intelligence</option><option>Wisdom</option><option>Charisma</option></select></label>
           <label>Feat instead <select id="sw5eLuFeat" class="sw5e-wiz-select"><option value="">— no feat / use ASI —</option>
             ${featOptions.map((f) => `<option value="${esc(f.name)}">${esc(f.name)}${f.source ? ` (${esc(f.source)})` : ''}</option>`).join('')}</select></label>
           </div>
           <div id="sw5eLuFeatPreview" class="sw5e-lu-choice-preview">${renderChoicePreview('', [], '', 'Choose a feat to preview what it does.')}</div></section>`
            : '';

        const fieldsTechPowers =
            techPowersToLearn > 0
                ? `<section class="sw5e-lu-section sw5e-lu-action"><h4>New Tech Power${techPowersToLearn > 1 ? 's' : ''}</h4>
           <p class="sw5e-wiz-hint">${esc(classDoc.name)} ${nextLevel} learns ${techPowersToLearn} new tech power${techPowersToLearn > 1 ? 's' : ''}. Max power level: <strong>${maxTechPowerLevel}</strong>.</p>
           <div class="sw5e-lu-choice-grid">
           ${Array.from({ length: techPowersToLearn })
               .map(
                   (_, i) => `<label>Tech power ${i + 1}<select id="sw5eLuTechPower${i}" class="sw5e-wiz-select"><option value="">— choose tech power —</option>
             ${eligibleTechPowers
                 .map((p) => `<option value="${esc(p._stable_id || p.name)}">${esc(p.name)} (${esc(p.level || 'At-will')})</option>`)
                 .join('')}</select></label>
             <div id="sw5eLuTechPowerPreview${i}" class="sw5e-lu-choice-preview">${renderChoicePreview('', [], '', 'Choose a tech power to preview what it does.')}</div>`
               )
               .join('')}
           </div></section>`
                : '';

        const fieldsSub = subChoice
            ? `<section class="sw5e-lu-section sw5e-lu-action"><h4>${esc(classDoc.name)} specialty / archetype</h4>
           <select id="sw5eLuSub" class="sw5e-wiz-select"><option value="">— Select —</option>
           ${(subChoice.pool || [])
               .map((pid) => {
                   const ar = resolveArchetypeGrant(pid, registry);
                   if (!ar || !ar._stable_id) return '';
                   const sel =
                       existingArchetypeId &&
                       String(ar._stable_id).toLowerCase() === String(existingArchetypeId).toLowerCase()
                           ? ' selected'
                           : '';
                   return `<option value="${esc(ar._stable_id)}"${sel}>${esc(ar.name)}</option>`;
               })
               .join('')}
           </select>
           ${subChoice.hint ? `<p class="sw5e-wiz-hint">${esc(plainSnippet(subChoice.hint, 500))}</p>` : ''}
           </section>`
            : '';

        body.innerHTML = `${summaryHtml}${fieldsHp}${fieldsAsi}${fieldsTechPowers}${fieldsSub}
      <p class="sw5e-wiz-hint">Apply updates your numeric sheet (HP, level, proficiency, subclass, optional ASI/feat, and selected tech powers). Strategy / maneuver picks remain on the full character sheet.</p>`;

        const featSelect = document.getElementById('sw5eLuFeat');
        const featPreview = document.getElementById('sw5eLuFeatPreview');
        if (featSelect && featPreview) {
            featSelect.onchange = () => {
                const row = featByName.get(featSelect.value);
                featPreview.innerHTML = row
                    ? renderChoicePreview(row.name || row.Name, [row.source || row.Source || 'Feat'], rowDescription(row), 'Choose a feat to preview what it does.')
                    : renderChoicePreview('', [], '', 'Choose a feat to preview what it does.');
            };
        }

        for (let i = 0; i < techPowersToLearn; i++) {
            const powerSelect = document.getElementById(`sw5eLuTechPower${i}`);
            const powerPreview = document.getElementById(`sw5eLuTechPowerPreview${i}`);
            if (!powerSelect || !powerPreview) continue;
            powerSelect.onchange = () => {
                const row = techPowerByChoiceId.get(String(powerSelect.value));
                powerPreview.innerHTML = row
                    ? renderChoicePreview(
                          row.name,
                          [
                              `Level: ${row.level || 'At-will'}`,
                              row.casting_time || row.casting_period ? `Cast: ${row.casting_time || row.casting_period}` : '',
                              row.range ? `Range: ${row.range}` : '',
                              row.duration ? `Duration: ${row.duration}` : '',
                              row.damage ? `Damage: ${row.damage}` : '',
                              row.saving_throw ? `Save: ${row.saving_throw}` : ''
                          ],
                          rowDescription(row),
                          'Choose a tech power to preview what it does.'
                      )
                    : renderChoicePreview('', [], '', 'Choose a tech power to preview what it does.');
            };
        }

        const btnApply = document.getElementById('sw5eLevelUpApply');
        if (btnApply) {
            btnApply.onclick = () => {
                if (subChoice) {
                    const sel = document.getElementById('sw5eLuSub');
                    const sid = sel && sel.value;
                    if (!sid && !existingArchetypeId) {
                        alert(`Choose your ${classDoc.name} specialty for this level.`);
                        return;
                    }
                }

                const hpIn = document.getElementById('sw5eLuHp');
                const hpGain = hpIn ? parseInt(hpIn.value, 10) || defaultHpGain : defaultHpGain;

                ensureHitPointsArray(charData, charRow, currentLevel, hd);
                charData.classes[0].hitPoints.push(Math.max(1, hpGain));

                setTotalLevelSingleClass(charData, nextLevel, classDoc);

                if (isAsi) {
                    const a1 = document.getElementById('sw5eLuAsi1');
                    const a2 = document.getElementById('sw5eLuAsi2');
                    const feat = document.getElementById('sw5eLuFeat');
                    const k1 = a1 && a1.value;
                    const k2 = a2 && a2.value;
                    const featName = feat && feat.value;
                    if (featName && (k1 || k2)) {
                        alert('Choose either ability score improvements or a feat, not both.');
                        return;
                    }
                    if (!featName && !k1 && !k2) {
                        alert('Choose ability score improvements or a feat for this level.');
                        return;
                    }
                    if (k1 || k2) applyAsi(charData, k1, k2);
                    if (featName) addLevelUpFeat(charData, featName, nextLevel);
                }

                if (techPowersToLearn > 0) {
                    const selectedPowerRows = [];
                    const seenPowerIds = new Set();
                    for (let i = 0; i < techPowersToLearn; i++) {
                        const sel = document.getElementById(`sw5eLuTechPower${i}`);
                        const val = sel && sel.value;
                        if (!val) {
                            alert(`Choose ${techPowersToLearn === 1 ? 'a tech power' : 'all tech powers'} for this level.`);
                            return;
                        }
                        if (seenPowerIds.has(val)) {
                            alert('Choose different tech powers for each new power slot.');
                            return;
                        }
                        seenPowerIds.add(val);
                        const row = eligibleTechPowers.find((p) => String(p._stable_id || p.name) === String(val));
                        if (row) selectedPowerRows.push(row);
                    }
                    selectedPowerRows.forEach((row) => addKnownTechPower(charData, row));
                }

                if (subChoice) {
                    const sel = document.getElementById('sw5eLuSub');
                    const sid = (sel && sel.value) || existingArchetypeId;
                    if (sid) {
                        const ar = registry.archetypesByStable.get(String(sid).toLowerCase());
                        if (ar) {
                            charData.classes[0].archetype = ar.name;
                            charData.classes[0].archetypeSlug = ar._stable_id;
                        }
                    }
                }

                if (classSlug && !charData.classes[0]._class_slug) charData.classes[0]._class_slug = classSlug;

                charData.proficiency_bonus = proficiencyBonusFromCharacterLevel(nextLevel);

                if (!charData.builderMeta) charData.builderMeta = { choiceHistory: [] };
                if (!Array.isArray(charData.builderMeta.choiceHistory)) charData.builderMeta.choiceHistory = [];
                charData.builderMeta.choiceHistory.push({
                    type: 'level_up',
                    from: currentLevel,
                    to: nextLevel,
                    hpGain,
                    classSlug,
                    archetypeSlug: charData.classes[0].archetypeSlug || null,
                    ts: Date.now()
                });

                if (typeof window.convertStarWarsBuilderJsonToGameCharacter !== 'function') {
                    alert('Character converter not loaded.');
                    return;
                }
                const { character } = window.convertStarWarsBuilderJsonToGameCharacter(charData, { existing: charRow });
                const idx = chars.findIndex((c) => c && c.id === charRow.id);
                if (idx >= 0) chars[idx] = character;
                if (typeof window.sendMessage === 'function') {
                    const payload = window.buildCharacterUpdatePayload
                        ? window.buildCharacterUpdatePayload(character)
                        : character;
                    window.sendMessage({
                        type: 'UpdateCharacter',
                        character: payload
                    });
                }
                if (typeof window.closeModal === 'function') window.closeModal('sw5eLevelUpModal');
                else modal.classList.remove('active');
                if (typeof window.renderCharacterSheetContent === 'function') {
                    try {
                        window.renderCharacterSheetContent();
                    } catch (e) {}
                }
                if (typeof window.addLogEntry === 'function') {
                    window.addLogEntry(`${character.name} leveled up to ${nextLevel}.`, 'info');
                }
            };
        }
    } catch (err) {
        console.error(err);
        body.innerHTML = `<p style="color:#f88;">Level-up wizard error: ${esc(err.message || String(err))}</p>`;
    }
}

export function unmountSw5eLevelUpWizard() {
    const modal = document.getElementById('sw5eLevelUpModal');
    if (modal) modal.classList.remove('active');
}
