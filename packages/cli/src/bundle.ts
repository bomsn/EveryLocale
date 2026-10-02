import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catalogBundleSchema, type CatalogBundle } from '@everylocale/core';

/** Consumers capture current.json once, then read immutable catalogs from that revision. */
export async function installBundle(directory: string, input: unknown) {
  const bundle = catalogBundleSchema.parse(input);
  const root = resolve(directory),
    releases = join(root, 'releases');
  await mkdir(releases, { recursive: true });
  const staging = join(releases, `.${bundle.revision}.${randomUUID()}.tmp`);
  await mkdir(staging);
  try {
    await writeFile(join(staging, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n', {
      flag: 'wx',
    });
    for (const catalog of bundle.catalogs)
      await writeFile(
        join(staging, `${catalog.locale}.json`),
        JSON.stringify(catalog, null, 2) + '\n',
        { flag: 'wx' },
      );
    const release = join(releases, bundle.revision);
    try {
      await rename(staging, release);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw error;
      const existing = catalogBundleSchema.parse(
        JSON.parse(await readFile(join(release, 'bundle.json'), 'utf8')),
      );
      if (JSON.stringify(existing) !== JSON.stringify(bundle))
        throw new Error('Existing release differs');
    }
    await activateBundle(root, bundle.revision);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return bundle;
}
export async function activateBundle(directory: string, revision: string) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid release revision');
  const root = resolve(directory);
  const bundle = catalogBundleSchema.parse(
    JSON.parse(await readFile(join(root, 'releases', revision, 'bundle.json'), 'utf8')),
  );
  if (bundle.revision !== revision) throw new Error('Release checksum differs');
  // Verify every delivered file before exposing the revision to a consuming build.
  for (const catalog of bundle.catalogs) {
    const file = JSON.parse(
      await readFile(join(root, 'releases', revision, `${catalog.locale}.json`), 'utf8'),
    );
    if (JSON.stringify(file) !== JSON.stringify(catalog))
      throw new Error('Delivered catalog differs');
  }
  const temporary = join(root, `.current.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, revision }) + '\n', {
      flag: 'wx',
    });
    await rename(temporary, join(root, 'current.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function readBundle(directory: string): Promise<CatalogBundle> {
  const root = resolve(directory);
  const pointer = JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) as {
    revision: string;
  };
  if (!/^[a-f0-9]{64}$/.test(pointer.revision)) throw new Error('Invalid release pointer');
  const bundle = catalogBundleSchema.parse(
    JSON.parse(await readFile(join(root, 'releases', pointer.revision, 'bundle.json'), 'utf8')),
  );
  if (bundle.revision !== pointer.revision) throw new Error('Release checksum differs');
  return bundle;
}
