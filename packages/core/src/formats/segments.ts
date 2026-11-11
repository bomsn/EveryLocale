import { hash } from '../hash.js';
import { ContractError, unitSchema, type SourceUnit } from '../types.js';

/** A source range that rendering replaces with an approved translation. */
export type Span = {
  start: number;
  end: number;
  id: string;
  /** Protected markup tokens inside the segment, mapped to the original markup. */
  tokens?: Record<string, string>;
  /** Encodes the translated text for its position in the document. */
  encode?: (value: string) => string;
};

export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function sourceUnit(
  id: string,
  source: string,
  kind: SourceUnit['kind'],
  context: string,
): SourceUnit {
  return unitSchema.parse({ id, source, kind, context });
}

/**
 * Document segments are identified by their content, not their position, so inserting a
 * paragraph adds one segment and every unchanged segment keeps its approval. Repeated text
 * in the same context receives an occurrence suffix.
 */
export class SegmentCollector {
  readonly units: SourceUnit[] = [];
  readonly spans: Span[] = [];
  private readonly occurrences = new Map<string, number>();
  private readonly tokenPrefix: string;

  constructor(private readonly namespace: string) {
    this.tokenPrefix = hash(namespace).slice(0, 8);
  }

  token(index: number): string {
    return `[[EL:${this.tokenPrefix}:${index}]]`;
  }

  add(
    span: Omit<Span, 'id'>,
    text: string,
    context: string,
    id = `${this.namespace}:${hash({ context, text }).slice(0, 16)}`,
  ): void {
    if (!text.trim()) return;
    const count = (this.occurrences.get(id) ?? 0) + 1;
    this.occurrences.set(id, count);
    const unitId = count === 1 ? id : `${id}-${count}`;
    this.units.push(sourceUnit(unitId, text, 'text', context));
    this.spans.push({ ...span, id: unitId });
  }
}

export function renderSpans(
  content: string,
  spans: readonly Span[],
  translations: Readonly<Record<string, string>>,
): string {
  let result = content;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    const translated = translations[span.id];
    if (translated === undefined)
      throw new ContractError('missing_translation', `Missing approved translation: ${span.id}`);
    const tokens = Object.entries(span.tokens ?? {});
    for (const [token] of tokens)
      if (translated.split(token).length !== 2)
        throw new ContractError('protected_markup', `Markup token changed in ${span.id}`);
    let value = span.encode ? span.encode(translated) : translated;
    for (const [token, raw] of tokens) value = value.replace(token, () => raw);
    result = result.slice(0, span.start) + value + result.slice(span.end);
  }
  return result;
}
