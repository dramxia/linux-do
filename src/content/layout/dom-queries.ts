/* Linux.do 工具箱 — 布局模块共享常量与工具函数 */

export const BODY_CLASS = 'ldtk-topic-split-active';
export const WRAPPER_CLASS = 'ldtk-topic-split-wrapper';
export const ARTICLE_PANE_CLASS = 'ldtk-topic-article-pane';
export const ARTICLE_CLONE_CLASS = 'ldtk-topic-article-clone';
export const COMMENTS_PANE_CLASS = 'ldtk-topic-comments-pane';
export const COMMENTS_STREAM_CLASS = 'ldtk-topic-comments-stream';
export const HEADER_TITLE_CLASS = 'ldtk-topic-header-title';
export const HEADER_TITLE_INNER_CLASS = 'ldtk-topic-header-title-inner';
export const HEADER_META_CLASS = 'ldtk-topic-header-meta';
export const HEADER_META_INNER_CLASS = 'ldtk-topic-header-meta-inner';
export const ARTICLE_META_CLASS = 'ldtk-topic-article-meta';
export const ARTICLE_META_INNER_CLASS = 'ldtk-topic-article-meta-inner';
export const ARTICLE_ACTIONS_CLASS = 'ldtk-topic-article-actions';
export const FOOTER_ACTIONS_SOURCE_ATTR = 'data-ldtk-footer-actions-source';
export const FOOTER_ACTIONS_PLACEHOLDER_ATTR = 'data-ldtk-footer-actions-placeholder';
export const TOPIC_META_SOURCE_ATTR = 'data-ldtk-topic-meta-source';
export const NATIVE_STREAM_CLASS = 'ldtk-topic-native-stream';
export const ORIGINAL_MAIN_POST_CLASS = 'ldtk-topic-original-main-post';
export const PAGED_COMMENT_CLASS = 'ldtk-paged-comment';
export const PAGER_CLASS = 'ldtk-comments-pager';
export const PAGER_INFO_CLASS = 'ldtk-comments-pager-info';
export const PAGER_BUTTON_CLASS = 'ldtk-comments-pager-button';
export const PAGE_SIZE = 20;
export const TOPIC_META_SELECTORS = [
  '.topic-map',
  '.topic-map-expanded',
  '.topic-map__contents',
  '.topic-map-section',
  '.topic-map-summary',
  '.topic-map-stats',
  '.topic-map__stats',
  '.topic-stats',
];
export const FOOTER_ACTIONS_SELECTORS = '#topic-footer-buttons, .topic-footer-main-buttons';

// 集群 B：模块级可变状态。ES 模块的 live binding 对跨模块 reassignment 是只读的，
// 因此用容器对象承载 topic-meta 观察器与同步定时器，供 topic-meta-cloner 与
// header-title-cloner 共享读写。状态提取到类型化容器是 T6 的职责，此处仅做机械搬运。
export const topicMetaState: {
  observer: MutationObserver | null;
  syncTimer: ReturnType<typeof setTimeout> | null;
} = {
  observer: null,
  syncTimer: null,
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] as string));
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
