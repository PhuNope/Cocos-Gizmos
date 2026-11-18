import { Component } from 'cc';
import { Gizmos3D } from './Gizmos3D';
import { GizmoHudOverlay } from './GizmoHudOverlay';
import { GizmoHudDomRenderer } from './GizmoHudDomRenderer';
import { formatHudControl, normalizeHudControls } from './GizmoHudControls';
import { GizmoHudLayout } from './GizmoHudLayout';
import {
    GizmoViewConfig,
    normalizeHudItems,
    normalizeViewConfig,
    shouldDrawGizmo,
    shouldDrawHud,
} from './GizmoPresentation';

export interface GizmoComponentVisibility {
    draw: boolean;
    hud: boolean;
}

/** Coordinates per-component settings, HUD rendering, and extension defaults. */
export class GizmoPresentationService {
    private readonly overlay = new GizmoHudOverlay();
    private readonly builderHud = new GizmoHudDomRenderer();
    private defaults: GizmoViewConfig = normalizeViewConfig(undefined);
    private readonly layout = new GizmoHudLayout();
    private planned = false;

    public getLayout(): GizmoHudLayout { return this.layout; }
    /** 3D Editor Operation HUD input, independent of the disabled WebView pointer layer. */
    public getBuilderHud(): GizmoHudDomRenderer { return this.builderHud; }

    public planFrame(
        components: readonly Component[],
        selected: ReadonlySet<string>,
        onError?: (component: Component, hook: string, error: unknown) => void,
    ): void {
        this.planned = true;
        this.overlay.beginFrame?.();
        this.builderHud.beginFrame();
        this.layout.beginFrame(
            components,
            (component) => this.evaluate(component, selected.has(component.node.uuid)).hud,
            onError,
        );
    }

    public finishFrame(): void {
        this.overlay.finishFrame?.(this.layout.totalRows);
        this.builderHud.finishFrame();
    }

    public clearFrame(): void {
        this.planned = false;
        this.layout.clear();
        this.overlay.clearFrame?.();
        this.builderHud.beginFrame();
        this.builderHud.hide();
    }


    public configure(value: unknown): GizmoViewConfig {
        this.defaults = normalizeViewConfig(value);
        return this.getSettings();
    }

    public getSettings(): GizmoViewConfig {
        return { ...this.defaults };
    }

    public evaluate(component: Component, selected: boolean): GizmoComponentVisibility {
        const callback = component.onGizmoSettings;
        const componentSettings = typeof callback === 'function' ? callback.call(component) : {};
        const config = normalizeViewConfig({ ...this.defaults, ...componentSettings });
        return {
            draw: shouldDrawGizmo(config.display, selected),
            hud: shouldDrawHud(config.hud, selected),
        };
    }

    public renderHud(component: Component): number {
        const plannedPlacement = this.layout.get(component);
        if (plannedPlacement) {
            // A built HUD uses native DOM flex layout and direct commands.
            // The existing row renderer is only its fallback on headless
            // Creator Scene processes without an accessible WebView DOM.
            if (plannedPlacement.tree && this.builderHud.canRender()) {
                return this.builderHud.queue(component,plannedPlacement.tree);
            }
            const count = this.overlay.render(component, plannedPlacement.items, plannedPlacement);
            // On a 2D Canvas, rendering through Gizmos2D must not create a
            // separate 3D debug root just to reset its drawing color.
            if (count && !this.overlay.isScreenHudActive &&
                this.overlay.lastRenderPath !== '2d') {
                Gizmos3D.beginColor(component.node, Gizmos3D.DEFAULT_COLOR);
            }
            return count;
        }
        if (this.planned) return 0;
        // Fallback for direct callers outside the Scene updater.
        const textCallback = component.onGizmoHud;
        const controlsCallback = component.onGizmoHudControls;
        const entries = typeof textCallback === 'function' ?
            normalizeHudItems(textCallback.call(component)) : [];
        if (typeof controlsCallback === 'function') {
            for (const control of normalizeHudControls(controlsCallback.call(component))) {
                const value = control.type === 'button' ?
                    undefined : (component as any)[control.property];
                entries.push({
                    id: 'control:' + control.id,
                    text: formatHudControl(control, value),
                    order: entries.length,
                    fontSize: control.fontSize,
                    color: control.color,
                    size: control.size,
                    style: control.style,
                });
            }
        }
        const count = this.overlay.render(component, entries);
        if (count && this.overlay.lastRenderPath !== '2d') {
            Gizmos3D.beginColor(component.node, Gizmos3D.DEFAULT_COLOR);
        }
        return count;
    }

    public getStats() {
        return {
            hudLabels: this.overlay.totalDrawn,
            overlay: this.overlay.diagnosticState,
            builderHud: {active:this.builderHud.active,editing:this.builderHud.editing},
            defaults: this.getSettings(),
        };
    }

    public dispose(): void {
        this.clearFrame();this.overlay.dispose();this.builderHud.dispose();
    }
}
