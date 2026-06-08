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
- **功能开关**：支持在 popup 中启用 / 关闭常用能力
  - 显示楼层复制 / 下载按钮
  - 启用 Base64 解码
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
npm run build
npm run check
```

当前项目采用零依赖构建：

- 源码位于 `src/`
- `scripts/build.js` 会生成根目录 `content.js` / `popup.js`
- 同时复制完整扩展到 `dist/`

## 文件结构

```text
linux-do-toolkit/
├── src/
│   ├── common/
│   │   └── settings.js          # 设置读写
│   ├── content/
│   │   ├── index.js             # Content Script 入口
│   │   ├── buttons.js           # 楼层按钮注入
│   │   ├── base64.js            # Base64 选择工具
│   │   ├── discourse.js         # Discourse 页面适配
│   │   ├── markdown.js          # HTML/Markdown 转换
│   │   ├── messages.js          # popup 消息通信
│   │   ├── output.js            # 复制、下载、Toast
│   │   └── post-export.js       # 楼层导出流程
│   └── popup/
│       └── index.js             # popup 入口
├── scripts/
│   └── build.js                 # 零依赖构建脚本
├── dist/                        # 构建输出
├── manifest.json                # 插件配置
├── background.js                # MV3 Service Worker，当前仅保留生命周期入口
├── content.js                   # 构建产物
├── popup.html                   # 工具栏弹窗界面
├── popup.js                     # 构建产物
├── styles.css                   # 注入按钮样式
└── icons/
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
