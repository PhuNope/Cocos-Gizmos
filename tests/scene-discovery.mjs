import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'source', 'ExecuteGizmos.ts');
const source = readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;

const schedulerSource = readFileSync(path.join(root, 'source/SceneUpdateScheduler.ts'), 'utf8');
const schedulerCode = ts.transpileModule(schedulerSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const schedulerExports = {};
vm.runInNewContext(schedulerCode, { exports: schedulerExports }, { filename: 'SceneUpdateScheduler.js' });

let now = 1000;
let scene = null;
let selected = [];
let beforeUpdate = null;
let timer = null;
let scanCount = 0;
let selectionLookups = 0;
const calls = { first: 0, second: 0, selected: 0 };
const firstComponent = {
    isValid: true, enabled: true,
    node: { uuid: 'first', activeInHierarchy: true },
    onDrawGizmos() { calls.first++; },
};
const secondComponent = {
    isValid: true, enabled: true,
    node: { uuid: 'second', activeInHierarchy: true },
    onDrawGizmos() { calls.second++; },
    onDrawGizmosSelected() { calls.selected++; },
};
const createNode = (name, components = []) => ({
    name, uuid: name, isValid: true, active: true, activeInHierarchy: true,
    children: [],
    get components() { scanCount++; return components; },
});
const rootNode = createNode('scene', [firstComponent]);
scene = rootNode;
const director = {
    getScene: () => scene,
    on: (event, fn) => { assert.equal(event, 'before-update'); beforeUpdate = fn; },
    off: (event, fn) => { assert.equal(beforeUpdate, fn); beforeUpdate = null; },
};
const sandbox = {
    exports: {},
    Editor: { Selection: { getSelected: (type) => {
        assert.equal(type, 'node');
        selectionLookups++;
        return selected;
    } } },
    Date: class extends Date { static now() { return now; } },
    console: { info() {}, warn() {}, error: (...args) => { throw new Error(args.join(' ')); } },
    setInterval: (fn, ms) => { assert.equal(ms, 250); timer = fn; return 1; },
    clearInterval: (id) => { assert.equal(id, 1); timer = null; },
    require: (id) => {
        if (id === './SceneUpdateScheduler') return schedulerExports;
        assert.equal(id, 'cc');
        return { Component: class {}, Node: class {}, director, Director: { EVENT_BEFORE_UPDATE: 'before-update' } };
    },
};
vm.runInNewContext(compiled, sandbox, { filename: 'ExecuteGizmos.js' });
const { start, stop } = sandbox.exports;
const handleRefreshes = [];
sandbox.exports.setPositionHandleAdapter({
    refresh(components, selected, at) {
        handleRefreshes.push({ count: components.length, selectedCount: selected.size, at });
    },
});
try {
    start(); // Initial scan and render.
    assert.equal(scanCount, 1);
    assert.equal(calls.first, 1);
    for (let i = 0; i < 10; i++) {
        now += 16;
        beforeUpdate();
    }
    assert.equal(scanCount, 1, 'No full scene traversal for each engine frame');
    assert.equal(calls.first, 11, 'Registered callbacks still draw each frame');
    assert.ok(selectionLookups <= 6, 'Selection must not be queried for every render frame');
    assert.ok(selectionLookups >= 2, 'Selection should refresh promptly during editor updates');

    // New components are discovered through the bounded fallback scan.
    const secondNode = createNode('child', [secondComponent]);
    rootNode.children.push(secondNode);
    selected = ['second'];
    now += 300;
    beforeUpdate();
    assert.equal(scanCount, 3, 'Root and child are both visited on refresh');
    assert.equal(calls.second, 1);
    assert.equal(calls.selected, 1);

    secondComponent.enabled = false;
    now += 16;
    beforeUpdate();
    assert.equal(calls.second, 1, 'Disabled components are skipped immediately');
    assert.equal(calls.selected, 1);
    assert.equal(scanCount, 3);

    scene = createNode('replacement', []);
    now += 16;
    beforeUpdate();
    assert.equal(scanCount, 4, 'Scene changes invalidate the registry');

    scene = null;
    now += 16;
    beforeUpdate();
    assert.equal(sandbox.exports.status().components, 0);
    const lastRefresh = handleRefreshes.at(-1);
    assert.equal(lastRefresh.count, 0,
        'Closing the Scene must release interactive Gizmos with an empty component registry');
    assert.equal(lastRefresh.selectedCount, 0);
    assert.equal(lastRefresh.at, now);

    const beforeTimer = sandbox.exports.status().frames;
    now += 16;
    timer();
    assert.equal(sandbox.exports.status().frames, beforeTimer,
        'Idle watchdog must skip a tick immediately after an engine frame');
    assert.equal(sandbox.exports.status().timerSkips, 1);

    now += 251;
    timer();
    assert.equal(sandbox.exports.status().frames, beforeTimer + 1,
        'Watchdog must keep the Scene responsive when the engine is paused');
    assert.equal(sandbox.exports.status().fallbackFrames, 1);
    assert.equal(sandbox.exports.status().engineFrames, 14);
} finally {
    stop();
}
assert.equal(beforeUpdate, null);
assert.equal(timer, null);
console.log('[scene-discovery] callback discovery is cached, refreshes on scene change, and respects selection');
