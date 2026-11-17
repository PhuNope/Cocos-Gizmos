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
