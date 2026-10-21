import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'source');
const OUT_FILE = path.join(ROOT, '.generated', 'Gizmos.ts');
const JS_OUT_FILE = path.join(ROOT, 'dist', 'Gizmos.js');

/**
 * Files are concatenated in this order. Each file's body is wrapped in its own
 * nested namespace to avoid identifier collisions between files (duplicate
 * helper class names, destructured decorators, ...).
 * - ns: null  -> statements are hoisted to file top-level (used by Ext.ts declare module)
 * - relImports: rewrite `import { X } from './Y'` into `const { X } = _Y;`
 */
const FILES = [
    { name: 'Define', ns: '_Define' },
    { name: 'Ext', ns: null },
    { name: 'ExecuteGizmos', ns: '_ExecuteGizmos', relImports: { './Define': '_Define' } },
    { name: 'Gizmos2D', ns: '_Gizmos2D' },
    { name: 'Gizmos3D', ns: '_Gizmos3D', relImports: { './Define': '_Define' } },
];

/**
 * The only exported runtime values and ambient globals.
 */
const PUBLIC_API = [
    { member: 'Gizmos2D', ns: '_Gizmos2D' },
    { member: 'Gizmos3D', ns: '_Gizmos3D' },
];

function fail(message) {
    console.error(`[build] ERROR: ${message}`);
    process.exit(1);
}

function indentBlock(source) {
    return source
        .replace(/\r\n/g, '\n')
        .replace(/^\s*\n/, '')
        .split('\n')
        .map((line) => (line.length > 0 ? `    ${line}` : line))
        .join('\n');
}

function importedNames(namedImports, context) {
    return namedImports.elements.map((element) => {
        const imported = element.propertyName ? element.propertyName.text : element.name.text;
        const local = element.name.text;
        if (imported !== local) fail(`${context}: import aliases ('${imported} as ${local}') are not supported`);
        return imported;
    });
}

const externalImports = new Map();
const nameOwner = new Map();
const hoistedStatements = [];
const namespaceBlocks = [];

for (const file of FILES) {
    const filePath = path.join(SRC_DIR, `${file.name}.ts`);
    let text;
    try {
        text = readFileSync(filePath, 'utf8');
    } catch {
        fail(`missing source file: ${filePath}`);
    }

    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2017, true, ts.ScriptKind.TS);
    const keptSlices = [];
    const relativeConsts = [];

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const moduleSpecifier = statement.moduleSpecifier.text;
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly || clause.name || !clause.namedBindings) {
                fail(`${file.name}.ts: unsupported import form from '${moduleSpecifier}'`);
            }

            const leadingTrivia = text.slice(statement.getFullStart(), statement.getStart(sourceFile));
            const hasTsIgnore = /@\s*ts-ignore/.test(leadingTrivia);

            if (moduleSpecifier.startsWith('.')) {
                const targetNamespace = file.relImports ? file.relImports[moduleSpecifier] : undefined;
                if (!targetNamespace) {
                    fail(
                        `${file.name}.ts: relative import '${moduleSpecifier}' is not mapped — ` +
                            `add it to relImports in scripts/build.mjs`,
                    );
                }
                if (!ts.isNamedImports(clause.namedBindings)) {
                    fail(`${file.name}.ts: namespace/default import from '${moduleSpecifier}' is not supported`);
                }
                const names = importedNames(clause.namedBindings, `${file.name}.ts`);
                relativeConsts.push(`const { ${names.join(', ')} } = ${targetNamespace};`);
            } else {
                if (!ts.isNamedImports(clause.namedBindings)) {
                    fail(`${file.name}.ts: namespace/default import from '${moduleSpecifier}' is not supported`);
                }
                let entry = externalImports.get(moduleSpecifier);
                if (!entry) {
                    entry = { names: [], tsIgnore: false };
                    externalImports.set(moduleSpecifier, entry);
                }
                if (hasTsIgnore) entry.tsIgnore = true;
                for (const name of importedNames(clause.namedBindings, `${file.name}.ts`)) {
                    const owner = nameOwner.get(name);
                    if (owner && owner !== moduleSpecifier) {
                        fail(`import name '${name}' comes from both '${owner}' and '${moduleSpecifier}'`);
                    }
                    nameOwner.set(name, moduleSpecifier);
                    if (!entry.names.includes(name)) entry.names.push(name);
                }
            }
            continue;
        }

        if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name)) {
            hoistedStatements.push(text.slice(statement.getFullStart(), statement.getEnd()));
            continue;
        }

        if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
            fail(`${file.name}.ts: top-level export statements are not supported in the bundle`);
        }

        keptSlices.push(text.slice(statement.getFullStart(), statement.getEnd()));
    }

    let body;
    if (relativeConsts.length > 0 && keptSlices.length > 0) {
        const [firstSlice, ...restSlices] = keptSlices;
        body =
            relativeConsts.join('\n') +
            '\n' +
            firstSlice.replace(/\r\n/g, '\n').replace(/^\n+/, '\n') +
            restSlices.join('');
    } else {
        body = relativeConsts.join('\n') + (relativeConsts.length ? '\n' : '') + keptSlices.join('');
    }

    if (file.ns === null) {
        if (body.trim().length > 0) hoistedStatements.push(body);
    } else {
        if (body.trim().length === 0) fail(`${file.name}.ts: file produced no statements`);
        namespaceBlocks.push(`namespace ${file.ns} {\n${indentBlock(body)}\n}`);
    }
}

