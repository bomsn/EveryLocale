import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { sourceHash, validateTranslation } from '@everylocale/core';
import { loadRelease, ReleaseError, type Release } from '@everylocale/runtime/server';
import type { Workspace } from '../project.js';
import { extractSources } from '../release.js';

type Problem = {
  code:
    | 'release_missing'
    | 'release_mismatch'
    | 'locale_missing'
    | 'locale_draft'
    | 'translation_missing'
    | 'translation_stale'
    | 'translation_invalid'
    | 'plural_rules_changed'
    | 'file_outdated'
    | 'id_unknown'
    | 'id_dynamic'
    | 'id_unused';
  message: string;
  locale?: string;
  id?: string;
  file?: string;
};
export type CheckReport = {
  release: string | null;
  problems: Problem[];
  /** Draft locales may be incomplete; their gaps are listed, not failed. */
  drafts: Array<{ locale: string; missing: number }>;
};

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const ID_CALLS: ReadonlySet<string> = new Set(['t', 'format', 'formatParts']);
const ID_COMPONENTS: ReadonlySet<string> = new Set(['Message', 'FormattedMessage']);

async function codeFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await codeFiles(path)));
    else if (CODE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

/**
 * Any string literal equal to a message id counts as a use, so ids kept in arrays, maps or
 * typed variables are found. Ids passed to a message component or formatter are also checked
 * for existence, and ids assembled from pieces are rejected because they cannot be checked.
 */
async function codeProblems(directory: string, root: string, known: ReadonlySet<string>) {
  const problems: Problem[] = [];
  const used = new Set<string>();
  for (const file of await codeFiles(directory)) {
    const text = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const where = (node: ts.Node) =>
      `${relative(root, file).split(sep).join('/')}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`;
    const checkId = (node: ts.Expression | undefined) => {
      if (!node) return;
      const expression = ts.isJsxExpression(node) ? node.expression : node;
      if (!expression) return;
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        if (!known.has(expression.text))
          problems.push({
            code: 'id_unknown',
            id: expression.text,
            file: where(expression),
            message: `${expression.text} is not a message in the source files`,
          });
      } else if (
        ts.isTemplateExpression(expression) ||
        (ts.isBinaryExpression(expression) &&
          expression.operatorToken.kind === ts.SyntaxKind.PlusToken)
      )
        problems.push({
          code: 'id_dynamic',
          file: where(expression),
          message: 'Message ids must be written whole so they can be checked',
        });
    };
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        if (known.has(node.text)) used.add(node.text);
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : node.expression.getText(source);
        if (ID_CALLS.has(callee)) checkId(node.arguments[0]);
      }
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        ID_COMPONENTS.has(node.tagName.getText(source))
      )
        for (const attribute of node.attributes.properties)
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'id')
            checkId(attribute.initializer);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const id of known)
    if (!used.has(id))
      problems.push({ code: 'id_unused', id, message: `${id} is never used in the code` });
  return problems;
}

export async function check(
  workspace: Workspace,
  options: { code?: string } = {},
): Promise<CheckReport> {
  const { config, root } = workspace;
  const problems: Problem[] = [];
  const documents = await extractSources(workspace);
  let release: Release;
  try {
    release = await loadRelease(join(root, config.release.directory));
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    return {
      release: null,
      drafts: [],
      problems: [
        {
          code: 'release_missing',
          message: `${error.message}. Run everylocale pull and commit the release.`,
        },
      ],
    };
  }
  const { manifest } = release;
  if (manifest.project !== config.project || manifest.sourceLocale !== config.sourceLocale)
    problems.push({
      code: 'release_mismatch',
      message: 'The release belongs to another project or source locale',
    });
  const drafts: CheckReport['drafts'] = [];
  for (const definition of config.registry.slice(1)) {
    const entry = manifest.locales.find((item) => item.id === definition.id);
    if (!entry) {
      problems.push({
        code: 'locale_missing',
        locale: definition.id,
        message: 'Not in the release; run everylocale pull',
      });
      continue;
    }
    const pinned = manifest.plurals[definition.id];
    const running = {
      cardinal: new Intl.PluralRules(definition.id).resolvedOptions().pluralCategories,
      ordinal: new Intl.PluralRules(definition.id, { type: 'ordinal' }).resolvedOptions()
        .pluralCategories,
    };
    if (pinned && JSON.stringify(pinned) !== JSON.stringify(running))
      problems.push({
        code: 'plural_rules_changed',
        locale: definition.id,
        message: `This runtime's CLDR plural rules (${running.cardinal.join(', ')}) differ from the release (${pinned.cardinal.join(', ')})`,
      });
    let missing = 0;
    for (const [source, list] of documents) {
      let catalog;
      try {
        catalog = release.catalog(definition.id, source.namespace);
      } catch {
        problems.push({
          code: 'release_mismatch',
          locale: definition.id,
          message: `The release has no ${source.namespace}; run everylocale pull`,
        });
        continue;
      }
      for (const unit of list) {
        const text = catalog.messages[unit.id];
        const current = catalog.sources[unit.id] === sourceHash(unit);
        if (text === undefined || !current) {
          missing++;
          if (definition.status === 'live')
            problems.push({
              code: text === undefined ? 'translation_missing' : 'translation_stale',
              locale: definition.id,
              id: unit.id,
              message:
                text === undefined
                  ? 'No approved translation'
                  : 'Approved for an earlier version of the source text',
            });
          continue;
        }
        for (const finding of validateTranslation(unit, text, definition.id))
          if (finding.severity === 'critical')
            problems.push({
              code: 'translation_invalid',
              locale: definition.id,
              id: unit.id,
              message: finding.message,
            });
      }
      if (definition.status !== 'live') continue;
      const rendered = workspace
        .extract(source, await workspace.read(source))
        .render(catalog.messages, definition.id);
      let current = '';
      try {
        current = await workspace.read(source, definition.id);
      } catch {
        // A missing file is reported as outdated.
      }
      if (current !== rendered)
        problems.push({
          code: 'file_outdated',
          locale: definition.id,
          file: source.target(definition.id),
          message: 'Differs from the release; run everylocale pull',
        });
    }
    if (definition.status === 'draft') drafts.push({ locale: definition.id, missing });
    else if (entry.status === 'draft')
      problems.push({
        code: 'locale_draft',
        locale: definition.id,
        message: 'Live in the config but pulled as a draft; run everylocale pull',
      });
  }
  if (options.code) {
    const known = new Set(
      [...documents]
        .filter(([source]) => source.kind === 'messages')
        .flatMap(([, list]) => list.map((unit) => unit.id)),
    );
    problems.push(...(await codeProblems(resolve(root, options.code), root, known)));
  }
  return { release: manifest.revision, problems, drafts };
}

export function formatReport(report: CheckReport): string {
  const lines = report.problems.map(
    (problem) =>
      `  ${[problem.locale, problem.file ?? problem.id].filter(Boolean).join(' ')}: ${problem.message} [${problem.code}]`,
  );
  const drafts = report.drafts.map(
    (draft) => `  ${draft.locale} (draft): ${String(draft.missing)} messages not approved yet`,
  );
  return [
    report.problems.length
      ? `${String(report.problems.length)} problems in release ${report.release ?? 'none'}:`
      : `Release ${report.release ?? ''} is complete for every live locale.`,
    ...lines,
    ...drafts,
  ].join('\n');
}
