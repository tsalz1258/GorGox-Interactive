import { loadSw5eRegistry } from './registry.js';
import { validateStep, validateAllSteps } from './validation.js';
import { finalizeCharBuilderState } from './finalize.js';
import { convertSkillCodesToKeys } from './calculations.js';
import { extractTechPowersKnownCount, extractForcePowersKnownCount } from './progression.js';

const STEPS = [
    { id: 'identity', title: 'Identity' },
    { id: 'species', title: 'Species' },
    { id: 'background', title: 'Background' },
    { id: 'class', title: 'Class' },
    { id: 'abilities', title: 'Abilities' },
    { id: 'proficiencies', title: 'Proficiencies' },
    { id: 'equipment', title: 'Equipment' },
    { id: 'powers', title: 'Powers' },
    { id: 'review', title: 'Review' }
];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITIES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function createInitialState() {
    const base = {};
    ABILITIES.forEach((a, i) => {
        base[a] = STANDARD_ARRAY[i];
    });
    return {
        identity: {
            name: '',
            playerName: '',
            age: '',
            height: '',
            alignment: '',
            backstory: '',
            personality: '',
            ideals: '',
            bonds: '',
            flaws: ''
        },
        portraitDataUrl: '',
        speciesSlug: null,
        backgroundStableId: null,
        classSlug: null,
        archetypeStableId: null,
        baseAbilityScores: { ...base },
        classSkillKeysChosen: [],
        backgroundSkillKeysChosen: [],
        expertiseKeys: [],
        backgroundFeatName: null,
        equipmentLines: [],
        techPowerNames: [],
        forcePowerNames: [],
        techPowerNamesRequired: 0,
        forcePowerNamesRequired: 0,
        choiceHistory: [],
        stepIndex: 0,
        detailHtml: '',
        searchFilter: ''
    };
}

function parseBackgroundSkillLabels(bg) {
    const raw = bg && bg.system && bg.system.skillProficiencies && bg.system.skillProficiencies.value;
    if (!raw) return [];
    const m = String(raw).match(/choose two from ([^.]+)/i);
    if (!m) return [];
    return m[1]
        .split(/,| and /)
        .map((s) => s.trim())
        .filter(Boolean);
}

function backgroundSkillLabelToKey(label) {
    const t = label.toLowerCase();
    const map = {
        deception: 'deception',
        performance: 'performance',
        persuasion: 'persuasion',
        'sleight of hand': 'sleight_of_hand',
        athletics: 'athletics',
        insight: 'insight',
        intimidation: 'intimidation',
        investigation: 'investigation',
        perception: 'perception',
        stealth: 'stealth',
        survival: 'survival',
        medicine: 'medicine',
        lore: 'lore',
        nature: 'nature',
        piloting: 'piloting',
        technology: 'technology',
        'animal handling': 'animal_handling',
        acrobatics: 'acrobatics'
    };
    return map[t] || null;
}

let __registryPromise = null;
function getRegistry() {
    if (!__registryPromise) __registryPromise = loadSw5eRegistry();
    return __registryPromise;
}

async function fetchPowerNames(kind) {
    const path =
        kind === 'tech'
            ? '/static/data/sw5e_compendium/techpowers_from_packs.json'
            : '/static/data/sw5e_compendium/force_powers_from_packs.json';
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((row) => row.name).filter(Boolean);
}

