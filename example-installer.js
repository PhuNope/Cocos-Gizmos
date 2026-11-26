'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXAMPLE_FILES = Object.freeze([
    'CocosGizmos2DDemo.ts', 'CocosGizmos2DDemo.ts.meta',
    'CocosGizmos3DDemo.ts', 'CocosGizmos3DDemo.ts.meta',
    'CocosGizmosSmokeDemo.ts', 'CocosGizmosSmokeDemo.ts.meta',
    'CocosGizmosDecoratorDemo.ts', 'CocosGizmosDecoratorDemo.ts.meta',
    'RegisterGizmos.ts', 'RegisterGizmos.ts.meta',
]);

/**
 * User-triggered installation only: startup never modifies a project.
 * Only creates assets/Example with bundled .meta identities. Existing
 * project files are never overwritten.
 */
async function installExample(editor, extensionRoot = __dirname) {
    const projectPath = editor?.Project?.path;
    if (typeof projectPath !== 'string' || !projectPath.trim()) {
        throw new Error('Cannot install examples: no Cocos Creator project is open');
    }
    const assetsRoot = path.join(path.resolve(projectPath), 'assets');
    if (!fs.existsSync(assetsRoot) || !fs.statSync(assetsRoot).isDirectory()) {
        throw new Error('Cannot install examples: project assets directory is missing');
    }
    const destination = path.join(assetsRoot, 'Example');
    const directoryMeta = path.join(assetsRoot, 'Example.meta');
    const assetUrl = 'db://assets/Example';
    if (fs.existsSync(destination)) {
        editor?.warn?.('[cocos-gizmos] assets/Example already exists; no files were overwritten.');
        return {status: 'already-exists',url:assetUrl,files:[]};
    }
    if (fs.existsSync(directoryMeta)) {
        throw new Error('assets/Example.meta already exists; not replacing project metadata');
    }
    const templates = path.join(extensionRoot, 'example-templates');
    const pairs = [
        [path.join(templates, 'Example.meta'), directoryMeta],
        ...EXAMPLE_FILES.map(name=>[
            path.join(templates,'Example',name),path.join(destination,name),
        ]),
    ];
    for(const [source] of pairs) {
        if(!fs.statSync(source).isFile()) {
            throw new Error('Invalid example template: ' + path.basename(source));
        }
    }
    fs.mkdirSync(destination); // exclusive: reject any existing user folder
    let wroteMeta=false;
    try {
        for(const [source,target] of pairs) {
            fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
            if(target===directoryMeta)wroteMeta=true;
        }
    } catch(error) {
        fs.rmSync(destination,{recursive:true,force:true});
        if(wroteMeta)fs.rmSync(directoryMeta,{force:true});
        throw error;
    }
    let refresh='completed';
    try {
        // Refresh existing parent; Example is not indexed yet.
        await editor.Message.request('asset-db','refresh-asset','db://assets');
    } catch(error) {
        refresh='pending';
        editor?.warn?.('[cocos-gizmos] Example installed. Refresh Assets if not visible: '+
            String(error?.message||error));
    }
    editor?.log?.('[cocos-gizmos] Installed project examples: '+assetUrl);
    return {status:'installed',url:assetUrl,
        files:EXAMPLE_FILES.filter(name=>name.endsWith('.ts')),refresh};
}

module.exports={installExample,EXAMPLE_FILES};
