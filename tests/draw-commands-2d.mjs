import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(filename, sandbox) {
    const source = readFileSync(path.join(root, 'source', filename + '.ts'), 'utf8');
    const code = ts.transpileModule(source, {
        fileName: filename + '.ts',
        compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    }).outputText;
    vm.runInNewContext(code, sandbox, { filename: filename + '.js' });
    return sandbox.exports;
}

const commandSandbox = { exports: {} };
const { DrawCommandBuffer2D } = load('DrawCommandBuffer2D', commandSandbox);
class Sink {
    constructor() { this.calls = []; }
    moveTo(...args) { this.calls.push(['moveTo', ...args]); }
    lineTo(...args) { this.calls.push(['lineTo', ...args]); }
    bezierCurveTo(...args) { this.calls.push(['bezierCurveTo', ...args]); }
    quadraticCurveTo(...args) { this.calls.push(['quadraticCurveTo', ...args]); }
    circle(...args) { this.calls.push(['circle', ...args]); }
    ellipse(...args) { this.calls.push(['ellipse', ...args]); }
    rect(...args) { this.calls.push(['rect', ...args]); }
    arc(...args) { this.calls.push(['arc', ...args]); }
    close() { this.calls.push(['close']); }
    stroke() { this.calls.push(['stroke']); }
    fill() { this.calls.push(['fill']); }
}
const count = (sink, name) => sink.calls.filter((entry) => entry[0] === name).length;

const buffer = new DrawCommandBuffer2D();
const sink = new Sink();
for (let i = 0; i < 100; i++) {
    buffer.moveTo(i, 0);
    buffer.lineTo(i + 1, 1);
    buffer.stroke();
}
for (let i = 0; i < 64; i++) {
    buffer.circle(i, i, 10);
    buffer.stroke();
}
assert.equal(buffer.isEmpty, false);
buffer.replay(sink);
assert.equal(count(sink, 'moveTo'), 100);
assert.equal(count(sink, 'lineTo'), 100);
assert.equal(count(sink, 'circle'), 64);
assert.equal(count(sink, 'stroke'), 1, '164 stroke paths must emit one stroke batch');
assert.equal(buffer.isEmpty, true);
assert.equal(buffer.operationCount, 0);
const emptyCalls = sink.calls.length;
buffer.replay(sink);
assert.equal(sink.calls.length, emptyCalls, 'Empty frames must not redraw old commands');

buffer.moveTo(0, 0);
buffer.lineTo(1, 1);
buffer.stroke();
buffer.circle(0, 0, 10);
buffer.fill();
buffer.moveTo(2, 2);
buffer.lineTo(3, 3);
buffer.stroke();
buffer.circle(3, 3, 4);
buffer.fill();
const mixed = new Sink();
buffer.replay(mixed);
assert.equal(count(mixed, 'stroke'), 2, 'A fill must flush earlier stroke commands');
assert.equal(count(mixed, 'fill'), 2, 'Fill geometry is submitted independently');
assert.deepEqual(mixed.calls.filter((entry) => entry[0] === 'stroke' || entry[0] === 'fill'), [
    ['stroke'], ['fill'], ['stroke'], ['fill'],
]);

buffer.arc(10, 12, 5, 0, Math.PI, true);
buffer.stroke();
const arcSink = new Sink();
buffer.replay(arcSink);
assert.equal(count(arcSink, 'arc'), 1);
assert.equal(arcSink.calls.find((call) => call[0] === 'arc')[6], true);

class Color {
    constructor(r, g, b, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a; }
    clone() { return new Color(this.r, this.g, this.b, this.a); }
}
Color.BLUE = new Color(0, 0, 255);
Color.WHITE = new Color(255, 255, 255);
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}
Vec3.ZERO = new Vec3();
class Node {
    constructor(name) {
        this.name = name;
        this.children = [];
        this.components = [];
        this.layer = 0;
        this.hideFlags = 0;
        this.componentSearches = 0;
    }
    set parent(parent) {
        this._parent = parent;
        if (parent) parent.children.push(this);
    }
    get parent() { return this._parent; }
    addComponent(Type) {
        const component = new Type();
        component.node = this;
        this.components.push(component);
        return component;
    }
    getComponentInChildren(Type) {
        this.componentSearches++;
        for (const node of [this, ...this.children]) {
            const candidate = node.components.find((component) => component instanceof Type);
            if (candidate) return candidate;
        }
        return null;
    }
    setPosition() {}
    setScale(...args) { this.scale = args; }
    setWorldPosition(pos) { this.worldPosition = pos; }
    inverseTransformPoint(out, point) {
        out.x = point.x - 10;
        out.y = point.y - 20;
        out.z = point.z || 0;
    }
}
class Component {}
class Label { constructor() { this.string = ''; } }
class Sprite { constructor() { this.spriteFrame = null; } }
class Graphics extends Sink {
    constructor() { super(); this.clearCount = 0; }
    clear() { this.clearCount++; }
}
const cc = {
    _decorator: { ccclass: () => (target) => target, executeInEditMode: (target) => target },
    CCObject: { Flags: { DontSave: 1, HideInHierarchy: 2 } },
    Color, Component, Graphics, Node, Vec3, Label, Sprite,
    Vec2: { ONE: { x: 1, y: 1 } },
    Layers: { Enum: { GIZMOS: 4, DEFAULT: 1 } },
    toRadian: (degrees) => degrees * Math.PI / 180,
};
let now = 1000;
const moduleSandbox = {
    exports: {},
    Date: class extends Date { static now() { return now; } },
    require(name) {
        if (name === 'cc') return cc;
        if (name === './DrawCommandBuffer2D') return { DrawCommandBuffer2D };
        throw new Error('Unexpected import ' + name);
    },
};
const { Gizmos2D } = load('Gizmos2D', moduleSandbox);
const rootNode = new Node('root');

