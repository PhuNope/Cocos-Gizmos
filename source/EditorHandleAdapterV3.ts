import { Component } from 'cc';
import {
    Point, Field, camera, validPoint, sceneRay, spaceFor, readField,
    writeField, handleWorldOrigin, markerSize, axisPlacement,
    rotationPlacement, rotationFrame, isCanvas2D, rotationScreenFallback,
} from './GizmoViewportGeometry';
import { drawSelectedPositionMarkers, setSelectedHandleHover,
    lastSelectedCanvasPaint } from './GizmoHandleRenderer';
import { hitTestHandle, hitTestHud, HandleHitTarget, HudHitTarget } from './GizmoHitTest';
import { handlePlaneNormal } from './PositionDragSolver';
import { axisDragNormal } from './AxisHandleGeometry';
import { GizmoMoveCommand } from './GizmoMoveCommand';
import { GizmoRotateCommand } from './GizmoRotateCommand';
import { RotateAxis } from './RotationHandleGeometry';
import { GizmoEditSession } from './GizmoEditSession';
import { HudControl, HudSliderDrag, hudSliderScreenTrack,
    normalizeHudControls } from './GizmoHudControls';
import type { GizmoHudLayout, GizmoHudPlacement } from './GizmoHudLayout';
import {
    GizmoInputDiagnostics, GizmoInputSnapshot, readScenePointer,
    isPrimaryScenePointer,
} from './SceneGizmoInput';
import { tickOnce as repaintWholeScene } from './ExecuteGizmos';

type Drag = { entry: HandleHitTarget; command: GizmoMoveCommand | GizmoRotateCommand };
type SliderDrag = { entry: HudHitTarget; solver: HudSliderDrag; session: GizmoEditSession<number> };

/** One active gesture across selected components: GizmoOperation emits
 * operation-level callbacks to all registered SelectGizmos.
 */
let captured: object | null = null;

