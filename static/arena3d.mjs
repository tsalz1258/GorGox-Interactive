import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/TransformControls.js";
import { STLLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/STLLoader.js";

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

let groundPlane = null;
let selectable = [];
let selectedObject = null;
let animHandle = 0;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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
  camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 5000);
  camera.position.set(0, 140, 220);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.target.set(0, 0, 0);
  orbit.maxPolarAngle = Math.PI * 0.49;

  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(160, 240, 140);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 800;
  key.shadow.camera.left = -260;
  key.shadow.camera.right = 260;
  key.shadow.camera.top = 260;
  key.shadow.camera.bottom = -260;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x88aaff, 0.35);
  rim.position.set(-200, 120, -220);
  scene.add(rim);

  const grid = new THREE.GridHelper(600, 120, 0x2a88ff, 0x2b2f3a);
  grid.position.y = 0;
  scene.add(grid);

  const groundGeo = new THREE.PlaneGeometry(600, 600);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x151821,
    roughness: 0.95,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  transform = new TransformControls(camera, renderer.domElement);
  transform.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
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
      for (const f of files) loadStlFile(f);
      fileInputEl.value = "";
    });
  }

  arenaEl.addEventListener("dragenter", onDragEnter);
  arenaEl.addEventListener("dragover", onDragOver);
  arenaEl.addEventListener("dragleave", onDragLeave);
  arenaEl.addEventListener("drop", onDrop);

  initialized = true;
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

  onResize();
  startRenderLoop();
}

function hide3D() {
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
  if (selectedObject) transform.attach(selectedObject);
  else transform.detach();
}

function onPointerDown(e) {
  if (!renderer || !camera || !raycaster) return;
  if (transform && transform.dragging) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  pointerNdc.set(x * 2 - 1, -(y * 2 - 1));
  raycaster.setFromCamera(pointerNdc, camera);

  const hits = raycaster.intersectObjects(selectable, true);
  if (hits.length) {
    const root = findSelectableRoot(hits[0].object);
    setSelected(root);
    return;
  }

  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, point);
  if (selectedObject && point) {
    selectedObject.position.set(point.x, selectedObject.position.y, point.z);
    return;
  }

  setSelected(null);
}

function findSelectableRoot(obj) {
  if (!obj) return null;
  let cur = obj;
  while (cur && cur.parent && cur.parent !== scene) {
    if (selectable.includes(cur)) return cur;
    cur = cur.parent;
  }
  if (selectable.includes(cur)) return cur;
  return obj;
}

function onKeyDown(e) {
  if (!arenaEl) arenaEl = document.getElementById("arena3D");
  if (!arenaEl || arenaEl.classList.contains("hidden")) return;

  if (e.key === "w" || e.key === "W") transform?.setMode("translate");
  if (e.key === "e" || e.key === "E") transform?.setMode("rotate");
  if (e.key === "r" || e.key === "R") transform?.setMode("scale");

  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedObject) {
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

function arena3dClearAll() {
  if (!scene) return;
  setSelected(null);
  for (const obj of [...selectable]) removeObject(obj);
  selectable = [];
}

async function loadStlFile(file) {
  ensureInit();
  if (!scene) return;
  if (!file || !file.name) return;

  const buf = await file.arrayBuffer();
  const loader = new STLLoader();
  const geom = loader.parse(buf);

  geom.computeVertexNormals();
  geom.computeBoundingBox();

  const center = new THREE.Vector3();
  geom.boundingBox.getCenter(center);
  geom.translate(-center.x, -center.y, -center.z);

  const material = new THREE.MeshStandardMaterial({
    color: 0xd8d2c2,
    roughness: 0.7,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = file.name;

  const size = new THREE.Vector3();
  geom.boundingBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const target = 35;
  const s = clamp(target / maxDim, 0.1, 30);
  mesh.scale.setScalar(s);

  const scaledHeight = size.y * s;
  mesh.position.y = scaledHeight * 0.5;

  scene.add(mesh);
  selectable.push(mesh);
  setSelected(mesh);
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
    if (name.endsWith(".stl")) loadStlFile(f);
  }
}

// Expose minimal API used by index.html buttons
window.toggle3DArena = toggle3DArena;
window.arena3dClearAll = arena3dClearAll;

