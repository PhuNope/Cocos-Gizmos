'use strict';

const fs = require('node:fs');
const path = require('node:path');

// URLs are relative to the read-only mount defined in package.json.
// Keep the UUIDs in sync with editor-assets/Examples/*.ts.meta.
const EXAMPLE_ASSETS = Object.freeze([
    { name: 'CocosGizmos2DDemo', uuid: '79b61d2e-c131-4ae7-8be4-54aa7becc30a' },
    { name: 'CocosGizmos3DDemo', uuid: '1f0a6e38-ffb9-4f95-9f39-ef443ba2e6d8' },
    { name: 'CocosGizmosSmokeDemo', uuid: 'c9f57ebd-36ce-4b24-a7bf-47a350c2d9db' },
]);

async function queryExampleAssets(editor) {
    if (typeof editor?.Message?.request !== 'function') {
        throw new Error('Editor Message API is unavailable');
    }
    const request = (...args) => editor.Message.request('asset-db', ...args);
    let databaseReady = null;
    try {
        // Present in Creator 3.8.8. Other patch versions may not expose it;
        // a missing query-ready message must not prevent trying actual assets.
        const ready = await request('query-ready');
        databaseReady = ready === true ? true : ready === false ? false : null;
    } catch {
        databaseReady = null;
    }
    if (databaseReady === false) {
        return {
            databaseReady,
            examples: EXAMPLE_ASSETS.map(({ name, uuid }) => ({
                name, expectedUuid: uuid,
                url: 'db://cocos-gizmos/Examples/' + name + '.ts',
                status: 'database-not-ready',
            })),
            guidance: 'Asset Database is still starting. Check again after the import completes.',
        };
    }
    const examples = await Promise.all(EXAMPLE_ASSETS.map(async ({ name, uuid }) => {
        const url = 'db://cocos-gizmos/Examples/' + name + '.ts';
        const entry = { name, url, expectedUuid: uuid };
        try {
            const info = await request('query-asset-info', url);
            if (!info || typeof info !== 'object') {
                return { ...entry, status: 'missing' };
            }
            const actualUuid = typeof info.uuid === 'string' ? info.uuid : null;
            const importer = typeof info.importer === 'string' ? info.importer : null;
            const status = info.invalid === true ? 'invalid' :
                actualUuid && actualUuid !== uuid ? 'uuid-mismatch' :
                info.imported === false ? 'not-imported' :
                importer && importer !== 'typescript' ? 'wrong-importer' :
                'imported';
            return { ...entry, status, actualUuid, importer };
        } catch (error) {
            return { ...entry, status: 'query-failed', error: String(error?.message || error) };
        }
    }));
    const allImported = examples.every((entry) => entry.status === 'imported');
    return {
        databaseReady,
        examples,
        guidance: allImported ?
            'Scripts are imported in Asset DB. Try dragging from Assets > cocos-gizmos > Examples to a Node Inspector; this check does not validate Scene compilation or drag-and-drop.' :
            'Check extension enablement, Cocos Console errors and the Assets > cocos-gizmos > Examples mount; restart the Editor if importing is stalled.',
    };
}

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
    async getExampleAssets() {
        return queryExampleAssets(globalThis.Editor);
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
