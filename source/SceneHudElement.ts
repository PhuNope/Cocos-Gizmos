import {
    hudControlScreenRect, hudGrid, hudRowScreenPosition, hudSliderScreenTrack,
} from './GizmoHudControls';
import {
    HudDomStyle, HudSize, hudSizePixels, normalizeHudStyle,
} from './GizmoHudStyle';

export interface SceneHudRow {
    index: number;
    text: string;
    color: string;
    fontSize: number;
    minSize?: number;
    maxSize?: number;
    isControl: boolean;
    kind?: 'button' | 'slider' | 'toggle' | 'checkbox';
    size?: HudSize;
    style?: HudDomStyle;
    width?: number;
    value?: number | boolean;
    min?: number;
    max?: number;
}

export interface SceneHudViewport { width: number; height: number }

/** ParticleSystem-style HUD separation: the DOM owns pointer capture and
 * controls, while the Scene application adapter owns Commands and values.
 * This port is registered by EditorHandleAdapterV3 when its Scene loads.
 * No engine raycast, physics Controller or Node is needed for HUD input.
 */
export interface SceneHudPointer {
    x: number; y: number; button: number; buttons: number; event: any;
}
export interface SceneHudInputPort {
    down(event: SceneHudPointer): boolean;
    move(event: SceneHudPointer): void;
    up(event: SceneHudPointer): void;
    cancel(): void;
}
let currentHudInputPort: SceneHudInputPort | null = null;

export function connectSceneHudInput(port: SceneHudInputPort): () => void {
    currentHudInputPort = port;
    return () => {
        if (currentHudInputPort === port) currentHudInputPort = null;
    };
}


const PALETTE = Object.freeze({
    surface: 'rgba(17, 23, 32, 0.94)',
    foreground: '#dce7ef',
    muted: '#a7b6c5',
    control: 'rgba(113, 141, 166, 0.13)',
    border: 'rgba(171, 194, 215, 0.15)',
    accent: '#69b8ae',
    accentMuted: '#3e837c',
    button: '#2c666f',
    slider: '#647487',
    thumb: '#e0ebf2',
});

/** Convert CSS-like data to safe, purely visual inline styles.
 * Geometry and pointer capture cannot be overridden by public styles.
 */
function applyAppearance(element: HTMLElement, style?: HudDomStyle): void {
    const value = normalizeHudStyle(style);
    if (value.color) element.style.color = value.color;
    if (value.backgroundColor) element.style.backgroundColor = value.backgroundColor;
    if (value.borderColor) element.style.borderColor = value.borderColor;
    if (value.borderWidth !== undefined) {
        element.style.borderStyle = 'solid';
        element.style.borderWidth = value.borderWidth + 'px';
    }
    if (value.borderRadius !== undefined) element.style.borderRadius = value.borderRadius + 'px';
    // fontSize is applied by the caller with the row's 10–18/12–24px
    // bounds so a large CSS value cannot escape the native picking height.
    if (value.fontWeight !== undefined) {
        const weight = { medium: '500', semibold: '600', bold: '700', normal: '400' } as const;
        element.style.fontWeight = typeof value.fontWeight === 'number' ?
            String(value.fontWeight) : weight[value.fontWeight];
    }
    if (value.opacity !== undefined) element.style.opacity = String(value.opacity);
    if (value.padding !== undefined) {
        element.style.paddingLeft = value.padding + 'px';
        element.style.paddingRight = value.padding + 'px';
    }
    if (value.letterSpacing !== undefined)
        element.style.letterSpacing = value.letterSpacing + 'px';
    if (value.textAlign) element.style.textAlign = value.textAlign;
}

/**
 * Scene-local floating DOM HUD following the ParticleSystem separation:
 * HTML controls own their click/drag; Gizmo commands own values and Undo.
 * The root is pointer-transparent except over actual controls, so ordinary
 * Scene selection/orbit still belongs to Creator. Texture HUD remains only
 * for Editor builds without a usable Scene DOM.
 */
