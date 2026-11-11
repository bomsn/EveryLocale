import {
  contextHash,
  type FailureCode,
  type Project,
  type SourceUnit,
  type TranslationRecord,
} from '@everylocale/core';
import { decodeFindings, decodeUnit } from './decode.js';

export type JobRow = {
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
  failure: FailureCode | null;
};
export type SourceRow = { data: string; source_hash: string; active: number };
export type PublicationRow = { unit_id: string; translation: string; source_hash: string };

export function record(row: JobRow): TranslationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    unitId: row.unit_id,
    locale: row.locale,
    sourceHash: row.source_hash,
    contextHash: row.context_hash,
    source: decodeUnit(row.source_data),
    translation: row.translation,
    revision: row.revision,
    status: row.status,
    findings: decodeFindings(row.findings),
    reviewSummary: row.review_summary,
    attempts: row.attempts,
    error: row.error,
    costUsd: row.cost,
    approvalRevision: row.approval_revision,
    failure: row.failure,
  };
}

/** Translation memory ignores the unit id, so moved or duplicated text reuses its translation. */
export const memoryHash = (project: Project, source: SourceUnit, locale: string) =>
  contextHash(project, { ...source, id: 'translation-memory' }, locale);
