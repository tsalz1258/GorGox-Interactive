/**
 * Armstech Engineering (SW5e-style) — modification reference for in-app tracker.
 * weapon: 'any' | 'blaster' | 'vibro' | 'blaster_str' (needs Str property) | 'vibro_dex' (needs Dex property on vibro)
 */
(function (global) {
    'use strict';

    function slotsForEngineerLevel(level) {
        const lv = Math.max(1, Math.min(20, Number(level) || 3));
        if (lv >= 17) return 8;
        if (lv >= 13) return 7;
        if (lv >= 9) return 6;
        if (lv >= 5) return 5;
        return 4;
    }

    var MODS = [
        { id: 'accuracy-focus', name: 'Accuracy Focus', minLevel: 5, weapon: 'blaster', requires: [], summary: '+1 attack (Blaster); +2 at 9th, +3 at 13th.' },
        { id: 'amplifying-barrel', name: 'Amplifying Barrel', minLevel: 5, weapon: 'blaster', requires: [], summary: '+1 damage (Blaster); +2 at 9th, +3 at 13th.' },
        { id: 'bayonet', name: 'Bayonet', minLevel: 3, weapon: 'blaster', requires: [], summary: 'Melee attack: finesse vibro blade, 1d6 kinetic.' },
        { id: 'burst-core', name: 'Burst Core', minLevel: 3, weapon: 'blaster', requires: [], summary: 'Weapon gains burst; burst number = reload number.' },
        { id: 'booming-strikes', name: 'Booming Strikes', minLevel: 5, weapon: 'any', requires: [], summary: '1/turn on hit: +1d6 damage; loud boom; sound-based detection risk if hidden.' },
        { id: 'celerity-oscillator', name: 'Celerity Oscillator', minLevel: 3, weapon: 'any', requires: [], summary: '1/turn on damage: +10 ft speed until next turn; target cannot OA you this turn.' },
        { id: 'collapsible-frame', name: 'Collapsible Frame', minLevel: 3, weapon: 'vibro', requires: [], summary: 'Vibroweapon gains reach.' },
        { id: 'compensation-oscillator', name: 'Compensation Oscillator', minLevel: 3, weapon: 'vibro_dex', requires: [], summary: 'Removes Dexterity property from your vibroweapon.' },
        { id: 'contoured-grip', name: 'Contoured Grip', minLevel: 5, weapon: 'vibro', requires: [], summary: '+1 attack (Vibro); +2 at 9th, +3 at 13th.' },
        { id: 'expanded-magazine', name: 'Expanded Magazine', minLevel: 3, weapon: 'blaster', requires: [], summary: 'Once, reload without an action; recharges when you reload with an action.' },
        { id: 'flashlight', name: 'Flashlight', minLevel: 3, weapon: 'any', requires: [], summary: 'Bonus action toggle; 60-ft bright cone.' },
        { id: 'harpoon-reel', name: 'Harpoon Reel', minLevel: 3, weapon: 'any', requires: [], summary: 'Secondary fire 30/60, 1d6 kinetic; reel/pull; reset as action.' },
        { id: 'imbue-weapon', name: 'Imbue Weapon', minLevel: 9, weapon: 'any', requires: [], summary: 'Short rest: store an at-will tech power in the weapon; releases on next hit.' },
        { id: 'improved-burst-core', name: 'Improved Burst Core', minLevel: 9, weapon: 'blaster', requires: ['burst-core'], summary: 'Burst number = half reload number.' },
        { id: 'integrated-magazine', name: 'Integrated Magazine', minLevel: 3, weapon: 'blaster', requires: ['expanded-magazine'], summary: 'Two reloads without an action before needing an action reload.' },
        { id: 'jagged-oscillator', name: 'Jagged Oscillator', minLevel: 3, weapon: 'vibro', requires: [], summary: 'On crit: +1d8 kinetic.' },
        { id: 'keen-oscillator', name: 'Keen Oscillator', minLevel: 5, weapon: 'vibro', requires: ['jagged-oscillator'], summary: 'Crit range +1.' },
        { id: 'neutronium-edge', name: 'Neutronium Edge', minLevel: 5, weapon: 'vibro', requires: [], summary: '+1 damage (Vibro); +2 at 9th, +3 at 13th.' },
        { id: 'overcharge-weapon', name: 'Overcharge Weapon', minLevel: 11, weapon: 'any', requires: ['booming-strikes'], summary: 'Expend tech slot for extra damage (stacks with Booming Strikes).' },
        { id: 'power-loop', name: 'Power Loop', minLevel: 9, weapon: 'any', requires: [], summary: 'On hit: gain temp HP = half damage dealt. 1/long rest.' },
        { id: 'recoil-dampener', name: 'Recoil Dampener', minLevel: 3, weapon: 'blaster_str', requires: [], summary: 'Removes Strength property from blaster.' },
        { id: 'returning-weapon-guard', name: 'Returning Weapon Guard', minLevel: 3, weapon: 'vibro', requires: [], summary: 'Thrown 20/60 if needed; returning property.' },
        { id: 'screening-weapon', name: 'Screening Weapon', minLevel: 3, weapon: 'any', requires: [], summary: 'Sound-based Perception/Investigation to find you at disadvantage when hidden attacking.' },
        { id: 'shock-absorber', name: 'Shock Absorber', minLevel: 3, weapon: 'any', requires: [], summary: 'Cast absorb energy; extra damage applies to melee and ranged weapon attacks.' },
        { id: 'siege-weapon', name: 'Siege Weapon', minLevel: 3, weapon: 'any', requires: [], summary: 'Double damage vs structures.' },
        { id: 'shocking-harpoon', name: 'Shocking Harpoon', minLevel: 9, weapon: 'any', requires: ['harpoon-reel'], summary: 'Bonus action at-will tech through harpoon line; adv/dis as appropriate. Resets with harpoon.' },
        { id: 'shocking-oscillator', name: 'Shocking Oscillator', minLevel: 9, weapon: 'vibro', requires: [], summary: 'On hit: 15-ft cone Dex save, 1d8 lightning. 1/long rest.' },
        { id: 'snap-fire', name: 'Snap Fire', minLevel: 9, weapon: 'blaster', requires: [], summary: 'Reaction opportunity attack at 10 ft with disadvantage.' },
        { id: 'staggering-oscillator', name: 'Staggering Oscillator', minLevel: 3, weapon: 'vibro', requires: [], summary: 'On hit: Str save or pushed 10 ft and prone. 1/short or long rest.' },
        { id: 'tracker', name: 'Tracker', minLevel: 5, weapon: 'any', requires: [], summary: '3 charges: 1 = target lock (bonus), 2 = detect invisibility (action). Long rest recharge.' },
        { id: 'truelight', name: 'Truelight', minLevel: 11, weapon: 'any', requires: ['flashlight'], summary: 'Bonus action: 1 min truesight-style light. 1/short or long rest.' },
        { id: 'venomous-oscillator', name: 'Venomous Oscillator', minLevel: 9, weapon: 'vibro', requires: [], summary: 'Bonus action: poison 1 min; next hit Con save vs tech DC. 1/long rest.' }
    ];

    global.ARMSTECH_ENGINEERING = {
        disciplineName: 'Armstech Engineering',
        modifications: MODS,
        modificationSlotsForLevel: slotsForEngineerLevel,
        /** Tech save DC per SW5e: 8 + PB + INT mod */
        techSaveDc: function (profBonus, intScore) {
            var pb = Math.max(0, Number(profBonus) || 0);
            var mod = Math.floor((Math.max(1, Number(intScore) || 10) - 10) / 2);
            return 8 + pb + mod;
        },
        intMod: function (intScore) {
            return Math.floor((Math.max(1, Number(intScore) || 10) - 10) / 2);
        },
        installsPerLongRest: function (intScore) {
            return Math.max(1, global.ARMSTECH_ENGINEERING.intMod(intScore));
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
