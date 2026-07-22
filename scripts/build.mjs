#!/usr/bin/env node
/* Linux.do 工具箱 — esbuild 多入口 IIFE 构建脚本
 *
 * 替换原 scripts/build.js 的手动拼接：源码已迁移为 ES modules，由 esbuild 解析
 * import/export 并打包为浏览器可加载的 IIFE 文件，输出到项目根目录。
 * 同时复制完整扩展到 dist/，保持与原 build.js 一致的产物结构。
 */
import { build } from 'esbuild';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = join(root, 'dist');

const STATIC_FILES = ['manifest.json', 'popup.html', 'styles.css', 'README.md'];

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function copyFileTo(src, dest) {
  await ensureDir(dirname(dest));
  await copyFile(src, dest);
}

async function copyStaticFiles() {
  await ensureDir(dist);
  for (const file of STATIC_FILES) {
    await copyFileTo(join(root, file), join(dist, file));
  }

  const iconsSrc = join(root, 'icons');
  if (existsSync(iconsSrc)) {
    const iconsDest = join(dist, 'icons');
    await ensureDir(iconsDest);
    const entries = await readdir(iconsSrc);
    for (const entry of entries) {
      await copyFile(join(iconsSrc, entry), join(iconsDest, entry));
    }
  }
}

async function copyGeneratedToDist(filenames) {
  for (const file of filenames) {
    await copyFileTo(join(root, file), join(dist, file));
  }
}

try {
  // dist/ 先清空旧产物，避免遗留文件干扰。
  if (existsSync(dist)) {
    await rm(dist, { recursive: true, force: true });
  }
  await ensureDir(dist);

  const result = await build({
    entryPoints: {
      content: join(root, 'src/content/index.ts'),
      popup: join(root, 'src/popup/index.ts'),
      background: join(root, 'src/background.ts'),
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome110',
    sourcemap: true,
    outdir: root,
    outbase: root,
    write: true,
    logLevel: 'info',
  });

  await copyStaticFiles();
  await copyGeneratedToDist(['content.js', 'popup.js', 'background.js', 'content.js.map', 'popup.js.map', 'background.js.map']);

  if (result.warnings.length > 0) {
    console.warn(`⚠️  esbuild reported ${result.warnings.length} warning(s).`);
  }
  console.log('✅ Build complete: root generated files and dist/ are up to date.');
} catch (err) {
  console.error('❌ Build failed:', err?.message || err);
  process.exit(1);
}
