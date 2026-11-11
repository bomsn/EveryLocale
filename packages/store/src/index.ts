import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  FailureCode,
  ApprovedCatalog,
  Finding,
  Project,
  SourceUnit,
  TranslationRecord,
} from '@everylocale/core';
import { migrate, schemaVersion, type MigrationResult } from './migrations.js';
export { SCHEMA_VERSION, type MigrationResult } from './migrations.js';
export { verifyDatabase, type DatabaseCheck } from './verify.js';
import type { JobRow, SourceRow } from './rows.js';
import * as projects from './projects.js';
import * as sources from './sources.js';
import * as jobs from './jobs.js';
import * as approvals from './approvals.js';
import * as releases from './releases.js';
import * as access from './access.js';
import * as sessions from './sessions.js';
export type { Session } from './sessions.js';
import type { DocumentOptions, Scope } from './decode.js';
export { documentOptionsSchema, type DocumentOptions } from './decode.js';
import type { ImportResult } from './approvals.js';
import type { RequestStatus } from './jobs.js';
export type { RequestStatus } from './jobs.js';
import type { TokenIdentity, TokenLimits } from './access.js';
export { withinLimits, type TokenIdentity, type TokenLimits } from './access.js';
export type { ImportResult } from './approvals.js';
import { deliveryMethods, type DeliveryStore } from './operations.js';
export type { DeliveryStore, DeliveryEvent, Operations } from './operations.js';

