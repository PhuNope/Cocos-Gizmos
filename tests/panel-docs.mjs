import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const packageManifest = require('../package.json');
const doc = require('../panels/docs/index.js');
const extension = require('../main.js');

assert.equal(packageManifest.panels.docs.main, './panels/docs/index.js');
const menu = packageManifest.contributions.menu;
const resetIndex = menu.findIndex(m => m.label === 'Reset Gizmos');
assert.equal(menu[resetIndex + 1].label, 'OpenDoc');
assert.equal(menu[resetIndex + 1].message, 'open-doc');
assert.deepEqual(packageManifest.contributions.messages['open-doc'].methods, ['openDoc']);
assert.match(doc.template, /Gizmos3D\.move/);
assert.match(doc.template, /Gizmos2D\.point/);
assert.match(doc.template, /onGizmoHudControls/);
assert.match(doc.template, /<svg[^>]+role="img"/);
assert.match(doc.style, /cg-api-card/);
assert.equal((doc.template.match(/class="cg-api-card"/g) || []).length, 8,
    'OpenDoc ships eight interactive API cards with diagrams and code');
assert.ok(!doc.template.includes('<script'), 'No untrusted remote scripting');

const originalEditor = globalThis.Editor;
const originalNavigator = globalThis.navigator;
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
    ];
    const tabs = ['all', 'start', '2d', '3d', 'handles', 'hud'].map(id => {
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
    assert.equal(cards.filter(c => !c.hidden).length, 3);
    elements.search.value = 'move';
    elements.search.trigger('input');
    assert.deepEqual(cards.map(x => x.hidden), [true, false, true]);
    elements.tabs.trigger('click', { target: { closest() { return tabs[4]; } } });
    assert.equal(tabs[4].attrs['aria-pressed'], 'true');
    assert.equal(elements.empty.hidden, true);
    elements.search.value = 'invalid-query';
    elements.search.trigger('input');
    assert.equal(elements.empty.hidden, false);
    doc.close.call(host);
    assert.equal(elements.search._handlers.size, 0);
    assert.equal(elements.tabs._handlers.size, 0);
    assert.equal(elements.cards._handlers.size, 0);
    console.log('[panel-docs] OpenDoc menu, API examples, illustrations, search and cleanup OK');
} finally {
    if (originalEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = originalEditor;
    if (originalNavigator === undefined) delete globalThis.navigator;
    else globalThis.navigator = originalNavigator;
}
