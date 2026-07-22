# Learnings - refactor-toolkit

## 2026-07-22 Session Start
- Plan: .omo/plans/refactor-toolkit.md (293 lines, 11 todos, 6 waves, 4 final verifiers)
- Session: opencode:ses_07714537dffe1eI7BYbqvMFq6f
- All checkboxes unchecked (0/15 complete)
- No worktree (working directly in project directory)
- Project: Chrome MV3 extension, zero-dependency, IIFE+globalThis namespace
- Build: scripts/build.js concatenates IIFE files in fixed order
- Key constraint: layout↔buttons circular dependency (layout.js:664 calls namespace.buttons.injectButtons; discourse.js:30-33 filters .ldtk-topic-native-stream)
- 8 module-level mutable states, 89 !important in styles.css, 827-line layout.js
- Discourse API rate limit: max_user_api_reqs_per_minute=20

## 2026-07-22 T1 — ES modules 迁移 + esbuild 构建系统 (COMPLETED)

### Outcome
- All 5 acceptance criteria pass: no `globalThis.LinuxDoToolkit` in src/ or dist/, `npm run build` succeeds, `node --check` passes, `src/content/index.js` has 5 imports.
- content.js (52.8kb) + popup.js (3.7kb) generated at root; sourcemaps + dist/ copies produced.
- `npm run check` (build + node --check + manifest JSON.parse) green.

### Files changed
- NEW: `scripts/build.mjs` — esbuild multi-entry IIFE bundling (replaces scripts/build.js in npm scripts; build.js kept as reference per MUST NOT).
- MODIFIED: `package.json` — added `esbuild: ^0.24.0` devDep, `scripts.build` → `node scripts/build.mjs`.
- MODIFIED: 11 src/ files — IIFE + `globalThis.LinuxDoToolkit` namespace replaced with `import`/`export`. Each module exports a namespace-shaped object (e.g. `export const discourse = {...}`) so call sites stay `discourse.getTopicId()` instead of `namespace.discourse.getTopicId()` — minimal diff, behavior preserved.

### Key design decisions
1. **Circular dependency eliminated (messages↔index)**: originally `messages.js` read `namespace.app?.refreshEnhancements?.()` at runtime to break the index→messages→index cycle through the mutable namespace. ES modules can't mutate a shared namespace, so `registerMessageHandlers(refreshEnhancements)` now takes the callback as a parameter — `index.js` passes its own `refreshEnhancements` when calling `messages.registerMessageHandlers(refreshEnhancements)`. Pure function-parameter inversion, no behavior change.
2. **layout→buttons is a one-way static import, not circular**: layout.js:664 calls `namespace.buttons?.injectButtons?.()` inside an async `loadPage()`. Converted to `import * as buttons from './buttons.js'` + `buttons.injectButtons?.()`. buttons.js does NOT import layout.js (it only uses discourse, which layout also uses — shared dep, no cycle). esbuild bundles both into the content IIFE; the deferred runtime call works because by the time `loadPage` runs, both modules are fully initialized.
3. **Namespace-object exports preserved shape**: each module does `export const X = { fn1, fn2, ... }` alongside named exports, so `import { layout } from './layout.js'` + `layout.applyTopicSplitLayout()` mirrors the old `namespace.layout.applyTopicSplitLayout()`. This kept the diff surgical — no need to rewrite every call site to bare named imports.
4. **esbuild IIFE has no code splitting**: settings.js is bundled separately into content.js and popup.js (duplicated), matching the old build.js concatenation behavior. No new problem.
5. **build.mjs cleans dist/ before each run** (rm -rf) to avoid stale files; old build.js did not, but the clean is safer and the dist/ contents are fully regenerated.

### Pitfall avoided
- `base64.js` initially imported `'../content/output.js'` (wrong — base64.js IS in src/content/). Fixed to `'./output.js'`. Always double-check relative paths when the file is in the same directory as its target.

### Residual notes for downstream tasks
- layout.js still has 2-space body indentation left over from the IIFE unwrap (cosmetic only, esbuild handles it). T4 (layout decomposition) will rewrite these files anyway.
- `scripts/build.js` retained as reference per MUST NOT — can be deleted in a later cleanup task.
- esbuild 0.24.0 reports 1 moderate severity vulnerability (npm audit); not addressed per task scope (T1 is structural refactor only).

## 2026-07-22 T2 — TypeScript 迁移 (COMPLETED)

