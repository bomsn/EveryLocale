import {
  ContractError,
  estimateReservation,
  estimateReviewReservation,
  FAILURES,
  ProviderError,
  translateAndReview,
  reviewTranslation,
  validateTranslation,
  type FailureCode,
  type ProviderConfig,
} from '@everylocale/core';
import type { LocalizationStore, ClaimedJob } from '@everylocale/store';
import { setTimeout as delay } from 'node:timers/promises';

export type WorkerConfig = {
  generator: ProviderConfig;
  reviewer: ProviderConfig;
  concurrency: number;
  intervalMs: number;
};
/** The subset of a pino logger the worker writes to. */
export type WorkerLog = {
  error(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
};
export type ProviderPause = { failure: FailureCode; message: string; since: number };

const HEARTBEAT_MS = 30000;
const TICK_MS = 200;

class InvalidSourceError extends Error {}

/** Every error a job can end with maps to exactly one failure code. */
function classify(error: unknown): { failure: FailureCode; message: string } {
  if (error instanceof ProviderError) return { failure: error.failure, message: error.message };
  if (error instanceof InvalidSourceError)
    return { failure: 'structure_invalid', message: error.message };
  if (error instanceof ContractError && error.code === 'cost_overrun')
    return { failure: 'cost_overrun', message: error.message };
  return { failure: 'internal', message: 'Unexpected error; see the service log' };
}

export class TranslationWorker {
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = new Set<Promise<void>>();
  private nextStart = 0;
  private abort = new AbortController();
  private pause: ProviderPause | null = null;
  constructor(
    private store: LocalizationStore,
    private config: WorkerConfig,
    private log: WorkerLog,
  ) {
    const nextRequest = new Map<string, number>();
    const wrap = (provider: ProviderConfig): ProviderConfig => ({
      ...provider,
      beforeRequest: async (signal) => {
        await provider.beforeRequest?.(signal);
        const key = provider.baseUrl;
        const start = Math.max(Date.now(), nextRequest.get(key) ?? 0);
        nextRequest.set(key, start + config.intervalMs);
        if (start > Date.now()) await delay(start - Date.now(), undefined, { signal });
      },
    });
    this.config = { ...config, generator: wrap(config.generator), reviewer: wrap(config.reviewer) };
  }
  /** Whether new work can start: providers configured, available and not paused. */
  available(): boolean {
    return (
      !this.pause &&
      this.config.generator.available?.() !== false &&
      this.config.reviewer.available?.() !== false
    );
  }
  status(): { paused: ProviderPause | null } {
    return { paused: this.pause };
  }
  /** The owner resumes after fixing the provider; queued work then continues. */
  resume() {
    if (this.pause) this.log.warn({ event: 'provider_resumed' }, 'translation provider resumed');
    this.pause = null;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.tick();
  }
  private tick = () => {
    if (this.stopped) return;
    try {
      if (
        this.active.size < this.config.concurrency &&
        Date.now() >= this.nextStart &&
        this.available()
      ) {
        const job = this.store.claim((project, unit, locale, reviewOnly, translation) =>
          reviewOnly && translation !== null
            ? estimateReviewReservation(project, unit, locale, translation, this.config.reviewer)
            : estimateReservation(
                project,
                unit,
                locale,
                this.config.generator,
                this.config.reviewer,
              ),
        );
        if (job) {
          this.nextStart = Date.now() + this.config.intervalMs;
          const task = this.run(job).finally(() => this.active.delete(task));
          this.active.add(task);
        }
      }
    } catch (error) {
      this.log.error(
        { err: error, event: 'claim_failed' },
        'translation worker could not claim a job',
      );
    }
    this.timer = setTimeout(this.tick, TICK_MS);
    this.timer.unref();
  };
  private async run(job: ClaimedJob) {
    const { id } = job.record;
    // The heartbeat runs in a timer, so the flag lives in an object the closure can update.
    const lease = { lost: false };
    const heartbeat = setInterval(() => {
      try {
        this.store.heartbeat(id, job.leaseToken);
      } catch {
        lease.lost = true;
      }
    }, HEARTBEAT_MS);
    try {
      if (
        validateTranslation(
          job.record.source,
          job.record.source.source,
          job.record.source.sourceLocale,
        ).some((finding) => finding.severity === 'critical')
      )
        throw new InvalidSourceError('The source message has invalid structure');
      const charge = (cost: number) => {
        this.store.charge(id, job.leaseToken, cost);
      };
      const result =
        job.reviewOnly && job.record.translation
          ? await reviewTranslation(
              job.project,
              job.record.source,
              job.record.locale,
              job.record.translation,
              this.config.reviewer,
              charge,
              this.abort.signal,
            )
          : await translateAndReview(
              job.project,
              job.record.source,
              job.record.locale,
              this.config.generator,
              this.config.reviewer,
              charge,
              this.abort.signal,
            );
      if (!lease.lost)
        this.store.complete(
          id,
          job.leaseToken,
          result.translation,
          result.findings,
          result.summary,
        );
    } catch (error) {
      if (!lease.lost) this.failed(job, error);
    } finally {
      clearInterval(heartbeat);
    }
  }
  private failed(job: ClaimedJob, error: unknown) {
    const { id, attempts } = job.record;
    const { failure, message } = classify(error);
    const provider = error instanceof ProviderError ? error : null;
    if (failure === 'internal')
      this.log.error({ err: error, event: 'job_failed', jobId: id }, 'translation job failed');
    const pauses = FAILURES[failure].pausesProvider && !this.abort.signal.aborted;
    if (pauses && !this.pause) {
      this.pause = { failure, message, since: Date.now() };
      this.log.error({ event: 'provider_paused', failure }, message);
    }
    try {
      if (provider?.costUsd !== undefined) this.store.charge(id, job.leaseToken, provider.costUsd);
      this.store.fail(id, job.leaseToken, failure, message, {
        uncertainCost: provider?.uncertainCost ?? false,
        requeue: pauses,
        ...(provider?.retryable
          ? {
              retryAfterMs: Math.max(
                provider.retryAfterMs,
                1000 * 2 ** attempts + Math.floor(Math.random() * 500),
              ),
            }
          : {}),
      });
    } catch (settleError) {
      this.log.warn(
        { err: settleError, event: 'lease_lost', jobId: id },
        'translation lease no longer belongs to this worker',
      );
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort.abort();
    await Promise.allSettled(this.active);
  }
}
