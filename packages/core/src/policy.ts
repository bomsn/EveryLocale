import type { Policy, Project, SourceUnit } from './types.js';

const globCache = new Map<string, RegExp>();
/** `**` matches any characters, `*` any characters except `/`; everything else is literal. */
export function globToRegExp(pattern: string): RegExp {
  let cached = globCache.get(pattern);
  if (!cached) {
    const source = pattern
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*');
    cached = new RegExp(`^${source}$`);
    globCache.set(pattern, cached);
  }
  return cached;
}
export const matchesGlob = (value: string, pattern: string) => globToRegExp(pattern).test(value);

/** Unit ids are `namespace:key`; an id without a colon is a key in the empty namespace. */
export function splitUnitId(id: string): { namespace: string; key: string } {
  const at = id.indexOf(':');
  return at < 0
    ? { namespace: '', key: id }
    : { namespace: id.slice(0, at), key: id.slice(at + 1) };
}

/** The first policy whose every condition matches; the schema guarantees a catch-all last policy. */
export function policyFor(
  project: Pick<Project, 'policies'>,
  unit: Pick<SourceUnit, 'id' | 'tags'>,
): Policy {
  const { namespace, key } = splitUnitId(unit.id);
  const policy = project.policies.find(
    ({ match }) =>
      (match.namespace === undefined || matchesGlob(namespace, match.namespace)) &&
      (match.key === undefined || matchesGlob(key, match.key)) &&
      (match.tag === undefined || unit.tags.includes(match.tag)),
  );
  if (!policy) throw new Error('Project policies have no catch-all rule');
  return policy;
}

export const isLocked = (project: Pick<Project, 'locked'>, unitId: string) =>
  project.locked.some((pattern) => matchesGlob(unitId, pattern));
