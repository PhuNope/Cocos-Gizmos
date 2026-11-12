import { Color, Component, Layers, Quat, Vec3 } from 'cc';
import {
    handlePlaneNormal,
    intersectHandlePlane,
    PositionDragSolver,
} from './PositionDragSolver';
import { HudControl, HudSliderDrag, hudRowScreenPosition, normalizeHudControls } from './GizmoHudControls';
import { normalizeHudItems } from './GizmoPresentation';

type Point = { x: number; y: number; z: number };
type Pointer = { x: number; y: number };
type Field = GizmoHandleDescriptor;
type Entry = { field: Field; controller: any; key: string };
type DragState = { entry: Entry; solver: PositionDragSolver; original: Point; changed: boolean };
type HudEntry = { control: HudControl; controller: any; key: string; index: number };
type HudDrag = { entry: HudEntry; solver: HudSliderDrag; changed: boolean };

function cceNamespace(): any {
    return (globalThis as any).cce || (globalThis as any).window?.cce || null;
}

function camera(): any {
    return cceNamespace()?.Camera?.camera || null;
}

function validPoint(value: any): value is Point {
    return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function selectedKeys(component: Component): string[] {
    const value: any = component;
    const names = [
        value.__classname__,
        value.constructor?.__classname__,
        value.constructor?.name,
    ].filter((key) => typeof key === 'string' && !!key) as string[];
    const keys = new Set<string>();
    for (const name of names) {
        keys.add(name);
        if (!name.includes('.')) keys.add('cc.' + name);
    }
    return [...keys];
}

function applyGizmoLayer(node: any): void {
    if (!node) return;
    node.layer = Layers.Enum.GIZMOS;
    for (const child of node.children || []) applyGizmoLayer(child);
}

function pointer(event: any): Pointer | null {
    for (const item of [event, event?.detail, event?.data, event?.mouse]) {
        if (Number.isFinite(item?.x) && Number.isFinite(item?.y)) {
            return { x: item.x, y: item.y };
        }
    }
    return null;
}

function sceneRay(position: Pointer): { o: Point; d: Point } | null {
    const view = camera();
    if (typeof view?.screenPointToRay !== 'function') return null;
    const ray = { o: new Vec3(), d: new Vec3() };
    try {
        const result = view.screenPointToRay(position.x, position.y, ray) || ray;
        if (validPoint(result.o) && validPoint(result.d)) return result;
    } catch (error) {
        console.warn('[cocos-gizmos/handles] Unable to calculate Scene ray:', error);
    }
    return null;
}

function spaceFor(component: Component, field: Field): {
    toLocal(point: Point): Point;
    toWorld(point: Point): Point;
} {
    if (field.space === 'world') {
        return {
            toLocal: (point) => ({ ...point }),
            toWorld: (point) => ({ ...point }),
        };
    }
    return {
        toLocal: (point) => {
            const result = new Vec3();
            component.node.inverseTransformPoint(result, new Vec3(point.x, point.y, point.z));
            return { x: result.x, y: result.y, z: result.z };
        },
        toWorld: (point) => {
            const result = new Vec3();
            Vec3.transformMat4(result, new Vec3(point.x, point.y, point.z), component.node.worldMatrix);
            return { x: result.x, y: result.y, z: result.z };
        },
    };
}

function readField(target: Component, field: Field): Point | null {
    const raw: any = (target as any)[field.property];
    const value = field.index === undefined ? raw : Array.isArray(raw) ? raw[field.index] : null;
    return validPoint(value) ? { x: value.x, y: value.y, z: value.z } : null;
}

function writeField(target: Component, field: Field, value: Point): boolean {
    const raw: any = (target as any)[field.property];
    const point = new Vec3(value.x, value.y, value.z);
    if (field.index === undefined) {
        (target as any)[field.property] = point;
        return true;
    }
    if (!Array.isArray(raw) || field.index < 0 || field.index >= raw.length) return false;
    raw[field.index] = point;
    return true;
}

function markerSize(world: Point): number {
    const view = camera();
    if (typeof view?.worldToScreen !== 'function') return 0.3;
    const screen = new Vec3();
    try {
        view.worldToScreen(new Vec3(world.x, world.y, world.z), screen);
        const a = sceneRay({ x: screen.x, y: screen.y });
        const b = sceneRay({ x: screen.x + 1, y: screen.y });
        if (!a || !b) return 0.3;
        const normal = a.d;
        const hitA = intersectHandlePlane(a, world, normal);
        const hitB = intersectHandlePlane(b, world, normal);
        if (!hitA || !hitB) return 0.3;
        const pixel = Math.hypot(hitA.x - hitB.x, hitA.y - hitB.y, hitA.z - hitB.z);
        if (Number.isFinite(pixel) && pixel > 0) return Math.max(0.01, Math.min(1000, pixel * 10));
    } catch {
        // Keep the default marker size if the camera is being replaced.
    }
    return 0.3;
}

function createEditorGizmo(base: any, allowHud: (component: Component) => boolean): any {
    return class PositionHandleEditorGizmo extends base {
        private entries: Entry[] = [];
        private hudEntries: HudEntry[] = [];
        private drag: DragState | null = null;
        private hudDrag: HudDrag | null = null;
        private pendingClick: HudEntry | null = null;
        private shown = false;
        private layout = '';

        public init(): void {
            this.shouldRegisterGizmoOperationEvent = true;
            this.rebuild();
            this._isInitialized = true;
        }

        private descriptors(): Field[] {
            const component = this.target as Component;
            const all = component?.onGizmoHandles?.();
            if (!Array.isArray(all)) return [];
            return all.filter((field) => field && typeof field.property === 'string' &&
                /^(xy|xz|yz|view)$/.test(field.plane || 'xy') &&
                (field.index === undefined || Number.isInteger(field.index) && field.index >= 0) &&
                readField(component, field) !== null);
        }

        private hudDescriptors(): HudControl[] {
            const component = this.target as Component;
            if (!component || !allowHud(component)) return [];
            const raw = component.onGizmoHudControls?.();
            return normalizeHudControls(raw).filter((control) =>
                control.type === 'button' ||
                (control.type === 'slider' ?
                    typeof (component as any)[control.property] === 'number' &&
                    Number.isFinite((component as any)[control.property]) :
                    typeof (component as any)[control.property] === 'boolean'));
        }

        private signature(fields: Field[], controls: HudControl[]): string {
            return JSON.stringify({
                fields: fields.map((field) => [
                    field.property, field.index, field.plane || 'xy',
                    field.space || 'local', field.axis, field.snap,
                    field.color, field.bounds,
                ]),
                controls,
            });
        }

        private rebuild(): void {
            this.clearEntries();
            const fields = this.descriptors();
            const controls = this.hudDescriptors();
            this.layout = this.signature(fields, controls);
            for (const field of fields) {
                try {
                    super.createController();
                    const controller = this._controller;
                    if (!controller) continue;
                    const key = `position:${field.property}:${field.index ?? 'single'}`;
                    const entry: Entry = { field, controller, key };
                    const color = new Color();
                    if (field.color && Color.fromHEX) Color.fromHEX(color, field.color);
                    else color.set(255, 174, 66, 255);
                    controller.setColor?.(color);
                    controller.setEditHandlesColor?.(color);
                    controller.setOpacity?.(255);
                    controller.editable = true;
                    controller._edit = true;
                    controller._editable = true;
                    controller._defaultEditHandleSize = 0.08;
                    controller.initEditHandles?.();
                    controller.showEditHandles?.();
                    if (controller._wireFrameBoxNode) controller._wireFrameBoxNode.active = false;
                    if (controller._wireFrameBoxMeshRenderer) controller._wireFrameBoxMeshRenderer.enabled = false;
                    if (controller._editHandlesShape) {
                        controller._editHandlesShape.active = true;
                        applyGizmoLayer(controller._editHandlesShape);
                        for (const child of controller._editHandlesShape.children || []) {
                            child.active = child.name === 'y';
                        }
                    }
                    applyGizmoLayer(controller._cubeNode);
                    // The editable Y face handles Scene picking; the cube renders the point.
                    controller.setHandleColor?.('y', color, 0);
                    if (controller._cubeNode) {
                        controller._cubeNode.active = true;
                        if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = true;
                        if (controller._handleDataMap?.[key]) controller.removeHandle?.(key);
                        controller.initHandle?.(controller._cubeNode, key);
                    }
                    const down = (event: any) => this.begin(entry, event);
                    const move = (event: any) => this.move(entry, event);
                    const up = () => this.finish(false);
                    controller.onControllerMouseDown = down;
                    controller.onControllerMouseMove = move;
                    controller.onControllerMouseUp = up;
                    controller.onMouseDown = down;
                    controller.onMouseMove = move;
                    controller.onMouseUp = up;
                    controller.registerEvents?.();
                    this.entries.push(entry);
                } catch (error) {
                    console.warn('[cocos-gizmos/handles] Cannot initialize position controller:', error);
                }
            }
            for (const [index, control] of controls.entries()) {
                try {
                    super.createController();
                    const controller = this._controller;
                    if (!controller) continue;
                    const key = 'hud:' + control.id;
                    const entry: HudEntry = { control, controller, key, index };
                    const color = new Color();
                    if (typeof Color.fromHEX === 'function') Color.fromHEX(color, control.color);
                    else color.set(58, 182, 255, 255);
                    controller.setColor?.(color);
                    controller.setOpacity?.(255);
                    controller.editable = true;
                    controller._edit = true;
                    controller._editable = true;
                    if (controller._wireFrameBoxNode) controller._wireFrameBoxNode.active = false;
                    if (controller._wireFrameBoxMeshRenderer) controller._wireFrameBoxMeshRenderer.enabled = false;
                    if (controller._editHandlesShape) controller._editHandlesShape.active = false;
                    if (controller._cubeNode) {
                        applyGizmoLayer(controller._cubeNode);
                        controller._cubeNode.active = true;
                        if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = true;
                        controller.initHandle?.(controller._cubeNode, key);
                    }
                    const down = (event: any) => this.beginHud(entry, event);
                    const move = (event: any) => this.moveHud(entry, event);
                    const up = () => this.finishHud(false);
                    controller.onControllerMouseDown = down;
                    controller.onControllerMouseMove = move;
                    controller.onControllerMouseUp = up;
                    controller.onMouseDown = down;
                    controller.onMouseMove = move;
                    controller.onMouseUp = up;
                    controller.registerEvents?.();
                    this.hudEntries.push(entry);
                } catch (error) {
                    console.warn('[cocos-gizmos/hud] Cannot initialize HUD controller:', error);
                }
            }
            this.updateMarkers();
        }

        public refreshHandles(): void {
            const fields = this.descriptors();
            const controls = this.hudDescriptors();
            if (this.signature(fields, controls) !== this.layout && !this.drag && !this.hudDrag && !this.pendingClick) {
                this.rebuild();
            } else this.updateMarkers();
        }

        private updateMarkers(): void {
            if (!this.shown && !this.drag) return;
            const component = this.target as Component;
            if (!component?.node?.isValid) return;
            for (const entry of this.entries) {
                const local = readField(component, entry.field);
                if (!local) {
                    entry.controller.hide?.();
                    continue;
                }
                const world = spaceFor(component, entry.field).toWorld(local);
                if (!validPoint(world)) continue;
                entry.controller.setPosition?.(new Vec3(world.x, world.y, world.z));
                entry.controller.setRotation?.(new Quat());
                const size = markerSize(world);
                entry.controller.updateSize?.(Vec3.ZERO, new Vec3(size, size, size));
            }
            if (!this.hudEntries.length) return;
            const view = camera();
            if (typeof view?.worldToScreen !== 'function') return;
            const anchor = new Vec3();
            try { view.worldToScreen(component.node.worldPosition, anchor); }
            catch { return; }
            if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
            const texts = normalizeHudItems(component.onGizmoHud?.());
            for (const entry of this.hudEntries) {
                const row = hudRowScreenPosition(anchor, texts.length + entry.index);
                const pointer = sceneRay({ x: row.x - 14, y: row.y });
                const normal = view.node?.forward || pointer?.d;
                const point = pointer && normal ?
                    intersectHandlePlane(pointer, component.node.worldPosition, normal) : null;
                if (!point) {
                    entry.controller.hide?.();
                    continue;
                }
                const world = new Vec3(point.x, point.y, point.z);
                entry.controller.setPosition?.(world);
                const size = markerSize(world) * 14;
                entry.controller.updateSize?.(Vec3.ZERO, new Vec3(size, size, size));
            }
        }

        private beginHud(entry: HudEntry, event: any): void {
            if (!this.shown || this.drag || this.hudDrag || this.pendingClick) return;
            if (event?.handleName && event.handleName !== entry.key && event.handleName !== 'y') return;
            const component = this.target as Component;
            if (entry.control.type !== 'slider') {
                this.pendingClick = entry;
                return;
            }
            const current = (component as any)[entry.control.property];
            const at = pointer(event);
            if (!at || !Number.isFinite(current)) return;
            try {
                const solver = new HudSliderDrag(entry.control, current, at.x);
                this.hudDrag = { entry, solver, changed: false };
                this.onControlBegin?.(entry.control.property);
                component.onGizmoHudChanged?.(entry.control.property, 'begin', current);
            } catch (error) {
                console.warn('[cocos-gizmos/hud] Cannot begin slider drag:', error);
            }
        }

        private moveHud(entry: HudEntry, event: any): void {
            const drag = this.hudDrag;
            if (!drag || drag.entry !== entry || drag.entry.control.type !== 'slider') return;
            const at = pointer(event);
            if (!at) return;
            const next = drag.solver.move(at.x);
            if (next === null) return;
            const component = this.target as Component;
            const property = drag.entry.control.property;
            if ((component as any)[property] === next) return;
            (component as any)[property] = next;
            drag.changed = true;
            component.onGizmoHudChanged?.(property, 'update', next);
            this.onControlUpdate?.(property);
            this.onComponentChanged?.(component.node);
            cceNamespace()?.Engine?.repaintInEditMode?.();
        }

        private finishHud(cancelled: boolean): void {
            const click = this.pendingClick;
            this.pendingClick = null;
            const component = this.target as Component;
            if (click && !cancelled) {
                const control = click.control;
                if (control.type === 'button') {
                    this.onControlBegin?.(click.key);
                    try {
                        component.onGizmoHudAction?.(control.id);
                        this.onComponentChanged?.(component.node);
                    } finally {
                        this.onControlEnd?.(click.key);
                    }
                } else if (control.type === 'toggle' || control.type === 'checkbox') {
                    const value = (component as any)[control.property];
                    if (typeof value === 'boolean') {
                        this.onControlBegin?.(control.property);
                        try {
                            component.onGizmoHudChanged?.(control.property, 'begin', value);
                            const next = !value;
                            (component as any)[control.property] = next;
                            component.onGizmoHudChanged?.(control.property, 'update', next);
                            this.onControlUpdate?.(control.property);
                            this.onComponentChanged?.(component.node);
                            component.onGizmoHudChanged?.(control.property, 'end', next);
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        } finally {
                            this.onControlEnd?.(control.property);
                        }
                    }
                }
                this.updateMarkers();
            }
            const drag = this.hudDrag;
            this.hudDrag = null;
            if (!drag || drag.entry.control.type !== 'slider') return;
            const property = drag.entry.control.property;
            if (cancelled && drag.changed) {
                (component as any)[property] = drag.solver.cancel();
                this.onComponentChanged?.(component.node);
            }
            component.onGizmoHudChanged?.(
                property, cancelled ? 'cancel' : 'end', (component as any)[property],
            );
            this.onControlEnd?.(property);
            this.updateMarkers();
        }

        private begin(entry: Entry, event: any): void {
            if (!this.shown || this.drag) return;
            if (event?.handleName && event.handleName !== 'y' && event.handleName !== entry.key) return;
            const view = pointer(event);
            const ray = view && sceneRay(view);
            if (!ray) return;
            const target = this.target as Component;
            const original = readField(target, entry.field);
            if (!original) return;
            const transform = spaceFor(target, entry.field);
            const forward = camera()?.node?.forward || ray.d;
            const normal = handlePlaneNormal(entry.field.plane || 'xy', transform, original, forward);
            if (!normal) return;
            try {
                const solver = new PositionDragSolver(original, transform, normal, entry.field);
                if (!solver.begin(ray)) return;
                this.drag = { entry, solver, original, changed: false };
                this.onControlBegin?.(entry.field.property, entry.field.index);
                target.onGizmoChanged?.(entry.field.property, 'begin', entry.field.index);
            } catch (error) {
                console.warn('[cocos-gizmos/handles] Unable to start position drag:', error);
            }
        }

        private move(entry: Entry, event: any): void {
            const drag = this.drag;
            if (!drag || drag.entry !== entry) return;
            const view = pointer(event);
            const ray = view && sceneRay(view);
            if (!ray) return;
            const next = drag.solver.move(ray);
            if (!next) return;
            const target = this.target as Component;
            if (!writeField(target, entry.field, next)) return;
            drag.changed = true;
            target.onGizmoChanged?.(entry.field.property, 'update', entry.field.index);
            this.onControlUpdate?.(entry.field.property, entry.field.index);
            this.onComponentChanged?.(target.node);
            this.updateMarkers();
            cceNamespace()?.Engine?.repaintInEditMode?.();
        }

        private finish(cancelled: boolean): void {
            const drag = this.drag;
            if (!drag) return;
            this.drag = null;
            const target = this.target as Component;
            if (cancelled && drag.changed) {
                writeField(target, drag.entry.field, drag.solver.cancel());
                this.onComponentChanged?.(target.node);
            }
            target?.onGizmoChanged?.(
                drag.entry.field.property, cancelled ? 'cancel' : 'end', drag.entry.field.index,
            );
            this.onControlEnd?.(drag.entry.field.property, drag.entry.field.index);
            this.updateMarkers();
        }

        public onGizmoMouseDown(event: any): void {
            const name = event?.handleName;
            const entry = this.entries.find((item) => item.key === name);
            if (entry) this.begin(entry, event);
            const hud = this.hudEntries.find((item) => item.key === name);
            if (hud) this.beginHud(hud, event);
        }

        public onGizmoMouseMove(event: any): void {
            if (this.drag) this.move(this.drag.entry, event);
            if (this.hudDrag) this.moveHud(this.hudDrag.entry, event);
        }

        public onGizmoMouseUp(): void {
            this.finish(false);
            this.finishHud(false);
        }

        public onKeyDown(event: any): boolean | void {
            if ((this.drag || this.hudDrag || this.pendingButton) &&
                (event?.key === 'Escape' || event?.keyCode === 27)) {
                this.finish(true);
                this.finishHud(true);
                return true;
            }
        }

        public onShow(): void {
            this.shown = true;
            this.refreshHandles();
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                controller.show?.();
                controller.showEditHandles?.();
                controller.registerEvents?.();
            }
        }

        public onHide(): void {
            this.finish(false);
            this.finishHud(true);
            this.shown = false;
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                controller.unregisterEvents?.();
                controller.hideEditHandles?.();
                controller.hide?.();
            }
        }

        public onTargetUpdate(): void { this.refreshHandles(); }
        public onNodeChanged(): void { this.updateMarkers(); }
        public updateControllerTransform(): void { this.updateMarkers(); }

        private clearEntries(): void {
            for (const { controller, key } of [...this.entries, ...this.hudEntries]) {
                controller.unregisterEvents?.();
                controller.removeHandle?.(key);
                controller.hideEditHandles?.();
                controller.hide?.();
            }
            this.entries.length = 0;
            this.hudEntries.length = 0;
        }

        public onDestroy(): void {
            this.finish(false);
            this.finishHud(true);
            this.shown = false;
            this.clearEntries();
        }
    };
}

