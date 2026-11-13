import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const zip = readFileSync(path.join(root, 'release', `Cocos-Gizmos-v${pkg.version}.zip`));
const entries = new Map();
let offset = 0;
while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const begin = offset + 30 + nameLen + extraLen;
    const bytes = zip.subarray(begin, begin + compressed);
    entries.set(name, (method === 8 ? inflateRawSync(bytes) : bytes).toString('utf8'));
    offset = begin + compressed;
}
const installed = JSON.parse(entries.get('package.json') || '{}');
assert.equal(installed.name, 'cocos-gizmos');
assert.ok(installed.contributions.menu.some(item =>
    item.path === 'Gizmos' && item.label === 'Reset Gizmos' &&
    item.message === 'reset-gizmos'),
    'Actual installable extension ZIP must expose top-level Gizmos reset menu');
assert.deepEqual(installed.contributions.messages['reset-gizmos'].methods,
    ['resetGizmos']);
assert.match(entries.get('main.js') || '', /resetGizmos/);
assert.match(entries.get('scene.js') || '', /gizmosReset/);
assert.match(entries.get('editor-runtime/PlaneHandleGeometry.js') || '',
    /planeHandleGeometry/);
assert.match(entries.get('editor-runtime/MoveHitGeometry.js') || '',
    /insideProjectedPlane/, 'Native installer must contain Move screen hit math');
assert.match(entries.get('editor-runtime/PositionHandles.js') || '',
    /updateMovePickingQuad/, 'Installer must bind transparent Move pick quads');
assert.doesNotMatch(entries.get('editor-runtime/PositionHandles.js') || '',
    /moveTo\(20, 32\)/,
    'Point marker sprite must not draw the old center plus sign');
for (const [event, method] of [
    ['selection:select', 'onSelectionSelect'],
    ['selection:unselect', 'onSelectionUnselect'],
]) {
    assert.deepEqual(installed.contributions.messages[event].methods, [method],
        'Selection lifecycle must survive the packer-generated manifest');
    assert.ok(entries.get('main.js')?.includes(method),
        'The packed main.js exports the registered selection handler');
}
assert.match(entries.get('scene.js') || '', /gizmosSelectionChanged/);
assert.match(entries.get('editor-runtime/ExecuteGizmos.js') || '', /syncSelection/);
assert.match(entries.get('editor-runtime/GizmoHudOverlay.js') || '', /CocosGizmosScreenHud/);
assert.match(entries.get('editor-runtime/GizmoHudOverlay.js') || '', /gizmoRootNode/);
assert.match(entries.get('editor-runtime/PositionHandles.js') || '', /isHandleDisposed/);
assert.match(entries.get('editor-runtime/GizmoMoveCommand.js') || '',
    /GizmoMoveCommand/, 'Installer includes application command');
assert.match(entries.get('editor-runtime/GizmoHandlePresets.js') || '',
    /makeMoveGizmo/, 'Editor includes reusable descriptor factories');
assert.match(entries.get('dist/GizmoHandlePresets.js') || '',
    /makePointGizmos/, 'Public ESM runtime includes descriptor factories');
assert.ok([...entries.keys()].every(name => !name.startsWith('docs/')),
    'Installed ZIP must exclude the repository docs directory');
assert.ok(installed.contributions.menu.some(item =>
    item.path === 'Gizmos' && item.label === 'OpenDoc' && item.message === 'open-doc'),
    'Installed extension must expose Gizmos > OpenDoc beside Reset Gizmos');
assert.equal(installed.panels.docs.main, './panels/docs/index.js');
assert.deepEqual(installed.contributions.messages['open-doc'].methods, ['openDoc']);
assert.match(entries.get('main.js') || '', /openDoc/);
assert.match(entries.get('panels/docs/index.js') || '', /Gizmos OpenDoc/);
assert.match(entries.get('panels/docs/index.js') || '', /<svg/);
assert.match(entries.get('panels/docs/index.js') || '', /Gizmos3D.move/);
assert.ok(!installed.contributions.messages['selection:select'].methods.includes('onSelectionUnselect'));
console.log('[packaged-selection] extracted ZIP manifest, Scene event bridge, fullscreen HUD & native reentry OK');
