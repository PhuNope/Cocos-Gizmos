import { GizmoEditSession } from './GizmoEditSession';

/** Application-layer command dispatcher for GizmoHUD trees.
 * Never imports DOM, cc, cce, Editor or a native Gizmo base class.
 * The host provides optional Undo/Inspector hooks at the composition root.
 */
export interface GizmoHudCommandHooks {
    begin?(component: any, property: string): void;
    update?(component: any, property: string): void;
    end?(component: any, property: string, cancelled: boolean): void;
    dirty?(component: any): void;
    error?(error: unknown): void;
}

export class GizmoHudCommandController {
    private active: { owner: any; node: GizmoHudControlNode;
        session: GizmoEditSession<number | boolean> } | null = null;

    constructor(private readonly hooks: GizmoHudCommandHooks = {}) {}

    private safe(label: string, call: () => void): void {
        try { call(); }
        catch (error) {
            // Inspector integration is optional; failure must not make a
            // valid user gesture cancel after just one update.
            this.hooks.error?.(new Error('GizmoHUD ' + label + ': ' + String(error)));
        }
    }

    private notify(owner: any, property: string,
        phase: GizmoHandlePhase, value: number | boolean): void {
        this.safe('onGizmoHudChanged', () =>
            owner.onGizmoHudChanged?.(property, phase, value));
    }

    public get editing(): boolean { return this.active !== null; }

    public begin(owner: any, node: GizmoHudControlNode): boolean {
        if (this.active || !owner || node.kind === 'button' ||
            node.command.kind !== 'property') return false;
        const property = node.command.property;
        const original = owner[property];
        if (node.kind === 'slider' ?
            typeof original !== 'number' || !Number.isFinite(original) :
            typeof original !== 'boolean') return false;
        const session=new GizmoEditSession<number | boolean>(
            () => owner[property],
            (value) => {owner[property]=value;},
            {
                begin: (value) => {
                    this.safe('begin', () => this.hooks.begin?.(owner,property));
                    this.notify(owner,property,'begin',value);
                },
                update: (value) => {
                    this.notify(owner,property,'update',value);
                    this.safe('update', () => this.hooks.update?.(owner,property));
                    this.safe('dirty', () => this.hooks.dirty?.(owner));
                },
                rollback: (value) => {
                    this.safe('rollback', () => this.hooks.dirty?.(owner));
                },
                end: (value,cancelled,changed) => {
                    this.notify(owner,property,cancelled?'cancel':'end',value);
                    this.safe('end', () => this.hooks.end?.(
                        owner,property,cancelled||!changed));
                    this.safe('dirty', () => this.hooks.dirty?.(owner));
                },
            },
        );
        this.active={owner,node,session};
        try {
            if (!session.begin()) {
                this.active=null;
                return false;
            }
            return true;
        } catch(error){
            this.active=null;
            this.safe('begin',()=>this.hooks.error?.(error));
            return false;
        }
    }

    public update(next: number | boolean): boolean {
        const edit=this.active;
        if(!edit)return false;
        let value: number | boolean=next;
        if(edit.node.kind==='slider') {
            if(typeof next!=='number' || !Number.isFinite(next)) return false;
            const min=edit.node.min, max=edit.node.max;
            if(typeof min!=='number'||typeof max!=='number'||!(max>min))
                return false;
            const step=edit.node.step;
            value=Math.max(min,Math.min(max,step ?
                min + Math.round((next-min)/step)*step : next));
            value=Math.round(value*1e6)/1e6;
        } else if(typeof next!=='boolean')return false;
        try { return edit.session.apply(value); }
        catch(error){
            this.finish(true);
            this.safe('update',()=>this.hooks.error?.(error));
            return false;
        }
    }

    public finish(cancelled=false): boolean {
        const edit=this.active;
        if(!edit)return false;
        this.active=null;
        try { return edit.session.finish(cancelled); }
        catch(error) {
            this.safe('finish',()=>this.hooks.error?.(error));
            return false;
        }
    }

    public commitValue(owner: any,node: GizmoHudControlNode,
        value: number | boolean): boolean {
        if(!this.begin(owner,node))return false;
        this.update(value);
        this.finish(false);
        return true;
    }

    public click(owner: any,node: GizmoHudControlNode): boolean {
        if(node.kind!=='button' || node.command.kind!=='action')return false;
        try {
            node.command.execute(owner);
            this.safe('dirty',()=>this.hooks.dirty?.(owner));
            return true;
        }catch(error){
            this.safe('action',()=>this.hooks.error?.(error));
            return false;
        }
    }

    public cancel(): void { this.finish(true); }
}
