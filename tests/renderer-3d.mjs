import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'source/Gizmos3D.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
        target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
    },
}).outputText;

class Color {
    static clones = 0;
    constructor(r = 255, g = 255, b = 255, a = 255) {
        Object.assign(this, { r, g, b, a });
    }
    clone() {
        Color.clones++;
        return new Color(this.r, this.g, this.b, this.a);
    }
}
Color.BLUE = new Color(0, 0, 255);
Color.WHITE = new Color();
class Vec3 {
    static transforms = 0;
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static transformMat4(out, point, matrix) {
        Vec3.transforms++;
        out.x = point.x * matrix.scale.x + matrix.position.x;
        out.y = point.y * matrix.scale.y + matrix.position.y;
        out.z = point.z * matrix.scale.z + matrix.position.z;
        return out;
    }
}
Vec3.ZERO = new Vec3();
Vec3.ONE = new Vec3(1, 1, 1);

class Node {
    constructor(name = 'node') {
        this.name = name;
        this.children = [];
        this.components = [];
        this.worldPosition = new Vec3(50, 10, -3);
        this.worldMatrix = { scale: new Vec3(2, 3, 4), position: this.worldPosition };
        this.eulerAngles = new Vec3(0, 0, 15);
        this.isValid = true;
        this.layer = 0;
        this.hideFlags = 0;
        this.componentLookups = 0;
    }
    addComponent(Type) {
        const component = new Type();
        component.node = this;
        this.components.push(component);
        component.onLoad?.();
        return component;
    }
    getComponentInChildren(Type) {
        this.componentLookups++;
        for (const node of [this, ...this.children]) {
            const found = node.components.find(c => c instanceof Type);
            if (found) return found;
        }
        return null;
    }
    setParent(node) { this.parent = node; }
    set parent(node) {
        this._parent = node;
        if (node) node.children.push(this);
    }
    get parent() { return this._parent; }
    setScale(...args) { this.scale = args; }
    setWorldScale(...args) { this.worldScaleSet = args; }
    setWorldRotation(rotation) { this.worldRotationSet = rotation; }
    setPosition(v) { this.position = v; }
    setWorldPosition(v) { this.worldPositionSet = v; }
    setRotationFromEuler(v) { this.rotationSet = v; }
}
class Component {}
class Label {
    constructor() {
        this._string = '';
        this.stringWrites = 0;
        this.fontSize = 40;
        this.lineHeight = 40;
    }
    get string() { return this._string; }
    set string(value) { this._string = value; this.stringWrites++; }
}
class Sprite {
    constructor() { this._frame = null; this.frameWrites = 0; }
    get spriteFrame() { return this._frame; }
    set spriteFrame(value) { this._frame = value; this.frameWrites++; }
}
class RenderRoot2D {}
const calls = { lines: [], dashed: [], triangles: [] };
const geometryRenderer = {
    addLine(a, b, color, depth) {
        calls.lines.push({ a: { ...a }, b: { ...b }, color, depth });
    },
    addDashedLine(a, b, color, depth) {
        calls.dashed.push({ a: { ...a }, b: { ...b }, color, depth });
    },
    addTriangle(...args) { calls.triangles.push(args); },
};

