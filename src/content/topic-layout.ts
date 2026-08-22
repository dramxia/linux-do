/* Linux.do 工具箱 - 主题正文/评论双栏阅读模式 */
import type { DiscourseSettings } from '../common/settings';
import { injectButtons } from './buttons';
import { copyToClipboard, showToast } from './output';
import { fetchPostReplies, TopicDataSource, type TopicPost } from './topic-api';
import {
  parseTopicActionResult,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_REACTION_PICKER_REQUEST_NAME,
  type TopicAction,
  type TopicActionRequest,
  type TopicReactionPickerRequest,
} from './topic-actions';
import { parseTopicEventDetail, TOPIC_EVENT_NAME, type TopicEventDetail } from './topic-events';
import { TopicReadTracker } from './topic-read-tracking';
import {
  buildPaginationItems,
  clampPage,
  COMMENTS_PAGE_PARAM,
  deriveInitialPage,
  getCommentPageForFloor,
  getPageCount,
  parseTopicRoute,
  readTopicState,
  updatePageUrl,
  writeTopicState,
  type PendingNativeAction,
  type TopicReadingState,
  type TopicRoute,
} from './topic-state';

const ROOT_CLASS = 'ldtk-topic-reading-root';
const ACTIVE_CLASS = 'ldtk-split-reading-active';
const PENDING_CLASS = 'ldtk-split-reading-pending';
const STYLE_ID = 'ldtk-topic-reading-style';
const PENDING_STYLE_ID = 'ldtk-topic-reading-pending-style';
const RETURN_BUTTON_ID = 'ldtk-native-return';
const MIN_VIEWPORT_WIDTH = 1280;
let nativeAttemptKey: string | null = null;
let actionRequestSequence = 0;

const DISCOURSE_ICON_REPLACEMENTS: Readonly<Record<string, string>> = {
  'd-liked': 'heart',
  'd-unliked': 'far-heart',
  'd-post-share': 'arrow-up-from-bracket',
};

const NATIVE_ACTION_SELECTORS: Record<PendingNativeAction['action'], string> = {
  like: '.post-action-menu__like, button[title*="赞"], button[aria-label*="赞"]',
  reply: '.post-action-menu__reply, button[title*="回复"], button[aria-label*="回复"]',
  bookmark: '.post-action-menu__bookmark, button[title*="书签"], button[aria-label*="书签"]',
  more: '.post-action-menu__more, button[title*="更多"], button[aria-label*="更多"]',
  edit: '.post-action-menu__edit, button[title*="编辑"], button[aria-label*="编辑"]',
  delete: '.post-action-menu__delete, button[title*="删除"], button[aria-label*="删除"]',
  recover: '.post-action-menu__recover, button[title*="恢复"], button[aria-label*="恢复"]',
};

const PENDING_STYLE = `
html.${PENDING_CLASS} #main-outlet,
html.${PENDING_CLASS} .sidebar-wrapper,
html.${PENDING_CLASS} .topic-navigation,
html.${PENDING_CLASS} .timeline-container {
  visibility: hidden !important;
}
`;

