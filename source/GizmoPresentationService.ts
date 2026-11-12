import { Component } from 'cc';
import { Gizmos3D } from './Gizmos3D';
import { GizmoHudOverlay } from './GizmoHudOverlay';
import { formatHudControl, normalizeHudControls } from './GizmoHudControls';
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
    private defaults: GizmoViewConfig = normalizeViewConfig(undefined);

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
        const textCallback = component.onGizmoHud;
        const controlsCallback = component.onGizmoHudControls;
        const entries = typeof textCallback === 'function' ?
            normalizeHudItems(textCallback.call(component)) : [];
        if (typeof controlsCallback === 'function') {
            for (const control of normalizeHudControls(controlsCallback.call(component))) {
                const value = control.type === 'slider' ?
                    (component as any)[control.property] : undefined;
                entries.push({
                    id: 'control:' + control.id,
                    text: formatHudControl(control, value),
                    order: entries.length,
                    fontSize: 14,
                    color: control.color,
                });
            }
        }
        const count = this.overlay.render(component, entries);
        if (count) Gizmos3D.beginColor(component.node, Gizmos3D.DEFAULT_COLOR);
        return count;
    }

    public getStats(): { hudLabels: number; defaults: GizmoViewConfig } {
        return { hudLabels: this.overlay.totalDrawn, defaults: this.getSettings() };
    }

    public dispose(): void { this.overlay.dispose(); }
}
