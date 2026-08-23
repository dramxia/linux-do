/* Linux.do 工具箱 - 主题正文/评论双栏阅读模式 */
import type { DiscourseSettings } from '../common/settings';
import { isSameTopicRoute, parseTopicRoute, type TopicRoute } from '../common/topic-route';
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
  captureTopicPageContext,
  isTopicPageContextCurrent,
  type TopicPageContext,
} from './topic-page-context';
import {
  buildPaginationItems,
  clampPage,
  COMMENTS_PAGE_PARAM,
  deriveInitialPage,
  getCommentPageForFloor,
  getPageCount,
  readTopicState,
  updatePageUrl,
  writeTopicState,
  type PendingNativeAction,
  type TopicReadingState,
} from './topic-state';

const ROOT_CLASS = 'ldtk-topic-reading-root';
const ACTIVE_CLASS = 'ldtk-split-reading-active';
const PENDING_CLASS = 'ldtk-split-reading-pending';
const STYLE_ID = 'ldtk-topic-reading-style';
const LOADING_STYLE_ID = 'ldtk-topic-reading-loading-style';
const LOADING_ROOT_ID = 'ldtk-topic-reading-loading';
const RETURN_BUTTON_ID = 'ldtk-native-return';
const MIN_VIEWPORT_WIDTH = 1280;
const SHELL_OFFSET_EPSILON = 0.2;
const ARTICLE_FOOTER_DEFAULT_HEIGHT = 130;
const ARTICLE_FOOTER_MIN_HEIGHT = 64;
const ARTICLE_FOOTER_MAX_RATIO = 0.5;
const ARTICLE_CONTENT_MIN_HEIGHT = 160;
const ARTICLE_FOOTER_KEYBOARD_STEP = 16;
let nativeAttemptKey: string | null = null;
let actionRequestSequence = 0;
let loadingOverlayVersion = 0;
let loadingOverlayHideTimer: number | null = null;

const NATIVE_ACTION_SELECTORS: Record<PendingNativeAction['action'], string> = {
  like: '.post-action-menu__like, button[title*="赞"], button[aria-label*="赞"]',
  reply: '.post-action-menu__reply, button[title*="回复"], button[aria-label*="回复"]',
  bookmark: '.post-action-menu__bookmark, button[title*="书签"], button[aria-label*="书签"]',
  more: '.post-action-menu__more, button[title*="更多"], button[aria-label*="更多"]',
  edit: '.post-action-menu__edit, button[title*="编辑"], button[aria-label*="编辑"]',
  delete: '.post-action-menu__delete, button[title*="删除"], button[aria-label*="删除"]',
  recover: '.post-action-menu__recover, button[title*="恢复"], button[aria-label*="恢复"]',
};

