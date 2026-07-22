/* Linux.do 工具箱 — Markdown 转换模块 */

// 检测内容是否为 HTML（而非纯 Markdown）。
function isHtmlContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'text/html');
  const elCount = doc.body.querySelectorAll('*').length;

  if (elCount > 2) return true;

  for (const el of doc.body.querySelectorAll('*')) {
    if (el.attributes.length > 0) return true;
  }

  return /^<(?!p>|\/p>)[a-zA-Z][\s\S]*>/.test(trimmed);
}

function htmlTableToMarkdown(tableEl: HTMLElement): string {
  const rows: string[][] = [];
  tableEl.querySelectorAll('tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('td, th')).map((cell) => {
      return cell.textContent?.trim().replace(/\|/g, '\\|') || '';
    });
    rows.push(cells);
  });

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((row) => row.length));
  rows.forEach((row) => {
    while (row.length < colCount) row.push('');
  });

  const lines: string[] = [];
  lines.push('| ' + rows[0].join(' | ') + ' |');
  lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < rows.length; i += 1) {
    lines.push('| ' + rows[i].join(' | ') + ' |');
  }

  return '\n' + lines.join('\n') + '\n\n';
}

// 轻量 HTML → Markdown 转换器，覆盖 Discourse 常见结构。
function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(walk).join('');

    switch (tag) {
      case 'h1': return `\n# ${children.trim()}\n\n`;
      case 'h2': return `\n## ${children.trim()}\n\n`;
      case 'h3': return `\n### ${children.trim()}\n\n`;
      case 'h4': return `\n#### ${children.trim()}\n\n`;
      case 'h5': return `\n##### ${children.trim()}\n\n`;
      case 'h6': return `\n###### ${children.trim()}\n\n`;
      case 'p': return `\n${children.trim()}\n\n`;
      case 'br': return '\n';
      case 'hr': return '\n---\n\n';
      case 'strong':
      case 'b': {
        const text = children.trim();
        return text ? `**${text}**` : '';
      }
      case 'em':
      case 'i': {
        const text = children.trim();
        return text ? `*${text}*` : '';
      }
      case 'del':
      case 's': {
        const text = children.trim();
        return text ? `~~${text}~~` : '';
      }
      case 'code': {
        const text = children.trim();
        return text ? `\`${text}\`` : '';
      }
      case 'pre': {
        const codeEl = el.querySelector('code');
        const lang = codeEl?.className?.match(/lang-(\w+)/)?.[1] || '';
        const codeText = codeEl ? (codeEl.textContent || '') : (el.textContent || '');
        return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
      }
      case 'a': {
        const href = el.getAttribute('href') || '';
        const text = children.trim();
        if (!text) return '';
        return href && href !== text ? `[${text}](${href})` : text;
      }
      case 'img': {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || '';
        return src ? `![${alt}](${src})` : '';
      }
      case 'blockquote': {
        const lines = children.trim().split('\n').map((line) => `> ${line}`).join('\n');
        return `\n${lines}\n\n`;
      }
      case 'aside': {
        if (el.classList?.contains('quote')) {
          const titleEl = el.querySelector('.quote-controls, [data-username]');
          const quoteUser = el.getAttribute('data-username') || titleEl?.getAttribute('data-username') || '';
          const blockquote = el.querySelector(':scope > blockquote');
          const content = blockquote ? Array.from(blockquote.childNodes).map(walk).join('').trim() : children.trim();
          const attribution = quoteUser ? `**${quoteUser} said:**\n` : '';
          const lines = (attribution + content).split('\n').map((line) => `> ${line}`).join('\n');
          return `\n${lines}\n\n`;
        }
        return children;
      }
      case 'ul': {
        return '\n' + Array.from(el.children).map((li) => {
          return li.tagName?.toLowerCase() === 'li' ? `- ${walk(li).trim()}` : walk(li);
        }).join('\n') + '\n\n';
      }
      case 'ol': {
        return '\n' + Array.from(el.children).map((li, index) => {
          return li.tagName?.toLowerCase() === 'li' ? `${index + 1}. ${walk(li).trim()}` : walk(li);
        }).join('\n') + '\n\n';
      }
      case 'li': return children;
      case 'table': return htmlTableToMarkdown(el);
      case 'sup': return `<sup>${children}</sup>`;
      case 'sub': return `<sub>${children}</sub>`;
      case 'mark': return `==${children.trim()}==`;
      case 'span': {
        if (el.classList?.contains('mention')) return children.trim() || (el.textContent?.trim() || '');
        return children;
      }
      case 'div': {
        if (el.classList?.contains('lightbox-wrapper')) {
          const img = el.querySelector('img');
          if (img) {
            const src = img.getAttribute('data-original-href') || img.getAttribute('src') || '';
            const alt = img.getAttribute('alt') || '';
            return src ? `\n![${alt}](${src})\n` : children;
          }
        }
        if (el.classList?.contains('onebox')) {
          const link = el.querySelector('a[href]');
          const title = el.querySelector('.onebox-body h3, .source a')?.textContent?.trim() || '';
          const href = link?.getAttribute('href') || '';
          if (title && href) return `\n[${title}](${href})\n`;
        }
        return children;
      }
      case 'section':
      case 'article':
      case 'main':
      case 'nav':
      case 'header':
      case 'footer':
      case 'figure':
      case 'figcaption':
      case 'details':
      case 'summary':
      case 'dd':
      case 'dt':
      case 'dl':
      case 'abbr':
      case 'cite':
      case 'ins':
      case 'u':
        return children;
      default:
        return children;
    }
  }

  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}

export function ensureMarkdown(rawContent: string): string {
  const trimmed = rawContent.trim();
  return isHtmlContent(trimmed) ? htmlToMarkdown(trimmed) : trimmed;
}

export function normalizeDiscourseMd(md: string): string {
  return md.replace(/!\[([^\]]+?)\|(\d+x\d+(?:x\d+)?(?:\|[^\]]*)?)\]\(/g, '![$1](');
}

export const markdown = {
  isHtmlContent,
  htmlToMarkdown,
  htmlTableToMarkdown,
  ensureMarkdown,
  normalizeDiscourseMd,
};