function renderIdentity(center, state) {
    center.innerHTML = `
      <div class="sw5e-wiz-fields">
        <label>Character name <input type="text" data-k="name" value="${esc(state.identity.name)}" class="sw5e-wiz-input" /></label>
        <label>Player name <input type="text" data-k="playerName" value="${esc(state.identity.playerName)}" class="sw5e-wiz-input" /></label>
        <label>Age <input type="text" data-k="age" value="${esc(state.identity.age)}" class="sw5e-wiz-input" /></label>
        <label>Height <input type="text" data-k="height" value="${esc(state.identity.height)}" class="sw5e-wiz-input" /></label>
        <label>Alignment <input type="text" data-k="alignment" value="${esc(state.identity.alignment)}" class="sw5e-wiz-input" /></label>
        <label>Portrait <input type="file" accept="image/*" id="sw5eWizPortrait" /></label>
        <label>Backstory<textarea data-k="backstory" class="sw5e-wiz-ta">${esc(state.identity.backstory)}</textarea></label>
        <label>Personality<textarea data-k="personality" class="sw5e-wiz-ta">${esc(state.identity.personality)}</textarea></label>
        <label>Ideals<textarea data-k="ideals" class="sw5e-wiz-ta">${esc(state.identity.ideals)}</textarea></label>
        <label>Bonds<textarea data-k="bonds" class="sw5e-wiz-ta">${esc(state.identity.bonds)}</textarea></label>
        <label>Flaws<textarea data-k="flaws" class="sw5e-wiz-ta">${esc(state.identity.flaws)}</textarea></label>
      </div>`;
    center.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.getAttribute('data-k');
        const ev = el.tagName === 'TEXTAREA' ? 'input' : 'input';
        el.addEventListener(ev, () => {
            state.identity[k] = el.value;
        });
    });
    const pf = center.querySelector('#sw5eWizPortrait');
    if (pf) {
        pf.onchange = (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
                state.portraitDataUrl = rd.result;
            };
            rd.readAsDataURL(f);
        };
    }
}

function renderListSelect(center, state, registry, type, detailEl) {
    const filter = (state.searchFilter || '').toLowerCase();
    let rows;
    if (type === 'species') rows = registry.species;
    else if (type === 'background') rows = registry.backgrounds;
    else rows = registry.classes;
    rows = rows.filter((r) => !filter || String(r.name).toLowerCase().includes(filter));
    center.innerHTML = `<div class="sw5e-wiz-search"><input type="search" placeholder="Filter…" class="sw5e-wiz-input" id="sw5eWizSearch" value="${esc(state.searchFilter)}" /></div>
      <div class="sw5e-wiz-card-grid" id="sw5eWizCards"></div>`;
    const grid = center.querySelector('#sw5eWizCards');
    const q = center.querySelector('#sw5eWizSearch');
    q.addEventListener('input', () => {
        state.searchFilter = q.value;
        renderListSelect(center, state, registry, type, detailEl);
    });
    rows.forEach((row) => {
        const id =
            type === 'species'
                ? row._species_slug
                : type === 'background'
                  ? row._stable_id
                  : row._class_slug;
        const sel =
            type === 'species'
                ? state.speciesSlug === id
                : type === 'background'
                  ? state.backgroundStableId === id
                  : state.classSlug === id;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'sw5e-wiz-card' + (sel ? ' is-selected' : '');
        const icon =
            row._icon_url_app || (type === 'background' ? '' : '');
        card.innerHTML = `${icon ? `<img src="${esc(icon)}" alt="" loading="lazy"/>` : ''}<span class="sw5e-wiz-card-title">${esc(row.name)}</span>`;
        card.onclick = () => {
            if (type === 'species') state.speciesSlug = id;
            else if (type === 'background') state.backgroundStableId = id;
            else state.classSlug = id;
            const raw =
                row.description || (row.system && row.system.description && row.system.description.value) || '';
            state.detailHtml = raw;
            if (detailEl) {
                detailEl.innerHTML = `<div class="sw5e-wiz-details-inner">${raw}</div>`;
            }
            center.querySelectorAll('.sw5e-wiz-card').forEach((c) => c.classList.remove('is-selected'));
            card.classList.add('is-selected');
        };
        grid.appendChild(card);
    });
}

