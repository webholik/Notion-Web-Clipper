import type { Annotations, ContentBlock, RichText } from './model';
export function safeUrl(input: string, base?: string): string | undefined {
  try {
    const url = new URL(input, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2000) return;
    return url.href;
  } catch { return; }
}
export function richText(text: string, annotations?: Annotations, link?: string): RichText[] {
  const result: RichText[] = [];
  while (text.length) {
    let end = 1900;
    if (/^[\uDC00-\uDFFF]$/.test(text[end] ?? '')) end--;
    result.push({ type: 'text', text: { content: text.slice(0, end), ...(link ? { link: { url: link } } : {}) }, ...(annotations ? { annotations } : {}) });
    text = text.slice(end);
  }
  return result;
}
export function textBlock(type: string, text: string): ContentBlock {
  return { object: 'block', type, [type]: { rich_text: richText(text), ...(type === 'code' ? { language: 'plain text' } : {}) } };
}

