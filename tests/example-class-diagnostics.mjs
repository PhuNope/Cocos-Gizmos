import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/GizmoExampleClassDiagnostics.ts'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, module, { filename: 'GizmoExampleClassDiagnostics.js' });
const { EXAMPLE_CLASS_NAMES, inspectGizmoExampleClasses } = module.exports;
const names = Array.from(EXAMPLE_CLASS_NAMES);
assert.deepEqual(names, ['CocosGizmos2DDemo', 'CocosGizmos3DDemo', 'CocosGizmosSmokeDemo', 'CocosGizmosDecoratorDemo']);

class Component {}
class Demo extends Component {}
class NotComponent {}
const ctors = new Map(names.map((name) => [name, Demo]));
let lookups = 0;
const engine = {
    Component,
    js: {
        getClassByName(name) { lookups++; return ctors.get(name); },
        isChildClassOf(type, base) {
            return type === base || type.prototype instanceof base;
        },
    },
};
const registered = inspectGizmoExampleClasses(engine);
assert.equal(lookups, 4);
assert.equal(registered.registryAvailable, true);
assert.ok(registered.classes.every((entry) => entry.status === 'registered'));

ctors.delete(names[0]);
ctors.set(names[1], NotComponent);
const mixed = inspectGizmoExampleClasses(engine);
assert.deepEqual(Array.from(mixed.classes, (entry) => entry.status),
    ['not-registered', 'not-component', 'registered', 'registered']);

const unavailable = inspectGizmoExampleClasses(null);
assert.equal(unavailable.registryAvailable, false);
assert.ok(unavailable.classes.every((entry) => entry.status === 'registry-unavailable'));

const noHelper = inspectGizmoExampleClasses({
    Component,
    js: { getClassByName: (name) => name === names[0] ? Demo : NotComponent },
});
assert.deepEqual(Array.from(noHelper.classes, (entry) => entry.status),
    ['registered', 'not-component', 'not-component', 'not-component'],
    'Use prototype inheritance when isChildClassOf is unavailable');

const failures = inspectGizmoExampleClasses({
    Component,
    js: { getClassByName(name) {
        if (name === names[1]) throw new Error('class registry busy');
        return Demo;
    } },
});
assert.deepEqual(Array.from(failures.classes, (entry) => entry.status),
    ['registered', 'lookup-error', 'registered', 'registered']);
assert.match(failures.classes[1].error, /registry busy/);
assert.equal(failures.classes[1].name, names[1]);
assert.equal(failures.classes[1].error.includes('C:\\'), false);
assert.equal(failures.classes.length, 4,
    'Class diagnostic must be read-only and never add or instantiate Components');

console.log('[example-class-diagnostics] live Scene component registration, absent classes and detached registry OK');
