import type { SqliteStore } from './index.js';
import {
  ContractError,
  contextHash,
  hash,
  sourceHash,
  unitSchema,
  validateTranslation,
  extractDocument,
} from '@everylocale/core';
import type { SourceUnit } from '@everylocale/core';
import { decodeStrings, dictionary, documentRow } from './decode.js';
import type { JobRow, SourceRow } from './rows.js';

export function source(store: SqliteStore, projectId: string, unitId: string): SourceRow {
  const row = store.db
    .prepare('SELECT * FROM sources WHERE project_id=? AND unit_id=?')
    .get(projectId, unitId) as SourceRow | undefined;
  if (!row || !row.active)
    throw new ContractError('source_missing', 'Source is missing or withdrawn', 404);
  return row;
}

export function importSources(store: SqliteStore, projectId: string, inputs: SourceUnit[]) {
  const project = store.getProject(projectId);
  const units = inputs.map((x) => unitSchema.parse(x));
  if (new Set(units.map((x) => x.id)).size !== units.length)
    throw new ContractError('duplicate_unit', 'Source IDs must be unique', 422);
  if (units.some((x) => x.sourceLocale !== project.sourceLocale))
    throw new ContractError('source_locale', 'Source unit locale differs from project', 422);
  return store.transaction(() => {
    const changed: string[] = [],
      unchanged: string[] = [];
    for (const unit of units) {
      const digest = sourceHash(unit);
      const previous = store.db
        .prepare('SELECT * FROM sources WHERE project_id=? AND unit_id=?')
        .get(projectId, unit.id) as SourceRow | undefined;
      if (previous?.source_hash === digest && previous.active) {
        unchanged.push(unit.id);
        continue;
      }
      const jobs = store.db
        .prepare(
          "SELECT * FROM jobs WHERE project_id=? AND unit_id=? AND status IN ('pending','running','review','approved')",
        )
        .all(projectId, unit.id) as JobRow[];
      for (const job of jobs) store.stale(job);
      store.db
        .prepare(
          'INSERT INTO sources(project_id,unit_id,data,source_hash) VALUES(?,?,?,?) ON CONFLICT(project_id,unit_id) DO UPDATE SET data=excluded.data,source_hash=excluded.source_hash,active=1',
        )
        .run(projectId, unit.id, JSON.stringify(unit), digest);
      changed.push(unit.id);
    }
    store.audit(projectId, 'connector', 'source.import', projectId, { changed, unchanged });
    return { changed, unchanged };
  });
}

export function importDocument(
  store: SqliteStore,
  projectId: string,
  namespace: string,
  format: string,
  content: string,
) {
  const project = store.getProject(projectId);
  const document = extractDocument(content, format, namespace);
  const units = document.units.map((x) => ({ ...x, sourceLocale: project.sourceLocale }));
  return store.transaction(() => {
    const previous = store.db
      .prepare('SELECT unit_ids FROM documents WHERE project_id=? AND namespace=?')
      .get(projectId, namespace) as { unit_ids: string } | undefined;
    const ids = units.map((x) => x.id);
    if (previous)
      store.withdraw(
        projectId,
        decodeStrings(previous.unit_ids).filter((x) => !ids.includes(x)),
        'connector',
      );
    const result = store.importSources(projectId, units);
    const sourceRevision = hash({ format, content });
    store.db
      .prepare(
        'INSERT INTO documents(project_id,namespace,format,content,unit_ids,source_revision) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,namespace) DO UPDATE SET format=excluded.format,content=excluded.content,unit_ids=excluded.unit_ids,source_revision=excluded.source_revision',
      )
      .run(projectId, namespace, format, content, JSON.stringify(ids), sourceRevision);
    return { ...result, units: ids, sourceRevision };
  });
}

