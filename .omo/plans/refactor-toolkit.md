# refactor-toolkit - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** 一个重构后的浏览器扩展工具箱，代码从松散的全局变量拼接改为现代模块化结构，巨型文件拆分为内聚小模块，CSS 样式冲突用标准隔离手段替代，帖子导出速度通过批量请求大幅提升，并建立测试和代码质量基础设施。

**Why this approach:** 先建立模块基础（ES modules + 构建工具），再在此基础上拆分巨型文件、优化性能、隔离样式、补测试和 lint。TypeScript 作为可否决的默认选择引入——它不是重构的核心目标，但为后续维护提供类型安全。每一步都有可执行的验收标准（grep/wc/npm 命令），不依赖人工判断。

**What it will NOT do:** 不增加任何新功能；不改变现有 Markdown 输出格式；不改变浏览器权限；不引入运行时依赖（发布包仍零依赖）；不改变用户可见的弹出窗口设计；不引入 CI/CD 或端到端测试。

**Effort:** Large
**Risk:** Medium - 关键路径是模块基础迁移（T1），若 esbuild IIFE 打包与运行时行为不一致可能导致加载失败，但有 node --check + Chrome 加载验证兜底
**Decisions I made for you:** TypeScript strict mode（可否决，若否决则 T2 跳过，保留 .js）；esbuild 作为开发依赖（发布包仍零运行时依赖，settings.js 在 content.js/popup.js 中各打包一份，与当前拼接行为一致）；Vitest 测试框架；Shadow DOM 仅用于按钮/Toast（base64 浮层保留 light DOM；Shadow DOM 内用 `<style>` 标签而非 Constructable Stylesheets 以兼容 chrome110 target）；ContentScriptManager 降级为条件项（仅当拆分后发现状态残留 bug 才引入）；layout.js 拆为 7 模块（header-title/topic-meta/footer-actions 分开，因合并后超 250 LOC）

Your next move: 计划已完成并通过双重高准确度评审。如需执行，运行 `/start-work`。完整执行细节见下方。

---

> TL;DR (machine): Large effort, Medium risk, 11 todos across 6 waves — ES modules→TS→layout decomposition(7 modules)→API perf→state extraction+event bus+observer→CSS isolation→quality/docs, all agent-verified via grep/wc/npm

## Scope
### Must have
1. 所有 `src/` 下源文件迁移为 ES modules（import/export），废弃 `globalThis.LinuxDoToolkit` 命名空间
2. TypeScript strict mode 类型化（可否决默认值，见 TL;DR Decisions）
3. esbuild 作为 devDependency 替代 scripts/build.js 拼接构建，产出 IIFE 格式 content.js/popup.js
4. layout.js（827行）拆分为 ≤250 LOC 的内聚模块（7 个：split-pane-layout, comment-pager, header-title-cloner, topic-meta-cloner, footer-actions-cloner, dom-queries, resize-handler）
5. 提取模块级可变状态（8个）到类型化状态容器
6. 事件总线解耦 layout→buttons 单向依赖（layout.loadPage 完成后发 'posts:rendered' 事件，buttons 订阅）
7. ManagedObserver 封装（3个 MutationObserver + resize listener 可 disconnect + pagehide 自动清理）
8. styles.css 中 !important 数量降至可量化阈值（前置探针确定 Discourse 是否对目标元素用 !important，据此设阈值）
9. 按钮和 Toast 迁入 Shadow DOM（closed mode）；base64 浮层保留 light DOM（寄生在 Discourse .quote-button 内）
10. collectLoadedPosts 串行 /raw/ 改为批量 posts.json?include_raw=true（前置探针验证参数可用性）+ 并发限制 + 429 Retry-After 退避
11. Vitest + jsdom + 手写 chrome mock 测试基础设施 + 12个纯函数单测 + 5个 HTML→Markdown 黄金用例
12. ESLint + Prettier 配置 + 统一错误处理（handleError 函数 + toast）
13. getSettings 调用区分初始化期（可缓存）与交互期（必须实时读 chrome.storage.sync）
14. 更新 README.md 澄清"零运行时依赖" + 新增开发说明
15. 更新 package.json scripts（build, check, test, lint, format）

