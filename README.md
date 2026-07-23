# Linux.do 工具箱

Chrome 浏览器插件，用于一键复制或下载 linux.do 帖子内容为 Markdown 文件，并提供 Base64 解码等阅读辅助能力。

## 功能

- **页面内按钮**：每个楼层旁边自动出现「复制」和「下载」按钮
  - 复制：将当前楼层转为 Markdown，复制到剪贴板
  - 下载：将当前楼层保存为 `.md` 文件
- **工具栏弹窗**：点击浏览器工具栏图标
  - 复制当前已加载楼层：按页面 DOM 中已加载楼层范围，调用 Discourse `/raw/...` 接口获取内容并合并为 Markdown
  - 下载当前已加载楼层：保存为 `.md` 文件；若部分楼层获取失败，会提示成功 / 失败数量
- **Base64 解码**：选中文本后，在 Discourse 选择浮层中注入 `base64` 按钮
- **正文 / 评论分栏**：帖子页自动将 1 楼正文固定在左侧，评论区显示在右侧，窄屏自动恢复单列
- **功能开关**：支持在 popup 中启用 / 关闭常用能力
  - 显示楼层复制 / 下载按钮
  - 启用 Base64 解码
  - 帖子页正文 / 评论分栏
  - 导出时保留来源元信息
  - 替换 `upload://` 图片链接

## 安装方法

### 直接加载源码目录

1. 执行构建：

   ```bash
   npm run build
   ```

2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 右上角打开「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择当前 `linux-do-toolkit` 文件夹
6. 完成！

### 加载发布目录

也可以执行构建后选择 `dist/` 目录加载：

```bash
npm run build
```

## 开发

```bash
npm install          # 安装开发依赖
npm run build        # 构建扩展（esbuild 打包到根目录 + dist/）
npm run check        # 构建 + 类型检查 + 语法验证
npm test             # 运行测试（Vitest + jsdom）
npm run test:watch   # 测试 watch 模式
npm run lint         # ESLint 代码检查
npm run format       # Prettier 格式化
npm run format:check # 检查格式化
```

当前项目采用**零运行时依赖**（开发依赖：esbuild、typescript、vitest 等，不进发布包）：

- 源码位于 `src/`（TypeScript + ES modules）
- `scripts/build.mjs` 使用 esbuild 打包，生成根目录 `content.js` / `popup.js` / `background.js`
- 同时复制完整扩展到 `dist/`
- shipped 扩展本身仍为零运行时依赖

## 文件结构

```text
linux-do-toolkit/
├── src/
│   ├── common/
│   │   └── settings.ts          # 功能开关设置
│   ├── content/
│   │   ├── layout/               # 分栏布局模块（T4 拆分）
│   │   │   ├── dom-queries.ts
│   │   │   ├── resize-handler.ts
│   │   │   ├── footer-actions-cloner.ts
│   │   │   ├── header-title-cloner.ts
│   │   │   ├── topic-meta-cloner.ts
│   │   │   ├── comment-pager.ts
│   │   │   ├── post-renderer.ts
│   │   │   └── split-pane-layout.ts
│   │   ├── index.ts              # 入口
│   │   ├── buttons.ts            # 复制/下载按钮（Shadow DOM）
│   │   ├── base64.ts             # Base64 解码
│   │   ├── discourse.ts          # Discourse API 适配
│   │   ├── markdown.ts           # HTML→Markdown 转换
│   │   ├── output.ts             # 输出/Toast（Shadow DOM）
│   │   ├── post-export.ts        # 帖子导出
│   │   ├── messages.ts           # 消息处理
│   │   ├── event-bus.ts          # 事件总线
│   │   ├── managed-observer.ts   # Observer 封装
│   │   ├── refresh-state.ts      # 刷新状态管理
│   │   ├── error-handler.ts      # 统一错误处理
│   │   └── api-rate-limiter.ts   # API 速率限制
│   ├── popup/
│   │   └── index.ts
│   └── background.ts
├── test/                         # 测试目录
│   ├── mocks/
│   │   └── chrome.ts
│   ├── fixtures/
│   │   └── *.html
│   └── *.test.ts
├── scripts/
│   ├── build.mjs                 # esbuild 构建脚本
│   └── probe-discourse-css.mjs   # CSS 探针
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── manifest.json
├── styles.css
├── popup.html
└── package.json
```

## Markdown 输出格式

单个楼层默认输出：

```markdown
<!-- 来源: https://linux.do/t/xxx/1#post-1 | 作者: xxx | 2024-01-01 -->

正文内容...
```

当前已加载楼层默认输出：

```markdown
<!-- 来源: https://linux.do/t/xxx -->

<!-- #1 作者名 | https://linux.do/t/xxx#post-1 -->

正文内容...
```

> 注意：整帖导出基于页面当前 DOM 中已加载楼层决定范围，并逐楼调用 `/raw/{topicId}/{postNumber}` 获取内容；不会主动拉取服务器上的全部回复。若部分楼层获取失败，插件会提示已成功与失败数量。
