/** Read-only Cocos-Gizmos extension demo. Drag from db://cocos-gizmos/Examples. */
import {
    _decorator, Color, Component, Mesh, SpriteFrame, Vec2, Vec3,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * Attach to a Node in a 3D Scene and focus the Scene camera near the Node.
 * World-space shapes are arranged around the node so each 3D API is visible.
 * No Gizmos runtime import is required in game scripts.
 */
@ccclass('CocosGizmos3DDemo')
export default class CocosGizmos3DDemo extends Component {
    @property
    public size = 1;

    @property
    public wireframe = true;

    @property
    public depthTest = true;

    @property
    public showLabels = true;

    @property
    public showOptionalAssets = true;

    @property({ type: SpriteFrame })
    public testSprite: SpriteFrame | null = null;

    @property({ type: Mesh })
    public testMesh: Mesh | null = null;

    @property({ type: Vec3 })
    public xyPoint = new Vec3(0, 1.5, 0);

    @property({ type: Vec3 })
    public xzPoint = new Vec3(2, 0, 2);

    @property({ type: Vec3 })
    public yzPoint = new Vec3(0, 2, -2);

    @property({ type: [Vec3] })
    public controlPoints: Vec3[] = [
        new Vec3(-2, 0, 0),
        new Vec3(-1, 1, 0),
        new Vec3(1, 1, 0),
        new Vec3(2, 0, 0),
    ];

    public lastEvent = 'none';

    public onGizmoSettings(): GizmoViewSettings {
        return { display: 'always', hud: 'selected' };
    }

    public onGizmoHandles(): GizmoHandleList {
        return [
            { property: 'xyPoint', plane: 'xy', space: 'local', snap: 0.25,
                color: '#ffcc00' },
            { property: 'xzPoint', plane: 'xz', space: 'local', snap: 0.25,
                color: '#00ffff' },
            { property: 'yzPoint', plane: 'yz', space: 'local', snap: 0.25,
                color: '#ff66ff' },
            { property: 'controlPoints', index: 0, plane: 'view', space: 'local',
                color: '#ffffff' },
            { property: 'controlPoints', index: 3, plane: 'xy', axis: 'x',
                space: 'local', color: '#99ff99' },
        ];
    }

    public onGizmoHud(): GizmoHudItem[] {
        return [
            { id: 'title', text: 'Gizmos3D API Test', order: 0, color: '#ffff88' },
            { id: 'size', text: 'Size: ' + this.size.toFixed(2), order: 1 },
            { id: 'depth', text: 'Depth test: ' + this.depthTest, order: 2 },
            { id: 'event', text: 'Last event: ' + this.lastEvent, order: 3, fontSize: 12 },
        ];
    }

    public onGizmoHudControls(): GizmoHudControlList {
        return [
            { type: 'slider', id: 'size', text: 'Shape size',
                property: 'size', min: 0.5, max: 3, step: 0.25 },
            { type: 'toggle', id: 'wire', text: 'Wireframe', property: 'wireframe' },
            { type: 'checkbox', id: 'depth', text: 'Depth test', property: 'depthTest' },
            { type: 'checkbox', id: 'labels', text: 'Labels', property: 'showLabels' },
            { type: 'button', id: 'reset', text: 'Reset 3D values' },
        ];
    }

    public onGizmoHudAction(id: string): void {
        if (id !== 'reset') return;
        this.size = 1;
        this.wireframe = true;
        this.depthTest = true;
        this.showLabels = true;
        this.xyPoint = new Vec3(0, 1.5, 0);
        this.xzPoint = new Vec3(2, 0, 2);
        this.yzPoint = new Vec3(0, 2, -2);
        this.lastEvent = 'reset button';
    }

    public onGizmoHudChanged(
        name: string, phase: GizmoHandlePhase, value: number | boolean,
    ): void {
        this.lastEvent = name + ': ' + phase + ' -> ' + String(value);
    }

    public onGizmoChanged(name: string, phase: GizmoHandlePhase, index?: number): void {
        this.lastEvent = name + (index === undefined ? '' : '[' + index + ']') + ': ' + phase;
    }

    public onDrawGizmos(): void {
        const n = this.node;
        const origin = n.worldPosition;
        const p = (x: number, y: number, z: number) =>
            new Vec3(origin.x + x, origin.y + y, origin.z + z);
        const s = this.size;
        const wire = this.wireframe;

        Gizmos3D.setDepTest(n, this.depthTest);

        // World-space axis and line APIs
        Gizmos3D.beginColor(n, Color.RED);
        Gizmos3D.drawLine(n, p(0, 0, 0), p(3, 0, 0));
        Gizmos3D.beginColor(n, Color.GREEN);
        Gizmos3D.drawLine(n, p(0, 0, 0), p(0, 3, 0));
        Gizmos3D.beginColor(n, Color.BLUE);
        Gizmos3D.drawLine(n, p(0, 0, 0), p(0, 0, 3));

        Gizmos3D.beginColor(n, Color.CYAN);
        Gizmos3D.drawLineList(n, [
            p(-9, 0, -7), p(-7, 1, -7), p(-5, 0, -7),
        ]);
        Gizmos3D.drawDashLine(n, p(-9, 0, -5), p(-5, 2, -5));
        Gizmos3D.drawDashLineList(n, [
            p(-9, 0, -3), p(-7, 1, -3), p(-5, 0, -3),
        ]);

        // Basic solids and wireframes
        Gizmos3D.beginColor(n, Color.YELLOW);
        Gizmos3D.drawSphere(n, p(-8, 1.5, 0), s, wire, 16, 12);
        Gizmos3D.drawCircle(n, p(-4, 1.5, 0), s, new Vec3(90, 0, 0), 32);
        Gizmos3D.drawDisc(n, p(0, 1.5, -6), s, Vec3.ZERO, wire, 24);
        Gizmos3D.drawBox(n, p(4, 1.5, -6),
            new Vec3(s * 2, s * 2, s * 2), new Vec3(0, 20, 0), wire);

        Gizmos3D.beginColor(n, Color.MAGENTA);
        Gizmos3D.drawCylinder(n, p(8, 1.5, -6), s * 0.65, s * 2.2,
            Vec3.ZERO, wire, 16);
        Gizmos3D.drawCone(n, p(-8, 1.5, 5), s * 0.85, s * 2,
            Vec3.ZERO, wire, 16);
        Gizmos3D.drawCapsule(n, p(-4, 1.5, 5), s * 0.5, s * 2.5,
            Vec3.ZERO, wire, 16, 8);
        Gizmos3D.drawOctahedron(n, p(0, 1.5, 5), s, Vec3.ZERO, wire);
        Gizmos3D.drawCross(n, p(4, 1.5, 5), s * 2);

        // Polygon, quad, arc and solid arc
        Gizmos3D.beginColor(n, Color.GREEN);
        Gizmos3D.drawPolygon(n, p(8, 1.5, 5), s, 6, Vec3.ZERO, wire);
        Gizmos3D.drawQuad(n,
            p(-4, 0, 9), p(-2, 0, 9), p(-2, 2, 9), p(-4, 2, 9), wire);
        Gizmos3D.drawArc(n, p(0, 1.5, 9), s, 20, 300,
            Vec3.ZERO, 24);
        Gizmos3D.drawSolidArc(n, p(4, 1.5, 9), s, 20, 160,
            Vec3.ZERO, wire, 24);

        // Curve and spline APIs
        Gizmos3D.beginColor(n, Color.CYAN);
        Gizmos3D.drawBezier(n,
            p(-8, 0, 10), p(-7, 3, 10),
            p(-5, -1, 10), p(-4, 1, 10),
            Vec3.ZERO, 24);
        Gizmos3D.drawSpline(n, [
            p(-8, 0, 13), p(-7, 2, 13), p(-5, -1, 13), p(-4, 1, 13),
        ]);

        // Raw indexed Mesh needs no imported asset; test both fill modes.
        const tetrahedron = {
            vertices: [
                new Vec3(0, s * 1.3, 0),
                new Vec3(-s, -s * 0.6, -s),
                new Vec3(s, -s * 0.6, -s),
                new Vec3(0, -s * 0.6, s),
            ],
            indices: [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2],
        };
        Gizmos3D.beginColor(n, Color.YELLOW);
        Gizmos3D.drawMesh(n, tetrahedron, p(0, 1.5, 13),
            Vec3.ZERO, Vec3.ONE, wire);

        // Optional assets: import a readable Mesh or SpriteFrame in Inspector.
        if (this.showOptionalAssets && this.testMesh) {
            Gizmos3D.drawMesh(n, this.testMesh, p(4, 1.5, 13),
                Vec3.ZERO, Vec3.ONE, wire);
        }
        if (this.showOptionalAssets && this.testSprite) {
            Gizmos3D.drawSprite(n, 'api3d-sprite', this.testSprite,
                p(8, 2.5, 10), new Vec2(0.4, 0.4), Color.WHITE);
        }

        // Reusable label IDs verify no label proliferation per frame.
        if (this.showLabels) {
            Gizmos3D.beginColor(n, Color.WHITE);
            Gizmos3D.drawLabel(n, 'api3d-title', 'Gizmos3D API Test',
                p(-4, 5, 0), 18, 0.15);
            Gizmos3D.drawLabel(n, 'api3d-hint', 'Select node to move colored handles',
                p(-4, 4, 0), 14, 0.12);
        }
        Gizmos3D.beginColor(n, Gizmos3D.DEFAULT_COLOR);
    }

    public onDrawGizmosSelected(): void {
        const n = this.node;

        // Local-space conversion API: all points below are relative to Node.
        Gizmos3D.beginLocalPosition(n);
        Gizmos3D.beginColor(n, Color.YELLOW);
        Gizmos3D.drawLine(n, Vec3.ZERO, this.xyPoint);
        Gizmos3D.drawLine(n, Vec3.ZERO, this.xzPoint);
        Gizmos3D.drawLine(n, Vec3.ZERO, this.yzPoint);
        Gizmos3D.drawSphere(n, this.xyPoint, 0.2, false, 12, 8);
        Gizmos3D.drawLineList(n, this.controlPoints);
        Gizmos3D.endLocalPosition(n);
        Gizmos3D.beginColor(n, Gizmos3D.DEFAULT_COLOR);
    }

    protected onRestore(): void {
        this.lastEvent = 'restored by Editor';
    }
}
