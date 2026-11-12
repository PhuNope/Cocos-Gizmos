import {
    _decorator,
    CCObject,
    Color,
    Component,
    Graphics,
    IVec2Like,
    Label,
    Layers,
    Node,
    Sprite,
    SpriteFrame,
    toRadian,
    Vec2,
    Vec3,
} from 'cc';
import { DrawCommandBuffer2D } from './DrawCommandBuffer2D';

const { ccclass, executeInEditMode } = _decorator;

class GizmosRenderer {
    public readonly commands = new DrawCommandBuffer2D();
    private readonly previous: number[] = [];
    private hasGeometry = false;

    constructor(private readonly graphic: Graphics) {}

    public draw(): void {
        if (this.commands.isEmpty) {
            if (this.hasGeometry) {
                this.graphic.clear();
                this.hasGeometry = false;
            }
            this.previous.length = 0;
            return;
        }

        if (this.hasGeometry && this.commands.equals(this.previous)) {
            this.commands.reset();
            return;
        }

        this.commands.copyTo(this.previous);
        try {
            this.graphic.clear();
            this.commands.replay(this.graphic);
            this.hasGeometry = true;
        } catch (error) {
            this.previous.length = 0;
            this.hasGeometry = false;
            throw error;
        }
    }
}

@ccclass('Gizmos2D.GizmosDebugDraw')
@executeInEditMode
class GizmosDebugDraw extends Component {
    private readonly _renderers = new Map<string, GizmosRenderer>();
    private readonly _labelMap = new Map<string, Label>();
    private readonly _spriteMap = new Map<string, Sprite>();
    private _color: Color = Gizmos2D.DEFAULT_COLOR;
    private _useLocalPosition = false;
    private _layer: Layers.Enum = Gizmos2D.DEFAULT_LAYER;
    private _drawCallsNoneGeometry: (() => void)[] = [];

    protected lateUpdate(dt: number): void {
        this._labelMap.forEach((label) => {
            label.string = '';
        });

        this._spriteMap.forEach((sprite) => {
            sprite.spriteFrame = null;
        });

        this._renderers.forEach((renderer) => renderer.draw());

        for (const drawCall of this._drawCallsNoneGeometry) drawCall();
        this._drawCallsNoneGeometry.length = 0;

        this._color = Gizmos2D.DEFAULT_COLOR;
        this._useLocalPosition = false;
        this._layer = Gizmos2D.DEFAULT_LAYER;
    }

    private createRenderer(color: Color, layer: Layers.Enum): GizmosRenderer {
        const node = new Node('Gizmo2DGraphics');
        const graphic = node.addComponent(Graphics);
        graphic.lineWidth = 5;
        graphic.strokeColor = color.clone();
        graphic.fillColor = color.clone();
        node.layer = layer;
        node.parent = this.node;
        node.setPosition(Vec3.ZERO);
        return new GizmosRenderer(graphic);
    }

    private getRenderer(color: Color): GizmosRenderer {
        // Color.toHEX() does not encode alpha, so keep all four channels.
        const key = [color.r, color.g, color.b, color.a, this._layer].join(':');
        let renderer = this._renderers.get(key);
        if (!renderer) {
            renderer = this.createRenderer(color, this._layer);
            this._renderers.set(key, renderer);
        }
        return renderer;
    }

    private worldToLocal(point: IVec2Like): IVec2Like {
        const local = new Vec3();
        this.node.inverseTransformPoint(local, new Vec3(point.x, point.y));
        return local;
    }

    private localPoint(point: IVec2Like): IVec2Like {
        return this._useLocalPosition ? point : this.worldToLocal(point);
    }

    private getSprite(id: string): Sprite {
        let sprite = this._spriteMap.get(id);
        if (!sprite) {
            sprite = new Node('spriteID: ' + id).addComponent(Sprite);
            this._spriteMap.set(id, sprite);
            sprite.node.layer = this.node.layer;
            sprite.node.setParent(this.node);
        }
        return sprite;
    }

    private getLabel(id: string): Label {
        let label = this._labelMap.get(id);
        if (!label) {
            label = new Node('labelID: ' + id).addComponent(Label);
            this._labelMap.set(id, label);
            label.node.layer = this.node.layer;
            label.node.setParent(this.node);
        }
        return label;
    }

    public setColor(color: Color): void {
        this._color = color;
    }

    public setUseLocalPosition(value: boolean): void {
        this._useLocalPosition = value;
    }

    public setLayer(layer: Layers.Enum): void {
        this._layer = layer;
    }

