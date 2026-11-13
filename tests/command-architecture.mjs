import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const load = (name, imports = {}) => {
    const text = readFileSync(new URL('../source/' + name + '.ts', import.meta.url), 'utf8');
    const js = ts.transpileModule(text, {
        compilerOptions: { target: ts.ScriptTarget.ES2017,
            module: ts.ModuleKind.CommonJS },
    }).outputText;
    const scope = { exports: {}, require(name) {
        if (name in imports) return imports[name];
        throw Error('Unexpected import: ' + name);
    } };
    vm.runInNewContext(js, scope);
    return scope.exports;
};
const plain = value => JSON.parse(JSON.stringify(value));
const presets = load('GizmoHandlePresets');
const move = presets.makeMoveGizmo('position', {
    snap: 0.25, pickSize: 32, hoverColor: '#fff456',
});
assert.equal(move.length, 6);
assert.deepEqual(plain(move.map(h => h.axis)), ['x', 'y', 'z', null, null, null]);
assert.deepEqual(plain(move.slice(3).map(h => h.plane)), ['xy', 'xz', 'yz']);
assert.equal(move.filter(h => h.showPositionLabel).length, 1);
assert.equal(move.every(h => h.property === 'position' && h.snap === 0.25 &&
    h.pickSize === 32), true);
assert.notEqual(move[0], move[1], 'Descriptors never share mutable model objects');
const compactDefaults = presets.makeMoveGizmo('compact');
assert.equal(compactDefaults[0].axisSize, 66);
assert.equal(compactDefaults[0].pickSize, 24);
assert.equal(compactDefaults[3].planeSize, 18);
assert.equal(compactDefaults[3].planeOffset, 14);
assert.ok(compactDefaults.every(handle => handle.snap === undefined),
    'Move Gizmo defaults to continuous floating-point dragging');
assert.equal(presets.makeMoveGizmo('close', { planeOffset: 12 })[3].planeOffset, 12);
assert.throws(() => presets.makeMoveGizmo('invalid', { planeOffset: 11 }), /planeOffset/);
assert.equal(compactDefaults[0].positionLabelOffset, 82);
assert.deepEqual(plain(presets.makePointGizmo('origin')),
    { property: 'origin', visual: 'point', plane: 'xy', space: 'local',
      color: '#ffcc00' });
assert.deepEqual(plain(presets.makePointGizmos('vertices', 3).map(h => h.index)),
    [0, 1, 2]);
assert.deepEqual(plain(presets.makePointGizmos('vertices', 0)), []);
assert.throws(() => presets.makeMoveGizmo(''), /non-empty/);
assert.throws(() => presets.makeMoveGizmo('a', { pickSize: -1 }), /pickSize/);
assert.throws(() => presets.makePointGizmos('a', -1), /count/);
assert.throws(() => presets.makePointGizmos('a', 1.5), /count/);

const session = load('GizmoEditSession');
const solver = load('PositionDragSolver');
const { GizmoMoveCommand } = load('GizmoMoveCommand', {
    './GizmoEditSession': session,
    './PositionDragSolver': solver,
});
let position = { x: 0, y: 0, z: 0 };
const signals = [];
const hooks = {
    begin(p) { signals.push(['begin', plain(p)]); },
    update(p) { signals.push(['update', plain(p)]); },
    rollback(p) { signals.push(['rollback', plain(p)]); },
    end(p, cancelled, changed) {
        signals.push(['end', plain(p), cancelled, changed]);
    },
};
const value = {
    read() { return position; },
    write(p) { position = { ...p }; },
};
const space = {
    toWorld(p) { return { ...p }; },
    toLocal(p) { return { ...p }; },
};
const ray = (x, y) => ({ o: { x, y, z: 10 }, d: { x: 0, y: 0, z: -1 } });
const first = new GizmoMoveCommand(position, space, { x: 0, y: 0, z: 1 },
    { plane: 'xy', snap: 0.5 }, value, hooks);
assert.equal(first.active, false);
assert.equal(first.update(ray(1, 2)), false, 'No command executes before begin');
assert.equal(first.begin(ray(0, 0)), true);
assert.equal(first.begin(ray(0, 0)), false);
assert.equal(first.update(ray(2.2, 3.1)), true);
assert.deepEqual(plain(position), { x: 2, y: 3, z: 0 });
assert.equal(first.update(ray(2.2, 3.1)), false);
assert.equal(first.cancel(), true);
assert.deepEqual(plain(position), { x: 0, y: 0, z: 0 });
assert.deepEqual(signals.map(item => item[0]), ['begin', 'update', 'rollback', 'end']);
assert.equal(signals.at(-1)[2], true);
assert.equal(first.active, false);
assert.equal(first.end(), false, 'No duplicate end events');

const second = new GizmoMoveCommand(position, space, { x: 0, y: 0, z: 1 },
    { plane: 'xy', axis: 'x' }, value, hooks);
assert.equal(second.begin(ray(0, 0)), true);
assert.equal(second.update(ray(5, 12)), true);
assert.deepEqual(plain(position), { x: 5, y: 0, z: 0 },
    'Axis constraints are domain geometry, not Scene controller code');
assert.equal(second.end(), true);
assert.equal(signals.at(-1)[2], false);
assert.equal(signals.at(-1)[3], true);
assert.equal(second.cancel(), false);
assert.deepEqual(plain(position), { x: 5, y: 0, z: 0 });

const badRay = { o: { x: 0, y: 0, z: 10 }, d: { x: 1, y: 0, z: 0 } };
const failed = new GizmoMoveCommand(position, space, { x: 0, y: 0, z: 1 },
    { plane: 'xy' }, value, hooks);
assert.equal(failed.begin(badRay), false);
assert.equal(failed.active, false);
console.log('[command-architecture] pure presets, single edit command, rollback, commit and axis constraints OK');
