import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { TranslationRecord } from '../packages/core/dist/index.js';

const compose = ['compose', '-p', 'everylocale-smoke', '-f', 'tests/wordpress/compose.yaml'];
const admin = 'disposable-owner-token-32-characters-long';
async function docker(args: string[], raw = false) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('docker', [...(raw ? [] : compose), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`Docker exited ${code}: ${output.slice(-8000)}`)),
    );
  });
}
async function wp(...args: string[]) {
  const name = `everylocale-smoke-cli-${randomUUID()}`;
  let failed = false;
  try {
    try {
      await docker(['run', '--name', name, '-T', 'cli', 'wp', ...args]);
    } catch {
      failed = true;
    }
    const output = await docker(['logs', name], true);
    if (failed) throw new Error(output);
    return output;
  } finally {
    await docker(['rm', '--force', name], true);
  }
}
const evaluate = (code: string) => wp('eval', code);
async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const response = await fetch(`http://localhost:4312/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
const jobs = async (): Promise<TranslationRecord[]> =>
  (await api('/projects/wordpress/jobs')).records;
async function until(check: () => Promise<boolean>, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Docker integration did not reach the expected state');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const dictionary = {
  'Hello localization': 'Bonjour localisation',
  'hello-localization': 'bonjour-localisation',
  'Hello world.': 'Bonjour le monde.',
  Uncategorized: 'Sans catégorie',
  'New source.': 'Nouvelle source.',
};
const fixture = `import {createServer} from 'node:http';const dictionary=${JSON.stringify(dictionary)};createServer(async(request,response)=>{let body='';for await(const chunk of request)body+=chunk;const payload=JSON.parse(body),input=JSON.parse(payload.messages[1].content);const value=payload.model==='reviewer'?{findings:[],summary:'Local transport fixture only.'}:{translation:dictionary[input.source]??input.source};response.setHeader('content-type','application/json');response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:50,completion_tokens:20}}));}).listen(4320,'0.0.0.0');`;
try {
  console.log(
    'Starting isolated WordPress, MariaDB, model transport fixture, and the real EveryLocale Docker release.',
  );
  await docker(['up', '-d', 'db', 'wordpress']);
  await docker(
    [
      'run',
      '-d',
      '--name',
      'everylocale-smoke-provider',
      '--network',
      'everylocale-smoke_default',
      'node:24-bookworm-slim',
      'node',
      '--input-type=module',
      '-e',
      fixture,
    ],
    true,
  );
  const environment = {
    EVERYLOCALE_ADMIN_TOKEN: admin,
    EVERYLOCALE_SESSION_SECRET: 'disposable-independent-session-secret-long',
    EVERYLOCALE_PUBLIC_ORIGIN: 'http://localhost:4312',
    EVERYLOCALE_GENERATOR_URL: 'http://everylocale-smoke-provider:4320/v1',
    EVERYLOCALE_REVIEWER_URL: 'http://everylocale-smoke-provider:4320/v1',
    EVERYLOCALE_GENERATOR_MODEL: 'generator',
    EVERYLOCALE_REVIEWER_MODEL: 'reviewer',
    EVERYLOCALE_GENERATOR_INPUT_PRICE: '0',
    EVERYLOCALE_GENERATOR_OUTPUT_PRICE: '0',
    EVERYLOCALE_REVIEWER_INPUT_PRICE: '0',
    EVERYLOCALE_REVIEWER_OUTPUT_PRICE: '0',
    EVERYLOCALE_PROVIDER_INTERVAL_MS: '0',
  };
  await docker(
    [
      'run',
      '-d',
      '--name',
      'everylocale-smoke-api',
      '--network',
      'everylocale-smoke_default',
      '-p',
      '127.0.0.1:4312:4310',
      ...Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      'everylocale:0.2.0',
    ],
    true,
  );
  await until(async () => {
    try {
      return (await fetch('http://localhost:4312/health')).ok;
    } catch {
      return false;
    }
  });
  await api('/projects/wordpress', 'PUT', {
    name: 'Disposable WordPress',
    targetLocales: ['fr'],
    budgetUsd: 1,
  });
  const token = await api('/projects/wordpress/tokens', 'POST', {
    scopes: ['read', 'import', 'translate', 'export'],
    expiresAt: Date.now() + 3600000,
  });
  for (let attempt = 0; ; attempt++) {
    try {
      await wp(
        'core',
        'install',
        '--url=http://localhost:4313',
        '--title=EveryLocale test',
        '--admin_user=owner',
        '--admin_password=disposable-test-password',
        '--admin_email=owner@example.test',
        '--skip-email',
      );
      break;
    } catch (error) {
      if (attempt >= 15) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await docker(
    [
      'cp',
      'adapters/wordpress/everylocale',
      'everylocale-smoke-wordpress-1:/var/www/html/wp-content/plugins/everylocale',
    ],
    true,
  );
  await wp('plugin', 'activate', 'everylocale');
  await wp('rewrite', 'structure', '/%postname%/');
  await evaluate(
    `update_option('everylocale_settings',${phpArray({ url: 'http://everylocale-smoke-api:4310', project: 'wordpress', token: token.token, source_locale: 'en', locales: 'fr' })});`,
  );
  const id = Number(
    (
      await evaluate(
        "$id=wp_insert_post(['post_type'=>'post','post_status'=>'publish','post_author'=>1,'post_title'=>'Hello localization','post_content'=>'<p>Hello world.</p>']);wp_update_post(['ID'=>$id,'post_content'=>'<p>Hello world.</p><p>Read <a href=\"'.get_permalink($id).'\">this article</a>.</p>']); EveryLocale_Connector::sync($id); echo $id;",
      )
    )
      .split('\n')
      .at(-1),
  );
  assert.ok(id > 0);
  console.log('WordPress source imported.');
  await until(async () => {
    const records = await jobs();
    return records.length > 0 && records.every((job) => job.status === 'review');
  });
  const targetId = Number(
    (
      await evaluate(
        `$posts=get_posts(['post_status'=>'draft','meta_key'=>'_everylocale_source_id','meta_value'=>${id}]);echo $posts[0]->ID;`,
      )
    )
      .split('\n')
      .at(-1),
  );
  assert.ok(targetId > 0);
  assert.equal(await status(targetId), 'draft');
  console.log(
    'Source publication creates linked drafts without publishing unapproved translations.',
  );
  const unavailable = await fetch('http://localhost:4313/fr/hello-localization/');
  assert.equal(unavailable.status, 404);
  assert.match(await unavailable.text(), /Read the original article/);
  const draftSitemap = await fetch('http://localhost:4313/everylocale-sitemap-1.xml');
  assert.equal(draftSitemap.status, 200);
  assert.doesNotMatch(await draftSitemap.text(), /hreflang="fr"/);
  for (const job of await jobs()) await approve(job);
  await evaluate(`EveryLocale_Connector::sync(${id});`);
  assert.equal(await status(targetId), 'publish');
  assert.match(await content(targetId), /Bonjour le monde/);
  const page = await fetch('http://localhost:4313/fr/bonjour-localisation/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /lang="fr"/);
  assert.match(html, /hreflang="x-default"/);
  assert.match(html, /hreflang="fr"/);
  assert.match(
    html,
    /Read <a href="http:\/\/localhost:4313\/fr\/bonjour-localisation\/">this article<\/a>/,
  );
  const sitemap = await fetch('http://localhost:4313/everylocale-sitemap-1.xml');
  const xml = await sitemap.text();
  assert.match(xml, /hreflang="fr"/);
  assert.match(xml, /hreflang="x-default"/);
  assert.match(xml, /\/fr\/bonjour-localisation\//);
  const englishPosts = (await (
    await fetch('http://localhost:4313/wp-json/wp/v2/posts')
  ).json()) as Array<{ id: number }>;
  assert.ok(!englishPosts.some((post) => post.id === targetId));
  const frenchPosts = (await (
    await fetch('http://localhost:4313/wp-json/wp/v2/posts?el_locale=fr')
  ).json()) as Array<{ id: number }>;
  assert.ok(frenchPosts.some((post) => post.id === targetId));
  assert.ok(!frenchPosts.some((post) => post.id === id));
  const job = (await jobs()).find((job) => job.source.source === 'Hello world.')!;
  await api(`/projects/wordpress/jobs/${job.id}`, 'PATCH', {
    revision: job.revision,
    translation: 'Bonjour à tous.',
  });
  await until(
    async () => (await jobs()).find((candidate) => candidate.id === job.id)?.status === 'review',
  );
  await approve((await jobs()).find((candidate) => candidate.id === job.id)!);
  await evaluate(`EveryLocale_Connector::sync(${id});`);
  assert.match(await content(targetId), /Bonjour à tous/);
  console.log(
    'Approval publishes localized content, SEO links, and corrections to an already published source.',
  );
  const slug = (await jobs()).find(
    (candidate) => candidate.source.source === 'hello-localization',
  )!;
  await api(`/projects/wordpress/jobs/${slug.id}`, 'PATCH', {
    revision: slug.revision,
    translation: 'bonjour-ailleurs',
  });
  await until(
    async () => (await jobs()).find((candidate) => candidate.id === slug.id)?.status === 'review',
  );
  await approve((await jobs()).find((candidate) => candidate.id === slug.id)!);
  await evaluate(`EveryLocale_Connector::sync(${id});`);
  const redirected = await fetch('http://localhost:4313/fr/bonjour-localisation/', {
    redirect: 'manual',
  });
  assert.equal(redirected.status, 301);
  assert.match(redirected.headers.get('location') ?? '', /\/fr\/bonjour-ailleurs\//);
  await evaluate(
    `wp_update_post(['ID'=>${id},'post_content'=>'<p>New source.</p>']); EveryLocale_Connector::sync(${id});`,
  );
  assert.match(await content(targetId), /Bonjour à tous/);
  await until(async () =>
    (await jobs())
      .filter((job) => job.status !== 'stale')
      .every((job) => ['approved', 'review'].includes(job.status)),
  );
  for (const candidate of (await jobs()).filter((job) => job.status === 'review'))
    await approve(candidate);
  await evaluate(`EveryLocale_Connector::sync(${id});`);
  assert.match(await content(targetId), /Nouvelle source/);
  await docker(['stop', 'everylocale-smoke-api'], true);
  await evaluate(`wp_delete_post(${id},true);`);
  assert.equal(await status(targetId), 'draft');
  assert.equal(
    (await evaluate(`echo is_array(get_option('everylocale_withdraw_${id}'))?'queued':'missing';`))
      .split('\n')
      .at(-1),
    'queued',
  );
  await docker(['start', 'everylocale-smoke-api'], true);
  await until(async () => {
    try {
      return (await fetch('http://localhost:4312/health')).ok;
    } catch {
      return false;
    }
  });
  await evaluate(`EveryLocale_Connector::deliver_withdrawal(${id});`);
  assert.deepEqual((await api('/projects/wordpress/exports/fr')).messages, {});
  await api('/projects/wordpress', 'PUT', {
    name: 'Disposable WordPress',
    targetLocales: ['fr'],
    budgetUsd: 1,
    approvalMode: 'automatic',
  });
  const automaticSource = Number(
    (
      await evaluate(
        "$id=wp_insert_post(['post_type'=>'post','post_status'=>'publish','post_author'=>1,'post_title'=>'Hello localization','post_name'=>'automatic-example','post_content'=>'<p>Hello world.</p>']);EveryLocale_Connector::sync($id);echo $id;",
      )
    )
      .split('\n')
      .at(-1),
  );
  assert.ok(automaticSource > 0);
  await until(async () => {
    const records = (await jobs()).filter((job) =>
      job.unitId.startsWith(`wp:post:${automaticSource}:`),
    );
    return records.length > 0 && records.every((job) => job.status === 'approved');
  });
  await evaluate(`EveryLocale_Connector::sync(${automaticSource});`);
  const automaticTarget = Number(
    (
      await evaluate(
        `$posts=get_posts(['post_status'=>'publish','meta_key'=>'_everylocale_source_id','meta_value'=>${automaticSource}]);echo $posts[0]->ID;`,
      )
    )
      .split('\n')
      .at(-1),
  );
  assert.ok(automaticTarget > 0);
  assert.equal(await status(automaticTarget), 'publish');
  assert.match(await content(automaticTarget), /Bonjour/);
  const audit = await api('/projects/wordpress/audit');
  assert.ok(
    audit.some(
      (event: { actor: string; action: string }) =>
        event.actor === 'automation' && event.action === 'translation.approve',
    ),
  );
  await evaluate(
    `wp_delete_post(${automaticSource},true);EveryLocale_Connector::deliver_withdrawal(${automaticSource});`,
  );
  assert.equal(await status(automaticTarget), 'draft');
  assert.deepEqual((await api('/projects/wordpress/exports/fr')).messages, {});
  console.log(
    'Human and automatic approval both publish through the real connector; deletion withdraws linked translations. WordPress end-to-end smoke passed.',
  );
} catch (error) {
  console.error(await docker(['logs', 'everylocale-smoke-api'], true).catch(() => ''));
  throw error;
} finally {
  await docker(
    ['rm', '--force', 'everylocale-smoke-api', 'everylocale-smoke-provider'],
    true,
  ).catch(() => {});
  await docker(['down', '--volumes', '--remove-orphans']);
}
function phpArray(values: Record<string, string>) {
  return (
    '[' +
    Object.entries(values)
      .map(([key, value]) => `'${key}'=>'${value.replaceAll("'", "\\'")}'`)
      .join(',') +
    ']'
  );
}
async function status(id: number) {
  return (await evaluate(`echo get_post(${id})->post_status;`)).split('\n').at(-1);
}
function content(id: number) {
  return evaluate(`echo get_post(${id})->post_content;`);
}
function approve(job: TranslationRecord) {
  return api(`/projects/wordpress/jobs/${job.id}/approve`, 'POST', { revision: job.revision });
}
