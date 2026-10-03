/**
 * UI Shell helpers — player cards, connection status, resizable sidebars.
 */
(function (global) {
    'use strict';

    var SIDEBAR_WIDTH_DEFAULT = 280;
    var SIDEBAR_WIDTH_MIN = 200;
    var SIDEBAR_WIDTH_MAX = 520;
    var SIDEBAR_MOBILE_BREAKPOINT = 900;

    var sidebarState = {
        left: SIDEBAR_WIDTH_DEFAULT,
        right: SIDEBAR_WIDTH_DEFAULT
    };

    function lsGet(key, fallback) {
        try {
            var v = localStorage.getItem(key);
            return v !== null ? v : fallback;
        } catch (e) { return fallback; }
    }

    function lsSet(key, val) {
        try { localStorage.setItem(key, val); } catch (e) {}
    }

    function clampSidebarWidth(w) {
        var max = Math.min(SIDEBAR_WIDTH_MAX, Math.floor(global.innerWidth * 0.45));
        return Math.max(SIDEBAR_WIDTH_MIN, Math.min(max, Math.round(w)));
    }

    function isMobileLayout() {
        return global.innerWidth <= SIDEBAR_MOBILE_BREAKPOINT;
    }

    function isSidebarCollapsed(side) {
        var mi = document.getElementById('mainInterface');
        if (!mi) return false;
        return side === 'left'
            ? mi.classList.contains('sidebar-left-collapsed')
            : mi.classList.contains('sidebar-right-collapsed');
    }

    function applySidebarWidths() {
        var root = document.documentElement;
        root.style.setProperty('--sidebar-left-width', sidebarState.left + 'px');
        root.style.setProperty('--sidebar-right-width', sidebarState.right + 'px');
        if (typeof global.ActionDock !== 'undefined') {
            global.ActionDock.scheduleLayout();
        }
    }

    function loadSidebarWidths() {
        var left = parseInt(lsGet('vttSidebarLeftWidth', String(SIDEBAR_WIDTH_DEFAULT)), 10);
        var right = parseInt(lsGet('vttSidebarRightWidth', String(SIDEBAR_WIDTH_DEFAULT)), 10);
        if (!isNaN(left)) sidebarState.left = clampSidebarWidth(left);
        if (!isNaN(right)) sidebarState.right = clampSidebarWidth(right);
        applySidebarWidths();
    }

    function saveSidebarWidths() {
        lsSet('vttSidebarLeftWidth', String(sidebarState.left));
        lsSet('vttSidebarRightWidth', String(sidebarState.right));
    }

    function updateSidebarResizeHandles() {
        var leftHandle = document.getElementById('sidebarResizeLeft');
        var rightHandle = document.getElementById('sidebarResizeRight');
        var mobile = isMobileLayout();
        if (leftHandle) {
            leftHandle.classList.toggle('hidden', mobile || isSidebarCollapsed('left'));
        }
        if (rightHandle) {
            rightHandle.classList.toggle('hidden', mobile || isSidebarCollapsed('right'));
        }
    }

    function setupSidebarResizeHandle(handle, side) {
        if (!handle || handle.dataset.resizeBound === '1') return;
        handle.dataset.resizeBound = '1';

        function onPointerDown(e) {
            if (isMobileLayout() || isSidebarCollapsed(side)) return;
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            document.body.classList.add('sidebar-resizing');
            var startX = e.clientX;
            var startW = side === 'left' ? sidebarState.left : sidebarState.right;
            function onMove(ev) {
                var dx = ev.clientX - startX;
                if (side === 'left') {
                    sidebarState.left = clampSidebarWidth(startW + dx);
                } else {
                    sidebarState.right = clampSidebarWidth(startW - dx);
                }
                applySidebarWidths();
            }
            function onUp() {
                document.body.classList.remove('sidebar-resizing');
                handle.releasePointerCapture(e.pointerId);
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                saveSidebarWidths();
            }
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        }

        handle.addEventListener('pointerdown', onPointerDown);

        handle.addEventListener('keydown', function (e) {
            if (isMobileLayout() || isSidebarCollapsed(side)) return;
            var step = e.shiftKey ? 40 : 12;
            var changed = false;
            if (e.key === 'ArrowLeft' && side === 'left') {
                sidebarState.left = clampSidebarWidth(sidebarState.left - step);
                changed = true;
            } else if (e.key === 'ArrowRight' && side === 'left') {
                sidebarState.left = clampSidebarWidth(sidebarState.left + step);
                changed = true;
            } else if (e.key === 'ArrowLeft' && side === 'right') {
                sidebarState.right = clampSidebarWidth(sidebarState.right + step);
                changed = true;
            } else if (e.key === 'ArrowRight' && side === 'right') {
                sidebarState.right = clampSidebarWidth(sidebarState.right - step);
                changed = true;
            }
            if (changed) {
                e.preventDefault();
                applySidebarWidths();
                saveSidebarWidths();
            }
        });
    }

    function initSidebarResize() {
        loadSidebarWidths();
        setupSidebarResizeHandle(document.getElementById('sidebarResizeLeft'), 'left');
        setupSidebarResizeHandle(document.getElementById('sidebarResizeRight'), 'right');
        updateSidebarResizeHandles();
        if (!global.__vttSidebarResizeResizeBound) {
            global.__vttSidebarResizeResizeBound = true;
            global.addEventListener('resize', function () {
                sidebarState.left = clampSidebarWidth(sidebarState.left);
                sidebarState.right = clampSidebarWidth(sidebarState.right);
                applySidebarWidths();
                updateSidebarResizeHandles();
            });
        }
    }

    function getPlayerInitials(name) {
        if (!name) return '?';
        var parts = String(name).trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }

    function renderPlayerCard(player) {
        if (!player || !player.name) return '';
        var initials = getPlayerInitials(player.name);
        var charName = player.character_name || 'No character';
        var dmBadge = player.is_dm ? '<span class="player-card__dm" title="Dungeon Master">DM</span>' : '';
        return (
            '<div class="player-card' + (player.is_dm ? ' player-card--dm' : '') + '">' +
            '<div class="player-card__avatar" aria-hidden="true">' + initials + '</div>' +
            '<div class="player-card__body">' +
            '<div class="player-card__name">' + escapeHtml(player.name) + dmBadge + '</div>' +
            '<div class="player-card__char">' + escapeHtml(charName) + '</div>' +
            '</div>' +
            '<span class="player-card__status" title="Connected" aria-label="Connected"></span>' +
            '</div>'
        );
    }

    function escapeHtml(str) {
        if (typeof global.escapeHtml === 'function') return global.escapeHtml(str);
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function updateConnectionStatus(connected) {
        var el = document.getElementById('connectionStatus');
        if (!el) return;
        el.classList.toggle('vtt-connection--online', !!connected);
        el.classList.toggle('vtt-connection--offline', !connected);
        el.textContent = connected ? 'Connected' : 'Disconnected';
    }

    function initActionBarToggle() {
        var wrap = document.getElementById('actionBarToggleWrap');
        if (!wrap) return;
        wrap.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action-bar-state]');
            if (!btn || typeof togglePlayerActionBar !== 'function') return;
            var wantOn = btn.dataset.actionBarState === 'on';
            var currentlyOn = typeof playerActionBarVisible !== 'undefined' ? playerActionBarVisible : true;
            if (wantOn !== currentlyOn) togglePlayerActionBar();
            syncActionBarToggleUI();
        });
    }

    function syncActionBarToggleUI() {
        var wrap = document.getElementById('actionBarToggleWrap');
        if (!wrap) return;
        var on = typeof playerActionBarVisible !== 'undefined' ? playerActionBarVisible : true;
        wrap.querySelectorAll('[data-action-bar-state]').forEach(function (btn) {
            var active = (btn.dataset.actionBarState === 'on') === on;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    global.UIShell = {
        renderPlayerCard: renderPlayerCard,
        updateConnectionStatus: updateConnectionStatus,
        initActionBarToggle: initActionBarToggle,
        syncActionBarToggleUI: syncActionBarToggleUI,
        initSidebarResize: initSidebarResize,
        updateSidebarResizeHandles: updateSidebarResizeHandles,
        applySidebarWidths: applySidebarWidths
    };

    global.addEventListener('DOMContentLoaded', function () {
        initActionBarToggle();
        initSidebarResize();
    });
})(window);
