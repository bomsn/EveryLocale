import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import {
  catalogBundleSchema,
  sourceHash,
  type ApprovedCatalog,
  type CatalogBundle,
  type SourceUnit,
} from '@everylocale/core';
import {
  catalogPath,
  manifestRevision,
  namespaceOf,
  releaseManifestSchema,
  releasePointerSchema,
  RELEASE_SCHEMA_VERSION,
  sha256,
  type NamespaceCatalog,
  type ReleaseManifest,
} from '@everylocale/runtime/server';
import type { SourceFile, Workspace } from './project.js';

/** Replaces a file in one rename, so readers never see a partial write. */
export async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

/** ICU messages are parsed; plain text segments become one literal, so braces stay text. */
function compile(unit: SourceUnit, text: string): MessageFormatElement[] {
  return unit.kind === 'icu' ? parse(text) : [{ type: TYPE.literal, value: text }];
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export type SourceDocuments = Map<SourceFile, SourceUnit[]>;

export async function extractSources(workspace: Workspace): Promise<SourceDocuments> {
  const documents: SourceDocuments = new Map();
  for (const source of workspace.sources)
    documents.set(source, workspace.extract(source, await workspace.read(source)).units);
  return documents;
}

/**
 * Builds a release from the service bundle and the local source files. Every approval must
 * match the local source text: a file edited after the last sync fails here instead of
 * shipping translations of older wording.
 */
export async function writeRelease(
  workspace: Workspace,
  input: unknown,
  documents: SourceDocuments,
): Promise<ReleaseManifest> {
  const bundle: CatalogBundle = catalogBundleSchema.parse(input);
  const { config } = workspace;
  if (bundle.projectId !== config.project)
    throw new Error(`The bundle belongs to ${bundle.projectId}, not ${config.project}`);
  const units = new Map<string, SourceUnit>();
  for (const list of documents.values()) for (const unit of list) units.set(unit.id, unit);
  const byLocale = new Map<string, ApprovedCatalog>(
    bundle.catalogs.map((catalog) => [catalog.locale, catalog]),
  );
  const outdated = [...units.values()].filter(
    (unit) => byLocale.get(config.sourceLocale)?.sources[unit.id] !== sourceHash(unit),
  );
  if (outdated.length)
    throw new Error(
      `Run everylocale sync first; the service has a different source for: ${outdated
        .slice(0, 10)
        .map((unit) => unit.id)
        .join(', ')}${outdated.length > 10 ? ` and ${String(outdated.length - 10)} more` : ''}`,
    );
  const namespaces = [...documents.keys()].map((source) => ({
    id: source.namespace,
    kind: source.kind,
  }));
  const files: Record<string, string> = {};
  const contents = new Map<string, string>();
  const put = (path: string, value: unknown) => {
    const text = json(value);
    contents.set(path, text);
    files[path] = sha256(text);
  };
  const locales: ReleaseManifest['locales'] = [];
  for (const locale of [config.sourceLocale, ...config.locales.map((item) => item.id)]) {
    const catalog = byLocale.get(locale);
    if (!catalog) throw new Error(`The service has no catalog for ${locale}`);
    const missing: string[] = [];
    for (const { id: namespace, kind } of namespaces) {
      const ids = [...units.values()].filter((unit) => namespaceOf(unit.id) === namespace);
      const entry: NamespaceCatalog = { locale, namespace, messages: {}, sources: {} };
      const compiled: Record<string, MessageFormatElement[]> = {};
      for (const unit of ids) {
        const text = catalog.messages[unit.id];
        if (text === undefined || catalog.sources[unit.id] !== sourceHash(unit)) {
          missing.push(unit.id);
          continue;
        }
        entry.messages[unit.id] = text;
        entry.sources[unit.id] = sourceHash(unit);
        if (kind === 'messages') compiled[unit.id] = compile(unit, text);
      }
      put(catalogPath(locale, namespace), entry);
      if (kind === 'messages') put(catalogPath(locale, namespace, true), compiled);
    }
    if (locale !== config.sourceLocale) {
      const definition = config.registry.find((item) => item.id === locale);
      const status = definition?.status ?? 'live';
      if (status === 'live' && missing.length)
        throw new Error(
          `${locale} is live but ${String(missing.length)} messages have no current approval`,
        );
      locales.push({ id: locale, status, missing });
    }
  }
  const plurals = Object.fromEntries(
    [config.sourceLocale, ...locales.map((item) => item.id)].map((locale) => [
      locale,
      {
        cardinal: new Intl.PluralRules(locale).resolvedOptions().pluralCategories,
        ordinal: new Intl.PluralRules(locale, { type: 'ordinal' }).resolvedOptions()
          .pluralCategories,
      },
    ]),
  );
  const unsigned = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    project: config.project,
    bundleRevision: bundle.revision,
    sourceLocale: config.sourceLocale,
    locales,
    namespaces,
    plurals,
    files,
  } as const;
  const manifest = releaseManifestSchema.parse({
    ...unsigned,
    revision: manifestRevision(unsigned),
  });
  const directory = join(workspace.root, config.release.directory);
  const target = join(directory, 'releases', manifest.revision);
  const staging = join(directory, 'releases', `.${manifest.revision}.${randomUUID()}.tmp`);
  try {
    for (const [path, text] of contents) {
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await writeFile(join(staging, path), text, { flag: 'wx' });
    }
    await writeFile(join(staging, 'manifest.json'), json(manifest), { flag: 'wx' });
    try {
      await rename(staging, target);
    } catch (error) {
      // The same revision already exists; identical content means there is nothing to do.
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error;
      const existing = await readFile(join(target, 'manifest.json'), 'utf8');
      if (existing !== json(manifest)) throw new Error('A different release has the same revision');
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await activate(workspace, manifest.revision);
  return manifest;
}

/** Points current.json at a release after checking that its manifest is present and intact. */
export async function activate(workspace: Workspace, revision: string) {
  const directory = join(workspace.root, workspace.config.release.directory);
  const pointer = releasePointerSchema.parse({ schemaVersion: RELEASE_SCHEMA_VERSION, revision });
  const manifest = releaseManifestSchema.parse(
    JSON.parse(await readFile(join(directory, 'releases', revision, 'manifest.json'), 'utf8')),
  );
  for (const [path, digest] of Object.entries(manifest.files))
    if (sha256(await readFile(join(directory, 'releases', revision, path), 'utf8')) !== digest)
      throw new Error(`Release file was altered: ${path}`);
  await atomicWrite(join(directory, 'current.json'), json(pointer));
}
