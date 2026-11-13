import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = (name) => ts.transpileModule(
    readFileSync(path.join(root, 'source', name + '.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } },
).outputText;
function load(name, imports = {}) {
    const scope = {
        exports: {},
        require(key) {
            if (!(key in imports)) throw new Error('Unknown ' + name + ' import: ' + key);
            return imports[key];
        },
    };
    vm.runInNewContext(compile(name), scope, { filename: name + '.js' });
    return scope.exports;
}

class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
}
const solver = load('PositionDragSolver');
const bridge = load('SceneCameraBridge');
const projection = load('GizmoHudProjection', {
    'cc': { Vec3 }, './PositionDragSolver': solver,
});
const { resolveSceneCamera } = bridge;
const { createSceneHudProjection } = projection;
const origin = new Vec3(12, 7, 0);

let renderRays = 0, rendererProjectionCalls = 0;
const renderCamera = {
    geometryRenderer: {},
    node: { forward: new Vec3(0, 0, -1) },
    worldToScreen(out, world) {
        assert.ok(out && world, 'Renderer signature is (out, world)');
        assert.equal(world.x, origin.x);
        rendererProjectionCalls++;
        Object.assign(out, { x: world.x * 2, y: world.y * 2, z: 1 });
        return out;
    },
    screenPointToRay(out, x, y) {
        assert.ok(out?.o && out?.d, 'Renderer signature is (out, x, y)');
        assert.equal(typeof x, 'number');
        assert.equal(typeof y, 'number');
        renderRays++;
        Object.assign(out.o, { x: x / 2, y: y / 2, z: 30 });
        Object.assign(out.d, { x: 0, y: 0, z: -1 });
        return out;
    },
};

const wrapped = resolveSceneCamera({ Camera: { _camera: { camera: renderCamera } } });
assert.equal(wrapped.convention, 'render-camera');
assert.equal(wrapped.source, 'wrapped');
const projected = createSceneHudProjection(wrapped.camera, origin);
assert.ok(projected, 'Creator render camera must produce a usable HUD projection');
assert.equal(rendererProjectionCalls, 1);
assert.equal(renderRays, 3);
assert.equal(projected.screen.x, 24);
assert.equal(projected.screen.y, 14);
assert.ok(Math.abs(projected.pixelSize - 0.5) < 1e-10);
const point = projected.worldAt(44, 34);
assert.ok(Math.abs(point.x - 22) < 1e-10);
assert.ok(Math.abs(point.y - 17) < 1e-10);
assert.ok(Math.abs(point.z) < 1e-10);

let componentCalls = 0, componentRays = 0;
const componentCamera = {
    node: { forward: new Vec3(0, 0, -1) },
    worldToScreen(world, out) {
        assert.equal(world.x, origin.x);
        componentCalls++;
        Object.assign(out, { x: world.x * 2, y: world.y * 2, z: 1 });
        return out;
    },
    screenPointToRay(x, y, out) {
        assert.equal(typeof x, 'number');
        assert.ok(out?.o && out?.d, 'Component Camera signature is (x, y, out)');
        componentRays++;
        Object.assign(out.o, { x: x / 2, y: y / 2, z: 30 });
        Object.assign(out.d, { x: 0, y: 0, z: -1 });
        return out;
    },
};
const direct = resolveSceneCamera({ Camera: { camera: componentCamera } });
assert.equal(direct.convention, 'component-camera');
assert.equal(direct.source, 'direct');
assert.ok(createSceneHudProjection(direct.camera, origin));
assert.equal(componentCalls, 1);
assert.equal(componentRays, 3);

const rawRender = resolveSceneCamera({ Camera: { camera: renderCamera } });
assert.equal(rawRender.convention, 'render-camera', 'A direct render Camera is still out-first');
assert.ok(createSceneHudProjection(rawRender.camera, origin));
const nested = resolveSceneCamera({
    Camera: { camera: { camera: renderCamera } },
});
assert.equal(nested.convention, 'render-camera');
assert.ok(createSceneHudProjection(nested.camera, origin));

assert.equal(resolveSceneCamera(null).camera, null);
assert.equal(resolveSceneCamera({ Camera: { _camera: {} } }).convention, 'unavailable');
assert.equal(resolveSceneCamera({ Camera: { _camera: { camera: {} } } }).camera, null);
const editorPreferred = resolveSceneCamera({ Camera: {
    _camera: { camera: renderCamera }, camera: componentCamera,
} });
assert.equal(editorPreferred.convention, 'component-camera',
    'Prefer Creator public cce.Camera.camera to its private renderer camera');
assert.equal(editorPreferred.source, 'direct');
assert.ok(createSceneHudProjection(editorPreferred.camera, origin));
componentCamera.camera = { width: 800, height: 600 };
assert.equal(resolveSceneCamera({ Camera: { camera: componentCamera } }).camera.viewport.width, 800);
assert.equal(resolveSceneCamera({ Camera: { camera: componentCamera } }).camera.viewport.height, 600);

console.log('[scene-camera-bridge] Creator 3.8 render-camera out-first and component-camera out-last projection/rays OK');