### Must NOT have (guardrails, anti-slop, scope boundaries)
1. 不加新功能（新按钮、新 API、新 UI 组件）
2. 不改 Discourse API 端点契约（/raw/, /t/{id}.json, /t/{id}/posts.json 保持不变，仅 collectLoadedPosts 改用批量端点）
3. 不改 manifest.json permissions（activeTab, clipboardWrite, storage 不变）
4. 不引入运行时依赖（shipped dist/ 仍无 node_modules，仅 devDeps）
5. 不改 popup.html 的用户可见 UI 设计（仅内部代码 TS 化）
6. 不改现有 Markdown 输出格式（单楼/整帖格式不变）
7. 不引入 CI/CD 配置
8. 不引入 Playwright/e2e 测试（仅单测；前置探针用一次性 headless 脚本不属于 e2e 测试）
9. 不改 background.js 为有逻辑的 service worker（仍占位，仅 TS 化为 background.ts）
10. 不引入状态管理库（Redux/Zustand 等，用轻量类型化容器）
11. 不引入 CSS-in-JS 库（用 scoped CSS + Shadow DOM）
12. 不改 icons/ 资源文件
13. 不承诺"消除全部 89 处 !important"——阈值由前置探针结果决定
14. 不无条件缓存 getSettings——交互期（点击 handler）必须实时读
15. 不引入 ContentScriptManager 除非 T4 拆分后发现现有刷新机制导致状态残留 bug
16. 不用 Constructable Stylesheets（chrome110 target 不保证支持，用 `<style>` 标签替代）

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + framework: Vitest + jsdom/happy-dom
- Evidence: <attemptDir>/task-<N>-refactor-toolkit.<ext> (attemptDir = currentAttemptDir from 'omo ulw-loop status --json', .omo/evidence/ulw/<session>/<goalId>/a<attempt>; outside ulw-loop use .omo/evidence/)
- 所有验收标准为可执行命令（grep/wc/npm/curl/vitest），非描述性目标
- chrome mock 接口清单：`{ storage: { sync: {get, set}, onChanged: {addListener} }, runtime: {onMessage: {addListener}, lastError, sendMessage} }`

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- **Wave 1** (Foundation): T1 — ES modules + esbuild build
- **Wave 2** (Type safety + Test infra): T2, T3 — TypeScript migration ‖ Testing infrastructure
- **Wave 3** (Decomposition + API): T4, T5 — layout.js decomposition ‖ Discourse API performance
- **Wave 4** (Infrastructure): T6, T7, T8, T9 — State extraction ‖ Event bus ‖ ManagedObserver ‖ CSS isolation
- **Wave 5** (Quality): T10 — Code quality & error handling
- **Wave 6** (Docs): T11 — README & docs

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. ES modules + esbuild | — | 2,3,4,5,11 | — |
| 2. TypeScript migration | 1 | 4,5,6,7,8,9,10 | 3 |
| 3. Testing infrastructure | 1 | 10 | 2 |
| 4. layout.js decomposition | 2 | 6,7,8,9,11 | 5 |
| 5. Discourse API performance | 2 | 10 | 4 |
| 6. State extraction | 4 | 10 | 7,8,9 |
| 7. Event bus | 4 | 10 | 6,8,9 |
| 8. ManagedObserver | 4 | 10 | 6,7,9 |
| 9. CSS isolation | 4 | 10 | 6,7,8 |
| 10. Code quality & error handling | 2,3,4,5,6,7,8,9 | 11 | — |
| 11. README & docs | 1,4,10 | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. ES modules 迁移 + esbuild 构建系统
  What to do / Must NOT do: 将所有 `src/` 下 11 个 IIFE 文件改为 ES modules（import/export），废弃 `globalThis.LinuxDoToolkit` 命名空间。创建 `scripts/build.mjs` 用 esbuild 多入口 IIFE 打包（content 入口=src/content/index.js, popup 入口=src/popup/index.js, platform=browser, target=chrome110, format=iife, sourcemap=true）。esbuild 作为 devDependency。esbuild IIFE 不支持 code splitting，settings.js 被 content 和 popup 共享时会在各自 bundle 中各打包一份（与当前 build.js 拼接方式行为一致，不引入新问题）。更新 package.json scripts: build=`node scripts/build.mjs`。manifest.json content_scripts 仍指向根目录 content.js（esbuild 输出到根目录，保持现状不改 dist/ 流程）。Must NOT: 不在此步引入 TypeScript（保留 .js）；不改 manifest permissions；不改 popup.html UI。
  Parallelization: Wave 1 | Blocked by: — | Blocks: 2,3,4,5,11
  References (executor has NO interview context - be exhaustive): src/common/settings.js:1-73 (导出 DEFAULT_SETTINGS/getSettings/saveSettings/onSettingsChanged), src/content/index.js:1-93 (入口，init/refreshEnhancements/scheduleRefreshEnhancements/bindDynamicPageEvents), src/content/layout.js:1-827 (导出 layout={applyTopicSplitLayout,restoreTopicSplitLayout}), src/content/buttons.js:1-84 (导出 buttons={injectButtons,removeInjectedActions}), src/content/base64.js:1-111 (导出 base64={injectBase64Button}), src/content/discourse.js:1-123 (导出 discourse API 函数), src/content/markdown.js:1-202 (导出 markdown 函数), src/content/output.js:1-77 (导出 output 函数), src/content/post-export.js:1-77 (导出 postExport 函数), src/content/messages.js:1-84 (导出 messages.registerMessageHandlers), src/popup/index.js:1-64 (popup 入口), scripts/build.js:1-62 (当前拼接构建，contentFiles 顺序: settings→markdown→discourse→layout→output→post-export→buttons→base64→messages→index), manifest.json:25 `"js": ["content.js"]` (根目录非 dist/), package.json:1-17 (当前 scripts: build/check)
  Acceptance criteria (agent-executable): 
  1. `grep -r 'globalThis.LinuxDoToolkit' src/` 返回空
  2. `grep -r 'globalThis\.LinuxDoToolkit' dist/` 返回空（产物无残留）
  3. `npm run build` 成功且产出根目录 content.js + popup.js
  4. `node --check content.js && node --check popup.js` 通过
  5. `grep -c 'import ' src/content/index.js` ≥1（验证 ES module import 存在）
  QA scenarios (name the exact tool + invocation): 
  - happy: `npm run build && node --check content.js && node --check popup.js && grep -rc 'globalThis.LinuxDoToolkit' src/ | grep -v ':0$'` 返回空（无输出=成功）。Evidence <attemptDir>/task-1-refactor-toolkit.txt
  - failure: 手动在某个 src 文件保留 `globalThis.LinuxDoToolkit` 引用后 `npm run build`，验证 grep 检测到残留（回归保护）
  Commit: Y | refactor(build): migrate IIFE concatenation to esbuild ES module bundling

