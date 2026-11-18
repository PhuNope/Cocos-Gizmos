import { Component } from 'cc';
import {
    Point, Field, camera, validPoint, sceneRay, spaceFor, readField,
    writeField, handleWorldOrigin, markerSize, axisPlacement,
    rotationPlacement, rotationFrame, isCanvas2D, rotationScreenFallback,
} from './GizmoViewportGeometry';
import { drawSelectedPositionMarkers, setSelectedHandleHover } from './GizmoHandleRenderer';
import { hitTestHandle, hitTestHud, HandleHitTarget, HudHitTarget } from './GizmoHitTest';
import { handlePlaneNormal } from './PositionDragSolver';
import { axisDragNormal } from './AxisHandleGeometry';
import { GizmoCommands } from './GizmoCommandBuilder';
import { GizmoMoveCommand } from './GizmoMoveCommand';
import { GizmoRotateCommand } from './GizmoRotateCommand';
import { RotateAxis } from './RotationHandleGeometry';
import { GizmoEditSession } from './GizmoEditSession';
import { HudControl, HudSliderDrag, hudSliderScreenTrack,
    normalizeHudControls } from './GizmoHudControls';
import type { GizmoHudLayout, GizmoHudPlacement } from './GizmoHudLayout';
import {
    GizmoInputDiagnostics, GizmoInputSnapshot, readScenePointer,
    readSceneHandleName, isPrimaryScenePointer,
} from './SceneGizmoInput';
import { tickOnce as repaintWholeScene } from './ExecuteGizmos';
import { SceneSelectionLease, consumeOwnedSceneEvent } from './SceneSelectionLease';
import { hudControlScreenRect } from './GizmoHudControls';
import { SceneViewportInput, SceneViewportInputPorts, ViewportPointer } from './SceneViewportInput';
import { SceneEngineInput } from './SceneEngineInput';
import { SceneOperationInput } from './SceneOperationInput';
import { connectSceneHudInput } from './SceneHudElement';

type Drag = { entry: HandleHitTarget; command: GizmoMoveCommand | GizmoRotateCommand };
type SliderDrag = { entry: HudHitTarget; solver: HudSliderDrag; session: GizmoEditSession<number> };

/** One active gesture across selected components: GizmoOperation emits
 * operation-level callbacks to all registered SelectGizmos.
 */
let captured: object | null = null;
let lastImmediateRepaint=0;

function requestSceneRepaint(hoverTransition = false): void {
    // Do not coalesce hover transitions: a pointer can enter and exit a
    // narrow 2D handle in <32ms, and the exit must clear the previous color
    // in the very next Scene paint. Expensive drag value updates still coalesce.
    const now=Date.now();
    if(hoverTransition || now-lastImmediateRepaint>=32){
        lastImmediateRepaint=now;
        try{repaintWholeScene();}
        catch { /* Scene may close between events */ }
    }
    try{
        const global=globalThis as any;
        (global.cce||global.window?.cce)?.Engine?.repaintInEditMode?.();
    }catch { /* Scene process detaching */ }
}

const selectedKeys = (component: Component): string[] => {
    const value: any=component;
    // Prefer Creator's registered class name. A generic JS constructor name
    // (Object/Component) must never be installed into the global Gizmo pool.
    const explicit=[value.__classname__,value.constructor?.__classname__]
        .filter((v): v is string=>typeof v==='string'&&!!v.trim());
    const fallback=value.constructor?.name;
    const names=explicit.length?explicit:
        typeof fallback==='string'&&fallback.length>0&&
        fallback!=='Object'&&fallback!=='Component'?[fallback]:[];
    const out=new Set<string>();
    for(const name of names) {
        out.add(name);
        if(!name.includes('.'))out.add('cc.'+name);
    }
    return [...out];
};

function isSelectable(component: Component): boolean {
    return !!component?.isValid && !!component.node?.isValid &&
        component.enabled !== false && component.node.activeInHierarchy !== false;
}

/** Resolve the public SelectGizmo superclass by shape, not by assuming a
 * physics component name. The v3 Editor 3.8.8 types show every component
 * Gizmo inherits SelectGizmo; this avoids inheriting BoxColliderComponentGizmo.
 */
export function resolveSelectGizmo(typeDefs: Record<string, unknown>): any | null {
    for (const value of Object.values(typeDefs || {})) {
        if(typeof value!=='function') continue;
        let parent: any=Object.getPrototypeOf(value);
        for(let depth=0;depth<5 && typeof parent==='function';depth++) {
            const proto=parent.prototype;
            if(typeof proto?.show==='function' &&
                typeof proto?.hide==='function' &&
                typeof proto?.getCompPropPath==='function' &&
                typeof proto?.onControlBegin==='function') return parent;
            parent=Object.getPrototypeOf(parent);
        }
    }
    return null;
}

