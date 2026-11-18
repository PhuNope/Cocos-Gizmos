import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../source/SceneHudElement.ts', import.meta.url), 'utf8');
const controlsSource = readFileSync(new URL('../source/GizmoHudControls.ts', import.meta.url), 'utf8');
const compile = value => ts.transpileModule(value, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
}).outputText;
const appearance = { exports: {} };
vm.runInNewContext(compile(readFileSync(new URL('../source/GizmoHudStyle.ts',
    import.meta.url), 'utf8')), appearance);
const controls = { exports: {}, require(id) {
    if (id === './GizmoHudStyle') return appearance.exports;
    throw Error(id);
} };
vm.runInNewContext(compile(controlsSource), controls);
class Element {
    constructor(tag) {
        this.tag = tag;
        this.style = {};
        this.children = [];
        this.parentElement = null;
        this.textContent = '';
        this.clientWidth = 900;
        this.clientHeight = 540;
        this.listeners = new Map();
    }
    addEventListener(type, callback) {
        const listeners=this.listeners.get(type)||[];
        listeners.push(callback);this.listeners.set(type,listeners);
    }
    removeEventListener(type, callback) {
        this.listeners.set(type,(this.listeners.get(type)||[])
            .filter(item=>item!==callback));
    }
    emit(type, event) {
        for(const callback of this.listeners.get(type)||[])
            callback(event);
    }
    get firstElementChild() { return this.children[0]||null; }
    getBoundingClientRect() {
        return {left:0,top:0,right:900,bottom:540,width:900,height:540};
    }
    setPointerCapture(id) { this.pointerCaptured=id; }
    appendChild(child) {
        if (child.tag === 'fragment') {
            for (const entry of [...child.children]) this.appendChild(entry);
            return child;
        }
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
    replaceChildren(...children) {
        this.children = [];
        for (const child of children) this.appendChild(child);
    }
    remove() {
        if (this.parentElement) this.parentElement.children =
            this.parentElement.children.filter(node => node !== this);
        this.parentElement = null;
    }
}
const fakeWindow=new Element('window');
fakeWindow.PointerEvent=function PointerEvent(){};
const scene = new Element('div');
scene.style.position = '';
const doc = {
    defaultView:fakeWindow,
    getElementById(id) {
        if (id === 'GameDiv') return scene;
        if (id === 'cocos-gizmos-scene-hud') return scene.children.find(child => child.id === id) || null;
        return null;
    },
    createElement(tag) { return new Element(tag); },
    createDocumentFragment() { return new Element('fragment'); },
};
const scope = {
    exports: {},
    require(id) {
        if (id === './GizmoHudControls') return controls.exports;
        if (id === './GizmoHudStyle') return appearance.exports;
        throw Error(id);
    },
};
vm.runInNewContext(compile(source), scope);
const Hud = scope.exports.SceneHudElement;
const hud = new Hud(() => doc);
const viewport = { width: 900, height: 540 };
const rows = [
    { index: 0, text: '<b>not html</b>', fontSize: 14, color: '#ffcc00', isControl: false },
    { index: 1, text: 'Radius', fontSize: 14, color: '#ffffff',
        isControl: true, kind: 'slider', value: 35, min: 0, max: 100 },
    { index: 2, text: 'Visible', fontSize: 14, color: '#ffffff',
        isControl: true, kind: 'toggle', value: true },
    { index: 3, text: 'Reset', fontSize: 14, color: '#ffffff',
        isControl: true, kind: 'button' },
];
assert.equal(hud.render(viewport, rows, 4), true);
const root = scene.children[0];
assert.equal(root.id, 'cocos-gizmos-scene-hud');
assert.equal(root.style.pointerEvents, 'none');
assert.equal(scene.style.position, 'relative');
assert.equal(root.children.length, 4);
assert.equal(root.children[0].textContent, '<b>not html</b>');
assert.equal(root.children[1].children.length, 3);

assert.ok(parseInt(root.style.width, 10) < viewport.width,
    'A single-column dock never takes over the entire Scene width');
const customized = rows.map((row) => ({ ...row }));
customized[3] = {
    ...customized[3],
    size: { width: 136, height: 18 },
    style: { backgroundColor: '#264653', color: '#e9fffc',
        borderRadius: 8, fontWeight: 600, padding: 4,
        pointerEvents: 'auto', position: 'fixed' },
};
assert.equal(hud.render(viewport, customized, 4), true);
const button = root.children[3];
const hit = controls.exports.hudControlScreenRect(viewport, 3, 4, customized[3].size);
assert.equal(button.style.width, hit.width + 'px');
assert.equal(button.style.height, hit.height + 'px');
assert.equal(button.style.left, hit.left + 'px');
assert.equal(button.style.backgroundColor, '#264653');
assert.equal(button.style.borderRadius, '8px');
assert.equal(button.style.fontWeight, '600');
assert.equal(button.style.pointerEvents, undefined,
    'User styles must not override native Editor pointer capture');
assert.equal(button.style.position, 'absolute',
    'User styles cannot reposition the picking rectangle');

assert.equal(hud.render(viewport, rows, 4), true);
assert.equal(scene.children.length, 1, 'Identical frame should reuse the mounted element');
hud.hide();
assert.equal(root.style.display, 'none');
assert.equal(hud.render(viewport, rows, 4), true);
assert.equal(root.style.display, 'block');
// DOM floating controls directly own their browser mouse events. They
// must keep the exact same DOM nodes across Editor redraws while dragging.
const inputEvents=[];
const disconnect=scope.exports.connectSceneHudInput({
    down(pointer){inputEvents.push(['down',pointer.x,pointer.y]);return true;},
    move(pointer){inputEvents.push(['move',pointer.x,pointer.y]);},
    up(pointer){inputEvents.push(['up',pointer.x,pointer.y]);},
    cancel(){inputEvents.push(['cancel']);},
});
assert.equal(hud.render(viewport,rows,4),true);
const slider=root.children[1];
assert.equal(slider.style.pointerEvents,'auto',
    'Only controls receive pointer input; the floating root stays transparent');
const sliderHit=controls.exports.hudControlScreenRect(viewport,1,4);
const event=(x,y,id=1)=>({
    clientX:x,clientY:540-y,button:0,buttons:1,pointerId:id,
    stopImmediatePropagation(){this.stopped=true;},
    stopPropagation(){this.stopped=true;},
    preventDefault(){this.prevented=true;},
});
const press=event(sliderHit.left+20,sliderHit.bottom+10);
slider.emit('pointerdown',press);
assert.equal(press.stopped,true,'HUD press cannot select the Scene Node');
assert.equal(press.prevented,true);
assert.equal(inputEvents.at(-1)[0],'down');
assert.equal(fakeWindow.listeners.get('pointermove').length,1);
const nextRows=rows.map(row=>({...row}));
nextRows[1].value=82;
assert.equal(hud.render(viewport,nextRows,4),true);
assert.equal(root.children[1],slider,
    'Editor redraw must not replace DOM slider during pointer capture');
assert.equal(slider.children[2].textContent,'82',
    'Value readout updates without replacing the active slider');
const sliderMove=event(sliderHit.left+55,sliderHit.bottom+10);
fakeWindow.emit('pointermove',sliderMove);
assert.equal(inputEvents.at(-1)[0],'move');
fakeWindow.emit('pointerup',sliderMove);
assert.equal(inputEvents.at(-1)[0],'up');
assert.equal(fakeWindow.listeners.get('pointermove').length,0,
    'Global pointer listener is detached on release');
assert.equal(hud.render(viewport,nextRows,4),true);
assert.equal(root.children.length,4);

const button=root.children[3];
const buttonHit=controls.exports.hudControlScreenRect(viewport,3,4);
const buttonPress=event(buttonHit.left+10,buttonHit.bottom+10,2);
button.emit('pointerdown',buttonPress);
fakeWindow.emit('pointerup',buttonPress);
assert.equal(inputEvents.at(-1)[0],'up');
assert.equal(inputEvents.filter(x=>x[0]==='cancel').length,0);
assert.equal(root.style.pointerEvents,'none',
    'Background click must still reach native Scene selection');
disconnect();
hud.dispose();
assert.equal(scene.children.length, 0);
assert.equal(scene.style.position, '');
assert.equal(hud.render(viewport, [], 0), false);
assert.equal(new Hud(() => null).render(viewport, rows, 4), false);
console.log('[scene-hud-element] attach, content, picker passthrough, cache, hide, dispose OK');
