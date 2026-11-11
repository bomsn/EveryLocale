import type { ClaimedJob, JobFilters, ProjectSummary, SqliteStore } from './index.js';
import {
  ContractError,
  contextHash,
  hash,
  validateTranslation,
  PIPELINE_REVISION,
} from '@everylocale/core';
import type { Finding, Project, SourceUnit, TranslationRecord } from '@everylocale/core';
import { decodeStrings, decodeUnit } from './decode.js';
import { record, memoryHash } from './rows.js';
import type { JobRow } from './rows.js';
import { deliveryMethods } from './operations.js';
import { randomUUID } from 'node:crypto';

export function release(store: SqliteStore, job: JobRow, uncertain = false) {
  if (job.reserved <= 0) return;
  store.db
    .prepare('UPDATE projects SET reserved=MAX(0,reserved-?),spent=spent+? WHERE id=?')
    .run(job.reserved, uncertain ? job.reserved : 0, job.project_id);
  store.db
    .prepare('UPDATE jobs SET reserved=0,cost=cost+? WHERE id=?')
    .run(uncertain ? job.reserved : 0, job.id);
}

export function stale(store: SqliteStore, job: JobRow) {
  store.release(job, job.status === 'running');
  store.db
    .prepare("UPDATE jobs SET status='stale',lease_token=NULL,lease_until=NULL WHERE id=?")
    .run(job.id);
}

export function enqueue(
  store: SqliteStore,
  projectId: string,
  unitIds: string[],
  locales: string[],
  requestKey: string,
): TranslationRecord[] {
  const project = store.getProject(projectId);
  if (!requestKey || requestKey.length > 200)
    throw new ContractError(
      'idempotency_key',
      'An idempotency key of at most 200 characters is required',
      422,
    );
  if (!locales.length || locales.some((x) => !project.targetLocales.includes(x)))
    throw new ContractError('locale', 'Requested locale is not configured', 422);
  return store.transaction(() => {
    const units = [...new Set(unitIds)]
      .sort()
      .map((id) => ({ id, row: store.source(projectId, id) }));
    const targets = [...new Set(locales)].sort();
    const bodyHash = hash({
      units: units.map((x) => [x.id, x.row.source_hash]),
      targets,
      glossary: project.glossary,
      instructions: project.instructions,
      pipelineRevision: PIPELINE_REVISION,
      approvalMode: project.approvalMode,
    });
    const previous = store.db
      .prepare('SELECT body_hash,job_ids FROM requests WHERE project_id=? AND request_key=?')
      .get(projectId, requestKey) as { body_hash: string; job_ids: string } | undefined;
    if (previous) {
      if (previous.body_hash !== bodyHash)
        throw new ContractError(
          'idempotency_conflict',
          'This key was already used for a different revision',
        );
      return decodeStrings(previous.job_ids).map((id) => store.getJob(projectId, id));
    }
    const ids: string[] = [];
    for (const { id: unitId, row } of units)
      for (const locale of targets) {
        const source = decodeUnit(row.data);
        const context = contextHash(project, source, locale);
        const cached = store.db
          .prepare(
            'SELECT id,status,translation FROM jobs WHERE project_id=? AND unit_id=? AND locale=? AND context_hash=?',
          )
          .get(projectId, unitId, locale, context) as
          | { id: string; status: string; translation: string | null }
          | undefined;
        const memory = store.db
          .prepare(
            'SELECT translation,findings,review_summary FROM translation_memory WHERE project_id=? AND cache_key=?',
          )
          .get(projectId, memoryHash(project, source, locale)) as
          | { translation: string; findings: string; review_summary: string }
          | undefined;
        if (cached) {
          // Returning to an earlier source reuses its correction with a fresh revision approval.
          if (cached.status === 'stale') {
            store.db
              .prepare(
                'UPDATE jobs SET status=?,revision=revision+1,available_at=?,attempts=0,error=NULL WHERE id=?',
              )
              .run(
                cached.translation && memory?.translation === cached.translation
                  ? 'review'
                  : 'pending',
                store.now(),
                cached.id,
              );
            store.approveAutomatically(project, cached.id);
          }
          ids.push(cached.id);
          continue;
        }
        const id = randomUUID();
        store.db
          .prepare(
            "INSERT INTO jobs(id,project_id,unit_id,locale,source_hash,context_hash,source_data,status,available_at,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)",
          )
          .run(
            id,
            projectId,
            unitId,
            locale,
            row.source_hash,
            context,
            row.data,
            store.now(),
            store.now(),
          );
        const correction = store.db
          .prepare(
            "SELECT translation FROM jobs WHERE project_id=? AND unit_id=? AND locale=? AND source_hash=? AND operation='review' AND translation IS NOT NULL ORDER BY seq DESC LIMIT 1",
          )
          .get(projectId, unitId, locale, row.source_hash) as { translation: string } | undefined;
        // New guidance rechecks a person's wording instead of silently replacing their correction.
        if (correction)
          store.db
            .prepare("UPDATE jobs SET operation='review',translation=?,revision=1 WHERE id=?")
            .run(correction.translation, id);
        else if (memory)
          store.db
            .prepare(
              "UPDATE jobs SET status='review',translation=?,findings=?,review_summary=?,revision=1 WHERE id=?",
            )
            .run(memory.translation, memory.findings, memory.review_summary, id);
        store.approveAutomatically(project, id);
        ids.push(id);
      }
    store.db
      .prepare('INSERT INTO requests(project_id,request_key,body_hash,job_ids) VALUES(?,?,?,?)')
      .run(projectId, requestKey, bodyHash, JSON.stringify(ids));
    return ids.map((id) => store.getJob(projectId, id));
  });
}

