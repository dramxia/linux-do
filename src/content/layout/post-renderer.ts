/* Linux.do 工具箱 — 从 DiscoursePost JSON 创建 post DOM 元素 */
import type { DiscoursePost } from '../discourse';
import {
  PAGED_COMMENT_CLASS,
  escapeAttr,
  escapeHtml,
} from './dom-queries';

export function createPostFromJson(post: DiscoursePost): HTMLElement {
  const article = document.createElement('article');
  article.className = `topic-post ${PAGED_COMMENT_CLASS}`;
  article.setAttribute('data-post-id', String(post.id || ''));
  article.setAttribute('data-post-number', String(post.post_number || ''));

  const avatar = post.avatar_template
    ? post.avatar_template.replace('{size}', '45')
    : '';
  const createdAt = post.created_at || '';
  const cooked = post.cooked || '';

  article.innerHTML = `
    <div class="topic-avatar">
      ${avatar ? `<img class="avatar" width="45" height="45" src="${escapeAttr(avatar)}" alt="">` : ''}
    </div>
    <div class="topic-body">
      <div class="topic-meta-data">
        <span class="names">
          <span class="username">${escapeHtml(post.username || 'Unknown')}</span>
        </span>
        ${createdAt ? `<a class="post-date" href="#post-${escapeAttr(post.post_number || '')}"><time datetime="${escapeAttr(createdAt)}">${escapeHtml(createdAt.slice(0, 10))}</time></a>` : ''}
      </div>
      <div class="cooked">${cooked}</div>
      <section class="post-menu-area">
        <nav class="post-controls"></nav>
      </section>
    </div>
  `;

  return article;
}
