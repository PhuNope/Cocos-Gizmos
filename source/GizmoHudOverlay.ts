import { Color, Component, Vec3 } from 'cc';
import { Gizmos3D } from './Gizmos3D';
import { intersectHandlePlane } from './PositionDragSolver';
import { GizmoHudText } from './GizmoPresentation';
import { hudRowScreenPosition } from './GizmoHudControls';

type ViewCamera = {
    node?: { forward?: Vec3 };
    worldToScreen(point: Vec3, out: Vec3): void;
    screenPointToRay(x: number, y: number, ray: { o: Vec3; d: Vec3 }): { o: Vec3; d: Vec3 } | void;
};

function sceneCamera(): ViewCamera | null {
    const global = globalThis as any;
    const view = global.cce?.Camera?.camera || global.window?.cce?.Camera?.camera;
    return view && typeof view.worldToScreen === 'function' &&
        typeof view.screenPointToRay === 'function' ? view as ViewCamera : null;
}

function screenRay(camera: ViewCamera, x: number, y: number): { o: Vec3; d: Vec3 } | null {
    const ray = { o: new Vec3(), d: new Vec3() };
    try {
        const result = camera.screenPointToRay(x, y, ray) || ray;
        return result?.o && result?.d ? result : null;
    } catch {
        return null;
    }
}

function positionAtScreenPoint(
    camera: ViewCamera,
    origin: Vec3,
    x: number,
    y: number,
): { point: Vec3; pixelSize: number } | null {
    const primary = screenRay(camera, x, y);
    const adjacent = screenRay(camera, x + 1, y);
    if (!primary || !adjacent) return null;
    const normal = camera.node?.forward || primary.d;
    const a = intersectHandlePlane(primary, origin, normal);
    const b = intersectHandlePlane(adjacent, origin, normal);
    if (!a || !b) return null;
    const pixelSize = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (!Number.isFinite(pixelSize) || pixelSize <= 1e-8) return null;
    return {
        point: new Vec3(a.x, a.y, a.z),
        pixelSize,
    };
}

/**
 * Renders informational HUD text beside the selected node.
 * Stable label IDs reuse Gizmos3D Label components instead of allocating
 * meshes or textures on every Scene frame.
 */
export class GizmoHudOverlay {
    private readonly colors = new Map<string, Color>();
    private drawn = 0;

    public render(component: Component, items: readonly GizmoHudText[]): number {
        const camera = sceneCamera();
        const node = component?.node;
        if (!camera || !node?.isValid || !items.length) return 0;
        let anchor: Vec3;
        try {
            anchor = new Vec3();
            camera.worldToScreen(node.worldPosition, anchor);
        } catch {
            return 0;
        }
        if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return 0;
        let drawn = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const screen = hudRowScreenPosition(anchor, i);
            const placement = positionAtScreenPoint(camera, node.worldPosition, screen.x, screen.y);
            if (!placement) continue;
            let color = this.colors.get(item.color);
            if (!color) {
                color = new Color(255, 255, 255, 255);
                if (typeof Color.fromHEX === 'function') Color.fromHEX(color, item.color);
                if (this.colors.size >= 128) this.colors.clear();
                this.colors.set(item.color, color);
            }
            Gizmos3D.beginColor(node, color);
            Gizmos3D.drawLabel(node, 'cocos-gizmos:hud:' + item.id, item.text,
                placement.point, item.fontSize, placement.pixelSize);
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
