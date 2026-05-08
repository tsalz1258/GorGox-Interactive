/**
 * Loads and indexes SW5e compendium JSON slices from /static/data/sw5e_compendium/
 */

const BASE = '/static/data/sw5e_compendium';

async function fetchJson(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return r.json();
}

/**
 * Extract level from classfeature _imported_from path: classfeatures/berserker/1/rage.json
 */
export function classFeatureLevelFromPath(importedFrom) {
    if (!importedFrom || typeof importedFrom !== 'string') return null;
    const m = importedFrom.match(/classfeatures\/[^/]+\/(\d+)\//i);
    return m ? parseInt(m[1], 10) : null;
}

function indexBy(arr, keyFn) {
    const m = new Map();
    (arr || []).forEach((row, i) => {
        const k = keyFn(row, i);
        if (k != null && k !== '') m.set(String(k).toLowerCase(), row);
    });
    return m;
}

function indexByStableId(arr) {
    const m = new Map();
    (arr || []).forEach((row) => {
        if (row && row._stable_id) m.set(row._stable_id, row);
        if (row && row._fvtt_id) {
            const fid = String(row._fvtt_id).toLowerCase();
            m.set(`fvtt:${fid}`, row);
        }
    });
    return m;
}

let registryLoadPromise = null;

async function fetchAndBuildRegistry() {
    const [
        species,
        classes,
        backgrounds,
        archetypes,
        classfeatures,
        speciesfeatures,
        feats
    ] = await Promise.all([
        fetchJson(`${BASE}/species_from_packs.json`),
        fetchJson(`${BASE}/classes_from_packs.json`),
        fetchJson(`${BASE}/backgrounds_from_packs.json`),
        fetchJson(`${BASE}/archetypes_from_packs.json`),
        fetchJson(`${BASE}/classfeatures_from_packs.json`),
        fetchJson(`${BASE}/speciesfeatures_from_packs.json`),
        fetchJson(`${BASE}/feats_from_packs.json`).catch(() => [])
    ]);

    const speciesBySlug = indexBy(species, (r) => r._species_slug);
    const classesBySlug = indexBy(classes, (r) => r._class_slug);
    const backgroundsByStableId = indexBy(backgrounds, (r) => r._stable_id);
    const archetypesByFvtt = indexBy(archetypes, (r) => r._fvtt_id);
    const archetypesByStable = indexBy(archetypes, (r) => r._stable_id);
    const classFeaturesByFvtt = indexByStableId(classfeatures);
    const featsByFvtt = indexBy(feats, (r) => r._fvtt_id);

    const classFeaturesByClassSlug = new Map();
    (classfeatures || []).forEach((cf) => {
        const slug = cf._class_slug ? String(cf._class_slug).toLowerCase() : '';
        if (!slug) return;
        const lv = classFeatureLevelFromPath(cf._imported_from);
        if (!classFeaturesByClassSlug.has(slug)) classFeaturesByClassSlug.set(slug, []);
        classFeaturesByClassSlug.get(slug).push({ row: cf, level: lv });
    });

    const speciesFeaturesBySpecies = new Map();
    (speciesfeatures || []).forEach((sf) => {
        const slug = sf._species_slug ? String(sf._species_slug).toLowerCase() : '';
        if (!slug) return;
        if (!speciesFeaturesBySpecies.has(slug)) speciesFeaturesBySpecies.set(slug, []);
        speciesFeaturesBySpecies.get(slug).push(sf);
    });

    const archetypesByClassSlug = new Map();
    (archetypes || []).forEach((ar) => {
        const csRaw = ar._class_slug || (ar.system && ar.system.classIdentifier);
        const cs = csRaw ? String(csRaw).toLowerCase() : '';
        if (!cs) return;
        if (!archetypesByClassSlug.has(cs)) archetypesByClassSlug.set(cs, []);
        archetypesByClassSlug.get(cs).push(ar);
    });

    return {
        species,
        classes,
        backgrounds,
        archetypes,
        classfeatures,
        speciesfeatures,
        feats,
        speciesBySlug,
        classesBySlug,
        backgroundsByStableId,
        archetypesByFvtt,
        archetypesByStable,
        classFeaturesByFvtt,
        featsByFvtt,
        classFeaturesByClassSlug,
        speciesFeaturesBySpecies,
        archetypesByClassSlug
    };
}

/**
 * Singleton registry (shared by creator wizard, level-up, etc.).
 */
export async function loadSw5eRegistry() {
    if (!registryLoadPromise) {
        registryLoadPromise = fetchAndBuildRegistry().catch((e) => {
            registryLoadPromise = null;
            throw e;
        });
    }
    return registryLoadPromise;
}

let _fvttInvocationNames = null;
/** For resolving Fighter strategies, berserker instincts, etc. from advancement pools — loaded once. */
export async function getInvocationFvttToNameMap() {
    if (_fvttInvocationNames) return _fvttInvocationNames;
    const rows = await fetchJson(`${BASE}/invocations_from_packs.json`).catch(() => []);
    const m = new Map();
    (rows || []).forEach((r) => {
        if (r && r._fvtt_id) m.set(String(r._fvtt_id).toLowerCase(), r.name);
    });
    _fvttInvocationNames = m;
    return m;
}

let _fvttArchetypeFeatureNames = null;
export async function getArchetypeFeatureFvttToNameMap() {
    if (_fvttArchetypeFeatureNames) return _fvttArchetypeFeatureNames;
    const rows = await fetchJson(`${BASE}/archetypefeatures_from_packs.json`).catch(() => []);
    const m = new Map();
    (rows || []).forEach((r) => {
        if (r && r._fvtt_id) m.set(String(r._fvtt_id).toLowerCase(), r.name);
    });
    _fvttArchetypeFeatureNames = m;
    return m;
}

/** Human label for ItemGrant UUID path (class or archetype feature). */
export function resolveGrantedFeatureName(grantPath, registry, archetypeFeatNameMap) {
    if (!grantPath) return null;
    const s = String(grantPath).toLowerCase();
    const row = resolveClassFeatureGrant(grantPath, registry);
    if (row && row.name) return row.name;
    if (s.includes('archetypefeatures.') && archetypeFeatNameMap) {
        const tail = String(grantPath).split('.').pop().toLowerCase();
        return archetypeFeatNameMap.get(tail) || null;
    }
    return null;
}

/** Resolve Compendium.sw5e.classfeatures.XXX id to row */
export function resolveClassFeatureGrant(grantId, registry) {
    if (!grantId || !registry) return null;
    const id = String(grantId).split('.').pop().toLowerCase();
    return registry.classFeaturesByFvtt.get(`fvtt:${id}`);
}

/** Resolve Compendium.sw5e.archetypes.XXX */
export function resolveArchetypeGrant(grantId, registry) {
    if (!grantId || !registry) return null;
    const id = String(grantId).split('.').pop().toLowerCase();
    return registry.archetypesByFvtt.get(id);
}
