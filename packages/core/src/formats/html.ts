import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { ContractError, type ExtractedDocument } from '../types.js';
import { escapeHtml, renderSpans, SegmentCollector } from './segments.js';
import type { DocumentFormat } from './registry.js';

export type HtmlNode = DefaultTreeAdapterMap['node'];
export type HtmlElement = DefaultTreeAdapterMap['element'];
type HtmlText = DefaultTreeAdapterMap['textNode'];

export const isElement = (node: HtmlNode): node is HtmlElement => 'tagName' in node;
export const isText = (node: HtmlNode): node is HtmlText => node.nodeName === '#text';
export const childNodes = (node: HtmlNode): HtmlNode[] =>
  'childNodes' in node ? node.childNodes : [];
export const attribute = (node: HtmlElement, name: string) =>
  node.attrs.find((item) => item.name === name)?.value;

/** Attributes whose values are user-visible text. */
const TRANSLATABLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'alt',
  'title',
  'aria-label',
  'placeholder',
]);
const BLOCKED = new Set(['script', 'style', 'code', 'pre', 'textarea', 'svg', 'math']);
const INLINE = new Set(
  'a abbr b bdi bdo br cite code em i kbd mark s small span strong sub sup time u wbr'.split(' '),
);
const SENTENCES = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'label']);
const preserved = (node: HtmlElement) =>
  attribute(node, 'translate') === 'no' || attribute(node, 'data-el-preserve') !== undefined;

/** Element and comment skeleton; text positions may move when another language reorders words. */
function signature(node: HtmlNode): unknown {
  if (isText(node)) return ['text'];
  if (node.nodeName === '#comment') return ['comment', 'data' in node ? node.data : ''];
  const location = isElement(node) ? node.sourceCodeLocation : undefined;
  return [
    isElement(node) ? node.tagName : node.nodeName,
    // HTML recovery must not hide a moved closing tag.
    Boolean(location?.startTag),
    Boolean(location?.endTag),
    isElement(node)
      ? node.attrs.map((item) => [
          item.name,
          TRANSLATABLE_ATTRIBUTES.has(item.name) ? '' : item.value,
        ])
      : [],
    childNodes(node)
      .filter((child) => !isText(child))
      .map(signature),
  ];
}
const skeleton = (content: string) =>
  JSON.stringify(signature(parseFragment(content, { sourceCodeLocationInfo: true })));

function extract(content: string, namespace: string): ExtractedDocument {
  const segments = new SegmentCollector(namespace);
  const encode = escapeHtml;
  const walk = (node: HtmlNode) => {
    if (isElement(node) && (BLOCKED.has(node.tagName) || preserved(node))) return;
    if (isText(node) && node.sourceCodeLocation) {
      const parent = node.parentNode;
      const tag = parent && isElement(parent) ? parent.tagName : 'fragment';
      const { startOffset, endOffset } = node.sourceCodeLocation;
      segments.add(
        { start: startOffset, end: endOffset, encode },
        node.value,
        `HTML text inside ${tag}`,
      );
    }
    if (!isElement(node)) {
      for (const child of childNodes(node)) walk(child);
      return;
    }
    for (const item of node.attrs) {
      if (!TRANSLATABLE_ATTRIBUTES.has(item.name)) continue;
      const location = node.sourceCodeLocation?.attrs?.[item.name];
      if (!location) continue;
      const raw = content.slice(location.startOffset, location.endOffset);
      const equals = raw.indexOf('=');
      if (equals < 0) continue;
      const quote = raw.slice(equals + 1).trim()[0];
      if (quote !== '"' && quote !== "'")
        throw new ContractError(
          'unquoted_attribute',
          'Translatable HTML attributes must be quoted',
          422,
        );
      const start = location.startOffset + raw.indexOf(quote, equals + 1) + 1;
      segments.add(
        { start, end: location.endOffset - 1, encode },
        item.value,
        `${item.name} on ${node.tagName}`,
      );
    }
    // Whole sentences let the model reorder words around inline markup.
    if (SENTENCES.has(node.tagName) && addSentence(content, node, segments)) return;
    for (const child of childNodes(node)) walk(child);
  };
  walk(parseFragment(content, { sourceCodeLocationInfo: true }));
  const { units, spans } = segments;
  return {
    format: 'html',
    content,
    units,
    render(translations) {
      const rendered = renderSpans(content, spans, translations);
      if (skeleton(content) !== skeleton(rendered))
        throw new ContractError('protected_markup', 'Translation changes HTML structure', 422);
      return rendered;
    },
  };
}

/** Returns false when the element holds markup that cannot move as one protected token. */
function addSentence(content: string, node: HtmlElement, segments: SegmentCollector): boolean {
  const leaves: HtmlText[] = [];
  const collect = (child: HtmlNode): boolean => {
    if (isText(child)) {
      if (child.sourceCodeLocation) leaves.push(child);
      return true;
    }
    if (!isElement(child)) return true;
    if (
      !INLINE.has(child.tagName) ||
      child.attrs.some((item) => TRANSLATABLE_ATTRIBUTES.has(item.name))
    )
      return false;
    if (child.tagName === 'code' || preserved(child)) return true;
    return childNodes(child).every(collect);
  };
  if (!childNodes(node).every(collect) || leaves.length < 2) return false;
  const tokens: Record<string, string> = {};
  const first = leaves[0]?.sourceCodeLocation;
  const last = leaves.at(-1)?.sourceCodeLocation;
  if (!first || !last) return false;
  let cursor = first.startOffset;
  let text = '';
  for (const leaf of leaves) {
    const location = leaf.sourceCodeLocation;
    if (!location) continue;
    const gap = content.slice(cursor, location.startOffset);
    if (gap) {
      const token = segments.token(Object.keys(tokens).length);
      tokens[token] = gap;
      text += token;
    }
    text += leaf.value;
    cursor = location.endOffset;
  }
  segments.add(
    { start: first.startOffset, end: last.endOffset, tokens, encode: escapeHtml },
    text,
    `HTML sentence inside ${node.tagName}`,
  );
  return true;
}

export const htmlFormat: DocumentFormat = {
  id: 'html',
  kind: 'content',
  extract: (content, { namespace }) => extract(content, namespace),
};

/** Localize approved internal navigation after translation, preserving all other source markup. */
export function rewriteHtmlLinks(content: string, resolveLink: (href: string) => string): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const walk = (node: HtmlNode) => {
    if (isElement(node) && node.tagName === 'a') {
      const href = attribute(node, 'href');
      const location = node.sourceCodeLocation?.attrs?.href;
      if (href !== undefined && location) {
        const localized = resolveLink(href);
        if (localized !== href)
          replacements.push({
            start: location.startOffset,
            end: location.endOffset,
            value: `href="${escapeHtml(localized)}"`,
          });
      }
    }
    for (const child of childNodes(node)) walk(child);
  };
  walk(parseFragment(content, { sourceCodeLocationInfo: true }));
  let result = content;
  for (const item of replacements.sort((left, right) => right.start - left.start))
    result = result.slice(0, item.start) + item.value + result.slice(item.end);
  return result;
}
