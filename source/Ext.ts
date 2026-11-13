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
        /** Unique identifier when multiple handles edit the same Vec3. */
        id?: string;
        /** Compact axis-arrow handle, plane tile, or a single point.
         * For 'axis' set axis: 'x' | 'y' | 'z'. Three axis handles can
         * reference the same Vec3 property using distinct ids.
         */
        visual?: 'point' | 'plane' | 'axis';
        /** Visible length of an axis arrow in Scene pixels (default 78). */
        axisSize?: number;
        /** Radius in Scene pixels used for easier axis/plane selection (default 23). */
        pickSize?: number;
        /** Highlight color while hovered or dragged, e.g. '#ffff55'. */
        hoverColor?: string;
        /** Show a live coordinate label above this property's position.
         * When several handles edit the same property, the label is drawn once.
         */
        showPositionLabel?: boolean;
        /** Label's vertical offset in screen pixels (default 92). */
        positionLabelOffset?: number;
        /** Side length of the plane square in Scene pixels (default 36). */
        planeSize?: number;
        /** Offset of the square along its two axes in pixels (default 48). */
        planeOffset?: number;
    }

    /** Controls when a component draws in the Scene View. */
    type GizmoDisplayMode = 'always' | 'selected' | 'off';

    /** Per-component Gizmo rendering and HUD visibility. */
    interface GizmoViewSettings {
        /** Draw on every Scene frame, only while selected, or never. */
        display?: GizmoDisplayMode;
        /** Draw HUD for selected nodes, all nodes, or never. */
        hud?: 'selected' | 'always' | 'off';
    }

    /** Screen-space text attached to a component in the Scene View. */
    interface GizmoHudItem {
        /** Stable identifier for reusing the label across Scene frames. */
        id: string;
        /** Text to display beside the component in the Scene View. */
        text: string;
        /** Order within the component HUD. */
        order?: number;
        /** Preferred font height in screen pixels (default 14). */
        fontSize?: number;
        /** Minimum screen font height while zooming (default 12 pixels). */
        minSize?: number;
        /** Maximum screen font height while zooming (default 24 pixels). */
        maxSize?: number;
        /** RGBA hexadecimal color for the text. */
        color?: string;
    }

    /** A clickable Scene View HUD button. */
    interface GizmoHudButton {
        type: 'button';
        id: string;
        text: string;
        color?: string;
    }

    /** A Scene View slider bound to a serialized numeric component property. */
    interface GizmoHudSlider {
        type: 'slider';
        id: string;
        text: string;
        property: string;
        min: number;
        max: number;
        step?: number;
        color?: string;
    }

    /** A two-state switch bound to a serialized boolean property. */
    interface GizmoHudToggle {
        type: 'toggle';
        id: string;
        text: string;
        property: string;
        color?: string;
    }

    /** A tickable box bound to a serialized boolean property. */
    interface GizmoHudCheckbox {
        type: 'checkbox';
        id: string;
        text: string;
        property: string;
        color?: string;
    }

    /** Controls shown beside the component HUD text in the Scene View. */
    type GizmoHudControl = GizmoHudButton | GizmoHudSlider | GizmoHudToggle | GizmoHudCheckbox;
    type GizmoHudControlList = GizmoHudControl[];

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

        /**
         * Controls this component's Scene drawing and HUD visibility.
         * Keep serialized Inspector properties on the component and return
         * their current values from this callback.
         */
        onGizmoSettings?(): GizmoViewSettings;

        /**
         * Returns informational text labels anchored near this node in Scene View.
         * Entries with stable IDs reuse the same Label components across frames.
         */
        onGizmoHud?(): GizmoHudItem[];

        /** Defines buttons, sliders, toggles and checkboxes in the Scene HUD. */
        onGizmoHudControls?(): GizmoHudControlList;

        /** Invoked once when the corresponding HUD button is clicked. */
        onGizmoHudAction?(id: string): void;

        /** Invoked when a HUD slider, toggle or checkbox changes its component property. */
        onGizmoHudChanged?(property: string, phase: GizmoHandlePhase, value: number | boolean): void;

        /** Receives handle changes, including cancelled edits. */
        onGizmoChanged?(property: string, phase: GizmoHandlePhase, index?: number): void;
    }
}

export {};