export function exportDocument(
  store: SqliteStore,
  projectId: string,
  namespace: string,
  locale: string,
) {
  const project = store.getProject(projectId);
  const row = store.db
    .prepare('SELECT * FROM documents WHERE project_id=? AND namespace=?')
    .get(projectId, namespace) as
    | { format: string; content: string; source_revision: string }
    | undefined;
  if (!row) throw new ContractError('not_found', 'Document not found', 404);
  const document = extractDocument(row.content, row.format, namespace);
  const catalog = store.exportCatalog(projectId, locale);
  for (const unit of document.units) {
    if (catalog.sources[unit.id] !== sourceHash({ ...unit, sourceLocale: project.sourceLocale }))
      throw new ContractError(
        'incomplete_document',
        'All current document segments need approval before publication',
        422,
      );
  }
  const revision = hash({
    namespace,
    locale,
    sourceRevision: row.source_revision,
    messages: document.units.map((unit) => [unit.id, catalog.messages[unit.id]]),
  });
  return {
    namespace,
    locale,
    sourceRevision: row.source_revision,
    revision,
    content: document.render(catalog.messages, locale),
  };
}

/** A clearly marked private preview can mix reviewed candidates with untouched source text.
 * It never enters the approved-export path and always reports untranslated segments.
 */
export function previewDocument(
  store: SqliteStore,
  projectId: string,
  namespace: string,
  locale: string,
) {
  const project = store.getProject(projectId);
  if (!project.targetLocales.includes(locale))
    throw new ContractError('locale', 'Locale is not configured', 422);
  const row = store.db
    .prepare('SELECT * FROM documents WHERE project_id=? AND namespace=?')
    .get(projectId, namespace) as
    | { format: string; content: string; source_revision: string }
    | undefined;
  if (!row) throw new ContractError('not_found', 'Document not found', 404);
  const document = extractDocument(row.content, row.format, namespace);
  const translations = dictionary<string>(),
    pendingUnits: string[] = [];
  for (const rawUnit of document.units) {
    const unit = { ...rawUnit, sourceLocale: project.sourceLocale };
    const candidate = store.db
      .prepare(
        "SELECT translation FROM jobs WHERE project_id=? AND unit_id=? AND locale=? AND context_hash=? AND status IN ('review','approved')",
      )
      .get(projectId, unit.id, locale, contextHash(project, unit, locale)) as
      | { translation: string }
      | undefined;
    if (
      candidate?.translation &&
      !validateTranslation(unit, candidate.translation, locale, project.glossary).some(
        (finding) => finding.severity === 'critical',
      )
    )
      translations[unit.id] = candidate.translation;
    else {
      translations[unit.id] = unit.source;
      pendingUnits.push(unit.id);
    }
  }
  return {
    format: row.format,
    source: row.content,
    translation: document.render(translations, locale),
    sourceLocale: project.sourceLocale,
    pendingUnits,
    sourceRevision: row.source_revision,
  };
}

export function withdraw(store: SqliteStore, projectId: string, unitIds: string[], actor: string) {
  store.getProject(projectId);
  store.transaction(() => {
    for (const unitId of unitIds) {
      store.db
        .prepare('UPDATE sources SET active=0 WHERE project_id=? AND unit_id=?')
        .run(projectId, unitId);
      store.db
        .prepare('DELETE FROM publications WHERE project_id=? AND unit_id=?')
        .run(projectId, unitId);
      for (const job of store.db
        .prepare(
          "SELECT * FROM jobs WHERE project_id=? AND unit_id=? AND status IN ('pending','running','review','approved')",
        )
        .all(projectId, unitId) as JobRow[])
        store.stale(job);
      store.audit(projectId, actor, 'source.withdraw', unitId);
    }
  });
}

export function currentSources(store: SqliteStore, projectId: string) {
  return new Map(
    (
      store.db
        .prepare(
          'SELECT unit_id,data,source_hash,active FROM sources WHERE project_id=? AND active=1',
        )
        .all(projectId) as Array<SourceRow & { unit_id: string }>
    ).map((row) => [row.unit_id, row]),
  );
}

export function documents(store: SqliteStore, projectId: string) {
  store.getProject(projectId);
  return store.db
    .prepare(
      'SELECT namespace,format,unit_ids,source_revision FROM documents WHERE project_id=? ORDER BY namespace',
    )
    .all(projectId)
    .map((row) => documentRow(row))
    .map((row) => ({
      namespace: row.namespace,
      format: row.format,
      units: decodeStrings(row.unit_ids),
      sourceRevision: row.source_revision,
    }));
}
