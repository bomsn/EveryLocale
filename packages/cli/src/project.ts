import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CONFIG_FILE,
  extractDocument,
  formatKind,
  parseAppConfig,
  registerFormat,
  unknownFormats,
  type AppConfig,
  type DocumentFormat,
  type ExtractedDocument,
} from '@everylocale/core';

/** One source file matched by a config pattern, with everything needed to work with it. */
export type SourceFile = {
  /** Path relative to the config directory, with forward slashes. */
  path: string;
  format: string;
  kind: DocumentFormat['kind'];
  namespace: string;
  frontMatter: readonly string[] | undefined;
  tags: readonly string[];
  /** Where this file's translation lives for a locale, relative to the config directory. */
  target(locale: string): string;
};

export type Workspace = {
  config: AppConfig;
  /** Directory that holds the config file; every configured path is relative to it. */
  root: string;
  sources: SourceFile[];
  read(file: SourceFile, locale?: string): Promise<string>;
  extract(file: SourceFile, content: string): ExtractedDocument;
};

const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', 'build']);
const posix = (path: string) => path.split(sep).join('/');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function walk(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

/** Finds the config file, loads format plugins, and lists every source file it matches. */
export async function openWorkspace(configPath?: string): Promise<Workspace> {
  const file = resolve(configPath ?? CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(`No ${CONFIG_FILE} found at ${file}. Create one or pass --config.`);
  }
  const config = parseAppConfig(JSON.parse(text));
  const root = dirname(file);
  for (const specifier of config.formats) {
    const target = specifier.startsWith('.')
      ? pathToFileURL(resolve(root, specifier)).href
      : specifier;
    const module = (await import(target)) as { default?: DocumentFormat };
    if (!module.default) throw new Error(`Format plugin ${specifier} has no default export`);
    registerFormat(module.default);
  }
  const problems = unknownFormats(config);
  if (problems.length) throw new Error(problems.join('\n'));
  const sources: SourceFile[] = [];
  for (const pattern of config.files) {
    const sourcePattern = pattern.pattern.replace('{locale}', config.sourceLocale);
    const placeholder = sourcePattern.indexOf('{namespace}');
    const prefix = placeholder < 0 ? sourcePattern : sourcePattern.slice(0, placeholder);
    const base = join(root, prefix.slice(0, prefix.lastIndexOf('/') + 1));
    const matcher = new RegExp(`^${sourcePattern.split('{namespace}').map(escape).join('(.+)')}$`);
    for (const absolute of await walk(base)) {
      const path = posix(relative(root, absolute));
      const match = matcher.exec(path);
      if (!match) continue;
      const matched = match[1];
      const namespace = [pattern.namespace, matched].filter(Boolean).join('/');
      sources.push({
        path,
        format: pattern.format,
        kind: formatKind(pattern.format),
        namespace,
        frontMatter: pattern.frontMatter,
        tags: pattern.tags ?? [],
        target: (locale) =>
          pattern.pattern.replace('{locale}', locale).replace('{namespace}', matched ?? ''),
      });
    }
  }
  const namespaces = new Map<string, string>();
  for (const source of sources) {
    const other = namespaces.get(source.namespace);
    if (other)
      throw new Error(
        `${source.path} and ${other} share namespace ${source.namespace}; give one a namespace prefix`,
      );
    namespaces.set(source.namespace, source.path);
  }
  return {
    config,
    root,
    sources: sources.sort((a, b) => a.namespace.localeCompare(b.namespace)),
    read: (source, locale) =>
      readFile(join(root, locale ? source.target(locale) : source.path), 'utf8'),
    extract(source, content) {
      const document = extractDocument(content, source.format, source.namespace, {
        ...(source.frontMatter ? { frontMatter: source.frontMatter } : {}),
      });
      return {
        ...document,
        units: document.units.map((unit) => ({
          ...unit,
          sourceLocale: config.sourceLocale,
          tags: [...source.tags],
        })),
      };
    },
  };
}
