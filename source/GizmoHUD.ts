/**
 * Editor-neutral HUD description and fluent layout builder.
 *
 * Inspired by Flexily's composable flex nodes, but intentionally does NOT
 * bundle a second layout engine: DOM renders the tree with CSS Flexbox.
 * The same immutable tree can later be measured by a non-DOM renderer.
 *
 * The builder knows nothing about Cocos, Scene selection, HTML or Undo.
 * Commands are declarative values; execution happens in the application
 * layer, never during build().
 */
const HUD_ID = /^[a-zA-Z_$][a-zA-Z0-9_$:.-]{0,127}$/;
const HUD_PROPERTY = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function finite(value: number, label: string, minimum = 0, maximum = 1024): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum)
        throw new Error('GizmoHUD: invalid ' + label + ' (' + value + ')');
    return value;
}

function assertId(id: string): void {
    if (typeof id !== 'string' || !HUD_ID.test(id))
        throw new Error('GizmoHUD: invalid HUD/element id: ' + String(id));
}

function cloneTree(node: GizmoHudNode): GizmoHudNode {
    if (node.kind === 'row' || node.kind === 'column') {
        const children = node.children.map(cloneTree);
        return Object.freeze({
            ...node,
            style: Object.freeze({ ...(node.style || {}) }),
            children: Object.freeze(children),
        }) as GizmoHudNode;
    }
    return Object.freeze({
        ...node,
        style: Object.freeze({ ...(node.style || {}) }),
    }) as GizmoHudNode;
}

/**
 * Registered actions are an application concern. Definitions carry only an ID;
 * no Editor or DOM dependency leaks into the domain builder.
 */
export class GizmoHudCommandRegistry {
    private readonly entries = new Map<string, GizmoHudRegisteredCommand>();

    public register(command: GizmoHudRegisteredCommand): () => void {
        if (!command || typeof command.execute !== 'function') throw new Error('GizmoHUD.commands: invalid command');
        assertId(command.id);
        if (this.entries.has(command.id)) throw new Error('GizmoHUD.commands: duplicate ' + command.id);
        this.entries.set(command.id, command);
        return () => { if (this.entries.get(command.id) === command) this.entries.delete(command.id); };
    }
    public get(id: string): GizmoHudRegisteredCommand | undefined { return this.entries.get(id); }
    public canExecute(id: string, context: any): boolean {
        const command = this.entries.get(id);
        if (!command) return false;
        try { return command.canExecute ? command.canExecute(context) === true : true; }
        catch { return false; }
    }
    public execute(id: string, context: any): boolean {
        if (!this.canExecute(id, context)) return false;
        this.entries.get(id)!.execute(context);
        return true;
    }
    public unregister(id: string): boolean { return this.entries.delete(id); }
    public clear(): void { this.entries.clear(); }
}

type MountedHudRecord = {
    owner: any;
    definition: GizmoHudDefinition;
    visible: boolean;
    revision: number;
};
const MOUNTED_KEY = '__cocosGizmosHudMountsV3';
function mounts(): Map<string, MountedHudRecord> {
    // Share the Scene mount registry across the game ESM and Editor CJS
    // copies of GizmoHUD; they are intentionally different modules.
    const scope = globalThis as any;
    return scope[MOUNTED_KEY] || (scope[MOUNTED_KEY] = new Map<string, MountedHudRecord>());
}
function updateNode(node: GizmoHudNode, id: string,
    fields: Partial<GizmoHudNode>): GizmoHudNode {
    if (node.id === id) return cloneTree({ ...node, ...fields } as GizmoHudNode);
    if (node.kind === 'row' || node.kind === 'column')
        return cloneTree({ ...node, children: node.children.map(child =>
            updateNode(child, id, fields)) } as GizmoHudContainer);
    return node;
}

