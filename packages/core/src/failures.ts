/**
 * Every way a translation job can fail, with what it means for the operator. Jobs, alerts and
 * the API report these codes; adding a cause means adding it here.
 */
export const FAILURES = {
  provider_configuration: {
    pausesProvider: true,
    description: 'The provider rejected the key, account, permission or model.',
    action: 'Fix the provider settings, restart the service, then retry failed jobs.',
  },
  provider_unavailable: {
    pausesProvider: false,
    description: 'The provider could not be reached or was overloaded after retries.',
    action: 'Check the provider status; queued work continues when it recovers.',
  },
  provider_rejected: {
    pausesProvider: false,
    description: 'The provider refused this request, for example because it was too large.',
    action: 'Shorten or split the source, or raise the output limit, then retry.',
  },
  provider_response: {
    pausesProvider: false,
    description: 'The provider returned a response that was malformed, oversized or unmetered.',
    action: 'Check that the endpoint is OpenAI-compatible and reports token usage.',
  },
  model_output_invalid: {
    pausesProvider: false,
    description: 'The model did not return the required JSON.',
    action: 'Retry, or choose a model that supports JSON responses.',
  },
  structure_invalid: {
    pausesProvider: false,
    description: 'The source message has invalid ICU or protected structure.',
    action: 'Correct the source message and import it again.',
  },
  budget_exhausted: {
    pausesProvider: false,
    description: "The project's spending limit cannot cover this job.",
    action: 'Raise the project budget if appropriate, then retry.',
  },
  cost_overrun: {
    pausesProvider: false,
    description: 'Provider usage exceeded the amount reserved for the job.',
    action: 'Check the configured token prices and output limit.',
  },
  lease_expired: {
    pausesProvider: false,
    description: 'A worker stopped while processing the job three times.',
    action: 'Check the service logs for restarts or crashes, then retry.',
  },
  internal: {
    pausesProvider: false,
    description: 'An unexpected error occurred in the service.',
    action: 'Check the service logs for the error, then retry.',
  },
} as const satisfies Record<
  string,
  { pausesProvider: boolean; description: string; action: string }
>;
export type FailureCode = keyof typeof FAILURES;
export const FAILURE_CODES = Object.keys(FAILURES) as FailureCode[];
