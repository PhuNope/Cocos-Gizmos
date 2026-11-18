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
        /** Optional snap interval; omit for continuous, unsnapped dragging. */
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
        visual?: 'point' | 'plane' | 'axis' | 'box' | 'rotation';
        /** Visible length of an axis arrow in Scene pixels (default 66). */
        axisSize?: number;
        /** Radius in Scene pixels used for easier axis/plane selection (default 24). */
        pickSize?: number;
        /** Highlight color while hovered or dragged, e.g. '#ffff55'. */
        hoverColor?: string;
        /** Show a live coordinate label above this property's position.
         * When several handles edit the same property, the label is drawn once.
         */
        showPositionLabel?: boolean;
        /** Label's vertical offset in screen pixels (default 82). */
        positionLabelOffset?: number;
        /** Selectable 3D object box side length in WORLD/local units.
         * Set on a move handle when the object already draws its own box.
         */
        boxSize?: number;
        /** Side length of the plane square in Scene pixels (default 18). */
        planeSize?: number;
        /** Offset of the square along its two axes in pixels (default 14). */
        planeOffset?: number;
        /** Optional Vec3 property for a rotation ring pivot, independent of the Euler property. */
        pivotProperty?: string;
        /** The pivot Vec3 is Path/Component local by default; 'world' is already global. */
        pivotSpace?: GizmoHandleSpace;
        /** Screen-pixel radius of a Rotation Gizmo ring (default 72). */
        ringSize?: number;
    }

    /** Settings for Gizmos3D.move(property, options). */

    interface GizmosMoveHandleOptions {
        /** Optional 3D selectable object box, e.g. 0.7 in the example. */
        boxSize?: number;
        space?: GizmoHandleSpace;
        snap?: number;
        axisSize?: number;
        pickSize?: number;
        planeSize?: number;
        planeOffset?: number;
        hoverColor?: string;
        showPositionLabel?: boolean;
        positionLabelOffset?: number;
        bounds?: GizmoHandleDescriptor['bounds'];
    }

    /** Settings for Gizmos3D.rotate(property, options): one Vec3 of Euler
     * angles in DEGREES. Rotation rings are centered on the Component node.
     * Local axes use node's world frame followed by the stored Euler rotation;
     * world axes stay aligned to global XYZ. The Vec3 belongs to the
     * Component, not to Node.eulerAngles unless the user applies it.
     */
    interface GizmosRotateHandleOptions {
        space?: GizmoHandleSpace;
        /** Snapping in angular degrees, e.g. 15; omitted = smooth rotation. */
        snap?: number;
        /** Vec3 position property on this Component used as the ring pivot. */
        pivotProperty?: string;
        pivotSpace?: GizmoHandleSpace;
        /** Radius in Scene pixels (24..180, default 72). */
        ringSize?: number;
        /** Size of transparent ring hit area in pixels (8..32, default 14). */
        pickSize?: number;
        hoverColor?: string;
    }
    /** Options for the single Z rotation ring of Gizmos2D.rotate(). */
    type GizmosRotate2DHandleOptions = GizmosRotateHandleOptions;

    /** Gizmos2D.move(): only X, Y and XY; no 3D body/box handle.
     * Uses the Move descriptor options without boxSize.
     */
    type GizmosMove2DHandleOptions = Omit<GizmosMoveHandleOptions, 'boxSize'>;

    /** Options for Gizmos2D.point() and Gizmos2D.points(). */
    interface GizmoPointOptions {
        plane?: GizmoHandlePlane;
        space?: GizmoHandleSpace;
        snap?: number;
        color?: string;
        pickSize?: number;
        bounds?: GizmoHandleDescriptor['bounds'];
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

    /** Visual dimensions within the shared 22px Scene picking row.
     * Values are bounded; width is capped by the available HUD column.
     * The separate slider width option refers to its TRACK, not its row.
     */
    type GizmoHudSize = 'small' | 'normal' | 'large' | {
        width?: number;
        height?: number;
    };

    /** Supported CSS-like camelCase visual styling. This is deliberately
     * smaller than CSSStyleDeclaration so layout and input routing stay in
     * sync. No HTML, position, transform or pointerEvents overrides.
     */
    interface GizmoHudDomStyle {
        color?: string;
        backgroundColor?: string;
        borderColor?: string;
        borderWidth?: number;
        borderRadius?: number;
        fontSize?: number;
        fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold' | 400 | 500 | 600 | 700;
        opacity?: number;
        padding?: number;
        letterSpacing?: number;
        textAlign?: 'left' | 'center' | 'right';
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
        size?: GizmoHudSize;
        style?: GizmoHudDomStyle;
    }

    /** Shared visual sizing and ordering for Scene HUD controls. Controls
     * stay inside their original 22px picking row to prevent overlap.
     */
    interface GizmoHudControlStyle {
        /** Reorder the controls following text rows; equal orders are stable. */
        order?: number;
        /** Font height in on-screen pixels, clamped to 10–18 (default 14). */
        fontSize?: number;
        /** Compactness preset or width/height in Scene pixels. */
        size?: GizmoHudSize;
        /** DOM-style visual overrides (camelCase CSS-like properties). */
        style?: GizmoHudDomStyle;
    }

    /** A clickable Scene View HUD button. */
    interface GizmoHudButton extends GizmoHudControlStyle {
        type: 'button';
        id: string;
        text: string;
        color?: string;
        /** Width of the button in Scene pixels. */
        width?: number;
    }

    /** A Scene View slider bound to a serialized numeric component property. */
    interface GizmoHudSlider extends GizmoHudControlStyle {
        type: 'slider';
        id: string;
        text: string;
        property: string;
        min: number;
        max: number;
        step?: number;
        color?: string;
        /** Slider track width in Scene pixels, shared with click picking. */
        width?: number;
    }

    /** A two-state switch bound to a serialized boolean property. */
    interface GizmoHudToggle extends GizmoHudControlStyle {
        type: 'toggle';
        id: string;
        text: string;
        property: string;
        color?: string;
    }

    /** A tickable box bound to a serialized boolean property. */
    interface GizmoHudCheckbox extends GizmoHudControlStyle {
        type: 'checkbox';
        id: string;
        text: string;
        property: string;
        color?: string;
    }

    /** Controls shown beside the component HUD text in the Scene View. */
    type GizmoHudControl = GizmoHudButton | GizmoHudSlider | GizmoHudToggle | GizmoHudCheckbox;
    type GizmoHudControlList = GizmoHudControl[];

    /** Flex-like layout primitives for the GizmoHUD builder. */
    type GizmoHudAlign = 'start' | 'center' | 'end' | 'stretch';
    type GizmoHudJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
    type GizmoHudPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    type GizmoHudTheme = 'dark' | 'light';
    interface GizmoHudGroupOptions {
        gap?: number;
        padding?: number;
        align?: GizmoHudAlign;
        justify?: GizmoHudJustify;
        style?: GizmoHudDomStyle;
    }
    interface GizmoHudRegisteredCommand {
        id: string;
        label?: string;
        shortcut?: string;
        canExecute?(context: any): boolean;
        execute(context: any): void;
    }
    interface GizmoHudElementHandle {
        setText(text: string): GizmoHudMount;
        setDisabled(disabled: boolean): GizmoHudMount;
        setVisible(visible: boolean): GizmoHudMount;
    }

    /** Commands are domain data; a renderer never directly mutates a property. */
    interface GizmoHudPropertyCommand {
        readonly kind: 'property';
        readonly property: string;
    }
    interface GizmoHudActionCommand {
        readonly kind: 'action';
        readonly execute: (component: any) => void;
        readonly commandId?: string;
    }
    interface GizmoHudValueCommand {
        readonly kind: 'value';
        readonly read: (component: any) => number | boolean;
        readonly write: (component: any, value: number | boolean) => void;
    }
    type GizmoHudCommand = GizmoHudPropertyCommand | GizmoHudActionCommand | GizmoHudValueCommand;

    interface GizmoHudItemOptions {
        style?: GizmoHudDomStyle;
        grow?: number;
        disabled?: boolean;
        visible?: boolean;
    }
    interface GizmoHudButtonOptions extends GizmoHudItemOptions {
        command: string | GizmoHudActionCommand;
        icon?: string;
        variant?: 'default' | 'primary' | 'danger';
    }
    interface GizmoHudValueInput extends GizmoHudItemOptions {
        property?: string;
        value?: number | boolean;
        onChange?(value: number | boolean): void;
    }
    interface GizmoHudSliderInput extends GizmoHudSliderOptions, GizmoHudValueInput {}
    interface GizmoHudSliderOptions extends GizmoHudItemOptions {
        min: number;
        max: number;
        step?: number;
    }
    interface GizmoHudContainer {
        readonly kind: 'row' | 'column';
        readonly id: string;
        readonly children: readonly GizmoHudNode[];
        readonly gap?: number;
        readonly padding?: number;
        readonly width?: number;
        readonly height?: number;
        readonly grow?: number;
        readonly shrink?: number;
        readonly basis?: number;
        readonly wrap?: boolean;
        readonly align?: GizmoHudAlign;
        readonly justify?: GizmoHudJustify;
        readonly style?: GizmoHudDomStyle;
    }
    interface GizmoHudTextNode {
        readonly kind: 'text';
        readonly id: string;
        readonly text: string;
        readonly style?: GizmoHudDomStyle;
        readonly grow?: number;
    }
    interface GizmoHudSeparatorNode {
        readonly kind: 'separator';
        readonly id: string;
        readonly text: '';
        readonly style?: GizmoHudDomStyle;
    }
    interface GizmoHudControlNode {
        readonly kind: 'button' | 'slider' | 'checkbox' | 'toggle';
        readonly id: string;
        readonly text: string;
        readonly command: GizmoHudCommand;
        readonly style?: GizmoHudDomStyle;
        readonly grow?: number;
        readonly icon?: string;
        readonly variant?: 'default' | 'primary' | 'danger';
        readonly disabled?: boolean;
        readonly visible?: boolean;
        readonly min?: number;
        readonly max?: number;
        readonly step?: number;
    }
    type GizmoHudNode = GizmoHudContainer | GizmoHudTextNode | GizmoHudSeparatorNode | GizmoHudControlNode;
    interface GizmoHudDefinition {
        readonly kind: 'hud';
        readonly id: string;
        readonly root: GizmoHudContainer;
        readonly position?: GizmoHudPosition;
        readonly theme?: GizmoHudTheme;
    }

    /** Fluent, DOM-independent flex layout builder.
     * build() returns a snapshot; no Editor DOM or Node is allocated.
     */
    interface GizmoHudBuilder {
        title(value: string): this;
        position(value: GizmoHudPosition): this;
        theme(value: GizmoHudTheme): this;
        size(width: number, height?: number | 'auto'): this;
        label(text: string, options?: GizmoHudItemOptions): this;
        separator(): this;
        width(value: number): this;
        height(value: number): this;
        grow(value?: number): this;
        shrink(value?: number): this;
        basis(value: number): this;
        wrap(value?: boolean): this;
        style(value: GizmoHudDomStyle): this;
        gap(value: number): this;
        padding(value: number): this;
        align(value: GizmoHudAlign): this;
        justify(value: GizmoHudJustify): this;
        row(id: string | GizmoHudGroupOptions, build: (row: GizmoHudBuilder) => void): this;
        column(id: string | GizmoHudGroupOptions, build: (column: GizmoHudBuilder) => void): this;
        text(id: string, text: string, options?: GizmoHudItemOptions): this;
        button(id: string, text: string, command: GizmoHudActionCommand,
            options?: GizmoHudItemOptions): this;
        button(label: string, options: GizmoHudButtonOptions): this;
        slider(id: string, text: string, command: GizmoHudPropertyCommand,
            options: GizmoHudSliderOptions): this;
        slider(label: string, options: GizmoHudSliderInput): this;
        toggle(id: string, text: string, command: GizmoHudPropertyCommand,
            options?: GizmoHudItemOptions): this;
        toggle(label: string, options: GizmoHudValueInput): this;
        checkbox(id: string, text: string, command: GizmoHudPropertyCommand,
            options?: GizmoHudItemOptions): this;
        checkbox(label: string, options: GizmoHudValueInput): this;
        mount(owner?: any): GizmoHudMount;
        build(): GizmoHudDefinition;
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

        /**
         * Controls this component's Scene drawing and HUD visibility.
         * Keep serialized Inspector properties on the component and return
         * their current values from this callback.
         */
        onGizmoSettings?(): GizmoViewSettings;

        /**
         * Returns informational HUD rows. size/style allow compact CSS-like
         * visual customization; stable IDs avoid unnecessary DOM updates.
         */
        onGizmoHud?(): GizmoHudItem[];

        /** Preferred v3 HUD API. Declarative layout and Command descriptors
         * created by GizmoHUD.createHud(). Old row callbacks are separate.
         */
        onGizmoHUD?(): GizmoHudDefinition;

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
