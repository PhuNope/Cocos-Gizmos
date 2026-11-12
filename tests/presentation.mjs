import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(name, imports = {}) {
    const src = readFileSync(path.join(root, 'source', name + '.ts'), 'utf8');
    const code = ts.transpileModule(src, {
        compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const scope = {
        exports: {},
        require(mod) {
            if (!(mod in imports)) throw new Error('Unknown import ' + mod);
            return imports[mod];
        },
    };
    vm.runInNewContext(code, scope);
    return scope.exports;
}

const presentation = load('GizmoPresentation');
const { normalizeViewConfig, shouldDrawGizmo, shouldDrawHud, normalizeHudItems } = presentation;
assert.deepEqual({ ...normalizeViewConfig({}) }, { display: 'always', hud: 'selected' });
assert.deepEqual({ ...normalizeViewConfig({ display: 'selected', hud: 'off' }) },
    { display: 'selected', hud: 'off' });
assert.deepEqual({ ...normalizeViewConfig({ display: 'all', hud: 'unknown' }) },
    { display: 'always', hud: 'selected' });
assert.equal(shouldDrawGizmo('always', false), true);
assert.equal(shouldDrawGizmo('selected', false), false);
assert.equal(shouldDrawGizmo('selected', true), true);
assert.equal(shouldDrawGizmo('off', true), false);
assert.equal(shouldDrawHud('selected', false), false);
assert.equal(shouldDrawHud('always', false), true);
assert.equal(shouldDrawHud('off', true), false);

const hud = normalizeHudItems([
    { id: 'two', text: 'Second', order: 2, fontSize: 999, color: '#abc123' },
    { id: 'one', text: 'First', order: -1, fontSize: 2 },
    { id: 'one', text: 'Duplicate', order: -2 },
    { id: '', text: 'Invalid' },
    { id: 'bad', text: 123 },
    { id: 'three', text: 'Third', order: 3, color: '<script>' },
], 3);
assert.equal(hud.length, 3);
assert.deepEqual(hud.map(x => x.id), ['one', 'two', 'three']);
assert.equal(hud[0].fontSize, 9);
assert.equal(hud[1].fontSize, 60);
assert.equal(hud[2].color, '#ffffff');
assert.equal(normalizeHudItems([{ id: 'x', text: 'hello' }])[0].color, '#ffffff');

let rendered = [];
let disposed = false;
class FakeOverlay {
    get totalDrawn() { return rendered.length; }
    render(component, entries) {
        rendered.push({ component, entries });
        return entries.length;
    }
    dispose() { disposed = true; }
}
const gizmos3d = { DEFAULT_COLOR: {}, beginColor(node, color) { rendered.push({ reset: node }); } };
const { GizmoPresentationService } = load('GizmoPresentationService', {
    cc: {},
    './Gizmos3D': { Gizmos3D: gizmos3d },
    './GizmoHudOverlay': { GizmoHudOverlay: FakeOverlay },
    './GizmoPresentation': presentation,
});
const service = new GizmoPresentationService();
const component = {
    node: { uuid: 'n' },
    onGizmoHud() { return [{ id: 'info', text: 'Speed 10' }]; },
};
assert.equal(service.evaluate(component, false).draw, true);
assert.equal(service.evaluate(component, false).hud, false);
assert.equal(service.evaluate(component, true).hud, true);
service.configure({ display: 'selected', hud: 'off' });
assert.equal(service.evaluate(component, false).draw, false);
assert.equal(service.evaluate(component, true).draw, true);
assert.equal(service.evaluate(component, true).hud, false);
component.onGizmoSettings = () => ({ display: 'off', hud: 'always' });
assert.equal(service.evaluate(component, true).draw, false);
assert.equal(service.evaluate(component, false).hud, true);
assert.equal(service.renderHud(component), 1);
assert.equal(rendered[0].entries[0].id, 'info');
assert.equal(rendered[1].reset, component.node);
assert.equal(service.getStats().hudLabels, 2);
service.dispose();
assert.equal(disposed, true);
console.log('[presentation] visibility policy, sanitization, HUD ordering and disposal OK');