/**
 * Last-resort editor-independent input host. The Editor's private Gizmo pool
 * may differ between 3.8.x builds; pointer interaction should not disappear
 * just because its SelectGizmo base cannot be discovered. This fallback is
 * intentionally NOT an Undo adapter: status() reports the limitation.
 */
class StandaloneGestureHost {
    public target: Component | null;
    public shouldRegisterGizmoOperationEvent = false;
    constructor(component: Component | null) { this.target=component; }
    public show(): void { (this as any).onShow?.(); }
    public hide(): void { (this as any).onHide?.(); }
    public destroy(): void { (this as any).onDestroy?.(); }
    public getCompPropPath(property: string): string { return property; }
    public onControlBegin(_property: string): void {}
    public onControlUpdate(_property: string): void {}
    public onControlEnd(_property: string): void {}
    public onComponentChanged(_node: any): void {}
}

function createSelectHandleGizmo(
    base: any, input: GizmoInputDiagnostics,
    allowHud: (component: Component) => boolean,
    hudLayout?: GizmoHudLayout,
    selectionLease?: SceneSelectionLease,
): any {
    return class CocosGizmosSelectHandles extends base {
        private shown=false;
        private disposed=false;
        private fields: HandleHitTarget[]=[];
        private controls: HudHitTarget[]=[];
        private moveDrag: Drag | null=null;
        private sliderDrag: SliderDrag | null=null;
        private buttonDown: HudHitTarget | null=null;
        private hudDownRect: {left:number;right:number;bottom:number;top:number} | null=null;
        private hover: string | null=null;
        private lastPaint=0;
        private deferredHide=false;
        private suppressedLifecycleCancels=0;

        /** Editor 3.8.8 may re-evaluate SelectGizmo visibility synchronously
         * from onControlUpdate/onComponentChanged while the pointer is DOWN.
         * Visibility callbacks must not end an application edit session.
         * Only mouse-up, Escape, or explicit Scene teardown may do so.
         */
        public hasActiveGesture(): boolean {
            return captured===this && !!(this.moveDrag||this.sliderDrag||this.buttonDown);
        }

        public cancelGestureForTeardown(): void {
            selectionLease?.clear();
            this.deferredHide=false;
            try { this.finishHandle(true); }
            finally { this.finishHud(true); }
        }

        public hide(): void {
            if(this.hasActiveGesture() && isSelectable(this.target as Component)){
                this.deferredHide=true;
                this.suppressedLifecycleCancels++;
                return;
            }
            super.hide();
        }

        public destroy(): void {
            if(this.hasActiveGesture() && isSelectable(this.target as Component)){
                this.deferredHide=true;
                this.suppressedLifecycleCancels++;
                return;
            }
            super.destroy();
        }

        constructor(...args: any[]) {
            super(...args);
            this.shouldRegisterGizmoOperationEvent=true;
        }

        public init(): void {
            this._isInitialized=true;
            this.refreshHandles();
        }

        private component(): Component | null {
            const target=this.target as Component | null;
            return isSelectable(target as Component) ? target : null;
        }

        private placement(): GizmoHudPlacement | null {
            const component=this.component();
            return component && hudLayout ? hudLayout.get(component) : null;
        }

        private setHover(entry: HandleHitTarget | null): void {
            const name=entry?.key||null;
            if(name===this.hover)return;
            this.hover=name;
            const component=this.component();
            if(component) setSelectedHandleHover(component,name);
            if(this.shown) requestSceneRepaint(true);
        }

        public refreshHandles(): void {
            const component=this.component();
            if(!component){this.fields=[];this.controls=[];return;}
            let raw: unknown=[];
            try { raw=component.onGizmoHandles?.() || []; }
            catch(error) { console.warn('[cocos-gizmos/handles] descriptors:',error); }
            this.fields=Array.isArray(raw) ? raw.filter((field: any) => field &&
                typeof field.property==='string' &&
                /^(xy|xz|yz|view)$/.test(field.plane||'xy') &&
                (field.index===undefined || Number.isInteger(field.index)&&field.index>=0) &&
                readField(component,field)!==null &&
                (!field.pivotProperty || validPoint((component as any)[field.pivotProperty])) &&
                (!field.visual || ['point','axis','plane','box','rotation'].includes(field.visual)) &&
                (field.visual!=='axis'||['x','y','z'].includes(field.axis))
            ).map((field: Field) => ({
                key:'position:'+field.property+':'+(field.index??'single')+
                    (field.id?':'+field.id:''),
                field,
            })) : [];
            const controls=allowHud(component) ?
                (this.placement()?.controls ||
                 normalizeHudControls(component.onGizmoHudControls?.())) : [];
            this.controls=controls.filter((control) =>
                control.type==='button' ||
                (control.type==='slider' ?
                    typeof (component as any)[control.property]==='number' :
                    typeof (component as any)[control.property]==='boolean')
            ).map((control,index)=>({key:'hud:'+control.id,control,index}));
        }

        private pick(event: any): HandleHitTarget | null {
            const point=readScenePointer(event), component=this.component();
            return point&&component ?
                hitTestHandle(component,this.fields,point,camera()):null;
        }

        private pickHud(event: any): HudHitTarget | null {
            const point=readScenePointer(event), view=camera(),
                placement=this.placement();
            return point&&view?.viewport&&placement ?
                hitTestHud(point,view.viewport,placement,this.controls,
                    hudLayout?.totalRows||0):null;
        }

        private editorPropertyPath(property: string): string {
            // Creator's SelectGizmo receives a serialized Component path,
            // not necessarily the raw TS field name. Resolve it at the
            // boundary; the command/value ports remain Editor-independent.
            try {
                const value=this.getCompPropPath?.(property);
                if(typeof value==='string' && value.length>0)return value;
            } catch { /* A detached Scene may no longer know this Component */ }
            return property;
        }

        private readonly nativeHookWarnings = new Set<string>();

        private safeNativeHook(label: string, action: () => void): void {
            try { action(); }
            catch (error) {
                // The Editor's private SelectGizmo Undo/Inspector hooks differ
                // across Creator 3.8.x variants. A failing optional hook must
                // NEVER throw through a GizmoEditSession update: that turned
                // a valid HUD Slider drag into update -> immediate cancel.
                if (!this.nativeHookWarnings.has(label)) {
                    this.nativeHookWarnings.add(label);
                    console.warn('[cocos-gizmos/v3] Native Editor hook ' +
                        label + ' failed (gesture continues):', error);
                }
            }
        }

        private changed(property: string): void {
            const component=this.component();
            if (!component) return;
            const path=this.editorPropertyPath(property);
            this.safeNativeHook('update:'+property,()=>
                this.onControlUpdate?.(path));
            this.safeNativeHook('component:'+property,()=>
                this.onComponentChanged?.(component.node));
            requestSceneRepaint();
        }

        private beginEdit(property: string): void {
            const path=this.editorPropertyPath(property);
            this.safeNativeHook('begin:'+property,()=>
                this.onControlBegin?.(path));
        }

        private endEdit(property: string, cancelled: boolean): void {
            const path=this.editorPropertyPath(property);
            this.safeNativeHook('end:'+property,()=>{
                if(cancelled && typeof this.onControlCancel==='function')
                    this.onControlCancel(path);
                else this.onControlEnd?.(path);
            });
        }

        private startHandle(entry: HandleHitTarget, event: any): void {
            if(captured || this.moveDrag || this.sliderDrag || this.buttonDown) return;
            const point=readScenePointer(event);
            const ray=point&&sceneRay(point), component=this.component();
            if(!ray || !component || !point)return;
            const original=readField(component,entry.field);
            if(!original)return;
            const world=handleWorldOrigin(component,entry.field,original);
            const pixel=markerSize(world)/22;
            const ring=rotationPlacement(component,entry.field,original,world,pixel);
            const space=spaceFor(component,entry.field);
            const axis=axisPlacement(component,entry.field,original,world,pixel);
            const view=camera();
            const normal=ring?.normal || (axis ?
                axisDragNormal(axis.unit,view?.node?.forward||ray.d) :
                handlePlaneNormal(entry.field.plane||'xy',space,original,
                    view?.node?.forward||ray.d));
            if(!normal)return;
            const property=entry.field.property, index=entry.field.index;
            const port={
                read:()=>readField(component,entry.field) as Point,
                write:(value:Point)=>{
                    if(!writeField(component,entry.field,value))
                        throw new Error('Gizmo property is no longer editable');
                },
            };
            const hooks={
                begin:()=>{
                    this.beginEdit(property);
                    try { component.onGizmoChanged?.(property,'begin',index); }
                    catch(error){this.endEdit(property,true);throw error;}
                },
                update:()=>{
                    component.onGizmoChanged?.(property,'update',index);
                    this.changed(property);
                },
                rollback:()=>this.changed(property),
                end:(_value:Point,cancelled:boolean,changed:boolean)=>{
                    try { component.onGizmoChanged?.(
                        property,cancelled?'cancel':'end',index); }
                    finally {this.endEdit(property,cancelled||!changed);}
                },
            };
            try {
                const command=ring ?
                    GizmoCommands.rotate()
                        .initial(original).pivot(ring.center).axisNormal(ring.normal)
                        .frame(rotationFrame(component))
                        .constraints({
                            axis:entry.field.axis as RotateAxis,
                            space:entry.field.space==='world'?'world':'local',
                            snap:entry.field.snap,twoD:isCanvas2D(component.node),
                        })
                        .value(port).hooks(hooks)
                        .screenFallback(rotationScreenFallback(ring,view))
                        .build() :
                    GizmoCommands.move()
                        .initial(original).space(space).planeNormal(normal)
                        .constraints(entry.field).value(port).hooks(hooks).build();
                // Arm capture BEFORE begin(). Native onControlBegin can
                // synchronously request a Gizmo visibility rebuild.
                this.moveDrag={entry,command}; captured=this;
                selectionLease?.begin(component.node.uuid);
                if(ring ? !command.begin(ray,point):!command.begin(ray)){
                    this.moveDrag=null;
                    if(captured===this)captured=null;
                    selectionLease?.clear();
                    return;
                }
                this.setHover(entry);
            } catch(error) {
                // A failed begin cannot leave a phantom captured Gizmo.
                this.finishHandle(true);
                console.warn('[cocos-gizmos/handles] Begin failed:',error);
            }
        }

        private startHud(entry: HudHitTarget,event:any):void {
            if(captured || this.sliderDrag || this.buttonDown || this.moveDrag)return;
            const component=this.component();
            if(!component)return;
            const control=entry.control;
            const point=readScenePointer(event), view=camera();
            const placement=this.placement();
            if(!point || !view?.viewport || !placement)return;
            if(control.type!=='slider'){
                const row=placement.startRow+placement.textCount+entry.index;
                this.hudDownRect=hudControlScreenRect(view.viewport,row,
                    hudLayout?.totalRows||0,control.size);
                this.buttonDown=entry;captured=this;
                selectionLease?.begin(component.node.uuid);
                return;
            }
            const value=(component as any)[control.property];
            if(!point||!Number.isFinite(value))return;
            const track=view?.viewport&&placement ?
                hudSliderScreenTrack(view.viewport,
                    placement.startRow+placement.textCount+entry.index,
                    hudLayout?.totalRows||0,control.width,control.size):null;
            const onTrack=!!track&&point.x>=track.left&&
                point.x<=track.left+track.width;
            try {
                const solver=new HudSliderDrag(control,value,point.x,
                    track?.width,onTrack ? track!.left:undefined);
                const property=control.property;
                const session=new GizmoEditSession<number>(
                    ()=> (component as any)[property],
                    next=>{(component as any)[property]=next;},
                    {
                        begin:(initial)=>{
                            this.beginEdit(property);
                            try{component.onGizmoHudChanged?.(property,'begin',initial);}
                            catch(error){this.endEdit(property,true);throw error;}
                        },
                        update:(next)=>{
                            component.onGizmoHudChanged?.(property,'update',next);
                            this.changed(property);
                        },
                        rollback:()=>this.changed(property),
                        end:(next,cancelled,changed)=>{
                            try{component.onGizmoHudChanged?.(property,
                                cancelled?'cancel':'end',next);}
                            finally{this.endEdit(property,cancelled||!changed);}
                        },
                    },
                );
                // begin() also calls native onControlBegin and can trigger
                // an immediate Editor visibility refresh.
                this.sliderDrag={entry,solver,session};captured=this;
                selectionLease?.begin(component.node.uuid);
                session.begin();
                if(onTrack){const next=solver.move(point.x);if(next!==null)session.apply(next);}
            }catch(error){
                console.warn('[cocos-gizmos/hud] Slider begin failed:',error);
                this.finishHud(true);
            }
        }

        private moveInput(event:any):void {
            if(captured && captured!==this)return;
            const point=readScenePointer(event);
            if(!point)return;
            if(this.moveDrag){
                const ray=sceneRay(point);
                if(!ray)return;
                try {
                    if(this.moveDrag.entry.field.visual==='rotation')
                        (this.moveDrag.command as GizmoRotateCommand).update(ray,point);
                    else this.moveDrag.command.update(ray);
                }catch(error){
                    this.finishHandle(true);
                    console.warn('[cocos-gizmos/handles] Drag cancelled:',error);
                }
            } else if(this.sliderDrag) {
                const drag=this.sliderDrag;
                const next=drag.solver.move(point.x);
                if(next===null)return;
                try{drag.session.apply(next);}
                catch(error){this.finishHud(true);console.warn('[cocos-gizmos/hud] Edit cancelled:',error);}
            } else if(!captured)this.setHover(this.pick(event));
        }

        private finishHandle(cancelled:boolean):void {
            const drag=this.moveDrag;
            if(!drag)return;
            this.moveDrag=null;
            try {if(cancelled)drag.command.cancel();else drag.command.end();}
            finally {if(captured===this)captured=null;}
        }

        private finishHud(cancelled:boolean,event?:any):void {
            const click=this.buttonDown, drag=this.sliderDrag;
            const downRect=this.hudDownRect;
            this.buttonDown=null;this.sliderDrag=null;this.hudDownRect=null;
            // Reset capture even if a user Component callback throws. A failed
            // button should never block all subsequent Scene interactions.
            try {
                if(drag)drag.session.finish(cancelled);
                if(!click || cancelled)return;
                const component=this.component();
                // HUD descriptors are re-created on each Scene frame. Do not
                // compare object identity across pointer-down and pointer-up.
                const released=event ? this.pickHud(event) : click;
                const point=event ? readScenePointer(event) : null;
                const insideDownRect=!!(point && downRect &&
                    point.x>=downRect.left && point.x<=downRect.right &&
                    point.y>=downRect.bottom && point.y<=downRect.top);
                if(!component || !insideDownRect && (!released || released.key!==click.key))
                    return;
                const control=click.control;
                if(control.type==='button') {
                    // A button ID is NOT a serialized Component property.
                    // Passing "hud:reset" through SelectGizmo.onControlBegin
                    // makes Editor run an invalid property transaction and
                    // can drop the currently selected Node. Actions should
                    // update their own properties and notify Scene redraw.
                    component.onGizmoHudAction?.(control.id);
                    this.safeNativeHook('button:'+control.id,()=>
                        this.onComponentChanged?.(component.node));
                    requestSceneRepaint();
                    return;
                }
                if(control.type!=='toggle' && control.type!=='checkbox')return;
                const property=control.property;
                const original=(component as any)[property];
                if(typeof original!=='boolean')return;
                const session=new GizmoEditSession<boolean>(
                    ()=>(component as any)[property],
                    value=>{(component as any)[property]=value;},
                    {
                        begin:(value)=>{
                            this.beginEdit(property);
                            try{component.onGizmoHudChanged?.(property,'begin',value);}
                            catch(error){this.endEdit(property,true);throw error;}
                        },
                        update:(value)=>{
                            component.onGizmoHudChanged?.(property,'update',value);
                            this.changed(property);
                        },
                        rollback:()=>this.changed(property),
                        end:(value,wasCancelled,changed)=>{
                            try{component.onGizmoHudChanged?.(property,
                                wasCancelled?'cancel':'end',value);}
                            finally{this.endEdit(property,wasCancelled||!changed);}
                        },
                    },
                );
                session.begin();
                try {session.apply(!original);session.finish();}
                catch(error) {
                    session.finish(true);
                    throw error;
                }
            } finally {
                if(captured===this)captured=null;
            }
        }

        private pointerDown(event:any):boolean {
            if(!this.shown || this.disposed || !isPrimaryScenePointer(event)||
                captured)return false;
            // Any next ordinary click ends the prior HUD selection lease.
            selectionLease?.clear();
            const hud=this.pickHud(event);
            if(hud)this.startHud(hud,event);
            else {
                const hit=this.pick(event);
                if(hit)this.startHandle(hit,event);
            }
            if(captured===this){
                consumeOwnedSceneEvent(event);
                return true;
            }
            return false;
        }

        private pointerUp(event:any):boolean {
            if(!isPrimaryScenePointer(event)||captured!==this)return false;
            consumeOwnedSceneEvent(event);
            try {
                this.finishHandle(false);
                this.finishHud(false,event);
            } finally {
                // Keep the lease for a short time after the HUD callback,
                // since Creator may dispatch selection:unselect asynchronously.
                selectionLease?.release();
                if(captured===this)captured=null;
                this.deferredHide=false;
            }
            return true;
        }

        public onNotGizmoMouseDown(event:any):boolean|void {
            input.record('outsideDown');
            if(this.pointerDown(event))return false;
        }
        public onNotGizmoMouseMove(event:any):boolean|void {
            const active=captured===this;
            if(active)consumeOwnedSceneEvent(event);
            this.moveInput(event);
            if(active)return false;
        }
        public onNotGizmoMouseUp(event:any):boolean|void {
            input.record('outsideUp');
            if(this.pointerUp(event))return false;
        }
        public onGizmoMouseDown(event:any):boolean|void {
            input.record('gizmoDown');
            // No native raycast mesh is created for our v3 handles.
            // A GizmoOperation hit usually belongs to Creator's transform
            // tool. Never steal it unless it has our registered handle name.
            const name=readSceneHandleName(event);
            if(!name || !this.fields.some(e=>e.key===name) &&
                !this.controls.some(e=>e.key===name)){
                // Another native tool was clicked: the previous HUD lease
                // must not revive our Node over the user's new selection.
                if(!captured)selectionLease?.clear();
                return;
            }
            if(this.pointerDown(event))return false;
        }
        public onGizmoMouseMove(event:any):boolean|void {
            input.record('gizmoMove');
            const active=captured===this;
            if(active){
                consumeOwnedSceneEvent(event);
                this.moveInput(event);
                return false;
            }
            // A visible Move/Rotate handle can be under a native Gizmo
            // raycast surface even before mouse-down. Update OUR visual
            // hover from shared screen geometry without taking the event.
            if(!captured && this.shown)this.setHover(this.pick(event));
        }
        public onGizmoMouseUp(event:any):boolean|void {
            input.record('gizmoUp');
            if(this.pointerUp(event))return false;
        }
        public onKeyDown(event:any):boolean|void {
            if(captured===this&&(event?.key==='Escape'||event?.keyCode===27)){
                try {this.finishHandle(true);this.finishHud(true);}
                finally {selectionLease?.clear();this.deferredHide=false;}
                return true;
            }
        }

        public onShow():void {
            this.shown=true;this.disposed=false;
            this.deferredHide=false;
            this.refreshHandles();
        }
        public onHide():void {
            if(this.hasActiveGesture() && isSelectable(this.target as Component)){
                // Also guard Editor code paths that invoke onHide directly.
                this.deferredHide=true;
                this.suppressedLifecycleCancels++;
                return;
            }
            this.shown=false;
            // A normal Editor hide may be caused by its own delayed
            // selection:unselect dispatch after a HUD click. Do not clear
            // the short-lived selection lease here: the main process still
            // needs to recognize and restore the protected Node.
            this.finishHandle(true);
            this.finishHud(true);
            const comp=this.target as Component;
            if(comp)setSelectedHandleHover(comp,null);
            this.hover=null;
        }
        public onDestroy():void {
            if(this.hasActiveGesture() && isSelectable(this.target as Component)){
                this.deferredHide=true;
                this.suppressedLifecycleCancels++;
                return;
            }
            this.onHide();this.disposed=true;this.fields=[];this.controls=[];
        }
        public onTargetUpdate():void {this.refreshHandles();}
        public onNodeChanged():void {this.refreshHandles();}
        public updateControllerTransform():void {this.refreshHandles();}
        public onViewportHover(event: ViewportPointer): void {
            if(this.shown && !this.disposed && !captured)
                this.setHover(this.pick(event));
        }
        public onViewportDown(event: ViewportPointer): boolean {
            return this.pointerDown(event);
        }
        public onViewportMove(event: ViewportPointer): void {
            if(captured===this)this.moveInput(event);
        }
        public onViewportUp(event: ViewportPointer): void {
            if(captured===this)this.pointerUp(event);
        }
        public onViewportCancel(): void {
            if(captured===this)this.cancelGestureForTeardown();
        }
        public isHandleVisible():boolean {return this.shown;}
        public isHandleDisposed():boolean {return this.disposed;}
        public diagnosticState() {
            return {
                positionHandles:this.fields.length,hudControls:this.controls.length,
                draggingPosition:!!this.moveDrag,draggingSlider:!!this.sliderDrag,
                pendingClick:!!this.buttonDown,
                deferredHide:this.deferredHide,
                suppressedLifecycleCancels:this.suppressedLifecycleCancels,
            };
        }
    };
}

