import { isPrimaryScenePointer } from './SceneGizmoInput';
import { sceneEventToViewport } from './ScenePointerCoordinates';
import { consumeOwnedSceneEvent } from './SceneSelectionLease';
import type { SceneViewportInputPorts, ViewportPointer } from './SceneViewportInput';

/** Creator 3.8.8 builtin/scene/@types/cce/public/operation/index.d.ts
 * declares OperationPriority.Gizmo = 99 and Camera = 98.
 *
 * Register at 100 so our own hit-tested shapes can consume their gestures
 * before GizmoOperation chooses a native Gizmo or Scene Node. Returning
 * false is the documented Operation stop-propagation contract.
 */
export const SCENE_GIZMO_INPUT_PRIORITY = 100;

interface OperationPort {
    on(type: string, listener: (event: any) => boolean | void, priority?: number): unknown;
    removeListener?(type: string, listener: (event: any) => boolean | void): void;
    off?(type: string, listener: (event: any) => boolean | void): void;
}

export class SceneOperationInput {
    private operation: OperationPort | null = null;
    private capturing = false;
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
    ) {}

    public refresh(): void {
        const operation=this.operationPort();
        if(!operation || typeof operation.on!=='function' ||
            typeof (operation.removeListener || operation.off)!=='function') {
            if(this.capturing){
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
        if(this.capturing){
            this.reason='operation-transition-deferred';
            return;
        }
        this.detach();
        this.operation=operation;
        operation.on('mousedown',this.onDown,SCENE_GIZMO_INPUT_PRIORITY);
        operation.on('mousemove',this.onMove,SCENE_GIZMO_INPUT_PRIORITY);
        operation.on('mouseup',this.onUp,SCENE_GIZMO_INPUT_PRIORITY);
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
        if(event?.target?.closest?.('#cocos-gizmos-scene-hud') ||
            event?.event?.target?.closest?.('#cocos-gizmos-scene-hud')) return;
        if(this.capturing || !isPrimaryScenePointer(event))return;
        const point=this.point(event);
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
        if(!this.capturing)return;
        this.events++;
        consumeOwnedSceneEvent(event);
        this.capturing=false;
        const point=this.point(event);
        if(point)this.ports.up(point);
        else this.ports.cancel();
        return false;
    };

    private readonly onKeyDown=(event:any):boolean|void=>{
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
                ['mouseup',this.onUp],['keydown',this.onKeyDown],
            ] as const){
                try{remove?.call(this.operation,name,callback);}
                catch(error){console.warn(
                    '[cocos-gizmos/input] Scene Operation cleanup:',error);}
            }
        }
        this.operation=null;
        if(this.capturing){
            this.capturing=false;
            this.ports.cancel();
        }
        this.reason='detached';
    }

    public status() {
        return {
            active:!!this.operation,reason:this.reason,
            captured:this.capturing,observed:this.events,
            intercepted:this.intercepted,hover:this.hoverEvents,
            cancelled:this.cancellations,priority:SCENE_GIZMO_INPUT_PRIORITY,
            pointerSource:this.lastPointerSource,
        };
    }
}
