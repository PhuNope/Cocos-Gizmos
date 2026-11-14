'use strict';

/**
 * Make a Cocos Creator "simple" extension panel occupy the available work
 * area on the monitor hosting its window. This is a best-effort fallback for
 * Creator builds where Editor.Panel.findWindow() is not exposed.
 *
 * Called only from the ready() hook of our standalone panels, never from the
 * Scene process or from docked Editor panels. Nothing here accesses Electron
 * internals, and all errors are intentionally nonfatal.
 */
function fillAvailableScreen(win = globalThis.window) {
    const screen = win?.screen;
    if (!screen || typeof win.resizeTo !== 'function') return false;
    const width = Math.floor(screen.availWidth);
    const height = Math.floor(screen.availHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) ||
        width < 480 || height < 360) return false;

    // If the Editor already maximized our standalone panel, leave it alone:
    // resizing a maximized BrowserWindow would restore its normal bounds.
    if (Number.isFinite(win.outerWidth) && Number.isFinite(win.outerHeight) &&
        win.outerWidth >= width - 8 && win.outerHeight >= height - 8)
        return true;

    try {
        const left = Number.isFinite(screen.availLeft) ?
            Math.floor(screen.availLeft) : 0;
        const top = Number.isFinite(screen.availTop) ?
            Math.floor(screen.availTop) : 0;
        win.moveTo?.(left, top);
        win.resizeTo(width, height);
        return true;
    } catch {
        // Chromium/Electron may disallow renderer-driven window resizing.
        // package.json's large standalone default size remains the fallback.
        return false;
    }
}

module.exports = { fillAvailableScreen };