if (externalImports.size === 0) {
    fail('no external imports found — output would not be an ES module (declare global would be invalid)');
}

const parts = [];
parts.push('// AUTO-GENERATED by scripts/build.mjs from source/*.ts — DO NOT EDIT');
parts.push('// Run `npm run build` to regenerate.\n');

const sortedModules = [...externalImports.keys()].sort((a, b) => {
    if (a === 'cc') return -1;
    if (b === 'cc') return 1;
    return 0;
});
for (const moduleSpecifier of sortedModules) {
    const entry = externalImports.get(moduleSpecifier);
    if (entry.tsIgnore) parts.push('// @ts-ignore');
    if (entry.names.length > 5) {
        const lines = entry.names.map((name) => `    ${name},`).join('\n');
        parts.push(`import {\n${lines}\n} from '${moduleSpecifier}';`);
    } else {
        parts.push(`import { ${entry.names.join(', ')} } from '${moduleSpecifier}';`);
    }
}
parts.push('');

if (hoistedStatements.length > 0) {
    parts.push(hoistedStatements.join('\n'));
    parts.push('');
}

parts.push(namespaceBlocks.join('\n\n'));
parts.push('');

for (const api of PUBLIC_API) {
    parts.push(`export const ${api.member} = ${api.ns}.${api.member};`);
}
parts.push('');

const globalTypeMembers = PUBLIC_API.map((api) => `    const ${api.member}: typeof ${api.ns}.${api.member};`).join('\n');
parts.push(`declare global {\n${globalTypeMembers}\n}`);
parts.push('');
parts.push('Object.assign(globalThis, { Gizmos2D, Gizmos3D });');
parts.push('');
const bundledTypeScript = parts.join('\n').replace(/\r\n/g, '\n');
mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, bundledTypeScript, 'utf8');

// The merged TypeScript above exists ONLY for declaration generation.
 // NEVER use it as a runtime script: it contains two decorated Components,
 // and Cocos Creator 3.8 rejects multiple Components in one script.
 // Compile source modules separately; each module owns at most one Component.
 // Public Gizmos.js only imports the helpers and installs two global APIs.
 // 'cc' and 'cc/env' remain engine-provided imports.
const runtimeModules = ['Define', 'ExecuteGizmos', 'Gizmos2D', 'Gizmos3D'];
const compilerOptions = {
    target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.ESNext,
    experimentalDecorators: true,
    useDefineForClassFields: false,
    removeComments: false,
};

function transpileRuntimeModule(name) {
    const sourcePath = path.join(SRC_DIR, name + '.ts');
    const text = readFileSync(sourcePath, 'utf8');
    const output = ts.transpileModule(text, {
        fileName: sourcePath,
        reportDiagnostics: true,
        compilerOptions,
    });
    const errors = (output.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) fail(name + ' transpilation failed: ' + errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\\n')).join('; '));

    // Runtime source only uses ./Define; enforce a concrete generated .js
    // extension for Cocos ESM resolution. Never rewrite 'cc' or 'cc/env'.
    let generated = output.outputText;
    if (name === 'ExecuteGizmos' || name === 'Gizmos3D') {
        generated = generated.replaceAll("from './Define'", "from './Define.js'")
                             .replaceAll('from "./Define"', 'from "./Define.js"');
        if (!generated.includes('Define.js')) fail(name + ' missing compiled Define import');
    }
    writeFileSync(path.join(ROOT, 'dist', name + '.js'), generated, 'utf8');
}

mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
for (const name of runtimeModules) transpileRuntimeModule(name);

const entry = `// AUTO-GENERATED by scripts/build.mjs — public entry, no Component declarations.
import { Gizmos2D } from './Gizmos2D.js';
import { Gizmos3D } from './Gizmos3D.js';
import './ExecuteGizmos.js';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

// Register globals only after both internal Component modules initialize.
if (EDITOR_NOT_IN_PREVIEW) Object.assign(globalThis, { Gizmos2D, Gizmos3D });
export { Gizmos2D, Gizmos3D };
`;
writeFileSync(JS_OUT_FILE, entry, 'utf8');
console.log('[build] wrote runtime modules separately (one Component per script) and ' + path.relative(ROOT, JS_OUT_FILE));
