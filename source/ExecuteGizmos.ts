import { Component, director, Director, Node } from 'cc';

// Scene process owns start/stop. A stale sessionStorage flag must not block the updater.
type UpdateStats = {
    started: boolean; frames: number; components: number; drawn: number;
    selectedDrawn: number; scene: string | null; selectionApi: boolean;
    lastSource: string | null; errors: number;
};
let running: {
    stats: UpdateStats;
    onBeforeUpdate: () => void;
    timer: ReturnType<typeof setInterval>;
    update: (source: string) => void;
} | null = null;

function selectedNodes(): { ids: Set<string>; available: boolean } {
    const editor = (globalThis as any).Editor || (globalThis as any).window?.Editor;
    if (!editor?.Selection || typeof editor.Selection.getSelected !== 'function') {
        return { ids: new Set<string>(), available: false };
    }
    try {
        const selected: string[] = editor.Selection.getSelected('node');
        return { ids: new Set(Array.isArray(selected) ? selected : []), available: true };
    } catch (error) {
        console.warn('[cocos-gizmos/updater] Cannot query Scene selection:', error);
        return { ids: new Set<string>(), available: false };
    }
}
function collectComponents(node: Node, out: Component[]): void {
    if (!node || !node.isValid || !node.active || !node.activeInHierarchy) return;
    for (const comp of node.components) {
        if (!comp || !comp.isValid || !comp.enabled) continue;
        if (typeof comp.onDrawGizmos === 'function' || typeof comp.onDrawGizmosSelected === 'function') out.push(comp);
    }
    for (const child of Array.from(node.children)) collectComponents(child, out);
}

export function start(): UpdateStats {
    stop();
    const stats: UpdateStats = {
        started: true, frames: 0, components: 0, drawn: 0, selectedDrawn: 0,
        scene: null, selectionApi: false, lastSource: null, errors: 0,
    };
    const reported = new Set<string>();
    let lastEngineTick = 0;
    let firstComponentLog = false;
    function warnOnce(key: string, error: unknown): void {
        stats.errors++;
        if (reported.has(key)) return;
        reported.add(key);
        console.error('[cocos-gizmos/updater] ' + key, error);
    }
    function update(source: string): void {
        if (source === 'timer' && Date.now() - lastEngineTick < 90) return;
        if (source === 'engine') lastEngineTick = Date.now();
        stats.frames++;
        stats.lastSource = source;
        let root: Node | null = null;
        try { root = director.getScene(); }
        catch (error) { warnOnce('director.getScene()', error); return; }
        stats.scene = root && (root.name || root.uuid || '(unnamed scene)');
        if (!root) { stats.components = 0; return; }
        const components: Component[] = [];
        try { collectComponents(root, components); }
        catch (error) { warnOnce('Scene traversal failed', error); return; }
        stats.components = components.length;
        if (components.length && !firstComponentLog) {
            firstComponentLog = true;
            console.info('[cocos-gizmos/updater] Found ' + components.length + ' Component(s) with Gizmos callbacks');
        }
        const selection = selectedNodes();
        stats.selectionApi = selection.available;
        for (const comp of components) {
            if (typeof comp.onDrawGizmos === 'function') {
                try { comp.onDrawGizmos(); stats.drawn++; }
                catch (error) { warnOnce('onDrawGizmos (' + comp.constructor?.name + ')', error); }
            }
            if (selection.ids.has(comp.node?.uuid) && typeof comp.onDrawGizmosSelected === 'function') {
                try { comp.onDrawGizmosSelected(); stats.selectedDrawn++; }
                catch (error) { warnOnce('onDrawGizmosSelected (' + comp.constructor?.name + ')', error); }
            }
        }
    }
    const onBeforeUpdate = () => update('engine');
    director.on(Director.EVENT_BEFORE_UPDATE, onBeforeUpdate);
    const timer = setInterval(() => update('timer'), 120);
    (timer as any)?.unref?.();
    running = { stats, onBeforeUpdate, timer, update };
    console.info('[cocos-gizmos/updater] Started; engine tick + 120ms idle fallback; no sessionStorage gate');
    update('initial');
    return status() as UpdateStats;
}
export function stop(): void {
    if (!running) return;
    director.off(Director.EVENT_BEFORE_UPDATE, running.onBeforeUpdate);
    clearInterval(running.timer);
    running = null;
    console.info('[cocos-gizmos/updater] Stopped');
}
export function status(): UpdateStats | { started: false } {
    return running ? { ...running.stats } : { started: false };
}
export function tickOnce(): UpdateStats | { started: false } {
    if (running) running.update('manual');
    return status();
}
