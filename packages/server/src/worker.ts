import {
  estimateReservation,
  estimateReviewReservation,
  ProviderError,
  translateAndReview,
  reviewTranslation,
  validateTranslation,
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
export class TranslationWorker {
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = new Set<Promise<void>>();
  private nextStart = 0;
  private abort = new AbortController();
  constructor(
    private store: LocalizationStore,
    private config: WorkerConfig,
    private report: (message: string) => void = console.error,
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
        this.config.generator.available?.() !== false &&
        this.config.reviewer.available?.() !== false
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
    } catch {
      this.report('Translation worker could not claim a job');
    }
    this.timer = setTimeout(this.tick, 200);
    this.timer.unref();
  };
  private async run(job: ClaimedJob) {
    const { id } = job.record;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      try {
        this.store.heartbeat(id, job.leaseToken);
      } catch {
        leaseLost = true;
      }
    }, 30000);
    try {
      if (
        validateTranslation(
          job.record.source,
          job.record.source.source,
          job.record.source.sourceLocale,
        ).some((finding) => finding.severity === 'critical')
      )
        throw new Error('Invalid source structure');
      const charge = (cost: number) => this.store.charge(id, job.leaseToken, cost);
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
      if (!leaseLost)
        this.store.complete(
          id,
          job.leaseToken,
          result.translation,
          result.findings,
          result.summary,
        );
    } catch (error) {
      if (!leaseLost) {
        const retry = error instanceof ProviderError && error.retryable;
        const delay = retry
          ? Math.max(
              error.retryAfterMs,
              1000 * 2 ** job.record.attempts + Math.floor(Math.random() * 500),
            )
          : undefined;
        try {
          if (error instanceof ProviderError && error.costUsd !== undefined)
            this.store.charge(id, job.leaseToken, error.costUsd);
          this.store.fail(
            id,
            job.leaseToken,
            error instanceof ProviderError
              ? error.message
              : 'Translation or review failed validation',
            delay,
            error instanceof ProviderError && error.uncertainCost,
          );
        } catch {
          this.report('Translation lease no longer belongs to this worker');
        }
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort.abort();
    await Promise.allSettled(this.active);
  }
}
