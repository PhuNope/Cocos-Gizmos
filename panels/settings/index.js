'use strict';

exports.template = `
<section class="gizmos-settings">
    <h2>Gizmos</h2>
    <p>Choose default Scene View visibility. Components can override these values.</p>
    <div class="field">
        <label for="gizmo-display">Gizmo display</label>
        <select id="gizmo-display">
            <option value="always">Always</option>
            <option value="selected">Selected</option>
            <option value="off">Off</option>
        </select>
    </div>
    <div class="field">
        <label for="gizmo-hud">HUD labels</label>
        <select id="gizmo-hud">
            <option value="selected">Selected</option>
            <option value="always">Always</option>
            <option value="off">Off</option>
        </select>
    </div>
    <p id="gizmo-feedback" role="status"></p>
    <section class="diagnostics">
        <h3>Scene diagnostics</h3>
        <p>Check the current Scene and Gizmo controller capabilities without changing any nodes.</p>
        <button id="gizmo-diagnostics-run" type="button">Check Scene integration</button>
        <pre id="gizmo-diagnostics-result" role="status" aria-live="polite"></pre>
    </section>
    <section class="diagnostics">
        <h3>Mounted example scripts</h3>
        <p>Check whether the 2D, 3D and Smoke Test scripts are imported
        in the extension Asset Database. This does not modify the project.</p>
        <button id="gizmo-examples-run" type="button">Check example assets</button>
        <pre id="gizmo-examples-result" role="status" aria-live="polite"></pre>
    </section>
</section>
`;

exports.style = `
.gizmos-settings { padding: 16px; color: var(--color-normal-fill, inherit); font: 13px sans-serif; }
.gizmos-settings h2 { margin: 0 0 12px; font-size: 18px; }
.gizmos-settings p { color: var(--color-normal-contrast-emphasis, #888); }
.gizmos-settings .field { margin: 16px 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.gizmos-settings select { min-width: 150px; border: 1px solid #666; border-radius: 4px; padding: 5px; background: #303030; color: #eee; }
#gizmo-feedback { min-height: 20px; }
.gizmos-settings .diagnostics { margin-top: 22px; padding-top: 12px; border-top: 1px solid #666; }
.gizmos-settings .diagnostics h3 { font-size: 14px; }
.gizmos-settings .diagnostics button { border: 1px solid #888; border-radius: 4px; padding: 6px 10px; background: #444; color: #eee; }
.gizmos-settings .diagnostics pre { margin-top: 8px; max-height: 280px; overflow: auto; white-space: pre-wrap; word-wrap: break-word; font: 11px monospace; }
`;

exports.$ = {
    display: '#gizmo-display',
    hud: '#gizmo-hud',
    feedback: '#gizmo-feedback',
    diagnosticsRun: '#gizmo-diagnostics-run',
    diagnosticsResult: '#gizmo-diagnostics-result',
    examplesRun: '#gizmo-examples-run',
    examplesResult: '#gizmo-examples-result',
};

exports.ready = async function ready() {
    const editor = globalThis.Editor;
    const display = this.$.display;
    const hud = this.$.hud;
    const feedback = this.$.feedback;
    let applied = { display: 'always', hud: 'selected' };
    try {
        const settings = await editor.Message.request('cocos-gizmos', 'get-settings');
        if (settings) applied = settings;
    } catch (error) {
        feedback.textContent = String(error?.message || error);
    }
    display.value = applied.display;
    hud.value = applied.hud;
    const changed = async () => {
        display.disabled = true;
        hud.disabled = true;
        try {
            const next = await editor.Message.request('cocos-gizmos', 'set-settings', {
                display: display.value,
                hud: hud.value,
            });
            applied = next;
            feedback.textContent = 'Scene View settings applied';
        } catch (error) {
            display.value = applied.display;
            hud.value = applied.hud;
            feedback.textContent = 'Cannot update Scene View: ' + String(error?.message || error);
        } finally {
            display.disabled = false;
            hud.disabled = false;
        }
    };
    this._gizmosOnChange = changed;
    display.addEventListener('change', changed);
    hud.addEventListener('change', changed);

    const checkScene = async () => {
        const button = this.$.diagnosticsRun;
        const output = this.$.diagnosticsResult;
        button.disabled = true;
        output.textContent = 'Checking Scene process...';
        try {
            const report = await editor.Message.request('cocos-gizmos', 'get-diagnostics');
            output.textContent = JSON.stringify(report, null, 2);
        } catch (error) {
            output.textContent = 'Scene diagnostics unavailable: ' + String(error?.message || error);
        } finally {
            button.disabled = false;
        }
    };
    this._gizmosOnDiagnostics = checkScene;
    this.$.diagnosticsRun.addEventListener('click', checkScene);

    const checkExamples = async () => {
        const button = this.$.examplesRun;
        const output = this.$.examplesResult;
        button.disabled = true;
        output.textContent = 'Checking extension Asset Database...';
        try {
            const report = await editor.Message.request('cocos-gizmos', 'get-example-assets');
            const details = (report?.examples || []).map((entry) =>
                entry.name + ': ' + entry.status +
                (entry.importer ? ' (importer: ' + entry.importer + ')' : '') +
                (entry.error ? ' — ' + entry.error : ''));
            output.textContent = [
                'Asset Database: ' + (report?.databaseReady === null ?
                    'readiness not reported' : report.databaseReady ? 'ready' : 'starting'),
                ...details,
                '',
                report?.guidance || 'No Asset Database result was returned.',
            ].join('\n');
        } catch (error) {
            output.textContent = 'Cannot check mounted scripts: ' +
                String(error?.message || error);
        } finally {
            button.disabled = false;
        }
    };
    this._gizmosOnExamples = checkExamples;
    this.$.examplesRun.addEventListener('click', checkExamples);
};

exports.close = function close() {
    if (!this._gizmosOnChange) return;
    this.$.display.removeEventListener('change', this._gizmosOnChange);
    this.$.hud.removeEventListener('change', this._gizmosOnChange);
    this._gizmosOnChange = null;
    if (this._gizmosOnDiagnostics) {
        this.$.diagnosticsRun.removeEventListener('click', this._gizmosOnDiagnostics);
        this._gizmosOnDiagnostics = null;
    }
    if (this._gizmosOnExamples) {
        this.$.examplesRun.removeEventListener('click', this._gizmosOnExamples);
        this._gizmosOnExamples = null;
    }
};
