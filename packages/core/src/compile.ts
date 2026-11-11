import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import type { SourceUnit } from './types.js';

/**
 * Parses a message ahead of time for the runtime. ICU messages are parsed; plain text such as
 * a PO entry becomes one literal, so braces in it stay text.
 */
export function compileMessage(kind: SourceUnit['kind'], text: string): MessageFormatElement[] {
  return kind === 'icu' ? parse(text) : [{ type: TYPE.literal, value: text }];
}
