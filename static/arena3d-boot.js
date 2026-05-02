/**
 * Defines window.toggle3DArena / window.arena3dClearAll synchronously so inline onclick
 * never hits ReferenceError. The real Three.js code loads on first use via dynamic import().
 */
(function () {
  var MODULE_URL = "/static/arena3d.module.js?v=28";
  var loadPromise = null;
  var api = null;

  /**
   * Classic-script bridge: ES module scope can miss host globals in some environments.
   * Always read snapshot fn from the same window object app.js uses, at call time.
   */
  window.__arena3dPullBattlefieldSnapshot = function () {
    var fn = null;
    try {
      fn = window.getBattlefieldSnapshotForArena3d;
    } catch (e) {}
    if (typeof fn !== "function" && typeof globalThis !== "undefined") {
      try {
        fn = globalThis.getBattlefieldSnapshotForArena3d;
      } catch (e2) {}
    }
    if (typeof fn === "function") {
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
  };

  function loadModule() {
    if (api) return Promise.resolve(api);
    if (loadPromise) return loadPromise;
    loadPromise = import(MODULE_URL)
      .then(function (m) {
        if (!m || typeof m.toggle3DArena !== "function") {
          throw new Error("arena3d.module.js did not export toggle3DArena");
        }
        if (typeof m.arena3dClearAll !== "function") {
          throw new Error("arena3d.module.js did not export arena3dClearAll");
        }
        if (typeof m.nudgeSelectionWorldRotation !== "function") {
          throw new Error("arena3d.module.js did not export nudgeSelectionWorldRotation");
        }
        if (typeof m.setArenaGizmoMode !== "function") {
          throw new Error("arena3d.module.js did not export setArenaGizmoMode");
        }
        api = m;
        return api;
      })
      .catch(function (err) {
        loadPromise = null;
        throw err;
      });
    return loadPromise;
  }

  window.toggle3DArena = function () {
    loadModule()
      .then(function (m) {
        m.toggle3DArena();
      })
      .catch(function (err) {
        console.error("[arena3d] Failed to load 3D arena module:", err);
        alert(
          "3D Arena could not load (check internet for Three.js CDN, or see console).\n" +
            (err && err.message ? err.message : String(err))
        );
      });
  };

  window.arena3dClearAll = function () {
    loadModule()
      .then(function (m) {
        m.arena3dClearAll();
      })
      .catch(function () {
        /* ignore if never loaded */
      });
  };

  /** axis: "x" | "z", degrees: number (e.g. ±90) — click a mini first */
  window.arena3dRotateSelection = function (axis, degrees) {
    loadModule()
      .then(function (m) {
        m.nudgeSelectionWorldRotation(axis, degrees);
      })
      .catch(function () {});
  };

  /** "translate" | "rotate" | "scale" — updates gizmo so players see what the tool does */
  window.arena3dSetGizmoMode = function (mode) {
    loadModule()
      .then(function (m) {
        m.setArenaGizmoMode(mode);
      })
      .catch(function () {});
  };

  console.log("[arena3d] boot loaded — toggle3DArena:", typeof window.toggle3DArena);
})();
