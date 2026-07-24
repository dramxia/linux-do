/* Linux.do 工具箱 — 布局模块共享常量与工具函数 */

export const BODY_CLASS = 'ldtk-topic-split-active';
export const PREPARING_ROOT_CLASS = 'ldtk-topic-split-preparing';
export const SIDEBAR_GUARD_CLASS = 'ldtk-topic-sidebar-collapsing';
export const WRAPPER_CLASS = 'ldtk-topic-split-wrapper';
export const ARTICLE_PANE_CLASS = 'ldtk-topic-article-pane';
export const COMMENTS_STREAM_CLASS = 'ldtk-topic-comments-stream';
export const HEADER_TITLE_CLASS = 'ldtk-topic-header-title';
export const HEADER_TITLE_INNER_CLASS = 'ldtk-topic-header-title-inner';
export const ARTICLE_ACTIONS_CLASS = 'ldtk-topic-article-actions';
export const FOOTER_ACTIONS_SOURCE_ATTR = 'data-ldtk-footer-actions-source';
export const FOOTER_ACTIONS_TOPIC_ATTR = 'data-ldtk-footer-actions-topic';
export const FOOTER_ACTIONS_PLACEHOLDER_ATTR = 'data-ldtk-footer-actions-placeholder';
export const FOOTER_ACTIONS_SELECTORS = '#topic-footer-buttons, .topic-footer-main-buttons';
export const NATIVE_STREAM_CLASS = 'ldtk-topic-native-stream';
export const ORIGINAL_MAIN_POST_CLASS = 'ldtk-topic-original-main-post';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] as string,
  );
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