export function getJob(store: SqliteStore, projectId: string, id: string): TranslationRecord {
  const row = store.db
    .prepare('SELECT * FROM jobs WHERE id=? AND project_id=?')
    .get(id, projectId) as JobRow | undefined;
  if (!row) throw new ContractError('not_found', 'Translation not found', 404);
  return record(row);
}

export function listJobs(
  store: SqliteStore,
  projectId: string,
  locale?: string,
  cursor = 0,
  limit = 100,
  filters: JobFilters = {},
): { records: TranslationRecord[]; cursor: number | null } {
  const project = store.getProject(projectId);
  const rows = store.db
    .prepare(
      `SELECT jobs.* FROM jobs WHERE project_id=? AND seq>? ${locale ? 'AND locale=?' : ''} ${filters.status ? 'AND status=?' : ''} ORDER BY seq`,
    )
    .iterate(
      projectId,
      cursor,
      ...(locale ? [locale] : []),
      ...(filters.status ? [filters.status] : []),
    );
  const sources = filters.current ? store.currentSources(projectId) : null;
  const page: Array<JobRow & { seq: number }> = [];
  const search = filters.search?.toLocaleLowerCase();
  for (const raw of rows) {
    const row = raw as JobRow & { seq: number };
    const unit = decodeUnit(row.source_data);
    if (
      sources &&
      (!project.targetLocales.includes(row.locale) ||
        sources.get(row.unit_id)?.source_hash !== row.source_hash ||
        contextHash(project, unit, row.locale) !== row.context_hash)
    )
      continue;
    if (
      search &&
      ![unit.source, unit.context, unit.id, row.translation ?? ''].some((value) =>
        value.toLocaleLowerCase().includes(search),
      )
    )
      continue;
    const last = page.at(-1);
    if (last && page.length === limit) return { records: page.map(record), cursor: last.seq };
    page.push(row);
  }
  return { records: page.map(record), cursor: null };
}

/** Coverage counts the current source and guidance, while previous publications stay live. */
export function summary(store: SqliteStore, projectId: string): ProjectSummary {
  const project = store.getProject(projectId),
    sources = store.currentSources(projectId);
  const jobs = new Map(
    (
      store.db
        .prepare(
          'SELECT unit_id,locale,context_hash,source_hash,status FROM jobs WHERE project_id=?',
        )
        .all(projectId) as Array<
        Pick<JobRow, 'unit_id' | 'locale' | 'context_hash' | 'source_hash' | 'status'>
      >
    ).map((row) => [`${row.unit_id}\0${row.locale}\0${row.context_hash}`, row]),
  );
  return {
    sourceUnits: sources.size,
    languages: project.targetLocales.map((locale) => {
      const counts = {
        locale,
        total: sources.size,
        approved: 0,
        review: 0,
        working: 0,
        failed: 0,
        untranslated: 0,
      };
      for (const source of sources.values()) {
        const unit = decodeUnit(source.data);
        const job = jobs.get(`${unit.id}\0${locale}\0${contextHash(project, unit, locale)}`);
        if (!job || job.source_hash !== source.source_hash || job.status === 'stale')
          counts.untranslated++;
        else if (job.status === 'approved') counts.approved++;
        else if (job.status === 'review') counts.review++;
        else if (job.status === 'failed') counts.failed++;
        else counts.working++;
      }
      return counts;
    }),
  };
}

