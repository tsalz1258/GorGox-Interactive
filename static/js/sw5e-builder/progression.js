/**
 * Inspect class.system.advancement for level-specific entries.
 */

export function getAdvancementsAtLevel(classDoc, level) {
    const adv = classDoc && classDoc.system && classDoc.system.advancement;
    if (!Array.isArray(adv)) return [];
    return adv.filter((a) => {
        if (a.type === 'ScaleValue') return false;
        if (a.type === 'HitPoints') return true;
        if (a.level == null || a.level === '') return false;
        return Number(a.level) === Number(level);
    });
}

export function getAbilityScoreImprovementLevels(classDoc) {
    const adv = classDoc && classDoc.system && classDoc.system.advancement;
    if (!Array.isArray(adv)) return [];
    return adv
        .filter((a) => a.type === 'AbilityScoreImprovement' && a.level != null)
        .map((a) => Number(a.level))
        .filter((n) => !isNaN(n));
}

export function getSubclassChoiceAtLevel(classDoc, level) {
    const adv = classDoc && classDoc.system && classDoc.system.advancement;
    if (!Array.isArray(adv)) return null;
    for (let i = 0; i < adv.length; i++) {
        const a = adv[i];
        if (a.type !== 'ItemChoice') continue;
        const cfg = a.configuration || {};
        if (cfg.type !== 'archetype') continue;
        const choices = cfg.choices || {};
        if (choices[String(level)] != null) {
            return { advancement: a, count: choices[String(level)], pool: cfg.pool || [], hint: cfg.hint || '' };
        }
    }
    return null;
}

export function extractTechPowersKnownCount(classFeaturesForLevelRows) {
    for (let i = 0; i < (classFeaturesForLevelRows || []).length; i++) {
        const d =
            classFeaturesForLevelRows[i].description ||
            (classFeaturesForLevelRows[i].system &&
                classFeaturesForLevelRows[i].system.description &&
                classFeaturesForLevelRows[i].system.description.value) ||
            '';
        const plain = String(d).replace(/<[^>]+>/g, ' ');
        const m = plain.match(/learn (\d+) tech powers/i);
        if (m) return parseInt(m[1], 10);
        const m2 = plain.match(/(\d+) tech powers of your choice/i);
        if (m2) return parseInt(m2[1], 10);
    }
    return null;
}

/** ItemGrant entries on the class advancement table for this character level only. */
export function getClassItemGrantsAtLevel(classDoc, level) {
    const adv = classDoc && classDoc.system && classDoc.system.advancement;
    if (!Array.isArray(adv)) return [];
    return adv.filter(
        (a) => a.type === 'ItemGrant' && Number(a.level) === Number(level)
    );
}

/**
 * Non-archetype ItemChoice advancements that apply exactly at `level`
 * (fighter strategies, maneuvers picks, berserker instincts, etc.).
 */
export function getOtherItemChoicesAtLevel(classDoc, level) {
    const adv = classDoc && classDoc.system && classDoc.system.advancement;
    if (!Array.isArray(adv)) return [];
    const out = [];
    for (let i = 0; i < adv.length; i++) {
        const a = adv[i];
        if (a.type !== 'ItemChoice') continue;
        const cfg = a.configuration || {};
        if (cfg.type === 'archetype') continue;
        const choices = cfg.choices || {};
        if (choices[String(level)] == null) continue;
        out.push({
            title: a.title || 'Choice',
            hint: cfg.hint || '',
            count: Number(choices[String(level)]) || 1,
            pool: cfg.pool || [],
            advancementId: a._id,
            subtype: (cfg.restriction && cfg.restriction.subtype) || ''
        });
    }
    return out;
}

/** ItemGrant archetype advancements at exactly this level for the player's chosen specialty/archetype. */
export function getArchetypeItemGrantsAtLevel(archetypeDoc, level) {
    const adv = archetypeDoc && archetypeDoc.system && archetypeDoc.system.advancement;
    if (!Array.isArray(adv)) return [];
    return adv.filter(
        (a) => a.type === 'ItemGrant' && Number(a.level) === Number(level)
    );
}

export function extractForcePowersKnownCount(classFeaturesForLevelRows) {
    for (let i = 0; i < (classFeaturesForLevelRows || []).length; i++) {
        const d =
            classFeaturesForLevelRows[i].description ||
            (classFeaturesForLevelRows[i].system &&
                classFeaturesForLevelRows[i].system.description &&
                classFeaturesForLevelRows[i].system.description.value) ||
            '';
        const plain = String(d).replace(/<[^>]+>/g, ' ');
        const m = plain.match(/learn (\d+) force powers/i);
        if (m) return parseInt(m[1], 10);
        const m2 = plain.match(/(\d+) force powers of your choice/i);
        if (m2) return parseInt(m2[1], 10);
    }
    return null;
}

const TECH_POWERS_KNOWN_BY_CLASS = {
    // SW5e PHB full techcaster progression. Engineer learns one additional
    // tech power each class level after 1st (6 at level 1, 9 at level 4).
    engineer: [0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
};

export function getTechPowersKnownForClassLevel(classSlug, level) {
    const table = TECH_POWERS_KNOWN_BY_CLASS[String(classSlug || '').toLowerCase()];
    const lv = Number(level);
    if (!table || !Number.isFinite(lv) || lv < 1) return null;
    return table[Math.min(20, Math.max(1, Math.floor(lv)))] ?? null;
}

export function getTechPowersLearnedAtLevel(classSlug, currentLevel, nextLevel) {
    const before = getTechPowersKnownForClassLevel(classSlug, currentLevel);
    const after = getTechPowersKnownForClassLevel(classSlug, nextLevel);
    if (before == null || after == null) return 0;
    return Math.max(0, after - before);
}

export function getMaxTechPowerLevelForClassLevel(classSlug, level) {
    const slug = String(classSlug || '').toLowerCase();
    if (slug !== 'engineer') return null;
    const lv = Math.max(1, Math.min(20, Math.floor(Number(level) || 1)));
    if (lv >= 17) return 9;
    if (lv >= 15) return 8;
    if (lv >= 13) return 7;
    if (lv >= 11) return 6;
    if (lv >= 9) return 5;
    if (lv >= 7) return 4;
    if (lv >= 5) return 3;
    if (lv >= 3) return 2;
    return 1;
}
