/* Linux.do 工具箱 — 原生风格图片预览（站点 lightbox 不可用时的兜底查看器） */
import type { DiscourseSettings } from '../common/settings';
import { showToast } from './output';

const VIEWER_STYLE_ID = 'ldtk-image-viewer-style';
const PREVIEW_ATTR = 'data-ldtk-image-preview';
const CAPTURE_BOUND_ATTR = 'data-ldtk-capture-bound';
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 32;
const DRAG_THRESHOLD = 4;

const VIEWER_STYLE = `
.ldtk-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(9, 9, 11, 0);
  opacity: 0;
  transition: background 0.2s ease, opacity 0.2s ease;
  touch-action: none;
  overscroll-behavior: contain;
  user-select: none;
  -webkit-user-select: none;
}
.ldtk-image-viewer.ldtk-open {
  background: rgba(9, 9, 11, 0.88);
  opacity: 1;
}
.ldtk-image-viewer.ldtk-closing {
  background: rgba(9, 9, 11, 0);
  opacity: 0;
}
.ldtk-image-viewer img.ldtk-viewer-img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: 6px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  cursor: grab;
  opacity: 0;
  visibility: hidden;
  will-change: transform, opacity;
  transition:
    transform 0.18s ease,
    opacity 0.14s ease;
}
.ldtk-image-viewer.ldtk-image-ready img.ldtk-viewer-img {
  opacity: 1;
  visibility: visible;
}
.ldtk-image-viewer.ldtk-animating img.ldtk-viewer-img {
  transition:
    transform 0.28s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.14s ease;
}
.ldtk-image-viewer.ldtk-dragging img.ldtk-viewer-img {
  cursor: grabbing;
  transition: none;
}
.ldtk-viewer-btn {
  position: absolute;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  background: rgba(24, 24, 27, 0.72);
  color: #fafafa;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background 0.15s ease, transform 0.15s ease;
}
.ldtk-viewer-btn:hover {
  background: rgba(39, 39, 42, 0.9);
  transform: scale(1.06);
}
.ldtk-viewer-btn:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.ldtk-viewer-btn svg {
  width: 17px;
  height: 17px;
}
.ldtk-viewer-close {
  top: 18px;
  right: 18px;
}
.ldtk-viewer-zoom-in {
  right: 18px;
  bottom: 66px;
}
.ldtk-viewer-zoom-out {
  right: 18px;
  bottom: 18px;
}
.ldtk-viewer-scale-badge {
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 2;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(24, 24, 27, 0.72);
  color: #d4d4d8;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  backdrop-filter: blur(8px);
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .ldtk-image-viewer,
  .ldtk-image-viewer img.ldtk-viewer-img,
  .ldtk-viewer-btn {
    transition: none;
  }
}
`;

const ICONS: Readonly<Record<'close' | 'zoomIn' | 'zoomOut', string>> = Object.freeze({
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  zoomIn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>',
  zoomOut:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>',
});

const SELECTOR_IMG = 'img:not([class*="emoji"]):not([class*="avatar"])';
const IMAGE_CONTAINER_SELECTOR = [
  '.cooked',
  '.post',
  'article',
  '[data-post]',
  '.topic-post',
  '.post-stream',
  '.ldtk-topic-reading-root',
].join(', ');
const EXCLUDED_ANCESTOR_SELECTOR = [
  'header',
  'nav',
  'button',
  '.topic-avatar',
  '.ldtk-post-controls',
  '.ldtk-post-extra-controls',
  '.ldtk-inline-reply',
  '.d-header',
  '.user-info',
  '.topic-meta-data',
  '.post-info',
  '.ldtk-image-viewer',
].join(', ');
const NATIVE_LIGHTBOX_SELECTOR = '.mfp-wrap, .pswp, .discourse-lightbox';

interface PointerState {
  id: number;
  x: number;
  y: number;
}

let viewerOpen = false;
let globalKeydownBound = false;