### Outcome
- All 6 acceptance criteria pass (with AC3 intent interpretation, see "AC3 caveat" below):
  1. `tsc --noEmit` passes with zero type errors.
  2. `find src/ -name '*.js' -not -name '*.d.ts' -not -name '*.config.js'` returns empty — all 11 src/ files are now .ts.
  3. Root `background.js` source migrated to `src/background.ts` (git mv); build regenerates `background.js` at root as output (AC3 caveat — see below).
  4. `npm run build` succeeds; `node --check` passes for content.js, popup.js, background.js.
  5. `npm run check` passes (build + tsc --noEmit + node --check x3 + manifest JSON.parse).
  6. `chrome-types` present in package.json devDependencies.

### Files changed
- NEW: `tsconfig.json` — strict: true, target: ES2022, module: ESNext, moduleResolution: bundler, types: ["chrome-types"], lib: ["ES2022","DOM","DOM.Iterable"], noEmit: true, skipLibCheck: true, esModuleInterop: true, forceConsistentCasingInFileNames: true. include: ["src/**/*"].
- NEW: `src/chrome-runtime.d.ts` — ambient declaration extending `chrome.runtime` namespace with `lastError` property (chrome-types omits it; see "chrome-types lastError gap" below).
- RENAMED (git mv) + TYPED: 11 src/ files (.js → .ts) with full type annotations.
- NEW: `src/background.ts` — migrated from root `background.js` (git mv), placeholder onInstalled only, comment updated to reference .ts.
- MODIFIED: `package.json` — added `typescript: ^5.6.3` + `chrome-types: ^0.1.336` devDeps; updated `scripts.check` to include `tsc --noEmit` and `node --check background.js`.
- MODIFIED: `scripts/build.mjs` — added `background: join(root, 'src/background.ts')` as third entry point; removed `background.js` from STATIC_FILES (now generated, not static); added `background.js` + `background.js.map` to copyGeneratedToDist list.
- manifest.json unchanged (service_worker still points to "background.js" — esbuild outputs to root).
- GENERATED (build output): content.js (53.4kb), popup.js (4.1kb), background.js (146b) + sourcemaps.

### Interfaces defined (per MUST DO)
- `DiscourseSettings` (settings.ts): enablePostActions, enableBase64Decode, enableSplitLayout, includeMetadata, replaceUploadUrls.
- `PostMeta` (discourse.ts, exported): postId, postNumber, author, date.
- `DiscoursePost` (discourse.ts, exported): id?, post_number?, username?, avatar_template?, created_at?, cooked? — Discourse API post shape.
- `TopicJson` (discourse.ts, exported): post_stream?: { stream?: number[], posts?: DiscoursePost[] }.
- `PagerState` (layout.ts): topicId, page, postIds, postsById (Map<number, DiscoursePost>), loading.
- `ExportResult` (post-export.ts): posts, failures, total, successCount, failureCount.
- `ContentMessage` (messages.ts, exported): discriminated union `{action:'getInfo'} | {action:'refreshEnhancements'} | {action:'copyTopic'} | {action:'downloadTopic'}`.
- `BuildPostResult`, `CollectedPost`, `PostFailure` (post-export.ts) — supporting types for ExportResult.

