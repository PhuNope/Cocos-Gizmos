import { GizmoEditHooks, GizmoEditSession } from './GizmoEditSession';
import { RotateQuat, RotateRay, RotateVec3 } from './RotationHandleGeometry';
import { RotationDragOptions, RotationDragSolver, RotationScreenFallback } from './RotationDragSolver';
import { GizmoValuePort, GizmoCommand } from './GizmoMoveCommand';

/** Undoable Euler-angle rotation command with the same lifecycle as Move. */
export class GizmoRotateCommand implements GizmoCommand {
    private readonly solver: RotationDragSolver;
    private readonly session: GizmoEditSession<RotateVec3>;
    constructor(
        initial: RotateVec3,
        pivot: RotateVec3,
        normal: RotateVec3,
        frame: RotateQuat,
        options: RotationDragOptions,
        value: GizmoValuePort,
        hooks: GizmoEditHooks<RotateVec3>,
        fallback?: RotationScreenFallback | null,
    ) {
        this.solver = new RotationDragSolver(initial,pivot,normal,frame,options,fallback);
        this.session = new GizmoEditSession<RotateVec3>(
            () => value.read(), next => value.write(next), hooks,
        );
    }
    public get active(): boolean { return this.session.isActive; }
    public begin(ray: RotateRay, pointer?: {x:number;y:number}): boolean {
        return !this.active && this.solver.begin(ray,pointer) && this.session.begin();
    }
    public update(ray: RotateRay, pointer?: {x:number;y:number}): boolean {
        if (!this.active) return false;
        const next = this.solver.move(ray,pointer);
        return next !== null && this.session.apply(next);
    }
    public end(): boolean { return this.session.finish(); }
    public cancel(): boolean { return this.session.finish(true); }
}