for (let i = 0; i < 100; i++) {
    Gizmos2D.drawLine(rootNode, { x: i + 10, y: 20 }, { x: i + 11, y: 21 });
}
for (let i = 0; i < 64; i++) {
    Gizmos2D.drawCircle(rootNode, { x: 20, y: 30 }, 25);
}
const debug = rootNode.children[0].components[0];
debug.lateUpdate(0);
let graphics = rootNode.children[0].children.map((n) => n.components[0]);
assert.equal(graphics.length, 1, 'Same RGBA and layer must share a Graphics component');
assert.equal(count(graphics[0], 'stroke'), 1);
assert.equal(count(graphics[0], 'lineTo'), 100);
assert.equal(count(graphics[0], 'circle'), 64);
assert.equal(rootNode.componentSearches, 1, 'Debug component lookup must be cached per Node');

const originalClearCount = graphics[0].clearCount;
const originalStrokeCount = count(graphics[0], 'stroke');
for (let i = 0; i < 100; i++) {
    Gizmos2D.drawLine(rootNode, { x: i + 10, y: 20 }, { x: i + 11, y: 21 });
}
for (let i = 0; i < 64; i++) {
    Gizmos2D.drawCircle(rootNode, { x: 20, y: 30 }, 25);
}
debug.lateUpdate(0);
assert.equal(graphics[0].clearCount, originalClearCount, 'Identical frames must retain geometry');
assert.equal(count(graphics[0], 'stroke'), originalStrokeCount, 'Identical frames must not submit geometry');
assert.equal(rootNode.componentSearches, 1, 'Repeated draw calls must reuse the cached component');

assert.deepEqual(graphics[0].calls.find((c) => c[0] === 'lineTo'), ['lineTo', 1, 1],
    'World line endpoint must use the second point');

Gizmos2D.beginLocalPosition(rootNode);
Gizmos2D.drawLine(rootNode, { x: 1, y: 2 }, { x: 8, y: 9 });
debug.lateUpdate(0);
assert.deepEqual(graphics[0].calls.slice(-3).slice(0, 2), [['moveTo', 1, 2], ['lineTo', 8, 9]],
    'Local-space endpoints must remain distinct');

const transparent = new Color(255, 0, 0, 80);
const opaque = new Color(255, 0, 0, 255);
Gizmos2D.beginColor(rootNode, transparent);
Gizmos2D.drawLine(rootNode, { x: 10, y: 20 }, { x: 12, y: 22 });
Gizmos2D.beginColor(rootNode, opaque);
Gizmos2D.drawLine(rootNode, { x: 10, y: 20 }, { x: 13, y: 23 });
Gizmos2D.beginLayer(rootNode, cc.Layers.Enum.DEFAULT);
Gizmos2D.drawLine(rootNode, { x: 10, y: 20 }, { x: 14, y: 24 });
debug.lateUpdate(0);
graphics = rootNode.children[0].children.map((n) => n.components[0]);
assert.equal(graphics.length, 4, 'Alpha and layer are part of the render state key');
assert.equal(graphics[2].node.layer, cc.Layers.Enum.GIZMOS);
assert.equal(graphics[3].node.layer, cc.Layers.Enum.DEFAULT);

const beforeClears = graphics.map((g) => g.clearCount);
debug.lateUpdate(0); // One empty frame clears previous commands.
const afterClears = graphics.map((g) => g.clearCount);
assert.equal(afterClears[0], beforeClears[0], 'Inactive renderer should not clear repeatedly');
assert.ok(afterClears.slice(1).every((value, index) => value === beforeClears[index + 1] + 1));
debug.lateUpdate(0); // Subsequent idle frames do not clear again.
assert.deepEqual(graphics.map((g) => g.clearCount), afterClears);

// Scene updates may fall back to 250ms. Labels/Sprites should not be erased
// on every lateUpdate, otherwise 2D annotations remain visible for one frame.
const frame = { width: 256, height: 128 };
Gizmos2D.drawLabel(rootNode, 'persistent', 'HUD annotation', { x: 5, y: 10 }, 16);
Gizmos2D.drawSprite(rootNode, 'preview', frame, { x: 12, y: 18 });
debug.lateUpdate(0);
const label = debug._labelMap.get('persistent');
const sprite = debug._spriteMap.get('preview');
assert.equal(label.string, 'HUD annotation');
assert.equal(sprite.spriteFrame, frame);
now += 300;
debug.lateUpdate(0);
assert.equal(label.string, 'HUD annotation',
    '2D label persists across a 250ms Scene watchdog gap');
assert.equal(sprite.spriteFrame, frame);
now += 451;
debug.lateUpdate(0);
assert.equal(label.string, '', '2D label expires only when idle longer than 750ms');
assert.equal(sprite.spriteFrame, null);

console.log('[draw-commands-2d] 164 paths/one stroke, local/world endpoints, render-state partitioning, idle reuse OK');
