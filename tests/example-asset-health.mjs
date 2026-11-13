import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const extension = require('../main.js');
const originalEditor = globalThis.Editor;
const uuids = {
    CocosGizmos2DDemo: '79b61d2e-c131-4ae7-8be4-54aa7becc30a',
    CocosGizmos3DDemo: '1f0a6e38-ffb9-4f95-9f39-ef443ba2e6d8',
    CocosGizmosSmokeDemo: 'c9f57ebd-36ce-4b24-a7bf-47a350c2d9db',
    CocosGizmosDecoratorDemo: '5c7b9b5e-3c33-42cd-b09d-5de039e8cbee',
};
const names = Object.keys(uuids);

function setEditor(query, isReady = true, classState = 'registered') {
    const requested = [];
    globalThis.Editor = {
        Message: {
            async request(service, message, url) {
                requested.push([service, message, url]);
                if (service === 'scene') {
                    assert.equal(message, 'execute-scene-script');
                    assert.equal(url.method, 'gizmosExampleClassStatus');
                    assert.deepEqual(url.args, []);
                    if (classState === 'scene-unavailable') {
                        throw new Error('Scene process is reloading');
                    }
                    if (classState === 'malformed') return {};
                    return {
                        registryAvailable: classState !== 'registry-unavailable',
                        classes: names.map((name, index) => ({
                            name,
                            status: classState === 'registry-unavailable' ?
                                'registry-unavailable' :
                                Array.isArray(classState) ? classState[index] : classState,
                        })),
                    };
                }
                assert.equal(service, 'asset-db');
                if (message === 'query-ready') {
                    if (isReady === 'unsupported') throw new Error('message not supported');
                    return isReady;
                }
                assert.equal(message, 'query-asset-info');
                assert.match(url, /^db:\/\/cocos-gizmos\/Examples\/CocosGizmos(?:2DDemo|3DDemo|SmokeDemo|DecoratorDemo)\.ts$/);
                const name = url.split('/').at(-1).replace(/\.ts$/, '');
                return query(name);
            },
        },
    };
    return requested;
}

try {
    const calls = setEditor((name) => ({
        uuid: uuids[name], importer: 'typescript', imported: true, invalid: false,
        file: 'C:\\private-project\\not-for-logs\\' + name + '.ts',
    }));
    const healthy = await extension.methods.getExampleAssets();
    assert.equal(healthy.databaseReady, true);
    assert.deepEqual(healthy.examples.map((e) => e.name), names);
    assert.ok(healthy.examples.every((e) => e.status === 'imported'));
    assert.ok(healthy.examples.every((e) => e.url.startsWith('db://cocos-gizmos/Examples/')));
    assert.equal(calls.length, 6,
        'One readiness query, four exact asset lookups, and one Scene registry query');
    assert.equal(healthy.sceneRegistry, 'available');
    assert.ok(healthy.examples.every((entry) => entry.classStatus === 'registered'));
    assert.ok(healthy.guidance.includes('Confirm drag-and-drop'),
        'Successful registry checks still require manual Inspector interaction');
    assert.doesNotMatch(JSON.stringify(healthy), /private-project/,
        'Asset diagnostics must not reveal local project paths');

    const waitingCalls = setEditor(() => { throw new Error('Must not query unready DB'); }, false);
    const waiting = await extension.methods.getExampleAssets();
    assert.equal(waiting.databaseReady, false);
    assert.ok(waiting.examples.every((e) => e.status === 'database-not-ready'));
    assert.equal(waitingCalls.length, 1,
        'Do not query individual scripts or Scene classes while DB is not ready');
    assert.ok(waiting.examples.every((entry) => entry.classStatus === 'not-checked'));

    setEditor((name) => name === names[0] ? null :
        name === names[1] ? { uuid: 'some-other-uuid', importer: 'typescript', imported: true } :
            { uuid: uuids[name], importer: 'typescript', imported: false }, 'unsupported');
    const incomplete = await extension.methods.getExampleAssets();
    assert.equal(incomplete.databaseReady, null, 'Unsupported readiness API must not abort actual checks');
    assert.deepEqual(incomplete.examples.map((e) => e.status),
        ['missing', 'uuid-mismatch', 'not-imported', 'not-imported']);

    setEditor((name) => name === names[0] ?
        { uuid: uuids[name], importer: 'typescript', invalid: true } :
        name === names[1] ? { uuid: uuids[name], importer: '*', imported: true } :
        { uuid: uuids[name], importer: 'typescript', imported: true });
    const bad = await extension.methods.getExampleAssets();
    assert.deepEqual(bad.examples.map((e) => e.status),
        ['invalid', 'wrong-importer', 'imported', 'imported']);

    setEditor((name) => {
        if (name === names[0]) throw new Error('importer unavailable');
        return { uuid: uuids[name], importer: 'typescript', imported: true };
    });
    const failed = await extension.methods.getExampleAssets();
    assert.equal(failed.examples[0].status, 'query-failed');
    assert.match(failed.examples[0].error, /importer unavailable/);
    assert.ok(failed.examples.slice(1).every((e) => e.status === 'imported'),
        'One query failure must not hide other script results');

    setEditor((name) => ({
        uuid: uuids[name], importer: 'typescript', imported: true,
    }), true, ['registered', 'not-registered', 'not-component', 'registered']);
    const noClasses = await extension.methods.getExampleAssets();
    assert.deepEqual(noClasses.examples.map((entry) => entry.classStatus),
        ['registered', 'not-registered', 'not-component', 'registered']);
    assert.ok(noClasses.guidance.includes('not registered as Components'));
    assert.ok(noClasses.examples.every((entry) => entry.status === 'imported'),
        'Asset import must remain independent from Component registration');

    setEditor((name) => ({
        uuid: uuids[name], importer: 'typescript', imported: true,
    }), true, 'scene-unavailable');
    const reloading = await extension.methods.getExampleAssets();
    assert.equal(reloading.sceneRegistry, 'unavailable');
    assert.ok(reloading.examples.every((entry) => entry.classStatus === 'scene-unavailable'),
        'A detached Scene process is NOT evidence of a missing script class');

    setEditor((name) => ({
        uuid: uuids[name], importer: 'typescript', imported: true,
    }), true, 'registry-unavailable');
    const noRegistry = await extension.methods.getExampleAssets();
    assert.equal(noRegistry.sceneRegistry, 'registry-unavailable');
    assert.ok(noRegistry.examples.every((entry) => entry.classStatus === 'registry-unavailable'));

    setEditor((name) => ({
        uuid: uuids[name], importer: 'typescript', imported: true,
    }), true, 'malformed');
    const malformed = await extension.methods.getExampleAssets();
    assert.ok(malformed.examples.every((entry) => entry.classStatus === 'scene-unavailable'));

    delete globalThis.Editor;
    await assert.rejects(extension.methods.getExampleAssets(), /Editor Message API is unavailable/);

    console.log('[example-asset-health] 4 mounted scripts, DB readiness, import errors, stable UUIDs and privacy OK');
} finally {
    if (originalEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = originalEditor;
}