/** A mounted definition is a data handle, not a DOM element or cc.Node. */
export class GizmoHudMount {
    private disposed = false;
    constructor(public readonly id: string, private readonly state: MountedHudRecord) {}
    private touch(): void { this.state.revision++; }
    public show(): this { if (!this.disposed) { this.state.visible = true; this.touch(); } return this; }
    public hide(): this { if (!this.disposed) { this.state.visible = false; this.touch(); } return this; }
    public update(definition: GizmoHudDefinition): this {
        if (this.disposed) return this;
        if (definition.id !== this.id) throw new Error('GizmoHUD.mount: definition ID mismatch');
        this.state.definition = definition;
        this.touch();
        return this;
    }
    public get(id: string): GizmoHudElementHandle {
        assertId(id);
        const exists=(node:GizmoHudNode):boolean=>node.id===id ||
            (node.kind==='row'||node.kind==='column') && node.children.some(exists);
        if (!exists(this.state.definition.root))
            throw new Error('GizmoHUD.mount: unknown element ' + id);
        const patch=(fields: Partial<GizmoHudNode>): void=>{
            if(this.disposed)return;
            this.state.definition=Object.freeze({
                ...this.state.definition,
                root:updateNode(this.state.definition.root,id,fields) as GizmoHudContainer,
            });
            this.touch();
        };
        return {
            setText: (text: string) => {patch({text:String(text).slice(0,1024)} as any);return this;},
            setDisabled: (disabled: boolean) => {patch({disabled:!!disabled} as any);return this;},
            setVisible: (visible: boolean) => {patch({visible:!!visible} as any);return this;},
        };
    }
    public unmount(): void { this.destroy(); }
    public destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (mounts().get(this.id) === this.state) mounts().delete(this.id);
    }
}

class HudBuilderImpl implements GizmoHudBuilder {
    private readonly children: GizmoHudNode[] = [];
    private nextId = 0;
    private positionValue: GizmoHudPosition = 'top-right';
    private themeValue: GizmoHudTheme = 'dark';
    private widthValue?: number;
    private heightValue?: number;
    private growValue?: number;
    private shrinkValue?: number;
    private basisValue?: number;
    private wrapValue = false;
    private styleValue: GizmoHudDomStyle = {};
    private gapValue = 6;
    private paddingValue = 8;
    private alignValue: GizmoHudAlign = 'stretch';
    private justifyValue: GizmoHudJustify = 'start';

    constructor(private readonly id: string,
        private readonly kind: 'row' | 'column' = 'column') {
        assertId(id);
    }

    private autoId(prefix: string): string { return prefix + '-' + (++this.nextId); }
    public title(value: string): this {
        this.text(this.autoId('title'),value,{style:{fontSize:16,fontWeight:600}});
        return this;
    }
    public position(value: GizmoHudPosition): this {
        if (!['top-left','top-right','bottom-left','bottom-right'].includes(value))
            throw new Error('GizmoHUD: invalid position');
        this.positionValue=value;return this;
    }
    public theme(value: GizmoHudTheme): this {
        if (value !== 'dark' && value !== 'light') throw new Error('GizmoHUD: invalid theme');
        this.themeValue=value;return this;
    }
    public size(width: number, height?: number | 'auto'): this {
        this.width(width);
        if(height !== undefined && height !== 'auto')this.height(height);
        return this;
    }
    public label(text: string, options: GizmoHudItemOptions = {}): this {
        return this.text(this.autoId('label'),text,options);
    }
    public separator(): this {
        this.children.push({kind:'separator',id:this.autoId('separator'),text:''});
        return this;
    }
    public width(value: number): this { this.widthValue = finite(value, 'width', 40, 1200); return this; }
    public height(value: number): this { this.heightValue = finite(value, 'height', 16, 1000); return this; }
    public grow(value = 1): this { this.growValue = finite(value, 'grow', 0, 100); return this; }
    public shrink(value = 1): this { this.shrinkValue = finite(value, 'shrink', 0, 100); return this; }
    public basis(value: number): this { this.basisValue = finite(value, 'basis', 0, 1200); return this; }
    public wrap(value = true): this {
        if (typeof value !== 'boolean') throw new Error('GizmoHUD: wrap must be boolean');
        this.wrapValue = value;
        return this;
    }
    public style(value: GizmoHudDomStyle): this {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('GizmoHUD: style must be an object');
        this.styleValue = { ...value };
        return this;
    }
    public gap(value: number): this { this.gapValue = finite(value, 'gap', 0, 64); return this; }
    public padding(value: number): this { this.paddingValue = finite(value, 'padding', 0, 64); return this; }
    public align(value: GizmoHudAlign): this {
        if (!['start', 'center', 'end', 'stretch'].includes(value))
            throw new Error('GizmoHUD: invalid align');
        this.alignValue = value; return this;
    }
    public justify(value: GizmoHudJustify): this {
        if (!['start', 'center', 'end', 'between', 'around', 'evenly'].includes(value))
            throw new Error('GizmoHUD: invalid justify');
        this.justifyValue = value; return this;
    }

