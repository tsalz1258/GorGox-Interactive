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
    extractForcePowersKnownCount
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

const ABILITIES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];

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
    if (slugFromChar) {
        const doc = registry.classesBySlug.get(String(slugFromChar).toLowerCase());
        if (doc) return doc;
    }
    const first = stem.split(/\s+/)[0]?.toLowerCase() || '';
    for (let i = 0; i < registry.classes.length; i++) {
        const c = registry.classes[i];
        if (String(c.name).toLowerCase() === first || String(c._class_slug).toLowerCase() === first) return c;
    }
    const slugGuess = first.replace(/[^a-z0-9]/g, '');
    return registry.classesBySlug.get(slugGuess) || registry.classesBySlug.get(first.replace(/\s+/g, '')) || null;
}

function getTotalLevel(charData) {
    if (!charData || !Array.isArray(charData.classes)) return 1;
    return charData.classes.reduce((s, c) => s + (Number(c.levels) || 0), 0) || 1;
}

function setTotalLevelSingleClass(charData, newLevel) {
    if (!charData.classes) charData.classes = [{}];
    if (!charData.classes[0]) charData.classes[0] = { name: 'Adventurer', levels: 1 };
    charData.classes[0].levels = newLevel;
    const nm = charData.classes[0].name || 'Class';
    const baseName = String(nm).replace(/\s+\d+$/, '').split(/\s+/)[0] || nm;
    charData.classes[0].name = baseName;
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

        const [registry, invMap, archetypeFeatNames] = await Promise.all([
            loadSw5eRegistry(),
            getInvocationFvttToNameMap(),
            getArchetypeFeatureFvttToNameMap()
        ]);

        const classDoc = findClassDoc(charData, registry, charRow);
        if (!classDoc) {
            const stem = deriveClassStemFromSheet(charData, charRow);
            body.innerHTML = `<p style="color:#f88;">Could not match "${esc(stem)}" to a SW5e class in the bundled compendium. Check spelling (e.g. &quot;Fighter&quot;) or use Wizard export.</p>`;
            return;
        }

        const currentLevel = getTotalLevel(charData);
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
            pc.tech && pc.tech !== 'none' && techHints != null
                ? `You may gain <strong>${techHints}</strong> new tech power(s) known (see level features text). Update known powers on your sheet after applying.`
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
                bulletLines.push('<strong>Ability Score Improvement:</strong> +2 to one score, +1/+1 split, or a feat.');
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
            ? `<section class="sw5e-lu-section sw5e-lu-action"><h4>Ability Score Improvement</h4>
           <p class="sw5e-wiz-hint">+2 one ability or +1/+1 (same ability twice picks +2). Leave both empty if you take a feat only.</p>
           <label>First adjustment <select id="sw5eLuAsi1" class="sw5e-wiz-select"><option value="">— none —</option>
             <option>Strength</option><option>Dexterity</option><option>Constitution</option>
             <option>Intelligence</option><option>Wisdom</option><option>Charisma</option></select></label>
           <label>Second adjustment <select id="sw5eLuAsi2" class="sw5e-wiz-select"><option value="">— none —</option>
             <option>Strength</option><option>Dexterity</option><option>Constitution</option>
             <option>Intelligence</option><option>Wisdom</option><option>Charisma</option></select></label></section>`
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

        body.innerHTML = `${summaryHtml}${fieldsHp}${fieldsAsi}${fieldsSub}
      <p class="sw5e-wiz-hint">Apply updates your numeric sheet (HP, level, proficiency, subclass, optional ASI). Strategy / power / maneuver picks remain on the full character sheet.</p>`;

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

                setTotalLevelSingleClass(charData, nextLevel);

                if (isAsi) {
                    const a1 = document.getElementById('sw5eLuAsi1');
                    const a2 = document.getElementById('sw5eLuAsi2');
                    const k1 = a1 && a1.value;
                    const k2 = a2 && a2.value;
                    if (k1 || k2) applyAsi(charData, k1, k2);
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
