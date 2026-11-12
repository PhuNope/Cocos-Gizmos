import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/GizmoEditSession.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports }, { filename: 'GizmoEditSession.js' });
const { GizmoEditSession } = exports;

function makeSession(initial) {
    let value = initial;
    const events = [];
    const session = new GizmoEditSession(
        () => value,
        (next) => { value = next; events.push(['write', next]); },
        {
            begin: (next) => events.push(['begin', next]),
            update: (next) => events.push(['update', next]),
            rollback: (next) => events.push(['rollback', next]),
            end: (next, cancelled, changed) =>
                events.push(['end', next, cancelled, changed]),
        },
    );
    return { session, events, read: () => value };
}

const empty = makeSession(50);
assert.equal(empty.session.apply(20), false, 'Cannot update outside a gesture');
assert.equal(empty.session.finish(), false, 'Cannot close a gesture twice');
assert.equal(empty.session.begin(), true);
assert.equal(empty.session.begin(), false);
assert.equal(empty.session.apply(50), false, 'Identical updates are skipped');
assert.equal(empty.session.finish(), false, 'Unchanged drag is not marked dirty');
assert.deepEqual(empty.events.map(row => row[0]), ['begin', 'end']);
assert.equal(empty.events.at(-1)[3], false);

const slider = makeSession(20);
slider.session.begin();
for (let i = 1; i <= 100; i++) {
    assert.equal(slider.session.apply(i), true);
    assert.equal(slider.session.apply(i), false);
}
assert.equal(slider.session.hasChanges, true);
assert.equal(slider.session.finish(), true);
assert.equal(slider.read(), 100);
assert.equal(slider.events.filter(row => row[0] === 'begin').length, 1);
assert.equal(slider.events.filter(row => row[0] === 'end').length, 1);
assert.equal(slider.events.filter(row => row[0] === 'update').length, 100);
assert.equal(slider.session.finish(), false);
assert.equal(slider.session.apply(200), false);

const cancelled = makeSession({ x: 4, y: 5, z: 6 });
cancelled.session.begin();
assert.equal(cancelled.session.apply({ x: 4, y: 5, z: 6 }), false);
assert.equal(cancelled.session.apply({ x: 15, y: 25, z: 35 }), true);
assert.equal(cancelled.session.finish(true), true);
assert.deepEqual({ ...cancelled.read() }, { x: 4, y: 5, z: 6 });
assert.deepEqual(cancelled.events.map(row => row[0]), [
    'begin', 'write', 'update', 'write', 'rollback', 'end',
]);
assert.equal(cancelled.events.at(-1)[2], true);
assert.equal(cancelled.events.at(-1)[3], true);
assert.equal(cancelled.session.isActive, false);

const toggle = makeSession(false);
toggle.session.begin();
toggle.session.apply(true);
toggle.session.finish();
assert.equal(toggle.read(), true);
assert.equal(toggle.events.filter(row => row[0] === 'end').length, 1);

const failed = new GizmoEditSession(
    () => 1, () => {},
    { begin: () => { throw new Error('begin failed'); },
      update: () => {}, rollback: () => {}, end: () => {} },
);
assert.throws(() => failed.begin(), /begin failed/);
assert.equal(failed.isActive, false);

const backToInitial = makeSession(10);
backToInitial.session.begin();
backToInitial.session.apply(12);
backToInitial.session.apply(10);
assert.equal(backToInitial.session.hasChanges, false);
backToInitial.session.finish();
assert.equal(backToInitial.events.at(-1)[3], false,
    'Returning to the initial value must not create a net change');

console.log('[gizmo-edit-session] one transaction per gesture, no-op filtering, cancel rollback and lifecycle OK');
