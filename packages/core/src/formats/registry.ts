import { ContractError, type ExtractedDocument } from '../types.js';
import { htmlFormat } from './html.js';
import { markdownFormat, mdxFormat } from './markdown.js';
import { poFormat } from './po.js';
import { jsonFormat, yamlFormat } from './structured.js';

export type ExtractOptions = {
  /** Prefix of every unit id from this document, for example `common` or `docs/setup`. */
  namespace: string;
  /** Front matter keys to translate in Markdown and MDX. Other keys are copied unchanged. */
  frontMatter?: readonly string[];
};

/**
 * A document format turns file content into translatable units and renders approved
 * translations back into the same structure. `render` must reject any translation that
 * changes protected structure.
 */
export interface DocumentFormat {
  readonly id: string;
  extract(content: string, options: ExtractOptions): ExtractedDocument;
}

/** Documents above this size are rejected before parsing. */
export const MAX_DOCUMENT_BYTES = 2_000_000;
const formats = new Map<string, DocumentFormat>(
  [jsonFormat, yamlFormat, poFormat, htmlFormat, markdownFormat, mdxFormat].map((format) => [
    format.id,
    format,
  ]),
);

/** Adds a format provided by another package. Ids are unique and cannot replace a format. */
export function registerFormat(format: DocumentFormat): void {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(format.id))
    throw new Error(`Invalid format id: ${format.id}`);
  if (formats.has(format.id)) throw new Error(`Format already registered: ${format.id}`);
  formats.set(format.id, format);
}

export const formatIds = (): string[] => [...formats.keys()];
export const isFormat = (id: string): boolean => formats.has(id);

export function extractDocument(
  content: string,
  format: string,
  namespace = 'document',
  options: Omit<ExtractOptions, 'namespace'> = {},
): ExtractedDocument {
  if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES)
    throw new ContractError('document_size', 'Document exceeds 2 MB', 413);
  const definition = formats.get(format);
  if (!definition)
    throw new ContractError('unsupported_format', `Unsupported document format: ${format}`, 422);
  return definition.extract(content, { ...options, namespace });
}