    public drawSprite(
        id: string,
        spriteFrame: SpriteFrame,
        position: IVec2Like,
        scale: Vec2 = Vec2.ONE,
        color: Color = Color.WHITE,
    ): void {
        const sprite = this.getSprite(id);
        const local = this._useLocalPosition;
        sprite.node.layer = this._layer;
        this._drawCallsNoneGeometry.push(() => {
            sprite.color = color;
            sprite.spriteFrame = spriteFrame;
            sprite.node.setScale(new Vec3(scale.x, scale.y));
            const p = new Vec3(position.x, position.y);
            if (local) sprite.node.setPosition(p);
            else sprite.node.setWorldPosition(p);
        });
    }

    public drawLabel(id: string, text: string, position: IVec2Like, fontSize: number = 40, scale: Vec2 = Vec2.ONE): void {
        const label = this.getLabel(id);
        const local = this._useLocalPosition;
        const color = this._color.clone();
        label.node.layer = this._layer;
        this._drawCallsNoneGeometry.push(() => {
            label.color = color;
            label.fontSize = fontSize;
            label.lineHeight = fontSize;
            label.string = text;
            label.node.setScale(new Vec3(scale.x, scale.y));
            const p = new Vec3(position.x, position.y);
            if (local) label.node.setPosition(p);
            else label.node.setWorldPosition(p);
        });
    }

    public drawLine(start: IVec2Like, end: IVec2Like): void {
        const a = this.localPoint(start);
        const b = this.localPoint(end);
        const commands = this.getRenderer(this._color).commands;
        commands.moveTo(a.x, a.y);
        commands.lineTo(b.x, b.y);
        commands.stroke();
    }

    public drawLineList(points: IVec2Like[], close = false): void {
        if (!points.length) return;
        const commands = this.getRenderer(this._color).commands;
        const first = this.localPoint(points[0]);
        commands.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i++) {
            const p = this.localPoint(points[i]);
            commands.lineTo(p.x, p.y);
        }
        if (close) commands.close();
        commands.stroke();
    }

    public drawCircle(center: IVec2Like, radius: number): void {
        const c = this.localPoint(center);
        const commands = this.getRenderer(this._color).commands;
        commands.circle(c.x, c.y, radius);
        commands.stroke();
    }

    public drawSolidCircle(center: IVec2Like, radius: number): void {
        const c = this.localPoint(center);
        const commands = this.getRenderer(this._color).commands;
        commands.circle(c.x, c.y, radius);
        commands.fill();
    }

    public drawRect(position: IVec2Like, width: number, height: number): void {
        const p = this.localPoint(position);
        const commands = this.getRenderer(this._color).commands;
        commands.rect(p.x, p.y, width, height);
        commands.stroke();
    }

    public drawSolidRect(position: IVec2Like, width: number, height: number): void {
        const p = this.localPoint(position);
        const commands = this.getRenderer(this._color).commands;
        commands.rect(p.x - width / 2, p.y - height / 2, width, height);
        commands.fill();
    }

    public drawSolidPolygon(points: IVec2Like[]): void {
        if (points.length < 3) return;
        const commands = this.getRenderer(this._color).commands;
        const first = this.localPoint(points[0]);
        commands.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i++) {
            const p = this.localPoint(points[i]);
            commands.lineTo(p.x, p.y);
        }
        commands.close();
        commands.fill();
    }

    public drawEllipse(center: IVec2Like, radiusX: number, radiusY: number): void {
        const c = this.localPoint(center);
        const commands = this.getRenderer(this._color).commands;
        commands.ellipse(c.x, c.y, radiusX, radiusY);
        commands.stroke();
    }

    public drawSolidEllipse(center: IVec2Like, radiusX: number, radiusY: number): void {
        const c = this.localPoint(center);
        const commands = this.getRenderer(this._color).commands;
        commands.ellipse(c.x, c.y, radiusX, radiusY);
        commands.fill();
    }

    public drawArc(
        center: IVec2Like,
        radius: number,
        startAngle: number,
        endAngle: number,
        counterclockwise = false,
    ): void {
        const c = this.localPoint(center);
        const from = toRadian(startAngle);
        const commands = this.getRenderer(this._color).commands;
        commands.moveTo(c.x + Math.cos(from) * radius, c.y + Math.sin(from) * radius);
        commands.arc(c.x, c.y, radius, from, toRadian(endAngle), counterclockwise);
        commands.stroke();
    }

    public drawSolidArc(
        center: IVec2Like,
        radius: number,
        startAngle: number,
        endAngle: number,
        counterclockwise = false,
    ): void {
        const c = this.localPoint(center);
        const from = toRadian(startAngle);
        const commands = this.getRenderer(this._color).commands;
        commands.moveTo(c.x + Math.cos(from) * radius, c.y + Math.sin(from) * radius);
        commands.arc(c.x, c.y, radius, from, toRadian(endAngle), counterclockwise);
        commands.lineTo(c.x, c.y);
        commands.fill();
    }

    public drawBezierCurves(a: IVec2Like, b: IVec2Like, c: IVec2Like, d: IVec2Like): void {
        const first = this.localPoint(a);
        const control1 = this.localPoint(b);
        const control2 = this.localPoint(c);
        const end = this.localPoint(d);
        const commands = this.getRenderer(this._color).commands;
        commands.moveTo(first.x, first.y);
        commands.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
        commands.stroke();
    }

    public drawQuadraticCurve(a: IVec2Like, b: IVec2Like, c: IVec2Like): void {
        const first = this.localPoint(a);
        const control = this.localPoint(b);
        const end = this.localPoint(c);
        const commands = this.getRenderer(this._color).commands;
        commands.moveTo(first.x, first.y);
        commands.quadraticCurveTo(control.x, control.y, end.x, end.y);
        commands.stroke();
    }
}