export function leased(store: SqliteStore, id: string, token: string): JobRow {
  const row = store.db
    .prepare(
      "SELECT * FROM jobs WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
    )
    .get(id, token, store.now()) as JobRow | undefined;
  if (!row) throw new ContractError('lease_lost', 'Translation lease expired or source changed');
  return row;
}

export function claim(
  store: SqliteStore,
  estimate: (
    project: Project,
    source: SourceUnit,
    locale: string,
    reviewOnly: boolean,
    translation: string | null,
  ) => number,
): ClaimedJob | null {
  return store.transaction(() => {
    for (const expired of store.db
      .prepare("SELECT * FROM jobs WHERE status='running' AND lease_until<=?")
      .all(store.now()) as JobRow[]) {
      store.release(expired, true);
      store.db
        .prepare('UPDATE jobs SET status=?,lease_token=NULL,lease_until=NULL,error=? WHERE id=?')
        .run(
          expired.attempts >= 3 ? 'failed' : 'pending',
          'Previous worker lease expired; reserved cost charged conservatively',
          expired.id,
        );
      if (expired.attempts >= 3)
        deliveryMethods.emit(
          store.db,
          store.now(),
          expired.project_id,
          'alert.translation_failed',
          expired.id,
          { locale: expired.locale, reason: 'worker_interrupted' },
        );
    }
    const pending = store.db
      .prepare(
        `WITH ranked AS (
            SELECT seq,ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY seq) AS position
            FROM jobs WHERE status='pending' AND available_at<=?
          ) SELECT jobs.* FROM ranked JOIN jobs USING(seq) ORDER BY ranked.position,jobs.seq LIMIT 100`,
      )
      .all(store.now()) as JobRow[];
    for (const job of pending) {
      const project = store.getProject(job.project_id);
      const unit = decodeUnit(job.source_data);
      const source = store.source(job.project_id, job.unit_id);
      if (
        source.source_hash !== job.source_hash ||
        contextHash(project, unit, job.locale) !== job.context_hash
      ) {
        store.stale(job);
        continue;
      }
      const reviewOnly = (job as JobRow & { operation: string }).operation === 'review';
      let reserve: number;
      try {
        reserve = estimate(project, unit, job.locale, reviewOnly, job.translation);
        if (!Number.isFinite(reserve) || reserve < 0) throw new Error('Invalid reservation');
      } catch {
        store.db
          .prepare(
            "UPDATE jobs SET status='failed',error='Source structure or provider cost reservation is invalid' WHERE id=?",
          )
          .run(job.id);
        deliveryMethods.emit(
          store.db,
          store.now(),
          job.project_id,
          'alert.translation_failed',
          job.id,
          { locale: job.locale, reason: 'invalid_reservation' },
        );
        continue;
      }
      const claimed = store.db
        .prepare(
          "UPDATE projects SET reserved=reserved+? WHERE id=? AND spent+reserved+?<=json_extract(config,'$.budgetUsd')+0.000000001",
        )
        .run(reserve, job.project_id, reserve);
      if (!claimed.changes) {
        // Active jobs can release unused reservations; pending work must wait for that balance.
        if (
          store.db
            .prepare(
              "SELECT 1 FROM projects WHERE id=? AND spent+?<=json_extract(config,'$.budgetUsd')+0.000000001",
            )
            .get(job.project_id, reserve)
        )
          continue;
        store.db
          .prepare("UPDATE jobs SET status='failed',error='Project budget exhausted' WHERE id=?")
          .run(job.id);
        deliveryMethods.emit(
          store.db,
          store.now(),
          job.project_id,
          'alert.budget_exhausted',
          job.id,
          { locale: job.locale },
        );
        continue;
      }
      const leaseToken = randomUUID();
      store.db
        .prepare(
          "UPDATE jobs SET status='running',attempts=attempts+1,reserved=?,lease_token=?,lease_until=?,error=NULL WHERE id=?",
        )
        .run(reserve, leaseToken, store.now() + 150000, job.id);
      return { record: store.getJob(job.project_id, job.id), leaseToken, project, reviewOnly };
    }
    return null;
  });
}

