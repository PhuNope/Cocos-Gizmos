import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function load(name, deps = {}) {
    const file = readFileSync(new URL('../source/' + name + '.ts', import.meta.url), 'utf8');
    const js = ts.transpileModule(file, {
        compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const context = { exports: {}, require(id) {
        if (!(id in deps)) throw new Error('Unmapped dependency: ' + id);
        return deps[id];
    } };
    vm.runInNewContext(js, context);
    return context.exports;
}

const session = load('GizmoEditSession');
const position = load('PositionDragSolver');
const move = load('GizmoMoveCommand', {
    './GizmoEditSession': session, './PositionDragSolver': position,
});
const rotationGeometry = load('RotationHandleGeometry');
const rotation = load('RotationDragSolver', {
    './RotationHandleGeometry': rotationGeometry,
});
const rotate = load('GizmoRotateCommand', {
    './GizmoEditSession': session,
    './RotationHandleGeometry': rotationGeometry,
    './RotationDragSolver': rotation,
    './GizmoMoveCommand': move,
});
const { GizmoCommands } = load('GizmoCommandBuilder', {
    './GizmoMoveCommand': move,
    './GizmoRotateCommand': rotate,
});
const identity = { toLocal: p => ({ ...p }), toWorld: p => ({ ...p }) };
const hooks = { begin() {}, update() {}, rollback() {}, end() {} };
let current = { x: 0, y: 0, z: 0 };
const port = { read: () => current, write: p => { current = { ...p }; } };
const ray = (x, y) => ({ o: { x, y, z: 10 }, d: { x: 0, y: 0, z: -1 } });

assert.throws(() => GizmoCommands.move().build(), /required/);
assert.throws(() => GizmoCommands.rotate().build(), /required/);
const sourceOptions = { plane: 'xy', bounds: { max: { x: 2 } } };
const config = GizmoCommands.move().initial(current).space(identity)
    .planeNormal({ x: 0, y: 0, z: 1 }).constraints(sourceOptions)
    .value(port).hooks(hooks);
const command = config.build();
sourceOptions.bounds.max.x = 500;
assert.equal(command.begin(ray(0, 0)), true);
assert.equal(command.update(ray(10, 0)), true);
assert.equal(current.x, 2, 'Builder takes a defensive copy of mutable constraints');
assert.equal(command.cancel(), true);
assert.equal(current.x, 0);

const rotateCommand = GizmoCommands.rotate().initial(current).pivot(current)
    .axisNormal({ x: 0, y: 0, z: 1 })
    .frame({ x: 0, y: 0, z: 0, w: 1 })
    .constraints({ axis: 'z', space: 'local' })
    .value(port).hooks(hooks).build();
assert.equal(rotateCommand.active, false);
assert.equal(typeof rotateCommand.begin, 'function');
assert.equal(typeof rotateCommand.end, 'function');
console.log('[command-builder] move/rotate factories, validation and snapshot isolation OK');
