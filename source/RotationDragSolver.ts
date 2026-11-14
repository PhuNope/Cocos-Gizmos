import {
    RotateAxis, RotateQuat, RotateRay, RotateSpace, RotateVec3,
    rotateAxisQuat, rotateAxisVector, rotateCross, rotateDot, rotateEulerQuat,
    rotateQuatEuler, rotateQuatInverse, rotateQuatMul, rotateQuatUnit,
    rotateSub, rotateUnit,
} from './RotationHandleGeometry';

export interface RotationScreenFallback {
    /** Unit vector in the direction of a projected ring diameter. */
    tangent: {x:number;y:number};
    /** Scene View ring radius in screen pixels. */
    radiusPixels: number;
}
export interface RotationDragOptions {
    axis: RotateAxis;
    space?: RotateSpace;
    snap?: number; // angle steps in degrees
    twoD?: boolean;
}
/** A single stable rotation plane is captured at mouse-down.
 * Accumulate signed angle changes to cross +/-180 and complete full turns.
 * Quaternion composition makes world-axis and local-axis rotation different
 * even if the Euler property contains multiple nonzero components.
 */
export class RotationDragSolver {
    private previous: RotateVec3 | null = null;
    private totalDegrees = 0;
    private screenStart: {x:number;y:number} | null = null;
    private readonly useScreen: boolean;
    private readonly normal: RotateVec3;
    private readonly initialQuat: RotateQuat;
    private readonly frame: RotateQuat;
    constructor(
        private readonly initial: RotateVec3,
        private readonly center: RotateVec3,
        normal: RotateVec3,
        frame: RotateQuat,
        private readonly options: RotationDragOptions,
        private readonly screenFallback?: RotationScreenFallback | null,
    ) {
        const unit = rotateUnit(normal);
        if (!unit || ![initial.x,initial.y,initial.z].every(Number.isFinite))
            throw new Error('Rotation axis or Euler property is invalid');
        if (options.snap !== undefined &&
            (!Number.isFinite(options.snap) || options.snap <= 0))
            throw new Error('Rotation snap must be a positive angle');
        this.normal = unit;
        this.frame = rotateQuatUnit(frame);
        this.initialQuat = rotateEulerQuat(initial);
        // An X/Y rotation plane becomes edge-on as the Scene camera faces Z.
        // Ray/plane intersections are undefined then; use a stable screen
        // projection of the ring as an Editor-style gesture fallback.
        if (screenFallback && (!Number.isFinite(screenFallback.radiusPixels) ||
            screenFallback.radiusPixels <= 0 ||
            !Number.isFinite(screenFallback.tangent.x) ||
            !Number.isFinite(screenFallback.tangent.y)))
            throw new Error('Invalid rotation screen fallback');
        this.useScreen = !!screenFallback;
    }
    private onPlane(ray: RotateRay): RotateVec3 | null {
        const denom = rotateDot(this.normal,ray.d);
        if (!Number.isFinite(denom) || Math.abs(denom)<1e-6) return null;
        const t = rotateDot(this.normal,rotateSub(this.center,ray.o))/denom;
        if (!Number.isFinite(t) || t < 0) return null;
        const hit={x:ray.o.x+t*ray.d.x,y:ray.o.y+t*ray.d.y,
            z:ray.o.z+t*ray.d.z};
        return rotateUnit(rotateSub(hit,this.center));
    }
    public begin(ray: RotateRay, pointer?: {x:number;y:number}): boolean {
        this.totalDegrees=0;
        this.screenStart=null;
        this.previous=null;
        const facing = Math.abs(rotateDot(this.normal,ray.d)) /
            Math.max(1e-8,Math.hypot(ray.d.x,ray.d.y,ray.d.z));
        if (facing >= 0.08)
            this.previous=this.onPlane(ray);
        if(this.previous) return true;
        if(this.useScreen && pointer &&
            Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
            this.screenStart={x:pointer.x,y:pointer.y};
            return true;
        }
        return false;
    }
    public move(ray: RotateRay, pointer?: {x:number;y:number}): RotateVec3 | null {
        if (this.screenStart) {
            if(!pointer || !this.screenFallback) return null;
            const vector=this.screenFallback.tangent;
            const pixels=(pointer.x-this.screenStart.x)*vector.x +
                (pointer.y-this.screenStart.y)*vector.y;
            this.totalDegrees=pixels/this.screenFallback.radiusPixels*180/Math.PI;
        } else {
            if (!this.previous) return null;
            const next=this.onPlane(ray);
            if (!next) return null;
            const sine=rotateDot(this.normal,rotateCross(this.previous,next));
            const cosine=rotateDot(this.previous,next);
            const incremental=Math.atan2(sine,cosine)*180/Math.PI;
            if (!Number.isFinite(incremental)) return null;
            this.totalDegrees+=incremental;
            this.previous=next;
        }
        const delta=this.options.snap ?
            Math.round(this.totalDegrees/this.options.snap)*this.options.snap :
            this.totalDegrees;
        if (this.options.twoD) {
            return {x:this.initial.x,y:this.initial.y,
                z:this.initial.z+delta};
        }
        const axis=rotateAxisVector(this.options.axis);
        const rotation=this.options.space === 'world' ?
            rotateQuatMul(
                rotateQuatMul(
                    rotateQuatInverse(this.frame),rotateAxisQuat(axis,delta)),
                rotateQuatMul(this.frame,this.initialQuat)) :
            rotateQuatMul(this.initialQuat,rotateAxisQuat(axis,delta));
        const euler=rotateQuatEuler(rotation);
        return [euler.x,euler.y,euler.z].every(Number.isFinite) ? euler : null;
    }
    public cancel(): RotateVec3 {
        return {...this.initial};
    }
}
