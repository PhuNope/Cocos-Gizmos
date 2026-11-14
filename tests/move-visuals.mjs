import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(name) {
    const src = readFileSync(path.join(root, 'source', name + '.ts'), 'utf8');
    const output = ts.transpileModule(src, { compilerOptions: {
        target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    const scope = { exports: {} };
    vm.runInNewContext(output, scope, { filename: name + '.ts' });
    return scope.exports;
}
const { moveWorldPerPixel } = load('MoveScreenScale');
const { moveStrokeBands } = load('MoveStrokeGeometry');
const center = { x: 320, y: 120, z: 0 };
const right = {x:1,y:0,z:0}, up={x:0,y:1,z:0};
for(const pixelsPerUnit of [0.01, 1, 100, 1000000]) {
    const project = p => ({ x: p.x * pixelsPerUnit, y:p.y * pixelsPerUnit });
    const worldPerPixel = moveWorldPerPixel(center, project, right, up);
    assert.ok(worldPerPixel !== null && Number.isFinite(worldPerPixel));
    assert.ok(Math.abs(worldPerPixel * pixelsPerUnit - 1) < 1e-7,
        '2D and 3D orthographic zoom preserve world/pixel scaling');
    const worldA={x:0,y:0,z:0}, worldB={x:66*worldPerPixel,y:0,z:0};
    const bands = moveStrokeBands(worldA,worldB,
        {x:0,y:0,z:-1}, worldPerPixel);
    assert.ok(bands);
    const core = Math.hypot(
        bands.core[0].x-bands.core[3].x,
        bands.core[0].y-bands.core[3].y,
        bands.core[0].z-bands.core[3].z) / worldPerPixel;
    const feather = Math.hypot(
        bands.feather[0].x-bands.feather[3].x,
        bands.feather[0].y-bands.feather[3].y,
        bands.feather[0].z-bands.feather[3].z) / worldPerPixel;
    assert.ok(Math.abs(core-1.7)<1e-7);
    assert.ok(Math.abs(feather-4.2)<1e-7);
}
assert.equal(moveStrokeBands({x:0,y:0,z:0},{x:0,y:0,z:1},
    {x:0,y:0,z:1},1),null,'Camera-facing degeneracy does not create invalid ribbons');
assert.equal(moveWorldPerPixel(center, () => null), null);
assert.equal(moveWorldPerPixel(center,p=>({x:NaN,y:p.y})), null);
const adapter = readFileSync(path.join(root,'source/PositionHandles.ts'),'utf8');
assert.doesNotMatch(adapter,/if \(!hitA \|\| !hitB\) return 0\.3/);
assert.match(adapter,/moveWorldPerPixel\(world, project/);
assert.match(adapter,/drawMoveStroke\(node, a, b, color, onCanvas, pixel, canvasPoint\)/);
assert.match(adapter,/if \(this\.drag\?\.entry && component\?\.node\?\.isValid/);
assert.match(adapter,/Gizmos2D\.flushEditorFrame\(\)/);
console.log('[move-visuals] constant zoom size, soft feather ribbons and immediate 2D drag repaint OK');
