import { z } from 'zod';
import {
  approvedCatalogSchema,
  ContractError,
  findingSchema,
  unitSchema,
  type ApprovedCatalog,
} from '@everylocale/core';

/** Every JSON column is validated when read, so a corrupted row fails loudly at its source. */
const column =
  <T>(schema: z.ZodType<T>) =>
  (text: string): T =>
    schema.parse(JSON.parse(text));

export const SCOPES = ['read', 'import', 'translate', 'review', 'approve', 'export'] as const;
export type Scope = (typeof SCOPES)[number];

export const decodeUnit = column(unitSchema);
export const decodeFindings = column(z.array(findingSchema));
export const decodeScopes = column(z.array(z.enum(SCOPES)));
export const decodeStrings = column(z.array(z.string()));
export const decodeCatalog = column(approvedCatalogSchema);
export const decodeDetail = column(z.record(z.string(), z.unknown()));
export const decodeSourceLocale = column(z.object({ sourceLocale: z.string() }));

const documentSchema = z.object({
  namespace: z.string(),
  format: z.string(),
  unit_ids: z.string(),
  source_revision: z.string(),
});
export const documentRow = (row: unknown) => documentSchema.parse(row);
const tokenSchema = z.object({
  id: z.string(),
  scopes: z.string(),
  created_at: z.number(),
  expires_at: z.number(),
  revoked: z.number(),
});
export const tokenRow = (row: unknown) => tokenSchema.parse(row);

/** Unit ids are user input, so lookup tables must not inherit `__proto__` or other keys. */
export const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export function approvedSource(catalog: ApprovedCatalog, unitId: string): string {
  const source = catalog.sources[unitId];
  if (source === undefined)
    throw new ContractError(
      'artifact_corrupt',
      `Approved artifact has no source for ${unitId}`,
      500,
    );
  return source;
}
