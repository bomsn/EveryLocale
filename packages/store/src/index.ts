import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ContractError,
  contextHash,
  hash,
  projectSchema,
  sourceHash,
  unitSchema,
  validateTranslation,
  extractDocument,
  PIPELINE_REVISION,
  type ExtractedDocument,
  type ApprovedCatalog,
  type Finding,
  type Project,
  type SourceUnit,
  type TranslationRecord,
} from '@everylocale/core';
import { SCHEMA } from './schema.js';
import { deliveryMethods, type DeliveryStore } from './operations.js';
export type { DeliveryStore, DeliveryEvent, Operations } from './operations.js';

type JobRow = {
  id: string;
  project_id: string;
  unit_id: string;
  locale: string;
  source_hash: string;
  context_hash: string;
  source_data: string;
  translation: string | null;
  revision: number;
  status: TranslationRecord['status'];
  findings: string;
  review_summary: string;
  attempts: number;
  error: string | null;
  cost: number;
  reserved: number;
  approval_revision: number | null;
  lease_token: string | null;
  lease_until: number | null;
};
type SourceRow = { data: string; source_hash: string; active: number };
type PublicationRow = { unit_id: string; translation: string; source_hash: string };
export type Scope = 'read' | 'import' | 'translate' | 'review' | 'approve' | 'export';
export type JobFilters = {
  status?: TranslationRecord['status'];
  search?: string;
  current?: boolean;
};
export type ProjectSummary = {
  sourceUnits: number;
  languages: Array<{
    locale: string;
    total: number;
    approved: number;
    review: number;
    working: number;
    failed: number;
    untranslated: number;
  }>;
};
export type ClaimedJob = {
  record: TranslationRecord;
  leaseToken: string;
  project: Project;
  reviewOnly: boolean;
};
export interface TranslationStore {
  getProject(id: string): Project;
  importSources(projectId: string, units: SourceUnit[]): { changed: string[]; unchanged: string[] };
  enqueue(
    projectId: string,
    unitIds: string[],
    locales: string[],
    requestKey: string,
  ): TranslationRecord[];
  claim(
    estimate: (
      project: Project,
      source: SourceUnit,
      locale: string,
      reviewOnly: boolean,
      translation: string | null,
    ) => number,
  ): ClaimedJob | null;
  heartbeat(id: string, leaseToken: string): void;
  charge(id: string, leaseToken: string, cost: number): void;
  complete(
    id: string,
    leaseToken: string,
    translation: string,
    findings: Finding[],
    summary: string,
  ): void;
  fail(
    id: string,
    leaseToken: string,
    message: string,
    retryAfterMs?: number,
    uncertainCost?: boolean,
  ): void;
  approve(
    projectId: string,
    id: string,
    revision: number,
    actor: string,
    overrideReason?: string,
  ): void;
  exportCatalog(projectId: string, locale: string, requireCurrent?: boolean): ApprovedCatalog;
  exportBundle(
    projectId: string,
    requireCurrent?: boolean,
  ): import('@everylocale/core').CatalogBundle;
}
export interface LocalizationStore extends TranslationStore, DeliveryStore {
  close(): void;
  saveProject(project: Project, actor?: string): Project;
  listProjects(): Array<Project & { spentUsd: number; reservedUsd: number }>;
  importDocument(
    project: string,
    namespace: string,
    format: ExtractedDocument['format'],
    content: string,
  ): { changed: string[]; unchanged: string[]; units: string[]; sourceRevision: string };
  exportDocument(
    project: string,
    namespace: string,
    locale: string,
  ): {
    namespace: string;
    locale: string;
    sourceRevision: string;
    revision: string;
    content: string;
  };
  previewDocument(
    project: string,
    namespace: string,
    locale: string,
  ): {
    format: ExtractedDocument['format'];
    source: string;
    translation: string;
    sourceLocale: string;
    pendingUnits: string[];
    sourceRevision: string;
  };
  documents(
    project: string,
  ): Array<{ namespace: string; format: string; units: string[]; sourceRevision: string }>;
  withdraw(project: string, unitIds: string[], actor: string): void;
  getJob(project: string, id: string): TranslationRecord;
  listJobs(
    project: string,
    locale?: string,
    cursor?: number,
    limit?: number,
    filters?: JobFilters,
  ): { records: TranslationRecord[]; cursor: number | null };
  summary(project: string): ProjectSummary;
  edit(project: string, id: string, revision: number, translation: string, actor: string): void;
  approveBatch(
    project: string,
    entries: Array<{ id: string; revision: number }>,
    actor: string,
  ): void;
  retry(project: string, id: string, actor: string): void;
  snapshot(project: string, locale: string): ApprovedCatalog;
  rollback(project: string, locale: string, artifact: string, actor: string): void;
  mintToken(
    project: string,
    scopes: Scope[],
    expiresAt: number,
  ): { id: string; token: string; expiresAt: number };
  authenticate(token: string): { projectId: string; scopes: Scope[]; actor: string } | null;
  authenticateId(id: string): { projectId: string; scopes: Scope[]; actor: string } | null;
  tokens(project: string): Array<{
    id: string;
    scopes: Scope[];
    created_at: number;
    expires_at: number;
    revoked: number;
  }>;
  revokeToken(project: string, id: string, actor: string): void;
  artifacts(
    project: string,
    locale?: string,
  ): Array<{ id: string; locale: string; created_at: number }>;
  auditLog(project: string): Array<{
    actor: string;
    action: string;
    entity_id: string;
    detail: string;
    created_at: number;
  }>;
}

