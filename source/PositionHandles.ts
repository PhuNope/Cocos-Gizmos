import { CCObject, Color, Component, director, Director, gfx, Layers,
    ImageAsset, input as engineInput, Input, Material, Mesh, MeshRenderer, Node, Quat, RenderRoot2D,
    Sprite, SpriteFrame, Texture2D, UITransform, utils, Vec3 } from 'cc';
import { Gizmos2D } from './Gizmos2D';
import { Gizmos3D } from './Gizmos3D';
import {
    handlePlaneNormal,
    intersectHandlePlane,
    PositionDragSolver,
} from './PositionDragSolver';
import { HudControl, HudSliderDrag, hudGrid, hudRowScreenPosition, hudControlScreenRect,
    hudSliderScreenTrack, normalizeHudControls, hudControlLayoutSignature } from './GizmoHudControls';
import { createSceneHudProjection, createViewportHudProjection } from './GizmoHudProjection';
import { normalizeHudItems } from './GizmoPresentation';
import { GizmoEditSession } from './GizmoEditSession';
import { GizmoHudLayout } from './GizmoHudLayout';
import { resolveSceneCamera } from './SceneCameraBridge';
import {
    GizmoInputDiagnostics, GizmoInputSnapshot, readSceneHandleName,
    readScenePointer, ScenePointer,
} from './SceneGizmoInput';

type Point = { x: number; y: number; z: number };
type Field = GizmoHandleDescriptor;
type PositionVisual = {
    node: Node; renderer: MeshRenderer; material: Material; mesh: Mesh;
    sprite?: Sprite | null; image?: ImageAsset | null; texture?: Texture2D | null;
    frame?: SpriteFrame | null; uiRoot?: Node | null;
};
type Entry = { field: Field; controller: any; key: string; visual?: PositionVisual | null };
type DragState = { entry: Entry; solver: PositionDragSolver; session: GizmoEditSession<Point> };
type HudPickingQuad = { node: Node; renderer: MeshRenderer; material: Material; mesh: Mesh };
type HudEntry = { control: HudControl; controller: any; key: string; index: number;
    picking?: HudPickingQuad | null };
type HudDrag = { entry: HudEntry; solver: HudSliderDrag; session: GizmoEditSession<number> };

function cceNamespace(): any {
    return (globalThis as any).window?.cce || (globalThis as any).cce || null;
}

function camera(): any {
    return resolveSceneCamera(cceNamespace()).camera;
}

