import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/PlaneHandleGeometry.ts'), 'utf8');
const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(output, sandbox);
const { planeHandleGeometry } = sandbox.exports;
const origin = { x: 4, y: 2, z: 1 };
const axes = { x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 } };

const xy = planeHandleGeometry(origin, axes, 'xy', 0.01, 40, 52);
const xz = planeHandleGeometry(origin, axes, 'xz', 0.01, 40, 52);
const yz = planeHandleGeometry(origin, axes, 'yz', 0.01, 40, 52);
assert.ok(xy && xz && yz);
assert.equal(xy.size, 0.4);
assert.deepEqual({ ...xy.center }, { x: 4.52, y: 2.52, z: 1 });
assert.deepEqual({ ...xz.center }, { x: 4.52, y: 2, z: 1.52 });
assert.deepEqual({ ...yz.center }, { x: 4, y: 2.52, z: 1.52 });
assert.ok(Math.abs(xy.normal.z - 1) < 1e-8);
assert.ok(Math.abs(xz.normal.y + 1) < 1e-8);
assert.ok(Math.abs(yz.normal.x - 1) < 1e-8);
for (const tile of [xy, xz, yz]) {
    assert.equal(tile.corners.length, 4);
    const centroid = tile.corners.reduce((point, next) =>
        ({ x: point.x + next.x / 4,
           y: point.y + next.y / 4, z: point.z + next.z / 4 }),
        { x: 0, y: 0, z: 0 });
    for (const axis of ['x', 'y', 'z'])
        assert.ok(Math.abs(centroid[axis] - tile.center[axis]) < 1e-8);
}
const zoom = planeHandleGeometry(origin, axes, 'xy', 0.1, 40, 52);
assert.ok(Math.abs(zoom.size / xy.size - 10) < 1e-8,
    'Tile dimensions remain fixed in Scene pixels as the camera zooms');
assert.ok(planeHandleGeometry(origin, axes, 'xy', 0, 40, 52) === null);
assert.ok(planeHandleGeometry(origin, {
    ...axes, y: { x: 0, y: 0, z: 0 },
}, 'xy', 0.01, 40, 52) === null);
const rotated = {
    x: { x: 0, y: 1, z: 0 },
    y: { x: -1, y: 0, z: 0 },
    z: axes.z,
};
const localXY = planeHandleGeometry(origin, rotated, 'xy', 0.01);
assert.ok(Math.abs(localXY.normal.z - 1) < 1e-8,
    'Local rotated Node plane remains orthogonal to rotated basis');
const sample = readFileSync(path.join(root, 'editor-assets/Examples/CocosGizmos3DDemo.ts'), 'utf8');
for (const id of ['axis-x', 'axis-y', 'axis-z'])
    assert.ok(sample.includes(`id: '${id}'`));
assert.equal((sample.match(/property: 'moveObject'/g) || []).length, 3,
    'One object now exposes exactly three short XYZ rays, no center dot');
assert.equal((sample.match(/visual: 'axis'/g) || []).length, 3);
assert.ok(!sample.includes("visual: 'plane'"),
    'Three plane tiles are replaced, not drawn on top of the axis arrows');

const axisSource = readFileSync(path.join(root, 'source/AxisHandleGeometry.ts'), 'utf8');
const axisJs = ts.transpileModule(axisSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS },
}).outputText;
const axisModule = { exports: {} };
vm.runInNewContext(axisJs, axisModule);
const { axisHandleGeometry, axisSegmentDistanceSquared, axisDragNormal } = axisModule.exports;
const rays = ['x', 'y', 'z'].map(axis =>
    axisHandleGeometry(origin, {
        x: { x: 1, y: 0, z: 0 },
        y: { x: 0, y: 1, z: 0 },
        z: { x: 0, y: 0, z: 1 },
    }, axis, 0.01, 78));
assert.ok(rays.every(Boolean));
assert.deepEqual(rays.map(r => Math.round((r.end.x - origin.x) * 100)),
    [78, 0, 0]);
assert.equal(rays[0].size, 0.24);
assert.equal(rays[1].center.y, origin.y + 0.78 * 0.57);
assert.equal(rays[2].end.z, origin.z + 0.78);
assert.ok(Math.abs(axisHandleGeometry(origin, {
    x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
}, 'x', 0.02).size / rays[0].size - 2) < 1e-8,
'Ray keeps constant apparent pixel size while zooming');
assert.equal(axisSegmentDistanceSquared({ x: 30, y: 4 },
    { x: 10, y: 0 }, { x: 78, y: 0 }), 16);
assert.equal(axisSegmentDistanceSquared({ x: 30, y: 40 },
    { x: 10, y: 0 }, { x: 78, y: 0 }), 1600);
assert.ok(axisDragNormal({ x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 }).z < -0.99);
assert.ok(axisDragNormal({ x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 }), 'Camera looking along X still gets a fallback plane');
console.log('[plane-handles] compact XYZ rays, pixel scaling, segment picking and locked axis drag OK');