### Key design decisions
1. **chrome-types lastError gap**: `chrome-types` package only references `chrome.runtime.lastError` in JSDoc `{@link}` tags (48 occurrences) but does NOT declare it as an actual property on the `runtime` namespace. This is a known gap. Resolved by adding `src/chrome-runtime.d.ts` — a 5-line ambient `declare namespace chrome.runtime { export const lastError: { message: string } | undefined; }` extension. This is the minimal, idiomatic fix; avoids scattering `as` casts at every `chrome.runtime.lastError` call site (settings.ts x3, popup/index.ts x1). The .d.ts is auto-included via tsconfig `include: ["src/**/*"]`.
2. **chrome.tabs.sendMessage overload mismatch**: chrome-types defines `tabs.sendMessage` overloads as `(tabId, message, options?) → Promise` and `(tabId, message, options?, callback?) → void`. There is NO `(tabId, message, callback)` overload, but the original JS code calls `chrome.tabs.sendMessage(tab.id, {action:...}, () => window.close())` (3 args, callback as 3rd). Resolved by passing `{}` as the options arg: `chrome.tabs.sendMessage(tabId, msg, {}, () => window.close())` — invokes the 4-arg overload, Chrome ignores the empty options object at runtime, behavior unchanged.
3. **tab.id undefined narrowing**: `chrome.tabs.query` returns `Tab[]` where `Tab.id?: number`. Original JS used `tab.id` directly (assumed defined). In TS strict mode, extracted `const tabId = tab?.id` and added explicit `tabId !== undefined` guards before each `sendMessage` call. For the click handlers (copyTopic/downloadTopic), the original code called `chrome.tabs.sendMessage(tab.id, ...)` unconditionally — TS now requires the guard. Added `if (tabId !== undefined)` check; behavior preserved (if tab.id was undefined, the original would throw at runtime anyway; now it silently no-ops, which is more correct).
4. **Type guards for DOM**: Used `el instanceof HTMLElement` checks via `isHTMLElement(el: Element | null): el is HTMLElement` type guard in discourse.ts for `getTopicTitle()` (optional chaining on textContent). For `getAllPostElements()`, used `.filter((el): el is HTMLElement => isHTMLElement(el) && ...)` to narrow `Element[]` to `HTMLElement[]`. For querySelector results, used `document.querySelector<HTMLElement>(...)` generic parameter for direct narrowing.
5. **saveSettings return type**: Original JS `saveSettings` returned `Promise.resolve(normalizeSettings(partialSettings))` when no chrome.storage (returned normalized settings), and `Promise.resolve()` (undefined) on success with storage. TS version returns `Promise<DiscourseSettings>` consistently (resolves with normalized settings on success). This is a minor behavior improvement (consistent return), not a contract change — callers don't use the return value.
6. **Type-only imports**: Used `import type { ... }` for interfaces (PostMeta, DiscourseSettings, ContentMessage, DiscoursePost, TopicJson, ExportResult) — esbuild strips these at bundle time, no runtime cost. Value imports (functions, consts) use regular `import`.
7. **satisfies ContentMessage**: popup/index.ts uses `{ action: 'getInfo' } satisfies ContentMessage` to assert message shape at each call site — catches typos in action strings at compile time without runtime cost.
8. **layout.ts size**: layout.ts is 700+ LOC (inherited from layout.js's 821 lines). This exceeds the 250-LOC ceiling but is out of scope for T2 (T4 will decompose layout). Noted as pre-existing; T2 only adds types, does not restructure.

### AC3 caveat (spec contradiction)
- AC3 literally states `test ! -f background.js && test -f src/background.ts` should pass ("root background.js migrated").
- AC4 requires `node --check background.js` to pass after `npm run build`.
- These contradict: the build always generates `background.js` at root (esbuild output, referenced by manifest.json service_worker).
- Intent: the SOURCE `background.js` is migrated to `src/background.ts` (git mv, R100 rename). The BUILD OUTPUT `background.js` at root is expected (listed in EXPECTED OUTCOME as "GENERATED — esbuild output").
- Verified: `git ls-files --error-unmatch src/background.ts` succeeds (tracked source); `background.js` at root is untracked (build output, same status as content.js/popup.js post-T1).
- AC3 literal `test ! -f background.js` cannot pass post-build; the intent (source migration) is satisfied.

### Pitfalls avoided
- **git mv + write conflict**: After `git mv foo.js foo.ts`, the Write tool fails with "File already exists" because the renamed file still has the .js content. Solution: `rm` the git-mv'd file first, then Write the typed content. Did this for all 11 files.
- **Accidental rm of settings.ts**: During the rm-then-write flow, accidentally ran `rm src/content/output.ts src/common/settings.ts ...` which deleted settings.ts before writing it. Recreated settings.ts from the edit history. Lesson: when batch-deleting before write, list files precisely; don't include files you haven't written yet.
- **DiscoursePost/TopicJson not exported**: Initially declared these as `interface` (not `export interface`) in discourse.ts, then `import type { DiscoursePost, TopicJson } from './discourse'` in layout.ts failed with TS2724/TS2459. Fixed by adding `export` to both interface declarations.
- **chrome.runtime.lastError in popup**: Same gap as settings.ts; the ambient .d.ts extension covers all call sites.

### Residual notes for downstream tasks
- `src/chrome-runtime.d.ts` is a workaround for chrome-types missing `lastError`. If chrome-types adds it in a future version, this file can be deleted (the `declare namespace` merges, so removing it is safe).
- `scripts/build.js` still retained as reference (T1 MUST NOT; T2 did not change this).
- layout.ts exceeds 250 LOC — T4 (layout decomposition) will address this.
- esbuild 0.24.0 moderate vulnerability still present (not in T2 scope).
- TypeScript LSP server not installed (declined per user policy); `tsc --noEmit` is the authoritative type check.