const LAYOUT_STYLE = `
html.${ACTIVE_CLASS} {
  --d-sidebar-animation-time: 0ms;
}
html.${ACTIVE_CLASS} #main-outlet .ldtk-shadow-host {
  visibility: hidden !important;
  pointer-events: none !important;
}
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
html.${ACTIVE_CLASS} #main-outlet .discourse-boosts__input-container {
  z-index: 410 !important;
}
html.${ACTIVE_CLASS} #reply-control {
  z-index: 400 !important;
}
html.${ACTIVE_CLASS} #reply-control.open {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
html.${ACTIVE_CLASS} .sidebar-wrapper { transition: none !important; }
html.${ACTIVE_CLASS} .sidebar-wrapper.ldtk-sidebar-center-target {
  translate: calc(0px - var(--ldtk-sidebar-center-shift, 0px)) 0;
}
.${ROOT_CLASS} {
  position: fixed;
  inset:
    var(--ldtk-header-height, 60px) var(--ldtk-sidebar-end-inset, 0px) 0
    var(--ldtk-sidebar-start-inset, 0px);
  z-index: 90;
  --ldtk-background: var(--secondary, #fff);
  --ldtk-foreground: var(--primary, #18181b);
  --ldtk-muted: var(--primary-very-low, #f4f4f5);
  --ldtk-muted-foreground: var(--primary-medium, #71717a);
  --ldtk-border: var(--primary-low, #e4e4e7);
  --ldtk-accent: var(--primary-very-low, #f4f4f5);
  --ldtk-accent-foreground: var(--primary, #18181b);
  --ldtk-ring: var(--tertiary, #0f766e);
  --ldtk-brand: var(--tertiary, #0f766e);
  --ldtk-radius: 10px;
  box-sizing: border-box;
  contain: layout paint;
  overflow: hidden;
  color: var(--ldtk-foreground);
  background: var(--ldtk-muted);
  font-family: var(--font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif);
  letter-spacing: 0;
}
.${ROOT_CLASS} *, .${ROOT_CLASS} *::before, .${ROOT_CLASS} *::after {
  box-sizing: border-box;
}
.ldtk-reading-grid {
  width: min(100%, 1880px);
  height: 100%;
  margin: 0 auto;
  padding: 10px;
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(420px, 2fr);
  gap: 10px;
}
.ldtk-reading-pane {
  min-width: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--ldtk-background);
  border: 1px solid var(--ldtk-border);
  border-radius: var(--ldtk-radius);
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 5%);
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
  padding: 28px clamp(24px, 3.5vw, 56px) 36px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.ldtk-article-header {
  max-width: 760px;
  margin: 0 auto 22px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--ldtk-border);
}
.ldtk-article-header h1 {
  margin: 0 0 14px;
  color: var(--ldtk-foreground);
  font-size: 27px;
  line-height: 1.25;
  font-weight: 700;
  overflow-wrap: anywhere;
  letter-spacing: 0;
  text-wrap: balance;
}
.ldtk-article-byline {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ldtk-article-byline-avatar {
  display: block;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 1px solid var(--ldtk-border);
  border-radius: 50%;
  background: var(--ldtk-muted);
  object-fit: cover;
}
.ldtk-article-byline-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.ldtk-article-byline strong {
  color: var(--ldtk-foreground);
  font-size: 13px;
  line-height: 1.35;
  font-weight: 600;
}
.ldtk-article-byline time,
.ldtk-comment-status,
.ldtk-post-meta {
  color: var(--ldtk-muted-foreground);
}
.ldtk-article-content {
  max-width: 760px;
  margin: 0 auto;
}
.ldtk-article-footer {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  width: 100%;
  max-height: min(21vh, 130px);
  padding: 0 clamp(24px, 3.5vw, 56px) 8px;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
  border-top: 1px solid var(--ldtk-border);
  box-shadow: 0 -6px 18px rgb(0 0 0 / 5%);
  scrollbar-gutter: stable;
}
.ldtk-article-footer > * {
  max-width: 760px;
  margin-right: auto;
  margin-left: auto;
}
.ldtk-article-footer-resizer {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 24px;
  border: 0;
  background: var(--ldtk-background);
  cursor: row-resize;
  touch-action: none;
}
.ldtk-article-footer-resizer::before {
  width: 48px;
  height: 3px;
  border-radius: 999px;
  background: var(--ldtk-border);
  content: "";
  transition: background-color 120ms ease;
}
.ldtk-article-footer-resizer:hover::before,
.ldtk-article-footer-resizer:focus-visible::before,
.ldtk-article-footer-resizer[data-dragging="true"]::before {
  background: var(--ldtk-ring);
}
.ldtk-article-footer-resizer:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: -2px;
}
.ldtk-article-footer-resizer + .ldtk-post-controls {
  margin-top: 2px;
}
.ldtk-article-pane[data-resizing-footer="true"],
.ldtk-article-pane[data-resizing-footer="true"] * {
  cursor: row-resize !important;
  user-select: none !important;
}
.ldtk-article-reply-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 38px;
  padding: 8px 0;
  border-top: 1px solid var(--ldtk-border);
}
.ldtk-article-reply-summary[hidden] {
  display: none;
}
.ldtk-article-reply-chip {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  min-height: 32px;
  max-width: min(100%, 360px);
  padding: 4px 9px 4px 4px;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  color: var(--ldtk-muted-foreground);
  background: var(--ldtk-background);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    color 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease,
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ldtk-article-reply-chip:hover {
  color: var(--ldtk-accent-foreground);
  background: var(--ldtk-accent);
}
.ldtk-article-reply-chip:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
}
.ldtk-article-reply-chip:active:not(:disabled) {
  transform: scale(0.98);
}
.ldtk-article-reply-avatar {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
}
.ldtk-article-reply-content {
  display: -webkit-box;
  min-width: 0;
  padding-top: 2px;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.45;
  text-align: left;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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
  gap: 10px 20px;
  min-height: 56px;
  padding: 10px 0;
  border-top: 1px solid var(--ldtk-border);
  border-bottom: 1px solid var(--ldtk-border);
}
.ldtk-topic-stat {
  display: grid;
  gap: 2px;
  min-width: 52px;
  color: var(--ldtk-muted-foreground);
  font-size: 12px;
  line-height: 1.2;
}
.ldtk-topic-stat strong {
  color: var(--ldtk-foreground);
  font-size: 16px;
  font-weight: 650;
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
  width: 26px;
  height: 26px;
  border: 2px solid var(--ldtk-background);
  border-radius: 50%;
  background: var(--ldtk-muted);
}
.ldtk-topic-read-time {
  margin-left: auto;
  text-align: right;
}
.ldtk-topic-read-time strong {
  color: var(--ldtk-foreground);
}
.ldtk-comments-pane {
  position: relative;
  background: var(--ldtk-background);
}
.ldtk-comments-toolbar {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 6px 10px 6px 14px;
  background: var(--ldtk-background);
  border-bottom: 1px solid var(--ldtk-border);
}
.ldtk-comments-toolbar h2 {
  margin: 0 auto 0 0;
  font-size: 13px;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: 0;
}
.ldtk-toolbar-button,
.ldtk-pagination button,
.ldtk-reply-target {
  min-width: 30px;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    color 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease,
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ldtk-toolbar-button:hover,
.ldtk-pagination button:hover,
.ldtk-reply-target:hover {
  background: var(--ldtk-accent);
}
.ldtk-toolbar-button:focus-visible,
.ldtk-pagination button:focus-visible,
.ldtk-reply-target:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
}
.ldtk-toolbar-button:disabled,
.ldtk-pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.ldtk-toolbar-button:active:not(:disabled),
.ldtk-pagination button:active:not(:disabled),
.ldtk-reply-target:active:not(:disabled) {
  transform: scale(0.97);
}
.ldtk-toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  margin: 0;
  padding: 0;
  line-height: 0;
  vertical-align: middle;
}
.ldtk-toolbar-button .d-icon {
  position: static;
  flex: 0 0 15px;
  width: 15px;
  height: 15px;
  margin: 0;
  display: block;
}
.ldtk-toolbar-button[aria-busy="true"] .d-icon {
  animation: ldtk-refresh-spin 700ms linear infinite;
}
.ldtk-new-replies {
  display: none;
  width: calc(100% - 24px);
  margin: 8px 12px 0;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  color: var(--ldtk-brand);
  background: var(--ldtk-muted);
  font: inherit;
  cursor: pointer;
  transition:
    color 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease,
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ldtk-new-replies:hover { background: var(--ldtk-accent); }
.ldtk-new-replies:active:not(:disabled) { transform: scale(0.99); }
.ldtk-new-replies:disabled { cursor: wait; opacity: 0.5; }
.ldtk-new-replies[data-visible="true"] { display: block; }
.ldtk-comments-list {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 0 14px;
}
.${ROOT_CLASS} .topic-post {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--ldtk-border);
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
  width: 34px;
  height: 34px;
  border: 1px solid var(--ldtk-border);
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
  margin-bottom: 7px;
}
.${ROOT_CLASS} .names .username {
  color: var(--ldtk-foreground);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.ldtk-post-meta {
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
}
.ldtk-reply-target {
  min-height: 22px;
  padding: 3px 6px;
  border-color: var(--ldtk-border);
  color: var(--ldtk-muted-foreground);
  background: var(--ldtk-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
  text-align: left;
}
.ldtk-reply-target:hover {
  border-color: var(--ldtk-muted-foreground);
  color: var(--ldtk-foreground);
  background: var(--ldtk-accent);
}
.${ROOT_CLASS} .cooked {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  overflow-wrap: anywhere;
  color: var(--ldtk-foreground);
  font-size: 14px;
  line-height: 1.65;
}
.${ROOT_CLASS} .ldtk-article-content .cooked {
  font-size: 15px;
  line-height: 1.75;
}
.${ROOT_CLASS} .cooked > :first-child {
  margin-top: 0;
}
.${ROOT_CLASS} .cooked > :last-child {
  margin-bottom: 0;
}
.${ROOT_CLASS} .cooked p,
.${ROOT_CLASS} .cooked ul,
.${ROOT_CLASS} .cooked ol,
.${ROOT_CLASS} .cooked blockquote,
.${ROOT_CLASS} .cooked pre,
.${ROOT_CLASS} .cooked table,
.${ROOT_CLASS} .cooked .onebox {
  margin-top: 0;
  margin-bottom: 0.9em;
}
.${ROOT_CLASS} .cooked h1,
.${ROOT_CLASS} .cooked h2,
.${ROOT_CLASS} .cooked h3,
.${ROOT_CLASS} .cooked h4,
.${ROOT_CLASS} .cooked h5,
.${ROOT_CLASS} .cooked h6 {
  margin: 1.4em 0 0.6em;
  color: var(--ldtk-foreground);
  line-height: 1.35;
  font-weight: 650;
  letter-spacing: 0;
}
.${ROOT_CLASS} .cooked h1 { font-size: 1.65em; }
.${ROOT_CLASS} .cooked h2 { font-size: 1.4em; }
.${ROOT_CLASS} .cooked h3 { font-size: 1.2em; }
.${ROOT_CLASS} .cooked h4 { font-size: 1.05em; }
.${ROOT_CLASS} .cooked h5,
.${ROOT_CLASS} .cooked h6 { font-size: 1em; }
.${ROOT_CLASS} .cooked a {
  color: var(--ldtk-brand);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
.${ROOT_CLASS} .cooked blockquote {
  padding: 8px 12px;
  border-left: 3px solid var(--ldtk-border);
  color: var(--ldtk-muted-foreground);
  background: var(--ldtk-muted);
}
.${ROOT_CLASS} .cooked blockquote > :last-child {
  margin-bottom: 0;
}
.${ROOT_CLASS} .cooked ul,
.${ROOT_CLASS} .cooked ol {
  padding-left: 1.5em;
}
.${ROOT_CLASS} .cooked li + li {
  margin-top: 0.35em;
}
.${ROOT_CLASS} .cooked li > ul,
.${ROOT_CLASS} .cooked li > ol {
  margin-top: 0.35em;
  margin-bottom: 0;
}
.${ROOT_CLASS} .cooked code:not(pre code) {
  padding: 0.15em 0.35em;
  border: 1px solid var(--ldtk-border);
  border-radius: 4px;
  background: var(--ldtk-muted);
  font-size: 0.88em;
}
.${ROOT_CLASS} .cooked hr {
  margin: 2em 0;
  border: 0;
  border-top: 1px solid var(--ldtk-border);
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
  padding: 12px;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  background: var(--ldtk-muted);
  white-space: pre;
}
.${ROOT_CLASS} .cooked pre code {
  font-size: 13px;
  line-height: 1.65;
}
.${ROOT_CLASS} .cooked table {
  display: block;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  border-spacing: 0;
}
.${ROOT_CLASS} .cooked th,
.${ROOT_CLASS} .cooked td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--ldtk-border);
  text-align: left;
  vertical-align: top;
}
.${ROOT_CLASS} .cooked th {
  background: var(--ldtk-muted);
  font-size: 0.92em;
  font-weight: 600;
}
.${ROOT_CLASS} .cooked tr:last-child td {
  border-bottom: 0;
}
.${ROOT_CLASS} .cooked th + th,
.${ROOT_CLASS} .cooked td + td {
  border-left: 1px solid var(--ldtk-border);
}
.${ROOT_CLASS} .cooked figure {
  margin: 1.5em 0;
}
.${ROOT_CLASS} .cooked figcaption {
  margin-top: 8px;
  color: var(--ldtk-muted-foreground);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}
.${ROOT_CLASS} .cooked details {
  margin: 0.9em 0;
  padding: 9px 12px;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  background: var(--ldtk-muted);
}
.${ROOT_CLASS} .cooked summary {
  color: var(--ldtk-foreground);
  font-weight: 600;
  cursor: pointer;
}
.${ROOT_CLASS} .cooked details[open] summary {
  margin-bottom: 8px;
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
  border-radius: calc(var(--ldtk-radius) - 2px);
}
.ldtk-post-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 32px;
  margin-top: 10px;
  color: var(--ldtk-muted-foreground);
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
  gap: 5px;
  min-width: 30px;
  min-height: 30px;
  padding: 6px;
  border: 0;
  border-radius: calc(var(--ldtk-radius) - 2px);
  color: var(--ldtk-muted-foreground);
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition:
    color 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease,
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.ldtk-post-menu-button:hover {
  color: var(--ldtk-accent-foreground);
  background: var(--ldtk-accent);
}
.ldtk-post-menu-button:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
}
.ldtk-post-menu-button:active:not(:disabled) {
  transform: scale(0.97);
}
.ldtk-post-menu-button:disabled,
.ldtk-post-menu-button[aria-busy="true"] {
  cursor: wait;
  opacity: 0.5;
}
.ldtk-post-menu-button .d-icon {
  width: 15px;
  height: 15px;
  display: block;
  pointer-events: none;
}
.ldtk-post-menu-button .btn-toggle-reaction-emoji {
  display: block;
  width: 16px;
  height: 16px;
  object-fit: contain;
  pointer-events: none;
}
.ldtk-post-menu-button.button-count {
  gap: 5px;
  color: var(--ldtk-muted-foreground);
  font-variant-numeric: tabular-nums;
}
.ldtk-post-menu-button.like-count .d-icon,
.ldtk-post-menu-button[aria-pressed="true"].post-action-menu__like {
  color: var(--love, #fa6c8d);
}
.ldtk-post-menu-button.bookmarked {
  color: var(--ldtk-brand);
}
.ldtk-post-menu-button.post-action-menu__reply {
  padding-inline: 9px;
  color: var(--ldtk-foreground);
  border: 1px solid var(--ldtk-border);
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
  border: 1px solid var(--ldtk-border);
  border-radius: 999px;
  color: var(--ldtk-foreground);
  background: var(--ldtk-muted);
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
  color: var(--ldtk-muted-foreground);
}
.${ROOT_CLASS} .discourse-boosts__add-btn:hover {
  color: var(--ldtk-foreground);
}
.ldtk-inline-replies {
  margin-top: 8px;
  padding-left: 10px;
  border-top: 1px solid var(--ldtk-border);
  border-left: 2px solid var(--ldtk-border);
}
.ldtk-inline-replies[hidden] {
  display: none;
}
.ldtk-inline-reply {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ldtk-border);
}
.ldtk-inline-reply-avatar img {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 50%;
}
.ldtk-inline-reply-body {
  min-width: 0;
}
.ldtk-inline-reply-heading {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}
.ldtk-inline-reply-heading strong {
  color: var(--ldtk-foreground);
  font-size: 12px;
}
.ldtk-inline-reply-floor {
  margin-left: auto;
  padding: 2px 0;
  border: 0;
  color: var(--ldtk-muted-foreground);
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ldtk-inline-reply .cooked {
  font-size: 13px;
}
.ldtk-inline-replies-status,
.ldtk-load-more-replies {
  width: 100%;
  padding: 8px;
  border: 0;
  color: var(--ldtk-muted-foreground);
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: center;
}
.ldtk-load-more-replies {
  cursor: pointer;
}
.ldtk-load-more-replies:hover {
  color: var(--ldtk-brand);
  background: var(--ldtk-accent);
}
.ldtk-deleted-placeholder {
  color: var(--ldtk-muted-foreground);
  font-style: italic;
}
.ldtk-destroyed-post > .ldtk-deleted-placeholder {
  grid-column: 1 / -1;
  margin: 0;
}
.ldtk-comment-status {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
}
.ldtk-pagination {
  position: sticky;
  bottom: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 46px;
  padding: 8px 10px;
  background: var(--ldtk-background);
  border-top: 1px solid var(--ldtk-border);
}
.ldtk-pagination button[aria-current="page"] {
  color: var(--ldtk-background);
  border-color: var(--ldtk-foreground);
  background: var(--ldtk-foreground);
}
.ldtk-pagination .d-icon {
  width: 13px;
  height: 13px;
  display: block;
  pointer-events: none;
}
.ldtk-pagination-ellipsis { padding: 0 3px; color: var(--ldtk-muted-foreground); }
.ldtk-post-highlight {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: -2px;
  background: var(--ldtk-muted) !important;
}
#${RETURN_BUTTON_ID} {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid var(--primary, #18181b);
  border-radius: 8px;
  color: var(--secondary, #fff);
  background: var(--primary, #18181b);
  box-shadow:
    0 4px 6px -1px rgb(0 0 0 / 0.1),
    0 2px 4px -2px rgb(0 0 0 / 0.1);
  font: 500 12px/1.2 var(--font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif);
  cursor: pointer;
  transition:
    opacity 120ms ease,
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
#${RETURN_BUTTON_ID}:hover { opacity: 0.9; }
#${RETURN_BUTTON_ID}:active { transform: scale(0.98); }
#${RETURN_BUTTON_ID}:focus-visible {
  outline: 2px solid var(--tertiary, #0f766e);
  outline-offset: 3px;
}
@keyframes ldtk-refresh-spin {
  to { transform: rotate(-360deg); }
}
@media (max-width: 1439px) {
  .ldtk-reading-grid {
    grid-template-columns: minmax(0, 56fr) minmax(420px, 44fr);
  }
  .ldtk-article-scroll {
    padding-inline: 28px;
  }
  .ldtk-article-footer {
    padding-inline: 28px;
  }
  .ldtk-article-header h1 {
    font-size: 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .${ROOT_CLASS} *, #${RETURN_BUTTON_ID} { scroll-behavior: auto !important; }
  .${ROOT_CLASS} .heart-animation { animation: none !important; }
  .${ROOT_CLASS} button { transition: none !important; }
  .${ROOT_CLASS} button:active { transform: none !important; }
  .ldtk-toolbar-button[aria-busy="true"] .d-icon { animation: none !important; }
  #${RETURN_BUTTON_ID} { transition: none !important; }
  #${RETURN_BUTTON_ID}:active { transform: none !important; }
}
`;

