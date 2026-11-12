// @ts-expect-error — the old Gizmos namespace must not be globally available
Gizmos;
// @ts-expect-error — private members must not be part of the public surface
Gizmos2D.getDebugNode;
// @ts-expect-error — internal build namespaces must not leak into the global scope
_Gizmos2D.Gizmos2D;

// @ts-expect-error — only supported Scene View handle planes are accepted
const invalidHandlePlane: GizmoHandlePlane = 'yx';
// @ts-expect-error — handles need a component property name
const missingHandleProperty: GizmoHandleDescriptor = { plane: 'xy' };
// @ts-expect-error — the coordinate space must be local or world
const invalidHandleSpace: GizmoHandleSpace = 'screen';
// @ts-expect-error — only declared change phases are accepted
const invalidHandlePhase: GizmoHandlePhase = 'drag';
// @ts-expect-error — snap is a number, not a string
const invalidHandleSnap: GizmoHandleDescriptor = { property: 'target', snap: '5' };
