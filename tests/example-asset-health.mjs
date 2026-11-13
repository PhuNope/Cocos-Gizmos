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
};
const names = Object.keys(uuids);

function setEditor(query, isReady = true) {
    const requested = [];
    globalThis.Editor = {
        Message: {
            async request(service, message, url) {
                assert.equal(service, 'asset-db');
                requested.push([message, url]);
                if (message === 'query-ready') {
                    if (isReady === 'unsupported') throw new Error('message not supported');
                    return isReady;
                }
                assert.equal(message, 'query-asset-info');
                assert.match(url, /^db:\/\/cocos-gizmos\/Examples\/CocosGizmos(?:2DDemo|3DDemo|SmokeDemo)\.ts$/);
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
    assert.equal(calls.length, 4, 'One readiness query and three exact asset lookups');
    assert.ok(healthy.guidance.includes('does not validate Scene compilation'));
    assert.doesNotMatch(JSON.stringify(healthy), /private-project/,
        'Asset diagnostics must not reveal local project paths');

    const waitingCalls = setEditor(() => { throw new Error('Must not query unready DB'); }, false);
    const waiting = await extension.methods.getExampleAssets();
    assert.equal(waiting.databaseReady, false);
    assert.ok(waiting.examples.every((e) => e.status === 'database-not-ready'));
    assert.equal(waitingCalls.length, 1, 'Do not query individual scripts while DB is not ready');

    setEditor((name) => name === names[0] ? null :
        name === names[1] ? { uuid: 'some-other-uuid', importer: 'typescript', imported: true } :
            { uuid: uuids[name], importer: 'typescript', imported: false }, 'unsupported');
    const incomplete = await extension.methods.getExampleAssets();
    assert.equal(incomplete.databaseReady, null, 'Unsupported readiness API must not abort actual checks');
    assert.deepEqual(incomplete.examples.map((e) => e.status),
        ['missing', 'uuid-mismatch', 'not-imported']);

    setEditor((name) => name === names[0] ?
        { uuid: uuids[name], importer: 'typescript', invalid: true } :
        name === names[1] ? { uuid: uuids[name], importer: '*', imported: true } :
        { uuid: uuids[name], importer: 'typescript', imported: true });
    const bad = await extension.methods.getExampleAssets();
    assert.deepEqual(bad.examples.map((e) => e.status),
        ['invalid', 'wrong-importer', 'imported']);

    setEditor((name) => {
        if (name === names[0]) throw new Error('importer unavailable');
        return { uuid: uuids[name], importer: 'typescript', imported: true };
    });
    const failed = await extension.methods.getExampleAssets();
    assert.equal(failed.examples[0].status, 'query-failed');
    assert.match(failed.examples[0].error, /importer unavailable/);
    assert.ok(failed.examples.slice(1).every((e) => e.status === 'imported'),
        'One query failure must not hide other script results');

    delete globalThis.Editor;
    await assert.rejects(extension.methods.getExampleAssets(), /Editor Message API is unavailable/);

    console.log('[example-asset-health] 3 mounted scripts, DB readiness, import errors, stable UUIDs and privacy OK');
} finally {
    if (originalEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = originalEditor;
}
