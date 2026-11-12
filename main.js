'use strict';

/** Initialize editor-only extension services. Type declarations are provided by the mounted asset package. */
exports.load = function load() {
    globalThis.Editor?.log?.('[cocos-gizmos] Type declarations available in db://cocos-gizmos/GizmosGlobal.ts');
};

exports.unload = function unload() {};
