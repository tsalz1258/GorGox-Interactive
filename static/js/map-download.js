/* DM map artwork download. app.js passes live state in; this file does not close over app.js lets. */
(function (global) {
    'use strict';

    function sanitizeMapDownloadFilename(name) {
        var s = String(name || 'map')
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        if (!s) s = 'map';
        if (!/\.png$/i.test(s)) s += '.png';
        return s;
    }

    function triggerBlobDownload(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
            try { URL.revokeObjectURL(url); } catch (e) {}
        }, 2500);
    }

    function loadHtmlImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('Failed to load image')); };
            img.src = src;
        });
    }

    function imageElementToPngBlob(img) {
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        if (!w || !h) return Promise.reject(new Error('Invalid image dimensions'));
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var cx = c.getContext('2d');
        if (!cx) return Promise.reject(new Error('Canvas unsupported'));
        cx.drawImage(img, 0, 0);
        return new Promise(function (resolve, reject) {
            c.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error('PNG encode failed'));
            }, 'image/png');
        });
    }

    function resolveMapRecordForDownload(ctx, mapId) {
        if (mapId) {
            if (ctx.currentMap && ctx.currentMap.id === mapId) return ctx.currentMap;
            if (Array.isArray(ctx.savedMapsCache)) {
                var hit = ctx.savedMapsCache.find(function (m) { return m && m.id === mapId; });
                if (hit) return hit;
            }
            return null;
        }
        return ctx.currentMap || null;
    }

    async function download(ctx, mapId) {
        if (!ctx.isDM) {
            alert('Only the DM can download maps.');
            return;
        }
        var map = resolveMapRecordForDownload(ctx, mapId || null);
        if (!map) {
            alert(mapId ? 'Map not found in the list. Refresh Maps and try again.' : 'No map is loaded. Load a map first, or download one from the Maps list.');
            return;
        }

        var name = map.name || 'map';
        var imagePath = map.image_path || '';
        try {
            var imgEl = null;
            if (
                ctx.currentMap &&
                ctx.currentMap.id === map.id &&
                ctx.currentMap.image &&
                ctx.currentMap.image.complete &&
                (ctx.currentMap.image.naturalWidth || 0) > 0
            ) {
                imgEl = ctx.currentMap.image;
            }
            if (!imgEl) {
                if (!imagePath) throw new Error('This map has no image path');
                var dataUrl = await ctx.fetchImageAsDataUrl(imagePath);
                if (!dataUrl) throw new Error('Could not fetch map image from server');
                imgEl = await loadHtmlImage(dataUrl);
            }
            var blob = await imageElementToPngBlob(imgEl);
            triggerBlobDownload(blob, sanitizeMapDownloadFilename(name));
            ctx.addLogEntry('📥 Downloaded map PNG: ' + name, 'success');
        } catch (err) {
            console.error('❌ downloadMapAsPng failed:', err);
            alert('Failed to download map PNG: ' + (err && err.message ? err.message : String(err)));
        }
    }

    global.MapDownload = { download: download, sanitizeMapDownloadFilename: sanitizeMapDownloadFilename };
})(window);
