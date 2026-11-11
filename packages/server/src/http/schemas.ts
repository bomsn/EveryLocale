import { z } from 'zod';
import {
  approvedCatalogSchema,
  catalogBundleSchema,
  FAILURE_CODES,
  findingSchema,
  policySchema,
  projectSchema,
  unitSchema,
  type FailureCode,
  type JobStatus,
} from '@everylocale/core';
import { documentOptionsSchema, SCOPES } from '@everylocale/store';

/**
 * Response shapes of the HTTP API. Each schema mirrors a store or service return type; the
 * contract checks every response against them outside production, and OpenAPI is built from
 * them. Named schemas become shared OpenAPI components.
 */
export const JOB_STATUSES: readonly [JobStatus, ...JobStatus[]] = [
  'pending',
  'running',
  'awaiting',
  'review',
  'failed',
  'stale',
  'approved',
];
const status = z.enum(JOB_STATUSES);
const failure = z.enum(FAILURE_CODES as [FailureCode, ...FailureCode[]]);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().describe('Milliseconds since the Unix epoch');

export const okSchema = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' });

const unitResponseSchema = unitSchema.meta({ id: 'SourceUnit' });
export const findingResponseSchema = findingSchema.meta({ id: 'Finding' });
const policyResponseSchema = policySchema.meta({ id: 'Policy' });

export const recordSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    unitId: z.string(),
    locale: z.string(),
    sourceHash: z.string(),
    contextHash: z.string(),
    source: unitResponseSchema,
    translation: z.string().nullable(),
    revision: z.number().int(),
    status,
    findings: z.array(findingResponseSchema),
    reviewSummary: z.string(),
    attempts: z.number().int(),
    error: z.string().nullable(),
    costUsd: z.number(),
    approvalRevision: z.number().int().nullable(),
    failure: failure.nullable(),
  })
  .meta({ id: 'Translation' });
export const recordWithPolicySchema = recordSchema
  .extend({ policy: policyResponseSchema })
  .meta({ id: 'TranslationWithPolicy' });

export const localeSchema = z
  .object({
    id: z.string(),
    status: z.enum(['live', 'draft']),
    label: z.string(),
    prefix: z.string(),
    direction: z.enum(['ltr', 'rtl']),
    flag: z.string().nullable().describe('Lower-case ISO country code of a flag, when one fits'),
  })
  .meta({ id: 'Locale' });

export const projectResponseSchema = projectSchema
  .extend({ locales: z.array(localeSchema) })
  .meta({ id: 'Project' });

export const catalogSchema = approvedCatalogSchema.meta({ id: 'ApprovedCatalog' });
export const bundleSchema = catalogBundleSchema.meta({ id: 'CatalogBundle' });

export const sessionSchema = z.object({
  owner: z.boolean(),
  scopes: z.array(z.enum(SCOPES)),
  locales: z.array(z.string()).nullable(),
  namespaces: z.array(z.string()).nullable(),
  csrf: z.string().nullable(),
  providersReady: z.boolean(),
});

export const operationsSchema = z.object({
  checkedAt: timestamp,
  projects: z.array(
    z.object({
      id: z.string(),
      spentUsd: z.number(),
      reservedUsd: z.number(),
      budgetUsd: z.number(),
      failed: z.number().int(),
      pending: z.number().int(),
      running: z.number().int(),
      oldestPendingAt: timestamp.nullable(),
    }),
  ),
  delivery: z.object({ pending: z.number().int(), dead: z.number().int() }),
  providers: z
    .object({
      paused: z.object({ failure, message: z.string(), since: timestamp }).nullable(),
    })
    .nullable(),
  events: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      type: z.string(),
      entityId: z.string(),
      detail: z.record(z.string(), z.unknown()),
      createdAt: timestamp,
      attempts: z.number().int(),
    }),
  ),
});

export const accountsSchema = z.object({
  configured: z.boolean(),
  accounts: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      email: z.string(),
      connected: z.boolean(),
      enabled: z.boolean(),
      paused: z.string().nullable(),
    }),
  ),
  usageUrl: z.string(),
});

export const tokenListSchema = z.array(
  z.object({
    id: z.string(),
    scopes: z.array(z.enum(SCOPES)),
    locales: z.array(z.string()).nullable(),
    namespaces: z.array(z.string()).nullable(),
    created_at: timestamp,
    expires_at: timestamp,
    revoked: z.number().int().describe('1 once revoked'),
  }),
);

export const sourceImportSchema = z.object({
  changed: z.array(z.string()),
  unchanged: z.array(z.string()),
});

export const documentSchema = z.object({
  namespace: z.string(),
  format: z.string(),
  units: z.array(z.string()),
  sourceRevision: sha256,
  options: documentOptionsSchema,
});

export const requestStatusSchema = z.object({
  total: z.number().int(),
  counts: z.partialRecord(status, z.number().int()),
  locales: z.record(z.string(), z.partialRecord(status, z.number().int())),
  attention: z.array(
    z.object({
      id: z.string(),
      unitId: z.string(),
      locale: z.string(),
      status,
      failure: failure.nullable(),
      error: z.string().nullable(),
      findings: z.array(z.string()),
    }),
  ),
});

export const summarySchema = z.object({
  sourceUnits: z.number().int(),
  languages: z.array(
    z.object({
      locale: z.string(),
      total: z.number().int(),
      approved: z.number().int(),
      review: z.number().int(),
      working: z.number().int(),
      awaiting: z.number().int(),
      failed: z.number().int(),
      untranslated: z.number().int(),
    }),
  ),
});

export const importResultSchema = z.object({
  imported: z.array(z.string()),
  unchanged: z.array(z.string()),
  rejected: z.array(z.object({ unitId: z.string(), reason: z.string() })),
});
