declare module 'cc' {
    interface Component {
        /**
         * Draws Gizmos in the Scene View while the Gizmos extension is enabled.
         * This optional callback does not require a registration decorator.
         * Keep Gizmos API calls inside this callback for type-only projects.
         */
        onDrawGizmos?(): void;

        /**
         * Draws Gizmos when this component's node is selected in the Scene View.
         * This optional callback does not require a registration decorator.
         */
        onDrawGizmosSelected?(): void;

        /**
         * Defines editable position handles for a selected component in the Scene View.
         * Each property must contain a Vec3 or an array of Vec3 values.
         * The plane and constraints use the selected coordinate space.
         */
        onGizmoHandles?(): Array<{
            property: string;
            index?: number;
            plane?: 'xy' | 'xz' | 'yz' | 'view';
            space?: 'local' | 'world';
            axis?: 'x' | 'y' | 'z';
            snap?: number;
            bounds?: {
                min?: { x?: number; y?: number; z?: number };
                max?: { x?: number; y?: number; z?: number };
            };
            color?: string;
        }>;

        /**
         * Receives position handle edit events after a Scene View interaction.
         * The cancel phase restores the original property value.
         */
        onGizmoChanged?(property: string, phase: 'begin' | 'update' | 'end' | 'cancel', index?: number): void;
    }
}
