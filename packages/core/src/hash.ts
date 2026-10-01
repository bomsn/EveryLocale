import { createHash } from 'node:crypto';
import type { Project, SourceUnit } from './types.js';
export const PIPELINE_REVISION = '3';
export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function sourceHash(unit: SourceUnit): string {
  return hash(unit);
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
