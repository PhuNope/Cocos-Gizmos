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
let protectedNode = null;
const reselected = [];
globalThis.Editor = {
    Selection: { getSelected(type) {
        assert.equal(type, 'node');
        return [...selected];
    }, select(type, uuid) {
        assert.equal(type, 'node');
        selected = [uuid];
        reselected.push(uuid);
    } },
    Message: { async request(channel, method, message) {
        assert.equal(channel, 'scene');
        assert.equal(method, 'execute-scene-script');
        if(message.method==='gizmosProtectedSelection')return protectedNode;
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
// The event UUID handles a stale Editor Selection snapshot on the first
// notification; next-turn synchronization must respect the real Editor state.
selected = [];
const firstStart=calls.length;
await extension.methods.onSelectionSelect('node', 'first-click');
assert.deepEqual(calls[firstStart][0], ['first-click'],
    'First event uses UUID before the Editor Selection snapshot updates');
assert.deepEqual(calls.at(-1)[0],[],
    'A later deselection cannot be undone by an earlier select callback');
selected = [];
const arrayStart=calls.length;
await extension.methods.onSelectionSelect('node', ['first-from-array']);
assert.deepEqual(calls[arrayStart][0], ['first-from-array']);
assert.deepEqual(calls.at(-1)[0],[]);
selected = ['first-from-array'];
await extension.methods.onSelectionUnselect('node', ['first-from-array']);
assert.deepEqual(calls.at(-1)[0], [],
    'Array unselect events clear handles');
// A stale HUD gesture lease must NEVER call Editor.Selection.select() to
// resurrect the old Node after the user clicks another node.
protectedNode = {nodeUuid:'first-from-array',active:false};
selected = ['other-node'];
await extension.methods.onSelectionUnselect('node','first-from-array');
assert.deepEqual(reselected,[],
    'Gizmo selection guard may not force-select a deselected Node');
assert.deepEqual(calls.at(-1)[0],['other-node'],
    'Switching to another Node must hide the former Node handles');
protectedNode = {nodeUuid:'first-from-array',active:true};
selected = [];
await extension.methods.onSelectionUnselect('node','first-from-array');
assert.deepEqual(reselected,[]);
assert.deepEqual(calls.at(-1)[0],[],
    'Even a held selection lease cannot override authoritative unselect');
protectedNode = null;
delete globalThis.Editor;
console.log('[selection-reentry] authoritative select/unselect and no HUD-driven reselect OK');
