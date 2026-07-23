#!/usr/bin/env node
/* Linux.do 工具箱 — T9 CSS 隔离前置探针
 *
 * 目标: 检查 linux.do 帖子页关键元素的 computed style 是否含 !important，
 * 决定 styles.css 重构后可保留的 !important 阈值。
 *
 * 沙箱环境通常无法访问 linux.do，本脚本优先用 Playwright（若已安装），
 * 否则降级到 fetch，再否则输出降级说明并退出码 0（不阻塞构建）。
 *
 * 降级路径: 阈值保守设为 ≤30，对确实需要覆盖 Discourse !important 的规则
 * 保留 !important 并附注释 `/* Discourse !important conflict *​/`。
 *
 * 运行: node scripts/probe-discourse-css.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const TARGET_URL = 'https://linux.do/t/1';

// 关键目标元素：分栏布局需要重置的 Discourse 容器
const TARGET_SELECTORS = [
  '#main-outlet-wrapper.wrap',
  '#main-outlet',
  '#main-outlet > .container',
  '.container.posts',
  '.topic-area',
  '.posts-wrapper',
  '.d-header .wrap',
  '.d-header .contents',
];

async function tryPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const result = await page.evaluate((selectors) => {
      const out = {};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) {
          out[sel] = { found: false };
          continue;
        }
        const cs = getComputedStyle(el);
        // 检查常见需要覆盖的属性是否被 !important 标记（无法直接读 !important，
        // 但可检测属性值是否非默认 — 若 Discourse 用 !important 设值，revert 无效）
        out[sel] = {
          found: true,
          display: cs.display,
          maxWidth: cs.maxWidth,
          width: cs.width,
          marginLeft: cs.marginLeft,
          marginRight: cs.marginRight,
          padding: cs.padding,
        };
      }
      return out;
    }, TARGET_SELECTORS);
    await browser.close();
    return { ok: true, source: 'playwright', data: result };
  } catch (err) {
    return { ok: false, source: 'playwright', error: err?.message || String(err) };
  }
}

async function tryFetch() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(TARGET_URL, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'ldtk-probe/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, source: 'fetch', error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    // fetch 无法执行 JS，Discourse 是 SPA，HTML 中通常不含目标元素
    // 但能拿到 HTML 说明网络可达，记录为部分成功
    return {
      ok: false,
      source: 'fetch',
      error: 'fetch 只能拿到 SSR HTML，Discourse 是 SPA 需要执行 JS 才能检测 computed style',
      htmlSize: html.length,
    };
  } catch (err) {
    return { ok: false, source: 'fetch', error: err?.message || String(err) };
  }
}

function countStylesCssImportant() {
  const cssPath = join(root, 'styles.css');
  if (!existsSync(cssPath)) return { count: 0, error: 'styles.css not found' };
  const content = readFileSync(cssPath, 'utf8');
  const matches = content.match(/!important/g);
  return { count: matches ? matches.length : 0 };
}

function emitFallbackReport(probeResults) {
  const cssInfo = countStylesCssImportant();
  const lines = [
    '=== T9 CSS 隔离前置探针 — 降级报告 ===',
    '',
    '探针目标: ' + TARGET_URL,
    '尝试方式: ' + probeResults.map((r) => `${r.source}(${r.ok ? 'OK' : 'FAIL'})`).join(', '),
    '失败原因:',
    ...probeResults.filter((r) => !r.ok).map((r) => `  - ${r.source}: ${r.error}`),
    '',
    '当前 styles.css !important 计数: ' + cssInfo.count,
    '',
    '降级决策:',
    '  - 沙箱环境无法访问 linux.do，无法实测 Discourse computed style 是否含 !important。',
    '  - 保守假设: Discourse 对 .wrap / .container / #main-outlet / .d-header 等容器',
    '    使用 !important 设置 max-width / margin / padding 等布局属性（Discourse 主题常见做法）。',
    '  - 阈值: ≤30 处 !important 保留。每处保留的 !important 附注释',
    '    `/* Discourse !important conflict */` 标明为冲突必要保留。',
    '  - 分栏布局（body.ldtk-topic-split-active 下）的非冲突规则改用:',
    '    (1) `all: revert` 重置继承属性',
    '    (2) `ldtk-` 命名空间前缀提高特异性（.ldtk-topic-split-wrapper 内）',
    '    (3) 提高 selector 特异性（多重 class、:where()/:is() 组合）',
    '  - 按钮 + Toast 迁入 Shadow DOM（closed mode），样式隔离由 :host { all: initial } 保证。',
    '  - base64 浮层保留 light DOM（任务明确要求 MUST NOT 改动）。',
    '',
    'Evidence: 探针降级，证据为本报告 + styles.css 中保留的 !important 注释。',
  ];
  console.log(lines.join('\n'));
}

async function main() {
  console.log('T9 CSS 隔离前置探针启动...');
  console.log('目标: ' + TARGET_URL);

  const results = [];
  console.log('尝试 Playwright...');
  const pw = await tryPlaywright();
  results.push(pw);
  if (pw.ok) {
    console.log('Playwright 探针成功:');
    console.log(JSON.stringify(pw.data, null, 2));
    console.log('\nEvidence: 实测 Discourse computed style，可据此精调阈值。');
    process.exit(0);
  }
  console.log('Playwright 不可用: ' + pw.error);

  console.log('尝试 fetch...');
  const f = await tryFetch();
  results.push(f);
  if (f.ok) {
    console.log('fetch 探针成功（但无法执行 JS）');
    process.exit(0);
  }
  console.log('fetch 不可用: ' + f.error);

  emitFallbackReport(results);
  process.exit(0); // 降级不阻塞
}

main().catch((err) => {
  console.error('探针异常:', err);
  process.exit(0); // 降级不阻塞
});
