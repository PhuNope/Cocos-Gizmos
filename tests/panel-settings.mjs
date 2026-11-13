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
assert.equal(manifest.contributions.messages['get-example-assets'].methods[0], 'getExampleAssets');
assert.match(panel.template, /Gizmo display/);
assert.match(panel.template, /HUD labels/);
assert.match(panel.template, /Check Scene integration/);
assert.match(panel.template, /Check example assets/);

const originalEditor = globalThis.Editor;
const forwarded = [];
let allowScene = true;
let allowExamples = true;
const exampleIds = {
    CocosGizmos2DDemo: '79b61d2e-c131-4ae7-8be4-54aa7becc30a',
    CocosGizmos3DDemo: '1f0a6e38-ffb9-4f95-9f39-ef443ba2e6d8',
    CocosGizmosSmokeDemo: 'c9f57ebd-36ce-4b24-a7bf-47a350c2d9db',
    CocosGizmosDecoratorDemo: '5c7b9b5e-3c33-42cd-b09d-5de039e8cbee',
};
globalThis.Editor = {
    Panel: { open: (id) => { assert.equal(id, 'cocos-gizmos.settings'); return true; } },
    Message: {
        async request(service, message, args) {
            if (service === 'cocos-gizmos') {
                if (message === 'get-settings') return main.methods.getSettings();
                if (message === 'set-settings') return main.methods.setSettings(args);
                if (message === 'get-diagnostics') return main.methods.getDiagnostics();
                if (message === 'get-example-assets') return main.methods.getExampleAssets();
                throw new Error('unexpected settings message');
            }
            if (service === 'asset-db') {
                if (!allowExamples) throw new Error('Asset Database not responding');
                if (message === 'query-ready') return true;
                assert.equal(message, 'query-asset-info');
                const name = args.split('/').at(-1).replace(/\.ts$/, '');
                assert.ok(name in exampleIds, 'Only bundled examples are queried');
                return { uuid: exampleIds[name], importer: 'typescript', imported: true };
            }
            assert.equal(service, 'scene');
            assert.equal(message, 'execute-scene-script');
            if (args.method === 'gizmosExampleClassStatus') {
                if (!allowScene) throw new Error('Scene reloading');
                assert.deepEqual(args.args, []);
                return {
                    registryAvailable: true,
                    classes: Object.keys(exampleIds).map((name) =>
                        ({ name, status: 'registered' })),
                };
            }
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
            examplesRun: makeSelect(''),
            examplesResult: { textContent: '' },
        },
    };
    await panel.ready.call(host);
    assert.equal(host.$.display.value, 'always');
    assert.equal(host.$.hud.value, 'selected');
    assert.equal(host.$.diagnosticsRun.listenerCount(), 1);
    await host.$.diagnosticsRun.click();
    assert.match(host.$.diagnosticsResult.textContent, /SampleScene/);
    assert.ok(host.$.diagnosticsResult.textContent.includes('Ctrl+Z'));
    await host.$.examplesRun.click();
    assert.match(host.$.examplesResult.textContent,
        /CocosGizmos2DDemo: imported \| Scene class: registered/);
    assert.match(host.$.examplesResult.textContent, /CocosGizmos3DDemo: imported/);
    assert.match(host.$.examplesResult.textContent, /CocosGizmosSmokeDemo: imported/);
    assert.match(host.$.examplesResult.textContent, /CocosGizmosDecoratorDemo: imported/);
    assert.equal(host.$.examplesRun.disabled, false);
    assert.match(host.$.examplesResult.textContent,
        /CocosGizmosSmokeDemo: imported \| Scene class: registered/);

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
    allowExamples = false;
    await host.$.examplesRun.click();
    assert.match(host.$.examplesResult.textContent, /readiness not reported/);
    assert.match(host.$.examplesResult.textContent, /query-failed/);
    panel.close.call(host);
    assert.equal(host.$.display.listenerCount(), 0);
    assert.equal(host.$.hud.listenerCount(), 0);
    assert.equal(host.$.diagnosticsRun.listenerCount(), 0);
    assert.equal(host.$.examplesRun.listenerCount(), 0);

    console.log('[settings-panel] manifest, scene messaging, update rollback and cleanup OK');
} finally {
    if (originalEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = originalEditor;
}
