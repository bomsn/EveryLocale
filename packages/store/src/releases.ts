import type { SqliteStore } from './index.js';
import { ContractError, hash } from '@everylocale/core';
import type { ApprovedCatalog } from '@everylocale/core';
import { decodeCatalog, decodeUnit, dictionary, approvedSource } from './decode.js';
import type { PublicationRow } from './rows.js';

export function exportCatalog(
  store: SqliteStore,
  projectId: string,
  locale: string,
  requireCurrent = false,
): ApprovedCatalog {
  const project = store.getProject(projectId);
  if (locale !== project.sourceLocale && !project.targetLocales.includes(locale))
    throw new ContractError('locale', 'Locale is not configured', 422);
  const messages = dictionary<string>();
  const sources = dictionary<string>();
  const active = store.db
    .prepare(
      'SELECT unit_id,data,source_hash FROM sources WHERE project_id=? AND active=1 ORDER BY unit_id',
    )
    .all(projectId) as Array<{ unit_id: string; data: string; source_hash: string }>;
  const published = store.db
    .prepare(
      'SELECT p.unit_id,p.translation,p.source_hash FROM publications p JOIN sources s ON s.project_id=p.project_id AND s.unit_id=p.unit_id WHERE p.project_id=? AND p.locale=? AND s.active=1 ORDER BY p.unit_id',
    )
    .all(projectId, locale) as PublicationRow[];
  if (locale === project.sourceLocale) {
    for (const row of active) {
      messages[row.unit_id] = decodeUnit(row.data).source;
      sources[row.unit_id] = row.source_hash;
    }
  } else {
    for (const row of published) {
      messages[row.unit_id] = row.translation;
      sources[row.unit_id] = row.source_hash;
    }
    if (requireCurrent && active.some((x) => sources[x.unit_id] !== x.source_hash))
      throw new ContractError('incomplete_catalog', 'Current sources are not fully approved', 422);
  }
  return {
    schemaVersion: 1,
    projectId,
    locale,
    sourceLocale: project.sourceLocale,
    revision: hash({ projectId, locale, messages, sources }),
    messages: Object.fromEntries(Object.entries(messages)),
    sources: Object.fromEntries(Object.entries(sources)),
  };
}

export function exportBundle(
  store: SqliteStore,
  projectId: string,
  requireCurrent = true,
): import('@everylocale/core').CatalogBundle {
  // One read transaction prevents publications from changing between locale exports.
  return store.db.transaction(() => {
    const project = store.getProject(projectId);
    const catalogs = [project.sourceLocale, ...project.targetLocales].map((locale) => ({
      ...store.exportCatalog(projectId, locale, requireCurrent),
      sourceLocale: project.sourceLocale,
    }));
    return {
      schemaVersion: 1 as const,
      projectId,
      catalogs,
      revision: hash({ projectId, catalogs }),
    };
  })();
}

export function snapshot(store: SqliteStore, projectId: string, locale: string): ApprovedCatalog {
  const catalog = store.exportCatalog(projectId, locale);
  store.db
    .prepare(
      'INSERT OR IGNORE INTO artifacts(id,project_id,locale,data,created_at) VALUES(?,?,?,?,?)',
    )
    .run(catalog.revision, projectId, locale, JSON.stringify(catalog), store.now());
  return catalog;
}

export function rollback(
  store: SqliteStore,
  projectId: string,
  locale: string,
  artifactId: string,
  actor: string,
) {
  store.transaction(() => {
    const row = store.db
      .prepare('SELECT data FROM artifacts WHERE id=? AND project_id=? AND locale=?')
      .get(artifactId, projectId, locale) as { data: string } | undefined;
    if (!row) throw new ContractError('not_found', 'Approved artifact not found', 404);
    const catalog = decodeCatalog(row.data);
    store.db
      .prepare('DELETE FROM publications WHERE project_id=? AND locale=?')
      .run(projectId, locale);
    for (const [unitId, translation] of Object.entries(catalog.messages)) {
      const source = store.db
        .prepare('SELECT active FROM sources WHERE project_id=? AND unit_id=?')
        .get(projectId, unitId) as { active: number } | undefined;
      if (!source?.active) continue;
      store.db
        .prepare(
          'INSERT INTO publications(project_id,unit_id,locale,translation,source_hash,job_id,revision,published_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          projectId,
          unitId,
          locale,
          translation,
          approvedSource(catalog, unitId),
          `artifact:${artifactId}`,
          0,
          store.now(),
        );
    }
    store.audit(projectId, actor, 'publication.rollback', artifactId, { locale });
  });
}

export function artifacts(store: SqliteStore, projectId: string, locale?: string) {
  return store.db
    .prepare(
      `SELECT id,locale,created_at FROM artifacts WHERE project_id=? ${locale ? 'AND locale=?' : ''} ORDER BY created_at DESC LIMIT 100`,
    )
    .all(...(locale ? [projectId, locale] : [projectId])) as Array<{
    id: string;
    locale: string;
    created_at: number;
  }>;
}
