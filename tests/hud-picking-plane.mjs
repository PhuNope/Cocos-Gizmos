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
    set(x, y, z) {
        Object.assign(this, { x, y, z });
        return this;
    }
}
class Quat {}
class Color {
    constructor(r = 255, g = 255, b = 255, a = 255) {
        Object.assign(this, { r, g, b, a });
    }
    static fromHEX(out, hex) { out.hex = hex; }
    set(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); }
    clone() { return new Color(this.r, this.g, this.b, this.a); }
}
Color.BLACK = new Color();
class Node {
    constructor(name = 'node') {
        this.name = name;
        this.children = [];
        this.isValid = true;
        this.active = true;
        this.hideFlags = 0;
        this.components = [];
        this.listeners = new Map();
    }
    on(name, callback) {
        const list = this.listeners.get(name) || [];
        list.push(callback);
        this.listeners.set(name, list);
    }
    emit(name, event) {
        for (const callback of this.listeners.get(name) || []) callback(event);
    }
    addChild(node) { node.parent = this; this.children.push(node); }
    addComponent(Type) {
        const value = new Type();
        value.node = this;
        this.components.push(value);
        return value;
    }
    getComponent(Type) { return this.components.find(c => c instanceof Type) || null; }
    setWorldPosition(value) { this.worldPosition = value; }
    setWorldRotation(value) { this.worldRotation = value; }
    setWorldScale(value) { this.worldScale = value; }
    inverseTransformPoint(out, value) {
        Object.assign(out, value);
        return out;
    }
    destroy() { this.isValid = false; }
}
class MeshRenderer {
    constructor() { this.isValid = true; this.enabled = true; }
    setMaterial(value) { this.material = value; }
}
Node.EventType = {
    MOUSE_DOWN: 'mouse-down', MOUSE_MOVE: 'mouse-move', MOUSE_UP: 'mouse-up',
    TOUCH_START: 'touch-start', TOUCH_MOVE: 'touch-move', TOUCH_END: 'touch-end',
};
class RenderRoot2D {}
class Sprite {
    constructor() { this.isValid = true; this.spriteFrame = null; }
}
Sprite.SizeMode = { CUSTOM: 2 };
class ImageAsset {
    constructor(canvas) { this.canvas = canvas; }
    destroy() { this.destroyed = true; }
}
class Texture2D {
    destroy() { this.destroyed = true; }
}
class SpriteFrame {
    destroy() { this.destroyed = true; }
}
class UITransform {
    setAnchorPoint(x, y) { this.anchor = [x, y]; }
    setContentSize(w, h) { this.size = [w, h]; }
}
class Material {
    initialize(value) { this.options = value; }
    setProperty(name, value) { this[name] = value; }
    destroy() { this.destroyed = true; }
}
let beforeDraw = null;
const twoDDraws = [];
const globalInput = {
    listeners: new Map(),
    on(type, callback, owner) {
        const entries = this.listeners.get(type) || [];
        entries.push({ callback, owner });
        this.listeners.set(type, entries);
    },
    off(type, callback, owner) {
        const entries = this.listeners.get(type) || [];
        this.listeners.set(type, entries.filter(item =>
            item.callback !== callback || item.owner !== owner));
    },
    emit(type, event) {
        for (const item of [...(this.listeners.get(type) || [])]) item.callback(event);
    },
    count(type) { return (this.listeners.get(type) || []).length; },
};
const MouseTypes = { MOUSE_DOWN: 'mouse-down', MOUSE_MOVE: 'mouse-move',
    MOUSE_UP: 'mouse-up' };
