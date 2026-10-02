import { z } from 'zod';
import { approvedCatalogSchema } from './types.js';
import { hash } from './hash.js';

export const catalogBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().min(1),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    catalogs: z.array(approvedCatalogSchema).min(1).max(101),
  })
  .superRefine((bundle, context) => {
    const locales = new Set<string>();
    for (const catalog of bundle.catalogs) {
      if (catalog.projectId !== bundle.projectId || locales.has(catalog.locale))
        context.addIssue({
          code: 'custom',
          message: 'Catalogs must belong to one project with distinct locales',
        });
      locales.add(catalog.locale);
      if (
        catalog.revision !==
        hash({
          projectId: catalog.projectId,
          locale: catalog.locale,
          messages: catalog.messages,
          sources: catalog.sources,
        })
      )
        context.addIssue({ code: 'custom', message: 'Catalog checksum differs' });
    }
    if (bundle.revision !== hash({ projectId: bundle.projectId, catalogs: bundle.catalogs }))
      context.addIssue({ code: 'custom', message: 'Bundle checksum differs' });
  });
export type CatalogBundle = z.infer<typeof catalogBundleSchema>;
