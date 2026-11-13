import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = name => ts.transpileModule(
    readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS } },
).outputText;
const controls = { exports: {} };
vm.runInNewContext(compile('GizmoHudControls'), controls);

class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
}
class Quat {}
class Node {
    constructor(name) {
        this.name = name;
        this.children = [];
        this.layer = 0;
        this.hideFlags = 0;
        this.components = [];
        this.active = true;
        this.isValid = true;
    }
    addChild(child) { this.children.push(child); child.parent = this; }
    addComponent(Type) {
        const comp = new Type();
        comp.node = this;
        this.components.push(comp);
        if (Type === Sorting) this.sorting = comp;
        return comp;
    }
    getComponent(Type) {
        return this.components.find(comp => comp instanceof Type) || null;
    }
    setWorldPosition(value) { this.position = value; }
    setWorldRotation(value) { this.rotation = value; }
    setWorldScale(value) { this.scale = value; }
    destroy() { this.isValid = false; }
}
class MeshRenderer {
    constructor() { this.isValid = true; }
    setMaterial(material) { this.material = material; }
}
class Sorting { constructor() { this.sortingOrder = 0; } }
class RenderRoot2D {}
class Sprite {
    constructor() { this.spriteFrame = null; }
}
class SpriteFrame {
    constructor() { this.texture = null; }
    destroy() { this.destroyed = true; }
}
class UITransform {
    setAnchorPoint(x, y) { this.anchor = [x, y]; }
    setContentSize(w, h) { this.size = [w, h]; }
}
class Material {
    initialize(value) { this.options = value; }
    setProperty(key, value) { this[key] = value; }
    destroy() { this.destroyed = true; }
}
class ImageAsset {
    constructor(image) { this.canvas = image; }
    destroy() { this.destroyed = true; }
}
class Texture2D {
    destroy() { this.destroyed = true; }
}
const rootGizmo = new Node('gizmoRoot');
const meshes = [], drawCalls = [], directorEvents = [];
let beforeDrawHook = null;
const document = {
    createElement(type) {
        assert.equal(type, 'canvas');
        return {
            width: 0, height: 0,
            getContext() {
                return {
                    clearRect() {}, fillRect(...args) { drawCalls.push(['rect', ...args]); },
                    fillText(...args) { drawCalls.push(['text', ...args]); },
                };
            },
        };
    },
};
const camera = {
    node: { forward: new Vec3(0, 0, -1), worldRotation: new Quat() },
    viewport: { width: 960, height: 560 },
    pixelWorld: 1,
    screenPointToRay(x, y, out) {
        out.o = new Vec3(x * this.pixelWorld / 100,
            y * this.pixelWorld / 100, 0);
        out.d = new Vec3(0, 0, -1);
        return out;
    },
};
const sandbox = {
    exports: {}, document,
    cce: { Gizmo: { gizmoRootNode: rootGizmo } },
    console: { warn(message) { throw new Error(message); } },
    require(name) {
        if (name === 'cc') return {
            CCObject: { Flags: { DontSave: 1, HideInHierarchy: 2 } },
            Color: class Color {},
            Component: class Component {},
            director: {
                on(event, listener) { directorEvents.push(['on', event]); beforeDrawHook = listener; },
                off(event) { directorEvents.push(['off', event]); },
                getScene() { return rootGizmo; },
            },
            Director: { EVENT_BEFORE_DRAW: 'before-draw' },
            gfx: { CullMode: { NONE: 0 } },
            ImageAsset, Layers: { Enum: { GIZMOS: 4, UI_2D: 8 } },
            Material, Mesh: class Mesh {}, MeshRenderer, Node, Quat, Sorting,
            RenderRoot2D, Sprite, SpriteFrame, UITransform,
            Texture2D,
            utils: { createMesh(geometry) {
                const mesh = { geometry, destroy() { this.destroyed = true; } };
                meshes.push(mesh);
                return mesh;
            } },
            Vec2: class Vec2 {}, Vec3,
        };
        if (name === './Gizmos3D') return { Gizmos3D: {} };
        if (name === './Gizmos2D') return { Gizmos2D: {} };
        if (name === './GizmoHudControls') return controls.exports;
        if (name === './GizmoHudProjection') return {};
        if (name === './GizmoPresentation') return {};
        if (name === './SceneCameraBridge') return {
            resolveSceneCamera() { return { camera }; },
        };
        throw new Error('Unsupported import ' + name);
    },
};
vm.runInNewContext(compile('GizmoHudOverlay'), sandbox);
const { GizmoHudOverlay } = sandbox.exports;
const overlay = new GizmoHudOverlay();
const node = { isValid: true, worldPosition: new Vec3() };
const component = { node, radius: 40 };
overlay.beginFrame();
assert.equal(overlay.render(component, [
    { id: 'text:title', text: 'Gizmos2D Test',
      color: '#ffcc00', fontSize: 16 },
    { id: 'control:radius', text: 'Radius: 40',
      color: '#ffffff', fontSize: 14 },
], {
    namespace: 'selected',
    startRow: 0,
    textCount: 1,
    controls: [{ type: 'slider', id: 'radius', text: 'Radius',
        property: 'radius', min: 0, max: 100, color: '#ffffff' }],
}), 2);
overlay.finishFrame(2);
assert.equal(overlay.isScreenHudActive, true);
assert.equal(rootGizmo.children.length, 1,
    'Screen HUD belongs to the editor Gizmo root, not Canvas/node');
