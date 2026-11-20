import { Component, RenderRoot2D, Vec3 } from 'cc';
import { moveWorldPerPixel } from './MoveScreenScale';
import { resolveSceneCamera } from './SceneCameraBridge';
import { planeHandleGeometry, PlaneHandleGeometry } from './PlaneHandleGeometry';
import { axisHandleGeometry, AxisRayGeometry } from './AxisHandleGeometry';
import { boundsOf, ScreenPoint } from './MoveHitGeometry';
import { rotateBasis, rotationRingGeometry, RotateAxis, RotateQuat,
    RotateRing, ROTATE_IDENTITY } from './RotationHandleGeometry';
import { ScenePointer } from './SceneGizmoInput';

/** Editor camera and geometry adapter shared by render, picking and commands.
 * No dependency on BoxCollider or Editor native controller internals.
 */
export type Point = { x:number; y:number; z:number };
export type Field = GizmoHandleDescriptor;

function cceNamespace(): any {
    return (globalThis as any).window?.cce || (globalThis as any).cce || null;
}

export function camera(): any {
    return resolveSceneCamera(cceNamespace()).camera;
}

export function validPoint(value: any): value is Point {
    return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function sceneRay(position: ScenePointer): { o: Point; d: Point } | null {
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

export function spaceFor(component: Component, field: Field): {
    toLocal(point: Point): Point;
    toWorld(point: Point): Point;
} {
    if (field.space === 'world') {
        return {
            toLocal: (point) => ({ ...point }),
            toWorld: (point) => ({ ...point }),
        };
    }
    // Opt-in local frame: an ancestor can own the handle coordinate system
    // even when the editable port belongs to a selected child Component.
    // This frame is used by rendering, native picking and Move commands.
    const frame = field.frameNode || component.node;
    const valid = () => !field.frameNode || frame?.isValid !== false;
    const invalid = () => ({ x: NaN, y: NaN, z: NaN });
    return {
        toLocal: (point) => {
            if (!valid() || !frame?.inverseTransformPoint) return invalid();
            const result = new Vec3();
            frame.inverseTransformPoint(result, new Vec3(point.x, point.y, point.z));
            return { x: result.x, y: result.y, z: result.z };
        },
        toWorld: (point) => {
            if (!valid() || !frame?.worldMatrix) return invalid();
            const result = new Vec3();
            Vec3.transformMat4(result, new Vec3(point.x, point.y, point.z), frame.worldMatrix);
            return { x: result.x, y: result.y, z: result.z };
        },
    };
}

/** Rotation Euler values are orientation, NOT a world/local position.
 * The ring's pivot stays at the Component Node's world position.
 */
export function handleWorldOrigin(component: Component, field: Field, value: Point): Point {
    if (field.visual === 'rotation') {
        if (field.pivotProperty) {
            const pivot = (component as any)[field.pivotProperty];
            if (!validPoint(pivot))return {x:NaN,y:NaN,z:NaN};
            if (field.pivotSpace === 'world')
                return {x:pivot.x,y:pivot.y,z:pivot.z};
            const world = new Vec3();
            Vec3.transformMat4(world,new Vec3(pivot.x,pivot.y,pivot.z),
                component.node.worldMatrix);
            return {x:world.x,y:world.y,z:world.z};
        }
        const pivot = component.node.worldPosition;
        return { x: pivot.x, y: pivot.y, z: pivot.z };
    }
    return spaceFor(component, field).toWorld(value);
}
export function rotationFrame(component: Component): RotateQuat {
    const frame: any = component.node.worldRotation;
    return frame && [frame.x,frame.y,frame.z,frame.w].every(Number.isFinite) ?
        {x:frame.x,y:frame.y,z:frame.z,w:frame.w} : ROTATE_IDENTITY;
}
export function rotationPlacement(component: Component, field: Field,
    euler: Point, world: Point, pixel: number): RotateRing | null {
    if (field.visual !== 'rotation' || !field.axis) return null;
    const basis = rotateBasis(euler,rotationFrame(component),
        field.space === 'world' ? 'world' : 'local');
    return rotationRingGeometry(world,basis,field.axis as RotateAxis,
        pixel*(field.ringSize ?? 72),64);
}

export function readField(target: Component, field: Field): Point | null {
    const raw: any = (target as any)[field.property];
    const value = field.index === undefined ? raw : Array.isArray(raw) ? raw[field.index] : null;
    return validPoint(value) ? { x: value.x, y: value.y, z: value.z } : null;
}

export function writeField(target: Component, field: Field, value: Point): boolean {
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
export function markerSize(world: Point): number {
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

export function isCanvas2D(node: any): boolean {
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
export function planePlacement(component: Component, field: Field,
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
export function axisPlacement(component: Component, field: Field,
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

export function isMoveHandle(field: Field): boolean {
    // Shared render/pick/hover lifecycle for translation and rotation overlays.
    return field.visual === 'axis' || field.visual === 'plane' ||
        field.visual === 'box' || field.visual === 'rotation';
}

export function boxPlacement(component: Component, field: Field,
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

export function projectMovePoint(view: any, point: Point): ScreenPoint | null {
    if (typeof view?.worldToScreen !== 'function') return null;
    const out = new Vec3();
    try { view.worldToScreen(new Vec3(point.x, point.y, point.z), out); }
    catch { return null; }
    return Number.isFinite(out.x) && Number.isFinite(out.y) ?
        { x: out.x, y: out.y } : null;
}

export type ProjectedMoveGeometry = {
    type: 'axis' | 'plane' | 'box' | 'rotation';
    rect: { left: number; right: number; bottom: number; top: number };
    axis?: { start: ScreenPoint; end: ScreenPoint };
    corners?: ScreenPoint[];
    ring?: ScreenPoint[];
};

export function projectedMoveGeometry(component: Component, field: Field,
    local: Point, world: Point, view: any, pixel?: number): ProjectedMoveGeometry | null {
    if (field.visual === 'rotation') {
        const ring = rotationPlacement(component,field,local,world,
            pixel ?? markerSize(world)/22);
        if(!ring) return null;
        const points = ring.points.map(p => projectMovePoint(view,p));
        if(points.some(p=>!p)) return null;
        const projected = points as ScreenPoint[];
        const rect = boundsOf(projected);
        return rect ? {type:'rotation',rect,ring:projected}:null;
    }
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

export function rotationScreenFallback(ring: RotateRing, view: any): {
    tangent: {x:number;y:number}; radiusPixels: number;
} | null {
    const center=projectMovePoint(view,ring.center);
    const u=projectMovePoint(view,ring.points[0]);
    const v=projectMovePoint(view,ring.points[16]);
    if(!center || !u || !v) return null;
    const du={x:u.x-center.x,y:u.y-center.y};
    const dv={x:v.x-center.x,y:v.y-center.y};
    const vector=du.x*du.x+du.y*du.y >= dv.x*dv.x+dv.y*dv.y ? du : dv;
    const length=Math.hypot(vector.x,vector.y);
    if (!Number.isFinite(length) || length < 8) return null;
    return {tangent:{x:vector.x/length,y:vector.y/length},
        radiusPixels:length};
}

