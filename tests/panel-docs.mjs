import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const packageManifest = require('../package.json');
const doc = require('../panels/docs/index.js');
const extension = require('../main.js');

assert.equal(packageManifest.panels.docs.main, './panels/docs/index.js');
const menu = packageManifest.contributions.menu;
const resetIndex = menu.findIndex(m => m.label === 'Reset Gizmos');
assert.equal(menu[resetIndex + 1].label, 'Open Document');
assert.equal(packageManifest.panels.docs.title, 'Gizmos Open Document');
assert.match(doc.template, /width: 220/);
assert.match(doc.template, /size: 'large'/);
assert.equal(menu[resetIndex + 1].message, 'open-doc');
assert.deepEqual(packageManifest.contributions.messages['open-doc'].methods, ['openDoc']);
assert.match(doc.template, /Gizmos3D\.move/);
assert.match(doc.template, /Gizmos2D\.move/);
assert.match(doc.template, /Gizmos2D\.point/);
assert.match(doc.template, /onGizmoHudControls/);
assert.match(doc.template, /<svg[^>]+role="img"/);
assert.match(doc.style, /cg-api-card/);
assert.equal((doc.template.match(/class="cg-api-card"/g) || []).length, 14,
    'Open Document ships fourteen API cards, including 2D Move, decorator and callback examples');
for (const callback of ['onGizmoChanged', 'onGizmoHudChanged', 'onGizmoHudAction',
    'onRestore', 'GizmoHandlePhase']) {
    assert.ok(doc.template.includes(callback), 'Open Document documents ' + callback);
}
for (const phase of ['begin', 'update', 'end', 'cancel']) {
    assert.ok(doc.template.includes(phase),
        'Open Document documents the drag phase ' + phase);
}
assert.match(doc.template, /data-doc-group="callbacks"/,
    'Callback cards are filterable in their own category');
assert.match(doc.template, /@registerGizmos\(CustomDrawer\)/);
assert.match(doc.template, /IDrawGizmos/);
assert.match(doc.template, /data-doc-group="decorators"/);
assert.match(doc.template, /index === undefined/,
    'Array handle callbacks document missing indices');
assert.match(doc.template, /setWorldPosition/,
    'Move callback example synchronizes the actual Scene Node');
assert.match(doc.template, /cg-notes/,
    'Callback phase guidance is rendered alongside code');
assert.ok(!doc.template.includes('<script'), 'No untrusted remote scripting');

const originalEditor = globalThis.Editor;
const opened = [];
globalThis.Editor = {
    Panel: { open(id) { opened.push(id); return true; } },
};
function target() {
    const handlers = new Map();
    return {
        value: '', textContent: '', dataset: {}, hidden: false,
        attrs: {}, _handlers: handlers,
        addEventListener(name, callback) { handlers.set(name, callback); },
        removeEventListener(name, callback) {
            assert.equal(handlers.get(name), callback); handlers.delete(name);
        },
        setAttribute(name, value) { this.attrs[name] = value; },
        trigger(name, event = {}) { return handlers.get(name)?.(event); },
    };
}
try {
    assert.equal(extension.methods.openDoc(), true);
    assert.deepEqual(opened, ['cocos-gizmos.docs']);

    const cards = [
        { dataset: { docGroup: 'start', docSearch: 'onDrawGizmos begin color' }, hidden: false },
        { dataset: { docGroup: 'handles', docSearch: 'Gizmos3D.move plane arrow' }, hidden: false },
        { dataset: { docGroup: 'hud', docSearch: 'onGizmoHud slider toggle' }, hidden: false },
        { dataset: { docGroup: 'callbacks', docSearch: 'onGizmoChanged phase update cancel' }, hidden: false },
    ];
    const tabs = ['all', 'start', '2d', '3d', 'handles', 'callbacks', 'hud', 'decorators'].map(id => {
        const node = target();
        node.dataset.docTab = id;
        return node;
    });
    const elements = { search: target(), tabs: target(), cards: target(),
        empty: target(), status: target() };
    elements.cards.querySelectorAll = () => cards;
    elements.tabs.querySelectorAll = () => tabs;
    const host = { $: elements };
    doc.ready.call(host);
    assert.equal(cards.filter(c => !c.hidden).length, 4);
    elements.search.value = 'move';
    elements.search.trigger('input');
    assert.deepEqual(cards.map(x => x.hidden), [true, false, true, true]);
    elements.tabs.trigger('click', { target: { closest() { return tabs[4]; } } });
    assert.equal(tabs[4].attrs['aria-pressed'], 'true');
    assert.equal(elements.empty.hidden, true);
    elements.search.value = 'cancel';
    elements.tabs.trigger('click', { target: { closest() { return tabs[5]; } } });
    elements.search.trigger('input');
    assert.deepEqual(cards.map(x => x.hidden), [true, true, true, false],
        'Callback tab supports searching by phase');
    assert.equal(tabs[5].attrs['aria-pressed'], 'true');
    assert.equal(elements.empty.hidden, true);
    elements.search.value = 'invalid-query';
    elements.search.trigger('input');
    assert.equal(elements.empty.hidden, false);
    doc.close.call(host);
    assert.equal(elements.search._handlers.size, 0);
    assert.equal(elements.tabs._handlers.size, 0);
    assert.equal(elements.cards._handlers.size, 0);
    console.log('[panel-docs] Open Document menu, API examples, illustrations, search and cleanup OK');
} finally {
    if (originalEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = originalEditor;
}
