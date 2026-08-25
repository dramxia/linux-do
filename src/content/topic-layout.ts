/* Linux.do 工具箱 - 主题正文/评论双栏阅读模式 */
import type { DiscourseSettings } from '../common/settings';
import { isSameTopicIdentity, parseTopicRoute, type TopicRoute } from '../common/topic-route';
import { injectButtons } from './buttons';
import { copyToClipboard, showToast } from './output';
import { TOPIC_CODE_HIGHLIGHT_REQUEST_NAME } from './topic-code-blocks';
import {
  fetchPostReplies,
  getTopicResponsePrefetchStatus,
  TopicDataSource,
  type InitialCommentBatchError,
  type TopicAcceptedAnswer,
  type TopicPost,
  type TopicPostReaction,
} from './topic-api';
import {
  beginTopicActivation,
  finishTopicActivation,
  markTopicPerfStage,
  setTopicPerfInitialPage,
} from './topic-perf';
import {
  parseTopicActionResult,
  parseTopicInteractionResult,
  TOPIC_ACTION_REQUEST_NAME,
  TOPIC_ACTION_RESULT_NAME,
  TOPIC_INTERACTION_REQUEST_NAME,
  TOPIC_INTERACTION_RESULT_NAME,
  type TopicAction,
  type TopicActionRequest,
  type TopicInteractionRequest,
  type TopicInteractionResult,
  type TopicInteractionUser,
  type TopicReactionOption,
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
  buildNativeFloorUrl,
  clampPage,
  COMMENTS_PAGE_PARAM,
  deriveInitialPage,
  getCommentPageForFloor,
  getPageCount,
  readTopicState,
  writeTopicState,
  type TopicReadingState,
} from './topic-state';

