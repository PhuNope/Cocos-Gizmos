import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(path.join(root, 'source/MoveHitGeometry.ts'), 'utf8');
const js = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS },
}).outputText;
const scope = { exports: {} };
vm.runInNewContext(js, scope);
const { boundsOf, rectContains, insideProjectedPlane,
    distanceToSegmentSquared } = scope.exports;
const quad = [
    { x: 10, y: 10 }, { x: 50, y: 10 },
    { x: 65, y: 40 }, { x: 25, y: 40 },
];
assert.ok(insideProjectedPlane({ x: 30, y: 20 }, quad),
    'Clicking the center of the visible tilted plane selects its interior');
assert.ok(insideProjectedPlane({ x: 50, y: 12 }, quad));
assert.equal(insideProjectedPlane({ x: 65, y: 10 }, quad), false,
    'Plane hit test never substitutes its oversized screen bounding rectangle');
assert.equal(insideProjectedPlane({ x: 30, y: 20 },
    [...quad].reverse()), true, 'Plane hit is independent of winding');
assert.equal(insideProjectedPlane({ x: 30, y: 20 },
    Array(4).fill({ x: 10, y: 10 })), false,
    'Degenerate edge-on plane cannot steal another axis pick');
const bounds = boundsOf(quad);
assert.equal(rectContains({ x: 40, y: 25 }, bounds), true);
assert.equal(rectContains({ x: 120, y: 25 }, bounds), false);
assert.equal(boundsOf([{ x: NaN, y: 0 }]), null);
assert.equal(distanceToSegmentSquared({ x: 30, y: 12 },
    { x: 10, y: 10 }, { x: 70, y: 10 }), 4);
assert.equal(distanceToSegmentSquared({ x: 30, y: 50 },
    { x: 10, y: 10 }, { x: 70, y: 10 }), 1600);
console.log('[move-picking] exact plane polygon, full axis shafts and box rectangle geometry OK');
