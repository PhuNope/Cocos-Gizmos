import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../source/SceneSelectionLease.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,
}}).outputText;
const scope={exports:{}};
vm.runInNewContext(code,scope);
const {SceneSelectionLease,consumeOwnedSceneEvent}=scope.exports;
const lease=new SceneSelectionLease();
assert.equal(lease.inspect(100),null);
lease.begin('selected-node');
assert.equal(lease.inspect(100).nodeUuid,'selected-node');
assert.equal(lease.inspect(100).active,true);
lease.release(1000);
assert.equal(lease.inspect(1249).nodeUuid,'selected-node');
assert.equal(lease.inspect(1249).active,false);
assert.equal(lease.inspect(1251),null,
    'Lease must expire so normal Scene selection remains possible');
lease.begin('old');
lease.begin('new');
assert.equal(lease.inspect(3000).nodeUuid,'new');
lease.clear();
assert.equal(lease.inspect(3000),null);

const calls=[];
const wrapper={
    stopPropagation(){calls.push('wrapper-stop');},
    preventDefault(){calls.push('wrapper-default');},
    propagationStopped:false,
    detail:{event:{
        stopImmediatePropagation(){calls.push('native-immediate');},
        preventDefault(){calls.push('native-default');},
    }},
};
consumeOwnedSceneEvent(wrapper);
assert.deepEqual(calls,[
    'wrapper-stop','wrapper-default','native-immediate','native-default',
]);
assert.equal(wrapper.propagationStopped,true);
assert.doesNotThrow(()=>consumeOwnedSceneEvent({nativeEvent:{
    stopImmediatePropagation(){throw new Error('read-only event');},
}}));
console.log('[scene-selection-lease] bounded focus guard and owned event propagation OK');
