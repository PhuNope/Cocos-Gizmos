/** A short-lived lease representing a selected Node's own Gizmo gesture.
 * The Scene process holds the lease; the Editor main process may consult it
 * when the native Scene picker emits an unwanted unselect for a HUD click.
 */
export class SceneSelectionLease {
    private nodeUuid: string | null = null;
    private expiresAt = 0;
    private held = false;

    public begin(nodeUuid: string): void {
        if (!nodeUuid) return;
        this.nodeUuid = nodeUuid;
        this.expiresAt = 0;
        this.held = true;
    }

    /** Preserve long enough for Editor's asynchronous unselect broadcast. */
    public release(now = Date.now()): void {
        if (!this.nodeUuid) return;
        this.held = false;
        this.expiresAt = now + 250;
    }

    public clear(): void {
        this.nodeUuid = null;
        this.expiresAt = 0;
        this.held = false;
    }

    public inspect(now = Date.now()): { nodeUuid: string; active: boolean } | null {
        if (!this.nodeUuid) return null;
        if (!this.held && now > this.expiresAt) {
            this.clear();
            return null;
        }
        return { nodeUuid: this.nodeUuid, active: this.held };
    }
}

/** Consume only a confirmed plugin-owned pointer gesture.
 * Creator can wrap the original pointer event inside data/detail/event;
 * a return value from onNotGizmoMouseDown alone is not propagation control.
 */
export function consumeOwnedSceneEvent(event: any): void {
    const wrapped = [event, event?.event, event?.detail?.event,
        event?.data?.event, event?.nativeEvent];
    const visited = new Set<unknown>();
    for (const value of wrapped) {
        if (!value || typeof value !== 'object' || visited.has(value)) continue;
        visited.add(value);
        try {
            if (typeof value.stopImmediatePropagation === 'function')
                value.stopImmediatePropagation();
            else if (typeof value.stopPropagation === 'function')
                value.stopPropagation();
            // Both browser and Cocos event payloads can expose these flags.
            if ('propagationStopped' in value) value.propagationStopped = true;
            if (typeof value.preventDefault === 'function') value.preventDefault();
        } catch {
            // Read-only Cocos event wrappers must not break an active gesture.
        }
    }
}

/**
 * Is the original browser hit target (or current element at its coordinates)
 * part of a real DOM HUD? Unlike a screen-rectangle hit, this means the
 * browser still needs to dispatch pointerdown/up/click to the HTML control.
 */
export function isSceneHudDomTarget(
    event: any,
    viewportPoint?: { x: number; y: number } | null,
    viewport?: { width: number; height: number } | null,
): boolean {
    const selector='#cocos-gizmos-scene-hud, #cocos-gizmos-builder-hud';
    const wrapped=[event,event?.event,event?.detail?.event,
        event?.data?.event,event?.nativeEvent];
    for(const value of wrapped) {
        const target=value?.target;
        if(target && typeof target.closest==='function') {
            try { if(target.closest(selector))return true; }
            catch { /* Editor wrappers can expose a non-DOM target */ }
        }
    }
    const doc=(globalThis as any).document ||
        (globalThis as any).window?.document;
    if(!doc?.elementFromPoint)return false;
    let clientX:number|undefined;
    let clientY:number|undefined;
    for(const value of wrapped) {
        if(Number.isFinite(value?.clientX) && Number.isFinite(value?.clientY)){
            clientX=value.clientX;clientY=value.clientY;break;
        }
    }
    if(clientX===undefined && viewportPoint && viewport &&
       viewport.width>0 && viewport.height>0){
        const canvas=doc.getElementById?.('GameCanvas') ||
            doc.getElementById?.('GameDiv');
        const rect=canvas?.getBoundingClientRect?.();
        if(rect && rect.width>0 && rect.height>0){
            clientX=rect.left+viewportPoint.x*rect.width/viewport.width;
            clientY=rect.bottom-viewportPoint.y*rect.height/viewport.height;
        }
    }
    if(clientX===undefined || clientY===undefined)return false;
    try { return !!doc.elementFromPoint(clientX,clientY)?.closest?.(selector); }
    catch {return false;}
}

/**
 * Test whether a Scene input belongs to a floating HUD, including Creator
 * Operation events that discard the original browser event.target.
 *
 * Only the visible Builder panel bounds are opaque to Scene picking; the
 * full-screen overlay remains pointer-transparent. DOM and Editor adapters
 * share this predicate instead of relying on an event target in 3D.
 */
export function isSceneHudPointerEvent(
    event: any,
    viewportPoint?: { x: number; y: number } | null,
    viewport?: { width: number; height: number } | null,
): boolean {
    const selector='#cocos-gizmos-scene-hud, #cocos-gizmos-builder-hud';
    const wrapped=[event,event?.event,event?.detail?.event,
        event?.data?.event,event?.nativeEvent];
    for(const value of wrapped) {
        const target=value?.target;
        if(target && typeof target.closest==='function') {
            try { if(target.closest(selector))return true; }
            catch { /* Cocos wrappers can expose a non-DOM target */ }
        }
    }
    const doc=(globalThis as any).document ||
        (globalThis as any).window?.document;
    if(!doc?.getElementById)return false;
    let clientX:number|undefined;
    let clientY:number|undefined;
    for(const value of wrapped) {
        if(Number.isFinite(value?.clientX) && Number.isFinite(value?.clientY)) {
            clientX=value.clientX;clientY=value.clientY;break;
        }
    }
    if(clientX===undefined && viewportPoint && viewport &&
       viewport.width>0 && viewport.height>0) {
        const canvas=doc.getElementById('GameCanvas') ||
            doc.getElementById('GameDiv');
        const rect=canvas?.getBoundingClientRect?.();
        if(rect && rect.width>0 && rect.height>0) {
            clientX=rect.left+viewportPoint.x*rect.width/viewport.width;
            clientY=rect.bottom-viewportPoint.y*rect.height/viewport.height;
        }
    }
    if(clientX===undefined || clientY===undefined)return false;
    const hit=doc.elementFromPoint?.(clientX,clientY);
    if(hit?.closest?.(selector))return true;
    const hud=doc.getElementById('cocos-gizmos-builder-hud');
    if(!hud || hud.style?.display==='none')return false;
    // Scene Operation can carry screen coordinates but no DOM target.
    // Check only individual visible panels, never the overlay's full rect.
    for(const panel of Array.from(hud.children||[]) as any[]) {
        if(panel.style?.display==='none')continue;
        const rect=panel.getBoundingClientRect?.();
        if(rect && rect.width>0 && rect.height>0 &&
            clientX>=rect.left && clientX<=rect.right &&
            clientY>=rect.top && clientY<=rect.bottom)return true;
    }
    return false;
}
