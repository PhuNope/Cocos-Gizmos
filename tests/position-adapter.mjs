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
const hudLayout = { exports: {} };
vm.runInNewContext(compile('GizmoHudLayout'), {
    exports: hudLayout.exports,
    require(id) {
        if (id === './GizmoHudControls') return hud.exports;
        if (id === './GizmoPresentation') return presentation.exports;
        throw new Error('Unknown HUD layout import ' + id);
    },
});
const gizmoInput = { exports: {} };
vm.runInNewContext(compile('SceneGizmoInput'), gizmoInput);
const cameraBridge = { exports: {} };
vm.runInNewContext(compile('SceneCameraBridge'), cameraBridge);
const events = [];
const visibleDots = { canvas: [], scene3d: [] };
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
            _cubeNode: { name: 'marker', active: false,
                setScale(scale) { this.scale = scale; } },
            _cubeNodeMR: { enabled: false },
            _editHandlesShape: { children: [{ name: 'x', active: true }, { name: 'y', active: true }] },
            _wireFrameBoxNode: { active: true },
            _wireFrameBoxMeshRenderer: { enabled: true },
            setColor() {}, setEditHandlesColor() {}, setHandleColor() {}, setOpacity() {},
            initEditHandles() { throw new Error('topNode: unsafe initEditHandles'); },
            showEditHandles() { throw new Error('topNode: unsafe showEditHandles'); },
            initHandle() {},
            registerCount: 0, unregisterCount: 0, showCount: 0, hideCount: 0,
            registerEvents() { this.registerCount++; },
            unregisterEvents() { this.unregisterCount++; },
            hideEditHandles() { throw new Error('topNode: unsafe hideEditHandles'); },
            hide() { this.hideCount++; },
            show() { this.showCount++; },
            setPosition(v) { this.position = v; },
            setRotation() {},
            updateSize() { throw new Error('topNode: unsafe BoxController.updateSize'); },
            removeHandle() {},
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
    geometryRenderer: {},
    screenPointToRay(out, x, y) {
        if (!out?.o || !out?.d || typeof x !== 'number') {
            throw new Error('The renderer scene camera requires (out, x, y)');
        }
        this.rays++;
        out.o = new Vec3(x, y, 100);
        out.d = new Vec3(0, 0, -1);
        return out;
    },
    worldToScreen(out, point) {
        if (!out || typeof point?.x !== 'number') {
            throw new Error('The renderer scene camera requires (out, worldPosition)');
        }
        out.set(point.x, point.y, 0);
    },
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
    cce: { Camera: { _camera: { camera: cam } }, Gizmo: manager, Engine: { repaintInEditMode() {} } },
    console: { warn(...args) { throw new Error(args.join(' ')); } },
    require(name) {
        if (name === 'cc') return { Color, Vec3, Quat, Layers: { Enum: { GIZMOS: 4, UI_2D: 16 } }, RenderRoot2D: class {}, Component: class {} };
        if (name === './Gizmos2D') return { Gizmos2D: {
            DEFAULT_LAYER: 4, DEFAULT_COLOR: {},
            beginLayer() {}, beginLocalPosition() {}, endLocalPosition() {},
            beginColor() {}, drawSolidEllipse(...args) { visibleDots.canvas.push(args); },
        } };
        if (name === './Gizmos3D') return { Gizmos3D: {
            DEFAULT_COLOR: {}, setDepTest() {}, beginColor() {},
            drawSphere(...args) { visibleDots.scene3d.push(args); },
        } };
        if (name === './PositionDragSolver') return math.exports;
        if (name === './GizmoEditSession') return edits.exports;
        if (name === './GizmoHudControls') return hud.exports;
        if (name === './GizmoPresentation') return presentation.exports;
        if (name === './GizmoHudProjection') return projection.exports;
        if (name === './SceneGizmoInput') return gizmoInput.exports;
        if (name === './SceneCameraBridge') return cameraBridge.exports;
        throw new Error('Unknown import ' + name);
    },
};
vm.runInNewContext(compile('PositionHandles'), sandbox);
const adapter = sandbox.exports.createPositionHandleAdapter();
assert.equal(adapter.status().reason, 'not-initialized');
const selected = new Set([node.uuid]);
adapter.refresh([component], selected, 1000);
assert.equal(adapter.status().active, 1, 'A selected component must display its Gizmo');
assert.ok(visibleDots.scene3d.length >= 1,
    'Selected marker is explicitly drawn, independent of native BoxController mesh');
