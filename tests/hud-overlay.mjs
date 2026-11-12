import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = (name) => ts.transpileModule(
    readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } },
).outputText;
const solver = { exports: {} };
vm.runInNewContext(compile('PositionDragSolver'), solver);
const controls = { exports: {} };
vm.runInNewContext(compile('GizmoHudControls'), controls);
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
}
const projection = { exports: {} };
vm.runInNewContext(compile('GizmoHudProjection'), {
    exports: projection.exports,
    require(id) {
        if (id === 'cc') return { Vec3 };
        if (id === './PositionDragSolver') return solver.exports;
        throw new Error('Unexpected projection import ' + id);
    },
});
class Color {
    static created = 0;
    constructor() { Color.created++; }
    static fromHEX(target, text) { target.hex = text; }
}
const labels = [];
const camera = {
    rays: 0,
    node: { forward: new Vec3(0, 0, -1) },
    worldToScreen(point, out) { Object.assign(out, { x: point.x + 100, y: point.y + 100, z: 1 }); },
    screenPointToRay(x, y) {
        this.rays++;
        return { o: new Vec3(x, y, 10), d: new Vec3(0, 0, -1) };
    },
};
const sink = {
    beginColor(node, color) { assert.equal(node.uuid, 'hud-owner'); assert.ok(color); },
    drawLabel(node, id, text, position, fontSize, scale) {
        labels.push({ id, text, position, fontSize, scale });
    },
};
const sandbox = {
    exports: {},
    cce: { Camera: { _camera: { camera } } },
    require(id) {
        if (id === 'cc') return { Color, Vec3 };
        if (id === './Gizmos3D') return { Gizmos3D: sink };
        if (id === './PositionDragSolver') return solver.exports;
        if (id === './GizmoPresentation') return {};
        if (id === './GizmoHudControls') return controls.exports;
        if (id === './GizmoHudProjection') return projection.exports;
        throw new Error('unexpected module ' + id);
    },
};
vm.runInNewContext(compile('GizmoHudOverlay'), sandbox);
const { GizmoHudOverlay } = sandbox.exports;
const overlay = new GizmoHudOverlay();
const component = { node: { uuid: 'hud-owner', isValid: true, worldPosition: new Vec3(0, 0, 0) } };
const entries = [{ id: 'speed', text: 'Speed: 42', order: 0, fontSize: 14, color: '#ff0000' }];
assert.equal(overlay.render(component, entries), 1);
assert.equal(labels.length, 1);
assert.equal(labels[0].id, 'cocos-gizmos:hud:speed');
assert.equal(labels[0].text, 'Speed: 42');
assert.equal(labels[0].fontSize, 14);
assert.ok(labels[0].scale > 0);
assert.ok(Number.isFinite(labels[0].position.x));
assert.equal(Color.created, 1);
assert.equal(camera.rays, 3, 'One HUD label uses three camera rays');
overlay.render(component, entries);
assert.equal(labels[1].id, labels[0].id, 'Stable HUD IDs are reused across frames');
assert.equal(Color.created, 1, 'Repeated labels reuse cached colors');
assert.equal(camera.rays, 6, 'Each frame builds only one projection per component');
const many = Array.from({ length: 24 }, (_, index) => ({
    id: 'item:' + index, text: 'Label ' + index,
    order: index, fontSize: 14, color: '#ff0000',
}));
overlay.render(component, many);
assert.equal(camera.rays, 9, '24 labels must share three rays, not 48');
assert.equal(labels.length, 26);
assert.equal(Color.created, 1);

// Same Node + duplicate user-facing label ID must not share a cached Label.
const ownerTwo = { node: component.node };
const sharedLabel = [{ id: 'text:title', text: 'Owner A', fontSize: 14, color: '#ff0000' }];
const rowCountBefore = labels.length;
overlay.render(component, sharedLabel, { namespace: 'owner-a', startRow: 0 });
overlay.render(ownerTwo, [{ ...sharedLabel[0], text: 'Owner B' }],
    { namespace: 'owner-b', startRow: 3 });
assert.equal(labels.length, rowCountBefore + 2);
const ownerLabelA = labels.at(-2);
const ownerLabelB = labels.at(-1);
assert.notEqual(ownerLabelA.id, ownerLabelB.id,
    'Labels with duplicate IDs on one Node must have different namespaces');
assert.ok(ownerLabelA.id.includes('owner-a'));
assert.ok(ownerLabelB.id.includes('owner-b'));
assert.equal(ownerLabelA.position.y - ownerLabelB.position.y, 66,
    'HUD rows share one screen-space layout and leave a blank row between owners');

component.node.isValid = false;
assert.equal(overlay.render(component, entries), 0);
overlay.dispose();
assert.equal(overlay.totalDrawn, 0);
console.log('[hud-overlay] screen projection, stable label IDs, color cache and disposal OK');