const cc = {
    _decorator: { ccclass: () => value => value, executeInEditMode: value => value },
    Camera: class Camera {},
    CCObject: { Flags: { DontSave: 1, HideInHierarchy: 2 } },
    Color, Component, Node, Vec3, Label, Sprite, RenderRoot2D,
    Layers: { Enum: { GIZMOS: 4, UI_3D: 8, UI_2D: 16 } },
    director: { getScene: () => null },
    toRadian: number => number * Math.PI / 180,
    Mat4: class Mat4 {
        static fromRTS(out, quat, position, scale) { out.position = position; out.scale = scale; }
        static multiply(out, left, right) { Object.assign(out, right); }
    },
    Quat: class Quat { static fromEuler() {} },
    gfx: { Format: {}, AttributeName: {} },
};
const sceneCamera = {
    node: Object.assign(new Node('camera'), {
        worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        forward: new Vec3(0, 0, -1),
    }),
    pixelWorld: 1,
    geometryRenderer,
    initGeometryRenderer() {},
    worldToScreen(out, world) {
        out.x = world.x / this.pixelWorld;
        out.y = world.y / this.pixelWorld;
        out.z = 1;
        return out;
    },
    screenPointToRay(out, x, y) {
        out.o = new Vec3(x * this.pixelWorld, y * this.pixelWorld, 100);
        out.d = new Vec3(0, 0, -1);
        return out;
    },
};
let now = 1000;
const sandbox = {
    exports: {},
    Date: class extends Date { static now() { return now; } },
    require: mod => {
        if (mod === 'cc') return cc;
        if (mod === './Define') return { cce: { Camera: { _camera: { camera: sceneCamera } } } };
        throw new Error('Unexpected module ' + mod);
    },
    console: { log() {}, warn: msg => { throw new Error(String(msg)); }, error() {} },
    cce: { Camera: { _camera: { camera: sceneCamera } } },
};
vm.runInNewContext(compiled, sandbox, { filename: 'Gizmos3D.js' });
const { Gizmos3D } = sandbox.exports;
const node = new Node('owner');
const color = new Color(4, 5, 6, 80);

Gizmos3D.beginColor(node, color);
for (let i = 0; i < 200; i++) {
    Gizmos3D.drawLine(node, new Vec3(i, 0, 0), new Vec3(i, 1, 0));
}
assert.equal(node.componentLookups, 1, 'Repeated 3D draw calls reuse debug component');
assert.equal(Color.clones, 1, 'Changing the color makes one snapshot, not one per primitive');
assert.equal(calls.lines.length, 200);
assert.ok(calls.lines.every(call => call.color === calls.lines[0].color));
assert.equal(calls.lines[0].color.a, 80);
Gizmos3D.drawDashLineList(node, [
    new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(1, 1, 0),
], true);
assert.equal(calls.dashed.length, 3, 'Closed dash polyline must draw three dashed segments');
assert.equal(calls.lines.length, 200, 'drawDashLineList must not call the solid line renderer');
Gizmos3D.drawDashLine(node, new Vec3(0, 0, 0), new Vec3(1, 1, 0));
assert.equal(calls.dashed.length, 4);
color.a = 200;
assert.equal(calls.lines[0].color.a, 80, 'User mutations must not change the current draw state');

Gizmos3D.beginLocalPosition(node);
Gizmos3D.drawLine(node, new Vec3(1, 2, 3), new Vec3(2, 3, 4));
const last = calls.lines.at(-1);
assert.deepEqual(last.a, { x: 52, y: 16, z: 9 });
assert.deepEqual(last.b, { x: 54, y: 19, z: 13 });

const debug = node.children[0].components[0];
const frame = { id: 17 };
Gizmos3D.drawLabel(node, 'title', 'Range', new Vec3(1, 1, 0), 20, 0.5);
Gizmos3D.drawSprite(node, 'icon', frame, new Vec3(0, 0, 0), { x: 1, y: 1 });
const label = debug._labelMap.get('title');
const sprite = debug._spriteMap.get('icon');
assert.equal(debug._root2D.layer, 12, '3D-space UI root uses camera-visible UI_3D instead of UI_2D');
assert.equal(label.node.layer, 12, '3D labels must be on UI_3D layer');
assert.equal(sprite.node.layer, 12, '3D sprites must be on UI_3D layer');
assert.deepEqual(label.node.worldScaleSet, [0.5, 0.5, 1],
    'Label size must be specified in world space, not multiplied by parent node scale');
assert.deepEqual(sprite.node.worldScaleSet, [1, 1, 1],
    'Sprite size must be independent of the root Node transform');
assert.equal(label.node.worldRotationSet, sceneCamera.node.worldRotation,
    'Billboard should use the camera world rotation');
