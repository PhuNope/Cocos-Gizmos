import { Vec3 } from 'cc';
import { intersectHandlePlane } from './PositionDragSolver';

type Point = { x: number; y: number; z: number };
type Ray = { o: Vec3; d: Vec3 };

export interface SceneHudCamera {
    node?: { forward?: Vec3 };
    viewport?: { width: number; height: number };
    /** Refresh private renderer matrices after Scene wheel/pan before ray projection. */
    sync?(): void;
    worldToScreen(point: Vec3, out: Vec3): void;
    screenPointToRay(x: number, y: number, ray: Ray): Ray | void;
}

export interface SceneHudProjection {
    readonly screen: { x: number; y: number };
    readonly viewport?: { width: number; height: number };
    readonly pixelSize: number;
    worldAt(x: number, y: number): Vec3;
}

function valid(point: Point): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function rayAt(camera: SceneHudCamera, x: number, y: number): Ray | null {
    const ray = { o: new Vec3(), d: new Vec3() };
    try {
        const result = camera.screenPointToRay(x, y, ray) || ray;
        return result?.o && result?.d && valid(result.o) && valid(result.d) ?
            result : null;
    } catch {
        return null;
    }
}

/**
 * Projects an entire HUD on the plane passing through the node and facing
 * the Scene camera. Three rays establish a reusable one-pixel world-space basis.
 * All HUD labels and interactive markers then share this basis for the frame.
 */
export function createSceneHudProjection(
    camera: SceneHudCamera,
    worldOrigin: Vec3,
): SceneHudProjection | null {
    if (!camera || !valid(worldOrigin)) return null;
    const screen = new Vec3();
    try { camera.worldToScreen(worldOrigin, screen); }
    catch { return null; }
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;

    const baseRay = rayAt(camera, screen.x, screen.y);
    const rayX = rayAt(camera, screen.x + 1, screen.y);
    const rayY = rayAt(camera, screen.x, screen.y + 1);
    if (!baseRay || !rayX || !rayY) return null;

    const normal = camera.node?.forward && valid(camera.node.forward) ?
        camera.node.forward : baseRay.d;
    const base = intersectHandlePlane(baseRay, worldOrigin, normal);
    const right = intersectHandlePlane(rayX, worldOrigin, normal);
    const up = intersectHandlePlane(rayY, worldOrigin, normal);
    if (!base || !right || !up) return null;
    const dx = { x: right.x - base.x, y: right.y - base.y, z: right.z - base.z };
    const dy = { x: up.x - base.x, y: up.y - base.y, z: up.z - base.z };
    const pixelSize = Math.hypot(dx.x, dx.y, dx.z);
    if (!valid(dx) || !valid(dy) || !Number.isFinite(pixelSize) || pixelSize <= 1e-8 ||
        Math.hypot(dy.x, dy.y, dy.z) <= 1e-8) return null;

    return {
        screen: { x: screen.x, y: screen.y },
        viewport: camera.viewport,
        pixelSize,
        worldAt(x: number, y: number): Vec3 {
            const u = x - screen.x;
            const v = y - screen.y;
            return new Vec3(
                base.x + u * dx.x + v * dy.x,
                base.y + u * dx.y + v * dy.y,
                base.z + u * dx.z + v * dy.z,
            );
        },
    };
}

/**
 * Creates a camera-facing, one-world-unit-deep HUD plane that tracks the Scene
 * viewport rather than the selected Node's world depth. Matching the
 * screen-textured HUD plane keeps picking handles aligned after zoom.
 */
export function createViewportHudProjection(camera: SceneHudCamera): SceneHudProjection | null {
    const viewport = camera.viewport;
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;
    const center = rayAt(camera, viewport.width * 0.5, viewport.height * 0.5);
    if (!center) return null;
    const origin = new Vec3(center.o.x + center.d.x,
        center.o.y + center.d.y, center.o.z + center.d.z);
    const normal = center.d;
    const x0 = viewport.width * 0.5;
    const y0 = viewport.height * 0.5;
    const x = rayAt(camera, x0 + 1, y0);
    const y = rayAt(camera, x0, y0 + 1);
    if (!x || !y) return null;
    const right = intersectHandlePlane(x, origin, normal);
    const up = intersectHandlePlane(y, origin, normal);
    const base = intersectHandlePlane(center, origin, normal);
    if (!base || !right || !up) return null;
    const dx = new Vec3(right.x - base.x, right.y - base.y, right.z - base.z);
    const dy = new Vec3(up.x - base.x, up.y - base.y, up.z - base.z);
    const pixelSize = Math.hypot(dx.x, dx.y, dx.z);
    if (!Number.isFinite(pixelSize) || pixelSize < 1e-9) return null;
    return {
        screen: { x: x0, y: y0 }, viewport, pixelSize,
        worldAt(x: number, y: number): Vec3 {
            const u = x - x0, v = y - y0;
            return new Vec3(base.x + u * dx.x + v * dy.x,
                base.y + u * dx.y + v * dy.y,
                base.z + u * dx.z + v * dy.z);
        },
    };
}