export class SceneHudElement {
    private root: HTMLElement | null = null;
    private host: HTMLElement | null = null;
    private originalPosition = '';
    private adjustedPosition = false;
    private signature = '';
    private held: { rowIndex: number; pointerId: number | null;
        viewport: SceneHudViewport; host: HTMLElement; doc: Document } | null = null;
    private heldValue: HTMLElement | null = null;
    private heldRail: HTMLElement | null = null;

    private stopEvent(event: any): void {
        event?.stopImmediatePropagation?.();
        event?.stopPropagation?.();
        event?.preventDefault?.();
    }

    private toViewport(event: any, host: HTMLElement,
        viewport: SceneHudViewport): SceneHudPointer | null {
        const rect = host.getBoundingClientRect?.();
        if (!rect || !(rect.width > 0) || !(rect.height > 0) ||
            !Number.isFinite(event?.clientX) ||
            !Number.isFinite(event?.clientY)) return null;
        return {
            x: (event.clientX - rect.left) * viewport.width / rect.width,
            y: (rect.bottom - event.clientY) * viewport.height / rect.height,
            button: typeof event.button === 'number' ? event.button : 0,
            buttons: typeof event.buttons === 'number' ? event.buttons : 1,
            event,
        };
    }

    private readonly onDragMove = (event: any): void => {
        const held = this.held;
        if (!held || (held.pointerId !== null &&
            event.pointerId !== undefined && event.pointerId !== held.pointerId)) return;
        const pointer = this.toViewport(event, held.host, held.viewport);
        this.stopEvent(event);
        if (!pointer) return;
        try { currentHudInputPort?.move(pointer); }
        catch (error) {
            this.endDrag(true);
            console.warn('[cocos-gizmos/hud] DOM drag failed:', error);
        }
    };

    private readonly onDragUp = (event: any): void => {
        const held = this.held;
        if (!held || (held.pointerId !== null &&
            event.pointerId !== undefined && event.pointerId !== held.pointerId)) return;
        const pointer = this.toViewport(event, held.host, held.viewport);
        this.stopEvent(event);
        try {
            if (pointer) currentHudInputPort?.up(pointer);
            else currentHudInputPort?.cancel();
        } finally {
            this.endDrag(false);
        }
    };

    private readonly onDragCancel = (event: any): void => {
        if (!this.held) return;
        this.stopEvent(event);
        this.endDrag(true);
    };

    private endDrag(cancel: boolean): void {
        const held = this.held;
        if (!held) return;
        this.held = null;
        const target: any = held.doc.defaultView?.addEventListener ?
            held.doc.defaultView : held.doc;
        const mouse = typeof (held.doc.defaultView as any)?.PointerEvent !== 'function';
        const prefix = mouse ? 'mouse' : 'pointer';
        target.removeEventListener?.(prefix + 'move', this.onDragMove, true);
        target.removeEventListener?.(prefix + 'up', this.onDragUp, true);
        target.removeEventListener?.(mouse ? 'mouseleave' : 'pointercancel',
            this.onDragCancel, true);
        if (cancel) {
            try { currentHudInputPort?.cancel(); }
            catch (error) { console.warn('[cocos-gizmos/hud] Cancel:', error); }
        }
        this.heldValue = null;
        this.heldRail = null;
        // Reconcile DOM content only AFTER mouse-up; replacing active control
        // DOM nodes each Editor tick drops browser pointer capture.
        this.signature = '';
    }

