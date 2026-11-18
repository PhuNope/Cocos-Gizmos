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

class HudBuilderImpl implements GizmoHudBuilder {
    private readonly children: GizmoHudNode[] = [];
    private widthValue?: number;
    private heightValue?: number;
    private growValue?: number;
    private gapValue = 6;
    private paddingValue = 8;
    private alignValue: GizmoHudAlign = 'stretch';
    private justifyValue: GizmoHudJustify = 'start';

    constructor(private readonly id: string,
        private readonly kind: 'row' | 'column' = 'column') {
        assertId(id);
    }

    public width(value: number): this { this.widthValue = finite(value, 'width', 40, 1200); return this; }
    public height(value: number): this { this.heightValue = finite(value, 'height', 16, 1000); return this; }
    public grow(value = 1): this { this.growValue = finite(value, 'grow', 0, 100); return this; }
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

    public row(id: string, children: (row: GizmoHudBuilder) => void): this {
        return this.container(id, 'row', children);
    }
    public column(id: string, children: (column: GizmoHudBuilder) => void): this {
        return this.container(id, 'column', children);
    }
    private container(id: string, kind: 'row' | 'column',
        callback: (builder: GizmoHudBuilder) => void): this {
        assertId(id);
        if (typeof callback !== 'function') throw new Error('GizmoHUD: group builder is required');
        const group = new HudBuilderImpl(id, kind);
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

    public button(id: string, text: string, command: GizmoHudActionCommand,
        options: GizmoHudItemOptions = {}): this {
        if (!command || command.kind !== 'action' || typeof command.execute !== 'function')
            throw new Error('GizmoHUD.button: an action command is required');
        this.leaf('button', id, text, command, options);
        return this;
    }

    public slider(id: string, text: string, command: GizmoHudPropertyCommand,
        options: GizmoHudSliderOptions): this {
        if (!options || !Number.isFinite(options.min) ||
            !Number.isFinite(options.max) || options.min >= options.max ||
            options.step !== undefined &&
            (!Number.isFinite(options.step) || options.step <= 0))
            throw new Error('GizmoHUD.slider: provide a valid min/max/step');
        this.leaf('slider', id, text, command, options);
        return this;
    }

    public checkbox(id: string, text: string, command: GizmoHudPropertyCommand,
        options: GizmoHudItemOptions = {}): this {
        this.leaf('checkbox', id, text, command, options);
        return this;
    }

    public toggle(id: string, text: string, command: GizmoHudPropertyCommand,
        options: GizmoHudItemOptions = {}): this {
        this.leaf('toggle', id, text, command, options);
        return this;
    }

    private leaf(kind: 'button' | 'slider' | 'checkbox' | 'toggle',
        id: string, text: string, command: GizmoHudCommand,
        options: GizmoHudItemOptions): void {
        assertId(id);
        if (!command || !['action','property'].includes(command.kind))
            throw new Error('GizmoHUD: invalid command');
        if (kind !== 'button' && (command.kind !== 'property' ||
            !HUD_PROPERTY.test(command.property)))
            throw new Error('GizmoHUD: value controls need a property command');
        this.children.push({
            kind, id, text:String(text).slice(0, 128), command,
            style:{ ...(options.style || {}) }, grow:options.grow,
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
            gap:this.gapValue, padding:this.paddingValue,
            align:this.alignValue, justify:this.justifyValue,
            children:[...this.children],
        };
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
            root:cloneTree(root) as GizmoHudContainer });
    }
}

export class GizmoHUD {
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
