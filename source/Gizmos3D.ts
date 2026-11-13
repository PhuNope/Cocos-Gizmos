import * as cocos from 'cc';
import {
    _decorator,
    Camera,
    CCObject,
    Color,
    Component,
    director,
    geometry,
    GeometryRenderer,
    gfx,
    Label,
    Layers,
    Mat4,
    Mesh,
    Node,
    Quat,
    RenderRoot2D,
    Sprite,
    SpriteFrame,
    toRadian,
    Vec2,
    Vec3,
} from 'cc';
import { cce } from './Define';

const { ccclass, executeInEditMode } = _decorator;


// BEGIN MESH POSITION READER TEST SURFACE
type GizmosMeshInput = Mesh | { vertices: Vec3[]; indices?: number[] };
type GizmosMeshPart = { vertices: Vec3[]; indices: number[] | null };
type GizmosMeshCacheEntry = {
    meshData: Uint8Array;
    primitiveCount: number;
    parts: GizmosMeshPart[];
};

// Static imported meshes are cached across Scene updates. Replacing mesh.data
// invalidates the cache. Raw vertex arrays are intentionally not cached.
const _meshPartsCache = new WeakMap<object, GizmosMeshCacheEntry>();
const _meshWarnedParts = new WeakMap<object, Set<number>>();

