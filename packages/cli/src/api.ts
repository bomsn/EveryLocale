import { serviceUrl } from '@everylocale/core';

/** Requests to the service time out instead of hanging a build. */
const REQUEST_TIMEOUT_MS = 30000;

export type Api = <T>(path: string, method?: string, body?: unknown, key?: string) => Promise<T>;

/**
 * The service address and a scoped project token come from the environment, never from the
 * config file, so the same config works locally and in CI without committing credentials.
 */
export function createApi(environment: NodeJS.ProcessEnv, urlOverride?: string): Api {
  const base = serviceUrl(urlOverride ?? environment.EVERYLOCALE_URL ?? 'http://localhost:4310');
  const token = environment.EVERYLOCALE_TOKEN;
  return async <T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> => {
    if (!token) throw new Error('Set EVERYLOCALE_TOKEN to a scoped project token');
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${token}`,
        // A JSON content type without a body is rejected, so it is sent only with one.
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // A proxy or gateway error page is reported by its HTTP status.
      throw new Error(`EveryLocale returned HTTP ${String(response.status)} without a JSON body`);
    }
    if (!response.ok)
      throw new Error(
        (data as { error?: { message?: string } }).error?.message ??
          `EveryLocale returned HTTP ${String(response.status)}`,
      );
    return data as T;
  };
}