const director = {
    on(name, callback) { assert.equal(name, 'before-draw'); beforeDraw = callback; },
    off() { beforeDraw = null; },
};
const meshInstances = [];
const uiDrawCalls = [];
const document = {
    listeners: new Map(),
    addEventListener(type, callback) {
        const list = this.listeners.get(type) || [];
        list.push(callback);
        this.listeners.set(type, list);
    },
    removeEventListener(type, callback) {
        this.listeners.set(type, (this.listeners.get(type) || [])
            .filter(item => item !== callback));
    },
    emit(type, event) {
        for (const callback of [...(this.listeners.get(type) || [])])
            callback(event);
    },
    querySelector(name) { return name === 'canvas' ? this.sceneCanvas : null; },
    sceneCanvas: {
        tagName: 'CANVAS',
        getBoundingClientRect() {
            return { left: 0, top: 0, width: 900, height: 500,
                bottom: 500, right: 900 };
        },
    },
    createElement(name) {
        assert.equal(name, 'canvas');
        return {
            width: 0, height: 0,
            getContext() {
                return {
                    clearRect() {},
                    beginPath() {}, arc() {}, fill() {}, stroke() {},
                    moveTo() {}, lineTo() {},
                };
            },
        };
    },
};
const cc = {
    CCObject: { Flags: { DontSave: 1, HideInHierarchy: 2 } },
    Color, Vec3, Quat, Node, Material, MeshRenderer, Mesh: class Mesh {},
    ImageAsset, Sprite, SpriteFrame, Texture2D, UITransform,
    input: globalInput, Input: { EventType: MouseTypes },
    gfx: { CullMode: { NONE: 0 } },
    RenderRoot2D,
    Layers: { Enum: { GIZMOS: 4, UI_2D: 16, UI_3D: 32 } },
    director, Director: { EVENT_BEFORE_DRAW: 'before-draw' },
    utils: { createMesh(geometry) {
        const mesh = { geometry, destroy() { this.destroyed = true; } };
        meshInstances.push(mesh);
        return mesh;
    } },
    Component: class Component {},
};
const solver = evaluate('PositionDragSolver');
const planes = evaluate('PlaneHandleGeometry');
const axes = evaluate('AxisHandleGeometry');
const hit = evaluate('MoveHitGeometry');
const scale = evaluate('MoveScreenScale');
const strokes = evaluate('MoveStrokeGeometry');
const rotationGeometry = evaluate('RotationHandleGeometry');
const rotationSolver = evaluate('RotationDragSolver', {
    './RotationHandleGeometry': rotationGeometry,
});
const edit = evaluate('GizmoEditSession');
const commands = evaluate('GizmoMoveCommand', {
    './GizmoEditSession': edit, './PositionDragSolver': solver,
});
const rotationCommands = evaluate('GizmoRotateCommand', {
    './GizmoEditSession': edit,
    './RotationHandleGeometry': rotationGeometry,
    './RotationDragSolver': rotationSolver,
    './GizmoMoveCommand': commands,
});
const appearance = evaluate('GizmoHudStyle');
const controls = evaluate('GizmoHudControls', { './GizmoHudStyle': appearance });
const presentation = { normalizeHudItems(value) { return value; } };
const layoutModule = evaluate('GizmoHudLayout', {
    './GizmoHudControls': controls, './GizmoPresentation': presentation,
});
const projection = evaluate('GizmoHudProjection', {
    cc, './PositionDragSolver': solver,
});
const cameraBridge = evaluate('SceneCameraBridge');
const input = evaluate('SceneGizmoInput');
let immediateSceneRepaints = 0;
class Base {
    constructor() { this.controllers = []; }
    createController() {
        const cube = new Node('box-cube');
        cube.setScale = () => {};
        this._controller = {
            _cubeNode: cube,
            _cubeNodeMR: { enabled: true, isValid: true },
            _editHandlesShape: {
                active: false,
                children: [{ name: 'x', active: false }, { name: 'y', active: false }],
            },
            editInitCount: 0, editShowCount: 0,
            initEditHandles() { this.editInitCount++; },
            showEditHandles() { this.editShowCount++; },
            setEditHandlesColor() {},
            setHandleColor(name, color, opacity) { this.hitFace = { name, opacity }; },
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
    document,
    cce: { Camera: { _camera: { camera: rendererCamera } }, Gizmo: manager },
    console: { warn(...args) { throw new Error(args.join(' ')); } },
    require(id) {
        const imports = {
            cc, './Gizmos2D': { Gizmos2D: {
                DEFAULT_COLOR: {}, DEFAULT_LAYER: 4,
                beginLayer() {}, beginLocalPosition() {}, endLocalPosition() {},
                beginColor() {}, flushEditorFrame() {},
                drawSolidEllipse(...args) { twoDDraws.push(args); },
                drawSolidPolygon(...args) { twoDDraws.push(args); },
            } },
            './Gizmos3D': { Gizmos3D: {
                DEFAULT_COLOR: {}, setDepTest() {}, getDepTest() { return true; }, beginColor() {},
                drawSphere() {}, drawLine() {}, drawQuad() {},
                drawPositionLabel() {},
            } },
            './PositionDragSolver': solver,
            './PlaneHandleGeometry': planes, './AxisHandleGeometry': axes,
            './MoveHitGeometry': hit,
            './MoveScreenScale': scale, './MoveStrokeGeometry': strokes,
            './ExecuteGizmos': { tickOnce() { immediateSceneRepaints++; } },
            './GizmoMoveCommand': commands,
            './RotationHandleGeometry': rotationGeometry,
            './GizmoRotateCommand': rotationCommands,
            './GizmoEditSession': edit,
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
// The Scene operation may consume native picking before Controller.onMouseDown.
// The fallback uses the exact same visual rect, not an approximate cube.
const clickX = (rect.left + rect.right) * 0.5;
const clickY = (rect.bottom + rect.top) * 0.5;
gizmo.onNotGizmoMouseDown({ x: clickX, y: clickY });
gizmo.onNotGizmoMouseUp({ x: clickX, y: clickY });
assert.equal(component.visible, true,
    'HUD is still interactive if native Gizmo Controller misses the click');
gizmo.onNotGizmoMouseDown({ x: clickX, y: clickY });
gizmo.onNotGizmoMouseUp({ x: clickX, y: 260 });
assert.equal(component.visible, true,
    'Releasing a HUD button outside its screen rectangle cancels it');
adapter.clear();
assert.equal(controller.hitTarget.active, false, 'Deselecting hides HUD raycast plane');
adapter.dispose();

// Regression: Editor 3.8.8 may hide its private BoxController cube after
// selection changes. The independent colored disc must remain visible and
// draggable in both Scene 3D and Canvas 2D, using the same mouse callbacks.
zoom = 1;
const dragNode = new Node('Drag3DNode');
dragNode.uuid = 'drag-node-3d';
dragNode.activeInHierarchy = true;
dragNode.worldMatrix = {};
dragNode.worldPosition = new Vec3();
const dragComponent = {
    __classname__: 'HudProbe',
    constructor: { name: 'HudProbe' },
    node: dragNode, isValid: true, enabled: true,
    handlePosition: new Vec3(100, 100, 0),
    onGizmoHandles() {
        return [{ property: 'handlePosition', plane: 'xy',
            space: 'local', color: '#ffcc00' }];
    },
};
const dragAdapter = createPositionHandleAdapter(() => true);
dragAdapter.refresh([dragComponent], new Set([dragNode.uuid]), 2000);
assert.equal(dragAdapter.status().active, 1);
assert.equal(dragAdapter.status().positionHandles, 1);
const dragGizmo = dragComponent.gizmo;
const dragController = dragGizmo.controllers[0];
const positionDisc = gizmoRootNode.children.find(node =>
    node.name === 'CocosGizmosPositionPoint' && node.active);
assert.ok(positionDisc, '3D selected drag point has its own visible mesh');
const dragSprite3D = positionDisc.children[0]?.children[0]?.getComponent(Sprite);
assert.ok(dragSprite3D?.spriteFrame,
    '3D drag point must be visible through the same Sprite UI pipeline as HUD');
assert.ok(dragSprite3D.node.listeners.get('mouse-down')?.length,
    'Marker Sprite must register actual Cocos Node mouse input');
assert.equal(document.listeners.get('pointerdown')?.length || 0, 0,
    'Native Scene drag does not install browser DOM listeners');
assert.equal(globalInput.count(MouseTypes.MOUSE_DOWN), 0,
    'Native Scene drag does not install Game View mouse listeners');
assert.equal(dragController._editHandlesShape.active, true);
assert.equal(dragController._editHandlesShape.children[1].active, true);
assert.equal(dragController._editHandlesShape.children[0].active, false);
assert.equal(dragController.hitFace?.name, 'y');
assert.equal(dragController.hitFace?.opacity, 0);
assert.equal(dragSprite3D.node.active, true);
assert.equal(positionDisc.getComponent(MeshRenderer).enabled, false,
    'Mesh-only drag point is disabled when the UI sprite is available');
assert.equal(positionDisc.worldPosition.x, 100);
assert.equal(positionDisc.worldPosition.y, 100);
assert.ok(positionDisc.worldScale.x > 0);
assert.equal(dragController._cubeNode.active, true,
    'Native drag hit cube is re-activated separately from the point mesh');
// Creator Gizmo Kit works by dispatching the BoxController editable +Y
// proxy through GizmoOperation. Exercise that same native path end-to-end.
dragController.onControllerMouseDown({
    handleName: 'y', getLocation() { return { x: 100, y: 100 }; },
});
assert.equal(dragGizmo.diagnosticState().draggingPosition, true,
    'Native +Y face acquires a position drag');
dragGizmo.onNotGizmoMouseDown({ x: 100, y: 100 });
assert.equal(dragGizmo.diagnosticState().draggingPosition, true,
    'Duplicate outside-down must not cause begin -> cancel');
dragGizmo.onNotGizmoMouseMove({ x: 121, y: 114 });
dragGizmo.onNotGizmoMouseUp();
assert.equal(dragComponent.handlePosition.x, 121);
assert.equal(dragComponent.handlePosition.y, 114);
assert.equal(dragGizmo.diagnosticState().draggingPosition, false);
assert.equal(dragController.editInitCount, 1,
    'Native edit face is not recreated during an active drag');

dragAdapter.refresh([dragComponent], new Set(), 2100);
assert.equal(dragController._editHandlesShape.active, false,
    'Deselecting disables native +Y face without leaking event listeners');
assert.equal(positionDisc.active, false,
    'Deselecting hides only the visible disc without destroying its mesh');
dragAdapter.refresh([dragComponent], new Set([dragNode.uuid]), 2110);
assert.equal(dragController._editHandlesShape.active, true,
    'Reselect immediately restores native BoxController face');
assert.equal(dragController.editInitCount, 1,
    'Reselect keeps the native face mesh rather than rebuilding it');
assert.equal(positionDisc.active, true,
    'Selected -> empty -> same node immediately restores visible drag disc');
dragAdapter.dispose();

const canvas = new Node('TestCanvas');
canvas.getComponent = Type => Type === cc.RenderRoot2D ? {} : null;
const dragNode2D = new Node('Drag2DNode');
dragNode2D.uuid = 'drag-node-2d';
dragNode2D.activeInHierarchy = true;
dragNode2D.parent = canvas;
dragNode2D.worldMatrix = {};
dragNode2D.worldPosition = new Vec3();
const drag2D = {
    ...dragComponent, node: dragNode2D,
    handlePosition: new Vec3(50, 60, 0),
};
const dragAdapter2D = createPositionHandleAdapter(() => true);
dragAdapter2D.refresh([drag2D], new Set([dragNode2D.uuid]), 3000);
const visual2D = gizmoRootNode.children.find(node =>
    node.name === 'CocosGizmosPositionPoint' && node.active);
assert.ok(visual2D, 'Canvas 2D selected point also owns a scene-visible disc');
const dragSprite2D = visual2D.children[0]?.children[0]?.getComponent(Sprite);
assert.ok(dragSprite2D?.spriteFrame,
    '2D drag point must use a UI Sprite, just like the working Scene HUD');
assert.equal(dragSprite2D.node.active, true);
assert.ok(twoDDraws.length >= 2, 'Canvas 2D fallback still draws Graphics markers');
assert.ok(dragSprite2D.node.listeners.get('mouse-down')?.length,
    'Canvas drag Sprite also receives native UI mouse input');
const controller2D = drag2D.gizmo.controllers[0];
assert.equal(controller2D._editHandlesShape.children[1].active, true,
    'Canvas 2D also keeps native editable +Y face for Scene picking');
controller2D.onControllerMouseDown({
    handleName: 'y', getUILocation() { return { x: 50, y: 60 }; },
});
assert.equal(drag2D.gizmo.diagnosticState().draggingPosition, true,
    'Native 2D +Y face begins a position edit');
drag2D.gizmo.onNotGizmoMouseDown({ x: 50, y: 60 });
assert.equal(drag2D.gizmo.diagnosticState().draggingPosition, true,
    '2D begin event is not cancelled by an outside-down notification');
drag2D.gizmo.onNotGizmoMouseMove({ x: 75, y: 70 });
drag2D.gizmo.onNotGizmoMouseUp();

assert.equal(drag2D.handlePosition.x, 75);
assert.equal(drag2D.handlePosition.y, 70);
dragAdapter2D.dispose();

// Realistic Move Gizmo integration: unlike the legacy +Y edit face, each
// arrow, plane tile and body box registers its own invisible MeshRenderer
// surface with Creator's native GizmoOperation. Screen picking can still
// choose a plane in preference to an overlapping arrow/box.
const moveNode = new Node('Move3DNode');
moveNode.uuid = 'move-3d-selected';
moveNode.activeInHierarchy = true;
moveNode.worldMatrix = {};
moveNode.worldPosition = new Vec3();
const moveComponent = {
    __classname__: 'MoveProbe',
    constructor: { name: 'MoveProbe' },
    isValid: true, enabled: true, node: moveNode,
    moveObject: new Vec3(100, 100, 0),
    onGizmoHandles() {
        const base = { property: 'moveObject', space: 'local',
            pickSize: 28, snap: 1 };
        return [
            { ...base, id: 'axis-x', visual: 'axis', axis: 'x',
                plane: 'view', axisSize: 78 },
            { ...base, id: 'plane-xy', visual: 'plane', plane: 'xy',
                planeSize: 24, planeOffset: 25 },
            { ...base, id: 'body', visual: 'box', plane: 'view',
                boxSize: 0.7 },
        ];
    },
};
const moveAdapter = createPositionHandleAdapter(() => true);
moveAdapter.refresh([moveComponent], new Set([moveNode.uuid]), 4000);
const moveGizmo = moveComponent.gizmo;
assert.equal(moveGizmo.controllers.length, 3);
const [arrowControl, planeControl, boxControl] = moveGizmo.controllers;
for (const controller of moveGizmo.controllers) {
    assert.equal(controller._cubeNode.active, false,
        'No native plus/cube visuals for Move Gizmo');
    assert.equal(controller._editHandlesShape.active, false,
        'No native +Y face that used to draw a colored + marker');
    assert.ok(controller.hitTarget?.name === 'CocosGizmosMoveHit',
        'Creator registers transparent mesh rather than an unrelated cube');
    assert.equal(controller.hitTarget.active, true);
    assert.ok(controller.hitTarget.getComponent(MeshRenderer)?.mesh,
        'Actual transparent pick geometry has a mesh for raycast');
    assert.ok(controller.hitTarget.worldScale?.x > 0 &&
        controller.hitTarget.worldScale?.y > 0);
}
assert.ok(arrowControl.hitTarget.worldScale.x >
    arrowControl.hitTarget.worldScale.y,
    'Native arrow picker covers the entire shaft, not a tiny center point');
assert.ok(planeControl.hitTarget.worldScale.x > 0 &&
    planeControl.hitTarget.worldScale.y > 0,
    'Native plane picker covers the projected square');

// Hover + wheel regression: native invisible hit quads already follow the
// camera in BEFORE_DRAW; now visible Move geometry must update in the same
// frame even when there is no drag/BEFORE_UPDATE from the Editor.
assert.ok(beforeDraw, 'Native Move Gizmo registered its BEFORE_DRAW callback');
const redrawCamera = rendererCamera.worldToScreen;
let visibleZoom = 1;
rendererCamera.worldToScreen = (out, point) => {
    out.set(point.x * visibleZoom, point.y * visibleZoom, point.z);
};
try {
    const cameraFrame = beforeDraw;
    cameraFrame(); // establish the initial projected-camera fingerprint
    arrowControl.onControllerHoverIn({});
    const hoveredFrames = immediateSceneRepaints;
    assert.equal(moveGizmo.diagnosticState().draggingPosition, false,
        'Pointer hovering over Move must not begin a drag');
    visibleZoom = 2;
    cameraFrame(); // wheel changed the camera; engine frame may be skipped
    assert.equal(immediateSceneRepaints, hoveredFrames + 1,
        'Hover + wheel repaints the Move arrows in this same BEFORE_DRAW frame');
    cameraFrame();
    assert.equal(immediateSceneRepaints, hoveredFrames + 1,
        'Unchanged camera never redraws Move on every BEFORE_DRAW');
    visibleZoom = 0.6;
    cameraFrame();
    assert.equal(immediateSceneRepaints, hoveredFrames + 1,
        'Multiple wheel events in one rendering interval are coalesced');
    // The most recent wheel position is submitted on the next paint slot,
    // rather than adding redundant 3D triangles in the same engine frame.
    await new Promise(resolve => setTimeout(resolve, 35));
    cameraFrame();
    assert.equal(immediateSceneRepaints, hoveredFrames + 2,
        'Reverse wheel zoom repaints after the 30ms coalescing interval');
} finally {
    rendererCamera.worldToScreen = redrawCamera;
}

const click = (controller, x, y) => controller.onControllerMouseDown({
    button: 0, handleName: controller.key, x, y,
});
const move = (controller, x, y) =>
    controller.onControllerMouseMove({ button: 0, x, y });
const release = controller => controller.onControllerMouseUp({ button: 0 });
// A click anywhere on the arrow shaft locks X, not just the head or middle.
click(arrowControl, 147, 100);
assert.equal(moveGizmo.diagnosticState().draggingPosition, true,
    'Arrow shaft acquires a native dragging session');
const repaintCountAtDrag = immediateSceneRepaints;
const oldWheelProjection = rendererCamera.worldToScreen;
let dragWheelZoom = 1;
rendererCamera.worldToScreen = (out, point) =>
    out.set(point.x * dragWheelZoom, point.y * dragWheelZoom, point.z);
try {
    beforeDraw();
    dragWheelZoom = 2;
    beforeDraw();
    dragWheelZoom = 0.5;
    beforeDraw();
    assert.equal(immediateSceneRepaints, repaintCountAtDrag,
        'Drag + scroll never requests a redundant full-scene redraw');
    assert.equal(moveGizmo.diagnosticState().draggingPosition, true);
} finally {
    rendererCamera.worldToScreen = oldWheelProjection;
}
move(arrowControl, 162, 113);
release(arrowControl);
const repaintAfterMouseUp = immediateSceneRepaints;
const oldAfterMouseUp = rendererCamera.worldToScreen;
rendererCamera.worldToScreen = (out, point) =>
    out.set(point.x * 1.75, point.y * 1.75, point.z);
try {
    await new Promise(resolve => setTimeout(resolve, 35));
    beforeDraw();
    assert.equal(immediateSceneRepaints, repaintAfterMouseUp + 1,
        'Wheel hover redraw resumes after drag release and the frame budget');
} finally {
    rendererCamera.worldToScreen = oldAfterMouseUp;
}
assert.deepEqual([moveComponent.moveObject.x, moveComponent.moveObject.y,
    moveComponent.moveObject.z], [115, 100, 0],
    'Dragging arrow affects its axis only');
moveComponent.moveObject = new Vec3(100, 100, 0);
moveGizmo.refreshHandles();
// Native overlapping rectangles can route to the arrow/controller, but the
// exact inner plane polygon must select XY instead of the nearby X arrow.
click(arrowControl, 125, 125);
assert.equal(moveGizmo.drag?.entry?.field.plane, 'xy',
    'Projected plane interior takes priority over overlapping native arrow');
move(arrowControl, 135, 132);
release(arrowControl);
assert.deepEqual([moveComponent.moveObject.x, moveComponent.moveObject.y,
    moveComponent.moveObject.z], [110, 107, 0],
    'Plane interior drags X/Y while preserving Z');
moveComponent.moveObject = new Vec3(100, 100, 0);
moveGizmo.refreshHandles();
// The selectable orange wireframe has its own view-plane command; a large
// arrow pick radius must not consume the dead zone at its origin.
click(boxControl, 100, 100);
assert.equal(moveGizmo.drag?.entry?.field.visual, 'box',
    'Clicking object box selects free-view body drag, not an axis');
move(boxControl, 106, 108);
release(boxControl);
assert.deepEqual([moveComponent.moveObject.x, moveComponent.moveObject.y,
    moveComponent.moveObject.z], [106, 108, 0]);
moveAdapter.refresh([moveComponent], new Set(), 4500);
assert.equal(arrowControl.hitTarget.active, false,
    'Deselecting disables all transparent arrow/plane/box surfaces');
assert.equal(planeControl.hitTarget.active, false);
assert.equal(boxControl.hitTarget.active, false);
moveAdapter.refresh([moveComponent], new Set([moveNode.uuid]), 4550);
assert.equal(arrowControl.hitTarget.active, true,
    'Reselecting restores exact native hit targets without rebuilding them');
moveAdapter.dispose();
assert.equal(arrowControl.hitTarget.isValid, false,
    'Switching scenes destroys old native Move picking nodes');
console.log('[move-picking-native] full arrow, polygon plane, object box, lifecycle and no plus glyph OK');

// Rotation gizmo native integration: its transparent picking mesh is an
// annulus, not a square, and the same named handle owns the Undo/Redo gesture.
const rotateNode = new Node('Rotate3DNode');
rotateNode.uuid='rotate-selected';
rotateNode.activeInHierarchy=true;
rotateNode.worldMatrix={};
rotateNode.worldPosition=new Vec3(100,100,0);
const rotateEvents=[];
const rotateComponent={
    __classname__:'RotationProbe',constructor:{name:'RotationProbe'},
    isValid:true,enabled:true,node:rotateNode,
    rotationEuler:new Vec3(0,0,0),
    onGizmoChanged(name,phase){rotateEvents.push(name+':'+phase);},
    onGizmoHandles(){return [
        ...['x','y','z'].map(axis=>({
            property:'rotationEuler',visual:'rotation',
            axis,id:'rotation-'+axis,plane:'view',
            space:'world',ringSize:70,pickSize:14,
            color: axis==='x'?'#ff595e':axis==='y'?'#43df66':'#4b8fff',
        })),
    ]},
};
const rotationAdapter=createPositionHandleAdapter(()=>true);
rotationAdapter.refresh([rotateComponent],new Set([rotateNode.uuid]),5800);
const rotateGizmo=rotateComponent.gizmo;
assert.equal(rotateGizmo.controllers.length,3,
    '3D Rotate creates exactly three native X/Y/Z controllers');
const [rotX,rotY,rotZ]=rotateGizmo.controllers;
for(const ctrl of rotateGizmo.controllers){
    assert.equal(ctrl.hitTarget.name,'CocosGizmosRotationHit');
    assert.ok(ctrl.hitTarget.getComponent(MeshRenderer)?.mesh);
    const verts=ctrl.hitTarget.getComponent(MeshRenderer).mesh.geometry.positions;
    assert.ok(verts.length>100,'Rotation pick surface is a segmented annulus');
    assert.equal(ctrl._cubeNode.active,false,'No native point box over rotation');
}
assert.ok(Math.abs(rotZ.hitTarget.worldScale.x-70)<1e-6,
    'Rotation ring radius maintains constant Scene pixel size');
rotateGizmo.onNotGizmoMouseDown({button:0,x:100,y:100});
assert.equal(rotateGizmo.diagnosticState().draggingPosition,false,
    'Empty center of a rotation gizmo never starts a gesture');
click(rotZ,170,100);
assert.equal(rotateGizmo.diagnosticState().draggingPosition,true,
    'Native Z annulus starts a rotation drag');
move(rotZ,100,170);
assert.ok(Math.abs(rotateComponent.rotationEuler.z-90)<1e-4,
    'Z ring drag updates Euler degrees by the signed angle, actual: ' +
    JSON.stringify(rotateComponent.rotationEuler) + '; events: ' + JSON.stringify(rotateEvents) +
    '; drag: ' + String(rotateGizmo.diagnosticState().draggingPosition));
release(rotZ);
assert.equal(rotateGizmo.diagnosticState().draggingPosition,false);
assert.ok(rotateEvents.includes('rotationEuler:begin'));
assert.ok(rotateEvents.includes('rotationEuler:update'));
assert.ok(rotateEvents.includes('rotationEuler:end'));

// Reset Euler and ensure an edge-on X ring (view forward -Z) is draggable.
rotateComponent.rotationEuler=new Vec3(0,0,0);
rotateGizmo.refreshHandles();
click(rotX,100,145);
assert.equal(rotateGizmo.diagnosticState().draggingPosition,true,
    'Edge-on X ring starts via screen-space fallback');
move(rotX,100,190);
assert.ok(Math.abs(rotateComponent.rotationEuler.x)>5,
    'Edge-on X ring responds to vertical pointer movement');
rotateGizmo.onKeyDown({key:'Escape'});
assert.deepEqual([
    rotateComponent.rotationEuler.x,rotateComponent.rotationEuler.y,
    rotateComponent.rotationEuler.z],[0,0,0],
    'Escape restores original Euler angles');
rotationAdapter.refresh([rotateComponent],new Set(),6000);
assert.equal(rotZ.hitTarget.active,false,'Deselection hides rotation ring picking');
rotationAdapter.refresh([rotateComponent],new Set([rotateNode.uuid]),6100);
assert.equal(rotZ.hitTarget.active,true,'Reselection restores annulus');
rotationAdapter.dispose();
assert.equal(rotX.hitTarget.isValid,false,
    'Scene cleanup destroys rotation picking meshes');
console.log('[rotate-picking-native] three annuli, 90° drag, edge-on X, cancel, reselect OK');

console.log('[position-visual] 2D/3D marker Sprite + native +Y BoxController drag proxy OK');
console.log('[hud-picking-plane] exact native HUD quad geometry, zoom and click OK');