function ensureViewerStyle(): void {
  if (document.getElementById(VIEWER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = VIEWER_STYLE_ID;
  style.textContent = VIEWER_STYLE;
  document.head.appendChild(style);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  if (element.offsetParent !== null) return true;
  const position = window.getComputedStyle(element).position;
  if (position === 'fixed' || position === 'sticky') return true;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function resolveUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function pickFromSrcset(srcset: string | null | undefined): string | null {
  if (!srcset) return null;
  let best: { url: string; score: number } | null = null;
  for (const candidate of srcset.split(',')) {
    const parts = candidate.trim().split(/\s+/);
    const url = resolveUrl(parts[0]);
    if (!url) continue;
    const descriptor = parts[1] ?? '';
    const score = descriptor.endsWith('x')
      ? Number.parseFloat(descriptor) * 100000 || 0
      : Number.parseInt(descriptor, 10) || 0;
    if (!best || score >= best.score) best = { url, score };
  }
  return best?.url ?? null;
}

function resolveFullImageUrl(img: HTMLImageElement): string {
  const anchor = img.closest('a');
  if (anchor) {
    const classList = anchor.classList;
    const isLightbox =
      classList.contains('lightbox') ||
      classList.contains('lightbox-trigger') ||
      anchor.hasAttribute('data-download-href') ||
      anchor.hasAttribute('data-orig-src');
    if (isLightbox) {
      const fromDataset = resolveUrl(anchor.dataset.origSrc ?? anchor.dataset.downloadHref);
      if (fromDataset) return fromDataset;
      const fromHref = resolveUrl(anchor.getAttribute('href'));
      if (fromHref && !fromHref.startsWith('javascript:')) return fromHref;
    }
  }
  return (
    resolveUrl(img.dataset.origSrc) ??
    resolveUrl(img.currentSrc) ??
    resolveUrl(img.src) ??
    pickFromSrcset(img.srcset) ??
    window.location.href
  );
}

function isPreviewableImage(target: EventTarget | null): target is HTMLImageElement {
  if (!(target instanceof HTMLImageElement)) return false;
  if (target.closest(`.ldtk-image-viewer, ${EXCLUDED_ANCESTOR_SELECTOR}`)) return false;
  if (target.closest('.onebox, .onebox-body, aside.onebox')) return false;
  if (!target.closest(IMAGE_CONTAINER_SELECTOR)) return false;
  const width = target.naturalWidth || target.getBoundingClientRect().width;
  const height = target.naturalHeight || target.getBoundingClientRect().height;
  if (width < 48 || height < 48) {
    // 无法读取尺寸的环境（如图片未加载或测试环境）默认允许预览；
    // 能读取尺寸时过滤掉图标级别的小图。
    return width === 0 && height === 0;
  }
  return true;
}

function shouldIgnoreAnchorClick(anchor: HTMLAnchorElement, img: HTMLImageElement): boolean {
  const classList = anchor.classList;
  if (
    classList.contains('lightbox') ||
    classList.contains('lightbox-trigger') ||
    classList.contains('attachment') ||
    classList.contains('image-overlay')
  ) {
    return false;
  }
  const href = anchor.getAttribute('href') ?? '';
  if (href.startsWith('javascript:')) return false;
  const imgUrl = resolveUrl(img.currentSrc ?? img.src);
  const hrefUrl = resolveUrl(href);
  if (!hrefUrl) return false;
  // 指向原图自身（含仅查询参数差异）的链接不算外链，允许预览。
  if (imgUrl && hrefUrl.replace(/[?#].*$/, '') === imgUrl.replace(/[?#].*$/, '')) return false;
  return true;
}

function downloadImage(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  const filename = url.split('/').pop()?.split(/[?#]/)[0] ?? '';
  if (filename && /\.[a-z0-9]{2,5}$/i.test(filename)) {
    anchor.setAttribute('download', filename);
  }
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

class ImageViewer {
  private readonly overlay: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly badge: HTMLSpanElement;
  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  private fitScale = 1;
  private naturalWidth = 0;
  private naturalHeight = 0;
  private readonly pointers = new Map<number, PointerState>();
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginX = 0;
  private dragOriginY = 0;
  private dragMoved = false;
  private pinchStartDistance = 0;
  private pinchStartScale = 1;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private closed = false;
  private readonly source: HTMLImageElement;
  private readonly fullUrl: string;
  private imageLoadVersion = 0;
  private imageRevealFrame: number | null = null;
  private removeGlobalListeners: (() => void) | null = null;
  private scrollLockCount = 0;
  private savedScrollX = 0;
  private savedScrollY = 0;
  private restoreScrollPosition: (() => void) | null = null;

  constructor(source: HTMLImageElement) {
    this.source = source;
    this.fullUrl = resolveFullImageUrl(source);

    this.overlay = document.createElement('div');
    this.overlay.className = 'ldtk-image-viewer ldtk-animating';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', '图片预览');
    this.overlay.setAttribute('aria-busy', 'true');

    this.img = document.createElement('img');
    this.img.className = 'ldtk-viewer-img';
    this.img.draggable = false;
    this.img.alt = source.alt || '';
    this.img.src = resolveUrl(source.currentSrc ?? source.src) ?? this.fullUrl;

    this.badge = document.createElement('span');
    this.badge.className = 'ldtk-viewer-scale-badge';
    this.badge.textContent = '100%';

    const closeButton = this.createButton('close', '关闭预览（Esc）', 'ldtk-viewer-close');
    closeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.close();
    });
    const zoomInButton = this.createButton('zoomIn', '放大（+）', 'ldtk-viewer-zoom-in');
    zoomInButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.zoomStep(1.25);
    });
    const zoomOutButton = this.createButton('zoomOut', '缩小（-）', 'ldtk-viewer-zoom-out');
    zoomOutButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.zoomStep(0.8);
    });

    this.overlay.append(this.img, closeButton, zoomInButton, zoomOutButton, this.badge);
    this.bindEvents();
  }

  open(): void {
    ensureViewerStyle();
    document.body.appendChild(this.overlay);
    this.lockScroll();
    requestAnimationFrame(() => {
      if (this.closed) return;
      this.overlay.classList.add('ldtk-open');
    });
    if (this.img.complete && this.img.naturalWidth > 0) {
      void this.onImageReady();
    }
  }

  private createButton(
    icon: keyof typeof ICONS,
    label: string,
    className: string,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ldtk-viewer-btn ${className}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = ICONS[icon];
    return button;
  }

  private hideImageUntilReady(): number {
    const version = ++this.imageLoadVersion;
    if (this.imageRevealFrame !== null) {
      window.cancelAnimationFrame(this.imageRevealFrame);
      this.imageRevealFrame = null;
    }
    this.overlay.classList.remove('ldtk-image-ready');
    this.overlay.setAttribute('aria-busy', 'true');
    return version;
  }

  private async onImageReady(): Promise<void> {
    const version = this.hideImageUntilReady();
    if (typeof this.img.decode === 'function') {
      try {
        await this.img.decode();
      } catch {
        // Some browser/image combinations reject decode after a successful load.
      }
    }
    if (this.closed || version !== this.imageLoadVersion || this.img.naturalWidth <= 0) return;
    this.naturalWidth = this.img.naturalWidth;
    this.naturalHeight = this.img.naturalHeight;
    this.computeFitScale();
    this.reset();
    this.imageRevealFrame = window.requestAnimationFrame(() => {
      this.imageRevealFrame = null;
      if (this.closed || version !== this.imageLoadVersion) return;
      this.overlay.classList.add('ldtk-image-ready');
      this.overlay.setAttribute('aria-busy', 'false');
    });
  }

  private computeFitScale(): void {
    if (this.naturalWidth <= 0 || this.naturalHeight <= 0) {
      this.fitScale = 1;
      return;
    }
    const maxWidth = window.innerWidth * 0.92;
    const maxHeight = window.innerHeight * 0.92;
    this.fitScale = Math.min(1, maxWidth / this.naturalWidth, maxHeight / this.naturalHeight);
  }

  private reset(): void {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  private applyTransform(): void {
    const scale = this.scale;
    this.img.style.transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${scale})`;
    this.badge.textContent = `${Math.round(scale * 100)}%`;
  }

  private setScale(next: number, centerX?: number, centerY?: number): void {
    const clamped = clamp(next, MIN_SCALE, MAX_SCALE);
    if (centerX === undefined || centerY === undefined) {
      this.scale = clamped;
      this.applyTransform();
      return;
    }
    const rect = this.overlay.getBoundingClientRect();
    const originX = centerX - (rect.left + rect.width / 2);
    const originY = centerY - (rect.top + rect.height / 2);
    const ratio = clamped / this.scale;
    this.translateX = originX - (originX - this.translateX) * ratio;
    this.translateY = originY - (originY - this.translateY) * ratio;
    this.scale = clamped;
    this.applyTransform();
  }

  private zoomStep(factor: number): void {
    this.overlay.classList.add('ldtk-animating');
    this.setScale(this.scale * factor);
  }

  private toggleZoom(clientX: number, clientY: number): void {
    this.overlay.classList.add('ldtk-animating');
    if (this.scale > this.fitScale * 1.05 || this.scale > 1.02) {
      this.reset();
      return;
    }
    const target = clamp(Math.max(2, this.fitScale * 2), MIN_SCALE, MAX_SCALE);
    this.setScale(target, clientX, clientY);
  }

  private bindEvents(): void {
    this.img.addEventListener('load', () => void this.onImageReady());
    this.img.addEventListener('error', () => {
      this.hideImageUntilReady();
      if (this.img.src !== this.fullUrl) {
        this.img.src = this.fullUrl;
        return;
      }
      showToast('图片加载失败');
      this.close();
    });
    this.img.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleZoom(event.clientX, event.clientY);
    });

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close();
    });

    this.overlay.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.overlay.classList.remove('ldtk-animating');
        const factor = Math.exp(-event.deltaY * 0.0016);
        this.setScale(this.scale * factor, event.clientX, event.clientY);
      },
      { passive: false },
    );

    this.overlay.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.overlay.addEventListener('contextmenu', (event) => {
      if (event.target === this.overlay) event.preventDefault();
    });

    const onPointerMove = (event: PointerEvent): void => this.onPointerMove(event);
    const onPointerEnd = (event: PointerEvent): void => this.onPointerEnd(event);
    const onResize = (): void => {
      this.computeFitScale();
      this.applyTransform();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('resize', onResize);
    this.removeGlobalListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('resize', onResize);
    };
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if ((event.target as Element | null)?.closest('.ldtk-viewer-btn')) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
    try {
      this.overlay.setPointerCapture(event.pointerId);
    } catch {
      // jsdom / 已被释放的指针
    }
    this.overlay.classList.remove('ldtk-animating');

    if (this.pointers.size === 1) {
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragOriginX = this.translateX;
      this.dragOriginY = this.translateY;
      this.dragMoved = false;
      this.overlay.classList.add('ldtk-dragging');
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchStartScale = this.scale;
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStartDistance > 0 && distance > 0) {
        this.setScale(
          this.pinchStartScale * (distance / this.pinchStartDistance),
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
        );
      }
      return;
    }

    if (this.pointers.size !== 1) return;
    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;
    if (!this.dragMoved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    this.dragMoved = true;
    this.translateX = this.dragOriginX + deltaX;
    this.translateY = this.dragOriginY + deltaY;
    this.applyTransform();
  }

  private onPointerEnd(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) {
      this.pinchStartDistance = 0;
    }
    if (this.pointers.size === 0) {
      this.overlay.classList.remove('ldtk-dragging');
      const wasTap =
        !this.dragMoved &&
        event.type === 'pointerup' &&
        event.pointerType !== 'mouse' &&
        event.target === this.img;
      if (wasTap) {
        const now = Date.now();
        const distance = Math.hypot(event.clientX - this.lastTapX, event.clientY - this.lastTapY);
        if (now - this.lastTapTime < DOUBLE_TAP_MS && distance < DOUBLE_TAP_DISTANCE) {
          this.lastTapTime = 0;
          this.toggleZoom(event.clientX, event.clientY);
        } else {
          this.lastTapTime = now;
          this.lastTapX = event.clientX;
          this.lastTapY = event.clientY;
        }
      }
      this.dragMoved = false;
      if (this.scale < this.fitScale) {
        this.overlay.classList.add('ldtk-animating');
        this.reset();
      }
    }
  }

  onKeydown(event: KeyboardEvent): boolean {
    if (this.closed) return false;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        return true;
      case '+':
      case '=':
        event.preventDefault();
        this.zoomStep(1.25);
        return true;
      case '-':
      case '_':
        event.preventDefault();
        this.zoomStep(0.8);
        return true;
      case '0':
        event.preventDefault();
        this.overlay.classList.add('ldtk-animating');
        this.reset();
        return true;
      case 'd':
      case 'D':
        event.preventDefault();
        downloadImage(this.fullUrl);
        return true;
      default:
        return false;
    }
  }

  private lockScroll(): void {
    this.scrollLockCount += 1;
    if (this.scrollLockCount > 1) return;
    this.savedScrollX = window.scrollX;
    this.savedScrollY = window.scrollY;
    const restore = (): void => {
      window.scrollTo(this.savedScrollX, this.savedScrollY);
    };
    window.addEventListener('scroll', restore, { passive: true });
    this.restoreScrollPosition = () => {
      window.removeEventListener('scroll', restore);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    viewerOpen = false;
    this.imageLoadVersion += 1;
    if (this.imageRevealFrame !== null) {
      window.cancelAnimationFrame(this.imageRevealFrame);
      this.imageRevealFrame = null;
    }
    this.removeGlobalListeners?.();
    this.scrollLockCount = 0;
    this.restoreScrollPosition?.();
    this.restoreScrollPosition = null;
    this.overlay.classList.add('ldtk-closing');
    this.overlay.classList.remove('ldtk-open');
    // 先同步从 DOM 移除，再等待动画（浏览器里动画类会平滑收尾，但状态已结束）。
    this.overlay.remove();
  }
}

let activeViewer: ImageViewer | null = null;

function openViewer(img: HTMLImageElement): void {
  if (viewerOpen) return;
  viewerOpen = true;
  activeViewer = new ImageViewer(img);
  activeViewer.open();
}

function isNativeLightboxOpen(): boolean {
  const lightbox = document.querySelector(NATIVE_LIGHTBOX_SELECTOR);
  return Boolean(lightbox && isElementVisible(lightbox));
}

function handleDocumentClick(event: MouseEvent): void {
  if (event.button !== 0 || event.defaultPrevented) return;
  if (!isPreviewableImage(event.target)) return;
  const img = event.target;
  if (img.hasAttribute(PREVIEW_ATTR)) return;

  const anchor = img.closest('a');
  if (anchor && shouldIgnoreAnchorClick(anchor, img)) return;

  event.preventDefault();
  event.stopPropagation();
  openViewer(img);
}

function handleCaptureClick(event: MouseEvent): void {
  if (isNativeLightboxOpen()) return;
  handleDocumentClick(event);
}

function handleBubbleClick(event: MouseEvent): void {
  if (event.defaultPrevented) return;
  if (isNativeLightboxOpen()) return;
  if (!isPreviewableImage(event.target)) return;
  const img = event.target;
  if (!img.hasAttribute(PREVIEW_ATTR)) return;
  const anchor = img.closest('a');
  if (anchor && shouldIgnoreAnchorClick(anchor, img)) return;
  event.preventDefault();
  event.stopPropagation();
  openViewer(img);
}

function bindCaptureHandlers(): void {
  if (document.documentElement.hasAttribute(CAPTURE_BOUND_ATTR)) return;
  document.documentElement.setAttribute(CAPTURE_BOUND_ATTR, '1');
  document.addEventListener('click', handleCaptureClick, true);
  document.addEventListener('click', handleBubbleClick, false);
}

function unbindCaptureHandlers(): void {
  if (!document.documentElement.hasAttribute(CAPTURE_BOUND_ATTR)) return;
  document.documentElement.removeAttribute(CAPTURE_BOUND_ATTR);
  document.removeEventListener('click', handleCaptureClick, true);
  document.removeEventListener('click', handleBubbleClick, false);
}

function bindGlobalKeydown(): void {
  if (globalKeydownBound) return;
  globalKeydownBound = true;
  document.addEventListener('keydown', (event) => {
    if (!viewerOpen || !activeViewer) return;
    if (activeViewer.onKeydown(event)) event.stopPropagation();
  });
}

function processCookedContainer(container: HTMLElement): void {
  const images = container.querySelectorAll<HTMLImageElement>(SELECTOR_IMG);
  images.forEach((img) => {
    if (img.hasAttribute(PREVIEW_ATTR)) return;
    if (img.closest(EXCLUDED_ANCESTOR_SELECTOR)) return;
    img.setAttribute(PREVIEW_ATTR, '1');
  });
}

export function initImageViewer(settings: DiscourseSettings): void {
  if (!settings.enableNativeImagePreview) {
    activeViewer?.close();
    unbindCaptureHandlers();
    document.querySelectorAll(`[${PREVIEW_ATTR}]`).forEach((element) => {
      element.removeAttribute(PREVIEW_ATTR);
    });
    return;
  }
  bindGlobalKeydown();
  bindCaptureHandlers();
  ensureViewerStyle();
  document
    .querySelectorAll<HTMLElement>(IMAGE_CONTAINER_SELECTOR)
    .forEach((container) => processCookedContainer(container));
}

export const imageViewerOwnedSelectors = [`#${VIEWER_STYLE_ID}`, '.ldtk-image-viewer'] as const;
