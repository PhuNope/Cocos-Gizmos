import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiled = name => ts.transpileModule(
    readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS } },
).outputText;
const evaluate = (name, imports = {}) => {
    const sandbox = { exports: {}, require(id) {
        if (id in imports) return imports[id];
        throw new Error('Unknown import ' + name + ':' + id);
    } };
    vm.runInNewContext(compiled(name), sandbox);
    return sandbox.exports;
};
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static transformMat4(out, value) {
        Object.assign(out, value);
        return out;
    }
}
class Quat {}
class Color {
    static fromHEX(out, hex) { out.hex = hex; }
    set() {}
}
Color.BLACK = new Color();
class Node {
    constructor(name = 'node') {
        this.name = name;
        this.children = [];
        this.isValid = true;
        this.active = true;
        this.hideFlags = 0;
    }
    addChild(node) { node.parent = this; this.children.push(node); }
    addComponent(Type) { const value = new Type(); value.node = this; return value; }
    setWorldPosition(value) { this.worldPosition = value; }
    setWorldRotation(value) { this.worldRotation = value; }
    setWorldScale(value) { this.worldScale = value; }
    destroy() { this.isValid = false; }
}
class MeshRenderer {
    constructor() { this.isValid = true; }
    setMaterial(value) { this.material = value; }
}
class Material {
    initialize(value) { this.options = value; }
    setProperty(name, value) { this[name] = value; }
    destroy() { this.destroyed = true; }
}
let beforeDraw = null;
const director = {
    on(name, callback) { assert.equal(name, 'before-draw'); beforeDraw = callback; },
    off() { beforeDraw = null; },
};
const meshInstances = [];
const cc = {
    CCObject: { Flags: { DontSave: 1, HideInHierarchy: 2 } },
    Color, Vec3, Quat, Node, Material, MeshRenderer, Mesh: class Mesh {},
    gfx: { CullMode: { NONE: 0 } },
    RenderRoot2D: class RenderRoot2D {},
    Layers: { Enum: { GIZMOS: 4, UI_2D: 16 } },
    director, Director: { EVENT_BEFORE_DRAW: 'before-draw' },
    utils: { createMesh(geometry) {
        const mesh = { geometry, destroy() { this.destroyed = true; } };
        meshInstances.push(mesh);
        return mesh;
    } },
    Component: class Component {},
};
const solver = evaluate('PositionDragSolver');
const edit = evaluate('GizmoEditSession');
const controls = evaluate('GizmoHudControls');
const presentation = { normalizeHudItems(value) { return value; } };
const layoutModule = evaluate('GizmoHudLayout', {
    './GizmoHudControls': controls, './GizmoPresentation': presentation,
});
const projection = evaluate('GizmoHudProjection', {
    cc, './PositionDragSolver': solver,
});
const cameraBridge = evaluate('SceneCameraBridge');
const input = evaluate('SceneGizmoInput');
class Base {
    constructor() { this.controllers = []; }
    createController() {
        const cube = new Node('box-cube');
        cube.setScale = () => {};
        this._controller = {
            _cubeNode: cube,
            _cubeNodeMR: { enabled: true, isValid: true },
            _editHandlesShape: { active: true },
            _wireFrameBoxNode: { active: true },
            _wireFrameBoxMeshRenderer: { enabled: true },
            shape: new Node('shape'),
            setColor() {}, setOpacity() {}, setPosition(value) { this.position = value; },
            setRotation() {}, initHandle(node, key) { this.hitTarget = node; this.key = key; },
            registerEvents() {}, unregisterEvents() {},
            show() {}, hide() {}, removeHandle() {},
        };
        this.controllers.push(this._controller);
    }
    show() { this.onShow?.(); }
    hide() { this.onHide?.(); }
}
const pool = { typeDefs: { 'cc.BoxCollider': Base } };
const gizmoRootNode = new Node('GizmoRoot');
let zoom = 1;
const rendererCamera = {
    width: 900, height: 500, geometryRenderer: {},
    node: { forward: new Vec3(0, 0, -1), worldRotation: new Quat() },
    worldToScreen(out, point) { Object.assign(out, point); },
    screenPointToRay(out, x, y) {
        out.o = new Vec3(x * zoom, y * zoom, 100);
        out.d = new Vec3(0, 0, -1);
        return out;
    },
    update() {},
};
const manager = {
    gizmoRootNode,
    _gizmoPool: { _getPool() { return pool; } },
    showComponentGizmo(component) { return component.gizmo; },
    createGizmo(key, component) {
        assert.ok(pool.typeDefs[key]);
        const gizmo = new pool.typeDefs[key]();
        gizmo.target = component;
        gizmo.init();
        component.gizmo = gizmo;
        return gizmo;
    },
};
const sandbox = {
    exports: {},
    cce: { Camera: { _camera: { camera: rendererCamera } }, Gizmo: manager },
    console: { warn(...args) { throw new Error(args.join(' ')); } },
    require(id) {
        const imports = {
            cc, './Gizmos2D': { Gizmos2D: {} },
            './Gizmos3D': { Gizmos3D: {} },
            './PositionDragSolver': solver, './GizmoEditSession': edit,
            './GizmoHudControls': controls, './GizmoHudProjection': projection,
            './GizmoPresentation': presentation, './GizmoHudLayout': layoutModule,
            './SceneCameraBridge': cameraBridge, './SceneGizmoInput': input,
        };
        if (id in imports) return imports[id];
        throw new Error('Unexpected ' + id);
    },
};
vm.runInNewContext(compiled('PositionHandles'), sandbox);
const { createPositionHandleAdapter } = sandbox.exports;
const selectedNode = new Node('selected');
selectedNode.uuid = 'hud-selected-node';
selectedNode.activeInHierarchy = true;
selectedNode.worldPosition = new Vec3(0, 0, 0);
const component = {
    __classname__: 'HudProbe',
    constructor: { name: 'HudProbe' },
    isValid: true, enabled: true, node: selectedNode,
    visible: true,
    onGizmoHandles() { return []; },
    onGizmoHud() { return [{ id: 'title', text: 'HUD panel', color: '#ffffff' }]; },
    onGizmoHudControls() {
        return [{ type: 'toggle', id: 'visible', text: 'Visible',
            property: 'visible', color: '#ffffff' }];
    },
};
const { GizmoHudLayout } = layoutModule;
const layout = new GizmoHudLayout();
layout.beginFrame([component], () => true);
const adapter = createPositionHandleAdapter(() => true, layout);
adapter.refresh([component], new Set([selectedNode.uuid]), 1000);
assert.equal(adapter.status().active, 1);
const gizmo = component.gizmo;
const controller = gizmo.controllers[0];
assert.ok(controller.hitTarget instanceof Node);
assert.notEqual(controller.hitTarget, controller._cubeNode,
    'The HUD handle must register a real camera-facing quad, never a box collider cube');
