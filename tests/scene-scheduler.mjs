import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'source/SceneUpdateScheduler.ts'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const exported = {};
vm.runInNewContext(code, { exports: exported }, { filename: 'SceneUpdateScheduler.js' });
const { SceneUpdateScheduler } = exported;

let time = 1000;
let engineListener = null;
let watchdog = null;
let schedules = 0;
let subscriptions = 0;
let unsubscribes = 0;
const calls = [];
const skipped = [];
let nestedEngine = false;
let throwOnEngine = false;

const scheduler = new SceneUpdateScheduler({
    now: () => time,
    subscribe: listener => {
        assert.equal(engineListener, null, 'Only one engine listener is allowed');
        engineListener = listener;
        subscriptions++;
    },
    unsubscribe: listener => {
        assert.equal(listener, engineListener, 'Must unregister exactly the installed listener');
        engineListener = null;
        unsubscribes++;
    },
    schedule: (fn, intervalMs) => {
        assert.equal(intervalMs, 250, 'Idle watchdog should not run at every frame');
        assert.equal(watchdog, null);
        watchdog = fn;
        schedules++;
        return 7;
    },
    cancel: id => {
        assert.equal(id, 7);
        watchdog = null;
    },
    update: source => {
        calls.push(source);
        if (nestedEngine && source === 'engine') {
            nestedEngine = false;
            engineListener();
            scheduler.tickOnce();
        }
        if (throwOnEngine && source === 'engine') {
            throwOnEngine = false;
            throw new Error('simulated callback error');
        }
    },
    onSkip: reason => skipped.push(reason),
});

scheduler.start();
scheduler.start(); // Start is idempotent.
assert.deepEqual(calls, ['initial']);
assert.equal(subscriptions, 1);
assert.equal(schedules, 1);

for (let i = 1; i <= 12; i++) {
    time += 16;
    engineListener();
}
assert.equal(calls.filter(s => s === 'engine').length, 12);

time += 20;
watchdog();
assert.equal(calls.filter(s => s === 'timer').length, 0,
    'Watchdog must not redraw while engine frames are active');
assert.equal(skipped.at(-1), 'recent-engine');

time += 251;
watchdog();
assert.equal(calls.filter(s => s === 'timer').length, 1,
    'Paused engine must fall back to idle Scene updates');
watchdog();
assert.equal(calls.filter(s => s === 'timer').length, 2,
    'Idle scene must be refreshable on successive watchdog checks');

nestedEngine = true;
engineListener();
assert.equal(skipped.filter(s => s === 'reentrant').length, 2,
    'Recursive engine and manual ticks must be coalesced into the current drawing pass');
assert.equal(calls.at(-1), 'engine');

throwOnEngine = true;
assert.throws(() => engineListener(), /simulated callback error/);
scheduler.tickOnce();
assert.equal(calls.at(-1), 'manual', 'A failed callback must not permanently lock the scheduler');

scheduler.stop();
scheduler.stop(); // Stop is idempotent.
assert.equal(engineListener, null);
assert.equal(watchdog, null);
assert.equal(unsubscribes, 1);
const countBefore = calls.length;
scheduler.tickOnce();
assert.equal(calls.length, countBefore, 'Tick once does nothing after stop');

time += 1000;
scheduler.start();
assert.equal(calls.at(-1), 'initial', 'Restart executes exactly one initial update');
assert.equal(subscriptions, 2);
scheduler.stop();
assert.equal(unsubscribes, 2);

console.log('[scene-scheduler] engine cadence, idle fallback, reentrancy, restart and cleanup OK');
