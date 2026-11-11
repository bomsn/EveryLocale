import { z } from 'zod';

export const unitSchema = z.object({
  id: z.string().min(1).max(240),
  source: z.string().min(1).max(20000),
  sourceLocale: z.string().min(2).max(40).default('en'),
  kind: z.enum(['text', 'icu', 'html', 'markdown']).default('text'),
  context: z.string().max(4000).default(''),
  protectedTerms: z.array(z.string().min(1).max(240)).max(100).default([]),
  /** Labels that approval policies match, such as `legal`. Tags never change the source revision. */
  tags: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i))
    .max(20)
    .default([]),
});
export type SourceUnit = z.infer<typeof unitSchema>;
export const findingSchema = z.object({
  severity: z.enum(['critical', 'major', 'minor']),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(1000),
});
export type Finding = z.infer<typeof findingSchema>;
export const reviewSchema = z.object({
  findings: z.array(findingSchema).max(30),
  summary: z.string().max(2000),
});
export type Review = z.infer<typeof reviewSchema>;
/** `*` matches within one path segment and `**` matches across segments. */
const glob = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[\w.:/*-]+$/, 'Use letters, digits, . : / - _ and *');
export const policySchema = z
  .object({
    match: z
      .object({
        /** Namespace glob, the part of a unit id before `:`. */
        namespace: glob.optional(),
        /** Key glob, the part of a unit id after `:`. */
        key: glob.optional(),
        tag: z.string().min(1).max(40).optional(),
      })
      .strict()
      .default({}),
    /** `human` keeps the text away from every model: a person writes the translation. */
    translate: z.enum(['ai', 'human']).default('ai'),
    approve: z.enum(['automatic', 'human']).default('human'),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export type GlossaryEntry = { source: string; targets: Record<string, string>; keep?: boolean };
export const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  name: z.string().min(1).max(120),
  sourceLocale: z.string().default('en'),
  targetLocales: z.array(z.string().min(2).max(40)).max(100),
  budgetUsd: z.number().nonnegative().max(1000000),
  policies: z
    .array(policySchema)
    .min(1)
    .max(100)
    .default([{ match: {}, translate: 'ai', approve: 'human' }])
    .refine(
      (policies) => Object.keys(policies.at(-1)?.match ?? {}).length === 0,
      'The last policy must match every message, so each message has an explicit rule',
    ),
  /** Unit id globs, such as `common:brand.*`, whose source text is used in every locale. */
  locked: z.array(glob).max(200).default([]),
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
  /** Language AI review findings are written in, for the people who read them. */
  reviewerLanguage: z.string().min(2).max(40).default('en'),
});
export type Project = z.infer<typeof projectSchema>;
/** `awaiting` is a message whose policy needs a person to write the translation. */
export type JobStatus =
  | 'pending'
  | 'running'
  | 'awaiting'
  | 'review'
  | 'failed'
  | 'stale'
  | 'approved';
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
  /** A registered format id, see `formatIds()`. */
  format: string;
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