assert.equal(controller.hitTarget.name, 'CocosGizmosHudHit');
const rect = controls.hudControlScreenRect({ width: 900, height: 500 }, 1, 2);
assert.equal(controller.hitTarget.worldPosition.x, (rect.left + rect.right) * 0.5);
assert.equal(controller.hitTarget.worldPosition.y, (rect.bottom + rect.top) * 0.5);
assert.equal(controller.hitTarget.worldPosition.z, 99);
assert.equal(controller.hitTarget.worldScale.x, rect.width);
assert.equal(controller.hitTarget.worldScale.y, rect.height);
assert.equal(controller._cubeNode.active, false, 'The old BoxController cube stays invisible');
const mesh = controller.hitTarget.getComponent ? null : controller.hitTarget;
assert.ok(meshInstances.length >= 1, 'The HUD picker registers mesh geometry');
assert.ok(beforeDraw, 'Picking is reprojected before each Scene draw');
zoom = 2;
beforeDraw();
assert.equal(controller.hitTarget.worldPosition.x, (rect.left + rect.right));
assert.equal(controller.hitTarget.worldScale.x, rect.width * 2,
    'Wheel scroll moves and scales picking quad with the HUD');
assert.equal(meshInstances.length, 1,
    'Picker mesh is immutable during scroll, so it does not stutter');
controller.onMouseDown({ handleName: 'hud:visible', x: 80, y: 30 });
assert.equal(component.visible, true);
controller.onMouseUp({ handleName: 'hud:visible', x: 80, y: 30 });
assert.equal(component.visible, false, 'Clicking the HUD quad toggles component property');
adapter.clear();
assert.equal(controller.hitTarget.active, false, 'Deselecting hides HUD raycast plane');
adapter.dispose();
console.log('[hud-picking-plane] exact native HUD quad geometry, zoom and click OK');