function validPoint(value: any): value is Point {
    return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function selectedKeys(component: Component): string[] {
    const value: any = component;
    const names = [
        value.__classname__,
        value.constructor?.__classname__,
        value.constructor?.name,
    ].filter((key) => typeof key === 'string' && !!key) as string[];
    const keys = new Set<string>();
    for (const name of names) {
        keys.add(name);
        if (!name.includes('.')) keys.add('cc.' + name);
    }
    return [...keys];
}

function applyGizmoLayer(node: any): void {
    if (!node) return;
    node.layer = Layers.Enum.GIZMOS;
    for (const child of node.children || []) applyGizmoLayer(child);
}

function sceneRay(position: ScenePointer): { o: Point; d: Point } | null {
    const view = camera();
    if (typeof view?.screenPointToRay !== 'function') return null;
    const ray = { o: new Vec3(), d: new Vec3() };
    try {
        const result = view.screenPointToRay(position.x, position.y, ray) || ray;
        if (validPoint(result.o) && validPoint(result.d)) return result;
    } catch (error) {
        console.warn('[cocos-gizmos/handles] Unable to calculate Scene ray:', error);
    }
    return null;
}

function spaceFor(component: Component, field: Field): {
    toLocal(point: Point): Point;
    toWorld(point: Point): Point;
} {
    if (field.space === 'world') {
        return {
            toLocal: (point) => ({ ...point }),
            toWorld: (point) => ({ ...point }),
        };
    }
    return {
        toLocal: (point) => {
            const result = new Vec3();
            component.node.inverseTransformPoint(result, new Vec3(point.x, point.y, point.z));
            return { x: result.x, y: result.y, z: result.z };
        },
        toWorld: (point) => {
            const result = new Vec3();
            Vec3.transformMat4(result, new Vec3(point.x, point.y, point.z), component.node.worldMatrix);
            return { x: result.x, y: result.y, z: result.z };
        },
    };
}

function readField(target: Component, field: Field): Point | null {
    const raw: any = (target as any)[field.property];
    const value = field.index === undefined ? raw : Array.isArray(raw) ? raw[field.index] : null;
    return validPoint(value) ? { x: value.x, y: value.y, z: value.z } : null;
}

function writeField(target: Component, field: Field, value: Point): boolean {
    const raw: any = (target as any)[field.property];
    const point = new Vec3(value.x, value.y, value.z);
    if (field.index === undefined) {
        (target as any)[field.property] = point;
        return true;
    }
    if (!Array.isArray(raw) || field.index < 0 || field.index >= raw.length) return false;
    raw[field.index] = point;
    return true;
}

function markerSize(world: Point): number {
    const view = camera();
    if (typeof view?.worldToScreen !== 'function') return 1.5;
    const screen = new Vec3();
    try {
        view.worldToScreen(new Vec3(world.x, world.y, world.z), screen);
        const a = sceneRay({ x: screen.x, y: screen.y });
        const b = sceneRay({ x: screen.x + 1, y: screen.y });
        if (!a || !b) return 1.5;
        const normal = a.d;
        const hitA = intersectHandlePlane(a, world, normal);
        const hitB = intersectHandlePlane(b, world, normal);
        if (!hitA || !hitB) return 0.3;
        const pixel = Math.hypot(hitA.x - hitB.x, hitA.y - hitB.y, hitA.z - hitB.z);
        // Use a ~22px picking marker rather than a tiny 10px cube. The
        // projection is evaluated again after every drag so the visible point
        // keeps the same size across Scene zoom levels.
        if (Number.isFinite(pixel) && pixel > 1e-10) {
            return Math.max(1e-8, pixel * 22);
        }
    } catch {
        // Keep the default marker size if the camera is being replaced.
    }
    return 1.5;
}

/**
 * Resize only the standalone picking marker. BoxController.updateSize()
 * re-enters editable box handles and assumes their private topNode exists.
 * These handles are not initialized by this Gizmo, so updateSize is unsafe.
 */
function setMarkerSize(controller: any, size: number, height = size, depth = size): void {
    const cube = controller?._cubeNode;
    if (!cube || !Number.isFinite(size) || size <= 0) return;
    // The built-in Controller may be attached beneath a transformed target
    // Node. Setting *local* scale makes points vanish on scaled 2D canvases.
    // World scale keeps the picking cube size independent of target scale.
    if (typeof cube.setWorldScale === 'function') {
        cube.setWorldScale(size, height, depth);
    } else {
        const parent = cube.parent?.worldScale;
        const parentX = parent?.x && Math.abs(parent.x) > 1e-8 ? Math.abs(parent.x) : 1;
        const parentY = parent?.y && Math.abs(parent.y) > 1e-8 ? Math.abs(parent.y) : 1;
        const parentZ = parent?.z && Math.abs(parent.z) > 1e-8 ? Math.abs(parent.z) : 1;
        const scale = new Vec3(size / parentX, height / parentY, depth / parentZ);
        if (typeof cube.setScale === 'function') cube.setScale(scale);
        else cube.scale = scale;
    }
}

function isCanvas2D(node: any): boolean {
    for (let current = node; current; current = current.parent) {
        if (typeof current.getComponent === 'function' &&
            current.getComponent(RenderRoot2D)) return true;
    }
    return false;
}

/**
 * Draw the marker independently from BoxCollider's private cube mesh. Creator
 * may keep the picking Controller alive while its rendering mesh disappears
 * after a 2D selection switch. The actual drag still uses initHandle and the
 * Editor's controller event pipeline; this is the visible representation.
 */
function drawSelectedPositionMarkers(component: Component): void {
    if (!component?.node?.isValid || typeof component.onGizmoHandles !== 'function') return;
    const fields: Field[] = component.onGizmoHandles() || [];
    if (!Array.isArray(fields) || !fields.length) return;
    const node = component.node;
    const onCanvas = isCanvas2D(node);
    const nodeScale = node.worldScale || new Vec3(1, 1, 1);
    const sx = Number.isFinite(nodeScale.x) && Math.abs(nodeScale.x) > 1e-8 ?
        Math.abs(nodeScale.x) : 1;
    const sy = Number.isFinite(nodeScale.y) && Math.abs(nodeScale.y) > 1e-8 ?
        Math.abs(nodeScale.y) : 1;
    try {
        if (onCanvas) {
            // The existing 2D Gizmo shapes in Creator Scene use GIZMOS,
            // not UI_2D. UI_2D is excluded by some Editor Scene cameras.
            Gizmos2D.beginLayer(node, Layers.Enum.GIZMOS);
            Gizmos2D.beginLocalPosition(node);
        } else {
            Gizmos3D.setDepTest(node, false);
        }
        for (const field of fields) {
            if (!field || typeof field.property !== 'string') continue;
            const local = readField(component, field);
            if (!local) continue;
            const world = spaceFor(component, field).toWorld(local);
            if (!validPoint(world)) continue;
            const diameter = markerSize(world);
            const radius = diameter * 0.4;
            const color = new Color(255, 190, 40, 255);
            if (typeof field.color === 'string' && typeof Color.fromHEX === 'function') {
                Color.fromHEX(color, field.color);
            }
            if (onCanvas) {
                const at = new Vec3();
                node.inverseTransformPoint(at, new Vec3(world.x, world.y, world.z));
                Gizmos2D.beginColor(node, Color.BLACK);
                Gizmos2D.drawSolidEllipse(node, at, radius * 1.12 / sx, radius * 1.12 / sy);
                Gizmos2D.beginColor(node, color);
                Gizmos2D.drawSolidEllipse(node, at, radius / sx, radius / sy);
            } else {
                Gizmos3D.beginColor(node, color);
                Gizmos3D.drawSphere(node, new Vec3(world.x, world.y, world.z),
                    radius, false, 12, 8);
            }
        }
    } finally {
        if (onCanvas) {
            Gizmos2D.endLocalPosition(node);
            Gizmos2D.beginLayer(node, Gizmos2D.DEFAULT_LAYER);
            Gizmos2D.beginColor(node, Gizmos2D.DEFAULT_COLOR);
        } else {
            Gizmos3D.setDepTest(node, true);
            Gizmos3D.beginColor(node, Gizmos3D.DEFAULT_COLOR);
        }
    }
}

/**
 * HUD hit geometry must be a screen-facing quad, not a stretched BoxCollider
 * cube. The same viewport rectangle is used for drawing, hit-test and picking.
 */
/**
 * Visual drag dots live under the Editor's gizmo root rather than within
 * BoxController._cubeNode. The native cube is only a picking fallback:
 * Cocos Creator may disable that private renderer during selection changes.
 * The disc is depth-free and camera-facing for both 2D and 3D Scene modes.
 */
function createPositionVisual(color: Color): PositionVisual | null {
    const parent = cceNamespace()?.Gizmo?.gizmoRootNode;
    if (!parent?.isValid || typeof Node !== 'function' ||
        typeof MeshRenderer !== 'function' || typeof utils?.createMesh !== 'function') return null;
    let node: Node | null = null;
    let material: Material | null = null;
    let mesh: Mesh | null = null;
    try {
        node = new Node('CocosGizmosPositionPoint');
        node.layer = Layers.Enum.GIZMOS;
        node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
        parent.addChild(node);
        node.active = false; // Only show after the selected component is ready.
        const renderer = node.addComponent(MeshRenderer);
        material = new Material();
        material.initialize({
            effectName: 'builtin-unlit', technique: 1,
            states: {
                depthStencilState: { depthTest: false, depthWrite: false },
                rasterizerState: { cullMode: gfx.CullMode.NONE },
            },
        });
        material.setProperty('mainColor', color);
        renderer.setMaterial(material, 0);
        (renderer as any).priority = 32760;
        // Unit circle. A stable mesh is kept throughout drag/zoom; only the
        // Scene-world transform changes, avoiding a GPU allocation per frame.
        const positions = [0, 0, 0];
        const indices: number[] = [];
        const segments = 20;
        for (let i = 0; i <= segments; i++) {
            const angle = i * Math.PI * 2 / segments;
            positions.push(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
        }
        for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);
        mesh = utils.createMesh({ positions, indices }, undefined, { calculateBounds: true });
        renderer.mesh = mesh;
        const visual: PositionVisual = { node, renderer, material, mesh };
        // Match the HUD's proven RenderRoot2D/Sprite rendering path. A
        // standalone builtin-unlit MeshRenderer can be invisible to the
        // Creator 3.8.8 Scene camera, especially in 2D mode.
        const document = (globalThis as any).document;
        if (document?.createElement && typeof Sprite === 'function') {
            let uiRoot: Node | null = null;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 64;
                canvas.height = 64;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    const r = Math.max(0, Math.min(255, color.r));
                    const g = Math.max(0, Math.min(255, color.g));
                    const b = Math.max(0, Math.min(255, color.b));
                    ctx.clearRect(0, 0, 64, 64);
                    ctx.fillStyle = 'rgba(0,0,0,0.85)';
                    ctx.beginPath();
                    ctx.arc(32, 32, 29, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
                    ctx.beginPath();
                    ctx.arc(32, 32, 24, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(32, 32, 24, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.strokeStyle = '#151923';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(20, 32); ctx.lineTo(44, 32);
                    ctx.moveTo(32, 20); ctx.lineTo(32, 44);
                    ctx.stroke();
                    const image = new ImageAsset(canvas);
                    const texture = new Texture2D();
                    texture.image = image;
                    const frame = new SpriteFrame();
                    frame.texture = texture;
                    uiRoot = new Node('CocosGizmosPointUIRoot');
                    uiRoot.layer = Layers.Enum.GIZMOS | (Layers.Enum.UI_3D || 0);
                    node.addChild(uiRoot);
                    uiRoot.addComponent(RenderRoot2D);
                    const spriteNode = new Node('CocosGizmosDragPointVisible');
                    spriteNode.layer = uiRoot.layer;
                    uiRoot.addChild(spriteNode);
                    const sprite = spriteNode.addComponent(Sprite);
                    // SpriteFrame assignment may reset UITransform dimensions
                    // unless SizeMode.CUSTOM is selected explicitly.
                    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                    sprite.spriteFrame = frame;
                    const transform = spriteNode.getComponent(UITransform) ||
                        spriteNode.addComponent(UITransform);
                    transform.setAnchorPoint?.(0.5, 0.5);
                    transform.setContentSize?.(28, 28);
                    const Sorting2D = (globalThis as any).cc?.Sorting2D;
                    if (typeof Sorting2D === 'function') {
                        const sorting: any = spriteNode.addComponent(Sorting2D);
                        if (sorting) sorting.sortingOrder = 32760;
                    }
                    visual.uiRoot = uiRoot;
                    visual.sprite = sprite;
                    visual.image = image;
                    visual.texture = texture;
                    visual.frame = frame;
                    // Never draw both representations at the same time.
                    renderer.enabled = false;
                }
            } catch (error) {
                console.warn('[cocos-gizmos/handles] Sprite marker fallback:', error);
                if (uiRoot?.isValid) uiRoot.destroy();
                renderer.enabled = true;
            }
        }
        return visual;
    } catch (error) {
        console.warn('[cocos-gizmos/handles] Native point visual fallback:', error);
        mesh?.destroy();
        material?.destroy();
        if (node?.isValid) node.destroy();
        return null;
    }
}

function disposePositionVisual(visual?: PositionVisual | null): void {
    if (!visual) return;
    if (visual.renderer.isValid) visual.renderer.mesh = null;
    if (visual.sprite?.isValid) visual.sprite.spriteFrame = null;
    visual.frame?.destroy();
    visual.texture?.destroy();
    visual.image?.destroy();
    visual.mesh.destroy();
    visual.material.destroy();
    if (visual.node.isValid) visual.node.destroy();
}

function createHudPickingQuad(): HudPickingQuad | null {
    const parent = cceNamespace()?.Gizmo?.gizmoRootNode;
    if (!parent?.isValid || typeof Node !== 'function' ||
        typeof MeshRenderer !== 'function' ||
        typeof utils?.createMesh !== 'function') return null;
    let node: Node | null = null;
    let material: Material | null = null;
    let mesh: Mesh | null = null;
    try {
        node = new Node('CocosGizmosHudHit');
        node.layer = Layers.Enum.GIZMOS;
        node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
        parent.addChild(node);
        const renderer = node.addComponent(MeshRenderer);
        material = new Material();
        material.initialize({
            effectName: 'builtin-unlit', technique: 1,
            states: {
                depthStencilState: { depthTest: false, depthWrite: false },
                rasterizerState: { cullMode: gfx.CullMode.NONE },
            },
        });
        material.setProperty('mainColor', new Color(255, 255, 255, 0));
        renderer.setMaterial(material, 0);
        mesh = utils.createMesh({
            positions: [-0.5, -0.5, 0, -0.5, 0.5, 0,
                0.5, 0.5, 0, 0.5, -0.5, 0],
            indices: [0, 3, 1, 3, 2, 1],
        }, undefined, { calculateBounds: true });
        renderer.mesh = mesh;
        return { node, renderer, material, mesh };
    } catch (error) {
        console.warn('[cocos-gizmos/hud] HUD picking quad unavailable:', error);
        mesh?.destroy();
        material?.destroy();
        if (node?.isValid) node.destroy();
        return null;
    }
}
function disposeHudPickingQuad(picking?: HudPickingQuad | null): void {
    if (!picking) return;
    if (picking.renderer.isValid) picking.renderer.mesh = null;
    picking.mesh.destroy();
    picking.material.destroy();
    if (picking.node.isValid) picking.node.destroy();
}

/**
 * Native BoxController.resetHandleColor() assumes initHandle() snapshots
 * exactly one Color and opacity for each registered renderer. A custom HUD
 * MeshRenderer (or an Editor-owned cube after a Scene switch) can lack that
 * snapshot, causing the Cocos Creator 3.8.8 setMeshColor(undefined) crash.
 */
function repairNativeHandleColors(controller: any, key?: string, fallback?: Color): void {
    const handles = controller?._handleDataMap;
    if (!handles || typeof handles !== 'object') return;
    const names = key ? [key] : Object.keys(handles);
    const candidate = fallback && Number.isFinite(fallback.a) ?
        fallback : new Color(255, 255, 255, 255);
    for (const name of names) {
        const data = handles[name];
        if (!data) continue;
        const nodes = Array.isArray(data.rendererNodes) ? data.rendererNodes : [];
        const colors = Array.isArray(data.oriColors) ? data.oriColors : [];
        const opacities = Array.isArray(data.oriOpacities) ? data.oriOpacities : [];
        const valid = (color: any): boolean => color &&
            Number.isFinite(color.r) && Number.isFinite(color.g) &&
            Number.isFinite(color.b) && Number.isFinite(color.a);
        data.oriColors = nodes.map((_node: unknown, i: number) =>
            valid(colors[i]) ? colors[i] : (candidate.clone?.() || candidate));
        data.oriOpacities = nodes.map((_node: unknown, i: number) =>
            Number.isFinite(opacities[i]) ? opacities[i] : 255);
    }
}

/** Never call BoxController.hide() for a registered custom HUD/position
 * handle: it mutates private snapshot materials and throws on Creator 3.8.8.
 * Unregistering native events and disabling visible/picking nodes is enough;
 * the owning Gizmo is responsible for canceling active drag sessions.
 */
function suspendNativeController(controller: any, picking?: HudPickingQuad | null): void {
    if (!controller) return;
    repairNativeHandleColors(controller);
    if (picking?.node?.isValid) picking.node.active = false;
    if (controller._cubeNode?.isValid !== false && controller._cubeNode)
        controller._cubeNode.active = false;
    if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = false;
}

function createEditorGizmo(
    base: any, allowHud: (component: Component) => boolean,
    input: GizmoInputDiagnostics,
    hudLayout?: GizmoHudLayout,
): any {
    return class PositionHandleEditorGizmo extends base {
        private entries: Entry[] = [];
        private hudEntries: HudEntry[] = [];
        private drag: DragState | null = null;
        private hudDrag: HudDrag | null = null;
        private pendingClick: HudEntry | null = null;
        private shown = false;
        private destroyed = false;
        private beforeDrawRegistered = false;
        private globalMouseRegistered = false;
        private domMouseRegistered = false;
        /** Map browser events from the Editor's Scene canvas to the same
         * bottom-left pixel space as cce.Camera.worldToScreen. The Engine input
         * backend is not always connected to the embedded Scene WebView.
         */
        private domPointer(event: any): ScenePointer | null {
            if (!event || typeof event.clientX !== 'number' ||
                typeof event.clientY !== 'number') return null;
            const view = camera();
            const viewport = view?.viewport;
            if (!viewport) return null;
            const doc = (globalThis as any).document;
            const canvas = event.target?.tagName?.toLowerCase?.() === 'canvas' ?
                event.target : (doc?.querySelector?.('#GameCanvas') ||
                    doc?.querySelector?.('canvas'));
            const rect = canvas?.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) return null;
            const x = (event.clientX - rect.left) * viewport.width / rect.width;
            const y = (rect.bottom - event.clientY) * viewport.height / rect.height;
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 ||
                y < 0 || x > viewport.width || y > viewport.height) return null;
            return { x, y };
        }
        private readonly onDomMouseDown = (event: any): void => {
            if (!this.shown || this.destroyed || this.drag || this.hudDrag ||
                this.pendingClick || (event.button !== undefined && event.button !== 0))
                return;
            const point = this.domPointer(event);
            if (!point || this.hudEntryAt(point)) return;
            const entry = this.positionEntryAt(point);
            if (!entry) return;
            this.begin(entry, point);
            if (this.drag) {
                // A visible overlay Sprite can otherwise let the Editor's
                // selection tool steal the click before a drag starts.
                event.preventDefault?.();
                event.stopPropagation?.();
            }
        };
        private readonly onDomMouseMove = (event: any): void => {
            if (!this.drag) return;
            const point = this.domPointer(event);
            if (point) this.move(this.drag.entry, point);
            if (point) event.preventDefault?.();
        };
        private readonly onDomMouseUp = (event: any): void => {
            if (!this.drag) return;
            const point = this.domPointer(event);
            if (point) this.move(this.drag.entry, point);
            this.finish(false);
        };
        private registerDomMouse(): void {
            const doc = (globalThis as any).document;
            if (this.domMouseRegistered || typeof doc?.addEventListener !== 'function') return;
            doc.addEventListener('pointerdown', this.onDomMouseDown, true);
            doc.addEventListener('pointermove', this.onDomMouseMove, true);
            doc.addEventListener('pointerup', this.onDomMouseUp, true);
            this.domMouseRegistered = true;
        }
        private unregisterDomMouse(): void {
            if (!this.domMouseRegistered) return;
            const doc = (globalThis as any).document;
            doc?.removeEventListener?.('pointerdown', this.onDomMouseDown, true);
            doc?.removeEventListener?.('pointermove', this.onDomMouseMove, true);
            doc?.removeEventListener?.('pointerup', this.onDomMouseUp, true);
            this.domMouseRegistered = false;
        }

        /** Cocos input is independent of private Scene BoxController picking.
         * Only initiate gestures inside the selected screen-space drag disc.
         * Never swallow the event: the standard Editor transform tool works
         * normally for every click outside the custom handles.
         */
        private readonly onGlobalMouseDown = (event: any): void => {
            if (!this.shown || this.destroyed || this.drag || this.hudDrag ||
                this.pendingClick || !event) return;
            if (typeof event.getButton === 'function' &&
                event.getButton() !== 0) return;
            if (this.hudEntryAt(event)) return;
            const entry = this.positionEntryAt(event);
            if (entry) this.begin(entry, event);
        };
        private readonly onGlobalMouseMove = (event: any): void => {
            if (this.drag && event) this.move(this.drag.entry, event);
        };
        private readonly onGlobalMouseUp = (_event: any): void => {
            if (this.drag) this.finish(false);
        };
        private registerGlobalMouse(): void {
            const events = Input?.EventType;
            if (this.globalMouseRegistered || !events || typeof engineInput?.on !== 'function') return;
            try {
                engineInput.on(events.MOUSE_DOWN, this.onGlobalMouseDown, this);
                engineInput.on(events.MOUSE_MOVE, this.onGlobalMouseMove, this);
                engineInput.on(events.MOUSE_UP, this.onGlobalMouseUp, this);
                this.globalMouseRegistered = true;
            } catch (error) {
                // Different Creator builds expose different input backends.
                console.warn('[cocos-gizmos/handles] Global input fallback unavailable:', error);
                this.unregisterGlobalMouse();
            }
        }
        private unregisterGlobalMouse(): void {
            if (typeof engineInput?.off === 'function' && Input?.EventType) {
                engineInput.off(Input.EventType.MOUSE_DOWN, this.onGlobalMouseDown, this);
                engineInput.off(Input.EventType.MOUSE_MOVE, this.onGlobalMouseMove, this);
                engineInput.off(Input.EventType.MOUSE_UP, this.onGlobalMouseUp, this);
            }
            this.globalMouseRegistered = false;
        }

        private readonly beforeDraw = (): void => {
            if (!this.shown || this.destroyed) return;
            // Re-project during Scene scroll, before native controller raycast.
            this.updateMarkers();
        };
        private layout = '';
        private readonly registeredControllers = new WeakSet<object>();
        private readonly unavailableMarkers = new WeakSet<object>();

        private hideUnavailableMarker(controller: any): void {
            if (!controller || this.unavailableMarkers.has(controller)) return;
            this.unregisterController(controller);
            const hud = this.hudEntries.find(entry => entry.controller === controller);
            const position = this.entries.find(entry => entry.controller === controller);
            if (position?.visual?.node?.isValid) position.visual.node.active = false;
            suspendNativeController(controller, hud?.picking);
            this.unavailableMarkers.add(controller);
        }

        private restoreMarker(controller: any): void {
            if (!this.shown || !controller || !this.unavailableMarkers.has(controller)) return;
            this.unavailableMarkers.delete(controller);
            const hud = this.hudEntries.find(entry => entry.controller === controller);
            if (hud?.picking?.node?.isValid) hud.picking.node.active = true;
            else this.ensureMarkerVisible(controller);
            this.registerController(controller);
        }

        /** Creator may hide the cube MeshRenderer while keeping the Gizmo instance. */
        private ensureMarkerVisible(controller: any): void {
            const cube = controller?._cubeNode;
            if (!cube || cube.isValid === false || this.unavailableMarkers.has(controller)) return;
            // HUD quads stay invisible; the BoxCollider cube must never cover
            // the HUD or steal mouse hits from its screen-aligned picker.
            if (this.hudEntries.some(entry => entry.controller === controller && entry.picking)) return;
            cube.active = true;
            if (controller._cubeNodeMR?.isValid !== false && controller._cubeNodeMR) {
                controller._cubeNodeMR.enabled = true;
            }
        }

        private hasDestroyedMarkers(): boolean {
            return [...this.entries, ...this.hudEntries].some(({ controller }) =>
                !controller?._cubeNode || controller._cubeNode.isValid === false) ||
                this.hudEntries.some(({ picking }) => picking && picking.node.isValid === false);
        }

        private registerController(controller: any): void {
            if (!this.shown || !controller || this.registeredControllers.has(controller)) return;
            controller.registerEvents?.();
            this.registeredControllers.add(controller);
        }

        private unregisterController(controller: any): void {
            if (!controller || !this.registeredControllers.has(controller)) return;
            this.registeredControllers.delete(controller);
            controller.unregisterEvents?.();
        }

        private closeControl(property: string, index: number | undefined, cancelled: boolean): void {
            if (cancelled && typeof this.onControlCancel === 'function') {
                this.onControlCancel(property, index);
            } else {
                this.onControlEnd?.(property, index);
            }
        }

        public init(): void {
            this.destroyed = false;
            this.shouldRegisterGizmoOperationEvent = true;
            this.rebuild();
            this._isInitialized = true;
        }

        private descriptors(): Field[] {
            const component = this.target as Component;
            const all = component?.onGizmoHandles?.();
            if (!Array.isArray(all)) return [];
            return all.filter((field) => field && typeof field.property === 'string' &&
                /^(xy|xz|yz|view)$/.test(field.plane || 'xy') &&
                (field.index === undefined || Number.isInteger(field.index) && field.index >= 0) &&
                readField(component, field) !== null);
        }

        private hudDescriptors(): HudControl[] {
            const component = this.target as Component;
            if (!component || !allowHud(component)) return [];
            const raw = hudLayout ? hudLayout.get(component)?.controls || [] :
                normalizeHudControls(component.onGizmoHudControls?.());
            return raw.filter((control) =>
                control.type === 'button' ||
                (control.type === 'slider' ?
                    typeof (component as any)[control.property] === 'number' &&
                    Number.isFinite((component as any)[control.property]) :
                    typeof (component as any)[control.property] === 'boolean'));
        }

        private signature(fields: Field[], controls: HudControl[]): string {
            return JSON.stringify({
                fields: fields.map((field) => [
                    field.property, field.index, field.plane || 'xy',
                    field.space || 'local', field.axis, field.snap,
                    field.color, field.bounds,
                ]),
                controls: hudControlLayoutSignature(controls),
            });
        }

        private rebuild(): void {
            this.clearEntries();
            const fields = this.descriptors();
            const controls = this.hudDescriptors();
            this.layout = this.signature(fields, controls);
            for (const field of fields) {
                try {
                    super.createController();
                    const controller = this._controller;
                    if (!controller) continue;
                    const key = `position:${field.property}:${field.index ?? 'single'}`;
                    const entry: Entry = { field, controller, key };
                    const color = new Color();
                    if (field.color && Color.fromHEX) Color.fromHEX(color, field.color);
                    else color.set(255, 174, 66, 255);
                    controller.setColor?.(color);
                    controller.setOpacity?.(255);
                    // Use only the standalone cube. BoxController's editable face
                    // handles require private topNode state and crash on 3.8.8.
                    if (controller._wireFrameBoxNode) controller._wireFrameBoxNode.active = false;
                    if (controller._wireFrameBoxMeshRenderer) controller._wireFrameBoxMeshRenderer.enabled = false;
                    if (controller._editHandlesShape) controller._editHandlesShape.active = false;
                    if (!controller._cubeNode || typeof controller.initHandle !== 'function') {
                        throw new Error('Standalone position marker is unavailable');
                    }
                    applyGizmoLayer(controller._cubeNode);
                    controller._cubeNode.active = true;
                    if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = true;
                    if (controller._handleDataMap?.[key]) controller.removeHandle?.(key);
                    controller.initHandle(controller._cubeNode, key);
                    repairNativeHandleColors(controller, key, color);
                    entry.visual = createPositionVisual(color);
                    this.registerVisualMouse(entry);
                    const down = (event: any) => { input.record('controllerDown'); this.begin(entry, event); };
                    const move = (event: any) => { input.record('controllerMove'); this.move(entry, event); };
                    const up = () => {
                        input.record('controllerUp');
                        // An unrelated controller may receive the same Scene mouse-up.
                        if (this.drag?.entry === entry) this.finish(false);
                        else if (this.drag || this.hudDrag || this.pendingClick)
                            input.record('ignoredUp');
                    };
                    controller.onControllerMouseDown = down;
                    controller.onControllerMouseMove = move;
                    controller.onControllerMouseUp = up;
                    controller.onMouseDown = down;
                    controller.onMouseMove = move;
                    controller.onMouseUp = up;
                    this.registerController(controller);
                    this.entries.push(entry);
                } catch (error) {
                    console.warn('[cocos-gizmos/handles] Cannot initialize position controller:', error);
                }
            }
            for (const [index, control] of controls.entries()) {
                try {
                    super.createController();
                    const controller = this._controller;
                    if (!controller) continue;
                    const key = 'hud:' + control.id;
                    const entry: HudEntry = { control, controller, key, index };
                    const picking = createHudPickingQuad();
                    entry.picking = picking;
                    const color = new Color();
                    if (typeof Color.fromHEX === 'function') Color.fromHEX(color, control.color);
                    else color.set(58, 182, 255, 255);
                    controller.setColor?.(color);
                    // HUD is painted in a texture; its native cube must be
                    // invisible, while remaining enabled for Scene picking.
                    controller.setOpacity?.(0);
                    if (controller._wireFrameBoxNode) controller._wireFrameBoxNode.active = false;
                    if (controller._wireFrameBoxMeshRenderer) controller._wireFrameBoxMeshRenderer.enabled = false;
                    if (controller._editHandlesShape) controller._editHandlesShape.active = false;
                    if (!controller._cubeNode || typeof controller.initHandle !== 'function') {
                        throw new Error('Standalone HUD marker is unavailable');
                    }
                    applyGizmoLayer(controller._cubeNode);
                    if (picking) {
                        // Keep the controller shape active for move/up dispatch,
                        // but let the actual mesh quad receive HUD pointer hits.
                        if (controller.shape) controller.shape.active = true;
                        controller._cubeNode.active = false;
                        if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = false;
                    } else {
                        controller._cubeNode.active = true;
                        if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = true;
                    }
                    controller.initHandle(picking?.node || controller._cubeNode, key);
                    repairNativeHandleColors(controller, key, color);
                    const down = (event: any) => { input.record('controllerDown'); this.beginHud(entry, event); };
                    const move = (event: any) => { input.record('controllerMove'); this.moveHud(entry, event); };
                    const up = (event: any) => {
                        input.record('controllerUp');
                        if (this.hudDrag?.entry === entry) this.finishHud(false);
                        else if (this.pendingClick === entry) {
                            const releasedOn = readSceneHandleName(event);
                            this.finishHud(!!releasedOn && releasedOn !== entry.key);
                        } else if (this.drag || this.hudDrag || this.pendingClick) {
                            input.record('ignoredUp');
                        }
                    };
                    controller.onControllerMouseDown = down;
                    controller.onControllerMouseMove = move;
                    controller.onControllerMouseUp = up;
                    controller.onMouseDown = down;
                    controller.onMouseMove = move;
                    controller.onMouseUp = up;
                    this.registerController(controller);
                    this.hudEntries.push(entry);
                } catch (error) {
                    console.warn('[cocos-gizmos/hud] Cannot initialize HUD controller:', error);
                }
            }
            this.updateMarkers();
        }

        public refreshHandles(): void {
            const fields = this.descriptors();
            const controls = this.hudDescriptors();
            if (!this.drag && !this.hudDrag && !this.pendingClick &&
                (this.hasDestroyedMarkers() || this.signature(fields, controls) !== this.layout)) {
                this.rebuild();
            } else this.updateMarkers();
        }

        /** UI Sprite mouse events are dispatched through a separate
         * Cocos UI hit-test path in Scene View. Register directly on the
         * point, which is what the user actually clicks, not BoxCollider.
         */
        private registerVisualMouse(entry: Entry): void {
            const node = entry.visual?.sprite?.node;
            if (!node || typeof node.on !== 'function' || !Node?.EventType) return;
            const types = Node.EventType;
            node.on(types.MOUSE_DOWN, (event: any) => {
                if (!this.shown || this.destroyed || this.drag) return;
                if (typeof event?.getButton === 'function' && event.getButton() !== 0) return;
                this.begin(entry, event);
                if (this.drag?.entry === entry) event.propagationStopped = true;
            });
            node.on(types.MOUSE_MOVE, (event: any) => {
                if (this.drag?.entry === entry) this.move(entry, event);
            });
            node.on(types.MOUSE_UP, () => {
                if (this.drag?.entry === entry) this.finish(false);
            });
            node.on(types.TOUCH_START, (event: any) => {
                if (this.shown && !this.drag) this.begin(entry, event);
            });
            node.on(types.TOUCH_MOVE, (event: any) => {
                if (this.drag?.entry === entry) this.move(entry, event);
            });
            node.on(types.TOUCH_END, () => {
                if (this.drag?.entry === entry) this.finish(false);
            });
            // All callbacks are owned by the visual Node and automatically
            // released when its owning Gizmo destroys the visual.
        }

        private updateMarkers(): void {
            if (!this.shown && !this.drag) return;
            const component = this.target as Component;
            if (!component?.node?.isValid) return;
            for (const entry of this.entries) {
                const local = readField(component, entry.field);
                if (!local) {
                    this.hideUnavailableMarker(entry.controller);
                    continue;
                }
                const world = spaceFor(component, entry.field).toWorld(local);
                if (!validPoint(world)) {
                    this.hideUnavailableMarker(entry.controller);
                    continue;
                }
                this.restoreMarker(entry.controller);
                this.ensureMarkerVisible(entry.controller);
                entry.controller.setPosition?.(new Vec3(world.x, world.y, world.z));
                entry.controller.setRotation?.(new Quat());
                const size = markerSize(world);
                setMarkerSize(entry.controller, size);
                if (!entry.visual?.node?.isValid) {
                    const color = new Color(255, 174, 66, 255);
                    if (entry.field.color && Color.fromHEX)
                        Color.fromHEX(color, entry.field.color);
                    entry.visual = createPositionVisual(color);
                    this.registerVisualMouse(entry);
                }
                if (entry.visual?.node?.isValid) {
                    const visible = entry.visual.node;
                    visible.active = true;
                    visible.setWorldPosition(new Vec3(world.x, world.y, world.z));
                    const rotation = camera()?.node?.worldRotation;
                    if (rotation) visible.setWorldRotation(rotation);
                    visible.setWorldScale(new Vec3(size * 0.8, size * 0.8, 1));
                    // Render the Sprite directly in screen space, at the same
                    // near-camera depth as the working HUD overlay.
                    if (entry.visual?.sprite?.node?.isValid) {
                        const view = camera();
                        const screen = new Vec3();
                        const projection = view?.viewport ?
                            createViewportHudProjection(view) : null;
                        let projected = false;
                        if (view && projection) {
                            view.sync?.();
                            try {
                                view.worldToScreen(new Vec3(world.x, world.y, world.z), screen);
                                if (Number.isFinite(screen.x) && Number.isFinite(screen.y)) {
                                    const dot = entry.visual.sprite.node;
                                    dot.setWorldPosition(projection.worldAt(screen.x, screen.y));
                                    const rotation = view.node?.worldRotation;
                                    if (rotation) dot.setWorldRotation(rotation);
                                    dot.setWorldScale(new Vec3(
                                        projection.pixelSize, projection.pixelSize, 1));
                                    dot.active = true;
                                    projected = true;
                                }
                            } catch {
                                // Keep MeshRenderer as fallback for unusual Editor cameras.
                            }
                        }
                        entry.visual.sprite.node.active = projected;
                        entry.visual.renderer.enabled = !projected;
                    }
                }
            }
            if (!this.hudEntries.length) return;
            const view = camera();
            if (typeof view?.worldToScreen !== 'function' ||
                typeof view?.screenPointToRay !== 'function') {
                for (const entry of this.hudEntries) this.hideUnavailableMarker(entry.controller);
                return;
            }
            view.sync?.();
            const projection = (view.viewport && createViewportHudProjection(view)) ||
                createSceneHudProjection(view, component.node.worldPosition);
            if (!projection) {
                for (const entry of this.hudEntries) this.hideUnavailableMarker(entry.controller);
                return;
            }
            const placement = hudLayout?.get(component);
            const textCount = placement ? placement.textCount :
                normalizeHudItems(component.onGizmoHud?.()).length;
            const startRow = placement?.startRow || 0;
            // A HUD row is 22 screen pixels tall. Keep its picking cube about
            // 14 pixels wide; multiplying a 10px world size by 14 creates a
            // ~140px hit box overlapping adjacent buttons and sliders.
            const size = Math.max(1e-8, projection.pixelSize * 14);
            for (const entry of this.hudEntries) {
                this.restoreMarker(entry.controller);
                this.ensureMarkerVisible(entry.controller);
                const row = hudRowScreenPosition(
                    projection.screen, startRow + textCount + entry.index,
                    projection.viewport, hudLayout?.totalRows);
                // Cover the whole HUD control row instead of a tiny 14px
                // dot. Cocos Gizmo Kit similarly uses invisible handle quads.
                const grid = projection.viewport ?
                    hudGrid(projection.viewport,
                        Math.max(hudLayout?.totalRows || 0, startRow + textCount +
                            this.hudEntries.length)) : null;
                const rect = projection.viewport && grid ?
                    hudControlScreenRect(projection.viewport,
                        startRow + textCount + entry.index,
                        hudLayout?.totalRows || startRow + textCount +
                            this.hudEntries.length) : null;
                const hitWidth = rect ? rect.width : 14;
                const centerX = rect ? (rect.left + rect.right) * 0.5 : row.x - 14;
                const centerY = rect ? (rect.bottom + rect.top) * 0.5 : row.y;
                const world = projection.worldAt(centerX, centerY);
                if (entry.picking && entry.picking.node.isValid && rect) {
                    entry.picking.node.active = true;
                    entry.picking.node.setWorldPosition(world);
                    const rotation = view.node?.worldRotation;
                    if (rotation) entry.picking.node.setWorldRotation(rotation);
                    entry.picking.node.setWorldScale(new Vec3(
                        projection.pixelSize * hitWidth,
                        projection.pixelSize * rect.height, 1));
                    // HUD cube stays invisible. Only the accurately projected
                    // transparent plane participates in native Scene raycast.
                } else {
                    entry.controller.setPosition?.(world);
                    setMarkerSize(entry.controller,
                        rect ? projection.pixelSize * hitWidth : size,
                        rect ? projection.pixelSize * rect.height : size,
                        rect ? projection.pixelSize * 6 : size);
                }
            }
        }

        private beginHud(entry: HudEntry, event: any): void {
            if (!this.shown || this.drag || this.hudDrag || this.pendingClick) return;
            const handleName = readSceneHandleName(event);
            if (handleName && handleName !== entry.key) return;
            const component = this.target as Component;
            if (entry.control.type !== 'slider') {
                this.pendingClick = entry;
                return;
            }
            const current = (component as any)[entry.control.property];
            const at = readScenePointer(event);
            if (!at) { input.record('missingPointer'); return; }
            if (!Number.isFinite(current)) return;
            try {
                const view = camera();
                const placement = hudLayout?.get(component);
                const total = hudLayout?.totalRows || 0;
                const track = view?.viewport ?
                    hudSliderScreenTrack(view.viewport,
                        (placement?.startRow || 0) + (placement?.textCount || 0) +
                            entry.index, total || entry.index + 1) : null;
                const solver = new HudSliderDrag(entry.control, current, at.x,
                    track?.width);
                const property = entry.control.property;
                const session = new GizmoEditSession<number>(
                    () => (component as any)[property],
                    (value) => { (component as any)[property] = value; },
                    {
                        begin: (value) => {
                            this.onControlBegin?.(property);
                            try { component.onGizmoHudChanged?.(property, 'begin', value); }
                            catch (error) {
                                this.closeControl(property, undefined, true);
                                throw error;
                            }
                        },
                        update: (value) => {
                            component.onGizmoHudChanged?.(property, 'update', value);
                            this.onControlUpdate?.(property);
                            this.onComponentChanged?.(component.node);
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        rollback: () => {
                            this.onComponentChanged?.(component.node);
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        end: (value, cancelled, changed) => {
                            try {
                                component.onGizmoHudChanged?.(
                                    property, cancelled ? 'cancel' : 'end', value);
                            } finally {
                                this.closeControl(property, undefined, cancelled || !changed);
                                this.updateMarkers();
                            }
                        },
                    },
                );
                session.begin();
                this.hudDrag = { entry, solver, session };
            } catch (error) {
                console.warn('[cocos-gizmos/hud] Cannot begin slider drag:', error);
            }
        }

        private moveHud(entry: HudEntry, event: any): void {
            const drag = this.hudDrag;
            if (!drag || drag.entry !== entry || drag.entry.control.type !== 'slider') return;
            const at = readScenePointer(event);
            if (!at) return;
            const next = drag.solver.move(at.x);
            if (next === null) return;
            try { drag.session.apply(next); }
            catch (error) {
                try { this.finishHud(true); }
                finally { console.warn('[cocos-gizmos/hud] Slider edit cancelled:', error); }
            }
        }

        private finishHud(cancelled: boolean): void {
            const click = this.pendingClick;
            this.pendingClick = null;
            const component = this.target as Component;
            if (click) {
                input.record(cancelled ? 'cancelledClick' : 'committedClick');
            }
            if (click && !cancelled) {
                const control = click.control;
                if (control.type === 'button') {
                    this.onControlBegin?.(click.key);
                    try {
                        component.onGizmoHudAction?.(control.id);
                        this.onComponentChanged?.(component.node);
                    } finally {
                        this.onControlEnd?.(click.key);
                    }
                } else if (control.type === 'toggle' || control.type === 'checkbox') {
                    const value = (component as any)[control.property];
                    if (typeof value === 'boolean') {
                        const property = control.property;
                        const session = new GizmoEditSession<boolean>(
                            () => (component as any)[property],
                            (next) => { (component as any)[property] = next; },
                            {
                                begin: (initial) => {
                                    this.onControlBegin?.(property);
                                    try { component.onGizmoHudChanged?.(property, 'begin', initial); }
                                    catch (error) {
                                        this.closeControl(property, undefined, true);
                                        throw error;
                                    }
                                },
                                update: (next) => {
                                    component.onGizmoHudChanged?.(property, 'update', next);
                                    this.onControlUpdate?.(property);
                                    this.onComponentChanged?.(component.node);
                                    cceNamespace()?.Engine?.repaintInEditMode?.();
                                },
                                rollback: () => this.onComponentChanged?.(component.node),
                                end: (next, cancelled, changed) => {
                                    try {
                                        component.onGizmoHudChanged?.(
                                            property, cancelled ? 'cancel' : 'end', next);
                                    } finally {
                                        this.closeControl(property, undefined, cancelled || !changed);
                                    }
                                },
                            },
                        );
                        session.begin();
                        try {
                            session.apply(!value);
                            session.finish();
                        } catch (error) {
                            session.finish(true);
                            throw error;
                        }
                    }
                }
                this.updateMarkers();
            }
            const drag = this.hudDrag;
            this.hudDrag = null;
            if (!drag || drag.entry.control.type !== 'slider') return;
            drag.session.finish(cancelled);
        }

        private begin(entry: Entry, event: any): void {
            if (!this.shown || this.drag || this.hudDrag || this.pendingClick) return;
            const handleName = readSceneHandleName(event);
            if (handleName && handleName !== entry.key) return;
            const view = readScenePointer(event);
            const ray = view && sceneRay(view);
            if (!ray) { input.record('missingPointer'); return; }
            const target = this.target as Component;
            const original = readField(target, entry.field);
            if (!original) return;
            const transform = spaceFor(target, entry.field);
            const forward = camera()?.node?.forward || ray.d;
            const normal = handlePlaneNormal(entry.field.plane || 'xy', transform, original, forward);
            if (!normal) return;
            try {
                const solver = new PositionDragSolver(original, transform, normal, entry.field);
                if (!solver.begin(ray)) return;
                const property = entry.field.property;
                const index = entry.field.index;
                const session = new GizmoEditSession<Point>(
                    () => readField(target, entry.field) as Point,
                    (value) => {
                        if (!writeField(target, entry.field, value)) {
                            throw new Error('Position handle property is no longer editable');
                        }
                    },
                    {
                        begin: () => {
                            this.onControlBegin?.(property, index);
                            try { target.onGizmoChanged?.(property, 'begin', index); }
                            catch (error) {
                                this.closeControl(property, index, true);
                                throw error;
                            }
                        },
                        update: () => {
                            target.onGizmoChanged?.(property, 'update', index);
                            this.onControlUpdate?.(property, index);
                            this.onComponentChanged?.(target.node);
                            this.updateMarkers();
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        rollback: () => {
                            this.onComponentChanged?.(target.node);
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        end: (_value, cancelled, changed) => {
                            try {
                                target.onGizmoChanged?.(
                                    property, cancelled ? 'cancel' : 'end', index);
                            } finally {
                                this.closeControl(property, index, cancelled || !changed);
                                this.updateMarkers();
                            }
                        },
                    },
                );
                session.begin();
                this.drag = { entry, solver, session };
            } catch (error) {
                console.warn('[cocos-gizmos/handles] Unable to start position drag:', error);
            }
        }

        private move(entry: Entry, event: any): void {
            const drag = this.drag;
            if (!drag || drag.entry !== entry) return;
            const view = readScenePointer(event);
            const ray = view && sceneRay(view);
            if (!ray) return;
            const next = drag.solver.move(ray);
            if (!next) return;
            try { drag.session.apply(next); }
            catch (error) {
                try { this.finish(true); }
                finally { console.warn('[cocos-gizmos/handles] Position edit cancelled:', error); }
            }
        }

        private finish(cancelled: boolean): void {
            const drag = this.drag;
            if (!drag) return;
            this.drag = null;
            drag.session.finish(cancelled);
        }

        /** The Editor can hide its native cube even when a component stays
         * selected. Match the independent position disc in Scene pixels to
         * start native PositionDragSolver gestures without BoxController hits.
         * The selection/move gizmos use the same screenPointToRay coordinates.
         */
        private positionEntryAt(event: any): Entry | null {
            if (!this.shown || this.destroyed || !this.entries.length) return null;
            const pointer = readScenePointer(event);
            const view = camera();
            if (!pointer || typeof view?.worldToScreen !== 'function') return null;
            let nearest: Entry | null = null;
            let bestDistanceSquared = 18 * 18;
            for (const entry of this.entries) {
                const local = readField(this.target as Component, entry.field);
                if (!local) continue;
                const world = spaceFor(this.target as Component, entry.field).toWorld(local);
                if (!validPoint(world)) continue;
                const screen = new Vec3();
                try {
                    view.worldToScreen(new Vec3(world.x, world.y, world.z), screen);
                } catch {
                    continue;
                }
                const dx = screen.x - pointer.x;
                const dy = screen.y - pointer.y;
                const distanceSquared = dx * dx + dy * dy;
                if (Number.isFinite(distanceSquared) && distanceSquared < bestDistanceSquared) {
                    nearest = entry;
                    bestDistanceSquared = distanceSquared;
                }
            }
            return nearest;
        }

        /** Fallback hit-test when Creator consumes a HUD pointer event before
         * its native transparent mesh can receive a Controller callback. */
        private hudEntryAt(event: any): HudEntry | null {
            if (!this.shown || this.destroyed || !this.hudEntries.length) return null;
            const point = readScenePointer(event);
            const viewport = camera()?.viewport;
            const component = this.target as Component;
            const placement = hudLayout?.get(component);
            if (!point || !viewport || !placement) return null;
            for (const entry of this.hudEntries) {
                const rect = hudControlScreenRect(viewport,
                    placement.startRow + placement.textCount + entry.index,
                    hudLayout?.totalRows || 0);
                if (point.x >= rect.left && point.x <= rect.right &&
                    point.y >= rect.bottom && point.y <= rect.top) {
                    return entry;
                }
            }
            return null;
        }

        public onGizmoMouseDown(event: any): void {
            input.record('gizmoDown');
            const name = readSceneHandleName(event);
            const entry = this.entries.find((item) => item.key === name) ||
                (!name ? this.positionEntryAt(event) : null);
            if (entry) this.begin(entry, name ? event : {
                ...event, ...readScenePointer(event), handleName: entry.key,
            });
            const hud = this.hudEntries.find((item) => item.key === name) ||
                (!name ? this.hudEntryAt(event) : null);
            if (hud) this.beginHud(hud, name ? event : {
                ...event, ...readScenePointer(event), handleName: hud.key,
            });
        }

        public onGizmoMouseMove(event: any): void {
            input.record('gizmoMove');
            if (this.drag) this.move(this.drag.entry, event);
            if (this.hudDrag) this.moveHud(this.hudDrag.entry, event);
        }

        public onGizmoMouseUp(event?: any): void {
            input.record('gizmoUp');
            // The Scene Operation route may include a named picking target.
            // A different target must not activate a pending HUD button.
            const click = this.pendingClick;
            const releasedOn = readSceneHandleName(event);
            const clickCancelled = !!click && !!releasedOn && releasedOn !== click.key;
            this.finish(false);
            this.finishHud(clickCancelled);
        }

        // GizmoOperation dispatches these callbacks to every registered Gizmo
        // on Creator 3.8.8, even when no controller was hit.
        public onNotGizmoMouseDown(event?: any): void {
            input.record('outsideDown');
            const hud = this.hudEntryAt(event);
            const point = readScenePointer(event);
            // HUD gets priority when on-screen shapes overlap position points.
            if (!hud && point && !this.drag && !this.pendingClick && !this.hudDrag) {
                const position = this.positionEntryAt(event);
                if (position) {
                    this.begin(position, { ...event, ...point, handleName: position.key });
                    if (this.drag) return;
                }
            }
            if (hud && point && !this.drag && !this.pendingClick && !this.hudDrag) {
                // Controller event routing can be intercepted by another
                // Gizmo. Use the identical screen rectangle as the HUD mesh.
                this.beginHud(hud, { ...event, ...point, handleName: hud.key });
                return;
            }
            this.finish(true);
            this.finishHud(true);
        }

        public onNotGizmoMouseMove(event?: any): void {
            if (this.drag && event) this.move(this.drag.entry, event);
            if (this.hudDrag && event) this.moveHud(this.hudDrag.entry, event);
        }

        public onNotGizmoMouseUp(event?: any): void {
            input.record('outsideUp');
            // A pointer-up on the same HUD rectangle commits click actions;
            // a true outside release cancels buttons, but commits slider drags.
            const click = this.pendingClick;
            const onRow = click && this.hudEntryAt(event) === click;
            this.finish(false);
            this.finishHud(!!click && !onRow);
        }

        public onKeyDown(event: any): boolean | void {
            if ((this.drag || this.hudDrag || this.pendingClick) &&
                (event?.key === 'Escape' || event?.keyCode === 27)) {
                this.finish(true);
                this.finishHud(true);
                return true;
            }
        }

        public isHandleVisible(): boolean { return this.shown; }
        public isHandleDisposed(): boolean { return this.destroyed; }

        public onShow(): void {
            if (this.destroyed) return;
            this.shown = true;
            this.registerGlobalMouse();
            this.registerDomMouse();
            if (!this.beforeDrawRegistered && typeof director?.on === 'function') {
                director.on(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = true;
            }
            this.refreshHandles();
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                if (!this.unavailableMarkers.has(controller)) {
                    repairNativeHandleColors(controller);
                    const hud = this.hudEntries.find(entry => entry.controller === controller);
                    if (hud?.picking?.node?.isValid) hud.picking.node.active = true;
                    else this.ensureMarkerVisible(controller);
                    const point = this.entries.find(entry => entry.controller === controller);
                    if (point?.visual?.node?.isValid) point.visual.node.active = true;
                    this.registerController(controller);
                }
            }
            this.updateMarkers();
        }

        public onHide(): void {
            this.unregisterGlobalMouse();
            this.unregisterDomMouse();
            if (this.beforeDrawRegistered) {
                director.off(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = false;
            }
            for (const entry of this.hudEntries) {
                if (entry.picking?.node?.isValid) entry.picking.node.active = false;
            }
            for (const entry of this.entries) {
                if (entry.visual?.node?.isValid) entry.visual.node.active = false;
            }
            this.finish(true);
            this.finishHud(true);
            this.shown = false;
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                this.unregisterController(controller);
                const hud = this.hudEntries.find(entry => entry.controller === controller);
                suspendNativeController(controller, hud?.picking);
            }
        }

        public diagnosticState(): {
            positionHandles: number;
            hudControls: number;
            draggingPosition: boolean;
            draggingSlider: boolean;
            pendingClick: boolean;
        } {
            return {
                positionHandles: this.entries.length,
                hudControls: this.hudEntries.length,
                draggingPosition: !!this.drag,
                draggingSlider: !!this.hudDrag,
                pendingClick: !!this.pendingClick,
            };
        }

        public onTargetUpdate(): void { this.refreshHandles(); }
        public onNodeChanged(): void { this.updateMarkers(); }
        public updateControllerTransform(): void { this.updateMarkers(); }

        private clearEntries(): void {
            for (const { controller, key } of [...this.entries, ...this.hudEntries]) {
                try {
                    this.unregisterController(controller);
                    const hud = this.hudEntries.find(item => item.controller === controller);
                    suspendNativeController(controller, hud?.picking);
                    controller.removeHandle?.(key);
                    disposeHudPickingQuad(hud?.picking);
                    const point = this.entries.find(item => item.controller === controller);
                    disposePositionVisual(point?.visual);
                } catch (error) {
                    // The Editor can destroy a controller during a Scene switch.
                    // Disposal must not leak a visible marker when Cocos
                    // destroys the native BoxController halfway through cleanup.
                    const point = this.entries.find(item => item.controller === controller);
                    disposePositionVisual(point?.visual);
                    const hud = this.hudEntries.find(item => item.controller === controller);
                    disposeHudPickingQuad(hud?.picking);
                    console.warn('[cocos-gizmos/handles] Discarding a stale controller:', error);
                }
            }
            this.entries.length = 0;
            this.hudEntries.length = 0;
        }

        public onDestroy(): void {
            this.unregisterGlobalMouse();
            this.unregisterDomMouse();
            if (this.beforeDrawRegistered) {
                director.off(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = false;
            }
            this.destroyed = true;
            this.finish(true);
            this.finishHud(true);
            this.shown = false;
            this.clearEntries();
        }
    };
}

export interface PositionHandleSceneAdapter {
    refresh(components: readonly Component[], selected: ReadonlySet<string>, now: number): void;
    /** Immediately hide active controllers when the Scene changes or closes. */
    clear(): void;
    dispose(): void;
    status(): {
        registered: number; active: number; reason: string;
        positionHandles: number; hudControls: number;
        draggingPosition: number; draggingSlider: number; pendingClicks: number;
        input: GizmoInputSnapshot;
    };
}

export function createPositionHandleAdapter(
    allowHud: (component: Component) => boolean = () => true,
    hudLayout?: GizmoHudLayout,
): PositionHandleSceneAdapter {
    const registered = new Map<string, any>();
    const active = new Map<Component, any>();
    let gizmoConstructor: any = null;
    let latestScan = -Infinity;
    let lastSelection = new Set<string>();
    let reason = 'not-initialized';
    const input = new GizmoInputDiagnostics();
    let manager: any = null;
    let typeDefs: any = null;

    function initialize(): boolean {
        const gizmo = cceNamespace()?.Gizmo;
        const pool = gizmo?._gizmoPool?._getPool?.('component');
        if (!pool?.typeDefs || typeof pool.typeDefs['cc.BoxCollider'] !== 'function') {
            reason = 'component-gizmo-bridge-unavailable';
            return false;
        }
        manager = gizmo;
        typeDefs = pool.typeDefs;
        if (!gizmoConstructor) gizmoConstructor = createEditorGizmo(typeDefs['cc.BoxCollider'], allowHud, input, hudLayout);
        reason = 'ready';
        return true;
    }

    function show(component: Component): any {
        // Explicitly re-activate on every selection entry, including
        // A -> no selection -> A. Merely calling gizmo.show() on the stale
        // component reference does not re-register native Scene operation
        // picking after an empty selection in Creator 3.8.8.
        let gizmo = (component as any).gizmo;
        try {
            manager.showComponentGizmo?.(component);
            const mounted = (component as any).gizmo;
            if (mounted instanceof gizmoConstructor) gizmo = mounted;
        } catch {
            // Use createGizmo when Editor keeps a stale component link.
        }
        if (!(gizmo instanceof gizmoConstructor) || gizmo.isHandleDisposed?.()) {
            gizmo = null;
        }
        if (!gizmo && typeof manager.createGizmo === 'function') {
            for (const key of selectedKeys(component)) {
                try {
                    gizmo = manager.createGizmo(key, component) || (component as any).gizmo;
                    if (gizmo instanceof gizmoConstructor) break;
                } catch {
                    // Some class keys are aliases that the pool does not register.
                }
            }
        }
        if (!(gizmo instanceof gizmoConstructor) || gizmo.isHandleDisposed?.()) return null;
        gizmo.show?.();
        // Some Editor Gizmo implementations do not dispatch onShow when
        // reusing a previously hidden component Gizmo. Restore it explicitly.
        if (gizmo.isHandleVisible?.() === false) gizmo.onShow?.();
        gizmo.refreshHandles?.();
        return gizmo;
    }

    return {
        refresh(components, selected, now) {
            const selectionChanged = selected.size !== lastSelection.size ||
                [...selected].some((id) => !lastSelection.has(id));
            // Paint every Scene tick. 2D Graphics are cleared at lateUpdate,
            // whereas registering native Controller instances can be throttled.
            // A rapid A -> B -> A selection still bypasses the controller scan.
            // Visual markers must not disappear even when the Editor replaces
            // the native component Gizmo or temporarily unmounts its cube.
            for (const component of components) {
                if (component?.isValid && component.enabled &&
                    component.node?.activeInHierarchy &&
                    selected.has(component.node.uuid)) {
                    try { drawSelectedPositionMarkers(component); }
                    catch (error) {
                        console.warn('[cocos-gizmos/handles] Cannot paint position markers:', error);
                    }
                }
            }
            // Native Gizmo discovery and activation are heavier than painting.
            if (!selectionChanged && now - latestScan < 250) return;
            lastSelection = new Set(selected);
            latestScan = now;
            if (!initialize()) return;
            const wanted = new Set<Component>();
            for (const component of components) {
                if (!component?.isValid || !component.enabled || !component.node?.activeInHierarchy ||
                    !selected.has(component.node.uuid) ||
                    (typeof component.onGizmoHandles !== 'function' &&
                     (typeof component.onGizmoHudControls !== 'function' ||
                      (hudLayout && !hudLayout.get(component))))) continue;
                wanted.add(component);
                let installed = false;
                for (const key of selectedKeys(component)) {
                    if (!typeDefs[key]) {
                        typeDefs[key] = gizmoConstructor;
                        registered.set(key, gizmoConstructor);
                        installed = true;
                    } else if (typeDefs[key] === gizmoConstructor) installed = true;
                }
                if (!installed) continue;
                const previous = active.get(component);
                if (previous) {
                    // Creator can replace component.gizmo while the adapter still
                    // holds the previous instance after an A -> B -> A selection.
                    if (previous !== (component as any).gizmo ||
                        previous.isHandleDisposed?.() ||
                        previous.isHandleVisible?.() === false) {
                        const restored = show(component);
                        if (restored) active.set(component, restored);
                        else active.delete(component);
                    } else previous.refreshHandles?.();
                } else {
                    const next = show(component);
                    if (next) active.set(component, next);
                }
            }
            for (const [component, gizmo] of active) {
                if (!wanted.has(component)) {
                    gizmo.hide?.();
                    active.delete(component);
                }
            }
        },
        clear() {
            for (const gizmo of active.values()) gizmo.hide?.();
            active.clear();
            lastSelection.clear();
            latestScan = -Infinity;
        },
        dispose() {
            for (const gizmo of active.values()) gizmo.hide?.();
            active.clear();
            for (const [key, ctor] of registered) {
                if (typeDefs?.[key] === ctor) delete typeDefs[key];
            }
            registered.clear();
            lastSelection.clear();
            manager = null;
            typeDefs = null;
            latestScan = -Infinity;
            reason = 'disposed';
        },
        status() {
            const counts = {
                positionHandles: 0, hudControls: 0,
                draggingPosition: 0, draggingSlider: 0, pendingClicks: 0,
            };
            for (const gizmo of active.values()) {
                const info = gizmo.diagnosticState?.();
                if (!info) continue;
                counts.positionHandles += info.positionHandles;
                counts.hudControls += info.hudControls;
                if (info.draggingPosition) counts.draggingPosition++;
                if (info.draggingSlider) counts.draggingSlider++;
                if (info.pendingClick) counts.pendingClicks++;
            }
            return { registered: registered.size, active: active.size, reason, ...counts,
                input: input.snapshot() };
        },
    };
}
