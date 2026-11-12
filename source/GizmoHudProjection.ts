import { Vec3 } from 'cc';
import { intersectHandlePlane } from './PositionDragSolver';

type Point = { x: number; y: number; z: number };
type Ray = { o: Vec3; d: Vec3 };

export interface SceneHudCamera {
    node?: { forward?: Vec3 };
    worldToScreen(point: Vec3, out: Vec3): void;
    screenPointToRay(x: number, y: number, ray: Ray): Ray | void;
}

export interface SceneHudProjection {
    readonly screen: { x: number; y: number };
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
