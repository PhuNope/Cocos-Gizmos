/** Scene View display preferences and stable HUD entry filtering. */
export interface GizmoViewConfig {
    display: 'always' | 'selected' | 'off';
    hud: 'selected' | 'always' | 'off';
}

export interface GizmoHudText {
    id: string;
    text: string;
    order: number;
    fontSize: number;
    /** Minimum rendered font height in screen pixels (default 12). */
    minSize?: number;
    /** Maximum rendered font height in screen pixels (default 24). */
    maxSize?: number;
    color: string;
}

export const DEFAULT_VIEW_CONFIG: Readonly<GizmoViewConfig> = Object.freeze({
    display: 'always',
    hud: 'selected',
});

export function normalizeViewConfig(value: unknown): GizmoViewConfig {
    const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
        display: data.display === 'off' || data.display === 'selected' ? data.display : 'always',
        hud: data.hud === 'off' || data.hud === 'always' ? data.hud : 'selected',
    };
}

export function shouldDrawGizmo(mode: GizmoViewConfig['display'], selected: boolean): boolean {
    return mode === 'always' || (mode === 'selected' && selected);
}

export function shouldDrawHud(mode: GizmoViewConfig['hud'], selected: boolean): boolean {
    return mode === 'always' || (mode === 'selected' && selected);
}

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

/** Keep only valid, uniquely identified labels and sort them predictably. */
export function normalizeHudItems(value: unknown, maxItems = 24): GizmoHudText[] {
    if (!Array.isArray(value)) return [];
    const result: GizmoHudText[] = [];
    const ids = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object' || result.length >= maxItems) continue;
        const item = raw as Record<string, unknown>;
        if (typeof item.id !== 'string' || !item.id || item.id.length > 128 ||
            ids.has(item.id) || typeof item.text !== 'string') continue;
        ids.add(item.id);
        result.push({
            id: item.id,
            text: item.text.slice(0, 1024),
            order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : 0,
            fontSize: typeof item.fontSize === 'number' && Number.isFinite(item.fontSize)
                ? Math.max(9, Math.min(60, item.fontSize)) : 14,
            minSize: typeof item.minSize === 'number' && Number.isFinite(item.minSize)
                ? Math.max(8, Math.min(64, item.minSize)) : 12,
            maxSize: typeof item.maxSize === 'number' && Number.isFinite(item.maxSize)
                ? Math.max(8, Math.min(64, item.maxSize)) : 24,
            color: typeof item.color === 'string' && COLOR_PATTERN.test(item.color)
                ? item.color : '#ffffff',
        });
    }
    for (const item of result) {
        if (item.maxSize! < item.minSize!) item.maxSize = item.minSize;
    }
    result.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return result;
}
