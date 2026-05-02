import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/TransformControls.js";
import { STLLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js";

let initialized = false;
let arenaEl = null;
let viewportEl = null;
let dropHintEl = null;
let fileInputEl = null;

let renderer = null;
/** PMREM for scene.environment (IBL — critical for MeshStandard / MeshPhysical). */
let arenaPmremGenerator = null;
let scene = null;
let camera = null;
let orbit = null;
let transform = null;
let raycaster = null;
let pointerNdc = null;

/** Parent for floor + grid + STLs — same coordinate system as 2D map pixels (1 unit = 1 px). */
let battlefieldGroup = null;
/** Token-linked STLs (not in `selectable`); preserved when the floor texture reloads. */
let tokenMiniRoot = null;
/** Combat movement / targeting / measurement overlay (map pixel space → world XZ). */
let combatOverlayRoot = null;
/** @type {Map<string, { mesh: THREE.Object3D | null, url: string, loading?: boolean, pendingWorld?: { wx: number, wz: number, cell: number } }>} */
let tokenMiniById = new Map();
/** Monotonic per-token generation so stale fetches never add a second mesh. */
let tokenMiniLoadGen = new Map();
let groundMesh = null;
let gridLines = null;
let groundPlane = null;
/** Distant inward-facing textured sphere ("space beyond the grid"). Not part of battlefieldGroup. */
let starfieldMesh = null;

let selectable = [];
let selectedObject = null;
let animHandle = 0;
let syncIntervalId = null;
let dirKeyLight = null;

/** Match 2D map / grid (world units = pixels). */
let mapWidth = 1200;
let mapHeight = 800;
let gridWorld = 50;
let lastBattlefieldSyncKey = "";
const _boundsBox = new THREE.Box3();

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function isAllowedArenaModelFilename(name) {
  const n = (name || "").toLowerCase();
  return n.endsWith(".stl") || n.endsWith(".glb");
}

function isProbablyGlbArrayBuffer(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const u8 = new Uint8Array(buffer, 0, 4);
  return u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46;
}

function virtualNameForModelBuffer(urlOrPath, buffer) {
  const p = String(urlOrPath || "")
    .split("?")[0]
    .toLowerCase();
  const base = p.split("/").pop() || p;
  if (base.endsWith(".glb") || base.endsWith(".stl")) return base;
  return isProbablyGlbArrayBuffer(buffer) ? "model.glb" : "model.stl";
}

/**
 * Meshy / GLB exports often use dark textures + high metalness; without IBL they read as black.
 * scene.environment supplies reflections; this nudges intensity and clamps extreme PBR so faces stay visible.
 */
function applyArenaGlbMaterialBoost(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
        mat.envMapIntensity = (mat.envMapIntensity ?? 1) * 1.45;
        if (mat.metalness != null && mat.metalness > 0.92) mat.metalness = 0.88;
        if (mat.roughness != null && mat.roughness < 0.15) mat.roughness = 0.2;
      }
    }
  });
}

function captureMiniFootprintReference(root) {
  if (!root) return;
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.userData.tokenMiniFoot = box.isEmpty() ? 1 : Math.max(size.x, size.z) || 1;
}

function applyMiniScaleForCell(root, cellWorld, maxScale) {
  if (!root || root.userData == null || root.userData.tokenMiniFoot == null || isNaN(root.userData.tokenMiniFoot)) return;
  const foot = root.userData.tokenMiniFoot || 1;
  const s = clamp((0.82 * cellWorld) / foot, 0.03, maxScale);
  root.scale.setScalar(s);
  plantMiniOnFloor(root);
}

/**
 * @param {string} virtualName — filename or URL tail used only to pick .stl vs .glb
 * @param {ArrayBuffer} buffer
 * @param {{ stlColor?: number }} [opts]
 * @returns {Promise<THREE.Object3D>}
 */
