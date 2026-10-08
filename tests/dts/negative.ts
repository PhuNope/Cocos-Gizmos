// @ts-expect-error — registerGizmos was removed (gizmos are auto-discovered)
Gizmos.registerGizmos;
// @ts-expect-error — private members must not be part of the public surface
Gizmos.Gizmos2D.getDebugNode;
// @ts-expect-error — internal build namespaces must not leak into the global scope
_Gizmos2D.Gizmos2D;
