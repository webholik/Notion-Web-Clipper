import { Readability } from '@mozilla/readability';
import type { Annotations, Capture, ContentBlock, RichText } from './model';

import { safeUrl, richText } from './shared';
export { safeUrl, richText, textBlock } from './shared';

const skip = 'script,style,noscript,nav,form,button,input,textarea,select,iframe,svg,canvas,[hidden],[aria-hidden="true"],[inert]';
function inline(node: Node, base: string, marks: Annotations = {}, link?: string): RichText[] {
  if (node.nodeType === 3) return richText((node.textContent ?? '').replace(/\s+/g, ' '), marks, link);
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  if (el.matches(skip)) return [];
  if (el.tagName === 'BR') return richText('\n', marks, link);
  const mark: Record<string, keyof Annotations> = { STRONG: 'bold', B: 'bold', EM: 'italic', I: 'italic', S: 'strikethrough', DEL: 'strikethrough', U: 'underline', CODE: 'code' };
  const next = mark[el.tagName] ? { ...marks, [mark[el.tagName]]: true } : marks;
  const href = el.tagName === 'A' ? safeUrl(el.getAttribute('href') ?? '', base) : link;
  return Array.from(el.childNodes).flatMap(n => inline(n, base, next, href));
}

export function toBlocks(root: Element, base: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const emitRich = (type: string, value: RichText[]) => {
    // Notion arrays have at most 100 entries. Split rather than truncate.
    for (let i = 0; i < value.length; i += 40) {
      const rich_text = value.slice(i, i + 40);
      if (rich_text.some(t => t.text.content.trim())) blocks.push({ object: 'block', type, [type]: { rich_text } });
    }
  };
  const walk = (el: Element) => {
    if (el.matches(skip)) return;
    const tag = el.tagName;
    if (tag === 'IMG') {
      const src = safeUrl(el.getAttribute('src') || el.getAttribute('data-src') || '', base);
      if (src) blocks.push({ object: 'block', type: 'image', image: { type: 'external', external: { url: src }, caption: richText((el.getAttribute('alt') ?? '').slice(0, 1000)) } });
      return;
    }
    if (tag === 'HR') { blocks.push({ object: 'block', type: 'divider', divider: {} }); return; }
    if (tag === 'PRE') {
      const chunks = richText(el.textContent ?? '');
      for (let i = 0; i < chunks.length; i += 40) blocks.push({ object: 'block', type: 'code', code: { language: 'plain text', rich_text: chunks.slice(i, i + 40) } });
      return;
    }
    const heading = /^H[1-6]$/.test(tag) ? `heading_${Math.min(3, Number(tag[1]))}` : undefined;
    if (heading || ['P', 'LI', 'BLOCKQUOTE'].includes(tag)) {
      // Lists are flattened in reading order; nested list text must not be repeated in its parent.
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll('ul,ol,img,pre,blockquote').forEach(n => n.remove());
      emitRich(heading ?? (tag === 'LI' ? (el.parentElement?.tagName === 'OL' ? 'numbered_list_item' : 'bulleted_list_item') : tag === 'BLOCKQUOTE' ? 'quote' : 'paragraph'), inline(clone, base));
      for (const child of el.querySelectorAll('img,ul,ol,pre,blockquote')) {
        let parent = child.parentElement;
        while (parent && parent !== el && !parent.matches('img,ul,ol,pre,blockquote')) parent = parent.parentElement;
        if (parent === el) walk(child);
      }
      return;
    }
    if (tag === 'TABLE') {
      for (const row of el.querySelectorAll('tr')) emitRich('paragraph', richText(Array.from(row.querySelectorAll('th,td')).map(c => c.textContent?.trim() ?? '').join(' | ')));
      return;
    }
    let loose: RichText[] = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3 || (child.nodeType === 1 && ['A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'CODE', 'BR'].includes((child as Element).tagName))) loose.push(...inline(child, base));
      else if (child.nodeType === 1) { emitRich('paragraph', loose); loose = []; walk(child as Element); }
    }
    emitRich('paragraph', loose);
  };
  walk(root);
  return blocks;
}

// Readability modifies its input; only pass a clone. Never render returned HTML.
// https://github.com/mozilla/readability#basic-usage
export function extractArticle(document: Document): Capture {
  const url = safeUrl(document.URL);
  if (!url) throw new Error('Open a regular HTTP or HTTPS webpage to clip it.');
  const capture: Capture = { url, title: document.title.trim() || new URL(url).hostname, excerpt: '', blocks: [] };
  const clone = document.cloneNode(true) as Document;
  clone.querySelectorAll(skip).forEach(n => n.remove());
  try {
    const article = new Readability<Element>(clone, { serializer: n => n as Element, maxElemsToParse: 60_000 }).parse();
    if (article?.content) {
      capture.title = article.title?.trim() || capture.title;
      capture.excerpt = (article.excerpt ?? '').slice(0, 300);
      capture.blocks = toBlocks(article.content, url);
    }
  } catch { capture.warning = 'This page is too complex to extract. You can still save its link.'; }
  if (!capture.blocks.length) capture.warning = 'No readable article found. Save the link instead.';
  if (capture.blocks.length > 1500 || JSON.stringify(capture.blocks).length > 3_000_000) {
    capture.blocks = [];
    capture.warning = 'This article is too large for a reliable capture. Save the link instead.';
  }
  return capture;
}
