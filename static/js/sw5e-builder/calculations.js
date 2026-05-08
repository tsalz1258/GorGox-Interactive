import { SW5E_SKILL_CODE_TO_KEY, skillKeyToAbility } from './mappings.js';

export function abilityMod(score) {
    const n = Number(score);
    if (isNaN(n)) return 0;
    return Math.floor((n - 10) / 2);
}

export function proficiencyBonusFromCharacterLevel(level) {
    const lv = Math.max(1, Math.min(20, Number(level) || 1));
    if (lv <= 4) return 2;
    if (lv <= 8) return 3;
    if (lv <= 12) return 4;
    if (lv <= 16) return 5;
    return 6;
}

export function parseSpeciesAbilityIncreases(description) {
    const text = String(description || '');
    const bumps = { Strength: 0, Dexterity: 0, Constitution: 0, Intelligence: 0, Wisdom: 0, Charisma: 0 };
    const re = /Your ([A-Za-z]+) score increases by (\d+)/gi;
    let m;
    const nameMap = {
        strength: 'Strength',
        dexterity: 'Dexterity',
        constitution: 'Constitution',
        intelligence: 'Intelligence',
        wisdom: 'Wisdom',
        charisma: 'Charisma'
    };
    while ((m = re.exec(text)) !== null) {
        const ab = nameMap[m[1].toLowerCase()];
        if (ab) bumps[ab] += parseInt(m[2], 10);
    }
    return bumps;
}

export function applySpeciesBonuses(baseScores, speciesFeatureRows) {
    const out = { ...baseScores };
    (speciesFeatureRows || []).forEach((sf) => {
        if (sf.name && /ability score increase/i.test(sf.name)) {
            const d = sf.description || (sf.system && sf.system.description && sf.system.description.value) || '';
            const plain = String(d).replace(/<[^>]+>/g, ' ');
            const inc = parseSpeciesAbilityIncreases(plain);
            Object.keys(inc).forEach((k) => {
                out[k] = (out[k] || 10) + inc[k];
            });
        }
    });
    return out;
}

export function buildSkillsObject(baseScores, proficientKeys, expertiseKeys, profBonus) {
    const skills = {};
    const pb = Number(profBonus) || 2;
    const ablNameFromSkillKey = (sk) => {
        const a = skillKeyToAbility(sk);
        const map = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
        return map[a] || 'Strength';
    };

    const allKeys = new Set([...(proficientKeys || []), ...(expertiseKeys || [])]);
    allKeys.forEach((key) => {
        const abl = ablNameFromSkillKey(key);
        let bonus = abilityMod(baseScores[abl] ?? 10);
        const prof = (proficientKeys || []).includes(key);
        const exp = (expertiseKeys || []).includes(key);
        if (exp) bonus += 2 * pb;
        else if (prof) bonus += pb;
        skills[key] = {
            proficient: prof || exp,
            expertise: exp,
            mod: bonus
        };
    });
    return skills;
}

export function convertSkillCodesToKeys(codes) {
    return (codes || [])
        .map((c) => {
            const s = String(c).trim();
            return SW5E_SKILL_CODE_TO_KEY[s] || SW5E_SKILL_CODE_TO_KEY[s.toLowerCase()] || s;
        })
        .filter(Boolean);
}
