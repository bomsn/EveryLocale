import { z } from 'zod';
import type { FailureCode } from './failures.js';

export type ProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  inputPrice: number;
  outputPrice: number;
  maxOutputTokens?: number;
  beforeRequest?: (signal?: AbortSignal) => Promise<void>;
  reasoningEffort?: string;
  transport?: (system: string, payload: unknown, signal?: AbortSignal) => Promise<ModelResult>;
  onUsage?: (result: ModelResult) => void;
  available?: () => boolean;
};
export type ModelResult = {
  value: unknown;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};
export type ProviderErrorOptions = {
  failure: FailureCode;
  /** The worker may try again later; the attempt counts toward the job's limit. */
  retryable?: boolean;
  retryAfterMs?: number;
  /** The provider may have charged for a request whose usage is unknown. */
  uncertainCost?: boolean;
  /** A known charge for a request that still failed. */
  costUsd?: number;
};
export class ProviderError extends Error {
  readonly failure: FailureCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number;
  readonly uncertainCost: boolean;
  readonly costUsd: number | undefined;
  constructor(message: string, options: ProviderErrorOptions) {
    super(message);
    this.failure = options.failure;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.uncertainCost = options.uncertainCost ?? false;
    this.costUsd = options.costUsd;
  }
}
/** HTTP statuses that mean the key, account, permission or model is wrong for every request. */
const CONFIGURATION_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 404]);
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
export function validateProvider(config: ProviderConfig): void {
  const url = new URL(config.baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid provider URL');
  if (
    !config.model ||
    !Number.isFinite(config.inputPrice) ||
    !Number.isFinite(config.outputPrice) ||
    config.inputPrice < 0 ||
    config.outputPrice < 0
  )
    throw new Error('Model and explicit nonnegative prices are required');
  if (
    config.maxOutputTokens !== undefined &&
    (!Number.isInteger(config.maxOutputTokens) ||
      config.maxOutputTokens < 128 ||
      config.maxOutputTokens > 32768)
  )
    throw new Error('Output token limit must be between 128 and 32768');
}
export function reservation(config: ProviderConfig, system: string, payload: unknown): number {
  const input = Buffer.byteLength(system + JSON.stringify(payload), 'utf8') + 2048;
  return (input * config.inputPrice + (config.maxOutputTokens ?? 4096) * config.outputPrice) / 1e6;
}
export async function modelCall(
  config: ProviderConfig,
  system: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<ModelResult> {
  validateProvider(config);
  await config.beforeRequest?.(signal);
  if (config.transport) {
    const result = await config.transport(system, payload, signal);
    config.onUsage?.(result);
    return result;
  }
  const timeout = AbortSignal.timeout(55000);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        temperature: 0,
        max_tokens: config.maxOutputTokens ?? 4096,
        response_format: { type: 'json_object' },
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
      }),
    });
  } catch {
    throw new ProviderError('Provider request failed or timed out', {
      failure: 'provider_unavailable',
      retryable: true,
      uncertainCost: true,
    });
  }
  if (!response.ok) {
    const retry = response.status === 429 || response.status >= 500;
    const failure: FailureCode = retry
      ? 'provider_unavailable'
      : CONFIGURATION_STATUSES.has(response.status)
        ? 'provider_configuration'
        : 'provider_rejected';
    const retryHeader = response.headers.get('retry-after');
    const seconds = retryHeader === null ? NaN : Number(retryHeader);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : retryHeader
        ? Date.parse(retryHeader) - Date.now()
        : 0;
    await response.body?.cancel();
    throw new ProviderError(`Provider returned HTTP ${response.status}`, {
      failure,
      retryable: retry,
      retryAfterMs: Number.isFinite(delay) ? Math.max(0, Math.min(delay, 300000)) : 0,
      uncertainCost: response.status >= 500,
    });
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 1000000) {
          await reader.cancel();
          throw new ProviderError('Provider response exceeds size limit', {
            failure: 'provider_response',
            uncertainCost: true,
          });
        }
        chunks.push(next.value);
      }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Provider response interrupted', {
      failure: 'provider_unavailable',
      retryable: true,
      uncertainCost: true,
    });
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError('Provider returned invalid response JSON', {
      failure: 'provider_response',
      uncertainCost: true,
    });
  }
  const decoded = responseSchema.safeParse(parsed);
  if (!decoded.success)
    throw new ProviderError('Provider returned an unsupported response shape', {
      failure: 'provider_response',
      uncertainCost: true,
    });
  const usage = decoded.data.usage;
  if (!usage && (config.inputPrice > 0 || config.outputPrice > 0))
    throw new ProviderError('Metered provider did not return usage', {
      failure: 'provider_response',
      uncertainCost: true,
    });
  const [choice] = decoded.data.choices;
  if (!choice)
    throw new ProviderError('Provider returned no choices', {
      failure: 'provider_response',
      uncertainCost: true,
    });
  const content = choice.message.content;
  let value: unknown;
  const costUsd = usage
    ? (usage.prompt_tokens * config.inputPrice + usage.completion_tokens * config.outputPrice) / 1e6
    : 0;
  try {
    value = JSON.parse(content);
  } catch {
    throw new ProviderError('Model returned invalid JSON', {
      failure: 'model_output_invalid',
      costUsd,
    });
  }
  const result = {
    value,
    costUsd,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
  config.onUsage?.(result);
  return result;
}
