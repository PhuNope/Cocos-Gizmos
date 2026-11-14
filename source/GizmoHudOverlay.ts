import * as cocos from 'cc';
import {
    CCObject, Color, Component, director, Director, gfx, ImageAsset, Layers,
    Material, Mesh, MeshRenderer, Node, Quat, RenderRoot2D,
    Sprite, SpriteFrame, Texture2D, UITransform, utils, Vec2, Vec3,
} from 'cc';
import { Gizmos3D } from './Gizmos3D';
import { Gizmos2D } from './Gizmos2D';
import { GizmoHudText } from './GizmoPresentation';
import { hudGrid, hudRowScreenPosition, hudControlScreenRect,
    hudSliderScreenTrack } from './GizmoHudControls';
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


type ScreenRow = { index: number; text: string; color: string; fontSize: number;
    minSize?: number; maxSize?: number; isControl: boolean;
    kind?: 'button' | 'slider' | 'toggle' | 'checkbox';
    size?: 'small' | 'normal' | 'large';
    width?: number;
    value?: number | boolean; min?: number; max?: number };

/** Draw CSS-independent, antialiased HUD widgets in the existing texture. */
function hudRoundedRect(ctx: any, x: number, y: number, w: number,
    h: number, radius: number, fill: string): void {
    ctx.fillStyle = fill;
    if (typeof ctx.beginPath !== 'function' ||
        typeof ctx.quadraticCurveTo !== 'function' ||
        typeof ctx.moveTo !== 'function' || typeof ctx.lineTo !== 'function' ||
        typeof ctx.fill !== 'function') {
        ctx.fillRect(x, y, w, h);
        return;
    }
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();
}