const LAYOUT_STYLE = `
html.${ACTIVE_CLASS},
html.${ACTIVE_CLASS} body {
  overflow: hidden !important;
}
html.${ACTIVE_CLASS} #main-outlet {
  position: relative !important;
  z-index: 400 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
html.${ACTIVE_CLASS} .sidebar-wrapper,
html.${ACTIVE_CLASS} .topic-navigation,
html.${ACTIVE_CLASS} .timeline-container {
  display: none !important;
}
html.${ACTIVE_CLASS} #main-outlet .discourse-reactions-picker.is-expanded {
  z-index: 410 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}
html.${ACTIVE_CLASS} #main-outlet .discourse-boosts__input-container,
html.${ACTIVE_CLASS} #main-outlet .discourse-boosts__input-container * {
  visibility: visible !important;
  pointer-events: auto !important;
}
html.${ACTIVE_CLASS} #reply-control {
  z-index: 400 !important;
}
html.${ACTIVE_CLASS} #reply-control.open {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
.${ROOT_CLASS} {
  position: fixed;
  inset: var(--ldtk-header-height, 60px) 0 0;
  z-index: 90;
  box-sizing: border-box;
  overflow: hidden;
  color: var(--primary, #222);
  background: var(--secondary, #fff);
  font-family: var(--font-family, Arial, sans-serif);
  letter-spacing: 0;
}
.${ROOT_CLASS} *, .${ROOT_CLASS} *::before, .${ROOT_CLASS} *::after {
  box-sizing: border-box;
}
.ldtk-reading-grid {
  width: min(100%, 1920px);
  height: 100%;
  margin: 0 auto;
  padding: 16px 24px;
  display: grid;
  grid-template-columns: minmax(0, 58fr) minmax(420px, 42fr);
  gap: 24px;
}
.ldtk-reading-pane {
  min-width: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--secondary, #fff);
  border: 1px solid var(--primary-low, #e4e4e4);
  border-radius: 6px;
}
.ldtk-article-pane {
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: hidden;
}
.ldtk-article-scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 28px clamp(24px, 4vw, 64px) 40px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.ldtk-article-header {
  max-width: 780px;
  margin: 0 auto 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-article-header h1 {
  margin: 0 0 12px;
  color: var(--primary, #222);
  font-size: 28px;
  line-height: 1.3;
  font-weight: 650;
  overflow-wrap: anywhere;
  letter-spacing: 0;
}
.ldtk-article-header p,
.ldtk-comment-status,
.ldtk-post-meta {
  color: var(--primary-medium, #6b6b6b);
}
.ldtk-article-content {
  max-width: 780px;
  margin: 0 auto;
}
.ldtk-article-footer {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  width: 100%;
  max-height: min(38vh, 230px);
  padding: 0 clamp(24px, 4vw, 64px) 12px;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--primary, #222);
  background: var(--secondary, #fff);
  border-top: 1px solid var(--primary-low, #e4e4e4);
  box-shadow: 0 -4px 12px rgb(0 0 0 / 4%);
  scrollbar-gutter: stable;
}
.ldtk-article-footer > * {
  max-width: 780px;
  margin-right: auto;
  margin-left: auto;
}
.ldtk-article-reply-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 38px;
  padding: 8px 0;
  border-top: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-article-reply-summary[hidden] {
  display: none;
}
.ldtk-article-reply-chip {
  display: inline-flex;
  align-items: flex-start;
  gap: 5px;
  min-height: 30px;
  max-width: min(100%, 300px);
  padding: 3px 9px 3px 4px;
  border: 0;
  border-radius: 8px;
  color: var(--primary-medium, #666);
  background: var(--primary-very-low, #f5f5f5);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.ldtk-article-reply-chip:hover {
  color: var(--primary, #222);
  background: var(--primary-low, #e9e9e9);
}
.ldtk-article-reply-chip:focus-visible {
  outline: 2px solid var(--tertiary, #0088cc);
  outline-offset: 2px;
}
.ldtk-article-reply-avatar {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}
.ldtk-article-reply-content {
  min-width: 0;
  padding-top: 2px;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.45;
  text-align: left;
}
.ldtk-article-reply-content img.emoji {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin: 0 1px;
  border-radius: 0;
  object-fit: contain;
  vertical-align: -4px;
}
.ldtk-topic-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px 20px;
  min-height: 68px;
  padding: 12px 0;
  border-top: 1px solid var(--primary-low, #e4e4e4);
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-topic-stat {
  display: grid;
  gap: 2px;
  min-width: 52px;
  color: var(--primary-medium, #666);
  font-size: 12px;
  line-height: 1.2;
}
.ldtk-topic-stat strong {
  color: var(--tertiary, #0088cc);
  font-size: 19px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.ldtk-topic-participants {
  display: flex;
  align-items: center;
  min-width: 0;
}
.ldtk-topic-participants a {
  display: block;
  margin-left: -5px;
}
.ldtk-topic-participants a:first-child {
  margin-left: 0;
}
.ldtk-topic-participants img {
  display: block;
  width: 30px;
  height: 30px;
  border: 2px solid var(--secondary, #fff);
  border-radius: 50%;
  background: var(--primary-low, #e4e4e4);
}
.ldtk-topic-read-time {
  margin-left: auto;
  text-align: right;
}
.ldtk-topic-read-time strong {
  color: var(--primary-medium, #666);
}
.ldtk-comments-pane {
  position: relative;
  background: var(--secondary, #fff);
}
.ldtk-comments-toolbar {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 54px;
  padding: 8px 12px;
  background: var(--secondary, #fff);
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-comments-toolbar h2 {
  margin: 0 auto 0 0;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 650;
  letter-spacing: 0;
}
.ldtk-toolbar-button,
.ldtk-pagination button,
.ldtk-reply-target {
  min-width: 32px;
  min-height: 32px;
  padding: 6px 9px;
  border: 1px solid var(--primary-low, #ddd);
  border-radius: 4px;
  color: var(--primary, #222);
  background: var(--secondary, #fff);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.ldtk-toolbar-button:hover,
.ldtk-pagination button:hover,
.ldtk-reply-target:hover {
  background: var(--primary-very-low, #f5f5f5);
}
.ldtk-toolbar-button:focus-visible,
.ldtk-pagination button:focus-visible,
.ldtk-reply-target:focus-visible {
  outline: 2px solid var(--tertiary, #0088cc);
  outline-offset: 2px;
}
.ldtk-toolbar-button:disabled,
.ldtk-pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.ldtk-new-replies {
  display: none;
  width: calc(100% - 24px);
  margin: 10px 12px 0;
  padding: 9px 12px;
  border: 1px solid var(--tertiary-low, #b9dff3);
  border-radius: 4px;
  color: var(--tertiary, #0088cc);
  background: var(--tertiary-very-low, #edf7fc);
  font: inherit;
  cursor: pointer;
}
.ldtk-new-replies[data-visible="true"] { display: block; }
.ldtk-comments-list {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 0 16px;
}
.${ROOT_CLASS} .topic-post {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  gap: 12px;
  padding: 20px 0;
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
  background: transparent;
}
.${ROOT_CLASS} .topic-post:last-child { border-bottom: 0; }
.${ROOT_CLASS} .ldtk-article-content.topic-post {
  display: block;
  padding: 0;
  border: 0;
}
.${ROOT_CLASS} .topic-avatar img {
  display: block;
  width: 42px;
  height: 42px;
  border-radius: 50%;
}
.${ROOT_CLASS} .topic-body {
  width: 100% !important;
  min-width: 0;
  max-width: 100%;
}
.ldtk-post-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.${ROOT_CLASS} .names .username {
  color: var(--primary, #222);
  font-weight: 650;
  text-decoration: none;
}
.ldtk-post-meta {
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
}
.ldtk-reply-target {
  min-height: 24px;
  padding: 3px 6px;
  border-color: var(--tertiary-low, #9ccfe8);
  color: var(--tertiary-hover, #006699);
  background: var(--tertiary-very-low, #e7f5fc);
  box-shadow: inset 3px 0 0 var(--tertiary, #0088cc);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
  text-align: left;
}
.ldtk-reply-target:hover {
  border-color: var(--tertiary, #0088cc);
  color: var(--tertiary-hover, #005580);
  background: var(--tertiary-low, #d7edf8);
}
.${ROOT_CLASS} .cooked {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.65;
}
.${ROOT_CLASS} .cooked pre,
.${ROOT_CLASS} .cooked table,
.${ROOT_CLASS} .cooked .md-table,
.${ROOT_CLASS} .cooked .onebox {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.${ROOT_CLASS} .cooked pre {
  white-space: pre;
}
.${ROOT_CLASS} .cooked table {
  display: block;
}
.${ROOT_CLASS} .cooked p,
.${ROOT_CLASS} .cooked li,
.${ROOT_CLASS} .cooked a,
.${ROOT_CLASS} .cooked blockquote {
  overflow-wrap: anywhere;
}
.${ROOT_CLASS} .cooked img,
.${ROOT_CLASS} .cooked video,
.${ROOT_CLASS} .cooked iframe,
.${ROOT_CLASS} .cooked object,
.${ROOT_CLASS} .cooked canvas,
.${ROOT_CLASS} .cooked svg {
  max-width: 100%;
}
.${ROOT_CLASS} .cooked img,
.${ROOT_CLASS} .cooked video {
  height: auto;
}
.ldtk-post-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 40px;
  margin-top: 16px;
  color: var(--primary-medium, #6b6b6b);
}
.ldtk-post-extra-controls,
.ldtk-post-actions,
.ldtk-more-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.ldtk-post-actions {
  margin-left: auto;
}
.ldtk-more-actions[hidden] {
  display: none;
}
.ldtk-post-menu-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 32px;
  min-height: 32px;
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  color: var(--primary-low-mid, #919191);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.ldtk-post-menu-button:hover {
  color: var(--primary, #222);
  background: var(--d-hover, var(--primary-very-low, #f2f2f2));
}
.ldtk-post-menu-button:focus-visible {
  outline: 2px solid var(--tertiary, #0088cc);
  outline-offset: 2px;
}
.ldtk-post-menu-button:disabled,
.ldtk-post-menu-button[aria-busy="true"] {
  cursor: wait;
  opacity: 0.5;
}
.ldtk-post-menu-button .d-icon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  pointer-events: none;
}
.ldtk-post-menu-button .btn-toggle-reaction-emoji {
  display: block;
  width: 18px;
  height: 18px;
  object-fit: contain;
  pointer-events: none;
}
.ldtk-post-menu-button.button-count {
  gap: 5px;
  color: var(--primary-medium, #777);
  font-variant-numeric: tabular-nums;
}
.ldtk-post-menu-button.like-count .d-icon,
.ldtk-post-menu-button[aria-pressed="true"].post-action-menu__like {
  color: var(--love, #fa6c8d);
}
.ldtk-post-menu-button.bookmarked {
  color: var(--tertiary, #0088cc);
}
.ldtk-post-menu-button.post-action-menu__reply {
  padding-inline: 9px;
  color: var(--primary-medium, #666);
}
.${ROOT_CLASS} .discourse-boosts__post-menu {
  width: 100%;
  padding: 4px 0;
}
.${ROOT_CLASS} .discourse-boosts__list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.${ROOT_CLASS} .discourse-boosts__bubble {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 8px 4px 4px;
  border: 0;
  border-radius: 50px;
  color: var(--primary, #222);
  background: var(--primary-100, var(--primary-very-low, #f2f2f2));
  font-size: 12px;
  line-height: 1;
}
.${ROOT_CLASS} .discourse-boosts__bubble > a {
  flex: 0 0 auto;
}
.${ROOT_CLASS} .discourse-boosts__bubble .avatar {
  display: block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}
.${ROOT_CLASS} .discourse-boosts__cooked {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
}
.${ROOT_CLASS} .discourse-boosts__cooked p {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
}
.${ROOT_CLASS} .discourse-boosts__cooked img.emoji,
.${ROOT_CLASS} .discourse-boosts__cooked img.emoji.only-emoji {
  width: 16px;
  height: 16px;
  margin: 0;
  object-fit: contain;
}
.${ROOT_CLASS} .discourse-boosts__add-btn {
  color: var(--primary-medium, #666);
}
.${ROOT_CLASS} .discourse-boosts__add-btn:hover {
  color: var(--primary, #222);
}
.ldtk-inline-replies {
  margin-top: 8px;
  border-top: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-inline-replies[hidden] {
  display: none;
}
.ldtk-inline-reply {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-inline-reply-avatar img {
  display: block;
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.ldtk-inline-reply-body {
  min-width: 0;
}
.ldtk-inline-reply-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.ldtk-inline-reply-heading strong {
  color: var(--primary, #222);
  font-size: 13px;
}
.ldtk-inline-reply-floor {
  margin-left: auto;
  padding: 2px 0;
  border: 0;
  color: var(--primary-medium, #777);
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ldtk-inline-reply .cooked {
  font-size: 14px;
}
.ldtk-inline-replies-status,
.ldtk-load-more-replies {
  width: 100%;
  padding: 10px;
  border: 0;
  color: var(--primary-medium, #666);
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: center;
}
.ldtk-load-more-replies {
  cursor: pointer;
}
.ldtk-load-more-replies:hover {
  color: var(--tertiary, #0088cc);
  background: var(--primary-very-low, #f5f5f5);
}
.ldtk-deleted-placeholder {
  color: var(--primary-medium, #666);
  font-style: italic;
}
.ldtk-destroyed-post > .ldtk-deleted-placeholder {
  grid-column: 1 / -1;
  margin: 0;
}
.ldtk-comment-status {
  padding: 36px 16px;
  text-align: center;
}
.ldtk-pagination {
  position: sticky;
  bottom: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 52px;
  padding: 8px 12px;
  background: var(--secondary, #fff);
  border-top: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-pagination button[aria-current="page"] {
  color: var(--secondary, #fff);
  border-color: var(--tertiary, #0088cc);
  background: var(--tertiary, #0088cc);
}
.ldtk-pagination-ellipsis { padding: 0 3px; color: var(--primary-medium, #666); }
.ldtk-post-highlight {
  outline: 3px solid var(--tertiary, #0088cc);
  outline-offset: -3px;
  background: var(--tertiary-very-low, #edf7fc) !important;
}
#${RETURN_BUTTON_ID} {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483646;
  min-height: 40px;
  padding: 9px 14px;
  border: 1px solid var(--tertiary, #0088cc);
  border-radius: 5px;
  color: var(--secondary, #fff);
  background: var(--tertiary, #0088cc);
  box-shadow: 0 4px 14px rgb(0 0 0 / 20%);
  font: 600 14px/1.2 var(--font-family, Arial, sans-serif);
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .${ROOT_CLASS} *, #${RETURN_BUTTON_ID} { scroll-behavior: auto !important; }
  .${ROOT_CLASS} .heart-animation { animation: none !important; }
}
`;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getAvatarUrl(template?: string): string | null {
  if (!template) return null;
  const url = template.replace('{size}', '90');
  return url.startsWith('//') ? `${window.location.protocol}${url}` : url;
}

