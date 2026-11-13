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
const bridge = { exports: {} };
vm.runInNewContext(compile('SceneCameraBridge'), bridge);
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
    pixelWorld: 1,
    node: { forward: new Vec3(0, 0, -1) },
    geometryRenderer: {},
    // Creator's internal scene camera uses *out-first* signatures.
    worldToScreen(out, point) {
        Object.assign(out, {
            x: point.x / this.pixelWorld + 100,
            y: point.y / this.pixelWorld + 100,
            z: 1,
        });
    },
    screenPointToRay(out, x, y) {
        this.rays++;
        out.o = new Vec3((x - 100) * this.pixelWorld,
            (y - 100) * this.pixelWorld, 10);
        out.d = new Vec3(0, 0, -1);
        return out;
    },
};
const sink = {
    beginColor(node, color) { assert.equal(node.uuid, 'hud-owner'); assert.ok(color); },
    drawLabel(node, id, text, position, fontSize, scale) {
        labels.push({ id, text, position, fontSize, scale, target: '3d' });
    },
};
const sink2D = {
    beginLayer(node, layer) { assert.equal(layer, 4); },
    beginLocalPosition() {},
    endLocalPosition() {},
    beginColor(node, color) { assert.equal(node.uuid, 'hud-owner'); assert.ok(color); },
    drawLabel(node, id, text, position, fontSize, scale) {
        labels.push({ id, text, position, fontSize, scale, target: '2d' });
    },
};
class RenderRoot2D {}
const sandbox = {
    exports: {},
    cce: { Camera: { _camera: { camera } } },
    require(id) {
        if (id === 'cc') return {
            Color, Vec3, Vec2: class Vec2 {
                constructor(x = 0, y = 0) { Object.assign(this, { x, y }); }
            },
            Layers: { Enum: { GIZMOS: 4 } }, RenderRoot2D,
        };
        if (id === './Gizmos3D') return { Gizmos3D: sink };
        if (id === './Gizmos2D') return { Gizmos2D: sink2D };
        if (id === './PositionDragSolver') return solver.exports;
        if (id === './GizmoPresentation') return {};
        if (id === './GizmoHudControls') return controls.exports;
        if (id === './GizmoHudProjection') return projection.exports;
        if (id === './SceneCameraBridge') return bridge.exports;
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
assert.equal(labels[0].target, '3d');
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

camera.pixelWorld = 0.00005; // extremely close zoom
overlay.render(component, entries, { namespace: 'zoom', startRow: 0 });
assert.ok(Math.abs(labels.at(-1).scale - 0.00005) < 1e-9,
    'HUD text should keep its on-screen font size even at extreme close zoom');
camera.pixelWorld = 0.2; // normal zoom
overlay.render(component, entries, { namespace: 'zoom', startRow: 0 });
assert.ok(Math.abs(labels.at(-1).scale - 0.2) < 1e-7,
    'Normal zoom should retain the screen-space text scale');

const { hudTextPixels } = sandbox.exports;
assert.equal(hudTextPixels(6), 12);
assert.equal(hudTextPixels(200), 24);
assert.equal(hudTextPixels(18), 18);
assert.equal(hudTextPixels(40, 10, 20), 20);
camera.pixelWorld = 0.1;
overlay.render(component, [{ id: 'limits', text: 'bounded',
    fontSize: 30, minSize: 14, maxSize: 18 }]);
assert.ok(Math.abs(labels.at(-1).scale - 0.06) < 1e-8,
    '30px font must be scaled down to an 18px on-screen maximum');

// 2D HUD must reuse the Canvas RenderRoot. Its Gizmos2D labels are already
// in the camera's visible UI graph, unlike a second nested 3D root.
const UiRoot = RenderRoot2D;
const canvas = {
    getComponent(type) { return type === UiRoot ? new UiRoot() : null; },
    parent: null,
};
const oldParent = component.node.parent;
const oldScale = component.node.worldScale;
const oldTransform = component.node.inverseTransformPoint;
component.node.parent = canvas;
component.node.worldScale = new Vec3(2, 4, 1);
component.node.inverseTransformPoint = (out, point) => {
    Object.assign(out, { x: point.x / 2, y: point.y / 4, z: point.z });
};
overlay.render(component, entries, { namespace: 'canvas', startRow: 0 });
assert.equal(labels.at(-1).target, '2d');
assert.ok(Math.abs(labels.at(-1).scale.x - 0.05) < 1e-8);
assert.ok(Math.abs(labels.at(-1).scale.y - 0.025) < 1e-8);
component.node.parent = oldParent;
component.node.worldScale = oldScale;
component.node.inverseTransformPoint = oldTransform;

component.node.isValid = false;
assert.equal(overlay.render(component, entries), 0);
overlay.dispose();
assert.equal(overlay.totalDrawn, 0);
console.log('[hud-overlay] screen projection, stable label IDs, color cache and disposal OK');
