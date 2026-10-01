import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';
import { projectSchema, unitSchema } from '../packages/core/dist/index.js';
const store = new SqliteStore(':memory:');
store.saveProject(
  projectSchema.parse({
    id: 'demo',
    name: 'Review workspace demo',
    targetLocales: ['ar', 'zh-Hant-TW', 'de', 'es', 'fr'],
    budgetUsd: 5,
  }),
);
store.importSources('demo', [
  unitSchema.parse({
    id: 'welcome',
    source: 'Welcome, {name}',
    kind: 'icu',
    context: 'Greeting after sign-in. Preserve the account name.',
  }),
]);
store.enqueue('demo', ['welcome'], ['ar', 'zh-Hant-TW', 'de', 'es', 'fr'], 'demo');
const translations: Record<string, string> = {
  ar: 'مرحبًا، {name}',
  'zh-Hant-TW': '歡迎，{name}',
  de: 'Willkommen, {name}',
  es: 'Bienvenido, {name}',
  fr: 'Bienvenue, {name}',
};
for (let i = 0; i < 5; i++) {
  const job = store.claim(() => 0)!;
  store.complete(
    job.record.id,
    job.leaseToken,
    translations[job.record.locale]!,
    [],
    'Demo wording for interface testing. No model or native-language evaluation was performed.',
  );
}
const article = store.importDocument(
  'demo',
  'article',
  'html',
  '<h1>About EveryLocale</h1><p>A useful report.</p><p>Read <a href="https://example.test/guide">the guide</a>.</p><img src="https://example.test/pixel" alt="A diagram"><script>window.__untrusted_preview=true</script>',
);
store.enqueue('demo', article.units, ['ar'], 'article-demo');
for (;;) {
  const job = store.claim(() => 0);
  if (!job) break;
  const translation = job.record.source.source
    .replace('About', 'حول')
    .replace('A useful report', 'تقرير مفيد')
    .replace('Read', 'اقرأ')
    .replace('the guide', 'الدليل')
    .replace('A diagram', 'رسم توضيحي');
  store.complete(
    job.record.id,
    job.leaseToken,
    translation,
    [],
    'Interface fixture only; no native-language evaluation.',
  );
}
const app = await createApp(store, {
  adminToken: 'disposable-ui-test-owner-token-32-chars',
  sessionSecret: 'disposable-independent-ui-session-secret',
  publicOrigin: 'http://localhost:4314',
  secureCookie: false,
  providersReady: false,
});
await app.listen({ host: '127.0.0.1', port: 4314 });
console.log('Disposable UI demo listening on localhost:4314.');
const stop = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
