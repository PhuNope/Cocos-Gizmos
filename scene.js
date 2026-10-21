'use strict';
// Cocos Creator scene contributions run in the Editor Scene process only.
// Unlike asset-db mounts they are not part of the game's module graph.
let installed = null;
exports.load = function load() {
    const path = require('node:path');
    if (globalThis.Editor?.App?.path) {
        module.paths.push(path.join(globalThis.Editor.App.path, 'node_modules'));
    }
    const { Gizmos2D } = require('./editor-runtime/Gizmos2D.js');
    const { Gizmos3D } = require('./editor-runtime/Gizmos3D.js');
    // Make the APIs available to Cocos project scripts in the Scene process.
    installed = { Gizmos2D, Gizmos3D };
    Object.assign(globalThis, installed);
    require('./editor-runtime/ExecuteGizmos.js');
    console.info('[cocos-gizmos] Gizmos2D and Gizmos3D loaded in Editor Scene only');
};
exports.unload = function unload() {
    if (!installed) return;
    if (globalThis.Gizmos2D === installed.Gizmos2D) delete globalThis.Gizmos2D;
    if (globalThis.Gizmos3D === installed.Gizmos3D) delete globalThis.Gizmos3D;
    installed = null;
};
exports.methods = {};
