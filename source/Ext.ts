/**
 * A Scene View coordinate plane for an editable Gizmo position handle.
 */
declare global {
    type GizmoHandlePlane = 'xy' | 'xz' | 'yz' | 'view';
    type GizmoHandleSpace = 'local' | 'world';
    type GizmoHandleAxis = 'x' | 'y' | 'z';
    type GizmoHandlePhase = 'begin' | 'update' | 'end' | 'cancel';

    /**
     * Describes one editable Vec3 position in the Scene View.
     * Only the selected component's handles are displayed.
     */
    interface GizmoHandleDescriptor {
        /** Name of a Vec3 or Vec3[] property on the component. */
        property: string;
        /** Index of the point when the property contains an array of Vec3 values. */
        index?: number;
        /** Movement plane. Defaults to the node's XY plane. */
        plane?: GizmoHandlePlane;
        /** Local (default) or world-space point coordinates. */
        space?: GizmoHandleSpace;
        /** Lock movement to one axis in the selected coordinate space. */
        axis?: GizmoHandleAxis;
        /** Positive snap interval, expressed in the selected coordinate space. */
        snap?: number;
        /** Optional minimum and maximum values for each coordinate. */
        bounds?: {
            min?: { x?: number; y?: number; z?: number };
            max?: { x?: number; y?: number; z?: number };
        };
        /** Point marker color as a hexadecimal color string. */
        color?: string;
    }

    /** A set of editable position handles returned by onGizmoHandles(). */
    type GizmoHandleList = GizmoHandleDescriptor[];
}

declare module 'cc' {
    interface Component {
        /**
         * Draws Gizmos in the Scene View while the extension is enabled.
         * Keep Gizmos API calls inside this optional callback for type-only projects.
         */
        onDrawGizmos?(): void;

        /** Draws Gizmos while this component's node is selected. */
        onDrawGizmosSelected?(): void;

        /**
         * Defines editable Scene View position handles without a decorator.
         * Annotate the implementation as : GizmoHandleList to enable
         * completion for plane, space, axis, snap, bounds, and color.
         */
        onGizmoHandles?(): GizmoHandleList;

        /** Receives handle changes, including cancelled edits. */
        onGizmoChanged?(property: string, phase: GizmoHandlePhase, index?: number): void;
    }
}

export {};