export type { Scope } from './decode.js';
export type JobFilters = {
  status?: TranslationRecord['status'];
  search?: string;
  current?: boolean;
  /** Only jobs a limited token may see. */
  within?: TokenLimits;
};
export type ProjectSummary = {
  sourceUnits: number;
  languages: Array<{
    locale: string;
    total: number;
    approved: number;
    review: number;
    working: number;
    /** Waiting for a person because the policy keeps the text away from models. */
    awaiting: number;
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
    failure: FailureCode,
    message: string,
    options?: { retryAfterMs?: number; uncertainCost?: boolean; requeue?: boolean },
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
    complete?: readonly string[] | 'all',
  ): import('@everylocale/core').CatalogBundle;
}
export interface LocalizationStore extends TranslationStore, DeliveryStore {
  close(): void;
  saveProject(project: Project, actor?: string): Project;
  listProjects(): Array<Project & { spentUsd: number; reservedUsd: number }>;
  importDocument(
    project: string,
    namespace: string,
    format: string,
    content: string,
    options?: DocumentOptions,
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
    format: string;
    source: string;
    translation: string;
    sourceLocale: string;
    pendingUnits: string[];
    sourceRevision: string;
  };
  documents(project: string): Array<{
    namespace: string;
    format: string;
    units: string[];
    sourceRevision: string;
    options: DocumentOptions;
  }>;
  withdraw(project: string, unitIds: string[], actor: string): void;
  removeDocument(project: string, namespace: string, actor: string): void;
  getJob(project: string, id: string): TranslationRecord;
  listJobs(
    project: string,
    locale?: string,
    cursor?: number,
    limit?: number,
    filters?: JobFilters,
  ): { records: TranslationRecord[]; cursor: number | null };
  summary(project: string): ProjectSummary;
  requestStatus(project: string, key: string): RequestStatus;
  edit(project: string, id: string, revision: number, translation: string, actor: string): void;
  importTranslations(
    project: string,
    locale: string,
    entries: ReadonlyArray<{ unitId: string; translation: string }>,
    actor: string,
  ): ImportResult;
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
    limits?: Partial<TokenLimits>,
    actor?: string,
  ): { id: string; token: string; expiresAt: number };
  authenticate(token: string): TokenIdentity | null;
  authenticateId(id: string): TokenIdentity | null;
  tokens(project: string): Array<
    TokenLimits & {
      id: string;
      scopes: Scope[];
      created_at: number;
      expires_at: number;
      revoked: number;
    }
  >;
  revokeToken(project: string, id: string, actor: string): void;
  createSession(
    tokenId: string | null,
    ttlMs: number,
  ): { secret: string; csrf: string; expiresAt: number };
  session(secret: string): import('./sessions.js').Session | 'expired' | null;
  revokeSession(secret: string): void;
  revokeSessions(actor: string): number;
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
  /** A service-level alert, such as a failed backup, delivered like any other event. */
  readonly recordAlert = (type: string, detail: Record<string, unknown>) => {
    deliveryMethods.emit(this.db, this.now(), '*', type, '*', detail);
  };
  readonly db: Database.Database;
  /** The schema upgrade this process applied on open, including the pre-upgrade backup path. */
  readonly migration: MigrationResult;
  constructor(
    path: string,
    /** @internal */
    readonly now: () => number = Date.now,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { timeout: 5000 });
    try {
      schemaVersion(this.db);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.migration = migrate(this.db, path, now());
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  /** @internal */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  /** @internal */
  audit(projectId: string, actor: string, action: string, entityId: string, detail: unknown = {}) {
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
    return projects.getProject(this, id);
  }
  saveProject(input: Project, actor = 'owner'): Project {
    return projects.saveProject(this, input, actor);
  }
  listProjects(): Array<Project & { spentUsd: number; reservedUsd: number }> {
    return projects.listProjects(this);
  }
  /** @internal */
  source(projectId: string, unitId: string): SourceRow {
    return sources.source(this, projectId, unitId);
  }
  /** @internal */
  release(job: JobRow, uncertain = false) {
    jobs.release(this, job, uncertain);
  }
  /** @internal */
  stale(job: JobRow) {
    jobs.stale(this, job);
  }
  importSources(projectId: string, inputs: SourceUnit[]) {
    return sources.importSources(this, projectId, inputs);
  }
  importDocument(
    projectId: string,
    namespace: string,
    format: string,
    content: string,
    options?: DocumentOptions,
  ) {
    return sources.importDocument(this, projectId, namespace, format, content, options);
  }
  exportDocument(projectId: string, namespace: string, locale: string) {
    return sources.exportDocument(this, projectId, namespace, locale);
  }
  /** A clearly marked private preview can mix reviewed candidates with untouched source text.
   * It never enters the approved-export path and always reports untranslated segments.
   */
  previewDocument(projectId: string, namespace: string, locale: string) {
    return sources.previewDocument(this, projectId, namespace, locale);
  }
  removeDocument(projectId: string, namespace: string, actor: string) {
    sources.removeDocument(this, projectId, namespace, actor);
  }
  withdraw(projectId: string, unitIds: string[], actor: string) {
    sources.withdraw(this, projectId, unitIds, actor);
  }
  enqueue(
    projectId: string,
    unitIds: string[],
    locales: string[],
    requestKey: string,
  ): TranslationRecord[] {
    return jobs.enqueue(this, projectId, unitIds, locales, requestKey);
  }
  getJob(projectId: string, id: string): TranslationRecord {
    return jobs.getJob(this, projectId, id);
  }
  listJobs(
    projectId: string,
    locale?: string,
    cursor = 0,
    limit = 100,
    filters: JobFilters = {},
  ): { records: TranslationRecord[]; cursor: number | null } {
    return jobs.listJobs(this, projectId, locale, cursor, limit, filters);
  }
  /** @internal */
  currentSources(projectId: string) {
    return sources.currentSources(this, projectId);
  }
  /** Coverage counts the current source and guidance, while previous publications stay live. */
  requestStatus(projectId: string, key: string): RequestStatus {
    return jobs.requestStatus(this, projectId, key);
  }
  summary(projectId: string): ProjectSummary {
    return jobs.summary(this, projectId);
  }
  /** @internal */
  leased(id: string, token: string): JobRow {
    return jobs.leased(this, id, token);
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
    return jobs.claim(this, estimate);
  }
  heartbeat(id: string, token: string) {
    jobs.heartbeat(this, id, token);
  }
  charge(id: string, token: string, cost: number) {
    jobs.charge(this, id, token, cost);
  }
  complete(id: string, token: string, translation: string, findings: Finding[], summary: string) {
    jobs.complete(this, id, token, translation, findings, summary);
  }
  /** Automatic approval follows the same revision and publication transaction as owner approval.
   * Policy changes do not retroactively publish the review queue; only completed or reused work qualifies.
   */
  /** @internal */
  approveAutomatically(project: Project, id: string) {
    approvals.approveAutomatically(this, project, id);
  }
  fail(
    id: string,
    token: string,
    failure: FailureCode,
    message: string,
    options?: { retryAfterMs?: number; uncertainCost?: boolean; requeue?: boolean },
  ) {
    jobs.fail(this, id, token, failure, message, options);
  }
  edit(projectId: string, id: string, revision: number, translation: string, actor: string) {
    approvals.edit(this, projectId, id, revision, translation, actor);
  }
  approve(projectId: string, id: string, revision: number, actor: string, overrideReason?: string) {
    approvals.approve(this, projectId, id, revision, actor, overrideReason);
  }
  importTranslations(
    projectId: string,
    locale: string,
    entries: ReadonlyArray<{ unitId: string; translation: string }>,
    actor: string,
  ): ImportResult {
    return approvals.importTranslations(this, projectId, locale, entries, actor);
  }
  /** @internal */
  jobFor(project: Project, unitId: string, locale: string): TranslationRecord {
    return jobs.jobFor(this, project, unitId, locale);
  }
  approveBatch(projectId: string, entries: Array<{ id: string; revision: number }>, actor: string) {
    approvals.approveBatch(this, projectId, entries, actor);
  }
  retry(projectId: string, id: string, actor: string) {
    jobs.retry(this, projectId, id, actor);
  }
  exportCatalog(projectId: string, locale: string, requireCurrent = false): ApprovedCatalog {
    return releases.exportCatalog(this, projectId, locale, requireCurrent);
  }
  exportBundle(
    projectId: string,
    complete: readonly string[] | 'all' = 'all',
  ): import('@everylocale/core').CatalogBundle {
    return releases.exportBundle(this, projectId, complete);
  }
  snapshot(projectId: string, locale: string): ApprovedCatalog {
    return releases.snapshot(this, projectId, locale);
  }
  rollback(projectId: string, locale: string, artifactId: string, actor: string) {
    releases.rollback(this, projectId, locale, artifactId, actor);
  }
  mintToken(
    projectId: string,
    scopes: Scope[],
    expiresAt: number,
    limits?: Partial<TokenLimits>,
    actor?: string,
  ) {
    return access.mintToken(this, projectId, scopes, expiresAt, limits, actor);
  }
  authenticate(token: string): TokenIdentity | null {
    return access.authenticate(this, token);
  }
  authenticateId(id: string): TokenIdentity | null {
    return access.authenticateId(this, id);
  }
  documents(projectId: string) {
    return sources.documents(this, projectId);
  }
  tokens(projectId: string) {
    return access.tokens(this, projectId);
  }
  artifacts(projectId: string, locale?: string) {
    return releases.artifacts(this, projectId, locale);
  }
  revokeToken(projectId: string, id: string, actor: string) {
    access.revokeToken(this, projectId, id, actor);
  }
  auditLog(projectId: string) {
    return access.auditLog(this, projectId);
  }
  createSession(tokenId: string | null, ttlMs: number) {
    return sessions.createSession(this, tokenId, ttlMs);
  }
  session(secret: string) {
    return sessions.session(this, secret);
  }
  revokeSession(secret: string) {
    sessions.revokeSession(this, secret);
  }
  revokeSessions(actor: string) {
    return sessions.revokeSessions(this, actor);
  }
}
