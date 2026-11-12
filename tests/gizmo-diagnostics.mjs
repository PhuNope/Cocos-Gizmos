import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filename = path.join(root, 'source/GizmoDiagnostics.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;
const scope = { exports: {} };
vm.runInNewContext(code, scope);
const { buildGizmoSmokeReport } = scope.exports;

const missing = buildGizmoSmokeReport(null, null, null, null);
assert.equal(missing.scene.updaterStarted, false);
assert.equal(missing.bridge.colliderControllerAvailable, false);
assert.equal(missing.bridge.cameraScreenPointToRay, false);
assert.equal(missing.handles.reason, 'not-loaded');
assert.ok(missing.concerns.some(value => value.includes('component Gizmo bridge')));
assert.ok(missing.requiresManualVerification.some(value => value.includes('Ctrl+Z')));

let selections = 0;
let pools = 0;
const Editor = { Selection: { getSelected(type) {
    assert.equal(type, 'node');
    selections++;
    return ['scene-node-a', 'scene-node-b'];
} } };
class ColliderGizmo {
    onControlBegin() {}
    onControlEnd() {}
}
const pool = { typeDefs: { 'cc.BoxCollider': ColliderGizmo } };
const cce = {
    Gizmo: {
        _gizmoPool: { _getPool(type) {
            assert.equal(type, 'component');
            pools++;
            return pool;
        } },
        createGizmo() {},
        showComponentGizmo() {},
    },
    Camera: { camera: {
        worldToScreen() {},
        screenPointToRay() {},
    } },
};
const report = buildGizmoSmokeReport(Editor, cce, {
    started: true, scene: 'SampleScene', components: 4, errors: 0, engineFrames: 60,
    selectionApi: true,
}, {
    registered: 2, active: 1, reason: 'ready',
    positionHandles: 2, hudControls: 4, draggingPosition: 1,
    draggingSlider: 0, pendingClicks: 0,
});
assert.equal(selections, 1);
assert.equal(pools, 1);
assert.equal(report.scene.updaterStarted, true);
assert.equal(report.scene.name, 'SampleScene');
assert.equal(report.scene.selectedNodeCount, 2);
assert.equal(report.bridge.colliderControllerAvailable, true);
assert.equal(report.bridge.hasNativeControlBegin, true);
assert.equal(report.bridge.hasNativeControlEnd, true);
assert.equal(report.bridge.hasNativeControlCancel, false,
    'Do not claim native cancellation support when the hook is missing');
assert.equal(report.handles.positionHandles, 2);
assert.equal(report.handles.hudControls, 4);
assert.equal(report.handles.draggingPosition, 1);
assert.deepEqual(Array.from(report.concerns), []);
assert.ok(report.requiresManualVerification.length >= 4,
    'Probe must never claim it has verified actual click/Undo behavior');

const inaccessible = buildGizmoSmokeReport({
    Selection: { getSelected() { throw new Error('Editor selection detached'); } },
}, { Gizmo: { _gizmoPool: { _getPool() { throw new Error('No pool'); } } } },
{ started: true, scene: 'Scene', selectionApi: true },
{ reason: 'component-gizmo-bridge-unavailable' });
assert.equal(inaccessible.scene.selectedNodeCount, null);
assert.equal(inaccessible.bridge.componentPoolAccessible, false);
assert.ok(inaccessible.concerns.length >= 2);
console.log('[gizmo-diagnostics] read-only status, API discovery, missing bridge and honest caveats OK');
