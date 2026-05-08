/**
 * SW5e Foundry skill short codes → sheet keys used by GorGox (buildSkillsSection Star Wars branch).
 */
export const SW5E_SKILL_CODE_TO_KEY = {
    ath: 'athletics',
    acr: 'acrobatics',
    slt: 'sleight_of_hand',
    ste: 'stealth',
    ani: 'animal_handling',
    ins: 'insight',
    med: 'medicine',
    prc: 'perception',
    sur: 'survival',
    itm: 'investigation',
    inv: 'investigation',
    lor: 'lore',
    nat: 'nature',
    pil: 'piloting',
    tec: 'technology',
    dec: 'deception',
    imt: 'intimidation',
    itd: 'intimidation',
    prf: 'performance',
    per: 'performance',
    prs: 'persuasion',
    uti: 'technology'
};

export const SW5E_ABILITY_NAMES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];

export function skillKeyToAbility(skillKey) {
    const k = SW5E_SKILL_CODE_TO_KEY;
    if (['athletics'].includes(skillKey)) return 'str';
    if (['acrobatics', 'sleight_of_hand', 'stealth'].includes(skillKey)) return 'dex';
    if (['investigation', 'lore', 'nature', 'piloting', 'technology'].includes(skillKey)) return 'int';
    if (['animal_handling', 'insight', 'medicine', 'perception', 'survival'].includes(skillKey)) return 'wis';
    if (['deception', 'intimidation', 'performance', 'persuasion'].includes(skillKey)) return 'cha';
    return 'str';
}

/**
 * Map Foundry trait grant code to a human label (for features / notes).
 */
export function describeTraitGrant(code) {
    if (!code || typeof code !== 'string') return '';
    const [a, b] = code.split(':');
    if (a === 'armor') return `Armor: ${b}`;
    if (a === 'weapon') return `Weapon: ${b}`;
    if (a === 'skills') {
        const key = SW5E_SKILL_CODE_TO_KEY[b] || b;
        return `Skill: ${key}`;
    }
    if (a === 'saves') return `Save: ${b?.toUpperCase()}`;
    return code;
}
