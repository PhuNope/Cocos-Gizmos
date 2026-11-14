/** Stable world units per Scene pixel without camera ray/plane intersections.
 * A finite screen-space derivative avoids the 0.3-world-unit fallback that
 * made Move arrow geometry explode when zooming very close to a handle.
 */
export type MovePoint3 = { x: number; y: number; z: number };
export type MovePoint2 = { x: number; y: number };
export type MoveProject = (point: MovePoint3) => MovePoint2 | null;

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
