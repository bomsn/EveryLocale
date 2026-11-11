import { IntlMessageFormat } from 'intl-messageformat';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { parseFragment } from 'parse5';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { attribute, childNodes, isElement, isText, type HtmlNode } from './formats/html.js';
import { escapeHtml } from './formats/segments.js';
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

const ALLOWED: ReadonlySet<string> = new Set(
  'p h1 h2 h3 h4 h5 h6 div span strong em b i u ul ol li blockquote pre code table tr td th thead tbody tfoot caption br hr a figure figcaption abbr small del sup sub dl dt dd'.split(
    ' ',
  ),
);
const VOID: ReadonlySet<string> = new Set(['br', 'hr']);
const DISCARD: ReadonlySet<string> = new Set([
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
const KEPT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'lang',
  'dir',
  'title',
  'colspan',
  'rowspan',
]);
const SAFE_LINK = /^(?:https?:\/\/|\/(?!\/)|#)/i;
// Control characters, spaces and backslashes can disguise a link's real destination.
const UNSAFE_LINK_CHARACTERS = /[\p{Cc}\s\\]/u;
const textOf = (node: HtmlNode): string =>
  isText(node) ? node.value : childNodes(node).map(textOf).join('');

/** Review previews never execute MDX or fetch a source document's external assets.
 * The output is rebuilt from an allowlist, so unknown elements keep only their text.
 * The host additionally puts this fragment in a sandboxed, CSP-restricted frame.
 */
export function documentPreview(
  content: string,
  format: string,
  options: {
    link?: (href: string) => string | null;
    headingIds?: boolean;
    focusableCode?: boolean;
  } = {},
): string {
  let html = content;
  if (format === 'markdown' || format === 'mdx') {
    const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);
    if (format === 'mdx') processor.use(remarkMdx);
    html = String(processor.use(remarkRehype).use(rehypeStringify).processSync(content));
  } else if (format !== 'html') return `<pre>${escapeHtml(content)}</pre>`;
  const headings = new Map<string, number>();
  const render = (node: HtmlNode): string => {
    if (isText(node)) return escapeHtml(node.value);
    if (!isElement(node))
      return node.nodeName === '#comment' ? '' : childNodes(node).map(render).join('');
    if (DISCARD.has(node.tagName)) return '';
    if (node.tagName === 'img') return escapeHtml(`[Image: ${attribute(node, 'alt') ?? ''}]`);
    const inner = childNodes(node).map(render).join('');
    if (!ALLOWED.has(node.tagName)) return inner;
    const attributes = node.attrs
      .filter((item) => KEPT_ATTRIBUTES.has(item.name))
      .map((item) => [item.name, item.value] as const);
    const href = attribute(node, 'href');
    if (node.tagName === 'a' && href !== undefined && options.link) {
      const destination = options.link(href);
      if (destination && SAFE_LINK.test(destination) && !UNSAFE_LINK_CHARACTERS.test(destination))
        attributes.push(['href', destination]);
    }
    if (/^h[1-6]$/.test(node.tagName) && options.headingIds) {
      const slug = textOf(node)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');
      const count = headings.get(slug) ?? 0;
      headings.set(slug, count + 1);
      attributes.push(['id', slug + (count ? `-${String(count)}` : '')]);
    }
    if (node.tagName === 'pre' && options.focusableCode) attributes.push(['tabindex', '0']);
    const open = `<${node.tagName}${attributes.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('')}>`;
    return VOID.has(node.tagName) ? open : `${open}${inner}</${node.tagName}>`;
  };
  return render(parseFragment(html));
}
