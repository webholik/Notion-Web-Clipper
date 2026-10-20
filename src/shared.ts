import type { Annotations, RichText } from './model';
export function safeUrl(input: string, base?: string): string | undefined {
  try {
    const url = new URL(input, base);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2000
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

// Split text below Notion’s length limit without cutting a UTF-16 surrogate pair.
export function richText(text: string, annotations?: Annotations, link?: string): RichText[] {
  const result: RichText[] = [];
  while (text.length) {
    let end = 1900;
    if (/^[\uDC00-\uDFFF]$/.test(text[end] ?? '')) end--;
    result.push({
      type: 'text',
      text: { content: text.slice(0, end), ...(link ? { link: { url: link } } : {}) },
      ...(annotations ? { annotations } : {}),
    });
    text = text.slice(end);
  }
  return result;
}
