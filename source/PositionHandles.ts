import { CCObject, Color, Component, director, Director, gfx, Layers,
    ImageAsset, Material, Mesh, MeshRenderer, Node, Quat, RenderRoot2D,
    Sprite, SpriteFrame, Texture2D, UITransform, utils, Vec3 } from 'cc';
import { Gizmos2D } from './Gizmos2D';
import { Gizmos3D } from './Gizmos3D';
import {
    handlePlaneNormal,
    intersectHandlePlane,
} from './PositionDragSolver';
import { GizmoMoveCommand } from './GizmoMoveCommand';
import { HudControl, HudSliderDrag, hudGrid, hudRowScreenPosition, hudControlScreenRect,
    hudSliderScreenTrack, normalizeHudControls, hudControlLayoutSignature } from './GizmoHudControls';
import { createSceneHudProjection, createViewportHudProjection } from './GizmoHudProjection';
import { normalizeHudItems } from './GizmoPresentation';
import { GizmoEditSession } from './GizmoEditSession';
import { planeHandleGeometry, PlaneHandleGeometry } from './PlaneHandleGeometry';
import { moveWorldPerPixel } from './MoveScreenScale';
import { moveStrokeBands, MoveStrokePoint } from './MoveStrokeGeometry';
import { axisHandleGeometry, axisDragNormal, AxisRayGeometry } from './AxisHandleGeometry';
import { boundsOf, centerDistanceSquared, distanceToSegmentSquared,
    insideProjectedPlane, rectContains, ScreenPoint } from './MoveHitGeometry';
import { GizmoHudLayout } from './GizmoHudLayout';
import { resolveSceneCamera } from './SceneCameraBridge';
import {
    GizmoInputDiagnostics, GizmoInputSnapshot, isPrimaryScenePointer,
    readSceneHandleName, readScenePointer, ScenePointer,
} from './SceneGizmoInput';

type Point = { x: number; y: number; z: number };
type Field = GizmoHandleDescriptor;
type PositionVisual = {
    node: Node; renderer: MeshRenderer; material: Material; mesh: Mesh;
    sprite?: Sprite | null; image?: ImageAsset | null; texture?: Texture2D | null;
    frame?: SpriteFrame | null; uiRoot?: Node | null;
};
type Entry = { field: Field; controller: any; key: string;
    visual?: PositionVisual | null;
    picking?: HudPickingQuad | null;
};
/** Editor-only hover state (never serialized onto user components). */
const selectedHover = new WeakMap<Component, string>();
type DragState = { entry: Entry; command: GizmoMoveCommand };
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

/** Consistent camera-pixel size in both ortho 2D and perspective 3D.
 * Never fall back to a large hardcoded world size after a successful
 * projection: that caused giant arrows when the Scene was zoomed in.
 */
