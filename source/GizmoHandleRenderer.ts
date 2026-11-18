import { Color, Component, Layers, Node, Vec3 } from 'cc';
import { Gizmos2D } from './Gizmos2D';
import { Gizmos3D } from './Gizmos3D';
import { moveStrokeBands, MoveStrokePoint } from './MoveStrokeGeometry';
import {
    Point, Field, camera, readField, handleWorldOrigin, validPoint,
    markerSize, isCanvas2D, planePlacement, axisPlacement, rotationPlacement,
} from './GizmoViewportGeometry';

/** Presentation-only adapter: independent of Editor native gizmo/controller.
 * All user drawings continue to flow through Graphics2D/GeometryRenderer3D.
 */
const selectedHover = new WeakMap<Component,string>();
const lastCanvasPaint = new WeakMap<Component,number>();

export function setSelectedHandleHover(component: Component, key: string | null): void {
    if ((selectedHover.get(component) || null) === key) return;
    if (key) selectedHover.set(component,key);
    else selectedHover.delete(component);
    // Color is part of each Gizmos2D Graphics renderer cache key. The
    // previously hovered color otherwise stays visible for its 750ms idle
    // grace, even after the normal color was painted. Invalidate only the
    // 2D hover transition, not ordinary idle geometry.
    if (component?.node && isCanvas2D(component.node))
        Gizmos2D.invalidateHover(component.node);
}

export function lastSelectedCanvasPaint(component: Component): number {
    return lastCanvasPaint.get(component) || 0;
}

function drawMoveStroke(
    node: Node, a: MoveStrokePoint, b: MoveStrokePoint,
    color: Color, onCanvas: boolean, pixel: number,
    canvasPoint: (point: Point) => Vec3,
): void {
    const view = camera();
    const forward = view?.node?.forward || { x: 0, y: 0, z: -1 };
    const bands = moveStrokeBands(a, b, forward, pixel);
    if (!bands) {
        // Looking straight down one axis makes a camera-facing ribbon
        // degenerate. Keep the 3D arrow segment with a native line.
        if (!onCanvas) {
            Gizmos3D.beginColor(node, color);
            Gizmos3D.drawLine(node, new Vec3(a.x, a.y, a.z),
                new Vec3(b.x, b.y, b.z));
        }
        return;
    }
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

export function drawSelectedPositionMarkers(component: Component): void {
    if (!component?.node?.isValid || typeof component.onGizmoHandles !== 'function') return;
    const fields: Field[] = component.onGizmoHandles() || [];
    if (!Array.isArray(fields) || !fields.length) return;
    const node = component.node;
    const onCanvas = isCanvas2D(node);
    camera()?.sync?.();
    const previousDepthTest = onCanvas ? true : Gizmos3D.getDepTest(node);
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
            const world = handleWorldOrigin(component, field, local);
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
            const ring = rotationPlacement(component, field, local, world, pixel);
            if (ring) {
                // Soft rings are drawn through the same camera-facing stroke
                // routine as Move, with fixed ~2px width at any Scene zoom.
                // The native annulus mesh handles raycast; this is visual only.
                for(let i=1;i<ring.points.length;i++)
                    drawMoveStroke(node,ring.points[i-1],ring.points[i],
                        color,onCanvas,pixel,canvasPoint);
                continue;
            }
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
            lastCanvasPaint.set(component, Date.now());
        } else {
            // Restore the user's original setting; a drawer may choose
            // depthTest=false for all its onDrawGizmos() primitives.
            Gizmos3D.setDepTest(node, previousDepthTest);
            Gizmos3D.beginColor(node, Gizmos3D.DEFAULT_COLOR);
        }
    }
}

