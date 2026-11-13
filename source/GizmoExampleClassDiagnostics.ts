/**
 * Read-only class registration check in the Cocos Creator Scene process.
 *
 * Asset DB knows that a *.ts file exists, but this probe checks whether
 * Cocos has actually registered its @ccclass() Component constructor.
 * It does not instantiate Components, edit a Scene or run a demo callback.
 */
export interface GizmoExampleClassStatus {
    name: string;
    status: 'registered' | 'not-registered' | 'not-component' |
        'registry-unavailable' | 'lookup-error';
    error?: string;
}
export interface GizmoExampleClassReport {
    registryAvailable: boolean;
    classes: GizmoExampleClassStatus[];
}

export const EXAMPLE_CLASS_NAMES = [
    'CocosGizmos2DDemo',
    'CocosGizmos3DDemo',
    'CocosGizmosSmokeDemo',
] as const;

export function inspectGizmoExampleClasses(engine: any): GizmoExampleClassReport {
    const registry = engine?.js;
    const getByName = registry?.getClassByName;
    const base = engine?.Component;
    const registryAvailable = typeof getByName === 'function' &&
        typeof base === 'function';

    const classes: GizmoExampleClassStatus[] = EXAMPLE_CLASS_NAMES.map((name) => {
        if (!registryAvailable) return { name, status: 'registry-unavailable' };
        try {
            const ctor = getByName.call(registry, name);
            if (typeof ctor !== 'function') return { name, status: 'not-registered' };
            let isComponent: boolean;
            if (typeof registry.isChildClassOf === 'function') {
                isComponent = registry.isChildClassOf(ctor, base);
            } else {
                isComponent = ctor === base || ctor.prototype instanceof base;
            }
            return { name, status: isComponent ? 'registered' : 'not-component' };
        } catch (error) {
            return { name, status: 'lookup-error',
                error: String((error as any)?.message || error) };
        }
    });
    return { registryAvailable, classes };
}
