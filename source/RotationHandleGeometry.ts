/**
 * Rotation-gizmo geometry and Euler math independent of Cocos rendering.
 * Quaternions follow Cocos Creator 3.8's YZX Euler convention (degrees).
 * The component's Node world rotation is the reference frame of a Vec3
 * Euler property; local rings follow frame*property, world rings stay fixed.
 */
export type RotateAxis = 'x' | 'y' | 'z';
export type RotateSpace = 'local' | 'world';
export type RotateVec3 = { x: number; y: number; z: number };
export type RotateQuat = { x: number; y: number; z: number; w: number };
export type RotateRay = { o: RotateVec3; d: RotateVec3 };
export type RotateRing = {
    center: RotateVec3;
    normal: RotateVec3;
    u: RotateVec3;
    v: RotateVec3;
    radius: number;
    points: RotateVec3[];
};
export const ROTATE_IDENTITY: RotateQuat = { x: 0, y: 0, z: 0, w: 1 };
const EPS = 1e-8;
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export function rotateDot(a: RotateVec3, b: RotateVec3): number {
    return a.x*b.x + a.y*b.y + a.z*b.z;
}
export function rotateSub(a: RotateVec3, b: RotateVec3): RotateVec3 {
    return { x: a.x-b.x, y: a.y-b.y, z: a.z-b.z };
}
export function rotateCross(a: RotateVec3, b: RotateVec3): RotateVec3 {
    return {
        x: a.y*b.z-a.z*b.y,
        y: a.z*b.x-a.x*b.z,
        z: a.x*b.y-a.y*b.x,
    };
}
export function rotateUnit(v: RotateVec3): RotateVec3 | null {
    const l = Math.hypot(v.x, v.y, v.z);
    return Number.isFinite(l) && l > EPS ?
        { x: v.x/l, y: v.y/l, z: v.z/l } : null;
}
export function rotateQuatUnit(q: RotateQuat): RotateQuat {
    const l = Math.hypot(q.x, q.y, q.z, q.w);
    if (!Number.isFinite(l) || l <= EPS) return { ...ROTATE_IDENTITY };
    return { x: q.x/l, y: q.y/l, z: q.z/l, w: q.w/l };
}
export function rotateQuatMul(a: RotateQuat, b: RotateQuat): RotateQuat {
    return {
        x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
        w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    };
}
export function rotateQuatInverse(q: RotateQuat): RotateQuat {
    const p = rotateQuatUnit(q);
    return { x: -p.x, y: -p.y, z: -p.z, w: p.w };
}
export function rotateEulerQuat(value: RotateVec3): RotateQuat {
    const x = value.x*RAD/2, y = value.y*RAD/2, z = value.z*RAD/2;
    const sx = Math.sin(x), cx = Math.cos(x);
    const sy = Math.sin(y), cy = Math.cos(y);
    const sz = Math.sin(z), cz = Math.cos(z);
    return {
        x: sx*cy*cz + cx*sy*sz,
        y: cx*sy*cz + sx*cy*sz,
        z: cx*cy*sz - sx*sy*cz,
        w: cx*cy*cz - sx*sy*sz,
    };
}
export function rotateQuatEuler(q0: RotateQuat): RotateVec3 {
    const {x,y,z,w} = rotateQuatUnit(q0);
    const test = x*y+z*w;
    if (test > 0.499999)
        return {x: 0, y: 2*Math.atan2(x,w)*DEG, z: 90};
    if (test < -0.499999)
        return {x: 0, y: -2*Math.atan2(x,w)*DEG, z: -90};
    return {
        x: Math.atan2(2*x*w-2*y*z, 1-2*x*x-2*z*z)*DEG,
        y: Math.atan2(2*y*w-2*x*z, 1-2*y*y-2*z*z)*DEG,
        z: Math.asin(Math.max(-1, Math.min(1, 2*test)))*DEG,
    };
}
export function rotateAxisVector(axis: RotateAxis): RotateVec3 {
    return axis === 'x' ? {x:1,y:0,z:0} :
        axis === 'y' ? {x:0,y:1,z:0} : {x:0,y:0,z:1};
}
export function rotateAxisQuat(axis: RotateVec3, degrees: number): RotateQuat {
    const half = degrees*RAD/2, s = Math.sin(half);
    return { x: axis.x*s, y: axis.y*s, z: axis.z*s, w: Math.cos(half) };
}
export function rotateQuatVector(q0: RotateQuat, v: RotateVec3): RotateVec3 {
    const q = rotateQuatUnit(q0);
    const t = rotateCross({x:q.x,y:q.y,z:q.z}, v);
    const u = rotateCross({x:q.x,y:q.y,z:q.z}, t);
    return {x:v.x+2*(q.w*t.x+u.x),
        y:v.y+2*(q.w*t.y+u.y),
        z:v.z+2*(q.w*t.z+u.z)};
}
export function rotateBasis(
    euler: RotateVec3, frame: RotateQuat, space: RotateSpace,
): { x: RotateVec3; y: RotateVec3; z: RotateVec3 } {
    const orientation = space === 'world' ? ROTATE_IDENTITY :
        rotateQuatMul(rotateQuatUnit(frame), rotateEulerQuat(euler));
    return {
        x: rotateQuatVector(orientation, rotateAxisVector('x')),
        y: rotateQuatVector(orientation, rotateAxisVector('y')),
        z: rotateQuatVector(orientation, rotateAxisVector('z')),
    };
}

/** A 64-segment circle aligned to the selected object/world rotation. */
export function rotationRingGeometry(
    center: RotateVec3, basis: {x:RotateVec3;y:RotateVec3;z:RotateVec3},
    axis: RotateAxis, radius: number, segments = 64,
): RotateRing | null {
    if (!Number.isFinite(radius) || radius <= EPS ||
        !Number.isFinite(segments) || segments < 12 || segments > 128) return null;
    const u = rotateUnit(basis[axis === 'x' ? 'y' : axis === 'y' ? 'z' : 'x']);
    const rawV = rotateUnit(basis[axis === 'x' ? 'z' : axis === 'y' ? 'x' : 'y']);
    const normal = rotateUnit(basis[axis]);
    if (!u || !rawV || !normal) return null;
    // Keep circles orthonormal even when supplied with a scaled basis.
    const v = rotateUnit(rotateCross(normal, u));
    if (!v) return null;
    const points: RotateVec3[] = [];
    for (let i=0; i<=segments; i++) {
        const a = i*2*Math.PI/segments;
        const c = Math.cos(a)*radius, s = Math.sin(a)*radius;
        points.push({x:center.x+u.x*c+v.x*s,
            y:center.y+u.y*c+v.y*s, z:center.z+u.z*c+v.z*s});
    }
    return {center, normal, u, v, radius, points};
}
export function rotationRingDistanceSquared(
    point: {x:number;y:number},
    projected: readonly {x:number;y:number}[],
): number {
    if (projected.length < 2) return Infinity;
    let minimum = Infinity;
    for (let i=1;i<projected.length;i++) {
        const a=projected[i-1], b=projected[i];
        const dx=b.x-a.x, dy=b.y-a.y;
        const length=dx*dx+dy*dy;
        if (!Number.isFinite(length) || length <= EPS) continue;
        const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length));
        const x=a.x+t*dx, y=a.y+t*dy;
        minimum=Math.min(minimum,(point.x-x)**2+(point.y-y)**2);
    }
    return minimum;
}
