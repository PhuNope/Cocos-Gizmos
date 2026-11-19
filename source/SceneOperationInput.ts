import { isPrimaryScenePointer } from './SceneGizmoInput';
import { sceneEventToViewport } from './ScenePointerCoordinates';
import { consumeOwnedSceneEvent, isSceneHudPointerEvent,
    isSceneHudDomTarget } from './SceneSelectionLease';
import type { SceneViewportInputPorts, ViewportPointer } from './SceneViewportInput';

/** Creator 3.8.8 builtin/scene/@types/cce/public/operation/index.d.ts
 * declares OperationPriority.Gizmo = 99 and Camera = 98.
 *
 * Register at 100 so our own hit-tested shapes can consume their gestures
 * before GizmoOperation chooses a native Gizmo or Scene Node. Returning
 * false is the documented Operation stop-propagation contract.
 */
export const SCENE_GIZMO_INPUT_PRIORITY = 100;

export interface BuilderHudOperationPort {
    usesSceneOperationInput(): boolean;
    operationDown(pointer: ViewportPointer,
        viewport:{width:number;height:number}|null):boolean;
    operationMove(pointer: ViewportPointer,
        viewport:{width:number;height:number}|null):boolean;
    operationUp(pointer: ViewportPointer|null,
        viewport:{width:number;height:number}|null):boolean;
    operationCancel():void;
    operationWheel(pointer:ViewportPointer,
        viewport:{width:number;height:number}|null,deltaY:number):boolean;
}

interface OperationPort {
    on(type: string, listener: (event: any) => boolean | void, priority?: number): unknown;
    removeListener?(type: string, listener: (event: any) => boolean | void): void;
    off?(type: string, listener: (event: any) => boolean | void): void;
}

export class SceneOperationInput {
    private operation: OperationPort | null = null;
    private capturing = false;
    private hudOwned = false;
    private builderHudGesture = false;
    private builderHudDown = 0;
    private builderHudWheel = 0;
    private events = 0;
    private intercepted = 0;
    private hoverEvents = 0;
    private cancellations = 0;
    private reason = 'not-mounted';
    private lastPointerSource = 'missing';

    constructor(
        private readonly ports: SceneViewportInputPorts,
        private readonly operationPort: () => OperationPort | null =
            () => (globalThis as any).cce?.Operation ||
                (globalThis as any).window?.cce?.Operation || null,
        private readonly builderHud: () => BuilderHudOperationPort | null =
            () => null,
    ) {}

    public refresh(): void {
        const operation=this.operationPort();
        if(!operation || typeof operation.on!=='function' ||
            typeof (operation.removeListener || operation.off)!=='function') {
            if(this.capturing || this.builderHudGesture){
                // A temporary Scene recreation must not force a rollback
                // before the old dispatcher sends mouse-up. Teardown
                // explicitly calls detach() and still cancels on purpose.
                this.reason='operation-transition-deferred';
                return;
            }
            if(this.operation)this.detach();
            this.reason='scene-operation-unavailable';
            return;
        }
        if(operation===this.operation)return;
        if(this.capturing || this.builderHudGesture){
            this.reason='operation-transition-deferred';
            return;
        }
        this.detach();
        this.operation=operation;
        operation.on('mousedown',this.onDown,SCENE_GIZMO_INPUT_PRIORITY);
        operation.on('mousemove',this.onMove,SCENE_GIZMO_INPUT_PRIORITY);
        operation.on('mouseup',this.onUp,SCENE_GIZMO_INPUT_PRIORITY);
        // Verified in the bundled Creator 3.8.8 Editor types:
        // SceneMouseEvent explicitly includes 'mousewheel'.
        operation.on('mousewheel',this.onWheel,SCENE_GIZMO_INPUT_PRIORITY);
        operation.on('keydown',this.onKeyDown,SCENE_GIZMO_INPUT_PRIORITY);
        this.reason='scene-operation-priority-100';
    }

    private point(event: any): ViewportPointer | null {
        const result=sceneEventToViewport(event,this.ports.viewport());
        this.lastPointerSource=result.source;
        const pointer=result.pointer;
        if(!pointer)return null;
        return {
            x:pointer.x,y:pointer.y,
            button:typeof event?.button==='number'?event.button:0,
            buttons:typeof event?.buttons==='number'?event.buttons:1,
            event,
        };
    }

    private readonly onDown=(event:any):boolean|void=>{
        if(this.capturing || !isPrimaryScenePointer(event))return;
        // DOM may have swallowed the previous mouseup: a fresh down starts
        // a new gesture and must never inherit stale HUD ownership.
        this.hudOwned=false;
        const point=this.point(event);
        const hud=this.builderHud();
        // Cocos 3D Editor's parent Scene Panel has webview:pointer-events none;
        // pointerdown cannot reach the rendered HTML even at maximal z-index.
        // The Editor Operation therefore owns 3D HUD input and dispatches
        // directly to the application-layer commands by control rectangles.
        if(point && hud?.usesSceneOperationInput() &&
            hud.operationDown(point,this.ports.viewport())){
            this.builderHudGesture=true;
            this.builderHudDown++;
            this.hudOwned=true;
            consumeOwnedSceneEvent(event);
            return false; // Stop native Node picker, not an active DOM event.
        }
        // A browser click over the DOM HUD must reach the actual HTML
        // control, even when Creator also reports a Scene Operation event.
        // Stop only geometry-only Scene picks: returning false for a real
        // DOM target terminates pointerdown before button/input handlers.
        if(isSceneHudPointerEvent(event,point,this.ports.viewport())){
            this.hudOwned=true;
            return isSceneHudDomTarget(event,point,this.ports.viewport()) ?
                undefined : false;
        }
        if(!point)return;
        this.events++;
        try {
            if(!this.ports.down(point)){
                this.ports.hover(point);
                return; // Let native selection run on a real miss.
            }
            this.capturing=true;
            this.intercepted++;
            consumeOwnedSceneEvent(event);
            return false;
        }catch(error){
            this.capturing=false;
            try{this.ports.cancel();}finally{console.warn(
                '[cocos-gizmos/input] Scene Operation mouse-down:',error);}
            // Our code failed: do not swallow normal Editor selection.
        }
    };