assert.equal(sprite.node.worldRotationSet, sceneCamera.node.worldRotation);
assert.equal(label.string, 'Range');
assert.equal(sprite.spriteFrame, frame);
const labelWrites = label.stringWrites;
const spriteWrites = sprite.frameWrites;
debug.lateUpdate(0);
Gizmos3D.drawLabel(node, 'title', 'Range', new Vec3(1, 1, 0), 20, 0.5);
Gizmos3D.drawSprite(node, 'icon', frame, new Vec3(0, 0, 0), { x: 1, y: 1 });
debug.lateUpdate(0);
assert.equal(label.stringWrites, labelWrites, 'Static text must not be reset and rewritten each frame');
assert.equal(sprite.frameWrites, spriteWrites, 'Static sprite must not be reset each frame');
now += 300;
debug.lateUpdate(0);
assert.equal(label.string, 'Range',
    'HUD labels survive the 250ms idle/watchdog interval');
assert.equal(sprite.spriteFrame, frame,
    '3D sprites also survive the 250ms idle/watchdog interval');
now += 451;
debug.lateUpdate(0);
assert.equal(label.string, '', 'Labels expire after 750ms without a draw');
assert.equal(sprite.spriteFrame, null, 'Sprites expire after 750ms without a draw');
const labelAfterClear = label.stringWrites;
const spriteAfterClear = sprite.frameWrites;
debug.lateUpdate(0);
assert.equal(label.stringWrites, labelAfterClear, 'Idle overlay must not repeatedly clear text');
assert.equal(sprite.frameWrites, spriteAfterClear, 'Idle overlay must not repeatedly clear sprite');

sceneCamera.pixelWorld = 0.001; // zoom close, native label would be enormous
Gizmos3D.drawLabel(node, 'bounded', 'Bounded zoom', new Vec3(0, 0, 0),
    20, 0.5, 12, 24);
const bounded = debug._labelMap.get('bounded');
assert.ok(Math.abs(bounded.node.worldScaleSet[0] - 0.0012) < 1e-9,
    'Close zoom clamps 3D label to maximum 24 on-screen pixels');
sceneCamera.pixelWorld = 20; // zoom far, native label would be microscopic
Gizmos3D.drawLabel(node, 'bounded', 'Bounded zoom', new Vec3(0, 0, 0),
    20, 0.5, 12, 24);
assert.ok(Math.abs(bounded.node.worldScaleSet[0] - 12) < 1e-7,
    'Far zoom scales 3D label up to minimum 12 on-screen pixels');
sceneCamera.pixelWorld = 1;
// The public component Camera uses worldToScreen(world,out) and
// screenPointToRay(x,y,out), unlike its private renderer camera.
const directCamera = {
    node: sceneCamera.node,
    pixelWorld: 0.01,
    worldToScreen(world, out) {
        out.x = world.x / this.pixelWorld;
        out.y = world.y / this.pixelWorld;
        out.z = 1;
    },
    screenPointToRay(x, y, out) {
        out.o = new Vec3(x * this.pixelWorld, y * this.pixelWorld, 100);
        out.d = new Vec3(0, 0, -1);
        return out;
    },
};
sandbox.cce.Camera.camera = directCamera;
Gizmos3D.drawLabel(node, 'bounded', 'Active camera',
    new Vec3(0, 0, 0), 20, 0.5, 12, 24);
assert.ok(Math.abs(bounded.node.worldScaleSet[0] - 0.012) < 1e-8,
    '3D bounds use the public Scene Camera instead of a stale renderer camera');
delete sandbox.cce.Camera.camera;

const vertices = [
    new Vec3(0, 0, 0), new Vec3(1, 0, 0),
    new Vec3(1, 1, 0), new Vec3(0, 1, 0),
];
Vec3.transforms = 0;
Gizmos3D.drawMesh(
    node,
    { vertices, indices: [0, 1, 2, 0, 2, 3] },
    new Vec3(10, 20, 30),
    Vec3.ZERO,
    Vec3.ONE,
    false,
);
assert.equal(calls.triangles.length, 2);
assert.equal(Vec3.transforms, 4, 'Each unique indexed vertex must be transformed once');
assert.deepEqual({ ...calls.triangles[0][0] }, { x: 10, y: 20, z: 30 });
assert.deepEqual({ ...calls.triangles[1][2] }, { x: 10, y: 21, z: 30 });

console.log('[renderer-3d] primitive state, local transforms, stable overlays and indexed mesh reuse OK');
