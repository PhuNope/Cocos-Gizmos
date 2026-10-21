import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {stripBuild, detectAndStrip, isStandaloneRuntime} = require('../build/strip.js');
const builder = require('../builder.js');
const hooks = require('../build/hooks.js');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(builder.configs['*'].hooks, './build/hooks.js');
assert.equal(hooks.throwError, true);
assert.equal(pkg.contributions.scene.script, './scene.js');
assert.equal(pkg.contributions['asset-db'], undefined, 'runtime assets must not be mounted into the project');

const scene = readFileSync(path.join(root, 'scene.js'), 'utf8');
assert.match(scene, /exports\.load\s*=\s*function/);
assert.match(scene, /exports\.unload\s*=\s*function/);
assert.match(scene, /editor-runtime\/Gizmos2D\.js/);
assert.match(scene, /editor-runtime\/Gizmos3D\.js/);
assert.doesNotMatch(scene, /dist\/Gizmos/);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cocos-gizmos-scene-only-'));
const put = (relative, contents) => {
    const file = path.join(scratch, relative);
    mkdirSync(path.dirname(file), {recursive:true});
    writeFileSync(file, contents);
    return file;
};
try {
    const file = put('src/chunks/game.js',
        "System.register([],function(exports) { class Player { " +
        "update(t){return t+1} a(){Gizmos2D.drawLine(this.node,0,0)} " +
        "onDrawGizmos(){this.a()} onDrawGizmosSelected(){Gizmos3D.drawSphere(this.node,[0,0,0],1)} " +
        "onSelectedGizmsos(){return 'other callback'} onSelectedGizmos(){return 'other alias'} " +
        "fixed(){return 'Gizmos2D onDrawGizmos harmless string'} } " +
        "if (EDITOR) {Gizmos2D.drawCircle()} exports('Player',Player); });");
    const runtime = [
        put('src/extensions/cocos-gizmos/dist/Gizmos.js', 'Object.assign(globalThis,{Gizmos2D,Gizmos3D})'),
        put('src/extensions/cocos-gizmos/dist/Gizmos2D.js', 'class GizmosDebugDraw {}'),
    ];
    const stats = stripBuild(scratch);
    assert.equal(stats.removedFiles, 2);
    assert.equal(stats.removedMethods, 2);
    assert.equal(stats.changedFiles, 1);
    for (const p of runtime) assert.equal(existsSync(p), false);
    const cleaned = readFileSync(file, 'utf8');
    assert.match(cleaned, /update\(t\)/);
    assert.match(cleaned, /a\(\)\{Gizmos2D\.drawLine/);
    assert.match(cleaned, /if \(EDITOR\) \{Gizmos2D\.drawCircle/);
    assert.match(cleaned, /onSelectedGizmsos/);
    assert.match(cleaned, /onSelectedGizmos/);
    assert.doesNotMatch(cleaned, /onDrawGizmos\(\)\{/);
    assert.doesNotMatch(cleaned, /onDrawGizmosSelected\(\)\{/);
    assert.equal(stripBuild(scratch).removedMethods, 0, 'idempotent');
    assert.equal(isStandaloneRuntime('src/chunks/shared.js'), false);

    const result = detectAndStrip(
        'class Player { onDrawGizmos(){ Gizmos2D.drawCircle() } keep(){return Gizmos3D} }',
        'file.js',
    );
    assert.equal(result.removed, 1);
    assert.match(result.text, /keep\(\)/);
    // A bundled chunk containing unrelated Gizmos code must NOT stop the build.
    const mixed = put('src/chunks/shared.js',
        'class GizmosDebugDraw {} class Enemy { onDrawGizmos(){Gizmos2D.drawCircle()} a(){ Gizmos2D.drawLine() } }');
    const mixedStats = stripBuild(scratch);
    assert.equal(mixedStats.removedMethods, 1);
    assert.match(readFileSync(mixed, 'utf8'), /class GizmosDebugDraw/);
    assert.match(readFileSync(mixed, 'utf8'), /a\(\)\{ Gizmos2D\.drawLine\(\)/);
    // Regression: exact Cocos Creator 3.8.8 / Web Mobile System.register
    // output reported by the user. Callbacks are prototype assignments in a
    // comma/return expression, not class or object method declarations.
    const cocosCompiled = 'System.register("chunks:///_virtual/Gizmos2DComp.ts",["./rollupPluginModLoBabelHelpers.js","cc"],(function(o){var i,n,t,e,s,r;return{setters:[function(o){i=o.inheritsLoose},function(o){n=o.cclegacy,t=o._decorator,e=o.Color,s=o.Vec2,r=o.Component}],execute:function(){var c;n._RF.push({},"8e3e3OWl1BNLJdp3LdVsqk1","Gizmos2DComp",void 0);var l=t.ccclass;t.property,o("Gizmos2DComp",l("Gizmos2DComp")(c=function(o){function n(){return o.apply(this,arguments)||this}i(n,o);var t=n.prototype;return t.start=function(){console.log("Gizmos2DComp started")},t.onDrawGizmos=function(){Gizmos2D.beginColor(this.node,e.RED),Gizmos2D.beginLocalPosition(this.node),Gizmos2D.drawSolidCircle(this.node,s.ZERO,50),Gizmos2D.endLocalPosition(this.node)},t.onDrawGizmosSelected=function(){},n}(r))||c);n._RF.pop()}}}));';
    const webIndex = put('assets/main/index.js', cocosCompiled);
    const cocosStats = stripBuild(scratch);
    assert.equal(cocosStats.removedMethods, 2, 'remove both compiled prototype assignments');
    assert.equal(cocosStats.changedFiles, 1);
    const webOutput = readFileSync(webIndex, 'utf8');
    assert.equal(webOutput.length, cocosCompiled.length, 'retain bundle offsets');
    assert.match(webOutput, /t\.start=function\(\)\{console\.log\("Gizmos2DComp started"\)\}/);
    assert.match(webOutput, /,n\}\(r\)/, 'preserve the returned Component class');
    assert.doesNotMatch(webOutput, /\.onDrawGizmos(?:Selected)?=/, 'no Gizmos method assignments remain');
    assert.doesNotMatch(webOutput, /Gizmos2D\.beginColor/, 'the debug body was removed');
    assert.doesNotThrow(() => new Function(webOutput), 'the rewritten System.register is still valid JavaScript');
    assert.equal(stripBuild(scratch).removedMethods, 0, 'Web Mobile output can be reprocessed safely');

    // Comma expressions with no retained assignment must not become invalid.
    const onlyAssignments = detectAndStrip(
        'var x=function(){return t.onDrawGizmos=function(){},t.onDrawGizmosSelected=function(){}}',
        'only.js',
    );
    assert.equal(onlyAssignments.removed, 2);
    assert.doesNotThrow(() => new Function(onlyAssignments.text));
    const standaloneAssignment = detectAndStrip(
        't.onDrawGizmos=function(){Gizmos2D.drawCircle()}; const keep=42;',
        'standalone.js',
    );
    assert.equal(standaloneAssignment.removed, 1);
    assert.match(standaloneAssignment.text, /const keep=42/);
    assert.doesNotThrow(() => new Function(standaloneAssignment.text));
    await hooks.onAfterBuild({dest: scratch}, {dest: scratch});
    console.log('[editor-only] compiled System.register prototype callbacks stripped; ordinary helpers retained; runtime is Scene-only');
} finally {
    rmSync(scratch, {recursive:true, force:true});
}
