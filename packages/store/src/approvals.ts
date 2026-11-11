import type { SqliteStore } from './index.js';
import { ContractError, contextHash, validateTranslation } from '@everylocale/core';
import type { Project } from '@everylocale/core';

/** Automatic approval follows the same revision and publication transaction as owner approval.
 * Policy changes do not retroactively publish the review queue; only completed or reused work qualifies.
 */
export function approveAutomatically(store: SqliteStore, project: Project, id: string) {
  if (project.approvalMode !== 'automatic') return;
  const job = store.getJob(project.id, id);
  if (job.status !== 'review' || job.findings.some((finding) => finding.severity !== 'minor'))
    return;
  store.approve(project.id, id, job.revision, 'automation');
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
    if (!['review', 'approved'].includes(job.status) || job.revision !== revision)
      throw new ContractError('revision_conflict', 'Translation changed; reload before editing');
    if (store.source(projectId, job.unitId).source_hash !== job.sourceHash)
      throw new ContractError('stale_source', 'Source changed');
    const structural = validateTranslation(
      job.source,
      translation,
      job.locale,
      store.getProject(projectId).glossary,
    );
    if (structural.some((x) => x.severity === 'critical'))
      throw new ContractError(
        'structural_failure',
        'Correct protected structure before saving',
        422,
      );
    store.db
      .prepare(
        "UPDATE jobs SET translation=?,revision=revision+1,status='pending',operation='review',attempts=0,available_at=?,findings=?,review_summary=?,approval_revision=NULL WHERE id=?",
      )
      .run(
        translation,
        store.now(),
        JSON.stringify(structural),
        'Owner corrections are queued for independent review.',
        id,
      );
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
      mode: actor === 'automation' ? 'automatic' : 'human',
    });
  });
}

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
