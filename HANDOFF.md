# Handoff — Build Gizmos thành 1 file TS

## Tổng quan

Package Cocos Creator 3.8 (mount `./assets` readonly). Thư viện gizmos phát triển trong `source/` (ES modules), build gộp thành **1 file** `assets/Gizmos.ts` — consumer dùng global namespace `Gizmos`, **không import, không decorator**.

## Build

```bash
npm run build
```

3 bước tuần tự:

1. `tsc -p tsconfig.json --noEmit` — type-check `source/`
2. `node scripts/build.mjs` — gộp AST → `assets/Gizmos.ts`
3. `tsc -p tsconfig.assets.json --noEmit` — type-check output

Lưu ý môi trường: `npx` bị chặn PowerShell execution policy → dùng `npm.cmd run build`.

## Dùng API (consumer)

```ts
// KHÔNG import gì cả
Gizmos.Gizmos2D.drawCircle(node, pos, 100);
Gizmos.Gizmos3D.drawSphere(node, pos, 1);
```

- Global `Gizmos` chỉ có đúng 2 member: `Gizmos2D`, `Gizmos3D` (IntelliSense hiện đúng 2 mục)
- Đăng ký gizmos = **auto-discovery**: chỉ cần viết `onDrawGizmos()` / `onDrawGizmosSelected()` trong component — editor tự walk scene mỗi frame và gọi (chỉ editor, guard `if (Editor)`)
- `Gizmos.registerGizmos` **đã bị xoá** (`source/Decorator.ts` không còn)

## Cách build script hoạt động (`scripts/build.mjs`)

- Dùng TypeScript Compiler API (parse AST, không regex) — devDependency `typescript` có sẵn, **0 dep mới**
- Config đầu file:
  - `FILES`: thứ tự file + mapping import tương đối (`'./Define'` → `_Define`)
  - `PUBLIC_API`: surface của global `Gizmos` (thêm/bớt API sửa ở đây)
- Gỡ `import 'cc'` / `'cc/env'` → gộp dedupe lên đầu file (trùng tên khác module → fail-loud)
- `import { X } from './Define'` → sinh `const { X } = _Define;` trong namespace file đó
- `declare module 'cc'` (từ `Ext.ts`) → nâng lên top-level
- Mỗi file bọc `namespace _<Tên> { }` — **bắt buộc** vì các file trùng tên (`GizmosDebugDraw` ×2, `const { ccclass, executeInEditMode }` ×2, `Editor`)
- Output: **0 top-level export** (không thể import khỏi file) + `declare global` + `window.Gizmos = { Gizmos2D, Gizmos3D }`

## Trạng thái file

| Trạng thái | File |
|---|---|
| tạo mới | `scripts/build.mjs`, `tsconfig.assets.json`, `assets/Gizmos.ts` (generated — **commit vào git**, assets được mount vào project) |
| sửa | `tsconfig.json` (thêm include), `package.json` (build script), `source/ExecuteGizmos.ts` (auto-discovery), `source/Gizmos2D.ts`, `source/Gizmos3D.ts` (xóa block `declare namespace Gizmos` + import `cc/env`), `source/Ext.ts` (methods optional) |
| xoá | `source/Decorator.ts` |
| **chưa đụng** | `assets/Example.ts` (để đó chờ sửa — xem TODO) |

## TODO còn lại

1. Sửa `assets/Example.ts`:
   - bỏ decorator `@registerGizmos` + comment nhắc nó (auto-discovery không cần)
   - `Gizmos3D.` → `Gizmos.Gizmos3D.`, `Gizmos2D.` → `Gizmos.Gizmos2D.`
   - không thêm import nào
2. Sau khi sửa: bỏ `"exclude": ["assets/Example.ts"]` trong `tsconfig.assets.json` để Example được type-check trong build
3. Mở Cocos kiểm tra: node có Example hiện gizmos, console không lỗi; tạo 1 script mới gọi `Gizmos.*` không import → chạy được (editor + preview)
4. Cocos tự sinh `assets/Gizmos.ts.meta` lần đầu mở project → commit kèm

## Kiến thức quan trọng (đừng quên)

- **Docs Cocos 3.8**: mọi script được load lúc boot, TRƯỚC khi deserialization — nhưng **thứ tự eval không xác định** khi không có import → cấm tham chiếu `Gizmos` lúc eval (ví dụ decorator). Auto-discovery giải quyết đúng vấn đề này; method body (`onDrawGizmos`, `update`) chạy sau boot nên an toàn
- **Pattern type đã test thực tế bằng TS API**: `declare global { const Gizmos: { Gizmos2D: typeof _Gizmos2D.Gizmos2D; ... } }` — namespace local **phải đặt tên khác** `Gizmos` (đặt trùng → lỗi TS2502 self-reference)
- `typeof <namespace local>` trong `declare global` hợp lệ; object literal 2 member đảm bảo IntelliSense chỉ hiện 2 mục
- Sau khi sửa `source/`, luôn chạy lại `npm run build` — **không sửa tay `assets/Gizmos.ts`** (file AUTO-GENERATED)

## Verification hiện tại

- `npm run build` → exit 0 (cả 3 bước)
- 19 structural checks: 0 top-level export, `declare global` đúng 2 member, không `registerGizmos`, không relative import leak, không trailing whitespace/CR
- Consumer type test: `Gizmos.Gizmos2D`/`Gizmos.Gizmos3D` resolve không cần import; `Gizmos.registerGizmos` xác nhận không tồn tại
