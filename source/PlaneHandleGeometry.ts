/** Viewport-sized 3D plane-handle geometry, independent of Cocos rendering.
 * All points are WORLD-space and plane basis vectors are normalized.
 */
export type PlaneHandleKind = 'xy' | 'xz' | 'yz';
export type PlaneVec3 = { x: number; y: number; z: number };
export type PlaneHandleBasis = { x: PlaneVec3; y: PlaneVec3; z: PlaneVec3 };
export type PlaneHandleGeometry = {
    center: PlaneVec3;
    corners: [PlaneVec3, PlaneVec3, PlaneVec3, PlaneVec3];
    size: number;
    normal: PlaneVec3;
};

const add = (a: PlaneVec3, b: PlaneVec3): PlaneVec3 =>
    ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (v: PlaneVec3, factor: number): PlaneVec3 =>
    ({ x: v.x * factor, y: v.y * factor, z: v.z * factor });
const cross = (a: PlaneVec3, b: PlaneVec3): PlaneVec3 =>
    ({ x: a.y * b.z - a.z * b.y,
       y: a.z * b.x - a.x * b.z,
       z: a.x * b.y - a.y * b.x });
export function unitPlaneVector(vector: PlaneVec3): PlaneVec3 | null {
    const length = Math.hypot(vector.x, vector.y, vector.z);
    if (!Number.isFinite(length) || length <= 1e-10) return null;
    return scale(vector, 1 / length);
}

/** A 36px square centered 48px along each of its two positive local axes.
 * Since offset + halfSize <= 66px it stays clear of the center Move handle.
 * Pixel size is a world-space scalar from the Scene camera ray projection.
 */
export function planeHandleGeometry(
    origin: PlaneVec3,
    basis: PlaneHandleBasis,
    plane: PlaneHandleKind,
    worldUnitsPerPixel: number,
    sizePixels = 36,
    insetPixels = 48,
): PlaneHandleGeometry | null {
    if (![worldUnitsPerPixel, sizePixels, insetPixels].every(
        value => Number.isFinite(value) && value > 0)) return null;
    const axes = plane === 'xy' ? [basis.x, basis.y] :
        plane === 'xz' ? [basis.x, basis.z] : [basis.y, basis.z];
    const u = unitPlaneVector(axes[0]);
    const v = unitPlaneVector(axes[1]);
    if (!u || !v) return null;
    const normal = unitPlaneVector(cross(u, v));
    if (!normal) return null;
    const center = add(origin, scale(add(u, v), insetPixels * worldUnitsPerPixel));
    const half = sizePixels * worldUnitsPerPixel / 2;
    return {
        center,
        corners: [
            add(add(center, scale(u, -half)), scale(v, -half)),
            add(add(center, scale(u, half)), scale(v, -half)),
            add(add(center, scale(u, half)), scale(v, half)),
            add(add(center, scale(u, -half)), scale(v, half)),
        ],
        size: sizePixels * worldUnitsPerPixel,
        normal,
    };
}