function hudDisc(ctx: any, x: number, y: number, r: number, color: string): void {
    ctx.fillStyle = color;
    if (typeof ctx.beginPath === 'function' &&
        typeof ctx.arc === 'function' && typeof ctx.fill === 'function') {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    } else ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

function hudCheckboxTick(ctx: any, x: number, y: number, scale: number): void {
    if (typeof ctx.beginPath === 'function' &&
        typeof ctx.moveTo === 'function' &&
        typeof ctx.lineTo === 'function' &&
        typeof ctx.stroke === 'function') {
        ctx.beginPath();
        ctx.moveTo(x, y + 5 * scale);
        ctx.lineTo(x + 4 * scale, y + 9 * scale);
        ctx.lineTo(x + 11 * scale, y);
        ctx.strokeStyle = '#102333';
        ctx.lineWidth = 2 * scale;
        ctx.lineCap = 'round';
        ctx.stroke();
    } else {
        ctx.font = 'bold ' + 12 * scale + 'px sans-serif';
        ctx.fillStyle = '#102333';
        ctx.fillText('✓', x, y + 5 * scale);
    }
}

function projectHudPlane(camera: SceneHudCamera, left: number, bottom: number,
    width: number, height: number): number[] | null {
    const viewport = camera.viewport;
    if (!viewport) return null;
    const ray = (x: number, y: number) => {
        const output = { o: new Vec3(), d: new Vec3() };
        try {
            const result = camera.screenPointToRay(x, y, output) || output;
            if (!result?.o || !result?.d ||
                !Number.isFinite(result.o.x) || !Number.isFinite(result.d.x)) return null;
            return result;
        } catch { return null; }
    };
    const center = ray(viewport.width / 2, viewport.height / 2);
    if (!center) return null;
    const normal = center.d;
    const planePoint = new Vec3(center.o.x + normal.x,
        center.o.y + normal.y, center.o.z + normal.z);
    const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
    const vertices: number[] = [];
    for (const [x, y] of [[left, bottom], [left, bottom + height],
        [left + width, bottom + height], [left + width, bottom]]) {
        const r = ray(x, y);
        if (!r) return null;
        const den = dot(r.d, normal);
        if (!Number.isFinite(den) || Math.abs(den) < 1e-9) return null;
        const dist = dot(new Vec3(planePoint.x - r.o.x,
            planePoint.y - r.o.y, planePoint.z - r.o.z), normal) / den;
        if (!Number.isFinite(dist) || dist < 0) return null;
        vertices.push(r.o.x + r.d.x * dist, r.o.y + r.d.y * dist, r.o.z + r.d.z * dist);
    }
    return vertices;
}

/** Single screen-space textured HUD, following Creator Gizmo Kit's Gizmo-root
 * overlay approach. Never attach HUD labels to a Canvas or a selected Node.
 * Using a single no-depth MeshRenderer prevents child-Canvas clipping.
 */
class ScreenHudMesh {
    private root: Node | null = null;
    private renderer: MeshRenderer | null = null;
    private material: Material | null = null;
    private mesh: Mesh | null = null;
    private texture: Texture2D | null = null;
    private image: ImageAsset | null = null;
    private uiRoot: Node | null = null;
    private uiSprite: Sprite | null = null;
    private uiFrame: SpriteFrame | null = null;
    private canvas: any = null;
    private contentSignature = '';
    private geometrySignature = '';
    private geometryMode: 'local' | 'world' | null = null;
    private camera: SceneHudCamera | null = null;
    private height = 0;
    private width = 0;
    private registered = false;

    private readonly beforeDraw = (): void => {
        if (this.root?.isValid && this.root.active && this.camera) this.updateGeometry();
    };

    private ensureRoot(): boolean {
        if (this.root?.isValid && this.renderer?.isValid) return true;
        this.dispose();
        const global = globalThis as any;
        const cce = global.window?.cce || global.cce;
        const parent = cce?.Gizmo?.gizmoRootNode || director.getScene();
        if (!parent?.isValid) return false;
        try {
            const root = new Node('CocosGizmosScreenHud');
            root.layer = Layers.Enum.GIZMOS;
            root.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
            parent.addChild(root);
            root.setWorldPosition(new Vec3());
            root.setWorldRotation(new Quat());
            root.setWorldScale(new Vec3(1, 1, 1));
            const node = new Node('HudScreenQuad');
            node.layer = Layers.Enum.GIZMOS;
            root.addChild(node);
            const renderer = node.addComponent(MeshRenderer);
            const material = new Material();
            material.initialize({
                effectName: 'builtin-unlit', technique: 1,
                defines: { USE_TEXTURE: true },
                states: {
                    depthStencilState: { depthTest: false, depthWrite: false },
                    rasterizerState: { cullMode: gfx.CullMode.NONE },
                },
            });
            renderer.setMaterial(material, 0);
            (renderer as any).priority = 32767;
            // A depth-disabled material alone does not guarantee that the HUD
            // is drawn after other GIZMOS meshes. Match Creator Gizmo Kit's
            // renderer sorting order, so HUD stays above other 2D/3D gizmos.
            const Sorting = (cocos as any).Sorting;
            if (typeof Sorting === 'function') {
                const sorting: any = node.addComponent(Sorting);
                if (sorting) sorting.sortingOrder = 32767;
            }
            this.root = root;
            this.renderer = renderer;
            this.material = material;
            // 3D Sprite/Label belong to a later UI pass than MeshRenderer.
            // A dedicated RenderRoot2D submits this final HUD in the same UI
            // pass, after the user's Scene sprites, instead of relying on
            // 3D mesh sorting to outrank an unrelated UI batching pipeline.
            let uiRoot: Node | null = null;
            try {
                uiRoot = new Node('CocosGizmosHudUIRoot');
                uiRoot.layer = (Layers.Enum.UI_3D ?? 0) | Layers.Enum.GIZMOS;
                root.addChild(uiRoot);
                uiRoot.addComponent(RenderRoot2D);
                const spriteNode = new Node('CocosGizmosHudTopmost');
                spriteNode.layer = uiRoot.layer;
                uiRoot.addChild(spriteNode);
                const sprite = spriteNode.addComponent(Sprite);
                const transform = spriteNode.getComponent?.(UITransform) ||
                    spriteNode.addComponent(UITransform);
                transform.setAnchorPoint?.(0, 0);
                const Sorting2D = (globalThis as any).cc?.Sorting2D;
                if (typeof Sorting2D === 'function') {
                    const sort: any = spriteNode.addComponent(Sorting2D);
                    if (sort) sort.sortingOrder = 32767;
                }
                this.uiRoot = uiRoot;
                this.uiSprite = sprite;
                // The textured HUD is drawn in the 2D UI pass. Keep the Mesh
                // fallback dormant so it doesn't darken the final HUD twice.
                renderer.enabled = false;
            } catch (error) {
                console.warn('[cocos-gizmos/hud] UI pass unavailable; keeping Mesh HUD fallback:', error);
                if (uiRoot?.isValid) uiRoot.destroy();
                this.uiRoot = null;
                this.uiSprite = null;
                renderer.enabled = true;
            }
            director.on(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
            this.registered = true;
            return true;
        } catch (error) {
            console.warn('[cocos-gizmos/hud] Cannot create Scene screen HUD:', error);
            this.dispose();
            return false;
        }
    }

    public render(camera: SceneHudCamera, rows: readonly ScreenRow[], totalRows: number): boolean {
        const viewport = camera.viewport;
        const document = (globalThis as any).document;
        if (!viewport || !document?.createElement || !rows.length || !this.ensureRoot()) {
            this.hide();
            return false;
        }
        const grid = hudGrid(viewport, totalRows);
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(grid.height);
        const scale = 2;
        const signature = JSON.stringify([width, height, rows, totalRows]);
        if (this.contentSignature !== signature) {
            try {
                const canvas = this.canvas || (this.canvas = document.createElement('canvas'));
                canvas.width = Math.min(4096, width * scale);
                canvas.height = Math.min(2048, height * scale);
                const ctx = canvas.getContext('2d');
                if (!ctx) return false;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#151e2d';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#78b8f0';
                ctx.fillRect(0, 0, canvas.width, scale);
                ctx.textBaseline = 'middle';
                const columnTextWidth = Math.max(70, grid.columnWidth - 30);
                for (const row of rows) {
                    const screen = hudRowScreenPosition({ x: 0, y: 0 },
                        row.index, viewport, totalRows);
                    const x = screen.x;
                    const y = height - screen.y;
                    const font = row.isControl ?
                        hudTextPixels(row.fontSize, 10, 18) :
                        hudTextPixels(row.fontSize, row.minSize, row.maxSize);
                    // All visual sizes fit inside the shared 22px picking row.
                    const visualScale = row.size === 'small' ? 0.78 :
                        row.size === 'large' ? 1.12 : 1;
                    if (row.isControl) {
                        const hit = hudControlScreenRect(viewport, row.index, totalRows);
                        hudRoundedRect(ctx, hit.left * scale,
                            (height - hit.top + 1) * scale,
                            hit.width * scale, Math.max(1, hit.height - 2) * scale,
                            5 * scale, '#273950');
                    }
                    ctx.font = font * scale + 'px sans-serif';
                    ctx.fillStyle = /^#[a-fA-F0-9]{6,8}$/.test(row.color) ?
                        row.color : '#ffffff';
                    if (row.kind === 'slider') {
                        const value = typeof row.value === 'number' ? row.value : row.min || 0;
                        const progress = Number.isFinite(value) &&
                            Number.isFinite(row.min) && Number.isFinite(row.max) &&
                            (row.max as number) > (row.min as number) ?
                            Math.max(0, Math.min(1, (value - (row.min as number)) /
                                ((row.max as number) - (row.min as number)))) : 0;
                        const track = hudSliderScreenTrack(
                            viewport, row.index, totalRows, row.width);
                        const trackX = track.left;
                        const trackWidth = track.width;
                        ctx.fillText(row.text, x * scale, y * scale,
                            grid.columnWidth * 0.32 * scale);
                        hudRoundedRect(ctx, trackX * scale, (y - 3) * scale,
                            trackWidth * scale, 6 * visualScale * scale,
                            3 * visualScale * scale, '#54677e');
                        if (progress > 0)
                            hudRoundedRect(ctx, trackX * scale, (y - 3) * scale,
                                trackWidth * progress * scale,
                                6 * visualScale * scale, 3 * visualScale * scale,
                                '#7bbaff');
                        hudDisc(ctx, (trackX + trackWidth * progress) * scale,
                            y * scale, 5 * visualScale * scale, '#eef8ff');
                        ctx.fillStyle = '#c4e4ff';
                        ctx.fillText(String(Math.round(value * 1000) / 1000),
                            (trackX + trackWidth + 9) * scale, y * scale,
                            grid.columnWidth * 0.20 * scale);
                    } else if (row.kind === 'toggle') {
                        const enabled = row.value === true;
                        const pillX = x + grid.columnWidth - 77 * visualScale;
                        ctx.fillStyle = '#e7f1ff';
                        ctx.fillText(row.text, x * scale, y * scale,
                            Math.max(35, grid.columnWidth - 95) * scale);
                        hudRoundedRect(ctx, pillX * scale, (y - 8) * scale,
                            37 * visualScale * scale, 16 * visualScale * scale,
                            8 * visualScale * scale,
                            enabled ? '#3ad2a4' : '#55667e');
                        hudDisc(ctx, (pillX + (enabled ? 28 : 9) * visualScale) * scale,
                            y * scale, 6 * visualScale * scale, '#f6fbff');
                        ctx.fillStyle = enabled ? '#98efcf' : '#b3c0d4';
                        ctx.font = 10 * scale + 'px sans-serif';
                        ctx.fillText(enabled ? 'On' : 'Off',
                            (pillX + 42) * scale, y * scale, 30 * scale);
                    } else if (row.kind === 'checkbox') {
                        const enabled = row.value === true;
                        const left = (x + 2) * scale, top = (y - 7) * scale;
                        hudRoundedRect(ctx, left, top,
                            15 * visualScale * scale, 15 * visualScale * scale,
                            3 * visualScale * scale, enabled ? '#69c9f1' : '#54667b');
                        if (enabled)
                            hudCheckboxTick(ctx, left + 2 * scale,
                                top + 3 * scale, scale * visualScale);
                        ctx.fillStyle = '#e7f1ff';
                        const textStart = 9 + 17 * visualScale;
                        ctx.fillText(row.text, (x + textStart) * scale, y * scale,
                            Math.max(35, columnTextWidth - textStart) * scale);
                    } else if (row.kind === 'button') {
                        const defaultWidth = Math.min(grid.columnWidth - 40, 150);
                        const width = Math.max(60, Math.min(grid.columnWidth - 30,
                            row.width ?? defaultWidth));
                        hudRoundedRect(ctx, x * scale,
                            (y - 9 * visualScale) * scale,
                            width * scale, 18 * visualScale * scale,
                            6 * visualScale * scale, '#397eb8');
                        ctx.font = '600 ' + Math.max(12, font - 1) * scale + 'px sans-serif';
                        ctx.fillStyle = '#f5faff';
                        ctx.fillText(row.text, (x + 12) * scale, y * scale,
                            Math.max(30, width - 18) * scale);
                    } else {
                        ctx.fillText(row.text, x * scale, y * scale,
                            columnTextWidth * scale);
                    }
                }
                const image = new ImageAsset(canvas);
                const texture = new Texture2D();
                texture.image = image;
                this.material?.setProperty('mainTexture', texture);
                if (this.uiSprite) {
                    const frame = new SpriteFrame();
                    frame.texture = texture;
                    this.uiSprite.spriteFrame = frame;
                    this.uiFrame?.destroy();
                    this.uiFrame = frame;
                }
                this.texture?.destroy();
                this.image?.destroy();
                this.texture = texture;
                this.image = image;
                this.contentSignature = signature;
            } catch (error) {
                console.warn('[cocos-gizmos/hud] Cannot render Scene HUD texture:', error);
                this.hide();
                return false;
            }
        }
        this.camera = camera;
        this.width = width;
        this.height = height;
        if (this.root) this.root.active = true;
        this.updateGeometry();
        return true;
    }

    private updateGeometry(): void {
        if (!this.camera || !this.renderer || !this.root?.isValid) return;
        // The render camera caches inverse VP. Wheel navigation changes the
        // camera transform before its matrices are updated in the Scene pass.
        this.camera.sync?.();
        const verts = projectHudPlane(this.camera, 0, 0, this.width, this.height);
        if (!verts) {
            this.root.active = false;
            return;
        }
        const target = this.renderer.node;
        const rotation = this.camera.node && (this.camera.node as any).worldRotation;
        const canTransform = rotation && typeof target?.setWorldPosition === 'function' &&
            typeof target?.setWorldRotation === 'function' &&
            typeof target?.setWorldScale === 'function';
        try {
            if (canTransform) {
                if (this.uiSprite?.node?.isValid) {
                    this.uiSprite.node.active = true;
                    this.renderer.enabled = false;
                }
                // Use one immutable unit quad. Only its Node transform changes
                // during scroll, instead of creating/destroying GPU meshes
                // every frame. This removes zoom stutter and picker drift.
                if (this.geometryMode !== 'local') {
                    const mesh = utils.createMesh({
                        positions: [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
                        indices: [0, 3, 1, 3, 2, 1],
                        uvs: [0, 1, 0, 0, 1, 0, 1, 1],
                    }, undefined, { calculateBounds: true });
                    this.renderer.mesh = mesh;
                    this.mesh?.destroy();
                    this.mesh = mesh;
                    this.geometryMode = 'local';
                }
                const dx = Math.hypot(verts[9] - verts[0],
                    verts[10] - verts[1], verts[11] - verts[2]);
                const dy = Math.hypot(verts[3] - verts[0],
                    verts[4] - verts[1], verts[5] - verts[2]);
                target.setWorldPosition(new Vec3(verts[0], verts[1], verts[2]));
                target.setWorldRotation(rotation);
                target.setWorldScale(new Vec3(dx, dy, 1));
                if (this.uiSprite?.node?.isValid) {
                    const overlayNode = this.uiSprite.node;
                    const transform = overlayNode.getComponent?.(UITransform);
                    transform?.setContentSize?.(this.width, this.height);
                    overlayNode.setWorldPosition(new Vec3(verts[0], verts[1], verts[2]));
                    overlayNode.setWorldRotation(rotation);
                    overlayNode.setWorldScale(new Vec3(dx / this.width, dy / this.height, 1));
                }
                return;
            }
            // Fallback for editors with an alternate Scene camera wrapper.
            // The UI Sprite cannot be positioned without camera world rotation.
            if (this.uiSprite?.node?.isValid) this.uiSprite.node.active = false;
            this.renderer.enabled = true;
            const signature = verts.join(',');
            if (signature === this.geometrySignature && this.geometryMode === 'world') return;
            target?.setWorldPosition?.(new Vec3());
            target?.setWorldRotation?.(new Quat());
            target?.setWorldScale?.(new Vec3(1, 1, 1));
            const mesh = utils.createMesh({
                positions: verts, indices: [0, 3, 1, 3, 2, 1],
                uvs: [0, 1, 0, 0, 1, 0, 1, 1],
            }, undefined, { calculateBounds: true });
            this.renderer.mesh = mesh;
            this.mesh?.destroy();
            this.mesh = mesh;
            this.geometrySignature = signature;
            this.geometryMode = 'world';
        } catch (error) {
            console.warn('[cocos-gizmos/hud] HUD geometry update failed:', error);
        }
    }

    public hide(): void {
        if (this.root?.isValid) this.root.active = false;
        this.camera = null;
    }

    public dispose(): void {
        if (this.registered) director.off(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
        this.registered = false;
        if (this.renderer?.isValid) this.renderer.mesh = null;
        this.mesh?.destroy();
        this.uiSprite && (this.uiSprite.spriteFrame = null);
        this.uiFrame?.destroy();
        this.material?.destroy();
        this.texture?.destroy();
        this.image?.destroy();
        if (this.root?.isValid) this.root.destroy();
        this.root = null;
        this.renderer = null;
        this.material = null;
        this.mesh = null;
        this.uiRoot = null;
        this.uiSprite = null;
        this.uiFrame = null;
        this.texture = null;
        this.image = null;
        this.camera = null;
        this.geometrySignature = '';
        this.geometryMode = null;
        this.contentSignature = '';
    }
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
    private readonly screen = new ScreenHudMesh();
    private readonly screenRows: ScreenRow[] = [];
    private frameActive = false;
    private screenActive = false;

    public get isScreenHudActive(): boolean {
        return this.screenActive || (this.frameActive && this.screenRows.length > 0);
    }

    public beginFrame(): void {
        this.frameActive = true;
        this.screenRows.length = 0;
    }

    public finishFrame(totalRows: number): void {
        const camera = sceneCamera();
        if (this.screenRows.length && camera?.viewport) {
            this.screenActive = this.screen.render(camera, this.screenRows, totalRows);
        } else {
            this.screen.hide();
            this.screenActive = false;
        }
        this.frameActive = false;
        this.screenRows.length = 0;
    }

    public clearFrame(): void {
        this.frameActive = false;
        this.screenRows.length = 0;
        this.screenActive = false;
        this.screen.hide();
    }

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
        placement?: Pick<GizmoHudPlacement, 'namespace' | 'startRow'> &
            Partial<Pick<GizmoHudPlacement, 'textCount' | 'controls'>>,
    ): number {
        const camera = sceneCamera();
        const node = component?.node;
        if (!node?.isValid || !items.length) return 0;
        if (!camera) { this.cameraMissing++; this.lastPath = 'none'; return 0; }
        // Render through one viewport-attached texture, as in Creator Gizmo Kit.
        // Keep the historical Canvas Label path only where document is missing.
        if (this.frameActive && camera.viewport && (globalThis as any).document?.createElement) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const control = placement?.controls && i >= (placement.textCount || 0) ?
                    placement.controls[i - (placement.textCount || 0)] : undefined;
                const current = control && 'property' in control ?
                    (component as any)[control.property] : undefined;
                this.screenRows.push({
                    index: (placement?.startRow || 0) + i,
                    // The textured HUD draws the real widget. Keep formatted
                    // Unicode labels only for the non-Canvas fallback path.
                    text: control ? control.text : item.text, color: item.color,
                    fontSize: item.fontSize, minSize: item.minSize,
                    maxSize: item.maxSize,
                    isControl: item.id.startsWith('control:'),
                    kind: control?.type,
                    size: control?.size,
                    width: control?.type === 'button' ||
                        control?.type === 'slider' ? control.width : undefined,
                    value: typeof current === 'number' || typeof current === 'boolean' ?
                        current : undefined,
                    min: control?.type === 'slider' ? control.min : undefined,
                    max: control?.type === 'slider' ? control.max : undefined,
                });
            }
            this.drawn += items.length;
            this.lastPath = '3d';
            return items.length;
        }
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
                (placement?.startRow || 0) + i, projection.viewport);
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
                // A translucent viewport-docked row remains readable over
                // arbitrary Scene geometry without consuming 3D depth.
                const backgroundWidth = Math.min(370, Math.max(145, item.text.length * requestedPixels * 0.55 + 26));
                const backgroundCenter = projection.worldAt(
                    screen.x + backgroundWidth * 0.5 - 10, screen.y);
                const backgroundLocal = new Vec3();
                node.inverseTransformPoint(backgroundLocal, backgroundCenter);
                Gizmos2D.beginColor(node, new Color(15, 18, 24, 205));
                Gizmos2D.drawSolidRect(node, backgroundLocal,
                    backgroundWidth * projection.pixelSize / sx,
                    21 * projection.pixelSize / sy);
                Gizmos2D.beginColor(node, color);
                Gizmos2D.drawLabel(node, id, item.text, local, fontSize,
                    new Vec2(worldScale / sx, worldScale / sy),
                    item.minSize, item.maxSize);
            } else {
                Gizmos3D.beginColor(node, color);
                Gizmos3D.drawLabel(node, id, item.text,
                    position, fontSize, worldScale, item.minSize, item.maxSize);
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
        this.screen.dispose();
        this.colors.clear();
        this.drawn = 0;
        this.drawn2D = 0;
        this.drawn3D = 0;
        this.cameraMissing = 0;
        this.projectionFailed = 0;
        this.lastPath = 'none';
    }
}