function parseArenaModelBuffer(virtualName, buffer, opts) {
  const nameLower = String(virtualName || "").toLowerCase();
  const useGlb = nameLower.endsWith(".glb") || isProbablyGlbArrayBuffer(buffer);
  if (useGlb) {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.parse(
        buffer,
        "",
        (gltf) => {
          try {
            const scene = gltf.scene;
            scene.traverse((c) => {
              if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
              }
            });
            applyArenaGlbMaterialBoost(scene);
            scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(scene);
            const ctr = box.getCenter(new THREE.Vector3());
            scene.position.sub(ctr);
            scene.updateMatrixWorld(true);
            resolve(scene);
          } catch (e) {
            reject(e);
          }
        },
        (err) => reject(err || new Error("GLB parse failed"))
      );
    });
  }
  const stlColor = opts && opts.stlColor != null ? opts.stlColor : 0xd8d2c2;
  const loader = new STLLoader();
  const geom = loader.parse(buffer);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  const center = new THREE.Vector3();
  geom.boundingBox.getCenter(center);
  geom.translate(-center.x, -center.y, -center.z);
  const material = new THREE.MeshStandardMaterial({
    color: stlColor,
    roughness: 0.65,
    metalness: 0.06,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return Promise.resolve(mesh);
}

/** Keep mesh bottom on the floor plane (y = 0) after move/rotate/scale. */
function plantMiniOnFloor(mesh) {
  if (!mesh) return;
  mesh.updateMatrixWorld(true);
  _boundsBox.setFromObject(mesh);
  if (_boundsBox.isEmpty()) return;
  const dy = -_boundsBox.min.y;
  if (Math.abs(dy) > 1e-5) mesh.position.y += dy;
}

/** If world AABB sticks out past the map edges in XZ, nudge position once. Returns true if moved. */
function clampMiniInsideMapXZOnce(mesh) {
  if (!mesh || mapWidth <= 0 || mapHeight <= 0) return false;
  mesh.updateMatrixWorld(true);
  _boundsBox.setFromObject(mesh);
  if (_boundsBox.isEmpty()) return false;
  const hw = mapWidth / 2;
  const hh = mapHeight / 2;
  let dx = 0;
  let dz = 0;
  if (_boundsBox.min.x < -hw) dx = -hw - _boundsBox.min.x;
  else if (_boundsBox.max.x > hw) dx = hw - _boundsBox.max.x;
  if (_boundsBox.min.z < -hh) dz = -hh - _boundsBox.min.z;
  else if (_boundsBox.max.z > hh) dz = hh - _boundsBox.max.z;
  if (dx === 0 && dz === 0) return false;
  mesh.position.x += dx;
  mesh.position.z += dz;
  return true;
}

function isUserTransformableMini(mesh) {
  if (!mesh) return false;
  if (selectable.includes(mesh)) return true;
  return !!(mesh.userData && mesh.userData.gorgoxTokenMiniId);
}

function isTokenLinkedMini(mesh) {
  return !!(mesh && mesh.userData && mesh.userData.gorgoxTokenMiniId);
}

/**
 * Keep mini on the table: optional grid snap, always floor-plant, clamp inside map footprint.
 * @param {{ snapGrid?: boolean }} opts — snapGrid true while translating (and on release / spawn).
 */
function applyMiniConstraints(mesh, opts) {
  const snapGrid = !!(opts && opts.snapGrid);
  if (!mesh || !isUserTransformableMini(mesh)) return;
  const doSnap = snapGrid;
  for (let i = 0; i < 12; i++) {
    if (doSnap) snapObjectToGrid(mesh);
    plantMiniOnFloor(mesh);
    if (!clampMiniInsideMapXZOnce(mesh)) break;
  }
  plantMiniOnFloor(mesh);
}

function resolveBattlefieldSnapshotFn() {
  const out = [];
  try {
    if (typeof globalThis !== "undefined") out.push(globalThis);
  } catch (_) {}
  try {
    if (typeof window !== "undefined") out.push(window);
  } catch (_) {}
  try {
    if (typeof document !== "undefined" && document.defaultView) out.push(document.defaultView);
  } catch (_) {}
  for (let i = 0; i < out.length; i++) {
    const o = out[i];
    const f = o && o.getBattlefieldSnapshotForArena3d;
    if (typeof f === "function") return f;
  }
  return null;
}

function getSnapshot() {
  if (typeof window !== "undefined" && typeof window.__arena3dPullBattlefieldSnapshot === "function") {
    return window.__arena3dPullBattlefieldSnapshot();
  }
  const fn = resolveBattlefieldSnapshotFn();
  if (fn) {
    return fn();
  }
  return {
    hasMap: false,
    image: null,
    imagePath: null,
    width: 1200,
    height: 800,
    gridPixels: 50,
    tokens: [],
    combatOverlay: { movementCells: null, targeting: null, measurements: [] },
  };
}

function disposeBattlefieldChildren() {
  if (!battlefieldGroup) return;
  const toRemove = [];
  for (const ch of battlefieldGroup.children) {
    if (selectable.includes(ch)) continue;
    if (ch === tokenMiniRoot || ch === combatOverlayRoot || ch.userData?.gorgoxPreserveInBattlefieldSync) continue;
    toRemove.push(ch);
  }
  for (const ch of toRemove) {
    battlefieldGroup.remove(ch);
    ch.traverse?.((n) => {
      if (n.geometry && typeof n.geometry.dispose === "function") n.geometry.dispose();
      if (n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) {
          if (m.map && typeof m.map.dispose === "function") m.map.dispose();
          if (typeof m.dispose === "function") m.dispose();
        }
      }
    });
  }
  groundMesh = null;
  gridLines = null;
}

