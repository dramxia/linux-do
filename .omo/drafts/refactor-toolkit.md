---
slug: refactor-toolkit
status: review-complete
intent: unclear
review_required: true
plan_path: .omo/plans/refactor-toolkit.md
plan_sha256: 57d157c31bdc85633da40cc717624178fdd08c50c4bda22796cc344a2f573aca
review_round_id: review-round-2
pending-action: none (plan delivered, awaiting user to start-work)
review:
  momus:
    status: approved
    workspace_root: /Users/misemo/project/my/plugin/linux-do-toolkit
    runtime_home: null
    target: .omo/plans/refactor-toolkit.md
    round_id: review-round-2
    plan_sha256: 57d157c31bdc85633da40cc717624178fdd08c50c4bda22796cc344a2f573aca
    launch_id: launch-2
    session: ses_076e2e5bfffekmW2A09CFRTu93
    result: APPROVE (8/8 dimensions passed, all round-1 fixes confirmed)
  independent:
    status: approved
    workspace_root: /Users/misemo/project/my/plugin/linux-do-toolkit
    runtime_home: null
    target: .omo/plans/refactor-toolkit.md
    round_id: review-round-2
    plan_sha256: 57d157c31bdc85633da40cc717624178fdd08c50c4bda22796cc344a2f573aca
    launch_id: launch-2
    session: ses_076e20e36ffespGnEmh04PLUZN
    result: APPROVE (9/9 dimensions passed, all round-1 fixes confirmed, 4 non-blocking observations)
approach: |
  六组件拓扑重构（C1→C6，拓扑锁）。C1 建立基础（TS+esbuild+ES modules），C2-C6 依赖 C1。
  C2 拆分 layout.js 827 行巨型文件并提取状态。C3 CSS 隔离（Shadow DOM + scoped CSS）。
  C4 Discourse API 性能优化（批量并发 + 429 退避）。C5 测试基础（Vitest + 纯函数单测）。
  C6 代码质量与错误处理（ESLint+Prettier+统一 error boundary）。所有可逆内部决策采用
  最佳实践默认值，零 owner-decision。批准后运行 Metis → 写计划 → 自动双重高准确度评审。
---

# Draft: refactor-toolkit

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

| id  | outcome (one line)                                                                                                                   | status   | evidence path                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------- |
| C1  | TS + esbuild + ES modules 替换 IIFE+global namespace；`npm run build` 产出 dist/ IIFE，`tsc --noEmit` 通过                            | active   | package.json:5-6, scripts/build.js, manifest.json:8-12 |
| C2  | layout.js 827 行拆为多个 <250 LOC 内聚模块；提取 7 个模块级可变状态到类型化容器；处理 layout↔buttons 循环依赖；封装 ManagedObserver | active   | src/content/layout.js:1-827, src/content/index.js:1-93 |
| C3  | 注入 UI 迁入 Shadow DOM（closed）；分栏布局用 scoped CSS 替代 89 处 !important；抽取 Discourse 选择器到常量模块                       | active   | styles.css:1-724, src/content/layout.js:30-39 |
| C4  | collectLoadedPosts 串行 /raw/ → 批量 posts.json?include_raw=true；并发限制 + 429 Retry-After 退避                                     | active   | src/content/post-export.js:1-77, src/content/discourse.js:52-86 |
| C5  | Vitest + jsdom/happy-dom + 手写 chrome mock；12 个纯函数单测 + HTML→Markdown 转换器测试；纯函数覆盖率 >80%                           | active   | package.json (无 test/devDeps), src/content/markdown.js:52-185 |
| C6  | ESLint + Prettier + tsconfig strict；统一错误处理（集中 error boundary + toast）；消除重复 getSettings                                | active   | 全局（散落的 try/catch + showToast）   |

## Open assumptions (announced defaults)
<!-- Intent is UNCLEAR: research resolves ambiguity, defaults are adopted (not asked), and each is surfaced in the plan's human TL;DR for veto. -->
<!-- assumption | adopted default | rationale | reversible? -->

