import { GizmoEditHooks } from './GizmoEditSession';
import { GizmoMoveCommand, GizmoValuePort } from './GizmoMoveCommand';
import {
    HandleCoordinateSpace, HandlePositionOptions, HandleVector3,
} from './PositionDragSolver';
import { GizmoRotateCommand } from './GizmoRotateCommand';
import { RotateQuat, RotateVec3 } from './RotationHandleGeometry';
import { RotationDragOptions, RotationScreenFallback } from './RotationDragSolver';

/**
 * Fluent application-layer factories. Creator-specific adapters supply the
 * value port and edit hooks; geometry and commands stay Editor-independent.
 *
 * Builders are single-use configurations by convention. build() snapshots
 * configuration so future mutations cannot change a running gesture.
 */
export class MoveCommandBuilder {
    private position?: HandleVector3;
    private coordinates?: HandleCoordinateSpace;
    private normal?: HandleVector3;
    private options: HandlePositionOptions = {};
    private port?: GizmoValuePort;
    private callbacks?: GizmoEditHooks<HandleVector3>;

    public initial(value: HandleVector3): this {
        this.position = { ...value }; return this;
    }
    public space(value: HandleCoordinateSpace): this {
        this.coordinates = value; return this;
    }
    public planeNormal(value: HandleVector3): this {
        this.normal = { ...value }; return this;
    }
    public constraints(value: HandlePositionOptions): this {
        this.options = {
            ...value,
            bounds: value.bounds ? {
                min: value.bounds.min ? { ...value.bounds.min } : undefined,
                max: value.bounds.max ? { ...value.bounds.max } : undefined,
            } : undefined,
        };
        return this;
    }
    public value(value: GizmoValuePort): this {
        this.port = value; return this;
    }
    public hooks(value: GizmoEditHooks<HandleVector3>): this {
        this.callbacks = value; return this;
    }
    public build(): GizmoMoveCommand {
        if (!this.position || !this.coordinates || !this.normal || !this.port || !this.callbacks)
            throw new Error('MoveCommandBuilder: initial, space, planeNormal, value and hooks are required');
        return new GizmoMoveCommand(
            { ...this.position }, this.coordinates, { ...this.normal },
            this.constraintsSnapshot(), this.port, this.callbacks,
        );
    }
    private constraintsSnapshot(): HandlePositionOptions {
        const c = this.options;
        return {
            ...c,
            bounds: c.bounds ? {
                min: c.bounds.min ? { ...c.bounds.min } : undefined,
                max: c.bounds.max ? { ...c.bounds.max } : undefined,
            } : undefined,
        };
    }
}

export class RotateCommandBuilder {
    private position?: RotateVec3;
    private center?: RotateVec3;
    private normal?: RotateVec3;
    private rotationFrame?: RotateQuat;
    private options?: RotationDragOptions;
    private port?: GizmoValuePort;
    private callbacks?: GizmoEditHooks<RotateVec3>;
    private screen?: RotationScreenFallback | null;

    public initial(value: RotateVec3): this { this.position = { ...value }; return this; }
    public pivot(value: RotateVec3): this { this.center = { ...value }; return this; }
    public axisNormal(value: RotateVec3): this { this.normal = { ...value }; return this; }
    public frame(value: RotateQuat): this { this.rotationFrame = { ...value }; return this; }
    public constraints(value: RotationDragOptions): this { this.options = { ...value }; return this; }
    public value(value: GizmoValuePort): this { this.port = value; return this; }
    public hooks(value: GizmoEditHooks<RotateVec3>): this { this.callbacks = value; return this; }
    public screenFallback(value: RotationScreenFallback | null): this {
        this.screen = value ? { tangent: { ...value.tangent }, radiusPixels: value.radiusPixels } : null;
        return this;
    }
    public build(): GizmoRotateCommand {
        if (!this.position || !this.center || !this.normal || !this.rotationFrame ||
            !this.options || !this.port || !this.callbacks)
            throw new Error('RotateCommandBuilder: initial, pivot, axisNormal, frame, constraints, value and hooks are required');
        return new GizmoRotateCommand(
            { ...this.position }, { ...this.center }, { ...this.normal },
            { ...this.rotationFrame }, { ...this.options },
            this.port, this.callbacks,
            this.screen ? { tangent: { ...this.screen.tangent }, radiusPixels: this.screen.radiusPixels } : this.screen,
        );
    }
}

/** Namespace-style, discoverable entry point for new command consumers. */
export const GizmoCommands = {
    move: (): MoveCommandBuilder => new MoveCommandBuilder(),
    rotate: (): RotateCommandBuilder => new RotateCommandBuilder(),
};
