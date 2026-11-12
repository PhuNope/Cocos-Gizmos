/**
 * Read-only diagnostics for a live Creator Scene process.
 * This intentionally does not invoke controller events or mutate the Scene.
 * It cannot prove native mouse picking or Undo without real user interaction.
 */
type UnknownRecord = Record<string, any>;

export interface GizmoSmokeReport {
    scene: {
        updaterStarted: boolean;
        name: string | null;
        components: number;
        callbackErrors: number;
        engineFrames: number;
        selectionApi: boolean;
        selectedNodeCount: number | null;
    };
    bridge: {
        componentPoolAccessible: boolean;
        colliderControllerAvailable: boolean;
        hasCreateGizmo: boolean;
        hasShowComponentGizmo: boolean;
        cameraWorldToScreen: boolean;
        cameraScreenPointToRay: boolean;
        cameraSource: 'direct' | 'wrapped' | 'missing';
        hasNativeControlBegin: boolean;
        hasNativeControlEnd: boolean;
        hasNativeControlCancel: boolean;
    };
    handles: UnknownRecord;
    concerns: string[];
    requiresManualVerification: string[];
}

function safely<T>(run: () => T, fallback: T): T {
    try { return run(); }
    catch { return fallback; }
}

export function buildGizmoSmokeReport(
    editor: any,
    cce: any,
    updater: UnknownRecord | null,
    handleState: UnknownRecord | null,
): GizmoSmokeReport {
    const selection = safely<unknown>(() => editor?.Selection?.getSelected?.('node'), null);
    const selectionCount = Array.isArray(selection) ? selection.length : null;
    const pool = safely<any>(() => cce?.Gizmo?._gizmoPool?._getPool?.('component'), null);
    const ctor = pool?.typeDefs?.['cc.BoxCollider'];
    const controller = ctor?.prototype;
    const cameraApi = cce?.Camera;
    const cam = cameraApi?.camera || cameraApi?._camera?.camera;
    const cameraSource = cameraApi?.camera ? 'direct' :
        cameraApi?._camera?.camera ? 'wrapped' : 'missing';
    const report: GizmoSmokeReport = {
        scene: {
            updaterStarted: updater?.started === true,
            name: typeof updater?.scene === 'string' ? updater.scene : null,
            components: typeof updater?.components === 'number' ? updater.components : 0,
            callbackErrors: typeof updater?.errors === 'number' ? updater.errors : 0,
            engineFrames: typeof updater?.engineFrames === 'number' ? updater.engineFrames : 0,
            selectionApi: updater?.selectionApi === true && selectionCount !== null,
            selectedNodeCount: selectionCount,
        },
        bridge: {
            componentPoolAccessible: !!pool?.typeDefs,
            colliderControllerAvailable: typeof ctor === 'function',
            hasCreateGizmo: typeof cce?.Gizmo?.createGizmo === 'function',
            hasShowComponentGizmo: typeof cce?.Gizmo?.showComponentGizmo === 'function',
            cameraWorldToScreen: typeof cam?.worldToScreen === 'function',
            cameraScreenPointToRay: typeof cam?.screenPointToRay === 'function',
            cameraSource,
            hasNativeControlBegin: typeof controller?.onControlBegin === 'function',
            hasNativeControlEnd: typeof controller?.onControlEnd === 'function',
            hasNativeControlCancel: typeof controller?.onControlCancel === 'function',
        },
        handles: handleState ? {
            registered: handleState.registered ?? 0,
            active: handleState.active ?? 0,
            reason: handleState.reason ?? 'unknown',
            positionHandles: handleState.positionHandles ?? 0,
            hudControls: handleState.hudControls ?? 0,
            draggingPosition: handleState.draggingPosition ?? 0,
            draggingSlider: handleState.draggingSlider ?? 0,
            pendingClicks: handleState.pendingClicks ?? 0,
        } : { registered: 0, active: 0, reason: 'not-loaded' },
        concerns: [],
        requiresManualVerification: [
            'Click and drag a position handle in the real Scene View',
            'Click Button, Slider, Toggle and Checkbox in the real Scene View',
            'Check Ctrl+Z and Ctrl+Shift+Z with a serialized component and Prefab instance',
            'Change selection and close the Scene while dragging',
            'Verify the Inspector and Prefab override indicator update',
        ],
    };

    if (!report.scene.updaterStarted) report.concerns.push('Scene updater is not running');
    if (!report.scene.name) report.concerns.push('No active Scene detected');
    if (!report.scene.selectionApi) report.concerns.push('Scene selection API is unavailable');
    if (!report.bridge.componentPoolAccessible || !report.bridge.colliderControllerAvailable) {
        report.concerns.push('Private component Gizmo bridge is unavailable on this Editor build');
    }
    if (!report.bridge.cameraWorldToScreen || !report.bridge.cameraScreenPointToRay) {
        report.concerns.push('Scene camera projection methods are unavailable');
    }
    if (!report.bridge.hasNativeControlBegin || !report.bridge.hasNativeControlEnd) {
        report.concerns.push('Expected controller transaction hooks are not exposed');
    }
    if (report.scene.callbackErrors) report.concerns.push('Gizmo callback errors have occurred');
    if (report.handles.reason && report.handles.reason !== 'ready' &&
        report.handles.reason !== 'not-initialized') {
        report.concerns.push('Handle adapter: ' + report.handles.reason);
    }
    return report;
}
