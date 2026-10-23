'use strict';
// Editor Scene process only; no runtime assets mounted.
let installed = null;
let updater = null;
exports.load = function load() {
    const path = require('node:path');
    if (globalThis.Editor?.App?.path) module.paths.push(path.join(globalThis.Editor.App.path, 'node_modules'));
    const { Gizmos2D } = require('./editor-runtime/Gizmos2D.js');
    const { Gizmos3D } = require('./editor-runtime/Gizmos3D.js');
    installed = { Gizmos2D, Gizmos3D };
    Object.assign(globalThis, installed);
    updater = require('./editor-runtime/ExecuteGizmos.js');
    const status = updater.start();
    console.info('[cocos-gizmos] Scene runtime loaded; updater=' + status.started +
        ', Scene=' + (status.scene || '(not ready)'));
};
exports.unload = function unload() {
    if (updater) { updater.stop(); updater = null; }
    if (!installed) return;
    if (globalThis.Gizmos2D === installed.Gizmos2D) delete globalThis.Gizmos2D;
    if (globalThis.Gizmos3D === installed.Gizmos3D) delete globalThis.Gizmos3D;
    installed = null;
};
exports.methods = {
    gizmosStatus() { return updater ? updater.status() : { started: false }; },
    gizmosTick() { return updater ? updater.tickOnce() : { started: false }; },
};
