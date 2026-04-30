import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/TransformControls.js";
import { STLLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

let initialized = false;
let arenaEl = null;
let viewportEl = null;
let dropHintEl = null;
let fileInputEl = null;

let renderer = null;
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
/** @type {Map<string, { mesh: THREE.Object3D | null, url: string, loading?: boolean, pendingWorld?: { wx: number, wz: number, cell: number } }>} */
let tokenMiniById = new Map();
/** Monotonic per-token generation so stale fetches never add a second mesh. */
let tokenMiniLoadGen = new Map();
let groundMesh = null;
let gridLines = null;
let groundPlane = null;

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
  const doSnap = snapGrid && !isTokenLinkedMini(mesh);
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
  return { hasMap: false, image: null, imagePath: null, width: 1200, height: 800, gridPixels: 50, tokens: [] };
}

function disposeBattlefieldChildren() {
  if (!battlefieldGroup) return;
  const toRemove = [];
  for (const ch of battlefieldGroup.children) {
    if (selectable.includes(ch)) continue;
    if (ch === tokenMiniRoot || ch.userData?.gorgoxPreserveInBattlefieldSync) continue;
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  viewportEl.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0c10);

  const w = Math.max(1, viewportEl.clientWidth);
  const h = Math.max(1, viewportEl.clientHeight);
  camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 20000);
  camera.position.set(0, 900, 1100);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.target.set(0, 0, 0);
  orbit.maxPolarAngle = Math.PI * 0.49;

  const ambient = new THREE.AmbientLight(0xffffff, 0.42);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  dirKeyLight = key;
  key.position.set(400, 1200, 600);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.near = 100;
  key.shadow.camera.far = 8000;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xaabbff, 0.28);
  rim.position.set(-800, 600, -900);
  scene.add(rim);

  battlefieldGroup = new THREE.Group();
  scene.add(battlefieldGroup);

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
  };
  transform.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
    if (!e.value && selectedObject) applyMiniConstraints(selectedObject, { snapGrid: true });
  });
  transform.addEventListener("objectChange", () => {
    const o = selectedObject;
    if (!o || !isUserTransformableMini(o)) return;
    if (isTokenLinkedMini(o) && transform.mode !== "rotate") transform.setMode("rotate");
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
  onResize();
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
    if (isTokenLinkedMini(selectedObject)) transform.setMode("rotate");
    transform.attach(selectedObject);
  } else transform.detach();
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
  if (e.key === "w" || e.key === "W") {
    if (!tokenSel) transform?.setMode("translate");
  }
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
      rec.mesh.position.x = wx;
      rec.mesh.position.z = wz;
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
} catch (_) {}

export { toggle3DArena, arena3dClearAll, nudgeSelectionWorldRotation };