export interface V3HandleAdapter {
    refresh(components: readonly Component[],selected: ReadonlySet<string>,now:number):void;
    protectedSelection(): {nodeUuid:string;active:boolean}|null;
    clear():void;
    dispose():void;
    status():{
        registered:number;active:number;reason:string;
        positionHandles:number;hudControls:number;
        draggingPosition:number;draggingSlider:number;pendingClicks:number;
        suppressedLifecycleCancels:number; deferredVisibility:number;
        input:GizmoInputSnapshot;
        viewportInput: ReturnType<SceneViewportInput['status']>;
        engineInput: ReturnType<SceneEngineInput['status']>;
        operationInput: ReturnType<SceneOperationInput['status']>;
    };
}

/** Clean SelectGizmo input adapter, without inheriting the Editor
 * BoxColliderComponentGizmo or allocating any physics/edit-face proxies.
 * The visual 2D/3D renderers are independent of this pool lifecycle.
 */
export function createV3HandleAdapter(
    allowHud:(component:Component)=>boolean=()=>true,
    hudLayout?:GizmoHudLayout,
):V3HandleAdapter {
    const registered=new Map<string,any>();
    const active=new Map<Component,any>();
    const owned=new Map<Component,any>();
    const input=new GizmoInputDiagnostics();
    const selectionLease=new SceneSelectionLease();
    const pointerPorts: SceneViewportInputPorts = {
        viewport() { return camera()?.viewport || null; },
        down(event) {
            // HUD is first in draw order, so it owns clicks over any
            // overlapping 3D handle. Native Gizmos receive all misses.
            for(const gizmo of active.values()){
                if(gizmo.pickHud(event) && gizmo.onViewportDown(event))return true;
            }
            for(const gizmo of active.values()){
                if(gizmo.onViewportDown(event))return true;
            }
            return false;
        },
        move(event) {
            (captured as any)?.onViewportMove?.(event);
        },
        hover(event) {
            for(const gizmo of active.values())gizmo.onViewportHover?.(event);
        },
        up(event) {
            (captured as any)?.onViewportUp?.(event);
        },
        cancel() {
            (captured as any)?.onViewportCancel?.();
        },
    };
    // HUD DOM controls use their own browser event path rather than
    // Editor raycasting, as Creator's native ParticleSystem float window
    // does. Reuse the same application Command callbacks for consistency.
    const disconnectHudInput=connectSceneHudInput(pointerPorts);
    const operationInput=new SceneOperationInput(pointerPorts);
    const viewportInput=new SceneViewportInput(pointerPorts);
    const engineInput=new SceneEngineInput(pointerPorts);
    let manager:any=null, typeDefs:any=null, ctor:any=null;
    let nativeBaseAvailable=false;
    let latestScan=-Infinity,reason='not-initialized';
    let lastSelected=new Set<string>();

    const initialize=():boolean=>{
        const cce:any=(globalThis as any).cce||(globalThis as any).window?.cce;
        manager=cce?.Gizmo;
        typeDefs=manager?._gizmoPool?._getPool?.('component')?.typeDefs || null;
        if(!ctor){
            const base=typeDefs ? resolveSelectGizmo(typeDefs) : null;
            nativeBaseAvailable=!!base;
            ctor=createSelectHandleGizmo(base || StandaloneGestureHost,
                input,allowHud,hudLayout,selectionLease);
            if(!base)console.warn(
                '[cocos-gizmos/v3] Native SelectGizmo unavailable: ' +
                'using direct mouse input without native Undo hooks');
        }
        reason=nativeBaseAvailable ? 'ready-select-gizmo' :
            'ready-direct-input-no-native-undo';
        return true;
    };

    function release(component:Component,gizmo:any):void {
        if(!gizmo)return;
        // Teardown is authoritative (Scene switch, disabled/destroyed Node,
        // plugin unload). Unlike Editor's transient visibility refresh, this
        // must roll back an in-flight gesture and free the global capture.
        try {gizmo.cancelGestureForTeardown?.();}
        catch(error){console.warn('[cocos-gizmos/v3] Cancel:',error);}
        try {gizmo.hide?.();}
        catch(error){console.warn('[cocos-gizmos/v3] Hide:',error);}
        try {gizmo.onDestroy?.();}
        catch(error){console.warn('[cocos-gizmos/v3] Release:',error);}
        try {if((component as any)?.gizmo===gizmo)(component as any).gizmo=null;}
        catch {/* old Scene is destroyed */}
    }
    function clear():void {
        for(const [component,gizmo] of owned)release(component,gizmo);
        operationInput.detach();
        viewportInput.detach();
        engineInput.detach();
        owned.clear();active.clear();lastSelected.clear();latestScan=-Infinity;
        captured=null;
        selectionLease.clear();
    }
    function show(component:Component):any {
        let gizmo:any=(component as any).gizmo;
        try{
            manager.showComponentGizmo?.(component);
            const mounted=(component as any).gizmo;
            if(mounted instanceof ctor)gizmo=mounted;
        }catch {/* fallback to registered component Gizmo creation */}
        if(!(gizmo instanceof ctor)||gizmo.isHandleDisposed?.())gizmo=null;
        if(!gizmo&&typeof manager?.createGizmo==='function'){
            for(const name of selectedKeys(component)){
                try{
                    gizmo=manager.createGizmo(name,component)||
                        (component as any).gizmo;
                    if(gizmo instanceof ctor)break;
                }catch {/* unregistered class alias */}
            }
        }
        if(!(gizmo instanceof ctor)){
            // createGizmo() is an Editor pool factory; it does NOT promise
            // to attach its returned instance to component.gizmo. When an
            // extension has no native controller mesh, use a standalone
            // SelectGizmo instance for the DOM pointer port instead of
            // silently losing every custom handle and HUD control.
            try {
                gizmo=new ctor(component);
                gizmo.init?.();
            } catch(error) {
                console.warn('[cocos-gizmos/v3] Standalone input adapter:',error);
                return null;
            }
        }
        const old=owned.get(component);
        if(old&&old!==gizmo)release(component,old);
        owned.set(component,gizmo);
        gizmo.show?.();
        if(gizmo.isHandleVisible?.()===false)gizmo.onShow?.();
        gizmo.refreshHandles?.();
        return gizmo;
    }
    return {
        refresh(components,selected,now) {
            // Creator 3.8.8 Scene Operation is the source of truth: higher
            // priority than Gizmo=99 and Camera=98 avoids update->cancel
            // from native Scene selection after a custom HUD/control click.
            operationInput.refresh();
            const nativeActive=operationInput.status().active;
            const webCapturing=viewportInput.status().captured;
            const engineCapturing=engineInput.status().captured;
            if(nativeActive){
                // Input adapters can become available asynchronously between
                // frames. Never detach an adapter that owns a held pointer:
                // that detach is defined to cancel the current EditSession.
                if(!webCapturing && !engineCapturing){
                    viewportInput.detach();
                    engineInput.refresh(false);
                }
            } else if(engineCapturing){
                // A late WebView mount must not steal a Cocos engine drag.
                engineInput.refresh(true);
            } else if(webCapturing){
                viewportInput.refresh();
                engineInput.refresh(false);
            } else {
                viewportInput.refresh();
                engineInput.refresh(!viewportInput.status().active);
            }
            for(const component of components){
                if(isSelectable(component)&&selected.has(component.node.uuid)){
                    try{drawSelectedPositionMarkers(component);}
                    catch(error){console.warn('[cocos-gizmos/v3] Render:',error);}
                }
            }
            const changed=selected.size!==lastSelected.size ||
                [...selected].some(id=>!lastSelected.has(id));
            if(!changed&&now-latestScan<250)return;
            latestScan=now;lastSelected=new Set(selected);
            if(!initialize())return;
            const present=new Set(components);
            for(const [comp,gizmo] of owned){
                // The Editor can briefly drop a Component from the registry
                // while serializing its changed property. Do not terminate
                // the in-flight gesture merely because one scan missed it.
                if(!isSelectable(comp)||(!present.has(comp)&&!gizmo.hasActiveGesture?.())){
                    release(comp,gizmo);owned.delete(comp);active.delete(comp);
                }
            }
            const wanted=new Set<Component>();
            for(const [component,gizmo] of active) {
                if(gizmo.hasActiveGesture?.() && isSelectable(component))
                    wanted.add(component);
            }
            for(const component of components){
                if(!isSelectable(component)||!selected.has(component.node.uuid)||
                    (typeof component.onGizmoHandles!=='function' &&
                    (typeof component.onGizmoHudControls!=='function' ||
                     (hudLayout&&!hudLayout.get(component)))))continue;
                wanted.add(component);
                // Never require our Component's name to be free in the
                // Editor's private Gizmo pool. Another extension or stale
                // version may already own that name, but screen-space input
                // must still function for this selected Component.
                // A native SelectGizmo registration improves Undo only.
                if(typeDefs) {
                    for(const key of selectedKeys(component)){
                        if(!typeDefs[key]){
                            typeDefs[key]=ctor;registered.set(key,ctor);
                        }
                    }
                }
                const old=active.get(component);
                if(old&&old.isHandleVisible?.()!==false &&
                    !old.isHandleDisposed?.())old.refreshHandles?.();
                else{
                    const next=show(component);
                    if(next)active.set(component,next);
                    else active.delete(component);
                }
            }
            for(const [comp,gizmo] of active){
                if(!wanted.has(comp)){
                    if(gizmo.hasActiveGesture?.() && isSelectable(comp)){
                        // Selection snapshots can momentarily be empty during
                        // Inspector updates. Retain the live gesture until a
                        // genuine mouse-up/Escape or explicit Scene teardown.
                        continue;
                    }
                    try{gizmo.hide?.();}
                    catch(error){console.warn('[cocos-gizmos/v3] Deselect:',error);}
                    active.delete(comp);
                }
            }
        },
        clear,
        dispose(){
            clear();
            disconnectHudInput();
            for(const [key,value] of registered)
                if(typeDefs?.[key]===value)delete typeDefs[key];
            registered.clear();manager=null;typeDefs=null;
            reason='disposed';
        },
        protectedSelection() { return selectionLease.inspect(); },
        status() {
            const counts={positionHandles:0,hudControls:0,
                draggingPosition:0,draggingSlider:0,pendingClicks:0,
                suppressedLifecycleCancels:0,deferredVisibility:0};
            for(const gizmo of active.values()){
                const stat=gizmo.diagnosticState?.();
                if(!stat)continue;
                counts.positionHandles+=stat.positionHandles;
                counts.hudControls+=stat.hudControls;
                if(stat.draggingPosition)counts.draggingPosition++;
                if(stat.draggingSlider)counts.draggingSlider++;
                if(stat.pendingClick)counts.pendingClicks++;
                counts.suppressedLifecycleCancels+=stat.suppressedLifecycleCancels||0;
                if(stat.deferredHide)counts.deferredVisibility++;
            }
            return {registered:registered.size,active:active.size,
                reason,...counts,input:input.snapshot(),
                operationInput:operationInput.status(),
                viewportInput:viewportInput.status(),
                engineInput:engineInput.status()};
        },
    };
}