assert.equal(adapter.status().registered, 2, 'Register both plain and cc-prefixed Cocos component names');
assert.ok(componentPool.typeDefs['cc.ProbePosition']);
const gizmo = component.gizmo;
assert.ok(gizmo);
assert.equal(gizmo.controllers.length, 1);
assert.equal(gizmo.controllers[0]._editHandlesShape.active, false,
    'Editable BoxController face handles are never initialized or displayed');
assert.equal(gizmo.controllers[0]._cubeNode.active, true, 'The rendered point remains visible');
assert.equal(gizmo.controllers[0]._cubeNodeMR.enabled, true, 'Point mesh rendering is enabled');
assert.equal(gizmo.controllers[0]._cubeNode.layer, 4, 'Point marker uses the Gizmos render layer');
assert.equal(gizmo.controllers[0]._cubeNode.layer, 4,
    'Standalone cube is the only picking marker');
assert.equal(gizmo.controllers[0]._wireFrameBoxMeshRenderer.enabled, false, 'Collider wireframe is hidden');
assert.equal(gizmo.controllers[0]._cubeNode.scale.x, 22,
    '2D picking marker is 22 screen pixels instead of the former 10px hitbox');
assert.equal(typeof gizmo.onNotGizmoMouseDown, 'function');
assert.equal(typeof gizmo.onNotGizmoMouseMove, 'function');
assert.equal(typeof gizmo.onNotGizmoMouseUp, 'function');
assert.equal(gizmo.shouldRegisterGizmoOperationEvent, true);
const ctrl = gizmo.controllers[0];
assert.equal(ctrl.registerCount, 1, 'Controller registers only once on first show');
gizmo.onShow();
assert.equal(ctrl.registerCount, 1, 'Repeated onShow does not register duplicate listeners');
gizmo.onHide();
assert.equal(ctrl.unregisterCount, 1, 'Hiding unregisters listeners once');
gizmo.onHide();
assert.equal(ctrl.unregisterCount, 1, 'Repeated onHide does not unregister twice');
gizmo.onShow();
assert.equal(ctrl.registerCount, 2, 'Showing again re-registers a single listener');
ctrl.onMouseDown({
    detail: { handleName: 'position:target:single' },
    data: { mouseX: 150, mouseY: 0 },
});
for (const [x, y] of [[0, 150], [-150, 0], [0, -150], [150, 0]]) {
    ctrl.onMouseMove({ handleName: 'position:target:single',
        getLocation() { return { x, y }; } });
    assert.deepEqual([component.target.x, component.target.y, component.target.z], [x, y, 0],
        'Dragging must cover 360 degrees around a 2D node');
}
// Creator's global mouse operation must be able to release without a hit.
gizmo.onNotGizmoMouseMove();
gizmo.onNotGizmoMouseUp();
assert.ok(events.includes('begin:target'));
assert.ok(events.includes('update:target'));
assert.ok(events.includes('end:target'));
assert.ok(events.includes('component-changed'));
assert.equal(events.filter(value => value === 'native-begin:target').length, 1,
    'One position drag opens one controller transaction');
assert.equal(events.filter(value => value === 'native-cancel:target').length, 1,
    'A complete circle returning to its origin is a no-op and cancels its undo entry');

ctrl.onMouseDown({ handleName: 'position:target:single', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'position:target:single', x: 180, y: 0 });
ctrl.onMouseUp();
assert.equal(component.target.x, 180);
assert.equal(ctrl.position.x, 180,
    'The marker follows the serialized property and remains aligned after drag');
assert.equal(ctrl._cubeNode.active, true, 'Releasing a drag must not hide the point');
assert.equal(ctrl._cubeNode.scale.x, 22,
    'The point remains the same visible size after completing a drag');
assert.equal(events.filter(value => value === 'native-end:target').length, 1,
    'A meaningful position drag closes a single native transaction');
component.target = new Vec3(150, 0, 0);

ctrl.onMouseDown({ handleName: 'position:target:single', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'position:target:single', x: -300, y: 250 });
gizmo.onKeyDown({ key: 'Escape' });
assert.deepEqual([component.target.x, component.target.y, component.target.z], [150, 0, 0],
    'Escape must cancel and restore serialized coordinates');
