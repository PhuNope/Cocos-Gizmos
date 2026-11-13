import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const extension = require('../main.js');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.ok(manifest.contributions.messages['selection:select']);
assert.ok(manifest.contributions.messages['selection:unselect']);
const calls = [];
let selected = ['node-2d'];
globalThis.Editor = {
    Selection: { getSelected(type) {
        assert.equal(type, 'node');
        return [...selected];
    } },
    Message: { async request(channel, method, message) {
        assert.equal(channel, 'scene');
        assert.equal(method, 'execute-scene-script');
        assert.equal(message.method, 'gizmosSelectionChanged');
        calls.push(message.args[0]);
    } },
};
await extension.methods.onSelectionSelect('node', 'node-2d');
selected = [];
await extension.methods.onSelectionUnselect('node', 'node-2d');
selected = ['node-2d'];
await extension.methods.onSelectionSelect('node', 'node-2d');
assert.deepEqual(calls, [['node-2d'], [], ['node-2d']],
    'Selected -> empty -> same node must synchronise every transition');
selected = [];
await extension.methods.onSelectionUnselect('node', 'node-2d');
selected = ['other-node'];
await extension.methods.onSelectionSelect('node', 'other-node');
selected = ['node-2d'];
await extension.methods.onSelectionUnselect('node', 'other-node');
assert.deepEqual(calls.slice(-3), [[], ['other-node'], ['node-2d']],
    'Replacing a node must read the final selection, not the stale unselected UUID');
assert.deepEqual(await extension.methods.onSelectionSelect('asset', 'sprite'), undefined);
assert.equal(calls.length, 6, 'Non-node selections must not touch Scene gizmos');
delete globalThis.Editor;
console.log('[selection-reentry] native select/unselect + same-node reactivation OK');
