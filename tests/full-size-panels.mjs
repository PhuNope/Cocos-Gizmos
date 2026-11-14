import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = require('../package.json');
const main = require('../main.js');
const { fillAvailableScreen } = require('../panels/full-size.js');

for (const id of ['docs', 'settings']) {
    const panel = manifest.panels[id];
    assert.equal(panel.type, 'simple');
    assert.equal(panel.size.width, 1600);
    assert.equal(panel.size.height, 920);
    assert.equal(panel.flags.resizable, true);
    assert.equal(panel.flags.save, false);
    assert.ok(panel.size['min-width'] > 0);
    assert.ok(panel.size['min-height'] > 0);
}

const calls = [];
const win = {
    screen: { availWidth: 1920, availHeight: 1040, availLeft: 1920, availTop: 0 },
    outerWidth: 750, outerHeight: 560,
    moveTo(...args) { calls.push(['move', ...args]); },
    resizeTo(...args) { calls.push(['resize', ...args]); },
};
assert.equal(fillAvailableScreen(win), true);
assert.deepEqual(calls, [['move', 1920, 0], ['resize', 1920, 1040]],
    'New standalone panel covers its monitor work area');
calls.length = 0;
win.outerWidth = 1920;
win.outerHeight = 1040;
assert.equal(fillAvailableScreen(win), true);
assert.equal(calls.length, 0,
    'A maximized panel must not be resized back to a normal window');
assert.equal(fillAvailableScreen(null), false);
assert.equal(fillAvailableScreen({screen:{availWidth:0,availHeight:0},resizeTo(){}}), false);
assert.equal(fillAvailableScreen({ screen: { availWidth: 1920, availHeight: 1080 },
    resizeTo() { throw new Error('window resizing forbidden'); } }), false,
    'When renderer resize is blocked, the large manifest window is retained');

const original = globalThis.Editor;
try {
    const windows = new Map();
    const opened = [];
    for (const id of ['cocos-gizmos.docs', 'cocos-gizmos.settings']) {
        windows.set(id, { maximize() { opened.push(['maximized', id]); } });
    }
    globalThis.Editor = {
        Panel: {
            open(id) { opened.push(['opened', id]); return true; },
            findWindow(id) { opened.push(['lookup', id]); return windows.get(id); },
        },
    };
    assert.equal(main.methods.openDoc(), true);
    assert.equal(main.methods.openSettings(), true);
    assert.deepEqual(opened, [
        ['opened','cocos-gizmos.docs'],
        ['lookup','cocos-gizmos.docs'],
        ['maximized','cocos-gizmos.docs'],
        ['opened','cocos-gizmos.settings'],
        ['lookup','cocos-gizmos.settings'],
        ['maximized','cocos-gizmos.settings'],
    ]);

    const asyncEvents = [];
    globalThis.Editor.Panel = {
        async open(id) { asyncEvents.push('opened:' + id); return true; },
        findWindow(id) { asyncEvents.push('lookup:' + id);
            return { maximize() { asyncEvents.push('maximized:' + id); } }; },
    };
    assert.equal(await main.methods.openDoc(), true);
    assert.deepEqual(asyncEvents, [
        'opened:cocos-gizmos.docs',
        'lookup:cocos-gizmos.docs',
        'maximized:cocos-gizmos.docs',
    ]);
    globalThis.Editor.Panel = { open() { return true; } };
    assert.equal(main.methods.openSettings(), true,
        'A Creator build without findWindow remains supported');
} finally {
    if (original === undefined) delete globalThis.Editor;
    else globalThis.Editor = original;
}

const packed = readFileSync(path.join(root, 'scripts/pack.mjs'), 'utf8');
assert.match(packed, /panels\/full-size\.js/,
    'The helper must be included in the real installable ZIP');
console.log('[full-size-panels] standalone windows, main maximize, renderer fit and fallback OK');