    private bindControl(
        box: HTMLElement, row: SceneHudRow, host: HTMLElement,
        viewport: SceneHudViewport, doc: Document,
    ): void {
        if (!currentHudInputPort || typeof box.addEventListener !== 'function')
            return;
        box.style.pointerEvents = 'auto';
        box.style.cursor = row.kind === 'slider' ? 'ew-resize' : 'pointer';
        (box as any).tabIndex = -1;
        const pointerSupported = typeof (doc.defaultView as any)?.PointerEvent === 'function';
        box.addEventListener(pointerSupported ? 'pointerdown' : 'mousedown', (event: any) => {
            if (this.held || event.button !== 0 || !currentHudInputPort) return;
            const pointer = this.toViewport(event, host, viewport);
            if (!pointer) return;
            this.stopEvent(event);
            if (!currentHudInputPort.down(pointer)) return;
            this.held = {
                rowIndex: row.index, pointerId:
                    Number.isInteger(event.pointerId) ? event.pointerId : null,
                viewport, host, doc,
            };
            const target: any = doc.defaultView?.addEventListener ?
                doc.defaultView : doc;
            const prefix = pointerSupported ? 'pointer' : 'mouse';
            target.addEventListener(prefix + 'move', this.onDragMove, true);
            target.addEventListener(prefix + 'up', this.onDragUp, true);
            target.addEventListener(pointerSupported ? 'pointercancel' : 'mouseleave',
                this.onDragCancel, true);
            try { box.setPointerCapture?.(event.pointerId); }
            catch { /* The window capture listener still keeps the gesture. */ }
        });
        // A button click must never leak through to the Scene Node picker,
        // even when Chromium fires click after a captured pointer-up.
        box.addEventListener('click', (event: any) => this.stopEvent(event));
        box.addEventListener('dblclick', (event: any) => this.stopEvent(event));
    }

    constructor(private readonly documentPort: () => Document | null =
        () => (globalThis as any).document || null) {}

    public render(viewport: SceneHudViewport, rows: readonly SceneHudRow[], count: number): boolean {
        if (!rows.length || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
            viewport.width <= 0 || viewport.height <= 0) {
            this.hide();
            return false;
        }
        const doc = this.documentPort();
        const host = doc?.getElementById('GameDiv') || doc?.getElementById('GameCanvas');
        if (!doc?.createElement || !doc.createDocumentFragment ||
            !host?.appendChild || !host.style) {
            this.hide();
            return false;
        }
        this.attach(doc, host);
        if (!this.root) return false;
        if (this.held) {
            // Keep exactly the same DOM nodes while the mouse is down.
            // The browser native slider/checkbox keeps capture and focus.
            const current = rows.find(row => row.index === this.held?.rowIndex);
            if (current) {
                if (this.heldValue && typeof current.value === 'number')
                    this.heldValue.textContent =
                        String(Math.round(current.value * 1000) / 1000);
                if (this.heldRail && typeof current.value === 'number' &&
                    Number.isFinite(current.min) && Number.isFinite(current.max) &&
                    (current.max as number) > (current.min as number)) {
                    const progress = (current.value - (current.min as number)) /
                        ((current.max as number) - (current.min as number));
                    this.heldRail.style.width =
                        Math.max(0, Math.min(100, progress * 100)) + '%';
                }
            }
            return true;
        }
        const grid = hudGrid(viewport, count);
        const sx = host.clientWidth > 0 ? host.clientWidth / viewport.width : 1;
        const sy = host.clientHeight > 0 ? host.clientHeight / viewport.height : 1;
        const signature = JSON.stringify([viewport, sx, sy, count, rows]);
        this.root.style.display = 'block';
        if (signature === this.signature) return true;
        this.signature = signature;
        Object.assign(this.root.style, {
            width: grid.width + 'px',
            height: grid.height + 'px',
            transform: `scale(${sx}, ${sy})`,
            boxSizing: 'border-box',
            background: PALETTE.surface,
            border: '1px solid ' + PALETTE.border,
            borderRadius: '10px 10px 0 0',
            boxShadow: '0 -3px 24px rgba(0,0,0,.30)',
        });

        const fragment = doc.createDocumentFragment();
        for (const row of rows) {
            const screen = hudRowScreenPosition({ x: 0, y: 0 }, row.index, viewport, count);
            const box = doc.createElement('div');
            const style = normalizeHudStyle(row.style);
            const color = style.color || (/^#[0-9a-fA-F]{6,8}$/.test(row.color) ?
                row.color : PALETTE.foreground);
            const textFont = Math.max(row.isControl ? 10 : row.minSize ?? 12,
                Math.min(row.isControl ? 18 : row.maxSize ?? 24,
                    style.fontSize ?? row.fontSize));
            const dimensions = hudSizePixels(row.size, Math.max(30, grid.columnWidth - 14));
            Object.assign(box.style, {
                position: 'absolute', display: 'flex', alignItems: 'center',
                overflow: 'hidden', whiteSpace: 'nowrap', boxSizing: 'border-box',
                color, fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: textFont + 'px', fontWeight: row.isControl ? '500' : '400',
            });
            if (row.isControl) {
                const hit = hudControlScreenRect(viewport, row.index, count, row.size);
                Object.assign(box.style, {
                    left: hit.left + 'px', top: (grid.height - hit.top) + 'px',
                    width: hit.width + 'px', height: hit.height + 'px',
                    paddingLeft: '6px', paddingRight: '6px',
                    borderRadius: '6px', background: PALETTE.control,
                    border: '1px solid ' + PALETTE.border,
                });
                this.renderControl(doc, box, viewport, count, row, hit.left);
                this.bindControl(box, row, host, viewport, doc);
            } else {
                Object.assign(box.style, {
                    left: screen.x + 'px',
                    top: (grid.height - screen.y - dimensions.height / 2) + 'px',
                    width: dimensions.width + 'px', height: dimensions.height + 'px',
                    textOverflow: 'ellipsis', color: row.index === 0 ?
                        PALETTE.accent : color,
                    fontWeight: row.index === 0 ? '600' : '400',
                    paddingLeft: '2px',
                });
                box.textContent = row.text;
            }
            applyAppearance(box, style);
            fragment.appendChild(box);
        }
        this.root.replaceChildren(fragment);
        return true;
    }

