import { GizmoHudCommandController, GizmoHudCommandHooks } from './GizmoHUDController';
import { walkGizmoHUD } from './GizmoHUD';
import { normalizeHudStyle } from './GizmoHudStyle';

export interface GizmoHudView {
    component: any;
    definition: GizmoHudDefinition;
}

type ActiveGesture = {
    component: any;
    control: GizmoHudControlNode;
    element: HTMLElement;
    view: Window | Document;
    pointerId: number | null;
};

/**
 * DOM-only Scene adapter. Application Commands and layout data are completely
 * independent of Cocos Editor. CSS Flexbox is the layout engine, just as
 * Flexily's node tree maps to a layout backend.
 *
 * Separate from the legacy flattened textured HUD. A floating panel sits
 * at top right; native Scene picks/Camera still work outside its controls.
 */
export class GizmoHudDomRenderer {
    private root: HTMLElement | null = null;
    private host: HTMLElement | null = null;
    private priorPosition = '';
    private changedHostPosition = false;
    private signature = '';
    private readonly items: GizmoHudView[] = [];
    private readonly liveInputs = new Map<string, HTMLInputElement>();
    private gesture: ActiveGesture | null = null;
    private readonly commands: GizmoHudCommandController;

    constructor(
        private readonly documentPort: () => Document | null = () =>
            (globalThis as any).document || null,
        hooks: GizmoHudCommandHooks = {},
    ) {
        this.commands = new GizmoHudCommandController({
            ...hooks,
            dirty: (component) => {
                hooks.dirty?.(component);
                try {
                    const ctx = globalThis as any;
                    (ctx.cce || ctx.window?.cce)?.Engine?.repaintInEditMode?.();
                } catch { /* Scene may be closing */ }
            },
            error: (error) => {
                if (hooks.error) hooks.error(error);
                else console.warn('[cocos-gizmos/hud-builder]', error);
            },
        });
    }

    public beginFrame(): void { this.items.length = 0; }

    public queue(component: any, definition: GizmoHudDefinition): number {
        if (!component || !definition || definition.kind !== 'hud') return 0;
        this.items.push({component,definition});
        let count=0;
        walkGizmoHUD(definition.root,() => count++);
        return count;
    }

    public get active(): boolean { return !!this.root && this.root.style.display !== 'none'; }
    public get editing(): boolean { return this.commands.editing; }
    public canRender(): boolean {
        const doc=this.documentPort();
        const host=doc?.getElementById?.('GameDiv') ||
            doc?.getElementById?.('GameCanvas');
        return !!(doc?.createElement && host?.appendChild && host?.style);
    }

    public finishFrame(): boolean {
        if (!this.items.length) {
            if (!this.gesture) this.hide();
            return false;
        }
        const doc=this.documentPort();
        const host=doc?.getElementById?.('GameDiv') ||
            doc?.getElementById?.('GameCanvas');
        if (!doc || !host?.appendChild || !host.style) {
            this.hide();
            return false;
        }
        this.attach(doc,host);
        if (!this.root) return false;
        this.root.style.display='flex';
        if (this.gesture) {
            // Never replace a live slider while browser pointer capture owns
            // it. Cocos can redraw on every Component value update.
            return true;
        }
        const snapshot=this.items.map(item=>({
            node:item.component?.node?.uuid,
            definition:this.structureKey(item.definition),
            values:this.valuesKey(item),
        }));
        const signature=JSON.stringify(snapshot);
        if(this.signature===signature)return true;
        this.signature=signature;
        const fragment=doc.createDocumentFragment();
        this.liveInputs.clear();
        for(const item of this.items) {
            const panel=this.drawNode(doc,item,item.definition.root,
                item.definition.id,true);
            fragment.appendChild(panel);
        }
        this.root.replaceChildren(fragment);
        return true;
    }

    private structureKey(definition: GizmoHudDefinition): unknown {
        const key=(node: GizmoHudNode): unknown => {
            if('children' in node)
                return [node.kind,node.id,node.width,node.height,node.grow,
                    node.gap,node.padding,node.align,node.justify,
                    (node.children || []).map(key)];
            if(!('command' in node))return [node.kind,node.id,node.text,node.style,node.grow];
            return [node.kind,node.id,node.text,node.style,node.grow,
                node.min,node.max,node.step,
                node.command.kind,
                node.command.kind==='property'?node.command.property:null];
        };
        return [definition.id,key(definition.root)];
    }

    private valuesKey(item: GizmoHudView): unknown {
        const result: unknown[]=[];
        walkGizmoHUD(item.definition.root,(node)=>{
            if(!('command' in node) || node.command.kind!=='property')return;
            result.push([node.id,item.component[node.command.property]]);
        });
        return result;
    }

