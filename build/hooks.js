'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { stripBuild } = require('./strip.js');
exports.throwError = true;
exports.onAfterBuild = async function (options, result) {
    const dest = (result && result.dest) || (options && options.dest);
    if (typeof dest !== 'string' || !path.isAbsolute(dest) || !fs.existsSync(dest)) {
        throw new Error('[cocos-gizmos] Cannot identify absolute build output directory; no project files modified');
    }
    const stats = stripBuild(dest);
    console.log('[cocos-gizmos] Editor-only release verified: removed ' +
        stats.removedFiles + ' standalone Gizmos scripts; stripped ' +
        stats.removedMethods + ' debug methods from ' + stats.changedFiles + ' built JS files');
};