function buildGridOverlay(w, h, g) {
  const hw = w / 2;
  const hh = h / 2;
  const verts = [];
  const step = Math.max(4, g);
  for (let px = 0; px <= w; px += step) {
    const x = px - hw;
    verts.push(x, 0.02, -hh, x, 0.02, hh);
  }
  for (let py = 0; py <= h; py += step) {
    const z = py - hh;
    verts.push(-hw, 0.02, z, hw, 0.02, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x4a9eff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  return new THREE.LineSegments(geo, mat);
}

function createStarfieldSky() {
  const W = 2048;
  const H = 1024;
  const canvasEl = typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvasEl) return null;
  canvasEl.width = W;
  canvasEl.height = H;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return null;
  const radial = ctx.createRadialGradient(W * 0.4, H * 0.12, 0, W * 0.4, H * 0.55, Math.max(W, H) * 1.05);
  radial.addColorStop(0, "#1f2f58");
  radial.addColorStop(0.35, "#121a38");
  radial.addColorStop(0.7, "#080814");
  radial.addColorStop(1, "#020205");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);

  const nebulaCount = 14;
  for (let i = 0; i < nebulaCount; i++) {
    const mx = Math.random() * W;
    const my = Math.random() * H * 0.95;
    const r = 60 + Math.random() * 180;
    const g2 = ctx.createRadialGradient(mx, my, 0, mx, my, r);
    const rr = Math.floor(55 + Math.random() * 80);
    const rg = Math.floor(35 + Math.random() * 60);
    const rb = Math.floor(110 + Math.random() * 90);
    g2.addColorStop(0, `rgba(${rr},${rg},${rb},${0.11 + Math.random() * 0.1})`);
    g2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g2;
    ctx.globalAlpha = 1;
    ctx.fillRect(mx - r, my - r, r * 2, r * 2);
  }

  let i = 0;
  while (i < 5200) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const band = Math.sin((y / H) * Math.PI); // Fewer stars at bottom for horizon feel
    if (band < Math.random()) {
      continue;
    }
    i++;
    const br = Math.random();
    ctx.fillStyle = br > 0.992 ? "#ffffff" : br > 0.935 ? "#d4e9ff" : "#8aa4cc";
    ctx.globalAlpha = 0.3 + Math.random() * 0.7;
    const sz = br > 0.985 ? 2 : br > 0.915 ? 1.5 : 1;
    ctx.fillRect(Math.floor(x), Math.floor(y), sz, sz);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvasEl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;

  const geo = new THREE.SphereGeometry(16000, 48, 32);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    depthWrite: false,
  });
  mat.toneMapped = false;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "gorgoxStarfield";
  mesh.renderOrder = -2000;
  return mesh;
}

function disposeCombatOverlayChildren() {
  if (!combatOverlayRoot) return;
  while (combatOverlayRoot.children.length > 0) {
    const ch = combatOverlayRoot.children[0];
    combatOverlayRoot.remove(ch);
    tryDispose(ch);
  }
}