function formatCompactNumber(value: number): string {
  const normalized = Math.max(0, value);
  if (normalized < 1_000) return String(normalized);
  const units = [
    { threshold: 1_000_000, suffix: 'm' },
    { threshold: 1_000, suffix: 'k' },
  ];
  const unit = units.find(({ threshold }) => normalized >= threshold);
  if (!unit) return String(normalized);
  const compact = normalized / unit.threshold;
  return `${compact >= 100 ? Math.round(compact) : compact.toFixed(1).replace(/\.0$/, '')}${unit.suffix}`;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createButton(className: string, text: string, label = text): HTMLButtonElement {
  const button = createElement('button', className, text);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  return button;
}

function createDiscourseIcon(name: string): SVGSVGElement {
  const symbolName = DISCOURSE_ICON_REPLACEMENTS[name] || name;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('fa', 'd-icon', `d-icon-${name}`, 'svg-icon', 'svg-string');
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbolName}`);
  icon.appendChild(use);
  return icon;
}

function setButtonIcon(button: HTMLButtonElement, name: string): void {
  const use = button.querySelector('use');
  if (!use) return;
  use.setAttribute('href', `#${DISCOURSE_ICON_REPLACEMENTS[name] || name}`);
  const icon = use.closest('svg');
  if (icon) icon.setAttribute('class', `fa d-icon d-icon-${name} svg-icon svg-string`);
}

interface PostMenuButtonOptions {
  className?: string;
  icon: string;
  label: string;
  visibleLabel?: string;
}

function createPostMenuButton(options: PostMenuButtonOptions): HTMLButtonElement {
  const classes = ['ldtk-post-menu-button', 'btn-flat', options.className]
    .filter(Boolean)
    .join(' ');
  const button = createButton(classes, '', options.label);
  button.title = options.label;
  button.appendChild(createDiscourseIcon(options.icon));
  if (options.visibleLabel) button.appendChild(createElement('span', '', options.visibleLabel));
  return button;
}

function getNativePost(floor: number): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    `#main-outlet .topic-post[data-post-number="${floor}"], #main-outlet article[data-post-number="${floor}"]`,
  );
  return candidates[0] || null;
}

function buildNativeFloorUrl(floor: number): string {
  const url = new URL(window.location.href);
  const parts = window.location.pathname.split('/').filter(Boolean);
  const numericIndexes = parts.flatMap((part, index) => (/^\d+$/.test(part) ? [index] : []));
  if (numericIndexes.length >= 2) parts.splice(numericIndexes[1], 1);
  if (floor > 1) parts.push(String(floor));
  url.pathname = `/${parts.join('/')}`;
  url.searchParams.delete(COMMENTS_PAGE_PARAM);
  url.hash = '';
  return url.href;
}

function removeReturnButton(): void {
  document.getElementById(RETURN_BUTTON_ID)?.remove();
}

function ensureLayoutStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = createElement('style');
  style.id = STYLE_ID;
  style.textContent = LAYOUT_STYLE;
  document.head.appendChild(style);
}

function ensurePendingStyle(): void {
  if (document.getElementById(PENDING_STYLE_ID)) return;
  const style = createElement('style');
  style.id = PENDING_STYLE_ID;
  style.textContent = PENDING_STYLE;
  (document.head || document.documentElement).appendChild(style);
}

export function clearPendingTopicLayout(): void {
  document.documentElement.classList.remove(PENDING_CLASS);
  document.getElementById(PENDING_STYLE_ID)?.remove();
}

export function prepareTopicLayout(settings?: DiscourseSettings): boolean {
  const route = parseTopicRoute(window.location.pathname);
  const eligible =
    Boolean(route) &&
    window.innerWidth >= MIN_VIEWPORT_WIDTH &&
    settings?.enableSplitReading !== false;
  if (!eligible) {
    clearPendingTopicLayout();
    return false;
  }
  ensurePendingStyle();
  document.documentElement.classList.add(PENDING_CLASS);
  return true;
}

function addHighlight(element: HTMLElement): void {
  element.classList.add('ldtk-post-highlight');
  window.setTimeout(() => element.classList.remove('ldtk-post-highlight'), 1800);
}

interface NativeModeOptions {
  route: TopicRoute;
  settings: DiscourseSettings;
  state: TopicReadingState;
}