function markerSize(world: Point): number {
    const view = camera();
    if (typeof view?.worldToScreen !== 'function') return 0.22;
    // Callers synchronize the camera once per frame before sampling.
    const project = (p: Point): { x: number; y: number } | null => {
        try {
            const screen = new Vec3();
            view.worldToScreen(new Vec3(p.x, p.y, p.z), screen);
            return Number.isFinite(screen.x) && Number.isFinite(screen.y) ?
                { x: screen.x, y: screen.y } : null;
        } catch { return null; }
    };
    const pixel = moveWorldPerPixel(world, project,
        view.node?.right, view.node?.up);
    return pixel === null ? 0.22 : Math.max(1e-10, pixel * 22);
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

/** Both rendering and native edit-face picking use this one geometry.
 * The two axes come from the component's coordinate space, so rotated Nodes
 * retain the correct movement plane without changing the target Vec3.
 */
function planePlacement(component: Component, field: Field,
    local: Point, world: Point, resolvedPixel = markerSize(world) / 22): PlaneHandleGeometry | null {
    if (field.visual !== 'plane' || field.plane === 'view' || !field.plane) return null;
    const space = spaceFor(component, field);
    const basis = (axis: 'x' | 'y' | 'z'): Point => {
        const next = { ...local, [axis]: local[axis] + 1 };
        const point = space.toWorld(next);
        return { x: point.x - world.x, y: point.y - world.y, z: point.z - world.z };
    };
    const pixel = resolvedPixel;
    return planeHandleGeometry(world, {
        x: basis('x'), y: basis('y'), z: basis('z'),
    }, field.plane, pixel,
    field.planeSize ?? 18, field.planeOffset ?? 14);
}

/** Position of a compact X/Y/Z ray on the same local/world basis as the
 * editable Vec3; no new serialized properties or Scene nodes are created.
 */
function axisPlacement(component: Component, field: Field,
    local: Point, world: Point, resolvedPixel = markerSize(world) / 22): AxisRayGeometry | null {
    if (field.visual !== 'axis' || !field.axis) return null;
    const space = spaceFor(component, field);
    const next = { ...local, [field.axis]: local[field.axis] + 1 };
    const point = space.toWorld(next);
    const direction = { x: point.x - world.x, y: point.y - world.y,
        z: point.z - world.z };
    const unit = field.axis === 'x' ? { x: direction.x, y: direction.y, z: direction.z } :
        direction;
    const axes = { x: unit, y: unit, z: unit };
    return axisHandleGeometry(world, axes, field.axis,
        resolvedPixel, field.axisSize ?? 66);
}

function isMoveHandle(field: Field): boolean {
    return field.visual === 'axis' || field.visual === 'plane' || field.visual === 'box';
}

function boxPlacement(component: Component, field: Field,
    local: Point): Point[] | null {
    if (field.visual !== 'box' || !Number.isFinite(field.boxSize) ||
        (field.boxSize || 0) <= 0) return null;
    const half = (field.boxSize as number) * 0.5;
    const space = spaceFor(component, field);
    const corners: Point[] = [];
    for (const x of [-half, half])
        for (const y of [-half, half])
            for (const z of [-half, half])
                corners.push(space.toWorld({
                    x: local.x + x, y: local.y + y, z: local.z + z,
                }));
    return corners;
}

function projectMovePoint(view: any, point: Point): ScreenPoint | null {
    if (typeof view?.worldToScreen !== 'function') return null;
    const out = new Vec3();
    try { view.worldToScreen(new Vec3(point.x, point.y, point.z), out); }
    catch { return null; }
    return Number.isFinite(out.x) && Number.isFinite(out.y) ?
        { x: out.x, y: out.y } : null;
}

function positionAxisHitProxy(controller: any, geometry: AxisRayGeometry,
    field?: Field): void {
    const face = (controller?._editHandlesShape?.children || []).find(
        (child: any) => child?.name === 'y');
    if (!face || face.isValid === false) return;
    const at = geometry.center;
    face.setWorldPosition?.(new Vec3(at.x, at.y, at.z));
    // Make the invisible native +Y pick face a LONG strip aligned with the
    // visible arrow, instead of the previous ~24px square that was almost
    // impossible to click. Its color stays completely transparent.
    const length = Math.hypot(geometry.end.x - geometry.start.x,
        geometry.end.y - geometry.start.y, geometry.end.z - geometry.start.z);
    const px = geometry.size / 24;
    const width = px * Math.max(24, (field?.pickSize ?? 24) * 1.5);
    face.setWorldScale?.(new Vec3(length, width, width));
    const view = camera();
    const rotation = view?.node?.worldRotation;
    if (rotation && typeof Quat.fromEuler === 'function' &&
        typeof Quat.multiply === 'function') {
        const correction = new Quat();
        Quat.fromEuler(correction, 90, 0, 0);
        const local = new Quat();
        // Rotate the long face strip in screen space towards the selected
        // axis ray; its normal stays aligned to the Editor camera.
        try {
            const first = new Vec3();
            const last = new Vec3();
            view?.worldToScreen?.(new Vec3(geometry.start.x, geometry.start.y,
                geometry.start.z), first);
            view?.worldToScreen?.(new Vec3(geometry.end.x, geometry.end.y,
                geometry.end.z), last);
            const angle = Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI;
            const spin = new Quat();
            Quat.fromEuler(spin, 0, Number.isFinite(angle) ? angle : 0, 0);
            Quat.multiply(local, correction, spin);
        } catch { Quat.multiply(local, correction, new Quat()); }
        const orientation = new Quat();
        Quat.multiply(orientation, rotation, local);
        face.setWorldRotation?.(orientation);
    }
}

/** Native BoxController +Y face is the only reliable Creator 3.8 hit proxy.
 * Move/scale that private face to cover the plane tile in world space.
 * Its event callbacks still run through the existing GizmoEditSession.
 */
function positionPlaneHitProxy(controller: any, plane: Field['plane'],
    geometry: PlaneHandleGeometry, field?: Field): void {
    const face = (controller?._editHandlesShape?.children || []).find(
        (child: any) => child?.name === 'y');
    if (!face || face.isValid === false) return;
    const p = geometry.center;
    face.setWorldPosition?.(new Vec3(p.x, p.y, p.z));
    if (typeof face.setWorldScale === 'function') {
        const pixel = geometry.size / Math.max(12, field?.planeSize ?? 36);
        const coverage = Math.max(geometry.size,
            pixel * Math.max(28, (field?.pickSize ?? 24) * 1.75));
        face.setWorldScale(new Vec3(coverage, coverage, coverage));
    }
    if (typeof face.setWorldRotation === 'function' &&
        typeof Quat.fromEuler === 'function') {
        // Builtin +Y edit face lies in XZ. Rotate its normal onto +Z/+X
        // for the XY/YZ squares, respectively.
        const rotation = new Quat();
        if (plane === 'xy') Quat.fromEuler(rotation, 90, 0, 0);
        else if (plane === 'yz') Quat.fromEuler(rotation, 0, 0, -90);
        else Quat.fromEuler(rotation, 0, 0, 0);
        face.setWorldRotation(rotation);
    }
}

/**
 * Draw the marker independently from BoxCollider's private cube mesh. Creator
 * may keep the picking Controller alive while its rendering mesh disappears
 * after a 2D selection switch. The actual drag still uses initHandle and the
 * Editor's controller event pipeline; this is the visible representation.
 */
/** Consistent ~2px Move strokes for both Graphics2D and GeometryRenderer3D.
 * Two alpha-composited quads give each stroke a translucent pixel fringe.
 * Render against the camera plane; hit geometry remains unchanged.
 */
function drawMoveStroke(
    node: Node, a: MoveStrokePoint, b: MoveStrokePoint,
    color: Color, onCanvas: boolean, pixel: number,
    canvasPoint: (point: Point) => Vec3,
): void {
    const view = camera();
    const forward = view?.node?.forward || { x: 0, y: 0, z: -1 };
    const bands = moveStrokeBands(a, b, forward, pixel);
    if (!bands) return;
    const draw = (quad: MoveStrokePoint[], paint: Color) => {
        if (onCanvas) {
            Gizmos2D.beginColor(node, paint);
            Gizmos2D.drawSolidPolygon(node, quad.map(canvasPoint));
        } else {
            Gizmos3D.beginColor(node, paint);
            const points = quad.map(p => new Vec3(p.x, p.y, p.z));
            Gizmos3D.drawQuad(node, points[0], points[1], points[2], points[3], false);
        }
    };
    draw(bands.feather, new Color(color.r, color.g, color.b,
        Math.max(1, Math.round(color.a * 0.24))));
    draw(bands.core, color);
}

function drawSelectedPositionMarkers(component: Component): void {
    if (!component?.node?.isValid || typeof component.onGizmoHandles !== 'function') return;
    const fields: Field[] = component.onGizmoHandles() || [];
    if (!Array.isArray(fields) || !fields.length) return;
    const node = component.node;
    const onCanvas = isCanvas2D(node);
    camera()?.sync?.();
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
            const key = 'position:' + field.property + ':' +
                (field.index ?? 'single') + (field.id ? ':' + field.id : '');
            const highlighted = selectedHover.get(component) === key;
            const colorText = highlighted ? (field.hoverColor || '#ffff65') : field.color;
            if (typeof colorText === 'string' && typeof Color.fromHEX === 'function')
                Color.fromHEX(color, colorText);
            if (field.showPositionLabel) {
                const labelId = 'selected-pos:' + field.property + ':' +
                    (field.index ?? 'single');
                if (onCanvas) {
                    const at = new Vec3();
                    node.inverseTransformPoint(at, new Vec3(world.x, world.y, world.z));
                    // The 2D label is drawn in local Canvas space but sized in
                    // screen pixels, matching the 3D position label zoom policy.
                    const offset = (field.positionLabelOffset ?? 82) *
                        diameter / 22 / sy;
                    Gizmos2D.beginColor(node, Color.WHITE);
                    Gizmos2D.drawLabel(node, labelId,
                        'X: ' + local.x.toFixed(2) + '  Y: ' + local.y.toFixed(2),
                        new Vec3(at.x, at.y + offset, 0), 16,
                        undefined, 12, 22);
                } else {
                    Gizmos3D.drawPositionLabel(node, labelId,
                        new Vec3(world.x, world.y, world.z),
                        { offsetPixels: field.positionLabelOffset ?? 82,
                          digits: 2, minSize: 12, maxSize: 22 });
                }
            }
            // The owning Component already draws the exact editable box.
            // This descriptor contributes only its invisible hit zone.
            if (field.visual === 'box') continue;
            // World geometry is shared with screen hit-testing and drag.
            // Canvas targets must be painted via Gizmos2D Graphics rather than
            // the 3D geometry renderer, otherwise their arrows disappear.
            const canvasPoint = (v: Point): Vec3 => {
                const point = new Vec3();
                node.inverseTransformPoint(point, new Vec3(v.x, v.y, v.z));
                return point;
            };
            const pixel = diameter / 22;
            const ray = axisPlacement(component, field, local, world, pixel);
            if (ray) {
                // A soft-edged 2px ribbon replaces zoom-dependent Graphics
                // lineWidth=5 and jagged native 3D one-pixel debug lines.
                for (const [a, b] of [
                    [ray.start, ray.end],
                    [ray.end, ray.tipLeft],
                    [ray.end, ray.tipRight],
                ]) drawMoveStroke(node, a, b, color, onCanvas, pixel, canvasPoint);
                continue;
            }
            const plane = planePlacement(component, field, local, world, pixel);
            if (plane) {
                const corners = plane.corners;
                if (onCanvas) {
                    Gizmos2D.beginColor(node, new Color(color.r, color.g, color.b, 60));
                    Gizmos2D.drawSolidPolygon(node, corners.map(canvasPoint));
                } else {
                    const points = corners.map(p => new Vec3(p.x, p.y, p.z));
                    Gizmos3D.beginColor(node, new Color(color.r, color.g, color.b, 60));
                    Gizmos3D.drawQuad(node, points[0], points[1],
                        points[2], points[3], false);
                }
                for (let i = 0; i < 4; i++)
                    drawMoveStroke(node, corners[i], corners[(i + 1) % 4],
                        color, onCanvas, pixel, canvasPoint);
                continue;
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
                    // Plain colored drag dot: no '+' glyph. The old cross
                    // looked like a second transform tool on every handle.
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

function createHudPickingQuad(purpose = 'Hud'): HudPickingQuad | null {
    const parent = cceNamespace()?.Gizmo?.gizmoRootNode;
    if (!parent?.isValid || typeof Node !== 'function' ||
        typeof MeshRenderer !== 'function' ||
        typeof utils?.createMesh !== 'function') return null;
    let node: Node | null = null;
    let material: Material | null = null;
    let mesh: Mesh | null = null;
    try {
        node = new Node('CocosGizmos' + purpose + 'Hit');
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
type ProjectedMoveGeometry = {
    type: 'axis' | 'plane' | 'box';
    rect: { left: number; right: number; bottom: number; top: number };
    axis?: { start: ScreenPoint; end: ScreenPoint };
    corners?: ScreenPoint[];
};

function projectedMoveGeometry(component: Component, field: Field,
    local: Point, world: Point, view: any, pixel?: number): ProjectedMoveGeometry | null {
    if (field.visual === 'axis') {
        const arrow = axisPlacement(component, field, local, world, pixel);
        if (!arrow) return null;
        const start = projectMovePoint(view, arrow.start);
        const end = projectMovePoint(view, arrow.end);
        const rect = start && end ? boundsOf([start, end]) : null;
        return start && end && rect ? {
            type: 'axis', rect, axis: { start, end },
        } : null;
    }
    if (field.visual === 'plane') {
        const tile = planePlacement(component, field, local, world, pixel);
        if (!tile) return null;
        const corners = tile.corners.map(p => projectMovePoint(view, p));
        if (corners.some(p => !p)) return null;
        const projected = corners as ScreenPoint[];
        const rect = boundsOf(projected);
        return rect ? { type: 'plane', rect, corners: projected } : null;
    }
    if (field.visual === 'box') {
        const corners = boxPlacement(component, field, local);
        if (!corners) return null;
        const projected = corners.map(p => projectMovePoint(view, p));
        if (projected.some(p => !p)) return null;
        const rect = boundsOf(projected as ScreenPoint[]);
        return rect ? { type: 'box', rect } : null;
    }
    return null;
}

/** One transparent MeshRenderer quad for every move region. GizmoOperation
 * raycasts this *registered* mesh, just as it does working HUD controls.
 * The old editable +Y face was not aligned to the arrow or plane tile and
 * drew the unwanted round '+' glyphs at each proxy center.
 */
function updateMovePickingQuad(
    entry: Entry, geometry: ProjectedMoveGeometry | null,
    view: any, projection: ReturnType<typeof createViewportHudProjection>,
): boolean {
    const picking = entry.picking;
    if (!picking?.node?.isValid || !projection || !geometry) {
        if (picking?.node?.isValid) picking.node.active = false;
        return false;
    }
    const rect = geometry.rect;
    const middleX = (rect.left + rect.right) * 0.5;
    const middleY = (rect.bottom + rect.top) * 0.5;
    if (![middleX, middleY].every(Number.isFinite)) {
        picking.node.active = false;
        return false;
    }
    let width = Math.max(16, rect.right - rect.left + 6);
    let height = Math.max(16, rect.top - rect.bottom + 6);
    let angle = 0;
    if (geometry.axis) {
        const { start, end } = geometry.axis;
        const dx = end.x - start.x, dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 6) {
            picking.node.active = false;
            return false;
        }
        // Entire arrow shaft + head, not only the old tiny center face.
        width = length + 18;
        height = Math.max(24, (entry.field.pickSize ?? 28) * 1.25);
        angle = Math.atan2(dy, dx) * 180 / Math.PI;
    } else if (geometry.type === 'plane') {
        width = Math.max(16, width);
        height = Math.max(16, height);
    }
    picking.node.active = true;
    picking.node.setWorldPosition(projection.worldAt(middleX, middleY));
    const base = view?.node?.worldRotation;
    if (base && geometry.axis &&
        typeof Quat.fromEuler === 'function' &&
        typeof Quat.multiply === 'function') {
        const roll = new Quat();
        Quat.fromEuler(roll, 0, 0, angle);
        const worldRotation = new Quat();
        Quat.multiply(worldRotation, base, roll);
        picking.node.setWorldRotation(worldRotation);
    } else if (base) {
        picking.node.setWorldRotation(base);
    }
    picking.node.setWorldScale(new Vec3(
        projection.pixelSize * width,
        projection.pixelSize * height, 1,
    ));
    if (entry.controller?.shape) entry.controller.shape.active = true;
    return true;
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

/** Creator 3.8.x Scene hit-testing selects BoxController's editable +Y
 * face. The visible position Sprite is purely decorative: it does not enter
 * Editor GizmoOperation's picking list. Mirror the working Cocos Gizmo Kit
 * design by keeping exactly one invisible editable face enabled.
 */
function configurePositionHitProxy(controller: any, color: Color, enabled: boolean): void {
    if (!controller) return;
    // Creator 3.8 uses BoxController's +Y editable face as the hit target.
    // Initializing/showing the face again on *every Scene frame* resets
    // Editor picking state just after mouse-down. Only change the native
    // controller on a real disabled -> enabled transition.
    const wasEnabled = controller.__cocosGizmosProxyEnabled === true;
    if (enabled && !controller.__cocosGizmosProxyReady) {
        try {
            controller._defaultEditHandleSize = 0.08;
            controller.initEditHandles?.();
            controller.__cocosGizmosProxyReady = true;
        } catch (error) {
            // A Creator build without the private editable-face API retains
            // the standalone cube as a fallback; don't disrupt HUD/selection.
            controller.__cocosGizmosProxyReady = false;
            console.warn('[cocos-gizmos/handles] Native edit face init unavailable:', error);
        }
    }
    if (enabled && !wasEnabled && controller.__cocosGizmosProxyReady) {
        try {
            controller.showEditHandles?.();
        } catch (error) {
            console.warn('[cocos-gizmos/handles] Native edit face show unavailable:', error);
        }
    }
    controller.__cocosGizmosProxyEnabled = enabled;
    controller._edit = enabled;
    controller._editable = enabled;
    controller.editable = enabled;
    const shape = controller._editHandlesShape;
    if (shape) {
        shape.active = enabled && controller.__cocosGizmosProxyReady;
        for (const child of shape.children || []) {
            child.active = enabled &&
                controller.__cocosGizmosProxyReady &&
                child.name === 'y';
        }
        // Recursively walking the whole native handle tree every BEFORE_DRAW
        // adds unnecessary work during camera orbit/pan and long edit sessions.
        if (enabled && !wasEnabled) applyGizmoLayer(shape);
    }
    if (enabled && !wasEnabled && controller.__cocosGizmosProxyReady) {
        controller.setEditHandlesColor?.(color);
        // Like Cocos Gizmo Kit, the +Y face is fully transparent but
        // remains present in native GizmoOperation raycast.
        controller.setHandleColor?.('y', color, 0);
        repairNativeHandleColors(controller, 'y', color);
    }
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
        private hoveredKey: string | null = null;
        private setHover(entry: Entry | null): void {
            const next = entry?.key || null;
            if (this.hoveredKey === next || !this.shown || this.destroyed) return;
            this.hoveredKey = next;
            const component = this.target as Component;
            if (component) {
                if (next) selectedHover.set(component, next);
                else selectedHover.delete(component);
            }
            cceNamespace()?.Engine?.repaintInEditMode?.();
        }
        private lastSceneCamera: any = null;
        private lastProjectionMode: any = undefined;
        // Creator's embedded Scene routes mouse events through GizmoOperation,
        // not the Game Canvas input pipeline. Native BoxController's editable
        // +Y face is the same hit proxy used by Cocos Gizmo Kit.
        private readonly beforeDraw = (): void => {
            if (!this.shown || this.destroyed) return;
            // Scene 2D/3D button can replace the renderer camera without
            // changing selected Components. The old native raycast proxy
            // belongs to the previous Scene camera; re-mount it once, not
            // on every rotation/zoom of the new camera.
            this.refreshSceneCamera();
            this.updateMarkers();
            // The Scene scheduler can miss an update during a drag or a
            // wheel zoom. Render and flush before the same GPU draw, rather
            // than leaving red/green 2D arrows one or two frames behind.
            const component = this.target as Component;
            if (this.drag?.entry && component?.node?.isValid &&
                isCanvas2D(component.node)) {
                drawSelectedPositionMarkers(component);
                Gizmos2D.flushEditorFrame();
            }
        };
        private refreshSceneCamera(): void {
            const sceneCamera = cceNamespace()?.Camera;
            const raw = sceneCamera?.camera?.camera ||
                sceneCamera?._camera?.camera || sceneCamera?.camera || null;
            const mode = raw?.projectionType ?? raw?.projection ??
                sceneCamera?.is2D ?? undefined;
            // Creator can return a fresh wrapper for the same Scene camera on
            // each frame. Prefer the stable camera Node to avoid mounting a
            // native BoxController every BEFORE_DRAW (severe Editor lag).
            const identity = raw?.node || raw;
            if (this.lastSceneCamera === identity && this.lastProjectionMode === mode) return;
            const changed = this.lastSceneCamera !== null;
            this.lastSceneCamera = identity;
            this.lastProjectionMode = mode;
            if (!changed || !raw) return;
            for (const entry of this.entries) {
                const controller = entry.controller;
                if (!controller || controller.__cocosGizmosNativeShown === false) continue;
                controller.__cocosGizmosNativeShown = false;
                const color = new Color(255, 174, 66, 255);
                if (entry.field.color && Color.fromHEX)
                    Color.fromHEX(color, entry.field.color);
                try {
                    controller.show?.();
                    controller.__cocosGizmosNativeShown = true;
                    // Native handle binding stays on the registered
                    // transparent Move quad across camera-mode changes.
                    // Only the legacy point marker needs a +Y face refresh.
                    if (!entry.picking) {
                        configurePositionHitProxy(controller, color, false);
                        configurePositionHitProxy(controller, color, true);
                        controller.setOpacity?.(0);
                    } else if (controller._editHandlesShape) {
                        controller._editHandlesShape.active = false;
                    }
                } catch (error) {
                    console.warn('[cocos-gizmos/handles] Camera switch hit proxy:', error);
                }
            }
        }
        private layout = '';
        private readonly registeredControllers = new WeakSet<object>();
        private readonly unavailableMarkers = new WeakSet<object>();

        private hideUnavailableMarker(controller: any): void {
            if (!controller || this.unavailableMarkers.has(controller)) return;
            this.unregisterController(controller);
            const hud = this.hudEntries.find(entry => entry.controller === controller);
            const position = this.entries.find(entry => entry.controller === controller);
            if (position?.visual?.node?.isValid) position.visual.node.active = false;
            suspendNativeController(controller, hud?.picking || position?.picking);
            if (controller.shape) controller.shape.active = false;
            this.unavailableMarkers.add(controller);
        }

        private restoreMarker(controller: any): void {
            if (!this.shown || !controller || !this.unavailableMarkers.has(controller)) return;
            this.unavailableMarkers.delete(controller);
            const hud = this.hudEntries.find(entry => entry.controller === controller);
            const move = this.entries.find(entry => entry.controller === controller);
            const picking = hud?.picking || move?.picking;
            if (picking?.node?.isValid) picking.node.active = true;
            else this.ensureMarkerVisible(controller);
            if (picking && controller.shape) controller.shape.active = true;
            this.registerController(controller);
        }

        /** Creator may hide the cube MeshRenderer while keeping the Gizmo instance. */
        private ensureMarkerVisible(controller: any): void {
            const cube = controller?._cubeNode;
            if (!cube || cube.isValid === false || this.unavailableMarkers.has(controller)) return;
            // HUD quads stay invisible; the BoxCollider cube must never cover
            // the HUD or steal mouse hits from its screen-aligned picker.
            if (this.hudEntries.some(entry => entry.controller === controller && entry.picking) ||
                this.entries.some(entry => entry.controller === controller && entry.picking)) return;
            cube.active = true;
            if (controller._cubeNodeMR?.isValid !== false && controller._cubeNodeMR) {
                controller._cubeNodeMR.enabled = true;
            }
        }

        private hasDestroyedMarkers(): boolean {
            return [...this.entries, ...this.hudEntries].some(({ controller }) =>
                !controller?._cubeNode || controller._cubeNode.isValid === false) ||
                [...this.entries, ...this.hudEntries].some(
                    ({ picking }) => picking && picking.node.isValid === false);
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
                readField(component, field) !== null &&
                (field.visual !== 'plane' || field.plane !== 'view') &&
                (field.visual !== 'axis' || field.axis === 'x' ||
                    field.axis === 'y' || field.axis === 'z') &&
                (field.axisSize === undefined || Number.isFinite(field.axisSize) &&
                    field.axisSize >= 24 && field.axisSize <= 200) &&
                (field.pickSize === undefined || Number.isFinite(field.pickSize) &&
                    field.pickSize >= 12 && field.pickSize <= 72) &&
                (field.planeSize === undefined || Number.isFinite(field.planeSize) &&
                    field.planeSize >= 12 && field.planeSize <= 120) &&
                (field.planeOffset === undefined || Number.isFinite(field.planeOffset) &&
                    field.planeOffset >= 12 && field.planeOffset <= 180));
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
                    field.color, field.bounds, field.id,
                    field.visual || 'point', field.planeSize, field.planeOffset,
                    field.axisSize, field.pickSize, field.boxSize,
                    field.hoverColor,
                    field.showPositionLabel, field.positionLabelOffset,
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
                    const key = `position:${field.property}:${field.index ?? 'single'}` +
                        (field.id ? ':' + field.id : '');
                    const entry: Entry = { field, controller, key };
                    // Reuse the working native HUD quad picking mechanism for
                    // 3D Move arrows, plane squares and the optional body box.
                    // It is the actual registered controller hit target,
                    // while drawSelectedPositionMarkers provides the visuals.
                    entry.picking = isMoveHandle(field) ?
                        createHudPickingQuad('Move') : null;
                    const color = new Color();
                    if (field.color && Color.fromHEX) Color.fromHEX(color, field.color);
                    else color.set(255, 174, 66, 255);
                    controller.setColor?.(color);
                    controller.setOpacity?.(entry.picking ? 0 : 255);
                    controller._hoverColor = color;
                    controller.hoverColor = color;
                    // Registered transparent quads eliminate the native +Y
                    // handle glyph entirely for Move Gizmos. Only standalone
                    // point handles retain the native +Y fallback.
                    if (entry.picking) {
                        if (controller._editHandlesShape)
                            controller._editHandlesShape.active = false;
                    } else configurePositionHitProxy(controller, color, true);
                    if (controller._wireFrameBoxNode) controller._wireFrameBoxNode.active = false;
                    if (controller._wireFrameBoxMeshRenderer) controller._wireFrameBoxMeshRenderer.enabled = false;
                    if (!controller._cubeNode || typeof controller.initHandle !== 'function') {
                        throw new Error('Standalone position marker is unavailable');
                    }
                    applyGizmoLayer(controller._cubeNode);
                    controller._cubeNode.active = !entry.picking;
                    if (controller._cubeNodeMR)
                        controller._cubeNodeMR.enabled = !entry.picking;
                    if (controller._handleDataMap?.[key]) controller.removeHandle?.(key);
                    controller.initHandle(entry.picking?.node || controller._cubeNode, key);
                    repairNativeHandleColors(controller, key, color);
                    // Native mesh only receives pointer events; the circular
                    // point is rendered separately. Keep saved snapshots valid.
                    controller.setOpacity?.(0);
                    if (!entry.picking) controller.setHandleColor?.('y', color, 0);
                    if (entry.picking && controller.shape)
                        controller.shape.active = true;
                    if (!isMoveHandle(field)) {
                        entry.visual = createPositionVisual(color);
                        this.registerVisualMouse(entry);
                    }
                    const down = (event: any) => {
                        input.record('controllerDown');
                        if (!isPrimaryScenePointer(event)) return;
                        // Creator reports the editable face as 'y', not our
                        // custom cube handle. Translate it before begin().
                        const name = readSceneHandleName(event);
                        const candidate = entry.picking ?
                            this.positionEntryAt(event) : null;
                        // Native transparent picking rectangles may overlap.
                        // The exact plane polygon / closest arrow wins when
                        // multiple quads share the same edited Vec3.
                        const selected = candidate &&
                            candidate.field.property === entry.field.property &&
                            isMoveHandle(candidate.field) ? candidate : entry;
                        const location = readScenePointer(event);
                        this.begin(selected, name === selected.key ? event : {
                            ...event, ...(location || {}), handleName: selected.key,
                        });
                    };
                    const move = (event: any) => {
                        input.record('controllerMove');
                        this.move(this.drag?.entry || entry, event);
                    };
                    const up = (event?: any) => {
                        input.record('controllerUp');
                        if (!isPrimaryScenePointer(event)) return;
                        // An unrelated controller may receive the same Scene mouse-up.
                        if (this.drag?.entry === entry ||
                            (entry.picking && this.drag &&
                             this.drag.entry.field.property === entry.field.property))
                            this.finish(false);
                        else if (this.drag || this.hudDrag || this.pendingClick)
                            input.record('ignoredUp');
                    };
                    controller.onControllerHoverIn = (event: any) => {
                        if (this.shown && !this.drag) this.setHover(entry);
                    };
                    controller.onControllerHoverOut = () => {
                        if (!this.drag && this.hoveredKey === entry.key)
                            this.setHover(null);
                    };
                    controller.onHoverIn = controller.onControllerHoverIn;
                    controller.onHoverOut = controller.onControllerHoverOut;
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
                    const down = (event: any) => {
                        input.record('controllerDown');
                        if (isPrimaryScenePointer(event)) this.beginHud(entry, event);
                    };
                    const move = (event: any) => { input.record('controllerMove'); this.moveHud(entry, event); };
                    const up = (event: any) => {
                        input.record('controllerUp');
                        if (!isPrimaryScenePointer(event)) return;
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
                if (!isPrimaryScenePointer(event)) return;
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
            // A middle-button pan moves the Editor camera before the render
            // camera's inverse view-projection matrix is rebuilt. Sync once
            // before updating all native hit faces and visible point Sprites.
            camera()?.sync?.();
            const component = this.target as Component;
            if (!component?.node?.isValid) return;
            const moveView = camera();
            const moveProjection = moveView?.viewport &&
                this.entries.some(entry => entry.picking) ?
                createViewportHudProjection(moveView) : null;
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
                // Editor may reset edit face visibility on selection change.
                const color = new Color(255, 174, 66, 255);
                if (entry.field.color && Color.fromHEX)
                    Color.fromHEX(color, entry.field.color);
                if (!entry.picking)
                    configurePositionHitProxy(entry.controller, color, true);
                const pixel = markerSize(world) / 22;
                const tile = planePlacement(component, entry.field, local, world, pixel);
                const ray = axisPlacement(component, entry.field, local, world, pixel);
                const center = ray?.center || tile?.center || world;
                entry.controller.setPosition?.(new Vec3(center.x, center.y, center.z));
                entry.controller.setRotation?.(new Quat());
                const size = ray?.size || tile?.size || pixel * 22;
                if (!entry.picking) setMarkerSize(entry.controller, size);
                if (entry.picking) {
                    updateMovePickingQuad(entry,
                        projectedMoveGeometry(component, entry.field, local, world, moveView, pixel),
                        moveView, moveProjection);
                    if (entry.controller._editHandlesShape)
                        entry.controller._editHandlesShape.active = false;
                    if (entry.controller._cubeNode)
                        entry.controller._cubeNode.active = false;
                    if (entry.controller._cubeNodeMR)
                        entry.controller._cubeNodeMR.enabled = false;
                } else if (tile) positionPlaneHitProxy(entry.controller,
                    entry.field.plane, tile, entry.field);
                if (ray && !entry.picking) {
                    positionAxisHitProxy(entry.controller, ray, entry.field);
                    // The +Y editable face is the actual native hit proxy.
                    // Hide BoxController's own cube, otherwise three chunky
                    // cubes obscure the three thin axis arrows.
                    if (entry.controller._cubeNode) entry.controller._cubeNode.active = false;
                    if (entry.controller._cubeNodeMR)
                        entry.controller._cubeNodeMR.enabled = false;
                }
                if (!isMoveHandle(entry.field) && !entry.visual?.node?.isValid) {
                    const color = new Color(255, 174, 66, 255);
                    if (entry.field.color && Color.fromHEX)
                        Color.fromHEX(color, entry.field.color);
                    entry.visual = createPositionVisual(color);
                    this.registerVisualMouse(entry);
                }
                if (entry.visual?.node?.isValid) {
                    const visible = entry.visual.node;
                    visible.active = !isMoveHandle(entry.field);
                    visible.setWorldPosition(new Vec3(center.x, center.y, center.z));
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
                            try {
                                view.worldToScreen(new Vec3(center.x, center.y, center.z), screen);
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
                        entry.visual.sprite.node.active = projected &&
                            !isMoveHandle(entry.field);
                        entry.visual.renderer.enabled = !projected &&
                            !isMoveHandle(entry.field);
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
            if (!isPrimaryScenePointer(event)) return;
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
            if (!isPrimaryScenePointer(event)) return;
            if (!this.shown || this.drag || this.hudDrag || this.pendingClick) return;
            const handleName = readSceneHandleName(event);
            if (handleName && handleName !== entry.key) return;
            const view = readScenePointer(event);
            // The native BoxController can receive a left click immediately
            // after middle-button Scene pan, before the next BEFORE_DRAW. Its
            // camera matrices must be current before PositionDragSolver starts.
            if (view) camera()?.sync?.();
            const ray = view && sceneRay(view);
            if (!ray) { input.record('missingPointer'); return; }
            const target = this.target as Component;
            const original = readField(target, entry.field);
            if (!original) return;
            const transform = spaceFor(target, entry.field);
            const forward = camera()?.node?.forward || ray.d;
            const axis = entry.field.visual === 'axis' ?
                axisPlacement(target, entry.field, original,
                    transform.toWorld(original)) : null;
            const normal = axis ?
                axisDragNormal(axis.unit, forward) :
                handlePlaneNormal(entry.field.plane || 'xy', transform, original, forward);
            if (!normal) return;
            try {
                const property = entry.field.property;
                const index = entry.field.index;
                // Application command contains all gesture/constraint/undo
                // orchestration; this adapter only binds Cocos callbacks.
                const command = new GizmoMoveCommand(
                    original, transform, normal, entry.field,
                    {
                        read: () => readField(target, entry.field) as Point,
                        write: (value) => {
                            if (!writeField(target, entry.field, value))
                                throw new Error('Position handle property is no longer editable');
                        },
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
                            if (isCanvas2D(target.node)) {
                                drawSelectedPositionMarkers(target);
                                Gizmos2D.flushEditorFrame();
                            }
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        rollback: () => {
                            this.onComponentChanged?.(target.node);
                            if (isCanvas2D(target.node)) {
                                drawSelectedPositionMarkers(target);
                                Gizmos2D.flushEditorFrame();
                            }
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        end: (_value, cancelled, changed) => {
                            try {
                                target.onGizmoChanged?.(
                                    property, cancelled ? 'cancel' : 'end', index);
                            } finally {
                                this.closeControl(property, index, cancelled || !changed);
                                this.updateMarkers();
                                if (isCanvas2D(target.node)) {
                                    drawSelectedPositionMarkers(target);
                                    Gizmos2D.flushEditorFrame();
                                }
                            }
                        },
                    },
                );
                if (!command.begin(ray)) return;
                this.drag = { entry, command };
                this.setHover(entry);
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
            try { drag.command.update(ray); }
            catch (error) {
                try { this.finish(true); }
                finally { console.warn('[cocos-gizmos/handles] Position edit cancelled:', error); }
            }
        }

        private finish(cancelled: boolean): void {
            const drag = this.drag;
            if (!drag) return;
            this.drag = null;
            if (cancelled) drag.command.cancel();
            else drag.command.end();
        }

        /** The Editor can hide its native cube even when a component stays
         * selected. Match the independent position disc in Scene pixels to
         * start native PositionDragSolver gestures without BoxController hits.
         * The selection/move gizmos use the same screenPointToRay coordinates.
         */
        private positionEntryAt(event: any): Entry | null {
            if (!this.shown || this.destroyed || !this.entries.length ||
                !isPrimaryScenePointer(event)) return null;
            const pointer = readScenePointer(event);
            const view = camera();
            if (!pointer || typeof view?.worldToScreen !== 'function') return null;
            view.sync?.();
            const component = this.target as Component;
            let plane: Entry | null = null;
            let axis: Entry | null = null;
            let box: Entry | null = null;
            let point: Entry | null = null;
            let planeDistance = Infinity, axisDistance = Infinity;
            let boxDistance = Infinity, pointDistance = Infinity;
            for (const entry of this.entries) {
                const local = readField(component, entry.field);
                if (!local) continue;
                const world = spaceFor(component, entry.field).toWorld(local);
                if (!validPoint(world)) continue;
                const projected = projectedMoveGeometry(
                    component, entry.field, local, world, view);
                if (projected?.type === 'plane' && projected.corners) {
                    // The exact visible parallelogram takes precedence over
                    // overlapping strips and the large selectable object box.
                    if (insideProjectedPlane(pointer, projected.corners, 3)) {
                        const distance = centerDistanceSquared(pointer, projected.rect);
                        if (distance < planeDistance) {
                            plane = entry;
                            planeDistance = distance;
                        }
                    }
                    continue;
                }
                if (projected?.type === 'axis' && projected.axis) {
                    const distance = distanceToSegmentSquared(pointer,
                        projected.axis.start, projected.axis.end);
                    const radius = entry.field.pickSize ?? 28;
                    const dx = projected.axis.end.x - projected.axis.start.x;
                    const dy = projected.axis.end.y - projected.axis.start.y;
                    const lenSq = dx * dx + dy * dy;
                    const along = lenSq > 1e-5 ?
                        ((pointer.x - projected.axis.start.x) * dx +
                            (pointer.y - projected.axis.start.y) * dy) / lenSq : -1;
                    // Keep an unambiguous center area for clicking the box.
                    // Without it, a generous arrow radius steals clicks from
                    // the object body even before the visible shaft starts.
                    const centerClearance = this.entries.some(item =>
                        item.field.visual === 'box') ? 0.15 : -0.1;
                    if (along >= centerClearance &&
                        distance <= radius * radius && distance < axisDistance) {
                        axis = entry;
                        axisDistance = distance;
                    }
                    continue;
                }
                if (projected?.type === 'box') {
                    if (rectContains(pointer, projected.rect, 0)) {
                        const distance = centerDistanceSquared(pointer, projected.rect);
                        if (distance < boxDistance) {
                            box = entry;
                            boxDistance = distance;
                        }
                    }
                    continue;
                }
                const screen = projectMovePoint(view, world);
                if (!screen) continue;
                const distance = (screen.x - pointer.x) ** 2 +
                    (screen.y - pointer.y) ** 2;
                const radius = entry.field.pickSize ?? 18;
                if (distance <= radius * radius && distance < pointDistance) {
                    point = entry;
                    pointDistance = distance;
                }
            }
            return plane || axis || box || point;
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
            if (!isPrimaryScenePointer(event)) return;
            const name = readSceneHandleName(event);
            const named = this.entries.find((item) => item.key === name);
            const projected = this.positionEntryAt(event);
            const entry = named && isMoveHandle(named.field) && projected &&
                isMoveHandle(projected.field) &&
                projected.field.property === named.field.property ?
                projected : named || (name === 'y' || !name ? projected : null);
            if (entry) this.begin(entry, name === entry.key ? event : {
                ...event, ...(readScenePointer(event) || {}), handleName: entry.key,
            });
            const hud = this.hudEntries.find((item) => item.key === name) ||
                (!name ? this.hudEntryAt(event) : null);
            if (hud) this.beginHud(hud, name ? event : {
                ...event, ...readScenePointer(event), handleName: hud.key,
            });
        }

        public onGizmoMouseMove(event: any): void {
            input.record('gizmoMove');
            if (!this.drag && !this.hudDrag)
                this.setHover(this.positionEntryAt(event));
            if (this.drag) this.move(this.drag.entry, event);
            if (this.hudDrag) this.moveHud(this.hudDrag.entry, event);
        }

        public onGizmoMouseUp(event?: any): void {
            input.record('gizmoUp');
            if (!isPrimaryScenePointer(event)) return;
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
            // Middle mouse belongs to Scene camera pan, never a Gizmo drag.
            if (!isPrimaryScenePointer(event)) return;
            // Creator dispatches onNotGizmoMouseDown to selected component
            // gizmos even after BoxController's onControllerMouseDown has
            // already started a valid gesture. The previous fallthrough
            // finish(true) cancelled it immediately (begin -> cancel).
            if (this.drag) return; // Native face already owns the gesture.
            if (this.hudDrag || this.pendingClick) {
                // Preserve the existing HUD outside-click cancellation behavior.
                this.finishHud(true);
                return;
            }
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
            // Clicks outside every selected handle are normal Scene
            // interactions. There is no active session to roll back here.
        }

        public onNotGizmoMouseMove(event?: any): void {
            if (!this.drag && !this.hudDrag && event)
                this.setHover(this.positionEntryAt(event));
            if (this.drag && event) this.move(this.drag.entry, event);
            if (this.hudDrag && event) this.moveHud(this.hudDrag.entry, event);
        }

        public onNotGizmoMouseUp(event?: any): void {
            input.record('outsideUp');
            if (!isPrimaryScenePointer(event)) return;
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
            if (!this.beforeDrawRegistered && typeof director?.on === 'function') {
                director.on(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = true;
            }
            this.refreshHandles();
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                if (!this.unavailableMarkers.has(controller)) {
                    repairNativeHandleColors(controller);
                    const point = this.entries.find(entry => entry.controller === controller);
                    if (point && (!controller.__cocosGizmosNativeShown ||
                        controller.shape?.active === false)) {
                        // Creator's BoxController.show() mounts its native
                        // raycast shape. Merely enabling _cubeNode and
                        // registerEvents does NOT make the editable face
                        // clickable. This is the key lifecycle step used
                        // by the working Cocos Gizmo Kit implementation.
                        try {
                            controller.show?.();
                            controller.__cocosGizmosNativeShown = true;
                        } catch (error) {
                            console.warn('[cocos-gizmos/handles] Native controller show unavailable:', error);
                        }
                        const color = new Color(255, 174, 66, 255);
                        if (point.field.color && Color.fromHEX)
                            Color.fromHEX(color, point.field.color);
                        if (!point.picking) {
                            configurePositionHitProxy(controller, color, true);
                            controller.setOpacity?.(0);
                            controller.setHandleColor?.('y', color, 0);
                        }
                    }
                    const hud = this.hudEntries.find(entry => entry.controller === controller);
                    const picker = hud?.picking || point?.picking;
                    if (picker?.node?.isValid) picker.node.active = true;
                    else this.ensureMarkerVisible(controller);
                    if (picker && controller.shape) controller.shape.active = true;
                    if (point?.visual?.node?.isValid)
                        point.visual.node.active = !isMoveHandle(point.field);
                    this.registerController(controller);
                }
            }
            this.updateMarkers();
        }

        public onHide(): void {
            if (this.destroyed) return;
            selectedHover.delete(this.target as Component);
            this.hoveredKey = null;
            // Mark hidden *before* cancelling an in-flight edit. Session's
            // end/rollback callback calls updateMarkers(); if shown is still
            // true, it re-activates the native +Y hit proxy while deselecting.
            this.shown = false;
            if (this.beforeDrawRegistered) {
                director.off(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = false;
            }
            for (const entry of this.hudEntries) {
                if (entry.picking?.node?.isValid) entry.picking.node.active = false;
            }
            for (const entry of this.entries) {
                if (entry.visual?.node?.isValid) entry.visual.node.active = false;
                if (entry.picking?.node?.isValid) entry.picking.node.active = false;
                if (!entry.picking)
                    configurePositionHitProxy(entry.controller, new Color(255,255,255,255), false);
                // The native BoxController keeps a separate raycast shape.
                // Disabling only its cube and +Y face leaves an invisible hit
                // proxy over the 3D View after switching from Test2D.
                if (entry.controller?.shape) entry.controller.shape.active = false;
                entry.controller.__cocosGizmosNativeShown = false;
            }
            this.finish(true);
            this.finishHud(true);
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                this.unregisterController(controller);
                const hud = this.hudEntries.find(entry => entry.controller === controller);
                const move = this.entries.find(entry => entry.controller === controller);
                suspendNativeController(controller, hud?.picking || move?.picking);
                // Even an invisible HUD Controller's native shape can block
                // 3D picking. Only selected Gizmos may own active raycast.
                if (controller?.shape) controller.shape.active = false;
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
            selectedHover.delete(this.target as Component);
            this.hoveredKey = null;
            for (const { controller, key } of [...this.entries, ...this.hudEntries]) {
                try {
                    this.unregisterController(controller);
                    const hud = this.hudEntries.find(item => item.controller === controller);
                    const point = this.entries.find(item => item.controller === controller);
                    suspendNativeController(controller, hud?.picking || point?.picking);
                    if (point && !point.picking) configurePositionHitProxy(controller,
                        new Color(255, 255, 255, 255), false);
                    if (controller?.shape) controller.shape.active = false;
                    controller.removeHandle?.(key);
                    disposeHudPickingQuad(hud?.picking);
                    disposeHudPickingQuad(point?.picking);
                    disposePositionVisual(point?.visual);
                } catch (error) {
                    // The Editor can destroy a controller during a Scene switch.
                    // Disposal must not leak a visible marker when Cocos
                    // destroys the native BoxController halfway through cleanup.
                    const point = this.entries.find(item => item.controller === controller);
                    disposePositionVisual(point?.visual);
                    const hud = this.hudEntries.find(item => item.controller === controller);
                    disposeHudPickingQuad(hud?.picking);
                    disposeHudPickingQuad(point?.picking);
                    console.warn('[cocos-gizmos/handles] Discarding a stale controller:', error);
                }
            }
            this.entries.length = 0;
            this.hudEntries.length = 0;
        }

        public onDestroy(): void {
            if (this.destroyed) return;
            if (this.beforeDrawRegistered) {
                director.off(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = false;
            }
            this.destroyed = true;
            this.shown = false;
            this.lastSceneCamera = null;
            this.finish(true);
            this.finishHud(true);
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
    // Hidden Gizmos are not in "active" but their BoxController shapes,
    // per-frame callbacks and visual Sprite resources still exist. Track all
    // Gizmos ever mounted by this adapter until the Scene changes.
    const owned = new Map<Component, any>();
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

    function releaseGizmo(component: Component, gizmo: any): void {
        if (!gizmo) return;
        try { gizmo.hide?.(); }
        catch (error) {
            console.warn('[cocos-gizmos/handles] Native hide during cleanup:', error);
            try { gizmo.onHide?.(); } catch { /* previous Scene is gone */ }
        }
        try { gizmo.onDestroy?.(); }
        catch (error) {
            console.warn('[cocos-gizmos/handles] Native release during cleanup:', error);
        }
        try {
            if ((component as any)?.gizmo === gizmo)
                (component as any).gizmo = null;
        } catch { /* destroyed component */ }
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
        const previous = owned.get(component);
        if (previous && previous !== gizmo) releaseGizmo(component, previous);
        owned.set(component, gizmo);
        gizmo.show?.();
        // Some Editor Gizmo implementations do not dispatch onShow when
        // reusing a previously hidden component Gizmo. Restore it explicitly.
        if (gizmo.isHandleVisible?.() === false) gizmo.onShow?.();
        gizmo.refreshHandles?.();
        return gizmo;
    }

    /** Scene root changes destroy and replace the Cocos Node tree.
     * Disposing the old native controllers prevents the Editor's Gizmo pool
     * from reusing invalid +Y picking faces on the next scene.
     * Each instance is isolated: a destroyed component must not prevent
     * remaining controllers from being released.
     */
    function releaseForSceneChange(): void {
        // Important: selecting Test2D, then Test3D, removes Test2D from
        // "active" but it still has a cached Gizmo and native BoxController.
        // Release both selected and hidden instances before swapping Scenes.
        for (const [component, gizmo] of owned) {
            releaseGizmo(component, gizmo);
        }
        owned.clear();
        active.clear();
        lastSelection.clear();
        latestScan = -Infinity;
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
            // The Editor can reconstruct unsaved Scene Components without
            // dispatching BEFORE_SCENE_LAUNCH. Their old JS objects disappear
            // from the traversal but their native gizmos stay in the pool.
            // Reclaim them during the existing 250ms discovery pass.
            const present = new Set(components);
            for (const [component, gizmo] of owned) {
                if (!present.has(component) || !component.isValid ||
                    component.node?.isValid === false) {
                    releaseGizmo(component, gizmo);
                    owned.delete(component);
                    active.delete(component);
                }
            }
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
                    // Do not destroy on every selection change, but disable
                    // both native raycast shape and visual picking volume.
                    try { gizmo.hide?.(); }
                    catch (error) {
                        console.warn('[cocos-gizmos/handles] Deselect hide failed:', error);
                        try { gizmo.onHide?.(); } catch { /* stale */ }
                    }
                    active.delete(component);
                }
            }
        },
        clear() {
            releaseForSceneChange();
        },
        dispose() {
            releaseForSceneChange();
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