function addMovementCellsOverlay3d(cells, g) {
  if (!combatOverlayRoot || !Array.isArray(cells) || cells.length < 1) return;
  const cell = Math.max(4, g);
  const geom = new THREE.PlaneGeometry(cell, cell);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x22ee55,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geom, mat, cells.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const px = Number(c.x) * cell + cell / 2;
    const py = Number(c.y) * cell + cell / 2;
    const { wx, wz } = pixelToWorldXZ(px, py);
    dummy.position.set(wx, 0.038, wz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.renderOrder = 2;
  combatOverlayRoot.add(mesh);
}

function addTargetingOverlay3d(t) {
  if (!combatOverlayRoot || !t || !t.mode) return;
  const cx = Number(t.cx);
  const cy = Number(t.cy);
  if (!isFinite(cx) || !isFinite(cy)) return;
  const { wx, wz } = pixelToWorldXZ(cx, cy);
  const y = 0.055;
  if (t.mode === "dual" && t.innerPx > 0 && t.outerPx >= t.innerPx) {
    const innerPx = Number(t.innerPx);
    const outerPx = Number(t.outerPx);
    const ringGeo = new THREE.RingGeometry(innerPx, outerPx, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xc9a227,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.position.set(wx, y, wz);
    ring.renderOrder = 3;
    combatOverlayRoot.add(ring);
    const diskGeo = new THREE.CircleGeometry(innerPx, 48);
    diskGeo.rotateX(-Math.PI / 2);
    const disk = new THREE.Mesh(
      diskGeo,
      new THREE.MeshBasicMaterial({
        color: 0x44cc66,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    disk.position.set(wx, y + 0.004, wz);
    disk.renderOrder = 4;
    combatOverlayRoot.add(disk);
  } else if (t.mode === "single" && t.rPx > 0) {
    const rPx = Number(t.rPx);
    const diskGeo = new THREE.CircleGeometry(rPx, 64);
    diskGeo.rotateX(-Math.PI / 2);
    const disk = new THREE.Mesh(
      diskGeo,
      new THREE.MeshBasicMaterial({
        color: 0xc9a227,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    disk.position.set(wx, y, wz);
    disk.renderOrder = 3;
    combatOverlayRoot.add(disk);
  }
}

function addMeasurementRuler3d(m) {
  if (!combatOverlayRoot || m.x0 == null || m.y0 == null || m.x1 == null || m.y1 == null) return;
  const a = pixelToWorldXZ(m.x0, m.y0);
  const b = pixelToWorldXZ(m.x1, m.y1);
  const y = 0.048;
  const verts = new Float32Array([a.wx, y, a.wz, b.wx, y, b.wz]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffaa44, linewidth: 1, depthWrite: false })
  );
  line.renderOrder = 5;
  combatOverlayRoot.add(line);
}

function addMeasurementCircle3d(m) {
  if (!combatOverlayRoot || m.cx == null || m.cy == null || !(m.rPx > 0)) return;
  const { wx, wz } = pixelToWorldXZ(m.cx, m.cy);
  const rPx = Number(m.rPx);
  const geo = new THREE.CircleGeometry(rPx, 64);
  geo.rotateX(-Math.PI / 2);
  const disk = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  disk.position.set(wx, 0.046, wz);
  disk.renderOrder = 4;
  combatOverlayRoot.add(disk);
}

function addMeasurementCone3d(m, g) {
  if (!combatOverlayRoot || m.x == null || m.y == null) return;
  const cell = Math.max(4, g);
  const halfAngle = (((m.angle != null ? m.angle : 60) * Math.PI) / 180) / 2;
  const directionRad = (((m.direction != null ? m.direction : 0) * Math.PI) / 180);
  const distFeet = m.distance != null ? m.distance : 15;
  const length = (distFeet / 5) * cell;
  const tipX = m.x;
  const tipY = m.y;
  const dirX = Math.cos(directionRad);
  const dirY = Math.sin(directionRad);
  const baseX = tipX + dirX * length;
  const baseY = tipY + dirY * length;
  const perpX = -dirY;
  const perpY = dirX;
  const baseWidth = Math.tan(halfAngle) * length;
  const BLx = baseX + perpX * baseWidth;
  const BLy = baseY + perpY * baseWidth;
  const BRx = baseX - perpX * baseWidth;
  const BRy = baseY - perpY * baseWidth;
  const t = pixelToWorldXZ(tipX, tipY);
  const bl = pixelToWorldXZ(BLx, BLy);
  const br = pixelToWorldXZ(BRx, BRy);
  const y = 0.042;
  const verts = new Float32Array([t.wx, y, t.wz, bl.wx, y, bl.wz, br.wx, y, br.wz]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const coneMesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  coneMesh.renderOrder = 3;
  combatOverlayRoot.add(coneMesh);
}

function syncCombatOverlayFromSnapshot(snap) {
  if (!combatOverlayRoot) return;
  disposeCombatOverlayChildren();
  const o = snap && snap.combatOverlay;
  if (!o) return;
  const g = Math.max(4, Number(snap.gridPixels) || gridWorld || 50);
  if (Array.isArray(o.movementCells) && o.movementCells.length > 0) {
    addMovementCellsOverlay3d(o.movementCells, g);
  }
  if (o.targeting && o.targeting.mode) {
    addTargetingOverlay3d(o.targeting);
  }
  if (Array.isArray(o.measurements)) {
    for (const m of o.measurements) {
      if (!m) continue;
      if (m.type === "ruler") addMeasurementRuler3d(m);
      else if (m.type === "circle") addMeasurementCircle3d(m);
      else if (m.type === "cone") addMeasurementCone3d(m, g);
    }
  }
}

function syncBattlefieldFromGorgox(force) {
  if (!battlefieldGroup) return;
  const snap = getSnapshot();
  const w = Math.max(100, Number(snap.width) || 1200);
  const h = Math.max(100, Number(snap.height) || 800);
  const g = Math.max(4, Number(snap.gridPixels) || 50);
  const img = snap.image;
  const key = `${w}|${h}|${g}|${snap.imagePath || ""}|${img && img.complete && img.naturalWidth ? img.naturalWidth + "x" + img.naturalHeight : "noimg"}`;
  if (!force && key === lastBattlefieldSyncKey) {
    syncTokenMinisFromSnapshot(snap);
    syncCombatOverlayFromSnapshot(snap);
    return;
  }
  lastBattlefieldSyncKey = key;

  mapWidth = w;
  mapHeight = h;
  gridWorld = g;

  disposeBattlefieldChildren();

  const geo = new THREE.PlaneGeometry(w, h);
  let mat;
  if (img && img.complete && img.naturalWidth > 0) {
    const tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.98,
      metalness: 0,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: 0x1a1f2e,
      roughness: 0.95,
      metalness: 0,
    });
  }
  groundMesh = new THREE.Mesh(geo, mat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  battlefieldGroup.add(groundMesh);

  gridLines = buildGridOverlay(w, h, g);
  battlefieldGroup.add(gridLines);

  for (const m of selectable) applyMiniConstraints(m, { snapGrid: true });

  syncTokenMinisFromSnapshot(snap);

  const extent = Math.max(w, h);
  if (orbit && camera) {
    orbit.target.set(0, 0, 0);
    camera.position.set(0, extent * 0.55, extent * 0.65);
    orbit.update();
  }
  if (dirKeyLight) {
    const half = extent * 0.7;
    dirKeyLight.shadow.camera.left = -half;
    dirKeyLight.shadow.camera.right = half;
    dirKeyLight.shadow.camera.top = half;
    dirKeyLight.shadow.camera.bottom = -half;
    dirKeyLight.shadow.camera.updateProjectionMatrix();
  }
  if (transform && typeof transform.setTranslationSnap === "function") {
    transform.setTranslationSnap(g);
  }

  syncCombatOverlayFromSnapshot(snap);
}

function worldXZToPixel(wx, wz) {
  const hw = mapWidth / 2;
  const hh = mapHeight / 2;
  return { px: wx + hw, py: wz + hh };
}

function pixelToWorldXZ(px, py) {
  const hw = mapWidth / 2;
  const hh = mapHeight / 2;
  return { wx: px - hw, wz: py - hh };
}

function snapObjectToGrid(mesh) {
  if (!mesh || !mapWidth || !mapHeight || !gridWorld) return;
  const { px, py } = worldXZToPixel(mesh.position.x, mesh.position.z);
  const g = gridWorld;
  let cx = Math.floor(px / g) * g + g / 2;
  let cy = Math.floor(py / g) * g + g / 2;
  cx = clamp(cx, g / 2, mapWidth - g / 2);
  cy = clamp(cy, g / 2, mapHeight - g / 2);
  const w = pixelToWorldXZ(cx, cy);
  mesh.position.x = w.wx;
  mesh.position.z = w.wz;
}

function worldXZToGridCell(wx, wz) {
  const { px, py } = worldXZToPixel(wx, wz);
  const g = Math.max(4, gridWorld || 50);
  return { gx: Math.floor(px / g), gy: Math.floor(py / g) };
}

function ensureInit() {
  if (initialized) return;

  arenaEl = document.getElementById("arena3D");
  viewportEl = document.getElementById("arena3dViewport");
  dropHintEl = document.getElementById("arena3dDropHint");
  fileInputEl = document.getElementById("arena3dStlInput");

  if (!arenaEl || !viewportEl) {
    console.error("[arena3d] Missing arena3D elements");
    return;
  }

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.42;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  viewportEl.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06040c);

  arenaPmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment(renderer);
  scene.environment = arenaPmremGenerator.fromScene(roomEnv, 0.04).texture;
  roomEnv.dispose();

  if (!starfieldMesh) {
    starfieldMesh = createStarfieldSky();
    if (starfieldMesh) scene.add(starfieldMesh);
  }

  const w = Math.max(1, viewportEl.clientWidth);
  const h = Math.max(1, viewportEl.clientHeight);
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 20000);
  camera.position.set(0, 900, 1100);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.target.set(0, 0, 0);
  orbit.maxPolarAngle = Math.PI * 0.49;

  const ambient = new THREE.AmbientLight(0xffffff, 0.88);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2520, 0.68);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.28);
  dirKeyLight = key;
  key.position.set(400, 1200, 600);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.near = 100;
  key.shadow.camera.far = 8000;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xaabbff, 0.5);
  rim.position.set(-800, 600, -900);
  scene.add(rim);

  const fill = new THREE.DirectionalLight(0xfff2dd, 0.52);
  fill.castShadow = false;
  fill.position.set(-350, 550, 520);
  scene.add(fill);

  battlefieldGroup = new THREE.Group();
  scene.add(battlefieldGroup);

  combatOverlayRoot = new THREE.Group();
  combatOverlayRoot.userData.gorgoxPreserveInBattlefieldSync = true;
  battlefieldGroup.add(combatOverlayRoot);

  tokenMiniRoot = new THREE.Group();
  tokenMiniRoot.userData.gorgoxPreserveInBattlefieldSync = true;
  battlefieldGroup.add(tokenMiniRoot);

  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  transform = new TransformControls(camera, renderer.domElement);
  transform.showY = false;
  const origSetMode = transform.setMode.bind(transform);
  transform.setMode = function (mode) {
    origSetMode(mode);
    transform.showY = mode === "rotate";
    refreshArena3dGizmoToolbar();
  };
  transform.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
    if (e.value) return;
    const o = selectedObject;
    if (!o) return;
    const translating = transform.mode === "translate";
    applyMiniConstraints(o, { snapGrid: translating });
    if (translating && isTokenLinkedMini(o)) {
      const id = o.userData && o.userData.gorgoxTokenMiniId;
      const { gx, gy } = worldXZToGridCell(o.position.x, o.position.z);
      if (id != null && typeof window !== "undefined") {
        const fn = window.notifyArenaTokenMovedFrom3d;
        const ok =
          typeof fn !== "function" ? true : fn(String(id), gx, gy) !== false;
        if (!ok && typeof window.arena3dSyncNow === "function") window.arena3dSyncNow();
      }
    }
  });
  transform.addEventListener("objectChange", () => {
    const o = selectedObject;
    if (!o || !isUserTransformableMini(o)) return;
    applyMiniConstraints(o, { snapGrid: transform.mode === "translate" });
  });
  transform.setMode("translate");
  scene.add(transform);

  raycaster = new THREE.Raycaster();
  pointerNdc = new THREE.Vector2();

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKeyDown);

  if (fileInputEl) {
    fileInputEl.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) loadArenaModelFile(f);
      fileInputEl.value = "";
    });
  }

  arenaEl.addEventListener("dragenter", onDragEnter);
  arenaEl.addEventListener("dragover", onDragOver);
  arenaEl.addEventListener("dragleave", onDragLeave);
  arenaEl.addEventListener("drop", onDrop);

  initialized = true;
  syncBattlefieldFromGorgox(true);
  refreshArena3dGizmoToolbar();
  onResize();
}