assert.equal(rootGizmo.children[0].layer, 4);
assert.equal(rootGizmo.children[0].children[0].layer, 4);
const sceneHudRoot = rootGizmo.children[0];
const uiNode = sceneHudRoot.children.find(node => node.name === 'CocosGizmosHudUIRoot');
assert.ok(uiNode, 'HUD has its own late-rendered UI_3D RenderRoot2D');
const topSprite = uiNode.children[0].getComponent(Sprite);
assert.ok(topSprite?.spriteFrame?.texture,
    'The textured HUD draws as a UI Sprite above other Scene sprites');
assert.equal(sceneHudRoot.children[0].getComponent(MeshRenderer).enabled, false,
    'Mesh fallback must not double-render under a working UI Sprite');

assert.ok(drawCalls.some(call => call[0] === 'rect' && call[3] > 1000),
    'Canvas HUD draws a full-width dark bar at retina scale');
assert.ok(drawCalls.some(call => call[0] === 'text' && call[1] === 'Gizmos2D Test'));
assert.ok(drawCalls.some(call => call[0] === 'text' && call[1] === 'Radius'),
    'Slider is painted with a proper track and numeric value');
assert.equal(meshes.length, 1);
assert.equal(rootGizmo.children[0].children[0].sorting?.sortingOrder, 32767,
    'HUD receives the highest gizmo sorting order');
assert.equal(meshes[0].geometry.positions.length, 12);
assert.deepEqual(Array.from(meshes[0].geometry.indices), [0, 3, 1, 3, 2, 1]);
// Navigation changes should update only the unit quad transform, not
// destroy/recreate a GPU mesh on every mouse-wheel tick.
camera.node.worldRotation = { x: 0, y: 0, z: 0, w: 1 };
overlay.beginFrame();
overlay.render(component, [
    { id: 'text:title', text: 'Gizmos2D Test', color: '#ffcc00', fontSize: 16 },
    { id: 'control:radius', text: 'Radius: 40', color: '#ffffff', fontSize: 14 },
], { namespace: 'selected', startRow: 0, textCount: 1,
    controls: [{ type: 'slider', id: 'radius', text: 'Radius',
        property: 'radius', min: 0, max: 100, color: '#ffffff' }] });
overlay.finishFrame(2);
const transformed = rootGizmo.children[0].children[0];
const unitQuadMeshCount = meshes.length;
const initialWidth = transformed.scale.x;
camera.pixelWorld = 2;
beforeDrawHook?.();
assert.equal(meshes.length, unitQuadMeshCount,
    'Wheel zoom never reallocates HUD meshes');
assert.ok(Math.abs(transformed.scale.x - initialWidth * 2) < 1e-8,
    'HUD geometry follows Scene camera zoom in the same frame');
camera.pixelWorld = 1;
const texBefore = drawCalls.length;
overlay.beginFrame();
overlay.render(component, [{ id: 'text:title', text: 'Gizmos2D Test',
    color: '#ffcc00', fontSize: 16 },
{ id: 'control:radius', text: 'Radius: 40', color: '#ffffff', fontSize: 14 }],
{ namespace: 'selected', startRow: 0, textCount: 1,
    controls: [{ type: 'slider', id: 'radius', text: 'Radius',
        property: 'radius', min: 0, max: 100, color: '#ffffff' }] });
overlay.finishFrame(2);
assert.equal(drawCalls.length, texBefore, 'Identical HUD frames reuse the same texture');
overlay.beginFrame();
overlay.finishFrame(0);
assert.equal(rootGizmo.children[0].active, false,
    'Deselecting every node hides the bottom HUD');
overlay.dispose();
assert.equal(rootGizmo.children[0].isValid, false);
assert.ok(directorEvents.some(([kind]) => kind === 'off'));
console.log('[screen-hud-mesh] full width textured HUD, slider, reuse and hide OK');
