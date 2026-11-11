import { z } from 'zod';
import { canonicalLocale, defineLocales, type LocaleDefinition } from './locales.js';
import { isFormat } from './formats/index.js';

/** The config file an app commits next to its source catalogs. */
export const CONFIG_FILE = 'everylocale.config.json';
export const CONFIG_VERSION = 1;
/** Matches the service's project ids. */
export const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const NAMESPACE = /^[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)*$/i;

const localeId = z
  .string()
  .min(2)
  .max(40)
  .refine((value) => canonicalLocale(value) !== null, 'Use a BCP 47 locale id such as fr-CA');

const localeSchema = z
  .object({
    id: localeId,
    status: z
      .enum(['live', 'draft'])
      .default('live')
      .describe('Live locales must be complete; draft locales may be incomplete.'),
    label: z.string().min(1).max(80).optional().describe('Defaults to the CLDR native name.'),
    prefix: z
      .string()
      .max(40)
      .optional()
      .describe('URL segment. Defaults to the lower-cased id; the source locale has none.'),
    direction: z.enum(['ltr', 'rtl']).optional().describe('Defaults to the script direction.'),
  })
  .strict();

const fileSchema = z
  .object({
    pattern: z
      .string()
      .min(1)
      .describe(
        'Path relative to the config file. {locale} is required; {namespace} matches one or more path segments.',
      ),
    format: z.string().refine(isFormat, 'Unknown document format'),
    namespace: z
      .string()
      .regex(NAMESPACE)
      .optional()
      .describe('Namespace for a pattern without {namespace}, or a prefix for one with it.'),
    frontMatter: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Markdown and MDX front matter keys to translate. Defaults to title and description.',
      ),
  })
  .strict()
  .superRefine((file, context) => {
    const count = (token: string) => file.pattern.split(token).length - 1;
    if (count('{locale}') !== 1)
      context.addIssue({ code: 'custom', message: 'A pattern contains {locale} exactly once' });
    if (count('{namespace}') > 1)
      context.addIssue({ code: 'custom', message: 'A pattern contains {namespace} at most once' });
    if (!count('{namespace}') && !file.namespace)
      context.addIssue({
        code: 'custom',
        message: 'A pattern without {namespace} needs namespace',
      });
    if (file.pattern.startsWith('/') || file.pattern.split('/').includes('..'))
      context.addIssue({ code: 'custom', message: 'Patterns stay inside the config directory' });
  });

export const appConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(CONFIG_VERSION),
    project: z.string().regex(PROJECT_ID).describe('Project id on the EveryLocale service.'),
    sourceLocale: localeId.describe('The language the source files are written in.'),
    locales: z.array(localeSchema).min(1).describe('Target locales, in display order.'),
    files: z.array(fileSchema).default([]),
    release: z
      .object({
        directory: z
          .string()
          .min(1)
          .default('.everylocale')
          .describe('Where pull writes verified releases.'),
      })
      .strict()
      .default({ directory: '.everylocale' }),
  })
  .strict();

export type AppConfigInput = z.input<typeof appConfigSchema>;
export type AppConfig = z.output<typeof appConfigSchema> & {
  /** The source locale followed by every target, with derived labels and directions. */
  registry: readonly LocaleDefinition[];
};

export class ConfigError extends Error {}

/** Validates a parsed config file and derives the locale registry from it. */
export function parseAppConfig(input: unknown): AppConfig {
  const parsed = appConfigSchema.safeParse(input);
  if (!parsed.success)
    throw new ConfigError(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
        .join('\n'),
    );
  const config = parsed.data;
  try {
    return { ...config, registry: defineLocales(config.sourceLocale, config.locales) };
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : 'Invalid locales');
  }
}

/** JSON Schema for editors and other languages' tooling, generated from the same definition. */
export const appConfigJsonSchema = () =>
  z.toJSONSchema(appConfigSchema, { io: 'input', target: 'draft-2020-12' });
