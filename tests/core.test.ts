import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDocument,
  unitSchema,
  validateTranslation,
  matchLocale,
  resolveLocale,
  languageSuggestion,
  arabicFlag,
  localizePath,
  alternates,
  rewriteHtmlLinks,
} from '../packages/core/src/index.js';

test('approved internal-link rendering preserves Gutenberg markup and escapes localized destinations', () => {
  const source =
    "<!-- wp:paragraph --><p><a class='link' href='/about?x=1&amp;y=2'>About</a><code>href='/about'</code></p><!-- /wp:paragraph -->";
  const rendered = rewriteHtmlLinks(source, (href) =>
    href.startsWith('/about') ? '/de/über?x=1&y=2' : href,
  );
  assert.equal(
    rendered,
    "<!-- wp:paragraph --><p><a class='link' href=\"/de/über?x=1&amp;y=2\">About</a><code>href='/about'</code></p><!-- /wp:paragraph -->",
  );
});

test('country and browser hints never override an explicit English preference', () => {
  assert.equal(
    resolveLocale({ pathname: '/dashboard', privateSurface: true, profile: 'en', cookie: 'fr' }),
    'en',
  );
  assert.equal(
    resolveLocale({ pathname: '/de/pricing', privateSurface: false, profile: 'en' }),
    'de',
  );
  assert.equal(resolveLocale({ pathname: '/', privateSurface: false, cookie: 'fr' }), 'en');
  assert.equal(languageSuggestion(['en-US', 'fr-FR'], 'en'), null);
  assert.equal(languageSuggestion(['fr-FR', 'en'], 'en'), 'fr');
  assert.equal(arabicFlag('MA'), 'ma');
  assert.equal(arabicFlag('AE'), 'ae');
  assert.equal(arabicFlag('TW'), 'sa');
  assert.equal(arabicFlag(null), 'sa');
});
test('Chinese scripts stay distinct and language switching preserves queries and anchors', () => {
  assert.equal(matchLocale('zh-TW'), 'zh-Hant-TW');
  assert.equal(matchLocale('zh-HK'), 'zh-Hant-TW');
  assert.equal(matchLocale('zh-CN'), null);
  assert.equal(matchLocale('zh-Hans'), null);
  assert.equal(
    localizePath('/de/pricing?plan=pro#features', 'fr'),
    '/fr/pricing?plan=pro#features',
  );
  assert.throws(() => localizePath('//elsewhere.test/path', 'de'));
  assert.deepEqual(
    alternates('https://example.test', { en: '/article', de: '/de/article' }).map(
      (x) => x.hreflang,
    ),
    ['en', 'de', 'x-default'],
  );
});
test('JSON and YAML keep types and ICU declarations intact', () => {
  const document = extractDocument(
    '{"greet":"Hello {name}","enabled":true,"price":25}',
    'json',
    'app',
  );
  assert.equal(document.units.length, 1);
  assert.equal(document.units[0]!.kind, 'icu');
  assert.deepEqual(JSON.parse(document.render({ 'app:greet': 'Hallo {name}' }, 'de')), {
    greet: 'Hallo {name}',
    enabled: true,
    price: 25,
  });
  assert.throws(() => document.render({}, 'de'));
  const yaml = extractDocument('title: Hello\ncount: 3\n', 'yaml', 'app');
  assert.match(yaml.render({ 'app:title': 'Bonjour' }, 'fr'), /count: 3/);
});
test('HTML and Gutenberg preserve code, links, comments and escaped attributes', () => {
  const source =
    '<!-- wp:paragraph --><p>Hello <strong>world</strong> <a href="https://example.test">Read</a></p><!-- /wp:paragraph --><img src="/x.png" alt="Our logo"><pre>const x = 1</pre><div translate="no">Brand</div>';
  const document = extractDocument(source, 'html', 'post');
  assert.equal(document.units.length, 4);
  const translations = Object.fromEntries(
    document.units.map((x) => [x.id, x.source === 'Our logo' ? 'Logo "quoted"' : `FR ${x.source}`]),
  );
  const output = document.render(translations, 'fr');
  assert.match(output, /<!-- wp:paragraph -->/);
  assert.match(output, /href="https:\/\/example.test"/);
  assert.match(output, /alt="Logo &quot;quoted&quot;"/);
  assert.match(output, /<pre>const x = 1<\/pre>/);
  assert.match(output, /<div translate="no">Brand<\/div>/);
  assert.throws(() => extractDocument('<img alt=Hello>', 'html'));
});
test('Markdown and executable MDX survive translation without link or code changes', () => {
  const source =
    'import Demo from "./demo";\n\n# Hello **world**\n\nRead [the guide](https://example.test/docs) and `x + 1`.\n\n<Demo value={42} />\n\n```js\nconst x = 1;\n```\n';
  const document = extractDocument(source, 'mdx', 'guide');
  assert.equal(document.units.length, 2);
  const translations = Object.fromEntries(
    document.units.map((x) => [
      x.id,
      x.source
        .replace('Hello', 'Bonjour')
        .replace('world', 'monde')
        .replace('Read', 'Lire')
        .replace('the guide', 'le guide')
        .replace('and', 'et'),
    ]),
  );
  const output = document.render(translations, 'fr');
  assert.match(output, /# Bonjour \*\*monde\*\*/);
  assert.match(output, /\[le guide\]\(https:\/\/example.test\/docs\)/);
  assert.match(output, /import Demo/);
  assert.match(output, /<Demo value=\{42\} \/>/);
  assert.match(output, /const x = 1;/);
  const broken = { ...translations, [document.units[0]!.id]: 'Bonjour' };
  assert.throws(() => document.render(broken, 'fr'));
});
test('ICU validation protects variables and requires all Arabic plural categories', () => {
  const source = unitSchema.parse({
    id: 'count',
    source: '{count, plural, one {# item} other {# items}}',
    kind: 'icu',
  });
  assert.ok(
    validateTranslation(source, '{count, plural, one {# عنصر} other {# عناصر}}', 'ar').some(
      (x) => x.code === 'plural_branch',
    ),
  );
  const correct =
    '{count, plural, zero {لا عناصر} one {عنصر} two {عنصران} few {# عناصر} many {# عنصرا} other {# عنصر}}';
  assert.deepEqual(validateTranslation(source, correct, 'ar'), []);
  assert.ok(
    validateTranslation(source, correct.replaceAll('count', 'n'), 'ar').some(
      (x) => x.code === 'icu_structure',
    ),
  );
  const simple = unitSchema.parse({
    id: 'fact',
    source: 'Pay 25 USD at https://example.test. Brand',
    protectedTerms: ['Brand'],
  });
  assert.ok(
    validateTranslation(simple, 'Pay 30 USD at https://example.test. Brand', 'de').some(
      (x) => x.code === 'protected_value',
    ),
  );
});
test('Traditional Chinese checks surface script problems', () => {
  const source = unitSchema.parse({ id: 'save', source: 'Save settings' });
  assert.ok(
    validateTranslation(source, '保存设置', 'zh-Hant-TW').some(
      (x) => x.code === 'chinese_script' && x.severity === 'critical',
    ),
  );
  assert.deepEqual(validateTranslation(source, '儲存設定', 'zh-Hant-TW'), []);
  const variants = validateTranslation(source, '設定已儲存。核准後在平台發布。', 'zh-Hant-TW');
  assert.ok(variants.every((finding) => finding.severity === 'minor'));
  assert.ok(
    validateTranslation(source, '設定', 'zh-Hant-TW').every(
      (finding) => finding.severity !== 'critical',
    ),
  );
  const protectedSource = { ...source, source: 'Keep 设置 unchanged', protectedTerms: ['设置'] };
  assert.ok(
    validateTranslation(protectedSource, '保留 设置 不變', 'zh-Hant-TW').every(
      (finding) => finding.code !== 'chinese_script',
    ),
  );
});
test('PO catalogs render target plural forms without deleting metadata', () => {
  const source =
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\n#. A button\nmsgid "Save"\nmsgstr ""\n\nmsgid "%d item"\nmsgid_plural "%d items"\nmsgstr[0] ""\nmsgstr[1] ""\n';
  const document = extractDocument(source, 'po', 'messages');
  assert.equal(document.units.length, 2);
  const translations = {
    [document.units[0]!.id]: '儲存',
    [document.units[1]!.id]: '{__el_count, plural, other {%d 個項目}}',
  };
  const output = document.render(translations, 'zh-Hant-TW');
  assert.match(output, /nplurals=1/);
  assert.match(output, /%d 個項目/);
  assert.match(output, /#\. A button/);
});
