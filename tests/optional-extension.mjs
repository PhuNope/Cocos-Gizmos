import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'cocos-gizmos-optional-'));
const write = (relative, source) => {
    const filename = path.join(temp, relative);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, source, 'utf8');
    return filename;
};

try {
    // A type-only package provides declarations, never JavaScript.
    write('node_modules/@types/cocos-gizmos/index.d.ts', "export * from './Gizmos';\n");
    write('node_modules/@types/cocos-gizmos/Gizmos.d.ts',
        readFileSync(path.join(root, 'dist', 'Gizmos.d.ts'), 'utf8'));
    write('node_modules/cc/index.d.ts', [
        'export interface IVec2Like { x: number; y: number; }',
        'export class Vec3 { x: number; y: number; z: number; }',
        'export class Node { worldPosition: Vec3; }',
        'export class Component { node: Node; }',
        'export const _decorator: { ccclass(name: string): ClassDecorator };',
        '',
    ].join('\n'));
    const file = write('Consumer.ts', [
        "import { _decorator, Component } from 'cc';",
        "import type { Gizmos2D as Gizmos2DType } from '@types/cocos-gizmos';",
        'const { ccclass } = _decorator;',
        "@ccclass('OptionalGizmo')",
        'export class OptionalGizmo extends Component {',
        '    private readonly typesOnly: Gizmos2DType | null = null;',
        '    public ticks = 0;',
        '    public update(): void { this.ticks++; }',
        '    public onDrawGizmos(): void {',
        '        Gizmos2D.drawCircle(this.node, { x: 0, y: 0 }, 100);',
        '    }',
        '    public onDrawGizmosSelected(): void {',
        '        Gizmos3D.drawSphere(this.node, this.node.worldPosition, 1);',
        '    }',
        '}',
        '',
    ].join('\n'));

    const options = {
        target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        experimentalDecorators: true,
        strict: true,
        skipLibCheck: true,
        noEmitOnError: true,
        types: [],
    };
    const program = ts.createProgram([file], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => temp,
        getNewLine: () => '\n',
    }));

    let javascript = '';
    const emitted = program.emit(undefined, (name, text) => {
        if (name.endsWith('Consumer.js')) javascript = text;
    });
    assert.equal(emitted.emitSkipped, false);
    assert.ok(javascript, 'The component must emit JavaScript');
    assert.doesNotMatch(javascript, /registerGizmos/);
    assert.doesNotMatch(javascript, /require\(["']@types\/cocos-gizmos["']\)/);
    assert.doesNotMatch(javascript, /require\(["']cocos-gizmos["']\)/);

    // The game evaluates component modules without the Editor extension.
    const cc = {
        Component: class Component { constructor() {
            this.node = { worldPosition: { x: 0, y: 0, z: 0 } };
        } },
        _decorator: { ccclass: () => (target) => target },
    };
    const sandbox = {
        exports: {},
        require: (name) => {
            assert.equal(name, 'cc', 'Type-only dependencies must not be imported at runtime');
            return cc;
        },
    };
    vm.runInNewContext(javascript, sandbox, { filename: 'Consumer.js' });
    assert.equal(sandbox.Gizmos2D, undefined);
    assert.equal(sandbox.Gizmos3D, undefined);
    const instance = new sandbox.exports.OptionalGizmo();
    instance.update();
    assert.equal(instance.ticks, 1, 'Game lifecycle must run with no Gizmos extension');

    // When the Editor extension is present, it invokes the optional callbacks.
    let circles = 0;
    let spheres = 0;
    sandbox.Gizmos2D = { drawCircle: () => circles++ };
    sandbox.Gizmos3D = { drawSphere: () => spheres++ };
    instance.onDrawGizmos();
    instance.onDrawGizmosSelected();
    assert.equal(circles, 1);
    assert.equal(spheres, 1);

    // A registration decorator cannot be supplied by declarations alone.
    const invalid = write('Invalid.ts', [
        "import { Component } from 'cc';",
        '@registerGizmos()',
        'export class Invalid extends Component {}',
        '',
    ].join('\n'));
    const invalidProgram = ts.createProgram([invalid], { ...options, noEmit: true });
    const missing = ts.getPreEmitDiagnostics(invalidProgram)
        .some((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n').includes('registerGizmos'));
    assert.ok(missing, '@registerGizmos must not be required or declared');

    console.log('[optional-extension] type-only compile + game lifecycle without extension + editor callbacks OK');
} finally {
    rmSync(temp, { recursive: true, force: true });
}
