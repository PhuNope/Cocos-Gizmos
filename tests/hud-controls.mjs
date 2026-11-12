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
const { normalizeHudControls, formatHudControl, HudSliderDrag, hudRowScreenPosition } = scope.exports;

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
assert.equal(formatHudControl(controls[0]), '[Reset]');
assert.match(formatHudControl(controls[1], 50), /Radius: \[/);
assert.equal(formatHudControl(controls[2], true), 'Visible: [ON]');
assert.equal(formatHudControl(controls[2], false), 'Visible: [OFF]');
assert.equal(formatHudControl(controls[3], true), '[x] Grid');
assert.equal(formatHudControl(controls[3], false), '[ ] Grid');
assert.equal(formatHudControl(controls[3], undefined), '[ ] Grid');

const drag = new HudSliderDrag(controls[1], 25, 100);
assert.equal(drag.move(160), 75);
assert.equal(drag.move(-1000), 0);
assert.equal(drag.move(1100), 100);
assert.equal(drag.cancel(), 25);
assert.equal(drag.move(Number.NaN), null);
assert.throws(() => new HudSliderDrag(controls[1], Infinity, 100));
const pos = hudRowScreenPosition({ x: 20, y: 30 }, 2);
assert.equal(pos.x, 40);
assert.equal(pos.y, 10);

console.log('[hud-controls] button, slider, toggle and checkbox normalization, rendering and slider constraints OK');
