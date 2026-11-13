import { Color, Component, Layers, RenderRoot2D, Vec2, Vec3 } from 'cc';
import { Gizmos3D } from './Gizmos3D';
import { Gizmos2D } from './Gizmos2D';
import { GizmoHudText } from './GizmoPresentation';
import { hudRowScreenPosition } from './GizmoHudControls';
import { createSceneHudProjection, SceneHudCamera } from './GizmoHudProjection';
import type { GizmoHudPlacement } from './GizmoHudLayout';
import { resolveSceneCamera } from './SceneCameraBridge';

function isUnder2DRenderRoot(node: any): boolean {
    for (let current = node; current; current = current.parent) {
        if (typeof current.getComponent === 'function' &&
            current.getComponent(RenderRoot2D)) return true;
    }
    return false;
}

/** A HUD label has a bounded size in actual on-screen pixels. */
export function hudTextPixels(size: number, minimum = 12, maximum = 24): number {
    return Math.min(maximum, Math.max(minimum, size));
}

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
    private drawn2D = 0;
    private drawn3D = 0;
    private cameraMissing = 0;
    private projectionFailed = 0;
    private lastPath: '2d' | '3d' | 'none' = 'none';

    public get diagnosticState(): {
        drawn2D: number; drawn3D: number;
        cameraMissing: number; projectionFailed: number;
        lastPath: '2d' | '3d' | 'none';
    } {
        return {
            drawn2D: this.drawn2D, drawn3D: this.drawn3D,
            cameraMissing: this.cameraMissing,
            projectionFailed: this.projectionFailed,
            lastPath: this.lastPath,
        };
    }

    public get lastRenderPath(): '2d' | '3d' | 'none' {
        return this.lastPath;
    }

    public render(
        component: Component,
        items: readonly GizmoHudText[],
        placement?: Pick<GizmoHudPlacement, 'namespace' | 'startRow'>,
    ): number {
        const camera = sceneCamera();
        const node = component?.node;
        if (!node?.isValid || !items.length) return 0;
        if (!camera) { this.cameraMissing++; this.lastPath = 'none'; return 0; }
        const projection = createSceneHudProjection(camera, node.worldPosition);
        if (!projection) {
            this.projectionFailed++;
            this.lastPath = 'none';
            return 0;
        }

        // RenderRoot2D on Canvas owns 2D/UI labels in the 2D Scene View.
        // Creating another 3D RenderRoot for a 2D owner can leave the labels
        // invisible even while the Node's Gizmos2D primitives draw normally.
        const render2D = isUnder2DRenderRoot(node);
        this.lastPath = render2D ? '2d' : '3d';
        if (render2D) {
            // Canvas cameras render UI_2D, not necessarily the Editor GIZMOS layer.
            Gizmos2D.beginLayer(node, Layers.Enum.UI_2D);
            Gizmos2D.beginLocalPosition(node);
        }
        let drawn = 0;
        try {
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
            const id = 'cocos-gizmos:hud:' +
                (placement ? placement.namespace + ':' : '') + item.id;
            const fontSize = item.fontSize || 14;
            const requestedPixels = hudTextPixels(fontSize, item.minSize, item.maxSize);
            const worldScale = projection.pixelSize * requestedPixels / fontSize;
            const position = projection.worldAt(screen.x, screen.y);
            if (render2D) {
                // The Scene's Canvas is the correct RenderRoot2D for UI nodes.
                const local = new Vec3();
                node.inverseTransformPoint(local, position);
                const parentScale = node.worldScale;
                const sx = parentScale?.x && Math.abs(parentScale.x) > 1e-8 ?
                    Math.abs(parentScale.x) : 1;
                const sy = parentScale?.y && Math.abs(parentScale.y) > 1e-8 ?
                    Math.abs(parentScale.y) : 1;
                Gizmos2D.beginColor(node, color);
                Gizmos2D.drawLabel(node, id, item.text, local, fontSize,
                    new Vec2(worldScale / sx, worldScale / sy));
            } else {
                Gizmos3D.beginColor(node, color);
                Gizmos3D.drawLabel(node, id, item.text,
                    position, fontSize, worldScale);
            }
            drawn++;
        }
        } finally {
            if (render2D) Gizmos2D.endLocalPosition(node);
        }
        this.drawn += drawn;
        if (render2D) this.drawn2D += drawn;
        else this.drawn3D += drawn;
        return drawn;
    }

    public get totalDrawn(): number { return this.drawn; }

    public dispose(): void {
        this.colors.clear();
        this.drawn = 0;
        this.drawn2D = 0;
        this.drawn3D = 0;
        this.cameraMissing = 0;
        this.projectionFailed = 0;
        this.lastPath = 'none';
    }
}
