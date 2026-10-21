'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = (() => {
    try { return require('./vendor/typescript.js'); }
    catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes('vendor/typescript.js')) throw error;
        return require('typescript'); // Local npm tests; release ZIP bundles this parser.
    }
})();
const CALLBACKS = new Set(['onDrawGizmos', 'onDrawGizmosSelected']);
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
    if (errors.length) throw new Error('[cocos-gizmos] Unable to parse ' + name + ': ' +
        ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'));
    return ast;
}
function functionLike(node) {
    return ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}
function isCallbackAssignment(node) {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
    const left = node.left;
    const named = ts.isPropertyAccessExpression(left) ? left.name.text :
        ts.isElementAccessExpression(left) && ts.isStringLiteral(left.argumentExpression)
            ? left.argumentExpression.text : null;
    return CALLBACKS.has(named) && functionLike(node.right);
}
function isComma(node) {
    return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken;
}
function flattenComma(node, expressions, commas) {
    if (isComma(node)) {
        flattenComma(node.left, expressions, commas);
        commas.push(node.operatorToken);
        flattenComma(node.right, expressions, commas);
    } else {
        expressions.push(node);
    }
}
function detectAndStrip(source, fileName) {
    const ast = parse(source, fileName);
    const edits = [];
    let removed = 0;
    const blank = (start, end) => edits.push({start, end, replacement: ''});
    const visit = node => {
        if (isComma(node)) {
            const expressions = [], commas = [];
            flattenComma(node, expressions, commas);
            const keep = [];
            for (let i = 0; i < expressions.length; i++) {
                if (isCallbackAssignment(expressions[i])) {
                    removed++;
                } else {
                    keep.push(i);
                }
            }
            if (keep.length !== expressions.length) {
                if (keep.length === 0) {
                    // The whole comma expression consisted of debug callbacks.
                    edits.push({start:node.getStart(ast), end:node.end, replacement:'void 0'});
                    return;
                }
                // Keep one ORIGINAL comma between each pair of retained
                // expressions; blank all removed assignments and extra commas.
                // In particular handle Cocos/Rollup's:
                //   return t.start=fn,t.onDrawGizmos=fn,t.onDrawGizmosSelected=fn,n
                const keepCommas = new Set();
                for (let i = 0; i + 1 < keep.length; i++) keepCommas.add(keep[i]);
                for (let i = 0; i < commas.length; i++) {
                    if (!keepCommas.has(i)) blank(commas[i].getStart(ast), commas[i].end);
                }
                for (let i = 0; i < expressions.length; i++) {
                    if (isCallbackAssignment(expressions[i])) {
                        blank(expressions[i].getStart(ast), expressions[i].end);
                    } else {
                        visit(expressions[i]);
                    }
                }
                return;
            }
            for (const expression of expressions) visit(expression);
            return;
        }
        if (isCallbackAssignment(node)) {
            removed++;
            if (ts.isExpressionStatement(node.parent) && node.parent.expression === node) {
                blank(node.parent.getStart(ast), node.parent.end);
            } else {
                edits.push({start:node.getStart(ast), end:node.end, replacement:'void 0'});
            }
            return;
        }
        const isClassOrObjectMethod = ts.isMethodDeclaration(node);
        const isFunctionProperty = (ts.isPropertyAssignment(node) ||
            ts.isPropertyDeclaration(node)) && node.initializer && functionLike(node.initializer);
        if ((isClassOrObjectMethod || isFunctionProperty) &&
            CALLBACKS.has(propertyName(node.name))) {
            let start = node.getStart(ast), end = node.end;
            if (ts.isObjectLiteralExpression(node.parent)) {
                const following = source.slice(end).match(/^\s*,/);
                const preceding = source.slice(0, start).match(/,\s*$/);
                if (following) end += following[0].length;
                else if (preceding) start -= preceding[0].length;
            }
            blank(start, end);
            removed++;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    edits.sort((a, b) => a.start - b.start);
    for (let i = 1; i < edits.length; i++) {
        if (edits[i].start < edits[i - 1].end) {
            throw new Error('[cocos-gizmos] Overlapping callback edits in ' + fileName);
        }
    }
    // Keep original byte offsets/newlines for the rest of the System.register
    // chunk: compiled game code and nearby source locations remain untouched.
    let output = source;
    for (let i = edits.length - 1; i >= 0; i--) {
        const {start, end, replacement} = edits[i];
        const original = source.slice(start, end);
        const padding = original.slice(replacement.length).replace(/[^\r\n]/g, ' ');
        output = output.slice(0, start) + replacement + padding + output.slice(end);
    }
    if (removed && parse(output, fileName).parseDiagnostics.length) {
        throw new Error('[cocos-gizmos] Stripped output has invalid syntax in ' + fileName);
    }
    return {text: output, removed};
}
function isStandaloneRuntime(relative) {
    // Optional cleanup for legacy bundles; modern Gizmos is Scene-only.
    const parts = relative.split('/');
    const at = parts.findIndex(part => part === 'cocos-gizmos');
    return at >= 0 && parts[at+1] === 'dist' &&
        parts.length === at+3 && STANDALONE.has(parts[parts.length-1]);
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
        if (!/onDrawGizmos/.test(source)) continue;
        const transformed = detectAndStrip(source, relative);
        // Intentionally DO NOT inspect remaining Gizmos calls, helper methods,
        // if (EDITOR), or other user code. This is the requested behavior.
        if (transformed.removed) {
            writes.push([file, transformed.text]);
            removedMethods += transformed.removed;
        }
    }
    // Do not touch user's original assets/, only finished build output.
    for (const [file, content] of writes) fs.writeFileSync(file, content, 'utf8');
    for (const file of deletes) fs.unlinkSync(file);
    return {removedFiles:deletes.length, removedMethods, changedFiles:writes.length};
}
module.exports = {stripBuild, detectAndStrip, isStandaloneRuntime};
