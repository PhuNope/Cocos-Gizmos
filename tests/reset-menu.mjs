import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const top = pkg.contributions.menu.find(item => item.path === 'Gizmos' &&
    item.label === 'Reset Gizmos');
assert.ok(top, 'Gizmos is a dedicated top-level Creator menu');
assert.equal(top.message, 'reset-gizmos');
assert.deepEqual(pkg.contributions.messages['reset-gizmos'].methods, ['resetGizmos']);

let starts = 0;
let stops = 0;
const synced = [];
const cleared = [];
const services = [];
const handles = [];
let positionAdapter = null;
let presentationAdapter = null;
const updater = {
    start() { starts++; return { started: true }; },
    stop() { stops++; },
    status() { return { started: true, scene: 'Gizmos.scene' }; },
    syncSelection(ids) { synced.push([...ids]); },
    setPresentationAdapter(value) { presentationAdapter = value; },
    setPositionHandleAdapter(value) { positionAdapter = value; },
};
class GizmoPresentationService {
    constructor() {
        this.settings = { display: 'always', hud: 'selected' };
        this.disposed = false;
        services.push(this);
    }
    getSettings() { return { ...this.settings }; }
    configure(input) { this.settings = { ...input }; return this.getSettings(); }
    getLayout() { return {}; }
    evaluate() { return { hud: true }; }
    dispose() { this.disposed = true; }
}
function createPositionHandleAdapter() {
    const item = {
        disposed: false,
        dispose() { this.disposed = true; },
        status() { return { active: 1, registered: 4 }; },
    };
    handles.push(item);
    return item;
}
const gizmos2D = class Gizmos2D {};
const gizmos3D = class Gizmos3D {};
const runtime = { exports: {}, console: { info() {}, error() {} },
    require(spec) {
        if (spec === './editor-runtime/Gizmos2D.js') return { Gizmos2D: gizmos2D };
        if (spec === './editor-runtime/Gizmos3D.js') return { Gizmos3D: gizmos3D };
        if (spec === './editor-runtime/ExecuteGizmos.js') return updater;
        if (spec === './editor-runtime/GizmoPresentationService.js') return {
            GizmoPresentationService,
        };
        if (spec === './editor-runtime/PositionHandles.js') return { createPositionHandleAdapter };
        throw Error('Unexpected Scene import: ' + spec);
    },
};
vm.runInNewContext(readFileSync(new URL('../scene.js', import.meta.url), 'utf8'),
    runtime, { filename: 'scene.js' });
runtime.exports.load();
assert.equal(starts, 1);
const initialService = services[0];
const initialHandles = handles[0];
runtime.exports.methods.gizmosSetViewSettings({ display: 'selected', hud: 'off' });

const extension = require('../main.js');
const originalEditor = globalThis.Editor;
const selected = ['selected-node'];
const requests = [];
globalThis.Editor = {
    Selection: { getSelected(type) {
        assert.equal(type, 'node');
        return selected;
    } },
    Message: {
        async request(channel, message, data) {
            assert.equal(channel, 'scene');
            assert.equal(message, 'execute-scene-script');
            assert.equal(data.name, 'cocos-gizmos');
            assert.equal(data.method, 'gizmosReset');
            requests.push(data);
            return runtime.exports.methods[data.method](...data.args);
        },
    },
    log() {},
    warn() {},
};
try {
    const first = await extension.methods.resetGizmos();
    assert.equal(first.started, true);
    assert.equal(first.selected, 1);
    assert.equal(first.scene, 'Gizmos.scene');
    assert.deepEqual(requests[0].args, [['selected-node']]);
    assert.deepEqual(synced.at(-1), ['selected-node']);
    assert.equal(starts, 2);
    assert.equal(stops, 1);
    assert.equal(initialService.disposed, true, 'Reset frees the old HUD overlay');
    assert.equal(initialHandles.disposed, true, 'Reset frees native BoxController handles');
    assert.notEqual(services.at(-1), initialService);
    assert.notEqual(handles.at(-1), initialHandles);
    assert.ok(positionAdapter && presentationAdapter);
    assert.deepEqual(services.at(-1).settings, { display: 'selected', hud: 'off' },
        'Reset must preserve user HUD and Gizmos display settings');

    selected.length = 0;
    const second = await extension.methods.resetGizmos();
    assert.equal(second.started, true, 'Reset works with nothing selected');
    assert.equal(second.selected, 0);
    assert.deepEqual(synced.at(-1), []);
    assert.equal(starts, 3);
    assert.equal(stops, 2);
    assert.equal(services.at(-2).disposed, true);
    assert.equal(handles.at(-2).disposed, true);

    runtime.exports.unload();
    assert.equal(stops, 3);
    assert.equal(handles.at(-1).disposed, true);
    assert.equal(services.at(-1).disposed, true);
    assert.equal(positionAdapter, null);
    assert.equal(presentationAdapter, null);
    console.log('[reset-menu] top-level Creator menu, IPC, Scene reset, selection, settings and cleanup OK');
} finally {
    if (originalEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = originalEditor;
}
