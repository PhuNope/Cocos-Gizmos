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

    if (hasProjectionMethods(wrapped)) {
        raw = wrapped;
        convention = 'render-camera';
        source = 'wrapped';
    } else if (hasProjectionMethods(direct?.camera)) {
        raw = direct.camera;
        convention = 'render-camera';
        source = 'direct';
    } else if (hasProjectionMethods(direct)) {
        raw = direct;
        // A renderer camera has no Component.camera getter. It also exposes
        // render-scene properties used by geometry drawing.
        convention = direct.geometryRenderer !== undefined ||
            typeof direct.initGeometryRenderer === 'function' ||
            direct.matViewProj !== undefined || direct.projectionType !== undefined ?
            'render-camera' : 'component-camera';
        source = 'direct';
    }

    if (!raw) return { camera: null, convention, source };

    const camera: SceneHudCamera = {
        node: raw.node,
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
