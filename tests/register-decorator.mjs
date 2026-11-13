import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/RegisterGizmos.ts'), 'utf8');
assert.equal(source, readFileSync(path.join(root, 'editor-assets/RegisterGizmos.ts'), 'utf8'));
const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS,
} }).outputText;
const load = enabled => {
    const exports = {};
    vm.runInNewContext(compiled, { exports, WeakMap, Object, TypeError,
        require(id) {
            assert.equal(id, 'cc/env', 'Runtime module only imports Editor flag');
            return { EDITOR_NOT_IN_PREVIEW: enabled };
        },
    }, { filename: 'RegisterGizmos.js' });
    return exports.registerGizmos;
};

let count = 0;
const calls = [];
class Drawer {
    constructor(component) { this.component = component; count++; }
    onDrawGizmos() { calls.push(['draw', this.component.id]); }
    onGizmoHandles() { return [{ property: 'point' }]; }
    onGizmoChanged(...args) { calls.push(['changed', this.component.id, ...args]); }
    onGizmoHudChanged(...args) { calls.push(['hud', this.component.id, ...args]); }
    onGizmoHudAction(id) { calls.push(['action', this.component.id, id]); }
}
class Example {
    constructor(id) { this.id = id; this.node = { isValid: true }; this.isValid = true; }
    onDrawGizmos() { throw Error('Drawer should override this method'); }
    onDrawGizmosSelected() { return 'existing Component method'; }
}
const register = load(true);
register(Drawer)(Example);
assert.equal(count, 0, 'Decorator should not instantiate Drawers before a callback');
assert.equal(Example.prototype.onDrawGizmosSelected(), 'existing Component method');
const a = new Example('a'), b = new Example('b');
a.onDrawGizmos(); a.onDrawGizmos(); b.onDrawGizmos();
assert.equal(count, 2, 'Each Component has one cached Gizmos drawer');
assert.deepEqual(a.onGizmoHandles(), [{ property: 'point' }]);
a.onGizmoChanged('point', 'update', 2);
a.onGizmoHudChanged('size', 'cancel', 1.5);
b.onGizmoHudAction('reset');
assert.deepEqual(calls, [
    ['draw', 'a'], ['draw', 'a'], ['draw', 'b'],
    ['changed', 'a', 'point', 'update', 2],
    ['hud', 'a', 'size', 'cancel', 1.5],
    ['action', 'b', 'reset'],
]);
a.isValid = false; a.onDrawGizmos();
b.node.isValid = false; b.onDrawGizmos();
assert.equal(calls.length, 6, 'Destroyed Component/Node must not call a drawer');
class Derived extends Example {}
new Derived('derived').onDrawGizmos();
assert.equal(count, 3, 'Inherited bridges work for derived classes');

class Preview {}
load(false)(Drawer)(Preview);
assert.equal(Object.hasOwn(Preview.prototype, 'onDrawGizmos'), false,
    'Preview/game cannot register Gizmos methods');
assert.equal(count, 3, 'Preview never creates a drawer');
assert.throws(() => register(null), /constructor/);

const editable = readFileSync(path.join(root, 'assets/GizmosDecoratorTest.ts'), 'utf8');
const mounted = readFileSync(path.join(root,
    'editor-assets/Examples/CocosGizmosDecoratorDemo.ts'), 'utf8');
assert.match(editable, /@registerGizmos\(CustomDrawer\)/);
assert.match(editable, /implements IDrawGizmos/);
assert.match(mounted, /from '\.\.\/RegisterGizmos'/);
console.log('[register-decorator] cached Editor callbacks, HUD and game/Preview no-op OK');
