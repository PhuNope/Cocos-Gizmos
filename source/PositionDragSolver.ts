/** Geometry and constraints for Scene View position handles. */
export type HandleAxis = 'x' | 'y' | 'z';
export type HandlePlane = 'xy' | 'xz' | 'yz' | 'view';

export interface HandleVector3 {
    x: number;
    y: number;
    z: number;
}

export interface HandleRay {
    o: HandleVector3;
    d: HandleVector3;
}

export interface HandlePositionOptions {
    plane?: HandlePlane;
    axis?: HandleAxis;
    snap?: number;
    bounds?: {
        min?: Partial<HandleVector3>;
        max?: Partial<HandleVector3>;
    };
}

export interface HandleCoordinateSpace {
    toLocal(point: HandleVector3): HandleVector3;
    toWorld(point: HandleVector3): HandleVector3;
}

const AXES: HandleAxis[] = ['x', 'y', 'z'];

function finite(value: HandleVector3): boolean {
    return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function copy(value: HandleVector3): HandleVector3 {
    return { x: value.x, y: value.y, z: value.z };
}

function dot(a: HandleVector3, b: HandleVector3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: HandleVector3, b: HandleVector3): HandleVector3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: HandleVector3, b: HandleVector3): HandleVector3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function normalize(vector: HandleVector3): HandleVector3 | null {
    const length = Math.hypot(vector.x, vector.y, vector.z);
    if (!Number.isFinite(length) || length <= 1e-12) return null;
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export function intersectHandlePlane(
    ray: HandleRay,
    origin: HandleVector3,
    normal: HandleVector3,
): HandleVector3 | null {
    if (!finite(ray.o) || !finite(ray.d) || !finite(origin) || !finite(normal)) return null;
    const denominator = dot(ray.d, normal);
    if (Math.abs(denominator) <= 1e-10) return null;
    const distance = dot(sub(origin, ray.o), normal) / denominator;
    if (!Number.isFinite(distance) || distance < 0) return null;
    return {
        x: ray.o.x + distance * ray.d.x,
        y: ray.o.y + distance * ray.d.y,
        z: ray.o.z + distance * ray.d.z,
    };
}

export function handlePlaneNormal(
    plane: HandlePlane,
    space: HandleCoordinateSpace,
    origin: HandleVector3,
    cameraForward: HandleVector3,
): HandleVector3 | null {
    if (plane === 'view') return normalize(cameraForward);
    const localX = sub(space.toWorld({ x: origin.x + 1, y: origin.y, z: origin.z }), space.toWorld(origin));
    const localY = sub(space.toWorld({ x: origin.x, y: origin.y + 1, z: origin.z }), space.toWorld(origin));
    const localZ = sub(space.toWorld({ x: origin.x, y: origin.y, z: origin.z + 1 }), space.toWorld(origin));
    if (plane === 'xy') return normalize(cross(localX, localY));
    if (plane === 'xz') return normalize(cross(localZ, localX));
    return normalize(cross(localY, localZ));
}

/**
 * One drag session fixes its plane and original grab offset at pointer-down.
 * Movement has no hard-coded world-distance limit.
 */
export class PositionDragSolver {
    private readonly initial: HandleVector3;
    private readonly initialWorld: HandleVector3;
    private readonly planeNormal: HandleVector3;
    private readonly plane: HandlePlane;
    private readonly axis: HandleAxis | undefined;
    private readonly snap: number | undefined;
    private readonly bounds: HandlePositionOptions['bounds'];
    private grabOffset: HandleVector3 | null = null;

    constructor(
        position: HandleVector3,
        private readonly space: HandleCoordinateSpace,
        normal: HandleVector3,
        options: HandlePositionOptions = {},
    ) {
        if (!finite(position) || !finite(normal)) throw new Error('Invalid position handle coordinates');
        if (options.snap !== undefined && (!Number.isFinite(options.snap) || options.snap <= 0)) {
            throw new Error('Position handle snap must be positive');
        }
        for (const axis of AXES) {
            const min = options.bounds?.min?.[axis];
            const max = options.bounds?.max?.[axis];
            if ((min !== undefined && !Number.isFinite(min)) ||
                (max !== undefined && !Number.isFinite(max)) ||
                (min !== undefined && max !== undefined && min > max)) {
                throw new Error('Invalid position handle bounds');
            }
        }
        this.initial = copy(position);
        this.initialWorld = space.toWorld(position);
        this.planeNormal = copy(normal);
        this.plane = options.plane || 'xy';
        this.axis = options.axis;
        this.snap = options.snap;
        this.bounds = options.bounds;
    }

    public begin(ray: HandleRay): boolean {
        const hit = intersectHandlePlane(ray, this.initialWorld, this.planeNormal);
        if (!hit) return false;
        this.grabOffset = sub(this.initialWorld, hit);
        return true;
    }

    public move(ray: HandleRay): HandleVector3 | null {
        if (!this.grabOffset) return null;
        const hit = intersectHandlePlane(ray, this.initialWorld, this.planeNormal);
        if (!hit) return null;

        const local = this.space.toLocal({
            x: hit.x + this.grabOffset.x,
            y: hit.y + this.grabOffset.y,
            z: hit.z + this.grabOffset.z,
        });
        if (!finite(local)) return null;

        const allowed = this.axis ? [this.axis] :
            this.plane === 'xy' ? ['x', 'y'] :
            this.plane === 'xz' ? ['x', 'z'] :
            this.plane === 'yz' ? ['y', 'z'] : AXES;

        for (const axis of AXES) {
            if (!allowed.includes(axis)) {
                local[axis] = this.initial[axis];
                continue;
            }
            if (this.snap) local[axis] = Math.round(local[axis] / this.snap) * this.snap;
            const min = this.bounds?.min?.[axis];
            const max = this.bounds?.max?.[axis];
            if (min !== undefined) local[axis] = Math.max(min, local[axis]);
            if (max !== undefined) local[axis] = Math.min(max, local[axis]);
        }
        return finite(local) ? local : null;
    }

    public cancel(): HandleVector3 {
        return copy(this.initial);
    }
}