function refreshArena3dGizmoToolbar() {
  const moveBtn = typeof document !== "undefined" ? document.getElementById("arena3dGizmoMove") : null;
  const rotBtn = typeof document !== "undefined" ? document.getElementById("arena3dGizmoRotate") : null;
  const hintEl = typeof document !== "undefined" ? document.getElementById("arena3dGizmoHint") : null;
  if (!moveBtn || !rotBtn || !transform) return;
  const tokenMini = !!(selectedObject && isTokenLinkedMini(selectedObject));
  const mode = typeof transform.mode === "string" ? transform.mode : "translate";

  moveBtn.disabled = !selectedObject;
  moveBtn.classList.toggle("arena3d-btn-active", mode === "translate" && !!selectedObject);
  rotBtn.classList.toggle("arena3d-btn-active", mode === "rotate");

  if (hintEl) {
    if (!selectedObject) {
      hintEl.textContent = "Nothing selected · Pick a mini. Move repositions token minis on the grid (same as the 2D map).";
    } else if (tokenMini) {
      hintEl.textContent =
        "Selected: map token · Move (W) — drag to snap on the grid · Rotate (E) — tilt and facing; map updates when you finish a move.";
    } else if (mode === "rotate") {
      hintEl.textContent = "Placed miniature · Rotate — tilt and facing.";
    } else if (mode === "scale") {
      hintEl.textContent = "Placed miniature · Scale — shrink or enlarge (keyboard R).";
    } else {
      hintEl.textContent = "Placed miniature · Move — drag on the battlefield grid.";
    }
  }
}

