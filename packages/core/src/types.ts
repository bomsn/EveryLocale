import { z } from 'zod';

export const unitSchema = z.object({
  id: z.string().min(1).max(240),
  source: z.string().min(1).max(20000),
  sourceLocale: z.string().min(2).max(40).default('en'),
  kind: z.enum(['text', 'icu', 'html', 'markdown']).default('text'),
  context: z.string().max(4000).default(''),
  protectedTerms: z.array(z.string().min(1).max(240)).max(100).default([]),
});
export type SourceUnit = z.infer<typeof unitSchema>;
export type Finding = { severity: 'critical' | 'major' | 'minor'; code: string; message: string };
export type Review = { findings: Finding[]; summary: string };
export const reviewSchema = z.object({
  findings: z
    .array(
      z.object({
        severity: z.enum(['critical', 'major', 'minor']),
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(1000),
      }),
    )
    .max(30),
  summary: z.string().max(2000),
});
export type GlossaryEntry = { source: string; targets: Record<string, string>; keep?: boolean };
export const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  name: z.string().min(1).max(120),
  sourceLocale: z.string().default('en'),
  targetLocales: z.array(z.string().min(2).max(40)).max(100),
  budgetUsd: z.number().finite().nonnegative().max(1000000),
  approvalMode: z.enum(['automatic', 'human']).default('human'),
  glossary: z
    .array(
      z.object({
        source: z.string().min(1),
        targets: z.record(z.string(), z.string()),
        keep: z.boolean().optional(),
      }),
    )
    .default([]),
  instructions: z.record(z.string(), z.string().max(4000)).default({}),
});
export type Project = z.infer<typeof projectSchema>;
export type JobStatus = 'pending' | 'running' | 'review' | 'failed' | 'stale' | 'approved';
export type TranslationRecord = {
  id: string;
  projectId: string;
  unitId: string;
  locale: string;
  sourceHash: string;
  contextHash: string;
  source: SourceUnit;
  translation: string | null;
  revision: number;
  status: JobStatus;
  findings: Finding[];
  reviewSummary: string;
  attempts: number;
  error: string | null;
  costUsd: number;
  approvalRevision: number | null;
};
export type ApprovedCatalog = {
  schemaVersion: 1;
  projectId: string;
  locale: string;
  revision: string;
  sourceLocale?: string;
  messages: Record<string, string>;
  sources: Record<string, string>;
};
export const approvedCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().min(1),
    locale: z.string().min(2),
    sourceLocale: z.string().min(2).default('en'),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    messages: z.record(z.string(), z.string()),
    sources: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .superRefine((catalog, context) => {
    for (const locale of [catalog.locale, catalog.sourceLocale]) {
      try {
        new Intl.Locale(locale);
      } catch {
        context.addIssue({ code: 'custom', message: 'Invalid catalog locale' });
      }
    }
    if (
      Object.keys(catalog.messages).some((id) => !catalog.sources[id]) ||
      Object.keys(catalog.sources).some((id) => catalog.messages[id] === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Catalog messages and approved source revisions must agree',
      });
  });
export type ExtractedDocument = {
  format: 'json' | 'yaml' | 'po' | 'markdown' | 'mdx' | 'html';
  content: string;
  units: SourceUnit[];
  render(translations: Record<string, string>, locale: string): string;
};
export class ContractError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
