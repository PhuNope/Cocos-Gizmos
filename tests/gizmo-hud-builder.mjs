import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile=name=>ts.transpileModule(
    readFileSync(new URL('../source/'+name+'.ts',import.meta.url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}},
).outputText;
const api={exports:{}};
vm.runInNewContext(compile('GizmoHUD'),api);
const {GizmoHUD,walkGizmoHUD}=api.exports;
const calls=[];
const builder=GizmoHUD.createHud('shape')
    .width(330).padding(12).gap(8)
    .text('title','Particle-style HUD',{style:{color:'#ffffff'}})
    .row('settings',row=>{
        row.gap(12)
            .slider('size','Shape Size',GizmoHUD.bind('size'),{
                min:.5,max:3,step:.25,
            })
            .checkbox('wire','Wireframe',GizmoHUD.bind('wireframe'));
    })
    .button('reset','Reset',GizmoHUD.action(owner=>{
        calls.push('reset');owner.size=1;
    }));
const hud=builder.build();
assert.equal(hud.kind,'hud');
assert.equal(hud.root.kind,'column');
assert.equal(hud.root.width,330);
assert.equal(hud.root.gap,8);
assert.equal(hud.root.children[1].kind,'row');
assert.equal(hud.root.children[1].children.length,2);
assert.equal(hud.root.children[1].children[0].command.property,'size');
assert.equal(hud.root.children[1].children[0].min,0.5);
assert.equal(hud.root.children[1].children[0].step,0.25);
const names=[];
walkGizmoHUD(hud.root,node=>names.push(node.id));
assert.deepEqual(names,['title','settings','size','wire','reset']);
assert.ok(Object.isFrozen(hud.root));
assert.ok(Object.isFrozen(hud.root.children));
builder.text('later','new text');
assert.equal(hud.root.children.length,3,
    'build must produce an immutable snapshot independent of later builder changes');
assert.throws(()=>GizmoHUD.createHud('bad id'),/invalid/);
assert.throws(()=>GizmoHUD.bind('transform.size'),/simple Component property/);
assert.throws(()=>GizmoHUD.action(null),/function/);
assert.throws(()=>GizmoHUD.createHud().slider('bad','Size',
    GizmoHUD.bind('size'),{min:10,max:1}),/min\/max/);
assert.throws(()=>GizmoHUD.createHud('x').text('same','Hi')
    .button('same','Reset',GizmoHUD.action(()=>{})).build(),/duplicate/);

const edit={exports:{}};
vm.runInNewContext(compile('GizmoEditSession'),edit);
const controllerScope={exports:{},require(name){
    if(name==='./GizmoEditSession')return edit.exports;
    throw Error(name);
}};
vm.runInNewContext(compile('GizmoHUDController'),controllerScope);
const {GizmoHudCommandController}=controllerScope.exports;
const owner={
    size:1,wireframe:true,
    onGizmoHudChanged(name,phase,value){calls.push([name,phase,value]);},
};
const hooks=[];
const command=new GizmoHudCommandController({
    begin:(o,p)=>hooks.push(['begin',p]),
    update:(o,p)=>hooks.push(['update',p]),
    end:(o,p,cancelled)=>hooks.push(['end',p,cancelled]),
    dirty:()=>hooks.push(['dirty']),
});
const slider=hud.root.children[1].children[0];
assert.equal(command.begin(owner,slider),true);
assert.equal(command.update(1.37),true);
assert.equal(owner.size,1.25,'Slider step clamps and snaps through Command');
assert.equal(command.update(1.37),false,'Equivalent snapped value is no-op');
assert.equal(command.update(100),true);
assert.equal(owner.size,3);
assert.equal(command.finish(false),true);
assert.equal(command.editing,false);
assert.deepEqual(calls.slice(-4),[
    ['size','begin',1],
    ['size','update',1.25],
    ['size','update',3],
    ['size','end',3],
]);
assert.equal(hooks[0][0],'begin');
assert.equal(hooks.at(-2)[0],'end');
assert.equal(command.begin(owner,slider),true);
command.update(2.5);
command.cancel();
assert.equal(owner.size,3,'Cancel must roll back to transaction starting value');
assert.equal(calls.at(-1)[1],'cancel');
const checkbox=hud.root.children[1].children[1];
assert.equal(command.commitValue(owner,checkbox,false),true);
assert.equal(owner.wireframe,false);
assert.equal(calls.at(-1)[1],'end');
assert.equal(command.click(owner,hud.root.children[2]),true);
assert.deepEqual(calls.at(-1),'reset');
assert.equal(owner.size,1);

// Optional native Inspector hook errors cannot tear down application sessions.
const failures=[];
const resilient=new GizmoHudCommandController({
    begin(){throw Error('private Editor hook unavailable');},
    update(){throw Error('Inspector unavailable');},
    error(error){failures.push(String(error));},
});
assert.equal(resilient.begin(owner,slider),true);
resilient.update(1.5);
resilient.finish();
assert.equal(owner.size,1.5);
assert.ok(failures.length>=2);
console.log('[gizmo-hud-builder] flex tree snapshots, Commands, slider/checkbox/action, cancel and hook isolation OK');