function renderAbilities(center, state) {
    const opts = STANDARD_ARRAY.map((n) => `<option value="${n}">${n}</option>`).join('');
    const rows = ABILITIES.map((a) => {
        const v = state.baseAbilityScores[a] ?? 10;
        return `<label>${a} <select data-ab="${a}" class="sw5e-wiz-select">${STANDARD_ARRAY.map(
            (n) => `<option value="${n}" ${Number(v) === n ? 'selected' : ''}>${n}</option>`
        ).join('')}</select></label>`;
    }).join('');
    center.innerHTML = `<p class="sw5e-wiz-hint">Assign the standard array (15–8) to each ability — each value once.</p>
      <button type="button" class="sw5e-wiz-btn-secondary" id="sw5eResetStd">Reset to default order</button>
      <div class="sw5e-wiz-fields">${rows}</div>`;
    center.querySelectorAll('select[data-ab]').forEach((sel) => {
        sel.onchange = () => {
            const k = sel.getAttribute('data-ab');
            state.baseAbilityScores[k] = parseInt(sel.value, 10);
        };
    });
    center.querySelector('#sw5eResetStd').onclick = () => {
        ABILITIES.forEach((a, i) => {
            state.baseAbilityScores[a] = STANDARD_ARRAY[i];
        });
        renderAbilities(center, state);
    };
}

function renderProficiencies(center, state, registry) {
    const cls = registry.classesBySlug.get(String(state.classSlug || '').toLowerCase());
    const bg = registry.backgroundsByStableId.get(String(state.backgroundStableId || '').toLowerCase());
    if (!cls) {
        center.innerHTML = '<p>Select a class first.</p>';
        return;
    }
    const pool = convertSkillCodesToKeys((cls.system.skills && cls.system.skills.choices) || []);
    const need = Number(cls.system.skills.number) || 0;
    const bgLabels = parseBackgroundSkillLabels(bg);
    const bgKeys = bgLabels.map(backgroundSkillLabelToKey).filter(Boolean);

    let html = `<h4 class="sw5e-wiz-sub">Class skills (pick ${need})</h4><div class="sw5e-wiz-chip-grid">`;
    pool.forEach((key) => {
        const on = state.classSkillKeysChosen.includes(key);
        html += `<button type="button" class="sw5e-wiz-chip${on ? ' is-on' : ''}" data-class-sk="${esc(key)}">${esc(key)}</button>`;
    });
    html += `</div>`;
    if (bgKeys.length) {
        html += `<h4 class="sw5e-wiz-sub">Background skills (pick 2)</h4><div class="sw5e-wiz-chip-grid">`;
        bgKeys.forEach((key) => {
            const on = state.backgroundSkillKeysChosen.includes(key);
            html += `<button type="button" class="sw5e-wiz-chip${on ? ' is-on' : ''}" data-bg-sk="${esc(key)}">${esc(key)}</button>`;
        });
        html += `</div>`;
    }
    if (bg && bg.system && bg.system.featOptions && bg.system.featOptions.value && bg.system.featOptions.value.length) {
        html += `<h4 class="sw5e-wiz-sub">Background feat</h4><select id="sw5eBgFeat" class="sw5e-wiz-select"><option value="">— Choose —</option>`;
        bg.system.featOptions.value.forEach((fo) => {
            const n = fo.name || '';
            html += `<option value="${esc(n)}" ${state.backgroundFeatName === n ? 'selected' : ''}>${esc(n)}</option>`;
        });
        html += `</select>`;
    }
    center.innerHTML = html;
    center.querySelectorAll('[data-class-sk]').forEach((btn) => {
        btn.onclick = () => {
            const k = btn.getAttribute('data-class-sk');
            const i = state.classSkillKeysChosen.indexOf(k);
            if (i >= 0) state.classSkillKeysChosen.splice(i, 1);
            else if (state.classSkillKeysChosen.length < need) state.classSkillKeysChosen.push(k);
            renderProficiencies(center, state, registry);
        };
    });
    center.querySelectorAll('[data-bg-sk]').forEach((btn) => {
        btn.onclick = () => {
            const k = btn.getAttribute('data-bg-sk');
            const i = state.backgroundSkillKeysChosen.indexOf(k);
            if (i >= 0) state.backgroundSkillKeysChosen.splice(i, 1);
            else if (state.backgroundSkillKeysChosen.length < 2) state.backgroundSkillKeysChosen.push(k);
            renderProficiencies(center, state, registry);
        };
    });
    const fs = center.querySelector('#sw5eBgFeat');
    if (fs) {
        fs.onchange = () => {
            state.backgroundFeatName = fs.value || null;
        };
    }
}

