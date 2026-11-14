import type { Color, Component, Mesh, Node, Vec3 } from 'cc';

declare const node: Node;
declare const color: Color;
declare const pos: Vec3;
declare const mesh: Mesh;
declare const comp: Component;

comp.onDrawGizmos?.();
comp.onDrawGizmosSelected?.();

// All handle types are global: components do not import the extension runtime.
const move2dOptions: GizmosMove2DHandleOptions = {
    space: 'local', axisSize: 66, pickSize: 24,
    planeSize: 18, planeOffset: 14, showPositionLabel: true,
};
const move2dHandles: GizmoHandleList = Gizmos2D.move('target', move2dOptions);
void move2dHandles;
const handle: GizmoHandleDescriptor = {
    property: 'target',
    plane: 'xy',
    space: 'local',
    axis: 'x',
    snap: 5,
    bounds: { min: { x: -500 }, max: { x: 500, y: 200 } },
    color: '#ff8800',
};
const handles: GizmoHandleList = [handle, {
    property: 'points',
    index: 0,
    plane: 'view',
    space: 'world',
}];
const plane: GizmoHandlePlane = 'xz';
const axis: GizmoHandleAxis = 'z';
const space: GizmoHandleSpace = 'world';
const phase: GizmoHandlePhase = 'cancel';
const callback: NonNullable<Component['onGizmoHandles']> = () => handles;
const handleChanged: NonNullable<Component['onGizmoChanged']> =
    (property, currentPhase, index) => {
        const reported: GizmoHandlePhase = currentPhase;
        void property;
        void reported;
        void index;
    };
void [plane, axis, space, phase, callback, handleChanged];
comp.onGizmoHandles?.();
comp.onGizmoChanged?.('target', 'update', 0);

const sceneSettings: GizmoViewSettings = { display: 'selected', hud: 'off' };
const displayMode: GizmoDisplayMode = 'always';
const hudLabels: GizmoHudItem[] = [
    { id: 'speed', text: 'Speed: 10', order: 0, fontSize: 14, color: '#00ff00' },
];
const getSettings: NonNullable<Component['onGizmoSettings']> = () => sceneSettings;
const getHud: NonNullable<Component['onGizmoHud']> = () => hudLabels;
comp.onGizmoSettings?.();
comp.onGizmoHud?.();
void [displayMode, getSettings, getHud];

const hudControls: GizmoHudControlList = [
    { type: 'button', id: 'reset', text: 'Reset' },
    { type: 'slider', id: 'radius', text: 'Radius', property: 'radius',
      min: 0, max: 100, step: 5 },
    { type: 'toggle', id: 'visible', text: 'Visible', property: 'visible' },
    { type: 'checkbox', id: 'grid', text: 'Grid', property: 'grid', color: '#44aaff' },
];
const checkbox: GizmoHudCheckbox = hudControls[3] as GizmoHudCheckbox;
const toggle: GizmoHudToggle = hudControls[2] as GizmoHudToggle;
const getControls: NonNullable<Component['onGizmoHudControls']> = () => hudControls;
const onAction: NonNullable<Component['onGizmoHudAction']> = id => { void id; };
const onChanged: NonNullable<Component['onGizmoHudChanged']> = (property, phase, value) => {
    const typed: number | boolean = value;
    const changePhase: GizmoHandlePhase = phase;
    void [property, typed, changePhase];
};
comp.onGizmoHudControls?.();
comp.onGizmoHudAction?.('reset');
comp.onGizmoHudChanged?.('grid', 'update', true);
comp.onGizmoHudChanged?.('radius', 'update', 50);
void [checkbox, toggle, getControls, onAction, onChanged];



Gizmos2D.beginColor(node, color);
const circleResult: void = Gizmos2D.drawCircle(node, { x: 0, y: 0 }, 100);
Gizmos2D.drawLabel(node, 'id', 'text', { x: 0, y: 0 });
const layer: number = Gizmos2D.DEFAULT_LAYER;
const defaultColor: Readonly<Color> = Gizmos2D.DEFAULT_COLOR;

Gizmos3D.drawSphere(node, pos, 1);
Gizmos3D.drawCircle(node, pos, 10);
Gizmos3D.drawSpline(node, [pos]);
Gizmos3D.drawMesh(node, mesh, pos);
Gizmos3D.drawMesh(node, {vertices: [pos, pos, pos], indices: [0, 1, 2]}, pos, pos, pos, false);
const void3D: void = Gizmos3D.drawBox(node, pos, pos);

// Named imports are also available for module consumers.
import { Gizmos2D as Module2D, Gizmos3D as Module3D } from '../../dist/Gizmos';
Module2D.drawCircle(node, { x: 0, y: 0 }, 1);
Module3D.drawSphere(node, pos, 1);