- [x] 2. TypeScript 迁移
  What to do / Must NOT do: 创建 tsconfig.json（strict: true, target: ES2022, module: ESNext, moduleResolution: bundler, types: ["chrome-types"], lib: ["ES2022","DOM","DOM.Iterable"]）。安装 devDeps: typescript, chrome-types。所有 src/ 下 .js→.ts（含类型注解+接口）。根目录 background.js 也迁移为 background.ts（仍占位，仅 TS 化），更新 manifest.json service_worker 指向（esbuild 输出 background.js 到根目录）。更新 scripts/build.mjs 支持 TS 转译（esbuild 内置，无需额外 loader）+ 新增 background 入口。更新 package.json scripts: check=`npm run build && tsc --noEmit && node --check content.js && node --check popup.js`。DOM 交互用类型守卫函数收窄。消息通信用判别联合类型。Must NOT: 不改运行时行为（纯类型添加）；不改 API 契约；不引 @types/chrome（用 chrome-types 官方包）；不改 background.ts 逻辑（仍仅 onInstalled 占位）。
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 4,5,6,7,8,9,10 | Can parallelize with: 3
  References (executor has NO interview context - be exhaustive): src/common/settings.js:1-73 (DEFAULT_SETTINGS 冻结对象需类型化), src/content/discourse.js:1-123 (getPostMeta 返回类型, fetchRawPost/fetchTopicJson/fetchPostsByIds 返回 Promise<Response>), src/content/layout.js:42-48 (pagerState 需 PagerState 接口), src/content/messages.js:20 (chrome.runtime.onMessage 需判别联合消息类型), src/content/output.js:1-77 (showToast DOM 类型), src/popup/index.js:1-64 (chrome.tabs.query 类型), background.js:1-6 (占位 service worker, 仅 chrome.runtime.onInstalled.addListener), manifest.json:8 (`"service_worker": "background.js"` 需指向 esbuild 产物), package.json:8 (当前 check 脚本需更新)
  Acceptance criteria (agent-executable):
  1. `tsc --noEmit` 通过（零类型错误）
  2. `find src/ -name '*.js' -not -name '*.d.ts' -not -name '*.config.js'` 返回空（所有源文件已 .ts 化，排除配置文件）
  3. `test ! -f background.js && test -f src/background.ts` 通过（根目录 background.js 已迁移）
  4. `npm run build` 成功且 `node --check content.js && node --check popup.js && node --check background.js` 通过
  5. `npm run check` 通过（含 tsc --noEmit）
  6. `grep 'chrome-types' package.json` 返回非空
  QA scenarios:
  - happy: `npm run check` 全绿。Evidence <attemptDir>/task-2-refactor-toolkit.txt
  - failure: 删除某个类型注解后 `tsc --noEmit` 报错（验证类型检查有效）
  Commit: Y | refactor(types): migrate all source files including background.js to TypeScript strict mode

