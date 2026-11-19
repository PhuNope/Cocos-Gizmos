import { GizmoHudCommandController, GizmoHudCommandHooks } from './GizmoHUDController';
import { GizmoHUD, walkGizmoHUD } from './GizmoHUD';
import { normalizeHudStyle } from './GizmoHudStyle';

export interface GizmoHudView {
    component: any;
    definition: GizmoHudDefinition;
}

type OperationControl = {
    component: any;
    node: GizmoHudControlNode;
    element: HTMLElement;
    readout?: HTMLElement;
};
type ScrollbarGesture = { panel: HTMLElement; grabY: number };
type PanelStyle = { left: string; top: string; right: string; bottom: string };
type PanelDrag = {
    panel: HTMLElement;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    before: PanelStyle;
    prior: {left:number;top:number}|undefined;
};
type DomPanelDrag = {
    data: PanelDrag;
    view: Window | Document;
    handle: HTMLElement;
    pointerId: number | null;
    usesPointer: boolean;
};
type OperationGesture = {
    control: OperationControl | null;
    lastX: number;
    lastY: number;
    scrollbar?: ScrollbarGesture;
    drag?: PanelDrag;
};

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
    private portal = false;
    private signature = '';
    // JSON signatures cannot tell two deserialized Component objects with
    // the same Node UUID apart. Rebind Commands when Editor replaces an owner.
    private renderedOwners: any[] = [];
    private readonly items: GizmoHudView[] = [];
    private readonly liveInputs = new Map<string, HTMLInputElement>();
    private gesture: ActiveGesture | null = null;
    private operationGesture: OperationGesture | null = null;
    private domPanelDrag: DomPanelDrag | null = null;
    private readonly panelPositions = new Map<string,{left:number;top:number}>();
    private operationPanelDragCount = 0;
    private readonly operationControls: OperationControl[] = [];
    private operationAttemptCount = 0;
    private operationLastHit = 'not-checked';
    private operationDownCount = 0;
    private operationUpdateCount = 0;
    private operationCommitCount = 0;
    private operationWheelCount = 0;
    private operationScrollDragCount = 0;
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
    /**
     * Creator 3D Scene template uses a canvas within a webview whose parent
     * Editor Scene panel explicitly sets 'webview { pointer-events:none }'.
     * Native HTML controls inside that webview can render but cannot click.
     * Route 3D input from cce.Operation instead; keep working 2D DOM input.
     */
    public usesSceneOperationInput(): boolean {
        const doc=this.documentPort();
        return !!(doc?.getElementById?.('Cocos3dGameContainer') ||
            (doc?.getElementById?.('GameCanvas') as HTMLElement | null)
                ?.tagName?.toLowerCase()==='canvas');
    }
    public operationStatus() {
        return {enabled:this.usesSceneOperationInput(),
            captured:!!this.operationGesture,
            attempts:this.operationAttemptCount,lastHit:this.operationLastHit,
            down:this.operationDownCount,update:this.operationUpdateCount,
            commit:this.operationCommitCount,controls:this.operationControls.length,
            wheel:this.operationWheelCount,scrollDrag:this.operationScrollDragCount,
            panelDrag:this.operationPanelDragCount,
            domDragging:!!this.domPanelDrag};
    }
    private operationPoint(pointer:{x:number;y:number},
        viewport:{width:number;height:number} | null):{x:number;y:number}|null {
        if(!viewport || viewport.width<=0 || viewport.height<=0)return null;
        const doc=this.documentPort();
        const canvas=doc?.getElementById?.('GameCanvas') ||
            doc?.getElementById?.('GameDiv');
        const r=canvas?.getBoundingClientRect?.();
        if(!r || r.width<=0 || r.height<=0)return null;
        return {x:r.left+pointer.x*r.width/viewport.width,
            y:r.bottom-pointer.y*r.height/viewport.height};
    }
    private inside(el:HTMLElement,x:number,y:number):boolean {
        if(el.style.display==='none')return false;
        const r=el.getBoundingClientRect?.();
        return !!r && r.width>0 && r.height>0 &&
            x>=r.left && x<=r.right && y>=r.top && y<=r.bottom;
    }
    private visiblePanel(x:number,y:number): HTMLElement | null {
        if(!this.root || this.root.style.display==='none')return null;
        const children=Array.from(this.root.children) as HTMLElement[];
        // Reverse order matches the DOM stacking order for overlapping HUDs.
        return [...children].reverse().find(panel=>this.inside(panel,x,y))||null;
    }

    private panelKey(panel:HTMLElement):string {
        return panel.getAttribute?.('data-gizmo-hud-id') ||
            (panel as any).attributes?.['data-gizmo-hud-id'] || '';
    }
    private panelBounds():{left:number;top:number;width:number;height:number}|null {
        const r=this.host?.getBoundingClientRect?.();
        if(!r || !(r.width>0) || !(r.height>0))return null;
        return r;
    }
    private clamp(value:number,min:number,max:number):number {
        return Math.min(max,Math.max(min,value));
    }
    private setPanelPosition(panel:HTMLElement,left:number,top:number):void {
        const bounds=this.panelBounds();
        const rect=panel.getBoundingClientRect?.();
        if(!bounds || !rect || !Number.isFinite(left) || !Number.isFinite(top))
            return;
        const x=this.clamp(left,0,Math.max(0,bounds.width-rect.width));
        const y=this.clamp(top,0,Math.max(0,bounds.height-rect.height));
        Object.assign(panel.style,{
            left:x+'px',top:y+'px',right:'auto',bottom:'auto',
        });
        const key=this.panelKey(panel);
        if(key)this.panelPositions.set(key,{left:x,top:y});
    }
    private beginPanelDrag(panel:HTMLElement,x:number,y:number):PanelDrag|null {
        const bounds=this.panelBounds();
        const rect=panel.getBoundingClientRect?.();
        if(!bounds || !rect || !(rect.width>0) || !(rect.height>0))return null;
        const key=this.panelKey(panel);
        const stored=key?this.panelPositions.get(key):undefined;
        return {panel,startX:x,startY:y,originLeft:rect.left-bounds.left,
            originTop:rect.top-bounds.top,
            before:{left:panel.style.left,top:panel.style.top,
                right:panel.style.right,bottom:panel.style.bottom},
            prior:stored?{...stored}:undefined};
    }
    private movePanelDrag(gesture:PanelDrag,x:number,y:number):void {
        this.setPanelPosition(gesture.panel,
            gesture.originLeft+x-gesture.startX,
            gesture.originTop+y-gesture.startY);
    }
    private cancelPanelDrag(gesture:PanelDrag):void {
        Object.assign(gesture.panel.style,gesture.before);
        const key=this.panelKey(gesture.panel);
        if(key) {
            if(gesture.prior)this.panelPositions.set(key,gesture.prior);
            else this.panelPositions.delete(key);
        }
    }
    /** A visible 26px grip at the panel top, not slider/checkbox content. */
    private isDragHandle(panel:HTMLElement,x:number,y:number):boolean {
        const r=panel.getBoundingClientRect?.();
        return !!r && x>=r.left && x<=r.right-20 &&
            y>=r.top && y<=r.top+26;
    }
    private clampMovedPanels():void {
        if(!this.root || this.domPanelDrag || this.operationGesture)return;
        for(const panel of Array.from(this.root.children) as HTMLElement[]) {
            const stored=this.panelPositions.get(this.panelKey(panel));
            if(stored)this.setPanelPosition(panel,stored.left,stored.top);
        }
    }

    private scrollGeometry(panel:HTMLElement): {
        max:number; top:number; height:number; thumb:number; travel:number;
        right:number;
    } | null {
        const rect=panel.getBoundingClientRect?.();
        const client=panel.clientHeight;
        const total=panel.scrollHeight;
        if(!rect || !(rect.height>0) || !(client>0) || !(total>client+1))
            return null;
        const height=Math.max(1,rect.height-8);
        const max=total-client;
        const thumb=Math.min(height,Math.max(28,height*client/total));
        return {max,top:rect.top+4,height,thumb,
            travel:Math.max(1,height-thumb),right:rect.right};
    }

    private scrollFromDrag(gesture:ScrollbarGesture,y:number):void {
        const info=this.scrollGeometry(gesture.panel);
        if(!info)return;
        const thumbTop=y-info.top-gesture.grabY;
        gesture.panel.scrollTop=Math.max(0,Math.min(info.max,
            thumbTop/info.travel*info.max));
    }

    /**
     * The 3D Scene WebView is pointer-disabled by the Editor panel, so its
     * native scrollbar cannot receive mousedown either. Own the narrow right
     * scrollbar strip through the same Scene Operation pointer route.
     */
    private beginScrollDrag(panel:HTMLElement,x:number,y:number):
        ScrollbarGesture | null {
        const info=this.scrollGeometry(panel);
        if(!info || x<info.right-20)return null;
        const current=Math.max(0,Math.min(info.max,panel.scrollTop||0));
        const thumbTop=info.top+current/info.max*info.travel;
        const grabY=y>=thumbTop && y<=thumbTop+info.thumb ?
            y-thumbTop : info.thumb/2;
        const gesture={panel,grabY};
        this.scrollFromDrag(gesture,y);
        this.operationScrollDragCount++;
        return gesture;
    }

    /** Consume wheel only over a HUD panel. Outside it the Scene can zoom. */
    public operationWheel(pointer:{x:number;y:number},
        viewport:{width:number;height:number}|null,deltaY:number):boolean {
        if(!this.usesSceneOperationInput() || !viewport)return false;
        const pt=this.operationPoint(pointer,viewport);
        if(!pt)return false;
        const panel=this.visiblePanel(pt.x,pt.y);
        if(!panel)return false;
        this.operationWheelCount++;
        const info=this.scrollGeometry(panel);
        if(info && Number.isFinite(deltaY) && deltaY!==0)
            panel.scrollTop=Math.max(0,Math.min(info.max,
                (panel.scrollTop||0)+Math.max(-800,Math.min(800,deltaY))));
        // Even at the scroll limit, do not accidentally zoom the 3D camera.
        return true;
    }

    /** Scene Operation priority 100: hit-test the *visible panel* first. */
    public operationDown(pointer:{x:number;y:number},
        viewport:{width:number;height:number}|null):boolean {
        this.operationAttemptCount++;
        if(!this.usesSceneOperationInput()){
            this.operationLastHit='not-3d';return false;
        }
        if(this.operationGesture||this.gesture){
            this.operationLastHit='already-captured';return false;
        }
        if(this.root?.style.display==='none'||!this.root){
            this.operationLastHit='hidden';return false;
        }
        if(!viewport){
            this.operationLastHit='missing-viewport';return false;
        }
        const pt=this.operationPoint(pointer,viewport);
        if(!pt){this.operationLastHit='missing-canvas-rect';return false;}
        const panel=this.visiblePanel(pt.x,pt.y);
        if(!panel){
            this.operationLastHit='outside-panel';return false;
        }
        if(this.isDragHandle(panel,pt.x,pt.y)){
            const drag=this.beginPanelDrag(panel,pt.x,pt.y);
            if(drag){
                this.operationGesture={control:null,lastX:pt.x,lastY:pt.y,
                    drag};
                this.operationLastHit='drag-handle';
                this.operationPanelDragCount++;
                this.operationDownCount++;
                return true;
            }
        }
        const scrollbar=this.beginScrollDrag(panel,pt.x,pt.y);
        if(scrollbar){
            this.operationGesture={control:null,lastX:pt.x,lastY:pt.y,
                scrollbar};
            this.operationLastHit='scrollbar';
            this.operationDownCount++;
            return true;
        }
        // Panel padding and labels also belong to HUD and cannot unselect.
        const control=[...this.operationControls].reverse().find(item=>
            !item.node.disabled && (this.inside(item.element,pt.x,pt.y) ||
                (item.node.kind==='toggle'||item.node.kind==='checkbox') &&
                !!item.element.parentElement &&
                this.inside(item.element.parentElement,pt.x,pt.y)))||null;
        this.operationGesture={control,lastX:pt.x,lastY:pt.y};
        this.operationLastHit=control?control.node.kind:'panel-background';
        this.operationDownCount++;
        if(control?.node.kind==='slider' &&
            this.commands.begin(control.component,control.node)) {
            this.updateOperationSlider(control,pt.x);
        }
        return true;
    }
    private updateOperationSlider(entry:OperationControl,x:number):void {
        const {node,element,readout}=entry;
        if(node.kind!=='slider'||!this.commands.editing)return;
        const r=element.getBoundingClientRect?.();
        if(!r || r.width<=0 || node.min===undefined || node.max===undefined)return;
        const ratio=Math.max(0,Math.min(1,(x-r.left)/r.width));
        const raw=node.min+(node.max-node.min)*ratio;
        if(this.commands.update(raw)) {
            const command=node.command;
            const value=command.kind==='property' ?
                entry.component[command.property] :
                command.kind==='value'?command.read(entry.component):raw;
            (element as HTMLInputElement).value=String(value);
            if(readout)readout.textContent=String(value);
            this.operationUpdateCount++;
        }
    }
    public operationMove(pointer:{x:number;y:number},
        viewport:{width:number;height:number}|null):boolean {
        const held=this.operationGesture;
        if(!held)return false;
        const pt=viewport?this.operationPoint(pointer,viewport):null;
        if(pt) {held.lastX=pt.x;held.lastY=pt.y;}
        if(held.drag){
            this.movePanelDrag(held.drag,held.lastX,held.lastY);
            return true;
        }
        if(held.scrollbar) {
            this.scrollFromDrag(held.scrollbar,held.lastY);
            return true;
        }
        if(held.control?.node.kind==='slider')
            this.updateOperationSlider(held.control,held.lastX);
        return true;
    }
    public operationUp(pointer:{x:number;y:number}|null,
        viewport:{width:number;height:number}|null):boolean {
        const held=this.operationGesture;
        if(!held)return false;
        const pt=pointer && viewport?this.operationPoint(pointer,viewport):null;
        const x=pt?.x??held.lastX,y=pt?.y??held.lastY;
        this.operationGesture=null;
        if(held.drag){
            this.movePanelDrag(held.drag,x,y);
            return true;
        }
        if(held.scrollbar) {
            this.scrollFromDrag(held.scrollbar,y);
            return true;
        }
        const entry=held.control;
        if(entry?.node.kind==='slider'){
            this.updateOperationSlider(entry,x);
            this.commands.finish(false);
            this.operationCommitCount++;
        }else if(entry && (this.inside(entry.element,x,y) ||
            (entry.node.kind==='toggle'||entry.node.kind==='checkbox') &&
            !!entry.element.parentElement &&
            this.inside(entry.element.parentElement,x,y))){
            if(entry.node.kind==='button'){
                if(this.commands.click(entry.component,entry.node))
                    this.operationCommitCount++;
            }else if(entry.node.kind==='toggle'||entry.node.kind==='checkbox'){
                const command=entry.node.command;
                const previous=command.kind==='property'?
                    entry.component[command.property] :
                    command.kind==='value'?command.read(entry.component):false;
                const next=previous!==true;
                if(this.commands.commitValue(entry.component,entry.node,next)){
                    (entry.element as HTMLInputElement).checked=next;
                    this.operationCommitCount++;
                }
            }
        }
        this.signature='';
        return true;
    }
    public operationCancel():void {
        if(!this.operationGesture)return;
        this.operationGesture=null;
        if(this.commands.editing)this.commands.finish(true);
        if(this.operationGesture?.drag)this.cancelPanelDrag(this.operationGesture.drag);
        this.signature='';
    }
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
        if (this.gesture || this.operationGesture) {
            // Never replace a live slider while browser or Scene capture owns
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
        const scrollOffsets=new Map<string,number>();
        for(const existing of Array.from(this.root.children) as HTMLElement[]) {
            const key=existing.getAttribute?.('data-gizmo-hud-id') ||
                (existing as any).attributes?.['data-gizmo-hud-id'];
            if(key)scrollOffsets.set(key,existing.scrollTop||0);
        }
        const fragment=doc.createDocumentFragment();
        this.liveInputs.clear();
        this.operationControls.length=0;
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
                pointerEvents:'auto',
            });
            offsets[corner]=previous+(item.definition.root.height||150)+8;
            fragment.appendChild(panel);
        }
        this.root.replaceChildren(fragment);
        for(const panel of Array.from(this.root.children) as HTMLElement[]) {
            const key=panel.getAttribute?.('data-gizmo-hud-id') ||
                (panel as any).attributes?.['data-gizmo-hud-id'];
            if(key && scrollOffsets.has(key))
                panel.scrollTop=scrollOffsets.get(key)!;
        }
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

    private addPanelEvents(panel: HTMLElement): void {
        // The entire *visible* panel, including labels and padding, belongs
        // to the HUD. Only the transparent full-screen host passes Scene input.
        // Bubble listeners preserve button/input target handlers and native
        // checkbox/range default actions (do not preventDefault here).
        for(const kind of ['pointerdown','mousedown','pointerup','mouseup',
            'click','dblclick','contextmenu','wheel'] as const) {
            panel.addEventListener(kind,(event)=>this.stop(event));
        }
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
                    maxWidth:'min(420px, 40vw)',
                    maxHeight:'min(70vh, calc(100% - 24px))',
                    minHeight:'0', overflowY:'auto',overflowX:'hidden',
                    overscrollBehavior:'contain',
                    background:light?'rgba(247,249,253,.97)':'rgba(17,23,32,.95)',
                    color:light?'#202938':'#dce7ef',
                    border:light?'1px solid rgba(49,63,87,.22)':
                        '1px solid rgba(171,194,215,.2)',
                    borderRadius:'10px',
                    boxShadow:'0 8px 28px rgba(0,0,0,.32)',
                    pointerEvents:'none',
                });
                // The panel is opaque to picking; the full-screen host is not.
                element.style.pointerEvents='auto';
                this.addPanelEvents(element);
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
            this.operationControls.push({component:item.component,
                node,element:button});
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
            this.operationControls.push({component:item.component,
                node,element:input,readout:current});
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
            this.operationControls.push({component:item.component,
                node,element:input});
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
        // Switching focus from the Scene canvas to an HTML control is not
        // a drag cancellation. Use pointercancel/Escape/dispose instead.
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
        // No blur listener: normal Editor focus transitions keep slider alive.
        view.removeEventListener('keydown',this.onKeyDown,true);
        try{(gesture.element as any).releasePointerCapture?.(gesture.pointerId);}
        catch { /* DOM node may already be disconnected */ }
        this.commands.finish(cancelled);
        this.signature=''; // Reconcile dynamic values only after pointer-up.
    }

    /**
     * Mount in the Scene document's body, above the canvas stacking context.
     * Appending to GameDiv/GameCanvas rendered the panel visually but the
     * Editor's canvas layer could remain the pointer hit target in 3D.
     * A fixed, pointer-transparent portal covers only GameDiv's rectangle;
     * individual panels explicitly opt back into native pointer events.
     */
    private attach(doc: Document, host: HTMLElement): void {
        const bounds=host.getBoundingClientRect?.();
        const portal=!!(doc.body?.appendChild && bounds &&
            bounds.width>0 && bounds.height>0);
        const parent=portal?doc.body!:host;
        if(this.root && this.host!==host)this.dispose();
        if(!this.root) {
            this.root=doc.createElement('div');
            this.root.id='cocos-gizmos-builder-hud';
            Object.assign(this.root.style,{
                position:portal?'fixed':'absolute',display:'block',
                zIndex:'2147483647',
                pointerEvents:'none',
                overflow:'hidden',
                fontFamily:'system-ui, -apple-system, sans-serif',
            });
        }
        if(this.root.parentElement!==parent)parent.appendChild(this.root);
        if(this.host!==host || this.portal!==portal) {
            if(this.host && this.changedHostPosition)
                this.host.style.position=this.priorPosition;
            this.host=host;
            this.portal=portal;
            this.priorPosition=host.style.position;
            this.changedHostPosition=!portal &&
                (!host.style.position||host.style.position==='static');
            if(this.changedHostPosition)host.style.position='relative';
            this.signature='';
        }
        if(portal){
            // Keep the HUD pinned to the actual Scene viewport even as
            // Editor panes are resized or the viewport is moved.
            Object.assign(this.root.style,{
                position:'fixed',
                left:bounds!.left+'px', top:bounds!.top+'px',
                width:bounds!.width+'px',height:bounds!.height+'px',
                right:'auto',bottom:'auto',
            });
        }else {
            Object.assign(this.root.style,{
                position:'absolute',
                left:'0',top:'0',width:'100%',height:'100%',
                right:'auto',bottom:'auto',
            });
        }
    }

    public hide(): void {
        if(this.root && !this.gesture && !this.operationGesture)
            this.root.style.display='none';
    }

    public dispose(): void {
        this.operationCancel();
        this.releaseGesture(true);
        this.commands.cancel();
        this.root?.remove();
        if(this.host&&this.changedHostPosition)
            this.host.style.position=this.priorPosition;
        this.root=null;
        this.host=null;
        this.changedHostPosition=false;
        this.portal=false;
        this.signature='';
        this.renderedOwners=[];
        this.liveInputs.clear();
        this.operationControls.length=0;
        this.items.length=0;
    }
}