assert.ok(events.includes('cancel:target'));
assert.equal(gizmo.controllers.length, 1);
assert.ok(events.includes('native-cancel:target'),
    'Escape cancels the native controller transaction when supported');

const baselineWrites = events.filter(value => value === 'component-changed').length;
ctrl.onMouseDown({ handleName: 'position:target:single', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'position:target:single', x: 150, y: 0 });
ctrl.onMouseUp();
assert.equal(events.filter(value => value === 'component-changed').length, baselineWrites,
    'No-op drag must not refresh Inspector or write component data');

const operationsBefore = events.filter(v => v === 'native-begin:target').length;
gizmo.onGizmoMouseDown({
    detail: { handleName: 'position:target:single' },
    getUILocation() { return { x: 150, y: 0 }; },
});
ctrl.onMouseDown({ handleName: 'position:target:single', x: 150, y: 0 });
gizmo.onGizmoMouseMove({ getLocation() { return { x: 190, y: 0 }; } });
gizmo.onGizmoMouseUp();
assert.equal(component.target.x, 190, 'Operation-level events can drag a position handle');
assert.equal(events.filter(v => v === 'native-begin:target').length, operationsBefore + 1,
    'Operation and controller duplicate down events must open only one transaction');
assert.equal(adapter.status().input.gizmoDown, 1);
assert.equal(adapter.status().input.gizmoUp, 1);
component.target = new Vec3(150, 0, 0);

ctrl.onMouseDown({ handleName: 'position:target:single', x: 150, y: 0 });
ctrl.onMouseMove({ handleName: 'position:target:single', x: -400, y: 180 });
assert.notEqual(component.target.x, 150);
adapter.refresh([component], new Set(), 1300);
assert.deepEqual([component.target.x, component.target.y, component.target.z], [150, 0, 0],
    'Selection change must cancel an active drag and restore original property');
assert.equal(adapter.status().active, 0);

// Regression: A -> B -> A in less than 250ms must re-show the same
// native Gizmo, rather than losing its hidden controller indefinitely.
adapter.refresh([component], selected, 1316);
assert.equal(adapter.status().active, 1, 'Reselecting a Node restores its Gizmo immediately');
assert.equal(gizmo.isHandleVisible(), true);
assert.equal(ctrl.registerCount, 3, 'Reselection reinstalls the owning controller listener');
assert.equal(ctrl._cubeNode.active, true);
// Cocos Editor may hide the picking MeshRenderer without calling onHide.
ctrl._cubeNode.active = false;
ctrl._cubeNodeMR.enabled = false;
gizmo.refreshHandles();
assert.equal(ctrl._cubeNode.active, true, 'Hidden picking cube is restored on refresh');
assert.equal(ctrl._cubeNodeMR.enabled, true, 'Marker MeshRenderer is re-enabled');
ctrl._cubeNode.active = false;
gizmo.onShow();
assert.equal(ctrl._cubeNode.active, true, 'Repeated show restores the native marker');

gizmo.hide(); // Cocos may hide a Gizmo directly on a Scene selection event.
assert.equal(gizmo.isHandleVisible(), false);
adapter.refresh([component], selected, 1600);
assert.equal(gizmo.isHandleVisible(), true, 'Refresh restores a Gizmo hidden by native Editor selection');
assert.equal(adapter.status().active, 1);
// Native Editor may replace component.gizmo on the same Component.
const previousGizmo = component.gizmo;
const replacement = new componentPool.typeDefs.ProbePosition();
replacement.target = component;
replacement.init();
component.gizmo = replacement;
adapter.refresh([component], new Set(), 1601);
adapter.refresh([component], selected, 1602);
assert.equal(adapter.status().active, 1);
assert.equal(component.gizmo, replacement);
assert.equal(replacement.isHandleVisible(), true,
    'Adapter adopts replacement native Gizmo instance after Scene selection');
const restoredListeners = ctrl.registerCount;
adapter.refresh([component], selected, 1616);
assert.equal(ctrl.registerCount, restoredListeners,
    'Healthy frames must not duplicate listeners after selection recovery');
adapter.refresh([component], new Set(), 1632);
assert.equal(adapter.status().active, 0, 'Immediate deselection hides the picking Gizmo');
adapter.refresh([component], selected, 1648);
assert.equal(adapter.status().active, 1, 'Repeated quick selection cycles must work');
adapter.refresh([component], new Set(), 1664);
assert.equal(adapter.status().active, 0);
assert.ok(adapter.status().input.controllerDown >= 4,
    'Diagnostics count real controller entry points');
