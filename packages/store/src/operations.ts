import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ContractError } from '@everylocale/core';

export type DeliveryEvent = {
  id: string;
  projectId: string;
  type: string;
  entityId: string;
  detail: Record<string, unknown>;
  createdAt: number;
  attempts: number;
};
export type Operations = {
  checkedAt: number;
  projects: Array<{
    id: string;
    spentUsd: number;
    reservedUsd: number;
    budgetUsd: number;
    failed: number;
    pending: number;
    running: number;
    oldestPendingAt: number | null;
  }>;
  delivery: { pending: number; dead: number };
};
export interface DeliveryStore {
  operations(): Operations;
  claimDelivery(): { event: DeliveryEvent; leaseToken: string } | null;
  settleDelivery(id: string, token: string, error?: string): void;
  retryDelivery(id: string): void;
  deliveryEvents(project?: string): Array<DeliveryEvent & { status: string; error: string | null }>;
  backup(path: string): Promise<void>;
}
type Row = {
  id: string;
  project_id: string;
  type: string;
  entity_id: string;
  detail: string;
  created_at: number;
  attempts: number;
  status: string;
  error: string | null;
};
const event = (row: Row): DeliveryEvent => ({
  id: row.id,
  projectId: row.project_id,
  type: row.type,
  entityId: row.entity_id,
  detail: JSON.parse(row.detail),
  createdAt: row.created_at,
  attempts: row.attempts,
});

/** Events are committed with their publication or exception so a crash cannot lose delivery. */
export const deliveryMethods = {
  /** Repeat unresolved health alerts at most hourly, including after a service restart. */
  checkHealth(db: Database.Database, now: number, providersAvailable: boolean) {
    db.transaction(() => {
      for (const project of deliveryMethods.operations(db, now).projects) {
        if (!project.pending) continue;
        const types = [];
        if (!providersAvailable) types.push('alert.provider_unavailable');
        if (project.oldestPendingAt !== null && now - project.oldestPendingAt >= 900000)
          types.push('alert.queue_stalled');
        for (const type of types) {
          const recent = db
            .prepare(
              'SELECT 1 FROM delivery_events WHERE project_id=? AND type=? AND created_at>? LIMIT 1',
            )
            .get(project.id, type, now - 3600000);
          if (!recent)
            deliveryMethods.emit(db, now, project.id, type, project.id, {
              pending: project.pending,
              oldestPendingAt: project.oldestPendingAt,
            });
        }
      }
    }).immediate();
  },
  emit(
    db: Database.Database,
    now: number,
    project: string,
    type: string,
    entity: string,
    detail: Record<string, unknown>,
  ) {
    db.prepare(
      'INSERT INTO delivery_events(id,project_id,type,entity_id,detail,created_at,available_at) VALUES(?,?,?,?,?,?,?)',
    ).run(randomUUID(), project, type, entity, JSON.stringify(detail), now, now);
  },
  operations(db: Database.Database, now: number): Operations {
    const projects = db
      .prepare(
        `SELECT p.id,p.spent AS spentUsd,p.reserved AS reservedUsd,json_extract(p.config,'$.budgetUsd') AS budgetUsd,
      SUM(CASE WHEN j.status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN j.status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN j.status='running' THEN 1 ELSE 0 END) AS running,
      MIN(CASE WHEN j.status='pending' THEN j.created_at END) AS oldestPendingAt
      FROM projects p LEFT JOIN jobs j ON j.project_id=p.id GROUP BY p.id ORDER BY p.id`,
      )
      .all() as Operations['projects'];
    const delivery = db
      .prepare(
        "SELECT COUNT(CASE WHEN status IN ('pending','running') THEN 1 END) AS pending,COUNT(CASE WHEN status='dead' THEN 1 END) AS dead FROM delivery_events",
      )
      .get() as Operations['delivery'];
    return { checkedAt: now, projects, delivery };
  },
  claim(db: Database.Database, now: number) {
    return db
      .transaction(() => {
        db.prepare(
          "UPDATE delivery_events SET status=CASE WHEN attempts>=8 THEN 'dead' ELSE 'pending' END,lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=?",
        ).run(now);
        const row = db
          .prepare(
            "SELECT * FROM delivery_events WHERE status='pending' AND available_at<=? ORDER BY seq LIMIT 1",
          )
          .get(now) as Row | undefined;
        if (!row) return null;
        const leaseToken = randomUUID();
        db.prepare(
          "UPDATE delivery_events SET status='running',attempts=attempts+1,lease_token=?,lease_until=? WHERE id=?",
        ).run(leaseToken, now + 30000, row.id);
        return { event: { ...event(row), attempts: row.attempts + 1 }, leaseToken };
      })
      .immediate();
  },
  settle(db: Database.Database, now: number, id: string, token: string, error?: string) {
    const row = db
      .prepare(
        "SELECT * FROM delivery_events WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
      )
      .get(id, token, now) as Row | undefined;
    if (!row) throw new ContractError('lease_lost', 'Delivery lease is no longer active');
    db.prepare(
      'UPDATE delivery_events SET status=?,error=?,available_at=?,lease_token=NULL,lease_until=NULL WHERE id=?',
    ).run(
      error ? (row.attempts >= 8 ? 'dead' : 'pending') : 'delivered',
      error?.slice(0, 500) ?? null,
      now + Math.min(3600000, 1000 * 2 ** row.attempts),
      id,
    );
  },
  retry(db: Database.Database, now: number, id: string) {
    const result = db
      .prepare(
        "UPDATE delivery_events SET status='pending',attempts=0,error=NULL,available_at=? WHERE id=? AND status='dead'",
      )
      .run(now, id);
    if (!result.changes) throw new ContractError('status', 'Only dead deliveries can be retried');
  },
  events(db: Database.Database, project?: string) {
    const rows = db
      .prepare(
        `SELECT * FROM delivery_events ${project ? 'WHERE project_id=?' : ''} ORDER BY (status='dead') DESC,seq DESC LIMIT 100`,
      )
      .all(...(project ? [project] : [])) as Row[];
    return rows.map((row) => ({ ...event(row), status: row.status, error: row.error }));
  },
  async backup(db: Database.Database, destination: string) {
    try {
      await access(destination);
      throw new Error('Backup destination already exists');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await db.backup(temporary);
      if (process.platform !== 'win32') await chmod(temporary, 0o600);
      // An exclusive hard link avoids overwriting a backup created by another process.
      const { link } = await import('node:fs/promises');
      await link(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  },
};
