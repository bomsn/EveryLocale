import { createContext, Fragment, useContext, useMemo, type ReactNode } from 'react';
import {
  createFormatter,
  type CompiledMessages,
  type Formatter,
  type MessageId,
  type MessageValues,
  type MissingMessageHandler,
  type TypedMessages,
} from '@everylocale/runtime';

const FormatterContext = createContext<Formatter | null>(null);

export type EveryLocaleProviderProps = {
  /** The locale the server resolved for this request; there is no default. */
  locale: string;
  /** Precompiled messages for the namespaces this page uses, from the server's release. */
  messages: CompiledMessages;
  missing?: 'report' | 'throw';
  onMissing?: MissingMessageHandler;
  children: ReactNode;
};

/**
 * Provides formatting for one locale. Server rendering and hydration receive the same locale
 * and messages from the request, so the browser never makes a second language decision.
 */
export function EveryLocaleProvider({
  locale,
  messages,
  missing,
  onMissing,
  children,
}: EveryLocaleProviderProps) {
  const formatter = useMemo(
    () => createFormatter({ locale, messages, missing, onMissing }),
    [locale, messages, missing, onMissing],
  );
  return <FormatterContext.Provider value={formatter}>{children}</FormatterContext.Provider>;
}

/** The formatter of the nearest provider: `format(id, values)` returns text. */
export function useMessages(): Formatter {
  const formatter = useContext(FormatterContext);
  if (!formatter) throw new Error('useMessages and Message need an EveryLocaleProvider above them');
  return formatter;
}

type ValuesProp<Id extends MessageId> = TypedMessages extends false
  ? { values?: Record<string, unknown> }
  : [MessageValues<Id>] extends [undefined]
    ? { values?: undefined }
    : { values: MessageValues<Id> };

/**
 * Renders a message. Rich-text tags are rendered by functions in `values`, for example
 * `{ link: (chunks) => <a href="/help">{chunks}</a> }`, and receive the already formatted parts.
 */
export function Message<Id extends MessageId>(props: { id: Id } & ValuesProp<Id>) {
  const formatter = useMessages();
  const parts = (formatter.formatParts as (id: string, values?: unknown) => unknown[])(
    props.id,
    props.values,
  );
  // Parts are formatted text and the elements tag renderers returned, in a fixed order, so
  // their index is a stable key.
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part as ReactNode}</Fragment>
      ))}
    </>
  );
}
