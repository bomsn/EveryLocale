import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAppConfig, defineLocales, ConfigError } from '../packages/core/dist/index.js';
import { CONFIG_SCHEMA_PATH, configSchemaText } from '../tools/config-schema.js';

const valid = {
  version: 1,
  project: 'storefront',
  sourceLocale: 'en',
  locales: [{ id: 'es' }, { id: 'fr-ca', status: 'draft' }, { id: 'zh-TW' }, { id: 'ar' }],
  files: [
    { pattern: 'locales/{locale}/{namespace}.json', format: 'json' },
    { pattern: 'content/{locale}/{namespace}.mdx', format: 'mdx', namespace: 'content' },
  ],
};

test('the config derives a canonical registry with native labels, prefixes and directions', () => {
  const config = parseAppConfig(valid);
  assert.deepEqual(
    config.registry.map((item) => [item.id, item.status, item.prefix, item.direction, item.label]),
    [
      ['en', 'live', '', 'ltr', 'English'],
      ['es', 'live', 'es', 'ltr', 'Español'],
      ['fr-CA', 'draft', 'fr-ca', 'ltr', 'Français canadien'],
      ['zh-TW', 'live', 'zh-tw', 'ltr', '中文（台灣）'],
      ['ar', 'live', 'ar', 'rtl', 'العربية'],
    ],
  );
  assert.equal(config.release.directory, '.everylocale');
});

test('invalid configs fail with every problem and its location', () => {
  const failure = (input: unknown) => {
    try {
      parseAppConfig(input);
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      return error.message;
    }
    assert.fail('expected a configuration error');
  };
  const message = failure({
    ...valid,
    locales: [{ id: 'not a locale' }],
    files: [
      { pattern: 'locales/messages.json', format: 'json' },
      { pattern: '../{locale}/{namespace}.xliff', format: 'xliff' },
    ],
  });
  assert.match(message, /locales\.0\.id: Use a BCP 47 locale id/);
  assert.match(message, /files\.0: A pattern contains \{locale\} exactly once/);
  assert.match(message, /files\.0: A pattern without \{namespace\} needs namespace/);
  assert.match(message, /files\.1\.format: Unknown document format/);
  assert.match(message, /files\.1: Patterns stay inside the config directory/);
  assert.match(failure({ ...valid, locales: [{ id: 'es' }, { id: 'ES' }] }), /unique/);
  assert.match(failure({ ...valid, extra: true }), /Unrecognized key/);
});

test('locale definitions reject duplicate prefixes and keep explicit overrides', () => {
  assert.throws(
    () =>
      defineLocales('en', [
        { id: 'pt-BR', prefix: 'pt' },
        { id: 'pt-PT', prefix: 'pt' },
      ]),
    /prefixes/,
  );
  const [, brazil] = defineLocales('en', [{ id: 'pt-BR', prefix: 'br', label: 'Português' }]);
  assert.deepEqual(brazil, {
    id: 'pt-BR',
    status: 'live',
    label: 'Português',
    prefix: 'br',
    direction: 'ltr',
  });
});

test('the committed JSON Schema matches the config definition', async () => {
  assert.equal(
    await readFile(CONFIG_SCHEMA_PATH, 'utf8'),
    configSchemaText(),
    'Run pnpm codegen and commit the schema',
  );
});
