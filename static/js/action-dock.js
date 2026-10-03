/**
 * Action Dock — draggable, resizable, collapsible bottom character console.
 * Keeps #playerActionBar inside viewport; docked between sidebars by default.
 */
(function (global) {
    'use strict';

    var HEIGHT_MIN = 80;
    var HEIGHT_MAX = 520;
    var HEIGHT_DEFAULT = 180;
    var COLLAPSED_HEIGHT = 52;
    var VIEWPORT_MARGIN = 8;
    var DRAWER_BREAKPOINT = 900;

    var state = {
        mode: 'docked',
        collapsed: false,
        floatX: null,
        floatY: null,
        height: HEIGHT_DEFAULT
    };

    var barEl = null;
    var resizeObserver = null;
    var layoutListenersBound = false;
    var layoutRaf = 0;

    function scheduleLayout() {
        if (layoutRaf) return;
        layoutRaf = global.requestAnimationFrame(function () {
            layoutRaf = 0;
            applyLayout();
        });
    }

    function lsGet(key, fallback) {
        try {
            var v = localStorage.getItem(key);
            return v !== null ? v : fallback;
        } catch (e) { return fallback; }
    }

    function lsSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) {}
    }

    function loadState() {
        var mode = lsGet('actionDockMode', 'docked');
        state.mode = mode === 'floating' ? 'floating' : 'docked';
        state.collapsed = lsGet('actionDockCollapsed', '0') === '1';
        var h = parseInt(lsGet('playerActionBarHeight', String(HEIGHT_DEFAULT)), 10);
        if (!isNaN(h) && h >= HEIGHT_MIN && h <= HEIGHT_MAX) state.height = h;
        var fx = parseFloat(lsGet('actionDockFloatX', ''));
        var fy = parseFloat(lsGet('actionDockFloatY', ''));
        state.floatX = !isNaN(fx) ? fx : null;
        state.floatY = !isNaN(fy) ? fy : null;
    }

    function saveState() {
        lsSet('actionDockMode', state.mode);
        lsSet('actionDockCollapsed', state.collapsed ? '1' : '0');
        lsSet('playerActionBarHeight', String(state.height));
        if (state.floatX !== null) lsSet('actionDockFloatX', String(state.floatX));
        if (state.floatY !== null) lsSet('actionDockFloatY', String(state.floatY));
    }

    function isDrawerMode() {
        return global.innerWidth <= DRAWER_BREAKPOINT;
    }

    function getEffectiveMode() {
        return isDrawerMode() ? 'drawer' : state.mode;
    }

    function getSidebarRects() {
        var left = document.getElementById('sidebarLeft');
        var right = document.getElementById('sidebarRight');
        var lRect = left ? left.getBoundingClientRect() : { right: 0 };
        var rRect = right ? right.getBoundingClientRect() : { left: global.innerWidth };
        return { left: lRect.right, right: rRect.left };
    }

    function getDockedRect() {
        var sides = getSidebarRects();
        var left = Math.max(VIEWPORT_MARGIN, sides.left);
        var right = Math.min(global.innerWidth - VIEWPORT_MARGIN, sides.right);
        var width = Math.max(200, right - left);
        return { left: left, width: width, bottom: 0 };
    }

    function clampFloatPosition(left, top, width, height) {
        var maxLeft = global.innerWidth - width - VIEWPORT_MARGIN;
        var maxTop = global.innerHeight - height - VIEWPORT_MARGIN;
        return {
            left: Math.max(VIEWPORT_MARGIN, Math.min(maxLeft, left)),
            top: Math.max(VIEWPORT_MARGIN, Math.min(maxTop, top))
        };
    }

    function getEffectiveHeight() {
        if (state.collapsed) return COLLAPSED_HEIGHT;
        return state.height;
    }

    function syncGlobalHeight() {
        var h = getEffectiveHeight();
        if (typeof global.playerActionBarHeight !== 'undefined') {
            global.playerActionBarHeight = state.height;
        }
        document.body.style.setProperty('--player-action-bar-height', h + 'px');
        document.body.style.setProperty('--action-dock-height', h + 'px');
        return h;
    }

    function applyLayout() {
        if (!barEl || barEl.classList.contains('hidden')) return;
        var mode = getEffectiveMode();
        if (mode !== 'floating') {
            state.mode = 'docked';
        }
        var h = syncGlobalHeight();

        barEl.classList.toggle('action-dock--collapsed', state.collapsed);
        barEl.classList.toggle('action-dock--floating', mode === 'floating');
        barEl.classList.toggle('action-dock--drawer', mode === 'drawer');
        barEl.classList.toggle('action-dock--docked', mode === 'docked' || mode === 'drawer');
        barEl.style.height = h + 'px';

        if (mode === 'floating') {
            var w = Math.min(720, global.innerWidth - VIEWPORT_MARGIN * 2);
            var left = state.floatX !== null ? state.floatX : (global.innerWidth - w) / 2;
            var top = state.floatY !== null ? state.floatY : global.innerHeight - h - 24;
            var clamped = clampFloatPosition(left, top, w, h);
            state.floatX = clamped.left;
            state.floatY = clamped.top;
            barEl.style.left = clamped.left + 'px';
            barEl.style.top = clamped.top + 'px';
            barEl.style.width = w + 'px';
            barEl.style.right = 'auto';
            barEl.style.bottom = 'auto';
        } else if (mode === 'drawer') {
            barEl.style.left = '0';
            barEl.style.right = '0';
            barEl.style.width = '100%';
            barEl.style.bottom = '0';
            barEl.style.top = 'auto';
        } else {
            var dock = getDockedRect();
            barEl.style.left = dock.left + 'px';
            barEl.style.width = dock.width + 'px';
            barEl.style.right = 'auto';
            barEl.style.bottom = '0';
            barEl.style.top = 'auto';
        }
    }

    function setupResize() {
        var edge = document.getElementById('actionDockResizeEdge');
        if (!edge || !barEl) return;
        edge.onpointerdown = function (e) {
            if (state.collapsed) return;
            if (e.target.closest('.action-dock__chrome-actions')) return;
            if (e.target.closest('.action-dock__drag-handle')) return;
            e.preventDefault();
            e.stopPropagation();
            edge.setPointerCapture(e.pointerId);
            var startY = e.clientY;
            var startH = state.height;
            function onMove(ev) {
                var dy = startY - ev.clientY;
                var nh = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(startH + dy)));
                state.height = nh;
                if (typeof global.playerActionBarHeight !== 'undefined') {
                    global.playerActionBarHeight = nh;
                }
                scheduleLayout();
            }
            function onUp() {
                edge.releasePointerCapture(e.pointerId);
                edge.removeEventListener('pointermove', onMove);
                edge.removeEventListener('pointerup', onUp);
                edge.removeEventListener('pointercancel', onUp);
                saveState();
            }
            edge.addEventListener('pointermove', onMove);
            edge.addEventListener('pointerup', onUp);
            edge.addEventListener('pointercancel', onUp);
        };
    }

    function setupDrag() {
        var handle = document.getElementById('actionDockDragHandle');
        if (!handle || !barEl) return;
        handle.onpointerdown = function (e) {
            if (isDrawerMode()) return;
            if (e.target.closest('button')) return;
            if (state.mode !== 'floating') return;
            e.preventDefault();
            e.stopPropagation();
            handle.setPointerCapture(e.pointerId);
            var startX = e.clientX;
            var startY = e.clientY;
            var origX = state.floatX;
            var origY = state.floatY;
            function onMove(ev) {
                state.floatX = origX + (ev.clientX - startX);
                state.floatY = origY + (ev.clientY - startY);
                scheduleLayout();
            }
            function onUp() {
                handle.releasePointerCapture(e.pointerId);
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                saveState();
            }
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        };
    }

    function setupChromeButtons() {
        var collapseBtn = document.getElementById('actionDockCollapseBtn');
        var undockBtn = document.getElementById('actionDockUndockBtn');
        var resetBtn = document.getElementById('actionDockResetBtn');
        if (collapseBtn) {
            collapseBtn.onclick = function () {
                state.collapsed = !state.collapsed;
                collapseBtn.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
                collapseBtn.textContent = state.collapsed ? '▲' : '▼';
                applyLayout();
                saveState();
            };
        }
        if (undockBtn) {
            undockBtn.onclick = function () {
                if (isDrawerMode()) return;
                state.mode = state.mode === 'floating' ? 'docked' : 'floating';
                if (state.mode === 'floating' && state.floatX === null) {
                    var rect = barEl.getBoundingClientRect();
                    state.floatX = rect.left;
                    state.floatY = rect.top;
                }
                applyLayout();
                saveState();
            };
        }
        if (resetBtn) {
            resetBtn.onclick = function () {
                state.mode = 'docked';
                state.collapsed = false;
                state.height = HEIGHT_DEFAULT;
                state.floatX = null;
                state.floatY = null;
                if (collapseBtn) {
                    collapseBtn.setAttribute('aria-expanded', 'true');
                    collapseBtn.textContent = '▼';
                }
                applyLayout();
                saveState();
            };
        }
    }

    function observeLayout() {
        var main = document.getElementById('mainInterface');
        if (!main || typeof ResizeObserver === 'undefined') return;
        if (resizeObserver) resizeObserver.disconnect();
        resizeObserver = new ResizeObserver(function () { scheduleLayout(); });
        resizeObserver.observe(main);
    }

    function resetToDocked() {
        state.mode = 'docked';
        state.floatX = null;
        state.floatY = null;
        lsSet('actionDockMode', 'docked');
        lsSet('actionDockFloatX', '');
        lsSet('actionDockFloatY', '');
    }

    function init(bar) {
        barEl = bar || document.getElementById('playerActionBar');
        if (!barEl) return;
        loadState();
        state.mode = 'docked';
        state.floatX = null;
        state.floatY = null;
        barEl.classList.add('action-dock');
        setupResize();
        setupDrag();
        setupChromeButtons();
        setupTabKeyboard();
        setupEscapeDrawer();
        if (!layoutListenersBound) {
            observeLayout();
            global.addEventListener('resize', scheduleLayout);
            layoutListenersBound = true;
        }
        applyLayout();
    }

    function setupTabKeyboard() {
        if (!barEl) return;
        var tabBar = barEl.querySelector('.player-bar-tabs');
        if (!tabBar) return;
        var tabs = Array.prototype.slice.call(tabBar.querySelectorAll('.player-bar-tab-btn'));
        if (!tabs.length) return;
        function focusTab(idx) {
            tabs.forEach(function (t, i) {
                t.setAttribute('tabindex', i === idx ? '0' : '-1');
            });
            tabs[idx].focus();
        }
        var activeIdx = tabs.findIndex(function (t) { return t.classList.contains('active'); });
        focusTab(activeIdx >= 0 ? activeIdx : 0);
        if (tabBar.dataset.keyboardBound === '1') return;
        tabBar.dataset.keyboardBound = '1';
        tabBar.addEventListener('keydown', function (e) {
            var current = tabs.findIndex(function (t) { return t === document.activeElement; });
            if (current < 0) return;
            var next = current;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                next = (current + 1) % tabs.length;
                e.preventDefault();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                next = (current - 1 + tabs.length) % tabs.length;
                e.preventDefault();
            } else if (e.key === 'Home') {
                next = 0;
                e.preventDefault();
            } else if (e.key === 'End') {
                next = tabs.length - 1;
                e.preventDefault();
            } else {
                return;
            }
            focusTab(next);
            if (typeof global.switchPlayerActionBarTab === 'function') {
                global.switchPlayerActionBarTab(tabs[next].dataset.tab);
            } else {
                tabs[next].click();
            }
        });
    }

    function setupEscapeDrawer() {
        if (global.document && global.document.body && global.document.body.dataset.actionDockEscapeBound === '1') return;
        if (global.document && global.document.body) global.document.body.dataset.actionDockEscapeBound = '1';
        global.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !barEl || barEl.classList.contains('hidden')) return;
            if (!isDrawerMode() || state.collapsed) return;
            state.collapsed = true;
            var collapseBtn = document.getElementById('actionDockCollapseBtn');
            if (collapseBtn) {
                collapseBtn.setAttribute('aria-expanded', 'false');
                collapseBtn.textContent = '▲';
            }
            applyLayout();
            saveState();
        });
    }

    function onVisibilityChange(visible) {
        if (!barEl) barEl = document.getElementById('playerActionBar');
        if (!barEl) return;
        barEl.classList.toggle('action-dock--visible', !!visible);
        if (visible) {
            scheduleLayout();
        }
    }

    function syncHeight(h, persist) {
        var nh = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, h));
        state.height = nh;
        if (typeof global.playerActionBarHeight !== 'undefined') {
            global.playerActionBarHeight = nh;
        }
        scheduleLayout();
        if (persist) saveState();
    }

    function setHeight(h) {
        syncHeight(h, true);
    }

    global.ActionDock = {
        init: init,
        applyLayout: applyLayout,
        scheduleLayout: scheduleLayout,
        onVisibilityChange: onVisibilityChange,
        getEffectiveHeight: getEffectiveHeight,
        syncHeight: syncHeight,
        setHeight: setHeight,
        resetToDocked: resetToDocked,
        getState: function () { return state; },
        HEIGHT_MIN: HEIGHT_MIN,
        HEIGHT_MAX: HEIGHT_MAX,
        HEIGHT_DEFAULT: HEIGHT_DEFAULT
    };

    global.addEventListener('DOMContentLoaded', function () {
        var bar = document.getElementById('playerActionBar');
        if (bar) init(bar);
    });
})(window);
