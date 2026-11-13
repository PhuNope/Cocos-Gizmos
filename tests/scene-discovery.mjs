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
const sceneListeners = new Map();
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
    on: (event, fn) => {
        if (event === 'before-update') beforeUpdate = fn;
        else {
            assert.ok(['before-scene-launch', 'after-scene-launch'].includes(event));
            sceneListeners.set(event, fn);
        }
    },
    off: (event, fn) => {
        if (event === 'before-update') {
            assert.equal(beforeUpdate, fn);
            beforeUpdate = null;
        } else {
            assert.equal(sceneListeners.get(event), fn);
            sceneListeners.delete(event);
        }
    },
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
        return { Component: class {}, Node: class {}, director, Director: {
            EVENT_BEFORE_UPDATE: 'before-update',
            EVENT_BEFORE_SCENE_LAUNCH: 'before-scene-launch',
            EVENT_AFTER_SCENE_LAUNCH: 'after-scene-launch',
        } };
    },
};
vm.runInNewContext(compiled, sandbox, { filename: 'ExecuteGizmos.js' });
const { start, stop } = sandbox.exports;
const handleRefreshes = [];
let clearedHandles = 0;
let plannedFrames = 0;
let clearedHudFrames = 0;
sandbox.exports.setPresentationAdapter({
    evaluate(_component, selected) { return { draw: true, hud: selected }; },
    renderHud() { return 0; },
    planFrame() { plannedFrames++; },
    clearFrame() { clearedHudFrames++; },
});
sandbox.exports.setPositionHandleAdapter({
    refresh(components, selected, at) {
        assert.ok(plannedFrames > handleRefreshes.length,
            'HUD frame layout must be planned before refreshing picking controllers');
        handleRefreshes.push({ count: components.length, selectedCount: selected.size, at });
    },
    clear() { clearedHandles++; },
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

    // Mask.onLoad can throw during a Scene switch before the next engine
    // update. The before-launch event must detach old native controllers
    // before the engine destroys the old Scene graph.
    const clearsBeforeFailedLaunch = clearedHandles;
    sceneListeners.get('before-scene-launch')();
    assert.ok(clearedHandles > clearsBeforeFailedLaunch,
        'Before-scene-launch proactively detaches old picking Gizmos');
    const refreshesBeforeInvalid = handleRefreshes.length;
    scene = createNode('partially-activated-mask-scene', []);
    now += 16;
    beforeUpdate();
    assert.equal(handleRefreshes.length, refreshesBeforeInvalid,
        'Do not register controllers on a Scene whose Mask.onLoad failed');
    now += 251;
    timer();
    assert.equal(handleRefreshes.length, refreshesBeforeInvalid,
        'Even the watchdog cannot reactivate broken Scene Gizmos');
    scene = createNode('replacement', []);
    // A subsequent successful Scene launch must unlock scanning and mount
    // a fresh adapter; merely returning to a scene should not need an
    // extension reinstall.
    sceneListeners.get('before-scene-launch')();
    sceneListeners.get('after-scene-launch')();
    now += 16;
    beforeUpdate();
    assert.equal(scanCount, 4, 'Scene changes invalidate the registry');
    assert.ok(clearedHandles >= 2, 'Scene switch must clear controllers immediately');

    scene = null;
    now += 16;
    beforeUpdate();
    assert.equal(sandbox.exports.status().components, 0);
    assert.ok(clearedHandles >= 3,
        'Closing the Scene must clear active handles regardless of the 250ms discovery throttle');
    assert.ok(clearedHudFrames >= 2,
        'Scene switching and closing must invalidate the previous component HUD layout');
    assert.equal(handleRefreshes.at(-1).count, 0,
        'The replacement Scene must have refreshed the component registry before closure');

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
assert.equal(sceneListeners.size, 0,
    'Extension unload deregisters both Scene launch callbacks');
console.log('[scene-discovery] callback discovery is cached, refreshes on scene change, and respects selection');