| assumption                          | adopted default                                                            | rationale                                                                 | reversible? |
| ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| 语言选择                             | TypeScript（strict mode）                                                  | 行业最佳实践；可逆（可编译回 JS）；用户说"重构整个项目"无约束                  | 是          |
| 构建工具                             | esbuild 作为 devDependency                                                | 社区共识首选（最快、单二进制、内置 TS 转译）；shipped 扩展仍零运行时依赖       | 是          |
| "零依赖"品牌承诺                    | 保留，更新 README 澄清为"零运行时依赖"                                    | esbuild 是 dev-only，不进发布包；MV3 强制 shipped 无 node_modules             | 是          |
| 测试框架                             | Vitest + jsdom/happy-dom                                                   | 原生 ESM、更快、配置少；手写 chrome mock 足够本项目                          | 是          |
| CSS 隔离策略                        | 注入 UI 用 Shadow DOM（closed）；分栏布局用 scoped CSS                    | Shadow DOM 完全隔离；分栏需修改 Discourse 元素不适合 Shadow DOM              | 是          |
| Discourse API 契约                  | 端点不变（/raw/, /t/{id}.json, /t/{id}/posts.json）                       | 均为官方或源码稳定多年的端点；重构不改外部契约                               | 是          |
| 串行→并行 fetch 优化                | 改用 posts.json?include_raw=true 批量获取，并发限制 + 429 退避             | 当前 50 楼逐楼串行慢且易触发 429（max_user_api_reqs_per_minute=20）          | 是          |
| 功能集                              | 保持现有功能集不变，不加新功能                                            | TOPOLOGY LOCK：用户要求重构不是加功能；reducing/phasing 不是 reframe         | 是          |
| Chrome 目标版本                     | chrome110（esbuild target）                                                | MV3 要求 Chrome 88+，chrome110 覆盖现代用户                                  | 是          |
| 循环依赖处理                        | 事件总线（pub/sub）解耦 layout↔buttons                                    | layout.loadPage 需触发 buttons.injectButtons；buttons 需读 layout 创建的 DOM | 是          |
| chrome 类型包                       | chrome-types（官方自动生成）而非 @types/chrome                            | 官方包更准确，Chromium 源码自动生成                                          | 是          |

## Findings (cited - path:lines)

### 项目结构
- 零依赖 Chrome MV3 扩展 "Linux.do 工具箱" v1.1.0（manifest.json:1-30）
- 构建：scripts/build.js:1-62 把 src/ 下 IIFE 文件按固定顺序拼接成根目录 content.js/popup.js 并复制到 dist/
- 无测试、无 lint、无 TS（package.json:1-17 无 devDependencies）
- background.js 仅占位（6 行，仅 onInstalled addListener）

### 模块耦合面（explore 报告）
- 11 个文件通过 `globalThis.LinuxDoToolkit` 命名空间共享，build.js 文件顺序保证"定义先于消费"
- **layout↔buttons 运行时循环依赖**：layout.js:664 在 loadPage 内调 `namespace.buttons?.injectButtons?.()`；buttons.js:23 调 `discourse.getPostElements()` 过滤 `.ldtk-topic-native-stream`（layout 创建的元素）。当前靠 namespace 延迟解构 + 单文件拼接规避

### layout.js 827 行 17 个责任集群（explore 报告）
- A 常量与选择器（行7-41）、B 可变状态（42-51）、C split-pane 容器与高度（53-82）、D header 标题克隆（84-104,262-286,351-369）、E topic-meta 源探测与克隆（106-324，含中文 magic string `['浏览量','赞','链接','用户']` 在 layout.js:126）、F footer-actions 迁移（202-260）、G article-pane 正文克隆（371-464）、H comments-pane 与 stream（407-440）、I 布局拆除/恢复（466-490，8 类元素）、J 评论分页状态机（492-554，PAGE_SIZE=20）、K HTML 转义工具（556-568）、L 从 JSON 构建 post DOM（570-605，直接注入 cooked HTML）、M 分页加载编排（636-757，async）、N 原生主帖探测（759-765）、O 顶层布局编排（767-817）、P resize 事件绑定（819-821，模块加载即注册无解绑）、Q namespace 导出（823-826）

### 模块级可变状态清单（7 个，explore 报告）
- `refreshTimer`(index.js:7)、`base64Timer`(index.js:8)、`refreshInFlight`(index.js:9)、`refreshPending`(index.js:10) — refresh 防抖/重入控制
- `pagerState`(layout.js:42-48) — 分页状态机核心，跨 5 函数共享，无 LRU/上限，有 TOCTOU 并发窗口
- `topicMetaObserver`(layout.js:50)、`topicMetaSyncTimer`(layout.js:51) — 第二个 MutationObserver + 防抖 timer
- `toast.hideTimer`(output.js:60,63,65) — 挂在 DOM 上的动态属性

