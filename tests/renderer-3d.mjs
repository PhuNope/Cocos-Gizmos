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
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static transformMat4(out, point, matrix) {
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
const calls = { lines: [], triangles: [] };
const geometryRenderer = {
    addLine(a, b, color, depth) {
        calls.lines.push({ a: { ...a }, b: { ...b }, color, depth });
    },
    addTriangle(...args) { calls.triangles.push(args); },
};

const cc = {
    _decorator: { ccclass: () => value => value, executeInEditMode: value => value },
    Camera: class Camera {},
    CCObject: { Flags: { DontSave: 1, HideInHierarchy: 2 } },
    Color, Component, Node, Vec3, Label, Sprite, RenderRoot2D,
    Layers: { Enum: { GIZMOS: 4 } },
    director: { getScene: () => null },
    toRadian: number => number * Math.PI / 180,
    Mat4: class Mat4 {},
    Quat: class Quat {},
    gfx: { Format: {}, AttributeName: {} },
};
const sceneCamera = {
    node: new Node('camera'),
    geometryRenderer,
    initGeometryRenderer() {},
};
const sandbox = {
    exports: {},
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
debug.lateUpdate(0);
assert.equal(label.string, '');
assert.equal(sprite.spriteFrame, null);
const labelAfterClear = label.stringWrites;
const spriteAfterClear = sprite.frameWrites;
debug.lateUpdate(0);
assert.equal(label.stringWrites, labelAfterClear, 'Idle overlay must not repeatedly clear text');
assert.equal(sprite.frameWrites, spriteAfterClear, 'Idle overlay must not repeatedly clear sprite');

console.log('[renderer-3d] 200 primitives, one color snapshot, transformed local points, stable overlay state OK');
