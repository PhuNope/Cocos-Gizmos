import type { Component } from 'cc';
import { HudControl, normalizeHudControls, formatHudControl } from './GizmoHudControls';
import { GizmoHudText, normalizeHudItems } from './GizmoPresentation';

export interface GizmoHudPlacement {
    /** Unique lifetime-stable prefix for the Label cache on this Node. */
    namespace: string;
    /** First screen-space row occupied by this component's HUD. */
    startRow: number;
    /** Number of text rows preceding this component's interactive controls. */
    textCount: number;
    /** Number of rendered rows (labels and controls). */
    rowCount: number;
    /** Validated HUD controls, ordered consistently for drawing and picking. */
    controls: readonly HudControl[];
    /** Text and control labels, in their exact display order. */
    items: readonly GizmoHudText[];
}

type HudComponent = Component & {
    onGizmoHud?: () => unknown;
    onGizmoHudControls?: () => unknown;
};

/**
 * Rebuild a frame-scoped HUD layout once for all components.
 *
 * Labels on the same Node use one namespace per component and nonoverlapping
 * row ranges. The position-handle adapter consumes these exact placements,
 * so picking and rendering never calculate independent offsets.
 */
export class GizmoHudLayout {
    private readonly identities = new WeakMap<Component, string>();
    private readonly placements = new Map<Component, GizmoHudPlacement>();
    private nextIdentity = 0;

    public identity(component: Component): string {
        let id = this.identities.get(component);
        if (!id) {
            id = 'component-' + (++this.nextIdentity);
            this.identities.set(component, id);
        }
        return id;
    }

    public get(component: Component): GizmoHudPlacement | null {
        return this.placements.get(component) || null;
    }

    /** Rows allocated for all selected HUD components in the Scene. */
    public get totalRows(): number {
        let total = 0;
        for (const placement of this.placements.values()) {
            total = Math.max(total, placement.startRow + placement.rowCount);
        }
        return total;
    }

    public clear(): void {
        this.placements.clear();
    }

    public beginFrame(
        components: readonly Component[],
        visible: (component: Component) => boolean,
        onError?: (component: Component, hook: string, error: unknown) => void,
    ): void {
        this.placements.clear();
        const nodeRows = new Map<object, number>();
        for (const component of components) {
            const comp = component as HudComponent;
            const node = comp?.node;
            if (!node || comp.isValid === false || comp.enabled === false ||
                node.activeInHierarchy === false ||
                (typeof comp.onGizmoHud !== 'function' &&
                 typeof comp.onGizmoHudControls !== 'function')) continue;
            let show = false;
            try { show = visible(component); }
            catch (error) {
                onError?.(component, 'onGizmoSettings', error);
                continue;
            }
            if (!show) continue;

            let texts: GizmoHudText[] = [];
            let controls: HudControl[] = [];
            if (typeof comp.onGizmoHud === 'function') {
                try { texts = normalizeHudItems(comp.onGizmoHud()); }
                catch (error) { onError?.(component, 'onGizmoHud', error); }
            }
            if (typeof comp.onGizmoHudControls === 'function') {
                try { controls = normalizeHudControls(comp.onGizmoHudControls()); }
                catch (error) { onError?.(component, 'onGizmoHudControls', error); }
            }
            if (!texts.length && !controls.length) continue;

            const items = texts.map((text) => ({ ...text, id: 'text:' + text.id }));
            for (const control of controls) {
                const value = control.type === 'button' ? undefined :
                    (comp as any)[control.property];
                items.push({
                    id: 'control:' + control.id,
                    text: formatHudControl(control, value),
                    order: items.length,
                    fontSize: control.fontSize,
                    color: control.color,
                });
            }
            const last = nodeRows.get(node) || 0;
            const startRow = last > 0 ? last + 1 : 0; // one blank row between components
            this.placements.set(component, {
                namespace: this.identity(component),
                startRow,
                textCount: texts.length,
                rowCount: items.length,
                controls,
                items,
            });
            nodeRows.set(node, startRow + items.length);
        }
    }
}