const ROOT_CLASS = 'ldtk-topic-reading-root';
const ACTIVE_CLASS = 'ldtk-split-reading-active';
const PENDING_CLASS = 'ldtk-split-reading-pending';
const STYLE_ID = 'ldtk-topic-reading-style';
const LOADING_STYLE_ID = 'ldtk-topic-reading-loading-style';
const LOADING_ROOT_ID = 'ldtk-topic-reading-loading';
const MIN_VIEWPORT_WIDTH = 1280;
const SHELL_OFFSET_EPSILON = 0.2;
const ARTICLE_FOOTER_DEFAULT_HEIGHT = 130;
const ARTICLE_FOOTER_MIN_HEIGHT = 64;
const ARTICLE_FOOTER_RESIZER_HEIGHT = 16;
const ARTICLE_FOOTER_MAX_RATIO = 0.5;
const ARTICLE_CONTENT_MIN_HEIGHT = 160;
const ARTICLE_FOOTER_KEYBOARD_STEP = 16;
const ARTICLE_COLUMN_DEFAULT_WIDTH_PERCENT = 60;
const ARTICLE_COLUMN_COMPACT_WIDTH_PERCENT = 56;
const ARTICLE_COLUMN_MIN_WIDTH = 320;
const ARTICLE_COLUMN_MIN_PERCENT = 25;
const ARTICLE_COLUMN_MAX_PERCENT = 75;
const COMMENTS_COLUMN_MIN_WIDTH = 420;
const COLUMN_RESIZER_WIDTH = 10;
const COLUMN_RESIZER_KEYBOARD_STEP = 2;
const CODE_COPY_RESET_DELAY = 3_000;
const REACTION_PICKER_CLOSE_DELAY = 150;
const LIKE_USERS_PAGE_SIZE = 30;
let actionRequestSequence = 0;
let loadingOverlayVersion = 0;
let loadingOverlayHideTimer: number | null = null;
let codeHighlightScheduled = false;

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
html.${ACTIVE_CLASS} .fk-d-menu[data-content][data-identifier="emoji-picker"],
html.${ACTIVE_CLASS} .fk-d-menu[data-content][data-identifier="emoji-picker"] * {
  visibility: visible !important;
  pointer-events: auto !important;
}
html.${ACTIVE_CLASS} .fk-d-menu[data-content][data-identifier="emoji-picker"] {
  z-index: 420 !important;
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
  --ldtk-scrollbar-thumb: color-mix(in srgb, var(--ldtk-muted-foreground) 58%, transparent);
  --ldtk-scrollbar-thumb-hover: color-mix(in srgb, var(--ldtk-foreground) 72%, transparent);
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
  --ldtk-article-column-width: 60%;
  width: min(100%, 1880px);
  height: 100%;
  margin: 0 auto;
  padding: 10px;
  display: grid;
  grid-template-columns:
    minmax(0, min(var(--ldtk-article-column-width), calc(100% - 430px)))
    10px
    minmax(420px, 1fr);
  gap: 0;
}
.ldtk-column-resizer {
  position: relative;
  z-index: 5;
  width: 10px;
  height: 100%;
  border: 0;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
}
.ldtk-column-resizer::before {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 4px;
  width: 2px;
  background: var(--ldtk-border);
  content: "";
  transition: background-color 120ms ease;
}
.ldtk-column-resizer:hover::before,
.ldtk-column-resizer:focus-visible::before,
.ldtk-column-resizer[data-dragging="true"]::before {
  background: var(--ldtk-ring);
}
.ldtk-column-resizer:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: -2px;
}
.ldtk-reading-grid[data-resizing-columns="true"],
.ldtk-reading-grid[data-resizing-columns="true"] * {
  cursor: col-resize !important;
  user-select: none !important;
}
.ldtk-reading-pane,
.ldtk-article-scroll,
.ldtk-article-footer {
  background: var(--ldtk-background);
  border: 1px solid var(--ldtk-border);
  border-radius: var(--ldtk-radius);
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 5%);
}
.ldtk-reading-pane {
  min-width: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: auto;
}
.ldtk-article-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: hidden;
  scrollbar-gutter: auto;
}
.ldtk-article-scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 28px clamp(24px, 3.5vw, 56px) 36px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: auto;
}
.ldtk-comments-pane,
.ldtk-article-scroll,
.ldtk-article-footer {
  scrollbar-width: thin;
  scrollbar-color: var(--ldtk-scrollbar-thumb) transparent;
}
.ldtk-comments-pane::-webkit-scrollbar,
.ldtk-article-scroll::-webkit-scrollbar,
.ldtk-article-footer::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.ldtk-comments-pane::-webkit-scrollbar-track,
.ldtk-article-scroll::-webkit-scrollbar-track,
.ldtk-article-footer::-webkit-scrollbar-track,
.ldtk-comments-pane::-webkit-scrollbar-corner,
.ldtk-article-scroll::-webkit-scrollbar-corner,
.ldtk-article-footer::-webkit-scrollbar-corner {
  background: transparent;
}
.ldtk-comments-pane::-webkit-scrollbar-thumb,
.ldtk-article-scroll::-webkit-scrollbar-thumb,
.ldtk-article-footer::-webkit-scrollbar-thumb {
  min-height: 36px;
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--ldtk-scrollbar-thumb);
  background-clip: padding-box;
}
.ldtk-comments-pane::-webkit-scrollbar-thumb:hover,
.ldtk-article-scroll::-webkit-scrollbar-thumb:hover,
.ldtk-article-footer::-webkit-scrollbar-thumb:hover {
  background: var(--ldtk-scrollbar-thumb-hover);
  background-clip: padding-box;
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
.ldtk-article-solved {
  width: 100%;
  max-width: 760px;
  margin: 20px auto 0;
}
.ldtk-article-solved > .accepted-answers {
  width: 100%;
}
.ldtk-article-footer {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  width: 100%;
  max-height: min(21vh, 130px);
  padding: 10px clamp(24px, 3.5vw, 56px) 8px;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--ldtk-foreground);
  scrollbar-gutter: auto;
}
.ldtk-article-footer > * {
  max-width: 760px;
  margin-right: auto;
  margin-left: auto;
}
.ldtk-article-footer-resizer {
  position: relative;
  z-index: 3;
  display: flex;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 16px;
  border: 0;
  background: transparent;
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
.ldtk-article-footer > .ldtk-post-controls {
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
.ldtk-comment-slot {
  min-height: 118px;
  border-bottom: 1px solid var(--ldtk-border);
}
.ldtk-comment-slot:last-child { border-bottom: 0; }
.ldtk-comment-slot > .topic-post { border-bottom: 0; }
.ldtk-comment-skeleton {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  min-height: 118px;
  padding: 14px 0;
}
.ldtk-comment-skeleton-avatar,
.ldtk-comment-skeleton-line,
.ldtk-article-skeleton-line {
  background: linear-gradient(
    90deg,
    var(--ldtk-muted) 0%,
    var(--ldtk-accent) 45%,
    var(--ldtk-muted) 100%
  );
  background-size: 220% 100%;
  animation: ldtk-skeleton-shimmer 1.4s linear infinite;
}
.ldtk-comment-skeleton-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
}
.ldtk-comment-skeleton-copy {
  display: grid;
  align-content: start;
  gap: 10px;
  padding-top: 4px;
}
.ldtk-comment-skeleton-line,
.ldtk-article-skeleton-line {
  height: 12px;
  border-radius: calc(var(--ldtk-radius) - 4px);
}
.ldtk-comment-skeleton-line:first-child { width: 38%; }
.ldtk-comment-skeleton-line:nth-child(2) { width: 92%; }
.ldtk-comment-skeleton-line:nth-child(3) { width: 70%; }
.ldtk-article-skeleton {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 12px 0;
}
.ldtk-article-skeleton-line {
  height: 14px;
  margin-bottom: 14px;
}
.ldtk-article-skeleton-line:first-child { width: 44%; height: 28px; margin-bottom: 26px; }
.ldtk-article-skeleton-line:nth-child(2) { width: 94%; }
.ldtk-article-skeleton-line:nth-child(3) { width: 86%; }
.ldtk-article-skeleton-line:nth-child(4) { width: 72%; }
.ldtk-comment-batch-error {
  display: grid;
  place-items: center;
  min-height: 118px;
  padding: 16px;
  color: var(--ldtk-muted-foreground);
  text-align: center;
}
.ldtk-comment-batch-error p { margin: 0 0 10px; }
.ldtk-comment-batch-error button {
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
  cursor: pointer;
}
.ldtk-comment-batch-error button:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
}
@keyframes ldtk-skeleton-shimmer {
  to { background-position: -220% 0; }
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
  position: relative;
  padding: 0;
  border: 1px solid var(--ldtk-border);
  border-radius: calc(var(--ldtk-radius) - 2px);
  background: var(--hljs-bg, var(--ldtk-muted));
  white-space: pre;
}
.${ROOT_CLASS} .cooked pre code {
  display: block;
  padding: 12px;
  background: transparent;
  font-size: 13px;
  line-height: 1.65;
}
.${ROOT_CLASS} .cooked pre.codeblock-buttons {
  display: block;
  overflow: auto;
}
.${ROOT_CLASS} .codeblock-button-wrapper {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  display: flex;
}
.${ROOT_CLASS} .copy-cmd {
  width: 30px;
  height: 30px;
  min-height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  color: var(--ldtk-muted-foreground);
  background: color-mix(in srgb, var(--ldtk-background) 92%, transparent);
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, color 150ms ease, background-color 150ms ease;
}
.${ROOT_CLASS} pre:hover > .codeblock-button-wrapper .copy-cmd,
.${ROOT_CLASS} pre:focus-within > .codeblock-button-wrapper .copy-cmd,
.${ROOT_CLASS} .copy-cmd.action-complete {
  opacity: 1;
  pointer-events: auto;
}
.${ROOT_CLASS} .copy-cmd:hover {
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
}
.${ROOT_CLASS} .copy-cmd:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
  opacity: 1;
  pointer-events: auto;
}
.${ROOT_CLASS} .copy-cmd:disabled {
  cursor: wait;
  opacity: 0.7;
}
.${ROOT_CLASS} .copy-cmd.action-complete {
  width: auto;
  min-width: 30px;
  padding: 0 8px;
  color: var(--ldtk-brand);
  cursor: default;
  font-size: 12px;
  font-weight: 600;
}
@media (hover: none) {
  .${ROOT_CLASS} .copy-cmd {
    opacity: 0.8;
    pointer-events: auto;
  }
  .${ROOT_CLASS} .cooked pre code {
    padding-right: 32px;
  }
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
.ldtk-post-reactions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
}
.ldtk-post-reaction-summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 6px;
  color: var(--ldtk-muted-foreground);
  font-size: 13px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ldtk-post-reaction-image {
  display: block;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  object-fit: contain;
}
.ldtk-post-reaction-code {
  max-width: 76px;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
}
.ldtk-post-reaction-count {
  min-width: 1ch;
  text-align: center;
}
.ldtk-post-accepted {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 5px 6px;
  color: var(--success, #008a3b);
  font-size: 13px;
  line-height: 1;
  font-weight: 600;
  white-space: nowrap;
}
.ldtk-post-accepted .d-icon {
  display: block;
  flex: 0 0 15px;
  width: 15px;
  height: 15px;
}
.ldtk-inline-popover {
  position: absolute;
  z-index: 12;
  width: min(340px, calc(100vw - 32px));
  max-height: min(420px, calc(100vh - 96px));
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--ldtk-border);
  border-radius: 6px;
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
  box-shadow: 0 10px 28px rgb(0 0 0 / 16%);
}
.ldtk-inline-popover:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
}
.ldtk-inline-popover-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.ldtk-inline-popover-title {
  margin: 0 auto 0 0;
  color: var(--ldtk-foreground);
  font-size: 14px;
  line-height: 1.3;
  font-weight: 600;
}
.ldtk-inline-popover-close {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
}
.ldtk-inline-popover-status {
  min-height: 24px;
  margin: 0;
  color: var(--ldtk-muted-foreground);
  font-size: 13px;
  line-height: 1.5;
}
.ldtk-reaction-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(44px, 1fr));
  gap: 8px;
}
.ldtk-reaction-option {
  position: relative;
  min-width: 44px;
  min-height: 44px;
  padding: 8px;
  border: 1px solid var(--ldtk-border);
  border-radius: 6px;
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
  cursor: pointer;
}
.ldtk-reaction-option:hover { background: var(--ldtk-accent); }
.ldtk-reaction-option:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
}
.ldtk-reaction-option[aria-pressed="true"] { border-color: var(--ldtk-brand); }
.ldtk-reaction-option:disabled { cursor: wait; opacity: 0.5; }
.ldtk-reaction-option img {
  display: block;
  width: 24px;
  height: 24px;
  margin: auto;
  object-fit: contain;
}
.ldtk-like-users-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ldtk-like-user {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 6px;
  border-radius: 5px;
}
.ldtk-like-user:hover { background: var(--ldtk-muted); }
.ldtk-like-user-avatar,
.ldtk-like-user-avatar-placeholder {
  display: block;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--ldtk-muted);
  object-fit: cover;
}
.ldtk-like-user-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
  color: var(--ldtk-foreground);
  text-decoration: none;
}
.ldtk-like-user-copy strong,
.ldtk-like-user-copy span {
  overflow-wrap: anywhere;
}
.ldtk-like-user-copy strong { font-size: 13px; font-weight: 600; }
.ldtk-like-user-copy span { color: var(--ldtk-muted-foreground); font-size: 12px; }
.ldtk-like-users-more {
  width: 100%;
  min-height: 36px;
  margin-top: 8px;
  border: 1px solid var(--ldtk-border);
  border-radius: 5px;
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
  cursor: pointer;
}
.ldtk-like-users-more:hover { background: var(--ldtk-accent); }
.ldtk-like-users-more:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 2px;
}
.ldtk-like-users-more:disabled { cursor: wait; opacity: 0.5; }
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
.${ROOT_CLASS} .ldtk-boost-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--ldtk-border);
  border-radius: 6px;
  background: var(--ldtk-background);
}
.${ROOT_CLASS} .ldtk-boost-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.${ROOT_CLASS} .ldtk-boost-label {
  color: var(--ldtk-foreground);
  font-size: 12px;
  font-weight: 600;
}
.${ROOT_CLASS} .ldtk-boost-input {
  width: 100%;
  min-height: 36px;
  padding: 7px 9px;
  border: 1px solid var(--ldtk-border);
  border-radius: 5px;
  color: var(--ldtk-foreground);
  background: var(--ldtk-background);
  font: inherit;
  letter-spacing: 0;
}
.${ROOT_CLASS} .ldtk-boost-input:focus-visible {
  outline: 2px solid var(--ldtk-ring);
  outline-offset: 1px;
}
.${ROOT_CLASS} .ldtk-boost-meta,
.${ROOT_CLASS} .ldtk-boost-error {
  min-height: 18px;
  margin: 0;
  color: var(--ldtk-muted-foreground);
  font-size: 12px;
  line-height: 1.5;
}
.${ROOT_CLASS} .ldtk-boost-error {
  color: var(--danger, #b42318);
}
.${ROOT_CLASS} .ldtk-boost-submit,
.${ROOT_CLASS} .ldtk-boost-cancel {
  min-width: 36px;
  min-height: 36px;
  justify-content: center;
}
.${ROOT_CLASS} .ldtk-boost-submit {
  color: var(--secondary, #fff);
  background: var(--tertiary, #0f766e);
}
.${ROOT_CLASS} .ldtk-boost-editor[aria-busy="true"] .ldtk-boost-input {
  opacity: 0.7;
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
@keyframes ldtk-refresh-spin {
  to { transform: rotate(-360deg); }
}
@media (max-width: 1439px) {
  .ldtk-reading-grid {
    --ldtk-article-column-width: 56%;
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
  .${ROOT_CLASS} * { scroll-behavior: auto !important; }
  .${ROOT_CLASS} .heart-animation { animation: none !important; }
  .${ROOT_CLASS} button { transition: none !important; }
  .${ROOT_CLASS} button:active { transform: none !important; }
  .ldtk-toolbar-button[aria-busy="true"] .d-icon { animation: none !important; }
  .ldtk-comment-skeleton-avatar,
  .ldtk-comment-skeleton-line,
  .ldtk-article-skeleton-line {
    animation: none !important;
    background: var(--ldtk-muted) !important;
  }
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

function formatRelativeDate(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const elapsed = Date.now() - timestamp;
  if (elapsed < 0) return formatDate(value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天`;
  return formatDate(value);
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
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
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
  check: '<path d="M20 6 9 17l-5-5"/>',
  'square-check': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  ellipsis:
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'far-bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
  'far-heart':
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 5.5 2q1.5.5 3 0a1 1 0 0 1 1 .6c.2.3.5.8.5 1.4v8a1 1 0 0 1-.4.8A6 6 0 0 1 14 16c-3 0-5-2-5.5-2q-1.5-.5-3 0a1 1 0 0 0-.5.4V22"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V6a2 2 0 0 0-4 0v9"/><path d="M6 14V8a2 2 0 0 0-4 0v7a8 8 0 0 0 8 8h2a8 8 0 0 0 8-8v-4a2 2 0 0 0-4 0v2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  'smile-plus':
    '<path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/><path d="M19 3v6"/><path d="M16 6h6"/>',
  'rotate-left':
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'trash-can':
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  xmark: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
/* Discourse 图标名 → lucide 图标名 */
const LUCIDE_NAME_MAP: Readonly<Record<string, string>> = {
  'd-liked': 'heart',
  'd-unliked': 'far-heart',
  'd-post-share': 'arrow-up-from-bracket',
  'discourse-bookmark-clock': 'bookmark-clock',
  'far-square-check': 'square-check',
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

function scheduleCodeHighlight(): void {
  if (codeHighlightScheduled) return;
  codeHighlightScheduled = true;
  queueMicrotask(() => {
    codeHighlightScheduled = false;
    document.dispatchEvent(new Event(TOPIC_CODE_HIGHLIGHT_REQUEST_NAME));
  });
}

function decorateCooked(cooked: HTMLElement): void {
  let hasCodeBlocks = false;
  cooked.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const pre = code.parentElement;
    const container = pre?.parentElement;
    if (!pre || (container !== cooked && container?.matches('article, blockquote'))) return;

    hasCodeBlocks = true;
    if (pre.classList.contains('codeblock-buttons')) return;

    pre.classList.add('codeblock-buttons');
    const wrapper = createElement('div', 'codeblock-button-wrapper');
    const copyButton = createIconButton('btn nohighlight copy-cmd btn-flat', 'copy', '复制代码');
    copyButton.dataset.copyCode = '';
    wrapper.appendChild(copyButton);
    code.before(wrapper);
  });
  if (hasCodeBlocks) scheduleCodeHighlight();
}

function createCooked(html: string): HTMLElement {
  const cooked = createElement('div', 'cooked');
  cooked.innerHTML = html;
  decorateCooked(cooked);
  return cooked;
}

function getCodeText(button: HTMLButtonElement): string | null {
  const code = button.closest('pre')?.querySelector('code');
  if (!code) return null;
  return (code.innerText || code.textContent || '')
    .replace(/[\f\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/g, ' ')
    .trim();
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

function getNativeFloorUrl(floor: number): string {
  return buildNativeFloorUrl(new URL(window.location.href), floor).href;
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
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.removeAttribute('aria-hidden');
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
  overlay.setAttribute('aria-hidden', 'true');
  overlay.removeAttribute('role');
  overlay.removeAttribute('aria-live');
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

interface LayoutCallbacks {
  requestRefresh: () => Promise<void>;
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

interface ColumnResizeBounds {
  contentWidth: number;
  minPercent: number;
  maxPercent: number;
}

interface ColumnResize {
  pointerId: number;
  startX: number;
  startPercent: number;
  latestX: number;
  bounds: ColumnResizeBounds;
}

class TopicLayout {
  readonly root = createElement('section', ROOT_CLASS);
  private readonly grid = createElement('div', 'ldtk-reading-grid');
  private readonly articlePane = createElement('section', 'ldtk-article-pane');
  private readonly columnResizer = createElement('div', 'ldtk-column-resizer');
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
  private readonly reactionOptions = new Map<string, TopicReactionOption>();
  private reactionOptionsPromise: Promise<TopicReactionOption[]> | null = null;
  private readonly replyAborts = new Map<number, AbortController>();
  private readonly codeCopyResetTimers = new Map<HTMLButtonElement, number>();
  private readonly failedCommentOffsets = new Set<number>();
  private articleReplies: TopicPost[] = [];
  private articleRendered = false;
  private readTracker: TopicReadTracker | null = null;
  private pageAbort: AbortController | null = null;
  private injectButtonsFrame: number | null = null;
  private retryCountdownTimer: number | null = null;
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
  private articleColumnWidthPercent: number;
  private columnResize: ColumnResize | null = null;
  private columnResizeFrame: number | null = null;
  private reactionPickerCloseTimer: number | null = null;
  private suppressReactionFocusOpen = false;

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
    this.articleColumnWidthPercent =
      this.state.articleColumnWidthPercent ??
      (window.innerWidth <= 1439
        ? ARTICLE_COLUMN_COMPACT_WIDTH_PERCENT
        : ARTICLE_COLUMN_DEFAULT_WIDTH_PERCENT);
  }

  mountShell(articleReplies: TopicPost[] = []): void {
    this.articleReplies = articleReplies;
    this.ensureStyle();
    this.root.setAttribute('aria-label', '主题双栏阅读');
    this.columnResizer.tabIndex = 0;
    this.columnResizer.setAttribute('role', 'separator');
    this.columnResizer.setAttribute('aria-label', '调整正文和评论宽度');
    this.columnResizer.setAttribute('aria-orientation', 'vertical');
    this.columnResizer.title = '左右拖动调整正文和评论宽度';
    this.columnResizer.addEventListener('pointerdown', this.handleColumnResizeStart);
    this.columnResizer.addEventListener('pointermove', this.handleColumnResizeMove);
    this.columnResizer.addEventListener('pointerup', this.handleColumnResizeEnd);
    this.columnResizer.addEventListener('pointercancel', this.handleColumnResizeEnd);
    this.columnResizer.addEventListener('lostpointercapture', this.handleColumnResizeEnd);
    this.columnResizer.addEventListener('keydown', this.handleColumnResizeKeyDown);
    this.grid.append(this.articlePane, this.columnResizer, this.commentsPane);
    this.root.appendChild(this.grid);
    if (this.source.articleReady) this.renderArticle();
    else this.renderArticleSkeleton();
    this.renderCommentsShell();
    this.renderCommentSlots();
    this.updateHeaderOffset();
    document.body.appendChild(this.root);
    this.applyArticleColumnWidth(this.articleColumnWidthPercent);
    this.constrainArticleFooterHeight();
    document.documentElement.classList.add(ACTIVE_CLASS);
    clearPendingTopicLayout();

    this.articleScroll.scrollTop = this.state.leftScrollTop;
    this.commentsPane.scrollTop = this.state.rightScrollTop;
    this.articleScroll.addEventListener('scroll', this.scheduleSave, { passive: true });
    this.commentsPane.addEventListener('scroll', this.scheduleSave, { passive: true });
    this.root.addEventListener('click', this.handleClick);
    this.root.addEventListener('keydown', this.handleKeyDown);
    this.root.addEventListener('pointerover', this.handleReactionPointerOver);
    this.root.addEventListener('pointerout', this.handleReactionPointerOut);
    this.root.addEventListener('focusin', this.handleReactionFocusIn);
    this.root.addEventListener('focusout', this.handleReactionFocusOut);
    window.addEventListener('popstate', this.handlePopState);
    window.addEventListener('pagehide', this.handlePageHide);
    document.addEventListener('click', this.handleNativeShellClick, true);
    document.addEventListener('transitionend', this.handleNativeShellTransitionEnd, true);
    document.addEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    this.scheduleInjectButtons();
  }

  revealArticle(articleReplies: TopicPost[] = this.articleReplies): void {
    if (this.destroyed || !this.source.articleReady) return;
    const repliesChanged =
      articleReplies.length !== this.articleReplies.length ||
      articleReplies.some((reply, index) => reply.id !== this.articleReplies[index]?.id);
    this.articleReplies = articleReplies;
    if (this.articleRendered && !repliesChanged) return;
    this.renderArticle();
    this.flushInjectButtons();
  }

  applyCommentBatch(pageOffset: number, posts: readonly TopicPost[]): void {
    if (this.destroyed) return;
    posts.forEach((post, index) => {
      const offset = pageOffset + index;
      const slot = this.getCommentSlot(offset);
      if (!slot) return;
      slot.hidden = false;
      slot.style.removeProperty('display');
      slot.style.removeProperty('min-height');
      slot.replaceChildren(this.createPost(post));
      slot.dataset.state = 'ready';
      this.failedCommentOffsets.delete(offset);
      if (this.route.floor === post.post_number) this.highlightFloor(post.post_number);
    });
    this.observeRenderedComments();
    this.scheduleInjectButtons();
  }

  applyCommentBatchError(failure: InitialCommentBatchError): void {
    if (this.destroyed) return;
    const offsets = [...new Set(failure.pageOffsets)].sort((left, right) => left - right);
    offsets.forEach((offset) => {
      const slot = this.getCommentSlot(offset);
      if (!slot) return;
      slot.hidden = false;
      slot.style.removeProperty('display');
      slot.style.removeProperty('min-height');
      this.failedCommentOffsets.add(offset);
      slot.dataset.state = 'failed';
    });
    const groups: number[][] = [];
    offsets.forEach((offset) => {
      const group = groups[groups.length - 1];
      if (!group || offset !== (group[group.length - 1] as number) + 1) groups.push([offset]);
      else group.push(offset);
    });
    groups.forEach((group) => {
      const slot = this.getCommentSlot(group[0] as number);
      if (!slot) return;
      const error = createElement('div', 'ldtk-comment-batch-error');
      error.setAttribute('role', 'group');
      const message = createElement('p', '', `${group.length} 条评论加载失败`);
      const retry = createButton('', '重试评论');
      retry.dataset.retryComments = 'true';
      if (failure.retryAt && failure.retryAt > Date.now()) {
        retry.disabled = true;
        retry.dataset.retryAt = String(failure.retryAt);
        retry.title = '请求受到限流，请稍后重试';
      }
      error.append(message, retry);
      slot.replaceChildren(error);
      slot.style.minHeight = `${group.length * 118}px`;
      group.slice(1).forEach((offset) => {
        const groupedSlot = this.getCommentSlot(offset);
        if (!groupedSlot) return;
        groupedSlot.hidden = true;
        groupedSlot.style.display = 'none';
      });
    });
    this.status.hidden = false;
    this.status.textContent = '部分评论加载失败，可重试';
    this.scheduleRetryCountdown();
  }

  enrichReplyTargets(): void {
    if (this.destroyed) return;
    this.commentsList.querySelectorAll<HTMLElement>('.topic-post').forEach((current) => {
      const postId = Number(current.dataset.postId);
      const post = this.source.getCachedPost(postId);
      if (!post?.reply_to_post_number) return;
      const target = current.querySelector<HTMLButtonElement>('.ldtk-reply-target');
      if (!target) return;
      const replyTargetPost = this.source.getCachedPostByNumber(post.reply_to_post_number);
      const replyTargetUsername = replyTargetPost?.username.trim();
      target.textContent = replyTargetUsername
        ? `回复 @${replyTargetUsername} · #${post.reply_to_post_number}`
        : `回复 #${post.reply_to_post_number}`;
      target.title = replyTargetUsername
        ? `跳转到 @${replyTargetUsername} 的 ${post.reply_to_post_number} 楼评论`
        : `跳转到 ${post.reply_to_post_number} 楼`;
    });
  }

  finalizeInitialComments(failedPageOffsets: readonly number[]): void {
    if (this.destroyed) return;
    failedPageOffsets.forEach((offset) => this.failedCommentOffsets.add(offset));
    this.commentsPane.setAttribute('aria-busy', 'false');
    this.renderPagination();
    if (this.source.commentCount === 0) {
      this.status.hidden = false;
      this.status.textContent = '暂无评论';
    } else if (this.failedCommentOffsets.size === 0) {
      this.status.hidden = true;
    } else {
      this.status.hidden = false;
      this.status.textContent = '部分评论加载失败，可重试';
    }
    this.observeRenderedComments();
    this.flushInjectButtons();
    if (this.route.floor) void this.goToFloor(this.route.floor);
  }

  destroy(save = true, preserveShell = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (save) this.saveState();
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.shellOffsetFrame !== null) {
      window.cancelAnimationFrame(this.shellOffsetFrame);
      this.shellOffsetFrame = null;
    }
    if (this.articleFooterResizeFrame !== null) {
      window.cancelAnimationFrame(this.articleFooterResizeFrame);
      this.articleFooterResizeFrame = null;
    }
    if (this.columnResizeFrame !== null) {
      window.cancelAnimationFrame(this.columnResizeFrame);
      this.columnResizeFrame = null;
    }
    if (this.injectButtonsFrame !== null) window.cancelAnimationFrame(this.injectButtonsFrame);
    this.injectButtonsFrame = null;
    if (this.retryCountdownTimer !== null) window.clearTimeout(this.retryCountdownTimer);
    this.retryCountdownTimer = null;
    if (this.reactionPickerCloseTimer !== null) {
      window.clearTimeout(this.reactionPickerCloseTimer);
      this.reactionPickerCloseTimer = null;
    }
    this.articleFooterResize = null;
    this.columnResize = null;
    delete this.articlePane.dataset.resizingFooter;
    delete this.grid.dataset.resizingColumns;
    this.clearSidebarAlignments();
    this.pageAbort?.abort();
    this.pageAbort = null;
    this.replyAborts.forEach((controller) => controller.abort());
    this.replyAborts.clear();
    this.codeCopyResetTimers.forEach((timer) => window.clearTimeout(timer));
    this.codeCopyResetTimers.clear();
    this.readTracker?.disconnect();
    this.articleScroll.removeEventListener('scroll', this.scheduleSave);
    this.commentsPane.removeEventListener('scroll', this.scheduleSave);
    this.root.removeEventListener('click', this.handleClick);
    this.root.removeEventListener('keydown', this.handleKeyDown);
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
    this.updateColumnResizerAria(this.articleColumnWidthPercent, this.getColumnResizeBounds());
    this.constrainArticleFooterHeight();
  }

  matches(route: TopicRoute, settings: DiscourseSettings): boolean {
    return (
      isSameTopicIdentity(this.route, route) &&
      this.settings.commentsPerPage === settings.commentsPerPage
    );
  }

  private getColumnResizeBounds(): ColumnResizeBounds {
    const style = getComputedStyle(this.grid);
    const measuredWidth = this.grid.clientWidth || this.grid.getBoundingClientRect().width;
    const horizontalPadding =
      (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    const contentWidth = Math.max(0, measuredWidth - horizontalPadding);
    if (contentWidth <= 0) {
      return {
        contentWidth: 0,
        minPercent: ARTICLE_COLUMN_MIN_PERCENT,
        maxPercent: ARTICLE_COLUMN_MAX_PERCENT,
      };
    }
    const maxPercent = Math.max(
      0,
      Math.min(
        ARTICLE_COLUMN_MAX_PERCENT,
        ((contentWidth - COLUMN_RESIZER_WIDTH - COMMENTS_COLUMN_MIN_WIDTH) / contentWidth) * 100,
      ),
    );
    const minPercent = Math.min(
      maxPercent,
      Math.max(ARTICLE_COLUMN_MIN_PERCENT, (ARTICLE_COLUMN_MIN_WIDTH / contentWidth) * 100),
    );
    return { contentWidth, minPercent, maxPercent };
  }

  private applyArticleColumnWidth(
    percent: number,
    bounds = this.getColumnResizeBounds(),
    updateAria = true,
  ): void {
    const nextPercent =
      Math.round(Math.min(bounds.maxPercent, Math.max(bounds.minPercent, percent)) * 10) / 10;
    this.articleColumnWidthPercent = nextPercent;
    const nextCss = `${nextPercent}%`;
    if (this.grid.style.getPropertyValue('--ldtk-article-column-width') !== nextCss) {
      this.grid.style.setProperty('--ldtk-article-column-width', nextCss);
    }
    if (updateAria) this.updateColumnResizerAria(nextPercent, bounds);
  }

  private updateColumnResizerAria(percent: number, bounds: ColumnResizeBounds): void {
    const current =
      Math.round(Math.min(bounds.maxPercent, Math.max(bounds.minPercent, percent)) * 10) / 10;
    const values: Record<string, string> = {
      'aria-valuemin': String(Math.round(bounds.minPercent * 10) / 10),
      'aria-valuemax': String(Math.round(bounds.maxPercent * 10) / 10),
      'aria-valuenow': String(current),
      'aria-valuetext': `正文 ${current}%，评论 ${Math.round((100 - current) * 10) / 10}％`,
    };
    Object.entries(values).forEach(([name, value]) => {
      if (this.columnResizer.getAttribute(name) !== value) {
        this.columnResizer.setAttribute(name, value);
      }
    });
  }

  private readonly handleColumnResizeStart = (event: PointerEvent): void => {
    if (event.isPrimary === false || event.button !== 0 || this.columnResize) return;
    const bounds = this.getColumnResizeBounds();
    if (bounds.contentWidth <= 0) return;
    const startPercent = Math.min(
      bounds.maxPercent,
      Math.max(bounds.minPercent, this.articleColumnWidthPercent),
    );
    event.preventDefault();
    this.columnResize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPercent,
      latestX: event.clientX,
      bounds,
    };
    this.columnResizer.dataset.dragging = 'true';
    this.grid.dataset.resizingColumns = 'true';
    if (typeof this.columnResizer.setPointerCapture === 'function') {
      this.columnResizer.setPointerCapture(event.pointerId);
    }
  };

  private readonly handleColumnResizeMove = (event: PointerEvent): void => {
    const resize = this.columnResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    event.preventDefault();
    const coalescedEvents =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    resize.latestX = coalescedEvents.at(-1)?.clientX ?? event.clientX;
    if (this.columnResizeFrame !== null) return;
    this.columnResizeFrame = window.requestAnimationFrame(this.flushColumnResizeFrame);
  };

  private readonly flushColumnResizeFrame = (): void => {
    this.columnResizeFrame = null;
    const resize = this.columnResize;
    if (!resize || this.destroyed) return;
    this.applyArticleColumnWidth(
      resize.startPercent + ((resize.latestX - resize.startX) / resize.bounds.contentWidth) * 100,
      resize.bounds,
      false,
    );
  };

  private flushPendingColumnResize(): void {
    if (this.columnResizeFrame !== null) {
      window.cancelAnimationFrame(this.columnResizeFrame);
      this.columnResizeFrame = null;
    }
    this.flushColumnResizeFrame();
  }

  private readonly handleColumnResizeEnd = (event: PointerEvent): void => {
    const resize = this.columnResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    if (event.type === 'pointerup') resize.latestX = event.clientX;
    this.flushPendingColumnResize();
    this.updateColumnResizerAria(this.articleColumnWidthPercent, resize.bounds);
    this.columnResize = null;
    delete this.columnResizer.dataset.dragging;
    delete this.grid.dataset.resizingColumns;
    if (
      event.type !== 'lostpointercapture' &&
      typeof this.columnResizer.hasPointerCapture === 'function' &&
      this.columnResizer.hasPointerCapture(event.pointerId)
    ) {
      this.columnResizer.releasePointerCapture(event.pointerId);
    }
    this.saveState();
  };

  private readonly handleColumnResizeKeyDown = (event: KeyboardEvent): void => {
    const bounds = this.getColumnResizeBounds();
    let nextPercent: number | null = null;
    if (event.key === 'ArrowLeft') {
      nextPercent = this.articleColumnWidthPercent - COLUMN_RESIZER_KEYBOARD_STEP;
    } else if (event.key === 'ArrowRight') {
      nextPercent = this.articleColumnWidthPercent + COLUMN_RESIZER_KEYBOARD_STEP;
    } else if (event.key === 'Home') {
      nextPercent = bounds.minPercent;
    } else if (event.key === 'End') {
      nextPercent = bounds.maxPercent;
    }
    if (nextPercent === null) return;
    event.preventDefault();
    this.applyArticleColumnWidth(nextPercent, bounds);
    this.saveState();
  };

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

  private renderArticleSkeleton(): void {
    const skeleton = createElement('div', 'ldtk-article-skeleton');
    skeleton.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 4; index += 1) {
      skeleton.appendChild(createElement('div', 'ldtk-article-skeleton-line'));
    }
    this.articlePane.setAttribute('aria-busy', 'true');
    this.articleScroll.replaceChildren(skeleton);
    this.articlePane.replaceChildren(this.articleScroll);
  }

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
    const cooked = createCooked(this.source.article.cooked);
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
    const solved = this.createSolvedArea();
    this.articleScroll.replaceChildren(header, content, ...(solved ? [solved] : []));
    this.articlePane.replaceChildren(this.articleScroll, resizer, footer);
    this.articlePane.setAttribute('aria-busy', 'false');
    this.articleFooter = footer;
    this.articleFooterResizer = resizer;
    this.constrainArticleFooterHeight();
    this.articleScroll.scrollTop = scrollTop;
    this.articleRendered = true;
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
          Math.floor(paneHeight - ARTICLE_CONTENT_MIN_HEIGHT - ARTICLE_FOOTER_RESIZER_HEIGHT),
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

  private renderCommentSlots(): void {
    this.commentsPane.setAttribute('aria-busy', 'true');
    this.status.hidden = false;
    this.status.textContent = '正在加载评论...';
    const start = (this.currentPage - 1) * this.settings.commentsPerPage;
    const count = this.source.commentPostIds.slice(
      start,
      start + this.settings.commentsPerPage,
    ).length;
    const fragment = document.createDocumentFragment();
    for (let offset = 0; offset < count; offset += 1) {
      const slot = createElement('div', 'ldtk-comment-slot');
      slot.dataset.pageOffset = String(offset);
      slot.dataset.state = 'loading';
      const skeleton = createElement('div', 'ldtk-comment-skeleton');
      skeleton.setAttribute('aria-hidden', 'true');
      const avatar = createElement('div', 'ldtk-comment-skeleton-avatar');
      const copy = createElement('div', 'ldtk-comment-skeleton-copy');
      for (let line = 0; line < 3; line += 1) {
        copy.appendChild(createElement('div', 'ldtk-comment-skeleton-line'));
      }
      skeleton.append(avatar, copy);
      slot.appendChild(skeleton);
      fragment.appendChild(slot);
    }
    this.commentsList.replaceChildren(fragment);
  }

  private getCommentSlot(pageOffset: number): HTMLElement | null {
    return this.commentsList.querySelector<HTMLElement>(
      `.ldtk-comment-slot[data-page-offset="${pageOffset}"]`,
    );
  }

  private observeRenderedComments(): void {
    this.readTracker ??= new TopicReadTracker(this.source.topic.id, this.commentsPane);
    this.readTracker.observe(
      Array.from(this.commentsList.querySelectorAll<HTMLElement>('.topic-post')),
    );
  }

  private scheduleInjectButtons(): void {
    if (this.injectButtonsFrame !== null) return;
    this.injectButtonsFrame = window.requestAnimationFrame(() => {
      this.injectButtonsFrame = null;
      if (this.destroyed) return;
      injectButtons(this.settings);
    });
  }

  private flushInjectButtons(): void {
    if (this.injectButtonsFrame !== null) window.cancelAnimationFrame(this.injectButtonsFrame);
    this.injectButtonsFrame = null;
    if (!this.destroyed) injectButtons(this.settings);
  }

  private scheduleRetryCountdown(): void {
    if (this.retryCountdownTimer !== null) window.clearTimeout(this.retryCountdownTimer);
    this.retryCountdownTimer = null;
    let pending = false;
    this.commentsList
      .querySelectorAll<HTMLButtonElement>('[data-retry-comments]')
      .forEach((button) => {
        const retryAt = Number(button.dataset.retryAt);
        const remainingSeconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000));
        button.disabled = remainingSeconds > 0;
        button.textContent = remainingSeconds > 0 ? `${remainingSeconds} 秒后重试` : '重试评论';
        if (remainingSeconds === 0) button.removeAttribute('title');
        pending ||= remainingSeconds > 0;
      });
    if (pending) {
      this.retryCountdownTimer = window.setTimeout(() => this.scheduleRetryCountdown(), 1_000);
    }
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
    time.href = getNativeFloorUrl(post.post_number);
    const timestamp = createElement(
      'time',
      '',
      `#${post.post_number} · ${formatDate(post.created_at)}`,
    );
    timestamp.dateTime = post.created_at;
    time.appendChild(timestamp);
    heading.appendChild(time);

    let cooked: HTMLElement;
    if (post.deleted_at && !post.cooked.trim()) {
      cooked = createElement('div', 'cooked');
      cooked.classList.add('ldtk-deleted-placeholder');
      cooked.textContent = '此回复已删除';
    } else {
      cooked = createCooked(post.cooked);
    }
    body.append(heading, cooked, this.createPostControls(post));
    const boosts = this.createBoosts(post);
    if (boosts) body.appendChild(boosts);
    article.append(avatar, body);
    return article;
  }

  private createPostControls(post: TopicPost): HTMLElement {
    const controls = createElement('nav', 'post-controls ldtk-post-controls');
    controls.style.position = 'relative';
    controls.setAttribute('aria-label', `${post.post_number} 楼操作`);
    const actions = createElement('div', 'actions ldtk-post-actions');
    const like = post.actions_summary?.find((action) => action.id === 2);
    const hasLiked = post.current_user_used_main_reaction ?? like?.acted === true;
    const currentReactionId = post.current_user_reaction?.id;
    const hasCustomReaction = Boolean(currentReactionId && !hasLiked);
    const hasReaction = hasLiked || Boolean(currentReactionId);

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

    const reactionSummary = this.createPostReactionSummary(post);
    if (reactionSummary) controls.appendChild(reactionSummary);

    if (
      this.source.topic.accepted_answers?.some((answer) => answer.post_number === post.post_number)
    ) {
      const solution = createElement('span', 'ldtk-post-accepted');
      solution.setAttribute('aria-label', '已采纳为解决方案');
      solution.append(createDiscourseIcon('check'), '解决方案');
      controls.appendChild(solution);
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
      likeButton.dataset.openReactions = 'true';
      likeButton.setAttribute('aria-haspopup', 'dialog');
      likeButton.setAttribute('aria-expanded', 'false');
    }

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

    const canFlag = post.actions_summary?.some(
      (action) => action.id !== 2 && action.can_act === true,
    );
    if (canFlag)
      addNativeAction(actions, 'flag', 'flag', '举报', 'post-action-menu__flag btn-icon');
    if (post.can_recover)
      addNativeAction(
        actions,
        'recover',
        'rotate-left',
        '恢复',
        'post-action-menu__recover btn-icon',
      );

    if (this.source.topic.details?.can_create_post !== false) {
      addNativeAction(
        actions,
        'reply',
        'reply',
        `回复 ${post.username}`,
        'post-action-menu__reply reply btn-icon',
      );
    }

    controls.appendChild(actions);
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

  private openBoostEditor(button: HTMLButtonElement): void {
    const postId = Number(button.dataset.postId);
    const floor = Number(button.dataset.floor);
    if (!postId || !floor) return;
    const owner = button.closest<HTMLElement>('.ldtk-post-actions, .discourse-boosts__list');
    if (!owner) return;
    const existing = owner.parentElement?.querySelector<HTMLElement>('.ldtk-boost-editor');
    if (existing) {
      existing.querySelector<HTMLInputElement>('.ldtk-boost-input')?.focus();
      return;
    }

    const form = createElement('form', 'ldtk-boost-editor');
    form.dataset.postId = String(postId);
    form.dataset.floor = String(floor);
    form.noValidate = true;
    const field = createElement('div', 'ldtk-boost-field');
    const inputId = `ldtk-boost-${postId}-${++actionRequestSequence}`;
    const label = createElement('label', 'ldtk-boost-label', '助推内容');
    label.htmlFor = inputId;
    const input = createElement('input', 'ldtk-boost-input');
    input.id = inputId;
    input.type = 'text';
    input.maxLength = 16;
    input.autocomplete = 'off';
    input.placeholder = '输入 1-16 个字符';
    const description = createElement('p', 'ldtk-boost-meta', '最多 16 个字符，按 Enter 提交');
    description.id = `${inputId}-description`;
    input.setAttribute('aria-describedby', description.id);
    field.append(label, input, description);

    const submit = createIconButton('ldtk-boost-submit', 'check', '提交助推');
    submit.type = 'submit';
    submit.disabled = true;
    const cancel = createIconButton('ldtk-boost-cancel', 'xmark', '取消助推');
    const close = (): void => {
      form.remove();
      button.setAttribute('aria-expanded', 'false');
      button.focus({ preventScroll: true });
    };
    cancel.addEventListener('click', close);
    input.addEventListener('input', () => {
      submit.disabled = input.value.trim().length === 0;
      input.removeAttribute('aria-invalid');
      form.querySelector('.ldtk-boost-error')?.remove();
      if (!input.hasAttribute('aria-describedby'))
        input.setAttribute('aria-describedby', description.id);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const raw = input.value.trim();
      if (!raw) return;
      this.requestPageAction(submit, {
        action: 'boost',
        postId,
        floor,
        boostRaw: raw,
        form,
        input,
      });
    });
    form.append(field, submit, cancel);
    owner.insertAdjacentElement('afterend', form);
    button.setAttribute('aria-expanded', 'true');
    input.focus({ preventScroll: true });
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

  private createAcceptedAnswers(answers: readonly TopicAcceptedAnswer[]): HTMLElement {
    const accordion = createElement(
      'aside',
      'accepted-answers d-post-accordion ldtk-accepted-answers',
    );
    const layout = createElement('div', 'd-post-accordion__layout');
    const header = createElement('div', 'd-post-accordion__header');
    const title = createElement('h3', 'accepted-answers__title');
    title.append(createDiscourseIcon('far-square-check'), '已解决');
    header.appendChild(title);
    if (answers.length > 1) {
      header.appendChild(
        createElement('span', 'accepted-answers__solution-count', `${answers.length} 解决方案`),
      );
    }

    const items = createElement('div', 'd-post-accordion__items');
    answers.forEach((answer, index) => {
      const hasContent = Boolean(answer.cooked?.trim());
      const expanded = hasContent && index === 0;
      const item = createElement(
        'div',
        `quote d-post-accordion-item ldtk-solution-item${
          hasContent ? ' d-post-accordion-item--has-content' : ''
        }`,
      );
      item.dataset.username = answer.username;
      item.dataset.post = String(answer.post_number);
      item.dataset.topic = String(answer.topic_id);
      if (expanded) item.dataset.expanded = 'true';
      if (hasContent && (answer.cooked?.length || 0) > 540) item.dataset.overflowing = 'true';
      item.style.setProperty('--max-lines-displayed', '6');

      const itemHeader = createElement('div', 'd-post-accordion-item__header');
      if (hasContent) itemHeader.dataset.toggleSolution = String(answer.id);
      const metadata = createElement('div', 'd-post-accordion-item__metadata');
      const user = createElement('a', 'user-link');
      user.href = `/u/${encodeURIComponent(answer.username)}`;
      const avatarUrl = getAvatarUrl(answer.avatar_template);
      if (avatarUrl) {
        const avatar = createElement('img', 'avatar');
        avatar.src = avatarUrl;
        avatar.alt = '';
        avatar.width = 24;
        avatar.height = 24;
        avatar.loading = 'lazy';
        user.appendChild(avatar);
      }
      user.appendChild(createElement('span', '', answer.name || answer.username));
      const dot = createElement('span', 'dot-separator');
      const date = createElement('a', 'date-link');
      date.href = answer.url || getNativeFloorUrl(answer.post_number);
      date.title = formatDate(answer.created_at);
      date.setAttribute('aria-label', formatDate(answer.created_at));
      const createdAt = createElement('time', '', formatRelativeDate(answer.created_at));
      createdAt.dateTime = answer.created_at;
      date.appendChild(createdAt);
      metadata.append(user, dot, date);

      const controls = createElement('div', 'd-post-accordion-item__controls');
      if (hasContent) {
        const toggle = createIconButton(
          'btn btn-flat d-post-accordion-item__toggle',
          expanded ? 'chevron-up' : 'chevron-down',
          expanded ? '收起' : '展开',
        );
        toggle.setAttribute('aria-expanded', String(expanded));
        controls.appendChild(toggle);
      } else {
        const jump = createElement('a', 'btn btn-flat d-post-accordion-item__jump');
        jump.href = answer.url || getNativeFloorUrl(answer.post_number);
        jump.title = '跳转到解决方案';
        jump.setAttribute('aria-label', '跳转到解决方案');
        jump.appendChild(createDiscourseIcon('arrow-down'));
        controls.appendChild(jump);
      }
      itemHeader.append(metadata, controls);
      item.appendChild(itemHeader);

      if (hasContent) {
        const body = createElement('div', 'd-post-accordion-item__body');
        const quote = createElement('blockquote', 'd-post-accordion-item__content');
        quote.id = `ldtk-solution-${answer.id}`;
        quote.appendChild(createCooked(answer.cooked || ''));
        const readMore = createElement('div', 'd-post-accordion-item__read-more');
        const link = createElement('a', 'read-more-link ldtk-solution-more', '阅读更多');
        link.href = answer.url || getNativeFloorUrl(answer.post_number);
        readMore.appendChild(link);
        body.append(quote, readMore);
        item.appendChild(body);
      }
      items.appendChild(item);
    });

    layout.append(header, items);
    accordion.appendChild(layout);
    return accordion;
  }

  private getSharedIssueLabel(count = this.source.topic.shared_issue_count || 0): string {
    return count > 0 ? `俺也一样 (${count})` : '俺也一样';
  }

  private createSharedIssueButton(): HTMLButtonElement | null {
    const topic = this.source.topic;
    if (topic.shared_issue_visible !== true) return null;
    const label = this.getSharedIssueLabel();
    const button = createButton(
      'btn btn-icon-text btn-default ldtk-shared-issue-button post-action-menu__solved-shared-issue',
      '',
      label,
    );
    button.title = label;
    button.append(createDiscourseIcon('hand'), createElement('span', 'd-button-label', label));
    button.dataset.topicAction = 'sharedIssue';
    button.dataset.postId = String(this.source.article.id);
    button.dataset.floor = '1';
    button.setAttribute('aria-pressed', String(topic.user_created_shared_issue === true));
    button.classList.toggle('has-shared-issue', topic.user_created_shared_issue === true);

    if (this.source.article.yours === true) {
      button.disabled = true;
      button.title = '主题作者不能标记相同问题';
    } else if (topic.closed === true) {
      button.disabled = true;
      button.title = '主题已关闭';
    } else if (topic.archived === true) {
      button.disabled = true;
      button.title = '主题已归档';
    }
    button.classList.toggle('disabled', button.disabled);
    return button;
  }

  private createSolvedArea(): HTMLElement | null {
    const answers = this.source.topic.accepted_answers || [];
    const sharedIssueButton = this.createSharedIssueButton();
    if (answers.length === 0 && !sharedIssueButton) return null;
    const area = createElement('section', 'ldtk-article-solved');
    if (answers.length > 0) area.appendChild(this.createAcceptedAnswers(answers));
    if (sharedIssueButton) {
      const row = createElement('div', 'solved-shared-issue-row');
      row.appendChild(sharedIssueButton);
      area.appendChild(row);
    }
    return area;
  }

  private updateSharedIssueButton(
    button: HTMLButtonElement,
    count: number,
    userCreatedSharedIssue: boolean,
  ): void {
    this.source.topic.shared_issue_count = count;
    this.source.topic.user_created_shared_issue = userCreatedSharedIssue;
    const label = this.getSharedIssueLabel(count);
    button.querySelector<HTMLElement>('.d-button-label')?.replaceChildren(label);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', String(userCreatedSharedIssue));
    button.classList.toggle('has-shared-issue', userCreatedSharedIssue);
  }

  private toggleAcceptedAnswer(header: HTMLElement): void {
    const item = header.closest<HTMLElement>('.d-post-accordion-item');
    const button = header.querySelector<HTMLButtonElement>('.d-post-accordion-item__toggle');
    if (!item || !button) return;
    const expanded = !item.hasAttribute('data-expanded');
    if (expanded) item.dataset.expanded = 'true';
    else item.removeAttribute('data-expanded');
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? '收起' : '展开');
    button.title = expanded ? '收起' : '展开';
    setButtonIcon(button, expanded ? 'chevron-up' : 'chevron-down');
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
    const serializedUrl = post.reactions?.find((reaction) => reaction.id === reactionId)?.emoji_url;
    const cached = this.reactionImages.get(post.id);
    const url = serializedUrl || (cached?.id === reactionId ? cached.url : undefined);
    if (!url) return null;
    const image = document.createElement('img');
    image.src = url;
    image.className = 'btn-toggle-reaction-emoji reaction-button';
    image.alt = `:${reactionId}:`;
    image.setAttribute('aria-hidden', 'true');
    image.draggable = false;
    image.removeAttribute('style');
    image.removeAttribute('width');
    image.removeAttribute('height');
    return image;
  }

  private createLikeUsersCountButton(post: TopicPost, count: number): HTMLButtonElement {
    const button = createPostMenuButton({
      className: 'post-action-menu__like-count button-count like-count',
      icon: 'd-liked',
      label: `${count} 个赞，查看表态用户`,
      visibleLabel: formatCompactNumber(count),
    });
    button.dataset.topicAction = 'likeUsers';
    button.dataset.postId = String(post.id);
    button.dataset.floor = String(post.post_number);
    button.dataset.reactionSummaryId = 'heart';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    return button;
  }

  private createPostReactionImage(url: string): HTMLImageElement {
    const image = createElement('img', 'ldtk-post-reaction-image');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.draggable = false;
    return image;
  }

  private createSerializedReactionSummary(reaction: TopicPostReaction): HTMLElement {
    const summary = createElement('span', 'ldtk-post-reaction-summary');
    summary.dataset.reactionSummaryId = reaction.id;
    const count = Math.max(0, reaction.count);
    const label = `${reaction.id} 表态 ${count} 次`;
    summary.setAttribute('aria-label', label);
    summary.title = label;
    const url = reaction.emoji_url || this.reactionOptions.get(reaction.id)?.url;
    if (url) {
      summary.appendChild(this.createPostReactionImage(url));
    } else {
      summary.appendChild(createElement('span', 'ldtk-post-reaction-code', `:${reaction.id}:`));
    }
    summary.appendChild(
      createElement('span', 'ldtk-post-reaction-count', formatCompactNumber(count)),
    );
    return summary;
  }

  private hydratePostReactionSummary(summary: HTMLElement, post: TopicPost): void {
    const missingImages = summary.querySelectorAll<HTMLElement>(
      '.ldtk-post-reaction-summary .ldtk-post-reaction-code',
    );
    if (missingImages.length === 0) return;
    void this.loadReactionOptions(summary, post.id, post.post_number)
      .then(() => {
        if (this.destroyed || !summary.isConnected) return;
        summary
          .querySelectorAll<HTMLElement>('.ldtk-post-reaction-summary[data-reaction-summary-id]')
          .forEach((item) => {
            const reactionId = item.dataset.reactionSummaryId;
            const placeholder = item.querySelector<HTMLElement>('.ldtk-post-reaction-code');
            const url = reactionId ? this.reactionOptions.get(reactionId)?.url : undefined;
            if (placeholder && url) placeholder.replaceWith(this.createPostReactionImage(url));
          });
      })
      .catch(() => {
        // Keep the readable reaction shortcode when Discourse's emoji service is unavailable.
      });
  }

  private createPostReactionSummary(post: TopicPost): HTMLElement | null {
    const reactions = (post.reactions || [])
      .map((reaction, index) => ({ reaction, index }))
      .filter(({ reaction }) => reaction.count > 0)
      .sort((left, right) => right.reaction.count - left.reaction.count || left.index - right.index)
      .slice(0, 3)
      .map(({ reaction }) => reaction);
    const fallbackCount = this.getPostReactionCount(post);
    if (reactions.length === 0 && fallbackCount === 0) return null;

    const summary = createElement('div', 'ldtk-post-reactions');
    summary.setAttribute('aria-label', '评论表态');
    if (reactions.length === 0) {
      summary.appendChild(this.createLikeUsersCountButton(post, fallbackCount));
      return summary;
    }
    reactions.forEach((reaction) => {
      summary.appendChild(
        reaction.id === 'heart'
          ? this.createLikeUsersCountButton(post, reaction.count)
          : this.createSerializedReactionSummary(reaction),
      );
    });
    if (
      reactions.some(
        (reaction) =>
          reaction.id !== 'heart' && !reaction.emoji_url && !this.reactionOptions.has(reaction.id),
      )
    ) {
      queueMicrotask(() => {
        if (!this.destroyed && summary.isConnected) this.hydratePostReactionSummary(summary, post);
      });
    }
    return summary;
  }

  private getPostReactionCount(post: TopicPost): number {
    const likeCount = post.actions_summary?.find((action) => action.id === 2)?.count || 0;
    const serializedCount = (post.reactions || []).reduce(
      (total, reaction) => total + Math.max(0, reaction.count),
      0,
    );
    return Math.max(0, post.reaction_users_count || 0, likeCount, serializedCount);
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
    const cooked = createCooked(post.cooked);
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
      const replies = await fetchPostReplies(
        postId,
        after,
        request.signal,
        String(this.source.topic.id),
        this.route.floor,
      );
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
      const replies = await fetchPostReplies(
        postId,
        1,
        request.signal,
        String(this.source.topic.id),
        this.route.floor,
      );
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

  private requestPageAction(
    button: HTMLButtonElement,
    override?: {
      action: TopicAction;
      postId: number;
      floor: number;
      boostRaw?: string;
      reactionId?: string;
      form?: HTMLFormElement;
      input?: HTMLInputElement;
      onSuccess?: (result: NonNullable<ReturnType<typeof parseTopicActionResult>>) => void;
      onError?: (message: string) => void;
    },
  ): void {
    const action = override?.action ?? (button.dataset.topicAction as TopicAction | undefined);
    const postId = override?.postId ?? Number(button.dataset.postId);
    const floor = override?.floor ?? Number(button.dataset.floor);
    if (!action || !postId || !floor) return;
    if (action === 'share') {
      button.disabled = true;
      void copyToClipboard(getNativeFloorUrl(floor))
        .then(() => showToast('已复制此楼链接'))
        .catch(() => showToast('复制链接失败，请重试'))
        .finally(() => {
          button.disabled = false;
        });
      return;
    }
    const request: TopicActionRequest = {
      requestId: `${Date.now()}:${++actionRequestSequence}`,
      topicId: this.source.topic.id,
      postId,
      floor,
      action,
      routeUrl: this.buildActionRoute(floor),
      ...(override?.boostRaw === undefined ? {} : { boostRaw: override.boostRaw }),
      ...(override?.reactionId === undefined ? {} : { reactionId: override.reactionId }),
    };
    const finish = (): void => {
      window.clearTimeout(timeout);
      button.disabled = false;
      button.removeAttribute('aria-busy');
      override?.form?.removeAttribute('aria-busy');
      button.removeEventListener(TOPIC_ACTION_RESULT_NAME, handleResult);
    };
    const handleResult = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const result = parseTopicActionResult(event.detail);
      if (!result || result.requestId !== request.requestId) return;
      if (!result.ok) {
        finish();
        const message = result.message || '操作失败，请重试';
        if (override?.form && override.input) {
          override.form.querySelector('.ldtk-boost-error')?.remove();
          const error = createElement('p', 'ldtk-boost-error', message);
          error.id = `${override.input.id}-error`;
          error.setAttribute('role', 'alert');
          override.input.setAttribute('aria-invalid', 'true');
          override.input.setAttribute('aria-describedby', error.id);
          override.form.querySelector('.ldtk-boost-field')?.appendChild(error);
          override.input.focus({ preventScroll: true });
        } else if (override?.onError) {
          override.onError(message);
        } else {
          showToast(message);
        }
        return;
      }
      finish();
      override?.form?.remove();
      if (
        action === 'sharedIssue' &&
        result.sharedIssueCount !== undefined &&
        result.userCreatedSharedIssue !== undefined
      ) {
        this.updateSharedIssueButton(
          button,
          result.sharedIssueCount,
          result.userCreatedSharedIssue,
        );
      }
      override?.onSuccess?.(result);
      if (['like', 'bookmark', 'boost', 'delete', 'recover'].includes(action)) {
        void this.updateVisiblePost({ topicId: request.topicId, postId, type: 'revised' });
      }
    };
    const timeout = window.setTimeout(() => {
      finish();
      const message = '静默操作响应超时，请重试';
      if (override?.onError) override.onError(message);
      else showToast(message);
    }, 15_000);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    override?.form?.setAttribute('aria-busy', 'true');
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

  private closeInlinePopover(popover: HTMLElement, restoreFocus = true): void {
    if (popover.classList.contains('ldtk-reaction-picker')) {
      this.cancelReactionPickerClose();
    }
    const triggerId = popover.dataset.triggerId;
    const trigger = triggerId ? document.getElementById(triggerId) : null;
    popover.remove();
    if (trigger instanceof HTMLButtonElement) {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) {
        const suppressReactionFocusOpen = popover.classList.contains('ldtk-reaction-picker');
        if (suppressReactionFocusOpen) this.suppressReactionFocusOpen = true;
        trigger.focus({ preventScroll: true });
        if (suppressReactionFocusOpen) this.suppressReactionFocusOpen = false;
      }
    }
  }

  private closeInlinePopovers(except?: HTMLElement): void {
    this.root.querySelectorAll<HTMLElement>('.ldtk-inline-popover').forEach((popover) => {
      if (popover !== except) this.closeInlinePopover(popover, false);
    });
  }

  private positionInlinePopover(button: HTMLButtonElement, popover: HTMLElement): void {
    const rootRect = this.root.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const inset = 12;
    const gap = 6;
    const width = popoverRect.width || Math.min(340, Math.max(0, rootRect.width - inset * 2));
    const height = popoverRect.height || popover.scrollHeight;
    const maxLeft = Math.max(inset, rootRect.width - inset - width);
    const left = Math.min(Math.max(inset, buttonRect.left - rootRect.left), maxLeft);
    const spaceAbove = Math.max(0, buttonRect.top - rootRect.top - inset - gap);
    const spaceBelow = Math.max(0, rootRect.bottom - buttonRect.bottom - inset - gap);
    const openAbove = spaceBelow < height && spaceAbove > spaceBelow;
    const preferredTop = openAbove
      ? buttonRect.top - rootRect.top - gap - height
      : buttonRect.bottom - rootRect.top + gap;
    const maxTop = Math.max(inset, rootRect.height - inset - height);
    const top = Math.min(Math.max(inset, preferredTop), maxTop);

    popover.style.left = `${left}px`;
    popover.style.right = 'auto';
    popover.style.top = `${top}px`;
    popover.dataset.placement = openAbove ? 'top' : 'bottom';
  }

  private createInlinePopover(
    button: HTMLButtonElement,
    title: string,
    className: string,
  ): HTMLElement | null {
    const controls = button.closest<HTMLElement>('.ldtk-post-controls');
    if (!controls) return null;
    const buttonId = button.id || `ldtk-action-${++actionRequestSequence}`;
    button.id = buttonId;
    const existing = this.root.querySelector<HTMLElement>(`.ldtk-inline-popover.${className}`);
    if (existing) {
      const sameTrigger = existing.dataset.triggerId === buttonId;
      this.closeInlinePopover(existing, sameTrigger);
      if (sameTrigger) return null;
    }
    this.closeInlinePopovers();
    const popover = createElement('section', `ldtk-inline-popover ${className}`);
    popover.dataset.triggerId = buttonId;
    popover.tabIndex = -1;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'false');
    const headingId = `${buttonId}-popover-title`;
    popover.setAttribute('aria-labelledby', headingId);
    const header = createElement('header', 'ldtk-inline-popover-header');
    const heading = createElement('h3', 'ldtk-inline-popover-title', title);
    heading.id = headingId;
    const close = createIconButton(
      'ldtk-post-menu-button ldtk-inline-popover-close',
      'xmark',
      '关闭',
    );
    close.dataset.closePopover = 'true';
    header.append(heading, close);
    popover.appendChild(header);
    this.root.appendChild(popover);
    this.positionInlinePopover(button, popover);
    button.setAttribute('aria-expanded', 'true');
    return popover;
  }

  private requestInteraction(
    target: HTMLElement,
    request: Omit<TopicInteractionRequest, 'requestId' | 'topicId' | 'routeUrl'>,
  ): Promise<TopicInteractionResult> {
    const requestId = `${Date.now()}:${++actionRequestSequence}`;
    const detail: TopicInteractionRequest = {
      requestId,
      topicId: this.source.topic.id,
      routeUrl: this.buildActionRoute(request.floor),
      ...request,
    };
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        window.clearTimeout(timeout);
        target.removeEventListener(TOPIC_INTERACTION_RESULT_NAME, handleResult);
      };
      const handleResult = (event: Event): void => {
        if (!(event instanceof CustomEvent)) return;
        const result = parseTopicInteractionResult(event.detail);
        if (
          !result ||
          result.requestId !== requestId ||
          result.interaction !== request.interaction
        ) {
          return;
        }
        finish();
        if (result.ok) resolve(result);
        else reject(new Error(result.message || '操作失败，请重试'));
      };
      const timeout = window.setTimeout(() => {
        finish();
        reject(new Error('静默操作响应超时，请重试'));
      }, 15_000);
      target.addEventListener(TOPIC_INTERACTION_RESULT_NAME, handleResult);
      target.dispatchEvent(
        new CustomEvent(TOPIC_INTERACTION_REQUEST_NAME, {
          bubbles: true,
          detail: JSON.stringify(detail),
        }),
      );
    });
  }

  private loadReactionOptions(
    target: HTMLElement,
    postId: number,
    floor: number,
  ): Promise<TopicReactionOption[]> {
    if (this.reactionOptions.size > 0) {
      return Promise.resolve([...this.reactionOptions.values()]);
    }
    if (!this.reactionOptionsPromise) {
      this.reactionOptionsPromise = this.requestInteraction(target, {
        interaction: 'reactionOptions',
        postId,
        floor,
      })
        .then((result) => {
          const options = result.reactionOptions || [];
          options.forEach((option) => this.reactionOptions.set(option.id, option));
          return options;
        })
        .finally(() => {
          this.reactionOptionsPromise = null;
        });
    }
    return this.reactionOptionsPromise;
  }

  private openReactionPicker(button: HTMLButtonElement): HTMLElement | null {
    const postId = Number(button.dataset.postId);
    const floor = Number(button.dataset.floor);
    if (!postId || !floor) return null;
    const existing = this.root.querySelector<HTMLElement>('.ldtk-reaction-picker');
    if (existing?.dataset.triggerId === button.id) return existing;
    const popover = this.createInlinePopover(button, '选择表态', 'ldtk-reaction-picker');
    if (!popover) return null;
    const status = createElement('p', 'ldtk-inline-popover-status', '正在加载表态...');
    status.setAttribute('role', 'status');
    popover.appendChild(status);
    this.positionInlinePopover(button, popover);
    void this.loadReactionOptions(popover, postId, floor)
      .then((options) => {
        if (!popover.isConnected) return;
        const currentReactionId = this.source.getCachedPost(postId)?.current_user_reaction?.id;
        const list = createElement('div', 'ldtk-reaction-options');
        list.setAttribute('role', 'group');
        options.forEach((option) => {
          const item = createButton('ldtk-reaction-option', '', `使用 ${option.id} 表态`);
          item.dataset.reactionId = option.id;
          item.dataset.postId = String(postId);
          item.dataset.floor = String(floor);
          item.title = option.id;
          item.setAttribute('aria-pressed', String(currentReactionId === option.id));
          const image = createElement('img');
          image.src = option.url;
          image.alt = `:${option.id}:`;
          image.width = 24;
          image.height = 24;
          image.draggable = false;
          item.appendChild(image);
          list.appendChild(item);
        });
        status.replaceWith(list);
        if (popover.dataset.focusFirst === 'true') {
          delete popover.dataset.focusFirst;
          list.querySelector<HTMLButtonElement>('.ldtk-reaction-option')?.focus({
            preventScroll: true,
          });
        }
        this.positionInlinePopover(button, popover);
      })
      .catch((error: Error) => {
        if (!popover.isConnected) return;
        status.textContent = error.message;
        status.setAttribute('role', 'alert');
      });
    return popover;
  }

  private getReactionTrigger(target: EventTarget | null): HTMLButtonElement | null {
    if (!(target instanceof Element)) return null;
    const direct = target.closest<HTMLButtonElement>('[data-open-reactions][data-floor]');
    if (direct && this.root.contains(direct)) return direct;
    const popover = target.closest<HTMLElement>('.ldtk-reaction-picker');
    const triggerId = popover?.dataset.triggerId;
    const trigger = triggerId ? document.getElementById(triggerId) : null;
    return trigger instanceof HTMLButtonElement && this.root.contains(trigger) ? trigger : null;
  }

  private getReactionPopover(button: HTMLButtonElement): HTMLElement | null {
    if (!button.id) return null;
    return (
      Array.from(this.root.querySelectorAll<HTMLElement>('.ldtk-reaction-picker')).find(
        (popover) => popover.dataset.triggerId === button.id,
      ) || null
    );
  }

  private isWithinReactionPicker(button: HTMLButtonElement, target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return button.contains(target) || Boolean(this.getReactionPopover(button)?.contains(target));
  }

  private cancelReactionPickerClose(): void {
    if (this.reactionPickerCloseTimer === null) return;
    window.clearTimeout(this.reactionPickerCloseTimer);
    this.reactionPickerCloseTimer = null;
  }

  private scheduleReactionPickerClose(button: HTMLButtonElement): void {
    this.cancelReactionPickerClose();
    this.reactionPickerCloseTimer = window.setTimeout(() => {
      this.reactionPickerCloseTimer = null;
      const popover = this.getReactionPopover(button);
      if (popover) this.closeInlinePopover(popover, false);
    }, REACTION_PICKER_CLOSE_DELAY);
  }

  private readonly handleReactionPointerOver = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerType !== 'mouse') return;
    const button = this.getReactionTrigger(event.target);
    if (!button || this.isWithinReactionPicker(button, pointerEvent.relatedTarget)) return;
    this.cancelReactionPickerClose();
    this.openReactionPicker(button);
  };

  private readonly handleReactionPointerOut = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerType !== 'mouse') return;
    const button = this.getReactionTrigger(event.target);
    if (!button || this.isWithinReactionPicker(button, pointerEvent.relatedTarget)) return;
    this.scheduleReactionPickerClose(button);
  };

  private readonly handleReactionFocusIn = (event: FocusEvent): void => {
    if (this.suppressReactionFocusOpen) return;
    const button = this.getReactionTrigger(event.target);
    if (!button || this.isWithinReactionPicker(button, event.relatedTarget)) return;
    this.cancelReactionPickerClose();
    if (event.target === button) this.openReactionPicker(button);
  };

  private readonly handleReactionFocusOut = (event: FocusEvent): void => {
    const button = this.getReactionTrigger(event.target);
    if (!button || this.isWithinReactionPicker(button, event.relatedTarget)) return;
    this.scheduleReactionPickerClose(button);
  };

  private openLikeUsers(button: HTMLButtonElement): void {
    const postId = Number(button.dataset.postId);
    const floor = Number(button.dataset.floor);
    if (!postId || !floor) return;
    const post = this.source.getCachedPost(postId);
    if (!post) return;
    const total = this.getPostReactionCount(post);
    const popover = this.createInlinePopover(
      button,
      `${formatCompactNumber(total)} 个表态`,
      'ldtk-like-users-popover',
    );
    if (!popover) return;
    const status = createElement('p', 'ldtk-inline-popover-status', '正在加载表态用户...');
    status.setAttribute('role', 'status');
    const list = createElement('ul', 'ldtk-like-users-list');
    popover.append(status, list);
    this.positionInlinePopover(button, popover);
    popover.focus({ preventScroll: true });
    let page = 0;
    const loadMore = createButton('ldtk-like-users-more', '加载更多点赞用户');
    loadMore.dataset.loadLikeUsers = 'true';
    const load = (): void => {
      loadMore.disabled = true;
      loadMore.setAttribute('aria-busy', 'true');
      void this.requestInteraction(popover, {
        interaction: 'likeUsers',
        postId,
        floor,
        page,
        pageSize: LIKE_USERS_PAGE_SIZE,
      })
        .then((result) => {
          if (!popover.isConnected) return;
          this.appendLikeUsers(list, result.users || []);
          page += 1;
          status.remove();
          if (list.childElementCount === 0) {
            const empty = createElement('p', 'ldtk-inline-popover-status', '暂无可显示的表态用户');
            list.replaceWith(empty);
            loadMore.remove();
            return;
          }
          if (result.hasMore) {
            popover.appendChild(loadMore);
            loadMore.disabled = false;
            loadMore.removeAttribute('aria-busy');
          } else {
            loadMore.remove();
          }
          this.positionInlinePopover(button, popover);
        })
        .catch((error: Error) => {
          if (!popover.isConnected) return;
          status.textContent = error.message;
          status.setAttribute('role', 'alert');
          loadMore.disabled = false;
          loadMore.removeAttribute('aria-busy');
        });
    };
    loadMore.addEventListener('click', load);
    load();
  }

  private appendLikeUsers(list: HTMLElement, users: TopicInteractionUser[]): void {
    users.forEach((user) => {
      const item = createElement('li', 'ldtk-like-user');
      const avatarUrl = getAvatarUrl(user.avatarTemplate);
      if (avatarUrl) {
        const avatar = createElement('img', 'ldtk-like-user-avatar');
        avatar.src = avatarUrl;
        avatar.alt = '';
        avatar.width = 36;
        avatar.height = 36;
        avatar.loading = 'lazy';
        item.appendChild(avatar);
      } else {
        item.appendChild(createElement('span', 'ldtk-like-user-avatar-placeholder'));
      }
      const profile = createElement('span', 'ldtk-like-user-copy');
      profile.append(
        createElement('strong', '', user.name || user.username),
        createElement('span', '', `@${user.username}`),
      );
      item.appendChild(profile);
      list.appendChild(item);
    });
  }

  private buildActionRoute(floor: number): string {
    return getNativeFloorUrl(floor);
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
    this.observeRenderedComments();
    this.scheduleInjectButtons();
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

  private retryFailedComments(): void {
    if (this.pageAbort || this.failedCommentOffsets.size === 0) return;
    const retryOffsets = new Set(this.failedCommentOffsets);
    const request = new AbortController();
    this.pageAbort = request;
    this.setCommentsLoading(true);
    this.status.hidden = false;
    this.status.textContent = '正在重试失败评论...';
    this.commentsList
      .querySelectorAll<HTMLButtonElement>('[data-retry-comments]')
      .forEach((button) => {
        button.disabled = true;
      });
    void this.source
      .loadInitial(this.currentPage, this.settings.commentsPerPage, request.signal, {
        onCommentBatch: (batch) => {
          batch.posts.forEach((post, index) => {
            const offset = batch.pageOffset + index;
            if (retryOffsets.has(offset)) this.applyCommentBatch(offset, [post]);
          });
        },
        onCommentBatchError: (failure) => this.applyCommentBatchError(failure),
        onCommentsReady: (failedOffsets) => this.finalizeInitialComments(failedOffsets),
        onReplyTargets: () => this.enrichReplyTargets(),
      })
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError' || this.destroyed) return;
        this.status.hidden = false;
        this.status.textContent = '评论重试失败，请稍后再试';
      })
      .finally(() => {
        if (this.pageAbort !== request) return;
        this.pageAbort = null;
        if (!this.destroyed) this.setCommentsLoading(false);
      });
  }

  private async loadPage(page: number, targetFloor?: number): Promise<void> {
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
      if (targetFloor) this.highlightFloor(targetFloor);
    } catch (error) {
      if ((error as Error).name === 'AbortError' || this.pageAbort !== request) return;
      this.status.hidden = false;
      this.status.textContent = '评论加载失败，请重试';
      this.renderPagination();
    } finally {
      if (this.pageAbort === request) {
        this.pageAbort = null;
        this.setCommentsLoading(false);
      }
    }
  }

  private async goToFloor(floor: number): Promise<void> {
    if (floor <= 1) {
      this.articleScroll.scrollTo({ top: 0, behavior: 'smooth' });
      const article = this.articlePane.querySelector<HTMLElement>('.topic-post');
      if (article) addHighlight(article);
      return;
    }
    const page = getCommentPageForFloor(floor, this.settings.commentsPerPage);
    if (page === this.currentPage) this.highlightFloor(floor);
    else await this.loadPage(page, floor);
  }

  private highlightFloor(floor: number): void {
    const slot = this.commentsList.querySelector<HTMLElement>(
      `.ldtk-comment-slot [data-post-number="${floor}"]`,
    );
    if (slot) {
      slot.scrollIntoView({ block: 'center', behavior: 'smooth' });
      addHighlight(slot);
      return;
    }
    const post = this.commentsList.querySelector<HTMLElement>(`[data-post-number="${floor}"]`);
    post?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (post) addHighlight(post);
  }

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const closePopover = target.closest<HTMLButtonElement>('[data-close-popover]');
    if (closePopover) {
      event.preventDefault();
      const popover = closePopover.closest<HTMLElement>('.ldtk-inline-popover');
      if (popover) this.closeInlinePopover(popover);
      return;
    }
    const reactionOption = target.closest<HTMLButtonElement>('[data-reaction-id][data-post-id]');
    if (reactionOption) {
      event.preventDefault();
      const reactionId = reactionOption.dataset.reactionId;
      const postId = Number(reactionOption.dataset.postId);
      const floor = Number(reactionOption.dataset.floor);
      const popover = reactionOption.closest<HTMLElement>('.ldtk-reaction-picker');
      if (!reactionId || !postId || !floor || !popover) return;
      popover.querySelectorAll<HTMLButtonElement>('.ldtk-reaction-option').forEach((button) => {
        button.disabled = true;
      });
      const reportError = (message: string): void => {
        popover.querySelector('.ldtk-inline-popover-status')?.remove();
        const error = createElement('p', 'ldtk-inline-popover-status', message);
        error.setAttribute('role', 'alert');
        popover.appendChild(error);
        popover.querySelectorAll<HTMLButtonElement>('.ldtk-reaction-option').forEach((button) => {
          button.disabled = false;
        });
        reactionOption.focus({ preventScroll: true });
      };
      this.requestPageAction(reactionOption, {
        action: 'reaction',
        postId,
        floor,
        reactionId,
        onSuccess: () => {
          const option = this.reactionOptions.get(reactionId);
          if (option) this.reactionImages.set(postId, { id: reactionId, url: option.url });
          this.closeInlinePopover(popover, false);
          void this.updateVisiblePost({ topicId: this.source.topic.id, postId, type: 'acted' });
        },
        onError: reportError,
      });
      return;
    }
    const copyCodeButton = target.closest<HTMLButtonElement>('[data-copy-code]');
    if (copyCodeButton) {
      event.preventDefault();
      this.copyCodeBlock(copyCodeButton);
      return;
    }
    const retryCommentsButton = target.closest<HTMLButtonElement>('[data-retry-comments]');
    if (retryCommentsButton) {
      event.preventDefault();
      this.retryFailedComments();
      return;
    }
    const pageButton = target.closest<HTMLButtonElement>('[data-page]');
    if (pageButton && this.pagination.contains(pageButton)) {
      event.preventDefault();
      void this.loadPage(Number(pageButton.dataset.page));
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
      void copyToClipboard(getNativeFloorUrl(floor))
        .then(() => showToast('已复制此楼链接'))
        .catch(() => showToast('复制链接失败，请重试'))
        .finally(() => {
          copyLinkButton.disabled = false;
        });
      return;
    }
    const solutionHeader = target.closest<HTMLElement>('[data-toggle-solution]');
    if (solutionHeader && !target.closest('a')) {
      event.preventDefault();
      this.toggleAcceptedAnswer(solutionHeader);
      return;
    }
    const actionButton = target.closest<HTMLButtonElement>('[data-topic-action][data-floor]');
    if (actionButton) {
      event.preventDefault();
      if (actionButton.dataset.topicAction === 'boost') this.openBoostEditor(actionButton);
      else if (actionButton.dataset.topicAction === 'likeUsers') this.openLikeUsers(actionButton);
      else this.requestPageAction(actionButton);
      return;
    }
    const targetButton = target.closest<HTMLButtonElement>('[data-target-floor]');
    if (targetButton) {
      event.preventDefault();
      void this.goToFloor(Number(targetButton.dataset.targetFloor));
      return;
    }

    const complexEmbed = target.closest('.poll, [data-poll-name], iframe, .lazyYT-container');
    if (complexEmbed) {
      event.preventDefault();
      showToast('此内容暂不支持在双栏内操作');
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
      void this.goToFloor(floor);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const reactionButton =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-open-reactions][data-floor]')
        : null;
    if (reactionButton && event.key === 'ArrowDown') {
      event.preventDefault();
      const popover = this.openReactionPicker(reactionButton);
      const firstOption = popover?.querySelector<HTMLButtonElement>('.ldtk-reaction-option');
      if (firstOption) firstOption.focus({ preventScroll: true });
      else if (popover) popover.dataset.focusFirst = 'true';
      return;
    }
    if (reactionButton && event.key === 'Escape') {
      const popover = this.getReactionPopover(reactionButton);
      if (!popover) return;
      event.preventDefault();
      this.closeInlinePopover(popover, false);
      return;
    }
    if (event.key !== 'Escape') return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    const popover =
      target instanceof Element
        ? target.closest<HTMLElement>('.ldtk-inline-popover')
        : target.parentElement?.closest<HTMLElement>('.ldtk-inline-popover');
    if (!popover) return;
    event.preventDefault();
    this.closeInlinePopover(popover);
  };

  private copyCodeBlock(button: HTMLButtonElement): void {
    const code = getCodeText(button);
    if (code === null) return;

    button.disabled = true;
    void copyToClipboard(code)
      .then(() => {
        const pendingReset = this.codeCopyResetTimers.get(button);
        if (pendingReset !== undefined) window.clearTimeout(pendingReset);
        button.classList.add('action-complete');
        button.setAttribute('aria-label', '代码已复制');
        button.replaceChildren(createElement('span', '', '已复制'));
        const resetTimer = window.setTimeout(() => {
          button.classList.remove('action-complete');
          button.setAttribute('aria-label', '复制代码');
          button.replaceChildren(createDiscourseIcon('copy'));
          this.codeCopyResetTimers.delete(button);
        }, CODE_COPY_RESET_DELAY);
        this.codeCopyResetTimers.set(button, resetTimer);
      })
      .catch(() => showToast('复制代码失败，请重试'))
      .finally(() => {
        button.disabled = false;
      });
  }

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
    void this.loadPage(page);
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
      articleColumnWidthPercent: this.articleColumnWidthPercent,
    });
  }
}

