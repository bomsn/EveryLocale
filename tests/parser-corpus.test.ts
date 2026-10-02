import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocument, validateTranslation, unitSchema } from '../packages/core/dist/index.js';
import { createRequire } from 'node:module';
const { IntlMessageFormat } = createRequire(
  new URL('../packages/core/package.json', import.meta.url),
)('intl-messageformat');

test('nested selectors, exact numbers, rich tags and Arabic plural branches survive rendering', () => {
  const source =
    '{role, select, owner {<strong>{name}</strong>: {count, plural, =0 {No projects} one {# project} other {# projects}}} other {Contact {name}}}';
  const translated =
    '{role, select, owner {<strong>{name}</strong>: {count, plural, =0 {لا مشاريع} zero {لا مشاريع} one {مشروع واحد} two {مشروعان} few {# مشاريع} many {# مشروعًا} other {# مشروع}}} other {اتصل بـ {name}}}';
  const unit = unitSchema.parse({ id: 'projects', kind: 'icu', source });
  assert.deepEqual(validateTranslation(unit, translated, 'ar'), []);
  const formatter = new IntlMessageFormat(translated, 'ar');
  for (const count of [0, 1, 2, 3, 11, 100]) {
    const text = formatter.format({
      role: 'owner',
      name: 'Ali',
      count,
      strong: (chunks: any) => chunks.join(''),
    });
    assert.match(String(text), /Ali/);
    assert.doesNotMatch(String(text), /projects/);
  }
  assert.ok(
    validateTranslation(unit, translated.replace('=0', ' =1'), 'ar').some(
      (f) => f.severity === 'critical',
    ),
  );
});

test('Gutenberg nested blocks preserve comments, protected code, attributes and mixed-direction identifiers', () => {
  const source =
    '<!-- wp:group {"layout":{"type":"constrained"}} --><div class="wp-block-group"><!-- wp:paragraph --><p>Read <a href="/guide?q=1&amp;x=2"><strong>the guide</strong></a> for <code>API_KEY</code> and <bdi dir="ltr">AB-123</bdi>.</p><!-- /wp:paragraph --><img src="/image.jpg" alt="Team photo" title="Our team"><input aria-label="Your email" placeholder="Enter email"><p translate="no">Immutable brand</p><svg><text>Untouched SVG</text></svg></div><!-- /wp:group -->';
  const doc = extractDocument(source, 'html', 'article', { groupInline: true });
  const messages = Object.fromEntries(
    doc.units.map((u) => [
      u.id,
      u.source
        .replace('Read', 'اقرأ')
        .replace('the guide', 'الدليل')
        .replace('for', 'لـ')
        .replace('and', 'و')
        .replace('Team photo', 'صورة الفريق')
        .replace('Our team', 'فريقنا')
        .replace('Your email', 'بريدك الإلكتروني')
        .replace('Enter email', 'أدخل البريد الإلكتروني'),
    ]),
  );
  const out = doc.render(messages, 'ar');
  for (const protectedText of [
    '<!-- wp:group {"layout":{"type":"constrained"}} -->',
    'href="/guide?q=1&amp;x=2"',
    '<code>API_KEY</code>',
    '<bdi dir="ltr">AB-123</bdi>',
    '<p translate="no">Immutable brand</p>',
    '<svg><text>Untouched SVG</text></svg>',
  ])
    assert.ok(out.includes(protectedText), protectedText);
  const grouped = doc.units.find((u) => u.source.includes('[[EL:'))!;
  assert.ok(grouped);
  assert.throws(
    () =>
      doc.render(
        { ...messages, [grouped.id]: messages[grouped.id]!.replace(/\[\[EL:[^\]]+\]\]/, '') },
        'ar',
      ),
    /Markup token/,
  );
});

test('MDX components, JSX attributes, expressions, fenced samples and reference links retain executable structure', () => {
  const source =
    'import {Notice} from "./components.js";\n\n# Setup\n\n<Notice title="Developer-owned attribute" count={2}>\n\nRead **the guide** and [API documentation][api] before using `process.env.KEY`.\n\n</Notice>\n\nCurrent version: {version}\n\n```tsx\nexport const x = <Button onClick={() => run()}>Code</Button>;\n```\n\n[api]: https://example.test/api "API"\n';
  const doc = extractDocument(source, 'mdx', 'docs');
  const messages = Object.fromEntries(
    doc.units.map((u) => [
      u.id,
      u.source
        .replace('Setup', 'Einrichtung')
        .replace('Read', 'Lesen Sie')
        .replace('the guide', 'die Anleitung')
        .replace('API documentation', 'API-Dokumentation')
        .replace('before using', 'vor der Verwendung von')
        .replace('and', 'und')
        .replace('Current version', 'Aktuelle Version'),
    ]),
  );
  const out = doc.render(messages, 'de');
  for (const value of [
    'title="Developer-owned attribute"',
    'count={2}',
    '{version}',
    'process.env.KEY',
    '[api]: https://example.test/api "API"',
    'export const x = <Button onClick={() => run()}>Code</Button>;',
  ])
    assert.ok(out.includes(value));
  assert.throws(
    () =>
      doc.render(
        { ...messages, [doc.units[0]!.id]: messages[doc.units[0]!.id] + '{executeUntrusted()}' },
        'de',
      ),
    /structure/,
  );
});

test('PO contexts stay distinct and Arabic export includes all six gettext forms', () => {
  const source =
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgctxt "navigation"\nmsgid "Open"\nmsgstr ""\n\nmsgctxt "status"\nmsgid "Open"\nmsgstr ""\n\nmsgid "%d project"\nmsgid_plural "%d projects"\nmsgstr[0] ""\nmsgstr[1] ""\n';
  const doc = extractDocument(source, 'po', 'app');
  assert.equal(new Set(doc.units.map((u) => u.id)).size, 3);
  const messages = Object.fromEntries(
    doc.units.map((u) => [
      u.id,
      u.kind === 'icu'
        ? '{__el_count, plural, zero {%d مشروع} one {%d مشروع} two {%d مشروعان} few {%d مشاريع} many {%d مشروعًا} other {%d مشروع}}'
        : u.context === 'navigation'
          ? 'افتح'
          : 'مفتوح',
    ]),
  );
  const out = doc.render(messages, 'ar');
  assert.match(out, /nplurals=6/);
  assert.match(out, /msgstr\[5\]/);
  assert.match(out, /افتح/);
  assert.match(out, /مفتوح/);
});