export class Gizmos2D {
    public static readonly DEFAULT_COLOR = Color.BLUE;
    public static readonly DEFAULT_LAYER = Layers.Enum.GIZMOS;
    private static readonly _debugNodes = new WeakMap<Node, GizmosDebugDraw>();

    private static getDebugNode(node: Node) {
        const cached = this._debugNodes.get(node);
        if (cached && cached.isValid !== false && cached.node?.isValid !== false && cached.node?.parent === node) {
            return cached;
        }
        let debugNode = node.getComponentInChildren(GizmosDebugDraw);
        if (!debugNode) {
            debugNode = new Node('DEBUG_DRAW2D_NODE').addComponent(GizmosDebugDraw);
            debugNode.node.layer = this.DEFAULT_LAYER;
            debugNode.node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
            debugNode.node.parent = node;
            debugNode.node.setPosition(Vec3.ZERO);
        }
        this._debugNodes.set(node, debugNode);
        return debugNode;
    }

    public static beginColor(node: Node, color: Color) {
        this.getDebugNode(node).setColor(color);
    }

    public static beginLocalPosition(node: Node) {
        this.getDebugNode(node).setUseLocalPosition(true);
    }

    public static endLocalPosition(node: Node) {
        this.getDebugNode(node).setUseLocalPosition(false);
    }

    public static drawSprite(
        node: Node,
        id: string,
        spriteFrame: SpriteFrame,
        position: IVec2Like,
        scale: Vec2 = Vec2.ONE,
        color: Color = Color.WHITE,
    ) {
        this.getDebugNode(node).drawSprite(id, spriteFrame, position, scale, color);
    }

    public static drawLabel(
        node: Node,
        id: string,
        text: string,
        point: IVec2Like,
        fontSize: number = 40,
        scale: Vec2 = Vec2.ONE,
    ) {
        this.getDebugNode(node).drawLabel(id, text, point, fontSize, scale);
    }

    public static beginLayer(node: Node, layer: Layers.Enum) {
        this.getDebugNode(node).setLayer(layer);
    }

    public static drawLine(node: Node, point1: IVec2Like, point2: IVec2Like) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawLine(point1, point2);
    }

    public static drawLineList(node: Node, points: IVec2Like[], close: boolean = false) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawLineList(points, close);
    }

    public static drawCircle(node: Node, center: IVec2Like, radius: number) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawCircle(center, radius);
    }

    public static drawSolidCircle(node: Node, center: IVec2Like, radius: number) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawSolidCircle(center, radius);
    }

    public static drawRect(node: Node, position: IVec2Like, width: number, height: number) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawRect(position, width, height);
    }

    public static drawSolidRect(node: Node, position: IVec2Like, width: number, height: number) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawSolidRect(position, width, height);
    }

    public static drawSolidPolygon(node: Node, positions: IVec2Like[]) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawSolidPolygon(positions);
    }

    public static drawEllipse(node: Node, center: IVec2Like, radiusX: number, radiusY: number) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawEllipse(center, radiusX, radiusY);
    }

    public static drawSolidEllipse(node: Node, center: IVec2Like, radiusX: number, radiusY: number) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawSolidEllipse(center, radiusX, radiusY);
    }

    public static drawArc(
        node: Node,
        center: IVec2Like,
        radius: number,
        startAngle: number,
        endAngle: number,
        counterclockwise: boolean = false,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawArc(center, radius, startAngle, endAngle, counterclockwise);
    }

    public static drawSolidArc(
        node: Node,
        center: IVec2Like,
        radius: number,
        startAngle: number,
        endAngle: number,
        counterclockwise: boolean = false,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawSolidArc(center, radius, startAngle, endAngle, counterclockwise);
    }

    public static drawBezierCurves(
        node: Node,
        point1: IVec2Like,
        point2: IVec2Like,
        point3: IVec2Like,
        point4: IVec2Like,
    ) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawBezierCurves(point1, point2, point3, point4);
    }

    public static drawQuadraticCurve(node: Node, point1: IVec2Like, point2: IVec2Like, point3: IVec2Like) {
        const debugNode = this.getDebugNode(node);
        debugNode.drawQuadraticCurve(point1, point2, point3);
    }
}

