import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const extension = require('../main.js');
const packageJson = require('../package.json');
const globalAsset = path.join(root, 'editor-assets', 'GizmosGlobal.ts');
const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'cocos-gizmos-project-'));
const assets = path.join(projectRoot, 'assets');
const previousEditor = globalThis.Editor;

try {
    mkdirSync(assets);
    const logs = [];
    globalThis.Editor = {
        Project: { path: projectRoot },
        log: (message) => logs.push(message),
        warn: (message) => { throw new Error(message); },
    };
    extension.load();
    extension.load();

    assert.equal(
        packageJson.contributions['asset-db'].mount.path,
        './editor-assets',
        'Editor must mount the generated script asset'
    );
    assert.equal(packageJson.contributions['asset-db'].mount.readonly, true);
    assert.ok(existsSync(globalAsset), 'npm run type must generate editor-assets/GizmosGlobal.ts');
    const bridge = path.join(assets, 'cocos-gizmos.global.d.ts');
    assert.equal(existsSync(bridge), false, 'Extension must not create declarations in project/assets');

    const asset = readFileSync(globalAsset, 'utf8');
    assert.match(asset, /declare global\s*\{/);
    assert.match(asset, /onDrawGizmos\?\(\): void/);
    assert.match(asset, /onGizmoHandles\?\(\): GizmoHandleList/);
    assert.match(asset, /interface GizmoHandleDescriptor/);
    assert.match(asset, /type GizmoHandlePlane/);
    assert.match(asset, /type GizmoHandlePhase/);
    assert.match(asset, /const Gizmos2D: typeof import\('\.\/GizmosGlobal'\)\.Gizmos2D/);
    assert.match(asset, /const Gizmos3D: typeof import\('\.\/GizmosGlobal'\)\.Gizmos3D/);
    assert.doesNotMatch(asset, /registerGizmos/);

    const js = ts.transpileModule(asset, {
        fileName: globalAsset,
        compilerOptions: {
            target: ts.ScriptTarget.ES2017,
            module: ts.ModuleKind.ESNext,
            removeComments: true,
        },
    }).outputText;
    assert.doesNotMatch(js, /Gizmos2D|Gizmos3D|require\(/,
        'The declarations asset must not add Gizmos runtime implementations');

    const consumer = path.join(assets, 'Consumer.ts');
    writeFileSync(consumer, [
        "import { Component } from 'cc';",
        'export class Consumer extends Component {',
        '    onDrawGizmos() {',
        '        Gizmos2D.drawCircle(this.node, { x: 0, y: 0 }, 100);',
        '    }',
        '    onDrawGizmosSelected() {',
        '        Gizmos3D.drawSphere(this.node, this.node.worldPosition, 2);',
        '    }',
        '}',
        '',
    ].join('\n'), 'utf8');

    // Model the Editor's TypeScript program with the mounted asset included.
    // The consumer itself imports no Gizmos module.
    const rootFiles = [
        globalAsset,
        path.join(root, 'Types', 'cocos-types.d.ts'),
        consumer,
    ];
    const options = {
        target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.Node16,
        moduleResolution: ts.ModuleResolutionKind.Node16,
        skipLibCheck: true,
        noEmit: true,
        strict: true,
        types: [],
    };
    const program = ts.createProgram(rootFiles, options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => projectRoot,
        getNewLine: () => '\n',
    }));

    const completionFile = path.join(assets, 'Completion.ts');
    writeFileSync(completionFile, 'Gizmo', 'utf8');
    const memberFile = path.join(assets, 'MemberCompletion.ts');
    const memberSource = [
        "import { Component } from 'cc';",
        'export class MemberCompletion extends Component {',
        '    onGiz',
        '}',
        '',
    ].join('\n');
    writeFileSync(memberFile, memberSource, 'utf8');
    const propertyFile = path.join(assets, 'PropertyCompletion.ts');
    const propertySource = [
        "import { Component } from 'cc';",
        'export class PropertyCompletion extends Component {',
        '    onGizmoHandles(): GizmoHandleList {',
        '        return [{  }];',
        '    }',
        '}',
        '',
    ].join('\n');
    writeFileSync(propertyFile, propertySource, 'utf8');
    const scripts = [...rootFiles, completionFile, memberFile, propertyFile];
    const host = {
        getScriptFileNames: () => scripts,
        getScriptVersion: () => '0',
        getScriptSnapshot: (filename) => {
            const text = ts.sys.readFile(filename);
            return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
        },
        getCurrentDirectory: () => root,
        getCompilationSettings: () => options,
        getDefaultLibFileName: ts.getDefaultLibFilePath,
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
    };
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    try {
        const completion = service.getCompletionsAtPosition(completionFile, 5, {});
        const names = new Set(completion?.entries.map((entry) => entry.name));
        assert.ok(names.has('Gizmos2D'), 'Global completion is missing Gizmos2D');
        assert.ok(names.has('Gizmos3D'), 'Global completion is missing Gizmos3D');

        const memberOffset = memberSource.indexOf('onGiz') + 'onGiz'.length;
        const methodNames = new Set(service.getCompletionsAtPosition(memberFile, memberOffset, {})
            ?.entries.map(entry => entry.name));
        assert.ok(methodNames.has('onGizmoHandles'), 'Component method completion is missing onGizmoHandles');
        assert.ok(methodNames.has('onGizmoChanged'), 'Component method completion is missing onGizmoChanged');

        const propertyOffset = propertySource.indexOf('return [{  }];') + 'return [{ '.length;
        const fieldNames = new Set(service.getCompletionsAtPosition(propertyFile, propertyOffset, {})
            ?.entries.map(entry => entry.name));
        for (const field of ['property', 'index', 'plane', 'space', 'axis', 'snap', 'bounds', 'color']) {
            assert.ok(fieldNames.has(field), 'Position handle property completion is missing ' + field);
        }
    } finally {
        service.dispose();
    }

    assert.equal(existsSync(bridge), false);

    // Existing project declarations are never removed or overwritten.
    const oldContent = '// AUTO-GENERATED by Cocos-Gizmos. Do not edit.\n';
    writeFileSync(bridge, oldContent, 'utf8');
    const warnings = [];
    globalThis.Editor.warn = (message) => warnings.push(message);
    extension.load();
    assert.equal(readFileSync(bridge, 'utf8'), oldContent);
    assert.ok(warnings.some((message) => message.includes('cocos-gizmos.global.d.ts')));

    console.log('[extension-types] mounted globals resolve without project writes; stale type files are reported');
} finally {
    if (previousEditor === undefined) delete globalThis.Editor;
    else globalThis.Editor = previousEditor;
    rmSync(projectRoot, { force: true, recursive: true });
}