    private renderControl(doc: Document, box: HTMLElement, viewport: SceneHudViewport,
        count: number, row: SceneHudRow, left: number): void {
        const dimensions = hudSizePixels(row.size, hudGrid(viewport, count).columnWidth);
        const scale = dimensions.scale;
        const label = doc.createElement('span');
        label.textContent = row.text; // User data is never interpreted as HTML.
        Object.assign(label.style, {
            overflow: 'hidden', textOverflow: 'ellipsis',
            flexShrink: '1', maxWidth: '66%',
        });
        if (row.kind === 'slider') {
            label.style.maxWidth = '32%';
            box.appendChild(label);
            const track = hudSliderScreenTrack(viewport, row.index, count, row.width, row.size);
            const progress = typeof row.value === 'number' && Number.isFinite(row.value) &&
                Number.isFinite(row.min) && Number.isFinite(row.max) &&
                (row.max as number) > (row.min as number) ?
                Math.max(0, Math.min(1, (row.value - (row.min as number)) /
                    ((row.max as number) - (row.min as number)))) : 0;
            const rail = doc.createElement('span');
            Object.assign(rail.style, {
                position: 'absolute', left: (track.left - left) + 'px',
                top: (dimensions.height / 2 - 2) + 'px',
                width: track.width + 'px', height: '4px',
                borderRadius: '4px', background: PALETTE.slider,
            });
            const fill = doc.createElement('span');
            Object.assign(fill.style, {
                display: 'block', width: (progress * 100) + '%',
                height: '100%', background: PALETTE.accent,
                borderRadius: '4px',
            });
            const knob = doc.createElement('span');
            Object.assign(knob.style, {
                position: 'absolute',
                left: `calc(${progress * 100}% - ${5 * scale}px)`,
                top: (-3 * scale) + 'px',
                width: 10 * scale + 'px', height: 10 * scale + 'px',
                borderRadius: '50%', background: PALETTE.thumb,
                boxShadow: '0 1px 3px rgba(0,0,0,.25)',
            });
            rail.appendChild(fill);
            rail.appendChild(knob);
            box.appendChild(rail);
            const number = doc.createElement('span');
            number.textContent = typeof row.value === 'number' ?
                String(Math.round(row.value * 1000) / 1000) : String(row.min ?? 0);
            Object.assign(number.style, {
                position: 'absolute', color: PALETTE.muted,
                left: (track.left + track.width + 8 - left) + 'px',
                fontSize: '11px',
            });
            box.appendChild(number);
            if (this.held?.rowIndex === row.index) {
                this.heldValue = number;
                this.heldRail = fill;
            }
        } else if (row.kind === 'toggle') {
            label.style.flex = '1';
            box.appendChild(label);
            const track = doc.createElement('span');
            Object.assign(track.style, {
                position: 'relative', flex: 'none',
                marginRight: '3px', width: 32 * scale + 'px',
                height: 16 * scale + 'px', borderRadius: '12px',
                background: row.value === true ? PALETTE.accentMuted : '#536476',
            });
            const knob = doc.createElement('span');
            Object.assign(knob.style, {
                position: 'absolute', top: 2 * scale + 'px',
                left: (row.value === true ? 18 : 2) * scale + 'px',
                width: 12 * scale + 'px', height: 12 * scale + 'px',
                borderRadius: '50%', background: PALETTE.thumb,
            });
            track.appendChild(knob);
            box.appendChild(track);
        } else if (row.kind === 'checkbox') {
            const boxIcon = doc.createElement('span');
            boxIcon.textContent = row.value === true ? '✓' : '';
            Object.assign(boxIcon.style, {
                display: 'inline-flex', flex: 'none',
                alignItems: 'center', justifyContent: 'center',
                marginRight: '8px', width: 14 * scale + 'px',
                height: 14 * scale + 'px', borderRadius: '4px',
                color: '#102a30',
                background: row.value === true ? PALETTE.accent : '#4a5869',
            });
            box.appendChild(boxIcon);
            box.appendChild(label);
        } else if (row.kind === 'button') {
            Object.assign(box.style, {
                background: PALETTE.button,
                borderColor: 'rgba(112,197,189,.40)',
            });
            label.style.maxWidth = '100%';
            label.style.fontWeight = '600';
            label.style.color = normalizeHudStyle(row.style).color || '#f1fcfa';
            box.appendChild(label);
        } else box.appendChild(label);
    }

