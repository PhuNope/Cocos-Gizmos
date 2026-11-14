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

// @ts-expect-error — 2D Move has no 3D selectable object box
const invalid2DMove: GizmosMove2DHandleOptions = { boxSize: 0.5 };
// @ts-expect-error — 2D Move has no Z-specific axis selection
Gizmos2D.move('position', { axis: 'z' });

// @ts-expect-error — toggle needs a boolean component property name
const invalidToggle: GizmoHudToggle = { type: 'toggle', id: 'x', text: 'Toggle' };
// @ts-expect-error — checkbox is distinct from slider
const invalidCheckbox: GizmoHudCheckbox = { type: 'slider', id: 'x', text: 'Check', property: 'flag' };
// @ts-expect-error — slider requires min/max numeric range
const invalidHudSlider: GizmoHudSlider = { type: 'slider', id: 'x', text: 'Speed', property: 'speed' };
// @ts-expect-error — control kind is a literal union
const invalidHudKind: GizmoHudControl = { type: 'switch', id: 'x', text: 'Wrong', property: 'flag' };
