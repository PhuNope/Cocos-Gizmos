'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = (() => {
    try { return require('./vendor/typescript.js'); }
    catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes('vendor/typescript.js')) throw error;
        return require('typescript'); // Local npm tests; parser is vendored in release ZIP
    }
})();
const CALLBACKS = new Set(['onDrawGizmos', 'onDrawGizmosSelected', 'onSelectedGizmos', 'onSelectedGizmsos']);
const RUNTIME = new Set(['Gizmos2D', 'Gizmos3D', 'GizmosDebugDraw', 'gizmosUpdate']);
const STANDALONE = new Set(['Define.js', 'ExecuteGizmos.js', 'Gizmos.js', 'Gizmos2D.js', 'Gizmos3D.js']);

function propertyName(name) {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
    return null;
}
function parse(source, name) {
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const errors = ast.parseDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error('[cocos-gizmos] Unsupported JS syntax in ' + name + ': ' +
        ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'));
    return ast;
}
function detectAndStrip(source, fileName) {
    const ast = parse(source, fileName);
    const spans = [];
    const visit = node => {
        const member = ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) ||
            ts.isPropertyAssignment(node);
        if (member && CALLBACKS.has(propertyName(node.name))) {
            let start = node.getStart(ast), end = node.end;
            if (ts.isObjectLiteralExpression(node.parent)) {
                const following = source.slice(end).match(/^\s*,/);
                const preceding = source.slice(0, start).match(/,\s*$/);
                if (following) end += following[0].length;
                else if (preceding) start -= preceding[0].length;
            }
            spans.push({ start, end });
            return;
        }
        if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) &&
            node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.expression.left) &&
            CALLBACKS.has(node.expression.left.name.text)) {
            spans.push({ start: node.getStart(ast), end: node.end });
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    const ordered = spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].start < ordered[i-1].end) throw new Error('Overlapping AST method edits');
    }
    let output = source;
    for (const {start, end} of ordered.reverse()) {
        output = output.slice(0, start) +
            output.slice(start, end).replace(/[^\n\r]/g, ' ') +
            output.slice(end);
    }
    return {text: output, removed: spans.length};
}
function findForbiddenCode(source, fileName) {
    const found = new Set();
    const visit = node => {
        if (ts.isIdentifier(node) && (RUNTIME.has(node.text) || CALLBACKS.has(node.text))) found.add(node.text);
        if (ts.isStringLiteral(node) &&
            /(?:Gizmos[23]D\.GizmosDebugDraw|gizmosUpdating|extensions[/\\]cocos-gizmos[/\\]dist)/.test(node.text)) {
            found.add(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(parse(source, fileName));
    return [...found];
}
function isStandaloneRuntime(relative) {
    // NEVER delete shared compiled chunks based on a substring match.
    const parts = relative.split('/');
    const at = parts.findIndex(p => p === 'cocos-gizmos');
    return at >= 0 && parts[at+1] === 'dist' && parts.length === at+3 &&
        STANDALONE.has(parts[parts.length - 1]);
}
function stripBuild(root) {
    const dest = fs.realpathSync(root);
    if (!fs.statSync(dest).isDirectory()) throw new Error('Build output is not a directory');
    const files = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) throw new Error('[cocos-gizmos] Unsafe symlink in output: ' + file);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) files.push(file);
        }
    };
    walk(dest);
    const writes = [], deletes = [];
    let removedMethods = 0;
    for (const file of files) {
        const relative = path.relative(dest, file).split(path.sep).join('/');
        if (isStandaloneRuntime(relative)) { deletes.push(file); continue; }
        const source = fs.readFileSync(file, 'utf8');
        if (!/(Gizmos|gizmos)/.test(source)) continue;
        const transformed = detectAndStrip(source, relative);
        const remaining = findForbiddenCode(transformed.text, relative);
        if (remaining.length) {
            throw new Error('[cocos-gizmos] ' + relative +
                ' still contains editor-only symbols (' + remaining.slice(0,6).join(', ') +
                '). Gizmos is bundled in a shared chunk or used in game code. ' +
                'Cannot remove safely; build refused and output left unchanged.');
        }
        if (transformed.removed) {
            writes.push([file, transformed.text]);
            removedMethods += transformed.removed;
        }
    }
    // Atomic planning: never alter a build until ALL candidates are verified.
    for (const [file, content] of writes) fs.writeFileSync(file, content, 'utf8');
    for (const file of deletes) fs.unlinkSync(file);
    return {removedFiles:deletes.length, removedMethods, changedFiles:writes.length};
}
module.exports = {stripBuild, detectAndStrip, findForbiddenCode, isStandaloneRuntime};