    private readonly onMove=(event:any):boolean|void=>{
        if(this.builderHudGesture){
            const point=this.point(event);
            if(point)this.builderHud()?.operationMove(point,this.ports.viewport());
            consumeOwnedSceneEvent(event);
            return false;
        }
        if(this.hudOwned){
            // The Scene Operation may not receive mouseup when a native DOM
            // control owns it. Release the guard once the mouse is up.
            const buttons=typeof event?.buttons==='number'?event.buttons:
                typeof event?.event?.buttons==='number'?event.event.buttons:null;
            if(buttons===0)this.hudOwned=false;
            else return; // Let the DOM control receive native pointermove.
        }
        const point=this.point(event);
        if(!point)return;
        this.events++;
        if(this.capturing){
            consumeOwnedSceneEvent(event);
            try{this.ports.move(point);}
            catch(error){
                this.capturing=false;
                this.ports.cancel();
                console.warn('[cocos-gizmos/input] Scene Operation mouse-move:',error);
            }
            return false;
        }
        this.hoverEvents++;
        this.ports.hover(point);
    };

    private readonly onUp=(event:any):boolean|void=>{
        if(this.builderHudGesture){
            this.builderHudGesture=false;
            this.hudOwned=false;
            const point=this.point(event);
            try {this.builderHud()?.operationUp(point,this.ports.viewport());}
            catch(error){this.builderHud()?.operationCancel();
                console.warn('[cocos-gizmos/hud] Operation release:',error);}
            consumeOwnedSceneEvent(event);
            return false;
        }
        if(this.hudOwned){
            this.hudOwned=false;
            return; // Never cancel native pointerup for a HUD slider.
        }
        if(!this.capturing)return;
        this.events++;
        consumeOwnedSceneEvent(event);
        this.capturing=false;
        const point=this.point(event);
        if(point)this.ports.up(point);
        else this.ports.cancel();
        return false;
    };

    private wheelDelta(event:any):number {
        const wrapped=[event,event?.event,event?.detail?.event,
            event?.nativeEvent,event?.data?.event,event?.detail,event?.data];
        for(const value of wrapped){
            if(!value)continue;
            if(Number.isFinite(value.deltaY) && value.deltaY!==0){
                const mode=value.deltaMode===1?16:
                    value.deltaMode===2?Math.max(120,this.ports.viewport()?.height||0):1;
                return value.deltaY*mode;
            }
            if(Number.isFinite(value.wheelDeltaY) && value.wheelDeltaY!==0)
                return -value.wheelDeltaY;
            if(typeof value.getScrollY==='function'){
                try{
                    const amount=value.getScrollY();
                    if(Number.isFinite(amount)&&amount!==0)return -amount;
                }catch { /* Some Creator events do not expose native wheel data */ }
            }
        }
        return 0;
    }

    private readonly onWheel=(event:any):boolean|void=>{
        const hud=this.builderHud();
        if(!hud?.usesSceneOperationInput())return;
        const point=this.point(event);
        if(!point)return;
        if(hud.operationWheel(point,this.ports.viewport(),this.wheelDelta(event))){
            this.builderHudWheel++;
            consumeOwnedSceneEvent(event);
            return false;
        }
        // Outside the HUD preserve Editor's normal camera wheel zoom.
    };

    private readonly onKeyDown=(event:any):boolean|void=>{
        if(this.builderHudGesture &&
            (event?.key==='Escape'||event?.keyCode===27)){
            this.builderHudGesture=false;
            this.hudOwned=false;
            this.builderHud()?.operationCancel();
            return false;
        }
        if(this.hudOwned && (event?.key==='Escape' || event?.keyCode===27)){
            this.hudOwned=false;
            return;
        }
        if(!this.capturing || event?.key!=='Escape' && event?.keyCode!==27)
            return;
        this.capturing=false;
        this.cancellations++;
        this.ports.cancel();
        return false;
    };

    public detach():void {
        if(this.operation){
            const remove=this.operation.removeListener || this.operation.off;
            for(const [name,callback] of [
                ['mousedown',this.onDown],['mousemove',this.onMove],
                ['mouseup',this.onUp],['mousewheel',this.onWheel],
                ['keydown',this.onKeyDown],
            ] as const){
                try{remove?.call(this.operation,name,callback);}
                catch(error){console.warn(
                    '[cocos-gizmos/input] Scene Operation cleanup:',error);}
            }
        }
        this.operation=null;
        this.hudOwned=false;
        if(this.builderHudGesture){
            this.builderHudGesture=false;
            this.builderHud()?.operationCancel();
        }
        if(this.capturing){
            this.capturing=false;
            this.ports.cancel();
        }
        this.reason='detached';
    }

    public status() {
        return {
            active:!!this.operation,reason:this.reason,
            captured:this.capturing,hudOwned:this.hudOwned,
            builderHudGesture:this.builderHudGesture,builderHudDown:this.builderHudDown,
            builderHudWheel:this.builderHudWheel,
            observed:this.events,
            intercepted:this.intercepted,hover:this.hoverEvents,
            cancelled:this.cancellations,priority:SCENE_GIZMO_INPUT_PRIORITY,
            pointerSource:this.lastPointerSource,
        };
    }
}
