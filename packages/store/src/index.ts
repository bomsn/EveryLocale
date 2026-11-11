import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ApprovedCatalog,
  Finding,
  Project,
  SourceUnit,
  TranslationRecord,
} from '@everylocale/core';
import { SCHEMA } from './schema.js';
import type { JobRow, SourceRow } from './rows.js';
import * as projects from './projects.js';
import * as sources from './sources.js';
import * as jobs from './jobs.js';
import * as approvals from './approvals.js';
import * as releases from './releases.js';
import * as access from './access.js';
import type { Scope } from './decode.js';
import { deliveryMethods, type DeliveryStore } from './operations.js';
export type { DeliveryStore, DeliveryEvent, Operations } from './operations.js';

export type { Scope } from './decode.js';
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
    format: string,
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
    format: string;
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
    /** @internal */
    readonly now: () => number = Date.now,
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
  importDocument(projectId: string, namespace: string, format: string, content: string) {
    return sources.importDocument(this, projectId, namespace, format, content);
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
  fail(id: string, token: string, message: string, retryAfterMs?: number, uncertainCost = false) {
    jobs.fail(this, id, token, message, retryAfterMs, uncertainCost);
  }
  edit(projectId: string, id: string, revision: number, translation: string, actor: string) {
    approvals.edit(this, projectId, id, revision, translation, actor);
  }
  approve(projectId: string, id: string, revision: number, actor: string, overrideReason?: string) {
    approvals.approve(this, projectId, id, revision, actor, overrideReason);
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
    requireCurrent = true,
  ): import('@everylocale/core').CatalogBundle {
    return releases.exportBundle(this, projectId, requireCurrent);
  }
  snapshot(projectId: string, locale: string): ApprovedCatalog {
    return releases.snapshot(this, projectId, locale);
  }
  rollback(projectId: string, locale: string, artifactId: string, actor: string) {
    releases.rollback(this, projectId, locale, artifactId, actor);
  }
  mintToken(projectId: string, scopes: Scope[], expiresAt: number) {
    return access.mintToken(this, projectId, scopes, expiresAt);
  }
  authenticate(token: string): { projectId: string; scopes: Scope[]; actor: string } | null {
    return access.authenticate(this, token);
  }
  authenticateId(id: string): { projectId: string; scopes: Scope[]; actor: string } | null {
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
}
