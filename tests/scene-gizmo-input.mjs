import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = ts.transpileModule(readFileSync(path.join(root, 'source/SceneGizmoInput.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const scope = { exports: {} };
vm.runInNewContext(code, scope);
const { readScenePointer, readSceneHandleName, isPrimaryScenePointer,
    GizmoInputDiagnostics } = scope.exports;

function assertPointer(event, x, y) {
    const p = readScenePointer(event);
    assert.ok(p, 'Expected a Scene pointer');
    assert.equal(p.x, x);
    assert.equal(p.y, y);
}
assertPointer({ x: 150, y: -50 }, 150, -50);
assertPointer({ detail: { x: 20, y: 30 } }, 20, 30);
assertPointer({ data: { mouseX: 40, mouseY: 80 } }, 40, 80);
assertPointer({ event: { offsetX: 15, offsetY: 33 } }, 15, 33);
assertPointer({ getLocation() { return { x: 7, y: 8 }; } }, 7, 8);
assertPointer({ mouse: { getUILocation() { return { x: 99, y: 23 }; } } }, 99, 23);
assertPointer({ detail: { event: { getMouseLocation() { return { x: 13, y: 42 }; } } } }, 13, 42);
assertPointer({ getLocation() { throw new Error('unavailable'); },
    getUILocation() { return { x: 10, y: 11 }; } }, 10, 11);
assert.equal(readScenePointer({ x: NaN, y: 1 }), null);
assert.equal(readScenePointer({ x: Infinity, y: 0 }), null);
assert.equal(readScenePointer({ clientX: 300, clientY: 100 }), null,
    'Desktop clientX without viewport conversion is not a valid Scene ray origin');

assert.equal(readSceneHandleName({ handleName: 'position:p:single' }), 'position:p:single');
assert.equal(readSceneHandleName({ detail: { handleName: 'hud:slider' } }), 'hud:slider');
assert.equal(readSceneHandleName({ data: { handle: { name: 'hud:toggle' } } }), 'hud:toggle');
assert.equal(readSceneHandleName({ event: { handle: { handleName: 'hud:check' } } }), 'hud:check');
assert.equal(readSceneHandleName({}), null);

// Middle-button camera pan and right-button orbit must NEVER acquire Gizmo
// position or HUD controls. Creator's event wrappers vary by Scene backend.
for (const event of [
    { button: 1, x: 100, y: 100 },
    { getButton() { return 1; }, x: 100, y: 100 },
    { detail: { button: 1 }, x: 100, y: 100 },
    { data: { event: { button: 1 } }, x: 100, y: 100 },
    { which: 2, x: 100, y: 100 },
    { buttons: 4, x: 100, y: 100 },
    { getButtons() { return 4; }, x: 100, y: 100 },
    { mouse: { button: 1 }, x: 100, y: 100 },
    { event: { button: 2 }, x: 100, y: 100 },
]) {
    assert.equal(isPrimaryScenePointer(event), false,
        'Middle/right camera navigation must not be a drag gesture');
}
for (const event of [
    { button: 0, x: 100, y: 100 },
    { getButton() { return 0; } },
    { which: 1 },
    { buttons: 1 },
    { detail: { getButton() { return 0; } } },
    { x: 100, y: 100 }, // Native BoxController omits button.
]) {
    assert.equal(isPrimaryScenePointer(event), true,
        'Left click and compatible native callbacks must remain draggable');
}

const stats = new GizmoInputDiagnostics();
stats.record('controllerDown');
for (let i = 0; i < 100; i++) stats.record('controllerMove');
stats.record('controllerUp');
stats.record('gizmoDown');
stats.record('outsideUp');
stats.record('missingPointer');
assert.equal(stats.snapshot().controllerMove, 100);
assert.equal(stats.snapshot().controllerDown, 1);
assert.deepEqual(Array.from(stats.snapshot().recent), [
    'controllerDown', 'controllerUp', 'gizmoDown', 'outsideUp', 'missingPointer',
]);
for (let i = 0; i < 30; i++) stats.record('outsideDown');
assert.equal(stats.snapshot().recent.length, 16);
assert.equal(stats.snapshot().outsideDown, 30);
const mutable = stats.snapshot();
mutable.recent.splice(0);
assert.equal(stats.snapshot().recent.length, 16,
    'External inspector consumers must not mutate the internal history');

console.log('[scene-gizmo-input] Cocos pointer shapes, safe handle lookup and bounded diagnostics OK');
