import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  extractDocument,
  projectSchema,
  unitSchema,
  modelCall,
  ProviderError,
  documentPreview,
} from '../packages/core/dist/index.js';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';

test('MDX translations cannot introduce executable expressions, JSX, or new links', () => {
  const document = extractDocument('Hello **friend** and {name}.', 'mdx', 'page');
  const unit = document.units[0]!;
  assert.match(
    document.render({ [unit.id]: unit.source.replace('Hello', 'Bienvenue') }, 'fr'),
    /Bienvenue/,
  );
  for (const extra of [' {evil()}', ' <script>alert(1)</script>', ' [click](https://evil.test)'])
    assert.throws(() => document.render({ [unit.id]: unit.source + extra }, 'fr'));
});
test('sentence-level HTML extraction keeps inline markup and rejects reordered structural tokens', () => {
  const document = extractDocument(
    '<p>Hello <strong>friend</strong>, welcome.</p>',
    'html',
    'page',
    { groupInline: true },
  );
  assert.equal(document.units.length, 1);
  const unit = document.units[0]!;
  assert.equal(
    document.render(
      {
        [unit.id]: unit.source
          .replace('Hello', 'Bonjour')
          .replace('friend', 'ami')
          .replace('welcome', 'bienvenue'),
      },
      'fr',
    ),
    '<p>Bonjour <strong>ami</strong>, bienvenue.</p>',
  );
  const tokens = unit.source.match(/\[\[EL:[^\]]+\]\]/g)!;
  assert.throws(() =>
    document.render(
      {
        [unit.id]: unit.source
          .replace(tokens[0]!, 'TEMP')
          .replace(tokens[1]!, tokens[0]!)
          .replace('TEMP', tokens[1]!),
      },
      'fr',
    ),
  );
});

test('Arabic and Chinese can omit English articles around inline tags without changing protected markup', () => {
  const source =
    '<!-- wp:paragraph --><p>A <strong>project</strong> groups text. The <a href="/guide/">guide</a> explains it.</p><code>const id = 1;</code><!-- /wp:paragraph -->';
  const document = extractDocument(source, 'html', 'articles', { groupInline: true });
  const unit = document.units[0]!;
  const tokens = unit.source.match(/\[\[EL:[^\]]+\]\]/g)!;
  assert.equal(tokens.length, 4);
  for (const [locale, translation, expected] of [
    [
      'ar',
      `${tokens[0]}المشروع${tokens[1]} يجمع النص. ${tokens[2]}الدليل${tokens[3]} يشرح ذلك.`,
      '<strong>المشروع</strong>',
    ],
    [
      'zh-Hant-TW',
      `${tokens[0]}專案${tokens[1]}整理文字。${tokens[2]}指南${tokens[3]}提供說明。`,
      '<strong>專案</strong>',
    ],
  ]) {
    const rendered = document.render({ [unit.id]: translation! }, locale!);
    assert.ok(rendered.includes(expected!));
    assert.ok(rendered.includes('href="/guide/"'));
    assert.ok(rendered.includes('<code>const id = 1;</code>'));
    assert.ok(rendered.startsWith('<!-- wp:paragraph -->'));
    assert.ok(rendered.endsWith('<!-- /wp:paragraph -->'));
  }
  assert.throws(
    () =>
      document.render(
        { [unit.id]: `${tokens[0]}project${tokens[2]}guide${tokens[1]}end${tokens[3]}` },
        'en',
      ),
    /structure/,
  );
});

test('whole protected code values can change sentence order without changing their contents', () => {
  const document = extractDocument(
    '<p>Sign in with <code>ADMIN_TOKEN</code> from <code>.env</code>.</p>',
    'html',
    'login',
    { groupInline: true },
  );
  const unit = document.units[0]!;
  const tokens = unit.source.match(/\[\[EL:[^\]]+\]\]/g)!;
  assert.equal(
    document.render({ [unit.id]: `使用來自 ${tokens[1]} 的 ${tokens[0]} 登入。` }, 'zh-Hant-TW'),
    '<p>使用來自 <code>.env</code> 的 <code>ADMIN_TOKEN</code> 登入。</p>',
  );
});

test('single-quoted HTML attributes safely preserve apostrophes in translations', () => {
  const document = extractDocument("<img src='/photo.png' alt='A portrait'>", 'html', 'photo');
  assert.equal(
    document.render({ [document.units[0]!.id]: "Le portrait d'Ali" }, 'fr'),
    "<img src='/photo.png' alt='Le portrait d&#39;Ali'>",
  );
});

