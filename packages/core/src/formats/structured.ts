import YAML from 'yaml';
import { ContractError, type ExtractedDocument, type SourceUnit } from '../types.js';
import { sourceUnit } from './segments.js';
import type { DocumentFormat } from './registry.js';

/** Keys use JSON Pointer escaping so `a/b` and nested `a` then `b` never collide. */
const keyPath = (path: readonly string[]) =>
  path.map((part) => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');

function structured(
  content: string,
  format: 'json' | 'yaml',
  namespace: string,
): ExtractedDocument {
  const data: unknown =
    format === 'json' ? JSON.parse(content) : YAML.parse(content, { uniqueKeys: true });
  const units: SourceUnit[] = [];
  const scan = (value: unknown, path: string[]) => {
    if (typeof value === 'string') {
      if (value.trim())
        units.push(
          sourceUnit(
            `${namespace}:${keyPath(path)}`,
            value,
            'icu',
            `Catalog key ${path.join('.')}`,
          ),
        );
    } else if (Array.isArray(value))
      value.forEach((item, index) => {
        scan(item, [...path, String(index)]);
      });
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
          const id = `${namespace}:${keyPath(path)}`;
          const translated = translations[id];
          if (translated === undefined)
            throw new ContractError('missing_translation', `Missing ${id}`);
          return translated;
        }
        if (Array.isArray(value))
          return value.map((item, index) => transform(item, [...path, String(index)]));
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

export const jsonFormat: DocumentFormat = {
  id: 'json',
  kind: 'messages',
  extract: (content, { namespace }) => structured(content, 'json', namespace),
};
export const yamlFormat: DocumentFormat = {
  id: 'yaml',
  kind: 'messages',
  extract: (content, { namespace }) => structured(content, 'yaml', namespace),
};