### Discourse API 面（explore 报告 + librarian 报告）
- `fetchRawPost` → `GET /raw/{topicId}/{postNumber}` (discourse.js:52-57)，text/plain 原始 Markdown，非官方文档但源码稳定
- `fetchTopicJson` → `GET /t/{topicId}.json` (discourse.js:59-67)，官方 API
- `fetchPostsByIds` → `GET /t/{topicId}/posts.json?post_ids[]=...` (discourse.js:69-86)，官方 API
- **速率限制**：登录用户 max_user_api_reqs_per_minute=20，50 楼逐楼并发极易触发 429
- **批量优化**：改用 `/t/{id}/posts.json?post_ids[]=&include_raw=true`，每批 20-300，处理 429 Retry-After 指数退避

### CSS/DOM 选择器脆弱点（explore 报告）
- styles.css 共 **89 处 !important**
- layout.js:30-39 TOPIC_META_SELECTORS 数组（8 个 .topic-map* 变体）
- layout.js:69-72 getNativeStream 4 级回退
- layout.js:126 中文 magic string `['浏览量','赞','链接','用户']`（仅适用中文界面 Discourse）
- Discourse 自定义事件 discourse-navigate-completed/page:change (index.js:80-81) 非标准

### 初始化序列（explore 报告）
- content.js 加载 → 10 模块 IIFE 顺序执行 → index.js:92 init() → 注册 namespace.app → registerMessageHandlers → refreshEnhancements（串行 layout→buttons→base64）→ bindDynamicPageEvents（8 类监听器）→ onSettingsChanged
- refreshEnhancements：refreshInFlight 防重入 → 串行 await layout→buttons→base64 → finally 检查 refreshPending。顺序约束：分栏隐藏原生 post stream，必须先布局隔离再注入按钮

### 可测试纯函数（explore 报告，约 12 个）
- decodeBase64Utf8、stripChineseText、formatPostMd、formatTopicMd、sanitizeFilename、normalizeDiscourseMd、replaceUploadUrls、escapeHtml、escapeAttr、assertExportResult、getExportToastPrefix、normalizeSettings
- 需 jsdom 的：isHtmlContent、htmlToMarkdown、htmlTableToMarkdown、ensureMarkdown（markdown.js:52-185 是最值得测的核心逻辑）

### Chrome MV3 ES Module 支持（Context7 + librarian 报告）
- Service worker 支持 `"type":"module"`；content scripts 不支持静态 import/export
- esbuild IIFE 打包是 content script 标准方案（多个生产级扩展佐证）
- chrome-types（官方）优于 @types/chrome（社区）
- esbuild 不做类型检查，需单独 `tsc --noEmit`

### CSS 隔离最佳实践（librarian 报告）
- Shadow DOM（closed）用于注入 UI：完全隔离，`:host { all: initial; }`，Constructable Stylesheets
- 分栏布局不适合 Shadow DOM（需修改 Discourse 自身元素），用 scoped CSS（`all: revert` + 命名空间前缀）
- 方案对比：Shadow DOM ⭐⭐⭐⭐⭐ > all:initial+scope ⭐⭐⭐ > 命名空间前缀 ⭐⭐ > !important 全局覆盖 ⭐

### 架构模式建议（librarian 报告）
- ManagedObserver 封装：每个 MutationObserver 必须有 disconnect 路径 + pagehide 自动清理
- ContentScriptManager 模式：处理 Discourse SPA 导航——cleanupFns 数组，URL 变化时 cleanup()+init() 重建
- 内存泄漏检查清单：每 addEventListener 有 removeEventListener、每 Observer 有 disconnect、无界 Map 用 WeakMap

## Decisions (with rationale)

1. **TypeScript 采用**（strict mode）：可逆（可编译回 JS），行业最佳实践。用户说"重构整个项目"无约束。用 chrome-types 官方类型包。
2. **esbuild 作为 devDependency**：社区共识首选。README "零依赖"品牌承诺保留，更新为"零运行时依赖"澄清 esbuild 是 dev-only。
3. **layout.js 拆为 6 个内聚模块**：split-pane-layout、comment-pager（状态机）、topic-meta-cloner、footer-action-migrator、dom-queries、resize-handler。每文件 <250 LOC。依据 explore 报告 17 集群聚类。
4. **事件总线解耦 layout↔buttons 循环依赖**：layout.loadPage 完成后发 'posts:rendered' 事件，buttons 订阅触发 injectButtons。避免直接 namespace 调用。
5. **ManagedObserver 封装**：2 个 MutationObserver + resize listener 封装为可 disconnect 的类。解决 layout.js:819 模块加载即注册无解绑问题。
6. **ContentScriptManager 模式**：处理 Discourse SPA 导航——cleanupFns 数组记录清理函数，URL 变化时 cleanup()+init() 重建。
7. **Shadow DOM（closed）用于注入 UI**：复制/下载按钮、Toast、base64 浮层迁入 Shadow DOM。`:host { all: initial; }` 重置。
8. **scoped CSS 替代 !important**：分栏布局用 `all: revert` + `ldt-` 命名空间前缀。目标消除全部 89 处 !important。
9. **批量 API + 并发限制**：collectLoadedPosts 改用 posts.json?include_raw=true 批量获取，每批 20，Promise.all + 429 Retry-After 指数退避。
10. **Vitest + 手写 chrome mock**：原生 ESM、更快。手写 mock 足够（只用 storage.sync + runtime）。
11. **保持现有功能集**：TOPOLOGY LOCK。Scope OUT 新功能。
12. **chrome110 target**：MV3 要求 Chrome 88+，chrome110 覆盖现代用户。

