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
let viewportRect={left:20,top:36,width:800,height:500};
host.getBoundingClientRect=()=>({
    ...viewportRect,right:viewportRect.left+viewportRect.width,
    bottom:viewportRect.top+viewportRect.height,
});
const body=new Element('body');
body.appendChild(host);
const fakeWindow=new Element('window');
fakeWindow.PointerEvent=function PointerEvent(){};
let sceneIs3D=false;
const doc={
    body,defaultView:fakeWindow,
    getElementById(id){
        if(id==='Cocos3dGameContainer' && sceneIs3D)return host;
        return id==='GameDiv'?host:null;
    },
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
    .style({backgroundColor:'#203040'})
    .wrap(false).shrink(0).basis(320)
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
assert.equal(host.children.length,0,
    'HUD may not live beneath Canvas or its stacking context');
assert.equal(body.children.length,2);
const root=body.children[1];
assert.equal(root.parentElement,body,'HUD must portal above GameDiv');
assert.equal(root.style.position,'fixed');
assert.equal(root.style.zIndex,'2147483647',
    'Portal must sit above other Scene canvas overlay stacking contexts');
assert.equal(root.style.left,'20px');
assert.equal(root.style.top,'36px');
assert.equal(root.style.width,'800px');
assert.equal(root.style.height,'500px');
assert.equal(root.id,'cocos-gizmos-builder-hud');
assert.equal(root.style.pointerEvents,'none',
    'Floating HUD background cannot steal Scene selection');
const panel=root.children[0];
assert.equal(panel.style.flexDirection,'column');
assert.equal(panel.style.pointerEvents,'auto',
    'Inside the visible 3D HUD panel native Scene picking must be blocked');
assert.equal(panel.emit('pointerdown').stopped,true,
    'Clicking HUD padding does not reach Scene selection');
assert.equal(panel.style.width,'320px');
assert.equal(panel.style.flexBasis,'320px');
assert.equal(panel.style.flexShrink,'0');
assert.equal(panel.style.backgroundColor,'#203040');
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
assert.equal(row.style.pointerEvents,'none',
    'Nested flex layout keeps individual controls interactive');
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
fakeWindow.emit('blur');
assert.equal(renderer.editing,true,
    'Editor focusing the HTML slider must not cancel the drag');
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
// Window resizing/repositioning must move the fixed portal with the viewport.
viewportRect={left:100,top:75,width:960,height:540};
renderer.beginFrame();renderer.queue(owner,hud());renderer.finishFrame();
assert.equal(root.style.left,'100px');
assert.equal(root.style.top,'75px');
assert.equal(root.style.width,'960px');
assert.equal(root.style.height,'540px');
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
// Persistent mounts are rendered without a selected component callback.
const unregister=GizmoHUD.commands.register({
    id:'gizmo.persist',
    execute:context=>{context.lastEvent='persistent';},
});
const persistent=GizmoHUD.createHud('persist')
    .position('bottom-left')
    .theme('light')
    .button('Run',{command:'gizmo.persist'})
    .mount(replacement);
renderer.beginFrame();
assert.equal(renderer.finishFrame(),true);
const persistentButton=root.find(x=>x.tag==='button');
persistentButton.emit('click');
assert.equal(replacement.lastEvent,'persistent');
assert.equal(root.children[0].style.bottom,'12px');
persistent.hide();
renderer.beginFrame();renderer.finishFrame();
assert.equal(root.style.display,'none');
persistent.show();
renderer.beginFrame();renderer.finishFrame();
assert.equal(root.style.display,'flex');
persistent.destroy();
unregister();
renderer.dispose();
assert.equal(host.children.length,0);
assert.equal(body.children.length,1,
    'Disposal removes only the HUD portal, not the Scene canvas host');
assert.equal(host.style.position,'');

// In Cocos Creator 3D, parent engine-view > webview has CSS
// pointer-events:none. No native DOM event is delivered to these inputs;
// Editor Operation coordinates must drive the very same Commands.
sceneIs3D=true;
// Restore the original viewport rectangle after the resize test above.
viewportRect={left:20,top:36,width:800,height:500};
const opOwner={
    node:{uuid:'3d-operation'},size:1,wireframe:true,lastEvent:'idle',
    changes:[],
    onGizmoHudChanged(property,phase,value){
        this.changes.push([property,phase,value]);
    },
};
const opHud=GizmoHUD.createHud('operation-3d')
    .width(320).padding(10)
    .button('reset','Reset',GizmoHUD.action(owner=>{
        owner.lastEvent='reset';
    }))
    .checkbox('wire','Wireframe',GizmoHUD.bind('wireframe'))
    .slider('size','Size',GizmoHUD.bind('size'),{
        min:0,max:4,step:.5,
    }).build();
const opRenderer=new GizmoHudDomRenderer(()=>doc);
opRenderer.beginFrame();
opRenderer.queue(opOwner,opHud);
assert.equal(opRenderer.finishFrame(),true);
assert.equal(opRenderer.usesSceneOperationInput(),true);
const opRoot=body.children[1];
const opPanel=opRoot.children[0];
const box=(left,top,right,bottom)=>({
    left,top,right,bottom,width:right-left,height:bottom-top,
});
opPanel.getBoundingClientRect=()=>box(400,70,720,340);
const opButton=opPanel.find(x=>x.tag==='button');
const opToggle=opPanel.find(x=>x.tag==='input'&&x.type==='checkbox');
const opRange=opPanel.find(x=>x.tag==='input'&&x.type==='range');
opButton.getBoundingClientRect=()=>box(420,90,520,120);
opToggle.getBoundingClientRect=()=>box(590,140,610,165);
opToggle.parentElement.getBoundingClientRect=()=>box(420,140,615,170);
opRange.getBoundingClientRect=()=>box(420,200,620,226);
// Inverse of 3D viewport to client transformation (GameDiv 20,36,800x500).
const toPointer=(clientX,clientY)=>({
    x:clientX-20,y:536-clientY,
});
const viewport={width:800,height:500};
assert.equal(opRenderer.operationDown(toPointer(100,95),viewport),false,
    'Clicks outside 3D panel belong to normal Scene selection');
assert.equal(opRenderer.operationDown(toPointer(405,75),viewport),true,
    'HUD padding blocks native Scene unselect even without a DOM target');
opRenderer.operationUp(toPointer(405,75),viewport);
assert.equal(opOwner.lastEvent,'idle');
assert.equal(opRenderer.operationDown(toPointer(460,100),viewport),true);
assert.equal(opRenderer.operationUp(toPointer(460,100),viewport),true);
assert.equal(opOwner.lastEvent,'reset',
    'Scene Operation can click Reset even if browser never fires click');
assert.equal(opRenderer.operationDown(toPointer(600,152),viewport),true);
opRenderer.operationUp(toPointer(600,152),viewport);
assert.equal(opOwner.wireframe,false,
    'Scene Operation forwards checkbox changes and keeps owner state');
assert.equal(opToggle.checked,false);
assert.equal(opRenderer.operationDown(toPointer(450,152),viewport),true);
opRenderer.operationUp(toPointer(450,152),viewport);
assert.equal(opOwner.wireframe,true,
    'Checkbox label area must also trigger the operation command');
// Slider changes from 1 to 3 and must survive multiple repaints.
assert.equal(opRenderer.operationDown(toPointer(470,214),viewport),true);
assert.equal(opRenderer.editing,true);
opRenderer.beginFrame();opRenderer.queue(opOwner,opHud);
opRenderer.finishFrame();
assert.equal(opRoot.children[0],opPanel,
    'Scene Operation drag must preserve DOM controls across frames');
opRenderer.operationMove(toPointer(570,214),viewport);
assert.equal(opOwner.size,3);
opRenderer.operationUp(toPointer(570,214),viewport);
assert.equal(opOwner.size,3);
assert.equal(opRenderer.editing,false);
assert.equal(opRange.value,'3');
assert.ok(opOwner.changes.some(x=>x[0]==='size'&&x[1]==='end'),
    'Slider must commit its GizmoEditSession after operation mouseup');
opRenderer.operationDown(toPointer(470,214),viewport);
opRenderer.operationMove(toPointer(615,214),viewport);
opRenderer.operationCancel();
assert.equal(opOwner.size,3,'Escape cancels Operation slider edit');
assert.equal(opRenderer.operationStatus().captured,false);
assert.equal(opRenderer.operationStatus().commit,4);

// In 3D, the visible grab strip is picked by Scene Operation coordinates.
const beforeDragCommits=opRenderer.operationStatus().commit;
const beforeDragCount=opRenderer.operationStatus().panelDrag;
assert.equal(opRenderer.operationDown(toPointer(660,76),viewport),true);
assert.equal(opRenderer.operationStatus().lastHit,'drag-handle');
opRenderer.beginFrame();opRenderer.queue(opOwner,opHud);
opRenderer.finishFrame();
assert.equal(opRoot.children[0],opPanel,
    'HUD must not be rebuilt during a Scene Operation panel drag');
assert.equal(opRenderer.operationMove(toPointer(400,120),viewport),true);
assert.equal(opPanel.style.left,'120px');
assert.equal(opPanel.style.top,'78px');
assert.equal(opRenderer.operationUp(toPointer(400,120),viewport),true);
assert.equal(opRenderer.operationStatus().panelDrag,beforeDragCount+1);
assert.equal(opRenderer.operationStatus().commit,beforeDragCommits,
    'Moving HUD must never execute a button/checkbox command');
assert.equal(opRenderer.operationStatus().captured,false);
// Escape cancels a subsequent panel drag and restores the previous position.
assert.equal(opRenderer.operationDown(toPointer(660,76),viewport),true);
opRenderer.operationMove(toPointer(1000,500),viewport);
opRenderer.operationCancel();
assert.equal(opPanel.style.left,'120px');
assert.equal(opPanel.style.top,'78px');

// A 3D Scene WebView cannot receive native DOM mousewheel or scrollbar
// pointer events; Scene Operation must update the *real* panel.scrollTop.
opPanel.clientHeight=260;
opPanel.scrollHeight=1040;
opPanel.scrollTop=0;
assert.equal(opPanel.style.overflowY,'auto');
assert.match(opPanel.style.maxHeight,/100% - 24px/,
    'HUD height must be limited by the Scene viewport, not the editor window');
assert.equal(opRenderer.operationWheel(toPointer(100,100),viewport,120),false,
    'Wheel outside HUD must continue to zoom the Scene camera');
assert.equal(opRenderer.operationWheel(toPointer(470,180),viewport,120),true);
assert.equal(opPanel.scrollTop,120);
assert.equal(opRenderer.operationWheel(toPointer(470,180),viewport,-35),true);
assert.equal(opPanel.scrollTop,85);
assert.equal(opRenderer.operationWheel(toPointer(470,180),viewport,2000),true);
assert.equal(opPanel.scrollTop,780,'Wheel scroll clamps to content height');
assert.equal(opRenderer.operationWheel(toPointer(470,180),viewport,120),true,
    'Wheel over HUD is consumed even at end of scroll');
assert.equal(opPanel.scrollTop,780);
opPanel.scrollTop=85;
// Native scrollbar track occupies the far right of the clipped HUD.
assert.equal(opRenderer.operationDown(toPointer(715,115),viewport),true);
assert.equal(opRenderer.operationStatus().lastHit,'scrollbar');
const beforeScrollbar=opPanel.scrollTop;
assert.equal(opRenderer.operationMove(toPointer(715,220),viewport),true);
assert.ok(opPanel.scrollTop>beforeScrollbar,
    'Operation pointer drag must move the scrollbar thumb');
assert.equal(opRenderer.operationUp(toPointer(715,220),viewport),true);
assert.equal(opRenderer.operationStatus().captured,false);
assert.equal(opOwner.lastEvent,'reset',
    'Scrollbar drag must never trigger the button behind it');
assert.equal(opRenderer.operationStatus().scrollDrag,1);
assert.equal(opRenderer.operationStatus().wheel,4);
// A definition/value change re-renders the panel. Preserve scroll offset.
const priorScroll=opPanel.scrollTop;
opOwner.lastEvent='changed';
opRenderer.beginFrame();opRenderer.queue(opOwner,opHud);
opRenderer.finishFrame();
assert.notEqual(opRoot.children[0],opPanel,
    'Model change rebuilds HTML but must preserve previous scroll position');
assert.equal(opRoot.children[0].scrollTop,priorScroll,
    'Visible lower HUD elements must remain in view after Scene repaint');
// 3D collapse/expand is routed via Scene Operation (not native button click).
const foldPanel3D=opRoot.children[0];
foldPanel3D.getBoundingClientRect=()=>box(400,70,720,340);
const foldButton3D=foldPanel3D.find(x=>
    x.attributes?.['data-gizmo-hud-collapse']==='true');
assert.ok(foldButton3D,'3D HUD has an always-present fold button');
const commitBeforeFold=opRenderer.operationStatus().commit;
assert.equal(opRenderer.operationDown(toPointer(710,80),viewport),true);
assert.equal(opRenderer.operationStatus().lastHit,'collapse-button');
assert.equal(opRenderer.operationUp(toPointer(710,80),viewport),true);
assert.equal(foldPanel3D.style.height,'28px');
assert.equal(foldPanel3D.style.padding,'3px',
    'Collapsed header must fit without clipping its collapse control');
assert.equal(foldButton3D.attributes['aria-expanded'],'false');
assert.equal(foldButton3D.textContent,'▢');
assert.equal(opRenderer.operationStatus().collapsed,1);
assert.equal(opRenderer.operationStatus().collapseClicks,1);
assert.equal(opRenderer.operationStatus().commit,commitBeforeFold,
    'Collapse cannot run a Component Gizmo command');
const foldBody3D=foldPanel3D.find(x=>
    x.attributes?.['data-gizmo-hud-id']==='operation-3d/operation-3d/reset');
assert.ok(foldBody3D);
assert.equal(foldBody3D.style.display,'none');
assert.equal(opRenderer.operationWheel(toPointer(450,82),viewport,120),true);
assert.equal(foldPanel3D.scrollTop,priorScroll,
    'Collapsed HUD cannot change stored scroll while wheel-over-UI is consumed');
// The mini-header remains draggable in the 3D Operation path.
const beforeFoldDrag=opRenderer.operationStatus().panelDrag;
assert.equal(opRenderer.operationDown(toPointer(650,76),viewport),true);
assert.equal(opRenderer.operationStatus().lastHit,'drag-handle');
opRenderer.operationMove(toPointer(600,90),viewport);
opRenderer.operationUp(toPointer(600,90),viewport);
assert.equal(opRenderer.operationStatus().panelDrag,beforeFoldDrag+1);
assert.equal(opRenderer.operationStatus().collapsed,1);
assert.equal(foldPanel3D.style.height,'28px');
assert.equal(opRenderer.operationDown(toPointer(710,80),viewport),true);
opRenderer.operationUp(toPointer(710,80),viewport);
assert.equal(opRenderer.operationStatus().collapsed,0);
assert.equal(foldButton3D.attributes['aria-expanded'],'true');
assert.equal(foldPanel3D.style.height,'');
assert.equal(foldPanel3D.style.overflowY,'auto');
assert.equal(foldPanel3D.scrollTop,priorScroll,
    'Expanded HUD restores scroll to reveal previous content');
const lastExpandedX=foldPanel3D.style.left;
opOwner.lastEvent='rebuild-after-collapse';
opRenderer.beginFrame();opRenderer.queue(opOwner,opHud);opRenderer.finishFrame();
assert.equal(opRoot.children[0].style.left,lastExpandedX,
    'Expanded HUD keeps its dragged placement after rebuild');
opRenderer.dispose();
sceneIs3D=false;
const only2D=new GizmoHudDomRenderer(()=>doc);
assert.equal(only2D.usesSceneOperationInput(),false,
    'Working 2D HUD must remain on native DOM pointer path');
only2D.beginFrame();only2D.queue(owner,hud());only2D.finishFrame();
const nativePanel=body.children[1].children[0];
const handle=nativePanel.find(el=>el.attributes?.['data-gizmo-hud-drag-handle']==='true');
assert.ok(handle,'Builder HUD shows its own draggable grip');
nativePanel.getBoundingClientRect=()=>{
    const left=nativePanel.style.right==='auto'?
        viewportRect.left+parseFloat(nativePanel.style.left):488;
    const top=nativePanel.style.bottom==='auto'?
        viewportRect.top+parseFloat(nativePanel.style.top):48;
    return box(left,top,left+320,top+180);
};
const nativeLastEvent=owner.lastEvent;
const starting=handle.emit('pointerdown',{
    clientX:540,clientY:59,pointerId:7,button:0,
});
assert.equal(starting.prevented,true);
assert.equal(only2D.operationStatus().domDragging,true);
fakeWindow.emit('pointermove',{clientX:300,clientY:240,pointerId:7});
assert.equal(nativePanel.style.left,'228px');
assert.equal(nativePanel.style.top,'193px');
only2D.beginFrame();only2D.queue(owner,hud());only2D.finishFrame();
assert.equal(body.children[1].children[0],nativePanel,
    'Native drag maintains the same panel DOM across update frames');
fakeWindow.emit('pointerup',{clientX:300,clientY:240,pointerId:7});
assert.equal(only2D.operationStatus().domDragging,false);
assert.equal(fakeWindow.listeners.get('pointermove').length,0,
    'Finished drag must clean up window pointer listeners');
assert.equal(owner.lastEvent,nativeLastEvent,
    'Drag cannot trigger HUD commands');
// Escape restores prior saved coordinates in 2D just as in 3D.
handle.emit('pointerdown',{clientX:300,clientY:240,pointerId:7,button:0});
fakeWindow.emit('pointermove',{clientX:500,clientY:320,pointerId:7});
fakeWindow.emit('keydown',{key:'Escape',keyCode:27});
assert.equal(nativePanel.style.left,'228px');
assert.equal(nativePanel.style.top,'193px');
assert.equal(only2D.operationStatus().domDragging,false);
// If the viewport shrinks, floating HUD is clamped back into view.
viewportRect={left:20,top:36,width:500,height:340};
only2D.beginFrame();only2D.queue(owner,hud());only2D.finishFrame();
assert.equal(nativePanel.style.left,'180px');
assert.equal(nativePanel.style.top,'160px');
owner.size=1.5;
only2D.beginFrame();only2D.queue(owner,hud());only2D.finishFrame();
const replacementPanel=body.children[1].children[0];
assert.notEqual(replacementPanel,nativePanel,
    'Changed property creates a new panel after drag ends');
assert.equal(replacementPanel.style.left,'180px');
assert.equal(replacementPanel.style.top,'160px',
    'Dragged position survives a HUD DOM rebuild');
// Native 2D button collapses, and the compact mini-HUD is still draggable.
const fold2D=replacementPanel.find(x=>
    x.attributes?.['data-gizmo-hud-collapse']==='true');
assert.ok(fold2D,'2D HUD includes a collapse button beside the drag label');
replacementPanel.getBoundingClientRect=()=>{
    const left=viewportRect.left+parseFloat(replacementPanel.style.left);
    const top=viewportRect.top+parseFloat(replacementPanel.style.top);
    const width=replacementPanel.style.height==='28px'?190:320;
    const height=replacementPanel.style.height==='28px'?28:180;
    return box(left,top,left+width,top+height);
};
const beforeFoldState=owner.lastEvent;
fold2D.emit('click');
assert.equal(only2D.operationStatus().collapsed,1);
assert.equal(replacementPanel.style.height,'28px');
assert.equal(fold2D.attributes['aria-expanded'],'false');
assert.equal(owner.lastEvent,beforeFoldState,
    'Collapse is a UI-only action and never invokes Component commands');
// Drag the collapsed 2D title bar, not a hidden slider/control.
const foldedGrip=replacementPanel.find(x=>
    x.attributes?.['data-gizmo-hud-drag-handle']==='true');
foldedGrip.emit('pointerdown',{clientX:250,clientY:205,pointerId:7,button:0});
assert.equal(only2D.operationStatus().domDragging,true);
fakeWindow.emit('pointermove',{clientX:270,clientY:215,pointerId:7});
fakeWindow.emit('pointerup',{clientX:270,clientY:215,pointerId:7});
assert.equal(replacementPanel.style.left,'200px');
assert.equal(replacementPanel.style.top,'170px');
assert.equal(replacementPanel.style.height,'28px');
fold2D.emit('click');
assert.equal(only2D.operationStatus().collapsed,0);
assert.equal(replacementPanel.style.height,'');
assert.equal(fold2D.attributes['aria-expanded'],'true');
assert.equal(replacementPanel.style.left,'180px',
    'Expanding near Scene edge re-clamps the larger panel into the viewport');
assert.equal(replacementPanel.style.top,'160px');
fold2D.emit('click');
owner.size=1.75;
only2D.beginFrame();only2D.queue(owner,hud());only2D.finishFrame();
const foldedRebuild=body.children[1].children[0];
assert.notEqual(foldedRebuild,replacementPanel);
assert.equal(foldedRebuild.style.height,'28px',
    'Collapsed state is stable across builder rerenders');
assert.equal(only2D.operationStatus().collapsed,1);
only2D.dispose();
viewportRect={left:20,top:36,width:800,height:500};

console.log('[gizmo-hud-dom] native DOM, 3D Editor Operation click/checkbox/slider drag/rollback, padding, selection passthrough and cleanup OK');