- [x] 3. 测试基础设施
  What to do / Must NOT do: 安装 devDeps: vitest, @vitest/coverage-v8, jsdom。创建 vitest.config.ts（environment: jsdom, coverage: {provider: v8, include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts']}）。创建 test/mocks/chrome.ts 手写 mock（接口: storage.sync.get/set, storage.onChanged.addListener, runtime.onMessage.addListener, runtime.lastError, runtime.sendMessage, runtime.id）。创建 test/fixtures/ 目录含 5 个 HTML→Markdown 黄金用例（从 Discourse 实际 cooked HTML 采样：简单段落/表格/引用/代码块/图片+链接混合）。为 12 个纯函数写单测：decodeBase64Utf8, stripChineseText, formatPostMd, formatTopicMd, sanitizeFilename, normalizeDiscourseMd, replaceUploadUrls, escapeHtml, escapeAttr, assertExportResult, getExportToastPrefix, normalizeSettings。escapeHtml/escapeAttr 当前在 layout.js:556-568，此步先从 layout.js 导出（T4 拆分后归入 dom-queries.ts）。注意：T2 和 T3 并行执行时，T3 需要 escapeHtml/escapeAttr 被 export——若 T2 尚未完成 layout.js→layout.ts，则在 layout.js 中添加 export 关键字（JS 也支持 export）；若 T2 已完成则在 layout.ts 中添加。Must NOT: 不引 vitest-chrome-mv3 库（手写 mock 足够）；不测 DOM 操作密集型逻辑（留给后续）；覆盖率目标仅针对纯函数。
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 10 | Can parallelize with: 2
  References (executor has NO interview context - be exhaustive): src/content/base64.js:1-25 (decodeBase64Utf8: atob+TextDecoder fatal), src/content/base64.js:27-40 (stripChineseText: Unicode Han+全角标点正则), src/content/output.js:1-77 (formatPostMd/formatTopicMd/sanitizeFilename/showToast), src/content/markdown.js:188-202 (normalizeDiscourseMd: 去图片尺寸后缀 |WxH), src/content/discourse.js:88-123 (replaceUploadUrls: upload:// 协议替换), src/content/layout.js:556-568 (escapeHtml/escapeAttr — 需先添加 export), src/content/post-export.js:1-15 (assertExportResult/getExportToastPrefix), src/common/settings.js:1-30 (DEFAULT_SETTINGS/normalizeSettings), src/content/markdown.js:52-185 (htmlToMarkdown/htmlTableToMarkdown/isHtmlContent/ensureMarkdown — 需 jsdom 的核心转换逻辑), package.json (当前无 test 脚本)
  Acceptance criteria (agent-executable):
  1. `npm test` 运行成功（所有测试通过）
  2. `npm test -- --coverage` 纯函数覆盖率 >80%
  3. `ls test/fixtures/*.html | wc -l` ≥5（黄金用例数）
  4. `grep 'storage.sync' test/mocks/chrome.ts` 返回非空（chrome mock 覆盖 storage）
  5. `grep 'runtime.onMessage' test/mocks/chrome.ts` 返回非空（chrome mock 覆盖消息）
  QA scenarios:
  - happy: `npm test -- --coverage` 全绿且覆盖率报告显示纯函数 >80%。Evidence <attemptDir>/task-3-refactor-toolkit.txt
  - failure: 故意修改 sanitizeFilename 逻辑后 `npm test` 报错（验证测试有效捕获回归）
  Commit: Y | test(foundation): add Vitest + jsdom + chrome mock + pure function unit tests

- [x] 4. layout.js 拆分为 7 个内聚模块
  What to do / Must NOT do: 将 src/content/layout.ts（827行）拆分为 7 个 ≤250 LOC 模块：① src/content/layout/split-pane-layout.ts（集群 C+G+O: split-pane 容器/高度/文章面板克隆/顶层编排, 行53-82+371-464+767-817 ≈175行）② src/content/layout/comment-pager.ts（集群 J+M+H: 分页状态机+加载编排+comments-pane, PAGE_SIZE=20, postIds.slice(1), 行407-440+492-554+636-757）③ src/content/layout/header-title-cloner.ts（集群 D: header-title 克隆, 行84-104+262-286+351-369 ≈65行）④ src/content/layout/topic-meta-cloner.ts（集群 E: topic-meta 探测克隆, 行106-324 含中文 magic string 行126, ~220行）⑤ src/content/layout/footer-actions-cloner.ts（集群 F: footer-actions 迁移 DOM 物理移动+placeholder 还原, 行202-260 ≈60行）⑥ src/content/layout/dom-queries.ts（集群 A+K: 常量/选择器+escapeHtml/escapeAttr 工具函数, 行7-41+556-568）⑦ src/content/layout/resize-handler.ts（集群 P: resize 监听封装可 disconnect, 行819-821）。集群 I（拆除/恢复 行466-490）归入 split-pane-layout.ts（与布局编排强耦合）。集群 L（createPostFromJson 行570-605）归入 comment-pager.ts（分页渲染用）。集群 N（原生主帖探测 行759-765）归入 split-pane-layout.ts。集群 B（状态行42-51）的状态提取在 T6 中处理，此步保留原位但添加 export。集群 Q（导出 行823-826）替换为各模块的具名 export。ContentScriptManager 降级为条件项——仅当拆分后发现现有 index.ts 防抖刷新机制（discourse-navigate-completed + page:change + refreshEnhancements 防重入）导致状态残留 bug 才引入（引入时在 T4 内追加，验收标准追加 `grep 'ContentScriptManager' src/content/` 非空检查）。Must NOT: 不改运行时行为（纯结构重组）；不引状态管理库；不在此步提取状态到类型化容器（T6 负责）；不在此步实现事件总线（T7 负责）；不在此步封装 ManagedObserver（T8 负责）。
  Parallelization: Wave 3 | Blocked by: 2 | Blocks: 6,7,8,9,11 | Can parallelize with: 5
  References (executor has NO interview context - be exhaustive): src/content/layout.js:1-827 全文（17 集群: A 常量行7-41, B 状态行42-51, C split-pane 行53-82, D header-title 行84-104/262-286/351-369, E topic-meta 行106-324 含中文 magic string 行126 ['浏览量','赞','链接','用户'], F footer-actions 行202-260 DOM 物理移动+placeholder 还原, G article-pane 行371-464, H comments-pane 行407-440, I 拆除/恢复 行466-490 处理8类元素, J 分页状态机 行492-554 PAGE_SIZE=20, K escapeHtml/escapeAttr 行556-568, L createPostFromJson 行570-605, M 分页加载编排 行636-757, N 原生主帖探测 行759-765, O 顶层编排 行767-817, P resize 行819-821, Q 导出 行823-826）, src/content/index.js:80-81 (discourse-navigate-completed/page:change 事件 — 现有刷新机制), src/content/discourse.js:30-33 (getPostElements 过滤 .ldtk-topic-native-stream — 循环依赖的真正过滤点)
  Acceptance criteria (agent-executable):
  1. `find src/content/layout -name '*.ts' -exec wc -l {} +` 每文件 ≤250 行
  2. `ls src/content/layout/*.ts | wc -l` = 7（7 个模块）
  3. `test ! -f src/content/layout.ts` 通过（原文件已拆分）
  4. `npm run build && node --check content.js` 通过（拆分后构建正常）
  5. `npm test` 通过（escapeHtml/escapeAttr 测试仍通过，函数已归入 dom-queries.ts）
  QA scenarios:
  - happy: `npm run build && find src/content/layout -name '*.ts' -exec wc -l {} +` 全部 ≤250 + `npm test` 通过。Evidence <attemptDir>/task-4-refactor-toolkit.txt
  - failure: 故意将两个模块合并超 250 行，验证 `wc -l` 检测到（回归保护）
  Commit: Y | refactor(layout): decompose 827-line layout.js into 7 cohesive modules under 250 LOC each

- [ ] 5. Discourse API 性能优化
  What to do / Must NOT do: **前置探针（gate）**: 先执行 `curl -s 'https://linux.do/t/1.json' | head -c 200` 确认 linux.do 可访问，再 `curl -s 'https://linux.do/t/1/posts.json?post_ids[]=1&include_raw=true' | python3 -c "import sys,json; d=json.load(sys.stdin); print('raw' in d.get('post_stream',{}).get('posts',[{}])[0])"` 验证 include_raw=true 参数可用且响应含 raw 字段。若探针失败（参数不可用或无 raw 字段或网络不可达），降级方案：保留串行 /raw/ 但加并发限制（Promise pool 5 并发）+ 429 Retry-After 退避。若探针成功：改写 collectLoadedPosts（src/content/post-export.ts:39-65）从串行 for-await /raw/{id}/{num} 改为批量 posts.json?include_raw=true，每批 20 个 post_id，Promise.all 并发 + 429 Retry-After 指数退避（初始 1s，最多 3 次重试）。注意：layout 的 comment-pager 已用 fetchPostsByIds（discourse.ts:69-86）批量获取 cooked HTML（非 raw），此优化仅影响 collectLoadedPosts 导出路径（需要 raw Markdown）。新增 src/content/api-rate-limiter.ts 封装并发限制+退避逻辑。Must NOT: 不改 layout comment-pager 的 API 调用（它已用批量且不需要 raw）；不改 API 端点契约；不引 axios/fetch 库（用原生 fetch）。
  Parallelization: Wave 3 | Blocked by: 2 | Blocks: 10 | Can parallelize with: 4
  References (executor has NO interview context - be exhaustive): src/content/post-export.js:39-65 (collectLoadedPosts: 当前串行 for (const [i, postEl] of postEls.entries()) { await postExport.buildPostMarkdown(postEl) }, buildPostMarkdown 内部调 fetchRawPost), src/content/post-export.js:17-30 (buildPostMarkdown: fetchRawPost→normalize→replaceUploadUrls→ensureMarkdown→formatPostMd), src/content/discourse.js:52-57 (fetchRawPost: GET /raw/{topicId}/{postNumber} 返回 text/plain), src/content/discourse.js:69-86 (fetchPostsByIds: GET /t/{topicId}/posts.json?post_ids[]= 已存在但 layout 分页用 cooked 非 raw), src/content/discourse.js:59-67 (fetchTopicJson: GET /t/{topicId}.json 返回 post_stream.stream[] post id 数组), src/content/messages.js:20-50 (copyTopic/downloadTopic 调 collectLoadedPosts), src/content/layout.js:636-757 (comment-pager 分页加载编排 — 已用批量 API, 不改)
  Acceptance criteria (agent-executable):
  1. 前置探针结果记录在 Evidence 文件中（curl 输出含 raw 字段 或 降级方案文档说明失败原因）
  2. 若探针成功: `grep 'include_raw' src/content/post-export.ts` 返回非空; 若探针失败(降级): `grep 'Promise.all\|rate-limiter\|pool' src/content/post-export.ts src/content/api-rate-limiter.ts` 返回非空
  3. 若探针成功: vitest mock fetch 断言 50 楼导出的 fetch 调用次数 ≤3（1 次批量 + 最多 2 次 429 重试）; 若探针失败(降级): vitest mock fetch 断言 50 楼导出有并发限制（同时活跃 fetch ≤5）且 429 退避逻辑存在（用 vitest fake timers 断言等待 Retry-After 时间）
  4. `grep 'Retry-After\|backoff' src/content/api-rate-limiter.ts` 返回非空（退避逻辑存在）
  5. `npm run build && node --check content.js` 通过
  QA scenarios:
  - happy: vitest mock 测试 `npm test -- --grep 'collectLoadedPosts'` 通过。若探针成功: 断言 fetch 调用 ≤3 次; 若降级: 断言并发限制+退避。Evidence <attemptDir>/task-5-refactor-toolkit.txt
  - failure: mock fetch 返回 429 + Retry-After: 1，验证退避逻辑等待 1s 后重试（用 vitest fake timers 断言）
  Commit: Y | perf(api): batch collectLoadedPosts with include_raw=true and 429 backoff

- [ ] 6. 状态提取到类型化容器
  What to do / Must NOT do: 提取 8 个模块级可变状态到类型化容器：① index.ts 的 refreshTimer/base64Timer/refreshInFlight/refreshPending → src/content/refresh-state.ts（RefreshState 类，含 scheduleRefresh/scheduleBase64/tryAcquire/release 方法）；② layout/comment-pager.ts 的 pagerState → comment-pager.ts 内 PagerState 类（非模块级单例，由 applyTopicSplitLayout 实例化传入 comment-pager 函数，页面切换时旧实例调 destroy() 清理 observer/disconnect）；③ layout/topic-meta-cloner.ts 的 topicMetaObserver/topicMetaSyncTimer → 在 T8 ManagedObserver 中封装；④ output.ts 的 toast.hideTimer → ToastManager 类（封装 show/hide/hideTimer 生命周期）。Must NOT: 不引状态管理库（用轻量类）；不改 refresh 防抖/重入逻辑的行为（仅结构重组）；不在此步封装 observer（T8 负责）。
  Parallelization: Wave 4 | Blocked by: 4 | Blocks: 10 | Can parallelize with: 7,8,9
  References (executor has NO interview context - be exhaustive): src/content/index.js:7-10 (refreshTimer/base64Timer/refreshInFlight/refreshPending — 4 个 let 模块级变量), src/content/index.js:13-33 (refreshEnhancements 防重入逻辑: refreshInFlight 检查→串行 await→finally refreshPending 检查), src/content/layout.js:42-48 (pagerState: topicId/page/postIds[]/postsById(Map)/loading(bool) — const 对象字段被 mutate), src/content/output.js:55-77 (showToast: toast.hideTimer 挂在 DOM 元素上的动态属性, 行60/63/65), src/content/layout.js:50-51 (topicMetaObserver/topicMetaSyncTimer — T8 处理)
  Acceptance criteria (agent-executable):
  1. `grep -rn -E '^let |^var ' src/content/ src/content/layout/` 返回空（无模块级可变 let/var — 所有状态在类实例内）
  2. `grep 'class RefreshState' src/content/refresh-state.ts` 返回非空
  3. `grep 'class PagerState' src/content/layout/comment-pager.ts` 返回非空
  4. `grep 'class ToastManager' src/content/output.ts` 返回非空
  5. `grep 'destroy' src/content/layout/comment-pager.ts` 返回非空（PagerState 有 destroy 清理路径）
  6. `npm run build && node --check content.js && npm test` 通过
  QA scenarios:
  - happy: `grep -rn -E '^let |^var ' src/content/ src/content/layout/` 返回空 + `npm test` 通过。Evidence <attemptDir>/task-6-refactor-toolkit.txt
  - failure: 故意在某个模块保留模块级 `let` 状态，验证 grep 检测到（回归保护）
  Commit: Y | refactor(state): extract 8 module-level mutable states into typed containers

- [ ] 7. 事件总线解耦 layout→buttons 单向依赖
  What to do / Must NOT do: 实现事件总线 src/content/event-bus.ts（简单 pub/sub API: on(event, handler)/off(event, handler)/emit(event, data)）。layout comment-pager.ts loadPage 完成后 emit('posts:rendered', { posts }), buttons.ts 订阅 'posts:rendered' 触发 injectButtons。修正循环依赖描述：layout→buttons 是单向（layout.ts:664 调 namespace.buttons.injectButtons），buttons 对 layout 的依赖是间接的（通过 discourse.getPostElements 过滤 .ldtk-topic-native-stream，过滤逻辑在 discourse.ts:30-33 非 buttons.ts）。事件总线 off() 必须在 ManagedObserver pagehide 清理时一并调用（T8 负责 pagehide 注册，T7 提供 off API）。事件总线 emit 同步执行（与直接调用等效，不引入异步时序问题）。Must NOT: 不引第三方事件库（用原生实现）；不改为异步 emit（避免注入时序问题）；不在此步实现 pagehide 清理（T8 负责注册清理回调）。
  Parallelization: Wave 4 | Blocked by: 4 | Blocks: 10 | Can parallelize with: 6,8,9
  References (executor has NO interview context - be exhaustive): src/content/layout.js:664 (namespace.buttons?.injectButtons?.() — 循环依赖点, 改为 emit), src/content/buttons.js:1-84 (injectButtons — 改为订阅 'posts:rendered'), src/content/discourse.js:30-33 (getPostElements 过滤 .ldtk-topic-native-stream — 循环依赖的真正过滤点, 不改), src/content/index.js:13-33 (refreshEnhancements 串行调用 layout→buttons→base64 — buttons 注入仍由 refreshEnhancements 触发或由事件总线触发, 两者需协调避免重复注入)
  Acceptance criteria (agent-executable):
  1. `grep 'posts:rendered' src/content/event-bus.ts src/content/layout/comment-pager.ts src/content/buttons.ts` 返回非空（事件总线连接 layout→buttons）
  2. `grep -E 'on\(|off\(|emit\(' src/content/event-bus.ts` 返回非空（pub/sub API 存在）
  3. `grep 'namespace.buttons\|LinuxDoToolkit.buttons' src/content/layout/` 返回空（layout 不再直接调 buttons）
  4. `npm run build && node --check content.js` 通过
  QA scenarios:
  - happy: `grep 'posts:rendered' src/content/event-bus.ts src/content/layout/comment-pager.ts src/content/buttons.ts` 全部非空 + 构建通过。Evidence <attemptDir>/task-7-refactor-toolkit.txt
  - failure: 故意在 layout 中恢复 `namespace.buttons` 直接调用，验证 grep 检测到（回归保护）
  Commit: Y | refactor(events): decouple layout→buttons with event bus for posts:rendered

- [ ] 8. ManagedObserver 封装所有 observer + resize
  What to do / Must NOT do: 创建 src/content/managed-observer.ts（ManagedObserver 类: 构造接收 target/observerInit/callback, 含 start()/disconnect()/isConnected 属性; pagehide 事件监听自动 disconnect）。封装 3 个 MutationObserver + 1 个 resize listener: ① index.ts 的 MutationObserver（行57-74, 监听 #main-outlet 过滤 ldtk- 自身变更）② layout/topic-meta-cloner.ts 的 topicMetaObserver（行50, 监听 topic-meta 变化同步克隆）③ 若 index.ts 有第二个 MutationObserver（base64 selectionchange 相关）一并封装 ④ layout/resize-handler.ts 的 resize listener（行819-821）。所有 observer/listener 的 disconnect/removeEventListener 在 ManagedObserver.disconnect() 中统一处理。ContentScriptManager 降级为条件项——仅当 T8 封装后发现现有 index.ts 防抖刷新机制导致 observer 状态残留 bug 才引入。Must NOT: 不改 observer 的监听目标和回调逻辑（仅封装 disconnect 路径）；不引第三方库。
  Parallelization: Wave 4 | Blocked by: 4 | Blocks: 10 | Can parallelize with: 6,7,9
  References (executor has NO interview context - be exhaustive): src/content/index.js:57-74 (MutationObserver: 监听 #main-outlet childList, 过滤 ldtk- 前缀自身变更后触发 refreshEnhancements), src/content/layout.js:50 (topicMetaObserver: 第二个 MutationObserver 监听 topic-meta), src/content/layout.js:51 (topicMetaSyncTimer: 防抖 timer), src/content/layout.js:819-821 (resize listener: 模块加载即注册 window.resize, 无解绑路径 — 需封装), src/content/index.js:80-81 (discourse-navigate-completed/page:change 事件监听 — 非 observer, 不封装但需确认有 removeEventListener 路径)
  Acceptance criteria (agent-executable):
  1. `grep 'class ManagedObserver' src/content/managed-observer.ts` 返回非空
  2. `grep 'disconnect' src/content/managed-observer.ts` 返回非空（有 disconnect 路径）
  3. `grep 'pagehide' src/content/managed-observer.ts` 返回非空（pagehide 自动清理）
  4. `grep -r 'new MutationObserver' src/content/ src/content/layout/` 仅出现在 managed-observer.ts 内（所有 observer 通过 ManagedObserver 创建）
  5. `grep -r 'ManagedObserver' src/content/index.ts src/content/layout/topic-meta-cloner.ts src/content/layout/resize-handler.ts` 返回非空（3 处使用点已封装）
  6. `npm run build && node --check content.js` 通过
  QA scenarios:
  - happy: `grep -r 'new MutationObserver' src/content/ src/content/layout/` 仅在 managed-observer.ts 内 + 构建通过。Evidence <attemptDir>/task-8-refactor-toolkit.txt
  - failure: 故意在 index.ts 保留裸 `new MutationObserver`，验证 grep 检测到（回归保护）
  Commit: Y | refactor(observer): wrap all MutationObservers and resize listener in ManagedObserver with pagehide cleanup

- [ ] 9. CSS 隔离
  What to do / Must NOT do: **前置探针（gate）**: 创建 scripts/probe-discourse-css.mjs（headless 脚本，用 content script 注入或 Playwright headless 一次性运行，输出目标元素 computed style JSON）。探针检查 `.d-header .wrap`、`#main-outlet`、`.container.posts`、`.row` 等元素的 Computed Styles 是否含 !important。注意：Must NOT #8 禁止 e2e 测试，但前置探针是一次性 headless 脚本不属于 e2e 测试。若无法访问 linux.do（网络限制），降级为检查 styles.css 现有 !important 用途并保守设阈值。若 Discourse 用 !important：阈值设为 `grep -c '!important' styles.css` ≤30（保留冲突必要的 !important，每处附注释 `/* Discourse !important conflict */`）。若 Discourse 未用 !important：阈值设为 ≤5。分栏布局（body.ldtk-topic-split-active 选择器下）：用 scoped CSS 替代 !important——`all: revert` 重置继承属性 + `ldt-` 命名空间前缀提高特异性。注入 UI（复制/下载按钮 .ldcopy-btn + Toast #ldcopy-toast）：迁入 Shadow DOM（closed mode）。Shadow DOM 挂载策略: 在每个 post 的 `.post-controls` 容器内创建 `<div class="ldtk-shadow-host">` 作为 shadow host, attachShadow({mode:'closed'}) 后将 `.ldcopy-actions` wrapper 注入 shadow root; postEl 引用通过闭包传递给点击 handler（shadow boundary 不影响 JS 闭包）。Shadow DOM 内用 `<style>` 标签注入样式（不用 Constructable Stylesheets，chrome110 target 不保证支持）。`:host { all: initial; }` 重置。**base64 浮层不迁入 Shadow DOM**（base64 按钮必须寄生在 Discourse .quote-button 容器内，light DOM 与 shadow DOM 不能混用父子关系）。抽取 Discourse 选择器到 src/content/layout/dom-queries.ts 常量（TOPIC_META_SELECTORS 等）。Must NOT: 不承诺"消除全部 89 处 !important"（阈值由探针决定）；不改 base64 浮层为 Shadow DOM；不引 CSS-in-JS 库；不用 Constructable Stylesheets（用 `<style>` 标签）。
  Parallelization: Wave 4 | Blocked by: 4 | Blocks: 10 | Can parallelize with: 6,7,8
  References (executor has NO interview context - be exhaustive): styles.css:1-724 (89 处 !important 全部在 body.ldtk-topic-split-active 选择器下, 覆盖 Discourse .d-header .wrap max-width / #main-outlet 布局 / .container.posts / .row 等), src/content/layout.js:30-39 (TOPIC_META_SELECTORS 数组 8 个 .topic-map* 变体), src/content/layout.js:69-72 (getNativeStream 4 级回退选择器), src/content/buttons.js:1-84 (injectButtons 在 .post-controls 注入 .ldcopy-btn 按钮, CSS 在 styles.css .ldcopy-actions/.ldcopy-btn), src/content/output.js:55-77 (showToast 创建 #ldcopy-toast div), src/content/base64.js:47 (document.querySelector('.quote-button') — base64 按钮寄生点, 必须保留 light DOM), styles.css 中 .ldcopy-btn/.ldcopy-toast 样式（当前无 !important — 注入 UI 本身无 CSS 隔离问题）
  Acceptance criteria (agent-executable):
  1. 前置探针结果记录在 Evidence 文件中（scripts/probe-discourse-css.mjs 输出的 computed style JSON 或降级说明）
  2. `grep -c '!important' styles.css` 输出 ≤ 阈值（30 或 5，取决于探针结果）
  3. `grep 'all: revert\|all:revert' styles.css` 返回非空（scoped CSS 策略存在）
  4. `grep 'attachShadow' src/content/buttons.ts src/content/output.ts` 返回非空（按钮/Toast 迁入 Shadow DOM）
  5. `grep 'attachShadow' src/content/base64.ts` 返回空（base64 保留 light DOM）
  6. `grep 'ldtk-shadow-host' src/content/buttons.ts` 返回非空（Shadow DOM 挂载策略已实现）
  7. `grep '<style>' src/content/buttons.ts src/content/output.ts` 返回非空（用 <style> 标签而非 Constructable Stylesheets）
  8. `npm run build && node --check content.js` 通过
  QA scenarios:
  - happy: `grep -c '!important' styles.css` ≤ 阈值 + `npm run build` 成功。Evidence <attemptDir>/task-9-refactor-toolkit.txt
  - failure: 故意在 styles.css 添加 !important 超过阈值，验证 grep -c 检测到（回归保护）
  Commit: Y | refactor(css): replace !important with scoped CSS and Shadow DOM isolation

- [ ] 10. 代码质量与错误处理
  What to do / Must NOT do: 安装 devDeps: eslint, @typescript-eslint/parser, @typescript-eslint/eslint-plugin, prettier。创建 .eslintrc.cjs（parser: @typescript-eslint/parser, extends: @typescript-eslint/recommended, rules: no-unused-vars/error, no-explicit-any/warn）。创建 .prettierrc（singleQuote: true, semi: true, printWidth: 100）。实现统一错误处理 src/content/error-handler.ts：`handleError(err: unknown, context: string): void` 函数——记录错误 + 调 showToast 反馈。所有散落的 try/catch（buttons.ts, base64.ts, messages.ts, layout 模块）改为调 handleError。getSettings 调用优化：区分初始化期（injectButtons 顶层, messages copyTopic/downloadTopic 入口 — 可缓存到模块变量，onSettingsChanged 时刷新缓存）与交互期（按钮点击 handler 内 — 必须实时调 getSettings 读 chrome.storage.sync 最新值，支持用户在 popup 改设置后立即生效）。getSettings 调用点检查用 grep 数量断言（不试图判断函数作用域，grep 无法理解 AST）。Must NOT: 不无条件缓存 getSettings（交互期必须实时读，见 Must NOT #14）；不引 eslint-config-airbnb（过重）；不改 background.ts 逻辑。
  Parallelization: Wave 5 | Blocked by: 2,3,4,5,6,7,8,9 | Blocks: 11
  References (executor has NO interview context - be exhaustive): src/content/buttons.js:16,41,61 (getSettings 调用点 — 16 为 injectButtons 顶层初始化期可缓存, 41/61 为点击 handler 交互期必须实时读), src/content/messages.js:40,59 (getSettings 调用 — copyTopic/downloadTopic 入口初始化期可缓存), src/common/settings.js:58 (onSettingsChanged 监听 — 缓存刷新触发点), src/content/buttons.js:30-50 (try/catch 散落), src/content/base64.js:60-80 (try/catch 散落), src/content/messages.js:25-45 (try/catch 散落), src/content/layout.js 各模块 (try/catch 散落), src/content/output.js:55-77 (showToast — handleError 调用点), package.json (当前无 lint/format 脚本)
  Acceptance criteria (agent-executable):
  1. `npm run lint` 通过（零 error，warn 可接受）
  2. `npm run format -- --check` 通过（所有文件已格式化）
  3. `grep 'handleError' src/content/error-handler.ts src/content/buttons.ts src/content/base64.ts src/content/messages.ts` 返回非空（统一错误处理已接入）
  4. `grep -c 'getSettings' src/content/buttons.ts` ≥3（3 处调用点保留: 1 初始化期缓存 + 2 交互期实时读）
  5. `npm run build && node --check content.js && npm test` 全部通过
  QA scenarios:
  - happy: `npm run lint && npm run format -- --check && npm test` 全绿。Evidence <attemptDir>/task-10-refactor-toolkit.txt
  - failure: 故意引入 `any` 类型后 `npm run lint` 报 warn（验证 lint 有效）
  Commit: Y | chore(quality): add ESLint+Prettier, unified error handling, and getSettings call optimization

- [ ] 11. README 与文档更新
  What to do / Must NOT do: 更新 README.md：① "零依赖"品牌承诺改为"零运行时依赖（开发依赖: esbuild, typescript, vitest 等，不进发布包）"② 新增"开发"章节：`npm install` 安装 devDeps, `npm run build` 构建, `npm run check` 类型检查, `npm test` 测试, `npm run lint` 代码检查, `npm run format` 格式化 ③ 更新文件结构说明（src/ 下新增 layout/ 子目录含 7 模块, test/ 目录, 配置文件 tsconfig.json/vitest.config.ts/.eslintrc.cjs/.prettierrc）④ 保持 Markdown 输出格式说明不变。Must NOT: 不改用户可见的功能描述；不改安装步骤（仍为加载源码目录）；不改 icons 说明。
  Parallelization: Wave 6 | Blocked by: 1,4,10 | Blocks: —
  References (executor has NO interview context - be exhaustive): README.md:1-110 (当前内容: "零依赖构建"卖点行1-10, 文件结构说明, Markdown 输出格式说明), package.json:1-17 (scripts: build/check/test/lint/format), src/ 目录结构 (T4 拆分后新增 layout/ 子目录含 7 个 .ts 模块)
  Acceptance criteria (agent-executable):
  1. `grep '零运行时依赖' README.md` 返回非空（品牌承诺已更新）
  2. `grep 'npm run build\|npm test\|npm run lint' README.md` 返回非空（开发说明已添加）
  3. `grep 'layout/' README.md` 返回非空（文件结构已更新）
  4. `grep '零依赖构建' README.md` 返回空或已更新（旧表述移除）
  QA scenarios:
  - happy: `grep '零运行时依赖' README.md && grep 'npm test' README.md` 返回非空。Evidence <attemptDir>/task-11-refactor-toolkit.txt
  - failure: 保留旧"零依赖构建"表述后 grep 检测到（回归保护）
  Commit: Y | docs(readme): update for zero-runtime-deps clarification and dev workflow

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  验证所有 11 个 todo 的 acceptance criteria 均已通过，Evidence 文件存在且非空。命令: 逐个检查 `grep -r 'globalThis.LinuxDoToolkit' src/ dist/` 返回空 + `tsc --noEmit` 通过 + `npm test` 通过 + `npm run lint` 通过 + `grep -c '!important' styles.css` ≤阈值 + `find src/content/layout -name '*.ts' -exec wc -l {} +` 全部 ≤250 + `ls src/content/layout/*.ts | wc -l` = 7。Evidence <attemptDir>/F1-refactor-toolkit.txt
- [ ] F2. Code quality review
  验证 TypeScript strict 无 any 泛滥（`grep -rn ': any' src/ | wc -l` ≤5），ESLint 无 error，所有 try/catch 调用 handleError，无模块级可变 let/var（`grep -rn -E '^let |^var ' src/content/ src/content/layout/` 返回空），所有 MutationObserver 通过 ManagedObserver 创建（`grep -r 'new MutationObserver' src/content/ src/content/layout/` 仅在 managed-observer.ts 内）。Evidence <attemptDir>/F2-refactor-toolkit.txt
- [ ] F3. Real manual QA
  在真实 Chrome 浏览器加载 dist/ 或源码目录，打开 linux.do 任意主题页，验证：① 分栏布局正常显示 ② 复制/下载按钮正常工作 ③ base64 解码按钮正常 ④ 整帖导出（50+楼）不触发 429 且导出内容正确 ⑤ popup 开关功能正常 ⑥ Toast 提示正常。因 Scope OUT #8 禁 e2e，此项为人工加载验证（agent 生成验证清单，用户执行确认）。Evidence <attemptDir>/F3-refactor-toolkit.txt
- [ ] F4. Scope fidelity
  验证未引入新功能（对比 manifest.json permissions 未变 + 无新 API 端点 + 无新 UI 组件 + 无新 runtime 依赖: `grep 'dependencies' package.json` 返回空或仅 devDependencies）。验证 Markdown 输出格式未变（对比测试 fixture 输出与重构前一致）。验证 popup.html UI 设计未变（`git diff popup.html` 仅内部脚本引用变化）。Evidence <attemptDir>/F4-refactor-toolkit.txt

## Commit strategy
- 每个 todo 完成后独立 commit（见各 todo Commit 行）
- Commit 类型: refactor/test/chore/docs/perf
- 最终合并为一个 PR 或直接 push 到主分支（由用户决定）

## Success criteria
1. `npm run check` 通过（build + tsc --noEmit + node --check）
2. `npm test` 通过，纯函数覆盖率 >80%
3. `npm run lint` 通过（零 error）
4. `grep -r 'globalThis.LinuxDoToolkit' src/ dist/` 返回空
5. `find src/content/layout -name '*.ts' -exec wc -l {} +` 每文件 ≤250 行
6. `ls src/content/layout/*.ts | wc -l` = 7（7 个拆分模块）
7. `grep -c '!important' styles.css` ≤ 阈值（30 或 5，取决于前置探针）
8. layout→buttons 依赖通过事件总线解耦（grep 'posts:rendered' 非空, grep 'namespace.buttons' in layout/ 返回空）
9. collectLoadedPosts 50 楼导出优化（探针成功: fetch ≤3 次; 降级: 并发限制+退避）
10. 所有 MutationObserver 通过 ManagedObserver 封装（grep 'new MutationObserver' 仅在 managed-observer.ts）
11. 无模块级可变 let/var（`grep -rn -E '^let |^var ' src/content/ src/content/layout/` 返回空）
12. 真实 Chrome 加载扩展，所有现有功能正常（F3 验证清单通过）
13. 未引入新功能/新权限/新运行时依赖（F4 验证通过）
