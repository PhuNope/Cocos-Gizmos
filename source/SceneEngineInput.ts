import { Input, input } from 'cc';
import { readScenePointer, isPrimaryScenePointer } from './SceneGizmoInput';
import { consumeOwnedSceneEvent } from './SceneSelectionLease';
import type { SceneViewportInputPorts, ViewportPointer } from './SceneViewportInput';

export interface EngineInputPort {
    source: { on(type: string, fn: (event: any) => void): void;
        off(type: string, fn: (event: any) => void): void; };
    events: { down: string; move: string; up: string };
}

/** Cocos engine input fallback when the Editor Scene Script has no WebView
 * DOM access. Does not allocate a Collider/Node or depend on a gizmo mesh.
 * Prefer window-capture DOM input when available, because it can prevent
 * native Scene selection before the Editor's own target listeners run.
 */
export class SceneEngineInput {
    private boundPort: EngineInputPort | null = null;
    private captured = false;
    private observed = 0;
    private intercepted = 0;
    private hoverCount = 0;
    private reason = 'not-mounted';

    constructor(
        private readonly ports: SceneViewportInputPorts,
        private readonly inputPort: () => EngineInputPort | null = () => {
            const types = Input?.EventType;
            if (!input?.on || !input?.off || !types?.MOUSE_DOWN ||
                !types?.MOUSE_MOVE || !types?.MOUSE_UP) return null;
            return { source: input, events: {
                down: types.MOUSE_DOWN,
                move: types.MOUSE_MOVE,
                up: types.MOUSE_UP,
            } };
        },
    ) {}

    public refresh(enabled: boolean): void {
        if (!enabled) {
            if(this.captured){
                this.reason='engine-transition-deferred';
                return;
            }
            this.detach();
            this.reason = 'higher-priority-scene-input';
            return;
        }
        if (this.boundPort) return;
        const port=this.inputPort();
        if (!port?.source?.on || !port?.source?.off) {
            this.reason='engine-input-unavailable';
            return;
        }
        this.boundPort=port;
        port.source.on(port.events.down,this.onDown);
        port.source.on(port.events.move,this.onMove);
        port.source.on(port.events.up,this.onUp);
        this.reason='engine-mouse-fallback';
    }

    private translate(event: any): ViewportPointer | null {
        const point=readScenePointer(event);
        if(!point)return null;
        let button=typeof event?.button==='number'?event.button:0;
        if(typeof event?.getButton==='function') {
            try{button=event.getButton();}
            catch { /* optional Cocos EventMouse method */ }
        }
        return {
            x:point.x,y:point.y,
            button,buttons:typeof event?.buttons==='number'?event.buttons:1,
            event,
        };
    }

    private readonly onDown=(event:any):void=>{
        if(this.captured || !isPrimaryScenePointer(event))return;
        const point=this.translate(event);
        if(!point)return;
        this.observed++;
        try {
            if(!this.ports.down(point)) {
                this.ports.hover(point);
                return;
            }
            this.captured=true;
            this.intercepted++;
            consumeOwnedSceneEvent(event);
        }catch(error){
            this.captured=false;
            try{this.ports.cancel();}finally{throw error;}
        }
    };
    private readonly onMove=(event:any):void=>{
        const point=this.translate(event);
        if(!point)return;
        this.observed++;
        if(this.captured){
            consumeOwnedSceneEvent(event);
            this.ports.move(point);
        }else{
            this.hoverCount++;
            this.ports.hover(point);
        }
    };
    private readonly onUp=(event:any):void=>{
        if(!this.captured)return;
        consumeOwnedSceneEvent(event);
        this.captured=false;
        const point=this.translate(event);
        if(point)this.ports.up(point);
        else this.ports.cancel();
    };

    public detach():void {
        if(this.boundPort){
            const {source,events}=this.boundPort;
            source.off(events.down,this.onDown);
            source.off(events.move,this.onMove);
            source.off(events.up,this.onUp);
        }
        if(this.captured){
            this.captured=false;
            this.ports.cancel();
        }
        this.boundPort=null;
        this.reason='detached';
    }

    public status():{active:boolean;reason:string;captured:boolean;
        observed:number;intercepted:number;hover:number} {
        return {
            active:!!this.boundPort,reason:this.reason,captured:this.captured,
            observed:this.observed,intercepted:this.intercepted,hover:this.hoverCount,
        };
    }
}
