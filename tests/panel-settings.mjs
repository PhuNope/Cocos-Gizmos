import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const main = require('../main.js');
const panel = require('../panels/settings/index.js');
const manifest = require('../package.json');

assert.equal(manifest.panels.settings.main, './panels/settings/index.js');
assert.equal(manifest.contributions.messages['get-settings'].methods[0], 'getSettings');
assert.equal(manifest.contributions.messages['set-settings'].methods[0], 'setSettings');
assert.equal(manifest.contributions.messages['get-diagnostics'].methods[0], 'getDiagnostics');
assert.match(panel.template, /Gizmo display/);
assert.match(panel.template, /HUD labels/);
assert.match(panel.template, /Check Scene integration/);

const originalEditor = globalThis.Editor;
const forwarded = [];
let allowScene = true;
globalThis.Editor = {
    Panel: { open: (id) => { assert.equal(id, 'cocos-gizmos.settings'); return true; } },
    Message: {
        async request(service, message, args) {
            if (service === 'cocos-gizmos') {
                if (message === 'get-settings') return main.methods.getSettings();
                if (message === 'set-settings') return main.methods.setSettings(args);
                if (message === 'get-diagnostics') return main.methods.getDiagnostics();
                throw new Error('unexpected settings message');
            }
            assert.equal(service, 'scene');
            assert.equal(message, 'execute-scene-script');
            if (args.method === 'gizmosSmokeReport') {
                if (!allowScene) throw new Error('Scene not ready');
                assert.deepEqual(args.args, []);
                return { scene: { updaterStarted: true, name: 'SampleScene' },
                    bridge: { colliderControllerAvailable: true },
                    requiresManualVerification: ['Ctrl+Z'], concerns: [] };
            }
            assert.equal(args.method, 'gizmosSetViewSettings');
            forwarded.push(args.args[0]);
            if (!allowScene) throw new Error('Scene not ready');
            return args.args[0];
        },
    },
};
try {
    assert.equal(main.methods.openSettings(), true);
    const defaults = main.methods.getSettings();
    assert.equal(defaults.display, 'always');
    assert.equal(defaults.hud, 'selected');

    function makeSelect(value) {
        const handlers = new Map();
        return {
            value, disabled: false,
            addEventListener(name, fn) { handlers.set(name, fn); },
            removeEventListener(name, fn) {
                assert.equal(handlers.get(name), fn);
                handlers.delete(name);
            },
            async change() { return handlers.get('change')(); },
            async click() { return handlers.get('click')(); },
            listenerCount() { return handlers.size; },
        };
    }
    const host = {
        $: {
            display: makeSelect(''),
            hud: makeSelect(''),
            feedback: { textContent: '' },
            diagnosticsRun: makeSelect(''),
            diagnosticsResult: { textContent: '' },
        },
    };
    await panel.ready.call(host);
    assert.equal(host.$.display.value, 'always');
    assert.equal(host.$.hud.value, 'selected');
    assert.equal(host.$.diagnosticsRun.listenerCount(), 1);
    await host.$.diagnosticsRun.click();
    assert.match(host.$.diagnosticsResult.textContent, /SampleScene/);
    assert.ok(host.$.diagnosticsResult.textContent.includes('Ctrl+Z'));

    host.$.display.value = 'selected';
    host.$.hud.value = 'off';
    await host.$.display.change();
    assert.equal(main.methods.getSettings().display, 'selected');
    assert.equal(main.methods.getSettings().hud, 'off');
    assert.deepEqual(forwarded.at(-1), { display: 'selected', hud: 'off' });
    assert.equal(host.$.display.disabled, false);

    allowScene = false;
    host.$.display.value = 'always';
    await host.$.display.change();
    assert.equal(host.$.display.value, 'selected', 'Failed updates restore last applied settings');
    assert.equal(main.methods.getSettings().display, 'selected');
    assert.match(host.$.feedback.textContent, /Cannot update Scene View/);
    await host.$.diagnosticsRun.click();
    assert.match(host.$.diagnosticsResult.textContent, /Scene diagnostics unavailable/);
    panel.close.call(host);
    assert.equal(host.$.display.listenerCount(), 0);
    assert.equal(host.$.hud.listenerCount(), 0);
    assert.equal(host.$.diagnosticsRun.listenerCount(), 0);

    console.log('[settings-panel] manifest, scene messaging, update rollback and cleanup OK');
} finally {
    if (originalEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = originalEditor;
}
