/**
 * Domain: immutable descriptions of editor gizmos, with no Cocos imports.
 * Scene adapters own rendering, picking and edit transactions.
 *
 * New public authoring API:
 *   Gizmos3D.move('position', { snap: .25 })
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
