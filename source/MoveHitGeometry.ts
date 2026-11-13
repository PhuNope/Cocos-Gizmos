/** Pure viewport hit math for the Creator-style Move gizmo.
 * The renderer, fallback picking and native picking use the same projected
 * axis/plane/box geometry; this module has no Cocos dependencies.
 */
export type ScreenPoint = { x: number; y: number };
export type ScreenRect = { left: number; right: number; bottom: number; top: number };
const valid = (p: ScreenPoint): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

export function boundsOf(points: readonly ScreenPoint[]): ScreenRect | null {
    if (!points.length || !points.every(valid)) return null;
    return {
        left: Math.min(...points.map(p => p.x)),
        right: Math.max(...points.map(p => p.x)),
        bottom: Math.min(...points.map(p => p.y)),
        top: Math.max(...points.map(p => p.y)),
    };
}

export function rectContains(point: ScreenPoint, rect: ScreenRect, inset = 0): boolean {
    return valid(point) &&
        point.x >= rect.left - inset && point.x <= rect.right + inset &&
        point.y >= rect.bottom - inset && point.y <= rect.top + inset;
}

export function distanceToSegmentSquared(
    point: ScreenPoint, a: ScreenPoint, b: ScreenPoint,
): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    if (!valid(point) || !valid(a) || !valid(b) || length < 1e-5)
        return Number.POSITIVE_INFINITY;
    const ratio = Math.min(1, Math.max(0,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    const x = a.x + ratio * dx - point.x;
    const y = a.y + ratio * dy - point.y;
    return x * x + y * y;
}

/** Convex polygon; accepts either clockwise or counterclockwise winding.
 * Small edge padding makes tilted plane squares easy to click without
 * enlarging the geometry enough to overlap neighboring axis handles.
 */
export function insideProjectedPlane(
    point: ScreenPoint, corners: readonly ScreenPoint[], padding = 3,
): boolean {
    if (corners.length !== 4 || !corners.every(valid) || !valid(point)) return false;
    let orientation = 0;
    let twiceArea = 0;
    for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const edgeX = b.x - a.x, edgeY = b.y - a.y;
        const length = Math.hypot(edgeX, edgeY);
        if (length <= 1e-5) return false;
        twiceArea += a.x * b.y - b.x * a.y;
        const cross = edgeX * (point.y - a.y) - edgeY * (point.x - a.x);
        if (cross > padding * length) {
            if (orientation < 0) return false;
            orientation = 1;
        } else if (cross < -padding * length) {
            if (orientation > 0) return false;
            orientation = -1;
        }
    }
    return Math.abs(twiceArea) > 2;
}

/** Convert the same point to a stable screen-space score; smaller wins. */
export function centerDistanceSquared(
    point: ScreenPoint, rect: ScreenRect,
): number {
    const dx = point.x - (rect.left + rect.right) * 0.5;
    const dy = point.y - (rect.bottom + rect.top) * 0.5;
    return dx * dx + dy * dy;
}