function renderEquipment(center, state) {
    const lines = (state.equipmentLines || []).join('\n') || '';
    center.innerHTML = `
      <p class="sw5e-wiz-hint">Starting equipment is derived from class/backstory in the rules. Add specific inventory lines (one per line). Background bundle is added on finalize.</p>
      <textarea id="sw5eEquipLines" class="sw5e-wiz-ta-large" placeholder="Vibrosword&#10;Light energy shield&#10;…">${esc(lines)}</textarea>`;
    center.querySelector('#sw5eEquipLines').addEventListener('input', (e) => {
        state.equipmentLines = e.target.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    });
}

async function renderPowers(center, state, registry) {
    const cls = registry.classesBySlug.get(String(state.classSlug || '').toLowerCase());
    const pc = cls && cls.system && cls.system.powercasting ? cls.system.powercasting : {};
    const slug = state.classSlug;
    const cfL1 = (registry.classFeaturesByClassSlug.get(slug) || [])
        .filter((x) => x.level === 1)
        .map((x) => x.row);
    let tNeed = extractTechPowersKnownCount(cfL1);
    let fNeed = extractForcePowersKnownCount(cfL1);
    if (pc.tech && pc.tech !== 'none') {
        if (tNeed == null) tNeed = 4;
        state.techPowerNamesRequired = tNeed;
    } else state.techPowerNamesRequired = 0;
    if (pc.force && pc.force !== 'none') {
        if (fNeed == null) fNeed = 4;
        state.forcePowerNamesRequired = fNeed;
    } else state.forcePowerNamesRequired = 0;

    if (!state.techPowerNamesRequired && !state.forcePowerNamesRequired) {
        center.innerHTML = '<p class="sw5e-wiz-hint">This class has no tech/force casting at 1st level (or data lists none). You can skip.</p>';
        return;
    }

    const techNames = state.techPowerNamesRequired ? await fetchPowerNames('tech') : [];
    const forceNames = state.forcePowerNamesRequired ? await fetchPowerNames('force') : [];

    let html = '';
    if (state.techPowerNamesRequired) {
        html += `<h4 class="sw5e-wiz-sub">Tech powers (pick ${state.techPowerNamesRequired})</h4>
          <input type="search" class="sw5e-wiz-input" id="sw5eTechSearch" placeholder="Filter tech powers…" />
          <div class="sw5e-wiz-power-grid" id="sw5eTechGrid"></div>`;
    }
    if (state.forcePowerNamesRequired) {
        html += `<h4 class="sw5e-wiz-sub">Force powers (pick ${state.forcePowerNamesRequired})</h4>
          <input type="search" class="sw5e-wiz-input" id="sw5eForceSearch" placeholder="Filter force powers…" />
          <div class="sw5e-wiz-power-grid" id="sw5eForceGrid"></div>`;
    }
    center.innerHTML = html;

    function bindGrid(gridId, searchId, pool, arrField, maxPick) {
        const grid = center.querySelector(gridId);
        const search = center.querySelector(searchId);
        if (!grid) return;

        function paint(filter) {
            const f = (filter || '').toLowerCase();
            const chosen = state[arrField] || [];
            grid.innerHTML = '';
            pool
                .filter((n) => !f || n.toLowerCase().includes(f))
                .slice(0, 200)
                .forEach((name) => {
                    const on = chosen.includes(name);
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'sw5e-wiz-chip' + (on ? ' is-on' : '');
                    b.textContent = name;
                    b.onclick = () => {
                        const ix = chosen.indexOf(name);
                        if (ix >= 0) chosen.splice(ix, 1);
                        else if (chosen.length < maxPick) chosen.push(name);
                        state[arrField] = chosen;
                        paint(search.value);
                    };
                    grid.appendChild(b);
                });
        }
        paint('');
        if (search) {
            search.oninput = () => paint(search.value);
        }
    }

    bindGrid('#sw5eTechGrid', '#sw5eTechSearch', techNames, 'techPowerNames', state.techPowerNamesRequired);
    bindGrid('#sw5eForceGrid', '#sw5eForceSearch', forceNames, 'forcePowerNames', state.forcePowerNamesRequired);
}

