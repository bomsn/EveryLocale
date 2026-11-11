import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { CompiledMessage, CompiledMessages } from './messages.js';
import {
  catalogPath,
  namespaceCatalogSchema,
  releaseManifestSchema,
  releasePointerSchema,
  type NamespaceCatalog,
  type ReleaseManifest,
} from './release.js';

export * from './release.js';

export class ReleaseError extends Error {}

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

/** The revision covers everything in the manifest except the revision itself. */
export const manifestRevision = (manifest: Omit<ReleaseManifest, 'revision'>) =>
  sha256(JSON.stringify(manifest));

const compiledSchema = z.record(z.string(), z.array(z.unknown()));

export type FallbackReport = (summary: { locale: string; missing: readonly string[] }) => void;

export type Release = {
  revision: string;
  manifest: ReleaseManifest;
  /**
   * Compiled messages for the namespaces a page uses. In a draft locale, messages without an
   * approved translation use the source text; `loadRelease` reports them once per locale.
   */
  messages(locale: string, namespaces: readonly string[]): CompiledMessages;
  /** Approved text and source revisions of one namespace, as stored in the release. */
  catalog(locale: string, namespace: string): NamespaceCatalog;
};

/**
 * Loads the release `current.json` points to and verifies every file against the manifest
 * checksums before anything is served. A missing, altered or partial release fails loudly.
 */
export async function loadRelease(
  directory: string,
  options: { onFallback?: FallbackReport } = {},
): Promise<Release> {
  const read = async (path: string) => {
    try {
      return await readFile(path);
    } catch {
      throw new ReleaseError(`Release file is missing: ${path}`);
    }
  };
  const parse = <T>(schema: z.ZodType<T>, bytes: Uint8Array, path: string): T => {
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) throw new ReleaseError(`Release file is invalid: ${path}`);
    return parsed.data;
  };
  const pointer = parse(
    releasePointerSchema,
    await read(join(directory, 'current.json')),
    'current.json',
  );
  const root = join(directory, 'releases', pointer.revision);
  const manifest = parse(
    releaseManifestSchema,
    await read(join(root, 'manifest.json')),
    'manifest.json',
  );
  const { revision, ...unsigned } = manifest;
  if (revision !== pointer.revision || manifestRevision(unsigned) !== revision)
    throw new ReleaseError('Release manifest does not match its revision');
  const files = new Map<string, Uint8Array>();
  for (const [path, digest] of Object.entries(manifest.files)) {
    const bytes = await read(join(root, path));
    if (sha256(bytes) !== digest) throw new ReleaseError(`Release file was altered: ${path}`);
    files.set(path, bytes);
  }
  const file = (path: string) => {
    const bytes = files.get(path);
    if (!bytes) throw new ReleaseError(`Release has no ${path}`);
    return bytes;
  };
  const compiled = new Map<string, Readonly<Record<string, CompiledMessage>>>();
  const namespaces = new Set(
    manifest.namespaces.filter((item) => item.kind === 'messages').map((item) => item.id),
  );
  const compiledFor = (locale: string, namespace: string) => {
    const key = `${locale}\u0000${namespace}`;
    let messages = compiled.get(key);
    if (!messages) {
      const path = catalogPath(locale, namespace, true);
      messages = parse(compiledSchema, file(path), path) as Record<string, CompiledMessage>;
      compiled.set(key, messages);
    }
    return messages;
  };
  for (const locale of manifest.locales)
    if (locale.missing.length) options.onFallback?.({ locale: locale.id, missing: locale.missing });
  const known = new Set([manifest.sourceLocale, ...manifest.locales.map((item) => item.id)]);
  return {
    revision,
    manifest,
    messages(locale, requested) {
      if (!known.has(locale)) throw new ReleaseError(`Locale ${locale} is not in this release`);
      const result: Record<string, CompiledMessage> = {};
      for (const namespace of requested) {
        if (!namespaces.has(namespace))
          throw new ReleaseError(
            `Namespace ${namespace} is not a message namespace in this release`,
          );
        Object.assign(result, compiledFor(manifest.sourceLocale, namespace));
        if (locale !== manifest.sourceLocale) Object.assign(result, compiledFor(locale, namespace));
      }
      return result;
    },
    catalog(locale, namespace) {
      const path = catalogPath(locale, namespace);
      return parse(namespaceCatalogSchema, file(path), path);
    },
  };
}
