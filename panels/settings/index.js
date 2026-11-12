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
</section>
`;

exports.style = `
.gizmos-settings { padding: 16px; color: var(--color-normal-fill, inherit); font: 13px sans-serif; }
.gizmos-settings h2 { margin: 0 0 12px; font-size: 18px; }
.gizmos-settings p { color: var(--color-normal-contrast-emphasis, #888); }
.gizmos-settings .field { margin: 16px 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.gizmos-settings select { min-width: 150px; border: 1px solid #666; border-radius: 4px; padding: 5px; background: #303030; color: #eee; }
#gizmo-feedback { min-height: 20px; }
`;

exports.$ = {
    display: '#gizmo-display',
    hud: '#gizmo-hud',
    feedback: '#gizmo-feedback',
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
};

exports.close = function close() {
    if (!this._gizmosOnChange) return;
    this.$.display.removeEventListener('change', this._gizmosOnChange);
    this.$.hud.removeEventListener('change', this._gizmosOnChange);
    this._gizmosOnChange = null;
};
