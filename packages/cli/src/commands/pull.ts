import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Api } from '../api.js';
import type { Workspace } from '../project.js';
import { atomicWrite, extractSources, writeRelease } from '../release.js';

export type PullSummary = {
  revision: string;
  written: string[];
  /** Draft-locale files written with source text where a translation is not approved yet. */
  partial: Array<{ path: string; missing: number }>;
  /** Draft-locale documents left unwritten until every segment is approved. */
  skipped: Array<{ path: string; missing: number }>;
};

/**
 * Downloads the approved bundle, writes a verified release, and renders each translated file.
 * Live locales must be complete. In draft locales, message files use the source text for
 * unapproved messages and documents wait until fully approved; both are reported.
 */
export async function pull(api: Api, workspace: Workspace): Promise<PullSummary> {
  const { config } = workspace;
  const live = config.registry.slice(1).filter((item) => item.status === 'live');
  const bundle = await api(
    `/projects/${encodeURIComponent(config.project)}/bundle?complete=${encodeURIComponent(
      live.map((item) => item.id).join(','),
    )}`,
  );
  const documents = await extractSources(workspace);
  const manifest = await writeRelease(workspace, bundle, documents);
  const summary: PullSummary = {
    revision: manifest.revision,
    written: [],
    partial: [],
    skipped: [],
  };
  const release = join(workspace.root, config.release.directory, 'releases', manifest.revision);
  for (const locale of manifest.locales) {
    for (const [source, units] of documents) {
      const catalog = JSON.parse(
        await readFile(join(release, locale.id, `${source.namespace}.json`), 'utf8'),
      ) as { messages: Record<string, string> };
      const missing = units.filter((unit) => catalog.messages[unit.id] === undefined);
      const path = source.target(locale.id);
      if (missing.length && source.kind === 'content') {
        summary.skipped.push({ path, missing: missing.length });
        continue;
      }
      const translations = { ...catalog.messages };
      for (const unit of missing) translations[unit.id] = unit.source;
      const document = workspace.extract(source, await workspace.read(source));
      await atomicWrite(join(workspace.root, path), document.render(translations, locale.id));
      summary.written.push(path);
      if (missing.length) summary.partial.push({ path, missing: missing.length });
    }
  }
  return summary;
}
