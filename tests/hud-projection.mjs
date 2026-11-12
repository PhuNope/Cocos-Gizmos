import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = name => ts.transpileModule(
    readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } },
).outputText;
const solver = { exports: {} };
vm.runInNewContext(compile('PositionDragSolver'), solver);
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
}
const projectionModule = { exports: {} };
vm.runInNewContext(compile('GizmoHudProjection'), {
    exports: projectionModule.exports,
    require(name) {
        if (name === 'cc') return { Vec3 };
        if (name === './PositionDragSolver') return solver.exports;
        throw new Error('Unexpected module ' + name);
    },
});
const { createSceneHudProjection } = projectionModule.exports;

let rays = 0;
let screens = 0;
const perspectiveCamera = {
    node: { forward: new Vec3(0, 0, -1) },
    worldToScreen(point, output) {
        screens++;
        output.x = point.x / (10 - point.z) * 100;
        output.y = point.y / (10 - point.z) * 100;
        output.z = 1;
    },
    screenPointToRay(x, y) {
        rays++;
        return { o: new Vec3(0, 0, 10), d: new Vec3(x / 100, y / 100, -1) };
    },
};

const origin = new Vec3(10, -5, 0);
const projection = createSceneHudProjection(perspectiveCamera, origin);
assert.ok(projection);
assert.equal(screens, 1);
assert.equal(rays, 3, 'The camera basis always requires just three rays');
assert.equal(projection.screen.x, 100);
assert.equal(projection.screen.y, -50);
assert.ok(Math.abs(projection.pixelSize - 0.1) < 1e-10);
for (const [x, y] of [[100, -50], [150, -20], [400, 200], [-100, -120]]) {
    const world = projection.worldAt(x, y);
    const ray = perspectiveCamera.screenPointToRay(x, y);
    const hit = solver.exports.intersectHandlePlane(ray, origin, perspectiveCamera.node.forward);
    assert.ok(Math.abs(world.x - hit.x) < 1e-9);
    assert.ok(Math.abs(world.y - hit.y) < 1e-9);
    assert.ok(Math.abs(world.z - hit.z) < 1e-9);
}
assert.equal(screens, 1, 'Mapping rows requires no extra worldToScreen calls');
assert.equal(rays, 7, 'Only test reference rays are added after constructing the basis');

const invalidCamera = {
    node: { forward: new Vec3(0, 0, -1) },
    worldToScreen(p, out) { Object.assign(out, p); },
    screenPointToRay(x, y) {
        return { o: new Vec3(), d: new Vec3(1, 0, 0) };
    },
};
assert.equal(createSceneHudProjection(invalidCamera, new Vec3()), null,
    'Parallel rays must safely disable a HUD projection');

const nanCamera = {
    worldToScreen(_point, out) { out.x = Number.NaN; out.y = 0; },
    screenPointToRay() { throw new Error('should not run'); },
};
assert.equal(createSceneHudProjection(nanCamera, new Vec3()), null);
console.log('[hud-projection] perspective camera basis, three rays, exact row placement and invalid rays OK');
