import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'assets', 'Gizmos.ts');
const TYPES_ENTRY = path.join(ROOT, 'Types', 'cocos-types.d.ts');
const TSCONFIG_ASSETS = path.join(ROOT, 'tsconfig.assets.json');
const OUT_FILE = path.join(ROOT, 'dist', 'Gizmos.d.ts');
const TEST_FILES = [
    path.join(ROOT, 'tests', 'dts', 'positive.ts'),
    path.join(ROOT, 'tests', 'dts', 'negative.ts'),
];

/**
 * Public surface kept in the .d.ts: the two classes below, the `cc` imports
 * they use, and the `declare module 'cc'` augmentation from source/Ext.ts
 * (onDrawGizmos hooks). Internal namespaces and runtime statements are
 * stripped.
 */
const PUBLIC_CLASSES = ['Gizmos2D', 'Gizmos3D'];

function fail(message) {
    console.error(`[type] ERROR: ${message}`);
    process.exit(1);
}

const diagnosticHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => '\n',
};

function formatDiagnostics(diagnostics) {
    return diagnostics.map((d) => '  ' + ts.formatDiagnostic(d, diagnosticHost).trim()).join('\n');
}

function loadAssetsOptions() {
    const read = ts.readConfigFile(TSCONFIG_ASSETS, ts.sys.readFile);
    if (read.error) fail(`cannot read tsconfig.assets.json:\n${formatDiagnostics([read.error])}`);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
    if (parsed.errors.length > 0) fail(`invalid tsconfig.assets.json:\n${formatDiagnostics(parsed.errors)}`);
    return parsed.options;
}

function emitBundleDeclarations() {
    const options = {
        ...loadAssetsOptions(),
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
    };
    const program = ts.createProgram([BUNDLE, TYPES_ENTRY], options);

    const preEmit = ts.getPreEmitDiagnostics(program);
    if (preEmit.length > 0) {
        fail(`assets/Gizmos.ts has ${preEmit.length} diagnostic(s):\n${formatDiagnostics(preEmit.slice(0, 10))}`);
    }

    let emitted = null;
    let emitCount = 0;
    const result = program.emit(undefined, (fileName, text) => {
        if (fileName.endsWith('.d.ts')) {
            emitCount += 1;
            emitted = text;
        }
    });
    if (result.emitSkipped) fail('declaration emit was skipped');
    if (result.diagnostics && result.diagnostics.length > 0) {
        fail(`emit diagnostics:\n${formatDiagnostics(result.diagnostics)}`);
    }
    if (emitCount !== 1 || emitted === null) fail(`expected exactly 1 emitted .d.ts, got ${emitCount}`);
    return emitted;
}

function findPublicClasses(sourceFile) {
    const found = new Map();
    const visit = (node) => {
        if (ts.isClassDeclaration(node) && node.name && PUBLIC_CLASSES.includes(node.name.text)) {
            if (found.has(node.name.text)) fail(`duplicate declaration of '${node.name.text}' in emitted .d.ts`);
            found.set(node.name.text, node);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const name of PUBLIC_CLASSES) {
        if (!found.has(name)) fail(`class '${name}' not found in emitted .d.ts`);
    }
    return found;
}

function isNonPublic(member) {
    const flags = ts.getCombinedModifierFlags(member);
    return (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
}

/**
 * Cut a class declaration out of the emitted .d.ts as text: drop non-public
 * members (text-slicing keeps tsc's own formatting), dedent out of the
 * surrounding namespace, and make it an ambient top-level declaration.
 */
function classToDeclarationText(classNode, sourceText, sourceFile) {
    const classStart = classNode.getStart(sourceFile);
    const kept = [];
    const dropped = [];
    for (const member of classNode.members) {
        (isNonPublic(member) ? dropped : kept).push(member);
    }
    if (kept.length === 0) fail(`class '${classNode.name.text}' has no public members`);

    const usedNames = new Set();
    for (const member of kept) {
        for (const identifier of collectIdentifiers(member)) usedNames.add(identifier);
    }
    for (const clause of classNode.heritageClauses ?? []) {
        for (const identifier of collectIdentifiers(clause)) usedNames.add(identifier);
    }
    for (const typeParameter of classNode.typeParameters ?? []) {
        for (const identifier of collectIdentifiers(typeParameter)) usedNames.add(identifier);
    }

    let text = sourceText.slice(classStart, classNode.getEnd());
    for (const member of dropped) {
        const from = member.getFullStart() - classStart;
        const to = member.getEnd() - classStart;
        text = text.slice(0, from) + text.slice(to);
    }

    const dedented = text
        .split('\n')
        .map((line, index) => (index > 0 && line.startsWith('    ') ? line.slice(4) : line))
        .join('\n');
    return { text: `declare ${dedented}`, usedNames };
}

function collectIdentifiers(node) {
    const names = new Set();
    const visit = (current) => {
        if (ts.isIdentifier(current)) names.add(current.text);
        ts.forEachChild(current, visit);
    };
    visit(node);
    return names;
}

function collectImports(sourceFile) {
    const imports = new Map();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const moduleSpecifier = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly || clause.name || !clause.namedBindings) {
            fail(`unsupported import form from '${moduleSpecifier}'`);
        }
        if (!ts.isNamedImports(clause.namedBindings)) {
            fail(`namespace/default import from '${moduleSpecifier}' is not supported`);
        }
        if (!imports.has(moduleSpecifier)) imports.set(moduleSpecifier, []);
        for (const element of clause.namedBindings.elements) {
            if (element.propertyName) {
                fail(`import aliases ('${element.propertyName.text} as ${element.name.text}') are not supported`);
            }
            imports.get(moduleSpecifier).push(element.name.text);
        }
    }
    return imports;
}

