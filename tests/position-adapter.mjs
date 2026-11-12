import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = name => ts.transpileModule(
    readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } },
).outputText;
const math = { exports: {} };
vm.runInNewContext(compile('PositionDragSolver'), math);
const events = [];
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    set(x, y, z) { Object.assign(this, { x, y, z }); }
    static transformMat4(out, input, matrix) {
        out.set(input.x + matrix.position.x, input.y + matrix.position.y, input.z + matrix.position.z);
        return out;
    }
}
Vec3.ZERO = new Vec3();
class Color {
    set() {}
    static fromHEX(color) { return color; }
}
class Quat {}
class Base {
    constructor() { this.controllers = []; }
    createController() {
        const c = {
            _cubeNode: { name: 'marker', active: false },
            _cubeNodeMR: { enabled: false },
            _editHandlesShape: { children: [{ name: 'x', active: true }, { name: 'y', active: true }] },
            _wireFrameBoxNode: { active: true },
            _wireFrameBoxMeshRenderer: { enabled: true },
            setColor() {}, setEditHandlesColor() {}, setHandleColor() {}, setOpacity() {},
            initEditHandles() {}, showEditHandles() {}, initHandle() {},
            registerEvents() {}, unregisterEvents() {}, hideEditHandles() {},
            hide() {}, show() {}, setPosition(v) { this.position = v; },
            setRotation() {}, updateSize() {}, removeHandle() {},
        };
        this._controller = c;
        this.controllers.push(c);
    }
    show() { this.onShow?.(); }
    hide() { this.onHide?.(); }
    onControlBegin(property) { events.push('begin:' + property); }
    onControlUpdate(property) { events.push('update:' + property); }
    onControlEnd(property) { events.push('end:' + property); }
    onComponentChanged() { events.push('component-changed'); }
}
const componentPool = { typeDefs: { 'cc.BoxCollider': Base } };
const manager = {
    _gizmoPool: { _getPool: type => { assert.equal(type, 'component'); return componentPool; } },
    createGizmo(key, component) {
        assert.equal(componentPool.typeDefs[key], componentPool.typeDefs['ProbePosition']);
        const gizmo = new componentPool.typeDefs[key]();
        gizmo.target = component;
        gizmo.init();
        component.gizmo = gizmo;
        return gizmo;
    },
};
const cam = {
    node: { forward: new Vec3(0, 0, -1) },
    screenPointToRay(x, y, out) {
        out.o = new Vec3(x, y, 100);
        out.d = new Vec3(0, 0, -1);
        return out;
    },
    worldToScreen(point, out) { out.set(point.x, point.y, 0); },
};
const node = {
    uuid: 'selected-node',
    isValid: true, activeInHierarchy: true,
    worldMatrix: { position: new Vec3() },
    inverseTransformPoint(out, p) { out.set(p.x, p.y, p.z); },
};
const component = {
    __classname__: 'ProbePosition',
    constructor: { name: 'ProbePosition' },
    node, isValid: true, enabled: true,
    target: new Vec3(150, 0, 0),
    onGizmoHandles() {
        return [{ property: 'target', plane: 'xy', space: 'local', snap: 10 }];
    },
    onGizmoChanged(property, phase) { events.push(phase + ':' + property); },
};
const sandbox = {
    exports: {},
    cce: { Camera: { camera: cam }, Gizmo: manager, Engine: { repaintInEditMode() {} } },
    console: { warn(...args) { throw new Error(args.join(' ')); } },
    require(name) {
        if (name === 'cc') return { Color, Vec3, Quat, Layers: { Enum: { GIZMOS: 4 } }, Component: class {} };
        if (name === './PositionDragSolver') return math.exports;
        throw new Error('Unknown import ' + name);
    },
};
vm.runInNewContext(compile('PositionHandles'), sandbox);
const adapter = sandbox.exports.createPositionHandleAdapter();
assert.equal(adapter.status().reason, 'not-initialized');
const selected = new Set([node.uuid]);
adapter.refresh([component], selected, 1000);
assert.equal(adapter.status().active, 1, 'A selected component must display its Gizmo');
assert.equal(adapter.status().registered, 2, 'Register both plain and cc-prefixed Cocos component names');
assert.ok(componentPool.typeDefs['cc.ProbePosition']);
const gizmo = component.gizmo;
assert.ok(gizmo);
assert.equal(gizmo.controllers.length, 1);
assert.equal(gizmo.controllers[0]._editHandlesShape.children[1].active, true);
assert.equal(gizmo.controllers[0]._editHandlesShape.children[0].active, false);
assert.equal(gizmo.controllers[0]._cubeNode.active, true, 'The rendered point remains visible');
assert.equal(gizmo.controllers[0]._cubeNodeMR.enabled, true, 'Point mesh rendering is enabled');
assert.equal(gizmo.controllers[0]._cubeNode.layer, 4, 'Point marker uses the Gizmos render layer');
assert.equal(gizmo.controllers[0]._editHandlesShape.children[1].layer, 4,
    'Picking proxy uses the Gizmos layer');
assert.equal(gizmo.controllers[0]._wireFrameBoxMeshRenderer.enabled, false, 'Collider wireframe is hidden');
assert.equal(gizmo.controllers[0].editable, true, 'Controller accepts editor interaction');
const ctrl = gizmo.controllers[0];
ctrl.onMouseDown({ handleName: 'y', x: 150, y: 0 });
for (const [x, y] of [[0, 150], [-150, 0], [0, -150], [150, 0]]) {
    ctrl.onMouseMove({ handleName: 'y', x, y });
    assert.deepEqual([component.target.x, component.target.y, component.target.z], [x, y, 0],
        'Dragging must cover 360 degrees around a 2D node');
}
ctrl.onMouseUp();
assert.ok(events.includes('begin:target'));
assert.ok(events.includes('update:target'));
assert.ok(events.includes('end:target'));
assert.ok(events.includes('component-changed'));

ctrl.onMouseDown({ handleName: 'y', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'y', x: -300, y: 250 });
gizmo.onKeyDown({ key: 'Escape' });
assert.deepEqual([component.target.x, component.target.y, component.target.z], [150, 0, 0],
    'Escape must cancel and restore serialized coordinates');
assert.ok(events.includes('cancel:target'));
assert.equal(gizmo.controllers.length, 1);

adapter.refresh([component], new Set(), 1300);
assert.equal(adapter.status().active, 0);
adapter.dispose();
assert.equal(adapter.status().reason, 'disposed');
assert.equal(componentPool.typeDefs.ProbePosition, undefined,
    'Unloading the extension must restore the plain Gizmo registration');
assert.equal(componentPool.typeDefs['cc.ProbePosition'], undefined,
    'Unloading the extension must restore the prefixed Gizmo registration');

console.log('[position-adapter] selected handle, XY dragging, undo hooks, Escape and cleanup OK');
