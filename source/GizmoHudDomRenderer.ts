import { GizmoHudCommandController, GizmoHudCommandHooks } from './GizmoHUDController';
import { GizmoHUD, walkGizmoHUD } from './GizmoHUD';
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
    // JSON signatures cannot tell two deserialized Component objects with
    // the same Node UUID apart. Rebind Commands when Editor replaces an owner.
    private renderedOwners: any[] = [];
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
        // Persistent mounts are independent of per-frame Component callbacks.
        // Query the shared registry on every frame so show/hide/update works.
        const items=[...this.items, ...GizmoHUD.mounted().map(entry=>({
            component:entry.owner,definition:entry.definition,
        }))];
        if (!items.length) {
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
        const snapshot=items.map(item=>({
            node:item.component?.node?.uuid,
            definition:this.structureKey(item.definition),
            values:this.valuesKey(item),
        }));
        const signature=JSON.stringify(snapshot);
        const owners=items.map(item=>item.component);
        const sameOwners=owners.length===this.renderedOwners.length &&
            owners.every((component,index)=>component===this.renderedOwners[index]);
        if(this.signature===signature && sameOwners)return true;
        this.signature=signature;
        this.renderedOwners=owners;
        const fragment=doc.createDocumentFragment();
        this.liveInputs.clear();
        const offsets:Record<string,number>={};
        for(const item of items) {
            const panel=this.drawNode(doc,item,item.definition.root,
                item.definition.id,true);
            const corner=item.definition.position||'top-right';
            const previous=offsets[corner]||0;
            const top=corner.startsWith('top');
            const left=corner.endsWith('left');
            Object.assign(panel.style,{
                position:'absolute',
                [top?'top':'bottom']: (12+previous)+'px',
                [left?'left':'right']: '12px',
                pointerEvents:'none',
            });
            offsets[corner]=previous+(item.definition.root.height||150)+8;
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
                    node.style,node.shrink,node.basis,node.wrap,
                    (node.children || []).map(key)];
            if(!('command' in node))return [node.kind,node.id,node.text,node.style,'grow' in node?node.grow:undefined];
            return [node.kind,node.id,node.text,node.style,node.grow,
                node.min,node.max,node.step,
                node.command.kind,
                node.command.kind==='property'?node.command.property:null];
        };
        return [definition.id,definition.position,definition.theme,key(definition.root)];
    }

    private valuesKey(item: GizmoHudView): unknown {
        const result: unknown[]=[];
        walkGizmoHUD(item.definition.root,(node)=>{
            if(!('command' in node))return;
            if(node.command.kind==='property')
                result.push([node.id,item.component[node.command.property]]);
            else if(node.command.kind==='value')
                result.push([node.id,node.command.read(item.component)]);
            else if(node.command.commandId)
                result.push([node.id,GizmoHUD.commands.canExecute(
                    node.command.commandId,item.component)]);
            result.push([node.id,node.disabled,node.visible]);
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
        // The control's own click/change handlers must still run. Using
        // stopImmediatePropagation() here prevents later same-element
        // listeners (including our Button command) from ever firing.
        // stopPropagation() is sufficient to keep Editor Scene picking out.
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
        if ('visible' in node && node.visible===false)element.style.display='none';
        Object.assign(element.style,{
            boxSizing:'border-box', minWidth:'0',
            flexGrow: String('grow' in node ? node.grow ?? 0 : 0),
            // Only container nodes currently expose shrink and basis; leaf
            // defaults use the browser's native flex sizing.
            ...('children' in node ? {
                flexShrink: String(node.shrink ?? 1),
                ...(node.basis !== undefined ?
                    { flexBasis: node.basis + 'px' } : {}),
            } : {}),
        });
        if('children' in node) {
            Object.assign(element.style,{
                display:'flex',
                flexDirection:node.kind==='row'?'row':'column',
                flexWrap:node.wrap ? 'wrap' : 'nowrap',
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
            this.applyStyle(element,node.style);
            if(node.width!==undefined)element.style.width=node.width+'px';
            if(node.height!==undefined)element.style.height=node.height+'px';
            if(isRoot) {
                const light=item.definition.theme==='light';
                Object.assign(element.style,{
                    maxWidth:'min(420px, 40vw)', maxHeight:'70vh',
                    overflowY:'auto',
                    background:light?'rgba(247,249,253,.97)':'rgba(17,23,32,.95)',
                    color:light?'#202938':'#dce7ef',
                    border:light?'1px solid rgba(49,63,87,.22)':
                        '1px solid rgba(171,194,215,.2)',
                    borderRadius:'10px',
                    boxShadow:'0 8px 28px rgba(0,0,0,.32)',
                    pointerEvents:'none',
                });
                // Background remains pointer transparent; only actual
                // Button/Slider/Checkbox/Toggle controls own mouse input.
            }
            for(const child of node.children)
                element.appendChild(this.drawNode(doc,item,child,scope+'/'+node.id));
            return element;
        }
        this.applyStyle(element,node.style);
        if(node.kind==='separator') {
            Object.assign(element.style,{
                height:'1px',background:'rgba(159,180,205,.2)',
                margin:'4px 0',pointerEvents:'none',
            });
            return element;
        }
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
            button.textContent=node.icon ? node.icon+'  '+node.text : node.text;
            Object.assign(button.style,{
                cursor:'pointer',padding:'5px 10px',
                borderRadius:'6px',border:'1px solid rgba(112,197,189,.45)',
                color:'#f1fcfa',background:'#2c666f',
            });
            this.applyStyle(button,node.style);
            const registryDisabled=!!(node.command.kind==='action' &&
                node.command.commandId && !GizmoHUD.commands.canExecute(
                    node.command.commandId,item.component));
            button.disabled=!!node.disabled || registryDisabled;
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
                String(item.component[command.property]) :
                command.kind==='value'?String(command.read(item.component)):input.min;
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
                item.component[command.property]===true:
                command.kind==='value'?command.read(item.component)===true:false;
            input.addEventListener('change',()=>{
                this.commands.commitValue(item.component,node,input.checked);
            });
            element.appendChild(input);
        }
        input.disabled=!!node.disabled;
        this.addControlEvents(input);
        this.liveInputs.set(scope+'/'+node.id,input);
        if(node.visible===false)element.style.display='none';
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
                position:'absolute',display:'block',
                left:'0',right:'0',top:'0',bottom:'0',
                zIndex:'2147483001',
                pointerEvents:'none',
                overflow:'visible',
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
        this.renderedOwners=[];
        this.liveInputs.clear();
        this.items.length=0;
    }
}