assert.ok(adapter.status().input.controllerMove >= 4,
    'Diagnostics count actual controller movement');
const missingBefore = adapter.status().input.missingPointer;
gizmo.onShow();
ctrl.onMouseDown({ handleName: 'position:target:single' });
assert.equal(adapter.status().input.missingPointer, missingBefore + 1,
    'Missing Cocos pointer coordinates are explicitly diagnosed');
gizmo.onHide();
// Creator can destroy the native instance when selection becomes empty.
// The same Node must get a fresh Controller when selected again.
adapter.refresh([component], selected, 1700);
const destroyedHandle = component.gizmo;
destroyedHandle.onDestroy();
assert.equal(destroyedHandle.isHandleDisposed(), true);
adapter.refresh([component], new Set(), 1710);
adapter.refresh([component], selected, 1720);
assert.notEqual(component.gizmo, destroyedHandle,
    'Empty -> same-node reentry recreates a native Gizmo destroyed by the Editor');
assert.equal(component.gizmo.isHandleVisible(), true);
assert.ok(component.gizmo.controllers[0]._cubeNode.active,
    'Fresh picking marker is active after complete deselection');
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
assert.ok(hudGizmo.controllers.every(c => c._cubeNode.scale?.x > 0),
    'Both position and HUD markers must avoid unsafe BoxController sizing');
for (const control of hudGizmo.controllers.slice(1)) {
    assert.ok(control._cubeNode.scale.x <= 14.01,
        'HUD picking cubes should be about 14px, not 140px');
    assert.ok(control._cubeNode.scale.x < 22,
        'A picking cube must not overlap the next 22px HUD row');
}
for (let i = 2; i < hudGizmo.controllers.length; i++) {
    const before = hudGizmo.controllers[i - 1].position.y;
    const after = hudGizmo.controllers[i].position.y;
    assert.ok(Math.abs(before - after) >= 22 - 1e-6,
        'HUD picking marker centers must occupy distinct screen rows');
}
const toggle = hudGizmo.controllers[1];
const checkbox = hudGizmo.controllers[2];
const slider = hudGizmo.controllers[3];
const button = hudGizmo.controllers[4];

// Cocos can replace the Scene camera during a 2D/3D switch.
const originalCamera = sandbox.cce.Camera._camera.camera;
const initialHide = button.hideCount;
const initialUnregister = button.unregisterCount;
sandbox.cce.Camera._camera.camera = null;
hudGizmo.refreshHandles();
hudGizmo.refreshHandles();
assert.equal(button.hideCount, initialHide,
    'Missing camera must not call unsafe native BoxController.hide()');
assert.equal(button._cubeNode.active, false,
    'Missing camera disables picking volume without resetting private handle colors');
assert.equal(button.unregisterCount, initialUnregister + 1,
    'Camera loss unregisters its picking listener');
const initialRegister = button.registerCount;
sandbox.cce.Camera._camera.camera = originalCamera;
hudGizmo.refreshHandles();
assert.equal(button.registerCount, initialRegister + 1,
    'Restored camera registers HUD picking listener again');
assert.equal(button._cubeNode.active, true,
    'Restored camera reactivates the picking marker');
hudGizmo.refreshHandles();
assert.equal(button.registerCount, initialRegister + 1,
    'Repeated frames never duplicate listeners');

assert.equal(hudAdapter.status().input.controllerDown, 0,
    'Input statistics are isolated per Scene adapter instance');

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
checkbox.onMouseUp();
assert.equal(component.visible, false, 'Mouse up from another controller cannot trigger toggle');
assert.equal(hudAdapter.status().pendingClicks, 1);
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
toggle.onMouseUp();
assert.equal(hudAdapter.status().draggingSlider, 1,
    'An unrelated controller up must not end slider drag');
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
checkbox.onMouseUp();
assert.equal(buttonClicks, 0, 'Different HUD controller cannot activate a pending button');
button.onMouseUp();
assert.equal(buttonClicks, 1);
assert.equal(hudAdapter.status().input.controllerDown > 0, true,
    'HUD click dispatch is visible in diagnostics');
