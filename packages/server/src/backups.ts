import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyDatabase, type DeliveryStore } from '@everylocale/store';
import type { WorkerLog } from './worker.js';

export type BackupConfig = {
  directory: string;
  intervalMs: number;
  /** How many verified backups to keep; older ones are deleted after a new one succeeds. */
  keep: number;
};

const PREFIX = 'everylocale-';
const SUFFIX = '.sqlite';

/**
 * Takes consistent online backups on a schedule, verifies each one, keeps the newest `keep`,
 * and records a durable alert when a backup fails, so an unattended service is never silently
 * without a recent backup.
 */
export class BackupScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  constructor(
    private store: DeliveryStore,
    private config: BackupConfig,
    private log: WorkerLog,
    private now: () => number = Date.now,
  ) {}
  start() {
    this.timer = setInterval(() => void this.backupOnce(), this.config.intervalMs);
    this.timer.unref();
  }
  async backupOnce(): Promise<string | null> {
    if (this.running) return null;
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const path = join(this.config.directory, `${PREFIX}${stamp}${SUFFIX}`);
    let completed: string | null = null;
    this.running = (async () => {
      try {
        await this.store.backup(path);
        verifyDatabase(path);
        const backups = (await readdir(this.config.directory))
          .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
          .sort();
        for (const old of backups.slice(0, Math.max(0, backups.length - this.config.keep)))
          await rm(join(this.config.directory, old), { force: true });
        completed = path;
      } catch (error) {
        this.log.error({ err: error, event: 'backup_failed' }, 'scheduled backup failed');
        this.store.recordAlert('alert.backup_failed', {
          reason: error instanceof Error ? error.message.slice(0, 300) : 'Backup failed',
        });
      }
    })();
    await this.running;
    this.running = undefined;
    return completed;
  }
  async stop() {
    clearInterval(this.timer);
    await this.running;
  }
}
