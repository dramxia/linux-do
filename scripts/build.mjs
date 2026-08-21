#!/usr/bin/env node
/* Linux.do 工具箱 — 构建浏览器入口并组装 dist/ 扩展目录 */
import { build } from 'esbuild';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = join(root, 'dist');

const STATIC_FILES = ['manifest.json', 'popup.html', 'README.md'];
const GENERATED_FILES = ['content.js', 'popup.js', 'content.js.map', 'popup.js.map'];

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
  const result = await build({
    entryPoints: {
      content: join(root, 'src/content/index.ts'),
      popup: join(root, 'src/popup/index.ts'),
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
  await copyGeneratedToDist(GENERATED_FILES);

  if (result.warnings.length > 0) {
    console.warn(`⚠️  esbuild reported ${result.warnings.length} warning(s).`);
  }
  console.log('✅ Build complete: root generated files and dist/ are up to date.');
} catch (err) {
  console.error('❌ Build failed:', err?.message || err);
  process.exit(1);
}
