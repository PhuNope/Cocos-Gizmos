import { Color, Component } from 'cc';
import { Gizmos3D } from './Gizmos3D';
import { GizmoHudText } from './GizmoPresentation';
import { hudRowScreenPosition } from './GizmoHudControls';
import { createSceneHudProjection, SceneHudCamera } from './GizmoHudProjection';

function sceneCamera(): SceneHudCamera | null {
    const global = globalThis as any;
    const view = global.cce?.Camera?.camera || global.window?.cce?.Camera?.camera;
    return view && typeof view.worldToScreen === 'function' &&
        typeof view.screenPointToRay === 'function' ? view as SceneHudCamera : null;
}

/**
 * Renders informational HUD text beside the selected node.
 * Stable label IDs reuse the same Gizmos3D Labels between Scene frames.
 * A single camera projection provides positions and pixel scale for all rows.
 */
export class GizmoHudOverlay {
    private readonly colors = new Map<string, Color>();
    private drawn = 0;

    public render(component: Component, items: readonly GizmoHudText[]): number {
        const camera = sceneCamera();
        const node = component?.node;
        if (!camera || !node?.isValid || !items.length) return 0;
        const projection = createSceneHudProjection(camera, node.worldPosition);
        if (!projection) return 0;

        let drawn = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const screen = hudRowScreenPosition(projection.screen, i);
            let color = this.colors.get(item.color);
            if (!color) {
                color = new Color(255, 255, 255, 255);
                if (typeof Color.fromHEX === 'function') Color.fromHEX(color, item.color);
                if (this.colors.size >= 128) this.colors.clear();
                this.colors.set(item.color, color);
            }
            Gizmos3D.beginColor(node, color);
            Gizmos3D.drawLabel(node, 'cocos-gizmos:hud:' + item.id, item.text,
                projection.worldAt(screen.x, screen.y), item.fontSize, projection.pixelSize);
            drawn++;
        }
        this.drawn += drawn;
        return drawn;
    }

    public get totalDrawn(): number { return this.drawn; }

    public dispose(): void {
        this.colors.clear();
        this.drawn = 0;
    }
}
