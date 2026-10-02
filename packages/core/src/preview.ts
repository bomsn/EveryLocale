import { IntlMessageFormat } from 'intl-messageformat';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { parseFragment, serialize } from 'parse5';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import type { ExtractedDocument } from './types.js';
export function isolateIdentifier(value: string): string {
  return `\u2068${value}\u2069`;
}
/** Build example inputs from the ICU AST, including nested plural and select branches. */
export function previewArguments(
  message: string,
): Array<{ name: string; type: 'text' | 'number'; value: string | number }> {
  const values = new Map<
    string,
    { name: string; type: 'text' | 'number'; value: string | number }
  >();
  const visit = (nodes: MessageFormatElement[]) => {
    for (const node of nodes) {
      if (node.type === TYPE.argument && !values.has(node.value))
        values.set(node.value, { name: node.value, type: 'text', value: 'Ali' });
      else if (
        node.type === TYPE.number ||
        node.type === TYPE.date ||
        node.type === TYPE.time ||
        node.type === TYPE.plural
      )
        values.set(node.value, {
          name: node.value,
          type: 'number',
          value: node.type === TYPE.date || node.type === TYPE.time ? 1767225600000 : 3,
        });
      if (node.type === TYPE.select || node.type === TYPE.plural) {
        if (node.type === TYPE.select && !values.has(node.value))
          values.set(node.value, {
            name: node.value,
            type: 'text',
            value: Object.keys(node.options).find((key) => key !== 'other') ?? 'other',
          });
        for (const option of Object.values(node.options)) visit(option.value);
      } else if (node.type === TYPE.tag) visit(node.children);
    }
  };
  visit(parse(message));
  return [...values.values()];
}
export function previewMessage(
  message: string,
  locale: string,
  values: Record<string, string | number | boolean> = {},
): string {
  const tags: Record<string, (chunks: string[]) => string> = {};
  const visit = (nodes: MessageFormatElement[]) => {
    for (const node of nodes) {
      if (node.type === TYPE.tag) {
        tags[node.value] = (chunks) => chunks.join('');
        visit(node.children);
      } else if (node.type === TYPE.select || node.type === TYPE.plural)
        for (const option of Object.values(node.options)) visit(option.value);
    }
  };
  visit(parse(message));
  // Formatting handlers flatten declared ICU tags into text; preview never interprets HTML.
  return String(new IntlMessageFormat(message, locale).format({ ...values, ...tags }));
}

/** Review previews never execute MDX or fetch a source document's external assets.
 * The host additionally puts this semantic fragment in a sandboxed, CSP-restricted frame.
 */
export function documentPreview(
  content: string,
  format: ExtractedDocument['format'],
  options: {
    link?: (href: string) => string | null;
    headingIds?: boolean;
    focusableCode?: boolean;
  } = {},
): string {
  let html = content;
  if (format === 'markdown' || format === 'mdx') {
    const processor = unified().use(remarkParse);
    if (format === 'mdx') processor.use(remarkMdx);
    html = String(processor.use(remarkRehype).use(rehypeStringify).processSync(content));
  } else if (format !== 'html')
    return `<pre>${content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`;
  const tree = parseFragment(html);
  const allowed = new Set(
    'p h1 h2 h3 h4 h5 h6 div span strong em b i u ul ol li blockquote pre code table tr td th thead tbody tfoot caption br hr a figure figcaption abbr small del sup sub dl dt dd'.split(
      ' ',
    ),
  );
  const discard = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'link',
    'base',
    'meta',
    'form',
  ]);
  const headings = new Map<string, number>();
  const text = (node: any): string =>
    node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
  const sanitize = (node: any) => {
    node.childNodes = (node.childNodes ?? []).flatMap((child: any) => {
      if (child.nodeName === '#text') return [child];
      if (discard.has(child.tagName)) return [];
      if (child.tagName === 'img')
        return [
          {
            nodeName: '#text',
            value: `[Image: ${child.attrs?.find((attribute: any) => attribute.name === 'alt')?.value ?? ''}]`,
            parentNode: node,
          },
        ];
      sanitize(child);
      if (!allowed.has(child.tagName)) return child.childNodes ?? [];
      const href = child.attrs?.find((attribute: any) => attribute.name === 'href')?.value;
      child.attrs = (child.attrs ?? []).filter((attribute: any) =>
        ['lang', 'dir', 'title', 'colspan', 'rowspan'].includes(attribute.name),
      );
      if (child.tagName === 'a' && href && options.link) {
        const destination = options.link(href);
        if (
          destination &&
          /^(?:https?:\/\/|\/(?!\/)|#)/i.test(destination) &&
          !/[\u0000-\u0020\\]/u.test(destination)
        )
          child.attrs.push({ name: 'href', value: destination });
      }
      if (/^h[1-6]$/.test(child.tagName) && options.headingIds) {
        const slug = text(child)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .trim()
          .replace(/\s+/g, '-');
        const count = headings.get(slug) ?? 0;
        headings.set(slug, count + 1);
        child.attrs.push({ name: 'id', value: slug + (count ? `-${count}` : '') });
      }
      if (child.tagName === 'pre' && options.focusableCode)
        child.attrs.push({ name: 'tabindex', value: '0' });
      return [child];
    });
  };
  sanitize(tree);
  return serialize(tree);
}