/** Switch transform gizmo: "translate" | "rotate" | "scale". */
export function setArenaGizmoMode(modeRaw) {
  ensureInit();
  if (!transform) return;
  const tokenMini = !!(selectedObject && isTokenLinkedMini(selectedObject));
  const m = typeof modeRaw === "string" ? modeRaw.trim().toLowerCase() : "translate";

  if (m === "rotate") {
    transform.setMode("rotate");
    return;
  }
  if (tokenMini && m === "scale") {
    transform.setMode("rotate");
    return;
  }
  if (m === "scale") {
    transform.setMode("scale");
    return;
  }
  transform.setMode("translate");
}

function onResize() {
  if (!renderer || !camera || !viewportEl) return;
  const w = Math.max(1, viewportEl.clientWidth);
  const h = Math.max(1, viewportEl.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function startRenderLoop() {
  if (animHandle) return;
  const tick = () => {
    animHandle = requestAnimationFrame(tick);
    orbit?.update();
    renderer?.render(scene, camera);
  };
  tick();
}

function stopRenderLoop() {
  if (animHandle) cancelAnimationFrame(animHandle);
  animHandle = 0;
}

function show3D() {
  ensureInit();
  if (!arenaEl) return;

  arenaEl.classList.remove("hidden");

  const mapCanvas = document.getElementById("mapCanvas");
  const mapControls = document.getElementById("mapControls");
  if (mapCanvas) mapCanvas.classList.add("hidden");
  if (mapControls) mapControls.classList.add("hidden");

  lastBattlefieldSyncKey = "";
  syncBattlefieldFromGorgox(true);

  if (syncIntervalId) clearInterval(syncIntervalId);
  syncIntervalId = setInterval(() => {
    if (!arenaEl || arenaEl.classList.contains("hidden")) return;
    syncBattlefieldFromGorgox(false);
  }, 750);

  onResize();
  refreshArena3dGizmoToolbar();
  startRenderLoop();
}

function hide3D() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  if (!arenaEl) arenaEl = document.getElementById("arena3D");
  if (arenaEl) arenaEl.classList.add("hidden");

  const mapCanvas = document.getElementById("mapCanvas");
  const mapControls = document.getElementById("mapControls");
  if (mapCanvas) mapCanvas.classList.remove("hidden");
  if (mapControls) mapControls.classList.remove("hidden");

  stopRenderLoop();
}

function toggle3DArena() {
  const el = document.getElementById("arena3D");
  const showing = el && !el.classList.contains("hidden");
  if (showing) hide3D();
  else show3D();
}

function setSelected(obj) {
  selectedObject = obj || null;
  if (!transform) return;
  if (selectedObject) {
    transform.attach(selectedObject);
  } else transform.detach();
  refreshArena3dGizmoToolbar();
}

function raycastTargets() {
  const list = [];
  if (groundMesh) list.push(groundMesh);
  for (const m of selectable) list.push(m);
  if (tokenMiniRoot) {
    for (const ch of tokenMiniRoot.children) {
      if (ch) list.push(ch);
    }
  }
  return list;
}

function onPointerDown(e) {
  if (!renderer || !camera || !raycaster) return;
  if (transform && transform.dragging) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  pointerNdc.set(x * 2 - 1, -(y * 2 - 1));
  raycaster.setFromCamera(pointerNdc, camera);

  const hits = raycaster.intersectObjects(raycastTargets(), true);
  if (hits.length) {
    const first = hits[0].object;
    const root = findTransformableRoot(first);
    if (root) {
      setSelected(root);
      return;
    }
    if (first === groundMesh || first.parent === groundMesh) {
      const pt = hits[0].point;
      if (selectedObject && !isTokenLinkedMini(selectedObject)) {
        selectedObject.position.x = pt.x;
        selectedObject.position.z = pt.z;
        applyMiniConstraints(selectedObject, { snapGrid: true });
      }
      setSelected(null);
      return;
    }
  }

  setSelected(null);
}

function findTransformableRoot(obj) {
  let cur = obj;
  while (cur) {
    if (selectable.includes(cur)) return cur;
    if (cur.userData && cur.userData.gorgoxTokenMiniId) return cur;
    cur = cur.parent;
  }
  return null;
}

function onKeyDown(e) {
  if (!arenaEl) arenaEl = document.getElementById("arena3D");
  if (!arenaEl || arenaEl.classList.contains("hidden")) return;

  const tokenSel = selectedObject && isTokenLinkedMini(selectedObject);
  if (e.key === "w" || e.key === "W") transform?.setMode("translate");
  if (e.key === "e" || e.key === "E") transform?.setMode("rotate");
  if (e.key === "r" || e.key === "R") {
    if (!tokenSel) transform?.setMode("scale");
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedObject) {
      if (isTokenLinkedMini(selectedObject)) {
        setSelected(null);
        return;
      }
      removeObject(selectedObject);
      setSelected(null);
    }
  }
}

