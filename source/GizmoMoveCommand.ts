import { GizmoEditHooks, GizmoEditSession } from './GizmoEditSession';
import {
    HandleCoordinateSpace, HandlePositionOptions, HandleRay, HandleVector3,
    PositionDragSolver,
} from './PositionDragSolver';

/**
 * Application command: one drag equals one undoable edit transaction.
 *
 * Ports instead of Creator globals keep this class independent of the
 * inspector, component lifecycle, camera, and renderer.
 * - Scene adapter turns native pointer coordinates into HandleRay.
 * - PositionDragSolver owns plane/axis geometry and snapping.
 * - GizmoEditSession owns snapshot, no-op detection, commit and rollback.
 * - GizmoMoveCommand orchestrates those two dependencies.
 */
export interface GizmoValuePort {
    read(): HandleVector3;
    write(value: HandleVector3): void;
}

export interface GizmoCommand {
    readonly active: boolean;
    begin(ray: HandleRay): boolean;
    update(ray: HandleRay): boolean;
    end(): boolean;
    cancel(): boolean;
}

export class GizmoMoveCommand implements GizmoCommand {
    private readonly solver: PositionDragSolver;
    private readonly session: GizmoEditSession<HandleVector3>;

    constructor(
        initial: HandleVector3,
        space: HandleCoordinateSpace,
        planeNormal: HandleVector3,
        constraints: HandlePositionOptions,
        value: GizmoValuePort,
        hooks: GizmoEditHooks<HandleVector3>,
    ) {
        this.solver = new PositionDragSolver(initial, space, planeNormal, constraints);
        this.session = new GizmoEditSession<HandleVector3>(
            () => value.read(),
            next => value.write(next),
            hooks,
        );
    }

    public get active(): boolean {
        return this.session.isActive;
    }

    public begin(ray: HandleRay): boolean {
        if (this.active || !this.solver.begin(ray)) return false;
        return this.session.begin();
    }

    public update(ray: HandleRay): boolean {
        if (!this.active) return false;
        const next = this.solver.move(ray);
        return next !== null && this.session.apply(next);
    }

    public end(): boolean {
        return this.session.finish();
    }

    public cancel(): boolean {
        return this.session.finish(true);
    }
}