export function heartbeat(store: SqliteStore, id: string, token: string) {
  store.transaction(() => {
    store.leased(id, token);
    store.db.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run(store.now() + 150000, id);
  });
}

export function charge(store: SqliteStore, id: string, token: string, cost: number) {
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Invalid provider charge');
  const overrun = store.transaction(() => {
    const job = store.leased(id, token);
    const release = Math.min(job.reserved, cost);
    store.db
      .prepare('UPDATE projects SET spent=spent+?,reserved=MAX(0,reserved-?) WHERE id=?')
      .run(cost, release, job.project_id);
    store.db
      .prepare('UPDATE jobs SET cost=cost+?,reserved=MAX(0,reserved-?) WHERE id=?')
      .run(cost, release, id);
    return cost > job.reserved + 1e-9;
  });
  if (overrun) throw new ContractError('cost_overrun', 'Provider usage exceeded its reservation');
}

export function complete(
  store: SqliteStore,
  id: string,
  token: string,
  translation: string,
  findings: Finding[],
  summary: string,
) {
  store.transaction(() => {
    const job = store.leased(id, token);
    const unit = decodeUnit(job.source_data);
    const project = store.getProject(job.project_id);
    if (
      store.source(job.project_id, job.unit_id).source_hash !== job.source_hash ||
      contextHash(project, unit, job.locale) !== job.context_hash
    )
      throw new ContractError('stale_source', 'Source changed while translating');
    const structural = validateTranslation(unit, translation, job.locale, project.glossary);
    store.release(job);
    const unique = [
      ...new Map(
        [...structural, ...findings].map((finding) => [JSON.stringify(finding), finding]),
      ).values(),
    ];
    store.db
      .prepare(
        "UPDATE jobs SET translation=?,findings=?,review_summary=?,revision=revision+1,status='review',lease_token=NULL,lease_until=NULL WHERE id=?",
      )
      .run(translation, JSON.stringify(unique), summary, id);
    if (!unique.some((finding) => finding.severity === 'critical'))
      store.db
        .prepare(
          'INSERT INTO translation_memory(project_id,cache_key,translation,findings,review_summary) VALUES(?,?,?,?,?) ON CONFLICT(project_id,cache_key) DO UPDATE SET translation=excluded.translation,findings=excluded.findings,review_summary=excluded.review_summary',
        )
        .run(
          job.project_id,
          memoryHash(project, unit, job.locale),
          translation,
          JSON.stringify(unique),
          summary,
        );
    store.approveAutomatically(project, id);
    if (
      project.approvalMode === 'automatic' &&
      unique.some((finding) => finding.severity !== 'minor')
    )
      deliveryMethods.emit(store.db, store.now(), job.project_id, 'alert.review_required', id, {
        locale: job.locale,
      });
  });
}

export function fail(
  store: SqliteStore,
  id: string,
  token: string,
  message: string,
  retryAfterMs?: number,
  uncertainCost = false,
) {
  store.transaction(() => {
    const job = store.leased(id, token);
    store.release(job, uncertainCost);
    const retry = retryAfterMs !== undefined && job.attempts < 3;
    store.db
      .prepare(
        'UPDATE jobs SET status=?,error=?,lease_token=NULL,lease_until=NULL,available_at=? WHERE id=?',
      )
      .run(
        retry ? 'pending' : 'failed',
        message.slice(0, 500),
        store.now() + (retryAfterMs ?? 0),
        id,
      );
    if (!retry)
      deliveryMethods.emit(store.db, store.now(), job.project_id, 'alert.translation_failed', id, {
        locale: job.locale,
      });
  });
}

export function retry(store: SqliteStore, projectId: string, id: string, actor: string) {
  store.transaction(() => {
    const job = store.getJob(projectId, id);
    if (job.status !== 'failed')
      throw new ContractError('status', 'Only failed jobs can be retried');
    if (store.source(projectId, job.unitId).source_hash !== job.sourceHash)
      throw new ContractError('stale_source', 'Import a new job for the current source');
    store.db
      .prepare("UPDATE jobs SET status='pending',attempts=0,error=NULL,available_at=? WHERE id=?")
      .run(store.now(), id);
    store.audit(projectId, actor, 'translation.retry', id);
  });
}
