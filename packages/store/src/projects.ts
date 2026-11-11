import type { SqliteStore } from './index.js';
import { policyFor, ContractError, contextHash, projectSchema } from '@everylocale/core';
import type { Project } from '@everylocale/core';
import { decodeSourceLocale, decodeUnit } from './decode.js';
import type { JobRow } from './rows.js';

export function getProject(store: SqliteStore, id: string): Project {
  const row = store.db.prepare('SELECT config FROM projects WHERE id=?').get(id) as
    | { config: string }
    | undefined;
  if (!row) throw new ContractError('not_found', 'Project not found', 404);
  return projectSchema.parse(JSON.parse(row.config));
}

export function saveProject(store: SqliteStore, input: Project, actor = 'owner'): Project {
  const project = projectSchema.parse(input);
  if (
    new Set(project.targetLocales).size !== project.targetLocales.length ||
    project.targetLocales.includes(project.sourceLocale)
  )
    throw new ContractError(
      'locales',
      'Target locales must be unique and distinct from the source',
      422,
    );
  for (const locale of [project.sourceLocale, ...project.targetLocales]) {
    try {
      new Intl.Locale(locale);
    } catch {
      throw new ContractError('locale', 'Invalid locale', 422);
    }
  }
  return store.transaction(() => {
    const previous = store.db
      .prepare('SELECT config,spent,reserved FROM projects WHERE id=?')
      .get(project.id) as { config: string; spent: number; reserved: number } | undefined;
    if (previous && decodeSourceLocale(previous.config).sourceLocale !== project.sourceLocale)
      throw new ContractError(
        'source_locale',
        'Create a new project to change its source locale',
        422,
      );
    if (previous && project.budgetUsd + 1e-9 < previous.spent + previous.reserved)
      throw new ContractError(
        'budget',
        'Budget cannot be lower than spent plus reserved costs',
        422,
      );
    store.db
      .prepare(
        'INSERT INTO projects(id,config,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config',
      )
      .run(project.id, JSON.stringify(project), store.now());
    if (previous) {
      const jobs = store.db
        .prepare(
          "SELECT * FROM jobs WHERE project_id=? AND status IN ('pending','running','review','approved')",
        )
        .all(project.id) as JobRow[];
      for (const job of jobs) {
        const unit = decodeUnit(job.source_data);
        if (
          !project.targetLocales.includes(job.locale) ||
          contextHash(project, unit, job.locale) !== job.context_hash
        )
          store.stale(job);
        // Queued model work stops as soon as a policy keeps the text away from models.
        else if (job.status === 'pending' && policyFor(project, unit).translate === 'human')
          store.db.prepare("UPDATE jobs SET status='awaiting' WHERE id=?").run(job.id);
      }
    }
    store.audit(project.id, actor, 'project.save', project.id);
    return project;
  });
}

export function listProjects(
  store: SqliteStore,
): Array<Project & { spentUsd: number; reservedUsd: number }> {
  return (
    store.db.prepare('SELECT config,spent,reserved FROM projects ORDER BY id').all() as Array<{
      config: string;
      spent: number;
      reserved: number;
    }>
  ).map((x) => ({
    ...projectSchema.parse(JSON.parse(x.config)),
    spentUsd: x.spent,
    reservedUsd: x.reserved,
  }));
}