    private applyStyle(element: HTMLElement, source?: GizmoHudDomStyle): void {
        const style=normalizeHudStyle(source);
        if(style.color)element.style.color=style.color;
        if(style.backgroundColor)element.style.backgroundColor=style.backgroundColor;
        if(style.borderColor)element.style.borderColor=style.borderColor;
        if(style.borderWidth!==undefined)element.style.borderWidth=style.borderWidth+'px';
        if(style.borderRadius!==undefined)element.style.borderRadius=style.borderRadius+'px';
        if(style.fontSize!==undefined)element.style.fontSize=style.fontSize+'px';
        if(style.opacity!==undefined)element.style.opacity=String(style.opacity);
        if(style.fontWeight!==undefined)element.style.fontWeight=String(style.fontWeight);
        if(style.padding!==undefined)element.style.padding=style.padding+'px';
        if(style.letterSpacing!==undefined)
            element.style.letterSpacing=style.letterSpacing+'px';
        if(style.textAlign)element.style.textAlign=style.textAlign;
    }

    private stop(event: any): void {
        event?.stopImmediatePropagation?.();
        event?.stopPropagation?.();
    }

    private addControlEvents(element: HTMLElement): void {
        for(const kind of ['pointerdown','mousedown','click','dblclick','pointerup',
            'mouseup','wheel','keydown','keyup'] as const) {
            element.addEventListener(kind,(event)=>this.stop(event));
        }
        element.style.pointerEvents='auto';
    }

    private drawNode(doc: Document, item: GizmoHudView, node: GizmoHudNode,
        scope: string, isRoot = false): HTMLElement {
        const element=doc.createElement('div');
        element.setAttribute('data-gizmo-hud-id', scope + '/' + node.id);
        Object.assign(element.style,{
            boxSizing:'border-box', minWidth:'0',
            flexGrow: String(node.grow ?? 0),
        });
        if('children' in node) {
            Object.assign(element.style,{
                display:'flex',
                flexDirection:node.kind==='row'?'row':'column',
                flexWrap:'nowrap',
                alignItems:node.align==='start'?'flex-start':
                    node.align==='end'?'flex-end':node.align==='center'?
                    'center':'stretch',
                justifyContent:node.justify==='start'?'flex-start':
                    node.justify==='end'?'flex-end':node.justify==='between'?
                    'space-between':node.justify==='around'?'space-around':
                    node.justify==='evenly'?'space-evenly':'center',
                gap:(node.gap??6)+'px',
                padding:(node.padding??8)+'px',
                pointerEvents:'none',
            });
            if(node.width!==undefined)element.style.width=node.width+'px';
            if(node.height!==undefined)element.style.height=node.height+'px';
            if(isRoot) {
                Object.assign(element.style,{
                    maxWidth:'min(420px, 40vw)', maxHeight:'70vh',
                    overflowY:'auto',
                    background:'rgba(17,23,32,.95)',
                    border:'1px solid rgba(171,194,215,.2)',
                    borderRadius:'10px',
                    boxShadow:'0 8px 28px rgba(0,0,0,.32)',
                    pointerEvents:'auto',
                });
                // Panel background is visible; only actual control input
                // elements are interactive. Unused space does not pick Nodes.
                element.addEventListener('pointerdown',e=>this.stop(e));
                element.addEventListener('mousedown',e=>this.stop(e));
            }
            for(const child of node.children)
                element.appendChild(this.drawNode(doc,item,child,scope+'/'+node.id));
            return element;
        }
        this.applyStyle(element,node.style);
        if(!('command' in node)) {
            element.textContent=node.text;
            Object.assign(element.style,{
                fontSize:element.style.fontSize||'13px',
                color:element.style.color||'#dce7ef',
                pointerEvents:'none',
            });
            return element;
        }
        Object.assign(element.style,{
            display:'flex',alignItems:'center',gap:'8px',
            minHeight:'24px',color:element.style.color||'#dce7ef',
        });
        if(node.kind==='button') {
            const button=doc.createElement('button');
            button.type='button';
            button.textContent=node.text;
            Object.assign(button.style,{
                cursor:'pointer',padding:'5px 10px',
                borderRadius:'6px',border:'1px solid rgba(112,197,189,.45)',
                color:'#f1fcfa',background:'#2c666f',
            });
            this.applyStyle(button,node.style);
            this.addControlEvents(button);
            button.addEventListener('click',()=>{
                this.commands.click(item.component,node);
            });
            element.appendChild(button);
            return element;
        }
        const label=doc.createElement('label');
        label.textContent=node.text;
        Object.assign(label.style,{
            minWidth:'0',whiteSpace:'nowrap',fontSize:'12px',
            color:'inherit',flexShrink:'0',
        });
        element.appendChild(label);
        const input=doc.createElement('input');
        input.style.flex='1';
        input.style.accentColor='#69b8ae';
        if(node.kind==='slider'){
            input.type='range';
            input.min=String(node.min ?? 0);
            input.max=String(node.max ?? 100);
            input.step=String(node.step ?? 'any');
            const command=node.command;
            input.value=command.kind==='property' ?
                String(item.component[command.property]) : input.min;
            const current=doc.createElement('span');
            current.textContent=input.value;
            Object.assign(current.style,{
                color:'#a7b6c5',minWidth:'32px',fontSize:'11px',
                textAlign:'right',
            });
            input.addEventListener('pointerdown',(event:any)=>
                this.startGesture(doc,item.component,node,input,event));
            input.addEventListener('mousedown',(event:any)=>{
                if(typeof (doc.defaultView as any)?.PointerEvent!=='function')
                    this.startGesture(doc,item.component,node,input,event);
            });
            input.addEventListener('input',()=>{
                if(!this.gesture)this.commands.begin(item.component,node);
                this.commands.update(Number(input.value));
                current.textContent=input.value;
            });
            input.addEventListener('change',()=>this.releaseGesture(false));
            element.appendChild(input);
            element.appendChild(current);
        } else {
            input.type='checkbox';
            input.style.flex='none';
            const command=node.command;
            input.checked=command.kind==='property' ?
                item.component[command.property]===true:false;
            input.addEventListener('change',()=>{
                this.commands.commitValue(item.component,node,input.checked);
            });
            element.appendChild(input);
        }
        this.addControlEvents(input);
        this.liveInputs.set(scope+'/'+node.id,input);
        return element;
    }

