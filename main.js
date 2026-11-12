'use strict';

const fs = require('node:fs');
const path = require('node:path');

let viewSettings = { display: 'always', hud: 'selected' };

function normalizeSettings(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
        display: ['always', 'selected', 'off'].includes(input.display) ? input.display : 'always',
        hud: ['selected', 'always', 'off'].includes(input.hud) ? input.hud : 'selected',
    };
}


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

exports.methods = {
    openSettings() {
        return globalThis.Editor?.Panel?.open?.('cocos-gizmos.settings');
    },
    async getDiagnostics() {
        return globalThis.Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cocos-gizmos',
            method: 'gizmosSmokeReport',
            args: [],
        });
    },
    getSettings() {
        return { ...viewSettings };
    },
    async setSettings(value) {
        const next = normalizeSettings(value);
        const editor = globalThis.Editor;
        const applied = await editor.Message.request('scene', 'execute-scene-script', {
            name: 'cocos-gizmos',
            method: 'gizmosSetViewSettings',
            args: [next],
        });
        if (!applied || !['always', 'selected', 'off'].includes(applied.display)) {
            throw new Error('The Scene View could not apply Gizmos settings');
        }
        viewSettings = next;
        return { ...viewSettings };
    },
};
