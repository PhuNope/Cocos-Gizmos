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
    }
}
