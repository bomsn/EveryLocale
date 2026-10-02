import { parseFragment } from 'parse5';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import * as gettext from 'gettext-parser';
import YAML from 'yaml';
import { getNPlurals, getFormula, getExamples, hasLang } from 'plural-forms';
import { IntlMessageFormat } from 'intl-messageformat';
import { hash } from './hash.js';
import { ContractError, unitSchema, type ExtractedDocument, type SourceUnit } from './types.js';

type Span = {
  start: number;
  end: number;
  id: string;
  tokens?: Record<string, string>;
  escape?: boolean;
};
type AstNode = {
  type?: string;
  value?: string;
  children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Localize approved internal navigation after translation, preserving all other source markup. */
export function rewriteHtmlLinks(content: string, resolveLink: (href: string) => string): string {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const walk = (node: any) => {
    if (node.tagName === 'a') {
      const href = node.attrs?.find((attribute: any) => attribute.name === 'href')?.value;
      const location = node.sourceCodeLocation?.attrs?.href;
      if (typeof href === 'string' && location) {
        const localized = resolveLink(href);
        if (localized !== href)
          replacements.push({
            start: location.startOffset,
            end: location.endOffset,
            value: `href="${escapeHtml(localized)}"`,
          });
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(parseFragment(content, { sourceCodeLocationInfo: true }));
  for (const replacement of replacements.sort((left, right) => right.start - left.start))
    content =
      content.slice(0, replacement.start) + replacement.value + content.slice(replacement.end);
  return content;
}
function unit(id: string, source: string, kind: SourceUnit['kind'], context: string): SourceUnit {
  return unitSchema.parse({ id, source, kind, context });
}
function renderSpans(content: string, spans: Span[], translations: Record<string, string>): string {
  let result = content;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    const translated = translations[span.id];
    if (translated === undefined)
      throw new ContractError('missing_translation', `Missing approved translation: ${span.id}`);
    for (const token of Object.keys(span.tokens ?? {})) {
      if (translated.split(token).length !== 2)
        throw new ContractError('protected_markup', `Markup token changed in ${span.id}`);
    }
    let value = span.escape ? escapeHtml(translated) : translated;
    for (const [token, raw] of Object.entries(span.tokens ?? {})) {
      value = value.replace(token, raw);
    }
    result = result.slice(0, span.start) + value + result.slice(span.end);
  }
  return result;
}
function structured(
  content: string,
  format: 'json' | 'yaml',
  namespace: string,
): ExtractedDocument {
  const data: unknown =
    format === 'json' ? JSON.parse(content) : YAML.parse(content, { uniqueKeys: true });
  const units: SourceUnit[] = [];
  const scan = (value: unknown, path: string[]) => {
    if (typeof value === 'string' && value.trim())
      units.push(
        unit(
          `${namespace}:${path.map((x) => x.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`,
          value,
          'icu',
          `Catalog key ${path.join('.')}`,
        ),
      );
    else if (Array.isArray(value)) value.forEach((x, i) => scan(x, [...path, String(i)]));
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) scan(child, [...path, key]);
  };
  scan(data, []);
  return {
    format,
    content,
    units,
    render(translations) {
      const transform = (value: unknown, path: string[]): unknown => {
        if (typeof value === 'string' && value.trim()) {
          const id = `${namespace}:${path.map((x) => x.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
          if (translations[id] === undefined)
            throw new ContractError('missing_translation', `Missing ${id}`);
          return translations[id];
        }
        if (Array.isArray(value)) return value.map((x, i) => transform(x, [...path, String(i)]));
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, transform(child, [...path, key])]),
          );
        return value;
      };
      const output = transform(data, []);
      return format === 'json' ? `${JSON.stringify(output, null, 2)}\n` : YAML.stringify(output);
    },
  };
}
/** Parser offsets preserve original syntax, Gutenberg comments, and executable MDX. */
function markup(
  content: string,
  format: 'html' | 'markdown' | 'mdx',
  namespace: string,
  groupInline = false,
): ExtractedDocument {
  const units: SourceUnit[] = [];
  const spans: Span[] = [];
  const add = (
    start: number,
    end: number,
    text: string,
    context: string,
    tokens?: Record<string, string>,
    escape = false,
  ) => {
    if (!text.trim()) return;
    const id = `${namespace}:${units.length}`;
    units.push(unit(id, text, 'text', context));
    spans.push({ start, end, id, tokens, escape });
  };
  if (format === 'html') {
    const root = parseFragment(content, { sourceCodeLocationInfo: true });
    const inline = new Set([
      'a',
      'abbr',
      'b',
      'bdi',
      'bdo',
      'br',
      'cite',
      'code',
      'em',
      'i',
      'kbd',
      'mark',
      's',
      'small',
      'span',
      'strong',
      'sub',
      'sup',
      'time',
      'u',
      'wbr',
    ]);
    const walk = (node: any, excluded = false) => {
      const attrs: Array<{ name: string; value: string }> = node.attrs ?? [];
      const blocked =
        excluded ||
        ['script', 'style', 'code', 'pre', 'textarea', 'svg', 'math'].includes(node.tagName) ||
        attrs.some(
          (x) => (x.name === 'translate' && x.value === 'no') || x.name === 'data-el-preserve',
        );
      if (blocked) return;
      if (node.nodeName === '#text' && node.sourceCodeLocation) {
        const location = node.sourceCodeLocation;
        add(
          location.startOffset,
          location.endOffset,
          node.value,
          `HTML text inside ${node.parentNode?.tagName ?? 'fragment'}`,
          undefined,
          true,
        );
      }
      for (const attr of attrs.filter((x) =>
        ['alt', 'title', 'aria-label', 'placeholder'].includes(x.name),
      )) {
        const location = node.sourceCodeLocation?.attrs?.[attr.name];
        if (!location) continue;
        const raw = content.slice(location.startOffset, location.endOffset);
        const equals = raw.indexOf('=');
        if (equals < 0) continue;
        const quoted = raw.slice(equals + 1).trim();
        const quote = quoted[0];
        if (quote !== '"' && quote !== "'")
          throw new ContractError(
            'unquoted_attribute',
            'Translatable HTML attributes must be quoted',
            422,
          );
        const start = location.startOffset + raw.indexOf(quote, equals + 1) + 1;
        add(
          start,
          location.endOffset - 1,
          attr.value,
          `${attr.name} on ${node.tagName}`,
          undefined,
          true,
        );
      }
      // Whole sentences give the model enough context to reorder words around inline markup.
      if (
        groupInline &&
        ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'label'].includes(node.tagName)
      ) {
        const leaves: any[] = [];
        let safe = true;
        const collect = (child: any) => {
          if (child.nodeName === '#text' && child.sourceCodeLocation) leaves.push(child);
          else if (child.tagName) {
            const childAttrs = child.attrs ?? [];
            if (
              !inline.has(child.tagName) ||
              childAttrs.some((x: any) =>
                ['alt', 'title', 'aria-label', 'placeholder'].includes(x.name),
              )
            ) {
              safe = false;
              return;
            }
            if (
              child.tagName === 'code' ||
              childAttrs.some(
                (x: any) =>
                  (x.name === 'translate' && x.value === 'no') || x.name === 'data-el-preserve',
              )
            )
              return;
            for (const sub of child.childNodes ?? []) collect(sub);
          }
        };
        for (const child of node.childNodes ?? []) collect(child);
        if (safe && leaves.length > 1) {
          const start = leaves[0].sourceCodeLocation.startOffset,
            end = leaves.at(-1).sourceCodeLocation.endOffset;
          const tokens: Record<string, string> = {};
          let cursor = start,
            text = '';
          for (const leaf of leaves) {
            const gap = content.slice(cursor, leaf.sourceCodeLocation.startOffset);
            if (gap) {
              const token = `[[EL:${hash(namespace).slice(0, 8)}:${Object.keys(tokens).length}]]`;
              tokens[token] = gap;
              text += token;
            }
            text += leaf.value;
            cursor = leaf.sourceCodeLocation.endOffset;
          }
          add(start, end, text, `HTML sentence inside ${node.tagName}`, tokens, true);
          return;
        }
      }
      for (const child of node.childNodes ?? []) walk(child, blocked);
    };
    walk(root);
  } else {
    const processor = unified().use(remarkParse);
    if (format === 'mdx') processor.use(remarkMdx);
    const tree = processor.parse(content) as AstNode;
    const walk = (node: AstNode) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (
        ['paragraph', 'heading', 'tableCell'].includes(node.type ?? '') &&
        start !== undefined &&
        end !== undefined
      ) {
        const leaves: Array<{ start: number; end: number; value: string }> = [];
        const collect = (child: AstNode) => {
          if (
            child.type === 'text' &&
            child.position?.start.offset !== undefined &&
            child.position?.end.offset !== undefined
          )
            leaves.push({
              start: child.position.start.offset,
              end: child.position.end.offset,
              value: child.value ?? '',
            });
          else if (
            ![
              'inlineCode',
              'code',
              'mdxFlowExpression',
              'mdxTextExpression',
              'mdxjsEsm',
              'html',
            ].includes(child.type ?? '')
          )
            for (const sub of child.children ?? []) collect(sub);
        };
        collect(node);
        if (!leaves.length) return;
        const tokens: Record<string, string> = {};
        let cursor = start;
        let text = '';
        const protect = (raw: string) => {
          if (!raw) return '';
          const token = `[[EL:${hash(namespace).slice(0, 8)}:${Object.keys(tokens).length}]]`;
          tokens[token] = raw;
          return token;
        };
        for (const leaf of leaves.sort((a, b) => a.start - b.start)) {
          text += protect(content.slice(cursor, leaf.start)) + leaf.value;
          cursor = leaf.end;
        }
        text += protect(content.slice(cursor, end));
        add(start, end, text, `${format} ${node.type}`, tokens);
        return;
      }
      if (
        [
          'code',
          'inlineCode',
          'html',
          'mdxFlowExpression',
          'mdxTextExpression',
          'mdxjsEsm',
        ].includes(node.type ?? '')
      )
        return;
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  }
  return {
    format,
    content,
    units,
    render: (translations) => {
      const rendered = renderSpans(content, spans, translations);
      if (format !== 'html') {
        const processor = unified().use(remarkParse);
        if (format === 'mdx') processor.use(remarkMdx);
        // Translation must never introduce executable MDX, change links, or create new markup.
        const signature = (node: any): unknown => {
          if (Array.isArray(node)) return node.map(signature);
          if (!node || typeof node !== 'object') return node;
          return Object.fromEntries(
            Object.entries(node)
              .filter(([key]) => !['position', 'start', 'end', 'loc', 'range'].includes(key))
              .map(([key, value]) => [
                key,
                key === 'value' && node.type === 'text' ? '' : signature(value),
              ]),
          );
        };
        try {
          if (
            JSON.stringify(signature(processor.parse(content))) !==
            JSON.stringify(signature(processor.parse(rendered)))
          )
            throw new Error('structure');
        } catch {
          throw new ContractError(
            'protected_markup',
            'Translation changes Markdown or executable MDX structure',
            422,
          );
        }
      } else {
        const signature = (node: any): unknown =>
          node.nodeName === '#text'
            ? ['text']
            : node.nodeName === '#comment'
              ? ['comment', node.data]
              : [
                  node.tagName ?? node.nodeName,
                  // HTML recovery must not hide a moved closing tag. Complete inline code
                  // elements can still move together when another language changes word order.
                  Boolean(node.sourceCodeLocation?.startTag),
                  Boolean(node.sourceCodeLocation?.endTag),
                  (node.attrs ?? []).map((attr: any) => [
                    attr.name,
                    ['alt', 'title', 'aria-label', 'placeholder'].includes(attr.name)
                      ? ''
                      : attr.value,
                  ]),
                  // Articles and spaces can disappear around inline tags in another language.
                  // Preserve the element/comment skeleton, rather than translatable text-node positions.
                  (node.childNodes ?? [])
                    .filter((child: any) => child.nodeName !== '#text')
                    .map(signature),
                ];
        if (
          JSON.stringify(signature(parseFragment(content, { sourceCodeLocationInfo: true }))) !==
          JSON.stringify(signature(parseFragment(rendered, { sourceCodeLocationInfo: true })))
        )
          throw new ContractError('protected_markup', 'Translation changes HTML structure', 422);
      }
      return rendered;
    },
  };
}
function po(content: string, namespace: string): ExtractedDocument {
  const data = gettext.po.parse(Buffer.from(content));
  const units: SourceUnit[] = [];
  for (const [context, entries] of Object.entries(data.translations))
    for (const [id, entry] of Object.entries(entries)) {
      if (!id) continue;
      const message = entry.msgid_plural
        ? `{__el_count, plural, one {${entry.msgid}} other {${entry.msgid_plural}}}`
        : entry.msgid;
      units.push(
        unit(
          `${namespace}:${hash([context, id]).slice(0, 24)}`,
          message,
          entry.msgid_plural ? 'icu' : 'text',
          context,
        ),
      );
    }
  return {
    format: 'po',
    content,
    units,
    render(translations, locale) {
      const copy = gettext.po.parse(Buffer.from(content));
      copy.headers.Language = locale;
      const language = new Intl.Locale(locale).language;
      if (!hasLang(language))
        throw new ContractError(
          'po_locale',
          `Gettext plural rules are unavailable for ${locale}`,
          422,
        );
      copy.headers['Plural-Forms'] =
        `nplurals=${getNPlurals(language)}; plural=${getFormula(language)};`;
      for (const [context, entries] of Object.entries(copy.translations))
        for (const [id, entry] of Object.entries(entries)) {
          if (!id) continue;
          const key = `${namespace}:${hash([context, id]).slice(0, 24)}`;
          if (translations[key] === undefined)
            throw new ContractError('missing_translation', `Missing ${key}`);
          if (entry.msgid_plural) {
            const formatter = new IntlMessageFormat(translations[key]!, locale);
            entry.msgstr = Array.from({ length: getNPlurals(language) }, () => '');
            for (const example of getExamples(language))
              entry.msgstr[example.plural] = String(
                formatter.format({ __el_count: example.sample }),
              );
            if (entry.msgstr.some((x) => !x))
              throw new ContractError('po_plural', 'Missing translated plural form', 422);
          } else entry.msgstr = [translations[key]!];
          if (entry.comments?.flag)
            entry.comments.flag = entry.comments.flag
              .split(',')
              .filter((x) => x.trim() !== 'fuzzy')
              .join(',');
        }
      return gettext.po.compile(copy).toString('utf8');
    },
  };
}
export function extractDocument(
  content: string,
  format: ExtractedDocument['format'],
  namespace = 'document',
  options: { groupInline?: boolean } = {},
): ExtractedDocument {
  if (Buffer.byteLength(content) > 2000000)
    throw new ContractError('document_size', 'Document exceeds 2 MB', 413);
  switch (format) {
    case 'json':
    case 'yaml':
      return structured(content, format, namespace);
    case 'html':
    case 'markdown':
    case 'mdx':
      return markup(content, format, namespace, options.groupInline);
    case 'po':
      return po(content, namespace);
  }
}
