import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const fail = (message) => { throw new Error('[verify-output] ' + message); };
const expected = ['Define.js', 'ExecuteGizmos.js', 'Gizmos.d.ts', 'Gizmos.js', 'Gizmos2D.js', 'Gizmos3D.js'].sort();
const actual = readdirSync(dist).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('Expected six runtime and type files, got: ' + actual.join(', '));
}
const read = (name) => readFileSync(path.join(dist, name), 'utf8');
const publicEntry = read('Gizmos.js');
const ast = ts.createSourceFile('Gizmos.js', publicEntry, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const exported = [];
for (const statement of ast.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const spec of statement.exportClause.elements) exported.push(spec.name.text);
    } else if (ts.isVariableStatement(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name)) fail('unexpected destructuring export');
            exported.push(decl.name.text);
        }
    } else if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) {
        fail('Unexpected export form in public entry');
    }
}
if (JSON.stringify(exported.sort()) !== JSON.stringify(['Gizmos2D', 'Gizmos3D'])) {
    fail('Only Gizmos2D and Gizmos3D may be publicly exported: ' + exported);
}
if (!publicEntry.includes('Object.assign(globalThis, { Gizmos2D, Gizmos3D })')) {
    fail('Missing runtime global registration');
}
// Cocos 3.8.x: Each script can have at most one Component. The old single-file
// bundle contained both decorated GizmosDebugDraw components and crashed.
// Check actual class decorators in each original source module. Their emitted
// counterparts must remain in different JS files (never concatenate again).
let totalDecorated = 0;
for (const name of ['Gizmos2D', 'Gizmos3D', 'Define', 'ExecuteGizmos']) {
    const sourceFile = path.join(root, 'source', name + '.ts');
    const sourceText = readFileSync(sourceFile, 'utf8');
    const source = ts.createSourceFile(sourceFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let decorated = 0;
    const visit = node => {
        if (ts.isClassDeclaration(node) && node.heritageClauses?.some(h => h.types.some(t => t.expression.getText(source) === 'Component'))) {
            if (ts.getDecorators(node)?.some(d => /ccclass/.test(d.expression.getText(source)))) decorated++;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    if (decorated > 1) fail(name + '.js would register more than one Component');
    const output = read(name + '.js');
    if (decorated === 1 && !output.includes('GizmosDebugDraw')) fail(name + '.js is missing the expected private Component');
    totalDecorated += decorated;
}
if (totalDecorated !== 2) fail('Expected exactly two separate private Component scripts');
if (/ccclass\\s*\\(/.test(publicEntry) || /__decorate/.test(publicEntry)) {
    fail('Public entry must not register a Cocos Component');
}
for (const dependency of ['Gizmos2D.js', 'Gizmos3D.js', 'ExecuteGizmos.js']) {
    if (!publicEntry.includes("'" + (dependency === 'ExecuteGizmos.js' ? './ExecuteGizmos.js' : './' + dependency) + "'")) {
        fail('Missing module dependency ' + dependency);
    }
}
const dts = read('Gizmos.d.ts');
for (const line of ['export declare class Gizmos2D', 'export declare class Gizmos3D',
    "const Gizmos2D: typeof import('./Gizmos').Gizmos2D",
    "const Gizmos3D: typeof import('./Gizmos').Gizmos3D",
    'onDrawGizmos?(): void;']) {
    if (!dts.includes(line)) fail('Declaration is missing: ' + line);
}
console.log('[verify-output] two public globals, two separated private Components, and TypeScript declarations OK');
