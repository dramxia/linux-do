# Linux.do 工具箱

Chrome 浏览器插件，用于一键复制或下载 linux.do 帖子内容为 Markdown 文件。

## 功能

- **页面内按钮**：每个楼层旁边自动出现「复制」和「下载」按钮
  - 复制：将当前楼层转为 Markdown，复制到剪贴板
  - 下载：将当前楼层保存为 .md 文件
- **工具栏弹窗**：点击浏览器工具栏图标
  - 复制整个主题：所有楼层合并为一个 Markdown
  - 下载整个主题：保存为 .md 文件

## 安装方法

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `linux-do-toolkit` 文件夹
5. 完成！

## 文件结构

```
linux-do-toolkit/
├── manifest.json      # 插件配置
├── content.js         # 核心逻辑（注入页面）
├── popup.html         # 工具栏弹窗界面
├── popup.js           # 弹窗逻辑
├── styles.css         # 注入按钮样式
├── background.js      # Service Worker（保留）
└── icons/
    ├── icon.svg       # 源图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Markdown 输出格式

单个楼层：
```markdown
# 帖子标题

> 作者: xxx | 时间: 2024-01-01 | #1
> 来源: https://linux.do/t/xxx/1

正文内容...
```

整个主题：
```markdown
# 帖子标题

> 来源: https://linux.do/t/xxx
> 楼层数: 42

---

## #1 — 作者名 (时间)

正文内容...

---

## #2 — 作者名 (时间)

正文内容...
```
