'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Initialize editor-only extension services and inspect global type availability. */
exports.load = function load() {
    const editor = globalThis.Editor;
    const projectRoot = editor?.Project?.path;

    if (typeof projectRoot === 'string' && projectRoot.trim()) {
        const oldDeclaration = path.join(projectRoot, 'assets', 'cocos-gizmos.global.d.ts');
        if (fs.existsSync(oldDeclaration)) {
            editor?.warn?.(
                '[cocos-gizmos] Remove the obsolete assets/cocos-gizmos.global.d.ts from this project. ' +
                'The mounted GizmosGlobal.ts asset supplies global declarations and duplicate declarations may conflict.'
            );
        }
    }

    editor?.log?.('[cocos-gizmos] Global types: db://cocos-gizmos/GizmosGlobal.ts');
};

exports.unload = function unload() {};