function renderReview(center, state, registry) {
    let html = '<div class="sw5e-wiz-review">';
    html += `<p><strong>Name:</strong> ${esc(state.identity.name)}</p>`;
    html += `<p><strong>Species:</strong> ${esc(registry.speciesBySlug.get(String(state.speciesSlug || '').toLowerCase())?.name)}</p>`;
    html += `<p><strong>Background:</strong> ${esc(registry.backgroundsByStableId.get(String(state.backgroundStableId || '').toLowerCase())?.name)}</p>`;
    html += `<p><strong>Class:</strong> ${esc(registry.classesBySlug.get(String(state.classSlug || '').toLowerCase())?.name)} 1</p>`;
    html += '<h4>Abilities</h4><ul>';
    ABILITIES.forEach((a) => {
        html += `<li>${esc(a)}: ${esc(state.baseAbilityScores[a])}</li>`;
    });
    html += `</ul><p><strong>Class skills:</strong> ${esc(state.classSkillKeysChosen.join(', '))}</p>`;
    html += `<p><strong>Background skills:</strong> ${esc(state.backgroundSkillKeysChosen.join(', '))}</p>`;
    if (state.techPowerNames.length) html += `<p><strong>Tech powers:</strong> ${esc(state.techPowerNames.join(', '))}</p>`;
    if (state.forcePowerNames.length) html += `<p><strong>Force powers:</strong> ${esc(state.forcePowerNames.join(', '))}</p>`;
    html += '</div>';
    center.innerHTML = html;
}

function updatePreview(panel, state, registry) {
    const sn = state.speciesSlug ? registry.speciesBySlug.get(String(state.speciesSlug).toLowerCase()) : null;
    const cn = state.classSlug ? registry.classesBySlug.get(String(state.classSlug).toLowerCase()) : null;
    panel.innerHTML = `
      <div class="sw5e-wiz-preview">
        <div class="sw5e-wiz-preview-name">${esc(state.identity.name || 'Unnamed')}</div>
        <div>${esc(sn ? sn.name : '—')} ${cn ? '· ' + esc(cn.name) : ''}</div>
        <div class="sw5e-wiz-preview-lv">Level 1</div>
      </div>`;
}

