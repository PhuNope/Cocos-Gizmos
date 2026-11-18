import { consumeOwnedSceneEvent } from './SceneSelectionLease';

export interface ViewportPoint { x: number; y: number }
export interface ViewportPointer extends ViewportPoint {
    button: number;
    buttons: number;
    event: any;
}
export interface SceneViewportInputPorts {
    viewport(): { width: number; height: number } | null;
    down(pointer: ViewportPointer): boolean;
    move(pointer: ViewportPointer): void;
    hover(pointer: ViewportPointer): void;
    up(pointer: ViewportPointer): void;
    cancel(): void;
}

type DomLike = {
    getElementById(id: string): any;
    addEventListener(type: string, handler: (event: any) => void, capture?: boolean): void;
    removeEventListener(type: string, handler: (event: any) => void, capture?: boolean): void;
    defaultView?: {
        PointerEvent?: any;
        addEventListener?: (type: string, handler: (event: any) => void, capture?: boolean) => void;
        removeEventListener?: (type: string, handler: (event: any) => void, capture?: boolean) => void;
    };
};

/**
 * Scene WebView's real DOM capture boundary.
 *
 * A custom Gizmo without a raycast Controller is NOT guaranteed to receive
 * onNotGizmoMouseDown: GizmoOperation can route the same click to a native
 * transform handle or to Scene selection. This input port hits our screen
 * descriptors before the Editor's bubble-phase picker sees the event.
 *
 * Mounts only in the engine WebView containing #GameCanvas. No scene/game
 * Nodes or BoxColliders are allocated. With no DOM it remains inactive,
 * allowing the Editor event callback adapter to remain a fallback.
 */
export class SceneViewportInput {
    private doc: DomLike | null = null;
    private eventRoot: DomLike | null = null;
    private canvas: any = null;
    private enabled = false;
    private captured = false;
    private pointerId: number | null = null;
    private observed = 0;
    private intercepted = 0;
    private hoverCount = 0;
    private cancellationCount = 0;
    private lastReason = 'not-mounted';

    constructor(
        private readonly ports: SceneViewportInputPorts,
        private readonly documentPort: () => DomLike | null =
            () => (globalThis as any).document ||
                (globalThis as any).window?.document || null,
    ) {}

    public refresh(): void {
        const doc = this.documentPort();
        const canvas = doc?.getElementById?.('GameCanvas') ||
            doc?.getElementById?.('GameDiv');
        if (!doc?.addEventListener || !canvas?.getBoundingClientRect) {
            if (this.doc) this.detach();
            this.lastReason = 'scene-webview-dom-unavailable';
            return;
        }
        if (this.doc === doc && this.canvas === canvas) return;
        this.detach();
        this.doc = doc;
        this.canvas = canvas;
        // Capture on window when possible: window is earlier than document,
        // canvas or Editor gizmo-picking listeners in the DOM event path.
        // Installing on document after Creator's own capture listener would
        // be too late to keep the Scene from unselecting a clicked HUD Node.
        this.eventRoot = doc.defaultView?.addEventListener &&
            doc.defaultView?.removeEventListener ?
            doc.defaultView as unknown as DomLike : doc;
        // Electron's WebView supports PointerEvent; older Scene backends
        // still use mouse events. Install exactly one family, not both.
        this.enabled = typeof doc.defaultView?.PointerEvent === 'function';
        const prefix = this.enabled ? 'pointer' : 'mouse';
        this.eventRoot.addEventListener(prefix + 'down', this.onDown, true);
        this.eventRoot.addEventListener(prefix + 'move', this.onMove, true);
        this.eventRoot.addEventListener(prefix + 'up', this.onUp, true);
        if (this.enabled) this.eventRoot.addEventListener('pointercancel', this.onCancel, true);
        this.lastReason = this.enabled ? 'pointer-capture' : 'mouse-capture';
    }

