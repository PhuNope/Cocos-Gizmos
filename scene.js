'use strict';
// Editor Scene process only; no runtime assets mounted.
let installed = null;
let updater = null;
let handles = null;
let presentation = null;
exports.load = function load() {
    const path = require('node:path');
    if (globalThis.Editor?.App?.path) module.paths.push(path.join(globalThis.Editor.App.path, 'node_modules'));
    const { Gizmos2D } = require('./editor-runtime/Gizmos2D.js');
    const { Gizmos3D } = require('./editor-runtime/Gizmos3D.js');
    installed = { Gizmos2D, Gizmos3D };
    Object.assign(globalThis, installed);
    updater = require('./editor-runtime/ExecuteGizmos.js');
    const { GizmoPresentationService } = require('./editor-runtime/GizmoPresentationService.js');
    presentation = new GizmoPresentationService();
    updater.setPresentationAdapter(presentation);
    const { createPositionHandleAdapter } = require('./editor-runtime/PositionHandles.js');
    handles = createPositionHandleAdapter((component) =>
        presentation.evaluate(component, true).hud, presentation.getLayout());
    updater.setPositionHandleAdapter(handles);
    const status = updater.start();
    console.info('[cocos-gizmos] Scene runtime loaded; updater=' + status.started +
        ', Scene=' + (status.scene || '(not ready)'));
};
exports.unload = function unload() {
    if (updater) {
        updater.stop();
        updater.setPositionHandleAdapter(null);
        updater.setPresentationAdapter(null);
        updater = null;
    }
    if (handles) { handles.dispose(); handles = null; }
    if (presentation) { presentation.dispose(); presentation = null; }
    if (!installed) return;
    if (globalThis.Gizmos2D === installed.Gizmos2D) delete globalThis.Gizmos2D;
    if (globalThis.Gizmos3D === installed.Gizmos3D) delete globalThis.Gizmos3D;
    installed = null;
};
let resetting = false;
/** Rebuild just the editor Gizmo runtime. This never reloads a Scene or
 * mutates the project's serialized Components. It also works after a
 * partially failed scene transition because updater.stop() unsubscribes
 * the old engine/scene listeners before new adapters are installed.
 */
function gizmosReset(selected = []) {
    if (resetting) return { started: false, busy: true };
    if (!updater || !installed) throw new Error('Cocos-Gizmos Scene runtime not loaded');
    resetting = true;
    const savedSettings = presentation?.getSettings?.() ||
        { display: 'always', hud: 'selected' };
    try {
        // Dispose old Scene objects before asking the editor to rebuild
        // any native BoxController +Y raycast faces.
        updater.stop();
        updater.setPositionHandleAdapter(null);
        updater.setPresentationAdapter(null);
        if (handles) handles.dispose();
        handles = null;
        if (presentation) presentation.dispose();
        presentation = null;

        const { GizmoPresentationService } =
            require('./editor-runtime/GizmoPresentationService.js');
        const { createPositionHandleAdapter } =
            require('./editor-runtime/PositionHandles.js');
        presentation = new GizmoPresentationService();
        presentation.configure(savedSettings);
        handles = createPositionHandleAdapter((component) =>
            presentation.evaluate(component, true).hud,
            presentation.getLayout());
        updater.setPresentationAdapter(presentation);
        updater.setPositionHandleAdapter(handles);
        const started = updater.start();
        if (!started?.started) throw new Error('Scene updater did not restart');
        const ids = Array.isArray(selected) ?
            selected.filter(id => typeof id === 'string') : [];
        // Force a fresh selection evaluation with no revision: avoids
        // rejecting a manual reset as an older selection event.
        updater.syncSelection(ids);
        const result = {
            started: true,
            selected: ids.length,
            scene: updater.status()?.scene || null,
            handles: handles.status(),
        };
        console.info('[cocos-gizmos] Manual Gizmos reset succeeded', result);
        return result;
    } catch (error) {
        console.error('[cocos-gizmos] Reset failed:', error);
        try { updater.stop(); } catch { /* Scene may be shutting down */ }
        updater.setPositionHandleAdapter(null);
        updater.setPresentationAdapter(null);
        try { handles?.dispose(); } catch { /* partial construction */ }
        try { presentation?.dispose(); } catch { /* partial construction */ }
        handles = null;
        presentation = null;
        throw error;
    } finally {
        resetting = false;
    }
}

exports.methods = {
    gizmosReset,
    gizmosStatus() { return updater ? updater.status() : { started: false }; },
    gizmosTick() { return updater ? updater.tickOnce() : { started: false }; },
    gizmosSelectionChanged(selected, revision) { return updater ? updater.syncSelection(selected, revision) : { started: false }; },
    gizmosHandleStatus() { return handles ? handles.status() : { registered: 0, active: 0, reason: 'not-loaded' }; },
    gizmosGetViewSettings() { return presentation ? presentation.getSettings() : { display: 'always', hud: 'selected' }; },
    gizmosSetViewSettings(value) { return presentation ? presentation.configure(value) : { display: 'always', hud: 'selected' }; },
    gizmosHudStatus() { return presentation ? presentation.getStats() : { hudLabels: 0, defaults: null }; },
    gizmosExampleClassStatus() {
        const { inspectGizmoExampleClasses } =
            require('./editor-runtime/GizmoExampleClassDiagnostics.js');
        let engine = null;
        try { engine = require('cc'); }
        catch { /* A detached Scene process may not expose the Cocos engine. */ }
        return inspectGizmoExampleClasses(engine);
    },
    gizmosSmokeReport() {
        const { buildGizmoSmokeReport } = require('./editor-runtime/GizmoDiagnostics.js');
        const editor = globalThis.Editor || globalThis.window?.Editor;
        const cce = globalThis.cce || globalThis.window?.cce;
        return buildGizmoSmokeReport(
            editor,
            cce,
            updater ? updater.status() : null,
            handles ? handles.status() : null,
            presentation ? presentation.getStats() : null,
        );
    },
};
