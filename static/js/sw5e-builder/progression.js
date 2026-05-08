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
