import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/GizmoExampleClassDiagnostics.ts'), 'utf8');
const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const classModule = { exports: {} };
vm.runInNewContext(transpiled, classModule);
const classNames = Array.from(classModule.exports.EXAMPLE_CLASS_NAMES);
class Component {}
class Demo extends Component {}
let engineAvailable = true;
const calls = [];
const scene = { exports: {} };
const script = readFileSync(path.join(root, 'scene.js'), 'utf8');
vm.runInNewContext(script, {
    exports: scene.exports,
    require(id) {
        calls.push(id);
        if (id === './editor-runtime/GizmoExampleClassDiagnostics.js')
            return classModule.exports;
        if (id === 'cc') {
            if (!engineAvailable) throw new Error('Scene engine not ready');
            return {
                Component,
                js: {
                    getClassByName(name) {
                        return classNames.includes(name) ? Demo : undefined;
                    },
                },
            };
        }
        throw new Error('Unexpected require: ' + id);
    },
}, { filename: 'scene.js' });

assert.equal(typeof scene.exports.methods.gizmosExampleClassStatus, 'function');
const registered = scene.exports.methods.gizmosExampleClassStatus();
assert.equal(registered.registryAvailable, true);
assert.equal(registered.classes.length, 4);
assert.ok(registered.classes.every((entry) => entry.status === 'registered'));
assert.deepEqual(calls,
    ['./editor-runtime/GizmoExampleClassDiagnostics.js', 'cc'],
    'Class check is read-only and loads no Scene drawing or Controller modules');

engineAvailable = false;
const detached = scene.exports.methods.gizmosExampleClassStatus();
assert.equal(detached.registryAvailable, false);
assert.ok(detached.classes.every((entry) => entry.status === 'registry-unavailable'));
console.log('[scene-example-classes] Scene Script class registry method, detached engine and no Scene writes OK');
