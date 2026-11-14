import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'source/GizmoHudControls.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const scope = { exports: {} };
vm.runInNewContext(code, scope, { filename: 'GizmoHudControls.js' });
const { normalizeHudControls, formatHudControl, HudSliderDrag, hudRowScreenPosition,
    hudControlLayoutSignature } = scope.exports;

const controls = normalizeHudControls([
    { type: 'button', id: 'reset', text: 'Reset' },
    { type: 'slider', id: 'radius', text: 'Radius', property: 'radius', min: 0, max: 100, step: 5 },
    { type: 'toggle', id: 'visible', text: 'Visible', property: 'visible', color: '#22aa88' },
    { type: 'checkbox', id: 'grid', text: 'Grid', property: 'grid' },
    { type: 'checkbox', id: 'grid', text: 'Duplicate', property: 'grid' },
    { type: 'toggle', id: 'missing', text: 'Missing' },
    { type: 'checkbox', id: 'invalid-name', text: 'Invalid', property: 'nested.field' },
    { type: 'slider', id: 'invalid-range', text: 'Range', property: 'radius', min: 10, max: 10 },
    { type: 'button', id: 'other', text: 'Other' },
]);
assert.deepEqual(Array.from(controls, (control) => control.type),
    ['button', 'slider', 'toggle', 'checkbox', 'button']);
assert.equal(controls[2].property, 'visible');
assert.equal(controls[2].color, '#22aa88');
assert.equal(controls[3].color, '#ffffff');
const layout = hudControlLayoutSignature(controls);
const relabeled = controls.map(control => ({ ...control, text: control.text + ' updated' }));
assert.equal(hudControlLayoutSignature(relabeled), layout,
    'Dynamic text changes must not recreate HUD controllers');
assert.notEqual(hudControlLayoutSignature(controls.slice(0, 3)), layout,
    'Changing the control list must invalidate the picking layout');
const recolored = controls.map(control => ({ ...control }));
recolored[2].color = '#ffffff';
assert.notEqual(hudControlLayoutSignature(recolored), layout,
    'Changing control marker color must update its controller');
assert.equal(formatHudControl(controls[0]), 'Reset');
assert.match(formatHudControl(controls[1], 50), /Radius: \[/);
assert.equal(formatHudControl(controls[2], true), 'Visible: On');
assert.equal(formatHudControl(controls[2], false), 'Visible: Off');
assert.equal(formatHudControl(controls[3], true), '☑ Grid');
assert.equal(formatHudControl(controls[3], false), '☐ Grid');
assert.equal(formatHudControl(controls[3], undefined), '☐ Grid');

const drag = new HudSliderDrag(controls[1], 25, 100);
assert.equal(drag.move(160), 75);
assert.equal(drag.move(-1000), 0);
assert.equal(drag.move(1100), 100);
assert.equal(drag.cancel(), 25);
assert.equal(drag.move(Number.NaN), null);
assert.throws(() => new HudSliderDrag(controls[1], Infinity, 100));
const absolute = new HudSliderDrag(controls[1], 80, 130, 200, 100);
assert.equal(absolute.move(100), 0, 'Click at left track endpoint selects min');
assert.equal(absolute.move(200), 50, 'Click at track midpoint sets 50%');
assert.equal(absolute.move(300), 100, 'Click at right endpoint selects max');
assert.equal(absolute.move(150), 25, 'Click obeys slider step');
assert.equal(absolute.move(500), 100, 'Absolute drag clamps above max');
assert.equal(absolute.move(-100), 0, 'Absolute drag clamps below min');
assert.equal(absolute.cancel(), 80, 'Cancel restores initial value');
assert.throws(() => new HudSliderDrag(controls[1], 20, 100, 0, 10));
assert.throws(() => new HudSliderDrag(controls[1], 20, 100, 100, NaN));
// Visual appearance and row ordering are part of the public control API.
const styled = normalizeHudControls([
    { type: 'slider', id: 'a', text: 'A', property: 'radius',
        min: 0, max: 100, order: 5, width: 230, size: 'large', fontSize: 19 },
    { type: 'button', id: 'b', text: 'B', order: -10,
        width: 180, size: 'small', fontSize: 11 },
    { type: 'checkbox', id: 'c', text: 'C', property: 'grid',
        fontSize: -200, size: 'giant' },
]);
assert.deepEqual(Array.from(styled, c => c.id), ['b', 'c', 'a'],
    'Custom order determines the HUD control rows');
assert.equal(styled[0].width, 180);
assert.equal(styled[0].size, 'small');
assert.equal(styled[2].width, 230);
assert.equal(styled[2].size, 'large');
assert.equal(styled[2].fontSize, 18);
assert.equal(styled[1].fontSize, 10);
assert.equal(styled[1].size, 'normal');
const { hudSliderScreenTrack } = scope.exports;
const defaultTrack = hudSliderScreenTrack({ width: 960, height: 560 }, 0, 4);
const customTrack = hudSliderScreenTrack({ width: 960, height: 560 }, 0, 4, 230);
assert.equal(customTrack.width, 230, 'Slider width is specified in screen pixels');
assert.equal(customTrack.left, defaultTrack.left, 'A custom width keeps track origin');
assert.ok(hudSliderScreenTrack({ width: 960, height: 560 }, 0, 4, 600).width < 600,
    'Slider width is clamped to avoid covering the value column');
assert.notEqual(hudControlLayoutSignature(styled),
    hudControlLayoutSignature(styled.map(c => ({ ...c, size: 'normal' }))),
    'Appearance changes invalidate the HUD layout signature');
const pos = hudRowScreenPosition({ x: 20, y: 30 }, 2);
assert.equal(pos.x, 40);
assert.equal(pos.y, 10);

console.log('[hud-controls] button, slider, toggle and checkbox normalization, rendering and slider constraints OK');