/* ═══════ 双栏加载遮罩 —— 与 shadcn 主题一致的 spinner ═══════ */
const LOADING_STYLE = `
#${LOADING_ROOT_ID} {
  position: fixed;
  inset: var(--ldtk-header-height, 60px) 0 0;
  z-index: 95;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--secondary, #fff);
  color: var(--primary-medium, #71717a);
  font: 500 13px/1.5 var(--font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif);
  opacity: 0;
  transition: opacity 180ms ease;
}
#${LOADING_ROOT_ID}[data-visible="true"] {
  opacity: 1;
}
#${LOADING_ROOT_ID} .ldtk-loading-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2.5px solid var(--primary-low, #e4e4e7);
  border-top-color: var(--primary, #18181b);
  animation: ldtk-loading-spin 700ms linear infinite;
}
@keyframes ldtk-loading-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  #${LOADING_ROOT_ID} { transition: none !important; }
  #${LOADING_ROOT_ID} .ldtk-loading-spinner { animation-duration: 1.4s !important; }
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
  const resolved = LUCIDE_NAME_MAP[name] || name;
  const icon = createLucideIcon(name);
  icon.classList.add('d-icon', `d-icon-${name}`, `d-icon-lucide-${resolved}`);
  return icon;
}

/* lucide 图标路径 —— 正文操作栏与评论操作栏共用同一图标体系（24x24，stroke 2，圆角端点） */
const LUCIDE_ICONS: Readonly<Record<string, string>> = {
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-up-from-bracket':
    '<path d="M7 17V7h10"/><path d="m7 7 10 10"/><path d="M12 3v9"/><path d="m8 7 4-4 4 4"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
  'bookmark-clock':
    '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><circle cx="18" cy="16" r="4"/><path d="M18 14v2l1.5 1.5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  ellipsis:
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'far-bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
  'far-heart':
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 5.5 2q1.5.5 3 0a1 1 0 0 1 1 .6c.2.3.5.8.5 1.4v8a1 1 0 0 1-.4.8A6 6 0 0 1 14 16c-3 0-5-2-5.5-2q-1.5-.5-3 0a1 1 0 0 0-.5.4V22"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  'rotate-left':
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'trash-can':
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
};
/* Discourse 图标名 → lucide 图标名 */
const LUCIDE_NAME_MAP: Readonly<Record<string, string>> = {
  'd-liked': 'heart',
  'd-unliked': 'far-heart',
  'd-post-share': 'arrow-up-from-bracket',
  'discourse-bookmark-clock': 'bookmark-clock',
};
/* 需要填充（而非描边）表示“已激活”状态的图标 */
const LUCIDE_FILLED_ICONS: ReadonlySet<string> = new Set(['heart', 'bookmark']);

function createLucideIcon(name: string, size = 15): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const resolved = LUCIDE_NAME_MAP[name] || name;
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', String(size));
  icon.setAttribute('height', String(size));
  icon.setAttribute('fill', LUCIDE_FILLED_ICONS.has(resolved) ? 'currentColor' : 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = LUCIDE_ICONS[resolved] || LUCIDE_ICONS[name] || '';
  return icon;
}

function setButtonIcon(button: HTMLButtonElement, name: string): void {
  const oldIcon = button.querySelector('svg.d-icon');
  if (!oldIcon) return;
  const next = createDiscourseIcon(name);
  const size = oldIcon.getAttribute('width');
  if (size) {
    next.setAttribute('width', size);
    next.setAttribute('height', size);
  }
  oldIcon.replaceWith(next);
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

function createIconButton(className: string, icon: string, label: string): HTMLButtonElement {
  const button = createButton(className, '', label);
  button.title = label;
  button.appendChild(createDiscourseIcon(icon));
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

/* 双栏加载遮罩：数据拉取期间覆盖页面，避免原生界面闪动 */
function showLoadingOverlay(): void {
  const version = ++loadingOverlayVersion;
  if (loadingOverlayHideTimer !== null) {
    window.clearTimeout(loadingOverlayHideTimer);
    loadingOverlayHideTimer = null;
  }
  if (!document.getElementById(LOADING_STYLE_ID)) {
    const style = createElement('style');
    style.id = LOADING_STYLE_ID;
    style.textContent = LOADING_STYLE;
    (document.head || document.documentElement).appendChild(style);
  }
  let overlay = document.getElementById(LOADING_ROOT_ID);
  if (!overlay) {
    overlay = createElement('div');
    overlay.id = LOADING_ROOT_ID;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.dataset.visible = 'false';
    const spinner = createElement('div', 'ldtk-loading-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    overlay.append(spinner, createElement('div', '', '正在加载双栏阅读…'));
    (document.body || document.documentElement).appendChild(overlay);
  }
  const header = document.querySelector<HTMLElement>('.d-header-wrap, .d-header');
  const height = Math.max(0, Math.round(header?.getBoundingClientRect().bottom || 0));
  overlay.style.setProperty('--ldtk-header-height', `${height || 60}px`);
  requestAnimationFrame(() => {
    if (version === loadingOverlayVersion && overlay?.isConnected) {
      overlay.dataset.visible = 'true';
    }
  });
}

function hideLoadingOverlay(): void {
  const version = ++loadingOverlayVersion;
  if (loadingOverlayHideTimer !== null) {
    window.clearTimeout(loadingOverlayHideTimer);
    loadingOverlayHideTimer = null;
  }
  const overlay = document.getElementById(LOADING_ROOT_ID);
  if (!overlay) return;
  overlay.dataset.visible = 'false';
  loadingOverlayHideTimer = window.setTimeout(() => {
    if (version !== loadingOverlayVersion) return;
    loadingOverlayHideTimer = null;
    overlay.remove();
    if (!document.getElementById(LOADING_ROOT_ID)) {
      document.getElementById(LOADING_STYLE_ID)?.remove();
    }
  }, 200);
}

function removeLoadingOverlay(): void {
  loadingOverlayVersion += 1;
  if (loadingOverlayHideTimer !== null) {
    window.clearTimeout(loadingOverlayHideTimer);
    loadingOverlayHideTimer = null;
  }
  document.getElementById(LOADING_ROOT_ID)?.remove();
  document.getElementById(LOADING_STYLE_ID)?.remove();
}

function ensureLayoutStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = createElement('style');
  style.id = STYLE_ID;
  style.textContent = LAYOUT_STYLE;
  document.head.appendChild(style);
}

export function clearPendingTopicLayout(): void {
  document.documentElement.classList.remove(PENDING_CLASS);
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
  document.documentElement.classList.add(PENDING_CLASS);
  return true;
}

function addHighlight(element: HTMLElement): void {
  element.classList.add('ldtk-post-highlight');
  window.setTimeout(() => element.classList.remove('ldtk-post-highlight'), 1800);
}

interface NativeModeOptions {
  route: TopicRoute;
  state: TopicReadingState;
  requestReturn: () => void;
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
    button.prepend(createLucideIcon('arrow-left', 13));
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
    options.requestReturn();
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
  requestRefresh: () => Promise<void>;
  handoffNative: (floor: number, action?: PendingNativeAction['action']) => void;
}

interface ShellGeometry {
  start: number;
  end: number;
}

interface ArticleFooterResize {
  pointerId: number;
  startY: number;
  startHeight: number;
  latestY: number;
  minHeight: number;
  maxHeight: number;
}

class TopicLayout {
  readonly root = createElement('section', ROOT_CLASS);
  private readonly articlePane = createElement('section', 'ldtk-reading-pane ldtk-article-pane');
  private readonly articleScroll = createElement('div', 'ldtk-article-scroll');
  private readonly commentsPane = createElement('section', 'ldtk-reading-pane ldtk-comments-pane');
  private readonly commentsList = createElement('div', 'ldtk-comments-list');
  private readonly pagination = createElement('nav', 'ldtk-pagination');
  private readonly newRepliesButton = createButton('ldtk-new-replies', '有新回复，点击刷新');
  private readonly refreshButton = createIconButton(
    'ldtk-toolbar-button',
    'rotate-left',
    '刷新评论',
  );
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
  private shellOffsetFrame: number | null = null;
  private shellHeaderHeight = 60;
  private shellGeometry: ShellGeometry | null = null;
  private readonly alignedSidebars = new Set<HTMLElement>();
  private articleFooter: HTMLElement | null = null;
  private articleFooterResizer: HTMLElement | null = null;
  private articleFooterHeight: number | undefined;
  private articleFooterResize: ArticleFooterResize | null = null;
  private articleFooterResizeFrame: number | null = null;

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
    this.articleFooterHeight = this.state.articleFooterHeight;
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
    this.constrainArticleFooterHeight();
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
    document.addEventListener('click', this.handleNativeShellClick, true);
    document.addEventListener('transitionend', this.handleNativeShellTransitionEnd, true);
    document.addEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    injectButtons(this.settings);

    if (this.route.floor) void this.goToFloor(this.route.floor, false);
  }

  destroy(save = true, preserveShell = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (save) this.saveState();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.shellOffsetFrame !== null) window.cancelAnimationFrame(this.shellOffsetFrame);
    if (this.articleFooterResizeFrame !== null) {
      window.cancelAnimationFrame(this.articleFooterResizeFrame);
      this.articleFooterResizeFrame = null;
    }
    this.articleFooterResize = null;
    delete this.articlePane.dataset.resizingFooter;
    this.clearSidebarAlignments();
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
    document.removeEventListener('click', this.handleNativeShellClick, true);
    document.removeEventListener('transitionend', this.handleNativeShellTransitionEnd, true);
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
    const height = Array.from(
      document.querySelectorAll<HTMLElement>('.d-header-wrap, .d-header'),
    ).reduce((bottom, header) => Math.max(bottom, header.getBoundingClientRect().bottom), 0);
    this.shellHeaderHeight = height || 60;
    this.root.style.setProperty('--ldtk-header-height', `${this.shellHeaderHeight}px`);
    const target = this.getShellGeometry(this.shellHeaderHeight);
    this.applyShellGeometry(target);
    this.constrainArticleFooterHeight();
  }

  matches(route: TopicRoute, settings: DiscourseSettings): boolean {
    return (
      isSameTopicRoute(this.route, route) &&
      this.settings.commentsPerPage === settings.commentsPerPage
    );
  }

  matchesRoute(route: TopicRoute | null): boolean {
    return isSameTopicRoute(this.route, route);
  }

  private ensureStyle(): void {
    ensureLayoutStyle();
  }

  private getShellGeometry(headerHeight: number): ShellGeometry {
    const viewportWidth = Math.max(0, window.innerWidth);
    const alignedSidebars = new Set<HTMLElement>();
    let geometry: ShellGeometry = { start: 0, end: 0 };

    for (const sidebar of document.querySelectorAll<HTMLElement>('.sidebar-wrapper')) {
      const style = getComputedStyle(sidebar);
      const rect = sidebar.getBoundingClientRect();
      const currentShift = this.getSidebarPresentationShift(sidebar, style);
      const baseLeft = rect.left + currentShift;
      const baseRight = rect.right + currentShift;
      const canAlign =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.height > 0 &&
        rect.bottom > headerHeight &&
        baseLeft >= 0 &&
        baseLeft < viewportWidth / 2 &&
        baseRight <= viewportWidth * 0.55;
      const centerShift = canAlign ? baseLeft / 2 : 0;
      this.setSidebarCenterShift(sidebar, centerShift);
      if (canAlign) alignedSidebars.add(sidebar);

      const alignedLeft = baseLeft - centerShift;
      const alignedRight = baseRight - centerShift;
      const visibleWidth = Math.min(viewportWidth, alignedRight) - Math.max(0, alignedLeft);
      const isVisible = canAlign && rect.width > 0 && visibleWidth > 0;
      if (!isVisible) continue;

      const start = Math.max(0, alignedRight);
      if (start > geometry.start) {
        geometry = { start, end: Math.max(0, alignedLeft) };
      }
    }

    for (const sidebar of this.alignedSidebars) {
      if (!alignedSidebars.has(sidebar)) this.setSidebarCenterShift(sidebar, 0);
    }
    this.alignedSidebars.clear();
    alignedSidebars.forEach((sidebar) => this.alignedSidebars.add(sidebar));
    return geometry;
  }

  private getSidebarPresentationShift(sidebar: HTMLElement, style: CSSStyleDeclaration): number {
    const translatedPixels = /^(-?[\d.]+)px(?:\s|$)/.exec(style.translate || '');
    if (translatedPixels) return Math.max(0, -Number(translatedPixels[1]));
    return Number.parseFloat(sidebar.style.getPropertyValue('--ldtk-sidebar-center-shift')) || 0;
  }

  private setSidebarCenterShift(sidebar: HTMLElement, shift: number): void {
    if (shift <= SHELL_OFFSET_EPSILON) {
      sidebar.classList.remove('ldtk-sidebar-center-target');
      sidebar.style.removeProperty('--ldtk-sidebar-center-shift');
      return;
    }
    const currentShift =
      Number.parseFloat(sidebar.style.getPropertyValue('--ldtk-sidebar-center-shift')) || 0;
    sidebar.classList.add('ldtk-sidebar-center-target');
    if (Math.abs(currentShift - shift) <= SHELL_OFFSET_EPSILON) return;
    sidebar.style.setProperty(
      '--ldtk-sidebar-center-shift',
      `${Math.round(shift * 1000) / 1000}px`,
    );
  }

  private clearSidebarAlignments(): void {
    for (const sidebar of this.alignedSidebars) this.setSidebarCenterShift(sidebar, 0);
    this.alignedSidebars.clear();
  }

  private applyShellGeometry(geometry: ShellGeometry): void {
    if (
      this.shellGeometry &&
      Math.abs(this.shellGeometry.start - geometry.start) <= SHELL_OFFSET_EPSILON &&
      Math.abs(this.shellGeometry.end - geometry.end) <= SHELL_OFFSET_EPSILON
    ) {
      return;
    }
    const format = (value: number): string => `${Math.round(value * 1000) / 1000}px`;
    this.shellGeometry = geometry;
    this.root.style.setProperty('--ldtk-sidebar-start-inset', format(geometry.start));
    this.root.style.setProperty('--ldtk-sidebar-end-inset', format(geometry.end));
  }

  private scheduleShellOffsetUpdates(): void {
    if (this.shellOffsetFrame !== null) window.cancelAnimationFrame(this.shellOffsetFrame);
    this.shellOffsetFrame = window.requestAnimationFrame(() => {
      this.shellOffsetFrame = null;
      if (this.destroyed) return;
      this.updateHeaderOffset();
    });
  }

  private readonly handleNativeShellClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.d-header-wrap, .d-header')) return;
    this.scheduleShellOffsetUpdates();
  };

  private readonly handleNativeShellTransitionEnd = (event: TransitionEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.sidebar-wrapper')) return;
    this.updateHeaderOffset();
  };

  private renderArticle(): void {
    const scrollTop = this.articleScroll.scrollTop;
    const header = createElement('header', 'ldtk-article-header');
    const title = createElement('h1');
    title.innerHTML = this.source.topic.fancy_title || this.source.topic.title;
    const byline = createElement('div', 'ldtk-article-byline');
    const avatarUrl = getAvatarUrl(this.source.article.avatar_template);
    if (avatarUrl) {
      const avatar = createElement('img', 'ldtk-article-byline-avatar');
      avatar.src = avatarUrl;
      avatar.alt = '';
      avatar.width = 32;
      avatar.height = 32;
      byline.appendChild(avatar);
    }
    const bylineCopy = createElement('div', 'ldtk-article-byline-copy');
    bylineCopy.appendChild(
      createElement(
        'strong',
        '',
        this.source.article.display_username || this.source.article.username,
      ),
    );
    const publishedAt = createElement('time', '', formatDate(this.source.article.created_at));
    publishedAt.dateTime = this.source.article.created_at;
    bylineCopy.appendChild(publishedAt);
    byline.appendChild(bylineCopy);
    header.append(title, byline);

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
    const resizer = createElement('div', 'ldtk-article-footer-resizer');
    resizer.tabIndex = 0;
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-label', '调整底部操作栏高度');
    resizer.setAttribute('aria-orientation', 'horizontal');
    resizer.title = '上下拖动调整底部操作栏高度';
    resizer.addEventListener('pointerdown', this.handleArticleFooterResizeStart);
    resizer.addEventListener('pointermove', this.handleArticleFooterResizeMove);
    resizer.addEventListener('pointerup', this.handleArticleFooterResizeEnd);
    resizer.addEventListener('pointercancel', this.handleArticleFooterResizeEnd);
    resizer.addEventListener('lostpointercapture', this.handleArticleFooterResizeEnd);
    resizer.addEventListener('keydown', this.handleArticleFooterResizeKeyDown);
    footer.appendChild(resizer);
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
    this.articleFooter = footer;
    this.articleFooterResizer = resizer;
    this.constrainArticleFooterHeight();
    this.articleScroll.scrollTop = scrollTop;
  }

  private getArticleFooterHeightBounds(): { min: number; max: number } {
    const paneHeight =
      this.articlePane.clientHeight ||
      this.articlePane.getBoundingClientRect().height ||
      Math.max(0, window.innerHeight - this.shellHeaderHeight - 20);
    return {
      min: ARTICLE_FOOTER_MIN_HEIGHT,
      max: Math.max(
        ARTICLE_FOOTER_MIN_HEIGHT,
        Math.min(
          Math.floor(paneHeight * ARTICLE_FOOTER_MAX_RATIO),
          Math.floor(paneHeight - ARTICLE_CONTENT_MIN_HEIGHT),
        ),
      ),
    };
  }

  private getCurrentArticleFooterHeight(): number {
    const footer = this.articleFooter;
    if (!footer) return ARTICLE_FOOTER_DEFAULT_HEIGHT;
    return (
      Number.parseFloat(footer.style.height) ||
      footer.getBoundingClientRect().height ||
      Math.min(ARTICLE_FOOTER_DEFAULT_HEIGHT, this.getArticleFooterHeightBounds().max)
    );
  }

  private applyArticleFooterHeight(
    height: number,
    bounds = this.getArticleFooterHeightBounds(),
    updateAria = true,
  ): void {
    const footer = this.articleFooter;
    if (!footer) return;
    const { min, max } = bounds;
    const nextHeight = Math.round(Math.min(max, Math.max(min, height)));
    this.articleFooterHeight = nextHeight;
    const nextHeightCss = `${nextHeight}px`;
    if (footer.style.height !== nextHeightCss) footer.style.height = nextHeightCss;
    if (footer.style.maxHeight !== `${max}px`) footer.style.maxHeight = `${max}px`;
    if (updateAria) this.updateArticleFooterResizerAria(nextHeight, min, max);
  }

  private constrainArticleFooterHeight(): void {
    const { min, max } = this.getArticleFooterHeightBounds();
    if (this.articleFooterHeight !== undefined) {
      this.applyArticleFooterHeight(this.articleFooterHeight);
      return;
    }
    this.updateArticleFooterResizerAria(this.getCurrentArticleFooterHeight(), min, max);
  }

  private updateArticleFooterResizerAria(height: number, min: number, max: number): void {
    const resizer = this.articleFooterResizer;
    if (!resizer) return;
    const current = Math.round(Math.min(max, Math.max(min, height)));
    const values: Record<string, string> = {
      'aria-valuemin': String(min),
      'aria-valuemax': String(max),
      'aria-valuenow': String(current),
      'aria-valuetext': `${current} 像素`,
    };
    Object.entries(values).forEach(([name, value]) => {
      if (resizer.getAttribute(name) !== value) resizer.setAttribute(name, value);
    });
  }

  private readonly handleArticleFooterResizeStart = (event: PointerEvent): void => {
    if (event.isPrimary === false || event.button !== 0 || this.articleFooterResize) return;
    const resizer = event.currentTarget as HTMLElement;
    const { min, max } = this.getArticleFooterHeightBounds();
    event.preventDefault();
    this.articleFooterResize = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: this.getCurrentArticleFooterHeight(),
      latestY: event.clientY,
      minHeight: min,
      maxHeight: max,
    };
    resizer.dataset.dragging = 'true';
    this.articlePane.dataset.resizingFooter = 'true';
    if (typeof resizer.setPointerCapture === 'function') {
      resizer.setPointerCapture(event.pointerId);
    }
  };

  private readonly handleArticleFooterResizeMove = (event: PointerEvent): void => {
    const resize = this.articleFooterResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    event.preventDefault();
    const coalescedEvents =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    resize.latestY = coalescedEvents.at(-1)?.clientY ?? event.clientY;
    if (this.articleFooterResizeFrame !== null) return;
    this.articleFooterResizeFrame = window.requestAnimationFrame(
      this.flushArticleFooterResizeFrame,
    );
  };

  private readonly flushArticleFooterResizeFrame = (): void => {
    this.articleFooterResizeFrame = null;
    const resize = this.articleFooterResize;
    if (!resize || this.destroyed) return;
    this.applyArticleFooterHeight(
      resize.startHeight + resize.startY - resize.latestY,
      {
        min: resize.minHeight,
        max: resize.maxHeight,
      },
      false,
    );
  };

  private flushPendingArticleFooterResize(): void {
    if (this.articleFooterResizeFrame !== null) {
      window.cancelAnimationFrame(this.articleFooterResizeFrame);
      this.articleFooterResizeFrame = null;
    }
    this.flushArticleFooterResizeFrame();
  }

  private readonly handleArticleFooterResizeEnd = (event: PointerEvent): void => {
    const resize = this.articleFooterResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    const resizer = event.currentTarget as HTMLElement;
    if (event.type === 'pointerup') resize.latestY = event.clientY;
    this.flushPendingArticleFooterResize();
    this.updateArticleFooterResizerAria(
      this.articleFooterHeight ?? resize.startHeight,
      resize.minHeight,
      resize.maxHeight,
    );
    this.articleFooterResize = null;
    delete resizer.dataset.dragging;
    delete this.articlePane.dataset.resizingFooter;
    if (
      event.type !== 'lostpointercapture' &&
      typeof resizer.hasPointerCapture === 'function' &&
      resizer.hasPointerCapture(event.pointerId)
    ) {
      resizer.releasePointerCapture(event.pointerId);
    }
    this.saveState();
  };

  private readonly handleArticleFooterResizeKeyDown = (event: KeyboardEvent): void => {
    const { min, max } = this.getArticleFooterHeightBounds();
    const current = this.getCurrentArticleFooterHeight();
    let nextHeight: number | null = null;
    if (event.key === 'ArrowUp') nextHeight = current + ARTICLE_FOOTER_KEYBOARD_STEP;
    else if (event.key === 'ArrowDown') nextHeight = current - ARTICLE_FOOTER_KEYBOARD_STEP;
    else if (event.key === 'PageUp') nextHeight = current + ARTICLE_FOOTER_KEYBOARD_STEP * 4;
    else if (event.key === 'PageDown') nextHeight = current - ARTICLE_FOOTER_KEYBOARD_STEP * 4;
    else if (event.key === 'Home') nextHeight = min;
    else if (event.key === 'End') nextHeight = max;
    if (nextHeight === null) return;
    event.preventDefault();
    this.applyArticleFooterHeight(nextHeight);
    this.saveState();
  };

  private renderCommentsShell(): void {
    const toolbar = createElement('header', 'ldtk-comments-toolbar');
    const heading = createElement('h2', '', `评论 ${this.source.commentCount}`);
    this.refreshButton.title = '从服务器重新加载主题和评论';
    this.refreshButton.addEventListener('click', this.requestCommentsRefresh);
    toolbar.append(heading, this.refreshButton);
    this.newRepliesButton.dataset.visible = 'false';
    this.newRepliesButton.addEventListener('click', this.requestCommentsRefresh);
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('aria-atomic', 'true');
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
      image.width = 34;
      image.height = 34;
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
    const previous = createIconButton('', 'chevron-left', '上一页');
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
    const next = createIconButton('', 'chevron-right', '下一页');
    next.disabled = this.currentPage >= this.pageCount;
    next.dataset.page = String(this.currentPage + 1);
    fragment.appendChild(next);
    this.pagination.replaceChildren(fragment);
  }

  private setCommentsLoading(loading: boolean): void {
    this.refreshButton.disabled = loading;
    this.newRepliesButton.disabled = loading;
    if (loading) this.refreshButton.setAttribute('aria-busy', 'true');
    else this.refreshButton.removeAttribute('aria-busy');
  }

  private readonly requestCommentsRefresh = (): void => {
    if (this.refreshButton.disabled) return;
    this.setCommentsLoading(true);
    void this.callbacks.requestRefresh().finally(() => {
      if (!this.destroyed) this.setCommentsLoading(false);
    });
  };

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
    this.setCommentsLoading(true);
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
      if (this.pageAbort === request) this.setCommentsLoading(false);
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
      ...(this.articleFooterHeight === undefined
        ? {}
        : { articleFooterHeight: this.articleFooterHeight }),
      nativeMode: false,
    });
  }
}

interface ReusableTopicData {
  topicId: string;
  pageRoot: HTMLElement;
  source: TopicDataSource;
  articleReplies: TopicPost[];
}

export type TopicLayoutRuntimeState =
  'disabled' | 'unsupported' | 'loading' | 'active' | 'native' | 'failed';

export class TopicLayoutRuntime {
  private activeLayout: TopicLayout | null = null;
  private activeContext: TopicPageContext | null = null;
  private loadingAbort: AbortController | null = null;
  private refreshVersion = 0;
  private latestSettings: DiscourseSettings | null = null;
  private reusableData: ReusableTopicData | null = null;
  private state: TopicLayoutRuntimeState = 'disabled';

  getState(): TopicLayoutRuntimeState {
    return this.state;
  }

  disable(): void {
    this.latestSettings = null;
    this.cleanupLayout();
    this.state = 'disabled';
    removeReturnButton();
    nativeAttemptKey = null;
  }

  suspend(): void {
    this.reusableData = null;
    this.cleanupLayout();
    this.state = 'unsupported';
    removeReturnButton();
    nativeAttemptKey = null;
  }

  invalidate(): void {
    this.reusableData = null;
  }

  reconcilePageContext(): void {
    if (
      this.activeLayout &&
      (!this.activeContext || !isTopicPageContextCurrent(this.activeContext))
    ) {
      this.rejectPageContext();
      return;
    }
    this.activeLayout?.updateHeaderOffset();
  }

  async activate(settings: DiscourseSettings, force = false): Promise<void> {
    this.latestSettings = settings;
    if (!settings.enableSplitReading) {
      this.disable();
      return;
    }
    const context = captureTopicPageContext();
    if (window.innerWidth < MIN_VIEWPORT_WIDTH || !context) {
      this.rejectPageContext();
      return;
    }
    const { route, pageRoot } = context;

    const readingState = readTopicState(route.topicId);
    if (readingState?.nativeMode && !force) {
      this.cleanupLayout();
      this.state = 'native';
      ensureNativeMode({
        route,
        state: readingState,
        requestReturn: () => void this.activate(settings, true),
      });
      return;
    }
    if (force && readingState?.nativeMode) {
      writeTopicState(route.topicId, {
        ...readingState,
        nativeMode: false,
        pendingAction: undefined,
      });
    }

    if (
      !force &&
      this.activeLayout?.matches(route, settings) &&
      this.activeContext &&
      isTopicPageContextCurrent(this.activeContext)
    ) {
      this.activeLayout.updateHeaderOffset();
      this.state = 'active';
      return;
    }

    const retainedLayout =
      force &&
      this.activeLayout?.matches(route, settings) &&
      this.activeContext &&
      isTopicPageContextCurrent(this.activeContext)
        ? this.activeLayout
        : null;
    if (!retainedLayout) {
      prepareTopicLayout(settings);
      showLoadingOverlay();
      this.activeLayout?.destroy();
      this.activeLayout = null;
    }
    this.cancelLoading();
    const version = ++this.refreshVersion;
    const request = new AbortController();
    this.loadingAbort = request;
    this.state = 'loading';
    let candidate: TopicLayout | null = null;

    try {
      const cachedData =
        !force &&
        this.reusableData?.topicId === route.topicId &&
        this.reusableData.pageRoot === pageRoot
          ? this.reusableData
          : null;
      const source =
        cachedData?.source ??
        (await TopicDataSource.create(route.topicId, request.signal, route.floor));
      if (!this.canContinueActivation(version, context, source.topic.id)) return;
      if (source.isMegaTopic) {
        if (retainedLayout) {
          this.state = 'active';
          showToast('主题内容过多，已保留当前双栏内容');
        } else {
          this.cleanupLayout();
          this.state = 'unsupported';
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
      const articleRepliesRequest = cachedData
        ? Promise.resolve(cachedData.articleReplies)
        : (source.article.reply_count || 0) > 0
          ? fetchPostReplies(source.article.id, 1, request.signal).catch((error: unknown) => {
              if ((error as Error).name === 'AbortError') throw error;
              return [];
            })
          : Promise.resolve([]);
      const [posts, articleReplies] = await Promise.all([
        source.loadPage(initialPage, settings.commentsPerPage, request.signal),
        articleRepliesRequest,
      ]);
      if (!this.canContinueActivation(version, context, source.topic.id)) return;
      retainedLayout?.persistState();
      candidate = new TopicLayout(route, source, settings, initialPage, {
        requestRefresh: () => {
          const currentSettings = this.latestSettings;
          return currentSettings ? this.activate(currentSettings, true) : Promise.resolve();
        },
        handoffNative: (floor, action) => this.handoffToNative(route, settings, floor, action),
      });
      candidate.mount(posts, articleReplies);
      if (!this.canContinueActivation(version, context, source.topic.id)) {
        candidate.destroy(false, Boolean(retainedLayout));
        return;
      }
      retainedLayout?.destroy(false, true);
      this.activeLayout = candidate;
      this.activeContext = context;
      this.reusableData = { topicId: route.topicId, pageRoot, source, articleReplies };
      this.state = 'active';
      candidate = null;
      hideLoadingOverlay();
    } catch (error) {
      candidate?.destroy(false, Boolean(retainedLayout));
      if (!this.isCurrent(version) || (error as Error).name === 'AbortError') return;
      if (!isTopicPageContextCurrent(context)) {
        this.rejectPageContext();
        return;
      }
      if (retainedLayout && this.activeLayout === retainedLayout) {
        this.state = 'active';
        console.warn('[Linux.do 工具箱] 双栏阅读刷新失败，已保留当前双栏内容', error);
        showToast('刷新失败，已保留当前双栏内容');
      } else {
        console.warn('[Linux.do 工具箱] 双栏阅读加载失败，已恢复原页面', error);
        this.cleanupLayout();
        this.state = 'failed';
      }
    } finally {
      if (this.isCurrent(version)) this.loadingAbort = null;
    }
  }

  private isCurrent(version: number): boolean {
    return version === this.refreshVersion;
  }

  private canContinueActivation(
    version: number,
    context: TopicPageContext,
    responseTopicId: number,
  ): boolean {
    if (!this.isCurrent(version)) return false;
    if (isTopicPageContextCurrent(context) && String(responseTopicId) === context.route.topicId) {
      return true;
    }
    this.rejectPageContext();
    return false;
  }

  private rejectPageContext(): void {
    this.suspend();
  }

  private cancelLoading(): void {
    this.refreshVersion += 1;
    this.loadingAbort?.abort();
    this.loadingAbort = null;
  }

  private cleanupLayout(): void {
    this.cancelLoading();
    this.activeLayout?.destroy();
    this.activeLayout = null;
    this.activeContext = null;
    document.documentElement.classList.remove(ACTIVE_CLASS);
    document.querySelectorAll(`.${ROOT_CLASS}`).forEach((root) => root.remove());
    document.getElementById(STYLE_ID)?.remove();
    clearPendingTopicLayout();
    removeLoadingOverlay();
  }

  private handoffToNative(
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
    this.activeLayout?.destroy();
    this.activeLayout = null;
    this.activeContext = null;
    const state: TopicReadingState = {
      ...previous,
      nativeMode: true,
      pendingAction: action ? { floor, action } : undefined,
    };
    writeTopicState(route.topicId, state);
    nativeAttemptKey = null;
    this.state = 'native';
    ensureNativeMode({
      route,
      state,
      requestReturn: () => void this.activate(settings, true),
    });
    const post = getNativePost(floor);
    if (post && !action) {
      post.scrollIntoView({ block: 'center' });
      addHighlight(post);
    } else if (!post && route.floor !== floor) {
      window.location.assign(buildNativeFloorUrl(floor));
    }
  }
}

export const topicLayoutOwnedSelectors = [
  `.${ROOT_CLASS}`,
  `#${STYLE_ID}`,
  `#${LOADING_ROOT_ID}`,
  `#${LOADING_STYLE_ID}`,
  `#${RETURN_BUTTON_ID}`,
] as const;