function record(row: JobRow): TranslationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    unitId: row.unit_id,
    locale: row.locale,
    sourceHash: row.source_hash,
    contextHash: row.context_hash,
    source: JSON.parse(row.source_data),
    translation: row.translation,
    revision: row.revision,
    status: row.status,
    findings: JSON.parse(row.findings),
    reviewSummary: row.review_summary,
    attempts: row.attempts,
    error: row.error,
    costUsd: row.cost,
    approvalRevision: row.approval_revision,
  };
}
const memoryHash = (project: Project, source: SourceUnit, locale: string) =>
  contextHash(project, { ...source, id: 'translation-memory' }, locale);
/** All source, budget, approval, and publication changes share SQLite transactions. */
export class SqliteStore implements LocalizationStore {
  readonly operations = () => deliveryMethods.operations(this.db, this.now());
  readonly checkHealth = (providersAvailable: boolean) =>
    deliveryMethods.checkHealth(this.db, this.now(), providersAvailable);
  readonly claimDelivery = () => deliveryMethods.claim(this.db, this.now());
  readonly settleDelivery = (id: string, token: string, error?: string) =>
    deliveryMethods.settle(this.db, this.now(), id, token, error);
  readonly retryDelivery = (id: string) => deliveryMethods.retry(this.db, this.now(), id);
  readonly deliveryEvents = (project?: string) => deliveryMethods.events(this.db, project);
  readonly backup = (path: string) => deliveryMethods.backup(this.db, path);
  readonly db: Database.Database;
  constructor(
    path: string,
    private now: () => number = Date.now,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { timeout: 5000 });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 3) throw new Error('Database schema is newer than this service');
    this.db.exec(SCHEMA);
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  private audit(
    projectId: string,
    actor: string,
    action: string,
    entityId: string,
    detail: unknown = {},
  ) {
    this.db
      .prepare(
        'INSERT INTO audit(project_id,actor,action,entity_id,detail,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(projectId, actor, action, entityId, JSON.stringify(detail), this.now());
    if (['translation.approve', 'source.withdraw', 'publication.rollback'].includes(action))
      deliveryMethods.emit(this.db, this.now(), projectId, 'publication.changed', entityId, {
        action,
        ...(detail as object),
      });
  }
  getProject(id: string): Project {
    const row = this.db.prepare('SELECT config FROM projects WHERE id=?').get(id) as
      | { config: string }
      | undefined;
    if (!row) throw new ContractError('not_found', 'Project not found', 404);
    return projectSchema.parse(JSON.parse(row.config));
  }
  saveProject(input: Project, actor = 'owner'): Project {
    const project = projectSchema.parse(input);
    if (
      new Set(project.targetLocales).size !== project.targetLocales.length ||
      project.targetLocales.includes(project.sourceLocale)
    )
      throw new ContractError(
        'locales',
        'Target locales must be unique and distinct from the source',
        422,
      );
    for (const locale of [project.sourceLocale, ...project.targetLocales]) {
      try {
        new Intl.Locale(locale);
      } catch {
        throw new ContractError('locale', 'Invalid locale', 422);
      }
    }
    return this.transaction(() => {
      const previous = this.db
        .prepare('SELECT config,spent,reserved FROM projects WHERE id=?')
        .get(project.id) as { config: string; spent: number; reserved: number } | undefined;
      if (previous && JSON.parse(previous.config).sourceLocale !== project.sourceLocale)
        throw new ContractError(
          'source_locale',
          'Create a new project to change its source locale',
          422,
        );
      if (previous && project.budgetUsd + 1e-9 < previous.spent + previous.reserved)
        throw new ContractError(
          'budget',
          'Budget cannot be lower than spent plus reserved costs',
          422,
        );
      this.db
        .prepare(
          'INSERT INTO projects(id,config,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config',
        )
        .run(project.id, JSON.stringify(project), this.now());
      if (previous) {
        const jobs = this.db
          .prepare(
            "SELECT * FROM jobs WHERE project_id=? AND status IN ('pending','running','review','approved')",
          )
          .all(project.id) as JobRow[];
        for (const job of jobs)
          if (
            !project.targetLocales.includes(job.locale) ||
            contextHash(project, JSON.parse(job.source_data), job.locale) !== job.context_hash
          )
            this.stale(job);
      }
      this.audit(project.id, actor, 'project.save', project.id);
      return project;
    });
  }
  listProjects(): Array<Project & { spentUsd: number; reservedUsd: number }> {
    return (
      this.db.prepare('SELECT config,spent,reserved FROM projects ORDER BY id').all() as Array<{
        config: string;
        spent: number;
        reserved: number;
      }>
    ).map((x) => ({
      ...projectSchema.parse(JSON.parse(x.config)),
      spentUsd: x.spent,
      reservedUsd: x.reserved,
    }));
  }
  private source(projectId: string, unitId: string): SourceRow {
    const row = this.db
      .prepare('SELECT * FROM sources WHERE project_id=? AND unit_id=?')
      .get(projectId, unitId) as SourceRow | undefined;
    if (!row || !row.active)
      throw new ContractError('source_missing', 'Source is missing or withdrawn', 404);
    return row;
  }
  private release(job: JobRow, uncertain = false) {
    if (job.reserved <= 0) return;
    this.db
      .prepare('UPDATE projects SET reserved=MAX(0,reserved-?),spent=spent+? WHERE id=?')
      .run(job.reserved, uncertain ? job.reserved : 0, job.project_id);
    this.db
      .prepare('UPDATE jobs SET reserved=0,cost=cost+? WHERE id=?')
      .run(uncertain ? job.reserved : 0, job.id);
  }
  private stale(job: JobRow) {
    this.release(job, job.status === 'running');
    this.db
      .prepare("UPDATE jobs SET status='stale',lease_token=NULL,lease_until=NULL WHERE id=?")
      .run(job.id);
  }
  importSources(projectId: string, inputs: SourceUnit[]) {
    const project = this.getProject(projectId);
    const units = inputs.map((x) => unitSchema.parse(x));
    if (new Set(units.map((x) => x.id)).size !== units.length)
      throw new ContractError('duplicate_unit', 'Source IDs must be unique', 422);
    if (units.some((x) => x.sourceLocale !== project.sourceLocale))
      throw new ContractError('source_locale', 'Source unit locale differs from project', 422);
    return this.transaction(() => {
      const changed: string[] = [],
        unchanged: string[] = [];
      for (const unit of units) {
        const digest = sourceHash(unit);
        const previous = this.db
          .prepare('SELECT * FROM sources WHERE project_id=? AND unit_id=?')
          .get(projectId, unit.id) as SourceRow | undefined;
        if (previous?.source_hash === digest && previous.active) {
          unchanged.push(unit.id);
          continue;
        }
        const jobs = this.db
          .prepare(
            "SELECT * FROM jobs WHERE project_id=? AND unit_id=? AND status IN ('pending','running','review','approved')",
          )
          .all(projectId, unit.id) as JobRow[];
        for (const job of jobs) this.stale(job);
        this.db
          .prepare(
            'INSERT INTO sources(project_id,unit_id,data,source_hash) VALUES(?,?,?,?) ON CONFLICT(project_id,unit_id) DO UPDATE SET data=excluded.data,source_hash=excluded.source_hash,active=1',
          )
          .run(projectId, unit.id, JSON.stringify(unit), digest);
        changed.push(unit.id);
      }
      this.audit(projectId, 'connector', 'source.import', projectId, { changed, unchanged });
      return { changed, unchanged };
    });
  }
  importDocument(
    projectId: string,
    namespace: string,
    format: ExtractedDocument['format'],
    content: string,
  ) {
    const project = this.getProject(projectId);
    const document = extractDocument(content, format, namespace, { groupInline: true });
    const units = document.units.map((x) => ({ ...x, sourceLocale: project.sourceLocale }));
    return this.transaction(() => {
      const previous = this.db
        .prepare('SELECT unit_ids FROM documents WHERE project_id=? AND namespace=?')
        .get(projectId, namespace) as { unit_ids: string } | undefined;
      const ids = units.map((x) => x.id);
      if (previous)
        this.withdraw(
          projectId,
          (JSON.parse(previous.unit_ids) as string[]).filter((x) => !ids.includes(x)),
          'connector',
        );
      const result = this.importSources(projectId, units);
      const sourceRevision = hash({ format, content });
      this.db
        .prepare(
          'INSERT INTO documents(project_id,namespace,format,content,unit_ids,source_revision) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,namespace) DO UPDATE SET format=excluded.format,content=excluded.content,unit_ids=excluded.unit_ids,source_revision=excluded.source_revision',
        )
        .run(projectId, namespace, format, content, JSON.stringify(ids), sourceRevision);
      return { ...result, units: ids, sourceRevision };
    });
  }
  exportDocument(projectId: string, namespace: string, locale: string) {
    const project = this.getProject(projectId);
    const row = this.db
      .prepare('SELECT * FROM documents WHERE project_id=? AND namespace=?')
      .get(projectId, namespace) as
      | { format: ExtractedDocument['format']; content: string; source_revision: string }
      | undefined;
    if (!row) throw new ContractError('not_found', 'Document not found', 404);
    const document = extractDocument(row.content, row.format, namespace, { groupInline: true });
    const catalog = this.exportCatalog(projectId, locale);
    for (const unit of document.units) {
      if (catalog.sources[unit.id] !== sourceHash({ ...unit, sourceLocale: project.sourceLocale }))
        throw new ContractError(
          'incomplete_document',
          'All current document segments need approval before publication',
          422,
        );
    }
    const revision = hash({
      namespace,
      locale,
      sourceRevision: row.source_revision,
      messages: document.units.map((unit) => [unit.id, catalog.messages[unit.id]]),
    });
    return {
      namespace,
      locale,
      sourceRevision: row.source_revision,
      revision,
      content: document.render(catalog.messages, locale),
    };
  }
  /** A clearly marked private preview can mix reviewed candidates with untouched source text.
   * It never enters the approved-export path and always reports untranslated segments.
   */
  previewDocument(projectId: string, namespace: string, locale: string) {
    const project = this.getProject(projectId);
    if (!project.targetLocales.includes(locale))
      throw new ContractError('locale', 'Locale is not configured', 422);
    const row = this.db
      .prepare('SELECT * FROM documents WHERE project_id=? AND namespace=?')
      .get(projectId, namespace) as
      | { format: ExtractedDocument['format']; content: string; source_revision: string }
      | undefined;
    if (!row) throw new ContractError('not_found', 'Document not found', 404);
    const document = extractDocument(row.content, row.format, namespace, { groupInline: true });
    const translations: Record<string, string> = Object.create(null),
      pendingUnits: string[] = [];
    for (const rawUnit of document.units) {
      const unit = { ...rawUnit, sourceLocale: project.sourceLocale };
      const candidate = this.db
        .prepare(
          "SELECT translation FROM jobs WHERE project_id=? AND unit_id=? AND locale=? AND context_hash=? AND status IN ('review','approved')",
        )
        .get(projectId, unit.id, locale, contextHash(project, unit, locale)) as
        | { translation: string }
        | undefined;
      if (
        candidate?.translation &&
        !validateTranslation(unit, candidate.translation, locale, project.glossary).some(
          (finding) => finding.severity === 'critical',
        )
      )
        translations[unit.id] = candidate.translation;
      else {
        translations[unit.id] = unit.source;
        pendingUnits.push(unit.id);
      }
    }
    return {
      format: row.format,
      source: row.content,
      translation: document.render(translations, locale),
      sourceLocale: project.sourceLocale,
      pendingUnits,
      sourceRevision: row.source_revision,
    };
  }
  withdraw(projectId: string, unitIds: string[], actor: string) {
    this.getProject(projectId);
    this.transaction(() => {
      for (const unitId of unitIds) {
        this.db
          .prepare('UPDATE sources SET active=0 WHERE project_id=? AND unit_id=?')
          .run(projectId, unitId);
        this.db
          .prepare('DELETE FROM publications WHERE project_id=? AND unit_id=?')
          .run(projectId, unitId);
        for (const job of this.db
          .prepare(
            "SELECT * FROM jobs WHERE project_id=? AND unit_id=? AND status IN ('pending','running','review','approved')",
          )
          .all(projectId, unitId) as JobRow[])
          this.stale(job);
        this.audit(projectId, actor, 'source.withdraw', unitId);
      }
    });
  }
  enqueue(
    projectId: string,
    unitIds: string[],
    locales: string[],
    requestKey: string,
  ): TranslationRecord[] {
    const project = this.getProject(projectId);
    if (!requestKey || requestKey.length > 200)
      throw new ContractError(
        'idempotency_key',
        'An idempotency key of at most 200 characters is required',
        422,
      );
    if (!locales.length || locales.some((x) => !project.targetLocales.includes(x)))
      throw new ContractError('locale', 'Requested locale is not configured', 422);
    return this.transaction(() => {
      const units = [...new Set(unitIds)]
        .sort()
        .map((id) => ({ id, row: this.source(projectId, id) }));
      const targets = [...new Set(locales)].sort();
      const bodyHash = hash({
        units: units.map((x) => [x.id, x.row.source_hash]),
        targets,
        glossary: project.glossary,
        instructions: project.instructions,
        pipelineRevision: PIPELINE_REVISION,
        approvalMode: project.approvalMode,
      });
      const previous = this.db
        .prepare('SELECT body_hash,job_ids FROM requests WHERE project_id=? AND request_key=?')
        .get(projectId, requestKey) as { body_hash: string; job_ids: string } | undefined;
      if (previous) {
        if (previous.body_hash !== bodyHash)
          throw new ContractError(
            'idempotency_conflict',
            'This key was already used for a different revision',
          );
        return (JSON.parse(previous.job_ids) as string[]).map((id) => this.getJob(projectId, id));
      }
      const ids: string[] = [];
      for (const { id: unitId, row } of units)
        for (const locale of targets) {
          const source: SourceUnit = JSON.parse(row.data);
          const context = contextHash(project, source, locale);
          const cached = this.db
            .prepare(
              'SELECT id,status,translation FROM jobs WHERE project_id=? AND unit_id=? AND locale=? AND context_hash=?',
            )
            .get(projectId, unitId, locale, context) as
            | { id: string; status: string; translation: string | null }
            | undefined;
          const memory = this.db
            .prepare(
              'SELECT translation,findings,review_summary FROM translation_memory WHERE project_id=? AND cache_key=?',
            )
            .get(projectId, memoryHash(project, source, locale)) as
            | { translation: string; findings: string; review_summary: string }
            | undefined;
          if (cached) {
            // Returning to an earlier source reuses its correction with a fresh revision approval.
            if (cached.status === 'stale') {
              this.db
                .prepare(
                  'UPDATE jobs SET status=?,revision=revision+1,available_at=?,attempts=0,error=NULL WHERE id=?',
                )
                .run(
                  cached.translation && memory?.translation === cached.translation
                    ? 'review'
                    : 'pending',
                  this.now(),
                  cached.id,
                );
              this.approveAutomatically(project, cached.id);
            }
            ids.push(cached.id);
            continue;
          }
          const id = randomUUID();
          this.db
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
              this.now(),
              this.now(),
            );
          const correction = this.db
            .prepare(
              "SELECT translation FROM jobs WHERE project_id=? AND unit_id=? AND locale=? AND source_hash=? AND operation='review' AND translation IS NOT NULL ORDER BY seq DESC LIMIT 1",
            )
            .get(projectId, unitId, locale, row.source_hash) as { translation: string } | undefined;
          // New guidance rechecks a person's wording instead of silently replacing their correction.
          if (correction)
            this.db
              .prepare("UPDATE jobs SET operation='review',translation=?,revision=1 WHERE id=?")
              .run(correction.translation, id);
          else if (memory)
            this.db
              .prepare(
                "UPDATE jobs SET status='review',translation=?,findings=?,review_summary=?,revision=1 WHERE id=?",
              )
              .run(memory.translation, memory.findings, memory.review_summary, id);
          this.approveAutomatically(project, id);
          ids.push(id);
        }
      this.db
        .prepare('INSERT INTO requests(project_id,request_key,body_hash,job_ids) VALUES(?,?,?,?)')
        .run(projectId, requestKey, bodyHash, JSON.stringify(ids));
      return ids.map((id) => this.getJob(projectId, id));
    });
  }
  getJob(projectId: string, id: string): TranslationRecord {
    const row = this.db
      .prepare('SELECT * FROM jobs WHERE id=? AND project_id=?')
      .get(id, projectId) as JobRow | undefined;
    if (!row) throw new ContractError('not_found', 'Translation not found', 404);
    return record(row);
  }
  listJobs(
    projectId: string,
    locale?: string,
    cursor = 0,
    limit = 100,
    filters: JobFilters = {},
  ): { records: TranslationRecord[]; cursor: number | null } {
    const project = this.getProject(projectId);
    const rows = this.db
      .prepare(
        `SELECT jobs.* FROM jobs WHERE project_id=? AND seq>? ${locale ? 'AND locale=?' : ''} ${filters.status ? 'AND status=?' : ''} ORDER BY seq`,
      )
      .iterate(
        projectId,
        cursor,
        ...(locale ? [locale] : []),
        ...(filters.status ? [filters.status] : []),
      );
    const sources = filters.current ? this.currentSources(projectId) : null;
    const page: Array<JobRow & { seq: number }> = [];
    const search = filters.search?.toLocaleLowerCase();
    for (const raw of rows) {
      const row = raw as JobRow & { seq: number };
      const unit = JSON.parse(row.source_data) as SourceUnit;
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
      if (page.length === limit) return { records: page.map(record), cursor: page.at(-1)!.seq };
      page.push(row);
    }
    return { records: page.map(record), cursor: null };
  }
  private currentSources(projectId: string) {
    return new Map(
      (
        this.db
          .prepare(
            'SELECT unit_id,data,source_hash,active FROM sources WHERE project_id=? AND active=1',
          )
          .all(projectId) as Array<SourceRow & { unit_id: string }>
      ).map((row) => [row.unit_id, row]),
    );
  }
  /** Coverage counts the current source and guidance, while previous publications stay live. */
  summary(projectId: string): ProjectSummary {
    const project = this.getProject(projectId),
      sources = this.currentSources(projectId);
    const jobs = new Map(
      (
        this.db
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
          const unit = JSON.parse(source.data) as SourceUnit;
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
  private leased(id: string, token: string): JobRow {
    const row = this.db
      .prepare(
        "SELECT * FROM jobs WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
      )
      .get(id, token, this.now()) as JobRow | undefined;
    if (!row) throw new ContractError('lease_lost', 'Translation lease expired or source changed');
    return row;
  }
  claim(
    estimate: (
      project: Project,
      source: SourceUnit,
      locale: string,
      reviewOnly: boolean,
      translation: string | null,
    ) => number,
  ): ClaimedJob | null {
    return this.transaction(() => {
      for (const expired of this.db
        .prepare("SELECT * FROM jobs WHERE status='running' AND lease_until<=?")
        .all(this.now()) as JobRow[]) {
        this.release(expired, true);
        this.db
          .prepare('UPDATE jobs SET status=?,lease_token=NULL,lease_until=NULL,error=? WHERE id=?')
          .run(
            expired.attempts >= 3 ? 'failed' : 'pending',
            'Previous worker lease expired; reserved cost charged conservatively',
            expired.id,
          );
        if (expired.attempts >= 3)
          deliveryMethods.emit(
            this.db,
            this.now(),
            expired.project_id,
            'alert.translation_failed',
            expired.id,
            { locale: expired.locale, reason: 'worker_interrupted' },
          );
      }
      const pending = this.db
        .prepare(
          `WITH ranked AS (
            SELECT seq,ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY seq) AS position
            FROM jobs WHERE status='pending' AND available_at<=?
          ) SELECT jobs.* FROM ranked JOIN jobs USING(seq) ORDER BY ranked.position,jobs.seq LIMIT 100`,
        )
        .all(this.now()) as JobRow[];
      for (const job of pending) {
        const project = this.getProject(job.project_id);
        const unit: SourceUnit = JSON.parse(job.source_data);
        const source = this.source(job.project_id, job.unit_id);
        if (
          source.source_hash !== job.source_hash ||
          contextHash(project, unit, job.locale) !== job.context_hash
        ) {
          this.stale(job);
          continue;
        }
        const reviewOnly = (job as JobRow & { operation: string }).operation === 'review';
        let reserve: number;
        try {
          reserve = estimate(project, unit, job.locale, reviewOnly, job.translation);
          if (!Number.isFinite(reserve) || reserve < 0) throw new Error('Invalid reservation');
        } catch {
          this.db
            .prepare(
              "UPDATE jobs SET status='failed',error='Source structure or provider cost reservation is invalid' WHERE id=?",
            )
            .run(job.id);
          deliveryMethods.emit(
            this.db,
            this.now(),
            job.project_id,
            'alert.translation_failed',
            job.id,
            { locale: job.locale, reason: 'invalid_reservation' },
          );
          continue;
        }
        const claimed = this.db
          .prepare(
            "UPDATE projects SET reserved=reserved+? WHERE id=? AND spent+reserved+?<=json_extract(config,'$.budgetUsd')+0.000000001",
          )
          .run(reserve, job.project_id, reserve);
        if (!claimed.changes) {
          // Active jobs can release unused reservations; pending work must wait for that balance.
          if (
            this.db
              .prepare(
                "SELECT 1 FROM projects WHERE id=? AND spent+?<=json_extract(config,'$.budgetUsd')+0.000000001",
              )
              .get(job.project_id, reserve)
          )
            continue;
          this.db
            .prepare("UPDATE jobs SET status='failed',error='Project budget exhausted' WHERE id=?")
            .run(job.id);
          deliveryMethods.emit(
            this.db,
            this.now(),
            job.project_id,
            'alert.budget_exhausted',
            job.id,
            { locale: job.locale },
          );
          continue;
        }
        const leaseToken = randomUUID();
        this.db
          .prepare(
            "UPDATE jobs SET status='running',attempts=attempts+1,reserved=?,lease_token=?,lease_until=?,error=NULL WHERE id=?",
          )
          .run(reserve, leaseToken, this.now() + 150000, job.id);
        return { record: this.getJob(job.project_id, job.id), leaseToken, project, reviewOnly };
      }
      return null;
    });
  }
  heartbeat(id: string, token: string) {
    this.transaction(() => {
      this.leased(id, token);
      this.db.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run(this.now() + 150000, id);
    });
  }
  charge(id: string, token: string, cost: number) {
    if (!Number.isFinite(cost) || cost < 0) throw new Error('Invalid provider charge');
    const overrun = this.transaction(() => {
      const job = this.leased(id, token);
      const release = Math.min(job.reserved, cost);
      this.db
        .prepare('UPDATE projects SET spent=spent+?,reserved=MAX(0,reserved-?) WHERE id=?')
        .run(cost, release, job.project_id);
      this.db
        .prepare('UPDATE jobs SET cost=cost+?,reserved=MAX(0,reserved-?) WHERE id=?')
        .run(cost, release, id);
      return cost > job.reserved + 1e-9;
    });
    if (overrun) throw new ContractError('cost_overrun', 'Provider usage exceeded its reservation');
  }
  complete(id: string, token: string, translation: string, findings: Finding[], summary: string) {
    this.transaction(() => {
      const job = this.leased(id, token);
      const unit: SourceUnit = JSON.parse(job.source_data);
      const project = this.getProject(job.project_id);
      if (
        this.source(job.project_id, job.unit_id).source_hash !== job.source_hash ||
        contextHash(project, unit, job.locale) !== job.context_hash
      )
        throw new ContractError('stale_source', 'Source changed while translating');
      const structural = validateTranslation(unit, translation, job.locale, project.glossary);
      this.release(job);
      const unique = [
        ...new Map(
          [...structural, ...findings].map((finding) => [JSON.stringify(finding), finding]),
        ).values(),
      ];
      this.db
        .prepare(
          "UPDATE jobs SET translation=?,findings=?,review_summary=?,revision=revision+1,status='review',lease_token=NULL,lease_until=NULL WHERE id=?",
        )
        .run(translation, JSON.stringify(unique), summary, id);
      if (!unique.some((finding) => finding.severity === 'critical'))
        this.db
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
      this.approveAutomatically(project, id);
      if (
        project.approvalMode === 'automatic' &&
        unique.some((finding) => finding.severity !== 'minor')
      )
        deliveryMethods.emit(this.db, this.now(), job.project_id, 'alert.review_required', id, {
          locale: job.locale,
        });
    });
  }
  /** Automatic approval follows the same revision and publication transaction as owner approval.
   * Policy changes do not retroactively publish the review queue; only completed or reused work qualifies.
   */
  private approveAutomatically(project: Project, id: string) {
    if (project.approvalMode !== 'automatic') return;
    const job = this.getJob(project.id, id);
    if (job.status !== 'review' || job.findings.some((finding) => finding.severity !== 'minor'))
      return;
    this.approve(project.id, id, job.revision, 'automation');
  }
  fail(id: string, token: string, message: string, retryAfterMs?: number, uncertainCost = false) {
    this.transaction(() => {
      const job = this.leased(id, token);
      this.release(job, uncertainCost);
      const retry = retryAfterMs !== undefined && job.attempts < 3;
      this.db
        .prepare(
          'UPDATE jobs SET status=?,error=?,lease_token=NULL,lease_until=NULL,available_at=? WHERE id=?',
        )
        .run(
          retry ? 'pending' : 'failed',
          message.slice(0, 500),
          this.now() + (retryAfterMs ?? 0),
          id,
        );
      if (!retry)
        deliveryMethods.emit(this.db, this.now(), job.project_id, 'alert.translation_failed', id, {
          locale: job.locale,
        });
    });
  }
  edit(projectId: string, id: string, revision: number, translation: string, actor: string) {
    this.transaction(() => {
      const job = this.getJob(projectId, id);
      if (!['review', 'approved'].includes(job.status) || job.revision !== revision)
        throw new ContractError('revision_conflict', 'Translation changed; reload before editing');
      if (this.source(projectId, job.unitId).source_hash !== job.sourceHash)
        throw new ContractError('stale_source', 'Source changed');
      const structural = validateTranslation(
        job.source,
        translation,
        job.locale,
        this.getProject(projectId).glossary,
      );
      if (structural.some((x) => x.severity === 'critical'))
        throw new ContractError(
          'structural_failure',
          'Correct protected structure before saving',
          422,
        );
      this.db
        .prepare(
          "UPDATE jobs SET translation=?,revision=revision+1,status='pending',operation='review',attempts=0,available_at=?,findings=?,review_summary=?,approval_revision=NULL WHERE id=?",
        )
        .run(
          translation,
          this.now(),
          JSON.stringify(structural),
          'Owner corrections are queued for independent review.',
          id,
        );
      this.audit(projectId, actor, 'translation.edit', id, { previousRevision: revision });
    });
  }
  approve(projectId: string, id: string, revision: number, actor: string, overrideReason?: string) {
    this.transaction(() => {
      const job = this.getJob(projectId, id);
      if (job.status !== 'review' || job.revision !== revision || !job.translation)
        throw new ContractError(
          'revision_conflict',
          'Only the exact reviewed revision can be approved',
        );
      const project = this.getProject(projectId);
      if (
        this.source(projectId, job.unitId).source_hash !== job.sourceHash ||
        contextHash(project, job.source, job.locale) !== job.contextHash
      )
        throw new ContractError('stale_source', 'Source or translation context changed');
      const structural = validateTranslation(
        job.source,
        job.translation,
        job.locale,
        project.glossary,
      );
      if (structural.some((x) => x.severity === 'critical'))
        throw new ContractError(
          'structural_failure',
          'Protected structure must be corrected before approval',
          422,
        );
      if (job.findings.some((x) => x.severity !== 'minor') && !overrideReason?.trim())
        throw new ContractError(
          'review_findings',
          'Correct material review findings or record an explicit owner override',
          422,
        );
      this.db
        .prepare("UPDATE jobs SET status='approved',approval_revision=? WHERE id=?")
        .run(revision, id);
      this.db
        .prepare(
          'INSERT INTO publications(project_id,unit_id,locale,translation,source_hash,job_id,revision,published_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id,unit_id,locale) DO UPDATE SET translation=excluded.translation,source_hash=excluded.source_hash,job_id=excluded.job_id,revision=excluded.revision,published_at=excluded.published_at',
        )
        .run(
          projectId,
          job.unitId,
          job.locale,
          job.translation,
          job.sourceHash,
          id,
          revision,
          this.now(),
        );
      this.audit(projectId, actor, 'translation.approve', id, {
        locale: job.locale,
        revision,
        sourceHash: job.sourceHash,
        overrideReason: overrideReason?.trim() ?? null,
        mode: actor === 'automation' ? 'automatic' : 'human',
      });
    });
  }
  approveBatch(projectId: string, entries: Array<{ id: string; revision: number }>, actor: string) {
    this.transaction(() => {
      for (const entry of entries) this.approve(projectId, entry.id, entry.revision, actor);
    });
  }
  retry(projectId: string, id: string, actor: string) {
    this.transaction(() => {
      const job = this.getJob(projectId, id);
      if (job.status !== 'failed')
        throw new ContractError('status', 'Only failed jobs can be retried');
      if (this.source(projectId, job.unitId).source_hash !== job.sourceHash)
        throw new ContractError('stale_source', 'Import a new job for the current source');
      this.db
        .prepare("UPDATE jobs SET status='pending',attempts=0,error=NULL,available_at=? WHERE id=?")
        .run(this.now(), id);
      this.audit(projectId, actor, 'translation.retry', id);
    });
  }
  exportCatalog(projectId: string, locale: string, requireCurrent = false): ApprovedCatalog {
    const project = this.getProject(projectId);
    if (locale !== project.sourceLocale && !project.targetLocales.includes(locale))
      throw new ContractError('locale', 'Locale is not configured', 422);
    const messages: Record<string, string> = Object.create(null);
    const sources: Record<string, string> = Object.create(null);
    const active = this.db
      .prepare(
        'SELECT unit_id,data,source_hash FROM sources WHERE project_id=? AND active=1 ORDER BY unit_id',
      )
      .all(projectId) as Array<{ unit_id: string; data: string; source_hash: string }>;
    const published = this.db
      .prepare(
        'SELECT p.unit_id,p.translation,p.source_hash FROM publications p JOIN sources s ON s.project_id=p.project_id AND s.unit_id=p.unit_id WHERE p.project_id=? AND p.locale=? AND s.active=1 ORDER BY p.unit_id',
      )
      .all(projectId, locale) as PublicationRow[];
    if (locale === project.sourceLocale) {
      for (const row of active) {
        messages[row.unit_id] = JSON.parse(row.data).source;
        sources[row.unit_id] = row.source_hash;
      }
    } else {
      for (const row of published) {
        messages[row.unit_id] = row.translation;
        sources[row.unit_id] = row.source_hash;
      }
      if (requireCurrent && active.some((x) => sources[x.unit_id] !== x.source_hash))
        throw new ContractError(
          'incomplete_catalog',
          'Current sources are not fully approved',
          422,
        );
    }
    return {
      schemaVersion: 1,
      projectId,
      locale,
      sourceLocale: project.sourceLocale,
      revision: hash({ projectId, locale, messages, sources }),
      messages: Object.fromEntries(Object.entries(messages)),
      sources: Object.fromEntries(Object.entries(sources)),
    };
  }
  exportBundle(
    projectId: string,
    requireCurrent = true,
  ): import('@everylocale/core').CatalogBundle {
    // One read transaction prevents publications from changing between locale exports.
    return this.db.transaction(() => {
      const project = this.getProject(projectId);
      const catalogs = [project.sourceLocale, ...project.targetLocales].map((locale) => ({
        ...this.exportCatalog(projectId, locale, requireCurrent),
        sourceLocale: project.sourceLocale,
      }));
      return {
        schemaVersion: 1 as const,
        projectId,
        catalogs,
        revision: hash({ projectId, catalogs }),
      };
    })();
  }
  snapshot(projectId: string, locale: string): ApprovedCatalog {
    const catalog = this.exportCatalog(projectId, locale);
    this.db
      .prepare(
        'INSERT OR IGNORE INTO artifacts(id,project_id,locale,data,created_at) VALUES(?,?,?,?,?)',
      )
      .run(catalog.revision, projectId, locale, JSON.stringify(catalog), this.now());
    return catalog;
  }
  rollback(projectId: string, locale: string, artifactId: string, actor: string) {
    this.transaction(() => {
      const row = this.db
        .prepare('SELECT data FROM artifacts WHERE id=? AND project_id=? AND locale=?')
        .get(artifactId, projectId, locale) as { data: string } | undefined;
      if (!row) throw new ContractError('not_found', 'Approved artifact not found', 404);
      const catalog: ApprovedCatalog = JSON.parse(row.data);
      this.db
        .prepare('DELETE FROM publications WHERE project_id=? AND locale=?')
        .run(projectId, locale);
      for (const [unitId, translation] of Object.entries(catalog.messages)) {
        const source = this.db
          .prepare('SELECT active FROM sources WHERE project_id=? AND unit_id=?')
          .get(projectId, unitId) as { active: number } | undefined;
        if (!source?.active) continue;
        this.db
          .prepare(
            'INSERT INTO publications(project_id,unit_id,locale,translation,source_hash,job_id,revision,published_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            projectId,
            unitId,
            locale,
            translation,
            catalog.sources[unitId]!,
            `artifact:${artifactId}`,
            0,
            this.now(),
          );
      }
      this.audit(projectId, actor, 'publication.rollback', artifactId, { locale });
    });
  }
  mintToken(projectId: string, scopes: Scope[], expiresAt: number) {
    this.getProject(projectId);
    if (
      !scopes.length ||
      scopes.some(
        (x) => !['read', 'import', 'translate', 'review', 'approve', 'export'].includes(x),
      ) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.now()
    )
      throw new ContractError('token', 'Valid scopes and future expiry are required', 422);
    const token = randomBytes(32).toString('base64url'),
      id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO access_tokens(id,project_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?)',
      )
      .run(id, projectId, hash(token), JSON.stringify(scopes), this.now(), expiresAt);
    return { id, token, expiresAt };
  }
  authenticate(token: string): { projectId: string; scopes: Scope[]; actor: string } | null {
    const row = this.db
      .prepare(
        'SELECT id,project_id,scopes FROM access_tokens WHERE token_hash=? AND revoked=0 AND expires_at>?',
      )
      .get(hash(token), this.now()) as
      | { id: string; project_id: string; scopes: string }
      | undefined;
    return row
      ? { projectId: row.project_id, scopes: JSON.parse(row.scopes), actor: `token:${row.id}` }
      : null;
  }
  authenticateId(id: string): { projectId: string; scopes: Scope[]; actor: string } | null {
    const row = this.db
      .prepare(
        'SELECT id,project_id,scopes FROM access_tokens WHERE id=? AND revoked=0 AND expires_at>?',
      )
      .get(id, this.now()) as { id: string; project_id: string; scopes: string } | undefined;
    return row
      ? { projectId: row.project_id, scopes: JSON.parse(row.scopes), actor: `token:${row.id}` }
      : null;
  }
  documents(projectId: string) {
    this.getProject(projectId);
    return this.db
      .prepare(
        'SELECT namespace,format,unit_ids,source_revision FROM documents WHERE project_id=? ORDER BY namespace',
      )
      .all(projectId)
      .map((row: any) => ({
        namespace: row.namespace,
        format: row.format,
        units: JSON.parse(row.unit_ids),
        sourceRevision: row.source_revision,
      }));
  }
  tokens(projectId: string) {
    this.getProject(projectId);
    return this.db
      .prepare(
        'SELECT id,scopes,created_at,expires_at,revoked FROM access_tokens WHERE project_id=? ORDER BY created_at DESC',
      )
      .all(projectId)
      .map((row: any) => ({ ...row, scopes: JSON.parse(row.scopes) }));
  }
  artifacts(projectId: string, locale?: string) {
    return this.db
      .prepare(
        `SELECT id,locale,created_at FROM artifacts WHERE project_id=? ${locale ? 'AND locale=?' : ''} ORDER BY created_at DESC LIMIT 100`,
      )
      .all(...(locale ? [projectId, locale] : [projectId])) as Array<{
      id: string;
      locale: string;
      created_at: number;
    }>;
  }
  revokeToken(projectId: string, id: string, actor: string) {
    this.db
      .prepare('UPDATE access_tokens SET revoked=1 WHERE project_id=? AND id=?')
      .run(projectId, id);
    this.audit(projectId, actor, 'token.revoke', id);
  }
  auditLog(projectId: string) {
    return this.db
      .prepare(
        'SELECT actor,action,entity_id,detail,created_at FROM audit WHERE project_id=? ORDER BY seq DESC LIMIT 200',
      )
      .all(projectId) as Array<{
      actor: string;
      action: string;
      entity_id: string;
      detail: string;
      created_at: number;
    }>;
  }
}
