import { createHash } from 'node:crypto';
import type { Project, SourceUnit } from './types.js';
export const PIPELINE_REVISION = '6';
export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** The source revision an approval binds to. Policy tags are excluded so relabeling never invalidates work. */
export function sourceHash(unit: SourceUnit): string {
  const { tags, ...revision } = unit;
  return hash(revision);
}
export function contextHash(project: Project, unit: SourceUnit, locale: string): string {
  return hash({
    source: sourceHash(unit),
    locale,
    glossary: project.glossary,
    instructions: project.instructions[locale] ?? '',
    pipeline: PIPELINE_REVISION,
  });
}
