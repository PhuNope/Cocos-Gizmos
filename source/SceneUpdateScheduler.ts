export type GizmoTickSource = 'engine' | 'timer' | 'initial' | 'manual';
export type GizmoTickSkipReason = 'recent-engine' | 'reentrant';

export interface SceneUpdateSchedulerPort {
    now(): number;
    subscribe(listener: () => void): void;
    unsubscribe(listener: () => void): void;
    schedule(listener: () => void, intervalMs: number): ReturnType<typeof setInterval>;
    cancel(handle: ReturnType<typeof setInterval>): void;
    update(source: GizmoTickSource): void;
    onSkip?(reason: GizmoTickSkipReason): void;
}

/**
 * Runs scene callbacks at the engine frame rate.
 * A low-frequency watchdog updates the Scene when engine frames stop.
 * Reentrant notifications never start a second drawing pass.
 */
export class SceneUpdateScheduler {
    public static readonly FALLBACK_INTERVAL_MS = 250;

    private started = false;
    private updating = false;
    private lastEngineFrame = -Infinity;
    private watchdog: ReturnType<typeof setInterval> | null = null;

    private readonly onEngineFrame = (): void => {
        if (!this.started) return;
        this.lastEngineFrame = this.port.now();
        this.run('engine');
    };

    private readonly onWatchdog = (): void => {
        if (!this.started) return;
        const now = this.port.now();
        const elapsed = now - this.lastEngineFrame;
        if (elapsed >= 0 && elapsed < SceneUpdateScheduler.FALLBACK_INTERVAL_MS) {
            this.port.onSkip?.('recent-engine');
            return;
        }
        this.run('timer');
    };

    constructor(private readonly port: SceneUpdateSchedulerPort) {}

    public start(): void {
        if (this.started) return;
        this.started = true;
        this.lastEngineFrame = -Infinity;
        try {
            this.port.subscribe(this.onEngineFrame);
            this.watchdog = this.port.schedule(
                this.onWatchdog, SceneUpdateScheduler.FALLBACK_INTERVAL_MS,
            );
            (this.watchdog as any)?.unref?.();
            this.run('initial');
        } catch (error) {
            this.stop();
            throw error;
        }
    }

    public tickOnce(): void {
        if (this.started) this.run('manual');
    }

    public stop(): void {
        if (!this.started) return;
        this.started = false;
        this.port.unsubscribe(this.onEngineFrame);
        if (this.watchdog !== null) {
            this.port.cancel(this.watchdog);
            this.watchdog = null;
        }
        this.lastEngineFrame = -Infinity;
    }

    private run(source: GizmoTickSource): void {
        if (this.updating) {
            this.port.onSkip?.('reentrant');
            return;
        }
        this.updating = true;
        try {
            this.port.update(source);
        } finally {
            this.updating = false;
        }
    }
}
