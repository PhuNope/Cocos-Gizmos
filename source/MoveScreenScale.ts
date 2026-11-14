/** Stable world units per Scene pixel without camera ray/plane intersections.
 * A finite screen-space derivative avoids the 0.3-world-unit fallback that
 * made Move arrow geometry explode when zooming very close to a handle.
 */
export type MovePoint3 = { x: number; y: number; z: number };
export type MovePoint2 = { x: number; y: number };
export type MoveProject = (point: MovePoint3) => MovePoint2 | null;

/**
 * Stable fingerprint of the view/projection used by visible Move arrows.
 *
 * BEFORE_UPDATE can skip a Scene wheel frame, while BEFORE_DRAW still runs
 * and updates native transparent picking quads. Sampling the projected
 * origin and three world-space basis directions also detects 3D orbit/pan,
 * perspective FOV changes and 2D orthographic zoom without relying on
 * undocumented Scene wheel events or private camera matrices.
 *
 * Coordinates are quantized to 1/32 screen pixel so floating point camera
 * jitter cannot trigger a new full Scene render every engine frame.
 */
export function moveCameraProjectionSignature(
    anchor: MovePoint3, project: MoveProject,
): string | null {
    const probes: MovePoint3[] = [
        anchor,
        { x: anchor.x + 1, y: anchor.y, z: anchor.z },
        { x: anchor.x, y: anchor.y + 1, z: anchor.z },
        { x: anchor.x, y: anchor.y, z: anchor.z + 1 },
    ];
    const result: number[] = [];
    for (const point of probes) {
        const xy = project(point);
        if (!valid2(xy)) return null;
        result.push(Math.round(xy.x * 32), Math.round(xy.y * 32));
    }
    return result.join(':');
}

const valid2 = (p: MovePoint2 | null): p is MovePoint2 =>
    !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function moveWorldPerPixel(
    world: MovePoint3, project: MoveProject,
    cameraRight?: MovePoint3 | null, cameraUp?: MovePoint3 | null,
): number | null {
    const center = project(world);
    if (!valid2(center)) return null;
    const directions: MovePoint3[] = [];
    // A tangent to the camera's image plane gives the exact orthographic
    // scale and first-order perspective scale. Other axes are fallbacks for
    // Creator camera wrappers that do not expose node.right / node.up.
    for (const direction of [cameraRight, cameraUp]) {
        if (direction) directions.push(direction);
    }
    if (!directions.length) {
        directions.push({ x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    }
    let pixelsPerWorld = 0;
    for (const direction of directions) {
        const length = Math.hypot(direction.x, direction.y, direction.z);
        if (!Number.isFinite(length) || length < 1e-10) continue;
        const neighbor = project({ x: world.x + direction.x,
            y: world.y + direction.y, z: world.z + direction.z });
        if (!valid2(neighbor)) continue;
        const px = Math.hypot(neighbor.x - center.x, neighbor.y - center.y);
        if (Number.isFinite(px) && px > 1e-8)
            pixelsPerWorld = Math.max(pixelsPerWorld, px / length);
    }
    return pixelsPerWorld > 1e-8 ? 1 / pixelsPerWorld : null;
}