    private readonly onPointerEnd=(event:any):void=>{
        const held=this.gesture;
        if(!held || held.pointerId!==null && event?.pointerId!==undefined &&
            event.pointerId!==held.pointerId)return;
        this.stop(event);
        this.releaseGesture(false);
    };

    private readonly onPointerCancel=(event:any):void=>{
        if(!this.gesture)return;
        this.stop(event);
        this.releaseGesture(true);
    };

    private readonly onKeyDown=(event:any):void=>{
        if(!this.gesture || event?.key!=='Escape' && event?.keyCode!==27)return;
        this.stop(event);
        this.releaseGesture(true);
    };

    private startGesture(doc: Document, component: any,
        control: GizmoHudControlNode, element: HTMLElement, event: any): void {
        if(event.button!==0 || this.gesture || !this.commands.begin(component,control))
            return;
        this.stop(event);
        const view:any=doc.defaultView?.addEventListener?doc.defaultView:doc;
        const pointer=typeof (doc.defaultView as any)?.PointerEvent==='function';
        const prefix=pointer?'pointer':'mouse';
        this.gesture={component,control,element,view,
            pointerId:Number.isInteger(event.pointerId)?event.pointerId:null};
        view.addEventListener(prefix+'up',this.onPointerEnd,true);
        view.addEventListener(pointer?'pointercancel':'mouseleave',this.onPointerCancel,true);
        view.addEventListener('blur',this.onPointerCancel,true);
        view.addEventListener('keydown',this.onKeyDown,true);
        try{(element as any).setPointerCapture?.(event.pointerId);}
        catch { /* window listener is still installed */ }
    }

    private releaseGesture(cancelled: boolean): void {
        const gesture=this.gesture;
        if(!gesture) {
            if(this.commands.editing)this.commands.finish(cancelled);
            return;
        }
        this.gesture=null;
        const view:any=gesture.view;
        // PointerEvent support must match the listener family used at begin.
        const pointer=typeof (view as any).PointerEvent==='function';
        const prefix=pointer?'pointer':'mouse';
        view.removeEventListener(prefix+'up',this.onPointerEnd,true);
        view.removeEventListener(pointer?'pointercancel':'mouseleave',
            this.onPointerCancel,true);
        view.removeEventListener('blur',this.onPointerCancel,true);
        view.removeEventListener('keydown',this.onKeyDown,true);
        try{(gesture.element as any).releasePointerCapture?.(gesture.pointerId);}
        catch { /* DOM node may already be disconnected */ }
        this.commands.finish(cancelled);
        this.signature=''; // Reconcile dynamic values only after pointer-up.
    }

    private attach(doc: Document, host: HTMLElement): void {
        if(this.root && this.host!==host)this.dispose();
        if(!this.root) {
            this.root=doc.createElement('div');
            this.root.id='cocos-gizmos-builder-hud';
            Object.assign(this.root.style,{
                position:'absolute',right:'12px',top:'12px',
                display:'flex',flexDirection:'column',alignItems:'flex-end',
                gap:'8px',zIndex:'2147483001',
                pointerEvents:'none',
                maxHeight:'75%',overflow:'visible',
                fontFamily:'system-ui, -apple-system, sans-serif',
            });
        }
        if(this.root.parentElement!==host)host.appendChild(this.root);
        if(this.host!==host){
            this.host=host;
            this.priorPosition=host.style.position;
            this.changedHostPosition=!host.style.position||
                host.style.position==='static';
            if(this.changedHostPosition)host.style.position='relative';
            this.signature='';
        }
    }

    public hide(): void {
        if(this.root && !this.gesture)this.root.style.display='none';
    }

    public dispose(): void {
        this.releaseGesture(true);
        this.commands.cancel();
        this.root?.remove();
        if(this.host&&this.changedHostPosition)
            this.host.style.position=this.priorPosition;
        this.root=null;
        this.host=null;
        this.changedHostPosition=false;
        this.signature='';
        this.liveInputs.clear();
        this.items.length=0;
    }
}