/**
 * `declare module '<name>'` augmentations (from source/Ext.ts via the bundle)
 * are part of the public API — keep them verbatim, JSDoc included.
 */
function collectModuleAugmentations(emittedText, sourceFile) {
    const blocks = [];
    for (const statement of sourceFile.statements) {
        if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)) continue;
        if (statement.name.text !== 'cc') {
            fail(`unexpected module augmentation '${statement.name.text}' — only 'cc' is allowed`);
        }
        blocks.push({
            text: emittedText.slice(statement.getFullStart(), statement.getEnd()).replace(/^\s*\n/, ''),
            identifiers: collectIdentifiers(statement),
        });
    }
    return blocks;
}

function buildOutputText(emittedText) {
    const sourceFile = ts.createSourceFile('Gizmos.d.ts', emittedText, ts.ScriptTarget.ES2017, true, ts.ScriptKind.TS);
    const classes = findPublicClasses(sourceFile);
    const augmentations = collectModuleAugmentations(emittedText, sourceFile);

    const usedNames = new Set();
    const classTexts = [];
    for (const name of PUBLIC_CLASSES) {
        const result = classToDeclarationText(classes.get(name), emittedText, sourceFile);
        for (const identifier of result.usedNames) usedNames.add(identifier);
        classTexts.push(result.text);
    }
    for (const augmentation of augmentations) {
        for (const identifier of augmentation.identifiers) usedNames.add(identifier);
    }

    const imports = collectImports(sourceFile);
    const importLines = [];
    for (const [moduleSpecifier, names] of imports) {
        const keptNames = names.filter((name) => usedNames.has(name));
        if (keptNames.length === 0) continue;
        if (moduleSpecifier !== 'cc') {
            fail(`unexpected import module '${moduleSpecifier}' — public surface must only depend on 'cc'`);
        }
        if (keptNames.length > 5) {
            const lines = keptNames.map((name) => `    ${name},`).join('\n');
            importLines.push(`import {\n${lines}\n} from '${moduleSpecifier}';`);
        } else {
            importLines.push(`import { ${keptNames.join(', ')} } from '${moduleSpecifier}';`);
        }
    }

    const parts = [];
    parts.push('// AUTO-GENERATED by scripts/type.mjs from assets/Gizmos.ts — DO NOT EDIT');
    parts.push('// Run `npm run type` to regenerate.\n');
    if (importLines.length > 0) {
        parts.push(importLines.join('\n'));
        parts.push('');
    }
    if (augmentations.length > 0) {
        parts.push(augmentations.map((augmentation) => augmentation.text).join('\n'));
        parts.push('');
    }
    parts.push(classTexts.join('\n\n'));
    parts.push('');
    const globalBlock = [
        'declare global {',
        '    const Gizmos: {',
        '        Gizmos2D: typeof Gizmos2D;',
        '        Gizmos3D: typeof Gizmos3D;',
        '    };',
        '}',
    ];
    parts.push(globalBlock.join('\n'));
    parts.push('');
    parts.push('export {};');
    parts.push('');
    return parts.join('\n').replace(/\r\n/g, '\n');
}

function checkOutput(output) {
    const mustContain = [
        'declare class Gizmos2D {',
        'declare class Gizmos3D {',
        "declare module 'cc' {",
        'onDrawGizmos?(): void;',
        'onDrawGizmosSelected?(): void;',
        'declare global {',
        'Gizmos2D: typeof Gizmos2D;',
        'Gizmos3D: typeof Gizmos3D;',
        'export {};',
    ];
    for (const snippet of mustContain) {
        if (!output.includes(snippet)) fail(`output is missing '${snippet}'`);
    }
    const mustNotContain = ['namespace _', 'private ', 'protected ', 'registerGizmos', 'getDebugNode'];
    for (const snippet of mustNotContain) {
        if (output.includes(snippet)) fail(`output must not contain '${snippet}'`);
    }
    for (const match of output.matchAll(/from '([^']+)'/g)) {
        if (match[1] !== 'cc') fail(`output imports from '${match[1]}' — only 'cc' is allowed`);
    }
}

function runConsumerTests() {
    const options = loadAssetsOptions();
    const program = ts.createProgram([OUT_FILE, TYPES_ENTRY, ...TEST_FILES], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
        const details = formatDiagnostics(diagnostics.slice(0, 20));
        fail(`consumer type tests failed with ${diagnostics.length} diagnostic(s):\n${details}`);
    }
}

const emittedText = emitBundleDeclarations();
const output = buildOutputText(emittedText);
checkOutput(output);

mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, output, 'utf8');
console.log(`[type] wrote ${path.relative(ROOT, OUT_FILE)}`);

runConsumerTests();
console.log(`[type] consumer type tests passed (${TEST_FILES.map((f) => path.relative(ROOT, f)).join(', ')})`);
