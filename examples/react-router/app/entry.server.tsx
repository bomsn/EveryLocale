import { PassThrough } from 'node:stream';
import { createReadableStreamFromReadable } from '@react-router/node';
import { renderToPipeableStream } from 'react-dom/server';
import { ServerRouter, type EntryContext } from 'react-router';

export const streamTimeout = 5_000;

/**
 * This example defers no data, so every response waits for the complete document. Visitors
 * and crawlers receive the same fully translated HTML, and no user-agent detection is needed.
 */
export default function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  if (request.method.toUpperCase() === 'HEAD') return new Response(null, { status, headers });
  return new Promise<Response>((resolve, reject) => {
    let responseStatus = status;
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={context} url={request.url} />,
      {
        onAllReady() {
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeout);
              callback();
            },
          });
          headers.set('Content-Type', 'text/html; charset=utf-8');
          pipe(body);
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers,
              status: responseStatus,
            }),
          );
        },
        onShellError: reject,
        onError(error) {
          responseStatus = 500;
          console.error(error);
        },
      },
    );
    // Aborting flushes whatever boundaries are still pending as client-rendered fallbacks.
    const timeout = setTimeout(abort, streamTimeout + 1000);
  });
}
