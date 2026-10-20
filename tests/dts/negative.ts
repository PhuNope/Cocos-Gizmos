// @ts-expect-error — the old Gizmos namespace must not be globally available
Gizmos;
// @ts-expect-error — private members must not be part of the public surface
Gizmos2D.getDebugNode;
// @ts-expect-error — internal build namespaces must not leak into the global scope
_Gizmos2D.Gizmos2D;
