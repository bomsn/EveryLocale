import { IntlMessageFormat } from 'intl-messageformat';
import type { CompiledMessages, MessageId, ValuesArgument } from './messages.js';

export type MissingMessageHandler = (id: string, locale: string) => void;

export type FormatterOptions = {
  locale: string;
  messages: CompiledMessages;
  /**
   * `report` renders the id and reports it once; `throw` fails, for tests and builds. A release
   * loaded on the server already fills draft gaps with reported source text, so a missing id
   * here means code and catalogs disagree.
   */
  missing?: 'report' | 'throw';
  onMissing?: MissingMessageHandler;
};

export class MissingMessageError extends Error {
  constructor(
    readonly id: string,
    readonly locale: string,
  ) {
    super(`Message ${id} is missing for ${locale}`);
  }
}

const reportToConsole: MissingMessageHandler = (id, locale) => {
  console.error(`EveryLocale: message ${id} is missing for ${locale}`);
};

/**
 * Declared rather than inferred so published declarations keep the generic signatures, which
 * resolve against the app's generated message types instead of the untyped fallback.
 */
export type Formatter = {
  readonly locale: string;
  has: (id: string) => boolean;
  /** Formats a message to text. */
  format: <Id extends MessageId>(id: Id, ...values: ValuesArgument<Id>) => string;
  /**
   * Formats a message whose values may render rich-text tags or elements, returning the parts
   * in order so a UI library can render them.
   */
  formatParts: <Id extends MessageId, Part = unknown>(
    id: Id,
    ...values: ValuesArgument<Id>
  ) => Array<string | Part>;
};

/** One formatter per locale and message set; parsed formats are cached per id. */
export function createFormatter(options: FormatterOptions): Formatter {
  const { locale, messages } = options;
  const formats = new Map<string, IntlMessageFormat>();
  const reported = new Set<string>();
  const onMissing = options.onMissing ?? reportToConsole;

  const compiled = (id: string) => {
    let format = formats.get(id);
    if (!format) {
      const message = messages[id];
      if (!message) {
        if (options.missing === 'throw') throw new MissingMessageError(id, locale);
        if (!reported.has(id)) {
          reported.add(id);
          onMissing(id, locale);
        }
        return null;
      }
      format = new IntlMessageFormat(message, locale);
      formats.set(id, format);
    }
    return format;
  };

  return {
    locale,
    has: (id: string) => id in messages,
    format(id, ...[values]) {
      const format = compiled(id);
      if (!format) return id;
      return String(format.format(values as Record<string, string | number | Date> | undefined));
    },
    formatParts<Id extends MessageId, Part>(id: Id, ...[values]: ValuesArgument<Id>) {
      const format = compiled(id);
      if (!format) return [id];
      const result = format.format<Part>(values as Record<string, Part>);
      return Array.isArray(result) ? result : [result];
    },
  };
}
