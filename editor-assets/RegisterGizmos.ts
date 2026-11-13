/**
 * Explicit dependency for Components that opt into a separate Editor Gizmos class.
 * Import from the installed Project extension (dist/RegisterGizmos.js) or
 * within the read-only examples from editor-assets/RegisterGizmos.ts.
 * Does not install callbacks in Preview or game builds.
 */
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import type { Component } from 'cc';

export interface IDrawGizmos<T extends Component = Component> {
    /** The Component this drawer belongs to, one drawer per Component instance. */
    readonly component: T;
    onGizmoSettings?(): GizmoViewSettings;
    onGizmoHandles?(): GizmoHandleList;
    onDrawGizmos?(): void;
    onDrawGizmosSelected?(): void;
    onGizmoHud?(): GizmoHudItem[];
    onGizmoHudControls?(): GizmoHudControlList;
    onGizmoChanged?(property: string, phase: GizmoHandlePhase, index?: number): void;
    onGizmoHudChanged?(property: string, phase: GizmoHandlePhase,
        value: number | boolean): void;
    onGizmoHudAction?(id: string): void;
}

export type GizmosDrawerConstructor<T extends Component> =
    new (component: T) => IDrawGizmos<T>;

const hooks = [
    'onGizmoSettings', 'onGizmoHandles',
    'onDrawGizmos', 'onDrawGizmosSelected',
    'onGizmoHud', 'onGizmoHudControls',
    'onGizmoChanged', 'onGizmoHudChanged', 'onGizmoHudAction',
] as const;

/**
 * @registerGizmos(MyDrawer) on a Cocos Component.
 * Drawer methods use the same arguments as Component callbacks. They are
 * invoked with this bound to the drawer; drawer.component is the owner.
 * Existing Component callback methods are preserved unless overridden.
 * Use normal prototype methods rather than arrow-function class fields.
 *
 * IMPORTANT: This is a HARD import dependency on the installed extension.
 * No prototype patches, drawer instances or callbacks run in game/Preview.
 */
export function registerGizmos<T extends Component>(
    Drawer: GizmosDrawerConstructor<T>,
): ClassDecorator {
    if (typeof Drawer !== 'function') {
        throw new TypeError('registerGizmos expects a Gizmos drawer class constructor');
    }
    return (target: Function) => {
        if (!EDITOR_NOT_IN_PREVIEW) return;
        const prototype: any = (target as any).prototype;
        if (!prototype) throw new TypeError('registerGizmos must decorate a Component class');

        const instances = new WeakMap<object, IDrawGizmos<T>>();
        for (const hook of hooks) {
            // A component with only a draw callback should not accidentally
            // advertise empty HUD and position-handle callbacks.
            if (typeof (Drawer.prototype as any)[hook] !== 'function') continue;
            const existing: unknown = prototype[hook];
            Object.defineProperty(prototype, hook, {
                configurable: true,
                writable: true,
                value: function(this: T, ...args: any[]): any {
                    if (!this || this.isValid === false || this.node?.isValid === false)
                        return undefined;
                    let drawer = instances.get(this);
                    if (!drawer) {
                        drawer = new Drawer(this);
                        instances.set(this, drawer);
                    }
                    const callback = (drawer as any)[hook];
                    if (typeof callback === 'function') return callback.apply(drawer, args);
                    return typeof existing === 'function' ?
                        existing.apply(this, args) : undefined;
                },
            });
        }
    };
}