interface ReusableTopicData {
  topicId: string;
  pageRoot: HTMLElement;
  source: TopicDataSource;
  articleReplies: TopicPost[];
}

export type TopicLayoutRuntimeState = 'disabled' | 'unsupported' | 'loading' | 'active' | 'failed';

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
  }

  suspend(): void {
    this.reusableData = null;
    this.cleanupLayout();
    this.state = 'unsupported';
  }

  invalidate(): void {
    this.reusableData = null;
  }

  reconcilePageContext(): void {
    if (
      this.activeLayout &&
      (!this.activeContext || !isTopicPageContextCurrent(this.activeContext))
    ) {
      this.suspend();
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
      this.suspend();
      return;
    }
    const { route, pageRoot } = context;

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
    const activationId = beginTopicActivation(route, getTopicResponsePrefetchStatus(route));
    let activationFinished = false;
    const finishActivation = (finalState: Parameters<typeof finishTopicActivation>[1]): void => {
      if (activationFinished) return;
      activationFinished = true;
      finishTopicActivation(activationId, finalState);
    };
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
        (await TopicDataSource.create(route.topicId, request.signal, route.floor, force));
      markTopicPerfStage(activationId, 'topic_fetch');
      if (!this.canContinueActivation(version, context, source.topic.id)) {
        finishActivation('aborted');
        return;
      }
      if (source.isMegaTopic) {
        if (retainedLayout) {
          this.state = 'active';
          showToast('主题内容过多，已保留当前双栏内容');
        } else {
          this.cleanupLayout();
          this.state = 'unsupported';
        }
        finishActivation('unsupported');
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
      setTopicPerfInitialPage(activationId, initialPage);
      const createCandidate = (): TopicLayout =>
        new TopicLayout(route, source, settings, initialPage, {
          requestRefresh: () => {
            const currentSettings = this.latestSettings;
            return currentSettings ? this.activate(currentSettings, true) : Promise.resolve();
          },
        });

      const progressive = !retainedLayout;
      const pendingBatches: Array<{ pageOffset: number; posts: readonly TopicPost[] }> = [];
      const pendingFailures: InitialCommentBatchError[] = [];
      let failedPageOffsets: readonly number[] = [];
      let firstCommentMarked = false;
      let batchSequence = 0;
      let articleRepliesRequest: Promise<TopicPost[]> | null = cachedData
        ? Promise.resolve(cachedData.articleReplies)
        : null;
      const startArticleReplies = (): Promise<TopicPost[]> => {
        articleRepliesRequest ??=
          (source.article.reply_count || 0) > 0
            ? fetchPostReplies(
                source.article.id,
                1,
                request.signal,
                route.topicId,
                route.floor,
              ).catch((error: unknown) => {
                if ((error as Error).name === 'AbortError') throw error;
                return [];
              })
            : Promise.resolve([]);
        return articleRepliesRequest;
      };

      if (retainedLayout) {
        markTopicPerfStage(activationId, 'shell');
        markTopicPerfStage(activationId, 'overlay_hidden');
      } else {
        candidate = createCandidate();
        candidate.mountShell();
        this.activeLayout = candidate;
        this.activeContext = context;
        markTopicPerfStage(activationId, 'shell');
        hideLoadingOverlay();
        markTopicPerfStage(activationId, 'overlay_hidden');
        if (source.articleReady) {
          markTopicPerfStage(activationId, 'article');
          void startArticleReplies();
        }
      }

      const initialResult = await source.loadInitial(
        initialPage,
        settings.commentsPerPage,
        request.signal,
        {
          onArticle: () => {
            if (!this.canContinueActivation(version, context, source.topic.id)) return;
            void startArticleReplies();
            if (!progressive) return;
            candidate?.revealArticle();
            markTopicPerfStage(activationId, 'article');
          },
          onCommentBatch: (batch) => {
            if (!this.canContinueActivation(version, context, source.topic.id)) return;
            markTopicPerfStage(activationId, `posts_batch_${++batchSequence}`);
            if (progressive) candidate?.applyCommentBatch(batch.pageOffset, batch.posts);
            else pendingBatches.push(batch);
            if (!firstCommentMarked && batch.posts.length > 0) {
              firstCommentMarked = true;
              if (progressive) markTopicPerfStage(activationId, 'first_comment');
            }
          },
          onCommentBatchError: (failure) => {
            if (!this.canContinueActivation(version, context, source.topic.id)) return;
            if (progressive) candidate?.applyCommentBatchError(failure);
            else pendingFailures.push(failure);
          },
          onCommentsReady: (failedOffsets) => {
            if (!this.canContinueActivation(version, context, source.topic.id)) return;
            failedPageOffsets = failedOffsets;
            if (progressive) candidate?.finalizeInitialComments(failedOffsets);
            markTopicPerfStage(activationId, 'ready');
          },
          onReplyTargets: () => {
            if (!this.canContinueActivation(version, context, source.topic.id)) return;
            if (progressive) candidate?.enrichReplyTargets();
          },
        },
      );
      failedPageOffsets = initialResult.failedPageOffsets;
      const articleReplies = await startArticleReplies();
      if (!this.canContinueActivation(version, context, source.topic.id)) {
        finishActivation('aborted');
        return;
      }

      if (retainedLayout) {
        retainedLayout.persistState();
        const previousFocus = retainedLayout.root.contains(document.activeElement)
          ? document.activeElement
          : null;
        candidate = createCandidate();
        candidate.mountShell(articleReplies);
        pendingBatches
          .sort((left, right) => left.pageOffset - right.pageOffset)
          .forEach((batch) => candidate?.applyCommentBatch(batch.pageOffset, batch.posts));
        pendingFailures.forEach((failure) => candidate?.applyCommentBatchError(failure));
        candidate.finalizeInitialComments(failedPageOffsets);
        candidate.enrichReplyTargets();
        markTopicPerfStage(activationId, 'article');
        if (firstCommentMarked) markTopicPerfStage(activationId, 'first_comment');
        retainedLayout.destroy(false, true);
        this.restoreRetainedFocus(previousFocus, candidate);
      } else {
        candidate?.revealArticle(articleReplies);
      }
      if (!candidate) throw new Error('双栏布局候选未创建');
      if (!this.canContinueActivation(version, context, source.topic.id)) {
        candidate.destroy(false, Boolean(retainedLayout));
        finishActivation('aborted');
        return;
      }
      markTopicPerfStage(activationId, 'enriched');
      this.activeLayout = candidate;
      this.activeContext = context;
      this.reusableData = { topicId: route.topicId, pageRoot, source, articleReplies };
      this.state = 'active';
      candidate = null;
      finishActivation('active');
    } catch (error) {
      candidate?.destroy(false, Boolean(retainedLayout));
      if (!this.isCurrent(version) || (error as Error).name === 'AbortError') {
        finishActivation('aborted');
        return;
      }
      if (!isTopicPageContextCurrent(context)) {
        finishActivation('aborted');
        this.suspend();
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
      finishActivation('failed');
    } finally {
      if (this.isCurrent(version)) this.loadingAbort = null;
      if (!activationFinished) finishActivation(request.signal.aborted ? 'aborted' : 'failed');
    }
  }

  private restoreRetainedFocus(previous: Element | null, candidate: TopicLayout): void {
    if (!(previous instanceof HTMLElement)) return;
    const postId = previous.closest<HTMLElement>('[data-post-id]')?.dataset.postId;
    const scope = postId
      ? candidate.root.querySelector<HTMLElement>(`[data-post-id="${postId}"]`)
      : candidate.root;
    if (!scope) return;
    const attributes = [
      'data-topic-action',
      'data-toggle-replies',
      'data-load-replies',
      'data-copy-post-link',
      'data-page',
      'data-retry-comments',
    ] as const;
    const matchingAttribute = attributes.find((attribute) => previous.hasAttribute(attribute));
    let replacement: HTMLElement | null = null;
    if (matchingAttribute) {
      const value = previous.getAttribute(matchingAttribute);
      replacement =
        Array.from(scope.querySelectorAll<HTMLElement>(`[${matchingAttribute}]`)).find(
          (element) => element.getAttribute(matchingAttribute) === value,
        ) || null;
    } else if (previous instanceof HTMLAnchorElement) {
      replacement =
        Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
          (anchor) => anchor.href === previous.href,
        ) || null;
    } else if (previous instanceof HTMLButtonElement) {
      replacement =
        Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) =>
            button.getAttribute('aria-label') === previous.getAttribute('aria-label') &&
            button.title === previous.title,
        ) || null;
    }
    replacement?.focus({ preventScroll: true });
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
    this.suspend();
    return false;
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
}

export const topicLayoutOwnedSelectors = [
  `.${ROOT_CLASS}`,
  `#${STYLE_ID}`,
  `#${LOADING_ROOT_ID}`,
  `#${LOADING_STYLE_ID}`,
] as const;
