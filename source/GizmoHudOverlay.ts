import { Color, Component } from 'cc';
import { Gizmos3D } from './Gizmos3D';
import { GizmoHudText } from './GizmoPresentation';
import { hudRowScreenPosition } from './GizmoHudControls';
import { createSceneHudProjection, SceneHudCamera } from './GizmoHudProjection';
import type { GizmoHudPlacement } from './GizmoHudLayout';
import { resolveSceneCamera } from './SceneCameraBridge';

function sceneCamera(): SceneHudCamera | null {
    const global = globalThis as any;
    return resolveSceneCamera(global.window?.cce || global.cce).camera;
}

/**
 * Renders informational HUD text beside the selected node.
 * Stable label IDs reuse the same Gizmos3D Labels between Scene frames.
 * A single camera projection provides positions and pixel scale for all rows.
 */
export class GizmoHudOverlay {
    private readonly colors = new Map<string, Color>();
    private drawn = 0;

    public render(
        component: Component,
        items: readonly GizmoHudText[],
        placement?: Pick<GizmoHudPlacement, 'namespace' | 'startRow'>,
    ): number {
        const camera = sceneCamera();
        const node = component?.node;
        if (!camera || !node?.isValid || !items.length) return 0;
        const projection = createSceneHudProjection(camera, node.worldPosition);
        if (!projection) return 0;

        let drawn = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const screen = hudRowScreenPosition(projection.screen,
                (placement?.startRow || 0) + i);
            let color = this.colors.get(item.color);
            if (!color) {
                color = new Color(255, 255, 255, 255);
                if (typeof Color.fromHEX === 'function') Color.fromHEX(color, item.color);
                if (this.colors.size >= 128) this.colors.clear();
                this.colors.set(item.color, color);
            }
            Gizmos3D.beginColor(node, color);
            const id = 'cocos-gizmos:hud:' +
                (placement ? placement.namespace + ':' : '') + item.id;
            // Never let the Editor drive a UI_3D label to microscopic
            // world scale while zooming very close to the selected Node.
            // World-scale billboarding keeps its visible size consistent.
            const labelScale = Math.max(0.002, Math.min(4, projection.pixelSize));
            Gizmos3D.drawLabel(node, id, item.text,
                projection.worldAt(screen.x, screen.y), item.fontSize, labelScale);
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