const selectedKeys = (component: Component): string[] => {
    const value: any=component;
    const names=[value.__classname__,value.constructor?.__classname__,
        value.constructor?.name].filter((v): v is string=>typeof v==='string'&&!!v);
    const out=new Set<string>();
    for(const name of names){out.add(name);if(!name.includes('.'))out.add('cc.'+name);}
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

function createSelectHandleGizmo(
    base: any, input: GizmoInputDiagnostics,
    allowHud: (component: Component) => boolean,
    hudLayout?: GizmoHudLayout,
): any {
    return class CocosGizmosSelectHandles extends base {
        private shown=false;
        private disposed=false;
        private fields: HandleHitTarget[]=[];
        private controls: HudHitTarget[]=[];
        private moveDrag: Drag | null=null;
        private sliderDrag: SliderDrag | null=null;
        private buttonDown: HudHitTarget | null=null;
        private hover: string | null=null;
        private lastPaint=0;

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
            if(this.shown) {
                try { repaintWholeScene(); }
                catch { /* Scene may close between pointer and repaint */ }
            }
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

        private changed(property: string): void {
            const component=this.component();
            if (!component) return;
            this.onControlUpdate?.(property);
            this.onComponentChanged?.(component.node);
            try { repaintWholeScene(); } catch { /* Scene temporarily unavailable */ }
            (globalThis as any).cce?.Engine?.repaintInEditMode?.();
        }

        private beginEdit(property: string): void {
            this.onControlBegin?.(property);
        }

        private endEdit(property: string, cancelled: boolean): void {
            if(cancelled && typeof this.onControlCancel==='function')
                this.onControlCancel(property);
            else this.onControlEnd?.(property);
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
                const command=ring ? new GizmoRotateCommand(
                    original,ring.center,ring.normal,rotationFrame(component),
                    {axis:entry.field.axis as RotateAxis,
                     space:entry.field.space==='world'?'world':'local',
                     snap:entry.field.snap,twoD:isCanvas2D(component.node)},
                    port,hooks,rotationScreenFallback(ring,view)
                ) : new GizmoMoveCommand(original,space,normal,entry.field,port,hooks);
                if(ring ? !command.begin(ray,point):!command.begin(ray))return;
                this.moveDrag={entry,command}; captured=this;
                this.setHover(entry);
            } catch(error) {
                console.warn('[cocos-gizmos/handles] Begin failed:',error);
            }
        }

        private startHud(entry: HudHitTarget,event:any):void {
            if(captured || this.sliderDrag || this.buttonDown || this.moveDrag)return;
            const component=this.component();
            if(!component)return;
            const control=entry.control;
            if(control.type!=='slider'){this.buttonDown=entry;captured=this;return;}
            const point=readScenePointer(event), view=camera();
            const placement=this.placement();
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
                session.begin();
                this.sliderDrag={entry,solver,session};captured=this;
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
            const clicked=this.buttonDown;
            this.buttonDown=null;
            const component=this.component();
            if(clicked && !cancelled && component){
                if(event && this.pickHud(event)!==clicked)cancelled=true;
                if(!cancelled){
                    const control=clicked.control;
                    if(control.type==='button'){
                        this.beginEdit(clicked.key);
                        try{
                            component.onGizmoHudAction?.(control.id);
                            this.changed(clicked.key);
                        }finally{this.endEdit(clicked.key,false);}
                    }else if(control.type==='toggle'||control.type==='checkbox'){
                        const property=control.property;
                        const original=(component as any)[property];
                        if(typeof original==='boolean'){
                            const session=new GizmoEditSession<boolean>(
                                ()=>(component as any)[property],
                                v=>{(component as any)[property]=v;},
                                {
                                    begin:(v)=>{this.beginEdit(property);
                                        component.onGizmoHudChanged?.(property,'begin',v);},
                                    update:(v)=>{component.onGizmoHudChanged?.(
                                        property,'update',v);this.changed(property);},
                                    rollback:()=>this.changed(property),
                                    end:(v,cancelled,changed)=>{
                                        try{component.onGizmoHudChanged?.(property,
                                            cancelled?'cancel':'end',v);}
                                        finally{this.endEdit(property,cancelled||!changed);}
                                    },
                                });
                            session.begin();
                            try{session.apply(!original);session.finish();}
                            catch(error){session.finish(true);throw error;}
                        }
                    }
                }
            }
            const drag=this.sliderDrag;this.sliderDrag=null;
            if(drag)drag.session.finish(cancelled);
            if(captured===this)captured=null;
        }

        private pointerDown(event:any):void {
            if(!this.shown || this.disposed || !isPrimaryScenePointer(event)||
                captured)return;
            const hud=this.pickHud(event);
            if(hud){this.startHud(hud,event);return;}
            const hit=this.pick(event);
            if(hit)this.startHandle(hit,event);
        }

        private pointerUp(event:any):void {
            if(!isPrimaryScenePointer(event)||captured!==this)return;
            this.finishHandle(false);this.finishHud(false,event);
        }

        public onNotGizmoMouseDown(event:any):void {
            input.record('outsideDown');this.pointerDown(event);
        }
        public onNotGizmoMouseMove(event:any):void {this.moveInput(event);}
        public onNotGizmoMouseUp(event:any):void {
            input.record('outsideUp');this.pointerUp(event);
        }
        public onGizmoMouseDown(event:any):void {
            input.record('gizmoDown');this.pointerDown(event);
        }
        public onGizmoMouseMove(event:any):void {
            input.record('gizmoMove');this.moveInput(event);
        }
        public onGizmoMouseUp(event:any):void {
            input.record('gizmoUp');this.pointerUp(event);
        }
        public onKeyDown(event:any):boolean|void {
            if(captured===this&&(event?.key==='Escape'||event?.keyCode===27)){
                this.finishHandle(true);this.finishHud(true);return true;
            }
        }

        public onShow():void {
            this.shown=true;this.disposed=false;this.refreshHandles();
        }
        public onHide():void {
            this.shown=false;
            this.finishHandle(true);this.finishHud(true);
            const comp=this.target as Component;
            if(comp)setSelectedHandleHover(comp,null);
            this.hover=null;
        }
        public onDestroy():void {
            this.onHide();this.disposed=true;this.fields=[];this.controls=[];
        }
        public onTargetUpdate():void {this.refreshHandles();}
        public onNodeChanged():void {this.refreshHandles();}
        public updateControllerTransform():void {this.refreshHandles();}
        public isHandleVisible():boolean {return this.shown;}
        public isHandleDisposed():boolean {return this.disposed;}
        public diagnosticState() {
            return {
                positionHandles:this.fields.length,hudControls:this.controls.length,
                draggingPosition:!!this.moveDrag,draggingSlider:!!this.sliderDrag,
                pendingClick:!!this.buttonDown,
            };
        }
    };
}

