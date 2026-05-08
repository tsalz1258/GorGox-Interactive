import {
    abilityMod,
    proficiencyBonusFromCharacterLevel,
    applySpeciesBonuses,
    buildSkillsObject,
    convertSkillCodesToKeys
} from './calculations.js';
import { extractTechPowersKnownCount, extractForcePowersKnownCount } from './progression.js';

function classFeaturesAtLevel(registry, classSlug, level) {
    const list = registry.classFeaturesByClassSlug.get(classSlug) || [];
    return list
        .filter((x) => x.level === level)
        .map((x) => x.row)
        .filter(Boolean);
}

/**
 * Build GorGox character_data JSON from wizard state (single class, level 1).
 */
export function finalizeCharBuilderState(state, registry) {
    const species = registry.speciesBySlug.get(String(state.speciesSlug || '').toLowerCase());
    const cls = registry.classesBySlug.get(String(state.classSlug || '').toLowerCase());
    const bg = registry.backgroundsByStableId.get(String(state.backgroundStableId || '').toLowerCase());
    if (!species || !cls || !bg) throw new Error('Missing species, class, or background');

    const speciesFeats = registry.speciesFeaturesBySpecies.get(String(state.speciesSlug || '').toLowerCase()) || [];

    let base = { ...state.baseAbilityScores };
    base = applySpeciesBonuses(base, speciesFeats);

    const level = 1;
    const pb = proficiencyBonusFromCharacterLevel(level);

    const sysSkills = cls.system && cls.system.skills ? cls.system.skills : { number: 0, choices: [] };
    const classSkillPool = convertSkillCodesToKeys(sysSkills.choices || []);
    const classPick = (state.classSkillKeysChosen || []).filter((k) => classSkillPool.includes(k));

    let bgSkills = [];
    if (bg.system && bg.system.skillProficiencies && bg.system.skillProficiencies.value) {
        const raw = String(bg.system.skillProficiencies.value);
        const low = raw.toLowerCase();
        const mapName = (n) => {
            const s = n.trim().toLowerCase();
            const table = {
                athletics: 'athletics',
                acrobatics: 'acrobatics',
                deception: 'deception',
                performance: 'performance',
                persuasion: 'persuasion',
                'sleight of hand': 'sleight_of_hand',
                stealth: 'stealth',
                investigation: 'investigation',
                insight: 'insight',
                intimidation: 'intimidation',
                perception: 'perception',
                survival: 'survival',
                medicine: 'medicine',
                lore: 'lore',
                nature: 'nature',
                piloting: 'piloting',
                technology: 'technology',
                'animal handling': 'animal_handling'
            };
            return table[s] || null;
        };
        if (/choose two from/i.test(raw)) {
            bgSkills = state.backgroundSkillKeysChosen || [];
        }
    }

    const profKeys = [...new Set([...classPick, ...bgSkills])];
    const skillsObj = buildSkillsObject(base, profKeys, state.expertiseKeys || [], pb);

    const hitDie = parseInt(String((cls.system && cls.system.hitDice) || 'd8').replace(/\D/g, ''), 10) || 8;
    const conMod = abilityMod(base.Constitution || 10);
    const hp1 = Math.max(1, hitDie + conMod);

    const savesProf = {};
    (cls.system.saves || []).forEach((s) => {
        savesProf[s] = true;
    });

    const className = cls.name || state.classSlug;
    const techNames = state.techPowerNames || [];
    const forceNames = state.forcePowerNames || [];

    const cfL1 = classFeaturesAtLevel(registry, state.classSlug, 1);
    const missTech = extractTechPowersKnownCount(cfL1);
    const missForce = extractForcePowersKnownCount(cfL1);
    const pc = cls.system && cls.system.powercasting ? cls.system.powercasting : {};
    let techReq = 0;
    let forceReq = 0;
    if (pc.tech && pc.tech !== 'none') {
        techReq = state.techPowerNamesRequired != null ? state.techPowerNamesRequired : missTech || 0;
    }
    if (pc.force && pc.force !== 'none') {
        forceReq = state.forcePowerNamesRequired != null ? state.forcePowerNamesRequired : missForce || 0;
    }

    const equipment = [];
    (state.equipmentLines || []).forEach((line) => {
        if (line && String(line).trim()) equipment.push({ name: String(line).trim(), equipped: false, quantity: 1 });
    });
    if (bg.system && bg.system.equipment && bg.system.equipment.value) {
        equipment.push({
            name: `Background kit: ${String(bg.system.equipment.value).slice(0, 120)}`,
            equipped: false,
            quantity: 1
        });
    }

    const charData = {
        name: state.identity.name.trim(),
        player_name: state.identity.playerName.trim(),
        species: species.name,
        speciesSlug: state.speciesSlug,
        background: bg.name,
        backgroundStableId: state.backgroundStableId,
        baseAbilityScores: {
            Strength: base.Strength,
            Dexterity: base.Dexterity,
            Constitution: base.Constitution,
            Intelligence: base.Intelligence,
            Wisdom: base.Wisdom,
            Charisma: base.Charisma
        },
        abilities: {
            str: { score: base.Strength, mod: abilityMod(base.Strength) },
            dex: { score: base.Dexterity, mod: abilityMod(base.Dexterity) },
            con: { score: base.Constitution, mod: abilityMod(base.Constitution) },
            int: { score: base.Intelligence, mod: abilityMod(base.Intelligence) },
            wis: { score: base.Wisdom, mod: abilityMod(base.Wisdom) },
            cha: { score: base.Charisma, mod: abilityMod(base.Charisma) }
        },
        proficiency_bonus: pb,
        saving_throw_proficiencies: Object.keys(savesProf).map((k) =>
            ({ str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }[k])
        ),
        skills: skillsObj,
        classes: [
            {
                name: className,
                levels: 1,
                hitPoints: [hp1],
                techPowers: techNames.slice(),
                forcePowers: forceNames.slice(),
                techPowerDetails: [],
                forcePowerDetails: []
            }
        ],
        class: `${className} 1`,
        level: 1,
        feats: state.backgroundFeatName ? [{ name: state.backgroundFeatName }] : [],
        techPowers: techNames.slice(),
        forcePowers: forceNames.slice(),
        equipment,
        speed: { walk: 30 },
        initiative: { mod: abilityMod(base.Dexterity) },
        traits: speciesFeats.map((sf) => sf.name).filter(Boolean),
        features: cfL1.map((cf) => cf.name).filter(Boolean),
        currentStats: { hitPointsLost: 0 },
        ac: { base: 10 + abilityMod(base.Dexterity) },
        builderMeta: {
            version: 1,
            choiceHistory: state.choiceHistory || [],
            identity: state.identity,
            missingData: []
        }
    };

    if (!missTech && pc.tech && pc.tech !== 'none')
        charData.builderMeta.missingData.push({
            field: 'tech_powers_known_count',
            note: 'Could not parse tech powers known from class features; player selected list manually.'
        });

    if (state.portraitDataUrl) {
        charData.image = state.portraitDataUrl;
    }

    return charData;
}
