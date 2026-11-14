import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = (name) => ts.transpileModule(
    readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS } },
).outputText;
const presets = { exports: {} };
vm.runInNewContext(compile('GizmoHandlePresets'), presets);
const { makeMoveGizmo2D } = presets.exports;
const descriptors = makeMoveGizmo2D('target', { space: 'local' });
assert.equal(descriptors.length, 3);
assert.deepEqual(Array.from(descriptors, d => d.id), ['axis-x', 'axis-y', 'plane-xy']);
assert.deepEqual(Array.from(descriptors, d => d.color), ['#ff595e', '#43df66', '#fff16e']);
assert.ok(descriptors.every(d => d.snap === undefined));
assert.ok(descriptors.every(d => d.boxSize === undefined));

const solverModule = { exports: {} };
vm.runInNewContext(compile('PositionDragSolver'), solverModule);
const { PositionDragSolver } = solverModule.exports;
const space = { toLocal(p) { return {...p}; }, toWorld(p) { return {...p}; } };
const initial = {x: 2, y: 3, z: 7};
const ray = (x, y) => ({o:{x,y,z:30},d:{x:0,y:0,z:-1}});
for(const [index, expected] of [
    [0, {x:3.125,y:3,z:7}],
    [1, {x:2,y:4.375,z:7}],
    [2, {x:3.125,y:4.375,z:7}],
]) {
    const descriptor = descriptors[index];
    const normal = {x:0,y:0,z:1};
    const solver = new PositionDragSolver(initial, space, normal, descriptor);
    assert.equal(solver.begin(ray(0,0)), true);
    const next = solver.move(ray(1.125,1.375));
    assert.deepEqual(JSON.parse(JSON.stringify(next)), expected,
        'X/Y/XY drag must preserve Z and fractional movement');
}

const source2D = readFileSync(path.join(root, 'source/Gizmos2D.ts'), 'utf8');
const renderer = readFileSync(path.join(root, 'source/PositionHandles.ts'), 'utf8');
const sample = readFileSync(path.join(root, 'editor-assets/Examples/CocosGizmos2DDemo.ts'), 'utf8');
assert.match(source2D, /public static move\(/);
assert.match(source2D, /return makeMoveGizmo2D\(property, options\)/);
assert.match(renderer, /if \(onCanvas\) \{\s*const start = canvasPoint\(ray.start\)/);
assert.match(renderer, /Gizmos2D\.drawSolidPolygon\(node, corners\)/);
assert.match(renderer, /drawMoveStroke\(node, corners\[i\]/);
assert.match(renderer, /Gizmos2D\.flushEditorFrame\(\)/);
assert.match(sample, /Gizmos2D\.move\('moveObject'/);
console.log('[move-2d] X/Y/XY descriptors, fractional drag and Canvas render path OK');
