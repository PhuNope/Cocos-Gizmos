/**
 * Groups one user gesture into one editor change session.
 * The host decides how to record the transaction and refresh the Inspector.
 */
export interface GizmoEditHooks<T> {
    begin(value: T): void;
    update(value: T): void;
    rollback(value: T): void;
    end(value: T, cancelled: boolean, changed: boolean): void;
}

function snapshot<T>(value: T): T {
    if (value && typeof value === 'object') {
        const point = value as { x?: number; y?: number; z?: number };
        if (typeof point.x === 'number' && typeof point.y === 'number' &&
            typeof point.z === 'number') {
            return { x: point.x, y: point.y, z: point.z } as T;
        }
    }
    return value;
}

function same<T>(left: T, right: T): boolean {
    if (Object.is(left, right)) return true;
    if (left && right && typeof left === 'object' && typeof right === 'object') {
        const a = left as { x?: number; y?: number; z?: number };
        const b = right as { x?: number; y?: number; z?: number };
        return typeof a.x === 'number' && typeof a.y === 'number' &&
            typeof a.z === 'number' && a.x === b.x && a.y === b.y && a.z === b.z;
    }
    return false;
}

/** One begin, zero or more meaningful updates, and one end or cancellation. */
export class GizmoEditSession<T> {
    private initial: T | undefined;
    private last: T | undefined;
    private active = false;
    private changed = false;

    constructor(
        private readonly read: () => T,
        private readonly write: (value: T) => void,
        private readonly hooks: GizmoEditHooks<T>,
    ) {}

    public get isActive(): boolean { return this.active; }
    public get hasChanges(): boolean { return this.changed; }

    public begin(): boolean {
        if (this.active) return false;
        const value = snapshot(this.read());
        this.initial = value;
        this.last = snapshot(value);
        this.changed = false;
        this.active = true;
        try { this.hooks.begin(snapshot(value)); }
        catch (error) {
            this.active = false;
            this.initial = undefined;
            this.last = undefined;
            throw error;
        }
        return true;
    }

    public apply(value: T): boolean {
        if (!this.active || same(this.last as T, value)) return false;
        const next = snapshot(value);
        this.write(next);
        this.last = snapshot(next);
        this.changed = !same(this.initial as T, next);
        this.hooks.update(snapshot(next));
        return true;
    }

    public finish(cancelled = false): boolean {
        if (!this.active) return false;
        this.active = false;
        const original = snapshot(this.initial as T);
        const changed = this.changed;
        let current = snapshot(this.last as T);
        try {
            if (cancelled && !same(original, current)) {
                this.write(original);
                this.hooks.rollback(snapshot(original));
                current = original;
            }
        } finally {
            this.initial = undefined;
            this.last = undefined;
            this.changed = false;
            this.hooks.end(snapshot(current), cancelled, changed);
        }
        return changed;
    }
}
