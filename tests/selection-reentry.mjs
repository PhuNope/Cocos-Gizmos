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
        calls.push(message.args);
    } },
};
await extension.methods.onSelectionSelect('node', 'node-2d');
selected = [];
await extension.methods.onSelectionUnselect('node', 'node-2d');
selected = ['node-2d'];
await extension.methods.onSelectionSelect('node', 'node-2d');
assert.deepEqual(calls.slice(0, 6).map(call => call[0]),
    [['node-2d'], ['node-2d'], [], [], ['node-2d'], ['node-2d']],
    'Select, empty and reselect are synchronized on initial event and next tick');
selected = [];
await extension.methods.onSelectionUnselect('node', 'node-2d');
selected = ['other-node'];
await extension.methods.onSelectionSelect('node', 'other-node');
selected = ['node-2d'];
await extension.methods.onSelectionUnselect('node', 'other-node');
assert.deepEqual(calls.slice(-6).map(call => call[0]),
    [[], [], ['other-node'], ['other-node'], ['node-2d'], ['node-2d']],
    'Replacing a node resolves the final selected UUID');
assert.deepEqual(await extension.methods.onSelectionSelect('asset', 'sprite'), undefined);
assert.equal(calls.length, 12, 'Non-node selections must not touch Scene gizmos');
assert.ok(calls.every(call => typeof call[1] === 'number'),
    'Every synchronization has an ordering revision');
for (let i = 1; i < calls.length; i++) {
    assert.ok(calls[i][1] > calls[i - 1][1], 'Selection revisions are monotonic');
}
// Scene may receive select before Editor.Selection.getSelected() is updated.
selected = [];
await extension.methods.onSelectionSelect('node', 'first-click');
assert.deepEqual(calls.at(-1)[0], ['first-click'],
    'First click uses event UUID even if Editor selection snapshot is stale');
selected = [];
await extension.methods.onSelectionSelect('node', ['first-from-array']);
assert.deepEqual(calls.at(-1)[0], ['first-from-array'],
    'Creator 3.8.8 array selection event also activates on the first click');
selected = ['first-from-array'];
await extension.methods.onSelectionUnselect('node', ['first-from-array']);
assert.deepEqual(calls.at(-1)[0], [],
    'Array unselect events clear all handles on the first deselection');
delete globalThis.Editor;
console.log('[selection-reentry] native select/unselect + same-node reactivation OK');
