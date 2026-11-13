import { _decorator, Color, Component, Layers, SpriteFrame, Vec2, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Attach to a Node in a 2D Scene and select it in the Hierarchy.
 * All Gizmos APIs are called only inside optional Scene Editor callbacks.
 * Use the Inspector to change fields and observe handles, HUD and shapes.
 */
@ccclass('Gizmos2DApiTest')
export default class Gizmos2DApiTest extends Component {
    @property
    public radius = 40;

    @property
    public showFilled = true;

    @property
    public showLabels = true;

    @property
    public showSprite = true;

    @property({ type: SpriteFrame })
    public testSprite: SpriteFrame | null = null;

    @property({ type: Vec3 })
    public point = new Vec3(0, 0, 0);

    @property({ type: [Vec3] })
    public waypoints: Vec3[] = [
        new Vec3(-130, -175, 0),
        new Vec3(130, -175, 0),
    ];

    /** Runtime-only diagnostic; nothing is serialized for this field. */
    public lastEvent = 'none';

    public onGizmoSettings(): GizmoViewSettings {
        return { display: 'always', hud: 'selected' };
    }

    public onGizmoHandles(): GizmoHandleList {
        const bounds = {
            min: { x: -600, y: -450 },
            max: { x: 600, y: 450 },
        };
        return [
            Gizmos2D.point('point', {
                snap: 5, color: '#ffcc00', bounds,
            }),
            ...Gizmos2D.points('waypoints', this.waypoints.length, {
                color: '#00ffff', bounds,
            }),
        ];
    }

    public onGizmoHud(): GizmoHudItem[] {
        return [
            { id: 'title', text: 'Gizmos2D API Test', order: 0, color: '#ffff88' },
            { id: 'radius', text: 'Radius: ' + this.radius, order: 1 },
            { id: 'point', text: 'Point: ' + this.point.x + ', ' + this.point.y, order: 2 },
            { id: 'event', text: 'Last event: ' + this.lastEvent, order: 3, fontSize: 12 },
        ];
    }

    public onGizmoHudControls(): GizmoHudControlList {
        return [
            {
                type: 'slider', id: 'radius', text: 'Radius',
                property: 'radius', min: 10, max: 90, step: 5,
            },
            { type: 'toggle', id: 'filled', text: 'Filled shapes', property: 'showFilled' },
            { type: 'checkbox', id: 'labels', text: 'Labels', property: 'showLabels' },
            { type: 'checkbox', id: 'sprite', text: 'Sprite', property: 'showSprite' },
            { type: 'button', id: 'reset', text: 'Reset test values' },
        ];
    }

    public onGizmoHudAction(id: string): void {
        if (id !== 'reset') return;
        this.radius = 40;
        this.showFilled = true;
        this.showLabels = true;
        this.showSprite = true;
        this.point = new Vec3();
        this.waypoints = [new Vec3(-130, -175, 0), new Vec3(130, -175, 0)];
        this.lastEvent = 'reset button';
    }

    public onGizmoHudChanged(
        name: string,
        phase: GizmoHandlePhase,
        value: number | boolean,
    ): void {
        this.lastEvent = name + ': ' + phase + ' -> ' + String(value);
    }

    public onGizmoChanged(name: string, phase: GizmoHandlePhase, index?: number): void {
        this.lastEvent = name + (index === undefined ? '' : '[' + index + ']') + ': ' + phase;
    }

    public onDrawGizmos(): void {
        const n = this.node;
        const r = this.radius;
        const v = (x: number, y: number) => new Vec2(x, y);

        Gizmos2D.beginLayer(n, Layers.Enum.GIZMOS);
        Gizmos2D.beginLocalPosition(n);

        // Outline shapes
        Gizmos2D.beginColor(n, Color.CYAN);
        Gizmos2D.drawCircle(n, v(-240, 160), r);
        Gizmos2D.drawEllipse(n, v(-100, 160), r * 1.25, r * 0.65);
        Gizmos2D.drawRect(n, v(20, 130), r * 2, r * 1.4);
        Gizmos2D.drawArc(n, v(245, 155), r, 20, 300, false);

        // Filled shapes
        if (this.showFilled) {
            Gizmos2D.beginColor(n, new Color(255, 120, 80, 170));
            Gizmos2D.drawSolidCircle(n, v(-240, 15), r * 0.8);
            Gizmos2D.drawSolidEllipse(n, v(-100, 15), r, r * 0.5);
            Gizmos2D.drawSolidRect(n, v(60, 15), r * 1.6, r);
            Gizmos2D.drawSolidArc(n, v(245, 15), r, 15, 155, false);
            Gizmos2D.drawSolidPolygon(n, [
                v(340, -15), v(375, 30), v(405, -10), v(385, -50),
            ]);
        }

        // Line and polyline
        Gizmos2D.beginColor(n, Color.GREEN);
        Gizmos2D.drawLine(n, v(-280, -90), v(-200, -130));
        Gizmos2D.drawLineList(n, [
            v(-165, -130), v(-135, -95), v(-105, -145), v(-75, -105),
        ]);
        Gizmos2D.drawLineList(n, [
            v(10, -135), v(55, -100), v(100, -135), v(55, -160),
        ], true);

        // Bezier and quadratic curves
        Gizmos2D.beginColor(n, Color.MAGENTA);
        Gizmos2D.drawBezierCurves(n,
            v(140, -130), v(160, -50), v(240, -200), v(270, -120));
        Gizmos2D.drawQuadraticCurve(n,
            v(300, -130), v(355, -40), v(410, -130));

        // Persistent label and sprite IDs exercise their cache.
        if (this.showLabels) {
            Gizmos2D.beginColor(n, Color.WHITE);
            Gizmos2D.drawLabel(n, 'api2d-title', 'Gizmos2D | Scene API',
                v(-260, 260), 20, Vec2.ONE, 12, 26);
            Gizmos2D.drawLabel(n, 'api2d-bottom', 'Drag the 3 points when selected',
                v(-160, -250), 16, Vec2.ONE, 11, 22);
        }
        if (this.showSprite && this.testSprite) {
            Gizmos2D.drawSprite(n, 'api2d-sprite', this.testSprite,
                v(340, 205), new Vec2(0.5, 0.5), Color.WHITE);
        }

        Gizmos2D.endLocalPosition(n);
        Gizmos2D.beginColor(n, Gizmos2D.DEFAULT_COLOR);
    }

    public onDrawGizmosSelected(): void {
        const n = this.node;
        Gizmos2D.beginLocalPosition(n);
        Gizmos2D.beginColor(n, Color.YELLOW);
        Gizmos2D.drawCircle(n, this.point, Math.max(8, this.radius * 0.3));
        Gizmos2D.drawLine(n, this.waypoints[0], this.waypoints[1]);
        Gizmos2D.drawLineList(n, [this.waypoints[0], this.point, this.waypoints[1]]);
        Gizmos2D.endLocalPosition(n);
        Gizmos2D.beginColor(n, Gizmos2D.DEFAULT_COLOR);
    }

    protected onRestore(): void {
        this.lastEvent = 'restored by Editor';
    }
}
