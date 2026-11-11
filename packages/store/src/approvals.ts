import type { SqliteStore } from './index.js';
import {
  ContractError,
  contextHash,
  policyFor,
  validateTranslation,
  type Project,
  type TranslationRecord,
} from '@everylocale/core';

export const HUMAN_SUMMARY = 'Written by a person. This policy sends no text to a model.';
export const AI_REVIEW_SUMMARY = 'Queued for independent AI review.';

/**
 * Automatic approval follows the same revision and publication transaction as owner approval.
 * Policy changes do not retroactively publish the review queue; only completed or reused work
 * qualifies.
 */
export function approveAutomatically(store: SqliteStore, project: Project, id: string) {
  const job = store.getJob(project.id, id);
  if (policyFor(project, job.source).approve !== 'automatic') return;
  if (job.status !== 'review' || job.findings.some((finding) => finding.severity !== 'minor'))
    return;
  store.approve(project.id, id, job.revision, 'automation');
}

/**
 * A person's wording, from the editor or an import, follows the message's policy: AI policies
 * queue an independent AI review, human policies go straight to the review state with only the
 * structural checks. Critical structural problems are rejected before anything is stored.
 */
function assignTranslation(
  store: SqliteStore,
  project: Project,
  job: TranslationRecord,
  translation: string,
) {
  const structural = validateTranslation(job.source, translation, job.locale, project.glossary);
  if (structural.some((finding) => finding.severity === 'critical'))
    throw new ContractError(
      'structural_failure',
      `Correct protected structure before saving: ${structural.map((finding) => finding.message).join(' ')}`,
      422,
    );
  const human = policyFor(project, job.source).translate === 'human';
  store.db
    .prepare(
      'UPDATE jobs SET translation=?,revision=revision+1,status=?,operation=?,attempts=0,available_at=?,findings=?,review_summary=?,approval_revision=NULL,error=NULL WHERE id=?',
    )
    .run(
      translation,
      human ? 'review' : 'pending',
      human ? 'human' : 'review',
      store.now(),
      JSON.stringify(structural),
      human ? HUMAN_SUMMARY : AI_REVIEW_SUMMARY,
      job.id,
    );
  if (human) store.approveAutomatically(project, job.id);
}

export function edit(
  store: SqliteStore,
  projectId: string,
  id: string,
  revision: number,
  translation: string,
  actor: string,
) {
  store.transaction(() => {
    const job = store.getJob(projectId, id);
    if (!['awaiting', 'review', 'approved'].includes(job.status) || job.revision !== revision)
      throw new ContractError('revision_conflict', 'Translation changed; reload before editing');
    if (store.source(projectId, job.unitId).source_hash !== job.sourceHash)
      throw new ContractError('stale_source', 'Source changed');
    assignTranslation(store, store.getProject(projectId), job, translation);
    store.audit(projectId, actor, 'translation.edit', id, { previousRevision: revision });
  });
}

export function approve(
  store: SqliteStore,
  projectId: string,
  id: string,
  revision: number,
  actor: string,
  overrideReason?: string,
) {
  store.transaction(() => {
    const job = store.getJob(projectId, id);
    if (job.status !== 'review' || job.revision !== revision || !job.translation)
      throw new ContractError(
        'revision_conflict',
        'Only the exact reviewed revision can be approved',
      );
    const project = store.getProject(projectId);
    if (
      store.source(projectId, job.unitId).source_hash !== job.sourceHash ||
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
    store.db
      .prepare("UPDATE jobs SET status='approved',approval_revision=? WHERE id=?")
      .run(revision, id);
    store.db
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
        store.now(),
      );
    store.audit(projectId, actor, 'translation.approve', id, {
      locale: job.locale,
      revision,
      sourceHash: job.sourceHash,
      overrideReason: overrideReason?.trim() ?? null,
      mode: AUTOMATIC_ACTORS.has(actor) ? 'automatic' : 'human',
    });
  });
}
/** Actors that approve without a person: policy automation and locked keys. */
const AUTOMATIC_ACTORS: ReadonlySet<string> = new Set(['automation', 'locked-key']);

export function approveBatch(
  store: SqliteStore,
  projectId: string,
  entries: Array<{ id: string; revision: number }>,
  actor: string,
) {
  store.transaction(() => {
    for (const entry of entries) store.approve(projectId, entry.id, entry.revision, actor);
  });
}

export type ImportResult = {
  imported: string[];
  unchanged: string[];
  rejected: Array<{ unitId: string; reason: string }>;
};

/**
 * Brings existing translations in as candidates for the current source text. Each follows its
 * message's policy exactly as an edit would, so nothing is approved that the policy would not
 * approve. Problems are reported per message; valid entries are kept.
 */
export function importTranslations(
  store: SqliteStore,
  projectId: string,
  locale: string,
  entries: ReadonlyArray<{ unitId: string; translation: string }>,
  actor: string,
): ImportResult {
  const project = store.getProject(projectId);
  if (!project.targetLocales.includes(locale))
    throw new ContractError('locale', 'Locale is not configured', 422);
  return store.transaction(() => {
    const result: ImportResult = { imported: [], unchanged: [], rejected: [] };
    for (const { unitId, translation } of entries) {
      let job: TranslationRecord;
      try {
        job = store.jobFor(project, unitId, locale);
      } catch (error) {
        result.rejected.push({ unitId, reason: (error as Error).message });
        continue;
      }
      if (job.translation === translation && ['review', 'approved'].includes(job.status)) {
        result.unchanged.push(unitId);
        continue;
      }
      try {
        assignTranslation(store, project, job, translation);
        result.imported.push(unitId);
      } catch (error) {
        result.rejected.push({ unitId, reason: (error as Error).message });
      }
    }
    store.audit(projectId, actor, 'translation.import', projectId, {
      locale,
      imported: result.imported.length,
      unchanged: result.unchanged.length,
      rejected: result.rejected.length,
    });
    return result;
  });
}
