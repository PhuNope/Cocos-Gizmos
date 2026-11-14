/** Lightweight screen-facing feather ribbons for Scene Move gizmos.
 * The outer 1px band is alpha-blended beneath the solid center, avoiding
 * razor-sharp 1px GeometryRenderer edges without changing Editor MSAA.
 * All output coordinates are WORLD-space and independent of viewport zoom.
 */
export type MoveStrokePoint = { x: number; y: number; z: number };
export type MoveStrokeQuad = [
    MoveStrokePoint, MoveStrokePoint, MoveStrokePoint, MoveStrokePoint
];
export interface MoveStrokeBands {
    feather: MoveStrokeQuad;
    core: MoveStrokeQuad;
}
const sub = (a: MoveStrokePoint, b: MoveStrokePoint): MoveStrokePoint =>
    ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: MoveStrokePoint, b: MoveStrokePoint): MoveStrokePoint =>
    ({ x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const shift = (p: MoveStrokePoint, d: MoveStrokePoint, distance: number): MoveStrokePoint =>
    ({ x: p.x + d.x * distance, y: p.y + d.y * distance, z: p.z + d.z * distance });

export function moveStrokeBands(
    a: MoveStrokePoint, b: MoveStrokePoint, cameraForward: MoveStrokePoint,
    worldPerPixel: number, solidPixels = 1.7, featherPixels = 1.25,
): MoveStrokeBands | null {
    if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0 ||
        !Number.isFinite(solidPixels) || solidPixels <= 0 ||
        !Number.isFinite(featherPixels) || featherPixels < 0) return null;
    const axis = sub(b, a);
    // GeometryRenderer 3.8 draws solid quads as front-facing triangles.
    // cross(axis,forward) reversed the winding from the Scene camera:
    // all Move3D arrows were backface-culled and thus invisible.
    const side = cross(cameraForward, axis);
    const length = Math.hypot(side.x, side.y, side.z);
    if (!Number.isFinite(length) || length < 1e-12) return null;
    const unit = { x: side.x / length, y: side.y / length, z: side.z / length };
    const quad = (width: number): MoveStrokeQuad => [
        shift(a, unit, width), shift(b, unit, width),
        shift(b, unit, -width), shift(a, unit, -width),
    ];
    return {
        core: quad(worldPerPixel * solidPixels * 0.5),
        feather: quad(worldPerPixel * (solidPixels * 0.5 + featherPixels)),
    };
}