    public row(id: string | GizmoHudGroupOptions, children: (row: GizmoHudBuilder) => void): this {
        return this.container(id, 'row', children);
    }
    public column(id: string | GizmoHudGroupOptions, children: (column: GizmoHudBuilder) => void): this {
        return this.container(id, 'column', children);
    }
    private container(input: string | GizmoHudGroupOptions, kind: 'row' | 'column',
        callback: (builder: GizmoHudBuilder) => void): this {
        const id=typeof input==='string'?input:this.autoId(kind);
        assertId(id);
        if (typeof callback !== 'function') throw new Error('GizmoHUD: group builder is required');
        const group = new HudBuilderImpl(id, kind);
        if (typeof input!=='string') {
            if(input.gap!==undefined)group.gap(input.gap);
            if(input.padding!==undefined)group.padding(input.padding);
            if(input.align!==undefined)group.align(input.align);
            if(input.justify!==undefined)group.justify(input.justify);
            if(input.style!==undefined)group.style(input.style);
        }
        callback(group);
        this.children.push(group.snapshot());
        return this;
    }

    public text(id: string, text: string, options: GizmoHudItemOptions = {}): this {
        assertId(id);
        this.children.push({ kind:'text', id, text:String(text).slice(0, 1024),
            style:{ ...(options.style || {}) }, grow:options.grow });
        return this;
    }

    public button(id: string, textOrOptions: string | GizmoHudButtonOptions,
        command?: GizmoHudActionCommand, options: GizmoHudItemOptions = {}): this {
        if(typeof textOrOptions !== 'string') {
            const settings=textOrOptions;
            const descriptor=typeof settings.command==='string' ?
                GizmoHUD.command(settings.command) : settings.command;
            if(!descriptor || descriptor.kind!=='action')
                throw new Error('GizmoHUD.button: provide a registered command or an action');
            this.leaf('button',this.autoId('button'),id,descriptor,settings);
            const node=this.children[this.children.length-1] as any;
            node.icon=settings.icon;
            node.variant=settings.variant;
            return this;
        }
        if (!command || command.kind !== 'action' || typeof command.execute !== 'function')
            throw new Error('GizmoHUD.button: an action command is required');
        this.leaf('button', id, textOrOptions, command, options);
        return this;
    }

    public slider(id: string, textOrOptions: string | GizmoHudSliderInput,
        command?: GizmoHudPropertyCommand, options?: GizmoHudSliderOptions): this {
        const convenient=typeof textOrOptions!=='string';
        const opts=convenient?textOrOptions as GizmoHudSliderInput:options!;
        if (!opts || !Number.isFinite(opts.min) ||
            !Number.isFinite(opts.max) || opts.min >= opts.max ||
            opts.step !== undefined &&
            (!Number.isFinite(opts.step) || opts.step <= 0))
            throw new Error('GizmoHUD.slider: provide a valid min/max/step');
        const descriptor=convenient?this.valueCommand(opts):command;
        if(!descriptor) throw new Error('GizmoHUD.slider: command required');
        this.leaf('slider',convenient?this.autoId('slider'):id,
            convenient?id:textOrOptions as string,descriptor,opts);
        return this;
    }

    private valueCommand(options: GizmoHudValueInput): GizmoHudCommand {
        if(options.property)return GizmoHUD.bind(options.property);
        if(typeof options.onChange !== 'function' ||
           typeof options.value !== 'number' && typeof options.value !== 'boolean')
            throw new Error('GizmoHUD: provide property or value + onChange');
        let current=options.value;
        return {kind:'value',read:()=>current,write:(_owner,value)=>{
            current=value;options.onChange?.(value);
        }};
    }
    public checkbox(id: string, textOrOptions: string | GizmoHudValueInput,
        command?: GizmoHudPropertyCommand, options: GizmoHudItemOptions = {}): this {
        const convenient=typeof textOrOptions!=='string';
        this.leaf('checkbox',convenient?this.autoId('checkbox'):id,
            convenient?id:textOrOptions as string,
            convenient?this.valueCommand(textOrOptions):command!,convenient?textOrOptions:options);
        return this;
    }

    public toggle(id: string, textOrOptions: string | GizmoHudValueInput,
        command?: GizmoHudPropertyCommand, options: GizmoHudItemOptions = {}): this {
        const convenient=typeof textOrOptions!=='string';
        this.leaf('toggle',convenient?this.autoId('toggle'):id,
            convenient?id:textOrOptions as string,
            convenient?this.valueCommand(textOrOptions):command!,convenient?textOrOptions:options);
        return this;
    }

