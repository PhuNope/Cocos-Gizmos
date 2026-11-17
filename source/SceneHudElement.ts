import {
    hudControlScreenRect, hudGrid, hudRowScreenPosition, hudSliderScreenTrack,
} from './GizmoHudControls';

export interface SceneHudRow {
    index: number;
    text: string;
    color: string;
    fontSize: number;
    minSize?: number;
    maxSize?: number;
    isControl: boolean;
    kind?: 'button' | 'slider' | 'toggle' | 'checkbox';
    size?: 'small' | 'normal' | 'large';
    width?: number;
    value?: number | boolean;
    min?: number;
    max?: number;
}

export interface SceneHudViewport { width: number; height: number }

/**
 * Renders one DOM HUD in the Scene's engine WebView (#GameDiv in 3D,
 * #GameCanvas in 2D). The parent Scene panel sets webview pointer-events:
 * none, so native Gizmo picking remains the sole owner of interactions.
 * No Cocos Node, Sprite, texture, Canvas or scene asset is involved.
 */
export class SceneHudElement {
    private root: HTMLElement | null = null;
    private host: HTMLElement | null = null;
    private originalPosition = '';
    private adjustedPosition = false;
    private signature = '';

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
        if (!doc?.createElement || !doc.createDocumentFragment || !host?.appendChild || !host.style) {
            this.hide();
            return false;
        }
        this.attach(doc, host);
        if (!this.root) return false;
        const grid = hudGrid(viewport, count);
        const sx = host.clientWidth > 0 ? host.clientWidth / viewport.width : 1;
        const sy = host.clientHeight > 0 ? host.clientHeight / viewport.height : 1;
        const signature = JSON.stringify([viewport, sx, sy, count, rows]);
        this.root.style.display = 'block';
        if (signature === this.signature) return true;
        this.signature = signature;
        Object.assign(this.root.style, {
            width: viewport.width + 'px', height: grid.height + 'px',
            transform: `scale(${sx}, ${sy})`, boxSizing: 'border-box',
            background: 'rgba(21,30,45,.94)', borderTop: '1px solid #78b8f0',
        });
        const fragment = doc.createDocumentFragment();
        for (const row of rows) {
            const screen = hudRowScreenPosition({ x: 0, y: 0 }, row.index, viewport, count);
            const box = doc.createElement('div');
            const color = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(row.color) ?
                row.color : '#ffffff';
            const fontSize = Math.max(row.isControl ? 10 : row.minSize ?? 12,
                Math.min(row.isControl ? 18 : row.maxSize ?? 24, row.fontSize));
            Object.assign(box.style, {
                position: 'absolute', height: '22px', display: 'flex', alignItems: 'center',
                overflow: 'hidden', whiteSpace: 'nowrap', boxSizing: 'border-box',
                color, font: fontSize + 'px system-ui, sans-serif',
            });
            if (row.isControl) {
                const hit = hudControlScreenRect(viewport, row.index, count);
                Object.assign(box.style, {
                    left: hit.left + 'px', top: (grid.height - hit.top) + 'px',
                    width: hit.width + 'px', paddingLeft: '5px',
                    borderRadius: '5px', background: '#273950',
                });
                this.renderControl(doc, box, viewport, count, row, hit.left);
            } else {
                Object.assign(box.style, {
                    left: screen.x + 'px', top: (grid.height - screen.y - 11) + 'px',
                    width: Math.max(30, grid.columnWidth - 28) + 'px',
                });
                box.textContent = row.text;
            }
            fragment.appendChild(box);
        }
        this.root.replaceChildren(fragment);
        return true;
    }

    private renderControl(doc: Document, box: HTMLElement, viewport: SceneHudViewport,
        count: number, row: SceneHudRow, left: number): void {
        const scale = row.size === 'small' ? 0.78 : row.size === 'large' ? 1.12 : 1;
        const label = doc.createElement('span');
        label.textContent = row.text; // Never interpolate user text into HTML.
        Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis',
            flexShrink: '1', maxWidth: '65%' });
        if (row.kind === 'slider') {
            label.style.maxWidth = '33%';
            box.appendChild(label);
            const track = hudSliderScreenTrack(viewport, row.index, count, row.width);
            const progress = typeof row.value === 'number' && Number.isFinite(row.value) &&
                Number.isFinite(row.min) && Number.isFinite(row.max) &&
                (row.max as number) > (row.min as number) ?
                Math.max(0, Math.min(1, (row.value - (row.min as number)) /
                    ((row.max as number) - (row.min as number)))) : 0;
            const rail = doc.createElement('span');
            Object.assign(rail.style, { position: 'absolute',
                left: (track.left - left) + 'px', top: '9px', width: track.width + 'px',
                height: Math.max(4, 6 * scale) + 'px', borderRadius: '4px',
                background: '#54677e' });
            const fill = doc.createElement('span');
            Object.assign(fill.style, { display: 'block', width: (progress * 100) + '%',
                height: '100%', background: '#7bbaff', borderRadius: '4px' });
            const knob = doc.createElement('span');
            Object.assign(knob.style, { position: 'absolute',
                left: `calc(${progress * 100}% - ${5 * scale}px)`,
                top: (-2 * scale) + 'px', width: 10 * scale + 'px',
                height: 10 * scale + 'px', borderRadius: '50%',
                background: '#eef8ff' });
            rail.appendChild(fill);
            rail.appendChild(knob);
            box.appendChild(rail);
            const number = doc.createElement('span');
            number.textContent = typeof row.value === 'number' ?
                String(Math.round(row.value * 1000) / 1000) : String(row.min ?? 0);
            Object.assign(number.style, { position: 'absolute', color: '#c4e4ff',
                left: (track.left + track.width + 9 - left) + 'px' });
            box.appendChild(number);
        } else if (row.kind === 'toggle') {
            label.style.flex = '1';
            box.appendChild(label);
            const track = doc.createElement('span');
            Object.assign(track.style, { position: 'relative', flex: 'none',
                marginRight: '28px', width: 37 * scale + 'px',
                height: 16 * scale + 'px', borderRadius: '10px',
                background: row.value === true ? '#3ad2a4' : '#55667e' });
            const knob = doc.createElement('span');
            Object.assign(knob.style, { position: 'absolute', top: 2 * scale + 'px',
                left: (row.value === true ? 23 : 3) * scale + 'px',
                width: 12 * scale + 'px', height: 12 * scale + 'px',
                borderRadius: '50%', background: '#f6fbff' });
            track.appendChild(knob);
            box.appendChild(track);
        } else if (row.kind === 'checkbox') {
            const boxIcon = doc.createElement('span');
            boxIcon.textContent = row.value === true ? '✓' : '';
            Object.assign(boxIcon.style, { display: 'inline-flex', flex: 'none',
                alignItems: 'center', justifyContent: 'center',
                marginRight: '8px', width: 15 * scale + 'px',
                height: 15 * scale + 'px', borderRadius: '3px', color: '#102333',
                background: row.value === true ? '#69c9f1' : '#54667b' });
            box.appendChild(boxIcon);
            box.appendChild(label);
        } else if (row.kind === 'button') {
            Object.assign(label.style, { background: '#397eb8', borderRadius: '5px',
                color: '#f5faff', padding: '2px 10px', fontWeight: '600' });
            box.appendChild(label);
        } else box.appendChild(label);
    }

    private attach(doc: Document, host: HTMLElement): void {
        if (this.root && this.host !== host) this.detach();
        if (!this.root) {
            this.root = doc.getElementById('cocos-gizmos-scene-hud') || doc.createElement('div');
            this.root.id = 'cocos-gizmos-scene-hud';
            Object.assign(this.root.style, { position: 'absolute', bottom: '0',
                left: '0', overflow: 'hidden', pointerEvents: 'none',
                zIndex: '2147483000', transformOrigin: 'bottom left',
                userSelect: 'none', fontFamily: 'system-ui, sans-serif' });
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

    public hide(): void { if (this.root) this.root.style.display = 'none'; }
    public dispose(): void { this.detach(); }

    private detach(): void {
        this.root?.remove();
        if (this.host && this.adjustedPosition)
            this.host.style.position = this.originalPosition;
        this.root = null;
        this.host = null;
        this.signature = '';
        this.adjustedPosition = false;
    }
}
