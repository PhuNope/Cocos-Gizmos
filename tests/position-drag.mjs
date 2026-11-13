import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/PositionDragSolver.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const scope = { exports: {} };
vm.runInNewContext(compiled, scope);
const { PositionDragSolver, intersectHandlePlane, handlePlaneNormal } = scope.exports;

const identity = { toLocal: p => ({...p}), toWorld: p => ({...p}) };
const ray = (x, y, z = 10) => ({ o: { x, y, z }, d: { x: 0, y: 0, z: -1 } });

const initial = { x: 200, y: 0, z: 0 };
const solver = new PositionDragSolver(initial, identity, { x: 0, y: 0, z: 1 }, { plane: 'xy' });
assert.equal(solver.begin(ray(200, 0)), true);
for (const [x, y] of [[0, 200], [-200, 0], [0, -200], [200, 0]]) {
    const point = solver.move(ray(x, y));
    assert.deepEqual({ ...point }, { x, y, z: 0 },
        'A position 200 world units from the origin must drag around all four quadrants');
}

assert.deepEqual({ ...solver.cancel() }, initial);
assert.deepEqual({ ...solver.move(ray(750, -800)) }, { x: 750, y: -800, z: 0 },
    'Long drags must not have a fixed 100 world unit limit');
assert.equal(solver.move({ o: { x: 0, y: 0, z: 10 }, d: { x: 1, y: 0, z: 0 } }), null);
assert.equal(intersectHandlePlane({ o: { x: 0, y: 0, z: -10 }, d: { x: 0, y: 0, z: -1 } },
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), null);

const offset = new PositionDragSolver(initial, identity, { x: 0, y: 0, z: 1 }, { plane: 'xy' });
assert.equal(offset.begin(ray(205, -5)), true);
assert.deepEqual({ ...offset.move(ray(50, 55)) }, { x: 45, y: 60, z: 0 },
    'Original grab offset remains stable during drag');

const continuous = new PositionDragSolver(initial, identity,
    { x: 0, y: 0, z: 1 }, { plane: 'xy' });
assert.equal(continuous.begin(ray(200, 0)), true);
assert.deepEqual({ ...continuous.move(ray(200.125, 0.375)) },
    { x: 200.125, y: 0.375, z: 0 },
    'Unsnapped dragging preserves fractional positions');
assert.deepEqual({ ...continuous.move(ray(200.1875, 0.4375)) },
    { x: 200.1875, y: 0.4375, z: 0 },
    'Small consecutive mouse motions do not jump to grid steps');

const snapped = new PositionDragSolver(initial, identity, { x: 0, y: 0, z: 1 }, {
    plane: 'xy', snap: 25,
    bounds: { min: { x: -300, y: -200 }, max: { x: 300, y: 200 } },
});
assert.equal(snapped.begin(ray(200, 0)), true);
assert.deepEqual({ ...snapped.move(ray(342, 183)) }, { x: 300, y: 175, z: 0 });
assert.deepEqual({ ...snapped.move(ray(-345, -500)) }, { x: -300, y: -200, z: 0 });

const locked = new PositionDragSolver({ x: 10, y: 20, z: 5 }, identity,
    { x: 0, y: 0, z: 1 }, { plane: 'xy', axis: 'x' });
assert.equal(locked.begin(ray(10, 20, 10)), true);
assert.deepEqual({ ...locked.move(ray(-55, 40)) }, { x: -55, y: 20, z: 5 });

const rotated = {
    toLocal: p => ({ x: (p.y - 10) / 2, y: -(p.x - 30) / 3, z: p.z }),
    toWorld: p => ({ x: 30 - 3 * p.y, y: 10 + 2 * p.x, z: p.z }),
};
const normal = handlePlaneNormal('xy', rotated, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
assert.equal(Math.abs(normal.z), 1);
const localDrag = new PositionDragSolver({ x: 4, y: 2, z: 0 }, rotated, normal, { plane: 'xy', snap: 1 });
assert.equal(localDrag.begin(ray(24, 18)), true);
const dest = rotated.toWorld({ x: -16, y: 25, z: 0 });
assert.deepEqual({ ...localDrag.move(ray(dest.x, dest.y)) }, { x: -16, y: 25, z: 0 },
    'Local coordinates remain correct under node rotation and nonuniform scaling');

for (const bad of [0, -1, Infinity]) {
    assert.throws(() => new PositionDragSolver(initial, identity, { x: 0, y: 0, z: 1 }, { snap: bad }));
}
assert.throws(() => new PositionDragSolver(initial, identity, { x: 0, y: 0, z: 1 },
    { bounds: { min: { x: 10 }, max: { x: -10 } } }));

console.log('[position-drag] XY 360 degrees, large distances, snap/bounds, axis locks and rotated local space OK');
