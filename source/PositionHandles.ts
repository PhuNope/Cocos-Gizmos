import { CCObject, Color, Component, director, Director, gfx, Layers,
    Material, Mesh, MeshRenderer, Node, Quat, RenderRoot2D, utils, Vec3 } from 'cc';
import { Gizmos2D } from './Gizmos2D';
import { Gizmos3D } from './Gizmos3D';
import {
    handlePlaneNormal,
    intersectHandlePlane,
    PositionDragSolver,
} from './PositionDragSolver';
import { HudControl, HudSliderDrag, hudGrid, hudRowScreenPosition, hudControlScreenRect,
    hudSliderScreenTrack, normalizeHudControls, hudControlLayoutSignature } from './GizmoHudControls';
import { createSceneHudProjection, createViewportHudProjection } from './GizmoHudProjection';
import { normalizeHudItems } from './GizmoPresentation';
import { GizmoEditSession } from './GizmoEditSession';
import { GizmoHudLayout } from './GizmoHudLayout';
import { resolveSceneCamera } from './SceneCameraBridge';
import {
    GizmoInputDiagnostics, GizmoInputSnapshot, readSceneHandleName,
    readScenePointer, ScenePointer,
} from './SceneGizmoInput';

type Point = { x: number; y: number; z: number };
type Field = GizmoHandleDescriptor;
type Entry = { field: Field; controller: any; key: string };
type DragState = { entry: Entry; solver: PositionDragSolver; session: GizmoEditSession<Point> };
type HudPickingQuad = { node: Node; renderer: MeshRenderer; material: Material; mesh: Mesh };
type HudEntry = { control: HudControl; controller: any; key: string; index: number;
    picking?: HudPickingQuad | null };
type HudDrag = { entry: HudEntry; solver: HudSliderDrag; session: GizmoEditSession<number> };

function cceNamespace(): any {
    return (globalThis as any).window?.cce || (globalThis as any).cce || null;
}

