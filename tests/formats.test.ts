import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDocument,
  formatIds,
  registerFormat,
  validateTranslation,
  unitSchema,
  languageDescription,
  localeTraits,
} from '../packages/core/dist/index.js';

test('Markdown front matter translates listed keys only and keeps every other key exact', () => {
  const source =
    '---\r\ntitle: Privacy policy\r\ndescription: |\r\n  How we handle\r\n  your data\r\nslug: privacy\r\norder: 3\r\n---\r\n\r\n# Privacy\r\n\r\nWe keep your data safe.\r\n';
  const document = extractDocument(source, 'markdown', 'legal');
  const ids = document.units.map((unit) => unit.id);
  assert.ok(ids.includes('legal:front-matter/title'));
  assert.ok(ids.includes('legal:front-matter/description'));
  assert.ok(!document.units.some((unit) => unit.source.includes('slug')));
  // Protected tokens such as the heading marker stay in place; only the words change.
  const translations = Object.fromEntries(
    document.units.map((unit) => [
      unit.id,
      unit.source.replace(/(?<=^|\]\])[^[\]]+$/, (words) => `ES "${words.trim()}"`),
    ]),
  );
  const rendered = document.render(translations, 'es');
  assert.match(rendered, /^---\r\ntitle: "ES \\"Privacy policy\\""\r\n/);
  assert.match(
    rendered,
    /description: "ES \\"How we handle\\nyour data\\""\r\nslug: privacy\r\norder: 3\r\n---/,
  );
  assert.match(rendered, /# ES "Privacy"/);
});

test('front matter keys are configurable and translations cannot add structure', () => {
  const source = '---\nheading: Setup\ntitle: Kept\n---\n\nText.\n';
  const document = extractDocument(source, 'mdx', 'docs', { frontMatter: ['heading'] });
  assert.deepEqual(
    document.units.map((unit) => unit.id).filter((id) => id.includes('front-matter')),
    ['docs:front-matter/heading'],
  );
  const body = document.units.find((unit) => unit.source === 'Text.');
  assert.ok(body);
  assert.match(
    document.render({ 'docs:front-matter/heading': 'Einrichtung', [body.id]: 'Text.' }, 'de'),
    /heading: "Einrichtung"\ntitle: Kept/,
  );
  assert.throws(
    () =>
      document.render(
        { 'docs:front-matter/heading': 'Einrichtung', [body.id]: 'Text.\n\n## Added' },
        'de',
      ),
    /structure/,
  );
});

test('document segment ids follow content, so an inserted paragraph leaves the others unchanged', () => {
  const ids = (content: string, format: string, namespace: string) =>
    extractDocument(content, format, namespace).units.map((unit) => unit.id);
  const before = ids('First.\n\nSecond.\n\nSecond.\n', 'markdown', 'help');
  const after = ids('New intro.\n\nFirst.\n\nSecond.\n\nSecond.\n', 'markdown', 'help');
  assert.equal(new Set(before).size, 3);
  assert.deepEqual(after.slice(1), before);
  assert.match(before[2] ?? '', /-2$/);
  const html = ids('<p>One</p><p>Two</p>', 'html', 'page');
  const moved = ids('<p>Zero</p><p>One</p><p>Two</p>', 'html', 'page');
  assert.deepEqual(moved.slice(1), html);
});

test('protected markup containing replacement patterns is restored verbatim', () => {
  const source = "<p>Pay <code>$&amp; $' $1</code> now.</p>";
  const document = extractDocument(source, 'html', 'pay');
  const unit = document.units[0];
  assert.ok(unit);
  assert.equal(
    document.render({ [unit.id]: unit.source.replace('Pay', 'Zahle') }, 'de'),
    "<p>Zahle <code>$&amp; $' $1</code> now.</p>",
  );
});

test('formats come from one registry, reject duplicates and unknown ids, and accept plugins', () => {
  assert.deepEqual(formatIds().sort(), ['html', 'json', 'markdown', 'mdx', 'po', 'yaml']);
  assert.throws(() => extractDocument('x', 'xliff'), /Unsupported document format/);
  assert.throws(
    () =>
      registerFormat({
        id: 'json',
        extract: () => {
          throw new Error('unused');
        },
      }),
    /already/,
  );
  const lines = (content: string) => content.split('\n').filter(Boolean);
  registerFormat({
    id: 'lines',
    extract: (content, { namespace }) => ({
      format: 'lines',
      content,
      units: lines(content).map((line, index) =>
        unitSchema.parse({ id: `${namespace}:${String(index)}`, source: line }),
      ),
      render: (translations) =>
        lines(content)
          .map((_, index) => translations[`${namespace}:${String(index)}`] ?? '')
          .join('\n'),
    }),
  });
  assert.equal(
    extractDocument('a\nb', 'lines', 'l').render({ 'l:0': 'A', 'l:1': 'B' }, 'fr'),
    'A\nB',
  );
});

test('Traditional Chinese checks apply to every Traditional locale id, not only zh-Hant', () => {
  const unit = unitSchema.parse({ id: 'x', source: 'Settings' });
  for (const locale of ['zh-TW', 'zh-Hant-TW', 'zh-HK', 'zh-Hant', 'zh-MO'])
    assert.deepEqual(
      validateTranslation(unit, '设置', locale).map((finding) => finding.code),
      ['chinese_script'],
      locale,
    );
  for (const locale of ['zh-CN', 'zh-Hans-SG', 'ja'])
    assert.deepEqual(validateTranslation(unit, '设置', locale), [], locale);
});

test('locale traits and model descriptions derive from CLDR data for any language', () => {
  assert.equal(localeTraits('ar-EG').direction, 'rtl');
  assert.equal(localeTraits('ur').direction, 'rtl');
  assert.equal(localeTraits('fr-CA').direction, 'ltr');
  assert.equal(localeTraits('zh-TW').script, 'Hant');
  assert.equal(languageDescription('zh-TW'), 'Chinese (Traditional, Taiwan)');
  assert.equal(languageDescription('fr-CA'), 'Canadian French');
  assert.equal(languageDescription('es'), 'Spanish');
  assert.equal(languageDescription('sr-Latn'), 'Serbian (Latin)');
});
