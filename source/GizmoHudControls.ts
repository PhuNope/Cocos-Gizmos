/** Validated controls and pointer-based value editing for the Scene View HUD. */
export type HudControl = {
    type: 'button';
    id: string;
    text: string;
    color: string;
} | {
    type: 'slider';
    id: string;
    text: string;
    property: string;
    min: number;
    max: number;
    step?: number;
    color: string;
} | {
    type: 'toggle' | 'checkbox';
    id: string;
    text: string;
    property: string;
    color: string;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const FIELD_NAME = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
export const HUD_ROW_HEIGHT = 22;
export const HUD_ROW_OFFSET_X = 20;
export const HUD_ROW_OFFSET_Y = 24;
export const HUD_SLIDER_TRACK_PIXELS = 120;

export function normalizeHudControls(value: unknown, maxItems = 12): HudControl[] {
    if (!Array.isArray(value)) return [];
    const controls: HudControl[] = [];
    const ids = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object' || controls.length >= maxItems) continue;
        const item = raw as Record<string, unknown>;
        if (typeof item.id !== 'string' || !item.id || item.id.length > 128 ||
            ids.has(item.id) || typeof item.text !== 'string' ||
            (item.type !== 'button' && item.type !== 'slider' &&
             item.type !== 'toggle' && item.type !== 'checkbox')) continue;
        const base = {
            id: item.id,
            text: item.text.slice(0, 128),
            color: typeof item.color === 'string' && HEX_COLOR.test(item.color) ?
                item.color : '#ffffff',
        };
        if (item.type === 'button') {
            controls.push({ type: 'button', ...base });
        } else if (item.type === 'toggle' || item.type === 'checkbox') {
            if (typeof item.property !== 'string' || !FIELD_NAME.test(item.property)) continue;
            controls.push({ type: item.type, ...base, property: item.property });
        } else {
            if (typeof item.property !== 'string' || !FIELD_NAME.test(item.property) ||
                !Number.isFinite(item.min) || !Number.isFinite(item.max) ||
                (item.min as number) >= (item.max as number) ||
                (item.step !== undefined &&
                    (!Number.isFinite(item.step) || (item.step as number) <= 0))) continue;
            controls.push({
                type: 'slider',
                ...base,
                property: item.property,
                min: item.min as number,
                max: item.max as number,
                step: item.step as number | undefined,
            });
        }
        ids.add(item.id);
    }
    return controls;
}

/**
 * Only changes that affect the interactive controller layout invalidate it.
 * Dynamic labels and values must not rebuild Scene picking handles.
 */
export function hudControlLayoutSignature(controls: readonly HudControl[]): string {
    return JSON.stringify(controls.map((control) => {
        if (control.type === 'slider') {
            return [control.type, control.id, control.property,
                control.min, control.max, control.step, control.color];
        }
        if (control.type === 'button') return [control.type, control.id, control.color];
        return [control.type, control.id, control.property, control.color];
    }));
}

/** Canvas HUD and native picking handles share this bottom-viewport grid. */
export function hudGrid(viewport: { width: number; height: number }, count: number): {
    rows: number; columns: number; columnWidth: number; height: number;
} {
    const width = Math.max(220, viewport.width);
    const maxRows = Math.max(3, Math.min(8, Math.floor(viewport.height * 0.34 / 26)));
    const columns = Math.max(1, Math.ceil(Math.max(1, count) / maxRows));
    const rows = Math.ceil(Math.max(1, count) / columns);
    return {
        rows, columns, columnWidth: width / columns,
        height: rows * 26 + 22,
    };
}

/** Coordinates are bottom-left origin, matching cc.Camera screenPointToRay. */
export function hudRowScreenPosition(
    anchor: { x: number; y: number }, index: number,
    viewport?: { width: number; height: number }, totalRows?: number,
): { x: number; y: number } {
    if (viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height) &&
        viewport.width > 220 && viewport.height > 120) {
        const grid = hudGrid(viewport, Math.max(index + 1, totalRows || index + 1));
        const column = Math.floor(index / grid.rows);
        const row = index % grid.rows;
        return {
            x: 14 + column * grid.columnWidth,
            y: grid.height - 14 - row * 26,
        };
    }
    return {
        x: anchor.x + HUD_ROW_OFFSET_X,
        y: anchor.y + HUD_ROW_OFFSET_Y - index * HUD_ROW_HEIGHT,
    };
}

/** Exact screen rectangle used by BOTH the HUD texture and native picking. */
export function hudControlScreenRect(
    viewport: { width: number; height: number }, index: number, totalRows: number,
): { left: number; right: number; bottom: number; top: number; width: number; height: number } {
    const row = hudRowScreenPosition({ x: 0, y: 0 }, index, viewport, totalRows);
    const grid = hudGrid(viewport, totalRows);
    const width = Math.max(30, grid.columnWidth - 14);
    return {
        left: row.x - 5, right: row.x - 5 + width,
        bottom: row.y - 11, top: row.y + 11, width, height: 22,
    };
}

/** Matches the track drawing (36% left, 38% wide) inside each HUD column. */
export function hudSliderScreenTrack(
    viewport: { width: number; height: number }, index: number, totalRows: number,
): { left: number; width: number } {
    const row = hudRowScreenPosition({ x: 0, y: 0 }, index, viewport, totalRows);
    const grid = hudGrid(viewport, totalRows);
    return { left: row.x + grid.columnWidth * 0.36,
        width: Math.max(50, grid.columnWidth * 0.38) };
}

export function formatHudControl(control: HudControl, value: unknown): string {
    if (control.type === 'button') return '[' + control.text + ']';
    if (control.type === 'toggle') return control.text + ': ' + (value === true ? '[ON]' : '[OFF]');
    if (control.type === 'checkbox') return '[' + (value === true ? 'x' : ' ') + '] ' + control.text;
    if (control.type !== 'slider') return control.text;
    const current = typeof value === 'number' && Number.isFinite(value) ?
        Math.max(control.min, Math.min(control.max, value)) : control.min;
    const progress = Math.min(1, Math.max(0, (current - control.min) / (control.max - control.min)));
    const filled = Math.max(0, Math.min(10, Math.round(progress * 10)));
    const number = String(Math.round(current * 1000) / 1000);
    return control.text + ': [' + '='.repeat(filled) + '|'.repeat(1) +
        '-'.repeat(10 - filled) + '] ' + number;
}

/**
 * A slider drag uses screen-space movement, so zooming the camera does not
 * affect the amount edited. The component property is committed by the adapter.
 */
export class HudSliderDrag {
    public readonly initial: number;

    constructor(
        private readonly control: Extract<HudControl, { type: 'slider' }>,
        initial: number,
        private readonly startX: number,
        private readonly trackPixels = HUD_SLIDER_TRACK_PIXELS,
    ) {
        if (!Number.isFinite(initial) || !Number.isFinite(startX)) {
            throw new Error('Invalid HUD slider starting state');
        }
        this.initial = initial;
    }

    public move(x: number): number | null {
        if (!Number.isFinite(x)) return null;
        const { min, max, step } = this.control;
        const raw = this.initial + ((x - this.startX) / this.trackPixels) * (max - min);
        const snapped = step ? min + Math.round((raw - min) / step) * step : raw;
        if (!Number.isFinite(snapped)) return null;
        const result = Math.max(min, Math.min(max, snapped));
        return Math.round(result * 1e6) / 1e6;
    }

    public cancel(): number {
        return this.initial;
    }
}