export interface V3HandleAdapter {
    refresh(components: readonly Component[],selected: ReadonlySet<string>,now:number):void;
    clear():void;
    dispose():void;
    status():{
        registered:number;active:number;reason:string;
        positionHandles:number;hudControls:number;
        draggingPosition:number;draggingSlider:number;pendingClicks:number;
        input:GizmoInputSnapshot;
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
    let manager:any=null, typeDefs:any=null, ctor:any=null;
    let latestScan=-Infinity,reason='not-initialized';
    let lastSelected=new Set<string>();

    const initialize=():boolean=>{
        const cce:any=(globalThis as any).cce||(globalThis as any).window?.cce;
        manager=cce?.Gizmo;
        typeDefs=manager?._gizmoPool?._getPool?.('component')?.typeDefs;
        if(!typeDefs){reason='component-gizmo-pool-unavailable';return false;}
        if(!ctor){
            const base=resolveSelectGizmo(typeDefs);
            if(!base){reason='select-gizmo-base-unavailable';return false;}
            ctor=createSelectHandleGizmo(base,input,allowHud,hudLayout);
        }
        reason='ready-select-gizmo';
        return true;
    };

    function release(component:Component,gizmo:any):void {
        if(!gizmo)return;
        try {gizmo.hide?.();}
        catch(error){console.warn('[cocos-gizmos/v3] Hide:',error);}
        try {gizmo.onDestroy?.();}
        catch(error){console.warn('[cocos-gizmos/v3] Release:',error);}
        try {if((component as any)?.gizmo===gizmo)(component as any).gizmo=null;}
        catch {/* old Scene is destroyed */}
    }
    function clear():void {
        for(const [component,gizmo] of owned)release(component,gizmo);
        owned.clear();active.clear();lastSelected.clear();latestScan=-Infinity;
        captured=null;
    }
    function show(component:Component):any {
        let gizmo:any=(component as any).gizmo;
        try{
            manager.showComponentGizmo?.(component);
            const mounted=(component as any).gizmo;
            if(mounted instanceof ctor)gizmo=mounted;
        }catch {/* fallback to registered component Gizmo creation */}
        if(!(gizmo instanceof ctor)||gizmo.isHandleDisposed?.())gizmo=null;
        if(!gizmo&&typeof manager.createGizmo==='function'){
            for(const name of selectedKeys(component)){
                try{
                    gizmo=manager.createGizmo(name,component)||
                        (component as any).gizmo;
                    if(gizmo instanceof ctor)break;
                }catch {/* unregistered class alias */}
            }
        }
        if(!(gizmo instanceof ctor))return null;
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
                if(!present.has(comp)||!isSelectable(comp)){
                    release(comp,gizmo);owned.delete(comp);active.delete(comp);
                }
            }
            const wanted=new Set<Component>();
            for(const component of components){
                if(!isSelectable(component)||!selected.has(component.node.uuid)||
                    (typeof component.onGizmoHandles!=='function' &&
                    (typeof component.onGizmoHudControls!=='function' ||
                     (hudLayout&&!hudLayout.get(component)))))continue;
                wanted.add(component);
                let installed=false;
                for(const key of selectedKeys(component)){
                    if(!typeDefs[key]){
                        typeDefs[key]=ctor;registered.set(key,ctor);installed=true;
                    }else if(typeDefs[key]===ctor)installed=true;
                }
                if(!installed)continue;
                const old=active.get(component);
                if(old&&old===(component as any).gizmo&&old.isHandleVisible?.()!==false &&
                    !old.isHandleDisposed?.())old.refreshHandles?.();
                else{
                    const next=show(component);
                    if(next)active.set(component,next);
                    else active.delete(component);
                }
            }
            for(const [comp,gizmo] of active){
                if(!wanted.has(comp)){
                    try{gizmo.hide?.();}
                    catch(error){console.warn('[cocos-gizmos/v3] Deselect:',error);}
                    active.delete(comp);
                }
            }
        },
        clear,
        dispose(){
            clear();
            for(const [key,value] of registered)
                if(typeDefs?.[key]===value)delete typeDefs[key];
            registered.clear();manager=null;typeDefs=null;
            reason='disposed';
        },
        status() {
            const counts={positionHandles:0,hudControls:0,
                draggingPosition:0,draggingSlider:0,pendingClicks:0};
            for(const gizmo of active.values()){
                const stat=gizmo.diagnosticState?.();
                if(!stat)continue;
                counts.positionHandles+=stat.positionHandles;
                counts.hudControls+=stat.hudControls;
                if(stat.draggingPosition)counts.draggingPosition++;
                if(stat.draggingSlider)counts.draggingSlider++;
                if(stat.pendingClick)counts.pendingClicks++;
            }
            return {registered:registered.size,active:active.size,
                reason,...counts,input:input.snapshot()};
        },
    };
}
