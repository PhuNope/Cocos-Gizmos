import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const fail = (reason) => { throw new Error('[verify-output] ' + reason); };
const actual = readdirSync(dist).sort();
const expected = ['Gizmos.d.ts', 'Gizmos.js'];
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('Expected exactly Gizmos.js and Gizmos.d.ts: ' + actual.join(', '));
}
const js = readFileSync(path.join(dist, 'Gizmos.js'), 'utf8');
const source = ts.createSourceFile('Gizmos.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const exported = [];
for (const stmt of source.statements) {
    if (!ts.canHaveModifiers(stmt) || !(ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (!ts.isVariableStatement(stmt)) fail('Unexpected non-class export');
    for (const declaration of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) fail('Unexpected export declaration');
        exported.push(declaration.name.text);
    }
}
if (JSON.stringify(exported.sort()) !== JSON.stringify(['Gizmos2D', 'Gizmos3D'])) {
    fail('Expected exactly two named class exports, got: ' + exported.join(', '));
}
if (!js.includes('Object.assign(globalThis, { Gizmos2D, Gizmos3D })')) fail('Global runtime registration missing');
const dts = readFileSync(path.join(dist, 'Gizmos.d.ts'), 'utf8');
for (const required of ['export declare class Gizmos2D', 'export declare class Gizmos3D',
    "const Gizmos2D: typeof import('./Gizmos').Gizmos2D",
    "const Gizmos3D: typeof import('./Gizmos').Gizmos3D",
    'onDrawGizmos?(): void;']) {
    if (!dts.includes(required)) fail('Missing declaration: ' + required);
}
console.log('[verify-output] exactly two files, two named exports, global classes, and editor hooks OK');
