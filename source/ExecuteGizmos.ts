import { Component, director, Director, Node } from 'cc';
import { SceneUpdateScheduler } from './SceneUpdateScheduler';

// Scene process owns start/stop. A stale sessionStorage flag must not block the updater.
type UpdateStats = {
    started: boolean; frames: number; components: number; drawn: number;
    selectedDrawn: number; scene: string | null; selectionApi: boolean;
    lastSource: string | null; errors: number;
    engineFrames: number; fallbackFrames: number;
    timerSkips: number; reentrantSkips: number; hudDrawn: number;
};
interface PositionHandleAdapter {
    refresh(components: readonly Component[], selected: ReadonlySet<string>, now: number): void;
}
interface PresentationAdapter {
    evaluate(component: Component, selected: boolean): { draw: boolean; hud: boolean };
    renderHud(component: Component): number;
}

let positionHandles: PositionHandleAdapter | null = null;
let presentation: PresentationAdapter | null = null;

export function setPositionHandleAdapter(adapter: PositionHandleAdapter | null): void {
    positionHandles = adapter;
}
export function setPresentationAdapter(adapter: PresentationAdapter | null): void {
    presentation = adapter;
}

let running: {
    stats: UpdateStats;
    scheduler: { stop(): void; tickOnce(): void };
    dispose: () => void;
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
const DISCOVERY_INTERVAL_MS = 250;
const SELECTION_POLL_INTERVAL_MS = 32;

class SelectedNodeCache {
    private previous = { ids: new Set<string>(), available: false };
    private lastCheckedAt = -Infinity;

    public get(now: number): { ids: Set<string>; available: boolean } {
        if (now - this.lastCheckedAt >= SELECTION_POLL_INTERVAL_MS) {
            this.previous = selectedNodes();
            this.lastCheckedAt = now;
        }
        return this.previous;
    }

    public clear(): void {
        this.previous = { ids: new Set<string>(), available: false };
        this.lastCheckedAt = -Infinity;
    }
}

function collectComponents(node: Node, out: Component[]): void {
    if (!node || !node.isValid || !node.active || !node.activeInHierarchy) return;
    for (const comp of node.components) {
        if (!comp || !comp.isValid || !comp.enabled) continue;
        if (typeof comp.onDrawGizmos === 'function' || typeof comp.onDrawGizmosSelected === 'function' ||
            typeof comp.onGizmoHandles === 'function' ||
            typeof comp.onGizmoHud === 'function' ||
            typeof comp.onGizmoHudControls === 'function') out.push(comp);
    }
    for (const child of node.children) collectComponents(child, out);
}

class GizmoComponentRegistry {
    private scene: Node | null = null;
    private lastScanAt = -Infinity;
    private components: Component[] = [];

    public get(scene: Node, now: number): readonly Component[] {
        if (scene !== this.scene || now - this.lastScanAt >= DISCOVERY_INTERVAL_MS) {
            const found: Component[] = [];
            collectComponents(scene, found);
            this.components = found;
            this.scene = scene;
            this.lastScanAt = now;
        }
        return this.components;
    }

    public clear(): void {
        this.scene = null;
        this.lastScanAt = -Infinity;
        this.components = [];
    }
}

export function start(): UpdateStats {
    stop();
    const stats: UpdateStats = {
        started: true, frames: 0, components: 0, drawn: 0, selectedDrawn: 0,
        scene: null, selectionApi: false, lastSource: null, errors: 0,
        engineFrames: 0, fallbackFrames: 0, timerSkips: 0, reentrantSkips: 0, hudDrawn: 0,
    };
    const reported = new Set<string>();
    const registry = new GizmoComponentRegistry();
    const selectionCache = new SelectedNodeCache();
    let activeScene: Node | null = null;
    let firstComponentLog = false;
    function warnOnce(key: string, error: unknown): void {
        stats.errors++;
        if (reported.has(key)) return;
        reported.add(key);
        console.error('[cocos-gizmos/updater] ' + key, error);
    }
    function update(source: string): void {
        stats.frames++;
        stats.lastSource = source;
        if (source === 'engine') stats.engineFrames++;
        if (source === 'timer') stats.fallbackFrames++;
        const now = Date.now();
        let root: Node | null = null;
        try { root = director.getScene(); }
        catch (error) { warnOnce('director.getScene()', error); return; }
        stats.scene = root && (root.name || root.uuid || '(unnamed scene)');
        if (root !== activeScene) {
            activeScene = root;
            selectionCache.clear();
        }
        if (!root) {
            registry.clear();
            stats.components = 0;
            return;
        }
        let components: readonly Component[];
        try { components = registry.get(root, now); }
        catch (error) { warnOnce('Scene traversal failed', error); return; }
        stats.components = components.length;
        if (components.length && !firstComponentLog) {
            firstComponentLog = true;
            console.info('[cocos-gizmos/updater] Found ' + components.length + ' Component(s) with Gizmos callbacks');
        }
        const selection = selectionCache.get(now);
        stats.selectionApi = selection.available;
        try {
            positionHandles?.refresh(components, selection.ids, now);
        } catch (error) {
            warnOnce('Position handles refresh failed', error);
        }
        for (const comp of components) {
            if (!comp.isValid || !comp.enabled || !comp.node?.activeInHierarchy) continue;
            const isSelected = selection.ids.has(comp.node.uuid);
            let visible = { draw: true, hud: isSelected };
            if (presentation) {
                try { visible = presentation.evaluate(comp, isSelected); }
                catch (error) { warnOnce('onGizmoSettings (' + comp.constructor?.name + ')', error); }
            }
            if (visible.draw && typeof comp.onDrawGizmos === 'function') {
                try { comp.onDrawGizmos(); stats.drawn++; }
                catch (error) { warnOnce('onDrawGizmos (' + comp.constructor?.name + ')', error); }
            }
            if (visible.draw && isSelected && typeof comp.onDrawGizmosSelected === 'function') {
                try { comp.onDrawGizmosSelected(); stats.selectedDrawn++; }
                catch (error) { warnOnce('onDrawGizmosSelected (' + comp.constructor?.name + ')', error); }
            }
            if (visible.hud && presentation &&
                (typeof comp.onGizmoHud === 'function' ||
                 typeof comp.onGizmoHudControls === 'function')) {
                try { stats.hudDrawn += presentation.renderHud(comp); }
                catch (error) { warnOnce('onGizmoHud (' + comp.constructor?.name + ')', error); }
            }
        }
    }
    const scheduler = new SceneUpdateScheduler({
        now: () => Date.now(),
        subscribe: (listener) => director.on(Director.EVENT_BEFORE_UPDATE, listener),
        unsubscribe: (listener) => director.off(Director.EVENT_BEFORE_UPDATE, listener),
        schedule: (listener, intervalMs) => setInterval(listener, intervalMs),
        cancel: (handle) => clearInterval(handle),
        update,
        onSkip: (reason) => {
            if (reason === 'recent-engine') stats.timerSkips++;
            else stats.reentrantSkips++;
        },
    });
    running = {
        stats,
        scheduler,
        dispose: () => {
            registry.clear();
            selectionCache.clear();
        },
    };
    try {
        scheduler.start();
    } catch (error) {
        running = null;
        registry.clear();
        selectionCache.clear();
        throw error;
    }
    console.info('[cocos-gizmos/updater] Started with engine frames and 250ms idle watchdog');
    return status() as UpdateStats;
}
export function stop(): void {
    if (!running) return;
    running.scheduler.stop();
    running.dispose();
    running = null;
    console.info('[cocos-gizmos/updater] Stopped');
}
export function status(): UpdateStats | { started: false } {
    return running ? { ...running.stats } : { started: false };
}
export function tickOnce(): UpdateStats | { started: false } {
    if (running) running.scheduler.tickOnce();
    return status();
}
