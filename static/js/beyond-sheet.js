/**
 * D&D Beyond–style standalone character sheet renderer for GorGox.
 * Used only by /static/character-sheet.html (does not load app.js).
 */
(function (global) {
  'use strict';

  var ABILITY_ORDER = [
    { key: 'str', label: 'Strength', full: 'Strength' },
    { key: 'dex', label: 'Dexterity', full: 'Dexterity' },
    { key: 'con', label: 'Constitution', full: 'Constitution' },
    { key: 'int', label: 'Intelligence', full: 'Intelligence' },
    { key: 'wis', label: 'Wisdom', full: 'Wisdom' },
    { key: 'cha', label: 'Charisma', full: 'Charisma' }
  ];

  var SW_SKILLS = [
    { key: 'athletics', name: 'Athletics', ab: 'str' },
    { key: 'acrobatics', name: 'Acrobatics', ab: 'dex' },
    { key: 'sleight_of_hand', name: 'Sleight of Hand', ab: 'dex' },
    { key: 'stealth', name: 'Stealth', ab: 'dex' },
    { key: 'investigation', name: 'Investigation', ab: 'int' },
    { key: 'lore', name: 'Lore', ab: 'int' },
    { key: 'nature', name: 'Nature', ab: 'int' },
    { key: 'piloting', name: 'Piloting', ab: 'int' },
    { key: 'technology', name: 'Technology', ab: 'int' },
    { key: 'animal_handling', name: 'Animal Handling', ab: 'wis' },
    { key: 'insight', name: 'Insight', ab: 'wis' },
    { key: 'medicine', name: 'Medicine', ab: 'wis' },
    { key: 'perception', name: 'Perception', ab: 'wis' },
    { key: 'survival', name: 'Survival', ab: 'wis' },
    { key: 'deception', name: 'Deception', ab: 'cha' },
    { key: 'intimidation', name: 'Intimidation', ab: 'cha' },
    { key: 'performance', name: 'Performance', ab: 'cha' },
    { key: 'persuasion', name: 'Persuasion', ab: 'cha' }
  ];

  var DND_SKILLS = [
    { key: 'athletics', name: 'Athletics', ab: 'str' },
    { key: 'acrobatics', name: 'Acrobatics', ab: 'dex' },
    { key: 'sleight_of_hand', name: 'Sleight of Hand', ab: 'dex' },
    { key: 'stealth', name: 'Stealth', ab: 'dex' },
    { key: 'arcana', name: 'Arcana', ab: 'int' },
    { key: 'history', name: 'History', ab: 'int' },
    { key: 'investigation', name: 'Investigation', ab: 'int' },
    { key: 'nature', name: 'Nature', ab: 'int' },
    { key: 'religion', name: 'Religion', ab: 'int' },
    { key: 'animal_handling', name: 'Animal Handling', ab: 'wis' },
    { key: 'insight', name: 'Insight', ab: 'wis' },
    { key: 'medicine', name: 'Medicine', ab: 'wis' },
    { key: 'perception', name: 'Perception', ab: 'wis' },
    { key: 'survival', name: 'Survival', ab: 'wis' },
    { key: 'deception', name: 'Deception', ab: 'cha' },
    { key: 'intimidation', name: 'Intimidation', ab: 'cha' },
    { key: 'performance', name: 'Performance', ab: 'cha' },
    { key: 'persuasion', name: 'Persuasion', ab: 'cha' }
  ];

  function esc(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function signed(n) {
    var v = Number(n) || 0;
    return v >= 0 ? '+' + v : String(v);
  }

  function calcMod(score) {
    var n = Number(score);
    if (isNaN(n)) n = 10;
    return Math.floor((n - 10) / 2);
  }

  function isStarWars(char, data) {
    if (data && (data.species || (Array.isArray(data.classes) && data.baseAbilityScores))) return true;
    if (char && /star|sw5e/i.test(String(char.style || ''))) return true;
    return !!(data && data.forcePoints) || !!(data && data.techPoints);
  }

  function displayName(char, data) {
    var raw = (data && data.name) || (char && char.name) || 'Character';
    var s = String(raw).trim();
    if (s.charAt(0) === '"') s = s.slice(1);
    if (s.charAt(s.length - 1) === '"') s = s.slice(0, -1);
    return s.trim() || 'Character';
  }

  function classLine(char, data) {
    if (data && Array.isArray(data.classes) && data.classes.length) {
      return data.classes
        .map(function (c) {
          var name = c.name || 'Class';
          var lv = c.levels || c.level || '';
          return lv ? name + ' ' + lv : name;
        })
        .join(' / ');
    }
    var cls = (char && char.class) || (data && data.class) || '';
    var level = (char && char.level) || (data && data.level) || '';
    return (cls + (level ? ' ' + level : '')).trim() || 'Adventurer';
  }

  function speciesLine(data, char) {
    if (data && data.species) {
      if (typeof data.species === 'string') return data.species;
      if (data.species.name) return data.species.name;
    }
    return (char && char.species) || '';
  }

  function abilityScores(char, data) {
    var out = {};
    ABILITY_ORDER.forEach(function (a) {
      out[a.key] = 10;
    });
    if (data && data.baseAbilityScores) {
      ABILITY_ORDER.forEach(function (a) {
        if (data.baseAbilityScores[a.full] != null) out[a.key] = Number(data.baseAbilityScores[a.full]) || 10;
      });
    } else if (data && data.abilities) {
      ABILITY_ORDER.forEach(function (a) {
        var row = data.abilities[a.key];
        if (row && row.score != null) out[a.key] = Number(row.score) || 10;
      });
    } else if (char) {
      out.str = Number(char.strength) || 10;
      out.dex = Number(char.dexterity) || 10;
      out.con = Number(char.constitution) || 10;
      out.int = Number(char.intelligence) || 10;
      out.wis = Number(char.wisdom) || 10;
      out.cha = Number(char.charisma) || 10;
    }
    return out;
  }

  function abilityMods(scores) {
    var out = {};
    Object.keys(scores).forEach(function (k) {
      out[k] = calcMod(scores[k]);
    });
    return out;
  }

  function profBonus(char, data) {
    return Number((data && data.proficiency_bonus) || (char && char.proficiency_bonus) || 2) || 2;
  }

  function saveProfSet(data) {
    var set = {};
    if (data && Array.isArray(data.saving_throw_proficiencies)) {
      data.saving_throw_proficiencies.forEach(function (ab) {
        set[String(ab).toLowerCase()] = true;
      });
    } else if (data && data.abilities) {
      ABILITY_ORDER.forEach(function (a) {
        if (data.abilities[a.key] && data.abilities[a.key].save_proficient) set[a.key] = true;
      });
    }
    return set;
  }

  function skillRows(char, data, mods, pb, starWars) {
    var list = starWars ? SW_SKILLS : DND_SKILLS;
    return list.map(function (skill) {
      var base = mods[skill.ab] || 0;
      var proficient = false;
      var expertise = false;
      var mod = base;
      if (data && data.skills && data.skills[skill.key]) {
        var row = data.skills[skill.key];
        if (typeof row.mod === 'number') mod = row.mod;
        proficient = !!row.proficient;
        expertise = !!row.expertise;
      }
      return {
        key: skill.key,
        name: skill.name,
        ab: skill.ab,
        mod: mod,
        proficient: proficient,
        expertise: expertise
      };
    });
  }

  function passive(skillMod) {
    return 10 + (Number(skillMod) || 0);
  }

  function equipmentList(data) {
    if (!data || !data.equipment) return [];
    if (Array.isArray(data.equipment)) return data.equipment;
    if (Array.isArray(data.equipment.items)) return data.equipment.items;
    return [];
  }

  function featureList(data) {
    var out = [];
    function push(name, content) {
      var n = String(name || '').trim();
      if (!n) return;
      out.push({ name: n, content: content || '' });
    }
    if (data && Array.isArray(data.customFeatures)) {
      data.customFeatures.forEach(function (f) {
        if (typeof f === 'string') push(f, '');
        else push(f.name || f.Name, f.content || f.description || '');
      });
    }
    if (data && Array.isArray(data.feats)) {
      data.feats.forEach(function (f) {
        if (typeof f === 'string') push(f, '');
        else push(f.name || f.Name, f.description || f.content || '');
      });
    }
    if (data && Array.isArray(data.customFeats)) {
      data.customFeats.forEach(function (f) {
        if (typeof f === 'string') push(f, '');
        else push(f.name || f.Name, f.content || f.description || '');
      });
    }
    if (data && Array.isArray(data.features)) {
      data.features.forEach(function (f) {
        if (typeof f === 'string') push(f, '');
        else if (f && typeof f === 'object') {
          Object.keys(f).forEach(function (k) {
            var arr = f[k];
            if (Array.isArray(arr)) arr.forEach(function (x) { push(typeof x === 'string' ? x : x.name, x.content || ''); });
          });
        }
      });
    } else if (data && data.features && typeof data.features === 'object') {
      ['class_features', 'species_traits', 'feats'].forEach(function (k) {
        var arr = data.features[k];
        if (Array.isArray(arr)) arr.forEach(function (x) { push(typeof x === 'string' ? x : x.name, x.content || x.description || ''); });
      });
    }
    return out;
  }

  function powerNames(data, kind) {
    var names = [];
    function add(n) {
      if (!n) return;
      if (names.indexOf(n) === -1) names.push(n);
    }
    if (!data) return names;
    if (Array.isArray(data.classes)) {
      data.classes.forEach(function (cls) {
        var arr = kind === 'force' ? cls.forcePowers : cls.techPowers;
        if (Array.isArray(arr)) arr.forEach(add);
      });
    }
    var top = kind === 'force' ? data.forcePowers : data.techPowers;
    if (Array.isArray(top)) top.forEach(add);
    var custom = kind === 'force' ? data.customForcePowers : data.customTechPowers;
    if (Array.isArray(custom)) {
      custom.forEach(function (p) {
        add(typeof p === 'string' ? p : p && p.name);
      });
    }
    return names;
  }

  function notesText(data) {
    if (!data) return '';
    if (typeof data.notes === 'string') return data.notes;
    if (data.notes && typeof data.notes === 'object') {
      return data.notes.text || data.notes.content || JSON.stringify(data.notes);
    }
    return '';
  }

  function backgroundText(data) {
    if (!data || !data.background) return '';
    if (typeof data.background === 'string') return data.background;
    var parts = [];
    if (data.background.name) parts.push(data.background.name);
    if (data.background.feat && data.background.feat.name) parts.push('Feat: ' + data.background.feat.name);
    if (data.background.feature) parts.push(String(data.background.feature));
    return parts.join('\n');
  }

  function iconImg(url, fallbackText, cls) {
    var c = cls || 'ddb-ico';
    if (url) {
      return '<img class="' + c + '" src="' + esc(url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling&&(this.nextElementSibling.style.display=\'inline-flex\')">' +
        '<span class="' + c + '-fallback" style="display:none" aria-hidden="true">' + (fallbackText || '•') + '</span>';
    }
    return '<span class="' + c + '-fallback" aria-hidden="true">' + (fallbackText || '•') + '</span>';
  }

  function resolveIcon(map, name) {
    if (!map || !name) return '';
    var key = String(name).toLowerCase().trim();
    if (map[key]) return map[key];
    var compact = key.replace(/[^a-z0-9]/g, '');
    if (map[compact]) return map[compact];
    return '';
  }

  function render(state) {
    var char = state.character || {};
    var data = state.characterData || {};
    var computed = state.computed || {};
    var icons = state.icons || {};
    var itemIcons = icons.items || {};
    var powerIcons = icons.powers || {};
    var powerMeta = icons.powerMeta || {};
    var fallbackItem = icons.fallbackItem || '';
    var tab = state.tab || 'actions';
    var starWars = isStarWars(char, data);
    var scores = abilityScores(char, data);
    var mods = abilityMods(scores);
    var pb = profBonus(char, data);
    var saves = saveProfSet(data);
    var skills = skillRows(char, data, mods, pb, starWars);
    var name = displayName(char, data);
    var cls = classLine(char, data);
    var species = speciesLine(data, char);
    var hpCur = char.current_hp != null ? char.current_hp : 0;
    var hpMax = char.max_hp != null ? char.max_hp : 0;
    var ac = computed.ac != null ? computed.ac : char.armor_class;
    var speed = (data.speed && (data.speed.walk || data.speed)) || char.speed || 30;
    var init = (data.initiative && data.initiative.mod != null) ? data.initiative.mod : (char.initiative_bonus || mods.dex || 0);
    var credits = data.credits != null ? Number(data.credits) || 0 : 0;
    var inspiration = data.inspiration === true;
    var attacks = Array.isArray(computed.attacks) ? computed.attacks : (Array.isArray(data.attacks) ? data.attacks : []);
    var gear = equipmentList(data);
    var features = featureList(data);
    var techPowers = powerNames(data, 'tech');
    var forcePowers = powerNames(data, 'force');
    var techPts = computed.techPts || { current: 0, max: 0 };
    var forcePts = computed.forcePts || { current: 0, max: 0 };
    var conditions = Array.isArray(data.activeConditions) ? data.activeConditions : [];
    var defenses = Array.isArray(data.defenses) ? data.defenses : (Array.isArray(data.resistances) ? data.resistances : []);
    var perception = skills.find(function (s) { return s.key === 'perception'; });
    var investigation = skills.find(function (s) { return s.key === 'investigation'; });
    var insight = skills.find(function (s) { return s.key === 'insight'; });

    var portrait = char.portrait_url || char.portrait || data.portrait || data.image || '';
    var hpPct = hpMax > 0 ? Math.max(0, Math.min(100, Math.round((Number(hpCur) / Number(hpMax)) * 100))) : 0;

    var html = '';
    html += '<div class="ddb-sheet' + (starWars ? ' is-sw' : '') + '" data-char-id="' + esc(char.id || '') + '" data-char-name="' + esc(name) + '">';

    html += '<header class="ddb-header">';
    html += '<div class="ddb-identity">';
    if (portrait) html += '<img class="ddb-portrait" src="' + esc(portrait) + '" alt="" loading="lazy">';
    else html += '<div class="ddb-portrait ddb-portrait-fallback" aria-hidden="true">⚔</div>';
    html += '<div class="ddb-identity-text">';
    html += '<div class="ddb-name">' + esc(name) + '</div>';
    html += '<div class="ddb-sub">' + esc(cls) + (species ? ' · ' + esc(species) : '') + '</div>';
    html += '</div></div>';
    html += '<div class="ddb-rests">';
    html += '<button type="button" class="ddb-btn" data-beyond-action="short-rest">Short Rest</button>';
    html += '<button type="button" class="ddb-btn" data-beyond-action="long-rest">Long Rest</button>';
    html += '<button type="button" class="ddb-btn ddb-btn-ghost" onclick="refreshCharacterSheet()">Refresh</button>';
    html += '</div></header>';

    html += '<div class="ddb-topstats">';
    html += '<div class="ddb-abilities">';
    ABILITY_ORDER.forEach(function (a) {
      html += '<button type="button" class="ddb-ability" data-beyond-roll="ability" data-ability="' + a.key + '" data-mod="' + mods[a.key] + '" title="Left-click to roll · Right-click for Advantage/Disadvantage">';
      html += '<div class="ddb-ability-label">' + esc(a.label.slice(0, 3)) + '</div>';
      html += '<div class="ddb-ability-mod">' + signed(mods[a.key]) + '</div>';
      html += '<div class="ddb-ability-score">' + esc(scores[a.key]) + '</div>';
      html += '</button>';
    });
    html += '</div>';

    html += '<div class="ddb-vitals">';
    html += '<div class="ddb-vital"><span>Proficiency</span><strong>' + signed(pb) + '</strong></div>';
    html += '<div class="ddb-vital"><span>Speed</span><strong>' + esc(String(speed)) + (String(speed).indexOf('ft') === -1 ? ' ft.' : '') + '</strong></div>';
    html += '<button type="button" class="ddb-vital ddb-vital-btn" data-beyond-roll="initiative" data-mod="' + init + '" title="Left-click to roll · Right-click for Advantage/Disadvantage"><span>Initiative</span><strong>' + signed(init) + '</strong></button>';
    html += '<div class="ddb-vital ddb-ac"><span>AC</span><strong>' + esc(ac) + '</strong></div>';
    html += '<div class="ddb-vital ddb-hp"><span>Hit Points</span><strong><input class="ddb-hp-input" type="number" min="0" value="' + esc(hpCur) + '"> / ' + esc(hpMax) + '</strong>';
    html += '<div class="ddb-hp-bar"><i style="width:' + hpPct + '%"></i></div></div>';
    html += '</div></div>';

    html += '<div class="ddb-layout">';

    html += '<aside class="ddb-col ddb-col-left">';
    html += '<section class="ddb-card"><h3>Saving Throws</h3><div class="ddb-list">';
    ABILITY_ORDER.forEach(function (a) {
      var proficient = !!saves[a.key];
      var saveMod = (mods[a.key] || 0) + (proficient ? pb : 0);
      html += '<button type="button" class="ddb-row" data-beyond-roll="save" data-ability="' + a.key + '" data-mod="' + saveMod + '" title="Left-click to roll · Right-click for Advantage/Disadvantage">';
      html += '<span class="ddb-prof ' + (proficient ? 'is-on' : '') + '">' + (proficient ? '●' : '○') + '</span>';
      html += '<span>' + esc(a.label) + '</span><strong>' + signed(saveMod) + '</strong></button>';
    });
    html += '</div></section>';

    html += '<section class="ddb-card"><h3>Senses</h3><div class="ddb-list static">';
    html += '<div class="ddb-row"><span>Passive Perception</span><strong>' + passive(perception && perception.mod) + '</strong></div>';
    html += '<div class="ddb-row"><span>Passive Investigation</span><strong>' + passive(investigation && investigation.mod) + '</strong></div>';
    html += '<div class="ddb-row"><span>Passive Insight</span><strong>' + passive(insight && insight.mod) + '</strong></div>';
    html += '</div></section>';

    html += '<section class="ddb-card"><h3>Proficiencies & Training</h3><div class="ddb-profs">';
    var armor = (data.proficiencies && data.proficiencies.armor) || (data.customProficiencies && data.customProficiencies.armor) || [];
    var weapons = (data.proficiencies && data.proficiencies.weapons) || (data.customProficiencies && data.customProficiencies.weapons) || [];
    var tools = (data.proficiencies && data.proficiencies.tools) || (data.customProficiencies && data.customProficiencies.tools) || [];
    var languages = (data.proficiencies && data.proficiencies.languages) || (data.customLanguages) || [];
    function listOrDash(v) {
      if (Array.isArray(v) && v.length) return esc(v.map(function (x) { return typeof x === 'string' ? x : x.name; }).filter(Boolean).join(', '));
      if (typeof v === 'string' && v.trim()) return esc(v);
      return '<span class="ddb-muted">—</span>';
    }
    html += '<div><strong>Armor</strong><div>' + listOrDash(armor) + '</div></div>';
    html += '<div><strong>Weapons</strong><div>' + listOrDash(weapons) + '</div></div>';
    html += '<div><strong>Tools</strong><div>' + listOrDash(tools) + '</div></div>';
    html += '<div><strong>Languages</strong><div>' + listOrDash(languages) + '</div></div>';
    html += '</div></section>';
    html += '</aside>';

    html += '<aside class="ddb-col ddb-col-skills">';
    html += '<section class="ddb-card"><h3>Skills</h3><div class="ddb-list">';
    skills.forEach(function (s) {
      var mark = s.expertise ? '◆' : (s.proficient ? '●' : '○');
      var clsMark = s.expertise ? 'is-exp' : (s.proficient ? 'is-on' : '');
      html += '<button type="button" class="ddb-row" data-beyond-roll="skill" data-skill="' + esc(s.name) + '" data-mod="' + s.mod + '" title="Left-click to roll · Right-click for Advantage/Disadvantage">';
      html += '<span class="ddb-prof ' + clsMark + '">' + mark + '</span>';
      html += '<span>' + esc(s.name) + ' <em>(' + s.ab.toUpperCase() + ')</em></span>';
      html += '<strong>' + signed(s.mod) + '</strong></button>';
    });
    html += '</div></section></aside>';

    html += '<main class="ddb-col ddb-col-main">';
    html += '<div class="ddb-tabs">';
    ['actions', 'spells', 'inventory', 'features', 'background', 'notes', 'extras'].forEach(function (t) {
      var label = t === 'spells' ? (starWars ? 'Powers' : 'Spells') : t.charAt(0).toUpperCase() + t.slice(1);
      if (t === 'features') label = 'Features & Traits';
      html += '<button type="button" class="ddb-tab' + (tab === t ? ' active' : '') + '" data-beyond-tab="' + t + '">' + label + '</button>';
    });
    html += '</div>';
    html += '<div class="ddb-tab-body">';

    if (tab === 'actions') {
      html += '<section class="ddb-card"><h3>Attacks</h3><div class="ddb-attacks">';
      if (!attacks.length) {
        html += '<div class="ddb-empty">No attacks on this sheet yet. Equip a weapon in Inventory.</div>';
      } else {
        attacks.forEach(function (atk) {
          var wname = atk.name || atk.weapon_name || 'Attack';
          var toHit = atk.to_hit != null ? atk.to_hit : (atk.toHit != null ? atk.toHit : 0);
          var dmg = atk.damage || atk.damage_dice || '1d4';
          var dtype = atk.type || atk.damage_type || '';
          var range = atk.range != null ? atk.range : '';
          var ico = resolveIcon(itemIcons, wname) || fallbackItem;
          html += '<div class="ddb-attack-row">';
          html += '<button type="button" class="ddb-attack" data-beyond-roll="attack" data-weapon="' + esc(wname) + '" data-to-hit="' + toHit + '" data-damage="' + esc(dmg) + '" data-damage-type="' + esc(dtype) + '" data-range="' + esc(range) + '" title="Left-click to attack · Right-click for Advantage/Disadvantage">';
          html += iconImg(ico, '⚔');
          html += '<div class="ddb-attack-text"><div class="ddb-attack-name">' + esc(wname) + '</div>';
          html += '<div class="ddb-attack-meta">To Hit ' + signed(toHit) + ' · ' + esc(dmg) + (dtype ? ' ' + esc(dtype) : '') + (range ? ' · ' + esc(range) : '') + '</div></div>';
          html += '</button>';
          html += '<button type="button" class="ddb-detail-btn" data-beyond-detail="attack" data-name="' + esc(wname) + '" data-to-hit="' + toHit + '" data-damage="' + esc(dmg) + '" data-damage-type="' + esc(dtype) + '" data-range="' + esc(range) + '" title="Open details">ⓘ</button>';
          html += '</div>';
        });
      }
      html += '</div></section>';

      if (starWars && (techPts.max > 0 || forcePts.max > 0)) {
        html += '<section class="ddb-card ddb-card-compact"><h3>Power Points</h3><div class="ddb-resources">';
        if (techPts.max > 0) {
          html += '<div class="ddb-resource"><span>⚡ Tech ' + techPts.current + ' / ' + techPts.max + '</span>';
          html += '<button type="button" data-beyond-action="use-tech">Use 1</button>';
          html += '<button type="button" data-beyond-action="restore-tech">Restore</button></div>';
        }
        if (forcePts.max > 0) {
          html += '<div class="ddb-resource"><span>✦ Force ' + forcePts.current + ' / ' + forcePts.max + '</span>';
          html += '<button type="button" data-beyond-action="use-force">Use 1</button>';
          html += '<button type="button" data-beyond-action="restore-force">Restore</button></div>';
        }
        html += '</div></section>';
      }

      html += '<section class="ddb-card"><h3>Actions / Features</h3><div class="ddb-features-mini">';
      if (!features.length) html += '<div class="ddb-empty">No class features listed.</div>';
      features.slice(0, 10).forEach(function (f) {
        html += '<div class="ddb-feature-wrap">';
        html += '<button type="button" class="ddb-feature" data-beyond-detail="feature" data-name="' + esc(f.name) + '" data-content="' + esc(f.content || '') + '">';
        html += '<strong>' + esc(f.name) + '</strong>';
        if (f.content) html += '<div class="ddb-feature-body">' + esc(String(f.content).slice(0, 140)) + (String(f.content).length > 140 ? '…' : '') + '</div>';
        html += '</button>';
        html += '<button type="button" class="ddb-mini" data-beyond-action="log-feature" data-feature="' + esc(f.name) + '">Use</button>';
        html += '</div>';
      });
      html += '</div></section>';
    } else if (tab === 'spells') {
      var powerFilter = state.powerFilter || { tech: 'all', force: 'all' };
      var powerUses = state.powerUses || {};

      function metaFor(p) {
        var key = String(p || '').toLowerCase().trim();
        var compact = key.replace(/[^a-z0-9]/g, '');
        return powerMeta[key] || powerMeta[compact] || null;
      }
      function normalizeTier(rawLevel) {
        if (rawLevel == null || rawLevel === '') return { tier: null, label: '?', unknown: true };
        if (typeof rawLevel === 'number' && !isNaN(rawLevel)) {
          return { tier: rawLevel, label: rawLevel === 0 ? 'At-will' : ('Lvl ' + rawLevel), unknown: false };
        }
        var s = String(rawLevel).trim();
        var lower = s.toLowerCase();
        if (lower === 'at-will' || lower === 'at will' || lower === 'atwill' || lower === 'cantrip' || s === '0') {
          return { tier: 0, label: 'At-will', unknown: false };
        }
        if (/^\d+$/.test(s)) {
          var n = parseInt(s, 10);
          return { tier: n, label: n === 0 ? 'At-will' : ('Lvl ' + n), unknown: false };
        }
        var m = s.match(/(\d+)/);
        if (m) {
          var n2 = parseInt(m[1], 10);
          return { tier: n2, label: n2 === 0 ? 'At-will' : ('Lvl ' + n2), unknown: false };
        }
        return { tier: null, label: s || '?', unknown: true };
      }
      function tierMeta(p) {
        var meta = metaFor(p);
        return normalizeTier(meta && meta.level);
      }
      function useKey(powerType, p) {
        return powerType + ':' + String(p || '').toLowerCase().trim();
      }
      function orderedTiers(list) {
        var seen = {};
        list.forEach(function (p) {
          var t = tierMeta(p);
          if (t.unknown) seen.unknown = true;
          else if (t.tier != null) seen[t.tier] = true;
        });
        var out = [];
        if (seen[0]) out.push('0');
        var L;
        for (L = 1; L <= 9; L++) if (seen[L]) out.push(String(L));
        if (seen.unknown) out.push('unknown');
        return out;
      }
      function passesFilter(p, filterKey) {
        if (!filterKey || filterKey === 'all') return true;
        var t = tierMeta(p);
        if (filterKey === 'unknown') return !!t.unknown;
        var want = parseInt(filterKey, 10);
        if (isNaN(want)) return true;
        if (t.unknown) return false;
        return t.tier === want;
      }
      function filterChips(kind, list) {
        var active = powerFilter[kind] || 'all';
        var keys = orderedTiers(list);
        var h = '<div class="ddb-power-filters" role="group" aria-label="Filter ' + kind + ' powers by level">';
        function chip(key, label) {
          return '<button type="button" class="ddb-filter-chip' + (active === key ? ' active' : '') + '" data-beyond-filter="' + kind + '" data-tier="' + esc(key) + '">' + esc(label) + '</button>';
        }
        h += chip('all', 'All');
        keys.forEach(function (k) {
          var lab = k === '0' ? 'At-will' : (k === 'unknown' ? '?' : ('Lvl ' + k));
          h += chip(k, lab);
        });
        h += '</div>';
        return h;
      }
      function pointsCard(kind, pts) {
        var cur = pts && pts.current != null ? pts.current : 0;
        var max = pts && pts.max != null ? pts.max : 0;
        var spent = Math.max(0, max - cur);
        var icon = kind === 'force' ? '✦' : '⚡';
        var label = kind === 'force' ? 'Force Points' : 'Tech Points';
        var h = '<div class="ddb-points-card ddb-points-card--' + kind + '">';
        h += '<div class="ddb-points-label">' + icon + ' ' + label + '</div>';
        h += '<div class="ddb-points-value">' + cur + '<small>/' + max + '</small></div>';
        h += '<div class="ddb-points-spent">' + spent + ' spent</div>';
        h += '<div class="ddb-points-actions">';
        h += '<button type="button" class="ddb-mini" data-beyond-action="use-' + kind + '" title="Spend 1 point">−</button>';
        h += '<button type="button" class="ddb-mini" data-beyond-action="restore-' + kind + '" title="Restore on rest">↺</button>';
        h += '</div></div>';
        return h;
      }
      function powerRow(p, powerType) {
        var ico = resolveIcon(powerIcons, p) || fallbackItem;
        var fb = powerType === 'force' ? '✦' : '⚡';
        var meta = metaFor(p);
        var t = tierMeta(p);
        var cast = meta && meta.casting ? String(meta.casting).replace(/^1\s+/i, '') : '—';
        var range = meta && meta.range ? meta.range : '—';
        var uses = Number(powerUses[useKey(powerType, p)]) || 0;
        var cost = (!t.unknown && t.tier > 0) ? t.tier : 0;
        var row = '';
        row += '<div class="ddb-power-line">';
        row += '<button type="button" class="ddb-power-row ' + powerType + '" data-beyond-detail="power" data-power-type="' + powerType + '" data-name="' + esc(p) + '" title="Open power details">';
        row += iconImg(ico, fb);
        row += '<span class="ddb-power-name">' + esc(p) + '<em>' + esc(t.label) + (cost ? (' · cost ' + cost) : ' · free') + '</em></span>';
        row += '<span class="ddb-power-cell" title="Casting time">' + esc(cast) + '</span>';
        row += '<span class="ddb-power-cell" title="Range">' + esc(range) + '</span>';
        row += '<span class="ddb-power-tag">' + (powerType === 'force' ? 'Force' : 'Tech') + '</span>';
        row += '</button>';
        row += '<div class="ddb-power-track" title="Times used this session"><span>' + uses + '</span><small>used</small></div>';
        row += '<button type="button" class="ddb-mini ddb-power-use" data-beyond-action="use-power" data-power-type="' + powerType + '" data-name="' + esc(p) + '" data-tier="' + (t.unknown ? '' : t.tier) + '" data-cost="' + cost + '" title="' + (cost ? ('Cast and spend ' + cost + ' point' + (cost === 1 ? '' : 's')) : 'Cast at-will power') + '">Use</button>';
        row += '</div>';
        return row;
      }
      function powerHeader() {
        return '<div class="ddb-power-head"><span>Power</span><span>Uses</span><span>Cast</span></div>';
      }
      function renderPool(kind, title, list, pts) {
        var filter = powerFilter[kind] || 'all';
        var shown = 0;
        var block = '<section class="ddb-card ddb-card-powers"><div class="ddb-powers-headrow">';
        block += '<h3>' + title + '</h3>';
        block += pointsCard(kind, pts);
        block += '</div>';
        if (list.length) block += filterChips(kind, list);
        block += powerHeader();
        block += '<div class="ddb-power-list">';
        if (!list.length) {
          block += '<div class="ddb-empty">No ' + kind + ' powers on this sheet.</div>';
        } else {
          list.forEach(function (p) {
            if (!passesFilter(p, filter)) return;
            shown++;
            block += powerRow(p, kind);
          });
          if (!shown) block += '<div class="ddb-empty">No powers match this filter.</div>';
        }
        block += '</div></section>';
        return block;
      }

      if (starWars) {
        html += renderPool('tech', 'Tech Powers', techPowers, techPts);
        html += renderPool('force', 'Force Powers', forcePowers, forcePts);
      } else {
        html += '<section class="ddb-card"><h3>Spells</h3>';
        html += filterChips('tech', techPowers);
        html += powerHeader();
        html += '<div class="ddb-power-list">';
        if (!techPowers.length) html += '<div class="ddb-empty">No spells on this sheet.</div>';
        techPowers.forEach(function (p) {
          if (!passesFilter(p, powerFilter.tech || 'all')) return;
          html += powerRow(p, 'tech');
        });
        html += '</div></section>';
      }
    } else if (tab === 'inventory') {
      html += '<section class="ddb-card ddb-card-compact"><h3>Credits</h3>';
      html += '<div class="ddb-credits"><input type="number" min="0" class="ddb-credits-input" value="' + credits + '"><button type="button" data-beyond-action="save-credits">Save</button></div></section>';
      html += '<section class="ddb-card"><h3>Inventory</h3>';
      html += '<div class="ddb-add-row"><input class="ddb-add-item" list="beyondItemCatalog" placeholder="Add item from catalog"><button type="button" data-beyond-action="add-item">Add</button></div>';
      html += '<datalist id="beyondItemCatalog"></datalist>';
      html += '<div class="ddb-inv-list">';
      if (!gear.length) html += '<div class="ddb-empty">Nothing carried.</div>';
      gear.forEach(function (item, idx) {
        var iname = typeof item === 'string' ? item : (item.name || item.Name || 'Item');
        var qty = typeof item === 'object' ? (item.quantity || item.qty || 1) : 1;
        var equipped = !!(item && item.equipped);
        var ico = resolveIcon(itemIcons, iname) || icons.fallbackItem || '';
        html += '<div class="ddb-inv-row">';
        html += '<button type="button" class="ddb-inv-name" data-beyond-detail="item" data-name="' + esc(iname) + '" data-index="' + idx + '" title="Open item details">';
        html += iconImg(ico, '📦');
        html += '<span>' + esc(iname) + (qty > 1 ? ' ×' + qty : '') + (equipped ? ' ★' : '') + '</span></button>';
        html += '<button type="button" data-beyond-action="toggle-equip" data-index="' + idx + '">' + (equipped ? 'Unequip' : 'Equip') + '</button>';
        html += '<button type="button" class="danger" data-beyond-action="remove-item" data-index="' + idx + '">×</button>';
        html += '</div>';
      });
      html += '</div></section>';
    } else if (tab === 'features') {
      html += '<section class="ddb-card"><h3>Features & Traits</h3><div class="ddb-features-mini">';
      if (!features.length) html += '<div class="ddb-empty">No features listed.</div>';
      features.forEach(function (f) {
        html += '<button type="button" class="ddb-feature" data-beyond-detail="feature" data-name="' + esc(f.name) + '" data-content="' + esc(f.content || '') + '">';
        html += '<strong>' + esc(f.name) + '</strong>';
        if (f.content) html += '<div class="ddb-feature-body">' + esc(String(f.content).slice(0, 180)) + (String(f.content).length > 180 ? '…' : '') + '</div>';
        html += '</button>';
      });
      html += '</div></section>';
    } else if (tab === 'background') {
      html += '<section class="ddb-card"><h3>Background</h3><pre class="ddb-notes">' + esc(backgroundText(data) || 'No background text.') + '</pre></section>';
      if (data.characteristics) {
        html += '<section class="ddb-card"><h3>Characteristics</h3><pre class="ddb-notes">' + esc(typeof data.characteristics === 'string' ? data.characteristics : JSON.stringify(data.characteristics, null, 2)) + '</pre></section>';
      }
    } else if (tab === 'notes') {
      html += '<section class="ddb-card"><h3>Notes</h3>';
      html += '<textarea class="ddb-notes-edit" rows="10">' + esc(notesText(data)) + '</textarea>';
      html += '<button type="button" data-beyond-action="save-notes">Save Notes</button></section>';
    } else if (tab === 'extras') {
      html += '<section class="ddb-card"><h3>Dice Tray</h3><div class="ddb-dice">';
      [4, 6, 8, 10, 12, 20, 100].forEach(function (sides) {
        html += '<button type="button" data-beyond-roll="flat" data-sides="' + sides + '">D' + sides + '</button>';
      });
      html += '</div></section>';
    }

    html += '</div></main>';

    html += '<aside class="ddb-col ddb-col-right">';
    html += '<section class="ddb-card"><h3>Defenses</h3><div class="ddb-list static" id="beyondDefenses">';
    if (!defenses.length) html += '<div class="ddb-empty">No resistances listed.</div>';
    defenses.forEach(function (d, i) {
      html += '<div class="ddb-row"><span>' + esc(typeof d === 'string' ? d : d.name || d) + '</span>';
      html += '<button type="button" class="danger ddb-mini" data-beyond-action="remove-defense" data-index="' + i + '">×</button></div>';
    });
    html += '</div><div class="ddb-add-row"><input class="ddb-add-defense" placeholder="Add defense / resistance"><button type="button" data-beyond-action="add-defense">Add</button></div></section>';

    html += '<section class="ddb-card"><h3>Conditions</h3><div class="ddb-list static">';
    if (!conditions.length) html += '<div class="ddb-empty">No active conditions.</div>';
    conditions.forEach(function (c, i) {
      html += '<div class="ddb-row"><span>' + esc(c) + '</span>';
      html += '<button type="button" class="danger ddb-mini" data-beyond-action="remove-condition" data-index="' + i + '">×</button></div>';
    });
    html += '</div><div class="ddb-add-row"><input class="ddb-add-condition" placeholder="Add condition"><button type="button" data-beyond-action="add-condition">Add</button></div></section>';

    html += '<section class="ddb-card"><h3>Heroic Inspiration</h3>';
    html += '<button type="button" class="ddb-insp' + (inspiration ? ' on' : '') + '" data-beyond-action="toggle-inspiration">' + (inspiration ? '✦ Has Inspiration' : 'Add Inspiration') + '</button>';
    html += '</section></aside>';

    html += '</div></div>';
    return html;
  }

  global.BeyondSheet = {
    render: render,
    displayName: displayName,
    isStarWars: isStarWars
  };
})(typeof window !== 'undefined' ? window : this);