function camera(): any {
    return resolveSceneCamera(cceNamespace()).camera;
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

function sceneRay(position: ScenePointer): { o: Point; d: Point } | null {
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
    if (typeof view?.worldToScreen !== 'function') return 1.5;
    const screen = new Vec3();
    try {
        view.worldToScreen(new Vec3(world.x, world.y, world.z), screen);
        const a = sceneRay({ x: screen.x, y: screen.y });
        const b = sceneRay({ x: screen.x + 1, y: screen.y });
        if (!a || !b) return 1.5;
        const normal = a.d;
        const hitA = intersectHandlePlane(a, world, normal);
        const hitB = intersectHandlePlane(b, world, normal);
        if (!hitA || !hitB) return 0.3;
        const pixel = Math.hypot(hitA.x - hitB.x, hitA.y - hitB.y, hitA.z - hitB.z);
        // Use a ~22px picking marker rather than a tiny 10px cube. The
        // projection is evaluated again after every drag so the visible point
        // keeps the same size across Scene zoom levels.
        if (Number.isFinite(pixel) && pixel > 1e-10) {
            return Math.max(1e-8, pixel * 22);
        }
    } catch {
        // Keep the default marker size if the camera is being replaced.
    }
    return 1.5;
}

/**
 * Resize only the standalone picking marker. BoxController.updateSize()
 * re-enters editable box handles and assumes their private topNode exists.
 * These handles are not initialized by this Gizmo, so updateSize is unsafe.
 */
function setMarkerSize(controller: any, size: number, height = size, depth = size): void {
    const cube = controller?._cubeNode;
    if (!cube || !Number.isFinite(size) || size <= 0) return;
    // The built-in Controller may be attached beneath a transformed target
    // Node. Setting *local* scale makes points vanish on scaled 2D canvases.
    // World scale keeps the picking cube size independent of target scale.
    if (typeof cube.setWorldScale === 'function') {
        cube.setWorldScale(size, height, depth);
    } else {
        const parent = cube.parent?.worldScale;
        const parentX = parent?.x && Math.abs(parent.x) > 1e-8 ? Math.abs(parent.x) : 1;
        const parentY = parent?.y && Math.abs(parent.y) > 1e-8 ? Math.abs(parent.y) : 1;
        const parentZ = parent?.z && Math.abs(parent.z) > 1e-8 ? Math.abs(parent.z) : 1;
        const scale = new Vec3(size / parentX, height / parentY, depth / parentZ);
        if (typeof cube.setScale === 'function') cube.setScale(scale);
        else cube.scale = scale;
    }
}

function isCanvas2D(node: any): boolean {
    for (let current = node; current; current = current.parent) {
        if (typeof current.getComponent === 'function' &&
            current.getComponent(RenderRoot2D)) return true;
    }
    return false;
}

/**
 * Draw the marker independently from BoxCollider's private cube mesh. Creator
 * may keep the picking Controller alive while its rendering mesh disappears
 * after a 2D selection switch. The actual drag still uses initHandle and the
 * Editor's controller event pipeline; this is the visible representation.
 */
function drawSelectedPositionMarkers(component: Component): void {
    if (!component?.node?.isValid || typeof component.onGizmoHandles !== 'function') return;
    const fields: Field[] = component.onGizmoHandles() || [];
    if (!Array.isArray(fields) || !fields.length) return;
    const node = component.node;
    const onCanvas = isCanvas2D(node);
    const nodeScale = node.worldScale || new Vec3(1, 1, 1);
    const sx = Number.isFinite(nodeScale.x) && Math.abs(nodeScale.x) > 1e-8 ?
        Math.abs(nodeScale.x) : 1;
    const sy = Number.isFinite(nodeScale.y) && Math.abs(nodeScale.y) > 1e-8 ?
        Math.abs(nodeScale.y) : 1;
    try {
        if (onCanvas) {
            Gizmos2D.beginLayer(node, Layers.Enum.UI_2D);
            Gizmos2D.beginLocalPosition(node);
        } else {
            Gizmos3D.setDepTest(node, false);
        }
        for (const field of fields) {
            if (!field || typeof field.property !== 'string') continue;
            const local = readField(component, field);
            if (!local) continue;
            const world = spaceFor(component, field).toWorld(local);
            if (!validPoint(world)) continue;
            const diameter = markerSize(world);
            const radius = diameter * 0.4;
            const color = new Color(255, 190, 40, 255);
            if (typeof field.color === 'string' && typeof Color.fromHEX === 'function') {
                Color.fromHEX(color, field.color);
            }
            if (onCanvas) {
                const at = new Vec3();
                node.inverseTransformPoint(at, new Vec3(world.x, world.y, world.z));
                Gizmos2D.beginColor(node, Color.BLACK);
                Gizmos2D.drawSolidEllipse(node, at, radius * 1.12 / sx, radius * 1.12 / sy);
                Gizmos2D.beginColor(node, color);
                Gizmos2D.drawSolidEllipse(node, at, radius / sx, radius / sy);
            } else {
                Gizmos3D.beginColor(node, color);
                Gizmos3D.drawSphere(node, new Vec3(world.x, world.y, world.z),
                    radius, false, 12, 8);
            }
        }
    } finally {
        if (onCanvas) {
            Gizmos2D.endLocalPosition(node);
            Gizmos2D.beginLayer(node, Gizmos2D.DEFAULT_LAYER);
            Gizmos2D.beginColor(node, Gizmos2D.DEFAULT_COLOR);
        } else {
            Gizmos3D.setDepTest(node, true);
            Gizmos3D.beginColor(node, Gizmos3D.DEFAULT_COLOR);
        }
    }
}

/**
 * HUD hit geometry must be a screen-facing quad, not a stretched BoxCollider
 * cube. The same viewport rectangle is used for drawing, hit-test and picking.
 */
function createHudPickingQuad(): HudPickingQuad | null {
    const parent = cceNamespace()?.Gizmo?.gizmoRootNode;
    if (!parent?.isValid || typeof Node !== 'function' ||
        typeof MeshRenderer !== 'function' ||
        typeof utils?.createMesh !== 'function') return null;
    let node: Node | null = null;
    let material: Material | null = null;
    let mesh: Mesh | null = null;
    try {
        node = new Node('CocosGizmosHudHit');
        node.layer = Layers.Enum.GIZMOS;
        node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
        parent.addChild(node);
        const renderer = node.addComponent(MeshRenderer);
        material = new Material();
        material.initialize({
            effectName: 'builtin-unlit', technique: 1,
            states: {
                depthStencilState: { depthTest: false, depthWrite: false },
                rasterizerState: { cullMode: gfx.CullMode.NONE },
            },
        });
        material.setProperty('mainColor', new Color(255, 255, 255, 0));
        renderer.setMaterial(material, 0);
        mesh = utils.createMesh({
            positions: [-0.5, -0.5, 0, -0.5, 0.5, 0,
                0.5, 0.5, 0, 0.5, -0.5, 0],
            indices: [0, 3, 1, 3, 2, 1],
        }, undefined, { calculateBounds: true });
        renderer.mesh = mesh;
        return { node, renderer, material, mesh };
    } catch (error) {
        console.warn('[cocos-gizmos/hud] HUD picking quad unavailable:', error);
        mesh?.destroy();
        material?.destroy();
        if (node?.isValid) node.destroy();
        return null;
    }
}
function disposeHudPickingQuad(picking?: HudPickingQuad | null): void {
    if (!picking) return;
    if (picking.renderer.isValid) picking.renderer.mesh = null;
    picking.mesh.destroy();
    picking.material.destroy();
    if (picking.node.isValid) picking.node.destroy();
}

function createEditorGizmo(
    base: any, allowHud: (component: Component) => boolean,
    input: GizmoInputDiagnostics,
    hudLayout?: GizmoHudLayout,
): any {
    return class PositionHandleEditorGizmo extends base {
        private entries: Entry[] = [];
        private hudEntries: HudEntry[] = [];
        private drag: DragState | null = null;
        private hudDrag: HudDrag | null = null;
        private pendingClick: HudEntry | null = null;
        private shown = false;
        private destroyed = false;
        private beforeDrawRegistered = false;
        private readonly beforeDraw = (): void => {
            if (!this.shown || this.destroyed) return;
            // Re-project during Scene scroll, before native controller raycast.
            this.updateMarkers();
        };
        private layout = '';
        private readonly registeredControllers = new WeakSet<object>();
        private readonly unavailableMarkers = new WeakSet<object>();

        private hideUnavailableMarker(controller: any): void {
            if (!controller || this.unavailableMarkers.has(controller)) return;
            this.unregisterController(controller);
            controller.hide?.();
            this.unavailableMarkers.add(controller);
        }

        private restoreMarker(controller: any): void {
            if (!this.shown || !controller || !this.unavailableMarkers.has(controller)) return;
            this.unavailableMarkers.delete(controller);
            controller.show?.();
            this.registerController(controller);
        }

        /** Creator may hide the cube MeshRenderer while keeping the Gizmo instance. */
        private ensureMarkerVisible(controller: any): void {
            const cube = controller?._cubeNode;
            if (!cube || cube.isValid === false || this.unavailableMarkers.has(controller)) return;
            // HUD quads stay invisible; the BoxCollider cube must never cover
            // the HUD or steal mouse hits from its screen-aligned picker.
            if (this.hudEntries.some(entry => entry.controller === controller && entry.picking)) return;
            cube.active = true;
            if (controller._cubeNodeMR?.isValid !== false && controller._cubeNodeMR) {
                controller._cubeNodeMR.enabled = true;
            }
        }

        private hasDestroyedMarkers(): boolean {
            return [...this.entries, ...this.hudEntries].some(({ controller }) =>
                !controller?._cubeNode || controller._cubeNode.isValid === false) ||
                this.hudEntries.some(({ picking }) => picking && picking.node.isValid === false);
        }

        private registerController(controller: any): void {
            if (!this.shown || !controller || this.registeredControllers.has(controller)) return;
            controller.registerEvents?.();
            this.registeredControllers.add(controller);
        }

        private unregisterController(controller: any): void {
            if (!controller || !this.registeredControllers.has(controller)) return;
            this.registeredControllers.delete(controller);
            controller.unregisterEvents?.();
        }

        private closeControl(property: string, index: number | undefined, cancelled: boolean): void {
            if (cancelled && typeof this.onControlCancel === 'function') {
                this.onControlCancel(property, index);
            } else {
                this.onControlEnd?.(property, index);
            }
        }

        public init(): void {
            this.destroyed = false;
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
            const raw = hudLayout ? hudLayout.get(component)?.controls || [] :
                normalizeHudControls(component.onGizmoHudControls?.());
            return raw.filter((control) =>
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
                controls: hudControlLayoutSignature(controls),
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
                    controller.setOpacity?.(255);
                    // Use only the standalone cube. BoxController's editable face
                    // handles require private topNode state and crash on 3.8.8.
                    if (controller._wireFrameBoxNode) controller._wireFrameBoxNode.active = false;
                    if (controller._wireFrameBoxMeshRenderer) controller._wireFrameBoxMeshRenderer.enabled = false;
                    if (controller._editHandlesShape) controller._editHandlesShape.active = false;
                    if (!controller._cubeNode || typeof controller.initHandle !== 'function') {
                        throw new Error('Standalone position marker is unavailable');
                    }
                    applyGizmoLayer(controller._cubeNode);
                    controller._cubeNode.active = true;
                    if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = true;
                    if (controller._handleDataMap?.[key]) controller.removeHandle?.(key);
                    controller.initHandle(controller._cubeNode, key);
                    const down = (event: any) => { input.record('controllerDown'); this.begin(entry, event); };
                    const move = (event: any) => { input.record('controllerMove'); this.move(entry, event); };
                    const up = () => {
                        input.record('controllerUp');
                        // An unrelated controller may receive the same Scene mouse-up.
                        if (this.drag?.entry === entry) this.finish(false);
                        else if (this.drag || this.hudDrag || this.pendingClick)
                            input.record('ignoredUp');
                    };
                    controller.onControllerMouseDown = down;
                    controller.onControllerMouseMove = move;
                    controller.onControllerMouseUp = up;
                    controller.onMouseDown = down;
                    controller.onMouseMove = move;
                    controller.onMouseUp = up;
                    this.registerController(controller);
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
                    const picking = createHudPickingQuad();
                    entry.picking = picking;
                    const color = new Color();
                    if (typeof Color.fromHEX === 'function') Color.fromHEX(color, control.color);
                    else color.set(58, 182, 255, 255);
                    controller.setColor?.(color);
                    // HUD is painted in a texture; its native cube must be
                    // invisible, while remaining enabled for Scene picking.
                    controller.setOpacity?.(0);
                    if (controller._wireFrameBoxNode) controller._wireFrameBoxNode.active = false;
                    if (controller._wireFrameBoxMeshRenderer) controller._wireFrameBoxMeshRenderer.enabled = false;
                    if (controller._editHandlesShape) controller._editHandlesShape.active = false;
                    if (!controller._cubeNode || typeof controller.initHandle !== 'function') {
                        throw new Error('Standalone HUD marker is unavailable');
                    }
                    applyGizmoLayer(controller._cubeNode);
                    if (picking) {
                        // Keep the controller shape active for move/up dispatch,
                        // but let the actual mesh quad receive HUD pointer hits.
                        if (controller.shape) controller.shape.active = true;
                        controller._cubeNode.active = false;
                        if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = false;
                    } else {
                        controller._cubeNode.active = true;
                        if (controller._cubeNodeMR) controller._cubeNodeMR.enabled = true;
                    }
                    controller.initHandle(picking?.node || controller._cubeNode, key);
                    const down = (event: any) => { input.record('controllerDown'); this.beginHud(entry, event); };
                    const move = (event: any) => { input.record('controllerMove'); this.moveHud(entry, event); };
                    const up = (event: any) => {
                        input.record('controllerUp');
                        if (this.hudDrag?.entry === entry) this.finishHud(false);
                        else if (this.pendingClick === entry) {
                            const releasedOn = readSceneHandleName(event);
                            this.finishHud(!!releasedOn && releasedOn !== entry.key);
                        } else if (this.drag || this.hudDrag || this.pendingClick) {
                            input.record('ignoredUp');
                        }
                    };
                    controller.onControllerMouseDown = down;
                    controller.onControllerMouseMove = move;
                    controller.onControllerMouseUp = up;
                    controller.onMouseDown = down;
                    controller.onMouseMove = move;
                    controller.onMouseUp = up;
                    this.registerController(controller);
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
            if (!this.drag && !this.hudDrag && !this.pendingClick &&
                (this.hasDestroyedMarkers() || this.signature(fields, controls) !== this.layout)) {
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
                    this.hideUnavailableMarker(entry.controller);
                    continue;
                }
                const world = spaceFor(component, entry.field).toWorld(local);
                if (!validPoint(world)) {
                    this.hideUnavailableMarker(entry.controller);
                    continue;
                }
                this.restoreMarker(entry.controller);
                this.ensureMarkerVisible(entry.controller);
                entry.controller.setPosition?.(new Vec3(world.x, world.y, world.z));
                entry.controller.setRotation?.(new Quat());
                const size = markerSize(world);
                setMarkerSize(entry.controller, size);
            }
            if (!this.hudEntries.length) return;
            const view = camera();
            if (typeof view?.worldToScreen !== 'function' ||
                typeof view?.screenPointToRay !== 'function') {
                for (const entry of this.hudEntries) this.hideUnavailableMarker(entry.controller);
                return;
            }
            view.sync?.();
            const projection = (view.viewport && createViewportHudProjection(view)) ||
                createSceneHudProjection(view, component.node.worldPosition);
            if (!projection) {
                for (const entry of this.hudEntries) this.hideUnavailableMarker(entry.controller);
                return;
            }
            const placement = hudLayout?.get(component);
            const textCount = placement ? placement.textCount :
                normalizeHudItems(component.onGizmoHud?.()).length;
            const startRow = placement?.startRow || 0;
            // A HUD row is 22 screen pixels tall. Keep its picking cube about
            // 14 pixels wide; multiplying a 10px world size by 14 creates a
            // ~140px hit box overlapping adjacent buttons and sliders.
            const size = Math.max(1e-8, projection.pixelSize * 14);
            for (const entry of this.hudEntries) {
                this.restoreMarker(entry.controller);
                this.ensureMarkerVisible(entry.controller);
                const row = hudRowScreenPosition(
                    projection.screen, startRow + textCount + entry.index,
                    projection.viewport, hudLayout?.totalRows);
                // Cover the whole HUD control row instead of a tiny 14px
                // dot. Cocos Gizmo Kit similarly uses invisible handle quads.
                const grid = projection.viewport ?
                    hudGrid(projection.viewport,
                        Math.max(hudLayout?.totalRows || 0, startRow + textCount +
                            this.hudEntries.length)) : null;
                const rect = projection.viewport && grid ?
                    hudControlScreenRect(projection.viewport,
                        startRow + textCount + entry.index,
                        hudLayout?.totalRows || startRow + textCount +
                            this.hudEntries.length) : null;
                const hitWidth = rect ? rect.width : 14;
                const centerX = rect ? (rect.left + rect.right) * 0.5 : row.x - 14;
                const centerY = rect ? (rect.bottom + rect.top) * 0.5 : row.y;
                const world = projection.worldAt(centerX, centerY);
                if (entry.picking && entry.picking.node.isValid && rect) {
                    entry.picking.node.active = true;
                    entry.picking.node.setWorldPosition(world);
                    const rotation = view.node?.worldRotation;
                    if (rotation) entry.picking.node.setWorldRotation(rotation);
                    entry.picking.node.setWorldScale(new Vec3(
                        projection.pixelSize * hitWidth,
                        projection.pixelSize * rect.height, 1));
                    // HUD cube stays invisible. Only the accurately projected
                    // transparent plane participates in native Scene raycast.
                } else {
                    entry.controller.setPosition?.(world);
                    setMarkerSize(entry.controller,
                        rect ? projection.pixelSize * hitWidth : size,
                        rect ? projection.pixelSize * rect.height : size,
                        rect ? projection.pixelSize * 6 : size);
                }
            }
        }

        private beginHud(entry: HudEntry, event: any): void {
            if (!this.shown || this.drag || this.hudDrag || this.pendingClick) return;
            const handleName = readSceneHandleName(event);
            if (handleName && handleName !== entry.key) return;
            const component = this.target as Component;
            if (entry.control.type !== 'slider') {
                this.pendingClick = entry;
                return;
            }
            const current = (component as any)[entry.control.property];
            const at = readScenePointer(event);
            if (!at) { input.record('missingPointer'); return; }
            if (!Number.isFinite(current)) return;
            try {
                const solver = new HudSliderDrag(entry.control, current, at.x);
                const property = entry.control.property;
                const session = new GizmoEditSession<number>(
                    () => (component as any)[property],
                    (value) => { (component as any)[property] = value; },
                    {
                        begin: (value) => {
                            this.onControlBegin?.(property);
                            try { component.onGizmoHudChanged?.(property, 'begin', value); }
                            catch (error) {
                                this.closeControl(property, undefined, true);
                                throw error;
                            }
                        },
                        update: (value) => {
                            component.onGizmoHudChanged?.(property, 'update', value);
                            this.onControlUpdate?.(property);
                            this.onComponentChanged?.(component.node);
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        rollback: () => {
                            this.onComponentChanged?.(component.node);
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        end: (value, cancelled, changed) => {
                            try {
                                component.onGizmoHudChanged?.(
                                    property, cancelled ? 'cancel' : 'end', value);
                            } finally {
                                this.closeControl(property, undefined, cancelled || !changed);
                                this.updateMarkers();
                            }
                        },
                    },
                );
                session.begin();
                this.hudDrag = { entry, solver, session };
            } catch (error) {
                console.warn('[cocos-gizmos/hud] Cannot begin slider drag:', error);
            }
        }

        private moveHud(entry: HudEntry, event: any): void {
            const drag = this.hudDrag;
            if (!drag || drag.entry !== entry || drag.entry.control.type !== 'slider') return;
            const at = readScenePointer(event);
            if (!at) return;
            const next = drag.solver.move(at.x);
            if (next === null) return;
            try { drag.session.apply(next); }
            catch (error) {
                try { this.finishHud(true); }
                finally { console.warn('[cocos-gizmos/hud] Slider edit cancelled:', error); }
            }
        }

        private finishHud(cancelled: boolean): void {
            const click = this.pendingClick;
            this.pendingClick = null;
            const component = this.target as Component;
            if (click) {
                input.record(cancelled ? 'cancelledClick' : 'committedClick');
            }
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
                        const property = control.property;
                        const session = new GizmoEditSession<boolean>(
                            () => (component as any)[property],
                            (next) => { (component as any)[property] = next; },
                            {
                                begin: (initial) => {
                                    this.onControlBegin?.(property);
                                    try { component.onGizmoHudChanged?.(property, 'begin', initial); }
                                    catch (error) {
                                        this.closeControl(property, undefined, true);
                                        throw error;
                                    }
                                },
                                update: (next) => {
                                    component.onGizmoHudChanged?.(property, 'update', next);
                                    this.onControlUpdate?.(property);
                                    this.onComponentChanged?.(component.node);
                                    cceNamespace()?.Engine?.repaintInEditMode?.();
                                },
                                rollback: () => this.onComponentChanged?.(component.node),
                                end: (next, cancelled, changed) => {
                                    try {
                                        component.onGizmoHudChanged?.(
                                            property, cancelled ? 'cancel' : 'end', next);
                                    } finally {
                                        this.closeControl(property, undefined, cancelled || !changed);
                                    }
                                },
                            },
                        );
                        session.begin();
                        try {
                            session.apply(!value);
                            session.finish();
                        } catch (error) {
                            session.finish(true);
                            throw error;
                        }
                    }
                }
                this.updateMarkers();
            }
            const drag = this.hudDrag;
            this.hudDrag = null;
            if (!drag || drag.entry.control.type !== 'slider') return;
            drag.session.finish(cancelled);
        }

        private begin(entry: Entry, event: any): void {
            if (!this.shown || this.drag || this.hudDrag || this.pendingClick) return;
            const handleName = readSceneHandleName(event);
            if (handleName && handleName !== entry.key) return;
            const view = readScenePointer(event);
            const ray = view && sceneRay(view);
            if (!ray) { input.record('missingPointer'); return; }
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
                const property = entry.field.property;
                const index = entry.field.index;
                const session = new GizmoEditSession<Point>(
                    () => readField(target, entry.field) as Point,
                    (value) => {
                        if (!writeField(target, entry.field, value)) {
                            throw new Error('Position handle property is no longer editable');
                        }
                    },
                    {
                        begin: () => {
                            this.onControlBegin?.(property, index);
                            try { target.onGizmoChanged?.(property, 'begin', index); }
                            catch (error) {
                                this.closeControl(property, index, true);
                                throw error;
                            }
                        },
                        update: () => {
                            target.onGizmoChanged?.(property, 'update', index);
                            this.onControlUpdate?.(property, index);
                            this.onComponentChanged?.(target.node);
                            this.updateMarkers();
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        rollback: () => {
                            this.onComponentChanged?.(target.node);
                            cceNamespace()?.Engine?.repaintInEditMode?.();
                        },
                        end: (_value, cancelled, changed) => {
                            try {
                                target.onGizmoChanged?.(
                                    property, cancelled ? 'cancel' : 'end', index);
                            } finally {
                                this.closeControl(property, index, cancelled || !changed);
                                this.updateMarkers();
                            }
                        },
                    },
                );
                session.begin();
                this.drag = { entry, solver, session };
            } catch (error) {
                console.warn('[cocos-gizmos/handles] Unable to start position drag:', error);
            }
        }

        private move(entry: Entry, event: any): void {
            const drag = this.drag;
            if (!drag || drag.entry !== entry) return;
            const view = readScenePointer(event);
            const ray = view && sceneRay(view);
            if (!ray) return;
            const next = drag.solver.move(ray);
            if (!next) return;
            try { drag.session.apply(next); }
            catch (error) {
                try { this.finish(true); }
                finally { console.warn('[cocos-gizmos/handles] Position edit cancelled:', error); }
            }
        }

        private finish(cancelled: boolean): void {
            const drag = this.drag;
            if (!drag) return;
            this.drag = null;
            drag.session.finish(cancelled);
        }

        public onGizmoMouseDown(event: any): void {
            input.record('gizmoDown');
            const name = readSceneHandleName(event);
            const entry = this.entries.find((item) => item.key === name);
            if (entry) this.begin(entry, event);
            const hud = this.hudEntries.find((item) => item.key === name);
            if (hud) this.beginHud(hud, event);
        }

        public onGizmoMouseMove(event: any): void {
            input.record('gizmoMove');
            if (this.drag) this.move(this.drag.entry, event);
            if (this.hudDrag) this.moveHud(this.hudDrag.entry, event);
        }

        public onGizmoMouseUp(event?: any): void {
            input.record('gizmoUp');
            // The Scene Operation route may include a named picking target.
            // A different target must not activate a pending HUD button.
            const click = this.pendingClick;
            const releasedOn = readSceneHandleName(event);
            const clickCancelled = !!click && !!releasedOn && releasedOn !== click.key;
            this.finish(false);
            this.finishHud(clickCancelled);
        }

        // GizmoOperation dispatches these callbacks to every registered Gizmo
        // on Creator 3.8.8, even when no controller was hit.
        public onNotGizmoMouseDown(): void {
            input.record('outsideDown');
            // A new click outside the Gizmo cancels an unfinished gesture.
            this.finish(true);
            this.finishHud(true);
        }

        public onNotGizmoMouseMove(): void {
            // No pointer capture when the Scene operation is not dragging us.
        }

        public onNotGizmoMouseUp(): void {
            input.record('outsideUp');
            // Releasing outside a handle commits drags but not button clicks.
            this.finish(false);
            this.finishHud(!this.hudDrag);
        }

        public onKeyDown(event: any): boolean | void {
            if ((this.drag || this.hudDrag || this.pendingClick) &&
                (event?.key === 'Escape' || event?.keyCode === 27)) {
                this.finish(true);
                this.finishHud(true);
                return true;
            }
        }

        public isHandleVisible(): boolean { return this.shown; }
        public isHandleDisposed(): boolean { return this.destroyed; }

        public onShow(): void {
            if (this.destroyed) return;
            this.shown = true;
            if (!this.beforeDrawRegistered && typeof director?.on === 'function') {
                director.on(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = true;
            }
            this.refreshHandles();
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                if (!this.unavailableMarkers.has(controller)) {
                    controller.show?.();
                    this.ensureMarkerVisible(controller);
                    this.registerController(controller);
                }
            }
            this.updateMarkers();
        }

        public onHide(): void {
            if (this.beforeDrawRegistered) {
                director.off(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = false;
            }
            for (const entry of this.hudEntries) {
                if (entry.picking?.node?.isValid) entry.picking.node.active = false;
            }
            this.finish(true);
            this.finishHud(true);
            this.shown = false;
            for (const { controller } of [...this.entries, ...this.hudEntries]) {
                this.unregisterController(controller);
                controller.hide?.();
            }
        }

        public diagnosticState(): {
            positionHandles: number;
            hudControls: number;
            draggingPosition: boolean;
            draggingSlider: boolean;
            pendingClick: boolean;
        } {
            return {
                positionHandles: this.entries.length,
                hudControls: this.hudEntries.length,
                draggingPosition: !!this.drag,
                draggingSlider: !!this.hudDrag,
                pendingClick: !!this.pendingClick,
            };
        }

        public onTargetUpdate(): void { this.refreshHandles(); }
        public onNodeChanged(): void { this.updateMarkers(); }
        public updateControllerTransform(): void { this.updateMarkers(); }

        private clearEntries(): void {
            for (const { controller, key } of [...this.entries, ...this.hudEntries]) {
                try {
                    this.unregisterController(controller);
                    controller.removeHandle?.(key);
                    controller.hide?.();
                    const hud = this.hudEntries.find(item => item.controller === controller);
                    disposeHudPickingQuad(hud?.picking);
                } catch (error) {
                    // The Editor can destroy a controller during a Scene switch.
                    console.warn('[cocos-gizmos/handles] Discarding a stale controller:', error);
                }
            }
            this.entries.length = 0;
            this.hudEntries.length = 0;
        }

        public onDestroy(): void {
            if (this.beforeDrawRegistered) {
                director.off(Director.EVENT_BEFORE_DRAW, this.beforeDraw);
                this.beforeDrawRegistered = false;
            }
            this.destroyed = true;
            this.finish(true);
            this.finishHud(true);
            this.shown = false;
            this.clearEntries();
        }
    };
}

export interface PositionHandleSceneAdapter {
    refresh(components: readonly Component[], selected: ReadonlySet<string>, now: number): void;
    /** Immediately hide active controllers when the Scene changes or closes. */
    clear(): void;
    dispose(): void;
    status(): {
        registered: number; active: number; reason: string;
        positionHandles: number; hudControls: number;
        draggingPosition: number; draggingSlider: number; pendingClicks: number;
        input: GizmoInputSnapshot;
    };
}

export function createPositionHandleAdapter(
    allowHud: (component: Component) => boolean = () => true,
    hudLayout?: GizmoHudLayout,
): PositionHandleSceneAdapter {
    const registered = new Map<string, any>();
    const active = new Map<Component, any>();
    let gizmoConstructor: any = null;
    let latestScan = -Infinity;
    let lastSelection = new Set<string>();
    let reason = 'not-initialized';
    const input = new GizmoInputDiagnostics();
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
        if (!gizmoConstructor) gizmoConstructor = createEditorGizmo(typeDefs['cc.BoxCollider'], allowHud, input, hudLayout);
        reason = 'ready';
        return true;
    }

    function show(component: Component): any {
        // Explicitly re-activate on every selection entry, including
        // A -> no selection -> A. Merely calling gizmo.show() on the stale
        // component reference does not re-register native Scene operation
        // picking after an empty selection in Creator 3.8.8.
        let gizmo = (component as any).gizmo;
        try {
            manager.showComponentGizmo?.(component);
            const mounted = (component as any).gizmo;
            if (mounted instanceof gizmoConstructor) gizmo = mounted;
        } catch {
            // Use createGizmo when Editor keeps a stale component link.
        }
        if (!(gizmo instanceof gizmoConstructor) || gizmo.isHandleDisposed?.()) {
            gizmo = null;
        }
        if (!gizmo && typeof manager.createGizmo === 'function') {
            for (const key of selectedKeys(component)) {
                try {
                    gizmo = manager.createGizmo(key, component) || (component as any).gizmo;
                    if (gizmo instanceof gizmoConstructor) break;
                } catch {
                    // Some class keys are aliases that the pool does not register.
                }
            }
        }
        if (!(gizmo instanceof gizmoConstructor) || gizmo.isHandleDisposed?.()) return null;
        gizmo.show?.();
        // Some Editor Gizmo implementations do not dispatch onShow when
        // reusing a previously hidden component Gizmo. Restore it explicitly.
        if (gizmo.isHandleVisible?.() === false) gizmo.onShow?.();
        gizmo.refreshHandles?.();
        return gizmo;
    }

    return {
        refresh(components, selected, now) {
            const selectionChanged = selected.size !== lastSelection.size ||
                [...selected].some((id) => !lastSelection.has(id));
            // Paint every Scene tick. 2D Graphics are cleared at lateUpdate,
            // whereas registering native Controller instances can be throttled.
            // A rapid A -> B -> A selection still bypasses the controller scan.
            // Visual markers must not disappear even when the Editor replaces
            // the native component Gizmo or temporarily unmounts its cube.
            for (const component of components) {
                if (component?.isValid && component.enabled &&
                    component.node?.activeInHierarchy &&
                    selected.has(component.node.uuid)) {
                    try { drawSelectedPositionMarkers(component); }
                    catch (error) {
                        console.warn('[cocos-gizmos/handles] Cannot paint position markers:', error);
                    }
                }
            }
            // Native Gizmo discovery and activation are heavier than painting.
            if (!selectionChanged && now - latestScan < 250) return;
            lastSelection = new Set(selected);
            latestScan = now;
            if (!initialize()) return;
            const wanted = new Set<Component>();
            for (const component of components) {
                if (!component?.isValid || !component.enabled || !component.node?.activeInHierarchy ||
                    !selected.has(component.node.uuid) ||
                    (typeof component.onGizmoHandles !== 'function' &&
                     (typeof component.onGizmoHudControls !== 'function' ||
                      (hudLayout && !hudLayout.get(component))))) continue;
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
                if (previous) {
                    // Creator can replace component.gizmo while the adapter still
                    // holds the previous instance after an A -> B -> A selection.
                    if (previous !== (component as any).gizmo ||
                        previous.isHandleDisposed?.() ||
                        previous.isHandleVisible?.() === false) {
                        const restored = show(component);
                        if (restored) active.set(component, restored);
                        else active.delete(component);
                    } else previous.refreshHandles?.();
                } else {
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
        clear() {
            for (const gizmo of active.values()) gizmo.hide?.();
            active.clear();
            lastSelection.clear();
            latestScan = -Infinity;
        },
        dispose() {
            for (const gizmo of active.values()) gizmo.hide?.();
            active.clear();
            for (const [key, ctor] of registered) {
                if (typeDefs?.[key] === ctor) delete typeDefs[key];
            }
            registered.clear();
            lastSelection.clear();
            manager = null;
            typeDefs = null;
            latestScan = -Infinity;
            reason = 'disposed';
        },
        status() {
            const counts = {
                positionHandles: 0, hudControls: 0,
                draggingPosition: 0, draggingSlider: 0, pendingClicks: 0,
            };
            for (const gizmo of active.values()) {
                const info = gizmo.diagnosticState?.();
                if (!info) continue;
                counts.positionHandles += info.positionHandles;
                counts.hudControls += info.hudControls;
                if (info.draggingPosition) counts.draggingPosition++;
                if (info.draggingSlider) counts.draggingSlider++;
                if (info.pendingClick) counts.pendingClicks++;
            }
            return { registered: registered.size, active: active.size, reason, ...counts,
                input: input.snapshot() };
        },
    };
}