function tryPendingNativeAction(route: TopicRoute, state: TopicReadingState): void {
  const pending = state.pendingAction;
  if (!pending) return;

  const attempt = (): boolean => {
    const post = getNativePost(pending.floor);
    if (!post) return false;
    post.scrollIntoView({ block: 'center' });
    addHighlight(post);
    const control = post.querySelector<HTMLElement>(NATIVE_ACTION_SELECTORS[pending.action]);
    control?.click();
    writeTopicState(route.topicId, { ...state, pendingAction: undefined });
    return true;
  };

  if (attempt()) return;
  if (route.floor !== pending.floor) {
    window.location.assign(buildNativeFloorUrl(pending.floor));
    return;
  }

  const observer = new MutationObserver(() => {
    if (attempt()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 8000);
}

function ensureNativeMode(options: NativeModeOptions): void {
  ensureLayoutStyle();
  clearPendingTopicLayout();
  document.documentElement.classList.remove(ACTIVE_CLASS);
  document.querySelector(`.${ROOT_CLASS}`)?.remove();
  let button = document.getElementById(RETURN_BUTTON_ID) as HTMLButtonElement | null;
  if (!button) {
    button = createButton('', '返回双栏阅读');
    button.id = RETURN_BUTTON_ID;
    document.body.appendChild(button);
  }
  button.onclick = () => {
    nativeAttemptKey = null;
    removeReturnButton();
    writeTopicState(options.route.topicId, {
      ...options.state,
      nativeMode: false,
      pendingAction: undefined,
    });
    void refreshTopicLayout(options.settings, true);
  };
  const pending = options.state.pendingAction;
  if (pending) {
    const attemptKey = `${options.route.topicId}:${pending.floor}:${pending.action}`;
    if (attemptKey !== nativeAttemptKey) {
      nativeAttemptKey = attemptKey;
      tryPendingNativeAction(options.route, options.state);
    }
  }
}

interface LayoutCallbacks {
  requestRefresh: () => void;
  handoffNative: (floor: number, action?: PendingNativeAction['action']) => void;
}

class TopicLayout {
  readonly root = createElement('section', ROOT_CLASS);
  private readonly articlePane = createElement('section', 'ldtk-reading-pane ldtk-article-pane');
  private readonly articleScroll = createElement('div', 'ldtk-article-scroll');
  private readonly commentsPane = createElement('section', 'ldtk-reading-pane ldtk-comments-pane');
  private readonly commentsList = createElement('div', 'ldtk-comments-list');
  private readonly pagination = createElement('nav', 'ldtk-pagination');
  private readonly newRepliesButton = createButton('ldtk-new-replies', '有新回复，点击刷新');
  private readonly refreshButton = createButton('ldtk-toolbar-button', '刷新', '刷新评论');
  private readonly status = createElement('div', 'ldtk-comment-status');
  private currentPage: number;
  private readonly pageCount: number;
  private readonly state: TopicReadingState;
  private readonly eventVersions = new Map<number, number>();
  private readonly reactionImages = new Map<number, { id: string; url?: string }>();
  private readonly replyAborts = new Map<number, AbortController>();
  private articleReplies: TopicPost[] = [];
  private readTracker: TopicReadTracker | null = null;
  private pageAbort: AbortController | null = null;
  private newReplyCount = 0;
  private destroyed = false;
  private saveTimer: number | null = null;

  constructor(
    readonly route: TopicRoute,
    private readonly source: TopicDataSource,
    private readonly settings: DiscourseSettings,
    initialPage: number,
    private readonly callbacks: LayoutCallbacks,
  ) {
    this.currentPage = initialPage;
    this.pageCount = getPageCount(source.commentCount, settings.commentsPerPage);
    const savedState = readTopicState(route.topicId);
    this.state = savedState
      ? {
          ...savedState,
          page: initialPage,
          rightScrollTop: savedState.page === initialPage ? savedState.rightScrollTop : 0,
        }
      : {
          page: initialPage,
          leftScrollTop: 0,
          rightScrollTop: 0,
        };
  }

  mount(initialPosts: TopicPost[], articleReplies: TopicPost[] = []): void {
    this.articleReplies = articleReplies;
    this.ensureStyle();
    this.root.setAttribute('aria-label', '主题双栏阅读');
    const grid = createElement('div', 'ldtk-reading-grid');
    grid.append(this.articlePane, this.commentsPane);
    this.root.appendChild(grid);
    this.renderArticle();
    this.renderCommentsShell();
    this.renderComments(initialPosts);
    this.updateHeaderOffset();
    document.body.appendChild(this.root);
    document.documentElement.classList.add(ACTIVE_CLASS);
    clearPendingTopicLayout();
    removeReturnButton();

    this.articleScroll.scrollTop = this.state.leftScrollTop;
    this.commentsPane.scrollTop = this.state.rightScrollTop;
    this.articleScroll.addEventListener('scroll', this.scheduleSave, { passive: true });
    this.commentsPane.addEventListener('scroll', this.scheduleSave, { passive: true });
    this.root.addEventListener('click', this.handleClick);
    this.root.addEventListener('pointerover', this.handleReactionPointerOver);
    this.root.addEventListener('pointerout', this.handleReactionPointerOut);
    this.root.addEventListener('focusin', this.handleReactionFocusIn);
    this.root.addEventListener('focusout', this.handleReactionFocusOut);
    window.addEventListener('popstate', this.handlePopState);
    window.addEventListener('pagehide', this.handlePageHide);
    document.addEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    injectButtons(this.settings);

    if (this.route.floor) void this.goToFloor(this.route.floor, false);
  }

  destroy(save = true, preserveShell = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (save) this.saveState();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.pageAbort?.abort();
    this.replyAborts.forEach((controller) => controller.abort());
    this.replyAborts.clear();
    this.readTracker?.disconnect();
    this.articleScroll.removeEventListener('scroll', this.scheduleSave);
    this.commentsPane.removeEventListener('scroll', this.scheduleSave);
    this.root.removeEventListener('click', this.handleClick);
    this.root.removeEventListener('pointerover', this.handleReactionPointerOver);
    this.root.removeEventListener('pointerout', this.handleReactionPointerOut);
    this.root.removeEventListener('focusin', this.handleReactionFocusIn);
    this.root.removeEventListener('focusout', this.handleReactionFocusOut);
    window.removeEventListener('popstate', this.handlePopState);
    window.removeEventListener('pagehide', this.handlePageHide);
    document.removeEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    this.root.remove();
    if (!preserveShell) {
      document.documentElement.classList.remove(ACTIVE_CLASS);
      document.getElementById(STYLE_ID)?.remove();
    }
  }

  persistState(): void {
    this.saveState();
  }

  updateHeaderOffset(): void {
    const header = document.querySelector<HTMLElement>('.d-header-wrap, .d-header');
    const height = Math.max(0, Math.round(header?.getBoundingClientRect().bottom || 0));
    this.root.style.setProperty('--ldtk-header-height', `${height || 60}px`);
  }

  matches(route: TopicRoute, settings: DiscourseSettings): boolean {
    return (
      this.route.topicId === route.topicId &&
      this.settings.commentsPerPage === settings.commentsPerPage
    );
  }

  private ensureStyle(): void {
    ensureLayoutStyle();
  }

  private renderArticle(): void {
    const scrollTop = this.articleScroll.scrollTop;
    const header = createElement('header', 'ldtk-article-header');
    const title = createElement('h1');
    title.innerHTML = this.source.topic.fancy_title || this.source.topic.title;
    const meta = createElement(
      'p',
      '',
      `${this.source.article.display_username || this.source.article.username} · ${formatDate(this.source.article.created_at)}`,
    );
    header.append(title, meta);

    const content = createElement('article', 'ldtk-article-content topic-post');
    content.dataset.postId = String(this.source.article.id);
    content.dataset.postNumber = '1';
    content.dataset.username = this.source.article.username;
    content.dataset.createdAt = this.source.article.created_at;
    const body = createElement('div', 'topic-body');
    const cooked = createElement('div', 'cooked');
    cooked.innerHTML = this.source.article.cooked;
    const footer = createElement('footer', 'ldtk-article-footer');
    footer.setAttribute('aria-label', '正文信息和操作');
    footer.appendChild(this.createPostControls(this.source.article));
    const boosts = this.createBoosts(this.source.article);
    if (boosts) footer.appendChild(boosts);
    const replySummary = this.createArticleReplySummary(this.source.article, this.articleReplies);
    if (replySummary) {
      footer.appendChild(replySummary);
      const repliesButton = footer.querySelector<HTMLButtonElement>('[data-toggle-replies]');
      repliesButton?.setAttribute('aria-expanded', 'true');
    }
    const summary = this.createTopicSummary();
    if (summary) footer.appendChild(summary);
    body.appendChild(cooked);
    content.appendChild(body);
    this.articleScroll.replaceChildren(header, content);
    this.articlePane.replaceChildren(this.articleScroll, footer);
    this.articleScroll.scrollTop = scrollTop;
  }

  private renderCommentsShell(): void {
    const toolbar = createElement('header', 'ldtk-comments-toolbar');
    const heading = createElement('h2', '', `评论 ${this.source.commentCount}`);
    this.refreshButton.title = '从服务器重新加载主题和评论';
    this.refreshButton.addEventListener('click', this.callbacks.requestRefresh);
    toolbar.append(heading, this.refreshButton);
    this.newRepliesButton.dataset.visible = 'false';
    this.newRepliesButton.addEventListener('click', this.callbacks.requestRefresh);
    this.pagination.setAttribute('aria-label', '评论分页');
    this.commentsPane.append(
      toolbar,
      this.newRepliesButton,
      this.status,
      this.commentsList,
      this.pagination,
    );
  }

  private createPost(post: TopicPost): HTMLElement {
    const article = createElement('article', 'topic-post ldtk-reading-post');
    article.dataset.postId = String(post.id);
    article.dataset.postNumber = String(post.post_number);
    article.dataset.username = post.username;
    article.dataset.createdAt = post.created_at;
    if (post.hidden) article.classList.add('is-hidden');

    const avatar = createElement('div', 'topic-avatar');
    const avatarUrl = getAvatarUrl(post.avatar_template);
    if (avatarUrl) {
      const image = createElement('img');
      image.src = avatarUrl;
      image.alt = '';
      image.width = 42;
      image.height = 42;
      image.loading = 'lazy';
      avatar.appendChild(image);
    }

    const body = createElement('div', 'topic-body');
    const heading = createElement('header', 'ldtk-post-heading');
    const names = createElement('span', 'names');
    const username = createElement(
      'span',
      'username',
      post.display_username || post.name || post.username,
    );
    names.appendChild(username);
    heading.appendChild(names);
    if (post.reply_to_post_number) {
      const replyTargetPost = this.source.getCachedPostByNumber(post.reply_to_post_number);
      const replyTargetUsername = replyTargetPost?.username.trim();
      const replyLabel = replyTargetUsername
        ? `回复 @${replyTargetUsername} · #${post.reply_to_post_number}`
        : `回复 #${post.reply_to_post_number}`;
      const replyTitle = replyTargetUsername
        ? `跳转到 @${replyTargetUsername} 的 ${post.reply_to_post_number} 楼评论`
        : `跳转到 ${post.reply_to_post_number} 楼`;
      const replyTarget = createButton('ldtk-reply-target', replyLabel, replyTitle);
      replyTarget.dataset.targetFloor = String(post.reply_to_post_number);
      heading.appendChild(replyTarget);
    }
    const time = createElement('a', 'ldtk-post-meta');
    time.href = buildNativeFloorUrl(post.post_number);
    const timestamp = createElement(
      'time',
      '',
      `#${post.post_number} · ${formatDate(post.created_at)}`,
    );
    timestamp.dateTime = post.created_at;
    time.appendChild(timestamp);
    heading.appendChild(time);

    const cooked = createElement('div', 'cooked');
    if (post.deleted_at && !post.cooked.trim()) {
      cooked.classList.add('ldtk-deleted-placeholder');
      cooked.textContent = '此回复已删除';
    } else {
      cooked.innerHTML = post.cooked;
    }
    body.append(heading, cooked, this.createPostControls(post));
    const boosts = this.createBoosts(post);
    if (boosts) body.appendChild(boosts);
    article.append(avatar, body);
    return article;
  }

  private createPostControls(post: TopicPost): HTMLElement {
    const controls = createElement('nav', 'post-controls ldtk-post-controls');
    controls.setAttribute('aria-label', `${post.post_number} 楼操作`);
    const extraControls = createElement('div', 'ldtk-post-extra-controls');
    const actions = createElement('div', 'actions ldtk-post-actions');
    const like = post.actions_summary?.find((action) => action.id === 2);
    const likeCount = Math.max(0, post.reaction_users_count ?? like?.count ?? 0);
    const hasLiked = post.current_user_used_main_reaction ?? like?.acted === true;
    const currentReactionId = post.current_user_reaction?.id;
    const hasCustomReaction = Boolean(currentReactionId && !hasLiked);
    const hasReaction = hasLiked || Boolean(currentReactionId);
    const replyCount = Math.max(0, post.reply_count || 0);

    const addNativeAction = (
      container: HTMLElement,
      action: TopicAction,
      icon: string,
      label: string,
      className?: string,
      visibleLabel?: string,
    ): HTMLButtonElement => {
      const button = createPostMenuButton({ className, icon, label, visibleLabel });
      button.dataset.topicAction = action;
      button.dataset.postId = String(post.id);
      button.dataset.floor = String(post.post_number);
      container.appendChild(button);
      return button;
    };

    if (likeCount > 0) {
      const likeUsers = addNativeAction(
        extraControls,
        'likeUsers',
        'd-liked',
        `${likeCount} 个赞，查看点赞用户`,
        'post-action-menu__like-count like-count button-count highlight-action',
        String(likeCount),
      );
      likeUsers.setAttribute('aria-haspopup', 'dialog');
      likeUsers.setAttribute('aria-expanded', 'false');
    }

    if (replyCount > 0) {
      const replies = createPostMenuButton({
        className: 'post-action-menu__show-replies show-replies btn-icon-text button-count',
        icon: 'chevron-down',
        label: `展开 ${replyCount} 个回复`,
        visibleLabel: `${replyCount} 个回复`,
      });
      replies.dataset.toggleReplies = String(post.id);
      replies.dataset.floor = String(post.post_number);
      replies.setAttribute('aria-expanded', 'false');
      extraControls.appendChild(replies);
    }

    if (like && post.yours !== true) {
      const likeLabel = hasCustomReaction
        ? `取消 ${currentReactionId} 表态`
        : hasLiked
          ? '取消赞'
          : '赞';
      const stateClass = hasLiked ? 'has-like' : hasCustomReaction ? 'has-reaction' : 'like';
      const likeButton = addNativeAction(
        actions,
        'like',
        hasLiked ? 'd-liked' : 'd-unliked',
        likeLabel,
        `post-action-menu__like toggle-like btn-icon ${stateClass}`,
      );
      if (hasCustomReaction && currentReactionId) {
        const reactionImage = this.createCurrentReactionImage(post, currentReactionId);
        if (reactionImage) likeButton.replaceChildren(reactionImage);
      }
      likeButton.setAttribute('aria-pressed', String(hasReaction));
      likeButton.setAttribute('aria-haspopup', 'menu');
    }

    const copyLink = createPostMenuButton({
      className: 'post-action-menu__copy-link btn-icon',
      icon: 'link',
      label: '复制此楼链接',
    });
    copyLink.dataset.copyPostLink = String(post.post_number);
    actions.appendChild(copyLink);

    if (!post.deleted_at) {
      const bookmarkIcon = post.bookmark_reminder_at
        ? 'discourse-bookmark-clock'
        : post.bookmarked
          ? 'bookmark'
          : 'far-bookmark';
      const bookmark = addNativeAction(
        actions,
        'bookmark',
        bookmarkIcon,
        post.bookmarked ? '编辑书签' : '添加书签',
        `post-action-menu__bookmark btn-icon ${post.bookmarked ? 'bookmarked' : ''}`,
      );
      bookmark.setAttribute('aria-haspopup', 'menu');
      bookmark.setAttribute('aria-expanded', 'false');
      bookmark.setAttribute('aria-pressed', String(post.bookmarked === true));
    }

    if (post.can_boost === true && (post.boosts?.length || 0) === 0) {
      const boost = addNativeAction(
        actions,
        'boost',
        'rocket',
        '助推',
        'post-action-menu__boost boost btn-flat',
      );
      boost.setAttribute('aria-haspopup', 'menu');
      boost.setAttribute('aria-expanded', 'false');
    }

    const moreActions = createElement('span', 'ldtk-more-actions');
    moreActions.hidden = true;
    addNativeAction(
      moreActions,
      'share',
      'd-post-share',
      '分享',
      'post-action-menu__share btn-icon',
    );
    const canFlag = post.actions_summary?.some(
      (action) => action.id !== 2 && action.can_act === true,
    );
    if (canFlag)
      addNativeAction(moreActions, 'flag', 'flag', '举报', 'post-action-menu__flag btn-icon');
    if (post.can_edit)
      addNativeAction(moreActions, 'edit', 'pencil', '编辑', 'post-action-menu__edit btn-icon');
    if (post.can_delete)
      addNativeAction(
        moreActions,
        'delete',
        'trash-can',
        '删除',
        'post-action-menu__delete btn-icon',
      );
    if (post.can_recover)
      addNativeAction(
        moreActions,
        'recover',
        'rotate-left',
        '恢复',
        'post-action-menu__recover btn-icon',
      );
    actions.appendChild(moreActions);

    const showMore = createPostMenuButton({
      className: 'post-action-menu__show-more show-more-actions btn-icon',
      icon: 'ellipsis',
      label: '更多',
    });
    showMore.dataset.showMore = 'true';
    showMore.setAttribute('aria-expanded', 'false');
    actions.appendChild(showMore);

    if (this.source.topic.details?.can_create_post !== false) {
      addNativeAction(
        actions,
        'reply',
        'reply',
        `回复 ${post.username}`,
        'post-action-menu__reply reply btn-icon-text',
        '回复',
      );
    }

    controls.append(extraControls, actions);
    return controls;
  }

  private createBoosts(post: TopicPost): HTMLElement | null {
    const boosts = post.boosts || [];
    if (boosts.length === 0) return null;

    const postMenu = createElement('div', 'discourse-boosts__post-menu');
    const wrapper = createElement('div', 'discourse-boosts');
    const list = createElement('div', 'discourse-boosts__list');
    boosts.forEach((boost) => {
      const bubble = createElement('span', 'discourse-boosts__bubble');
      const user = boost.user;
      const avatarUrl = getAvatarUrl(user?.avatar_template);
      if (user && avatarUrl) {
        const profile = createElement('a');
        profile.href = `/u/${encodeURIComponent(user.username)}`;
        profile.dataset.userCard = user.username;
        profile.title = user.name || user.username;
        profile.setAttribute('aria-label', user.name || user.username);
        const avatar = createElement('img', 'avatar');
        avatar.src = avatarUrl;
        avatar.alt = '';
        avatar.width = 24;
        avatar.height = 24;
        avatar.loading = 'lazy';
        profile.appendChild(avatar);
        bubble.appendChild(profile);
      }
      const cooked = createElement('span', 'discourse-boosts__cooked');
      cooked.innerHTML = boost.cooked;
      bubble.appendChild(cooked);
      list.appendChild(bubble);
    });

    if (post.can_boost === true) {
      const addBoost = createPostMenuButton({
        className: 'discourse-boosts__add-btn btn-flat',
        icon: 'rocket',
        label: '助推',
      });
      addBoost.dataset.topicAction = 'boost';
      addBoost.dataset.postId = String(post.id);
      addBoost.dataset.floor = String(post.post_number);
      addBoost.setAttribute('aria-haspopup', 'menu');
      addBoost.setAttribute('aria-expanded', 'false');
      list.appendChild(addBoost);
    }

    wrapper.appendChild(list);
    postMenu.appendChild(wrapper);
    return postMenu;
  }

  private createReplySummaryContent(post: TopicPost): { element: HTMLElement; text: string } {
    const cooked = createElement('div');
    cooked.innerHTML = post.cooked;
    const content = createElement('span', 'ldtk-article-reply-content');
    const textParts: string[] = [];
    const blockTags = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'TR']);
    const appendText = (value: string): void => {
      content.appendChild(document.createTextNode(value));
      textParts.push(value);
    };
    const appendNode = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(node.textContent || '');
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node instanceof HTMLImageElement) {
        const alt = node.alt || node.title;
        const isEmoji = node.classList.contains('emoji') || /^:[^:]+:$/.test(alt);
        if (isEmoji && node.getAttribute('src')) {
          const emoji = createElement('img', 'emoji');
          emoji.src = node.getAttribute('src') || '';
          emoji.alt = alt;
          emoji.title = node.title;
          emoji.width = 18;
          emoji.height = 18;
          emoji.loading = 'lazy';
          content.appendChild(emoji);
          textParts.push(alt);
        } else if (alt) {
          appendText(alt);
        }
        return;
      }
      if (node instanceof HTMLBRElement) {
        appendText(' ');
        return;
      }
      Array.from(node.childNodes).forEach(appendNode);
      if (blockTags.has(node.tagName)) appendText(' ');
    };
    Array.from(cooked.childNodes).forEach(appendNode);
    const text = textParts.join('').replace(/\s+/g, ' ').trim();
    if (content.childNodes.length === 0) appendText(`查看 ${post.post_number} 楼回复`);
    return { element: content, text: text || `查看 ${post.post_number} 楼回复` };
  }

  private createArticleReplySummary(
    article: TopicPost,
    replies: readonly TopicPost[],
  ): HTMLElement | null {
    if (replies.length === 0) return null;

    const summary = createElement('div', 'ldtk-article-reply-summary');
    summary.dataset.articleReplySummary = String(article.id);
    summary.setAttribute('aria-label', '正文的直接回复');
    replies.slice(0, 8).forEach((reply) => {
      const replyContent = this.createReplySummaryContent(reply);
      const button = createButton(
        'ldtk-article-reply-chip',
        '',
        `跳转到 ${reply.username} 的 ${reply.post_number} 楼回复：${replyContent.text}`,
      );
      button.dataset.targetFloor = String(reply.post_number);
      const avatarUrl = getAvatarUrl(reply.avatar_template);
      if (avatarUrl) {
        const avatar = createElement('img', 'ldtk-article-reply-avatar');
        avatar.src = avatarUrl;
        avatar.alt = '';
        avatar.loading = 'lazy';
        button.appendChild(avatar);
      }
      button.appendChild(replyContent.element);
      summary.appendChild(button);
    });
    return summary;
  }

  private createTopicSummary(): HTMLElement | null {
    const topic = this.source.topic;
    const participants = topic.details?.participants || [];
    const linkCount = topic.details?.links?.length;
    const stats: Array<{ value: number; label: string }> = [];
    if (typeof topic.views === 'number') stats.push({ value: topic.views, label: '浏览量' });
    if (typeof topic.like_count === 'number') stats.push({ value: topic.like_count, label: '赞' });
    if (typeof linkCount === 'number') stats.push({ value: linkCount, label: '链接' });
    if (typeof topic.participant_count === 'number') {
      stats.push({ value: topic.participant_count, label: '用户' });
    }
    const readMinutes =
      typeof topic.word_count === 'number' && topic.word_count > 0
        ? Math.max(1, Math.ceil(topic.word_count / 200))
        : null;
    if (stats.length === 0 && participants.length === 0 && readMinutes === null) return null;

    const summary = createElement('section', 'ldtk-topic-summary');
    summary.setAttribute('aria-label', '主题信息');
    stats.forEach((stat) => {
      const item = createElement('span', 'ldtk-topic-stat');
      item.append(
        createElement('strong', '', formatCompactNumber(stat.value)),
        createElement('span', '', stat.label),
      );
      summary.appendChild(item);
    });

    if (participants.length > 0) {
      const people = createElement('span', 'ldtk-topic-participants');
      people.setAttribute('aria-label', '主要参与者');
      participants.slice(0, 8).forEach((participant) => {
        const avatarUrl = getAvatarUrl(participant.avatar_template);
        if (!avatarUrl) return;
        const profile = createElement('a');
        profile.href = `/u/${encodeURIComponent(participant.username)}`;
        profile.title = participant.name || participant.username;
        profile.setAttribute('aria-label', participant.name || participant.username);
        const avatar = createElement('img');
        avatar.src = avatarUrl;
        avatar.alt = '';
        avatar.loading = 'lazy';
        profile.appendChild(avatar);
        people.appendChild(profile);
      });
      if (people.childElementCount > 0) summary.appendChild(people);
    }

    if (readMinutes !== null) {
      const readTime = createElement('span', 'ldtk-topic-stat ldtk-topic-read-time');
      readTime.append(
        createElement('strong', '', `${formatCompactNumber(readMinutes)} 分钟`),
        createElement('span', '', '阅读时间'),
      );
      summary.appendChild(readTime);
    }
    return summary;
  }

  private createCurrentReactionImage(post: TopicPost, reactionId: string): HTMLImageElement | null {
    const nativePost = document.querySelector<HTMLElement>(
      `#main-outlet .topic-post[data-post-id="${post.id}"], ` +
        `#main-outlet .topic-post[data-post-number="${post.post_number}"]`,
    );
    const nativeImage = nativePost?.querySelector<HTMLImageElement>(
      '.discourse-reactions-reaction-button .btn-toggle-reaction-emoji',
    );
    const expectedAlts = new Set([`:${reactionId}`, `:${reactionId}:`]);
    let image: HTMLImageElement | null = null;
    if (nativeImage && (!nativeImage.alt || expectedAlts.has(nativeImage.alt))) {
      image = nativeImage.cloneNode(false) as HTMLImageElement;
    } else {
      const cached = this.reactionImages.get(post.id);
      if (cached?.id === reactionId && cached.url) {
        image = document.createElement('img');
        image.src = cached.url;
      }
    }
    if (!image) return null;
    image.className = 'btn-toggle-reaction-emoji reaction-button';
    image.alt = `:${reactionId}:`;
    image.setAttribute('aria-hidden', 'true');
    image.draggable = false;
    image.removeAttribute('style');
    image.removeAttribute('width');
    image.removeAttribute('height');
    return image;
  }

  private createInlineReply(post: TopicPost): HTMLElement {
    const reply = createElement('article', 'ldtk-inline-reply');
    reply.dataset.postId = String(post.id);
    reply.dataset.postNumber = String(post.post_number);
    const avatar = createElement('div', 'ldtk-inline-reply-avatar');
    const avatarUrl = getAvatarUrl(post.avatar_template);
    if (avatarUrl) {
      const image = createElement('img');
      image.src = avatarUrl;
      image.alt = '';
      image.width = 32;
      image.height = 32;
      image.loading = 'lazy';
      avatar.appendChild(image);
    }
    const body = createElement('div', 'ldtk-inline-reply-body');
    const heading = createElement('header', 'ldtk-inline-reply-heading');
    heading.appendChild(
      createElement('strong', '', post.display_username || post.name || post.username),
    );
    const floor = createButton(
      'ldtk-inline-reply-floor',
      `#${post.post_number} · ${formatDate(post.created_at)}`,
      `跳转到 ${post.post_number} 楼`,
    );
    floor.dataset.targetFloor = String(post.post_number);
    heading.appendChild(floor);
    const cooked = createElement('div', 'cooked');
    cooked.innerHTML = post.cooked;
    body.append(heading, cooked);
    reply.append(avatar, body);
    return reply;
  }

  private appendInlineReplies(panel: HTMLElement, parent: TopicPost, replies: TopicPost[]): void {
    panel.querySelector('.ldtk-inline-replies-status')?.remove();
    panel.querySelector('.ldtk-load-more-replies')?.remove();
    const existing = new Set(
      Array.from(panel.querySelectorAll<HTMLElement>('.ldtk-inline-reply')).map(
        (element) => element.dataset.postId,
      ),
    );
    replies.forEach((reply) => {
      if (!existing.has(String(reply.id))) panel.appendChild(this.createInlineReply(reply));
    });
    const loadedCount = panel.querySelectorAll('.ldtk-inline-reply').length;
    panel.dataset.loadedCount = String(loadedCount);
    const lastReply = Array.from(panel.querySelectorAll<HTMLElement>('.ldtk-inline-reply')).at(-1);
    if (lastReply?.dataset.postNumber) panel.dataset.after = lastReply.dataset.postNumber;
    if (loadedCount < Math.max(0, parent.reply_count || 0) && replies.length > 0) {
      const more = createButton('ldtk-load-more-replies', '加载更多回复');
      more.dataset.loadReplies = String(parent.id);
      panel.appendChild(more);
    }
  }

  private async loadInlineReplies(button: HTMLButtonElement, append: boolean): Promise<void> {
    const postId = Number(button.dataset.toggleReplies || button.dataset.loadReplies);
    const post = this.source.getCachedPost(postId);
    const postElement = this.root.querySelector<HTMLElement>(`[data-post-id="${postId}"]`);
    const controls = postElement?.querySelector<HTMLElement>('.ldtk-post-controls');
    if (!post || !postElement || !controls) return;

    let panel = postElement.querySelector<HTMLElement>('.ldtk-inline-replies');
    if (!panel) {
      panel = createElement('section', 'ldtk-inline-replies');
      panel.setAttribute('aria-label', `${post.post_number} 楼的回复`);
      panel.setAttribute('aria-live', 'polite');
      controls.insertAdjacentElement('afterend', panel);
    }
    if (!append)
      panel.replaceChildren(createElement('p', 'ldtk-inline-replies-status', '正在加载回复...'));
    else {
      button.disabled = true;
      button.textContent = '正在加载...';
    }

    this.replyAborts.get(postId)?.abort();
    const request = new AbortController();
    this.replyAborts.set(postId, request);
    try {
      const after = append ? Number(panel.dataset.after) || 1 : 1;
      const replies = await fetchPostReplies(postId, after, request.signal);
      if (this.destroyed || request.signal.aborted) return;
      this.appendInlineReplies(panel, post, replies);
      if (!append && replies.length === 0) {
        panel.appendChild(createElement('p', 'ldtk-inline-replies-status', '暂无可见回复'));
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      panel.replaceChildren(
        createElement('p', 'ldtk-inline-replies-status', '回复加载失败，请重试'),
      );
    } finally {
      if (this.replyAborts.get(postId) === request) this.replyAborts.delete(postId);
      button.disabled = false;
    }
  }

  private async loadArticleReplySummary(button: HTMLButtonElement): Promise<void> {
    const postId = Number(button.dataset.toggleReplies);
    if (postId !== this.source.article.id) return;
    this.replyAborts.get(postId)?.abort();
    const request = new AbortController();
    this.replyAborts.set(postId, request);
    button.disabled = true;
    try {
      const replies = await fetchPostReplies(postId, 1, request.signal);
      if (this.destroyed || request.signal.aborted) return;
      this.articleReplies = replies;
      const summary = this.createArticleReplySummary(this.source.article, replies);
      if (!summary) {
        showToast('暂无可见回复');
        return;
      }
      button.closest('.ldtk-post-controls')?.insertAdjacentElement('afterend', summary);
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-label', '收起回复');
      setButtonIcon(button, 'chevron-up');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') showToast('回复加载失败，请重试');
    } finally {
      if (this.replyAborts.get(postId) === request) this.replyAborts.delete(postId);
      button.disabled = false;
    }
  }

  private toggleInlineReplies(button: HTMLButtonElement): void {
    const postId = Number(button.dataset.toggleReplies);
    if (postId === this.source.article.id) {
      const summary = this.root.querySelector<HTMLElement>(
        `[data-article-reply-summary="${postId}"]`,
      );
      if (!summary) {
        void this.loadArticleReplySummary(button);
        return;
      }
      summary.hidden = !summary.hidden;
      const expanded = !summary.hidden;
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${expanded ? '收起' : '展开'}回复`);
      setButtonIcon(button, expanded ? 'chevron-up' : 'chevron-down');
      return;
    }
    const postElement = this.root.querySelector<HTMLElement>(`[data-post-id="${postId}"]`);
    const panel = postElement?.querySelector<HTMLElement>('.ldtk-inline-replies');
    if (!panel) {
      button.setAttribute('aria-expanded', 'true');
      setButtonIcon(button, 'chevron-up');
      void this.loadInlineReplies(button, false);
      return;
    }
    panel.hidden = !panel.hidden;
    const expanded = !panel.hidden;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${expanded ? '收起' : '展开'}回复`);
    setButtonIcon(button, expanded ? 'chevron-up' : 'chevron-down');
  }

  private requestPageAction(button: HTMLButtonElement): void {
    const action = button.dataset.topicAction as TopicAction | undefined;
    const postId = Number(button.dataset.postId);
    const floor = Number(button.dataset.floor);
    if (!action || !postId || !floor) return;
    const request: TopicActionRequest = {
      requestId: `${Date.now()}:${++actionRequestSequence}`,
      topicId: this.source.topic.id,
      postId,
      floor,
      action,
      routeUrl: this.buildActionRoute(floor),
    };
    const waitsForMenuClose = action === 'bookmark' || action === 'boost' || action === 'likeUsers';
    let triggered = false;
    const finish = (): void => {
      window.clearTimeout(timeout);
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.removeEventListener(TOPIC_ACTION_RESULT_NAME, handleResult);
    };
    const handleResult = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const result = parseTopicActionResult(event.detail);
      if (!result || result.requestId !== request.requestId) return;
      if (!result.ok) {
        finish();
        showToast(result.message || '操作失败，请重试');
        return;
      }
      triggered = true;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (waitsForMenuClose) {
        button.setAttribute('aria-expanded', String(result.phase === 'triggered'));
      }
      if (action === 'like' && result.phase === 'triggered') {
        finish();
        window.setTimeout(
          () => void this.updateVisiblePost({ topicId: request.topicId, postId, type: 'revised' }),
          700,
        );
      } else if (action === 'bookmark' && result.phase === 'settled') {
        finish();
        void this.updateVisiblePost({ topicId: request.topicId, postId, type: 'revised' });
      } else if (action === 'boost' && result.phase === 'settled') {
        finish();
        void this.updateVisiblePost({ topicId: request.topicId, postId, type: 'revised' });
      } else if (action === 'likeUsers' && result.phase === 'settled') {
        finish();
      } else if (!waitsForMenuClose) {
        finish();
      }
    };
    const timeout = window.setTimeout(
      () => {
        finish();
        if (!triggered) showToast('原站操作响应超时，请重试');
      },
      waitsForMenuClose ? 120_000 : 10_000,
    );
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (action === 'like') {
      button.classList.add('heart-animation');
      window.setTimeout(() => button.classList.remove('heart-animation'), 450);
    }
    button.addEventListener(TOPIC_ACTION_RESULT_NAME, handleResult);
    button.dispatchEvent(
      new CustomEvent(TOPIC_ACTION_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(request),
      }),
    );
  }

  private requestReactionPicker(button: HTMLButtonElement, open: boolean): void {
    const postId = Number(button.dataset.postId);
    const floor = Number(button.dataset.floor);
    if (!postId || !floor) return;
    const request: TopicReactionPickerRequest = {
      topicId: this.source.topic.id,
      postId,
      floor,
      open,
      routeUrl: this.buildActionRoute(floor),
    };
    button.dispatchEvent(
      new CustomEvent(TOPIC_REACTION_PICKER_REQUEST_NAME, {
        bubbles: true,
        detail: JSON.stringify(request),
      }),
    );
  }

  private getReactionButton(target: EventTarget | null): HTMLButtonElement | null {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>(
      '.post-action-menu__like[data-topic-action="like"]',
    );
    return button && this.root.contains(button) ? button : null;
  }

  private isWithinButton(button: HTMLButtonElement, target: EventTarget | null): boolean {
    return target instanceof Node && button.contains(target);
  }

  private readonly handleReactionPointerOver = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerType !== 'mouse') return;
    const button = this.getReactionButton(event.target);
    if (!button || this.isWithinButton(button, pointerEvent.relatedTarget)) return;
    this.requestReactionPicker(button, true);
  };

  private readonly handleReactionPointerOut = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerType !== 'mouse') return;
    const button = this.getReactionButton(event.target);
    if (!button || this.isWithinButton(button, pointerEvent.relatedTarget)) return;
    this.requestReactionPicker(button, false);
  };

  private readonly handleReactionFocusIn = (event: Event): void => {
    const button = this.getReactionButton(event.target);
    if (button) this.requestReactionPicker(button, true);
  };

  private readonly handleReactionFocusOut = (event: Event): void => {
    const focusEvent = event as FocusEvent;
    const button = this.getReactionButton(event.target);
    if (!button || this.isWithinButton(button, focusEvent.relatedTarget)) return;
    this.requestReactionPicker(button, false);
  };

  private buildActionRoute(floor: number): string {
    const url = new URL(buildNativeFloorUrl(floor));
    url.searchParams.set(COMMENTS_PAGE_PARAM, String(this.currentPage));
    return url.href;
  }

  private renderComments(posts: TopicPost[]): void {
    this.replyAborts.forEach((controller) => controller.abort());
    this.replyAborts.clear();
    this.status.hidden = true;
    if (posts.length === 0) {
      this.status.hidden = false;
      this.status.textContent = this.source.commentCount === 0 ? '暂无评论' : '本页评论不可见';
      this.commentsList.replaceChildren();
    } else {
      const fragment = document.createDocumentFragment();
      posts.forEach((post) => fragment.appendChild(this.createPost(post)));
      this.commentsList.replaceChildren(fragment);
    }
    this.renderPagination();
    this.readTracker?.disconnect();
    this.readTracker = new TopicReadTracker(this.source.topic.id, this.commentsPane);
    this.readTracker.observe(
      Array.from(this.commentsList.querySelectorAll<HTMLElement>('.topic-post')),
    );
    injectButtons(this.settings);
  }

  private renderPagination(): void {
    const fragment = document.createDocumentFragment();
    const previous = createButton('', '上一页');
    previous.disabled = this.currentPage <= 1;
    previous.dataset.page = String(this.currentPage - 1);
    fragment.appendChild(previous);
    buildPaginationItems(this.currentPage, this.pageCount).forEach((item) => {
      if (item === 'ellipsis') {
        fragment.appendChild(createElement('span', 'ldtk-pagination-ellipsis', '...'));
        return;
      }
      const page = createButton('', String(item), `第 ${item} 页`);
      page.dataset.page = String(item);
      if (item === this.currentPage) page.setAttribute('aria-current', 'page');
      fragment.appendChild(page);
    });
    const next = createButton('', '下一页');
    next.disabled = this.currentPage >= this.pageCount;
    next.dataset.page = String(this.currentPage + 1);
    fragment.appendChild(next);
    this.pagination.replaceChildren(fragment);
  }

  private async loadPage(
    page: number,
    updateHistory: boolean,
    targetFloor?: number,
  ): Promise<void> {
    const nextPage = clampPage(page, this.pageCount);
    if (nextPage === this.currentPage && targetFloor === undefined) return;
    this.pageAbort?.abort();
    const request = new AbortController();
    this.pageAbort = request;
    this.readTracker?.flush();
    this.status.hidden = false;
    this.status.textContent = '正在加载评论...';
    this.refreshButton.disabled = true;
    Array.from(this.pagination.querySelectorAll('button')).forEach((button) => {
      button.disabled = true;
    });
    try {
      const posts = await this.source.loadPage(
        nextPage,
        this.settings.commentsPerPage,
        request.signal,
      );
      if (this.destroyed || request.signal.aborted || this.pageAbort !== request) return;
      this.currentPage = nextPage;
      this.renderComments(posts);
      this.commentsPane.scrollTop = 0;
      this.saveState();
      if (updateHistory) {
        const url = updatePageUrl(new URL(window.location.href), nextPage);
        window.history.pushState(window.history.state, '', url);
      }
      if (targetFloor) this.highlightFloor(targetFloor);
    } catch (error) {
      if ((error as Error).name === 'AbortError' || this.pageAbort !== request) return;
      this.status.hidden = false;
      this.status.textContent = '评论加载失败，请重试';
      this.renderPagination();
    } finally {
      if (this.pageAbort === request) this.refreshButton.disabled = false;
    }
  }

  private async goToFloor(floor: number, updateHistory: boolean): Promise<void> {
    if (floor <= 1) {
      this.articleScroll.scrollTo({ top: 0, behavior: 'smooth' });
      const article = this.articlePane.querySelector<HTMLElement>('.topic-post');
      if (article) addHighlight(article);
      return;
    }
    const page = getCommentPageForFloor(floor, this.settings.commentsPerPage);
    if (page === this.currentPage) this.highlightFloor(floor);
    else await this.loadPage(page, updateHistory, floor);
  }

  private highlightFloor(floor: number): void {
    const post = this.commentsList.querySelector<HTMLElement>(`[data-post-number="${floor}"]`);
    post?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (post) addHighlight(post);
  }

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const pageButton = target.closest<HTMLButtonElement>('[data-page]');
    if (pageButton && this.pagination.contains(pageButton)) {
      event.preventDefault();
      void this.loadPage(Number(pageButton.dataset.page), true);
      return;
    }
    const repliesButton = target.closest<HTMLButtonElement>('[data-toggle-replies]');
    if (repliesButton) {
      event.preventDefault();
      this.toggleInlineReplies(repliesButton);
      return;
    }
    const loadRepliesButton = target.closest<HTMLButtonElement>('[data-load-replies]');
    if (loadRepliesButton) {
      event.preventDefault();
      void this.loadInlineReplies(loadRepliesButton, true);
      return;
    }
    const showMoreButton = target.closest<HTMLButtonElement>('[data-show-more]');
    if (showMoreButton) {
      event.preventDefault();
      const actions = showMoreButton.closest('.ldtk-post-actions');
      const moreActions = actions?.querySelector<HTMLElement>('.ldtk-more-actions');
      if (moreActions) {
        moreActions.hidden = false;
        showMoreButton.hidden = true;
        showMoreButton.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    const copyLinkButton = target.closest<HTMLButtonElement>('[data-copy-post-link]');
    if (copyLinkButton) {
      event.preventDefault();
      const floor = Number(copyLinkButton.dataset.copyPostLink);
      copyLinkButton.disabled = true;
      void copyToClipboard(buildNativeFloorUrl(floor))
        .then(() => showToast('已复制此楼链接'))
        .catch(() => showToast('复制链接失败，请重试'))
        .finally(() => {
          copyLinkButton.disabled = false;
        });
      return;
    }
    const actionButton = target.closest<HTMLButtonElement>('[data-topic-action][data-floor]');
    if (actionButton) {
      event.preventDefault();
      this.requestPageAction(actionButton);
      return;
    }
    const targetButton = target.closest<HTMLButtonElement>('[data-target-floor]');
    if (targetButton) {
      event.preventDefault();
      void this.goToFloor(Number(targetButton.dataset.targetFloor), true);
      return;
    }

    const complexEmbed = target.closest('.poll, [data-poll-name], iframe, .lazyYT-container');
    if (complexEmbed) {
      const post = target.closest<HTMLElement>('[data-post-number]');
      if (post) {
        event.preventDefault();
        this.callbacks.handoffNative(Number(post.dataset.postNumber));
      }
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    const route = parseTopicRoute(url.pathname);
    const hashFloor = url.hash.match(/^#post[_-](\d+)$/)?.[1];
    const floor = route?.floor || (hashFloor ? Number(hashFloor) : undefined);
    if (route?.topicId === this.route.topicId && floor) {
      event.preventDefault();
      void this.goToFloor(floor, true);
    }
  };

  private readonly handlePopState = (): void => {
    const route = parseTopicRoute(window.location.pathname);
    if (route?.topicId !== this.route.topicId) return;
    const urlPage = Number(new URL(window.location.href).searchParams.get(COMMENTS_PAGE_PARAM));
    const page =
      urlPage > 0
        ? urlPage
        : route.floor
          ? getCommentPageForFloor(route.floor, this.settings.commentsPerPage)
          : 1;
    void this.loadPage(page, false);
  };

  private readonly handlePageHide = (): void => {
    this.saveState();
    this.readTracker?.flush(true);
  };

  private readonly handleTopicEvent = (event: CustomEvent<unknown>): void => {
    const detail = parseTopicEventDetail(event.detail);
    if (!detail || detail.topicId !== this.source.topic.id) return;
    if (detail.type === 'created') {
      this.newReplyCount += 1;
      this.newRepliesButton.textContent = `有 ${this.newReplyCount} 条新回复，点击刷新`;
      this.newRepliesButton.dataset.visible = 'true';
      return;
    }
    if (detail.type === 'acted' && detail.currentReactionId !== undefined) {
      if (detail.currentReactionId) {
        this.reactionImages.set(detail.postId, {
          id: detail.currentReactionId,
          ...(detail.currentReactionUrl ? { url: detail.currentReactionUrl } : {}),
        });
      } else {
        this.reactionImages.delete(detail.postId);
      }
    }
    void this.updateVisiblePost(detail);
  };

  private async updateVisiblePost(detail: TopicEventDetail): Promise<void> {
    const eventVersion = (this.eventVersions.get(detail.postId) || 0) + 1;
    this.eventVersions.set(detail.postId, eventVersion);
    const current = this.root.querySelector<HTMLElement>(`[data-post-id="${detail.postId}"]`);
    if (!current) {
      this.source.invalidatePost(detail.postId);
      return;
    }
    if (detail.type === 'destroyed') {
      const placeholder = createElement(
        'article',
        'topic-post ldtk-reading-post ldtk-destroyed-post',
      );
      placeholder.dataset.postId = String(detail.postId);
      placeholder.dataset.postNumber = current.dataset.postNumber || '';
      placeholder.appendChild(createElement('p', 'ldtk-deleted-placeholder', '此回复已被删除'));
      current.replaceWith(placeholder);
      this.source.invalidatePost(detail.postId);
      return;
    }
    try {
      const post = await this.source.refreshPost(detail.postId);
      if (!post || this.destroyed || this.eventVersions.get(detail.postId) !== eventVersion) {
        return;
      }
      const replacement = post.post_number === 1 ? null : this.createPost(post);
      if (replacement) {
        current.replaceWith(replacement);
        injectButtons(this.settings);
      } else {
        this.renderArticle();
        injectButtons(this.settings);
      }
    } catch {
      // Manual refresh remains available if a live update cannot be fetched.
    }
  }

  private readonly scheduleSave = (): void => {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveState(), 150);
  };

  private saveState(): void {
    writeTopicState(this.route.topicId, {
      page: this.currentPage,
      leftScrollTop: this.articleScroll.scrollTop,
      rightScrollTop: this.commentsPane.scrollTop,
      nativeMode: false,
    });
  }
}

let activeLayout: TopicLayout | null = null;
let loadingKey: string | null = null;
let loadingAbort: AbortController | null = null;
let refreshVersion = 0;
let latestSettings: DiscourseSettings | null = null;

function cleanupLayout(): void {
  refreshVersion += 1;
  loadingAbort?.abort();
  loadingAbort = null;
  loadingKey = null;
  activeLayout?.destroy();
  activeLayout = null;
  document.documentElement.classList.remove(ACTIVE_CLASS);
  document.querySelector(`.${ROOT_CLASS}`)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  clearPendingTopicLayout();
}

function handoffToNative(
  route: TopicRoute,
  settings: DiscourseSettings,
  floor: number,
  action?: PendingNativeAction['action'],
): void {
  const previous = readTopicState(route.topicId) || {
    page: getCommentPageForFloor(floor, settings.commentsPerPage),
    leftScrollTop: 0,
    rightScrollTop: 0,
  };
  activeLayout?.destroy();
  activeLayout = null;
  const state: TopicReadingState = {
    ...previous,
    nativeMode: true,
    pendingAction: action ? { floor, action } : undefined,
  };
  writeTopicState(route.topicId, state);
  nativeAttemptKey = null;
  ensureNativeMode({ route, settings, state });
  const post = getNativePost(floor);
  if (post && !action) {
    post.scrollIntoView({ block: 'center' });
    addHighlight(post);
  } else if (!post && route.floor !== floor) {
    window.location.assign(buildNativeFloorUrl(floor));
  }
}

export async function refreshTopicLayout(
  settings: DiscourseSettings,
  force = false,
): Promise<void> {
  latestSettings = settings;
  const route = parseTopicRoute(window.location.pathname);
  if (!settings.enableSplitReading || window.innerWidth < MIN_VIEWPORT_WIDTH || !route) {
    cleanupLayout();
    removeReturnButton();
    nativeAttemptKey = null;
    return;
  }

  const state = readTopicState(route.topicId);
  if (state?.nativeMode && !force) {
    cleanupLayout();
    ensureNativeMode({ route, settings, state });
    return;
  }
  if (force && state?.nativeMode) {
    writeTopicState(route.topicId, { ...state, nativeMode: false, pendingAction: undefined });
  }

  const key = `${route.topicId}:${settings.commentsPerPage}`;
  if (!force && activeLayout?.matches(route, settings)) {
    activeLayout.updateHeaderOffset();
    return;
  }
  if (!force && loadingKey === key) return;

  const retainedLayout = force && activeLayout?.matches(route, settings) ? activeLayout : null;
  if (!retainedLayout) {
    prepareTopicLayout(settings);
    activeLayout?.destroy();
    activeLayout = null;
  }
  loadingAbort?.abort();
  const version = ++refreshVersion;
  loadingKey = key;
  const request = new AbortController();
  loadingAbort = request;
  let candidate: TopicLayout | null = null;
  try {
    const source = await TopicDataSource.create(route.topicId, request.signal, route.floor);
    if (version !== refreshVersion) return;
    if (source.isMegaTopic) {
      if (retainedLayout) {
        showToast('主题内容过多，已保留当前双栏内容');
      } else {
        cleanupLayout();
      }
      return;
    }
    const pageCount = getPageCount(source.commentCount, settings.commentsPerPage);
    const session = readTopicState(route.topicId);
    const initialPage = deriveInitialPage({
      url: new URL(window.location.href),
      routeFloor: route.floor,
      sessionPage: session?.page,
      lastReadPostNumber: source.topic.last_read_post_number,
      perPage: settings.commentsPerPage,
      pageCount,
    });
    const articleRepliesRequest =
      (source.article.reply_count || 0) > 0
        ? fetchPostReplies(source.article.id, 1, request.signal).catch((error: unknown) => {
            if ((error as Error).name === 'AbortError') throw error;
            return [];
          })
        : Promise.resolve([]);
    const [posts, articleReplies] = await Promise.all([
      source.loadPage(initialPage, settings.commentsPerPage, request.signal),
      articleRepliesRequest,
    ]);
    if (version !== refreshVersion) return;
    retainedLayout?.persistState();
    candidate = new TopicLayout(route, source, settings, initialPage, {
      requestRefresh: () => {
        const currentSettings = latestSettings;
        if (currentSettings) void refreshTopicLayout(currentSettings, true);
      },
      handoffNative: (floor, action) => handoffToNative(route, settings, floor, action),
    });
    candidate.mount(posts, articleReplies);
    if (version !== refreshVersion) {
      candidate.destroy(false, Boolean(retainedLayout));
      return;
    }
    retainedLayout?.destroy(false, true);
    activeLayout = candidate;
    candidate = null;
  } catch (error) {
    candidate?.destroy(false, Boolean(retainedLayout));
    if ((error as Error).name === 'AbortError') return;
    if (retainedLayout && activeLayout === retainedLayout) {
      console.warn('[Linux.do 工具箱] 双栏阅读刷新失败，已保留当前双栏内容', error);
      showToast('刷新失败，已保留当前双栏内容');
    } else {
      console.warn('[Linux.do 工具箱] 双栏阅读加载失败，已恢复原页面', error);
      cleanupLayout();
    }
  } finally {
    if (version === refreshVersion) {
      loadingKey = null;
      loadingAbort = null;
    }
  }
}

export const topicLayoutOwnedSelectors = [
  `.${ROOT_CLASS}`,
  `#${STYLE_ID}`,
  `#${PENDING_STYLE_ID}`,
  `#${RETURN_BUTTON_ID}`,
] as const;
