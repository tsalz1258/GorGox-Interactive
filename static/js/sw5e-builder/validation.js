export function validateIdentity(state) {
    const e = [];
    if (!state.identity || !String(state.identity.name || '').trim()) e.push('Character name is required.');
    if (!state.identity || !String(state.identity.playerName || '').trim()) e.push('Player name is required.');
    return e;
}

export function validateSpecies(state) {
    const e = [];
    if (!state.speciesSlug) e.push('Choose a species.');
    return e;
}

export function validateBackground(state) {
    const e = [];
    if (!state.backgroundStableId) e.push('Choose a background.');
    return e;
}

export function validateClass(state) {
    const e = [];
    if (!state.classSlug) e.push('Choose a class.');
    return e;
}

export function validateAbilities(state) {
    const e = [];
    const b = state.baseAbilityScores || {};
    const need = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
    const vals = [];
    need.forEach((k) => {
        const v = b[k];
        if (v == null || isNaN(Number(v))) e.push(`Set ${k}.`);
        const n = Number(v);
        if (n < 3 || n > 18) e.push(`${k} must be between 3 and 18.`);
        vals.push(n);
    });
    const sortedStd = [...vals].sort((a, b) => b - a);
    const std = [15, 14, 13, 12, 10, 8];
    const okStd = std.every((x, i) => sortedStd[i] === x);
    if (!okStd) e.push('Use each value from the standard array (15, 14, 13, 12, 10, 8) exactly once.');
    return e;
}

export function validateProficiencies(state, registry) {
    const e = [];
    const cls = registry.classesBySlug.get(String(state.classSlug || '').toLowerCase());
    if (!cls || !cls.system || !cls.system.skills) return e;
    const need = Number(cls.system.skills.number) || 0;
    const picked = (state.classSkillKeysChosen || []).length;
    if (picked !== need) e.push(`Pick exactly ${need} class skills (selected ${picked}).`);

    const bg = registry.backgroundsByStableId.get(String(state.backgroundStableId || '').toLowerCase());
    if (bg && bg.system && bg.system.skillProficiencies && bg.system.skillProficiencies.value) {
        const raw = String(bg.system.skillProficiencies.value);
        const m = raw.match(/choose two from ([^.]+)/i);
        if (m) {
            const needBg = 2;
            const got = (state.backgroundSkillKeysChosen || []).length;
            if (got !== needBg) e.push(`Pick exactly ${needBg} background skills.`);
        }
    }
    return e;
}

export function validateEquipment(state) {
    return [];
}

export function validatePowers(state, registry) {
    const e = [];
    const cls = registry.classesBySlug.get(String(state.classSlug || '').toLowerCase());
    if (!cls || !cls.system || !cls.system.powercasting) return e;
    const tech = cls.system.powercasting.tech;
    const force = cls.system.powercasting.force;
    const needTech = state.techPowerNamesRequired || 0;
    const needForce = state.forcePowerNamesRequired || 0;
    if (tech && tech !== 'none') {
        const got = (state.techPowerNames || []).length;
        if (needTech > 0 && got < needTech) e.push(`Select at least ${needTech} tech powers (selected ${got}).`);
    }
    if (force && force !== 'none') {
        const got = (state.forcePowerNames || []).length;
        if (needForce > 0 && got < needForce) e.push(`Select at least ${needForce} force powers (selected ${got}).`);
    }
    return e;
}

export function validateAllSteps(state, registry) {
    const order = ['identity', 'species', 'background', 'class', 'abilities', 'proficiencies', 'equipment', 'powers'];
    for (let i = 0; i < order.length; i++) {
        const e = validateStep(order[i], state, registry);
        if (e.length) return e;
    }
    return [];
}

export function validateStep(stepId, state, registry) {
    switch (stepId) {
        case 'identity':
            return validateIdentity(state);
        case 'species':
            return validateSpecies(state);
        case 'background':
            return validateBackground(state);
        case 'class':
            return validateClass(state);
        case 'abilities':
            return validateAbilities(state);
        case 'proficiencies':
            return validateProficiencies(state, registry);
        case 'equipment':
            return validateEquipment(state);
        case 'powers':
            return validatePowers(state, registry);
        case 'review':
            return [];
        default:
            return [];
    }
}
