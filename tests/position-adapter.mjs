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
const edits = { exports: {} };
vm.runInNewContext(compile('GizmoEditSession'), edits);
const hud = { exports: {} };
vm.runInNewContext(compile('GizmoHudControls'), hud);
const presentation = { exports: {} };
vm.runInNewContext(compile('GizmoPresentation'), presentation);
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
const projection = { exports: {} };
vm.runInNewContext(compile('GizmoHudProjection'), {
    exports: projection.exports,
    require(name) {
        if (name === 'cc') return { Vec3 };
        if (name === './PositionDragSolver') return math.exports;
        throw new Error('Unknown projection import ' + name);
    },
});
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
    onControlBegin(property) { events.push('native-begin:' + property); }
    onControlUpdate(property) { events.push('native-update:' + property); }
    onControlEnd(property) { events.push('native-end:' + property); }
    onControlCancel(property) { events.push('native-cancel:' + property); }
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
    rays: 0,
    node: { forward: new Vec3(0, 0, -1) },
    screenPointToRay(x, y, out) {
        this.rays++;
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
        if (name === './GizmoEditSession') return edits.exports;
        if (name === './GizmoHudControls') return hud.exports;
        if (name === './GizmoPresentation') return presentation.exports;
        if (name === './GizmoHudProjection') return projection.exports;
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
assert.equal(events.filter(value => value === 'native-begin:target').length, 1,
    'One position drag opens one controller transaction');
assert.equal(events.filter(value => value === 'native-cancel:target').length, 1,
    'A complete circle returning to its origin is a no-op and cancels its undo entry');

ctrl.onMouseDown({ handleName: 'y', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'y', x: 180, y: 0 });
ctrl.onMouseUp();
assert.equal(component.target.x, 180);
assert.equal(events.filter(value => value === 'native-end:target').length, 1,
    'A meaningful position drag closes a single native transaction');
component.target = new Vec3(150, 0, 0);

ctrl.onMouseDown({ handleName: 'y', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'y', x: -300, y: 250 });
gizmo.onKeyDown({ key: 'Escape' });
assert.deepEqual([component.target.x, component.target.y, component.target.z], [150, 0, 0],
    'Escape must cancel and restore serialized coordinates');
assert.ok(events.includes('cancel:target'));
assert.equal(gizmo.controllers.length, 1);
assert.ok(events.includes('native-cancel:target'),
    'Escape cancels the native controller transaction when supported');

const baselineWrites = events.filter(value => value === 'component-changed').length;
ctrl.onMouseDown({ handleName: 'y', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'y', x: 150, y: 0 });
ctrl.onMouseUp();
assert.equal(events.filter(value => value === 'component-changed').length, baselineWrites,
    'No-op drag must not refresh Inspector or write component data');

ctrl.onMouseDown({ handleName: 'y', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'y', x: -400, y: 180 });
assert.notEqual(component.target.x, 150);
adapter.refresh([component], new Set(), 1300);
assert.deepEqual([component.target.x, component.target.y, component.target.z], [150, 0, 0],
    'Selection change must cancel an active drag and restore original property');
assert.equal(adapter.status().active, 0);
adapter.dispose();
assert.equal(adapter.status().reason, 'disposed');
assert.equal(componentPool.typeDefs.ProbePosition, undefined,
    'Unloading the extension must restore the plain Gizmo registration');
assert.equal(componentPool.typeDefs['cc.ProbePosition'], undefined,
    'Unloading the extension must restore the prefixed Gizmo registration');


node.worldPosition = new Vec3(0, 0, 0);
component.visible = false;
component.grid = true;
component.radius = 20;
let buttonClicks = 0;
const hudEvents = [];
component.onGizmoHud = () => [];
component.onGizmoHudControls = () => [
    { type: 'toggle', id: 'visibility', text: 'Visible', property: 'visible' },
    { type: 'checkbox', id: 'grid', text: 'Grid', property: 'grid' },
    { type: 'slider', id: 'radius', text: 'Radius', property: 'radius', min: 0, max: 100, step: 5 },
    { type: 'button', id: 'reset', text: 'Reset' },
];
component.onGizmoHudAction = id => {
    assert.equal(id, 'reset');
    buttonClicks++;
};
component.onGizmoHudChanged = (property, phase, value) =>
    hudEvents.push(property + ':' + phase + ':' + String(value));

const hudAdapter = sandbox.exports.createPositionHandleAdapter();
hudAdapter.refresh([component], selected, 2000);
const hudGizmo = component.gizmo;
assert.equal(hudAdapter.status().active, 1);
assert.equal(hudGizmo.controllers.length, 5, 'One position handle and four HUD controls');
const toggle = hudGizmo.controllers[1];
const checkbox = hudGizmo.controllers[2];
const slider = hudGizmo.controllers[3];
const button = hudGizmo.controllers[4];

const raysBefore = cam.rays;
hudGizmo.refreshHandles();
assert.equal(cam.rays - raysBefore, 5,
    'Four HUD controls share three rays; the position marker uses two');
const controllersBeforeText = hudGizmo.controllers.length;
const controlsBeforeText = component.onGizmoHudControls;
component.onGizmoHudControls = () => controlsBeforeText().map(control => ({
    ...control, text: control.text + '!',
}));
hudGizmo.refreshHandles();
assert.equal(hudGizmo.controllers.length, controllersBeforeText,
    'Changing HUD text must not recreate picking controllers');
component.onGizmoHudControls = controlsBeforeText;

toggle.onMouseDown({ handleName: 'hud:visibility', x: 10, y: 10 });
assert.equal(component.visible, false, 'Toggle changes on pointer release');
toggle.onMouseUp();
assert.equal(component.visible, true);
assert.ok(hudEvents.includes('visible:begin:false'));
assert.ok(hudEvents.includes('visible:update:true'));
assert.ok(hudEvents.includes('visible:end:true'));

checkbox.onMouseDown({ handleName: 'hud:grid', x: 10, y: 10 });
checkbox.onMouseUp();
assert.equal(component.grid, false);
checkbox.onMouseDown({ handleName: 'hud:grid', x: 10, y: 10 });
hudGizmo.onKeyDown({ key: 'Escape' });
assert.equal(component.grid, false, 'Cancelled click leaves checkbox unchanged');

slider.onMouseDown({ handleName: 'hud:radius', x: 30, y: 10 });
slider.onMouseMove({ handleName: 'hud:radius', x: 90, y: 10 });
assert.equal(component.radius, 70);
slider.onMouseUp();
assert.ok(hudEvents.includes('radius:update:70'));
slider.onMouseDown({ handleName: 'hud:radius', x: 30, y: 10 });
slider.onMouseMove({ handleName: 'hud:radius', x: 90, y: 10 });
hudGizmo.onKeyDown({ key: 'Escape' });
assert.equal(component.radius, 70, 'Escape restores the slider value');

button.onMouseDown({ handleName: 'hud:reset', x: 10, y: 10 });
assert.equal(buttonClicks, 0);
button.onMouseUp();
assert.equal(buttonClicks, 1);
button.onMouseDown({ handleName: 'hud:reset', x: 10, y: 10 });
hudGizmo.onKeyDown({ key: 'Escape' });
assert.equal(buttonClicks, 1, 'Cancelled button click is not dispatched');

toggle.onMouseDown({ handleName: 'hud:visibility', x: 10, y: 10 });
const registeredBeforeClear = hudAdapter.status().registered;
hudAdapter.clear();
assert.equal(component.visible, true, 'Scene cleanup cancels a pending toggle');
assert.equal(hudAdapter.status().active, 0, 'Scene cleanup hides all active controllers immediately');
assert.equal(hudAdapter.status().registered, registeredBeforeClear,
    'Scene cleanup must keep class registration for the next Scene');
hudAdapter.refresh([component], selected, 2301);
assert.equal(hudAdapter.status().active, 1, 'Opening another Scene can reuse registered controllers');
hudAdapter.clear();
hudAdapter.dispose();
assert.equal(componentPool.typeDefs.ProbePosition, undefined);
console.log('[hud-adapter] toggle/checkbox clicks, slider drag and cancel, button dispatch and cleanup OK');

console.log('[position-adapter] selected handle, XY dragging, undo hooks, Escape and cleanup OK');
