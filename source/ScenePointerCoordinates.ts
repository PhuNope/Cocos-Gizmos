import { readScenePointer, ScenePointer } from './SceneGizmoInput';

export interface ViewportSize { width: number; height: number }
export interface SceneCanvasElement {
    getBoundingClientRect(): {
        left: number; right: number; top: number; bottom: number;
        width: number; height: number;
    };
}
export interface SceneCanvasDocument {
    getElementById(id: string): SceneCanvasElement | null;
}

/**
 * Cocos Creator 3.8.8's ISceneMouseEvent contains BOTH x/y and browser
 * clientX/clientY. The first pair follows the Editor Operation's own
 * coordinate space; it cannot be assumed to match the renderer camera's
 * screenPointToRay/worldToScreen viewport.
 *
 * Use the actual engine canvas bounding rectangle, converting top-left
 * browser CSS pixels to bottom-left camera viewport pixels. This is exactly
 * the coordinate system that GizmoViewportGeometry and HUD drawing use.
 *
 * If we cannot establish this mapping, preserve the Editor event x/y rather
 * than guessing DPI or negating Y without knowing its coordinate origin.
 */
export function sceneEventToViewport(
    event: any, viewport?: ViewportSize | null,
    documentPort: SceneCanvasDocument | null =
        (globalThis as any).document || (globalThis as any).window?.document || null,
): { pointer: ScenePointer | null; source: 'canvas-client' | 'editor-xy' | 'missing' } {
    if (viewport && viewport.width > 0 && viewport.height > 0 &&
        Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
        const canvas=documentPort?.getElementById?.('GameCanvas') ||
            documentPort?.getElementById?.('GameDiv');
        let rect: ReturnType<SceneCanvasElement['getBoundingClientRect']> | null=null;
        try { rect=canvas?.getBoundingClientRect?.() || null; }
        catch { /* Viewport can close between event and projection */ }
        if (rect && rect.width > 0 && rect.height > 0 &&
            Number.isFinite(rect.left) && Number.isFinite(rect.bottom) &&
            Number.isFinite(rect.right) && Number.isFinite(rect.top)) {
            // Ignore client coordinates belonging to a different window or
            // iframe. A held pointer may move outside the canvas, so permit
            // one full canvas of overflow rather than clamping the motion.
            const paddingX=rect.width, paddingY=rect.height;
            if (event.clientX>=rect.left-paddingX &&
                event.clientX<=rect.right+paddingX &&
                event.clientY>=rect.top-paddingY &&
                event.clientY<=rect.bottom+paddingY) {
                return {
                    pointer: {
                        x: (event.clientX-rect.left)*viewport.width/rect.width,
                        y: (rect.bottom-event.clientY)*viewport.height/rect.height,
                    },
                    source:'canvas-client',
                };
            }
        }
    }
    const fallback=readScenePointer(event);
    return {pointer:fallback,source:fallback?'editor-xy':'missing'};
}