## Scope IN

1. 所有 `src/` 下 .js 文件迁移为 .ts + ES module（import/export）
2. 新增 tsconfig.json（strict, ESNext, chrome-types）
3. 新增 scripts/build.mjs（esbuild 多入口 IIFE 打包），替换 scripts/build.js
4. 更新 package.json（devDeps: esbuild, typescript, chrome-types, vitest, jsdom, eslint, prettier；scripts: build, check, test, lint, format）
5. 拆分 src/content/layout.js 为 6+ 内聚模块（每文件 <250 LOC）
6. 提取 7 个模块级可变状态到类型化状态容器
7. 封装 ManagedObserver 类（disconnect 路径 + pagehide 自动清理）
8. 实现 ContentScriptManager（SPA 导航 cleanup/init 生命周期）
9. 注入 UI（按钮/Toast/base64 浮层）迁入 Shadow DOM（closed）
10. styles.css 重构：scoped CSS 替代 89 处 !important
11. 抽取 Discourse 选择器到常量模块（dom-queries.ts）
12. collectLoadedPosts 改为批量 posts.json?include_raw=true + 并发限制 + 429 退避
13. 新增 Vitest 配置 + 手写 chrome mock + 12 个纯函数单测 + HTML→Markdown 转换器测试
14. 新增 ESLint + Prettier 配置
15. 统一错误处理（集中 error boundary + toast）
16. 废弃 globalThis.LinuxDoToolkit 命名空间
17. 更新 README.md 澄清"零运行时依赖" + 新增开发说明（构建/测试/lint）
18. 更新 manifest.json（如需调整 content_scripts 指向 dist/ 产物）
19. 事件总线实现（解耦 layout↔buttons）
20. 消除重复 getSettings 调用（缓存或依赖注入）

## Scope OUT (Must NOT have)

1. 不加新功能（新按钮、新 API、新 UI 组件）
2. 不改 Discourse API 端点契约（/raw/, /t/{id}.json, /t/{id}/posts.json 保持不变）
3. 不改 manifest.json permissions（activeTab, clipboardWrite, storage 不变）
4. 不引入运行时依赖（shipped dist/ 仍无 node_modules，仅 devDeps）
5. 不改 popup.html 的用户可见 UI 设计（仅内部代码 TS 化）
6. 不改现有 Markdown 输出格式（单楼/整帖格式不变）
7. 不引入 CI/CD 配置（用户未要求）
8. 不引入 Playwright/e2e 测试（用户未要求，仅单测）
9. 不改 background.js 为有逻辑的 service worker（仍占位，仅 TS 化）
10. 不引入状态管理库（Redux/Zustand 等，用轻量类型化容器）
11. 不引入 CSS-in-JS 库（用 scoped CSS + Shadow DOM）
12. 不改 icons/ 资源文件

## Open questions

无。所有分叉均为可逆内部或最佳实践默认值，UNCLEAR 路径不审问用户。所有默认值在计划 TL;DR 中供用户否决。

## Approval gate
status: awaiting-approval
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

研究已完成，拓扑已锁定（6 组件 C1-C6），所有默认假设已记录。等待用户明确批准后：
1. 运行 scaffold 脚本（不带 --draft-only）创建 .omo/plans/refactor-toolkit.md
2. 派发 Metis 间隙分析
3. 折叠 Metis 结论后 APPEND todo 批次到计划
4. 填充 TL;DR
5. 自动运行双重高准确度评审（momus + 独立 Oracle）
6. 修复至全部 APPROVE 后呈现最终 brief
