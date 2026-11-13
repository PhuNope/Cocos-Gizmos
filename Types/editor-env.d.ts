// Local type shim: Cocos Creator supplies cc/env at runtime.
// The editor-only flags are absent from @cocos/creator-types' public typings.
declare module 'cc/env' {
    export const EDITOR_NOT_IN_PREVIEW: boolean;
}