test('private document previews show reviewed context without allowing publication or executable/networking markup', () => {
  const store = new SqliteStore(':memory:');
  try {
    store.saveProject(
      projectSchema.parse({ id: 'preview', name: 'Preview', targetLocales: ['fr'], budgetUsd: 1 }),
    );
    const imported = store.importDocument(
      'preview',
      'article',
      'markdown',
      '# Hello\n\nRead [the guide](https://example.test).',
    );
    store.enqueue('preview', imported.units, ['fr'], 'preview');
    const claim = store.claim(() => 0)!;
    store.complete(
      claim.record.id,
      claim.leaseToken,
      claim.record.source.source.replace('Hello', 'Bonjour'),
      [],
      '',
    );
    const preview = store.previewDocument('preview', 'article', 'fr');
    assert.match(preview.translation, /# Bonjour/);
    assert.equal(preview.pendingUnits.length, 1);
    assert.throws(() => store.exportDocument('preview', 'article', 'fr'));
    const html = documentPreview(
      '<p onclick="evil()">Hello <a href="https://evil.test">friend</a><img src="https://evil.test/pixel" alt="Portrait"></p><script>evil()</script><iframe srcdoc="evil()"></iframe>',
      'html',
    );
    assert.match(html, /Hello <a>friend<\/a>/);
    assert.match(html, /Image: Portrait/);
    assert.doesNotMatch(html, /evil|onclick|href|src|script|iframe/);
    assert.equal(
      documentPreview('# Heading\n\n**Emphasis**', 'markdown'),
      '<h1>Heading</h1>\n<p><strong>Emphasis</strong></p>',
    );
    assert.doesNotMatch(
      documentPreview('import X from "./x.js"\n\nHello <X/> {evil()}', 'mdx'),
      /<script|<X|onclick|href=/,
    );
  } finally {
    store.close();
  }
});
test('returning to an earlier source reuses its translation but requires a new approval', () => {
  const store = new SqliteStore(':memory:');
  try {
    store.saveProject(
      projectSchema.parse({ id: 'p', name: 'Project', targetLocales: ['de'], budgetUsd: 1 }),
    );
    const original = unitSchema.parse({ id: 'greet', source: 'Hello' });
    store.importSources('p', [original]);
    const job = store.enqueue('p', ['greet'], ['de'], 'first')[0]!;
    const claim = store.claim(() => 0)!;
    store.complete(job.id, claim.leaseToken, 'Hallo', [], '');
    store.approve('p', job.id, 1, 'owner');
    store.importSources('p', [{ ...original, source: 'Goodbye' }]);
    store.importSources('p', [original]);
    const reused = store.enqueue('p', ['greet'], ['de'], 'return')[0]!;
    assert.equal(reused.id, job.id);
    assert.equal(reused.translation, 'Hallo');
    assert.equal(reused.status, 'review');
    assert.equal(reused.revision, 2);
    assert.throws(() => store.approve('p', job.id, 1, 'owner'));
    store.approve('p', job.id, 2, 'owner');
  } finally {
    store.close();
  }
});
test('revoking a project token invalidates its existing browser session', async () => {
  const store = new SqliteStore(':memory:');
  store.saveProject(
    projectSchema.parse({ id: 'p', name: 'Project', targetLocales: ['de'], budgetUsd: 1 }),
  );
  const token = store.mintToken('p', ['read', 'review'], Date.now() + 60000);
  const app = await createApp(store, {
    adminToken: 'test-owner-token-more-than-32-characters',
    sessionSecret: 'independent-test-session-secret-long-enough',
    publicOrigin: 'http://localhost:4310',
    secureCookie: false,
    providersReady: false,
  });
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/session',
      headers: { origin: 'http://localhost:4310' },
      payload: { token: token.token },
    });
    assert.equal(login.statusCode, 200);
    const session = login.cookies[0]!,
      headers = { cookie: `${session.name}=${session.value}` };
    assert.equal((await app.inject({ url: '/api/v1/session', headers })).statusCode, 200);
    store.revokeToken('p', token.id, 'owner');
    assert.equal((await app.inject({ url: '/api/v1/session', headers })).statusCode, 401);
  } finally {
    await app.close();
    store.close();
  }
});
test('provider response limits stop streaming input before an unbounded body is buffered', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end('x'.repeat(1000001));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      modelCall(
        {
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
          model: 'test',
          inputPrice: 0,
          outputPrice: 0,
        },
        'test',
        {},
      ),
      (error) =>
        error instanceof ProviderError &&
        error.message.includes('size limit') &&
        error.uncertainCost,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('moving unchanged content reuses independently reviewed wording without automatically approving its new identifier', () => {
  const store = new SqliteStore(':memory:');
  try {
    store.saveProject(
      projectSchema.parse({ id: 'p', name: 'Project', targetLocales: ['de'], budgetUsd: 1 }),
    );
    store.importSources('p', [
      unitSchema.parse({ id: 'article:0', source: 'Hello', context: 'Paragraph' }),
    ]);
    const job = store.enqueue('p', ['article:0'], ['de'], 'original')[0]!;
    const claim = store.claim(() => 0)!;
    store.complete(job.id, claim.leaseToken, 'Hallo', [], 'Reviewed');
    store.approve('p', job.id, 1, 'owner');
    store.importSources('p', [
      unitSchema.parse({ id: 'article:1', source: 'Hello', context: 'Paragraph' }),
    ]);
    const moved = store.enqueue('p', ['article:1'], ['de'], 'moved')[0]!;
    assert.equal(moved.status, 'review');
    assert.equal(moved.translation, 'Hallo');
    assert.equal(
      store.claim(() => 0),
      null,
    );
    assert.equal(store.exportCatalog('p', 'de').messages['article:1'], undefined);
  } finally {
    store.close();
  }
});