    private leaf(kind: 'button' | 'slider' | 'checkbox' | 'toggle',
        id: string, text: string, command: GizmoHudCommand,
        options: GizmoHudItemOptions): void {
        assertId(id);
        if (!command || !['action','property','value'].includes(command.kind))
            throw new Error('GizmoHUD: invalid command');
        if (kind !== 'button' && (command.kind !== 'property' &&
            command.kind !== 'value' || command.kind === 'property' &&
            !HUD_PROPERTY.test(command.property)))
            throw new Error('GizmoHUD: value controls need a binding command');
        this.children.push({
            kind, id, text:String(text).slice(0, 128), command,
            style:{ ...(options.style || {}) }, grow:options.grow,
            disabled: options.disabled, visible: options.visible,
            ...(kind === 'slider' ? {
                min:(options as GizmoHudSliderOptions).min,
                max:(options as GizmoHudSliderOptions).max,
                step:(options as GizmoHudSliderOptions).step,
            } : {}),
        } as GizmoHudNode);
    }

    private snapshot(): GizmoHudContainer {
        return {
            kind:this.kind, id:this.id,
            width:this.widthValue, height:this.heightValue, grow:this.growValue,
            shrink:this.shrinkValue, basis:this.basisValue,
            wrap:this.wrapValue, style:{...this.styleValue},
            gap:this.gapValue, padding:this.paddingValue,
            align:this.alignValue, justify:this.justifyValue,
            children:[...this.children],
        };
    }

    public mount(owner: any = {}): GizmoHudMount {
        return GizmoHUD.mount(this.build(),owner);
    }

    public build(): GizmoHudDefinition {
        const ids = new Set<string>();
        let total = 0;
        const visit = (node: GizmoHudNode, depth: number): void => {
            if (depth > 8 || ++total > 64)
                throw new Error('GizmoHUD: maximum depth 8 and 64 nodes');
            if (ids.has(node.id))
                throw new Error('GizmoHUD: duplicate element id: ' + node.id);
            ids.add(node.id);
            if (node.kind === 'row' || node.kind === 'column')
                node.children.forEach(child => visit(child, depth + 1));
        };
        const root=this.snapshot();
        visit(root,0);
        return Object.freeze({ kind:'hud' as const, id:this.id,
            position:this.positionValue, theme:this.themeValue,
            root:cloneTree(root) as GizmoHudContainer });
    }
}

export class GizmoHUD {
    public static readonly commands = new GizmoHudCommandRegistry();

    public static command(id: string): GizmoHudActionCommand {
        assertId(id);
        return Object.freeze({
            kind:'action' as const, commandId:id,
            execute: (owner: any) => GizmoHUD.commands.execute(id, owner),
        });
    }

    public static mount(definition: GizmoHudDefinition, owner: any = {}): GizmoHudMount {
        if (!definition || definition.kind!=='hud') throw new Error('GizmoHUD.mount: invalid definition');
        if (mounts().has(definition.id)) throw new Error('GizmoHUD.mount: HUD already mounted: '+definition.id);
        const state:MountedHudRecord={owner,definition,visible:true,revision:0};
        mounts().set(definition.id,state);
        return new GizmoHudMount(definition.id,state);
    }

    /** Read-only views for the Scene DOM adapter (mounted HUDs survive frames). */
    public static mounted(): readonly MountedHudRecord[] {
        return [...mounts().values()].filter(item=>item.visible);
    }

    /** A composable column by default; add nested row()/column() groups. */
    public static createHud(id = 'hud'): GizmoHudBuilder {
        return new HudBuilderImpl(id);
    }

    /** Bind a Slider/Checkbox/Toggle to an actual Component property. */
    public static bind(property: string): GizmoHudPropertyCommand {
        if (typeof property !== 'string' || !HUD_PROPERTY.test(property))
            throw new Error('GizmoHUD.bind: expected a simple Component property name');
        return Object.freeze({ kind:'property' as const, property });
    }

    /** Bind a Button to a command evaluated only on click. */
    public static action(execute: (component: any) => void): GizmoHudActionCommand {
        if (typeof execute !== 'function')
            throw new Error('GizmoHUD.action: execute must be a function');
        return Object.freeze({ kind:'action' as const, execute });
    }
}

/** Domain traversal; no DOM, Cocos, renderer or application imports. */
export function walkGizmoHUD(root: GizmoHudContainer,
    visitor: (node: GizmoHudNode) => void): void {
    for (const child of root.children) {
        visitor(child);
        if (child.kind === 'row' || child.kind === 'column')
            walkGizmoHUD(child, visitor);
    }
}
