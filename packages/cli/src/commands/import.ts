import type { Api } from '../api.js';
import type { SourceFile, Workspace } from '../project.js';

const BATCH = 5000;

export type ImportSummary = {
  imported: number;
  unchanged: number;
  rejected: Array<{ unitId: string; reason: string }>;
  /** Files that could not be paired with their source, with the reason. */
  unmatched: Array<{ path: string; reason: string }>;
};

/**
 * Pairs each existing translated file with its source. Message files pair by key. Documents
 * pair segment by segment, which requires the same structure in the same order; a document
 * that differs is reported rather than guessed at.
 */
async function pair(
  workspace: Workspace,
  source: SourceFile,
  locale: string,
): Promise<Array<{ unitId: string; translation: string }> | string> {
  let translated: string;
  try {
    translated = await workspace.read(source, locale);
  } catch {
    return 'no translated file';
  }
  const original = workspace.extract(source, await workspace.read(source)).units;
  const target = workspace.extract(source, translated).units;
  if (source.kind === 'messages') {
    const byId = new Map(target.map((unit) => [unit.id, unit.source]));
    return original.flatMap((unit) => {
      const translation = byId.get(unit.id);
      return translation === undefined ? [] : [{ unitId: unit.id, translation }];
    });
  }
  if (
    original.length !== target.length ||
    original.some((unit, index) => unit.context !== target[index]?.context)
  )
    return 'its structure differs from the source, so segments cannot be paired';
  return original.map((unit, index) => ({
    unitId: unit.id,
    translation: target[index]?.source ?? '',
  }));
}

export async function importTranslations(
  api: Api,
  workspace: Workspace,
  locale: string,
): Promise<ImportSummary> {
  if (!workspace.config.registry.slice(1).some((item) => item.id === locale))
    throw new Error(`${locale} is not a target locale in the config`);
  const summary: ImportSummary = { imported: 0, unchanged: 0, rejected: [], unmatched: [] };
  const entries: Array<{ unitId: string; translation: string }> = [];
  for (const source of workspace.sources) {
    const paired = await pair(workspace, source, locale);
    if (typeof paired === 'string')
      summary.unmatched.push({ path: source.target(locale), reason: paired });
    else entries.push(...paired);
  }
  for (let start = 0; start < entries.length; start += BATCH) {
    const result = await api<{
      imported: string[];
      unchanged: string[];
      rejected: ImportSummary['rejected'];
    }>(`/projects/${encodeURIComponent(workspace.config.project)}/translations`, 'POST', {
      locale,
      entries: entries.slice(start, start + BATCH),
    });
    summary.imported += result.imported.length;
    summary.unchanged += result.unchanged.length;
    summary.rejected.push(...result.rejected);
  }
  return summary;
}
