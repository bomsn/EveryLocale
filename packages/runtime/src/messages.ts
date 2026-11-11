import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';

/** A message parsed ahead of time, so the browser needs no ICU parser. */
export type CompiledMessage = MessageFormatElement[];
export type CompiledMessages = Readonly<Record<string, CompiledMessage>>;

/**
 * Generated message types register here through module augmentation (see `everylocale
 * codegen`). Without a registration, ids are strings and values are untyped.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by generated declarations
export interface Register {}

/** A rich-text tag renderer. Method syntax keeps it assignable from React or string renderers. */
export type Tag = {
  render(chunks: readonly unknown[]): unknown;
}['render'];

type Registered = Register extends { messages: infer Messages } ? Messages : never;
type Untyped = Record<string, Record<string, unknown> | undefined>;
type Catalog = [Registered] extends [never] ? Untyped : Registered;

export type MessageId = Extract<keyof Catalog, string>;
export type MessageValues<Id extends MessageId> = Catalog[Id];
/** Messages without arguments take no values; the others require theirs. */
export type ValuesArgument<Id extends MessageId> = [MessageValues<Id>] extends [undefined]
  ? [values?: undefined]
  : [values: MessageValues<Id>];