export interface PositionHandleSceneAdapter {
    refresh(components: readonly Component[], selected: ReadonlySet<string>, now: number): void;
    dispose(): void;
    status(): { registered: number; active: number; reason: string };
}

export function createPositionHandleAdapter(
    allowHud: (component: Component) => boolean = () => true,
): PositionHandleSceneAdapter {
    const registered = new Map<string, any>();
    const active = new Map<Component, any>();
    let gizmoConstructor: any = null;
    let latestScan = -Infinity;
    let reason = 'not-initialized';
    let manager: any = null;
    let typeDefs: any = null;

    function initialize(): boolean {
        const gizmo = cceNamespace()?.Gizmo;
        const pool = gizmo?._gizmoPool?._getPool?.('component');
        if (!pool?.typeDefs || typeof pool.typeDefs['cc.BoxCollider'] !== 'function') {
            reason = 'component-gizmo-bridge-unavailable';
            return false;
        }
        manager = gizmo;
        typeDefs = pool.typeDefs;
        if (!gizmoConstructor) gizmoConstructor = createEditorGizmo(typeDefs['cc.BoxCollider'], allowHud);
        reason = 'ready';
        return true;
    }

    function show(component: Component): any {
        let gizmo = (component as any).gizmo;
        if (!(gizmo instanceof gizmoConstructor)) {
            try {
                manager.showComponentGizmo?.(component);
                gizmo = (component as any).gizmo;
            } catch {
                // Use the component pool API when selection has no existing Gizmo.
            }
        }
        if (!(gizmo instanceof gizmoConstructor) && typeof manager.createGizmo === 'function') {
            for (const key of selectedKeys(component)) {
                try {
                    gizmo = manager.createGizmo(key, component) || (component as any).gizmo;
                    if (gizmo instanceof gizmoConstructor) break;
                } catch {
                    // Some class keys are aliases that the pool does not register.
                }
            }
        }
        if (!(gizmo instanceof gizmoConstructor)) return null;
        gizmo.show?.();
        gizmo.refreshHandles?.();
        return gizmo;
    }

    return {
        refresh(components, selected, now) {
            if (now - latestScan < 250) return;
            latestScan = now;
            if (!initialize()) return;
            const wanted = new Set<Component>();
            for (const component of components) {
                if (!component?.isValid || !component.enabled || !component.node?.activeInHierarchy ||
                    !selected.has(component.node.uuid) ||
                    (typeof component.onGizmoHandles !== 'function' &&
                     typeof component.onGizmoHudControls !== 'function')) continue;
                wanted.add(component);
                let installed = false;
                for (const key of selectedKeys(component)) {
                    if (!typeDefs[key]) {
                        typeDefs[key] = gizmoConstructor;
                        registered.set(key, gizmoConstructor);
                        installed = true;
                    } else if (typeDefs[key] === gizmoConstructor) installed = true;
                }
                if (!installed) continue;
                const previous = active.get(component);
                if (previous) previous.refreshHandles?.();
                else {
                    const next = show(component);
                    if (next) active.set(component, next);
                }
            }
            for (const [component, gizmo] of active) {
                if (!wanted.has(component)) {
                    gizmo.hide?.();
                    active.delete(component);
                }
            }
        },
        dispose() {
            for (const gizmo of active.values()) gizmo.hide?.();
            active.clear();
            for (const [key, ctor] of registered) {
                if (typeDefs?.[key] === ctor) delete typeDefs[key];
            }
            registered.clear();
            manager = null;
            typeDefs = null;
            latestScan = -Infinity;
            reason = 'disposed';
        },
        status() {
            return { registered: registered.size, active: active.size, reason };
        },
    };
}
