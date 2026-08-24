import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { imageViewerOwnedSelectors, initImageViewer } from '../src/content/image-viewer';
import { DEFAULT_SETTINGS, type DiscourseSettings } from '../src/common/settings';

function settingsWith(overrides: Partial<DiscourseSettings> = {}): DiscourseSettings {
  return { ...DEFAULT_SETTINGS, enableNativeImagePreview: true, ...overrides };
}

function createPostImage(attributes: Record<string, string> = {}): HTMLImageElement {
  const article = document.createElement('article');
  const cooked = document.createElement('div');
  cooked.className = 'cooked';
  const anchor = document.createElement('a');
  anchor.className = 'lightbox';
  anchor.href = 'https://linux.do/uploads/default/original/full.png';
  const img = document.createElement('img');
  img.src = 'https://linux.do/uploads/default/optimized/thumb.png';
  Object.entries(attributes).forEach(([key, value]) => img.setAttribute(key, value));
  anchor.appendChild(img);
  cooked.appendChild(anchor);
  article.appendChild(cooked);
  document.body.appendChild(article);
  return img;
}

function clickMouse(target: EventTarget): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-ldtk-capture-bound');
  document.head.innerHTML = '';
});

afterEach(() => {
  initImageViewer(settingsWith({ enableNativeImagePreview: false }));
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('initImageViewer', () => {
  it('marks cooked content images with the preview attribute', () => {
    const img = createPostImage();
    initImageViewer(settingsWith());
    expect(img.hasAttribute('data-ldtk-image-preview')).toBe(true);
  });

  it('skips emoji and avatar images', () => {
    const emoji = createPostImage({ class: 'emoji' });
    const avatar = createPostImage({ class: 'avatar' });
    initImageViewer(settingsWith());
    expect(emoji.hasAttribute('data-ldtk-image-preview')).toBe(false);
    expect(avatar.hasAttribute('data-ldtk-image-preview')).toBe(false);
  });

  it('skips images outside post containers', () => {
    const img = document.createElement('img');
    img.src = 'https://linux.do/uploads/default/original/full.png';
    document.body.appendChild(img);
    initImageViewer(settingsWith());
    expect(img.hasAttribute('data-ldtk-image-preview')).toBe(false);
  });

  it('injects the viewer style element once', () => {
    initImageViewer(settingsWith());
    initImageViewer(settingsWith());
    expect(document.querySelectorAll('#ldtk-image-viewer-style')).toHaveLength(1);
  });

  it('opens the viewer on capture click even when native lightbox is absent', () => {
    const img = createPostImage();
    initImageViewer(settingsWith());
    // 模拟原生 magnific lightbox 未注册：事件直接到达捕获监听器。
    const event = clickMouse(img);
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('.ldtk-image-viewer')).not.toBeNull();
  });

  it('keeps the preview image hidden until decoding and initial layout finish', async () => {
    const source = createPostImage();
    initImageViewer(settingsWith());
    clickMouse(source);

    const overlay = document.querySelector<HTMLElement>('.ldtk-image-viewer');
    const preview = overlay?.querySelector<HTMLImageElement>('.ldtk-viewer-img');
    let finishDecode!: () => void;
    const decode = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    Object.defineProperties(preview as HTMLImageElement, {
      naturalWidth: { configurable: true, value: 1600 },
      naturalHeight: { configurable: true, value: 900 },
      decode: { configurable: true, value: vi.fn(() => decode) },
    });

    preview?.dispatchEvent(new Event('load'));

    expect(overlay?.getAttribute('aria-busy')).toBe('true');
    expect(overlay?.classList.contains('ldtk-image-ready')).toBe(false);
    expect(getComputedStyle(preview as HTMLImageElement).visibility).toBe('hidden');

    finishDecode();
    await vi.waitFor(() => {
      expect(overlay?.classList.contains('ldtk-image-ready')).toBe(true);
    });
    expect(overlay?.getAttribute('aria-busy')).toBe('false');
    expect((preview as HTMLImageElement).style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');
    expect(getComputedStyle(preview as HTMLImageElement).visibility).toBe('visible');
  });

  it('does not open the viewer when a native lightbox overlay is already open', () => {
    const img = createPostImage();
    const native = document.createElement('div');
    native.className = 'mfp-wrap';
    native.style.width = '100px';
    native.style.height = '100px';
    native.style.position = 'fixed';
    document.body.appendChild(native);
    initImageViewer(settingsWith());
    const event = clickMouse(img);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('.ldtk-image-viewer')).toBeNull();
  });

  it('opens the viewer on bubble click when the capture handler ran before marking', () => {
    createPostImage();
    initImageViewer(settingsWith());
    // 后插入的图片由再次 init 打标，bubble 阶段兜底打开。
    const late = createPostImage();
    initImageViewer(settingsWith());
    expect(late.getAttribute('data-ldtk-image-preview')).toBe('1');
    const event = clickMouse(late);
    expect(document.querySelector('.ldtk-image-viewer')).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes the viewer and removes markers when the setting is disabled', () => {
    const img = createPostImage();
    initImageViewer(settingsWith());
    clickMouse(img);
    expect(document.querySelector('.ldtk-image-viewer')).not.toBeNull();
    initImageViewer(settingsWith({ enableNativeImagePreview: false }));
    expect(document.querySelector('.ldtk-image-viewer')).toBeNull();
    expect(img.hasAttribute('data-ldtk-image-preview')).toBe(false);
  });

  it('keeps the page scrollable while the viewer is open', () => {
    const img = createPostImage();
    initImageViewer(settingsWith());
    clickMouse(img);
    expect(document.querySelector('.ldtk-image-viewer')).not.toBeNull();
    // 不允许改动 html/body 的 overflow，避免触发 Discourse 的 sidebar 收起逻辑。
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
  });

  it('exposes owned selectors for the mutation filter', () => {
    expect(imageViewerOwnedSelectors).toContain('#ldtk-image-viewer-style');
    expect(imageViewerOwnedSelectors).toContain('.ldtk-image-viewer');
  });
});
