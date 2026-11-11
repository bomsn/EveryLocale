import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import YAML, { isMap, isScalar } from 'yaml';
import { ContractError, type ExtractedDocument } from '../types.js';
import { renderSpans, SegmentCollector, type Span } from './segments.js';
import type { DocumentFormat } from './registry.js';

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
type Dialect = 'markdown' | 'mdx';

/** Front matter keys translated when a file pattern does not list its own. */
export const DEFAULT_FRONT_MATTER_KEYS: readonly string[] = ['title', 'description'];
const SEGMENTS = new Set(['paragraph', 'heading', 'tableCell']);
const CODE = new Set([
  'code',
  'inlineCode',
  'html',
  'mdxFlowExpression',
  'mdxTextExpression',
  'mdxjsEsm',
  'yaml',
]);

function parse(content: string, dialect: Dialect): Node {
  const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);
  if (dialect === 'mdx') processor.use(remarkMdx);
  return processor.parse(content);
}
const offsets = (node: Node) => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
};

/** Translation must never add markup, change links or introduce executable MDX. */
function signature(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(signature);
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !['position', 'start', 'end', 'loc', 'range'].includes(key))
      .map(([key, value]) => [
        key,
        key === 'value' && (record.type === 'text' || record.type === 'yaml')
          ? ''
          : signature(value),
      ]),
  );
}

type FrontMatter = { start: number; data: Record<string, unknown> };
function frontMatter(content: string, tree: Node): FrontMatter | null {
  const node = tree.children?.[0];
  const range = node && offsets(node);
  if (node?.type !== 'yaml' || !range || node.value === undefined) return null;
  const start = content.indexOf('\n', range.start) + 1;
  if (content.slice(start, start + node.value.length) !== node.value)
    throw new ContractError('front_matter', 'Front matter could not be located', 422);
  const data: unknown = YAML.parse(node.value, { uniqueKeys: true }) ?? {};
  if (typeof data !== 'object' || Array.isArray(data))
    throw new ContractError('front_matter', 'Front matter must be a YAML mapping', 422);
  return { start, data: data as Record<string, unknown> };
}

function addFrontMatter(
  content: string,
  tree: Node,
  keys: readonly string[],
  namespace: string,
  segments: SegmentCollector,
) {
  const node = tree.children?.[0];
  const located = frontMatter(content, tree);
  if (!located || node?.value === undefined) return;
  const document = YAML.parseDocument(node.value, { uniqueKeys: true });
  if (!isMap(document.contents)) return;
  for (const item of document.contents.items) {
    if (!isScalar(item.key) || !isScalar(item.value)) continue;
    const key = String(item.key.value);
    const { value, range } = item.value;
    if (!keys.includes(key) || typeof value !== 'string') continue;
    const raw = node.value.slice(range[0], range[1]);
    // Block scalars own their final line break; a quoted replacement must keep it.
    const lineBreak = /\r?\n$/.exec(raw)?.[0] ?? '';
    const span: Omit<Span, 'id'> = {
      start: located.start + range[0],
      end: located.start + range[1],
      encode: (translated) => JSON.stringify(translated) + lineBreak,
    };
    segments.add(span, value, `Front matter ${key}`, `${namespace}:front-matter/${key}`);
  }
}

function addBlocks(content: string, tree: Node, segments: SegmentCollector, dialect: Dialect) {
  const walk = (node: Node) => {
    const range = offsets(node);
    if (SEGMENTS.has(node.type) && range) {
      const leaves: Array<{ start: number; end: number; value: string }> = [];
      const collect = (child: Node) => {
        const position = offsets(child);
        if (child.type === 'text' && position)
          leaves.push({ ...position, value: child.value ?? '' });
        else if (!CODE.has(child.type)) for (const sub of child.children ?? []) collect(sub);
      };
      collect(node);
      if (!leaves.length) return;
      const tokens: Record<string, string> = {};
      const protect = (raw: string) => {
        if (!raw) return '';
        const token = segments.token(Object.keys(tokens).length);
        tokens[token] = raw;
        return token;
      };
      let cursor = range.start;
      let text = '';
      for (const leaf of leaves.sort((a, b) => a.start - b.start)) {
        text += protect(content.slice(cursor, leaf.start)) + leaf.value;
        cursor = leaf.end;
      }
      text += protect(content.slice(cursor, range.end));
      segments.add({ ...range, tokens }, text, `${dialect} ${node.type}`);
      return;
    }
    if (CODE.has(node.type)) return;
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
}

function verify(original: string, rendered: string, dialect: Dialect, translatedKeys: Set<string>) {
  let same = false;
  try {
    const before = parse(original, dialect);
    const after = parse(rendered, dialect);
    same = JSON.stringify(signature(before)) === JSON.stringify(signature(after));
    const left = frontMatter(original, before)?.data ?? {};
    const right = frontMatter(rendered, after)?.data ?? {};
    same &&=
      JSON.stringify(Object.keys(left)) === JSON.stringify(Object.keys(right)) &&
      Object.keys(left).every((key) =>
        translatedKeys.has(key)
          ? typeof right[key] === 'string'
          : JSON.stringify(left[key]) === JSON.stringify(right[key]),
      );
  } catch {
    same = false;
  }
  if (!same)
    throw new ContractError(
      'protected_markup',
      'Translation changes Markdown, front matter or executable MDX structure',
      422,
    );
}

function format(dialect: Dialect): DocumentFormat {
  return {
    id: dialect,
    kind: 'content',
    extract(content, { namespace, frontMatter: keys = DEFAULT_FRONT_MATTER_KEYS }) {
      const tree = parse(content, dialect);
      const segments = new SegmentCollector(namespace);
      addFrontMatter(content, tree, keys, namespace, segments);
      addBlocks(content, tree, segments, dialect);
      const { units, spans } = segments;
      const translatedKeys = new Set(
        units
          .filter((unit) => unit.id.startsWith(`${namespace}:front-matter/`))
          .map((unit) => unit.id.slice(namespace.length + 'front-matter/'.length + 1)),
      );
      const document: ExtractedDocument = {
        format: dialect,
        content,
        units,
        render(translations) {
          const rendered = renderSpans(content, spans, translations);
          verify(content, rendered, dialect, translatedKeys);
          return rendered;
        },
      };
      return document;
    },
  };
}

export const markdownFormat = format('markdown');
export const mdxFormat = format('mdx');