    private point(event: any): ViewportPointer | null {
        const rect = this.canvas?.getBoundingClientRect?.();
        const size = this.ports.viewport();
        if (!rect || !size || !(rect.width > 0 && rect.height > 0) ||
            !(size.width > 0 && size.height > 0) ||
            !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY))
            return null;
        // cc.Camera.screenPointToRay uses bottom-left origin, while browser
        // clientY measures down from top of the Scene WebView.
        return {
            x: (event.clientX - rect.left) * size.width / rect.width,
            y: (rect.bottom - event.clientY) * size.height / rect.height,
            button: typeof event.button === 'number' ? event.button : 0,
            buttons: typeof event.buttons === 'number' ? event.buttons : 1,
            event,
        };
    }

    private readonly onDown = (event: any): void => {
        // Floating HUD controls own their browser events; do not begin a
        // second Scene-input gesture from the window capture listener.
        if (event?.target?.closest?.('#cocos-gizmos-scene-hud, #cocos-gizmos-builder-hud')) return;
        if (this.captured || event?.button !== 0 ||
            this.enabled && event?.isPrimary === false) return;
        const pointer = this.point(event);
        if (!pointer) return;
        this.observed++;
        try {
            if (!this.ports.down(pointer)) {
                this.ports.hover(pointer);
                return;
            }
            this.captured = true;
            this.pointerId = Number.isInteger(event.pointerId) ? event.pointerId : null;
            this.intercepted++;
            consumeOwnedSceneEvent(event);
            if (this.pointerId !== null) {
                try { this.canvas?.setPointerCapture?.(this.pointerId); }
                catch { /* WebView may not allow pointer capture on this target */ }
            }
        } catch (error) {
            this.captured = false;
            this.pointerId = null;
            try { this.ports.cancel(); } finally { throw error; }
        }
    };

    private readonly onMove = (event: any): void => {
        if (this.captured && this.pointerId !== null &&
            Number.isInteger(event?.pointerId) && event.pointerId !== this.pointerId)
            return;
        const pointer = this.point(event);
        if (!pointer) return;
        this.observed++;
        if (this.captured) {
            consumeOwnedSceneEvent(event);
            this.ports.move(pointer);
        } else {
            this.hoverCount++;
            this.ports.hover(pointer);
        }
    };

    private readonly onUp = (event: any): void => {
        if (!this.captured || this.pointerId !== null &&
            Number.isInteger(event?.pointerId) && event.pointerId !== this.pointerId)
            return;
        const pointer = this.point(event);
        consumeOwnedSceneEvent(event);
        this.captured = false;
        const oldId = this.pointerId;
        this.pointerId = null;
        try {
            if (pointer) this.ports.up(pointer);
            else this.ports.cancel();
        } finally {
            if (oldId !== null) {
                try { this.canvas?.releasePointerCapture?.(oldId); }
                catch { /* No captured pointer */ }
            }
        }
    };

    private readonly onCancel = (): void => {
        if (!this.captured) return;
        this.cancellationCount++;
        this.captured = false;
        this.pointerId = null;
        this.ports.cancel();
    };

    public detach(): void {
        if (this.eventRoot) {
            const prefix = this.enabled ? 'pointer' : 'mouse';
            this.eventRoot.removeEventListener(prefix + 'down', this.onDown, true);
            this.eventRoot.removeEventListener(prefix + 'move', this.onMove, true);
            this.eventRoot.removeEventListener(prefix + 'up', this.onUp, true);
            if (this.enabled) this.eventRoot.removeEventListener('pointercancel', this.onCancel, true);
        }
        this.onCancel();
        this.doc = null;
        this.eventRoot = null;
        this.canvas = null;
        this.lastReason = 'detached';
    }

    public status(): {
        active: boolean; reason: string; captured: boolean;
        observed: number; intercepted: number; hover: number; cancelled: number;
    } {
        return {
            active: !!this.doc, reason: this.lastReason, captured: this.captured,
            observed: this.observed, intercepted: this.intercepted,
            hover: this.hoverCount, cancelled: this.cancellationCount,
        };
    }
}
