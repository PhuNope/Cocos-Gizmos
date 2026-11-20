/**
 * Domain: immutable descriptions of editor gizmos, with no Cocos imports.
 * Scene adapters own rendering, picking and edit transactions.
 *
 * New public authoring API:
 *   Gizmos3D.move('position', { snap: .25 })
 *   Gizmos2D.move('position') // X, Y and XY only; continuous by default
 *   Gizmos2D.point('origin')
 *   Gizmos2D.points('vertices', this.vertices.length)
 */
function propertyName(property: string): string {
    if (typeof property !== 'string' || !property.trim()) {
        throw new Error('Gizmo property must be a non-empty string');
    }
    return property;
}

function size(value: number | undefined, fallback: number, min: number, max: number,
    label: string): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new RangeError(label + ' must be within ' + min + '..' + max);
    }
    return value;
}

export function makeMoveGizmo(
    property: string, options: GizmosMoveHandleOptions = {},
): GizmoHandleDescriptor[] {
    const name = propertyName(property);
    const axisSize = size(options.axisSize, 66, 24, 200, 'axisSize');
    const pickSize = size(options.pickSize, 24, 12, 72, 'pickSize');
    const planeSize = size(options.planeSize, 18, 12, 120, 'planeSize');
    const planeOffset = size(options.planeOffset, 14, 12, 180, 'planeOffset');
    const boxSize = options.boxSize === undefined ? null :
        size(options.boxSize, 0.7, 0.01, 1000, 'boxSize');
    if (options.snap !== undefined && (!Number.isFinite(options.snap) || options.snap <= 0)) {
        throw new RangeError('snap must be positive');
    }
    const shared = {
        property: name,
        space: options.space ?? 'local',
        frameNode: options.frameNode,
        snap: options.snap,
        bounds: options.bounds,
        pickSize,
        hoverColor: options.hoverColor ?? '#ffff65',
    };
    const axes: ReadonlyArray<readonly ['x' | 'y' | 'z', string]> = [
        ['x', '#ff595e'], ['y', '#43df66'], ['z', '#4b8fff'],
    ];
    const planes: ReadonlyArray<readonly ['xy' | 'xz' | 'yz', string]> = [
        ['xy', '#fff16e'], ['xz', '#58dfff'], ['yz', '#ff78de'],
    ];
    return [
        ...axes.map(([axis, color], index): GizmoHandleDescriptor => ({
            ...shared, id: 'axis-' + axis, visual: 'axis',
            plane: 'view', axis, axisSize, color,
            showPositionLabel: index === 0 && options.showPositionLabel !== false,
            positionLabelOffset: options.positionLabelOffset ?? 82,
        })),
        ...planes.map(([plane, color]): GizmoHandleDescriptor => ({
            ...shared, id: 'plane-' + plane, visual: 'plane',
            plane, planeSize, planeOffset, color,
        })),
        // Opt-in box picking is not enabled for every Move Gizmo: it
        // corresponds to a box already drawn by its owning Component.
        ...(boxSize === null ? [] : [{
            ...shared, id: 'move-body', visual: 'box' as const,
            plane: 'view' as const, boxSize, color: '#ffb94a',
        }]),
    ];
}

/** Two editable axes and the XY plane. Reuses 3D Move constraints, picking,
 * hover and undo, without publishing Z/XZ/YZ/box descriptors in Scene 2D.
 * The 2D Canvas renderer paints these world-space regions with Gizmos2D.
 */
export function makeMoveGizmo2D(
    property: string, options: GizmosMove2DHandleOptions = {},
): GizmoHandleDescriptor[] {
    return makeMoveGizmo(property, options).filter((handle) =>
        (handle.visual === 'axis' && (handle.axis === 'x' || handle.axis === 'y')) ||
        (handle.visual === 'plane' && handle.plane === 'xy'));
}

/** A rotation preset edits one Euler Vec3 in degrees through colored rings. */
export function makeRotateGizmo(
    property: string, options: GizmosRotateHandleOptions = {},
): GizmoHandleDescriptor[] {
    const name = propertyName(property);
    const ringSize = size(options.ringSize, 72, 24, 180, 'ringSize');
    const pickSize = size(options.pickSize, 14, 8, 32, 'pickSize');
    if (options.space !== undefined &&
        options.space !== 'local' && options.space !== 'world') {
        throw new RangeError('space must be local or world');
    }
    if (options.snap !== undefined &&
        (!Number.isFinite(options.snap) || options.snap <= 0)) {
        throw new RangeError('rotation snap must be positive degrees');
    }
    if (options.pivotProperty !== undefined &&
        (typeof options.pivotProperty !== 'string' || !options.pivotProperty.trim()))
        throw new Error('Rotation pivotProperty must be a non-empty property name');
    if (options.pivotSpace !== undefined &&
        options.pivotSpace !== 'local' && options.pivotSpace !== 'world')
        throw new Error('Rotation pivotSpace must be local or world');
    return ([
        ['x', '#ff595e'], ['y', '#43df66'], ['z', '#4b8fff'],
    ] as ReadonlyArray<readonly ['x'|'y'|'z',string]>)
        .map(([axis, color]): GizmoHandleDescriptor => ({
            property: name, id: 'rotation-' + axis, visual: 'rotation',
            axis, plane: 'view', space: options.space ?? 'local',
            snap: options.snap, ringSize, pickSize, color,
            pivotProperty: options.pivotProperty, pivotSpace: options.pivotSpace,
            hoverColor: options.hoverColor ?? '#ffff65',
        }));
}
export function makeRotateGizmo2D(
    property: string, options: GizmosRotate2DHandleOptions = {},
): GizmoHandleDescriptor[] {
    return makeRotateGizmo(property, options).filter(field => field.axis === 'z');
}

export function makePointGizmo(
    property: string, options: GizmoPointOptions = {},
): GizmoHandleDescriptor {
    const name = propertyName(property);
    return {
        property: name, visual: 'point',
        plane: options.plane ?? 'xy',
        space: options.space ?? 'local',
        snap: options.snap,
        color: options.color ?? '#ffcc00',
        bounds: options.bounds,
        pickSize: options.pickSize,
    };
}

export function makePointGizmos(
    property: string, count: number, options: GizmoPointOptions = {},
): GizmoHandleDescriptor[] {
    propertyName(property);
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000)
        throw new RangeError('Gizmo point count must be an integer in 0..10000');
    return Array.from({ length: count }, (_, index) => ({
        ...makePointGizmo(property, options), index,
    }));
}
