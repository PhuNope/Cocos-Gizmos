/** Safe CSS-like HUD appearance shared by DOM, Canvas and picking adapters. */
export type HudSizePreset = 'small' | 'normal' | 'large';
export interface HudDimensions {
    /** Entire label/control width in Scene pixels (not slider track width). */
    width?: number;
    /** Control height in Scene pixels, clamped to its 22px picking row. */
    height?: number;
}
export type HudSize = HudSizePreset | HudDimensions;

/** Supported CSSStyleDeclaration-like *visual* properties, in camelCase.
 * Layout ownership, positioning, event routing and raw HTML stay internal.
 */
export interface HudDomStyle {
    color?: string;
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    fontSize?: number;
    fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold' | 400 | 500 | 600 | 700;
    opacity?: number;
    padding?: number;
    letterSpacing?: number;
    textAlign?: 'left' | 'center' | 'right';
}

const COLOR = /^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)$/;
const limited = (value: unknown, min: number, max: number): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ?
        Math.max(min, Math.min(max, value)) : undefined;

export function normalizeHudSize(input: unknown): HudSize {
    if (input === 'small' || input === 'large') return input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'normal';
    const raw = input as Record<string, unknown>;
    const width = limited(raw.width, 60, 600);
    const height = limited(raw.height, 16, 22);
    return width === undefined && height === undefined ? 'normal' : {
        ...(width !== undefined ? { width: Math.round(width) } : {}),
        ...(height !== undefined ? { height: Math.round(height) } : {}),
    };
}

export function normalizeHudStyle(input: unknown): HudDomStyle {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const raw = input as Record<string, unknown>;
    const output: HudDomStyle = {};
    for (const key of ['color', 'backgroundColor', 'borderColor'] as const) {
        if (typeof raw[key] === 'string' && COLOR.test(raw[key])) output[key] = raw[key] as string;
    }
    for (const [name, min, max] of [
        ['borderWidth', 0, 2], ['borderRadius', 0, 14],
        ['fontSize', 10, 24], ['opacity', 0.25, 1],
        ['padding', 0, 8], ['letterSpacing', -0.5, 2],
    ] as const) {
        const n = limited(raw[name], min, max);
        if (n !== undefined) (output as any)[name] = n;
    }
    const weight = raw.fontWeight;
    if (weight === 'normal' || weight === 'medium' || weight === 'semibold' ||
        weight === 'bold' || weight === 400 || weight === 500 || weight === 600 ||
        weight === 700) output.fontWeight = weight;
    if (raw.textAlign === 'left' || raw.textAlign === 'center' ||
        raw.textAlign === 'right') output.textAlign = raw.textAlign;
    return output;
}

export function hudSizePixels(size: HudSize | undefined, maximumWidth: number): {
    width: number; height: number; scale: number;
} {
    const maximum = Math.max(30, maximumWidth);
    if (size && typeof size === 'object') {
        return {
            width: Math.max(30, Math.min(maximum, size.width ?? maximum)),
            height: Math.max(16, Math.min(22, size.height ?? 22)),
            scale: 1,
        };
    }
    const scale = size === 'small' ? 0.85 : size === 'large' ? 1.08 : 1;
    return { width: maximum, height: size === 'small' ? 20 : 22, scale };
}
