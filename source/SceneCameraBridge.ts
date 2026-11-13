import type { SceneHudCamera } from './GizmoHudProjection';

/** The render-scene Camera uses out-first signatures, unlike cc.Camera. */
export type SceneCameraConvention = 'render-camera' | 'component-camera' | 'unavailable';

export interface SceneCameraResolution {
    readonly camera: SceneHudCamera | null;
    readonly convention: SceneCameraConvention;
    readonly source: 'wrapped' | 'direct' | 'unavailable';
}

function hasProjectionMethods(value: any): boolean {
    return value && typeof value.worldToScreen === 'function' &&
        typeof value.screenPointToRay === 'function';
}

/**
 * Cocos Creator exposes two incompatible camera APIs:
 * - renderer.scene.Camera.worldToScreen(out, world), screenPointToRay(out, x, y)
 * - cc.Camera.worldToScreen(world, out), screenPointToRay(x, y, out)
 *
 * The Scene View exposes a renderer camera at cce.Camera._camera.camera.
 * Keep the two APIs separate; trial-and-error calls can mutate the wrong
 * objects, silently produce invalid rays, or throw on a real editor camera.
 */
export function resolveSceneCamera(cce: any): SceneCameraResolution {
    const editor = cce?.Camera;
    const wrapped = editor?._camera?.camera;
    const direct = editor?.camera;

    let raw: any = null;
    let convention: SceneCameraConvention = 'unavailable';
    let source: SceneCameraResolution['source'] = 'unavailable';

    // The public Scene cce.Camera.camera is a cc.Camera component in
    // Creator 3.8.x. Prefer it over private _camera.camera (renderer camera):
    // their viewport/pointer coordinates can differ during Scene 2D pan/zoom.
    if (hasProjectionMethods(direct)) {
        raw = direct;
        convention = direct.geometryRenderer !== undefined ||
            typeof direct.initGeometryRenderer === 'function' ||
            direct.matViewProj !== undefined || direct.projectionType !== undefined ?
            'render-camera' : 'component-camera';
        source = 'direct';
    } else if (hasProjectionMethods(direct?.camera)) {
        raw = direct.camera;
        convention = 'render-camera';
        source = 'direct';
    } else if (hasProjectionMethods(wrapped)) {
        raw = wrapped;
        convention = 'render-camera';
        source = 'wrapped';
    }

    if (!raw) return { camera: null, convention, source };

    const viewport = raw.camera || raw;
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    const camera: SceneHudCamera = {
        node: raw.node,
        sync() {
            // Scene navigation updates the camera node before its render-scene
            // inverse VP is refreshed. Screen rays otherwise lag the wheel.
            const render = raw.camera || raw;
            if (typeof render?.update === 'function') render.update(true);
        },
        viewport: Number.isFinite(width) && width > 0 &&
            Number.isFinite(height) && height > 0 ? { width, height } : undefined,
        worldToScreen(world, out) {
            if (convention === 'render-camera') {
                raw.worldToScreen(out, world);
            } else {
                raw.worldToScreen(world, out);
            }
        },
        screenPointToRay(x, y, out) {
            if (convention === 'render-camera') {
                return raw.screenPointToRay(out, x, y) || out;
            }
            return raw.screenPointToRay(x, y, out) || out;
        },
    };

    return { camera, convention, source };
}