function removeObject(obj) {
  if (!obj) return;
  obj.parent?.remove(obj);
  selectable = selectable.filter((o) => o !== obj);
  tryDispose(obj);
}

function tryDispose(obj) {
  obj.traverse?.((n) => {
    if (n.geometry && typeof n.geometry.dispose === "function") n.geometry.dispose();
    if (n.material) {
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (m.map && typeof m.map.dispose === "function") m.map.dispose();
        if (typeof m.dispose === "function") m.dispose();
      }
    }
  });
}

function bumpTokenMiniLoadGen(tokenId) {
  const n = (tokenMiniLoadGen.get(tokenId) || 0) + 1;
  tokenMiniLoadGen.set(tokenId, n);
  return n;
}

/** Remove every scene child tagged for this token (handles orphan meshes from superseded loads). */
function removeTokenMiniMeshesForId(tokenId) {
  if (!tokenMiniRoot) return;
  for (const ch of [...tokenMiniRoot.children]) {
    if (ch.userData && ch.userData.gorgoxTokenMiniId === tokenId) {
      tokenMiniRoot.remove(ch);
      tryDispose(ch);
    }
  }
}

function arena3dClearAll() {
  if (!scene) return;
  setSelected(null);
  for (const obj of [...selectable]) removeObject(obj);
  selectable = [];
  clearTokenMiniMeshes();
  disposeCombatOverlayChildren();
}

function clearTokenMiniMeshes() {
  if (tokenMiniRoot) {
    for (const ch of [...tokenMiniRoot.children]) {
      tokenMiniRoot.remove(ch);
      tryDispose(ch);
    }
  }
  tokenMiniById.clear();
  tokenMiniLoadGen.clear();
}

/**
 * @param {{ id: string, x: number, y: number, size?: number, stlUrl: string }[]} tokens
 */
function syncTokenMinisFromSnapshot(snap) {
  if (!tokenMiniRoot || !snap) return;
  const tokens = Array.isArray(snap.tokens) ? snap.tokens : [];
  const g = Math.max(4, Number(snap.gridPixels) || gridWorld || 50);
  const seen = new Set();

  for (const t of tokens) {
    if (!t || !t.id || !t.stlUrl) continue;
    const id = String(t.id);
    seen.add(id);
    const sz = Number(t.size);
    const tokenSize = !isNaN(sz) && sz > 0 ? sz : 1;
    const px = Number(t.x) * g + g / 2;
    const py = Number(t.y) * g + g / 2;
    const { wx, wz } = pixelToWorldXZ(px, py);
    const cell = Math.max(8, g * tokenSize);
    const rec = tokenMiniById.get(id);
    if (rec && rec.url === t.stlUrl && rec.mesh) {
      const skipPos =
        transform &&
        transform.dragging &&
        transform.mode === "translate" &&
        selectedObject === rec.mesh;
      if (!skipPos) {
        rec.mesh.position.x = wx;
        rec.mesh.position.z = wz;
      }
      rescaleTokenMiniMesh(rec.mesh, cell);
      plantMiniOnFloor(rec.mesh);
      continue;
    }
    if (rec && rec.mesh) {
      tokenMiniRoot.remove(rec.mesh);
      tryDispose(rec.mesh);
      tokenMiniById.delete(id);
    }
    loadTokenMiniStl(id, String(t.stlUrl), wx, wz, cell);
  }

  for (const [id, rec] of [...tokenMiniById.entries()]) {
    if (seen.has(id)) continue;
    bumpTokenMiniLoadGen(id);
    removeTokenMiniMeshesForId(id);
    if (rec && rec.mesh && rec.mesh.parent === tokenMiniRoot) {
      tokenMiniRoot.remove(rec.mesh);
      tryDispose(rec.mesh);
    } else if (rec && rec.mesh) {
      tryDispose(rec.mesh);
    }
    tokenMiniById.delete(id);
  }
}

