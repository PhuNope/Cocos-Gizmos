import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile=name=>ts.transpileModule(
    readFileSync(new URL('../source/'+name+'.ts',import.meta.url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}},
).outputText;
function load(name,imports={}){
    const scope={exports:{},console,globalThis:{},
        require(id){
            if(!(id in imports))throw Error('Unknown DOM HUD import: '+id);
            return imports[id];
        }};
    vm.runInNewContext(compile(name),scope);
    return scope.exports;
}
const api=load('GizmoHUD');
const sessions=load('GizmoEditSession');
const controller=load('GizmoHUDController',{'./GizmoEditSession':sessions});
const styles=load('GizmoHudStyle');
const {GizmoHudDomRenderer}=load('GizmoHudDomRenderer',{
    './GizmoHUDController':controller,
    './GizmoHUD':api,
    './GizmoHudStyle':styles,
});

class Element {
    constructor(tag){
        this.tag=tag;
        this.style={};
        this.children=[];
        this.parentElement=null;
        this.attributes={};
        this.listeners=new Map();
        this.textContent='';
        this.value='';
        this.checked=false;
    }
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,listener,capture){
        const ls=this.listeners.get(name)||[];
        ls.push(listener);this.listeners.set(name,ls);
    }
    removeEventListener(name,listener){
        this.listeners.set(name,(this.listeners.get(name)||[]).filter(x=>x!==listener));
    }
    appendChild(child){
        if(child.tag==='fragment'){
            for(const node of [...child.children])this.appendChild(node);
            return child;
        }
        this.children.push(child);
        child.parentElement=this;
        return child;
    }
    replaceChildren(fragment){
        this.children=[];
        this.appendChild(fragment);
    }
    remove(){
        if(this.parentElement)this.parentElement.children=
            this.parentElement.children.filter(x=>x!==this);
        this.parentElement=null;
    }
    emit(name,event={}){
        const e={
            button:0,pointerId:7,
            stopImmediatePropagation(){
                this.stopped=true;
                this.immediateStopped=true;
            },
            stopPropagation(){this.stopped=true;},
            preventDefault(){this.prevented=true;},
            ...event,
        };
        for(const fn of this.listeners.get(name)||[]) {
            fn(e);
            if(e.immediateStopped)break;
        }
        return e;
    }
    setPointerCapture(id){this.pointerId=id;}
    releasePointerCapture(){this.pointerId=null;}
    find(test){
        if(test(this))return this;
        for(const child of this.children){
            const found=child.find(test);if(found)return found;
        }
        return null;
    }
}
const host=new Element('div');
host.style.position='';
const fakeWindow=new Element('window');
fakeWindow.PointerEvent=function PointerEvent(){};
const doc={
    defaultView:fakeWindow,
    getElementById(id){return id==='GameDiv'?host:null;},
    createElement(name){return new Element(name);},
    createDocumentFragment(){return new Element('fragment');},
};
const {GizmoHUD}=api;
const owner={
    node:{uuid:'hud-demo'},size:1,wireframe:true,visible:true,
    lastEvent:'none',events:[],
    onGizmoHudChanged(name,phase,value){
        this.events.push([name,phase,value]);
    },
};
const hud=()=>GizmoHUD.createHud('shape')
    .width(320).gap(10).padding(12)
    .text('title','3D gizmos')
    .row('settings',row=>row.gap(12)
        .slider('size','Shape Size',GizmoHUD.bind('size'),{
            min:.5,max:3,step:.25,
        })
        .checkbox('wire','Wireframe',GizmoHUD.bind('wireframe')))
    .button('reset','Reset',GizmoHUD.action(comp=>{
        comp.lastEvent='reset';comp.size=1;
    }))
    .build();
const renderer=new GizmoHudDomRenderer(()=>doc);
renderer.beginFrame();
assert.equal(renderer.queue(owner,hud()),5);
assert.equal(renderer.finishFrame(),true);
assert.equal(host.children.length,1);
const root=host.children[0];
assert.equal(root.id,'cocos-gizmos-builder-hud');
assert.equal(root.style.pointerEvents,'none',
    'Floating HUD background cannot steal Scene selection');
const panel=root.children[0];
assert.equal(panel.style.flexDirection,'column');
assert.equal(panel.style.pointerEvents,'none');
assert.equal(panel.style.width,'320px');
const row=panel.find(x=>x.attributes['data-gizmo-hud-id']==='shape/shape/settings');
assert.equal(row.style.flexDirection,'row');
assert.equal(row.style.gap,'12px');
const slider=row.find(x=>x.tag==='input'&&x.type==='range');
const checkbox=row.find(x=>x.tag==='input'&&x.type==='checkbox');
const button=panel.find(x=>x.tag==='button');
assert.equal(slider.value,'1');
assert.equal(checkbox.checked,true);
assert.equal(button.textContent,'Reset');
assert.equal(slider.style.pointerEvents,'auto');
slider.emit('pointerdown');
assert.equal(renderer.editing,true);
slider.value='1.75';
slider.emit('input');
assert.equal(owner.size,1.75);
renderer.beginFrame();
renderer.queue(owner,hud());
renderer.finishFrame();
assert.equal(root.children[0],panel,
    'Repaint while slider is captured must never replace flex DOM');
assert.equal(renderer.editing,true);
fakeWindow.emit('pointerup');
assert.equal(renderer.editing,false);
assert.equal(owner.events.at(-1)[1],'end');
assert.equal(fakeWindow.listeners.get('pointerup').length,0);
renderer.beginFrame();renderer.queue(owner,hud());renderer.finishFrame();
const latestPanel=root.children[0];
const latestCheck=latestPanel.find(x=>x.tag==='input'&&x.type==='checkbox');
latestCheck.checked=false;
latestCheck.emit('change');
assert.equal(owner.wireframe,false);
assert.equal(owner.events.at(-1)[1],'end');
const latestButton=latestPanel.find(x=>x.tag==='button');
latestButton.emit('click');
assert.equal(owner.lastEvent,'reset',
    'stopPropagation must not suppress same-target Button command click');
assert.equal(owner.size,1);
assert.equal(latestButton.emit('pointerdown').stopped,true);
renderer.beginFrame();renderer.queue(owner,hud());renderer.finishFrame();
const refreshedSlider=root.find(x=>x.tag==='input'&&x.type==='range');
refreshedSlider.emit('pointerdown');
refreshedSlider.value='2';
refreshedSlider.emit('input');
fakeWindow.emit('keydown',{key:'Escape',keyCode:27});
assert.equal(owner.size,1,'Escape restores the initial Slider value');
assert.equal(owner.events.at(-1)[1],'cancel');
assert.equal(renderer.editing,false);
// Editor can deserialize and replace a Component while reusing the same
// Node UUID and property values. DOM actions must bind the NEW object.
const replacement={
    ...owner,node:{uuid:'hud-demo'},lastEvent:'replacement',
    onGizmoHudChanged:owner.onGizmoHudChanged,
};
renderer.beginFrame();renderer.queue(replacement,hud());renderer.finishFrame();
const rebound=root.find(x=>x.tag==='button');
rebound.emit('click');
assert.equal(replacement.lastEvent,'reset');
assert.equal(root.children.length,1);
renderer.beginFrame();
renderer.finishFrame();
assert.equal(root.style.display,'none','Unselected Node hides its builder HUD');
renderer.dispose();
assert.equal(host.children.length,0);
assert.equal(host.style.position,'');
console.log('[gizmo-hud-dom] nested flex layout, command input, drag stability, Escape, select cleanup and DOM passthrough OK');
