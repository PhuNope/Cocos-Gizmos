/** Normalizes common Cocos Creator Scene mouse event payloads. */
export interface ScenePointer { x: number; y: number }

type InputEventName =
    'controllerDown' | 'controllerMove' | 'controllerUp' |
    'gizmoDown' | 'gizmoMove' | 'gizmoUp' |
    'outsideDown' | 'outsideUp' | 'missingPointer';

function pointFrom(value: any): ScenePointer | null {
    if (!value || typeof value !== 'object') return null;
    for (const [x, y] of [
        [value.x, value.y],
        [value.mouseX, value.mouseY],
        [value.offsetX, value.offsetY],
    ]) {
        if (typeof x === 'number' && typeof y === 'number' &&
            Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    return null;
}

export function readScenePointer(event: any): ScenePointer | null {
    const queue = [event, event?.detail, event?.data, event?.mouse,
        event?.event, event?.detail?.event];
    for (const item of queue) {
        const direct = pointFrom(item);
        if (direct) return direct;
        for (const getter of ['getLocation', 'getUILocation', 'getMouseLocation']) {
            if (typeof item?.[getter] !== 'function') continue;
            try {
                const result = pointFrom(item[getter]());
                if (result) return result;
            } catch {
                // Scene events can have getters that are not valid for every phase.
            }
        }
    }
    return null;
}

export function readSceneHandleName(event: any): string | null {
    for (const item of [event, event?.detail, event?.data, event?.event]) {
        for (const value of [item?.handleName, item?.handle?.name, item?.handle?.handleName]) {
            if (typeof value === 'string' && value.length > 0) return value;
        }
    }
    return null;
}

export interface GizmoInputSnapshot {
    controllerDown: number;
    controllerMove: number;
    controllerUp: number;
    gizmoDown: number;
    gizmoMove: number;
    gizmoUp: number;
    outsideDown: number;
    outsideUp: number;
    missingPointer: number;
    recent: string[];
}

/**
 * Counts Editor dispatches without storing pointer positions or user data.
 * The history is bounded so long editing sessions cannot leak memory.
 */
export class GizmoInputDiagnostics {
    private readonly counts: Record<InputEventName, number> = {
        controllerDown: 0, controllerMove: 0, controllerUp: 0,
        gizmoDown: 0, gizmoMove: 0, gizmoUp: 0,
        outsideDown: 0, outsideUp: 0, missingPointer: 0,
    };
    private readonly recent: string[] = [];

    public record(name: InputEventName): void {
        this.counts[name]++;
        if (name === 'controllerMove' || name === 'gizmoMove') return;
        this.recent.push(name);
        if (this.recent.length > 16) this.recent.shift();
    }

    public snapshot(): GizmoInputSnapshot {
        return { ...this.counts, recent: [...this.recent] };
    }
}