export async function mountSw5eCharacterWizard() {
    const registry = await getRegistry();
    const modal = document.getElementById('sw5eCreatorModal');
    if (!modal) return;
    const state = createInitialState();

    const nav = modal.querySelector('[data-sw5e-wiz-nav]');
    const center = modal.querySelector('[data-sw5e-wiz-center]');
    const detail = modal.querySelector('[data-sw5e-wiz-detail]');
    const preview = modal.querySelector('[data-sw5e-wiz-preview]');
    const errs = modal.querySelector('[data-sw5e-wiz-errors]');
    const prog = modal.querySelector('[data-sw5e-wiz-progress]');
    const title = modal.querySelector('[data-sw5e-wiz-title]');
    const btnBack = modal.querySelector('[data-sw5e-wiz-back]');
    const btnNext = modal.querySelector('[data-sw5e-wiz-next]');
    const btnFinish = modal.querySelector('[data-sw5e-wiz-finish]');

    function showErrors(stepId) {
        const e = validateStep(stepId, state, registry);
        errs.innerHTML = e.length ? `<ul>${e.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
        return e.length === 0;
    }

    function paintStep() {
        const step = STEPS[state.stepIndex];
        state.searchFilter = '';
        title.textContent = `Create Character — ${step.title}`;
        prog.textContent = `Step ${state.stepIndex + 1} / ${STEPS.length}`;
        if (nav) {
            nav.innerHTML = STEPS.map(
                (s, i) =>
                    `<button type="button" class="sw5e-wiz-nav-item${i === state.stepIndex ? ' is-active' : ''}" data-idx="${i}">${esc(s.title)}</button>`
            ).join('');
            nav.querySelectorAll('[data-idx]').forEach((btn) => {
                btn.onclick = () => {
                    state.stepIndex = parseInt(btn.getAttribute('data-idx'), 10);
                    paintStep();
                };
            });
        }
        btnBack.style.visibility = state.stepIndex > 0 ? 'visible' : 'hidden';
        const last = state.stepIndex === STEPS.length - 1;
        btnNext.style.display = last ? 'none' : 'inline-block';
        btnFinish.style.display = last ? 'inline-block' : 'none';

        const detail = modal.querySelector('[data-sw5e-wiz-detail]');
        if (step.id === 'identity') renderIdentity(center, state);
        else if (step.id === 'species') renderListSelect(center, state, registry, 'species', detail);
        else if (step.id === 'background') renderListSelect(center, state, registry, 'background', detail);
        else if (step.id === 'class') renderListSelect(center, state, registry, 'class', detail);
        else if (step.id === 'abilities') renderAbilities(center, state);
        else if (step.id === 'proficiencies') renderProficiencies(center, state, registry);
        else if (step.id === 'equipment') renderEquipment(center, state);
        else if (step.id === 'powers')
            void renderPowers(center, state, registry).then(() => {
                updatePreview(preview, state, registry);
            });
        else if (step.id === 'review') renderReview(center, state, registry);

        if (step.id !== 'powers') updatePreview(preview, state, registry);
        showErrors(step.id);
    }

    btnBack.onclick = () => {
        if (state.stepIndex > 0) {
            state.stepIndex--;
            paintStep();
        }
    };

    btnNext.onclick = () => {
        const step = STEPS[state.stepIndex];
        if (!showErrors(step.id)) return;
        state.choiceHistory.push({ step: step.id, action: 'next', ts: Date.now() });
        if (state.stepIndex < STEPS.length - 1) {
            state.stepIndex++;
            paintStep();
        }
    };

    btnFinish.onclick = () => {
        const allErrs = validateAllSteps(state, registry);
        errs.innerHTML = allErrs.length ? `<ul>${allErrs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
        if (allErrs.length) return;
        try {
            const charData = finalizeCharBuilderState(state, registry);
            if (typeof window.convertStarWarsBuilderJsonToGameCharacter !== 'function') {
                alert('Character converter not loaded.');
                return;
            }
            const { character } = window.convertStarWarsBuilderJsonToGameCharacter(charData, null);
            if (!character || !character.id) {
                alert('Could not build character.');
                return;
            }
            if (typeof window.sendMessage === 'function') {
                window.sendMessage({ type: 'CreateCharacter', character });
            }
            if (Array.isArray(window.characters)) {
                window.characters.push(character);
            }
            if (typeof window.renderCharacterList === 'function') window.renderCharacterList();
            if (typeof window.closeModal === 'function') window.closeModal('sw5eCreatorModal');
            else modal.classList.remove('active');
            if (typeof window.addLogEntry === 'function') {
                window.addLogEntry(`Created character (SW5E wizard): ${character.name}`, 'info');
            }
        } catch (err) {
            console.error(err);
            alert(err.message || String(err));
        }
    };

    modal.classList.add('active');
    paintStep();
}

export function unmountSw5eCharacterWizard() {
    const modal = document.getElementById('sw5eCreatorModal');
    if (modal) modal.classList.remove('active');
}
