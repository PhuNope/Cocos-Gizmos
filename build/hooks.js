'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { stripBuild } = require('./strip.js');
exports.throwError = true;
exports.onAfterBuild = async function (options, result) {
    const dest = (result && result.dest) || (options && options.dest);
    if (typeof dest !== 'string' || !path.isAbsolute(dest) || !fs.existsSync(dest)) {
        throw new Error('[cocos-gizmos] Cannot identify build output folder');
    }
    const stats = stripBuild(dest);
    console.log('[cocos-gizmos] Editor-only: removed ' + stats.removedMethods +
        ' Gizmos callbacks from ' + stats.changedFiles +
        ' built JS files; removed ' + stats.removedFiles +
        ' legacy standalone Gizmos scripts. Other Gizmos references are not checked.');
};