button.onMouseDown({ handleName: 'hud:reset', x: 10, y: 10 });
hudGizmo.onKeyDown({ key: 'Escape' });
assert.equal(buttonClicks, 1, 'Cancelled button click is not dispatched');
button.onMouseDown({ handleName: 'hud:reset', x: 10, y: 10 });
hudGizmo.onNotGizmoMouseUp();
assert.equal(buttonClicks, 1, 'Releasing outside the handle must not click a button');
hudGizmo.onGizmoMouseDown({ detail: { handleName: 'hud:reset' } });
hudGizmo.onGizmoMouseUp({ handleName: 'hud:grid' });
assert.equal(buttonClicks, 1,
    'Releasing Scene operation over a different control must cancel the button');
hudGizmo.onGizmoMouseDown({ detail: { handleName: 'hud:reset' } });
hudGizmo.onGizmoMouseUp({ detail: { handleName: 'hud:reset' } });
assert.equal(buttonClicks, 2, 'Named operation-level up commits a matching button exactly once');
assert.equal(hudAdapter.status().input.gizmoDown, 2);
assert.ok(hudAdapter.status().input.ignoredUp >= 3,
    'Cross-control releases are visible to diagnostics');
assert.ok(hudAdapter.status().input.committedClick >= 2);
assert.ok(hudAdapter.status().input.cancelledClick >= 1);
slider.onMouseDown({ handleName: 'hud:radius', x: 30, y: 10 });
slider.onMouseMove({ handleName: 'hud:radius', x: 42, y: 10 });
hudGizmo.onNotGizmoMouseUp();
assert.equal(component.radius, 80, 'Releasing a slider outside its handle commits the drag');
assert.ok(hudEvents.includes('radius:end:80'));
slider.onMouseDown({ handleName: 'hud:radius', x: 30, y: 10 });
slider.onMouseMove({ handleName: 'hud:radius', x: 50, y: 10 });
hudGizmo.onNotGizmoMouseDown();
assert.equal(component.radius, 80, 'Clicking outside cancels unfinished slider drag');


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
// Two components on the same Node must receive different HUD picking rows.
const { GizmoHudLayout } = hudLayout.exports;
const sharedLayout = new GizmoHudLayout();
function makeHudOwner(name) {
    return {
        __classname__: 'ProbePosition',
        constructor: { name: 'ProbePosition' },
        node, isValid: true, enabled: true, flag: false,
        onGizmoHud() { return [{ id: 'title', text: name }]; },
        onGizmoHudControls() {
            return [{ type: 'checkbox', id: 'flag', text: 'Flag', property: 'flag' }];
        },
    };
}
const ownerA = makeHudOwner('A');
const ownerB = makeHudOwner('B');
sharedLayout.beginFrame([ownerA, ownerB], () => true);
const multiAdapter = sandbox.exports.createPositionHandleAdapter(() => true, sharedLayout);
multiAdapter.refresh([ownerA, ownerB], selected, 3100);
assert.equal(multiAdapter.status().active, 2,
    'Two components on the same selected Node get independent controllers');
assert.equal(multiAdapter.status().hudControls, 2);
const markerA = ownerA.gizmo.controllers[0];
const markerB = ownerB.gizmo.controllers[0];
assert.equal(markerA.position.y, 2, 'First HUD control is after first text row');
assert.equal(markerB.position.y, -64,
    'Second HUD control is after previous component and a spacer row');
assert.ok(markerA.position.y - markerB.position.y >= 44,
    'Picking hitboxes for separate components must not overlap');

markerB.onMouseDown({ handleName: 'hud:flag', x: 10, y: -64 });
markerB.onMouseUp();
assert.equal(ownerA.flag, false);
assert.equal(ownerB.flag, true, 'HUD action changes only its owning component');

sharedLayout.beginFrame([ownerA, ownerB], comp => comp === ownerB);
multiAdapter.refresh([ownerA, ownerB], selected, 3400);
assert.equal(multiAdapter.status().hudControls, 1,
    'Hidden component HUD does not retain its picking controller');
assert.equal(multiAdapter.status().active, 1,
    'HUD-only components with invisible HUD do not keep active Gizmo instances');
assert.equal(ownerB.gizmo.controllers[0].position.y, 2,
    'Remaining HUD moves to the first row when preceding HUD is hidden');
multiAdapter.dispose();

console.log('[hud-adapter] toggle/checkbox clicks, slider drag and cancel, button dispatch and cleanup OK');

console.log('[position-adapter] selected handle, XY dragging, undo hooks, Escape and cleanup OK');
