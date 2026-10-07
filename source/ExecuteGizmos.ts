import { Component, director, Director, Node } from 'cc';
import { Editor } from './Define';

if (Editor) {
    let root = director.getScene();

    if (!sessionStorage.getItem('gizmosUpdating')) {
        sessionStorage.setItem('gizmosUpdating', 'true');
        director.on(Director.EVENT_BEFORE_UPDATE, gizmosUpdate);
        director.on(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
            root = director.getScene();
        });
    }

    const gizmoComponents: Component[] = [];

    function collectGizmoComponents(node: Node, out: Component[]) {
        const components = node.components;
        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            if (typeof comp.onDrawGizmos === 'function') out.push(comp);
        }

        const children = node.children;
        for (let i = 0; i < children.length; i++) {
            collectGizmoComponents(children[i], out);
        }
    }

    function gizmosUpdate() {
        if (!root) return;

        gizmoComponents.length = 0;
        collectGizmoComponents(root, gizmoComponents);

        const selectedList: string[] = Editor.Selection.getSelected('node');
        for (let i = 0; i < gizmoComponents.length; i++) {
            const comp = gizmoComponents[i];
            if (comp.node.active && comp.enabled) {
                comp.onDrawGizmos?.();
                if (selectedList.includes(comp.node.uuid)) {
                    comp.onDrawGizmosSelected?.();
                }
            }
        }
    }
}
