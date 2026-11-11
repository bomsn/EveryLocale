import { z } from 'zod';

/**
 * A release is an immutable directory written by `everylocale pull`:
 *
 *   current.json                                  { schemaVersion, revision }
 *   releases/<revision>/manifest.json             locales, namespaces, plural rules, checksums
 *   releases/<revision>/<locale>/<namespace>.json      approved messages and source revisions
 *   releases/<revision>/<locale>/<namespace>.ast.json  precompiled messages (message namespaces)
 *
 * Apps read `current.json` once and load that revision; switching releases is one atomic
 * write of the pointer, and earlier revisions stay available for rollback.
 */
export const RELEASE_SCHEMA_VERSION = 1;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const releasePointerSchema = z
  .object({ schemaVersion: z.literal(RELEASE_SCHEMA_VERSION), revision: sha256 })
  .strict();

export const releaseManifestSchema = z
  .object({
    schemaVersion: z.literal(RELEASE_SCHEMA_VERSION),
    project: z.string().min(1),
    revision: sha256,
    /** The service bundle this release was built from. */
    bundleRevision: sha256,
    sourceLocale: z.string().min(2),
    locales: z.array(
      z
        .object({
          id: z.string().min(2),
          status: z.enum(['live', 'draft']),
          /** Message ids without an approved translation; always empty for live locales. */
          missing: z.array(z.string()),
        })
        .strict(),
    ),
    namespaces: z.array(
      z
        .object({
          id: z.string().min(1),
          /** `messages` are precompiled for the runtime; `content` is rendered into files. */
          kind: z.enum(['messages', 'content']),
        })
        .strict(),
    ),
    /** CLDR plural categories recorded when the release was built, per locale. */
    plurals: z.record(
      z.string(),
      z.object({ cardinal: z.array(z.string()), ordinal: z.array(z.string()) }).strict(),
    ),
    /** Every file in the release directory except the manifest, with its SHA-256. */
    files: z.record(z.string(), sha256),
  })
  .strict();
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const namespaceCatalogSchema = z
  .object({
    locale: z.string().min(2),
    namespace: z.string().min(1),
    messages: z.record(z.string(), z.string()),
    /** The source revision each approval binds to. */
    sources: z.record(z.string(), sha256),
  })
  .strict();
export type NamespaceCatalog = z.infer<typeof namespaceCatalogSchema>;

export const catalogPath = (locale: string, namespace: string, compiled = false) =>
  `${locale}/${namespace}${compiled ? '.ast' : ''}.json`;
/** The namespace of a message id, the part before the first colon. */
export const namespaceOf = (id: string) => {
  const at = id.indexOf(':');
  return at < 0 ? '' : id.slice(0, at);
};
