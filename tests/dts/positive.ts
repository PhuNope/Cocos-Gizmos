import type { Color, Component, Node, Vec3 } from 'cc';

declare const node: Node;
declare const color: Color;
declare const pos: Vec3;
declare const comp: Component;

comp.onDrawGizmos?.();
comp.onDrawGizmosSelected?.();

Gizmos.Gizmos2D.beginColor(node, color);
const circleResult: void = Gizmos.Gizmos2D.drawCircle(node, { x: 0, y: 0 }, 100);
Gizmos.Gizmos2D.drawLabel(node, 'id', 'text', { x: 0, y: 0 });
const layer: number = Gizmos.Gizmos2D.DEFAULT_LAYER;
const defaultColor: Readonly<Color> = Gizmos.Gizmos2D.DEFAULT_COLOR;

Gizmos.Gizmos3D.drawSphere(node, pos, 1);
Gizmos.Gizmos3D.drawCircle(node, pos, 10);
Gizmos.Gizmos3D.drawSpline(node, [pos]);
const void3D: void = Gizmos.Gizmos3D.drawBox(node, pos, pos);
