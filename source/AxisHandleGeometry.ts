/** A three-ray move manipulator: constant apparent size during Scene zoom.
 * Geometry is expressed in world coordinates so local/world Node transforms
 * are both supported. The same segment is used for drawing and hit testing.
 */
export type Axis3D = 'x' | 'y' | 'z';
export type AxisPoint = { x: number; y: number; z: number };
export type AxisBasis = { x: AxisPoint; y: AxisPoint; z: AxisPoint };

const add = (a: AxisPoint, b: AxisPoint): AxisPoint =>
    ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: AxisPoint, s: number): AxisPoint =>
    ({ x: a.x * s, y: a.y * s, z: a.z * s });
const minus = (a: AxisPoint, b: AxisPoint): AxisPoint =>
    ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: AxisPoint, b: AxisPoint): number =>
    a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: AxisPoint, b: AxisPoint): AxisPoint =>
    ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z,
       z: a.x * b.y - a.y * b.x });

export function axisUnit(v: AxisPoint): AxisPoint | null {
    const len = Math.hypot(v.x, v.y, v.z);
    if (!Number.isFinite(len) || len < 1e-9) return null;
    return scale(v, 1 / len);
}

export interface AxisRayGeometry {
    start: AxisPoint;
    end: AxisPoint;
    center: AxisPoint;
    tipLeft: AxisPoint;
    tipRight: AxisPoint;
    size: number;
    pixelWidth: number;
    unit: AxisPoint;
}

/** Draw a compact 78px ray, leaving 10px at the origin free of overlap.
 * The arrow tip has two visible 9px wings. It does not render extra dots.
 */
export function axisHandleGeometry(
    origin: AxisPoint, basis: AxisBasis, axis: Axis3D,
    worldPerPixel: number, lengthPixels = 78,
): AxisRayGeometry | null {
    if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0 ||
        !Number.isFinite(lengthPixels) || lengthPixels < 24 ||
        lengthPixels > 200) return null;
    const u = axisUnit(basis[axis]);
    if (!u) return null;
    const length = worldPerPixel * lengthPixels;
    const start = add(origin, scale(u, worldPerPixel * 10));
    const end = add(origin, scale(u, length));
    const center = add(origin, scale(u, length * 0.57));
    // Choose a stable perpendicular that also works when looking down an axis.
    const helper = Math.abs(u.z) > 0.89 ? { x: 0, y: 1, z: 0 } :
        { x: 0, y: 0, z: 1 };
    const side = axisUnit(cross(u, helper)) || { x: 0, y: 1, z: 0 };
    const back = add(origin, scale(u, length - worldPerPixel * 12));
    return {
        start, end, center,
        tipLeft: add(back, scale(side, worldPerPixel * 7)),
        tipRight: add(back, scale(side, -worldPerPixel * 7)),
        size: worldPerPixel * 24,
        pixelWidth: 13,
        unit: u,
    };
}

/** Squared distance to a projected ray (in Scene pixels).
 * The 10px center exclusion avoids overlapping the other two rays.
 */
export function axisSegmentDistanceSquared(
    point: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denom = dx * dx + dy * dy;
    if (denom <= 1e-8) return Number.POSITIVE_INFINITY;
    const t = Math.max(0, Math.min(1,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / denom));
    const x = a.x + t * dx - point.x;
    const y = a.y + t * dy - point.y;
    return x * x + y * y;
}

/** Drag on the plane containing the axis and facing the Scene camera.
 * Unlike an arbitrary fixed XY/XZ/YZ plane this remains responsive when
 * the user orbits/pans the editor while keeping the axis locked.
 */
export function axisDragNormal(
    direction: AxisPoint, cameraForward: AxisPoint,
): AxisPoint | null {
    const axis = axisUnit(direction);
    const forward = axisUnit(cameraForward);
    if (!axis || !forward) return null;
    const projected = minus(forward, scale(axis, dot(forward, axis)));
    const normal = axisUnit(projected);
    if (normal) return normal;
    const helper = Math.abs(axis.y) < 0.9 ?
        { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    return axisUnit(cross(axis, helper));
}