    private attach(doc: Document, host: HTMLElement): void {
        if (this.root && this.host !== host) this.detach();
        if (!this.root) {
            this.root = doc.getElementById('cocos-gizmos-scene-hud') || doc.createElement('div');
            this.root.id = 'cocos-gizmos-scene-hud';
            Object.assign(this.root.style, {
                position: 'absolute', bottom: '0', left: '0',
                overflow: 'hidden', pointerEvents: 'none',
                zIndex: '2147483000', transformOrigin: 'bottom left',
                userSelect: 'none', fontFamily: 'system-ui, sans-serif',
            });
        }
        if (this.root.parentElement !== host) host.appendChild(this.root);
        if (this.host !== host) {
            this.host = host;
            this.originalPosition = host.style.position;
            this.adjustedPosition = !host.style.position || host.style.position === 'static';
            if (this.adjustedPosition) host.style.position = 'relative';
            this.signature = '';
        }
    }

    public hide(): void {
        if (this.held) return; // Scene selection updates may race mouse-up.
        if (this.root) this.root.style.display = 'none';
    }
    public dispose(): void { this.detach(); }

    private detach(): void {
        this.endDrag(true);
        this.root?.remove();
        if (this.host && this.adjustedPosition)
            this.host.style.position = this.originalPosition;
        this.root = null;
        this.host = null;
        this.signature = '';
        this.adjustedPosition = false;
    }
}
