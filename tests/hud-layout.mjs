import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(name, imports = {}) {
    const code = ts.transpileModule(
        readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
        },
    ).outputText;
    const scope = {
        exports: {},
        require(id) {
            if (!(id in imports)) throw new Error('Unexpected import ' + id);
            return imports[id];
        },
    };
    vm.runInNewContext(code, scope, { filename: name + '.js' });
    return scope.exports;
}
const controls = load('GizmoHudControls');
const presentation = load('GizmoPresentation');
const { GizmoHudLayout } = load('GizmoHudLayout', {
    './GizmoHudControls': controls,
    './GizmoPresentation': presentation,
});

const sameNode = { uuid: 'one', activeInHierarchy: true, isValid: true };
const otherNode = { uuid: 'two', activeInHierarchy: true, isValid: true };
let reads = { a: 0, b: 0 };
function mock(node, name) {
    return {
        node, isValid: true, enabled: true, value: name === 'A' ? 10 : 20,
        onGizmoHud() {
            reads[name.toLowerCase()]++;
            return [{ id: 'title', text: name, order: 0 }];
        },
        onGizmoHudControls() {
            return [{ id: 'value', type: 'slider', text: 'Value',
                property: 'value', min: 0, max: 100 }];
        },
    };
}
const a = mock(sameNode, 'A');
const b = mock(sameNode, 'B');
const c = mock(otherNode, 'A');
const layout = new GizmoHudLayout();
layout.beginFrame([a, b, c], () => true);
const pa = layout.get(a), pb = layout.get(b), pc = layout.get(c);
assert.ok(pa && pb && pc);
assert.equal(pa.startRow, 0);
assert.equal(pa.textCount, 1);
assert.equal(pa.rowCount, 2);
assert.equal(pb.startRow, 3, 'Second component starts after first HUD and a blank row');
assert.equal(pb.textCount, 1);
assert.equal(pc.startRow, 0, 'Different nodes have independent HUD rows');
assert.notEqual(pa.namespace, pb.namespace, 'Same label ID must not alias across components');
assert.notEqual(pa.namespace, pc.namespace);
assert.deepEqual(Array.from(pa.items, item => item.id), ['text:title', 'control:value']);
assert.deepEqual(Array.from(pb.items, item => item.id), ['text:title', 'control:value']);
assert.match(pa.items[1].text, /10/);
assert.match(pb.items[1].text, /20/);
assert.equal(reads.a, 2, 'Each HUD callback runs once per component per frame');
assert.equal(reads.b, 1);

const oldNamespace = pa.namespace;
a.value = 35;
layout.beginFrame([a, b], () => true);
assert.equal(layout.get(a).namespace, oldNamespace, 'Stable component IDs reuse Labels');
assert.match(layout.get(a).items[1].text, /35/);
assert.equal(reads.a, 3);

layout.beginFrame([a, b], component => component === b);
assert.equal(layout.get(a), null, 'Hidden HUDs reserve no rows');
assert.equal(layout.get(b).startRow, 0);

layout.beginFrame([b, a], () => true);
assert.equal(layout.get(b).startRow, 0);
assert.equal(layout.get(a).startRow, 3);
assert.equal(layout.get(a).namespace, oldNamespace, 'Reordering does not change label ownership');

let failures = [];
const broken = {
    node: sameNode, isValid: true, enabled: true,
    onGizmoHud() { throw new Error('bad-text'); },
    onGizmoHudControls() { return [{ id: 'ok', text: 'Button', type: 'button' }]; },
};
layout.beginFrame([broken, a], () => true, (component, hook, error) =>
    failures.push([component, hook, error.message]));
assert.equal(failures.length, 1);
assert.equal(failures[0][1], 'onGizmoHud');
assert.equal(layout.get(broken).rowCount, 1,
    'Bad label callback must not hide a valid button');
assert.equal(layout.get(a).startRow, 2);
layout.clear();
assert.equal(layout.get(a), null);
assert.equal(layout.get(broken), null);
console.log('[hud-layout] stable component namespaces, node stacking, controls, visibility and callback isolation OK');
