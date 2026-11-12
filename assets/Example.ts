import { _decorator, Color, Component, Vec2, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('Gizmos.Example')
export default class GizmosExample extends Component {
    @property
    public radius = 100;

    /**
     * Draws the range in the Scene View while the Gizmos extension is enabled.
     * The method is optional and requires no registration decorator.
     */
    public onDrawGizmos(): void {
        Gizmos2D.beginColor(this.node, Color.GREEN);
        Gizmos2D.drawCircle(this.node, new Vec2(0, 0), this.radius);
    }

    /**
     * Draws a 3D marker when this node is selected in the Scene View.
     */
    public onDrawGizmosSelected(): void {
        Gizmos3D.beginColor(this.node, Color.YELLOW);
        Gizmos3D.drawSphere(this.node, this.node.worldPosition, 1);
        Gizmos3D.drawLine(
            this.node,
            this.node.worldPosition,
            new Vec3(this.node.worldPosition.x, this.node.worldPosition.y + 2, this.node.worldPosition.z),
        );
    }
}
