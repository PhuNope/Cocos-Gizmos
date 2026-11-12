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
        presentation.evaluate(component, true).hud);
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
exports.methods = {
    gizmosStatus() { return updater ? updater.status() : { started: false }; },
    gizmosTick() { return updater ? updater.tickOnce() : { started: false }; },
    gizmosHandleStatus() { return handles ? handles.status() : { registered: 0, active: 0, reason: 'not-loaded' }; },
    gizmosGetViewSettings() { return presentation ? presentation.getSettings() : { display: 'always', hud: 'selected' }; },
    gizmosSetViewSettings(value) { return presentation ? presentation.configure(value) : { display: 'always', hud: 'selected' }; },
    gizmosHudStatus() { return presentation ? presentation.getStats() : { hudLabels: 0, defaults: null }; },
};