function rescaleTokenMiniMesh(mesh, cellWorld) {
  applyMiniScaleForCell(mesh, cellWorld, 80);
}

function loadTokenMiniStl(tokenId, url, wx, wz, cellWorld) {
  const prev = tokenMiniById.get(tokenId);
  if (prev && prev.loading && prev.url === url) {
    prev.pendingWorld = { wx, wz, cell: cellWorld };
    return;
  }

  const gen = bumpTokenMiniLoadGen(tokenId);
  removeTokenMiniMeshesForId(tokenId);
  const absUrl = /^https?:\/\//i.test(url) ? url : new URL(url, window.location.href).href;
  tokenMiniById.set(tokenId, { url, mesh: null, loading: true, loadGen: gen });
  fetch(absUrl)
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const vname = virtualNameForModelBuffer(url, buf);
      return parseArenaModelBuffer(vname, buf, { stlColor: 0xc9b896 });
    })
    .then((root) => {
      if (tokenMiniLoadGen.get(tokenId) !== gen) {
        tryDispose(root);
        return;
      }
      let useWx = wx;
      let useWz = wz;
      let useCell = cellWorld;
      const entry = tokenMiniById.get(tokenId);
      if (entry && entry.pendingWorld) {
        useWx = entry.pendingWorld.wx;
        useWz = entry.pendingWorld.wz;
        useCell = entry.pendingWorld.cell;
      }
      root.userData.gorgoxTokenMiniId = tokenId;
      captureMiniFootprintReference(root);
      root.position.set(useWx, 0, useWz);
      applyMiniScaleForCell(root, useCell, 80);
      tokenMiniRoot.add(root);
      tokenMiniById.set(tokenId, { url, mesh: root, loading: false, loadGen: gen });
    })
    .catch((err) => {
      console.warn("[arena3d] Token model load failed:", tokenId, err && err.message ? err.message : err);
      if (tokenMiniLoadGen.get(tokenId) !== gen) return;
      const cur = tokenMiniById.get(tokenId);
      if (cur && cur.loading) tokenMiniById.delete(tokenId);
    });
}

async function loadArenaModelFile(file) {
  ensureInit();
  if (!battlefieldGroup) return;
  if (!file || !file.name) return;
  if (!isAllowedArenaModelFilename(file.name)) return;

  const buf = await file.arrayBuffer();
  const root = await parseArenaModelBuffer(file.name, buf);
  root.name = file.name;
  captureMiniFootprintReference(root);
  const cell = Math.max(8, gridWorld || 50);
  root.position.set(0, 0, 0);
  applyMiniScaleForCell(root, cell, 50);

  battlefieldGroup.add(root);
  selectable.push(root);

  applyMiniConstraints(root, { snapGrid: true });

  setSelected(root);
  if (transform) transform.setMode("translate");
}

function showDropHint(show) {
  if (!dropHintEl) dropHintEl = document.getElementById("arena3dDropHint");
  if (!dropHintEl) return;
  dropHintEl.classList.toggle("hidden", !show);
}

function onDragEnter(e) {
  e.preventDefault();
  e.stopPropagation();
  showDropHint(true);
}
function onDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  showDropHint(true);
}
function onDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  showDropHint(false);
}
function onDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  showDropHint(false);

  const files = Array.from(e.dataTransfer?.files || []);
  for (const f of files) {
    const name = (f.name || "").toLowerCase();
    if (isAllowedArenaModelFilename(name)) loadArenaModelFile(f);
  }
}

const _worldAxisX = new THREE.Vector3(1, 0, 0);
const _worldAxisZ = new THREE.Vector3(0, 0, 1);

/** Toolbar / host: tilt the selected mini around world X or Z (e.g. stand an STL upright). */
function nudgeSelectionWorldRotation(axis, degrees) {
  ensureInit();
  const o = selectedObject;
  if (!o || !isUserTransformableMini(o)) return;
  const ax = axis === "z" ? _worldAxisZ : _worldAxisX;
  const rad = ((Number(degrees) || 0) * Math.PI) / 180;
  if (rad === 0) return;
  o.rotateOnWorldAxis(ax, rad);
  applyMiniConstraints(o, { snapGrid: false });
}

// Allow app.js to force an immediate token mini refresh after attaching a model.
try {
  window.arena3dSyncNow = function () {
    ensureInit();
    syncBattlefieldFromGorgox(true);
  };
  window.arena3dRefreshBattlefieldIfOpen = function () {
    ensureInit();
    if (!arenaEl || arenaEl.classList.contains("hidden")) return;
    syncBattlefieldFromGorgox(false);
  };
} catch (_) {}

export { toggle3DArena, arena3dClearAll, nudgeSelectionWorldRotation };