/** Convert IEEE 754 half-precision POSITION data into Float32 numbers. */
function gizmosHalfToFloat(value: number): number {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1f;
    const fraction = value & 0x03ff;
    if (exponent === 0) {
        return fraction === 0 ? sign * 0 : sign * Math.pow(2, -14) * (fraction / 1024);
    }
    if (exponent === 0x1f) {
        return fraction === 0 ? sign * Infinity : NaN;
    }
    return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

function warnGizmosMeshPart(mesh: Mesh, index: number, reason: string): void {
    let warned = _meshWarnedParts.get(mesh);
    if (!warned) {
        warned = new Set<number>();
        _meshWarnedParts.set(mesh, warned);
    }
    if (warned.has(index)) return;
    warned.add(index);
    console.warn('[cocos-gizmos/drawMesh] ' + (mesh.name || 'Mesh') +
        ' submesh ' + index + ': ' + reason);
}

function getGizmosMeshParts(mesh: GizmosMeshInput): GizmosMeshPart[] {
    if (!mesh) return [];
    const object = mesh as any;
    if (Array.isArray(object.vertices)) {
        return [{ vertices: object.vertices, indices: object.indices || null }];
    }
    if (typeof object.readAttribute !== 'function' || typeof object.readIndices !== 'function') {
        return [];
    }
    const importedMesh = mesh as Mesh;
    const primitives = importedMesh.struct?.primitives || [];
    const primitiveCount = primitives.length;
    const meshData = importedMesh.data;
    const cached = _meshPartsCache.get(importedMesh);
    if (cached && cached.meshData === meshData && cached.primitiveCount === primitiveCount) {
        return cached.parts;
    }

    const parts: GizmosMeshPart[] = [];
    for (let index = 0; index < primitiveCount; index++) {
        // A primitive can reference any vertex bundle. It is NOT necessarily
        // vertexBundles[index] (multi-submesh imported assets can differ).
        const primitive = primitives[index];
        const positionAttribute = primitive.vertexBundelIndices
            .map((bundleIndex) => importedMesh.struct.vertexBundles[bundleIndex]?.attributes
                ?.find((attribute) => attribute.name === gfx.AttributeName.ATTR_POSITION))
            .find((attribute) => !!attribute);

        if (!positionAttribute) {
            warnGizmosMeshPart(importedMesh, index, 'POSITION attribute not found');
            continue;
        }
        const format = positionAttribute.format;
        const values = importedMesh.readAttribute(index, gfx.AttributeName.ATTR_POSITION);
        if (!values || values.length < 9 || values.length % 3 !== 0) {
            warnGizmosMeshPart(importedMesh, index,
                'POSITION data unavailable or malformed; check Mesh.allowDataAccess');
            continue;
        }

        // Cocos 3.8 readAttribute() returns Uint16Array containing *half
        // bits* for RGB16F, NOT decoded Float32 values.
        const isHalf = format === gfx.Format.RGB16F;
        if (!isHalf &&
            format !== gfx.Format.RGB32F &&
            format !== gfx.Format.RGB16I &&
            format !== gfx.Format.RGB16UI) {
            warnGizmosMeshPart(importedMesh, index,
                'unsupported POSITION format ' + (gfx.Format[format] || format));
            continue;
        }

        const vertices: Vec3[] = [];
        for (let offset = 0; offset < values.length; offset += 3) {
            const x = isHalf ? gizmosHalfToFloat(values[offset]) : Number(values[offset]);
            const y = isHalf ? gizmosHalfToFloat(values[offset + 1]) : Number(values[offset + 1]);
            const z = isHalf ? gizmosHalfToFloat(values[offset + 2]) : Number(values[offset + 2]);
            vertices.push(new Vec3(x, y, z));
        }
        const rawIndices = importedMesh.readIndices(index);
        parts.push({ vertices, indices: rawIndices ? Array.from(rawIndices) : null });
    }
    if (parts.length) {
        _meshPartsCache.set(importedMesh, { meshData, primitiveCount, parts });
    }
    return parts;
}
// END MESH POSITION READER TEST SURFACE

@ccclass('Gizmos3D.GizmosDebugDraw')
@executeInEditMode
class GizmosDebugDraw extends Component {
    private _color: Color = Gizmos3D.DEFAULT_COLOR;
    private _renderer: GeometryRenderer = null;
    private _depthTest: boolean = true;
    private _useLocalPosition: boolean = false;
    private _camera: Node;
    private _warnedNoCamera: boolean = false;
    private _labelMap: Map<string, Label> = new Map();
    private _spriteMap: Map<string, Sprite> = new Map();
    private _root2D: Node;
    // Scene Gizmos can be refreshed on a 250ms watchdog while the renderer
    // lateUpdate still runs every engine frame. A one-frame used-ID reset
    // makes labels flicker (or appear completely invisible). Keep overlays
    // until at least two watchdog intervals have elapsed since last draw.
    private static readonly OVERLAY_GRACE_MS = 750;
    private readonly _lastLabelUsed = new Map<string, number>();
    private readonly _lastSpriteUsed = new Map<string, number>();

    private static get overlayLayer(): number {
        // A 3D-space RenderRoot2D must render on a camera-visible UI layer.
        // Creator's Scene camera commonly excludes UI_2D.
        // Include GIZMOS as well: some Creator Scene View modes render
        // Editor gizmos while excluding the regular UI_3D camera layer.
        return (Layers.Enum.UI_3D ?? 0) | Layers.Enum.GIZMOS;
    }

    private orientToEditorCamera(node: Node): void {
        const editorCce = (globalThis as any).window?.cce || (globalThis as any).cce || cce;
        const cameraNode = editorCce?.Camera?._camera?.camera?.node ||
            editorCce?.Camera?.camera?.node || this._camera;
        if (!cameraNode) return;
        // Label/Sprite nodes live below the demo Node. World rotation is
        // required when the user's Node has a non-zero local rotation.
        if (typeof node.setWorldRotation === 'function' && cameraNode.worldRotation) {
            node.setWorldRotation(cameraNode.worldRotation);
        } else if (cameraNode.eulerAngles) {
            node.setRotationFromEuler(cameraNode.eulerAngles);
        }
    }

    private setOverlayWorldScale(node: Node, x: number, y: number): void {
        // Avoid multiplying the requested world-size by a scaled parent Node.
        // This keeps projected HUD text at a predictable screen pixel size.
        if (typeof node.setWorldScale === 'function') {
            node.setWorldScale(x, y, 1);
        } else {
            const parentScale = node.parent?.worldScale;
            const sx = parentScale?.x && Math.abs(parentScale.x) > 1e-8 ?
                Math.abs(parentScale.x) : 1;
            const sy = parentScale?.y && Math.abs(parentScale.y) > 1e-8 ?
                Math.abs(parentScale.y) : 1;
            node.setScale(x / sx, y / sy, 1);
        }
    }

    protected onLoad(): void {
        this._root2D = new Node('Root2D');
        this._root2D.layer = GizmosDebugDraw.overlayLayer;
        this._root2D.setParent(this.node);
        this._root2D.addComponent(RenderRoot2D);
        this.ensureGeometryRenderer();
    }

    private ensureGeometryRenderer(): boolean {
        if (this._renderer) return true;
        const editorCce = (globalThis as any).window?.cce || (globalThis as any).cce || cce;
        const editorCamera = editorCce?.Camera?._camera?.camera;
        let camera = editorCamera;
        if (!camera) {
            const root = director.getScene();
            camera = root?.getComponentInChildren(Camera)?.camera;
        }
        if (!camera) {
            if (!this._warnedNoCamera) {
                this._warnedNoCamera = true;
                console.warn('[cocos-gizmos/drawMesh] Scene camera unavailable. Open a 3D Scene with an Editor camera.');
            }
            return false;
        }
        try {
            if (typeof camera.initGeometryRenderer === 'function') camera.initGeometryRenderer();
            this._camera = camera.node || null;
            this._renderer = camera.geometryRenderer || null;
        } catch (error) {
            if (!this._warnedNoCamera) {
                this._warnedNoCamera = true;
                console.warn('[cocos-gizmos/drawMesh] Geometry Renderer initialization failed:', error);
            }
        }
        if (this._renderer) this._warnedNoCamera = false;
        return !!this._renderer;
    }

    protected lateUpdate(dt: number): void {
        const now = Date.now();
        this._labelMap.forEach((label, id) => {
            if (now - (this._lastLabelUsed.get(id) ?? -Infinity) >
                GizmosDebugDraw.OVERLAY_GRACE_MS && label.string) {
                label.string = '';
            }
        });
        this._spriteMap.forEach((sprite, id) => {
            if (now - (this._lastSpriteUsed.get(id) ?? -Infinity) >
                GizmosDebugDraw.OVERLAY_GRACE_MS && sprite.spriteFrame) {
                sprite.spriteFrame = null;
            }
        });

        this._color = Gizmos3D.DEFAULT_COLOR;
        this._useLocalPosition = false;
    }

    private localToWorld(local: Vec3): Vec3 {
        return Vec3.transformMat4(new Vec3(), local, this.node.worldMatrix);
    }

    public setDepthTest(value: boolean) {
        this._depthTest = value;
    }

    public setColor(color: Color) {
        // Snapshot once per state change so every primitive can share one color.
        this._color = color.clone();
    }

    public setUseLocalPosition(value: boolean) {
        this._useLocalPosition = value;
    }

    private rotate(pos: Vec3, rot: Vec3 = Vec3.ZERO): Mat4 {
        let result = new Mat4();
        let transform = new Mat4();

        Mat4.fromTranslation(result, pos);

        Mat4.fromXRotation(transform, toRadian(rot.x));
        result.multiply(transform);

        Mat4.fromYRotation(transform, toRadian(rot.y));
        result.multiply(transform);

        Mat4.fromZRotation(transform, toRadian(rot.z));
        result.multiply(transform);

        Mat4.fromTranslation(transform, new Vec3(-pos.x, -pos.y, -pos.z));
        result.multiply(transform);

        return result;
    }

    private getSprite(id: string): Sprite {
        let sprite = this._spriteMap.get(id);
        if (!sprite) {
            sprite = new Node('spriteID: ' + id).addComponent(Sprite);
            this._spriteMap.set(id, sprite);
            sprite.node.setParent(this._root2D);
            sprite.node.layer = GizmosDebugDraw.overlayLayer;
            // The screen HUD is submitted last. Prevent 3D Sprite overlays
            // from sorting above the Scene HUD in Cocos 3.8.8's UI pass.
            const Sorting2D = (cocos as any).Sorting2D;
            if (typeof Sorting2D === 'function') {
                const sorting: any = sprite.node.addComponent(Sorting2D);
                if (sorting) sorting.sortingOrder = -32767;
            }
        }
        return sprite;
    }

    private getLabel(id: string): Label {
        let label = this._labelMap.get(id);
        if (!label) {
            label = new Node('LabelID: ' + id).addComponent(Label);
            this._labelMap.set(id, label);
            label.node.setParent(this._root2D);
            label.node.layer = GizmosDebugDraw.overlayLayer;
            const Sorting2D = (cocos as any).Sorting2D;
            if (typeof Sorting2D === 'function') {
                const sorting: any = label.node.addComponent(Sorting2D);
                if (sorting) sorting.sortingOrder = -32767;
            }
        }
        return label;
    }

    public drawSprite(id: string, spriteFrame: SpriteFrame, position: Vec3, scale: Vec2, color: Color = Color.WHITE) {
        const sprite = this.getSprite(id);
        this._lastSpriteUsed.set(id, Date.now());
        if (sprite.spriteFrame !== spriteFrame) sprite.spriteFrame = spriteFrame;
        if (sprite.color !== color) sprite.color = color;
        if (this._useLocalPosition) sprite.node.setPosition(position);
        else sprite.node.setWorldPosition(position);
        this.setOverlayWorldScale(sprite.node, scale.x, scale.y);
        this.orientToEditorCamera(sprite.node);
    }

    private worldUnitsPerScreenPixel(world: Vec3): number | null {
        const global = globalThis as any;
        const editor = (global.window?.cce || global.cce || cce)?.Camera;
        const direct = editor?.camera;
        const wrapped = editor?._camera?.camera || direct?.camera;
        const raw = typeof direct?.worldToScreen === 'function' &&
            typeof direct?.screenPointToRay === 'function' ? direct : wrapped;
        if (typeof raw?.worldToScreen !== 'function' ||
            typeof raw?.screenPointToRay !== 'function') return null;
        const rendererCamera = (raw === wrapped && raw !== direct) ||
            typeof raw.initGeometryRenderer === 'function' ||
            raw.geometryRenderer !== undefined || raw.matViewProj !== undefined ||
            raw.projectionType !== undefined;
        try {
            const screen = new Vec3();
            if (rendererCamera) raw.worldToScreen(screen, world);
            else raw.worldToScreen(world, screen);
            if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
            const makeRay = (x: number) => {
                const out = { o: new Vec3(), d: new Vec3() };
                const result = rendererCamera ?
                    raw.screenPointToRay(out, x, screen.y) :
                    raw.screenPointToRay(x, screen.y, out);
                return result?.o && result?.d ? result : out;
            };
            const rayA = makeRay(screen.x);
            const rayB = makeRay(screen.x + 1);
            const normal = raw.node?.forward || rayA.d;
            const dot = (a: Vec3, b: Vec3): number =>
                a.x * b.x + a.y * b.y + a.z * b.z;
            const hit = (ray: { o: Vec3; d: Vec3 }): Vec3 | null => {
                const denominator = dot(ray.d, normal);
                if (!Number.isFinite(denominator) ||
                    Math.abs(denominator) <= 1e-10) return null;
                const delta = new Vec3(world.x - ray.o.x,
                    world.y - ray.o.y, world.z - ray.o.z);
                const distance = dot(delta, normal) / denominator;
                if (!Number.isFinite(distance) || distance < 0) return null;
                return new Vec3(ray.o.x + distance * ray.d.x,
                    ray.o.y + distance * ray.d.y,
                    ray.o.z + distance * ray.d.z);
            };
            const a = hit(rayA);
            const b = hit(rayB);
            if (!a || !b) return null;
            const pixel = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
            return Number.isFinite(pixel) && pixel > 1e-10 ? pixel : null;
        } catch {
            // Scene camera can be replaced while switching 2D and 3D.
            return null;
        }
    }

    public drawLabel(
        id: string, text: string, position: Vec3,
        fontSize: number = 40, scale: number = 1,
        minSize?: number, maxSize?: number,
    ) {
        const label = this.getLabel(id);
        this._lastLabelUsed.set(id, Date.now());
        if (label.string !== text) label.string = text;
        label.color = this._color;
        if (label.fontSize !== fontSize) label.fontSize = fontSize;
        if (label.lineHeight !== fontSize) label.lineHeight = fontSize;
        if (this._useLocalPosition) label.node.setPosition(position);
        else label.node.setWorldPosition(position);
        let worldScale = scale;
        if (Number.isFinite(fontSize) && fontSize > 0 &&
            Number.isFinite(scale) && scale > 0 &&
            (Number.isFinite(minSize) || Number.isFinite(maxSize))) {
            const world = this._useLocalPosition ? this.localToWorld(position) : position;
            const pixel = this.worldUnitsPerScreenPixel(world);
            if (pixel) {
                const min = Number.isFinite(minSize) ?
                    Math.max(1, minSize as number) : 1;
                const max = Number.isFinite(maxSize) ?
                    Math.max(min, maxSize as number) : Infinity;
                const projected = fontSize * scale / pixel;
                const bounded = Math.max(min, Math.min(max, projected));
                worldScale = pixel * bounded / fontSize;
            }
        }
        this.setOverlayWorldScale(label.node, worldScale, worldScale);
        this.orientToEditorCamera(label.node);
    }

    public drawLine(point1: Vec3, point2: Vec3) {
        const color = this._color;
        const p1 = this._useLocalPosition ? this.localToWorld(point1) : point1;
        const p2 = this._useLocalPosition ? this.localToWorld(point2) : point2;
        this._renderer?.addLine(p1, p2, color, this._depthTest);
    }

    public drawLineList(points: Vec3[], close: boolean = false) {
        const color = this._color;
        const pointList = this._useLocalPosition ? points.map((p) => this.localToWorld(p)) : points;
        if (pointList.length > 0) {
            for (let i = 0; i < pointList.length - 1; i++) {
                this._renderer?.addLine(pointList[i], pointList[i + 1], color, this._depthTest);
            }

            if (close) {
                this._renderer?.addLine(pointList[pointList.length - 1], pointList[0], color, this._depthTest);
            }
        }
    }

    public drawDashLine(point1: Vec3, point2: Vec3) {
        const color = this._color;
        const p1 = this._useLocalPosition ? this.localToWorld(point1) : point1;
        const p2 = this._useLocalPosition ? this.localToWorld(point2) : point2;
        this._renderer?.addDashedLine(p1, p2, color, this._depthTest);
    }

    public drawDashLineList(points: Vec3[], close: boolean = false) {
        const color = this._color;
        const pointList = this._useLocalPosition ? points.map((p) => this.localToWorld(p)) : points;
        if (pointList.length > 0) {
            for (let i = 0; i < pointList.length - 1; i++) {
                this._renderer?.addDashedLine(pointList[i], pointList[i + 1], color, this._depthTest);
            }

            if (close) {
                this._renderer?.addDashedLine(pointList[pointList.length - 1], pointList[0], color, this._depthTest);
            }
        }
    }

    public drawCircle(center: Vec3, radius: number, rot: Vec3 = Vec3.ZERO, segments: number = 32) {
        const color = this._color;
        const c = this._useLocalPosition ? this.localToWorld(center) : center;
        const transform = this.rotate(c, rot);
        this._renderer?.addCircle(c, radius, color, segments, this._depthTest, true, transform);
    }

    public drawDisc(
        center: Vec3,
        radius: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const color = this._color;
        const c = this._useLocalPosition ? this.localToWorld(center) : center;
        const transform = this.rotate(c, rot);
        this._renderer?.addDisc(c, radius, color, segments, wireFrame, this._depthTest, true, true, transform);
    }

    public drawQuad(point1: Vec3, point2: Vec3, point3: Vec3, point4: Vec3, wireFrame: boolean = false) {
        const color = this._color;
        const p1 = this._useLocalPosition ? this.localToWorld(point1) : point1;
        const p2 = this._useLocalPosition ? this.localToWorld(point2) : point2;
        const p3 = this._useLocalPosition ? this.localToWorld(point3) : point3;
        const p4 = this._useLocalPosition ? this.localToWorld(point4) : point4;
        this._renderer?.addQuad(p1, p2, p3, p4, color, wireFrame, this._depthTest);
    }

    public drawSphere(
        center: Vec3,
        radius: number,
        wireFrame: boolean = false,
        segmentsX: number = 32,
        segmentsY: number = 16,
    ) {
        const color = this._color;
        const c = this._useLocalPosition ? this.localToWorld(center) : center;
        this._renderer?.addSphere(c, radius, color, segmentsX, segmentsY, wireFrame, this._depthTest);
    }

    public drawArc(
        center: Vec3,
        radius: number,
        startAngle: number,
        endAngle: number,
        rot: Vec3 = Vec3.ZERO,
        segments: number = 32,
    ) {
        const color = this._color;
        const c = this._useLocalPosition ? this.localToWorld(center) : center;
        const transform = this.rotate(c, rot);
        this._renderer?.addArc(c, radius, color, startAngle, endAngle, segments, this._depthTest, true, transform);
    }

    public drawSolidArc(
        center: Vec3,
        radius: number,
        startAngle: number,
        endAngle: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const color = this._color;
        const c = this._useLocalPosition ? this.localToWorld(center) : center;
        const transform = this.rotate(c, rot);
        this._renderer?.addSector(
            c,
            radius,
            color,
            startAngle,
            endAngle,
            segments,
            wireFrame,
            this._depthTest,
            true,
            true,
            transform,
        );
    }

    public drawPolygon(
        position: Vec3,
        radius: number,
        segments: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
    ) {
        const color = this._color;
        const p = this._useLocalPosition ? this.localToWorld(position) : position;
        const transform = this.rotate(p, rot);
        this._renderer?.addPolygon(p, radius, color, segments, wireFrame, this._depthTest, true, true, transform);
    }

    public drawOctahedron(position: Vec3, radius: number, rot: Vec3 = Vec3.ZERO, wireFrame: boolean = false) {
        const color = this._color;
        const p = this._useLocalPosition ? this.localToWorld(position) : position;
        const transform = this.rotate(p, rot);
        this._renderer?.addOctahedron(p, radius, color, wireFrame, this._depthTest, false, true, transform);
    }

    public drawCross(position: Vec3, size: number) {
        const color = this._color;
        const p = this._useLocalPosition ? this.localToWorld(position) : position;
        this._renderer?.addCross(p, size, color, this._depthTest);
    }

    public drawCapsule(
        position: Vec3,
        radius: number,
        height: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segmentsX: number = 32,
        segmentsY: number = 8,
    ) {
        const color = this._color;
        const p = this._useLocalPosition ? this.localToWorld(position) : position;
        const transform = this.rotate(p, rot);
        this._renderer?.addCapsule(
            p,
            radius,
            height,
            color,
            segmentsX,
            segmentsY,
            wireFrame,
            this._depthTest,
            false,
            true,
            transform,
        );
    }

    /** Draw imported cc.Mesh or raw triangle vertices as wireframe/solid Gizmos. */
    public drawMesh(
        mesh: Mesh | { vertices: Vec3[]; indices?: number[] },
        position: Vec3 = this._useLocalPosition ? Vec3.ZERO : this.node.worldPosition,
        rotation: Vec3 = Vec3.ZERO,
        scale: Vec3 = Vec3.ONE,
        wireFrame: boolean = true,
    ): void {
        if (!mesh || !this.ensureGeometryRenderer()) return;
        const color = this._color;
        const quat = new Quat();
        Quat.fromEuler(quat, rotation.x, rotation.y, rotation.z);
        const transform = new Mat4();
        Mat4.fromRTS(transform, quat, position, scale);
        if (this._useLocalPosition) Mat4.multiply(transform, this.node.worldMatrix, transform);
        for (const part of getGizmosMeshParts(mesh)) {
            const { vertices, indices } = part;
            if (vertices.length < 3) continue;
            if (wireFrame) {
                if (indices && indices.length >= 3) {
                    this._renderer.addIndexedMesh(Vec3.ZERO, vertices, indices, color, this._depthTest, true, transform);
                } else {
                    this._renderer.addMesh(Vec3.ZERO, vertices, color, this._depthTest, true, transform);
                }
            } else {
                // Indexed meshes share vertices between triangles. Transform each
                // referenced vertex once per draw to avoid repeated matrix work.
                const transformed: (Vec3 | undefined)[] = indices ? new Array(vertices.length) : [];
                const getPoint = (index: number): Vec3 | undefined => {
                    const source = vertices[index];
                    if (!source) return undefined;
                    if (!indices) return Vec3.transformMat4(new Vec3(), source, transform);
                    let point = transformed[index];
                    if (!point) {
                        point = Vec3.transformMat4(new Vec3(), source, transform);
                        transformed[index] = point;
                    }
                    return point;
                };
                const count = indices ? indices.length : vertices.length;
                for (let i = 0; i + 2 < count; i += 3) {
                    const a = getPoint(indices ? indices[i] : i);
                    const b = getPoint(indices ? indices[i + 1] : i + 1);
                    const c = getPoint(indices ? indices[i + 2] : i + 2);
                    if (!a || !b || !c) continue;
                    this._renderer.addTriangle(a, b, c, color, false, this._depthTest, true);
                }
            }
        }
    }

    public drawBox(position: Vec3, size: Vec3, rot: Vec3 = Vec3.ZERO, wireFrame: boolean = false) {
        const color = this._color;
        const p = this._useLocalPosition ? this.localToWorld(position) : position;
        const transform = this.rotate(p, rot);
        let box = geometry?.AABB.create(p.x, p.y, p.z, size.x, size.y, size.z);
        this._renderer?.addBoundingBox(box, color, wireFrame, this._depthTest, false, true, transform);
    }

    public drawCylinder(
        position: Vec3,
        radius: number,
        height: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const color = this._color;
        const p = this._useLocalPosition ? this.localToWorld(position) : position;
        const transform = this.rotate(p, rot);
        this._renderer?.addCylinder(
            p,
            radius,
            height,
            color,
            segments,
            wireFrame,
            this._depthTest,
            false,
            true,
            transform,
        );
    }

    public drawCone(
        position: Vec3,
        radius: number,
        height: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const color = this._color;
        const p = this._useLocalPosition ? this.localToWorld(position) : position;
        const transform = this.rotate(p, rot);
        this._renderer?.addCone(p, radius, height, color, segments, wireFrame, this._depthTest, false, true, transform);
    }

    public drawBezier(
        point1: Vec3,
        point2: Vec3,
        point3: Vec3,
        point4: Vec3,
        rot: Vec3 = Vec3.ZERO,
        segments: number = 32,
    ) {
        const color = this._color;
        const p1 = this._useLocalPosition ? this.localToWorld(point1) : point1;
        const p2 = this._useLocalPosition ? this.localToWorld(point2) : point2;
        const p3 = this._useLocalPosition ? this.localToWorld(point3) : point3;
        const p4 = this._useLocalPosition ? this.localToWorld(point4) : point4;
        const transform = this.rotate(p1, rot);
        this._renderer?.addBezier(p1, p2, p3, p4, color, segments, this._depthTest, true, transform);
    }

    public drawSpline(
        knots: Vec3[],
        mode: geometry.SplineMode = geometry?.SplineMode.BEZIER,
        knotSize = 0.5,
        segments: number = 32,
    ) {
        const color = this._color;
        const knotsList = this._useLocalPosition ? knots.map((knot) => this.localToWorld(knot)) : knots;
        let spline = geometry?.Spline.create(mode, knotsList);
        this._renderer?.addSpline(spline, color, 0xffffffff, knotSize, segments, this._depthTest);
    }
}

export class Gizmos3D {
    public static readonly DEFAULT_COLOR = Color.BLUE;
    public static readonly DEFAULT_LAYER = Layers.Enum.GIZMOS;
    private static readonly _debugNodes = new WeakMap<Node, GizmosDebugDraw>();

    private static getDebugNode(node: Node) {
        const cached = this._debugNodes.get(node);
        if (cached && cached.isValid !== false && cached.node?.isValid !== false && cached.node?.parent === node) {
            return cached;
        }
        let debugNode = node.getComponentInChildren(GizmosDebugDraw);
        if (!debugNode) {
            debugNode = new Node('DEBUG_DRAW3D_NODE').addComponent(GizmosDebugDraw);
            debugNode.node.layer = this.DEFAULT_LAYER;
            debugNode.node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
            debugNode.node.parent = node;
        }

        this._debugNodes.set(node, debugNode);
        return debugNode;
    }

    public static setDepTest(node: Node, value: boolean) {
        let debugNode = this.getDebugNode(node);
        debugNode?.setDepthTest(value);
    }

    public static beginColor(node: Node, color: Color) {
        this.getDebugNode(node)?.setColor(color);
    }

    static beginLocalPosition(node: Node) {
        this.getDebugNode(node)?.setUseLocalPosition(true);
    }

    static endLocalPosition(node: Node) {
        this.getDebugNode(node)?.setUseLocalPosition(false);
    }

    public static drawSprite(
        node: Node,
        id: string,
        spriteFrame: SpriteFrame,
        position: Vec3,
        scale: Vec2 = Vec2.ONE,
        color: Color = Color.WHITE,
    ) {
        this.getDebugNode(node).drawSprite(id, spriteFrame, position, scale, color);
    }

    public static drawLabel(
        node: Node,
        id: string,
        text: string,
        position: Vec3,
        fontSize: number = 15,
        scale: number = 1,
        /** Minimum font height in Scene screen pixels while zooming. */
        minSize?: number,
        /** Maximum font height in Scene screen pixels while zooming. */
        maxSize?: number,
    ) {
        this.getDebugNode(node)?.drawLabel(id, text, position,
            fontSize, scale, minSize, maxSize);
    }

    public static drawLine(node: Node, point1: Vec3, point2: Vec3) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawLine(point1, point2);
    }

    public static drawLineList(node: Node, points: Vec3[], close: boolean = false) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawLineList(points, close);
    }

    public static drawDashLine(node: Node, point1: Vec3, point2: Vec3) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawDashLine(point1, point2);
    }

    public static drawDashLineList(node: Node, points: Vec3[], close: boolean = false) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawDashLineList(points, close);
    }

    public static drawCircle(node: Node, center: Vec3, radius: number, rot: Vec3 = Vec3.ZERO, segments: number = 32) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawCircle(center, radius, rot, segments);
    }

    public static drawDisc(
        node: Node,
        center: Vec3,
        radius: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawDisc(center, radius, rot, wireFrame, segments);
    }

    public static drawQuad(
        node: Node,
        point1: Vec3,
        point2: Vec3,
        point3: Vec3,
        point4: Vec3,
        wireFrame: boolean = false,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawQuad(point1, point2, point3, point4, wireFrame);
    }

    public static drawSphere(
        node: Node,
        center: Vec3,
        radius: number,
        wireFrame: boolean = false,
        segmentsX: number = 32,
        segmentsY: number = 16,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawSphere(center, radius, wireFrame, segmentsX, segmentsY);
    }

    public static drawArc(
        node: Node,
        center: Vec3,
        radius: number,
        startAngle: number,
        endAngle: number,
        rot: Vec3 = Vec3.ZERO,
        segments: number = 32,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawArc(center, radius, startAngle, endAngle, rot, segments);
    }

    public static drawSolidArc(
        node: Node,
        center: Vec3,
        radius: number,
        startAngle: number,
        endAngle: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawSolidArc(center, radius, startAngle, endAngle, rot, wireFrame, segments);
    }

    public static drawPolygon(
        node: Node,
        position: Vec3,
        radius: number,
        segments: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawPolygon(position, radius, segments, rot, wireFrame);
    }

    public static drawOctahedron(
        node: Node,
        position: Vec3,
        radius: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawOctahedron(position, radius, rot, wireFrame);
    }

    public static drawCross(node: Node, center: Vec3, size: number) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawCross(center, size);
    }

    public static drawCapsule(
        node: Node,
        position: Vec3,
        radius: number,
        height: number,
        rot?: Vec3,
        wireFrame?: boolean,
        segmentsX: number = 32,
        segmentsY: number = 8,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawCapsule(position, radius, height, rot, wireFrame, segmentsX, segmentsY);
    }

    /** Draw Mesh assets or raw triangles in Editor Scene; wireFrame defaults to true. */
    public static drawMesh(
        node: Node,
        mesh: Mesh | { vertices: Vec3[]; indices?: number[] },
        position?: Vec3,
        rotation: Vec3 = Vec3.ZERO,
        scale: Vec3 = Vec3.ONE,
        wireFrame: boolean = true,
    ): void {
        this.getDebugNode(node)?.drawMesh(mesh, position, rotation, scale, wireFrame);
    }

    public static drawBox(node: Node, center: Vec3, size: Vec3, rot?: Vec3, wireFrame?: boolean) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawBox(center, size, rot, wireFrame);
    }

    public static drawCylinder(
        node: Node,
        position: Vec3,
        radius: number,
        height: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawCylinder(position, radius, height, rot, wireFrame, segments);
    }

    public static drawCone(
        node: Node,
        position: Vec3,
        radius: number,
        height: number,
        rot: Vec3 = Vec3.ZERO,
        wireFrame: boolean = false,
        segments: number = 32,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawCone(position, radius, height, rot, wireFrame, segments);
    }

    public static drawBezier(
        node: Node,
        point1: Vec3,
        point2: Vec3,
        point3: Vec3,
        point4: Vec3,
        rot?: Vec3,
        segments: number = 32,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawBezier(point1, point2, point3, point4, rot, segments);
    }

    public static drawSpline(
        node: Node,
        knots: Vec3[],
        mode: geometry.SplineMode = geometry?.SplineMode.BEZIER,
        knotSize = 0.5,
        segments: number = 32,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode?.drawSpline(knots, mode, knotSize, segments);
    }
}

